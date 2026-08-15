import { Warning, ArrowClockwise, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';
import {
  useRetryServiceOrderGenerationGap,
  useServiceOrderGenerationGaps,
} from '@/hooks/useGenerateOpServiceOrders';

/**
 * Exceções da automação PV → OP → OS. O gatilho não bloqueia a fábrica quando
 * uma tarifa/cadastro está ausente; este painel torna a pendência visível e
 * oferece reprocessamento pelo mesmo writer canônico.
 */
export function ServiceOrderGenerationGapsAlert() {
  const { data: gaps = [], isLoading, isError } = useServiceOrderGenerationGaps();
  const retry = useRetryServiceOrderGenerationGap();

  if (isLoading || isError || gaps.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5" aria-label="OS pendentes de geração">
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 px-3 py-2.5">
        <Warning className="h-4 w-4 text-amber-700 dark:text-amber-400" weight="fill" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{gaps.length} terceirização sem OS</p>
          <p className="text-[11px] text-muted-foreground">A OP foi criada, mas tarifa ou cadastro impediram a emissão automática.</p>
        </div>
      </div>
      <div className="divide-y divide-amber-500/15">
        {gaps.slice(0, 6).map((gap) => (
          <div key={`${gap.order_id}:${gap.sector}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            <span className="font-mono font-semibold text-foreground">{gap.pv_number} · {gap.op_number}</span>
            <span className="text-muted-foreground">{serviceOrderSectorLabel(gap.sector)} → {gap.contractor_name}</span>
            <span className="min-w-0 flex-1 text-amber-700 dark:text-amber-400">{gap.reason}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-amber-500/30"
              disabled={retry.isPending || /tarifa|inativo|inexistente/i.test(gap.reason)}
              title={/tarifa|inativo|inexistente/i.test(gap.reason) ? 'Corrija o cadastro indicado antes de reprocessar.' : 'Gerar a OS agora'}
              onClick={() => retry.mutate(gap)}
            >
              {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowClockwise className="h-3.5 w-3.5" />}
              Reprocessar
            </Button>
          </div>
        ))}
      </div>
      {gaps.length > 6 && (
        <p className="border-t border-amber-500/20 px-3 py-2 text-[11px] text-muted-foreground">
          Mais {gaps.length - 6} pendência(s). Corrija as primeiras para reduzir a fila.
        </p>
      )}
    </section>
  );
}
