import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const HOOK = read('src/hooks/useSaleOrders.ts');
const LIST = read('src/pages/SaleOrders.tsx');
const FORM = read('src/pages/SaleOrderForm.tsx');
const CMD = read('src/lib/saleOrderCommand.ts');

/**
 * Incidente PV-00198 (25/09/2026): soft-delete em massa de outros PVs estourou
 * lock timeout com toast cru "Erro ao excluir: canceling statement…" na tela de
 * editar, enquanto o Novo Item + Salvar do 00198 commitava. Contrato:
 * soft-delete tem busy-retry + mensagem amigável; bulk lista falhas; save só
 * fala em "remoção" quando há item a remover.
 */
describe('soft-delete de PV com busy-retry e toast sem jargão Postgres', () => {
  it('writer de soft-delete usa o mesmo busy-retry do save', () => {
    expect(HOOK).toContain('export async function softDeleteSaleOrderWithBusyRetry');
    expect(HOOK).toContain('runSaleOrderCommandWithBusyRetry');
    expect(HOOK).toContain("'soft_delete_sale_order_command'");
    expect(HOOK).toContain('saleOrderId, orderNumber');
    expect(HOOK).not.toMatch(/Erro ao excluir: \$\{err\.message\}/);
  });

  it('formatador de soft-delete existe e distingue busy de conflito de versão', () => {
    expect(CMD).toContain('export function formatSaleOrderSoftDeleteError');
    expect(CMD).toContain('export function isSaleOrderSoftDeleteVersionConflict');
    expect(CMD).toContain('SALE_ORDER_BUSY_RETRY_MESSAGE');
  });

  it('exclusão em massa NÃO usa mutateAsync (evita toast por item) e nomeia falhas', () => {
    expect(LIST).toContain('softDeleteSaleOrderWithBusyRetry');
    expect(LIST).toContain('formatSaleOrderSoftDeleteError');
    const bulk = LIST.slice(LIST.indexOf('const doBulkDelete'), LIST.indexOf('const handleBulkStatusChange'));
    expect(bulk).not.toContain('deleteOrder.mutateAsync');
    expect(bulk).toContain('failed.map((f) => f.label)');
  });

  it('falha de save só fala em remoção quando expected_removed_count > 0', () => {
    expect(FORM).toContain('if (expectedRemovedCount > 0)');
    expect(FORM).toContain('Remoção não aplicada — o servidor recusou o salvamento.');
    // O toast de remoção não pode voltar a ser incondicional no onError do update.
    const onError = FORM.slice(
      FORM.indexOf('onError: (error: unknown) => {'),
      FORM.indexOf('if (!isCommittedStrapSourcingError(error)) return;'),
    );
    expect(onError).toContain('expectedRemovedCount > 0');
  });
});
