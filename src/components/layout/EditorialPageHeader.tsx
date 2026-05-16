import { ReactNode, useEffect } from 'react';
import { cn } from '@/lib/utils';

/** Atualiza document.title — restaura ao default quando desmonta. */
function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Squad Shoes` : 'Squad Shoes';
    return () => { document.title = previous; };
  }, [title]);
}

interface EditorialPageHeaderProps {
  /**
   * Numeração editorial (ex: "01", "02"). Aparece em Anton grande ao lado do kicker.
   * Opcional — se ausente, só renderiza o kicker text.
   */
  sectionNumber?: string;
  /**
   * Kicker label em ALL-CAPS small (10px tracking 0.18em). Ex: "PCP · Pedido".
   */
  sectionLabel: string;
  /**
   * Título principal — renderiza com Anton via .text-display-lg (clamp 48-96px).
   */
  title: string;
  /**
   * Descrição opcional (1-2 linhas) abaixo do título.
   */
  description?: string;
  /**
   * Slot direito — botões, filtros, etc. Empilha embaixo em mobile.
   */
  actions?: ReactNode;
  /**
   * Esconde a rule-line de baixo. Padrão: mostra. Útil quando o componente
   * filho já traz seu próprio divisor (ex: dashboards com section-label).
   */
  noRule?: boolean;
  /**
   * Classes extras no wrapper.
   */
  className?: string;
}

/**
 * Header editorial reutilizável.
 *
 * Layout (responsivo):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  01  KICKER · LABEL                       [actions]     │
 *   │  TÍTULO GIGANTE EM ANTON                                 │
 *   │  Descrição opcional · 1-2 linhas                         │
 *   ├──────────────────────────────────────────────────────────┤  ← rule-line
 *
 * Em mobile: actions empilha embaixo do título. Tipografia colapsa via clamp.
 */
export function EditorialPageHeader({
  sectionNumber,
  sectionLabel,
  title,
  description,
  actions,
  noRule = false,
  className,
}: EditorialPageHeaderProps) {
  useDocumentTitle(title);
  return (
    <header className={cn('space-y-3 pb-2', className)}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-6">
        <div className="min-w-0 space-y-2 flex-1">
          <div className="flex items-baseline gap-3">
            {sectionNumber && (
              <span
                className="font-display text-xl sm:text-2xl text-muted-foreground tabular-nums leading-none shrink-0"
                aria-hidden="true"
              >
                {sectionNumber}
              </span>
            )}
            <span className="section-label">{sectionLabel}</span>
          </div>
          <h1 className="text-display-lg !text-foreground !leading-[0.9]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-xl">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {actions}
          </div>
        )}
      </div>
      {!noRule && <div className="rule-line !bg-foreground" aria-hidden="true" />}
    </header>
  );
}
