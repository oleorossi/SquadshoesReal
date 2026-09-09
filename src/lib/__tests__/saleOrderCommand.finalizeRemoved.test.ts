import { describe, expect, it } from 'vitest';
import {
  assertFinalizeAppliedExpectedRemovals,
  countExpectedRemovedSaleOrderItems,
  formatSaleOrderCommandFailureMessage,
  formatSaleOrderUpdateSuccessMessage,
  readFinalizeRemovedSummary,
  SaleOrderCommandExecutionError,
  type SaleOrderCommandReceipt,
} from '@/lib/saleOrderCommand';

function receipt(
  partial: Partial<SaleOrderCommandReceipt> & { error?: SaleOrderCommandReceipt['error'] },
): SaleOrderCommandReceipt {
  return {
    ok: false,
    replayed: false,
    receipt_id: 'r1',
    sale_order_id: 'o1',
    command: 'update',
    previous_order_version: 1,
    order_version: 1,
    material_plan_revision_id: null,
    result: {},
    readiness: {
      ready: false,
      blockers: [],
      warnings: [],
      order_version: 1,
      material_plan_revision_id: null,
    },
    error: null,
    ...partial,
  };
}

describe('saleOrderCommand — finalize_removed UX', () => {
  it('lê o resumo do writer no result do receipt', () => {
    expect(readFinalizeRemovedSummary({
      finalize_removed: {
        removed_items: 2,
        preserved_items: 3,
        cancelled_strap_demands: 4,
        cancelled_purchase_contributions: 1,
      },
    })).toEqual({
      removed_items: 2,
      preserved_items: 3,
      cancelled_strap_demands: 4,
      cancelled_purchase_contributions: 1,
    });
  });

  it('toast de sucesso distingue remoção e retirada produtiva', () => {
    expect(formatSaleOrderUpdateSuccessMessage(null).title).toContain('Pedido atualizado');
    const mixed = formatSaleOrderUpdateSuccessMessage({
      removed_items: 1,
      preserved_items: 2,
      cancelled_strap_demands: 3,
      cancelled_purchase_contributions: 1,
    });
    expect(mixed.title).toContain('1 item removido');
    expect(mixed.title).toContain('2 retirados da produção');
    expect(mixed.description).toContain('demanda');
    expect(mixed.description).toContain('compra');
  });

  it('mapeia FK de strap_demands para recusa explícita', () => {
    const msg = formatSaleOrderCommandFailureMessage(receipt({
      error: {
        code: '23503',
        message: 'update or delete on table "sale_order_items" violates foreign key constraint "sale_order_strap_demands_sale_order_item_id_fkey"',
        detail: 'Key (id)=(317a3ac5-1386-40e5-a704-015c1e91450e) is still referenced from table "sale_order_strap_demands".',
      },
    }));
    expect(msg).toContain('NÃO foi salvo');
    expect(msg.toLowerCase()).toContain('demanda de tira');
  });

  it('SaleOrderCommandExecutionError usa a mensagem mapeada', () => {
    const err = new SaleOrderCommandExecutionError(receipt({
      error: {
        code: 'P0001',
        message: 'Nao e possivel remover o item do PV: ha contribuicao de compra de tira ativa',
        detail: null,
      },
    }));
    expect(err.message).toContain('NÃO foi salvo');
    expect(err.message.toLowerCase()).toContain('compra');
  });

  it('conta itens carregados ausentes do payload (regressão retain)', () => {
    expect(countExpectedRemovedSaleOrderItems(
      ['a', 'b', 'c'],
      ['a', 'c'],
    )).toBe(1);
    expect(countExpectedRemovedSaleOrderItems(['a'], ['a', 'b'])).toBe(0);
  });

  it('falha se o editor removeu itens e finalize_removed ficou 0/0', () => {
    expect(() => assertFinalizeAppliedExpectedRemovals(2, {
      removed_items: 0,
      preserved_items: 0,
      cancelled_strap_demands: 0,
      cancelled_purchase_contributions: 0,
    })).toThrow(/não persistiu/);
    expect(() => assertFinalizeAppliedExpectedRemovals(2, {
      removed_items: 0,
      preserved_items: 2,
      cancelled_strap_demands: 1,
      cancelled_purchase_contributions: 0,
    })).not.toThrow();
    expect(() => assertFinalizeAppliedExpectedRemovals(0, null)).not.toThrow();
  });
});
