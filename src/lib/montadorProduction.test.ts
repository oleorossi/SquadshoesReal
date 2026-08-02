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

// ── Dias produtivos e fichas (base do relatório do RH, 02/08/2026) ───────────
describe('dias produtivos', () => {
  it('conta dias DISTINTOS com pares lançados', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 1 }),
      row({ dia: '2026-07-02', detalhe: [{ tamanho: 12, medio: 24, dificil: 0 }], valor_par_medio: 1 }),
      row({ dia: '2026-07-02', detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 1 }),
    ]);
    // 3 lançamentos, 2 dias: quem lança em dois setores no MESMO dia não pode
    // aparecer com o dobro de dias trabalhados na folha.
    expect(agg.dias).toBe(2);
    expect(agg.pares).toBe(48);
  });

  it('dia sem pares não é dia produtivo', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', detalhe: [{ tamanho: 12, medio: 0, dificil: 0 }], valor_par_medio: 1 }),
      row({ dia: '2026-07-02', detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 1 }),
    ]);
    expect(agg.dias).toBe(1);
  });

  it('linha legado (por-grade) não conta dia — não entra no regime por par', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', origem: 'legacy', numeracoes: ['34'], total: 100, valor_par_medio: 1 }),
    ]);
    expect(agg.dias).toBe(0);
  });
});

describe('fichas', () => {
  it('soma round(pares ÷ tamanho) por tamanho quando há detalhe', () => {
    const agg = sumProducaoRows([
      row({ detalhe: [{ tamanho: 12, medio: 24, dificil: 0 }, { tamanho: 15, medio: 15, dificil: 15 }], valor_par_medio: 1 }),
    ]);
    expect(agg.fichas).toBe(2 + 2); // 24/12 = 2 · (15+15)/15 = 2
    expect(agg.fichasDerivadas).toBe(false);
  });

  it('sem detalhe, INFERE lote de 12 e marca como derivada', () => {
    const agg = sumProducaoRows([row({ detalhe: null, total: 240, valor_par_medio: 1 })]);
    expect(agg.fichas).toBe(20);
    expect(agg.fichasDerivadas).toBe(true);
    // Os PARES, que são a base do pagamento, NÃO dependem da inferência.
    expect(agg.pares).toBe(240);
    expect(agg.bruto).toBeCloseTo(240, 5);
  });

  it('a marca de derivada contamina o agregado inteiro (o relatório precisa avisar)', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 1 }),
      row({ dia: '2026-07-02', detalhe: null, total: 12, valor_par_medio: 1 }),
    ]);
    expect(agg.fichasDerivadas).toBe(true);
  });
});

// ── Bruto separado por dificuldade (02/08/2026) ──────────────────────────────
// Médio e difícil pagam R$/par diferentes. Ratear o bruto total pelo nº de pares
// produz uma taxa que não é a de nenhum dos dois — e faz cada linha do holerite
// sair errada, mesmo com a soma fechando.
describe('bruto e taxa por dificuldade', () => {
  it('separa o bruto e devolve a taxa REAL de cada dificuldade', () => {
    const agg = sumProducaoRows([
      row({ detalhe: [{ tamanho: 12, medio: 100, dificil: 20 }], valor_par_medio: 0.8, valor_par_dificil: 1 }),
    ]);
    expect(agg.brutoMedio).toBeCloseTo(80, 5);
    expect(agg.brutoDificil).toBeCloseTo(20, 5);
    expect(agg.bruto).toBeCloseTo(100, 5);
    expect(agg.taxaMedio).toBeCloseTo(0.8, 5);
    expect(agg.taxaDificil).toBeCloseTo(1, 5);
    // A média ponderada (0,8333) NÃO é a taxa de nenhuma das duas.
    expect(agg.bruto / agg.pares).toBeCloseTo(0.8333, 3);
    expect(agg.taxaMedio).not.toBeCloseTo(agg.bruto / agg.pares, 3);
    expect(agg.taxaVariou).toBe(false);
  });

  it('reajuste no meio do período: taxa vira média e taxaVariou avisa', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }], valor_par_medio: 0.8 }),
      row({ dia: '2026-07-02', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }], valor_par_medio: 1.0 }),
    ]);
    expect(agg.brutoMedio).toBeCloseTo(180, 5);
    expect(agg.taxaMedio).toBeCloseTo(0.9, 5);  // média das duas gravadas
    expect(agg.taxaVariou).toBe(true);
    // O TOTAL continua exato mesmo com a taxa exibida sendo média.
    expect(agg.bruto).toBeCloseTo(180, 5);
  });

  it('taxa igual repetida em vários lançamentos NÃO conta como reajuste', () => {
    const agg = sumProducaoRows([
      row({ dia: '2026-07-01', detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 0.8 }),
      row({ dia: '2026-07-02', detalhe: [{ tamanho: 12, medio: 24, dificil: 0 }], valor_par_medio: 0.8 }),
    ]);
    expect(agg.taxaVariou).toBe(false);
    expect(agg.taxaMedio).toBeCloseTo(0.8, 5);
  });

  it('dificuldade sem par não define taxa nem dispara o aviso', () => {
    const agg = sumProducaoRows([
      row({ detalhe: [{ tamanho: 12, medio: 12, dificil: 0 }], valor_par_medio: 0.8, valor_par_dificil: 1 }),
    ]);
    expect(agg.taxaDificil).toBe(0);
    expect(agg.brutoDificil).toBe(0);
    expect(agg.taxaVariou).toBe(false);
  });
});
