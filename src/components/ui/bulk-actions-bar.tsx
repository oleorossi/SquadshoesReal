import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface BulkAction {
  /** Texto exibido no botão */
  label: string;
  /** Ícone do Phosphor / lucide (qualquer ReactNode 14px) */
  icon?: ReactNode;
  /** Click handler — recebe Set<string> dos IDs selecionados */
  onClick: (selectedIds: Set<string>) => void | Promise<void>;
  /** Aparência visual */
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  /** Desabilita o botão (ex: enquanto processando) */
  disabled?: boolean;
}

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  actions: BulkAction[];
  /** Sobrescreve o label "X selecionado(s)" — útil pra contexto (ex: "3 OPs selecionadas") */
  itemLabel?: string;
  /** Esconde a barra (override externo). Padrão: mostra se há seleção. */
  hidden?: boolean;
  className?: string;
}

/**
 * Barra fixa no rodapé da viewport. Aparece com slide-up animation quando
 * há itens selecionados. Mostra contador + botões de ação + Cancelar.
 *
 * Renderizada como overlay fixo (não dentro do container da tabela) pra
 * não interferir no layout interno. Z-index alto pra ficar sobre scroll.
 *
 * Padrão visual editorial: branco dominante, hairline border, bg-card,
 * sem shadow forte. Tipografia Anton no número + section-label "selecionado".
 */
export function BulkActionsBar({
  selectedIds,
  onClear,
  actions,
  itemLabel,
  hidden,
  className,
}: BulkActionsBarProps) {
  const count = selectedIds.size;
  const visible = !hidden && count > 0;

  return (
    <div
      role="toolbar"
      aria-label="Ações em massa"
      aria-hidden={!visible}
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-toast',
        'transition-all duration-300 ease-out',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-8 pointer-events-none',
        className,
      )}
    >
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg shadow-foreground/5">
        {/* Counter */}
        <div className="flex items-baseline gap-2 pr-3 border-r border-border">
          <span className="font-display text-2xl leading-none tabular-nums">
            {count}
          </span>
          <span className="section-label text-foreground">
            {itemLabel ?? `selecionado${count !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {actions.map((action, idx) => (
            <Button
              key={idx}
              variant={action.variant ?? 'default'}
              size="sm"
              disabled={action.disabled}
              onClick={() => action.onClick(selectedIds)}
              className="h-8 gap-1.5 text-xs"
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>

        {/* Cancel */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="h-8 w-8 shrink-0 ml-1"
          aria-label="Cancelar seleção (Esc)"
          title="Cancelar seleção (Esc)"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Visual do retângulo de marquee. Renderizado dentro do container relativo
 * que tem useMarqueeSelection. Posição absoluta com coords do hook.
 */
export function MarqueeOverlay({
  rect,
}: {
  rect: { left: number; top: number; width: number; height: number } | null;
}) {
  if (!rect) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute pointer-events-none border border-primary bg-primary/10 rounded-sm z-dropdown"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
