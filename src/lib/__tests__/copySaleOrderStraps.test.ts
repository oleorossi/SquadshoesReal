import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  copyStrapLinesForNewOrder,
  type CopyStrapLineLike,
} from '@/lib/copySaleOrderStraps';

const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COLOR_ROSADO = '11111111-1111-4111-8111-111111111111';
const COLOR_TAN = '22222222-2222-4222-8222-222222222222';
const COLOR_INATIVA = '77777777-7777-4777-8777-777777777777';
const GROUP_STRASS = '33333333-3333-4333-8333-333333333333';
const GROUP_MEIA = '44444444-4444-4444-8444-444444444444';
const NAPA_SOFT = '88888888-8888-4888-8888-888888888888';
const NAPA_SUDANI = '99999999-9999-4999-8999-999999999999';
const MEASURE = '55555555-5555-4555-8555-555555555555';
const TYPE = '66666666-6666-4666-8666-666666666666';

const colorMap: Record<string, string> = {
  'ROSADO COM FUNDO ROSADO': COLOR_ROSADO,
  TAN: COLOR_TAN,
};
const resolveColorId = (name: string) => colorMap[name.trim().toUpperCase()] || null;
const activeColorIds = new Set([COLOR_ROSADO, COLOR_TAN]);

function sheetLine(id: string, patch: Partial<CopyStrapLineLike>): CopyStrapLineLike {
  return {
    id,
    technical_strap_line_id: id,
    measure_id: MEASURE,
    strap_type_id: TYPE,
    consumption: 40,
    consumption_per_size: { '34': 40 },
    ...patch,
  };
}

const technical: CopyStrapLineLike[] = [
  sheetLine(LINE_A, {
    label: 'TIRA 1',
    identity_basis: 'finished_product_group',
    identity_group_id: GROUP_STRASS,
    group_id: GROUP_STRASS,
    color_mode: 'select_on_order',
  }),
  sheetLine(LINE_B, {
    label: 'TIRA 2',
    identity_basis: 'reference_base',
    group_id: GROUP_MEIA,
    color_mode: 'follow_main',
  }),
  sheetLine(LINE_C, {
    label: 'TIRA 3',
    identity_basis: 'finished_product_group',
    identity_group_id: GROUP_STRASS,
    group_id: GROUP_STRASS,
    color_mode: 'select_on_order',
  }),
];

function copy(snapshotLines: CopyStrapLineLike[], technicalLines = technical) {
  return copyStrapLinesForNewOrder({
    snapshotLines,
    technicalLines,
    resolveColorId,
    activeColorIds,
    itemLabel: 'NL02 / PRETO',
  });
}

