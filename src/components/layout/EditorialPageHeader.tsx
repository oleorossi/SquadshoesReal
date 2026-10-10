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
   * Título principal — Anton uppercase. No modo default usa escala operacional
   * (ex-compact); `compact` desce mais um degrau.
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
  /**
   * Densificação 2026-10: `default` = antigo compact operacional;
   * `compact` = ainda um degrau abaixo (listagens densas).
   * O hero Anton clamp (36–60px) saiu do default — identidade fica no kicker
   * + display do título em escala de página, não de landing.
   */
  density?: 'default' | 'compact';
}

/**
 * Header editorial reutilizável — Industrial Editorial Pro 2.0.
 *
 * Layout (responsivo):
 *   · KICKER · LABEL
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  01   TÍTULO EM ANTON                  [actions]         │
 *   │       ATUALIZADO 14:32 · 32 FUNCIONÁRIOS                 │
 *   │       descrição opcional · 1-2 linhas                    │
 *   ╞══════════════════════════════════════════════════════════╡  ← rule-thick 3px
 *   │  [kpis grid opcional]                                    │
 *
 * Em mobile: actions empilha embaixo do título.
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
  density = 'default',
}: EditorialPageHeaderProps) {
  useDocumentTitle(title);
  const denser = density === 'compact';
  return (
    <header className={cn('relative', denser ? 'pb-0.5' : 'pb-1', className)}>
      <div className={cn(denser ? 'space-y-1' : 'space-y-1.5')}>
        {/* ── Eyebrow row (kicker MONO + live indicator opcional) ── */}
        <div className="flex items-center gap-2">
          {sectionNumber && (
            <span
              className={cn(
                'ed-display text-muted-foreground leading-none shrink-0',
                denser ? 'text-sm sm:text-base' : 'text-base sm:text-lg',
              )}
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

        {/* ── Title row (anton + actions inline em desktop) ── */}
        <div className={cn(
          'flex flex-col md:flex-row md:items-end md:justify-between',
          denser ? 'gap-1.5 md:gap-3' : 'gap-2 md:gap-4',
        )}>
          <div className={cn('min-w-0 flex-1', denser ? 'space-y-0.5' : 'space-y-1')}>
            <h1 className={cn(
              'break-words font-display uppercase leading-none tracking-tight text-foreground',
              denser
                ? 'text-lg sm:text-xl'
                : 'text-xl sm:text-2xl',
            )}>
              {title}
            </h1>
            {meta && (
              <p className="hero-editorial-meta">
                {meta}
              </p>
            )}
            {description && (
              <p className={cn(
                'text-muted-foreground max-w-xl',
                denser ? 'text-[11px] leading-snug' : 'text-xs',
              )}>{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* ── Rule-thick separator (3px foreground) ── */}
      {!noRule && (
        <div
          className={cn('rule-thick', denser ? 'mt-2' : 'mt-2.5')}
          aria-hidden="true"
        />
      )}

      {/* ── KPI slot abaixo do rule-line ── */}
      {kpis && (
        <div className={denser ? 'mt-2' : 'mt-3'}>
          {kpis}
        </div>
      )}
    </header>
  );
}
