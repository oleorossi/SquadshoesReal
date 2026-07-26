// FichaMontadoresPage.tsx — Squad Shoes
// "Ficha de Montadores" → CHAMADA DO DIA: produção diária dos montadores.
// O montador lança os PARES produzidos por TAMANHO DE FICHA (12 / 15 / 18 pares).
//   · fichas = Σ (pares ÷ tamanho)   · pares = Σ pares
// Roster do setor Montagem numa tela (visão Dia) + matriz montadores × Seg–Sex
// por tamanho (visão Semana). Um único "Salvar" (upsert em lote por dia/montador).
//
// Cada par tem DIFICULDADE (Médio âmbar / Difícil vermelho) que paga R$/par
// diferente: valor_par_medio / valor_par_dificil por montador.
// Modelo 'chamada' em public.ficha_montadores: 1 linha por (dia, montador_id) com
//   detalhe = [{tamanho, medio, dificil}], total = Σ (medio+dificil),
//   fichas_dia = Σ round((medio+dificil)/tamanho). Legado [{tamanho, pares}] é lido
//   como tudo MÉDIO; fichas de grade = origem='legacy'. Pagamento =
//   Σ pares_medio×valor_medio + Σ pares_dificil×valor_dificil.
import { supabase } from "@/integrations/supabase/client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatGrid, StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useEmployees } from "@/hooks/useEmployees";
import { searchMatchesAllTerms } from "@/lib/searchUtils";
import { useReferenciasProduzidas } from "@/hooks/useReferenciasProduzidas";
import { RelatorioPagamentoPanel } from "@/components/production/montadores/RelatorioPagamentoPanel";
import { ReferenciasProduzidasPanel } from "@/components/production/montadores/ReferenciasProduzidasPanel";
import { toast } from "sonner";
import { Printer, ChartBar, ClipboardText, ListChecks, Users, Package, CurrencyDollar, FloppyDisk, CaretLeft, CaretRight } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";
type Tab = "lancamento" | "produtividade" | "fichas";
type Setor =
  | "corte_palmilha" | "corte_forracao" | "aviamento" | "costura" | "silk"
  | "colagem" | "montagem" | "solagem" | "acabamento" | "expedicao";
/** Setores com chamada do dia INDEPENDENTE (mesma dinâmica, dados + relatórios
 *  separados por `ficha_montadores.setor`). Pra adicionar um setor novo é só
 *  incluir aqui — a tela ganha a aba automaticamente. */
const SETORES: { id: Setor; label: string; sing: string; plural: string; pattern: RegExp }[] = [
  { id: "corte_palmilha", label: "Corte Palmilha", sing: "cortador",  plural: "cortadores",  pattern: /corte\s*palmilha|palmilh/i },
  { id: "corte_forracao", label: "Corte Forração", sing: "cortador",  plural: "cortadores",  pattern: /corte\s*forra|forra/i },
  { id: "aviamento",      label: "Aviamento",      sing: "aviador",   plural: "aviadores",   pattern: /aviamento|mesa/i },
  { id: "costura",        label: "Costura",        sing: "costureiro", plural: "costureiros", pattern: /costura|costurei/i },
  { id: "silk",           label: "Silk",           sing: "silkeiro",  plural: "silkeiros",   pattern: /silk|serigraf/i },
  { id: "colagem",        label: "Colagem",        sing: "colador",   plural: "coladores",   pattern: /colagem|colador/i },
  { id: "montagem",       label: "Montadores",     sing: "montador",  plural: "montadores",  pattern: /montagem|montador/i },
  { id: "solagem",        label: "Soladores",      sing: "solador",   plural: "soladores",   pattern: /solagem|solador/i },
  { id: "acabamento",     label: "Acabamento",     sing: "acabador",  plural: "acabadores",  pattern: /acabamento|acabador/i },
  { id: "expedicao",      label: "Expedição",      sing: "expedidor", plural: "expedidores", pattern: /expedi/i },
];
type ChamadaView = "dia" | "semana";
type PeriodMode = "hoje" | "semana" | "q1" | "q2" | "mes" | "custom";

/** Tamanhos de ficha (pares por ficha). */
const SIZES = [12, 15, 18] as const;
type SizeMap = Record<number, number>; // tamanho -> pares
/** Dificuldade do par — paga R$/par diferente. */
type Diff = "medio" | "dificil";
const DIFFS: Diff[] = ["medio", "dificil"];
const DIFF_LABEL: Record<Diff, string> = { medio: "Médio", dificil: "Difícil" };
/** Pares por tamanho, separados por dificuldade. */
type DiffSizeMap = { medio: SizeMap; dificil: SizeMap };

// detalhe: modelo NOVO = [{tamanho, medio, dificil}]; LEGADO = [{tamanho, pares}]
// (lido como tudo em MÉDIO).
interface DetItem { tamanho: number; pares?: number; medio?: number; dificil?: number; }

