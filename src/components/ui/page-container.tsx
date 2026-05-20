import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  /**
   * Densidade do padding interno:
   * - 'default' = p-6 (24px) — padrão do design system, header de página principal
   * - 'tight'   = p-4 (16px) — listas densas, modais expandidos
   * - 'flush'   = p-0       — full-bleed (mapas, dashboards live)
   */
  density?: 'default' | 'tight' | 'flush';
  /** Limita a largura horizontal pra evitar texto esticado em 4K. Default: sem limite. */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | 'screen' | 'none';
  /** Gap vertical entre filhos (space-y). Default: space-y-5. */
  gap?: 'sm' | 'md' | 'lg';
  /** Animação de entrada (page-enter). Default: true. */
  animate?: boolean;
  className?: string;
}

const DENSITY_MAP = {
  default: 'p-6',
  tight: 'p-4',
  flush: 'p-0',
} as const;

const MAX_WIDTH_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  screen: 'max-w-screen-2xl',
  none: '',
} as const;

const GAP_MAP = {
  sm: 'space-y-3',
  md: 'space-y-5',
  lg: 'space-y-8',
} as const;

export function PageContainer({
  children,
  density = 'default',
  maxWidth = 'none',
  gap = 'md',
  animate = true,
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        DENSITY_MAP[density],
        MAX_WIDTH_MAP[maxWidth],
        GAP_MAP[gap],
        maxWidth !== 'none' && 'mx-auto',
        animate && 'page-enter',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  /** Título principal (h1, text-2xl font-bold). */
  title: ReactNode;
  /** Subtítulo opcional (text-sm muted, abaixo do título). */
  subtitle?: ReactNode;
  /** Slot pra botões/ações no canto direito. */
  actions?: ReactNode;
  /** Eyebrow label (text-eyebrow style, acima do título). */
  eyebrow?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1 space-y-1">
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
