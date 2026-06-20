import { Link } from 'react-router-dom';
import { Handshake, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { osStatusLabel, osStatusBadgeVariant, isOsCancelled } from '@/lib/osStatusMachine';
import { usePvServiceOrders } from '@/hooks/useReferenceTerceirizacoes';

/**
 * Card "Terceirizações geradas" do detalhe do PV. Lista as Ordens de Serviço
 * criadas automaticamente pela terceirização integrada (prestador, descrição,
 * status, valor). Só aparece quando há OS vinculadas.
 */
export function PvGeneratedServiceOrdersCard({ saleOrderId }: { saleOrderId: string }) {
  const { data: orders = [], isLoading } = usePvServiceOrders(saleOrderId);

  if (isLoading || orders.length === 0) return null;

  const activeOrders = orders.filter((o) => !isOsCancelled(o.status));
  const totalActive = activeOrders.reduce((s, o) => s + (Number(o.total_value) || 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          Terceirizações geradas
          <Badge variant="outline" className="h-5 text-[10px] font-mono">{orders.length}</Badge>
        </h3>
        <Link
          to="/terceirizados?tab=orders"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          Ver em Terceirizados <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2 font-semibold">OS</th>
              <th className="px-3 py-2 font-semibold">Prestador / Serviço</th>
              <th className="px-3 py-2 font-semibold text-center">Status</th>
              <th className="px-3 py-2 font-semibold text-right">Pares</th>
              <th className="px-3 py-2 font-semibold text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => {
              const cancelled = isOsCancelled(o.status);
              const contractor = o.contractors?.trade_name || o.contractors?.name || '—';
              return (
                <tr key={o.id} className={cancelled ? 'opacity-50' : 'hover:bg-muted/20'}>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{o.order_number || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{contractor}</span>
                      <span className="text-muted-foreground"> · {o.description}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={osStatusBadgeVariant(o.status)} className="text-[10px]">
                      {osStatusLabel(o.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {(Number(o.quantity) || 0).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {formatCurrency(o.total_value || 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end text-xs text-muted-foreground">
        Total terceirizado (ativo):{' '}
        <strong className="ml-1.5 text-foreground font-mono tabular-nums">{formatCurrency(totalActive)}</strong>
      </div>
    </div>
  );
}
