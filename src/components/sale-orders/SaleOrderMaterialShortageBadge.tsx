import { CheckCircle, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  formatShortageGrade,
  formatShortageQuantity,
  materialShortageStatus,
  saleOrderShowsMaterialShortage,
  shortageMaterialLabel,
  type SaleOrderMaterialShortageInfo,
} from '@/hooks/useSaleOrderMaterialShortages';

interface Props {
  status: string | null | undefined;
  info: SaleOrderMaterialShortageInfo | undefined;
  className?: string;
}

/**
 * Selo de material do PV na lista de vendas.
 *
 *  • "Falta material (N)" (âmbar) — abre a lista de produto, cor e quanto falta;
 *    solado mostra a falta por numeração.
 *  • "Material completo" (verde) — o motor empenhou tudo que o PV consome.
 *
 * Aprovar com falta NÃO é bloqueado (decisão do dono) — o selo é o aviso.
 * Sem dado (RPC ausente/falhou, PV sem linha gerenciada) → não renderiza nada.
 */
export function SaleOrderMaterialShortageBadge({ status, info, className }: Props) {
  if (!saleOrderShowsMaterialShortage(status)) return null;
  const state = materialShortageStatus(info);
  if (!state || !info) return null;

  if (state === 'completo') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 gap-1 whitespace-nowrap border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400',
          className,
        )}
        title="Todo o material deste PV está empenhado — liberado para corte."
      >
        <CheckCircle className="h-3 w-3" weight="fill" />
        Material completo
      </Badge>
    );
  }

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
          aria-label={`Falta material em ${info.shortLines} ${info.shortLines === 1 ? 'item' : 'itens'}. Ver detalhes`}
        >
          <AlertTriangle className="h-3 w-3" weight="fill" />
          Falta material ({info.shortLines})
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            Falta material{info.orderNumber ? ` — ${info.orderNumber}` : ''}
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            O PV segue liberado; a entrada de estoque quita a falta pela prioridade.
          </p>
        </div>
        {info.shortages.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {info.shortLines} {info.shortLines === 1 ? 'linha' : 'linhas'} com empenho parcial.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto">
            {info.shortages.map((line, i) => {
              const grade = formatShortageGrade(line.shortage_grade);
              return (
                <li key={`${line.product_id ?? 'x'}-${i}`} className="px-3 py-2 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 font-medium text-foreground">{shortageMaterialLabel(line)}</span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      −{formatShortageQuantity(line.quantity_short, line.unit)}
                    </span>
                  </div>
                  {grade && (
                    <p className="mt-0.5 font-mono text-[11px] text-red-600 dark:text-red-400">
                      nº {grade}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
