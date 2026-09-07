import { describe, expect, it } from 'vitest';
import {
  allocationKey,
  computeOsAllocationBreakdown,
  groupLedgerByContractor,
  validateOsAllocationDrafts,
} from '@/lib/osAllocationEngine';

describe('osAllocationEngine', () => {
  it('calcula fábrica como sobra após existentes e rascunhos', () => {
    const breakdown = computeOsAllocationBreakdown({
      orderQuantity: 180,
      existing: [{ quantity: 50, unitPrice: 2 }],
      drafts: [
        { quantity: 40, unitPrice: 2.5 },
        { quantity: 30, unitPrice: 3 },
      ],
    });

    expect(breakdown.existingQuantity).toBe(50);
    expect(breakdown.draftQuantity).toBe(70);
    expect(breakdown.factoryQuantity).toBe(60);
    expect(breakdown.remainingForDrafts).toBe(130);
    expect(breakdown.draftTotalValue).toBe(40 * 2.5 + 30 * 3);
    expect(breakdown.existingTotalValue).toBe(100);
    expect(breakdown.overAllocated).toBe(false);
  });

  it('detecta overflow quando o rateio passa da OP', () => {
    const breakdown = computeOsAllocationBreakdown({
      orderQuantity: 100,
      existing: [{ quantity: 60 }],
      drafts: [{ quantity: 50, unitPrice: 1 }],
    });
    expect(breakdown.overAllocated).toBe(true);
    expect(breakdown.overflow).toBe(10);
    expect(breakdown.factoryQuantity).toBe(0);
  });

  it('rejeita prestador duplicado e quantidade inválida', () => {
    const base = {
      orderQuantity: 100,
      existing: [] as Array<{ quantity: number }>,
      drafts: [
        {
          key: allocationKey('op-1', 'costura', 'c1'),
          orderId: 'op-1',
          sector: 'costura',
          contractorId: 'c1',
          quantity: 40,
          unitPrice: 2,
        },
        {
          key: allocationKey('op-1', 'costura', 'c1'),
          orderId: 'op-1',
          sector: 'costura',
          contractorId: 'c1',
          quantity: 20,
          unitPrice: 2,
        },
      ],
    };
    expect(validateOsAllocationDrafts(base).ok).toBe(false);

    base.drafts[1].contractorId = 'c2';
    base.drafts[1].key = allocationKey('op-1', 'costura', 'c2');
    base.drafts[1].quantity = 0;
    expect(validateOsAllocationDrafts(base).ok).toBe(false);

    base.drafts[1].quantity = 20;
    expect(validateOsAllocationDrafts(base)).toEqual({ ok: true });
  });

  it('agrupa ledger por prestador com totais', () => {
    const groups = groupLedgerByContractor([
      { contractorId: 'a', contractorName: 'Facção A', quantity: 10, totalValue: 20 },
      { contractorId: 'b', contractorName: 'Facção B', quantity: 5, totalValue: 15 },
      { contractorId: 'a', contractorName: 'Facção A', quantity: 7, totalValue: 14 },
    ]);
    expect(groups).toHaveLength(2);
    const faccaoA = groups.find((g) => g.contractorId === 'a')!;
    expect(faccaoA.quantity).toBe(17);
    expect(faccaoA.totalValue).toBe(34);
    expect(faccaoA.rows).toHaveLength(2);
  });
});
