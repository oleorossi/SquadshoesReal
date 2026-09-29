import { describe, expect, it } from 'vitest';
import {
  BULK_PACKAGING_MODE_OPTIONS,
  BULK_PACKAGING_PROTECTED_STATUSES,
  UPDATE_HEADER_FORBIDDEN_KEYS,
  buildBulkPackagingUpdatePayload,
  filterBulkPackagingEligibleIds,
  isBulkPackagingEligibleStatus,
  isCanonicalPackagingMode,
  stripForbiddenUpdateHeaderFields,
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

  // Regressão do toast "update não aceita campos de billing/factoring" (29/09/2026).
  it('tira billing/factoring/status do header antes do command update', () => {
    const header = {
      id: 'pv-1',
      client_name: 'ACME',
      packaging_mode: 'colmeia',
      box_grouping: 'grade',
      status: 'Em Produção',
      billing_status: 'open',
      delivery_month: '2026-09',
      delivery_week: 'S1',
      billing_week: '2026-09-S1',
      delivery_deadline: '2026-09-28',
      manual_billing_override: false,
      original_min_billing_date: null,
      manual_override_reason: null,
      is_factoring: true,
      factoring_config_id: 'fac-1',
    };
    const stripped = stripForbiddenUpdateHeaderFields(header);
    for (const key of UPDATE_HEADER_FORBIDDEN_KEYS) {
      expect(stripped, key).not.toHaveProperty(key);
    }
    expect(stripped).toMatchObject({
      id: 'pv-1',
      packaging_mode: 'colmeia',
      box_grouping: 'grade',
    });

    const payload = buildBulkPackagingUpdatePayload({
      header,
      items: [{ id: 'item-1', quantity: 12 }],
      packagingMode: 'individual_fitilho',
      cancelOpIds: ['op-1'],
    });
    expect(payload.header.packaging_mode).toBe('individual_fitilho');
    expect(payload.header).not.toHaveProperty('delivery_month');
    expect(payload.header).not.toHaveProperty('factoring_config_id');
    expect(payload.header).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('billing_patch');
    expect(payload).not.toHaveProperty('factoring_patch');
    expect(payload.cancel_op_ids).toEqual(['op-1']);
  });
});
