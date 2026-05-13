import { ReactNode } from 'react';
import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Ícone Lucide pra exibir no topo (h-12 w-12 dentro de bg-muted/60). */
  icon?: LucideIcon;
  /** Título principal (font-semibold, text-base). */
  title: string;
  /** Descrição opcional (text-sm muted, max-w-xs). */
  description?: string;
  /** Ação primária opcional (CTA) — pode ser Button, Link, etc. */
  action?: ReactNode;
  /** Padding vertical (default py-16). Use 'sm' pra py-8 em containers pequenos. */
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * EmptyState — placeholder unificado pra listas/tabelas vazias.
 *
 * Substitui ~23 variantes ad-hoc espalhadas no projeto que usavam
 * combinações soltas de Card + ícone + texto. Garante consistência
 * visual: ícone em circle bg-muted, título font-semibold, descrição
 * muted small, espaçamento padrão.
 *
 * Uso:
 * ```tsx
 * <EmptyState
 *   icon={Package}
 *   title="Nenhum produto encontrado"
 *   description="Tente ajustar os filtros ou cadastre um novo produto."
 *   action={<Button onClick={openCreate}>Novo produto</Button>}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-3 px-6',
        size === 'sm' ? 'py-8' : 'py-16',
        className,
      )}
      role="status"
    >
      {Icon && (
        <div className="h-12 w-12 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground/50 mb-1">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
