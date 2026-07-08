import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Handshake, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, cn } from '@/lib/utils';
import { serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';
import { normalizeOsStatus, osStatusLabel, isOsDone, isOsCancelled } from '@/lib/osStatusMachine';

/**
 * Card read-only "Ordens de Serviço deste pedido" no detalhe do PV. Lista as OS
 * geradas a partir deste pedido (fluxo por-OP no hub Terceirizados, além de OS
 * antigas/manuais vinculadas). A geração acontece em /terceirizados?tab=orders
 * ("Gerar OS por Pedido") — aqui é só acompanhamento.
 */
export function PvServiceOrdersCard({ saleOrderId }: { saleOrderId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pv_service_orders', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('service_orders')
        // Desambigua o embed: service_orders tem mais de uma FK pra `orders`
        // (order_id + relação reversa/legado), então PostgREST exige o hint da
        // coluna FK — `orders!order_id(...)` — senão dá "more than one relationship
        // was found for 'service_orders' and 'orders'". A chave do resultado
        // continua `orders`, então r.orders?.order_number segue igual.
        .select('id, order_number, target_sector, quantity, total_value, status, order_id, orders!order_id(order_number), contractors(name, trade_name)')
        .or(`source_sale_order_id.eq.${saleOrderId},sale_order_id.eq.${saleOrderId}`)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  if (isLoading || rows.length === 0) return null;

  const statusCls = (raw: string) => {
    const s = normalizeOsStatus(raw);
    if (isOsCancelled(s)) return 'bg-muted text-muted-foreground border-border';
    if (isOsDone(s)) return 'bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400';
    return 'bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400';
  };

  const totalAtivo = rows
    .filter((r: any) => !isOsCancelled(normalizeOsStatus(r.status)))
    .reduce((s: number, r: any) => s + (Number(r.total_value) || 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          Ordens de Serviço deste pedido
          <Badge variant="outline" className="h-5 text-[10px] font-mono">{rows.length}</Badge>
        </h3>
        <Link to="/terceirizados?tab=orders" className="text-xs text-primary hover:underline flex items-center gap-1">
          Gerar / ver OS <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Gere OS por serviço e OP em <strong>Terceirizados → Gerar OS por Pedido</strong>. Cada OS fica atrelada à OP correta.
      </p>

      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2 font-semibold">Serviço · Contratada</th>
              <th className="px-3 py-2 font-semibold">OP</th>
              <th className="px-3 py-2 font-semibold text-right">Pares</th>
              <th className="px-3 py-2 font-semibold text-right">Total</th>
              <th className="px-3 py-2 font-semibold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r: any) => {
              const contractor = r.contractors?.trade_name || r.contractors?.name || '—';
              const cancelled = isOsCancelled(normalizeOsStatus(r.status));
              return (
                <tr key={r.id} className={cn('align-top', cancelled && 'opacity-60')}>
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{r.target_sector ? serviceOrderSectorLabel(r.target_sector) : (r.order_number || 'OS')}</span>
                      <span className="text-muted-foreground"> · {contractor}</span>
                    </div>
                    {r.order_number && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">OS {r.order_number}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{r.orders?.order_number || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{(Number(r.quantity) || 0).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{formatCurrency(r.total_value)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="outline" className={cn('text-[10px]', statusCls(r.status))}>{osStatusLabel(normalizeOsStatus(r.status))}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span>Total ativo: <strong className="ml-1 text-foreground font-mono tabular-nums">{formatCurrency(totalAtivo)}</strong></span>
      </div>
    </div>
  );
}
