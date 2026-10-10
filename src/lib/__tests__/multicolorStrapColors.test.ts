import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  keptStrapColorsMessage,
  syncMulticolorStrapColors,
  type StrapColorChoice,
} from '@/lib/multicolorStrapColors';
import {
  applyTechnicalStrapMulticolor,
  technicalStrapMulticolorSummary,
} from '@/lib/technicalStrapLines';
import { copyStrapLinesForNewOrder, type CopyStrapLineLike } from '@/lib/copySaleOrderStraps';

const PRETO: StrapColorChoice = { id: '11111111-1111-4111-8111-111111111111', name: 'PRETO' };
const CARAMELO: StrapColorChoice = { id: '22222222-2222-4222-8222-222222222222', name: 'CARAMELO' };
const OURO: StrapColorChoice = { id: '33333333-3333-4333-8333-333333333333', name: 'OURO' };
const BRANCO: StrapColorChoice = { id: '44444444-4444-4444-8444-444444444444', name: 'BRANCO' };

interface Line { label: string; mode: 'follow_main' | 'select_on_order'; color?: string; color_id?: string | null }

const eligible = (line: Line) => line.mode === 'select_on_order';

describe('syncMulticolorStrapColors — pré-preenchimento (Q24)', () => {
  it('tira multicolor vazia vem com a cor principal quando ela existe para a tira', () => {
    const lines: Line[] = [
      { label: 'TIRA 1', mode: 'select_on_order', color: '', color_id: null },
      { label: 'TIRA 2', mode: 'select_on_order', color: '', color_id: null },
      { label: 'TIRA 3', mode: 'follow_main', color: 'PRETO', color_id: PRETO.id },
    ];
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible,
      // TIRA 2 não tem PRETO no catálogo: fica vazia (o guarda de save a nomeia).
      allowedColors: (line) => (line.label === 'TIRA 2' ? [CARAMELO, OURO] : [PRETO, CARAMELO]),
      nextMainColor: 'Preto',
    });
    expect(result.straps[0]).toMatchObject({ color: 'PRETO', color_id: PRETO.id });
    expect(result.straps[1]).toMatchObject({ color: '', color_id: null });
    expect(result.straps[2]).toBe(lines[2]);
    expect(result.changedIndexes).toEqual([0]);
  });

  it('não pré-preenche enquanto as cores da tira não foram resolvidas', () => {
    const lines: Line[] = [{ label: 'TIRA 1', mode: 'select_on_order', color: '', color_id: null }];
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible, allowedColors: () => null, nextMainColor: 'PRETO',
    });
    expect(result.straps).toBe(lines);
    expect(result.changedIndexes).toEqual([]);
  });

  it('prefere o UUID canônico da cor principal (alias aprovado) ao nome', () => {
    const lines: Line[] = [{ label: 'TIRA 1', mode: 'select_on_order', color: '', color_id: null }];
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible,
      allowedColors: () => [PRETO, CARAMELO],
      nextMainColor: 'PRETO FOSCO',
      nextMainColorId: PRETO.id,
    });
    expect(result.straps[0]).toMatchObject({ color: 'PRETO', color_id: PRETO.id });
  });

  it('não sobrescreve uma cor já escolhida sem troca da principal', () => {
    const lines: Line[] = [{ label: 'TIRA 1', mode: 'select_on_order', color: 'OURO', color_id: OURO.id }];
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible, allowedColors: () => [PRETO, OURO], nextMainColor: 'PRETO',
    });
    expect(result.straps).toBe(lines);
  });
});

