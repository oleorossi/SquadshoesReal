import type { MxSCompare, MxSDayCompare } from "@/lib/fichaMontadoresMxS";

interface FichaMxSFaixaProps {
  compare: MxSCompare;
  fmtDia: (iso: string) => string;
}

function deltaTone(delta: number): string {
  if (delta === 0) return "text-foreground";
  return "text-amber-700 dark:text-amber-400";
}

function deltaLabel(delta: number): string {
  if (delta === 0) return "bate";
  if (delta > 0) return `S +${delta.toLocaleString("pt-BR")}`;
  return `S ${delta.toLocaleString("pt-BR")}`;
}

/** Faixa Montagem × Solagem — alerta visual se Δ ≠ 0; não bloqueia pagar. */
export function FichaMxSFaixa({ compare, fmtDia }: FichaMxSFaixaProps) {
  const { period, byDay } = compare;
  const mismatchDays = byDay.filter((d) => d.delta !== 0 && (d.montagem > 0 || d.solagem > 0));
  const hasMismatch = period.delta !== 0;

  return (
    <section
      aria-label="Comparativo Montagem e Solagem"
      className={`overflow-hidden rounded-xl border ${hasMismatch ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-card"}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Pares · Montagem × Solagem
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            O que a montagem lança no dia a solagem cobre. Δ ≠ 0 é furo — não trava pagamento.
          </p>
        </div>
        <div className={`font-mono text-sm font-bold tabular-nums ${deltaTone(period.delta)}`}>
          Δ {deltaLabel(period.delta)}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border/60">
        <Bucket label="Montagem" value={period.montagem} />
        <Bucket label="Solagem" value={period.solagem} />
        <div className="px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Delta</p>
          <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${deltaTone(period.delta)}`}>
            {period.delta === 0 ? "0" : period.delta.toLocaleString("pt-BR")}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">solagem − montagem</p>
        </div>
      </div>
      {mismatchDays.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-amber-500/30 px-4 py-2.5 font-mono text-[11px]">
          {mismatchDays.map((d) => (
            <DayChip key={d.dia} day={d} fmtDia={fmtDia} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Bucket({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-foreground">
        {value.toLocaleString("pt-BR")}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">pares</p>
    </div>
  );
}

function DayChip({ day, fmtDia }: { day: MxSDayCompare; fmtDia: (iso: string) => string }) {
  return (
    <li
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300"
      title={`M ${day.montagem} · S ${day.solagem}`}
    >
      {fmtDia(day.dia)}
      <span className="ml-1.5 font-bold">
        M {day.montagem.toLocaleString("pt-BR")} · S {day.solagem.toLocaleString("pt-BR")}
      </span>
    </li>
  );
}
