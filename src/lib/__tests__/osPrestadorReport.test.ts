import { describe, expect, it } from 'vitest';
import {
  aggregateOs,
  buildLedger,
  filterLedger,
  osCsv,
  osTotals,
  periodBounds,
  returnPhysicalSign,
  type OsRawMovement,
} from '../osPrestadorReport';

function raw(partial: Partial<OsRawMovement> & Pick<OsRawMovement, 'id' | 'source'>): OsRawMovement {
  return {
    at: '2026-11-10',
    serviceOrderId: 'os-1',
    osNumber: 'OS-1',
    saleOrderNumber: 'PV-1',
    reference: 'INL01',
    color: 'OFF WHITE',
    gradeLabel: '34:2',
    contractorId: 'p1',
    contractorName: 'Ateliê Sul',
    internal: false,
    qtyDispatched: 0,
    qtyGood: 0,
    qtyDefect: 0,
    qtyLoss: 0,
    adjustmentKind: null,
    reversesReturnId: null,
    unitPrice: 2,
    dueDate: '2026-11-20',
    payableAmount: 0,
    payablePaid: 0,
    ...partial,
  };
}

describe('sinal do retorno', () => {
  it('estorno desconta e descarte não entra no saldo', () => {
    expect(returnPhysicalSign('reversal', null)).toBe(-1);
    expect(returnPhysicalSign(null, 'ret-1')).toBe(-1);
    expect(returnPhysicalSign('scrap', null)).toBe(0);
    expect(returnPhysicalSign(null, null)).toBe(1);
    expect(returnPhysicalSign('unproduced_return', null)).toBe(1);
    const back = buildLedger([
      raw({ id: 'd2', source: 'dispatch', qtyDispatched: 40, at: '2026-11-01' }),
      raw({ id: 'u', source: 'return', qtyGood: 40, adjustmentKind: 'unproduced_return', payableAmount: 80, at: '2026-11-04' }),
    ], '2026-11-15');
    const devolucao = back.find((line) => line.id === 'u')!;
    expect(devolucao.kind).toBe('devolucao_sem_producao');
    expect(devolucao.received).toBe(0);
    expect(devolucao.payable).toBe(0);
    expect(devolucao.value).toBe(0);
    expect(devolucao.pending).toBe(0);
    const lines = buildLedger([
      raw({ id: 'd', source: 'dispatch', qtyDispatched: 10, at: '2026-11-01' }),
      raw({ id: 'r', source: 'return', qtyGood: 6, qtyDefect: 1, payableAmount: 12, at: '2026-11-08' }),
      raw({ id: 'e', source: 'return', qtyGood: 6, adjustmentKind: 'reversal', reversesReturnId: 'r', payableAmount: 12, at: '2026-11-09' }),
      raw({ id: 's', source: 'return', qtyDefect: 1, adjustmentKind: 'scrap', at: '2026-11-10' }),
    ], '2026-11-15');
    const estorno = lines.find((line) => line.id === 'e')!;
    expect(estorno.kind).toBe('estorno');
    expect(estorno.received).toBe(-6);
    expect(lines.find((line) => line.id === 's')!.defect).toBe(0);
    expect(lines[0].pending).toBe(10 - 6 - 1 + 6);
  });
});

describe('relatório', () => {
  const today = '2026-11-19';
  const ledger = buildLedger([
    raw({ id: 'd1', source: 'dispatch', qtyDispatched: 8, at: '2026-11-02', dueDate: '2026-11-10' }),
    raw({ id: 'r1', source: 'return', qtyGood: 3, qtyDefect: 1, payableAmount: 6, payablePaid: 6, at: '2026-11-12' }),
    raw({ id: 'd2', source: 'dispatch', serviceOrderId: 'os-2', osNumber: 'OS-2', contractorId: 'p2', contractorName: 'Ateliê Norte', reference: 'BT01', color: 'PRETO', saleOrderNumber: 'PV-2', qtyDispatched: 4, at: '2026-11-05', dueDate: '2026-11-25' }),
  ], today);

  it('filtra novembro da INL01 e agrupa referência × cor × prestador', () => {
    const filtered = filterLedger(ledger, {
      from: '2026-11-01',
      to: '2026-11-30',
      saleOrder: '',
      reference: 'INL01',
      color: '',
      contractorId: '',
      status: '',
    });
    const rows = aggregateOs(filtered, 'referencia_cor_prestador');
    expect(rows).toHaveLength(1);
    expect(rows[0].sent).toBe(8);
    expect(rows[0].received).toBe(3);
    expect(rows[0].defect).toBe(1);
    expect(rows[0].pending).toBe(4);
    expect(rows[0].payable).toBe(6);
    expect(rows[0].paid).toBe(6);
    expect(osTotals(rows).sent).toBe(8);
    expect(osCsv(rows)).toContain('INL01 · OFF WHITE · Ateliê Sul');
    expect(osCsv(rows)).toContain('TOTAL');
  });

  it('status atrasado não mistura com o que ainda está no prazo', () => {
    const late = filterLedger(ledger, {
      from: '2026-11-01', to: '2026-11-30', saleOrder: '', reference: '', color: '', contractorId: '', status: 'atrasado',
    });
    expect(late.every((line) => line.osNumber === 'OS-1')).toBe(true);
    const byContractor = aggregateOs(ledger, 'prestador');
    expect(byContractor.find((row) => row.label === 'Ateliê Sul')!.lateCount).toBe(1);
    expect(byContractor.find((row) => row.label === 'Ateliê Norte')!.avgReturnDays).toBeNull();
  });

  it('presets de período', () => {
    expect(periodBounds('hoje', '2026-11-19')).toEqual({ from: '2026-11-19', to: '2026-11-19' });
    expect(periodBounds('mes', '2026-11-19').from).toBe('2026-11-01');
    expect(periodBounds('mes_anterior', '2026-11-19')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodBounds('semana', '2026-11-19').from).toBe('2026-11-16');
  });
});
