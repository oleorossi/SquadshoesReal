import { describe, expect, it } from 'vitest';
import {
  ELGIN_FARDO_GAP_X_MM,
  ELGIN_FARDO_PAGE_H_MM,
  ELGIN_FARDO_PAGE_W_DOTS,
  ELGIN_FARDO_PAGE_W_MM,
  buildFardoBatchZpl,
  buildFardoPairZpl,
  elginFardoZplFileName,
  formatFardoCounter,
  formatReprintStamp,
  normalizeFichaCartaoCodigo,
  parseFardoSelection,
  selectFardoLabels,
  type FardoElginLabel,
} from '@/lib/etiquetaFardoElgin';

const sample: FardoElginLabel = {
  codigo: 'PM-000001',
  ficha_index: 1,
  total_fichas: 100,
  pares: 12,
  pv: 'PV-00255',
  op: 'OP-2026-06203',
  modelo: 'SP143',
  cor: 'OFF WHITE',
  sizes: ['34', '35', '36', '37', '38', '39', '40'],
  grade: { '34': 1, '35': 1, '36': 2, '37': 3, '38': 2, '39': 2, '40': 1 },
};

describe('parseFardoSelection', () => {
  it('aceita lista, faixa e mistura no formato 1,5,10:15', () => {
    expect(parseFardoSelection('1,5,10:15', 100)).toEqual([1, 5, 10, 11, 12, 13, 14, 15]);
    expect(parseFardoSelection('1:15', 15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(parseFardoSelection('15:10', 20)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(parseFardoSelection(' 1 ; 5  8 ', 10)).toEqual([1, 5, 8]);
  });

  it('ignora fora do intervalo, lixo e duplicata', () => {
    expect(parseFardoSelection('0,1,1,101,abc,5', 100)).toEqual([1, 5]);
    expect(parseFardoSelection('', 100)).toEqual([]);
    expect(parseFardoSelection('1:3', 0)).toEqual([]);
  });
});

describe('selectFardoLabels', () => {
  const items = [1, 2, 3, 4, 5].map((ficha_index) => ({ ficha_index, codigo: `PM-00000${ficha_index}` }));

  it('campo vazio devolve todos, sem marcar 2ª via', () => {
    const r = selectFardoLabels(items, '  ');
    expect(r.isPartial).toBe(false);
    expect(r.selected).toHaveLength(5);
  });

  it('seleção parcial filtra por ficha_index', () => {
    const r = selectFardoLabels(items, '1,5');
    expect(r.isPartial).toBe(true);
    expect(r.selected.map((x) => x.ficha_index)).toEqual([1, 5]);
  });
});

describe('normalizeFichaCartaoCodigo', () => {
  it('aceita PM canônico, prefixo solto e só dígitos', () => {
    expect(normalizeFichaCartaoCodigo('PM-000001')).toBe('PM-000001');
    expect(normalizeFichaCartaoCodigo(' pm000001 ')).toBe('PM-000001');
    expect(normalizeFichaCartaoCodigo('000001')).toBe('PM-000001');
    expect(normalizeFichaCartaoCodigo('xyz')).toBeNull();
  });
});

describe('buildFardoPairZpl', () => {
  it('emite um par 106×30 com o mesmo Code128 nas duas metades e o número grande', () => {
    expect(ELGIN_FARDO_PAGE_W_MM).toBe(50 + ELGIN_FARDO_GAP_X_MM + 50);
    expect(ELGIN_FARDO_PAGE_H_MM).toBe(30);
    const zpl = buildFardoPairZpl(sample);
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trim().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain(`^PW${ELGIN_FARDO_PAGE_W_DOTS}`);
    expect(zpl).toContain('^LL240');
    expect(zpl).toContain('^FDPALMILHA^FS');
    expect(zpl).toContain('^FDMONTADOR^FS');
    expect((zpl.match(/\^FDPM-000001\^FS/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(zpl).toContain('^BCN,36,N,N,N');
    expect(zpl).toContain('^FD01^FS');
    expect(zpl).toContain('^FD/100^FS');
    expect(zpl).not.toContain('2A VIA');
  });

  it('carimba 2ª VIA nas duas artes quando é reimpressão', () => {
    const at = new Date('2026-11-28T08:00:00-03:00');
    const zpl = buildFardoPairZpl({ ...sample, isReprint: true, reprintAt: at });
    const stamp = formatReprintStamp(at);
    expect(stamp).toBe('28/11/26');
    expect((zpl.match(/2A VIA 28\/11\/26/g) || []).length).toBe(2);
  });

  it('escapa ^ e ~ do cadastro para não quebrar o ZPL', () => {
    const zpl = buildFardoPairZpl({ ...sample, cor: 'OFF^WHITE~X', modelo: 'SP_143' });
    expect(zpl).toContain('_5E');
    expect(zpl).toContain('_7E');
    expect(zpl).toContain('_5F');
    expect(zpl).not.toContain('^WHITE');
  });

  it('gera um bloco por fardo no lote e um nome de arquivo estável', () => {
    const batch = buildFardoBatchZpl([
      sample,
      { ...sample, codigo: 'PM-000002', ficha_index: 2 },
    ]);
    expect((batch.match(/\^XA/g) || []).length).toBe(2);
    expect(elginFardoZplFileName('PV-00255')).toBe('Etiquetas_Fardo_PV-00255_106x30.zpl');
    expect(formatFardoCounter(1, 100).label).toBe('01/100');
  });
});
