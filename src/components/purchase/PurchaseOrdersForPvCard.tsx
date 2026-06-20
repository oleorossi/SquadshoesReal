import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, ShoppingCart, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import { usePurchaseOrdersForPv } from '@/hooks/usePerPvPurchasing';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  sent: 'Enviada',
  parcial: 'Parcial',
  received: 'Recebida',
  cancelled: 'Cancelada',
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
};

/**
 * Card "Compras deste PV" no detalhe do pedido — lista as OCs do canal per_pv
 * que contêm este PV. Não mostra as OCs agregadas do MRP (essas usam
 * linked_sale_order_ids, não source_pv_ids).
 */
export default function PurchaseOrdersForPvCard({ pvId }: { pvId: string }) {
  const { data: orders = [], isLoading } = usePurchaseOrdersForPv(pvId);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-muted/40 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Compras deste PV</span>
          {orders.length > 0 && <Badge variant="outline">{orders.length}</Badge>}
        </div>
        <Link to="/purchase-orders/per-pv" className="text-xs text-primary hover:underline flex items-center gap-1">
          Ver todas <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : orders.length === 0 ? (
        <p className="px-3 py-6 text-sm text-muted-foreground text-center">
          Nenhuma OC gerada por este pedido ainda. Use <strong>Gerar OCs</strong> no topo.
        </p>
      ) : (
        <Table className="[&_td]:py-2 [&_th]:py-2">
          <TableHeader>
            <TableRow className="[&_th]:text-xs [&_th]:text-muted-foreground">
              <TableHead>Nº OC</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Criada em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                <TableCell className={o.supplier_id ? '' : 'text-amber-700'}>{o.supplier_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{STATUS_LABEL[o.status] || o.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(o.total_value)}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{fmtDate(o.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
