import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CircleNotch as Loader2, Lock } from '@phosphor-icons/react';

interface Props {
  saleOrderId: string;
}

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const KIND_LABEL: Record<string, string> = {
  pv_commitment: 'Comprometido',
  atelier_prep: 'Ateliê',
  component: 'OP',
};

export default function PvMaterialCommitmentsSection({ saleOrderId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pv-material-commitments', saleOrderId],
    enabled: !!saleOrderId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc(
        'list_material_commitments_by_pv',
        { p_sale_order_id: saleOrderId },
      );
      if (error) throw error;
      return (rows || []) as Array<{
        reservation_id: string;
        product_id: string;
        product_name: string;
        quantity_reserved: number;
        quantity_consumed: number;
        open_qty: number;
        status: string;
        kind: string;
        order_id: string | null;
        order_number: string | null;
        component: string | null;
        physical_qty: number;
        reserved_stock: number;
        available_qty: number;
      }>;
    },
  });

  if (isLoading) {
    return (
      <Panel className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando comprometimentos…
        </div>
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel className="p-4">
        <p className="text-sm text-destructive">
          Não foi possível carregar os comprometimentos deste PV.
        </p>
      </Panel>
    );
  }

  const open = (data || []).filter((r) => r.status === 'reserved' || r.status === 'partially_consumed');
  if (open.length === 0) return null;

  return (
    <Panel className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-semibold">Material comprometido (PV)</h3>
        <Badge variant="outline" className="text-xs">{open.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Saldo bloqueado para este pedido (disponível = físico − comprometido). Soft pegging — sem carimbo de lote na NF.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Aberto</TableHead>
              <TableHead className="text-right hidden md:table-cell">Físico</TableHead>
              <TableHead className="text-right hidden md:table-cell">Disponível</TableHead>
              <TableHead className="hidden md:table-cell">OP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.map((r) => (
              <TableRow key={r.reservation_id}>
                <TableCell className="font-medium text-sm">
                  {r.product_name}
                  {r.component ? (
                    <span className="block text-xs text-muted-foreground">{r.component}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {KIND_LABEL[r.kind] || r.kind}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{fmt(r.open_qty)}</TableCell>
                <TableCell className="text-right font-mono text-sm hidden md:table-cell">
                  {fmt(r.physical_qty)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm hidden md:table-cell">
                  {fmt(r.available_qty)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                  {r.order_number ? `#${r.order_number}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
