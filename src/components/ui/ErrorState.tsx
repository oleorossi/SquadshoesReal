import { Warning as AlertTriangle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ErrorState({
  title = 'Não foi possível carregar os dados',
  description = 'Verifique sua conexão e tente novamente.',
  onRetry,
  retrying = false,
  className,
  size = 'md',
}: ErrorStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center text-center",
      size === 'sm' && 'py-8 px-4',
      size === 'md' && 'py-16 px-4',
      size === 'lg' && 'py-24 px-4',
      className
    )}>
      <div className={cn("rounded-full bg-destructive/10 flex items-center justify-center mb-4", size === 'sm' ? 'h-8 w-8' : 'h-12 w-12')}>
        <AlertTriangle className={cn("text-destructive", size === 'sm' ? 'h-4 w-4' : 'h-6 w-6')} />
      </div>
      <h3 className={cn("font-semibold text-foreground mb-1", size === 'sm' ? 'text-xs' : 'text-sm')}>{title}</h3>
      <p className={cn("text-muted-foreground max-w-xs mb-4", size === 'sm' ? 'text-xs' : 'text-sm')}>{description}</p>
      {onRetry && (
        <Button variant="outline" size={size === 'sm' ? 'sm' : 'default'} onClick={onRetry} disabled={retrying} className="gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
          {retrying ? 'Tentando...' : 'Tentar novamente'}
        </Button>
      )}
    </div>
  );
}
