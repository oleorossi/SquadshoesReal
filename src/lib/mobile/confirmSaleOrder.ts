import {
  executeSaleOrderCommand,
  preflightSaleOrderCommand,
  SaleOrderReadinessBlockedError,
  type SaleOrderCommandReceipt,
} from '@/lib/saleOrderCommand';

export function mobileSaleOrderConfirmationKey(
  saleOrderId: string,
  orderVersion: number,
): string {
  return `pv:${saleOrderId}:confirm:v${orderVersion}`;
}

/**
 * Confirma somente um PV já persistido como Rascunho. Criar o cabeçalho e
 * confirmar são comandos distintos para que o writer atômico mantenha o mesmo
 * hash online e offline.
 */
export async function confirmMobileSaleOrder(
  saleOrderId: string,
): Promise<SaleOrderCommandReceipt> {
  const preflight = await preflightSaleOrderCommand({
    saleOrderId,
    command: 'confirm',
  });
  if (!preflight.ready) {
    throw new SaleOrderReadinessBlockedError(preflight);
  }

  const expectedOrderVersion = preflight.order_version;
  return executeSaleOrderCommand({
    saleOrderId,
    command: 'confirm',
    expectedOrderVersion,
    idempotencyKey: mobileSaleOrderConfirmationKey(saleOrderId, expectedOrderVersion),
    // Shape idêntico ao desktop: o mesmo intent nunca diverge por origem do
    // cliente; target/status são derivados pelo comando no servidor.
    payload: {},
  });
}
