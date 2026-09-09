import { supabase } from '@/integrations/supabase/client';
import {
  executeSaleOrderCommand,
  preflightSaleOrderCommand,
  SaleOrderReadinessBlockedError,
} from '@/lib/saleOrderCommand';

/**
 * Atualiza planejamento/data de faturamento sem abrir um segundo writer de PV.
 *
 * A tela de lote antes fazia PATCH direto em `sale_orders`, sem
 * expected_version ou receipt. O command `billing` tem allow-list estreita e
 * não rematerializa itens/OPs apenas para alterar datas comerciais.
 */
export async function updateSaleOrderBillingViaCommand(input: {
  saleOrderId: string;
  patch: Record<string, unknown>;
  intent: string;
}) {
  const { data: header, error: headerError } = await supabase
    .from('sale_orders')
    .select('id, order_version')
    .eq('id', input.saleOrderId)
    .single();
  if (headerError || !header) throw headerError || new Error('Pedido de venda não encontrado.');

  const expectedOrderVersion = Number((header as { order_version?: unknown }).order_version) || 0;
  if (!Number.isInteger(expectedOrderVersion) || expectedOrderVersion < 1) {
    throw new Error('A versão atual do pedido não pôde ser determinada. Recarregue e tente novamente.');
  }

  const preflight = await preflightSaleOrderCommand({
    saleOrderId: input.saleOrderId,
    command: 'billing',
    expectedOrderVersion,
    payload: input.patch,
  });
  if (!preflight.ready) throw new SaleOrderReadinessBlockedError(preflight);

  return executeSaleOrderCommand({
    saleOrderId: input.saleOrderId,
    command: 'billing',
    expectedOrderVersion,
    idempotencyKey: `pv:${input.saleOrderId}:${input.intent}:${crypto.randomUUID()}`,
    payload: input.patch,
  });
}
