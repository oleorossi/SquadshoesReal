/**
 * Panel — contêiner de seção do design system "Novidade Editorial".
 *
 * Substitui o padrão `<Card><CardHeader><CardTitle>` para blocos de
 * conteúdo (tabelas, listas, gráficos). Header editorial com eyebrow
 * opcional + título + slot de ações, separado do corpo por uma rule.
 *
 * Chrome 100% via design tokens. Para tabelas, passe `flush` (remove o
 * padding do corpo) — a tabela encosta nas bordas.
 */
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PanelProps {
  /** Eyebrow ALL-CAPS acima do título (ex: "PRODUÇÃO · ONDAS"). */
  eyebrow?: string;
  /** Título do painel. */
  title?: ReactNode;
  /** Subtítulo / descrição curta abaixo do título. */
  subtitle?: ReactNode;
  /** Slot direito do header — botões, filtros, badges. */
  actions?: ReactNode;
  /** Remove o padding do corpo (ideal para tabelas full-bleed). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
  /** Classes extras no corpo. */
  bodyClassName?: string;
}

export function Panel({
  eyebrow, title, subtitle, actions, flush, children, className, bodyClassName,
}: PanelProps) {
  const hasHeader = eyebrow || title || subtitle || actions;
  return (
    <div className={cn('bg-card border border-border rounded-lg overflow-hidden', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="min-w-0 space-y-0.5">
            {eyebrow && <div className="section-label">{eyebrow}</div>}
            {title && (
              <h3 className="text-sm font-bold tracking-tight text-foreground leading-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </div>
  );
}
