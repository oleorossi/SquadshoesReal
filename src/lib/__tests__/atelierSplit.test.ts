import { describe, expect, it } from 'vitest';
import {
  atelierJobCanSplit,
  atelierSplitConfirmMessage,
  gradeTotal,
  jobGradeFromItem,
  priceWasEdited,
  resolveAtelierPairPrice,
  rollupGradeByFaca,
  splitBalanceError,
  splitGrade,
  subtractGrades,
  suggestPairsByCapacity,
} from '@/lib/atelierSplit';

const lot = {
  status: 'open' as const,
  lot_number: 'LOTE-00004',
  jobs: [
    { id: 'a', pipeline_status: 'awaiting_cut', sale_order_id: 'so-250', order_number: 'PV-00250', sector: 'costura_cabedal' },
    { id: 'b', pipeline_status: 'awaiting_cut', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'costura_cabedal' },
    { id: 'c', pipeline_status: 'cancelled', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'aviamento' },
  ],
};

describe('separar job em lote próprio', () => {
  it('permite o job de 12 pares enquanto o lote aberto tem outro pedido', () => {
    expect(atelierJobCanSplit({ pipeline_status: 'awaiting_cut' }, lot)).toBe(true);
  });

  it('recusa lote já cortado, job que saiu do corte e pedido sozinho', () => {
    expect(atelierJobCanSplit({ pipeline_status: 'awaiting_cut' }, { ...lot, status: 'cut' })).toBe(false);
    expect(atelierJobCanSplit({ pipeline_status: 'cut' }, lot)).toBe(false);
    expect(atelierJobCanSplit(
      { pipeline_status: 'awaiting_cut' },
      { status: 'open', jobs: [lot.jobs[1]] },
    )).toBe(false);
  });

  it('a confirmação avisa que o corte antigo deixa estes pares', () => {
    const msg = atelierSplitConfirmMessage(
      { order_number: 'PV-00251', sale_order_id: 'so-251' },
      lot,
    );
    expect(msg).toContain('PV-00251');
    expect(msg).toContain('LOTE-00004');
    expect(msg).toContain('não debita a napa');
    expect(msg).not.toContain('Saem juntos');
  });

  it('nomeia os setores irmãos do mesmo pedido', () => {
    const msg = atelierSplitConfirmMessage(
      { order_number: 'PV-00251', sale_order_id: 'so-251' },
      {
        lot_number: 'LOTE-00004',
        jobs: [
          lot.jobs[0],
          { ...lot.jobs[1], sector: 'costura_cabedal' },
          { id: 'd', pipeline_status: 'awaiting_cut', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'aviamento' },
        ],
      },
    );
    expect(msg).toContain('Saem juntos os 2 jobs');
  });
});

const grade960 = { '34': 160, '35': 160, '36': 160, '37': 160, '38': 160, '39': 160 };

describe('envio dividido do Ateliê', () => {
  it('960 pares fecham em 300, 300 e 360 e a grade soma por tamanho', () => {
    const parts = splitGrade(grade960, [300, 300, 360]);
    expect(parts.map(gradeTotal)).toEqual([300, 300, 360]);
    for (const size of Object.keys(grade960)) {
      const sent = parts.reduce((sum, part) => sum + (part[size] || 0), 0);
      expect(sent).toBe(grade960[size as keyof typeof grade960]);
    }
  });

  it('a grade da ficha vezes as fichas fecha o total do job', () => {
    const grade = jobGradeFromItem({ '28': 2, '29': 2, '30': 2 }, 4, 24);
    expect(grade).toEqual({ '28': 8, '29': 8, '30': 8 });
    expect(gradeTotal(grade)).toBe(24);
  });

  it('envio parcial deixa o saldo por tamanho', () => {
    const remaining = subtractGrades(grade960, [splitGrade(grade960, [300, 660])[0]]);
    expect(gradeTotal(remaining)).toBe(660);
    expect(splitBalanceError(remaining, [{ mode: 'contractor', grade: { '34': 200 } }])).toMatch(/passa do saldo/);
  });

  it('interno e prestador cabem juntos e o excesso é recusado', () => {
    const full = { '28': 10, '29': 10 };
    expect(splitBalanceError(full, [
      { mode: 'internal', grade: { '28': 4, '29': 4 } },
      { mode: 'contractor', grade: { '28': 6, '29': 6 } },
    ])).toBeNull();
    expect(splitBalanceError(full, [
      { mode: 'contractor', grade: { '28': 11 } },
    ])).toMatch(/28/);
    expect(splitBalanceError(full, [
      { mode: 'contractor', grade: { '28': 2.5 } },
    ])).toMatch(/inteiros/);
  });

  it('sem capacidade divide igual; com capacidade, pelo ritmo', () => {
    expect(suggestPairsByCapacity(960, [null, null, null])).toEqual([320, 320, 320]);
    const paced = suggestPairsByCapacity(960, [100, 100, 120]);
    expect(paced.reduce((sum, qty) => sum + qty, 0)).toBe(960);
    expect(paced[2]).toBeGreaterThan(paced[0]);
  });

  it('a tarifa da referência vence a do setor, e o preço digitado fica marcado', () => {
    expect(resolveAtelierPairPrice({ referencePrice: 7, sectorPrice: 5 })).toEqual({
      price: 7,
      source: 'referencia',
    });
    expect(resolveAtelierPairPrice({ referencePrice: null, sectorPrice: 5 })).toEqual({
      price: 5,
      source: 'setor',
    });
    expect(resolveAtelierPairPrice({ referencePrice: null, sectorPrice: null })).toEqual({
      price: null,
      source: null,
    });
    expect(priceWasEdited(8, 5)).toBe(true);
    expect(priceWasEdited(5, 5)).toBe(false);
    expect(priceWasEdited(6, null)).toBe(true);
  });

  it('P, M e G somam as numerações da faca', () => {
    expect(rollupGradeByFaca(
      { '34': 12, '35': 12, '36': 12, '40': 6 },
      [{ label: 'P', sizes: ['34', '35', '36'] }, { label: 'G', sizes: ['40'] }],
    )).toEqual([
      { label: 'P', pairs: 36 },
      { label: 'G', pairs: 6 },
    ]);
  });
});
