import { Warning as AlertTriangle } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type MaterialReservationErrorBadgeProps = {
  materialStatus?: string | null;
  notes?: string | null;
};

/** Aviso operacional para OP cuja reserva ficou parcial ou falhou. */
export function MaterialReservationErrorBadge({
  materialStatus,
  notes,
}: MaterialReservationErrorBadgeProps) {
  if (materialStatus !== 'erro_reserva') return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="h-5 gap-1 border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="h-3 w-3" weight="fill" />
            Reserva com erro
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs">
          {notes || 'A reserva de materiais desta OP exige atenção. Cadastre a cor e rode a reserva (MRP).'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
