import type { ReactNode } from "react";

interface FichaLancamentoPanelProps {
  children: ReactNode;
  /** Reserva espaço pro dock sticky de rascunho. */
  hasDock?: boolean;
}

/** Módulo Lançar — bancada Dia/Semana (conteúdo composto pela página). */
export function FichaLancamentoPanel({ children, hasDock }: FichaLancamentoPanelProps) {
  return (
    <div
      className={`space-y-4 ${hasDock ? "pb-[calc(120px+env(safe-area-inset-bottom))]" : ""}`}
      data-ficha-modulo="lancamento"
    >
      {children}
    </div>
  );
}
