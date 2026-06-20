import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { X, FileArrowDown as FileDown, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface SelectionTotalsBarProps {
  count: number;
  total: number;
  paid: number;
  pending: number;
  onClear: () => void;
  onGeneratePdf: () => void;
  generating?: boolean;
  /** Ações extras (ex.: aprovar/enviar em massa na OC) renderizadas antes do PDF. */
  extraActions?: ReactNode;
  className?: string;
}

/**
 * Barra fixa no rodapé que aparece quando há ≥1 item selecionado numa listagem.
 * Mostra o contador + os totais somados (total, pago, a pagar) e o botão de
 * gerar o relatório PDF sobre a seleção. Reusada nas listagens de OC e OS.
 *
 * Mobile-first: em telas pequenas vira uma barra full-width colada embaixo
 * (com scroll horizontal nos números); em ≥sm vira uma pílula centralizada.
 */
export function SelectionTotalsBar({
  count,
  total,
  paid,
  pending,
  onClear,
  onGeneratePdf,
  generating,
  extraActions,
  className,
}: SelectionTotalsBarProps) {
  const visible = count > 0;
  return (
    <div
      role="toolbar"
      aria-label="Seleção e totais"
      aria-hidden={!visible}
      className={cn(
        'fixed z-toast transition-all duration-300 ease-out',
        // Mobile: barra colada embaixo, largura total. Desktop: pílula centralizada.
        'inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-8 pointer-events-none',
        className,
      )}
    >
      <div className="flex items-center gap-3 overflow-x-auto border-t border-border bg-card px-4 py-2.5 shadow-lg shadow-foreground/5 sm:rounded-lg sm:border">
        {/* Contador */}
        <div className="flex items-baseline gap-2 pr-3 border-r border-border shrink-0">
          <span className="font-display text-2xl leading-none tabular-nums">{count}</span>
          <span className="section-label text-foreground">selecionada{count !== 1 ? 's' : ''}</span>
        </div>

        {/* Totais */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
            <span className="text-sm font-bold tabular-nums">{fmtBRL(total)}</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Pago</span>
            <span className="text-sm font-semibold tabular-nums text-green-600">{fmtBRL(paid)}</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">A pagar</span>
            <span className="text-sm font-semibold tabular-nums text-amber-600">{fmtBRL(pending)}</span>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1.5 pl-2 shrink-0 ml-auto">
          {extraActions}
          <Button size="sm" className="gap-1.5" onClick={onGeneratePdf} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Gerar PDF
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={onClear} aria-label="Limpar seleção">
            <X className="h-3.5 w-3.5" /> Limpar
          </Button>
        </div>
      </div>
    </div>
  );
}
