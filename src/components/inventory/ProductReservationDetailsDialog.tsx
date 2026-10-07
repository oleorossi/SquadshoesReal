import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  CircleNotch as Loader2,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
  PencilSimple as Pencil,
} from '@phosphor-icons/react';
import {
  groupCommitmentsByPv,
  sumOpenQty,
  type CommitmentRow,
} from '@/lib/productReservationGroups';
import { cn } from '@/lib/utils';

interface Props {
  productId: string | null;
  productName?: string;
  unit?: string | null;
  /** Bruto em estoque — se omitido, busca do produto. */
  quantity?: number | null;
  /** products.reserved_stock — se omitido, busca do produto. */
  reservedStock?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fmt = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

export default function ProductReservationDetailsDialog({
  productId, productName, unit, quantity, reservedStock, open, onOpenChange,
}: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (open) setExpanded(new Set());
  }, [open, productId]);

  const { data: productStock } = useQuery({
    queryKey: ['product-stock-header', productId],
    enabled: !!productId && open && (quantity == null || reservedStock == null),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('quantity, reserved_stock, unit')
        .eq('id', productId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: commitments, isLoading } = useQuery({
    queryKey: ['product-material-commitments', productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        'list_material_commitments_by_product',
        { p_product_id: productId },
      );
      if (error) throw error;
      return (data || []) as CommitmentRow[];
    },
  });

  const groups = useMemo(
    () => groupCommitmentsByPv(commitments || []),
    [commitments],
  );
  const listedOpen = sumOpenQty(groups);

  const bruto = Number(quantity ?? productStock?.quantity ?? 0);
  const reservado = Number(reservedStock ?? productStock?.reserved_stock ?? listedOpen);
  const livre = bruto - reservado;
  const unitLabel = unit ?? productStock?.unit ?? '';

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const goEditProduct = () => {
    if (!productId) return;
    onOpenChange(false);
    navigate(`/estoque/${productId}`);
  };

  const goPv = (saleOrderId: string) => {
    onOpenChange(false);
    navigate(`/sales/edit/${saleOrderId}`);
  };

  const goOp = (orderNumber: string) => {
    onOpenChange(false);
    navigate(`/orders?search=${encodeURIComponent(orderNumber)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{productName || 'Reservas do material'}</DialogTitle>
          <DialogDescription>
            Pedidos com quantidade reservada deste item. Somente leitura.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-border pb-3 text-sm">
          <div>
            <span className="text-muted-foreground">Bruto </span>
            <span className="font-mono font-semibold tabular-nums">{fmt(bruto)}</span>
            {unitLabel ? <span className="ml-1 text-muted-foreground">{unitLabel}</span> : null}
          </div>
          <div>
            <span className="text-muted-foreground">Reservado </span>
            <span className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {fmt(reservado)}
            </span>
            {unitLabel ? <span className="ml-1 text-muted-foreground">{unitLabel}</span> : null}
          </div>
          <div>
            <span className="text-muted-foreground">Livre </span>
            <span
              className={cn(
                'font-mono font-semibold tabular-nums',
                livre < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {fmt(livre)}
            </span>
            {unitLabel ? <span className="ml-1 text-muted-foreground">{unitLabel}</span> : null}
          </div>
          {groups.length > 0 && Math.abs(listedOpen - reservado) > 0.01 && (
            <p className="basis-full text-xs text-amber-700 dark:text-amber-400">
              Soma das linhas ({fmt(listedOpen)}) difere do reservado do cadastro ({fmt(reservado)}).
            </p>
          )}
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              title="Nenhuma reserva aberta"
              description="Este material não está reservado em nenhum pedido no momento."
              action={
                <Button variant="outline" size="sm" className="gap-2" onClick={goEditProduct}>
                  <Pencil className="h-4 w-4" />
                  Editar cadastro
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Pedido</TableHead>
                    <TableHead className="hidden sm:table-cell">Cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Semana fat.</TableHead>
                    <TableHead className="text-right">Qtd aberta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const isOpen = expanded.has(g.key);
                    const pvLabel = g.saleOrderId
                      ? (g.saleOrderNumber || g.saleOrderId.slice(0, 8))
                      : 'Sem PV';
                    return (
                      <FragmentGroup
                        key={g.key}
                        isOpen={isOpen}
                        onToggle={() => toggle(g.key)}
                        pvLabel={pvLabel}
                        saleOrderId={g.saleOrderId}
                        clientName={g.clientName}
                        billingWeek={g.billingWeek}
                        openQty={g.openQty}
                        ops={g.ops}
                        onGoPv={goPv}
                        onGoOp={goOp}
                        unitLabel={unitLabel}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {groups.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" className="gap-2" onClick={goEditProduct}>
              <Pencil className="h-4 w-4" />
              Editar cadastro
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FragmentGroup({
  isOpen,
  onToggle,
  pvLabel,
  saleOrderId,
  clientName,
  billingWeek,
  openQty,
  ops,
  onGoPv,
  onGoOp,
  unitLabel,
}: {
  isOpen: boolean;
  onToggle: () => void;
  pvLabel: string;
  saleOrderId: string | null;
  clientName: string | null;
  billingWeek: string | null;
  openQty: number;
  ops: { reservationId: string; orderId: string | null; orderNumber: string | null; status: string | null; kind: string | null; openQty: number }[];
  onGoPv: (id: string) => void;
  onGoOp: (orderNumber: string) => void;
  unitLabel: string;
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={onToggle}
        data-testid={`reservation-pv-${saleOrderId ?? 'orphan'}`}
      >
        <TableCell className="w-8 px-2">
          {isOpen
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium">
          {saleOrderId ? (
            <button
              type="button"
              className="text-left hover:text-primary hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onGoPv(saleOrderId);
              }}
            >
              {pvLabel}
            </button>
          ) : (
            <span className="text-muted-foreground">{pvLabel}</span>
          )}
          <span className="ml-2 text-xs text-muted-foreground sm:hidden">
            {clientName || '—'}
          </span>
        </TableCell>
        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
          {clientName || '—'}
        </TableCell>
        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
          {billingWeek || '—'}
        </TableCell>
        <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
          {fmt(openQty)}
          {unitLabel ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unitLabel}</span> : null}
        </TableCell>
      </TableRow>
      {isOpen && ops.map((op) => (
        <TableRow key={op.reservationId} className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={2} className="pl-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {op.orderNumber ? (
                <button
                  type="button"
                  className="font-mono font-medium hover:text-primary hover:underline"
                  onClick={() => onGoOp(op.orderNumber!)}
                >
                  #{op.orderNumber}
                </button>
              ) : (
                <span className="text-muted-foreground">Sem OP</span>
              )}
              {op.status && (
                <Badge variant="outline" className="text-xs">{op.status}</Badge>
              )}
              {op.kind && (
                <Badge variant="secondary" className="text-xs font-normal">{op.kind}</Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden md:table-cell" />
          <TableCell className="text-right font-mono text-sm tabular-nums">
            {fmt(op.openQty)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