describe('copyStrapLinesForNewOrder', () => {
  it('PV legado (id ordinal): casa por rótulo único e resolve a cor pelo nome', () => {
    const result = copy([
      { id: '1', label: 'TIRA 1', color: 'ROSADO COM FUNDO ROSADO' },
      { id: '2', label: 'TIRA 2', color: 'TAN' },
      { id: '3', label: 'TIRA 3', color: 'ROSADO COM FUNDO ROSADO' },
    ]);
    expect(result.pending).toEqual([]);
    expect(result.lines.map((l) => l.technical_strap_line_id)).toEqual([LINE_A, LINE_B, LINE_C]);
    expect(result.lines[0]).toMatchObject({ color_id: COLOR_ROSADO });
    expect(result.lines[2]).toMatchObject({ color_id: COLOR_ROSADO });
  });

  it('snapshot canônico atravessa pelo UUID', () => {
    const snapshot = technical.map((line, i) => ({
      ...line,
      color: i === 1 ? 'TAN' : 'ROSADO COM FUNDO ROSADO',
      color_id: i === 1 ? COLOR_TAN : COLOR_ROSADO,
    }));
    const result = copy(snapshot);
    expect(result.pending).toEqual([]);
    expect(result.lines.map((l) => l.color_id)).toEqual([COLOR_ROSADO, COLOR_TAN, COLOR_ROSADO]);
  });

  it('NUNCA casa por posição: rótulo que não existe na ficha vira pendência nomeada', () => {
    const result = copy([
      { id: '1', label: 'TIRA FRENTE', color: 'ROSADO COM FUNDO ROSADO' },
      { id: '2', label: 'TIRA 2', color: 'TAN' },
      { id: '3', label: 'TIRA 3', color: 'ROSADO COM FUNDO ROSADO' },
    ]);
    expect(result.lines[0].color_id ?? null).toBeNull();
    expect(result.lines[2]).toMatchObject({ color_id: COLOR_ROSADO });
    expect(result.pending).toEqual(['NL02 / PRETO, TIRA 1: escolha a cor']);
  });

  it('rótulo repetido no PV de origem é ambíguo e não atravessa', () => {
    const result = copy([
      { id: '1', label: 'TIRA 1', color: 'ROSADO COM FUNDO ROSADO' },
      { id: '9', label: 'TIRA 1', color: 'TAN' },
    ]);
    expect(result.lines[0].color_id ?? null).toBeNull();
    expect(result.pending).toContain('NL02 / PRETO, TIRA 1: escolha a cor');
  });

  it('cor inativa no catálogo não atravessa', () => {
    const snapshot = technical.map((line) => ({ ...line, color: 'VELHA', color_id: COLOR_INATIVA }));
    const result = copy(snapshot);
    expect(result.pending).toEqual([
      'NL02 / PRETO, TIRA 1: escolha a cor',
      'NL02 / PRETO, TIRA 3: escolha a cor',
    ]);
  });

  it('leva o material escolhido no pedido quando a ficha ainda permite', () => {
    const tech = [sheetLine(LINE_A, {
      label: 'TIRA 1',
      identity_basis: 'reference_base',
      color_mode: 'follow_main',
      material_mode: 'select_on_order',
      allowed_material_group_ids: [NAPA_SOFT, NAPA_SUDANI],
    })];
    const ok = copy([{ ...tech[0], base_group_id: NAPA_SUDANI, base_group_name: 'NAPA SUDANI' }], tech);
    expect(ok.pending).toEqual([]);
    expect(ok.lines[0].base_group_id).toBe(NAPA_SUDANI);

    const removed = copy([{ ...tech[0], base_group_id: '12121212-1212-4212-8212-121212121212' }], tech);
    expect(removed.lines[0].base_group_id ?? null).toBeNull();
    expect(removed.pending).toEqual(['NL02 / PRETO, TIRA 1: escolha o material']);
  });

  it('ficha sem tiras devolve vazio', () => {
    expect(copy([{ id: '1', label: 'TIRA 1' }], [])).toEqual({ lines: [], pending: [], gaps: [] });
  });

  it('ficha com tira sem UUID vira pendência, não exceção', () => {
    const result = copy([], [{ id: '1', label: 'TIRA 1' }]);
    expect(result.lines).toEqual([]);
    expect(result.pending[0]).toMatch(/sem identificador estável/);
  });
});

/**
 * Regressão PV-00148 → "Duplicar para lojas" (11/10/2026).
 *
 * PV legado gravava a tira comprada pronta só como TEXTO, e às vezes com a cor
 * do CALÇADO ("OFF WHITE") em vez da cor da tira. Esse texto resolve para uma
 * cor canônica ATIVA, atravessava a cópia e só então
 * `prepare_sale_order_item_internal_straps` abortava o PV INTEIRO com
 * "Tira comprada pronta nao possui variante comercial ativa exata" — sem dizer
 * item nem tira, e derrubando a loja toda.
 */
describe('tira comprada pronta sem variante comercial', () => {
  const COLOR_OFF_WHITE = 'aaaa1111-1111-4111-8111-111111111111';
  const keys = new Set([`${MEASURE}|${GROUP_STRASS}|${COLOR_ROSADO}`.toLowerCase()]);

  const snapshot: CopyStrapLineLike[] = [
    { id: '1', label: 'TIRA 1', color: 'OFF WHITE', group_id: GROUP_STRASS, group_name: 'TIRA STRASS 6MM' },
  ];

  const run = (buyReadyVariantKeys: ReadonlySet<string> | null) => copyStrapLinesForNewOrder({
    snapshotLines: snapshot,
    technicalLines: [technical[0]],
    resolveColorId: (name) => (name.trim().toUpperCase() === 'OFF WHITE' ? COLOR_OFF_WHITE : resolveColorId(name)),
    activeColorIds: new Set([...activeColorIds, COLOR_OFF_WHITE]),
    buyReadyVariantKeys,
    itemLabel: 'NL02 / OFF WHITE',
  });

  it('vira pendência nomeada em vez de erro cru do writer', () => {
    const { pending } = run(keys);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toContain('NL02 / OFF WHITE');
    expect(pending[0]).toContain('TIRA 1');
    expect(pending[0]).toContain('OFF WHITE');
    expect(pending[0]).toContain('TIRA STRASS 6MM');
  });

  it('cor COM variante ativa continua passando', () => {
    const { pending } = copyStrapLinesForNewOrder({
      snapshotLines: [{ ...snapshot[0], color: 'ROSADO COM FUNDO ROSADO' }],
      technicalLines: [technical[0]],
      resolveColorId,
      activeColorIds,
      buyReadyVariantKeys: keys,
      itemLabel: 'NL01 / OFF WHITE',
    });
    expect(pending).toEqual([]);
  });

  it('sem catálogo carregado não inventa pendência — o writer ainda barra', () => {
    expect(run(null).pending).toEqual([]);
  });
});

