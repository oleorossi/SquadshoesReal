import { CheckCircle2, Clock, Circle, Scissors, Layers, Gem, Printer, Flame, Hammer, Footprints, Hand, Sparkles, Box, ScanSearch, PenLine, ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OrderStage } from '@/hooks/useOrderStages';

interface Props {
  stages: OrderStage[];
  onStageClick: (stage: OrderStage) => void;
}

const STAGE_ICONS: Record<string, LucideIcon> = {
  // Canonical names (post-Grupo 13 rename)
  'Corte Palmilha': Scissors,
  'Corte Forração': Layers,
  'Mesa':           Hand,
  'Silk':           Printer,
  'Colagem':        Flame,
  'Montagem':       Hammer,
  'Solagem':        Footprints,
  'Acabamento':     Sparkles,
  'Expedição':      Box,
  // Legacy fallbacks for in-flight orders created before rename
  'Corte':          Scissors,
  'Forração':       Layers,
  'Aviamento':      Gem,
  'Costura':        PenLine,
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
        const isDone = stage.status === 'concluido';
        const StageIcon = STAGE_ICONS[stage.stage_name] ?? ClipboardList;

        return (
          <button
            key={stage.id}
            onClick={() => onStageClick(stage)}
            className={`
              inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer
              ${isDone ? 'bg-success/15 text-success border-success/30' : ''}
              ${isRunning ? 'bg-warning/15 text-warning border-warning/30 animate-pulse' : ''}
              ${isPending ? 'bg-muted text-muted-foreground border-border' : ''}
              hover:ring-1 hover:ring-ring
            `}
            title={`${stage.stage_name}: ${stage.quantity_processed}/${stage.quantity_total}`}
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
