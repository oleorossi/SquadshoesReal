import { SectorProgressDots } from '@/components/production/SectorProgressDots';
import {
  formatFloorProgressLabel,
  saleOrderShowsFloorProgress,
  type SaleOrderFloorProgress,
} from '@/hooks/useSaleOrdersFloorProgress';

/** Acima disso, dots por estágio ficam ilegíveis (PV com muitas OPs). */
const DOTS_MAX_STAGES = 16;

interface SaleOrderFloorProgressSummaryProps {
  status: string | null | undefined;
  progress: SaleOrderFloorProgress | undefined;
  /** Em celular o rótulo do gargalo vai na linha de baixo. */
  compact?: boolean;
}

/**
 * Resumo de chão na lista de PVs: dots + n/m + setor gargalo.
 * Só para Aprovado / Em Produção; demais status → null (sem progresso falso).
 */
export function SaleOrderFloorProgressSummary({
  status,
  progress,
  compact = false,
}: SaleOrderFloorProgressSummaryProps) {
  if (!saleOrderShowsFloorProgress(status)) return null;
  if (!progress || progress.total <= 0) return null;

  const label = formatFloorProgressLabel(progress);
  const sectorOnly = progress.current_sector;
  const showDots = progress.total <= DOTS_MAX_STAGES;
  const tooltip = [
    label,
    progress.ops_active > 0 ? `${progress.ops_active} OP(s) ativa(s)` : null,
    progress.ops_done > 0 ? `${progress.ops_done} OP(s) finalizada(s)` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-0.5" title={tooltip || undefined}>
      {showDots ? (
        <SectorProgressDots
          completed={progress.completed}
          inProgress={progress.in_progress}
          total={progress.total}
        />
      ) : (
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {progress.completed}/{progress.total}
        </span>
      )}
      {sectorOnly && (
        <span className={compact
          ? 'text-xs text-muted-foreground truncate max-w-[180px]'
          : 'text-xs text-muted-foreground truncate max-w-[140px]'
        }>
          {sectorOnly}
        </span>
      )}
    </div>
  );
}
