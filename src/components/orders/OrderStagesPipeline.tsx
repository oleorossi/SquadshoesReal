import { CheckCircle as CheckCircle2, Clock, Circle, Scissors, Stack as Layers, Diamond as Gem, Printer, Flame, Hammer, Footprints, Hand, Sparkle as Sparkles, Cube as Box, MagnifyingGlass as ScanSearch, PencilLine as PenLine, ClipboardText as ClipboardList } from '@phosphor-icons/react';
import type { Icon as LucideIcon } from '@phosphor-icons/react';
import { OrderStage } from '@/hooks/useOrderStages';
import { isStageFullyProduced, isStageSkipped } from '@/lib/production/stageFlow';

interface Props {
  stages: OrderStage[];
  onStageClick: (stage: OrderStage) => void;
}

const STAGE_ICONS: Record<string, LucideIcon> = {
  // Canonical names pós PR1-PR3
  'Corte Palmilha': Scissors,
  'Corte Forração': Layers,
  'Aviamento':      Gem,         // ex-"Mesa", renomeado pela PR 1
  'Costura':        PenLine,     // setor próprio pela PR 2
  'Silk':           Printer,
  'Colagem':        Flame,
  'Montagem':       Hammer,
  'Solagem':        Footprints,
  'Acabamento':     Sparkles,
  'Expedição':      Box,
  // Legacy fallbacks for in-flight orders created before rename
  'Mesa':           Hand,
  'Corte':          Scissors,
  'Forração':       Layers,
  'Embalagem':      Box,
  'Inspeção':       ScanSearch,
};

export default function OrderStagesPipeline({ stages, onStageClick }: Props) {
  const sortedStages = [...stages].sort((a, b) => a.stage_order - b.stage_order);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {sortedStages.map((stage) => {
        const isPending = stage.status === 'pendente';
        const isRunning = stage.status === 'em_andamento';
        const skipped = isStageSkipped(stage);
        const isDone = isStageFullyProduced(stage);
        const StageIcon = STAGE_ICONS[stage.stage_name] ?? ClipboardList;

        return (
          <button
            key={stage.id}
            onClick={() => onStageClick(stage)}
            className={`
              inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer
              ${isDone ? 'bg-success/15 text-success border-success/30' : ''}
              ${skipped ? 'bg-warning/10 text-warning border-warning/30' : ''}
              ${isRunning ? 'bg-warning/15 text-warning border-warning/30 animate-pulse' : ''}
              ${isPending ? 'bg-muted text-muted-foreground border-border' : ''}
              hover:ring-1 hover:ring-ring
            `}
            title={`${stage.stage_name}: ${skipped ? 'pulado' : `${stage.quantity_processed}/${stage.quantity_total}`}`}
          >
            <StageIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">{stage.stage_name}</span>
            {isDone && <CheckCircle2 className="h-3 w-3" />}
            {isRunning && <Clock className="h-3 w-3" />}
            {isPending && <Circle className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
}
