import { supabase } from '@/integrations/supabase/client';

/** Status que NÃO contam como exposição em aberto. */
const SETTLED_STATUSES = '("received","cancelled")';

/**
 * Exposição em aberto (contas a receber) de um cliente, em R$.
 *
 * ⚠ `accounts_receivable.client_id` quase nunca é gravado: em produção
 * (auditoria 04/08/2026) **70 de 72** títulos estão com a coluna NULA, enquanto
 * `sale_order_id` está preenchido em **72/72**. Os dois call-sites filtravam por
 * `client_id`, então a consulta voltava vazia, a exposição dava sempre R$ 0,00 e
 * a trava de limite de crédito do PV nunca travou nada — nem o aviso na tela nem
 * o diálogo de confirmação no submit.
 *
 * O vínculo que existe de fato é `accounts_receivable.sale_order_id →
 * sale_orders.client_id`. O `client_id` direto continua sendo somado para os
 * títulos que o têm e para lançamentos avulsos sem PV; o dedup por `id` evita
 * contar duas vezes quem casa pelos dois caminhos.
 */
export async function fetchClientCreditExposure(clientId: string): Promise<number> {
  const { data: orders, error: ordersErr } = await supabase
    .from('sale_orders')
    .select('id')
    .eq('client_id', clientId);
  if (ordersErr) throw ordersErr;
  const orderIds = (orders || []).map((o: any) => o.id);

  const rows: any[] = [];

  if (orderIds.length > 0) {
    const { data, error } = await (supabase.from('accounts_receivable') as any)
      .select('id, amount, amount_received')
      .in('sale_order_id', orderIds)
      .not('status', 'in', SETTLED_STATUSES);
    if (error) throw error;
    rows.push(...(data || []));
  }

  const { data: direct, error: directErr } = await (supabase.from('accounts_receivable') as any)
    .select('id, amount, amount_received')
    .eq('client_id', clientId)
    .not('status', 'in', SETTLED_STATUSES);
  if (directErr) throw directErr;
  rows.push(...(direct || []));

  const seen = new Set<string>();
  let exposure = 0;
  for (const r of rows) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    exposure += (Number(r.amount) || 0) - (Number(r.amount_received) || 0);
  }
  return exposure;
}
