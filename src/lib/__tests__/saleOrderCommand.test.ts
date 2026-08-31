import { describe, expect, it } from 'vitest';
import {
  isStaleSaleOrderVersionError,
  normalizeCreateSaleOrderCommandReceipt,
  normalizeSaleOrderCommandPreflight,
  normalizeSaleOrderCommandReceipt,
  normalizeSaleOrderReadiness,
  SaleOrderCommandExecutionError,
  SaleOrderReadinessBlockedError,
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
});