describe('syncMulticolorStrapColors — troca da cor principal (Q25)', () => {
  const lines: Line[] = [
    { label: 'TIRA 1', mode: 'select_on_order', color: 'PRETO', color_id: PRETO.id },
    { label: 'TIRA 2', mode: 'select_on_order', color: 'OURO', color_id: OURO.id },
    { label: 'TIRA 3', mode: 'select_on_order', color: 'PRETO', color_id: PRETO.id },
  ];

  it('tiras na cor antiga acompanham; as trocadas à mão mantêm', () => {
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible,
      allowedColors: (line) => (line.label === 'TIRA 3' ? [PRETO, OURO] : [PRETO, CARAMELO, OURO]),
      nextMainColor: 'CARAMELO',
      previousMainColor: 'PRETO',
      previousMainColorId: PRETO.id,
    });
    expect(result.straps[0]).toMatchObject({ color: 'CARAMELO', color_id: CARAMELO.id });
    expect(result.straps[1]).toBe(lines[1]);
    // CARAMELO não existe para a TIRA 3: fica vazia para o usuário escolher.
    expect(result.straps[2]).toMatchObject({ color: '', color_id: null });
    expect(result.followed).toBe(2);
    expect(result.kept).toBe(1);
    expect(result.changedIndexes).toEqual([0, 2]);
    expect(keptStrapColorsMessage(result.kept)).toBe('1 tira manteve a cor escolhida.');
  });

  it('primeira escolha da cor principal (antes vazia) só pré-preenche', () => {
    const result = syncMulticolorStrapColors(lines, {
      isEligible: eligible,
      allowedColors: () => [PRETO, CARAMELO, OURO],
      nextMainColor: 'CARAMELO',
      previousMainColor: '',
    });
    expect(result.straps).toBe(lines);
    expect(result.kept).toBe(0);
  });

  it('mensagem no plural e nula quando nada foi mantido', () => {
    expect(keptStrapColorsMessage(0)).toBeNull();
    expect(keptStrapColorsMessage(2)).toBe('2 tiras mantiveram a cor escolhida.');
  });
});

describe('ficha técnica — "Tiras com cores combinadas" (Q23)', () => {
  const sheet = [
    { technical_strap_line_id: 'a', identity_basis: 'reference_base' as const, color_mode: 'follow_main' as const },
    { technical_strap_line_id: 'b', identity_basis: 'reference_base' as const, color_mode: 'follow_main' as const },
    { technical_strap_line_id: 'c', identity_basis: 'finished_product_group' as const, identity_group_id: 'g', color_mode: 'select_on_order' as const },
  ];

  it('desligado: Strass sozinho (comprado pronto) não torna o modelo multicolor', () => {
    expect(technicalStrapMulticolorSummary(sheet)).toEqual({
      configurable: 2, selectOnOrder: 0, multicolor: false, mixed: false,
    });
  });

  it('ligar = todas com cor no pedido; desligar = todas seguem a principal; Strass não muda', () => {
    const on = applyTechnicalStrapMulticolor(sheet, true);
    expect(on.map((line) => line.color_mode)).toEqual(['select_on_order', 'select_on_order', 'select_on_order']);
    expect(on.map((line) => line.technical_strap_line_id)).toEqual(['a', 'b', 'c']);
    expect(technicalStrapMulticolorSummary(on)).toMatchObject({ multicolor: true, mixed: false });

    const off = applyTechnicalStrapMulticolor(on, false);
    expect(off.map((line) => line.color_mode)).toEqual(['follow_main', 'follow_main', 'select_on_order']);
    expect(technicalStrapMulticolorSummary(off).multicolor).toBe(false);
  });

  it('estado misto: interruptor ligado com "N de M"', () => {
    const mixed = [{ ...sheet[0], color_mode: 'select_on_order' as const }, sheet[1], sheet[2]];
    expect(technicalStrapMulticolorSummary(mixed)).toEqual({
      configurable: 2, selectOnOrder: 1, multicolor: true, mixed: true,
    });
  });
});

describe('cópia de PV multicolor (Q27)', () => {
  const MEASURE = '55555555-5555-4555-8555-555555555555';
  const TYPE = '66666666-6666-4666-8666-666666666666';
  const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
  const technical: CopyStrapLineLike[] = ids.map((id, index) => ({
    id,
    technical_strap_line_id: id,
    label: `TIRA ${index + 1}`,
    identity_basis: 'reference_base',
    color_mode: 'select_on_order',
    measure_id: MEASURE,
    strap_type_id: TYPE,
    consumption: 40,
  }));

  it('leva a cor de cada tira, inclusive as iguais à principal', () => {
    const snapshot = technical.map((line, index) => ({
      ...line,
      ...[PRETO, OURO, PRETO].map((color) => ({ color: color.name, color_id: color.id }))[index],
    }));
    const result = copyStrapLinesForNewOrder({
      snapshotLines: snapshot,
      technicalLines: technical,
      resolveColorId: () => null,
      activeColorIds: new Set([PRETO.id, OURO.id, BRANCO.id]),
      itemLabel: 'I90I / PRETO',
    });
    expect(result.pending).toEqual([]);
    expect(result.lines.map((line) => [line.label, line.color, line.color_id])).toEqual([
      ['TIRA 1', 'PRETO', PRETO.id],
      ['TIRA 2', 'OURO', OURO.id],
      ['TIRA 3', 'PRETO', PRETO.id],
    ]);
    expect(result.lines.every((line) => line.color_mode === 'select_on_order')).toBe(true);
  });
});
