import type { ReactNode } from "react";

interface FichaConferirPanelProps {
  children: ReactNode;
}

/**
 * Módulo Conferir / pagar — ranking e quitação.
 * Na home Relatórios o ranking mora à direita; este wrapper marca o módulo.
 */
export function FichaConferirPanel({ children }: FichaConferirPanelProps) {
  return (
    <div className="space-y-4" data-ficha-modulo="conferir">
      {children}
    </div>
  );
}
