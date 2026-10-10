import type { ComponentType, ReactNode } from "react";
import {
  Warning as WarningIcon,
  CurrencyDollar,
  Clock,
  ClipboardText,
  CheckCircle,
  FileArrowDown,
  ChartBar,
} from "@phosphor-icons/react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FichaMxSFaixa } from "@/components/ficha-montadores/FichaMxSFaixa";
import { FichaConferirPanel } from "@/components/ficha-montadores/FichaConferirPanel";
import type { MxSCompare } from "@/lib/fichaMontadoresMxS";

export interface RelatoriosAggRow {
  key: string;
  nome: string;
  fichas: number;
  paresMedio: number;
  paresDificil: number;
  pares: number;
  taxaMedio: number;
  taxaDificil: number;
  porPar: boolean;
  valorPago: number;
  valorFolha: number;
  valorAberto: number;
  valorTotal: number;
  setorLabel?: string;
}

export interface RelatoriosTotals {
  fichas: number;
  pares: number;
  medio: number;
  dificil: number;
  valorPago: number;
  valorFolha: number;
  valorAberto: number;
  valorTotal: number;
}

export interface RelatoriosResumo {
  pares: number;
  paresMedio: number;
  paresDificil: number;
  bruto: number;
  brutoMedio: number;
  brutoDificil: number;
  taxaMedio: number;
  taxaDificil: number;
  taxaVariou: boolean;
  fichas: number;
  dias: number;
  semDetalhe: number;
  legado: number;
}

export interface RelatoriosWow {
  from: string;
  to: string;
  pares: number;
  bruto: number;
}

export interface RelatoriosCalCell {
  pares: number;
  medio: number;
  dificil: number;
  pago: boolean;
  /** Δ M×S do dia (solagem − montagem); undefined se sem dado. */
  mxDelta?: number;
}

export interface RelatoriosCalendario {
  porDia: Map<string, RelatoriosCalCell>;
  dias: string[];
  meses: string[];
  temDificil: boolean;
}

interface FichaRelatoriosHomeProps {
  periodLabel: string;
  rangeLabel: string;
  fmtDia: (iso: string) => string;
  fmtBRL: (v: number) => string;
  wdShort7: string[];
  dowIdx: (iso: string) => number;
  mxS: MxSCompare;
  /** Totais combinados M+S (topo). */
  totalsCombined: RelatoriosTotals;
  /** Pares×taxa do filtro atual (esquerda). */
  resumo: RelatoriosResumo;
  /** Split de bruto por setor no período (filtros de pessoa/pagamento). */
  brutoPorSetor: { montagem: number; solagem: number };
  paresPorSetor: { montagem: number; solagem: number };
  agg: RelatoriosAggRow[];
  totals: RelatoriosTotals;
  calendario: RelatoriosCalendario;
  wow: RelatoriosWow | null;
  oficioSing: string;
  podePagar: boolean;
  janelaESemanaFechada: boolean;
  onExportCsv: () => void;
  onPagar: (row: RelatoriosAggRow) => void;
  rankingActions?: ReactNode;
}

/**
 * Home Relatórios (dono): layout C —
 * esquerda dinheiro (1–3) · direita ranking (4) · calendário full-width (5).
 * Assinatura: quadro de fábrica.
 */
