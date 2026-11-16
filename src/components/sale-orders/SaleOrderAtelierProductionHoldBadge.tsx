import { Factory } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  ATELIER_PRODUCTION_HOLD_TITLE,
  saleOrderShowsAtelierProductionHold,
  type AtelierProductionHoldLine,
} from '@/lib/atelierProductionHold';

interface Props {
  status: string | null | undefined;
  holds: AtelierProductionHoldLine[] | undefined;
  className?: string;
}

/**
 * Selo "Ateliê (N)" na lista de PVs.
 *
 * A aprovação continua. Em Produção é recusado enquanto estes itens não
 * tiverem o cabedal de volta. A mesma lista sai no RAISE do banco.
 */
export function SaleOrderAtelierProductionHoldBadge({ status, holds, className }: Props) {
  if (!saleOrderShowsAtelierProductionHold(status)) return null;
  if (!holds || holds.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400',
            className,
          )}
          aria-label={`${holds.length} ${holds.length === 1 ? 'item' : 'itens'} com cabedal no Ateliê. Em Produção fica bloqueada até o retorno. Aprovação continua liberada.`}
        >
          <Factory className="h-3 w-3" weight="fill" />
          Ateliê ({holds.length})
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            Cabedal ainda no Ateliê
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {ATELIER_PRODUCTION_HOLD_TITLE} A aprovação continua liberada. A OP
            destes itens nasce quando o pedido for para Em Produção, depois que
            cada job voltar (prestador: recebido e conferido; interno: concluído).
          </p>
        </div>
        <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto">
          {holds.map(line => (
            <li key={line.itemId} className="px-3 py-2 text-xs">
              <div className="font-medium text-foreground">
                {line.referenceCode} · {line.color}
              </div>
              <p className="mt-0.5 leading-snug text-amber-700 dark:text-amber-400">
                {line.reason}
              </p>
              {line.pendingJobs ? (
                <p className="mt-0.5 font-mono text-[10px] leading-snug text-muted-foreground">
                  Jobs pendentes: {line.pendingJobs}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
