import { describe, it, expect } from 'vitest';
import {
  compareMontagemSolagem,
  paresTotaisOfRow,
  eachIsoDay,
  type FichaMontadorRowComSetor,
} from './fichaMontadoresMxS';

const row = (o: Partial<FichaMontadorRowComSetor>): FichaMontadorRowComSetor => ({
  montador_id: 'm1',
  dia: '2026-09-22',
  origem: 'chamada',
  detalhe: null,
  total: null,
  numeracoes: [],
  valor_par: null,
  valor_par_medio: 0.8,
  valor_par_dificil: 1,
  setor: 'montagem',
  ...o,
});

describe('paresTotaisOfRow', () => {
  it('soma médio + difícil', () => {
    expect(paresTotaisOfRow(row({
      detalhe: [{ tamanho: 12, medio: 80, dificil: 20 }],
    }))).toBe(100);
  });

  it('ignora legado', () => {
    expect(paresTotaisOfRow(row({ origem: 'legacy', total: 200 }))).toBe(0);
  });
});

describe('eachIsoDay', () => {
  it('lista dias inclusive', () => {
    expect(eachIsoDay('2026-09-21', '2026-09-23')).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23',
    ]);
  });
});

describe('compareMontagemSolagem', () => {
  it('3 montadores × 100 = 300 bate com solagem 300 no dia', () => {
    const rows = [
      row({ montador_id: 'm1', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }], setor: 'montagem' }),
      row({ montador_id: 'm2', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }], setor: 'montagem' }),
      row({ montador_id: 'm3', detalhe: [{ tamanho: 12, medio: 70, dificil: 30 }], setor: 'montagem' }),
      row({
        montador_id: 's1', setor: 'solagem',
        detalhe: [{ tamanho: 12, medio: 300, dificil: 0 }],
      }),
    ];
    const cmp = compareMontagemSolagem(rows, '2026-09-22', '2026-09-22');
    expect(cmp.period.montagem).toBe(300);
    expect(cmp.period.solagem).toBe(300);
    expect(cmp.period.delta).toBe(0);
    expect(cmp.byDay).toHaveLength(1);
    expect(cmp.byDay[0].delta).toBe(0);
  });

  it('marca Δ quando solagem fica abaixo num dia', () => {
    const rows = [
      row({ montador_id: 'm1', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }] }),
      row({ montador_id: 'm2', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }] }),
      row({ montador_id: 'm3', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }] }),
      row({
        montador_id: 's1', setor: 'solagem',
        detalhe: [{ tamanho: 12, medio: 250, dificil: 0 }],
      }),
    ];
    const cmp = compareMontagemSolagem(rows, '2026-09-22', '2026-09-22');
    expect(cmp.period.montagem).toBe(300);
    expect(cmp.period.solagem).toBe(250);
    expect(cmp.period.delta).toBe(-50);
  });

  it('agrega período e breakdown diário (C)', () => {
    const rows = [
      row({ dia: '2026-09-21', montador_id: 'm1', detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }] }),
      row({
        dia: '2026-09-21', montador_id: 's1', setor: 'solagem',
        detalhe: [{ tamanho: 12, medio: 100, dificil: 0 }],
      }),
      row({ dia: '2026-09-22', montador_id: 'm1', detalhe: [{ tamanho: 12, medio: 200, dificil: 0 }] }),
      row({
        dia: '2026-09-22', montador_id: 's1', setor: 'solagem',
        detalhe: [{ tamanho: 12, medio: 150, dificil: 0 }],
      }),
    ];
    const cmp = compareMontagemSolagem(rows, '2026-09-21', '2026-09-22');
    expect(cmp.period.montagem).toBe(300);
    expect(cmp.period.solagem).toBe(250);
    expect(cmp.period.delta).toBe(-50);
    expect(cmp.byDay).toHaveLength(2);
    expect(cmp.byDay[0]).toMatchObject({ dia: '2026-09-21', montagem: 100, solagem: 100, delta: 0 });
    expect(cmp.byDay[1]).toMatchObject({ dia: '2026-09-22', montagem: 200, solagem: 150, delta: -50 });
  });

  it('ignora setor fora de M/S e origem legacy', () => {
    const rows = [
      row({ setor: 'acabamento', detalhe: [{ tamanho: 12, medio: 999, dificil: 0 }] }),
      row({ origem: 'legacy', setor: 'montagem', total: 500 }),
    ];
    const cmp = compareMontagemSolagem(rows, '2026-09-22', '2026-09-22');
    expect(cmp.period.montagem).toBe(0);
    expect(cmp.period.solagem).toBe(0);
  });
});
