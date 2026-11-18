/**
 * Detalhe da OS nascida no envio do Ateliê.
 * Não é o editor da OS avulsa nem o contêiner consolidado de outras linhas.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { formatDateBR } from '@/lib/dateOnly';

interface Props {
  order: {
    id: string;
    order_number: string;
    description?: string | null;
    quoted_deadline?: string | null;
    quantity?: number | null;
    total_value?: number | null;
  } | null;
  onClose: () => void;
}

interface Line {
  id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_value: number | null;
  atelier_job_id: string | null;
  sale_order_id: string | null;
}

interface DispatchRow {
  id: string;
  qty_dispatched: number;
  dispatched_at: string;
  notes: string | null;
}

interface ReturnRow {
  id: string;
  qty_good: number;
  qty_defect: number;
  qty_loss: number;
  returned_at: string;
}

export function isAtelierRemessa(order: { description?: string | null; notes?: string | null }): boolean {
  return order.description === 'Remessa do Ateliê'
    || (order.notes ?? '').includes('jobs enviados juntos neste clique');
}

export function AtelierOsDetailDialog({ order, onClose }: Props) {
  const open = !!order;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['atelier-os-detail', order?.id ?? ''],
    enabled: open,
    queryFn: async () => {
      const id = order!.id;
      const [lines, dispatches, returns] = await Promise.all([
        supabase.from('service_order_items' as never)
          .select('id, description, quantity, unit_price, total_value, atelier_job_id, sale_order_id')
          .eq('service_order_id', id),
        supabase.from('service_order_dispatches')
          .select('id, qty_dispatched, dispatched_at, notes')
          .eq('service_order_id', id)
          .order('dispatched_at', { ascending: false }),
        supabase.from('service_order_returns')
          .select('id, qty_good, qty_defect, qty_loss, returned_at')
          .eq('service_order_id', id)
          .order('returned_at', { ascending: false }),
      ]);
      if (lines.error) throw lines.error;
      if (dispatches.error) throw dispatches.error;
      if (returns.error) throw returns.error;
      const itemRows = (lines.data ?? []) as unknown as Line[];
      const saleIds = [...new Set(itemRows.map((row) => row.sale_order_id).filter(Boolean))] as string[];
      let numbers = new Map<string, string>();
      if (saleIds.length > 0) {
        const { data: saleRows, error } = await supabase
          .from('sale_orders')
          .select('id, order_number')
          .in('id', saleIds);
        if (error) throw error;
        numbers = new Map((saleRows ?? []).map((row) => [row.id, row.order_number]));
      }
      return {
        lines: itemRows,
        dispatches: (dispatches.data ?? []) as DispatchRow[],
        returns: (returns.data ?? []) as ReturnRow[],
        numbers,
      };
    },
  });

  const firstPv = data?.lines.find((line) => line.sale_order_id)?.sale_order_id;
  const pvNumber = firstPv ? data?.numbers.get(firstPv) : null;
  const sent = (data?.dispatches ?? []).reduce((sum, row) => sum + Number(row.qty_dispatched || 0), 0);
  const received = (data?.returns ?? []).reduce(
    (sum, row) => sum + Number(row.qty_good || 0) + Number(row.qty_defect || 0) + Number(row.qty_loss || 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{order?.order_number}</DialogTitle>
          <DialogDescription>
            Remessa do Ateliê. O número da OS é este. O cartão da fila usa o mesmo número.
            {order?.quoted_deadline ? ` Volta prevista ${formatDateBR(order.quoted_deadline)}.` : ''}
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando a remessa…</p>}
        {isError && <p className="text-sm text-destructive">Não foi possível ler a remessa.</p>}
        {data && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {sent} enviados · {received} retornados
              {order?.total_value != null ? ` · ${formatCurrency(Number(order.total_value))}` : ''}
            </p>
            {pvNumber && (
              <Link className="text-primary underline" to={`/atelie?view=fila&pedido=${encodeURIComponent(pvNumber)}`}>
                Abrir {pvNumber} na fila do Ateliê
              </Link>
            )}
            <ul className="space-y-1">
              {data.lines.map((line) => (
                <li key={line.id} className="rounded border border-border/70 px-2 py-1">
                  <span className="font-medium">{line.description || 'Item'}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {Number(line.quantity || 0)} pares
                    {line.unit_price != null ? ` · ${formatCurrency(Number(line.unit_price))}/par` : ''}
                    {line.total_value != null ? ` · ${formatCurrency(Number(line.total_value))}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Despachos</p>
              {data.dispatches.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum despacho.</p>
              ) : (
                <ul className="text-xs">
                  {data.dispatches.map((row) => (
                    <li key={row.id}>{row.qty_dispatched} pares · {formatDateBR(row.dispatched_at.slice(0, 10))}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Retornos</p>
              {data.returns.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum retorno.</p>
              ) : (
                <ul className="text-xs">
                  {data.returns.map((row) => (
                    <li key={row.id}>
                      {row.qty_good} bons
                      {row.qty_defect ? ` · ${row.qty_defect} defeito` : ''}
                      {row.qty_loss ? ` · ${row.qty_loss} perda` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