/**
 * Escolher a cor no diálogo de duplicação (12/10/2026).
 *
 * O pedido de origem pode estar APROVADO/EXPEDIDO, e aí seu snapshot é
 * congelado (`isCommittedSaleOrderStrapSnapshotStatus`) — a cor errada não tem
 * como ser corrigida lá. Sem uma saída na própria duplicação, um PV legado com
 * tira sem variante nunca mais duplica.
 */
describe('escolha de cor da tira pronta na duplicação', () => {
  const COLOR_OFF_WHITE = 'aaaa1111-1111-4111-8111-111111111111';
  const scope = `${MEASURE}|${GROUP_STRASS}`.toLowerCase();
  const keys = new Set([`${MEASURE}|${GROUP_STRASS}|${COLOR_ROSADO}`.toLowerCase()]);
  const colorsByScope = new Map([[scope, [{ id: COLOR_ROSADO, name: 'ROSADO COM FUNDO ROSADO' }]]]);

  const semVariante: CopyStrapLineLike[] = [
    { id: '1', label: 'TIRA 1', color: 'OFF WHITE', group_id: GROUP_STRASS, group_name: 'TIRA STRASS 6MM' },
  ];
  const comVariante: CopyStrapLineLike[] = [
    { id: '1', label: 'TIRA 1', color: 'ROSADO COM FUNDO ROSADO', group_id: GROUP_STRASS, group_name: 'TIRA STRASS 6MM' },
  ];

  const run = (
    snapshotLines: CopyStrapLineLike[],
    buyReadyColorChoices?: ReadonlyMap<string, string> | null,
  ) => copyStrapLinesForNewOrder({
    snapshotLines,
    technicalLines: [technical[0]],
    resolveColorId: (name) => (name.trim().toUpperCase() === 'OFF WHITE' ? COLOR_OFF_WHITE : resolveColorId(name)),
    activeColorIds: new Set([...activeColorIds, COLOR_OFF_WHITE]),
    buyReadyVariantKeys: keys,
    buyReadyColorsByScope: colorsByScope,
    buyReadyColorChoices,
    itemLabel: 'NL02 / OFF WHITE',
  });

  it('expõe a lacuna com as cores cadastradas para escolher', () => {
    const { gaps } = run(semVariante);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].strapLabel).toBe('TIRA 1');
    expect(gaps[0].currentColorName).toBe('OFF WHITE');
    expect(gaps[0].groupName).toBe('TIRA STRASS 6MM');
    expect(gaps[0].options).toEqual([{ id: COLOR_ROSADO, name: 'ROSADO COM FUNDO ROSADO' }]);
  });

  it('a escolha resolve a lacuna e entra na linha copiada', () => {
    const { gaps, pending, lines } = run(semVariante, new Map([[LINE_A, COLOR_ROSADO]]));
    expect(gaps).toEqual([]);
    expect(pending).toEqual([]);
    expect(lines[0].color_id).toBe(COLOR_ROSADO);
    expect(lines[0].color).toBe('ROSADO COM FUNDO ROSADO');
  });

  it('NÃO sobrescreve a cor de um item que já estava correta', () => {
    const { lines, pending } = run(comVariante, new Map([[LINE_A, COLOR_ROSADO]]));
    expect(pending).toEqual([]);
    expect(lines[0].color_id).toBe(COLOR_ROSADO);
  });

  it('sem cadastro no escopo, a lacuna vem sem opção — só o Hub resolve', () => {
    const { gaps } = copyStrapLinesForNewOrder({
      snapshotLines: semVariante,
      technicalLines: [technical[0]],
      resolveColorId: (name) => (name.trim().toUpperCase() === 'OFF WHITE' ? COLOR_OFF_WHITE : resolveColorId(name)),
      activeColorIds: new Set([...activeColorIds, COLOR_OFF_WHITE]),
      buyReadyVariantKeys: keys,
      buyReadyColorsByScope: new Map(),
      itemLabel: 'NL02 / OFF WHITE',
    });
    expect(gaps[0].options).toEqual([]);
  });
});
