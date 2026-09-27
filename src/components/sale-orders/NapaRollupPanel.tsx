import { formatQty } from '@/lib/consumptionFormat';
import type { NapaRollup } from '@/lib/napaRollup';

interface Props {
  rollup: NapaRollup | null;
  /** Família selecionada no filtro (opcional). */
  selectedFamily?: string | null;
  onSelectFamily?: (name: string | null) => void;
  /** Compacto no trilho; completo no corpo / modal. */
  compact?: boolean;
  className?: string;
}

/**
 * Rollup canônico de napa: família → cor → destinos (cabedal / forração / tira)
 * → total. Usado na tela de consumo, no modal de OC e espelhado nos PDFs internos.
 */
export default function NapaRollupPanel({
  rollup,
  selectedFamily = null,
  onSelectFamily,
  compact = false,
  className = '',
}: Props) {
  if (!rollup) {
    return (
      <div className={`rounded-lg border border-border bg-card p-3 ${className}`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Necessidade de napa
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nenhuma napa neste consumo — só solado, químicos e/ou embalagem.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-border bg-card p-3 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Necessidade de napa
      </p>
      <p className="font-mono text-xl font-bold leading-none tabular-nums text-foreground">
        {formatQty(rollup.total, 'm')}
        <span className="ml-0.5 text-base font-semibold">m</span>
      </p>
      {rollup.parts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rollup.parts.map((part) => (
            <button
              key={part.name}
              type="button"
              aria-pressed={selectedFamily === part.name}
              onClick={() => onSelectFamily?.(selectedFamily === part.name ? null : part.name)}
              className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-snug transition-colors ${
                selectedFamily === part.name
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {formatQty(part.qty, 'm')} {part.name}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        cabedal · forração · tiras convertidas · soma por família e cor
      </p>
      {rollup.pendingCount > 0 && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {rollup.pendingCount}{' '}
          {rollup.pendingCount === 1 ? 'tira sem rendimento' : 'tiras sem rendimento'} — cadastre antes de gerar a OC
        </p>
      )}
      {rollup.skipped > rollup.pendingCount && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {rollup.skipped - rollup.pendingCount}{' '}
          {(rollup.skipped - rollup.pendingCount) === 1 ? 'item ficou' : 'itens ficaram'} fora
          do total — cadastro incompleto
        </p>
      )}

      {!compact && (
        <ul className="mt-3 space-y-2 border-t border-border/60 pt-2">
          {rollup.byFamilyColor
            .filter((b) => !selectedFamily || b.family === selectedFamily)
            .map((block) => (
              <li key={`${block.family}::${block.color}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    {block.family}
                    <span className="font-normal text-muted-foreground"> · {block.color}</span>
                  </p>
                  <p className="font-mono text-xs font-bold tabular-nums">
                    {formatQty(block.total, 'm')} m
                  </p>
                </div>
                <ul className="mt-0.5 space-y-0.5 pl-2">
                  {block.destinations.map((d) => (
                    <li
                      key={`${d.kind}-${d.label}-${d.pending ? 'p' : 'ok'}`}
                      className="flex items-baseline justify-between gap-2 text-[11px]"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {d.kind === 'Tira' ? d.label : d.label}
                        {d.kind === 'Tira' && d.strapMeters != null && d.strapMeters > 0 && (
                          <span className="opacity-80">
                            {' '}· {formatQty(d.strapMeters, 'm')} m tira
                            {d.yieldPerMeter ? ` ÷ ${d.yieldPerMeter}` : ''}
                          </span>
                        )}
                        {d.pending && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">rendimento pendente</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-foreground">
                        {d.pending ? '—' : `${formatQty(d.napaMeters, 'm')} m`}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
