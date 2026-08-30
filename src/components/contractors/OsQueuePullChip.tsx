import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  QUEUE_PULL_CHIP_META,
  type QueuePullFilter,
} from '@/lib/serviceOrderStageQueue';

export function OsQueuePullChip({ pull }: { pull: QueuePullFilter }) {
  const meta = QUEUE_PULL_CHIP_META[pull];
  return (
    <Badge
      variant="outline"
      title={meta.hint}
      className={cn('h-5 shrink-0 text-[9px] uppercase tracking-wider', meta.className)}
    >
      {meta.label}
    </Badge>
  );
}
