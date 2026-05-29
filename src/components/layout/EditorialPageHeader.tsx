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
   * Título principal — renderiza com Anton via .hero-editorial-title (clamp 36-60px).
   */
  title: string;
  /**
   * Descrição opcional (1-2 linhas) abaixo do título.
   */
  description?: string;
  /**
   * Metadados secundários renderizados em MONO ao lado do título (ex:
   * "ATUALIZADO 14:32 · 32 FUNCIONÁRIOS ATIVOS"). Wrap automático em mobile.
   * Use <strong> dentro pra destacar números.
   */
  meta?: ReactNode;
  /**
   * Indicador "live" inline no eyebrow — pulse vermelho squad. Pra dashboards
   * com dados em tempo real ou hubs operacionais.
   */
  live?: boolean;
  /**
   * Slot direito — botões, filtros, etc. Empilha embaixo em mobile.
   */
  actions?: ReactNode;
  /**
   * Slot inferior — KPI grid horizontal logo abaixo do rule-line. Renderiza
   * sem padding extra (deixa o consumer compor com .grid-kpi-fluid).
   * Opcional — se ausente, hero termina no rule-line.
   */
  kpis?: ReactNode;
  /**
   * Esconde a rule-thick de baixo. Padrão: mostra. Útil quando o componente
   * filho já traz seu próprio divisor.
   */
  noRule?: boolean;
  /**
   * Classes extras no wrapper.
   */
  className?: string;
}

/**
 * Header editorial reutilizável — Industrial Editorial Pro 2.0.
 *
 * Layout (responsivo):
 *   · KICKER · LABEL
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  01   TÍTULO GIGANTE EM ANTON          [actions]         │
 *   │       ATUALIZADO 14:32 · 32 FUNCIONÁRIOS                 │
 *   │       descrição opcional · 1-2 linhas                    │
 *   ╞══════════════════════════════════════════════════════════╡  ← rule-thick 3px
 *   │  [kpis grid opcional]                                    │
 *
 * Em mobile: actions empilha embaixo do título. Tipografia colapsa via clamp.
 */
export function EditorialPageHeader({
  sectionNumber,
  sectionLabel,
  title,
  description,
  meta,
  live = false,
  actions,
  kpis,
  noRule = false,
  className,
}: EditorialPageHeaderProps) {
  useDocumentTitle(title);
  return (
    <header className={cn('relative pb-2', className)}>
      <div className="space-y-3">
        {/* ── Eyebrow row (kicker MONO + live indicator opcional) ── */}
        <div className="flex items-center gap-2.5">
          {sectionNumber && (
            <span
              className="ed-display text-xl sm:text-2xl text-muted-foreground leading-none shrink-0"
              aria-hidden="true"
            >
              {sectionNumber}
            </span>
          )}
          {live && (
            <span className="live-dot shrink-0" aria-hidden="true" />
          )}
          <span className="ed-eyebrow">{sectionLabel}</span>
        </div>

        {/* ── Title row (anton clamp + actions inline em desktop) ── */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="hero-editorial-title break-words">
              {title}
            </h1>
            {meta && (
              <p className="hero-editorial-meta">
                {meta}
              </p>
            )}
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
      </div>

      {/* ── Rule-thick separator (3px foreground) ── */}
      {!noRule && (
        <div
          className="rule-thick mt-5"
          aria-hidden="true"
        />
      )}

      {/* ── KPI slot abaixo do rule-line ── */}
      {kpis && (
        <div className="mt-5">
          {kpis}
        </div>
      )}
    </header>
  );
}
