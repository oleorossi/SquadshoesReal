import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePurchaseOrders, useSaleOrderNumbersByIds, type PurchaseOrder } from '@/hooks/usePurchaseOrders';
import { isPerPvPurchaseOrder } from '@/lib/perPvPurchasing';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CircleNotch as Loader2, ShoppingCart, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovada', sent: 'Enviada',
  parcial: 'Parcial', received: 'Recebida', cancelled: 'Cancelada',
};
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; } };

/**
 * Canal dedicado "Compras por Pedido" — lista todas as OCs source_type='per_pv'
 * agrupadas por PV. Separado do menu tradicional /purchase-orders (que esconde
 * essas OCs por padrão) e do MRP/ondas.
 */
export default function PurchaseOrdersPerPv() {
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const perPv = useMemo(() => orders.filter(isPerPvPurchaseOrder), [orders]);

  const allPvIds = useMemo(
    () => Array.from(new Set(perPv.flatMap((o) => o.source_pv_ids || []))),
    [perPv],
  );
  const { data: pvNums = [] } = useSaleOrderNumbersByIds(allPvIds);
  const pvNumById = useMemo(
    () => Object.fromEntries(pvNums.map((p) => [p.id, p.order_number])),
    [pvNums],
  );

  // Agrupa por PV (uma OC com N source_pv_ids aparece sob cada PV).
  const groups = useMemo(() => {
    const m = new Map<string, PurchaseOrder[]>();
    for (const o of perPv) {
      const pvs = (o.source_pv_ids && o.source_pv_ids.length) ? o.source_pv_ids : ['—'];
      for (const pv of pvs) {
        if (!m.has(pv)) m.set(pv, []);
        m.get(pv)!.push(o);
      }
    }
    return Array.from(m.entries()).sort((a, b) =>
      (pvNumById[b[0]] || b[0]).localeCompare(pvNumById[a[0]] || a[0], 'pt-BR'),
    );
  }, [perPv, pvNumById]);

  const totalAll = perPv.reduce((s, o) => s + Number(o.total_value || 0), 0);

  return (
    <div className="w-full space-y-4 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="COMPRAS · POR PEDIDO"
        title="Compras por Pedido"
        description="Ordens de Compra geradas a partir de pedidos (PV), separadas do MRP/ondas"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 px-3 py-1">
              {perPv.length} OC(s) · {formatCurrency(totalAll)}
            </Badge>
            <Link to="/purchase-orders" className="text-sm text-primary hover:underline flex items-center gap-1">
              Menu tradicional <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando...
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nenhuma OC por pedido"
          description='Abra um PV e use "Gerar OCs", ou selecione vários pedidos na lista para gerar em lote.'
        />
      ) : (
        groups.map(([pvId, pos]) => (
          <Panel key={pvId} flush>
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                {pvNumById[pvId] || pvId}
                <Badge variant="outline" className="text-xs">{pos.length} OC(s)</Badge>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatCurrency(pos.reduce((s, o) => s + Number(o.total_value || 0), 0))}
              </span>
            </div>
            <Table className="[&_td]:py-2 [&_th]:py-2">
              <TableHeader>
                <TableRow className="[&_th]:text-xs [&_th]:text-muted-foreground">
                  <TableHead>Nº OC</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                    <TableCell className={o.supplier_id ? '' : 'text-amber-700'}>{o.supplier_name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{STATUS_LABEL[o.status] || o.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(o.total_value)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{fmtDate(o.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link to="/purchase-orders" className="text-xs text-primary hover:underline">ver no menu</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        ))
      )}
    </div>
  );
}
