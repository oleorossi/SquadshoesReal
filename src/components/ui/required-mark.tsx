import { cn } from '@/lib/utils';

interface RequiredMarkProps {
  className?: string;
}

export function RequiredMark({ className }: RequiredMarkProps) {
  return (
    <span
      className={cn('text-destructive ml-0.5', className)}
      aria-label="campo obrigatório"
    >
      *
    </span>
  );
}