interface Ficha {
  id: string;
  dia: string;
  montador: string | null;
  montador_id: string | null;
  referencia: string | null;
  reference_id: string | null;
  solado: string | null;       // LEGADO
  solado_id: string | null;    // LEGADO
  cor: string | null;
  grade: Grade;
  numeracoes: string[];
  quantidades: string[];
  total: number;               // PARES (modelo chamada) / pares da grade (legado)
  copias: number;
  valor_par: number | null;    // LEGADO = taxa base (== médio)
  valor_par_medio?: number | null;   // R$/par MÉDIO
  valor_par_dificil?: number | null; // R$/par DIFÍCIL
  fichas_dia?: number | null;  // modelo 'chamada' = qtd de fichas
  detalhe?: DetItem[] | null;  // [{tamanho, medio, dificil}]
  origem?: string | null;      // 'chamada' | 'legacy'
  criado_em?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const isoOf = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDia = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paresDaFicha = (f: { total: number; copias: number }) => (Number(f.total) || 0) * Math.max(1, Number(f.copias) || 1);
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// É um registro do modelo novo (produção diária)?
const isChamada = (f: Ficha) =>
  f.origem === "chamada" || (f.origem == null && Array.isArray(f.numeracoes) && f.numeracoes.length === 0);

const emptySizeMap = (): SizeMap => ({ 12: 0, 15: 0, 18: 0 });
const emptyDiffMap = (): DiffSizeMap => ({ medio: emptySizeMap(), dificil: emptySizeMap() });

// detalhe -> pares por tamanho SEPARADOS por dificuldade. Lê o modelo novo
// ({tamanho, medio, dificil}) e o legado ({tamanho, pares} = tudo MÉDIO);
// fallback p/ linhas sem detalhe = total como pares de ficha 12, em MÉDIO.
function diffSizeMapOf(f: Ficha): DiffSizeMap {
  const dm = emptyDiffMap();
  if (Array.isArray(f.detalhe) && f.detalhe.length) {
    for (const d of f.detalhe) {
      const t = Number(d.tamanho); if (!t) continue;
      if (d.medio != null || d.dificil != null) {
        dm.medio[t] = (dm.medio[t] || 0) + (Number(d.medio) || 0);
        dm.dificil[t] = (dm.dificil[t] || 0) + (Number(d.dificil) || 0);
      } else {
        // legado: {tamanho, pares} = tudo médio
        dm.medio[t] = (dm.medio[t] || 0) + (Number(d.pares) || 0);
      }
    }
    return dm;
  }
  const tot = Number(f.total) || 0;
  if (tot > 0) dm.medio[12] = tot;
  return dm;
}
// pares por tamanho COMBINADO (médio + difícil) — usado onde a dificuldade não importa.
function sizeMapOf(f: Ficha): SizeMap {
  const dm = diffSizeMapOf(f);
  const m = emptySizeMap();
  for (const sz of SIZES) m[sz] = (dm.medio[sz] || 0) + (dm.dificil[sz] || 0);
  return m;
}
const paresOfMap = (m: SizeMap) => SIZES.reduce((s, sz) => s + (m[sz] || 0), 0);
const fichasOfMap = (m: SizeMap) => SIZES.reduce((s, sz) => s + Math.round((m[sz] || 0) / sz), 0);
// pares totais por dificuldade (Produtividade / Fichas salvas).
function paresDiffOf(f: Ficha): { medio: number; dificil: number; total: number } {
  const dm = diffSizeMapOf(f);
  const medio = paresOfMap(dm.medio), dificil = paresOfMap(dm.dificil);
  return { medio, dificil, total: medio + dificil };
}
// Fichas (lotes) = Σ round((médio+difícil)/tamanho). Independe da dificuldade —
// deriva do detalhe (linhas antigas caem no fallback), ignorando fichas_dia defasado.
const fichasDiaOf = (f: Ficha) => fichasOfMap(sizeMapOf(f));
const paresOfFicha = (f: Ficha) => Number(f.total) || 0;
// helpers de DiffSizeMap (estado do lançamento)
const paresOfDiffMap = (dm: DiffSizeMap) => paresOfMap(dm.medio) + paresOfMap(dm.dificil);
const fichasOfDiffMap = (dm: DiffSizeMap) => SIZES.reduce((s, sz) => s + Math.round(((dm.medio[sz] || 0) + (dm.dificil[sz] || 0)) / sz), 0);

const WD_FULL = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const WD_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const weekdayName = (iso: string) => WD_FULL[(new Date(iso + "T00:00:00").getDay() + 6) % 7] || "";
function mondayOf(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}
function weekDaysOf(iso: string) {
  const mon = mondayOf(iso);
  return Array.from({ length: 5 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return isoOf(x); });
}
// Dias corridos (ISO) de um intervalo [from,to] inclusivo — base do calendário.
const WD_SHORT7 = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dowIdx = (iso: string) => (new Date(iso + "T00:00:00").getDay() + 6) % 7; // 0=Seg … 6=Dom
function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  let d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let g = 0; d <= end && g < 400; g++) { out.push(isoOf(d)); d = new Date(d.getTime() + 86400000); }
  return out;
}

