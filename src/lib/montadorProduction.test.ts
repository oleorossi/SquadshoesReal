import { describe, it, expect } from 'vitest';
import {
  paresDiffOfRow,
  sumProducaoRows,
  aggregateProducaoByMontador,
  isChamadaRow,
  type FichaMontadorRow,
} from './montadorProduction';

const row = (o: Partial<FichaMontadorRow>): FichaMontadorRow => ({
  montador_id: 'm1', dia: '2026-07-05', origem: 'chamada',
  detalhe: null, total: null, numeracoes: [],
  valor_par: null, valor_par_medio: null, valor_par_dificil: null, ...o,
});

describe('paresDiffOfRow', () => {
  it('soma médio/difícil por tamanho do detalhe', () => {
    const f = row({ detalhe: [
      { tamanho: 12, medio: 12, dificil: 0 },
      { tamanho: 15, medio: 0, dificil: 15 },
      { tamanho: 18, medio: 18, dificil: 18 },
    ] });
    expect(paresDiffOfRow(f)).toEqual({ medio: 30, dificil: 33 });
  });

  it('detalhe legado {tamanho, pares} conta tudo como médio', () => {
    const f = row({ detalhe: [{ tamanho: 12, pares: 24 }] });
    expect(paresDiffOfRow(f)).toEqual({ medio: 24, dificil: 0 });
  });

  it('sem detalhe usa total como médio', () => {
    expect(paresDiffOfRow(row({ detalhe: null, total: 40 }))).toEqual({ medio: 40, dificil: 0 });
  });
});

describe('sumProducaoRows', () => {
  it('bruto = paresMedio×vm + paresDificil×vd (snapshot por linha)', () => {
    const rows = [
      row({ detalhe: [{ tamanho: 12, medio: 100, dificil: 20 }], valor_par_medio: 1.1, valor_par_dificil: 1.4 }),
      row({ dia: '2026-07-06', detalhe: [{ tamanho: 15, medio: 30, dificil: 0 }], valor_par_medio: 1.1, valor_par_dificil: 1.4 }),
    ];
    const agg = sumProducaoRows(rows);
    expect(agg.paresMedio).toBe(130);
    expect(agg.paresDificil).toBe(20);
    expect(agg.pares).toBe(150);
    // 130×1,1 + 20×1,4 = 143 + 28 = 171
    expect(agg.bruto).toBeCloseTo(171, 5);
  });

  it('usa valor_par legado como médio quando valor_par_medio nulo', () => {
    const agg = sumProducaoRows([
      row({ detalhe: [{ tamanho: 12, medio: 10, dificil: 0 }], valor_par: 2, valor_par_medio: null }),
    ]);
    expect(agg.bruto).toBeCloseTo(20, 5);
  });

  it('ignora linha legado (origem legacy / por-grade) pra não duplicar', () => {
    const agg = sumProducaoRows([
      row({ origem: 'legacy', numeracoes: ['34', '35'], total: 200, valor_par_medio: 1 }),
    ]);
    expect(agg.pares).toBe(0);
    expect(agg.bruto).toBe(0);
  });

  it('rate ausente vira 0 (não quebra)', () => {
    const agg = sumProducaoRows([row({ detalhe: [{ tamanho: 12, medio: 10, dificil: 5 }] })]);
    expect(agg.bruto).toBe(0);
    expect(agg.pares).toBe(15);
  });
});

describe('aggregateProducaoByMontador', () => {
  it('agrega por montador e ignora linhas sem montador_id', () => {
    const map = aggregateProducaoByMontador([
      row({ montador_id: 'm1', detalhe: [{ tamanho: 12, medio: 10, dificil: 0 }], valor_par_medio: 1 }),
      row({ montador_id: 'm1', dia: '2026-07-06', detalhe: [{ tamanho: 12, medio: 5, dificil: 0 }], valor_par_medio: 1 }),
      row({ montador_id: 'm2', detalhe: [{ tamanho: 12, medio: 8, dificil: 2 }], valor_par_medio: 2, valor_par_dificil: 3 }),
      row({ montador_id: null, detalhe: [{ tamanho: 12, medio: 99, dificil: 0 }], valor_par_medio: 1 }),
    ]);
    expect(map.get('m1')!.pares).toBe(15);
    expect(map.get('m1')!.bruto).toBeCloseTo(15, 5);
    expect(map.get('m2')!.bruto).toBeCloseTo(8 * 2 + 2 * 3, 5);
    expect(map.has('__null__')).toBe(false);
  });
});

describe('isChamadaRow', () => {
  it('reconhece chamada e legado sem numerações', () => {
    expect(isChamadaRow(row({ origem: 'chamada' }))).toBe(true);
    expect(isChamadaRow(row({ origem: null, numeracoes: [] }))).toBe(true);
    expect(isChamadaRow(row({ origem: 'legacy', numeracoes: ['34'] }))).toBe(false);
  });
});
