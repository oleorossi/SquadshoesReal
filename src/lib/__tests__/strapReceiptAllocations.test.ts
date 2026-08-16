import { describe, expect, it } from 'vitest';
import {
  expectedStrapReceiptAllocationM,
  suggestStrapReceiptAllocations,
  validateStrapReceiptAllocations,
} from '@/lib/strapReceiptAllocations';

const contributions = [
  { contributionId: 'pv-2', originType: 'sale_order' as const, remainingM: 4, priority: 2 },
  { contributionId: 'floor', originType: 'stock_floor' as const, remainingM: 5, priority: 99 },
  { contributionId: 'pv-1', originType: 'sale_order' as const, remainingM: 6, priority: 1 },
];

describe('alocação revisável do recebimento de tiras', () => {
  it('sugere PVs na prioridade e deixa piso por último', () => {
    expect(suggestStrapReceiptAllocations(12, contributions)).toEqual([
      { contribution_id: 'pv-1', approved_m: 6 },
      { contribution_id: 'pv-2', approved_m: 4 },
      { contribution_id: 'floor', approved_m: 2 },
    ]);
    expect(suggestStrapReceiptAllocations(11, [
      { ...contributions[1], priority: 0 },
      contributions[0],
      contributions[2],
    ]).map((allocation) => allocation.contribution_id)).toEqual(['pv-1', 'pv-2', 'floor']);
  });

  it('aloca apenas o saldo elegível e deixa excedente como estoque livre', () => {
    expect(expectedStrapReceiptAllocationM(20, contributions)).toBe(15);
    expect(validateStrapReceiptAllocations(20, contributions, [
      { contribution_id: 'pv-1', approved_m: 6 },
      { contribution_id: 'pv-2', approved_m: 4 },
      { contribution_id: 'floor', approved_m: 5 },
    ])).toBeNull();
  });

  it('bloqueia soma incompleta e excesso por contribuição', () => {
    expect(validateStrapReceiptAllocations(8, contributions, [
      { contribution_id: 'pv-1', approved_m: 6 },
    ])).toContain('fechar 8');
    expect(validateStrapReceiptAllocations(8, contributions, [
      { contribution_id: 'pv-1', approved_m: 7 },
      { contribution_id: 'pv-2', approved_m: 1 },
    ])).toContain('excede');
  });
});
