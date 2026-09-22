import { describe, expect, it } from 'vitest';
import {
  formatSaleOrderCancelError,
  formatSaleOrderStatusError,
  formatUnknownSaleOrderUpdateError,
  hasPhysicalFactBlockers,
  isPostgresBusyError,
  isPostgresDeadlockError,
  isPostgresTimeoutError,
  isStaleSaleOrderVersionError,
  normalizeCreateSaleOrderCommandReceipt,
  normalizeSaleOrderCommandPreflight,
  normalizeSaleOrderCommandReceipt,
  normalizeSaleOrderReadiness,
  SaleOrderCommandExecutionError,
  SaleOrderReadinessBlockedError,
  shouldOfferAdminCompensatoryCancel,
} from '@/lib/saleOrderCommand';

describe('saleOrderCommand', () => {
  it('normaliza blockers e deriva ready de forma fail-closed', () => {
    const readiness = normalizeSaleOrderReadiness({
      order_version: 7,
      blockers: [{ code: 'sheet_unpublished', detail: 'Ficha não publicada' }],
      warnings: null,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.order_version).toBe(7);
    expect(readiness.blockers).toEqual([
      expect.objectContaining({ code: 'sheet_unpublished', message: 'Ficha não publicada' }),
    ]);
    expect(readiness.warnings).toEqual([]);
  });

  it('preserva a identidade e os detalhes usados pela janela de correção', () => {
    const readiness = normalizeSaleOrderReadiness({
      ready: false,
      blockers: [{
        code: 'material_color_not_registered',
        message: 'Cor ausente',
        item_id: 'item-1',
        reference_id: 'ref-1',
        overridable: true,
        details: { component: 'Palmilha', color: 'ROSADO', product_id: 'product-1' },
      }],
    });

    expect(readiness.blockers[0]).toEqual(expect.objectContaining({
      item_id: 'item-1',
      reference_id: 'ref-1',
      overrideable: true,
      details: {
        component: 'Palmilha',
        color: 'ROSADO',
        product_id: 'product-1',
      },
    }));
  });

  it('mantém ready explícito do servidor e completa identidade do preflight', () => {
    const preflight = normalizeSaleOrderCommandPreflight(
      { ready: true, blockers: [], order_version: 3 },
      { saleOrderId: 'pv-1', command: 'confirm' },
    );

    expect(preflight.ready).toBe(true);
    expect(preflight.sale_order_id).toBe('pv-1');
    expect(preflight.command).toBe('confirm');
  });

  it('não transforma envelope truncado sem ready explícito em autorização', () => {
    expect(normalizeSaleOrderReadiness({ blockers: [], order_version: 3 }).ready).toBe(false);
  });

  it('normaliza recibo idempotente e o resultado do domínio', () => {
    const receipt = normalizeSaleOrderCommandReceipt<{ ops_criadas: number }>({
      ok: true,
      replayed: true,
      receipt_id: 'receipt-1',
      sale_order_id: 'pv-1',
      command: 'promote',
      previous_order_version: 4,
      order_version: 5,
      material_plan_revision_id: 'plan-1',
      result: { ops_criadas: 2 },
      readiness: { ready: true, blockers: [], warnings: [], order_version: 5 },
    });

    expect(receipt.replayed).toBe(true);
    expect(receipt.result.ops_criadas).toBe(2);
    expect(receipt.readiness.ready).toBe(true);
  });

  it('aceita o envelope SQL canônico sem perder versão, replay ou preflight', () => {
    const receipt = normalizeSaleOrderCommandReceipt({
      ok: true,
      idempotent_replay: true,
      receipt_id: 'receipt-sql',
      sale_order_id: 'pv-sql',
      command: 'update',
      order_version_before: 8,
      order_version_after: 12,
      result: { order_id: 'pv-sql' },
      preflight: { ready: true, blockers: [], warnings: [], order_version: 8 },
    });

    expect(receipt.replayed).toBe(true);
    expect(receipt.previous_order_version).toBe(8);
    expect(receipt.order_version).toBe(12);
    expect(receipt.readiness.order_version).toBe(8);
  });

  it('normaliza create e exige sale_order_id somente quando houve sucesso', () => {
    const receipt = normalizeCreateSaleOrderCommandReceipt({
      ok: true,
      command: 'create',
      receipt_id: 'receipt-create',
      sale_order_id: 'pv-create',
      order_version_after: 4,
      result: { order_id: 'pv-create' },
      idempotent_replay: false,
    });
    expect(receipt.sale_order_id).toBe('pv-create');
    expect(receipt.order_version).toBe(4);

    expect(() => normalizeCreateSaleOrderCommandReceipt({
      ok: true,
      command: 'create',
      receipt_id: 'receipt-create',
    })).toThrow(/sale_order_id/);
  });

  it('rejeita resposta sem identidade auditável', () => {
    expect(() => normalizeSaleOrderCommandReceipt({ ok: true }))
      .toThrow(/receipt_id, sale_order_id, command/);
  });

  it('normaliza recibo sem ok explícito como falha fechada', () => {
    const command = normalizeSaleOrderCommandReceipt({
      receipt_id: 'receipt-truncated',
      sale_order_id: 'pv-1',
      command: 'confirm',
      result: {},
    });
    const create = normalizeCreateSaleOrderCommandReceipt({
      receipt_id: 'receipt-create-truncated',
      sale_order_id: 'pv-2',
      command: 'create',
      result: {},
    });

    expect(command.ok).toBe(false);
    expect(create.ok).toBe(false);
  });

  it('reconhece stale tanto no preflight quanto no receipt do writer', () => {
    const blocker = {
      code: 'stale_order_version',
      message: 'Versão esperada 46 difere da versão atual 50',
    };
    const preflight = normalizeSaleOrderCommandPreflight(
      { ready: false, blockers: [blocker], order_version: 50 },
      { saleOrderId: 'pv-1', command: 'update' },
    );
    const receipt = normalizeSaleOrderCommandReceipt({
      ok: false,
      receipt_id: 'receipt-stale',
      sale_order_id: 'pv-1',
      command: 'update',
      order_version_before: 50,
      order_version_after: 50,
      result: {},
      readiness: { ready: false, blockers: [blocker], order_version: 50 },
      error: { code: 'readiness_blocked', message: blocker.message },
    });

    expect(isStaleSaleOrderVersionError(new SaleOrderReadinessBlockedError(preflight)))
      .toBe(true);
    expect(isStaleSaleOrderVersionError(new SaleOrderCommandExecutionError(receipt)))
      .toBe(true);
    expect(isStaleSaleOrderVersionError(new Error('falha de rede'))).toBe(false);
  });

  it('formatSaleOrderCancelError usa order_number, não UUID cru', () => {
    const preflight = normalizeSaleOrderCommandPreflight(
      {
        ready: false,
        blockers: [{
          code: 'physical_fact',
          message: 'OP OP-2026-01146 possui fato físico (stage); cancelamento automático recusado',
          details: {
            op_number: 'OP-2026-01146',
            op_id: 'ab7e391d-d325-467e-a383-576e79311e6c',
            fact_kinds: ['stage'],
          },
        }],
        order_version: 3,
      },
      { saleOrderId: 'pv-139', command: 'cancel' },
    );

    expect(hasPhysicalFactBlockers(preflight)).toBe(true);
    const message = formatSaleOrderCancelError(new SaleOrderReadinessBlockedError(preflight));
    expect(message).toContain('OP-2026-01146');
    expect(message).toContain('stage');
    expect(message).not.toContain('ab7e391d');
  });

  it('shouldOfferAdminCompensatoryCancel só com fato físico puro + admin', () => {
    const physicalOnly = normalizeSaleOrderCommandPreflight(
      {
        ready: false,
        blockers: [{
          code: 'physical_fact',
          message: 'fato físico',
          details: { fact_kinds: ['stage'], op_number: 'OP-1' },
        }],
        order_version: 1,
      },
      { saleOrderId: 'pv-1', command: 'cancel' },
    );
    const withNfe = normalizeSaleOrderCommandPreflight(
      {
        ready: false,
        blockers: [
          {
            code: 'physical_fact',
            message: 'fato físico',
            details: { fact_kinds: ['stage'] },
          },
          {
            code: 'active_nfe_blocks_cancel',
            scope: 'fiscal',
            message: 'NF-e ativa',
          },
        ],
        order_version: 1,
      },
      { saleOrderId: 'pv-2', command: 'cancel' },
    );
    const nfeOnly = normalizeSaleOrderCommandPreflight(
      {
        ready: false,
        blockers: [{
          code: 'active_nfe_blocks_cancel',
          scope: 'fiscal',
          message: 'NF-e ativa',
        }],
        order_version: 1,
      },
      { saleOrderId: 'pv-3', command: 'cancel' },
    );

    expect(shouldOfferAdminCompensatoryCancel(physicalOnly, true)).toBe(true);
    expect(shouldOfferAdminCompensatoryCancel(physicalOnly, false)).toBe(false);
    expect(shouldOfferAdminCompensatoryCancel(withNfe, true)).toBe(false);
    expect(shouldOfferAdminCompensatoryCancel(nfeOnly, true)).toBe(false);
  });

  it('timeout de statement/lock vira pedido de retry, não a string crua do Postgres', () => {
    expect(isPostgresTimeoutError(new Error('canceling statement due to statement timeout'))).toBe(true);
    expect(isPostgresTimeoutError(new Error('canceling statement due to lock timeout'))).toBe(true);
    expect(isPostgresTimeoutError(new Error('Transição de status inválida'))).toBe(false);
    expect(formatSaleOrderStatusError(new Error('canceling statement due to statement timeout')))
      .toMatch(/Tente de novo/);
    expect(formatSaleOrderStatusError(new Error('canceling statement due to statement timeout')))
      .not.toMatch(/canceling statement/);
  });

  it('PostgREST plain object com statement timeout também vira retry (não [object Object])', () => {
    const postgrest = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
      details: null,
      hint: null,
    };
    expect(isPostgresTimeoutError(postgrest)).toBe(true);
    expect(isPostgresBusyError(postgrest)).toBe(true);
    expect(formatUnknownSaleOrderUpdateError(postgrest))
      .toMatch(/banco estava ocupado|Tente de novo/);
    expect(formatUnknownSaleOrderUpdateError(postgrest))
      .not.toMatch(/canceling statement/);
  });

  it('deadlock 40P01 também vira pedido de retry (não o texto cru do Postgres)', () => {
    const deadlock = new Error(
      'O pedido NÃO foi salvo. deadlock detected (Process 1099827 waits for ShareLock on transaction 69449655)',
    );
    expect(isPostgresDeadlockError(deadlock)).toBe(true);
    expect(isPostgresBusyError(deadlock)).toBe(true);
    expect(isPostgresDeadlockError({ code: '40P01', message: 'x' })).toBe(true);
    expect(formatSaleOrderStatusError(deadlock)).toMatch(/Tente de novo/);
    expect(formatSaleOrderStatusError(deadlock)).not.toMatch(/deadlock detected/);
    expect(formatUnknownSaleOrderUpdateError(deadlock)).toMatch(/O pedido NÃO foi salvo/);
    expect(formatUnknownSaleOrderUpdateError(deadlock)).not.toMatch(/ShareLock/);
  });
});
