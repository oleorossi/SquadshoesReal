/**
 * Quem entra na Central de Etiquetagem.
 *
 * A fila (`production_queue`) e as ondas legadas são a porta histórica. Um PV
 * já em `Em Produção` também entra, mesmo com zero linhas na fila — o PV-00255
 * entrou em produção sem registro em `production_queue` (a tabela inteira
 * tinha 10 linhas). A fila é recolocada no banco; esta tela não depende dela.
 */
export function saleOrderEligibleForLabels(input: {
  saleOrderId: string | null | undefined;
  scheduled: boolean;
  saleOrderStatus: unknown;
}): boolean {
  if (!input.saleOrderId) return false;
  if (input.scheduled) return true;
  return String(input.saleOrderStatus ?? '').trim() === 'Em Produção';
}

/** PV em produção cuja nenhuma OP chegou na lista visível da etiquetagem. */
export function productionOrdersMissingFromLabels(
  saleOrders: Array<{ id: string; order_number?: string | null; status?: string | null }>,
  visibleSaleOrderIds: ReadonlySet<string>,
): string[] {
  return saleOrders
    .filter((order) => String(order.status ?? '').trim() === 'Em Produção'
      && !visibleSaleOrderIds.has(order.id))
    .map((order) => order.order_number || order.id);
}
