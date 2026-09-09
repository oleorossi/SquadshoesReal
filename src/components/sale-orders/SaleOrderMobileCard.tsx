import { Package, PencilSimple as Pencil } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { parseDateOnly } from '@/lib/dateOnly';
import {
  STATUS_COLORS,
  STATUS_DOT,
  TERMINAL_BILLED_STATUSES,
  formatSaleOrderCurrency,
  formatSaleOrderDate,
} from '@/components/sale-orders/saleOrderListConstants';

interface SaleOrderMobileCardProps {
  order: any;
  pairs: number;
  minBilling: string | null;
  selected: boolean;
  canSeeFinancialValues: boolean;
  canEditPv: boolean;
  onToggleSelect: () => void;
  onOpenDetails: () => void;
  onPrefetchConsumption: () => void;
  onOpenConsumption: () => void;
  onEdit: () => void;
}

/** Card compacto da lista de PVs no viewport mobile (Fase 2.2). */
export function SaleOrderMobileCard({
  order,
  pairs,
  minBilling,
  selected,
  canSeeFinancialValues,
  canEditPv,
  onToggleSelect,
  onOpenDetails,
  onPrefetchConsumption,
  onOpenConsumption,
  onEdit,
}: SaleOrderMobileCardProps) {
  const isOverdue = !!(
    order.delivery_deadline
    && parseDateOnly(order.delivery_deadline) < new Date()
    && !TERMINAL_BILLED_STATUSES.includes(order.status)
    && order.status !== 'Cancelado'
  );
  const isInfeasible = !!(
    minBilling
    && order.delivery_deadline
    && order.delivery_deadline < minBilling
    && !TERMINAL_BILLED_STATUSES.includes(order.status)
    && order.status !== 'Cancelado'
  );

  return (
    <article
      className={cn(
        'rounded-xl border bg-card p-4 shadow-sm transition-colors',
        selected && 'border-primary bg-primary/5',
        (isOverdue || isInfeasible) && 'border-l-4 border-l-destructive',
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect()}
          aria-label={`Selecionar pedido ${order.order_number}`}
          className="mt-1"
        />
        <button type="button" onClick={onOpenDetails} className="min-w-0 flex-1 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-bold text-primary">{order.order_number || '—'}</span>
            <Badge variant="outline" className={cn('shrink-0 text-xs', STATUS_COLORS[order.status])}>
              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[order.status])} />
              {order.status}
            </Badge>
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{order.client_name}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <span>
              <strong className="block font-mono text-sm text-foreground">{pairs.toLocaleString('pt-BR')}</strong>
              pares
            </span>
            {canSeeFinancialValues && (
              <span>
                <strong className="block truncate font-mono text-sm text-foreground">
                  {formatSaleOrderCurrency(Number(order.total))}
                </strong>
                total
              </span>
            )}
            <span className={cn('text-right', (isOverdue || isInfeasible) && 'font-semibold text-destructive')}>
              <strong className="block text-sm text-foreground">{formatSaleOrderDate(order.delivery_deadline)}</strong>
              entrega
            </span>
          </div>
          {isInfeasible && minBilling && (
            <p className="mt-2 text-xs font-semibold text-destructive">
              Data mínima viável: {formatSaleOrderDate(minBilling)}
            </p>
          )}
        </button>
      </div>
      <div className="mt-3 flex gap-2 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          className="min-h-10 flex-1 gap-1.5"
          onMouseEnter={onPrefetchConsumption}
          onClick={onOpenConsumption}
        >
          <Package className="h-4 w-4" /> Consumo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-10 flex-1 gap-1.5"
          disabled={!canEditPv}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" /> Editar
        </Button>
      </div>
    </article>
  );
}
