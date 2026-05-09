import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, Factory } from 'lucide-react';

interface Props {
  productId: string | null;
  productName?: string;
  unit?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fmt = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export default function ProductReservationDetailsDialog({
  productId, productName, unit, open, onOpenChange,
}: Props) {
  const { data: reservations, isLoading: loadingRes } = useQuery({
    queryKey: ['product-reservations', productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('material_reservations')
        .select('id, order_id, quantity_reserved, quantity_consumed, status, lot_number, location, created_at, source')
        .eq('product_id', productId)
        .in('status', ['reserved', 'partially_consumed'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: movements, isLoading: loadingMov } = useQuery({
    queryKey: ['product-in-prod-movements', productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data: sm, error } = await supabase
        .from('stock_movements')
        .select('id, order_id, quantity, previous_stock, new_stock, description, created_at, user_email')
        .eq('product_id', productId!)
        .eq('movement_type', 'out')
        .not('order_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const orderIds = Array.from(new Set((sm || []).map((m: any) => m.order_id).filter(Boolean)));
      if (orderIds.length === 0) return [];
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('id, order_number, status, color')
        .in('id', orderIds)
        .in('status', ['Reservado', 'Em Produção']);
      if (oErr) throw oErr;
      const byId = new Map((orders || []).map((o: any) => [o.id, o]));
      return (sm || [])
        .filter((m: any) => byId.has(m.order_id))
        .map((m: any) => ({ ...m, order: byId.get(m.order_id) }));
    },
  });

  // Pega order_numbers para reservations
  const reservationOrderIds: string[] = Array.from(
    new Set((reservations || []).map((r: any) => r.order_id).filter((v: unknown): v is string => typeof v === 'string'))
  );
  const { data: reservationOrders } = useQuery({
    queryKey: ['reservation-order-numbers', reservationOrderIds.sort().join(',')],
    enabled: reservationOrderIds.length > 0 && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .in('id', reservationOrderIds);
      if (error) throw error;
      return new Map((data || []).map((o: any) => [o.id, o]));
    },
  });

  const totalReserved = (reservations || []).reduce(
    (acc: number, r: any) => acc + Math.max(0, Number(r.quantity_reserved || 0) - Number(r.quantity_consumed || 0)),
    0,
  );
  const totalInProd = (movements || []).reduce(
    (acc: number, m: any) => acc + Number(m.quantity || 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{productName || 'Detalhes do Produto'}</DialogTitle>
          <DialogDescription>
            Reservas ativas e movimentos de estoque ligados a OPs em produção.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="rounded-lg border p-3 bg-amber-500/5">
            <div className="flex items-center gap-2 text-xs uppercase font-medium text-amber-700">
              <Lock className="h-3.5 w-3.5" /> Reservado
            </div>
            <div className="display text-2xl tabular-nums text-amber-700 mt-1">
              {fmt(totalReserved)} <span className="text-sm font-normal text-muted-foreground">{unit || ''}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {(reservations || []).length} reserva(s)
            </div>
          </div>
          <div className="rounded-lg border p-3 bg-blue-500/5">
            <div className="flex items-center gap-2 text-xs uppercase font-medium text-blue-700">
              <Factory className="h-3.5 w-3.5" /> Em Produção
            </div>
            <div className="display text-2xl tabular-nums text-blue-700 mt-1">
              {fmt(totalInProd)} <span className="text-sm font-normal text-muted-foreground">{unit || ''}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {(movements || []).length} movimento(s)
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600" /> Reservas Ativas
          </h3>
          {loadingRes ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : (reservations || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem reservas ativas.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Reservado</TableHead>
                    <TableHead className="text-right">Consumido</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="hidden md:table-cell">Origem</TableHead>
                    <TableHead className="hidden md:table-cell">Criado em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reservations || []).map((r: any) => {
                    const saldo = Math.max(0, Number(r.quantity_reserved || 0) - Number(r.quantity_consumed || 0));
                    const ord = reservationOrders?.get(r.order_id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {ord?.order_number ? `#${ord.order_number}` : (r.order_id?.slice(0, 8) ?? '—')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt(r.quantity_reserved)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmt(r.quantity_consumed)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{fmt(saldo)}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{r.source || '—'}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Factory className="h-4 w-4 text-blue-600" /> Movimentos em OPs Ativas
          </h3>
          {loadingMov ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : (movements || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem movimentos em OPs ativas.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qtde</TableHead>
                    <TableHead className="hidden md:table-cell">Descrição</TableHead>
                    <TableHead className="hidden md:table-cell">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(movements || []).map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.order?.order_number ? `#${m.order.order_number}` : (m.order_id?.slice(0, 8) ?? '—')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{m.order?.status || '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmt(m.quantity)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-xs truncate">{m.description || '—'}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{fmtDate(m.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}