import { describe, expect, it } from 'vitest';
import {
  BULK_PACKAGING_MODE_OPTIONS,
  BULK_PACKAGING_PROTECTED_STATUSES,
  filterBulkPackagingEligibleIds,
  isBulkPackagingEligibleStatus,
  isCanonicalPackagingMode,
} from '../bulkPackagingMode';

describe('bulkPackagingMode', () => {
  it('oferece só os modos canônicos (sem amarrado legado)', () => {
    expect(BULK_PACKAGING_MODE_OPTIONS).toEqual([
      'individual_master',
      'colmeia',
      'individual_fitilho',
    ]);
    expect(isCanonicalPackagingMode('individual_fitilho')).toBe(true);
    expect(isCanonicalPackagingMode('individual_amarrado')).toBe(false);
  });

  it('bloqueia Faturado, Cancelado e terminais; Em Produção entra', () => {
    expect(isBulkPackagingEligibleStatus('Em Produção')).toBe(true);
    expect(isBulkPackagingEligibleStatus('Aprovado')).toBe(true);
    expect(isBulkPackagingEligibleStatus('Rascunho')).toBe(true);
    for (const status of BULK_PACKAGING_PROTECTED_STATUSES) {
      expect(isBulkPackagingEligibleStatus(status), status).toBe(false);
    }
  });

  it('filtra a seleção e conta os ignorados', () => {
    const orders = [
      { id: 'a', status: 'Em Produção' },
      { id: 'b', status: 'Faturado' },
      { id: 'c', status: 'Cancelado' },
      { id: 'd', status: 'Aprovado' },
    ];
    const { eligibleIds, skipped } = filterBulkPackagingEligibleIds(
      orders,
      ['a', 'b', 'c', 'd'],
    );
    expect(eligibleIds).toEqual(['a', 'd']);
    expect(skipped).toBe(2);
  });
});