export function FichaRelatoriosHome({
  periodLabel,
  rangeLabel,
  fmtDia,
  fmtBRL,
  wdShort7,
  dowIdx,
  mxS,
  totalsCombined,
  resumo,
  brutoPorSetor,
  paresPorSetor,
  agg,
  totals,
  calendario,
  wow,
  oficioSing,
  podePagar,
  janelaESemanaFechada,
  onExportCsv,
  onPagar,
  rankingActions,
}: FichaRelatoriosHomeProps) {
  const emptyPeriod = totalsCombined.pares === 0 && totalsCombined.valorTotal === 0;

  return (
    <div className="space-y-4" data-ficha-modulo="relatorios">
      <FichaMxSFaixa compare={mxS} fmtDia={fmtDia} />

      {emptyPeriod ? (
        <Panel>
          <EmptyState
            icon={ChartBar}
            title="Nenhuma produção neste período"
            description="Lance a chamada em Montagem e Solagem, ou mude o período. O comparativo M×S e o caixa aparecem quando houver pares."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* ── Esquerda: dinheiro (1–3) ── */}
          <div className="space-y-4">
            <section
              aria-label="Custo de mão de obra"
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="border-b border-border bg-foreground px-4 py-3 text-background">
                <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-background/65">
                  <CurrencyDollar className="h-4 w-4" /> Total do período · M+S
                </div>
                <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight tabular-nums">
                  {fmtBRL(totalsCombined.valorTotal)}
                </p>
                <p className="mt-1 text-xs text-background/70">
                  {totalsCombined.pares.toLocaleString("pt-BR")} pares ·{" "}
                  {totalsCombined.fichas.toLocaleString("pt-BR")} fichas
                </p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border border-b border-border font-mono text-xs tabular-nums">
                <SetorBruto
                  label="Montagem"
                  bruto={brutoPorSetor.montagem}
                  pares={paresPorSetor.montagem}
                  fmtBRL={fmtBRL}
                />
                <SetorBruto
                  label="Solagem"
                  bruto={brutoPorSetor.solagem}
                  pares={paresPorSetor.solagem}
                  fmtBRL={fmtBRL}
                />
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                <MoneyCell
                  label="A pagar"
                  value={totalsCombined.valorAberto}
                  hint="livre para fechar"
                  icon={Clock}
                  tone="text-amber-600"
                  fmtBRL={fmtBRL}
                  total={totalsCombined.valorTotal}
                />
                <MoneyCell
                  label="Na folha"
                  value={totalsCombined.valorFolha}
                  hint="aprovado, não quitado"
                  icon={ClipboardText}
                  tone="text-blue-600"
                  fmtBRL={fmtBRL}
                  total={totalsCombined.valorTotal}
                />
                <MoneyCell
                  label="Pago"
                  value={totalsCombined.valorPago}
                  hint="sem pendência"
                  icon={CheckCircle}
                  tone="text-green-600"
                  fmtBRL={fmtBRL}
                  total={totalsCombined.valorTotal}
                />
              </div>
            </section>

            <section
              aria-label="Pares por dificuldade"
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="border-b border-border px-4 py-2.5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Pares × R$/par · filtro atual
                </p>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="grid grid-cols-[74px_1fr_auto] items-baseline gap-2.5">
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-amber-600">
                    Médio
                  </span>
                  <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                    <b className="font-semibold text-foreground">
                      {resumo.paresMedio.toLocaleString("pt-BR")}
                    </b>{" "}
                    pares × {fmtBRL(resumo.taxaMedio)}
                  </span>
                  <span className="text-right font-mono text-sm font-semibold tabular-nums">
                    {fmtBRL(resumo.brutoMedio)}
                  </span>
                </div>
                {resumo.paresDificil > 0 && (
                  <div className="grid grid-cols-[74px_1fr_auto] items-baseline gap-2.5">
                    <span className="rounded bg-green-600/10 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-green-400">
                      Difícil
                    </span>
                    <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                      <b className="font-semibold text-foreground">
                        {resumo.paresDificil.toLocaleString("pt-BR")}
                      </b>{" "}
                      pares × {fmtBRL(resumo.taxaDificil)}
                    </span>
                    <span className="text-right font-mono text-sm font-semibold tabular-nums">
                      {fmtBRL(resumo.brutoDificil)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3.5 border-t border-border px-4 py-2 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                <span>
                  <b className="font-semibold text-foreground/80">
                    {resumo.fichas.toLocaleString("pt-BR")}
                  </b>{" "}
                  fichas
                </span>
                <span>
                  <b className="font-semibold text-foreground/80">{resumo.dias}</b> dias produtivos
                </span>
                <span>
                  <b className="font-semibold text-foreground/80">
                    {Math.round(resumo.pares / (resumo.dias || 1)).toLocaleString("pt-BR")}
                  </b>{" "}
                  pares/dia
                </span>
              </div>
            </section>

            {(resumo.taxaVariou || resumo.legado > 0 || resumo.semDetalhe > 0) && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {resumo.taxaVariou && (
                    <p>O R$/par mudou no período. Cada lançamento preserva a taxa vigente no dia.</p>
                  )}
                  {resumo.legado > 0 && (
                    <p>
                      <b>{resumo.legado}</b> lançamento(s) antigo(s) aparecem no histórico, mas não
                      entram no total da folha.
                    </p>
                  )}
                  {resumo.semDetalhe > 0 && (
                    <p>
                      <b>{resumo.semDetalhe}</b> lançamento(s) sem dificuldade detalhada entram como
                      médio, seguindo o motor da folha.
                    </p>
                  )}
                </div>
              </div>
            )}

            {wow && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    vs semana anterior ({fmtDia(wow.from)}–{fmtDia(wow.to)})
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={onExportCsv}
                  >
                    <FileArrowDown className="h-3.5 w-3.5" /> CSV
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Pares</p>
                    <p>
                      {resumo.pares.toLocaleString("pt-BR")}
                      <span
                        className={`ml-1 ${resumo.pares - wow.pares >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        ({resumo.pares - wow.pares >= 0 ? "+" : ""}
                        {(resumo.pares - wow.pares).toLocaleString("pt-BR")})
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Bruto</p>
                    <p>
                      {fmtBRL(resumo.bruto)}
                      <span
                        className={`ml-1 ${resumo.bruto - wow.bruto >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        ({resumo.bruto - wow.bruto >= 0 ? "+" : ""}
                        {fmtBRL(resumo.bruto - wow.bruto)})
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Direita: ranking (4) ── */}
          <FichaConferirPanel>
            <Panel
              eyebrow={`${periodLabel} · ${rangeLabel}`}
              title={`Rendimento por ${oficioSing}`}
              subtitle="Valor pelo R$/par gravado em cada lançamento. Ordenado por pares."
              actions={rankingActions}
            >
              <div className="divide-y divide-border/60">
                {agg.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Sem lançamentos no filtro atual.
                  </p>
                )}
                {agg.map((r, i) => (
                  <article key={r.key} className="flex items-start gap-3 px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">{r.nome}</h3>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {r.fichas} fichas
                        {r.setorLabel ? ` · ${r.setorLabel}` : ""}
                        {" · "}
                        <span className="text-amber-600">{r.paresMedio.toLocaleString("pt-BR")} méd</span>
                        {r.paresDificil > 0 && (
                          <>
                            {" · "}
                            <span className="text-green-700 dark:text-green-400">
                              {r.paresDificil.toLocaleString("pt-BR")} dif
                            </span>
                          </>
                        )}
                      </p>
                      {r.porPar && (
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                          <span className="text-amber-600">
                            a pagar {r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}
                          </span>
                          {" · "}
                          <span className="text-green-600">
                            pago {r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right font-mono tabular-nums">
                      <span className="block text-lg font-bold text-foreground">
                        {r.pares.toLocaleString("pt-BR")}
                      </span>
                      <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                        pares
                      </span>
                      {r.porPar && (
                        <span className="mt-0.5 block text-xs font-semibold text-foreground">
                          {fmtBRL(r.valorTotal)}
                        </span>
                      )}
                      {podePagar && r.porPar && r.valorAberto > 0 && !r.key.startsWith("txt:") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1.5 h-7"
                          disabled={!janelaESemanaFechada}
                          title={
                            janelaESemanaFechada
                              ? undefined
                              : "O pagamento só fecha em semana completa (seg→dom)."
                          }
                          onClick={() => onPagar(r)}
                        >
                          Pagar
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {agg.length > 0 && (
                <div className="flex justify-between border-t border-border px-4 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                  <span>Total ({agg.length})</span>
                  <span>
                    <b className="text-foreground">{totals.pares.toLocaleString("pt-BR")}</b> pares ·{" "}
                    <b className="text-foreground">{fmtBRL(totals.valorTotal)}</b>
                  </span>
                </div>
              )}
            </Panel>
          </FichaConferirPanel>
        </div>
      )}

      {/* ── Calendário full-width (5) ── */}
      {!emptyPeriod && calendario.dias.length > 0 && (
        <section aria-label="Ritmo diário" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Ritmo · calendário do período
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Âmbar = dia não pago. Contorno âmbar forte = Δ Montagem×Solagem no dia.
            </p>
          </div>
          {calendario.meses.map((mes) => {
            const [ano, m] = mes.split("-").map(Number);
            const primeiro = new Date(ano, m - 1, 1);
            const ultimo = new Date(ano, m, 0);
            const offset = (primeiro.getDay() + 6) % 7;
            const celulas: ReactNode[] = [];
            for (let i = 0; i < offset; i++) {
              celulas.push(<div key={`v${i}`} className="invisible" aria-hidden />);
            }
            for (let dd = 1; dd <= ultimo.getDate(); dd++) {
              const iso = `${ano}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
              const dentro = calendario.dias.includes(iso);
              const c = calendario.porDia.get(iso);
              const fds = dowIdx(iso) >= 5;
              if (!dentro) {
                celulas.push(<div key={iso} className="invisible" aria-hidden />);
                continue;
              }
              if (!c) {
                celulas.push(
                  <div
                    key={iso}
                    className={`min-h-11 rounded-md border border-dashed border-border p-1 sm:min-h-[58px] sm:p-1.5 ${fds ? "bg-muted/40" : ""}`}
                  >
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{dd}</span>
                  </div>,
                );
                continue;
              }
              const mxBad = c.mxDelta != null && c.mxDelta !== 0;
              celulas.push(
                <div
                  key={iso}
                  className={`flex min-h-11 min-w-0 flex-col overflow-hidden rounded-md border p-1 sm:min-h-[58px] sm:p-1.5 ${
                    mxBad
                      ? "border-amber-600 bg-amber-500/15"
                      : c.pago
                        ? "border-border bg-card"
                        : "border-amber-500/40 bg-amber-500/10"
                  } ${fds && c.pago && !mxBad ? "bg-muted/40" : ""}`}
                  title={`${fmtDia(iso)} — ${c.pares.toLocaleString("pt-BR")} pares${c.pago ? "" : " · não pago"}${mxBad ? ` · Δ M×S ${c.mxDelta}` : ""}`}
                >
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{dd}</span>
                  <span className="mt-auto truncate font-mono text-[11px] font-bold leading-none tracking-tight tabular-nums text-foreground sm:text-[17px]">
                    {c.pares.toLocaleString("pt-BR")}
                  </span>
                  {calendario.temDificil && (
                    <span className="hidden font-mono text-[9px] leading-tight sm:block">
                      <span className="font-bold text-amber-600">{c.medio}</span>
                      {c.dificil > 0 && (
                        <>
                          {" · "}
                          <span className="font-bold text-green-700 dark:text-green-400">{c.dificil}</span>
                        </>
                      )}
                    </span>
                  )}
                  {mxBad && (
                    <span className="hidden font-mono text-[8px] font-bold uppercase text-amber-700 dark:text-amber-400 sm:block">
                      Δ {c.mxDelta}
                    </span>
                  )}
                </div>,
              );
            }
            return (
              <div key={mes}>
                <h3 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </h3>
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                  {wdShort7.map((w) => (
                    <span
                      key={w}
                      className="pb-0.5 text-center font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground"
                    >
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1">{celulas}</div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-3.5 font-mono text-[11px] text-muted-foreground">
            <span>
              <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-500/40 bg-amber-500/10 align-[-1px]" />
              dia ainda não pago
            </span>
            <span>
              <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-600 bg-amber-500/15 align-[-1px]" />
              Δ Montagem×Solagem
            </span>
            <span>
              <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-border align-[-1px]" />
              sem lançamento
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function SetorBruto({
  label,
  bruto,
  pares,
  fmtBRL,
}: {
  label: string;
  bruto: number;
  pares: number;
  fmtBRL: (v: number) => string;
}) {
  return (
    <div className="px-4 py-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{fmtBRL(bruto)}</p>
      <p className="text-[10px] text-muted-foreground">{pares.toLocaleString("pt-BR")} pares</p>
    </div>
  );
}

function MoneyCell({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  fmtBRL,
  total,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  fmtBRL: (v: number) => string;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider sm:text-[11px] ${tone}`}>
        <Icon className="hidden h-4 w-4 sm:block" /> {label}
      </div>
      <p className="mt-2 truncate font-mono text-xs font-bold tabular-nums text-foreground sm:text-lg" title={fmtBRL(value)}>
        {fmtBRL(value)}
      </p>
      <p className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">{hint}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full rounded-full ${tone.includes("amber") ? "bg-amber-500" : tone.includes("blue") ? "bg-blue-600" : "bg-green-600"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