/** Intervalo {from,to} (ISO) do período (Produtividade + Fichas). */
function periodRange(mode: PeriodMode, cFrom: string, cTo: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  switch (mode) {
    case "hoje": { const t = todayISO(); return { from: t, to: t }; }
    case "semana": {
      const dow = (now.getDay() + 6) % 7;
      return { from: isoOf(new Date(y, m, now.getDate() - dow)), to: isoOf(new Date(y, m, now.getDate() - dow + 6)) };
    }
    case "q1": return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-15` };
    case "q2": return { from: `${y}-${pad(m + 1)}-16`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
    case "mes": return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
    case "custom": return { from: cFrom, to: cTo };
  }
}
const periodLabel: Record<PeriodMode, string> = {
  hoje: "Hoje", semana: "Esta semana", q1: "1ª quinzena", q2: "2ª quinzena", mes: "Mês", custom: "Personalizado",
};

/* ---------- Impressão do RELATÓRIO de produtividade (A4 retrato) ---------- */
function openPrint(html: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita pop-ups neste site para imprimir."); return; }
  w.document.write(html); w.document.close();
}
function imprimirRelatorio(rows: AggRow[], label: string, intervalo: string, totals: AggTotals) {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111}
    h1{font-size:18px;margin:0 0 2px} .sub{font-size:11px;color:#555;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #333;padding:6px 8px}
    th{background:#f1f0ed;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#444}
    td.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:800;background:#f6f5f2}
    .med{color:#b45309} .dif{color:#c81e2e}
    @page{size:A4 portrait;margin:12mm}`;
  const body = rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.nome)}</td><td class="n">${r.fichas}</td>`
    + `<td class="n med">${r.paresMedio}</td><td class="n med">${fmtBRL(r.valorMedio)}</td>`
    + `<td class="n dif">${r.paresDificil}</td><td class="n dif">${fmtBRL(r.valorDificil)}</td>`
    + `<td class="n">${r.pares}</td><td class="n">${fmtBRL(r.pago)}</td></tr>`).join("");
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Produtividade — Montadores</title><style>${css}</style></head><body>
    <h1>Produtividade dos Montadores</h1>
    <div class="sub">${esc(label)} · ${esc(intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <table><thead><tr><th>Montador</th><th style="text-align:right">Fichas</th>
      <th style="text-align:right" class="med">Pares méd</th><th style="text-align:right" class="med">R$/par méd</th>
      <th style="text-align:right" class="dif">Pares dif</th><th style="text-align:right" class="dif">R$/par dif</th>
      <th style="text-align:right">Pares</th><th style="text-align:right">Pagamento</th></tr></thead>
    <tbody>${body || '<tr><td colspan="8" style="text-align:center;color:#888">Sem dados no período.</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL (${rows.length} montador${rows.length === 1 ? "" : "es"})</td><td class="n">${totals.fichas}</td>
      <td class="n med">${totals.medio}</td><td class="n"></td>
      <td class="n dif">${totals.dificil}</td><td class="n"></td>
      <td class="n">${totals.pares}</td><td class="n">${fmtBRL(totals.pago)}</td></tr></tfoot></table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

/* ---------- Impressão do CALENDÁRIO de produção (montador × dia, A4 paisagem) ---------- */
interface CalCell { pares: number; medio: number; dificil: number; fichas: number; }
interface CalRow {
  key: string; nome: string; cells: Record<string, CalCell>;
  medio: number; dificil: number; pares: number; fichas: number; pago: number;
}
function imprimirCalendario(p: { rows: CalRow[]; days: string[]; setorLabel: string; periodo: string; intervalo: string }) {
  const { rows, days } = p;
  const nf = (n: number) => (Number(n) || 0).toLocaleString("pt-BR");
  const dayHead = days.map((d) => {
    const we = dowIdx(d) >= 5;
    return `<th class="day${we ? " we" : ""}">${WD_SHORT7[dowIdx(d)]}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`;
  }).join("");
  const body = rows.map((r) => {
    const cells = days.map((d) => {
      const c = r.cells[d]; const we = dowIdx(d) >= 5;
      if (!c || c.pares <= 0) return `<td class="c${we ? " we" : ""}">·</td>`;
      const sp = [c.medio > 0 ? `<span class="med">${c.medio}</span>` : "", c.dificil > 0 ? `<span class="dif">${c.dificil}</span>` : ""].filter(Boolean).join("<span class='x'>·</span>");
      return `<td class="c has${we ? " we" : ""}"><b>${c.pares}</b><div class="sp">${sp}</div></td>`;
    }).join("");
    return `<tr><td class="mont">${esc(r.nome)}</td>${cells}`
      + `<td class="n med">${r.medio || "—"}</td><td class="n dif">${r.dificil || "—"}</td>`
      + `<td class="n b">${nf(r.pares)}</td><td class="n f">${r.fichas}</td><td class="n pg">${fmtBRL(r.pago)}</td></tr>`;
  }).join("");
  const dayTot = days.map((d) => {
    const s = rows.reduce((a, r) => a + (r.cells[d]?.pares || 0), 0);
    return `<td class="c${dowIdx(d) >= 5 ? " we" : ""}">${s || ""}</td>`;
  }).join("");
  const tMed = rows.reduce((s, r) => s + r.medio, 0), tDif = rows.reduce((s, r) => s + r.dificil, 0);
  const tPar = rows.reduce((s, r) => s + r.pares, 0), tFic = rows.reduce((s, r) => s + r.fichas, 0);
  const tPag = rows.reduce((s, r) => s + r.pago, 0);
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:16px;margin:0 0 2px} .sub{font-size:10px;color:#555;margin-bottom:10px}
    .lg{font-size:9px;color:#555;margin:2px 0 10px} .lg b.med{color:#b45309} .lg b.dif{color:#c81e2e}
    table{width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed}
    th,td{border:1px solid #bbb;padding:2px 3px;text-align:center;overflow:hidden}
    th{background:#f1f0ed;font-size:8px;text-transform:uppercase;color:#444}
    th.day{width:22px;line-height:1.05} th.day.we,td.c.we{background:#f4f2ee}
    td.mont,th.mont{text-align:left;font-weight:700;white-space:nowrap;width:96px;background:#fafafa}
    td.c{color:#bbb} td.c.has{color:#111} td.c b{font-size:9px;font-weight:800} td.c .sp{font-size:6.5px;line-height:1}
    td.c .med{color:#b45309;font-weight:700} td.c .dif{color:#c81e2e;font-weight:700} td.c .x{color:#bbb;margin:0 1px}
    td.n{text-align:right;font-variant-numeric:tabular-nums;width:34px} td.n.med{color:#b45309;font-weight:700} td.n.dif{color:#c81e2e;font-weight:700}
    td.n.b{font-weight:800} td.n.pg{font-weight:800;width:56px} td.n.f{color:#c81e2e;font-weight:700;width:28px}
    th.sum{background:#e9e7e2}
    tfoot td{font-weight:800;background:#f6f5f2} tfoot td.c{color:#111}
    @page{size:A4 landscape;margin:8mm}`;
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Calendário — ${esc(p.setorLabel)}</title><style>${css}</style></head><body>
    <h1>Calendário de Produção — ${esc(p.setorLabel)}</h1>
    <div class="sub">${esc(p.periodo)} · ${esc(p.intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <div class="lg">Cada célula = <b>pares do dia</b>; embaixo o split <b class="med">médio</b> · <b class="dif">difícil</b>. Colunas cinza = fim de semana.</div>
    <table>
      <thead><tr><th class="mont">Montador</th>${dayHead}<th class="sum">Méd</th><th class="sum">Dif</th><th class="sum">Pares</th><th class="sum">Fichas</th><th class="sum">Pagto</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${days.length + 6}" style="text-align:center;color:#888;padding:12px">Sem lançamentos no período.</td></tr>`}</tbody>
      <tfoot><tr><td class="mont">TOTAL (${rows.length})</td>${dayTot}<td class="n med">${nf(tMed)}</td><td class="n dif">${nf(tDif)}</td><td class="n b">${nf(tPar)}</td><td class="n f">${tFic}</td><td class="n pg">${fmtBRL(tPag)}</td></tr></tfoot>
    </table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

interface AggRow {
  key: string; nome: string; fichas: number;
  paresMedio: number; paresDificil: number; pares: number;
  valorMedio: number; valorDificil: number; pago: number;
}
interface AggTotals { fichas: number; pares: number; pago: number; medio: number; dificil: number; pagoMedio: number; pagoDificil: number; }

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  const db = supabase as any;
  const [tab, setTab] = useState<Tab>("lancamento");
  // Setor ativo (Montadores / Soladores / …) — abas independentes na mesma tela.
  const [setor, setSetor] = useState<Setor>("montagem");
  const cfgSetor = useMemo(() => SETORES.find((s) => s.id === setor) ?? SETORES[0], [setor]);

  // ── chamada do dia / semana ──
  const [chamadaView, setChamadaView] = useState<ChamadaView>("dia");
  const [chamadaDia, setChamadaDia] = useState(todayISO());
  const [semanaAnchor, setSemanaAnchor] = useState(todayISO());
  const [semSize, setSemSize] = useState<number>(12);
  const [semDiff, setSemDiff] = useState<Diff>("medio"); // dificuldade ativa na matriz semanal
  const [busca, setBusca] = useState("");
  // Dia: pares por montador por dificuldade × tamanho
  const [pares, setPares] = useState<Record<string, DiffSizeMap>>({});
  const [origPares, setOrigPares] = useState<Record<string, DiffSizeMap>>({});
  // Semana: pares por (montador|dia) por dificuldade × tamanho
  const [week, setWeek] = useState<Record<string, DiffSizeMap>>({});
  const [origWeek, setOrigWeek] = useState<Record<string, DiffSizeMap>>({});
  const [savingDia, setSavingDia] = useState(false);
  const [savingSem, setSavingSem] = useState(false);

  // ── dados ──
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: employees = [] } = useEmployees();
  // Trabalhadores do SETOR ativo (montadores p/ montagem, soladores p/ solagem…).
  const montadores = useMemo(
    () => [...(employees as any[])]
      .filter((e) => e.active && cfgSetor.pattern.test(`${e.role || ""} ${e.department || ""}`))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [employees, cfgSetor],
  );

  const carregar = useCallback(async () => {
    setLoading(true);
    // Escopo por SETOR — cada aba (Montadores/Soladores) lê só os seus dados.
    const { data, error } = await db.from("ficha_montadores").select("*").eq("setor", setor).order("dia", { ascending: false }).order("criado_em", { ascending: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    else setFichas((data ?? []) as Ficha[]);
    setLoading(false);
  }, [db, setor]);
  useEffect(() => { carregar(); }, [carregar]);

  // Semeia a contagem do dia a partir do banco.
  useEffect(() => {
    const p: Record<string, DiffSizeMap> = {};
    for (const f of fichas) {
      if (!isChamada(f) || !f.montador_id || f.dia !== chamadaDia) continue;
      p[f.montador_id] = diffSizeMapOf(f);
    }
    setPares(p); setOrigPares(p);
  }, [fichas, chamadaDia]);

  // Semeia a matriz da semana.
  useEffect(() => {
    const days = weekDaysOf(semanaAnchor);
    const w: Record<string, DiffSizeMap> = {};
    for (const f of fichas) {
      if (!isChamada(f) || !f.montador_id) continue;
      if (days.includes(f.dia)) w[`${f.montador_id}|${f.dia}`] = diffSizeMapOf(f);
    }
    setWeek(w); setOrigWeek(w);
  }, [fichas, semanaAnchor]);

  // ── helpers Dia ──
  const mapOf = (mid: string): DiffSizeMap => pares[mid] || emptyDiffMap();
  const setPS = (mid: string, diff: Diff, sz: number, v: number) =>
    setPares((p) => {
      const cur = p[mid] || emptyDiffMap();
      return { ...p, [mid]: { ...cur, [diff]: { ...cur[diff], [sz]: Math.max(0, v) } } };
    });
  const paresMontador = (mid: string) => paresOfDiffMap(mapOf(mid));
  const fichasMontador = (mid: string) => fichasOfDiffMap(mapOf(mid));

  // ── helpers Semana ──
  const weekMap = (mid: string, day: string): DiffSizeMap => week[`${mid}|${day}`] || emptyDiffMap();
  const setWeekCell = (mid: string, day: string, diff: Diff, sz: number, v: number) =>
    setWeek((w) => {
      const k = `${mid}|${day}`; const cur = w[k] || emptyDiffMap();
      return { ...w, [k]: { ...cur, [diff]: { ...cur[diff], [sz]: Math.max(0, v) } } };
    });

  const rosterFiltrado = useMemo(
    () => montadores.filter((e) => searchMatchesAllTerms(busca, e.name, e.role, e.department, e.external_id)),
    [montadores, busca],
  );

  const totalDiaPares = useMemo(() => montadores.reduce((s, e) => s + paresMontador(e.id), 0), [montadores, pares]);
  const totalDiaFichas = useMemo(() => montadores.reduce((s, e) => s + fichasMontador(e.id), 0), [montadores, pares]);
  const dirtyDia = useMemo(
    () => montadores.filter((e) => JSON.stringify(mapOf(e.id)) !== JSON.stringify(origPares[e.id] || emptyDiffMap())).length,
    [montadores, pares, origPares],
  );

  const weekDays = useMemo(() => weekDaysOf(semanaAnchor), [semanaAnchor]);
  const weekLabel = `${fmtDia(weekDays[0])} – ${fmtDia(weekDays[4])}`;
  const semParesTotal = useMemo(() => Object.values(week).reduce((s, m) => s + paresOfDiffMap(m), 0), [week]);
  const semFichasTotal = useMemo(() => Object.values(week).reduce((s, m) => s + fichasOfDiffMap(m), 0), [week]);

  const fichasHoje = useMemo(() => {
    const t = todayISO();
    return fichas.filter((f) => isChamada(f) && f.dia === t).reduce((s, f) => s + fichasDiaOf(f), 0);
  }, [fichas]);

  // Persiste 1 montador num dia a partir do mapa de pares por tamanho.
  async function persistChamada(dia: string, e: { id: string; name: string }, dm: DiffSizeMap): Promise<string | null> {
    const existing = fichas.find((f) => isChamada(f) && f.montador_id === e.id && f.dia === dia);
    const totalP = paresOfDiffMap(dm);
    if (totalP <= 0) {
      if (!existing) return null;
      const { error } = await db.from("ficha_montadores").delete().eq("id", existing.id);
      return error ? error.message : null;
    }
    const det: DetItem[] = SIZES
      .filter((sz) => (dm.medio[sz] || 0) > 0 || (dm.dificil[sz] || 0) > 0)
      .map((sz) => ({ tamanho: sz, medio: dm.medio[sz] || 0, dificil: dm.dificil[sz] || 0 }));
    const fichasCount = det.reduce((s, d) => s + Math.round(((d.medio || 0) + (d.dificil || 0)) / d.tamanho), 0);
    // SNAPSHOT do R$/par: fonte única = cadastro do funcionário (payment_type='producao').
    // Congela o valor da época em cada apontamento — reajustar o cadastro não reescreve
    // folha passada. Não-producao (ou sem valor cadastrado) mantém o valor existente da
    // linha (fluxo legado da aba Produtividade via persistRateMontador).
    const emp = (employees as any[]).find((x) => x.id === e.id);
    const isProducao = String(emp?.payment_type || "").toLowerCase() === "producao";
    const vmCad = Number(emp?.valor_par_medio) || 0;
    const vdCad = Number(emp?.valor_par_dificil) || 0;
    const vmSnap = isProducao && vmCad > 0 ? vmCad : (existing?.valor_par_medio ?? existing?.valor_par ?? null);
    const vdSnap = isProducao && vdCad > 0 ? vdCad : (existing?.valor_par_dificil ?? null);
    const payload: any = {
      dia, montador: e.name, montador_id: e.id, setor,
      fichas_dia: fichasCount, total: totalP, copias: 1, grade: "adulto", numeracoes: [], quantidades: [],
      cor: null, referencia: null, reference_id: null, detalhe: det, origem: "chamada",
      valor_par_medio: vmSnap, valor_par_dificil: vdSnap,
      valor_par: (isProducao && vmCad > 0) ? vmCad : (existing?.valor_par ?? 0),
      atualizado_em: new Date().toISOString(),
    };
    const write = (pl: any) => existing
      ? db.from("ficha_montadores").update(pl).eq("id", existing.id)
      : db.from("ficha_montadores").insert(pl);
    let { error } = await write(payload);
    if (error && /column|could not find/i.test(error.message || "")) {
      const msg = (error.message || "").toLowerCase();
      const retry: any = { ...payload };
      if (msg.includes("fichas_dia")) delete retry.fichas_dia;
      if (msg.includes("detalhe")) delete retry.detalhe;
      if (msg.includes("origem")) delete retry.origem;
      if (msg.includes("setor")) delete retry.setor;
      if (msg.includes("valor_par_medio")) delete retry.valor_par_medio;
      if (msg.includes("valor_par_dificil")) delete retry.valor_par_dificil;
      ({ error } = await write(retry));
    }
    return error ? error.message : null;
  }

  async function salvarDia() {
    setSavingDia(true);
    const changed = montadores.filter((e) => JSON.stringify(mapOf(e.id)) !== JSON.stringify(origPares[e.id] || emptyDiffMap()));
    let ok = 0; const erros: string[] = [];
    for (const e of changed) {
      const err = await persistChamada(chamadaDia, e, mapOf(e.id));
      if (err) erros.push(e.name); else ok++;
    }
    await carregar();
    setSavingDia(false);
    if (erros.length) toast.error(`Falha em ${erros.length}: ${erros.join(", ")}`);
    if (ok) toast.success(`Dia salvo — ${ok} montador${ok === 1 ? "" : "es"}.`);
    if (!ok && !erros.length) toast.message("Nada para salvar.");
  }

  async function salvarSemana() {
    setSavingSem(true);
    let ok = 0, err = 0;
    for (const e of montadores) {
      for (const day of weekDays) {
        const k = `${e.id}|${day}`;
        if (JSON.stringify(week[k] || emptyDiffMap()) === JSON.stringify(origWeek[k] || emptyDiffMap())) continue;
        const m = await persistChamada(day, e, week[k] || emptyDiffMap());
        if (m) err++; else ok++;
      }
    }
    await carregar();
    setSavingSem(false);
    if (err) toast.error(`Falha em ${err} célula(s).`);
    if (ok) toast.success(`Semana salva — ${ok} lançamento${ok === 1 ? "" : "s"}.`);
    if (!ok && !err) toast.message("Nada para salvar.");
  }

  function zerarDia() { setPares({}); }
  function zerarSemana() { setWeek((w) => { const n: Record<string, DiffSizeMap> = {}; for (const k in w) n[k] = emptyDiffMap(); return n; }); }
  function abrirDia(f: Ficha) {
    setTab("lancamento"); setChamadaView("dia"); setChamadaDia(f.dia);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function excluir(f: Ficha) {
    if (!window.confirm("Excluir este lançamento?")) return;
    const { error } = await db.from("ficha_montadores").delete().eq("id", f.id);
    if (error) toast.error("Erro ao excluir: " + error.message);
    else await carregar();
  }
  // Grava a taxa (R$/par) de UMA dificuldade em TODAS as fichas do montador.
  async function persistRateMontador(key: string, diff: Diff, valor: number) {
    if (key.startsWith("txt:")) return;
    const col = diff === "medio" ? "valor_par_medio" : "valor_par_dificil";
    const patch: any = { [col]: valor };
    if (diff === "medio") patch.valor_par = valor; // mantém a coluna legada sincronizada
    let { error } = await db.from("ficha_montadores").update(patch).eq("montador_id", key);
    if (error && /column|could not find/i.test(error.message || "")) {
      // migration ainda não aplicada — cai na coluna legada (só médio).
      ({ error } = await db.from("ficha_montadores").update({ valor_par: valor }).eq("montador_id", key));
    }
    if (error) { toast.error("Erro ao salvar valor/par: " + error.message); return; }
    setFichas((fs) => fs.map((f) => (f.montador_id === key
      ? { ...f, [col]: valor, ...(diff === "medio" ? { valor_par: valor } : {}) } : f)));
  }

  // ── valor/par por montador × dificuldade (Produtividade) ──
  const aggKeyOf = (f: { montador_id?: string | null; montador?: string | null }) =>
    f.montador_id || `txt:${(f.montador || "—").toLowerCase()}`;
  const seedValores = useMemo(() => {
    const med: Record<string, number> = {}, dif: Record<string, number> = {};
    for (const f of fichas) {
      const key = aggKeyOf(f);
      const vm = Number(f.valor_par_medio ?? f.valor_par) || 0; // médio = base histórica
      const vd = Number(f.valor_par_dificil) || 0;
      if (vm > (med[key] || 0)) med[key] = vm;
      if (vd > (dif[key] || 0)) dif[key] = vd;
    }
    return { med, dif };
  }, [fichas]);
  const [valorMedioPor, setValorMedioPor] = useState<Record<string, number>>({});
  const [valorDificilPor, setValorDificilPor] = useState<Record<string, number>>({});
  useEffect(() => {
    const merge = (prev: Record<string, number>, seed: Record<string, number>) => {
      let changed = false; const next = { ...prev };
      for (const k in seed) { if (next[k] == null) { next[k] = seed[k]; changed = true; } }
      return changed ? next : prev;
    };
    setValorMedioPor((p) => merge(p, seedValores.med));
    setValorDificilPor((p) => merge(p, seedValores.dif));
  }, [seedValores]);

  // ── filtro de período (Produtividade + Fichas) ──
  const [pMode, setPMode] = useState<PeriodMode>("q1");
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [filtroMontador, setFiltroMontador] = useState<string>("__all__");
  const range = useMemo(() => periodRange(pMode, cFrom, cTo), [pMode, cFrom, cTo]);

  const fichasFiltradas = useMemo(
    () => fichas.filter((f) => f.dia >= range.from && f.dia <= range.to && (filtroMontador === "__all__" || f.montador_id === filtroMontador)),
    [fichas, range, filtroMontador],
  );

  // Referências + cores produzidas pelo setor no período (derivado das OPs) —
  // só carrega na aba Relatórios.
  const { data: refsProduzidas = [], isLoading: refsLoading } =
    useReferenciasProduzidas(setor, range.from, range.to, tab === "fichas");
  // Roster do relatório de pagamento respeita o filtro de montador da barra.
  const montadoresRelatorio = useMemo(
    () => (filtroMontador === "__all__" ? montadores : montadores.filter((e) => e.id === filtroMontador)),
    [montadores, filtroMontador],
  );

  const agg = useMemo<AggRow[]>(() => {
    const m = new Map<string, AggRow>();
    for (const f of fichasFiltradas) {
      const key = aggKeyOf(f);
      const fichasContrib = isChamada(f) ? fichasDiaOf(f) : 1; // chamada = nº de fichas; legado = 1 ficha/linha
      let pMed: number, pDif: number;
      if (isChamada(f)) { const pd = paresDiffOf(f); pMed = pd.medio; pDif = pd.dificil; }
      else { pMed = paresDaFicha(f); pDif = 0; } // legado não tinha dificuldade → tudo médio
      const cur = m.get(key) || { key, nome: f.montador || "(sem montador)", fichas: 0, paresMedio: 0, paresDificil: 0, pares: 0, valorMedio: 0, valorDificil: 0, pago: 0 };
      cur.fichas += fichasContrib; cur.paresMedio += pMed; cur.paresDificil += pDif; cur.pares += pMed + pDif;
      m.set(key, cur);
    }
    const rows = Array.from(m.values());
    for (const r of rows) {
      r.valorMedio = valorMedioPor[r.key] ?? 0;
      r.valorDificil = valorDificilPor[r.key] ?? 0;
      r.pago = r.paresMedio * r.valorMedio + r.paresDificil * r.valorDificil;
    }
    return rows.sort((a, b) => b.pares - a.pares);
  }, [fichasFiltradas, valorMedioPor, valorDificilPor]);
  const totals = useMemo<AggTotals>(
    () => agg.reduce((s, r) => ({
      fichas: s.fichas + r.fichas, pares: s.pares + r.pares, pago: s.pago + r.pago,
      medio: s.medio + r.paresMedio, dificil: s.dificil + r.paresDificil,
      pagoMedio: s.pagoMedio + r.paresMedio * r.valorMedio,
      pagoDificil: s.pagoDificil + r.paresDificil * r.valorDificil,
    }), { fichas: 0, pares: 0, pago: 0, medio: 0, dificil: 0, pagoMedio: 0, pagoDificil: 0 }),
    [agg],
  );

  const grupos = useMemo(() => {
    const m = new Map<string, Ficha[]>();
    for (const f of fichasFiltradas) { if (!m.has(f.dia)) m.set(f.dia, []); m.get(f.dia)!.push(f); }
    return Array.from(m.entries());
  }, [fichasFiltradas]);

  // Gera o CALENDÁRIO de produção (montador × dia) em PDF — o que cada montador
  // fez em cada dia do período, com o split médio/difícil e o pagamento.
  function gerarCalendario() {
    const days = daysInRange(range.from, range.to);
    if (!days.length) { toast.error("Selecione um período válido."); return; }
    const map = new Map<string, CalRow>();
    for (const f of fichasFiltradas) {
      const key = aggKeyOf(f);
      const pd = isChamada(f) ? paresDiffOf(f) : { medio: paresDaFicha(f), dificil: 0, total: paresDaFicha(f) };
      const fich = isChamada(f) ? fichasDiaOf(f) : 1;
      let r = map.get(key);
      if (!r) { r = { key, nome: f.montador || "(sem montador)", cells: {}, medio: 0, dificil: 0, pares: 0, fichas: 0, pago: 0 }; map.set(key, r); }
      const c = r.cells[f.dia] || { pares: 0, medio: 0, dificil: 0, fichas: 0 };
      c.pares += pd.total; c.medio += pd.medio; c.dificil += pd.dificil; c.fichas += fich;
      r.cells[f.dia] = c;
      r.pares += pd.total; r.medio += pd.medio; r.dificil += pd.dificil; r.fichas += fich;
    }
    const rows = Array.from(map.values())
      .map((r) => ({ ...r, pago: r.medio * (valorMedioPor[r.key] ?? 0) + r.dificil * (valorDificilPor[r.key] ?? 0) }))
      .sort((a, b) => b.pares - a.pares);
    if (!rows.length) { toast.error("Sem lançamentos no período pra gerar o calendário."); return; }
    imprimirCalendario({ rows, days, setorLabel: cfgSetor.label, periodo: periodLabel[pMode], intervalo: `${fmtDia(range.from)} a ${fmtDia(range.to)}` });
  }

  const lbl = "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";
  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "lancamento", label: "Chamada do dia", icon: ClipboardText },
    { id: "produtividade", label: "Produtividade", icon: ChartBar },
    { id: "fichas", label: "Relatórios", icon: ListChecks },
  ];

  // estilo dos inputs de pares por dificuldade (Médio âmbar · Difícil vermelho)
  const cellM = "h-9 w-14 rounded-md border border-amber-500/40 bg-amber-500/5 text-center text-sm font-bold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-amber-600";
  const cellD = "h-9 w-14 rounded-md border border-red-500/40 bg-red-500/5 text-center text-sm font-bold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-red-600";
  const numOf = (s: string) => parseInt(s.replace(/[^\d]/g, "")) || 0;

  return (
    <div className="w-full space-y-6">
      <EditorialPageHeader
        sectionLabel={`PRODUÇÃO · ${cfgSetor.label.toUpperCase()}`}
        title={`Ficha de ${cfgSetor.label}`}
        description="Lance os PARES produzidos por tamanho de ficha (12 / 15 / 18). O sistema calcula a quantidade de fichas."
        meta={<><span className="font-bold">{montadores.length}</span> {(montadores.length === 1 ? cfgSetor.sing : cfgSetor.plural).toUpperCase()} · <span className="font-bold">{fichasHoje}</span> FICHA{fichasHoje === 1 ? "" : "S"} HOJE</>}
      />

      {/* Setor — abas INDEPENDENTES (Montadores / Soladores). Mesma dinâmica;
          dados e relatórios separados por ficha_montadores.setor. */}
      <div className="flex overflow-hidden rounded-lg border border-border w-fit">
        {SETORES.map((s) => (
          <button key={s.id} type="button" onClick={() => setSetor(s.id)}
            className={`px-5 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${setor === s.id ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* abas */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ════ CHAMADA DO DIA ════ */}
      {tab === "lancamento" && (
        <div className="space-y-4">
          {/* controles */}
          <div className="flex flex-wrap items-end gap-3">
            {chamadaView === "dia" ? (
              <div>
                <label className={lbl}>Data</label>
                <Input type="date" value={chamadaDia} onChange={(e) => setChamadaDia(e.target.value)} className="h-9 w-44" />
              </div>
            ) : (
              <div>
                <label className={lbl}>Semana</label>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setSemanaAnchor((a) => isoOf(new Date(new Date(a + "T00:00:00").getTime() - 7 * 864e5)))} aria-label="Semana anterior"><CaretLeft className="h-4 w-4" /></Button>
                  <div className="h-9 inline-flex items-center rounded-md border border-border bg-card px-3 text-sm font-medium tabular-nums">{weekLabel}</div>
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setSemanaAnchor((a) => isoOf(new Date(new Date(a + "T00:00:00").getTime() + 7 * 864e5)))} aria-label="Próxima semana"><CaretRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
            <div className="min-w-[180px] flex-1">
              <label className={lbl}>Buscar</label>
              <SearchInput
                value={busca}
                onChange={setBusca}
                placeholder="Buscar por nome, cargo, setor ou matrícula…"
                resultCount={rosterFiltrado.length}
                totalCount={montadores.length}
                inputClassName="h-9"
              />
            </div>
            <div className="ml-auto flex overflow-hidden rounded-md border border-border">
              {(["dia", "semana"] as ChamadaView[]).map((v) => (
                <button key={v} type="button" onClick={() => setChamadaView(v)}
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${chamadaView === v ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{v}</button>
              ))}
            </div>
          </div>

          {montadores.length === 0 ? (
            <Panel>
              <EmptyState icon={Users} title={`Nenhum ${cfgSetor.sing} cadastrado`}
                description={`Defina funcionários com cargo ou setor "${cfgSetor.id.charAt(0).toUpperCase()}${cfgSetor.id.slice(1)}" em Funcionários para lançar a produção.`} />
            </Panel>
          ) : chamadaView === "dia" ? (
            <Panel
              flush
              eyebrow="CONTAGEM DO DIA"
              title={`${weekdayName(chamadaDia)} · ${fmtDia(chamadaDia)}`}
              subtitle="Pares por tamanho (12/15/18) e por dificuldade — Médio (âmbar) e Difícil (vermelho), que pagam valores diferentes."
              actions={<Button type="button" variant="outline" size="sm" className="h-8" onClick={zerarDia}>Zerar tudo</Button>}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 760 }}>
                  <thead>
                    <tr className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th rowSpan={2} className="px-4 py-2 text-left align-bottom" style={{ minWidth: 180 }}>Montador</th>
                      {SIZES.map((sz) => (
                        <th key={sz} colSpan={2} className="border-l border-border px-1 py-1.5 text-center" style={{ width: 120 }}>{sz}<span className="ml-1 font-mono text-[9px] normal-case text-muted-foreground/70">pares</span></th>
                      ))}
                      <th rowSpan={2} className="border-l border-border px-3 py-2 text-right align-bottom" style={{ width: 64 }}>Pares</th>
                      <th rowSpan={2} className="px-3 py-2 text-right align-bottom text-primary" style={{ width: 58 }}>Fichas</th>
                    </tr>
                    <tr className="border-b-2 border-border/80 bg-muted/40 text-[10px] font-bold uppercase tracking-wide">
                      {SIZES.map((sz) => (
                        <Fragment key={sz}>
                          <th className="border-l border-border px-1 py-1 text-center text-amber-600">Méd</th>
                          <th className="px-1 py-1 text-center text-red-600">Dif</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rosterFiltrado.map((e) => {
                      const dm = mapOf(e.id);
                      const pp = paresOfDiffMap(dm), ff = fichasOfDiffMap(dm);
                      return (
                        <tr key={e.id} className="border-b border-border/50 transition-colors hover:bg-primary/[0.03]" style={{ borderLeft: `2px solid ${pp > 0 ? "hsl(var(--primary))" : "transparent"}` }}>
                          <td className="px-4 py-2">
                            <div className="truncate text-sm font-semibold text-foreground">{e.name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{[e.role, e.department].filter(Boolean).join(" · ") || "Montagem"}</div>
                          </td>
                          {SIZES.map((sz) => (
                            <Fragment key={sz}>
                              <td className="border-l border-border px-1 py-1.5 text-center">
                                <input inputMode="numeric" value={dm.medio[sz] || ""} placeholder="0"
                                  onFocus={(ev) => ev.target.select()}
                                  onChange={(ev) => setPS(e.id, "medio", sz, numOf(ev.target.value))}
                                  className={cellM} aria-label={`Médio · ficha ${sz} — ${e.name}`} />
                              </td>
                              <td className="px-1 py-1.5 text-center">
                                <input inputMode="numeric" value={dm.dificil[sz] || ""} placeholder="0"
                                  onFocus={(ev) => ev.target.select()}
                                  onChange={(ev) => setPS(e.id, "dificil", sz, numOf(ev.target.value))}
                                  className={cellD} aria-label={`Difícil · ficha ${sz} — ${e.name}`} />
                              </td>
                            </Fragment>
                          ))}
                          <td className="border-l border-border px-3 py-2 text-right text-sm font-semibold tabular-nums text-foreground">{pp.toLocaleString("pt-BR")}</td>
                          <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-primary">{ff}</td>
                        </tr>
                      );
                    })}
                    {rosterFiltrado.length === 0 && (
                      <tr><td colSpan={SIZES.length * 2 + 3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Nenhum resultado para "{busca}".
                        <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={() => setBusca("")}>Limpar busca</Button>
                      </td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-foreground bg-muted/30 text-sm font-bold tabular-nums">
                      <td className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground">Total do dia</td>
                      {SIZES.map((sz) => {
                        const colM = rosterFiltrado.reduce((s, e) => s + (mapOf(e.id).medio[sz] || 0), 0);
                        const colD = rosterFiltrado.reduce((s, e) => s + (mapOf(e.id).dificil[sz] || 0), 0);
                        return (
                          <Fragment key={sz}>
                            <td className="border-l border-border px-1 py-2.5 text-center text-amber-600">{colM || ""}</td>
                            <td className="px-1 py-2.5 text-center text-red-600">{colD || ""}</td>
                          </Fragment>
                        );
                      })}
                      <td className="border-l border-border px-3 py-2.5 text-right text-foreground">{totalDiaPares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2.5 text-right text-primary" style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{totalDiaFichas}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3.5">
                <span className="text-[11px] text-muted-foreground">
                  <strong className="text-foreground">{totalDiaPares.toLocaleString("pt-BR")}</strong> pares · <strong className="text-primary">{totalDiaFichas}</strong> fichas
                  {dirtyDia > 0 && <span className="ml-2 font-semibold text-amber-600">● {dirtyDia} alterado{dirtyDia === 1 ? "" : "s"}</span>}
                </span>
                <Button type="button" onClick={salvarDia} disabled={savingDia} className="h-10 gap-2">
                  <FloppyDisk className="h-4 w-4" /> {savingDia ? "Salvando…" : "Salvar o dia"}
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel
              flush
              eyebrow={`SEMANA ${weekLabel}`}
              title="Matriz · Seg a Sex"
              subtitle="Pares por dia. Escolha a dificuldade e o tamanho para preencher — os totais somam as duas."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {DIFFS.map((df) => (
                      <button key={df} type="button" onClick={() => setSemDiff(df)}
                        className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${semDiff === df ? (df === "medio" ? "bg-amber-500 text-white" : "bg-red-600 text-white") : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{DIFF_LABEL[df]}</button>
                    ))}
                  </div>
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {SIZES.map((sz) => (
                      <button key={sz} type="button" onClick={() => setSemSize(sz)}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${semSize === sz ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{sz}</button>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={zerarSemana}>Zerar tudo</Button>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-center">
                  <thead>
                    <tr className="border-b-2 border-border/80 bg-muted/40">
                      <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ minWidth: 150 }}>Montador <span className={`font-mono normal-case ${semDiff === "medio" ? "text-amber-600" : "text-red-600"}`}>· {DIFF_LABEL[semDiff]} de {semSize}</span></th>
                      {weekDays.map((d, i) => (
                        <th key={d} className="px-1 py-2.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" style={{ minWidth: 60 }}>{WD_SHORT[i]} {d.slice(8)}</th>
                      ))}
                      <th className="border-l-2 border-border px-2 py-2.5 text-[11px] font-bold uppercase text-foreground" style={{ width: 90 }}>Pares · Fichas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterFiltrado.map((e) => {
                      const rowPares = weekDays.reduce((s, d) => s + paresOfDiffMap(weekMap(e.id, d)), 0);
                      const rowFichas = weekDays.reduce((s, d) => s + fichasOfDiffMap(weekMap(e.id, d)), 0);
                      return (
                        <tr key={e.id} className="border-b border-border/50">
                          <td className="sticky left-0 z-10 bg-card px-4 py-1.5 text-left"><span className="whitespace-nowrap text-sm font-semibold text-foreground">{e.name}</span></td>
                          {weekDays.map((d) => (
                            <td key={d} className="px-1 py-1">
                              <input inputMode="numeric"
                                value={weekMap(e.id, d)[semDiff][semSize] || ""}
                                placeholder="·"
                                onFocus={(ev) => ev.target.select()}
                                onChange={(ev) => setWeekCell(e.id, d, semDiff, semSize, numOf(ev.target.value))}
                                className={`h-8 w-full rounded border bg-card text-center text-sm font-semibold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 ${semDiff === "medio" ? "border-amber-500/40 focus:border-amber-600" : "border-red-500/40 focus:border-red-600"}`}
                                aria-label={`${e.name} ${fmtDia(d)} — ${DIFF_LABEL[semDiff]} de ${semSize}`} />
                            </td>
                          ))}
                          <td className="border-l-2 border-border px-2 text-center font-mono text-xs font-bold tabular-nums text-foreground whitespace-nowrap">{rowPares.toLocaleString("pt-BR")} · <span className="text-primary">{rowFichas}</span></td>
                        </tr>
                      );
                    })}
                    {rosterFiltrado.length === 0 && (
                      <tr><td colSpan={weekDays.length + 2} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Nenhum resultado para "{busca}".
                        <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={() => setBusca("")}>Limpar busca</Button>
                      </td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-foreground bg-muted/30">
                      <td className="sticky left-0 z-10 bg-muted/30 px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Total {DIFF_LABEL[semDiff]} ({semSize}) / dia</td>
                      {weekDays.map((d) => {
                        const colP = rosterFiltrado.reduce((s, e) => s + (weekMap(e.id, d)[semDiff][semSize] || 0), 0);
                        return <td key={d} className={`font-mono text-sm font-bold tabular-nums ${semDiff === "medio" ? "text-amber-600" : "text-red-600"}`}>{colP || ""}</td>;
                      })}
                      <td className="border-l-2 border-border" />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <span className="text-[11px] text-muted-foreground">Semana {weekLabel} (todos os tamanhos): <strong className="text-foreground">{semParesTotal.toLocaleString("pt-BR")}</strong> pares · <strong className="text-primary">{semFichasTotal}</strong> fichas</span>
                <Button type="button" onClick={salvarSemana} disabled={savingSem} className="h-10 gap-2">
                  <FloppyDisk className="h-4 w-4" /> {savingSem ? "Salvando…" : "Salvar semana"}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ════ filtro de período (Produtividade + Fichas) ════ */}
      {tab !== "lancamento" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(periodLabel) as PeriodMode[]).map((m) => (
              <button key={m} type="button" onClick={() => setPMode(m)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${pMode === m ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:bg-muted/40"}`}>{periodLabel[m]}</button>
            ))}
          </div>
          {pMode === "custom" && (
            <div className="flex items-end gap-2">
              <div><label className={lbl}>De</label><Input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="h-9 w-40" /></div>
              <div><label className={lbl}>Até</label><Input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="h-9 w-40" /></div>
            </div>
          )}
          <div className="min-w-[220px]">
            <label className={lbl}>Montador</label>
            <SearchableSelect
              value={filtroMontador}
              onChange={setFiltroMontador}
              options={[{ value: "__all__", label: "Todos os montadores" }, ...montadores.map((e) => ({ value: e.id, label: e.name, description: [e.role, e.department].filter(Boolean).join(" · ") || undefined }))]}
              placeholder="Todos os montadores"
              searchPlaceholder="Buscar montador..."
              emptyText="Nenhum montador encontrado."
            />
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{fmtDia(range.from)} – {fmtDia(range.to)}</div>
        </div>
      )}

      {/* ════ PRODUTIVIDADE ════ */}
      {tab === "produtividade" && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label="Montadores" value={String(agg.length)} icon={Users} />
            <StatCard label="Fichas" value={totals.fichas.toLocaleString("pt-BR")} icon={ClipboardText} tone="primary" />
            <StatCard label="Pares" value={totals.pares.toLocaleString("pt-BR")} icon={Package}
              hint={`${totals.medio.toLocaleString("pt-BR")} méd · ${totals.dificil.toLocaleString("pt-BR")} dif`} />
            <StatCard label="Pagamento" value={fmtBRL(totals.pago)} icon={CurrencyDollar}
              hint={`méd ${fmtBRL(totals.pagoMedio)} · dif ${fmtBRL(totals.pagoDificil)}`} />
          </StatGrid>

          <Panel
            eyebrow={`${periodLabel[pMode]} · ${fmtDia(range.from)}–${fmtDia(range.to)}`}
            title="Rendimento por montador"
            actions={<Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={agg.length === 0} onClick={() => imprimirRelatorio(agg, periodLabel[pMode], `${fmtDia(range.from)} a ${fmtDia(range.to)}`, totals)}><Printer className="h-4 w-4" /> Imprimir relatório</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" style={{ minWidth: 720 }}>
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-3 py-2">Montador</th>
                    <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Pares méd</th>
                    <th className="px-3 py-2 text-right text-amber-600">R$/par méd</th>
                    <th className="px-3 py-2 text-right text-red-600 border-l border-border">Pares dif</th>
                    <th className="px-3 py-2 text-right text-red-600">R$/par dif</th>
                    <th className="px-3 py-2 text-right border-l border-border">Pares</th>
                    <th className="px-3 py-2 text-right">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Sem lançamentos no período.</td></tr>}
                  {agg.map((r, i) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.nome}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{r.paresMedio.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="ml-auto w-24" onBlur={() => persistRateMontador(r.key, "medio", valorMedioPor[r.key] ?? 0)}>
                          <CurrencyInput value={valorMedioPor[r.key] ?? 0} onChange={(v) => setValorMedioPor((p) => ({ ...p, [r.key]: v }))} className="h-8 text-right" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600 border-l border-border">{r.paresDificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="ml-auto w-24" onBlur={() => persistRateMontador(r.key, "dificil", valorDificilPor[r.key] ?? 0)}>
                          <CurrencyInput value={valorDificilPor[r.key] ?? 0} onChange={(v) => setValorDificilPor((p) => ({ ...p, [r.key]: v }))} className="h-8 text-right" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground border-l border-border">{r.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtBRL(r.pago)}</td>
                    </tr>
                  ))}
                </tbody>
                {agg.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/30">
                      <td className="px-3 py-2" /><td className="px-3 py-2">Total ({agg.length})</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600 border-l border-border">{totals.medio.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums text-red-600 border-l border-border">{totals.dificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums border-l border-border">{totals.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.pago)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ════ RELATÓRIOS (período) ════ */}
      {tab === "fichas" && (
        <div className="space-y-6">
          {/* Pagamento por produção: produzido × já pago × saldo (folha) */}
          <RelatorioPagamentoPanel
            setorLabel={cfgSetor.label}
            range={range}
            periodoLabel={periodLabel[pMode]}
            montadores={montadoresRelatorio as any}
            fichasPeriodo={fichasFiltradas as any}
            refs={refsProduzidas}
          />

          {/* Referências + cores produzidas pelo setor (derivado das OPs) */}
          <ReferenciasProduzidasPanel
            setorLabel={cfgSetor.label}
            range={range}
            refs={refsProduzidas}
            isLoading={refsLoading}
          />

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Produção do período</h2>
            {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
            {!loading && <span className="text-xs text-muted-foreground">{fichasFiltradas.length} lançamento(s)</span>}
            <Button
              type="button" size="sm" className="ml-auto gap-1.5"
              disabled={fichasFiltradas.length === 0}
              onClick={gerarCalendario}
              title="Gera um PDF em calendário: o que cada montador fez em cada dia do período (com médio/difícil e pagamento)."
            >
              <Printer className="h-4 w-4" /> Calendário em PDF
            </Button>
          </div>
          {!loading && fichasFiltradas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum lançamento no período selecionado.</p>
          )}
          <div className="space-y-5">
            {grupos.map(([d, lista]) => {
              const diaFichas = lista.reduce((s, f) => s + (isChamada(f) ? fichasDiaOf(f) : 1), 0);
              const diaPares = lista.reduce((s, f) => s + (isChamada(f) ? paresOfFicha(f) : paresDaFicha(f)), 0);
              return (
                <div key={d}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">{fmtDia(d)} <span className="font-normal text-muted-foreground">· {diaFichas} fichas · {diaPares.toLocaleString("pt-BR")} pares</span></h3>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Montador</th>
                          <th className="px-3 py-2">Tamanhos (pares)</th>
                          <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Méd</th>
                          <th className="px-3 py-2 text-right text-red-600">Dif</th>
                          <th className="px-3 py-2 text-center border-l border-border">Fichas</th>
                          <th className="px-3 py-2 text-center">Pares</th>
                          <th className="px-3 py-2 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map((f) => {
                          const chamada = isChamada(f);
                          const m = sizeMapOf(f);
                          const pd = chamada ? paresDiffOf(f) : { medio: paresDaFicha(f), dificil: 0, total: paresDaFicha(f) };
                          const tamLabel = chamada
                            ? (SIZES.filter((sz) => (m[sz] || 0) > 0).map((sz) => `${m[sz]}×${sz}`).join("  ") || "—")
                            : (f.referencia || f.solado || "—");
                          return (
                            <tr key={f.id} className="border-t border-border">
                              <td className="px-3 py-2 font-medium text-foreground">{f.montador || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground tabular-nums">{tamLabel}{!chamada && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">grade</span>}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{pd.medio ? pd.medio.toLocaleString("pt-BR") : "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{pd.dificil ? pd.dificil.toLocaleString("pt-BR") : "—"}</td>
                              <td className="px-3 py-2 text-center font-semibold tabular-nums text-primary border-l border-border">{chamada ? fichasDiaOf(f) : 1}</td>
                              <td className="px-3 py-2 text-center tabular-nums text-foreground">{pd.total.toLocaleString("pt-BR")}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => abrirDia(f)} className="mr-3 text-xs font-medium text-primary hover:underline">Abrir o dia</button>
                                <button onClick={() => excluir(f)} className="text-xs font-medium text-muted-foreground hover:text-red-600 dark:hover:text-red-400">Excluir</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        </div>
      )}
    </div>
  );
}
