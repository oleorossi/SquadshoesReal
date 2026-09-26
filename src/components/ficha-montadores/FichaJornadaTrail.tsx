interface FichaJornadaTrailProps {
  tab: "lancamento" | "producao";
  reportView: "resumo" | "calendario" | "lancamentos";
  onLancamento: () => void;
  onConferir: () => void;
  onRelatorios: () => void;
}

/** Trilha 1·Lançar → 2·Conferir/pagar → 3·Relatórios (home do dono). */
export function FichaJornadaTrail({
  tab,
  reportView,
  onLancamento,
  onConferir,
  onRelatorios,
}: FichaJornadaTrailProps) {
  const onHome = tab === "producao" && reportView === "resumo";
  const onAudit = tab === "producao" && reportView !== "resumo";

  return (
    <ol
      aria-label="Jornada da ficha"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      <li className={tab === "lancamento" ? "text-foreground" : ""}>
        <button type="button" className="hover:text-foreground" onClick={onLancamento}>
          1 · Lançar
        </button>
      </li>
      <li aria-hidden className="text-border">→</li>
      <li className={onHome ? "text-muted-foreground" : ""}>
        <button type="button" className="hover:text-foreground" onClick={onConferir}>
          2 · Conferir / pagar
        </button>
      </li>
      <li aria-hidden className="text-border">→</li>
      <li className={onHome || onAudit ? "text-foreground" : ""}>
        <button type="button" className="hover:text-foreground" onClick={onRelatorios}>
          3 · Relatórios
        </button>
      </li>
    </ol>
  );
}
