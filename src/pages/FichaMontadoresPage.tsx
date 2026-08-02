// FichaMontadoresPage.tsx — Squad Shoes
// "Ficha de Montadores" → CHAMADA DO DIA: produção diária por setor.
// O trabalhador lança os PARES produzidos por TAMANHO DE FICHA (12 / 15 / 18).
//   · fichas = Σ (pares ÷ tamanho)   · pares = Σ pares
// Roster do setor numa tela (visão Dia) + matriz pessoas × Seg–Sex por tamanho
// (visão Semana). Um único "Salvar" (upsert em lote por dia/pessoa).
//
// Cada par tem DIFICULDADE (Médio âmbar / Difícil vermelho) que paga R$/par
// diferente: valor_par_medio / valor_par_dificil por pessoa.
// Modelo 'chamada' em public.ficha_montadores: 1 linha por (dia, montador_id) com
//   detalhe = [{tamanho, medio, dificil}], total = Σ (medio+dificil),
//   fichas_dia = Σ round((medio+dificil)/tamanho). Legado [{tamanho, pares}] é lido
//   como tudo MÉDIO; fichas de grade = origem='legacy'.
//
// SETORES: só MONTAGEM e SOLAGEM (SETORES_POR_PAR) — os dois ofícios pagos por
// produção; os outros 9 do fluxo nunca receberam um lançamento. O ROSTER e os
// RÓTULOS continuam vindo do banco (v_production_sectors / v_employee_sector),
// então o headcount desta tela e o do PCP saem da MESMA regra; esta tela só
// escolhe QUAIS setores exibir.
//
// PAGAMENTO = Σ por LINHA (pares × R$/par gravado NA PRÓPRIA LINHA), espelhando
// `sumProducaoRows` de montadorProduction.ts, que é o que a folha usa. O R$/par é
// snapshot do cadastro no momento do apontamento — a tela NÃO edita taxa (editar
// aqui reescrevia todo o histórico, inclusive de folha já calculada).
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatGrid, StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useEmployees } from "@/hooks/useEmployees";
import { useProductionSectors, useEmployeeSectors } from "@/hooks/useSectorRoster";
import { ratesOfRow } from "@/lib/montadorProduction";
import { searchMatchesAllTerms } from "@/lib/searchUtils";
import { toast } from "sonner";
import { Printer, ChartBar, ClipboardText, ListChecks, Users, Package, CurrencyDollar, FloppyDisk, CaretLeft, CaretRight, Warning, CheckCircle, Clock } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";
type Tab = "lancamento" | "produtividade" | "fichas";
/** Setores pagos por PRODUÇÃO — os únicos que esta tela atende (decisão do dono
 *  02/08/2026). Antes a faixa listava os 11 setores de v_production_sectors, mas
 *  9 deles nunca receberam um lançamento: o pagamento por par existe só em
 *  Montagem (montador) e Solagem (solador). Se outro ofício virar por-par um dia,
 *  basta acrescentar a chave canônica aqui. */
const SETORES_POR_PAR = ["montagem", "solagem"] as const;
/** Nome do ofício por setor, indexado pela CHAVE CANÔNICA do banco.
 *  Atenção: Aviamento tem chave 'mesa' (herança do nome antigo do setor) — por
 *  isso a chave nunca é derivada do rótulo aqui no TS. */
const OFICIO: Record<string, { sing: string; plural: string }> = {
  corte_palmilha:   { sing: "cortador",   plural: "cortadores" },
  corte_forracao:   { sing: "cortador",   plural: "cortadores" },
  costura_palmilha: { sing: "costureiro", plural: "costureiros" },
  costura_cabedal:  { sing: "costureiro", plural: "costureiros" },
  mesa:             { sing: "aviador",    plural: "aviadores" },
  silk:             { sing: "silkeiro",   plural: "silkeiros" },
  colagem:          { sing: "colador",    plural: "coladores" },
  montagem:         { sing: "montador",   plural: "montadores" },
  solagem:          { sing: "solador",    plural: "soladores" },
  acabamento:       { sing: "acabador",   plural: "acabadores" },
  expedicao:        { sing: "expedidor",  plural: "expedidores" },
};
const oficioOf = (key: string) => OFICIO[key] ?? { sing: "funcionário", plural: "funcionários" };
type ChamadaView = "dia" | "semana";
type PeriodMode = "hoje" | "semana" | "q1" | "q2" | "mes" | "custom";
/** Estado de quitação de um lançamento. A folha REIVINDICA na aprovação
 *  (payroll_run_id) e DATA no pagamento (pago_em) — são momentos diferentes, e o
 *  do meio é justamente onde não se pode relançar nem incluir em outra folha.
 *  'na' = não se aplica: o funcionário não é regime por par, então a produção
 *  dele é medição de produtividade e nunca vira pagamento por par. */
type PagEstado = "pago" | "folha" | "aberto" | "na";
type PagStatus = "todos" | PagEstado;
const PAG_LABEL: Record<PagStatus, string> = {
  todos: "Tudo", pago: "Pago", folha: "Na folha", aberto: "A pagar", na: "Sem regime por par",
};

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
  /** Folha que quitou o lançamento. NULL = produção ainda NÃO paga. */
  payroll_run_id?: string | null;
  pago_em?: string | null;
  criado_em?: string;
}

/** R$/par gravado NA LINHA (snapshot do cadastro na hora do apontamento).
 *  Reusa `ratesOfRow` de montadorProduction.ts DE PROPÓSITO: é exatamente a
 *  função que a FOLHA usa pra valorar. Reimplementar a leitura aqui abriria
 *  espaço pra tela e folha divergirem, em silêncio, no valor do MESMO
 *  lançamento — e é a tela que o gestor usa pra conferir a folha. */
const ratesOf = ratesOfRow;

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
function imprimirRelatorio(p: {
  rows: AggRow[]; totals: AggTotals; setorLabel: string; oficioPlural: string;
  label: string; intervalo: string; pagStatus: PagStatus;
}) {
  const { rows, totals } = p;
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:18px;margin:0 0 2px} .sub{font-size:11px;color:#555;margin-bottom:4px}
    .filtro{font-size:10px;color:#555;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #333;padding:6px 8px}
    th{background:#f1f0ed;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#444}
    td.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:800;background:#f6f5f2}
    .med{color:#b45309} .dif{color:#c81e2e} .pg{color:#15803d} .ab{color:#b45309} .fl{color:#1d4ed8}
    td.na{text-align:center;color:#888;font-size:10px}
    @page{size:A4 portrait;margin:12mm}`;
  const body = rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.nome)}</td><td class="n">${r.fichas}</td>`
    + `<td class="n med">${r.paresMedio}</td><td class="n dif">${r.paresDificil}</td>`
    + `<td class="n">${r.pares}</td>`
    + (r.porPar
      ? `<td class="n ab">${r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</td>`
        + `<td class="n fl">${r.valorFolha > 0 ? fmtBRL(r.valorFolha) : "—"}</td>`
        + `<td class="n pg">${r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</td>`
        + `<td class="n">${fmtBRL(r.valorTotal)}</td>`
      : `<td class="n na" colspan="4">não é regime por par</td>`)
    + `</tr>`).join("");
  const filtro = {
    todos: "Mostrando toda a produção do período.",
    aberto: "Filtrado: SOMENTE produção ainda livre, que nenhuma folha reivindicou.",
    folha: "Filtrado: SOMENTE produção reivindicada por folha aprovada e ainda não paga.",
    pago: "Filtrado: SOMENTE produção já paga.",
    na: "Filtrado: SOMENTE quem não é regime por par (produção como medição).",
  }[p.pagStatus];
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Produtividade — ${esc(p.setorLabel)}</title><style>${css}</style></head><body>
    <h1>Produtividade — ${esc(p.setorLabel)}</h1>
    <div class="sub">${esc(p.label)} · ${esc(p.intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <div class="filtro">${esc(filtro)} Valores calculados pelo R$/par gravado em cada lançamento.</div>
    <table><thead><tr><th>${esc(p.oficioPlural.replace(/^./, (c) => c.toUpperCase()))}</th><th style="text-align:right">Fichas</th>
      <th style="text-align:right" class="med">Pares méd</th><th style="text-align:right" class="dif">Pares dif</th>
      <th style="text-align:right">Pares</th>
      <th style="text-align:right" class="ab">A pagar</th><th style="text-align:right" class="fl">Na folha</th>
      <th style="text-align:right" class="pg">Pago</th>
      <th style="text-align:right">Total</th></tr></thead>
    <tbody>${body || '<tr><td colspan="9" style="text-align:center;color:#888">Sem dados no período.</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL (${rows.length})</td><td class="n">${totals.fichas}</td>
      <td class="n med">${totals.medio}</td><td class="n dif">${totals.dificil}</td>
      <td class="n">${totals.pares}</td>
      <td class="n ab">${fmtBRL(totals.valorAberto)}</td><td class="n fl">${fmtBRL(totals.valorFolha)}</td>
      <td class="n pg">${fmtBRL(totals.valorPago)}</td>
      <td class="n">${fmtBRL(totals.valorTotal)}</td></tr></tfoot></table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

/* ---------- Impressão do CALENDÁRIO de produção (montador × dia, A4 paisagem) ---------- */
/** `pago` na célula = o dia já foi quitado por uma folha (payroll_run_id). */
interface CalCell { pares: number; medio: number; dificil: number; fichas: number; pago: boolean; }
interface CalRow {
  key: string; nome: string; cells: Record<string, CalCell>;
  medio: number; dificil: number; pares: number; fichas: number;
  valorPago: number; valorAberto: number; valorTotal: number;
}
function imprimirCalendario(p: { rows: CalRow[]; days: string[]; setorLabel: string; oficioLabel: string; periodo: string; intervalo: string }) {
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
      // Dia ainda não quitado ganha marca — o gestor lê a coluna e sabe o que deve.
      return `<td class="c has${we ? " we" : ""}${c.pago ? "" : " ab"}"><b>${c.pares}</b><div class="sp">${sp}</div></td>`;
    }).join("");
    return `<tr><td class="mont">${esc(r.nome)}</td>${cells}`
      + `<td class="n med">${r.medio || "—"}</td><td class="n dif">${r.dificil || "—"}</td>`
      + `<td class="n b">${nf(r.pares)}</td><td class="n f">${r.fichas}</td>`
      + `<td class="n pgo">${r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</td>`
      + `<td class="n abt">${r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</td></tr>`;
  }).join("");
  const dayTot = days.map((d) => {
    const s = rows.reduce((a, r) => a + (r.cells[d]?.pares || 0), 0);
    return `<td class="c${dowIdx(d) >= 5 ? " we" : ""}">${s || ""}</td>`;
  }).join("");
  const tMed = rows.reduce((s, r) => s + r.medio, 0), tDif = rows.reduce((s, r) => s + r.dificil, 0);
  const tPar = rows.reduce((s, r) => s + r.pares, 0), tFic = rows.reduce((s, r) => s + r.fichas, 0);
  const tPago = rows.reduce((s, r) => s + r.valorPago, 0);
  const tAberto = rows.reduce((s, r) => s + r.valorAberto, 0);
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:16px;margin:0 0 2px} .sub{font-size:10px;color:#555;margin-bottom:10px}
    .lg{font-size:9px;color:#555;margin:2px 0 10px} .lg b.med{color:#b45309} .lg b.dif{color:#c81e2e}
    table{width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed}
    th,td{border:1px solid #bbb;padding:2px 3px;text-align:center;overflow:hidden}
    th{background:#f1f0ed;font-size:8px;text-transform:uppercase;color:#444}
    th.day{width:22px;line-height:1.05} th.day.we,td.c.we{background:#f4f2ee}
    td.mont,th.mont{text-align:left;font-weight:700;white-space:nowrap;width:96px;background:#fafafa}
    td.c{color:#bbb} td.c.has{color:#111} td.c b{font-size:9px;font-weight:800} td.c .sp{font-size:6.5px;line-height:1}
    td.c.ab{background:#fff7ed} td.c.ab.we{background:#f7efe4}
    td.c .med{color:#b45309;font-weight:700} td.c .dif{color:#c81e2e;font-weight:700} td.c .x{color:#bbb;margin:0 1px}
    td.n{text-align:right;font-variant-numeric:tabular-nums;width:34px} td.n.med{color:#b45309;font-weight:700} td.n.dif{color:#c81e2e;font-weight:700}
    td.n.b{font-weight:800} td.n.pgo{font-weight:800;width:56px;color:#15803d} td.n.abt{font-weight:800;width:56px;color:#b45309}
    td.n.f{color:#c81e2e;font-weight:700;width:28px}
    th.sum{background:#e9e7e2}
    tfoot td{font-weight:800;background:#f6f5f2} tfoot td.c{color:#111}
    @page{size:A4 landscape;margin:8mm}`;
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Calendário — ${esc(p.setorLabel)}</title><style>${css}</style></head><body>
    <h1>Calendário de Produção — ${esc(p.setorLabel)}</h1>
    <div class="sub">${esc(p.periodo)} · ${esc(p.intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <div class="lg">Cada célula = <b>pares do dia</b>; embaixo o split <b class="med">médio</b> · <b class="dif">difícil</b>. Célula com fundo claro = dia <b>ainda não pago</b>. Colunas cinza = fim de semana.</div>
    <table>
      <thead><tr><th class="mont">${esc(p.oficioLabel)}</th>${dayHead}<th class="sum">Méd</th><th class="sum">Dif</th><th class="sum">Pares</th><th class="sum">Fichas</th><th class="sum">Pago</th><th class="sum">A pagar</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${days.length + 7}" style="text-align:center;color:#888;padding:12px">Sem lançamentos no período.</td></tr>`}</tbody>
      <tfoot><tr><td class="mont">TOTAL (${rows.length})</td>${dayTot}<td class="n med">${nf(tMed)}</td><td class="n dif">${nf(tDif)}</td><td class="n b">${nf(tPar)}</td><td class="n f">${tFic}</td><td class="n pgo">${fmtBRL(tPago)}</td><td class="n abt">${fmtBRL(tAberto)}</td></tr></tfoot>
    </table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

interface AggRow {
  key: string; nome: string; fichas: number;
  paresMedio: number; paresDificil: number; pares: number;
  /** Taxa vigente no CADASTRO do funcionário — referência de conferência.
   *  NÃO entra no cálculo: o valor sai do snapshot de cada linha. Divergência
   *  entre as duas colunas significa reajuste depois do apontamento. */
  taxaMedio: number; taxaDificil: number;
  /** Regime por par? Se não, os valores abaixo ficam zerados de propósito:
   *  a produção do mensalista é medição, e somá-la em "a pagar" inventaria uma
   *  dívida que nunca será paga por par. */
  porPar: boolean;
  /** Valorado linha a linha pelo snapshot, separado por estado de quitação. */
  valorPago: number; valorFolha: number; valorAberto: number; valorTotal: number;
}
interface AggTotals {
  fichas: number; pares: number; medio: number; dificil: number;
  valorPago: number; valorFolha: number; valorAberto: number; valorTotal: number;
}

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  const db = supabase as any;
  const [tab, setTab] = useState<Tab>("lancamento");
  // Setores do fluxo (v_production_sectors, em flow_order) filtrados pelos que são
  // pagos por par. O RÓTULO continua vindo do banco (não hard-coded); só a seleção
  // de QUAIS setores aparecem é desta tela — ela cobre pagamento por produção, e
  // não o fluxo inteiro. Fallback se a view não trouxer um deles: mostra assim
  // mesmo, com o rótulo capitalizado, pra a aba nunca sumir por falha de cadastro.
  const { data: allSectors = [] } = useProductionSectors();
  const sectors = useMemo(() => {
    const byKey = new Map(allSectors.map((s) => [s.key, s]));
    return SETORES_POR_PAR.map((key) =>
      byKey.get(key) ?? { key, label: key.replace(/^./, (c) => c.toUpperCase()) },
    );
  }, [allSectors]);
  // Setor ativo — abas independentes na mesma tela, dados separados por
  // ficha_montadores.setor (que guarda a CHAVE canônica).
  const [setor, setSetor] = useState<string>("montagem");
  const cfgSetor = useMemo(() => {
    const s = sectors.find((x) => x.key === setor);
    return { id: setor, label: s?.label ?? "Setor", ...oficioOf(setor) };
  }, [sectors, setor]);

  // ── chamada do dia / semana ──
  const [chamadaView, setChamadaView] = useState<ChamadaView>("dia");
  const [chamadaDia, setChamadaDia] = useState(todayISO());
  const [semanaAnchor, setSemanaAnchor] = useState(todayISO());
  const [semSize, setSemSize] = useState<number>(12);
  const [semDiff, setSemDiff] = useState<Diff>("medio"); // dificuldade ativa na matriz semanal
  // Mostrar as 6 combinações (3 tamanhos × 2 dificuldades) na visão Dia. Fica
  // FECHADO por padrão: ficha 15/18 e par difícil existem, mas são raros — em
  // todo o histórico nenhum foi lançado. Deixá-los sempre à vista cobrava 6
  // campos por pessoa/dia pra preencher 1. Ver `colunasDia` abaixo: a coluna
  // rara aparece sozinha quando JÁ tem número, mesmo com o detalhe fechado, pra
  // nenhum lançamento existente ficar invisível.
  const [detalharDia, setDetalharDia] = useState(false);
  const [busca, setBusca] = useState("");
  // Dia: pares por montador por dificuldade × tamanho
  const [pares, setPares] = useState<Record<string, DiffSizeMap>>({});
  const [origPares, setOrigPares] = useState<Record<string, DiffSizeMap>>({});
  // Semana: pares por (montador|dia) por dificuldade × tamanho
  const [week, setWeek] = useState<Record<string, DiffSizeMap>>({});
  const [origWeek, setOrigWeek] = useState<Record<string, DiffSizeMap>>({});
  const [savingDia, setSavingDia] = useState(false);
  const [savingSem, setSavingSem] = useState(false);

  // ── filtro de período (Produtividade + Relatórios) ──
  // Declarado aqui em cima, antes do carregamento, porque a busca no banco é
  // recortada por data: o intervalo que a tela consegue exibir sai da união
  // destes filtros com o dia/semana da Chamada.
  const [pMode, setPMode] = useState<PeriodMode>("q1");
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const range = useMemo(() => periodRange(pMode, cFrom, cTo), [pMode, cFrom, cTo]);

  // ── dados ──
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);

  /** Intervalo a buscar = união do que TODAS as abas podem mostrar (dia da
   *  chamada, semana ancorada e período dos relatórios). Uma folga de 1 dia em
   *  cada ponta evita que a navegação por dia/semana dispare uma busca a cada
   *  clique de seta. */
  const dataRange = useMemo(() => {
    const wd = weekDaysOf(semanaAnchor);
    const cands = [chamadaDia, wd[0], wd[4], range.from, range.to].filter(Boolean) as string[];
    const shift = (iso: string, days: number) =>
      isoOf(new Date(new Date(iso + "T00:00:00").getTime() + days * 864e5));
    return { from: shift(cands.reduce((a, b) => (a < b ? a : b)), -1), to: shift(cands.reduce((a, b) => (a > b ? a : b)), 1) };
  }, [chamadaDia, semanaAnchor, range.from, range.to]);

  const { data: employees = [] } = useEmployees();
  const { data: employeeSectors = [] } = useEmployeeSectors();

  // Trabalhadores do SETOR ativo, pela view canônica (department + alocação
  // explícita, normalizados por capacity_sector_key). Carrega junto o R$/par do
  // cadastro, que é a fonte do snapshot no apontamento.
  const montadores = useMemo(
    () => employeeSectors
      .filter((r) => r.sector_key === setor)
      .map((r) => ({
        id: r.employee_id, name: r.name, role: r.role, department: r.department,
        external_id: r.external_id, payment_type: r.payment_type,
        valor_par_medio: r.valor_par_medio, valor_par_dificil: r.valor_par_dificil,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [employeeSectors, setor],
  );

  // Pendências de CADASTRO de quem é regime por par. A tela cobre só Montagem e
  // Solagem, então o alerta antigo ("sem setor de produção") virava ruído: ele
  // acusava toda a fábrica. O que importa aqui é quem é PAGO POR PAR e mesmo
  // assim não consegue receber — ou porque está lotado fora dos dois setores
  // (não há aba onde lançar a produção dele), ou porque não tem R$/par
  // cadastrado (o lançamento fica bloqueado, e antes virava produção valendo
  // R$ 0,00 — foi assim que 33 apontamentos ficaram zerados).
  const pendencias = useMemo(() => {
    const lotacao = new Map(employeeSectors.map((r) => [r.employee_id, { key: r.sector_key, label: r.sector_label }]));
    return employees
      .filter((e) => e.active && String((e as any).payment_type || "").toLowerCase() === "producao")
      .map((e) => {
        const lot = lotacao.get(e.id);
        const foraDosSetores = !lot || !(SETORES_POR_PAR as readonly string[]).includes(lot.key);
        const semTaxa = !(Number((e as any).valor_par_medio) > 0);
        return { id: e.id, name: e.name, lotacao: lot?.label || null, foraDosSetores, semTaxa };
      })
      .filter((p) => p.foraDosSetores || p.semTaxa)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [employees, employeeSectors]);

  const carregar = useCallback(async () => {
    setLoading(true);
    // Escopo por SETOR e por INTERVALO. Antes a tela baixava o histórico inteiro
    // do setor a cada troca de aba — cresce sem teto e o PostgREST corta em 1.000
    // linhas em silêncio, então um dia a produção antiga simplesmente sumiria dos
    // relatórios. Agora busca só o que as três abas conseguem exibir.
    const { data, error } = await db.from("ficha_montadores").select("*")
      .eq("setor", setor)
      .gte("dia", dataRange.from)
      .lte("dia", dataRange.to)
      .order("dia", { ascending: false })
      .order("criado_em", { ascending: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    else setFichas((data ?? []) as Ficha[]);
    setLoading(false);
  }, [db, setor, dataRange.from, dataRange.to]);
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

  /** Colunas de lançamento da visão Dia (tamanho × dificuldade). Sempre a
   *  combinação padrão (12 · médio); as demais entram quando o detalhe está
   *  aberto OU quando alguém do roster já tem número ali — assim abrir a tela
   *  nunca esconde um lançamento que existe. */
  const colunasDia = useMemo(() => {
    const cols: { sz: number; diff: Diff }[] = [];
    for (const sz of SIZES) {
      for (const diff of DIFFS) {
        const padrao = sz === 12 && diff === "medio";
        const temDado = montadores.some((e) => ((pares[e.id] || emptyDiffMap())[diff][sz] || 0) > 0);
        if (padrao || detalharDia || temDado) cols.push({ sz, diff });
      }
    }
    return cols;
  }, [montadores, pares, detalharDia]);
  /** Combinação rara com número lançado, mas com o detalhe FECHADO — a coluna
   *  aparece e ganha um rótulo explícito pra não parecer a coluna padrão. */
  const temColunaRara = colunasDia.some((c) => !(c.sz === 12 && c.diff === "medio"));

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

  // Regime de cada pessoa — decide se a produção dela é PAGAMENTO ou só medição.
  // Vem de employees (não do roster do setor) pra cobrir também quem lançou
  // produção num setor e depois foi transferido pra outro.
  const regimePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, String((e as any).payment_type || "mensalista").toLowerCase());
    return m;
  }, [employees]);

  /** Monta a linha de um (dia, pessoa). Retorna a ação a executar em LOTE:
   *  `delete` (zerou os pares), `update` (já existia) ou `insert`.
   *  Devolve `bloqueio` quando é regime por par sem R$/par cadastrado — salvar
   *  assim gravaria produção valendo R$ 0,00, que é exatamente como 33 registros
   *  antigos nasceram (ver docs/adr/0001). O banco também barra (trigger
   *  trg_ficha_montadores_require_rate); aqui o erro chega antes e com o nome. */
  function montarLinha(dia: string, e: { id: string; name: string }, dm: DiffSizeMap):
    | { acao: "delete"; id: string }
    | { acao: "update"; id: string; payload: any }
    | { acao: "insert"; payload: any }
    | { acao: "nada" }
    | { acao: "bloqueio"; nome: string } {
    const existing = fichas.find((f) => isChamada(f) && f.montador_id === e.id && f.dia === dia);
    const totalP = paresOfDiffMap(dm);
    if (totalP <= 0) return existing ? { acao: "delete", id: existing.id } : { acao: "nada" };

    const emp = montadores.find((x) => x.id === e.id);
    const vmCad = Number(emp?.valor_par_medio) || 0;
    const vdCad = Number(emp?.valor_par_dificil) || 0;
    // SNAPSHOT do R$/par: fonte única = cadastro do funcionário. Congela o valor
    // da época em cada apontamento, então reajustar o cadastro não reescreve
    // produção já apontada (nem folha já calculada em cima dela).
    const vmSnap = vmCad > 0 ? vmCad : (existing?.valor_par_medio ?? existing?.valor_par ?? null);
    const vdSnap = vdCad > 0 ? vdCad : (existing?.valor_par_dificil ?? null);
    // Trava: por par sem R$/par MÉDIO não salva. Só o médio é obrigatório —
    // há gente (Solagem) sem taxa de difícil cadastrada, e par difícil é raro;
    // a difícil só é exigida quando o lançamento tem pares difíceis.
    if (regimePor.get(e.id) === "producao") {
      if (!(Number(vmSnap) > 0)) return { acao: "bloqueio", nome: e.name };
      if (paresOfMap(dm.dificil) > 0 && !(Number(vdSnap) > 0)) return { acao: "bloqueio", nome: e.name };
    }

    const det: DetItem[] = SIZES
      .filter((sz) => (dm.medio[sz] || 0) > 0 || (dm.dificil[sz] || 0) > 0)
      .map((sz) => ({ tamanho: sz, medio: dm.medio[sz] || 0, dificil: dm.dificil[sz] || 0 }));
    const fichasCount = det.reduce((s, d) => s + Math.round(((d.medio || 0) + (d.dificil || 0)) / d.tamanho), 0);
    const payload: any = {
      dia, montador: e.name, montador_id: e.id, setor,
      fichas_dia: fichasCount, total: totalP, copias: 1, grade: "adulto", numeracoes: [], quantidades: [],
      cor: null, referencia: null, reference_id: null, detalhe: det, origem: "chamada",
      valor_par_medio: vmSnap, valor_par_dificil: vdSnap,
      valor_par: vmCad > 0 ? vmCad : (existing?.valor_par ?? 0),
      atualizado_em: new Date().toISOString(),
    };
    return existing ? { acao: "update", id: existing.id, payload } : { acao: "insert", payload };
  }

  /** Grava um conjunto de (dia, pessoa) em LOTE. Antes era uma ida ao banco por
   *  célula, em fila: a Semana com 5 pessoas × 5 dias disparava 25 requisições
   *  sequenciais e o botão ficava travado o tempo todo. Agora são no MÁXIMO 3
   *  (delete + update + insert), independente do tamanho do roster.
   *  Os updates ainda são um por linha porque cada um tem id próprio — mas vão
   *  em paralelo, não em fila. */
  async function persistirLote(itens: { dia: string; e: { id: string; name: string }; dm: DiffSizeMap }[]) {
    const bloqueados: string[] = [];
    const aExcluir: string[] = [];
    const aInserir: any[] = [];
    const aAtualizar: { id: string; payload: any }[] = [];
    for (const it of itens) {
      const r = montarLinha(it.dia, it.e, it.dm);
      if (r.acao === "bloqueio") bloqueados.push(r.nome);
      else if (r.acao === "delete") aExcluir.push(r.id);
      else if (r.acao === "insert") aInserir.push(r.payload);
      else if (r.acao === "update") aAtualizar.push({ id: r.id, payload: r.payload });
    }

    const erros: string[] = [];
    if (aExcluir.length) {
      const { error } = await db.from("ficha_montadores").delete().in("id", aExcluir);
      if (error) erros.push(error.message);
    }
    if (aInserir.length) {
      const { error } = await db.from("ficha_montadores").insert(aInserir);
      if (error) erros.push(error.message);
    }
    if (aAtualizar.length) {
      const res = await Promise.all(
        aAtualizar.map((u) => db.from("ficha_montadores").update(u.payload).eq("id", u.id)),
      );
      for (const r of res) if (r.error) erros.push(r.error.message);
    }

    const gravados = aExcluir.length + aInserir.length + aAtualizar.length;
    return { gravados, erros: Array.from(new Set(erros)), bloqueados: Array.from(new Set(bloqueados)) };
  }

  /** Avisa o que a trava barrou, com o caminho do conserto. */
  function avisarBloqueio(bloqueados: string[]) {
    if (!bloqueados.length) return;
    toast.error(
      `R$/par não cadastrado: ${bloqueados.join(", ")}. A produção não foi salva porque valeria R$ 0,00 na folha — cadastre em Funcionários → Remuneração.`,
      { duration: 8000 },
    );
  }

  async function salvarDia() {
    setSavingDia(true);
    const changed = montadores.filter((e) => JSON.stringify(mapOf(e.id)) !== JSON.stringify(origPares[e.id] || emptyDiffMap()));
    const { gravados, erros, bloqueados } = await persistirLote(
      changed.map((e) => ({ dia: chamadaDia, e, dm: mapOf(e.id) })),
    );
    await carregar();
    setSavingDia(false);
    avisarBloqueio(bloqueados);
    if (erros.length) toast.error(`Erro ao salvar: ${erros.join(" · ")}`);
    if (gravados) toast.success(`Dia salvo — ${gravados} ${gravados === 1 ? "lançamento" : "lançamentos"}.`);
    if (!gravados && !erros.length && !bloqueados.length) toast.message("Nada para salvar.");
  }

  async function salvarSemana() {
    setSavingSem(true);
    const itens: { dia: string; e: { id: string; name: string }; dm: DiffSizeMap }[] = [];
    for (const e of montadores) {
      for (const day of weekDays) {
        const k = `${e.id}|${day}`;
        if (JSON.stringify(week[k] || emptyDiffMap()) === JSON.stringify(origWeek[k] || emptyDiffMap())) continue;
        itens.push({ dia: day, e, dm: week[k] || emptyDiffMap() });
      }
    }
    const { gravados, erros, bloqueados } = await persistirLote(itens);
    await carregar();
    setSavingSem(false);
    avisarBloqueio(bloqueados);
    if (erros.length) toast.error(`Erro ao salvar: ${erros.join(" · ")}`);
    if (gravados) toast.success(`Semana salva — ${gravados} lançamento${gravados === 1 ? "" : "s"}.`);
    if (!gravados && !erros.length && !bloqueados.length) toast.message("Nada para salvar.");
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
  // A aba Produtividade NÃO edita mais o R$/par. O caminho antigo
  // (persistRateMontador) fazia UPDATE em TODAS as fichas do montador sem filtro
  // de data nem de setor: um ajuste de centavo revalorizava o histórico inteiro
  // e mudava folha já calculada — o oposto do "snapshot congelado" que o próprio
  // apontamento promete. A taxa agora se cadastra em Funcionários → Remuneração
  // e entra congelada em cada lançamento novo.
  const aggKeyOf = (f: { montador_id?: string | null; montador?: string | null }) =>
    f.montador_id || `txt:${(f.montador || "—").toLowerCase()}`;
  /** Taxa VIGENTE no cadastro (só referência de conferência na tela). */
  const taxaCadastro = useMemo(() => {
    const m = new Map<string, { vm: number; vd: number }>();
    for (const e of montadores) {
      m.set(e.id, { vm: Number(e.valor_par_medio) || 0, vd: Number(e.valor_par_dificil) || 0 });
    }
    return m;
  }, [montadores]);

  // pMode/cFrom/cTo e `range` ficam lá em cima (antes de `carregar`) — a busca
  // no banco depende deles. Aqui só os filtros que não afetam o intervalo.
  const [filtroMontador, setFiltroMontador] = useState<string>("__all__");
  // Quitação: separa o que a folha já pagou do que ainda está em aberto.
  const [pagStatus, setPagStatus] = useState<PagStatus>("todos");

  const estadoDe = useCallback((f: Ficha): PagEstado => {
    if (!f.montador_id || regimePor.get(f.montador_id) !== "producao") return "na";
    if (f.pago_em) return "pago";
    if (f.payroll_run_id) return "folha";
    return "aberto";
  }, [regimePor]);

  const fichasFiltradas = useMemo(
    () => fichas.filter((f) =>
      f.dia >= range.from && f.dia <= range.to
      && (filtroMontador === "__all__" || f.montador_id === filtroMontador)
      && (pagStatus === "todos" || estadoDe(f) === pagStatus)),
    [fichas, range, filtroMontador, pagStatus, estadoDe],
  );

  // Pares e VALOR por pessoa. O valor sai do R$/par de CADA linha (snapshot),
  // nunca de "pares do período × taxa de hoje" — senão um reajuste reescreveria
  // retroativamente o que já foi pago. Mesma conta de sumProducaoRows, que é a
  // que a folha executa.
  const agg = useMemo<AggRow[]>(() => {
    const m = new Map<string, AggRow>();
    for (const f of fichasFiltradas) {
      const key = aggKeyOf(f);
      const fichasContrib = isChamada(f) ? fichasDiaOf(f) : 1; // chamada = nº de fichas; legado = 1 ficha/linha
      const pd = isChamada(f)
        ? paresDiffOf(f)
        : { medio: paresDaFicha(f), dificil: 0, total: paresDaFicha(f) }; // legado = tudo médio
      const { vm, vd } = ratesOf(f);
      const valor = pd.medio * vm + pd.dificil * vd;
      const estado = estadoDe(f);
      const cur = m.get(key) || {
        key, nome: f.montador || "(sem montador)", fichas: 0,
        paresMedio: 0, paresDificil: 0, pares: 0,
        taxaMedio: 0, taxaDificil: 0, porPar: estado !== "na",
        valorPago: 0, valorFolha: 0, valorAberto: 0, valorTotal: 0,
      };
      cur.fichas += fichasContrib;
      cur.paresMedio += pd.medio; cur.paresDificil += pd.dificil; cur.pares += pd.medio + pd.dificil;
      // Só quem é regime por par entra nos baldes de dinheiro.
      if (estado !== "na") {
        if (estado === "pago") cur.valorPago += valor;
        else if (estado === "folha") cur.valorFolha += valor;
        else cur.valorAberto += valor;
        cur.valorTotal += valor;
      }
      m.set(key, cur);
    }
    const rows = Array.from(m.values());
    for (const r of rows) {
      const t = taxaCadastro.get(r.key);
      r.taxaMedio = t?.vm ?? 0; r.taxaDificil = t?.vd ?? 0;
    }
    return rows.sort((a, b) => b.pares - a.pares);
  }, [fichasFiltradas, taxaCadastro, estadoDe]);
  const totals = useMemo<AggTotals>(
    () => agg.reduce((s, r) => ({
      fichas: s.fichas + r.fichas, pares: s.pares + r.pares,
      medio: s.medio + r.paresMedio, dificil: s.dificil + r.paresDificil,
      valorPago: s.valorPago + r.valorPago,
      valorFolha: s.valorFolha + r.valorFolha,
      valorAberto: s.valorAberto + r.valorAberto,
      valorTotal: s.valorTotal + r.valorTotal,
    }), { fichas: 0, pares: 0, medio: 0, dificil: 0, valorPago: 0, valorFolha: 0, valorAberto: 0, valorTotal: 0 }),
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
      const { vm, vd } = ratesOf(f);
      const valor = pd.medio * vm + pd.dificil * vd;
      const estado = estadoDe(f);
      let r = map.get(key);
      if (!r) { r = { key, nome: f.montador || "(sem montador)", cells: {}, medio: 0, dificil: 0, pares: 0, fichas: 0, valorPago: 0, valorAberto: 0, valorTotal: 0 }; map.set(key, r); }
      const c = r.cells[f.dia] || { pares: 0, medio: 0, dificil: 0, fichas: 0, pago: true };
      c.pares += pd.total; c.medio += pd.medio; c.dificil += pd.dificil; c.fichas += fich;
      // Dia com QUALQUER lançamento ainda não pago conta como não pago — a marca
      // do calendário existe pra cobrar, então erra pro lado de sinalizar.
      c.pago = c.pago && estado === "pago";
      r.cells[f.dia] = c;
      r.pares += pd.total; r.medio += pd.medio; r.dificil += pd.dificil; r.fichas += fich;
      if (estado !== "na") {
        if (estado === "pago") r.valorPago += valor; else r.valorAberto += valor;
        r.valorTotal += valor;
      }
    }
    const rows = Array.from(map.values()).sort((a, b) => b.pares - a.pares);
    if (!rows.length) { toast.error("Sem lançamentos no período pra gerar o calendário."); return; }
    imprimirCalendario({
      rows, days, setorLabel: cfgSetor.label,
      oficioLabel: cfgSetor.sing.replace(/^./, (c) => c.toUpperCase()),
      periodo: periodLabel[pMode], intervalo: `${fmtDia(range.from)} a ${fmtDia(range.to)}`,
    });
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
        description="Lance os PARES produzidos no dia. O sistema calcula as fichas (lotes) e o valor a pagar pelo R$/par de cada pessoa."
        meta={<><span className="font-bold">{montadores.length}</span> {(montadores.length === 1 ? cfgSetor.sing : cfgSetor.plural).toUpperCase()} · <span className="font-bold">{fichasHoje}</span> FICHA{fichasHoje === 1 ? "" : "S"} HOJE</>}
      />

      {/* Setor — só Montagem e Solagem, os dois ofícios pagos por par. Dados e
          relatórios separados por ficha_montadores.setor. Com 2 abas a faixa cabe
          inteira: não precisa mais da rolagem horizontal que os 11 setores exigiam. */}
      <div className="flex flex-wrap gap-0 overflow-hidden rounded-lg border border-border w-fit">
          {sectors.map((s) => {
            const gente = employeeSectors.filter((r) => r.sector_key === s.key).length;
            return (
              <button key={s.key} type="button" onClick={() => setSetor(s.key)}
                title={`${s.label} — ${gente} ${gente === 1 ? "pessoa" : "pessoas"} no setor`}
                className={`whitespace-nowrap border-r border-border px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors last:border-r-0 ${setor === s.key ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>
                {s.label}
                <span className={`ml-1.5 font-mono text-[10px] ${setor === s.key ? "text-background/70" : "text-muted-foreground/60"}`}>{gente}</span>
              </button>
            );
          })}
      </div>

      {/* Pendência de CADASTRO de quem é por par: sem setor válido ou sem R$/par,
          a produção da pessoa não vira pagamento — e antes isso acontecia calado. */}
      {pendencias.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-[200px] flex-1">
            <p className="text-sm font-semibold text-foreground">
              {pendencias.length} funcionário{pendencias.length === 1 ? "" : "s"} por par com cadastro incompleto
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Sem isso a produção não vira pagamento na folha. Corrija em Funcionários → Remuneração.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              {pendencias.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold text-foreground">{p.name}</span>
                  {p.semTaxa && <span className="ml-1.5 text-amber-700 dark:text-amber-500">· sem R$/par cadastrado</span>}
                  {p.foraDosSetores && (
                    <span className="ml-1.5 text-amber-700 dark:text-amber-500">
                      · lotado em {p.lotacao || "nenhum setor"} (fora de Montagem/Solagem)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <Button asChild type="button" variant="outline" size="sm" className="h-8">
            <Link to="/rh?tab=funcionarios">Abrir Funcionários</Link>
          </Button>
        </div>
      )}

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
              <EmptyState icon={Users} title={`Nenhum ${cfgSetor.sing} no setor`}
                description={`Defina o setor "${cfgSetor.label}" no cadastro do funcionário (Funcionários → Setor) para lançar a produção dele aqui.`} />
            </Panel>
          ) : chamadaView === "dia" ? (
            <Panel
              flush
              eyebrow="CONTAGEM DO DIA"
              title={`${weekdayName(chamadaDia)} · ${fmtDia(chamadaDia)}`}
              subtitle={detalharDia || temColunaRara
                ? "Pares por tamanho de ficha (12/15/18) e por dificuldade — Médio (âmbar) e Difícil (vermelho) pagam R$/par diferentes."
                : "Pares produzidos no dia. Ficha de 12 e dificuldade média — abra “Todos os tamanhos” para lançar ficha 15/18 ou par difícil."}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant={detalharDia ? "default" : "outline"} size="sm" className="h-8"
                    aria-pressed={detalharDia} onClick={() => setDetalharDia((v) => !v)}>
                    {detalharDia ? "Só o padrão" : "Todos os tamanhos"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={zerarDia}>Zerar tudo</Button>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: colunasDia.length > 1 ? 760 : 480 }}>
                  <thead>
                    <tr className="border-b-2 border-border/80 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left align-bottom" style={{ minWidth: 180 }}>{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                      {colunasDia.map(({ sz, diff }) => (
                        <th key={`${sz}-${diff}`} className="border-l border-border px-1 py-1.5 text-center align-bottom" style={{ width: 72 }}>
                          <span className="block text-[11px] leading-tight">{sz}<span className="ml-0.5 font-mono text-[9px] normal-case text-muted-foreground/70">pares</span></span>
                          {/* Rótulo da dificuldade sempre presente: cor sozinha não
                              informa (daltonismo / impressão em P&B). */}
                          <span className={`block text-[10px] font-bold leading-tight ${diff === "medio" ? "text-amber-600" : "text-red-600"}`}>{DIFF_LABEL[diff]}</span>
                        </th>
                      ))}
                      <th className="border-l border-border px-3 py-2 text-right align-bottom" style={{ width: 64 }}>Pares</th>
                      <th className="px-3 py-2 text-right align-bottom text-primary" style={{ width: 58 }}>Fichas</th>
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
                          {colunasDia.map(({ sz, diff }) => (
                            <td key={`${sz}-${diff}`} className="border-l border-border px-1 py-1.5 text-center">
                              <input inputMode="numeric" value={dm[diff][sz] || ""} placeholder="0"
                                onFocus={(ev) => ev.target.select()}
                                onChange={(ev) => setPS(e.id, diff, sz, numOf(ev.target.value))}
                                className={diff === "medio" ? cellM : cellD}
                                aria-label={`${DIFF_LABEL[diff]} · ficha de ${sz} pares — ${e.name}`} />
                            </td>
                          ))}
                          <td className="border-l border-border px-3 py-2 text-right text-sm font-semibold tabular-nums text-foreground">{pp.toLocaleString("pt-BR")}</td>
                          <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-primary">{ff}</td>
                        </tr>
                      );
                    })}
                    {rosterFiltrado.length === 0 && (
                      <tr><td colSpan={colunasDia.length + 3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Nenhum resultado para "{busca}".
                        <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={() => setBusca("")}>Limpar busca</Button>
                      </td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-foreground bg-muted/30 text-sm font-bold tabular-nums">
                      <td className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground">Total do dia</td>
                      {colunasDia.map(({ sz, diff }) => {
                        const col = rosterFiltrado.reduce((s, e) => s + (mapOf(e.id)[diff][sz] || 0), 0);
                        return (
                          <td key={`${sz}-${diff}`} className={`border-l border-border px-1 py-2.5 text-center ${diff === "medio" ? "text-amber-600" : "text-red-600"}`}>{col || ""}</td>
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
              subtitle="Pares por dia. Você edita uma combinação por vez (dificuldade × tamanho); a marca +N na célula avisa quantos pares daquele dia estão fora da combinação atual."
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
                      <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ minWidth: 150 }}>{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())} <span className={`font-mono normal-case ${semDiff === "medio" ? "text-amber-600" : "text-red-600"}`}>· {DIFF_LABEL[semDiff]} de {semSize}</span></th>
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
                          {weekDays.map((d) => {
                            const cel = weekMap(e.id, d);
                            const naFatia = cel[semDiff][semSize] || 0;
                            const totalDoDia = paresOfDiffMap(cel);
                            // A matriz edita UMA fatia (dificuldade × tamanho) por vez, mas
                            // o dia pode ter pares em outras. Sem mostrar isso, a célula
                            // vazia parece "não produziu" quando na verdade produziu fora
                            // da fatia atual — e o lançamento seguinte sobrescreveria a
                            // leitura de quem confia no que está vendo.
                            const foraDaFatia = totalDoDia - naFatia;
                            return (
                              <td key={d} className="px-1 py-1">
                                <div className="relative">
                                  <input inputMode="numeric"
                                    value={naFatia || ""}
                                    placeholder="·"
                                    onFocus={(ev) => ev.target.select()}
                                    onChange={(ev) => setWeekCell(e.id, d, semDiff, semSize, numOf(ev.target.value))}
                                    className={`h-8 w-full rounded border bg-card text-center text-sm font-semibold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 ${foraDaFatia > 0 ? "border-dashed" : ""} ${semDiff === "medio" ? "border-amber-500/40 focus:border-amber-600" : "border-red-500/40 focus:border-red-600"}`}
                                    aria-label={`${e.name} ${fmtDia(d)} — ${DIFF_LABEL[semDiff]} de ${semSize}${foraDaFatia > 0 ? `; mais ${foraDaFatia} pares em outras combinações neste dia` : ""}`} />
                                  {foraDaFatia > 0 && (
                                    <span
                                      className="pointer-events-none absolute -bottom-0.5 right-0.5 font-mono text-[9px] font-bold leading-none text-muted-foreground"
                                      title={`${totalDoDia} pares no dia — ${foraDaFatia} fora de ${DIFF_LABEL[semDiff]} de ${semSize}`}
                                    >+{foraDaFatia}</span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
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
            <label className={lbl}>{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</label>
            <SearchableSelect
              value={filtroMontador}
              onChange={setFiltroMontador}
              options={[{ value: "__all__", label: `Todos os ${cfgSetor.plural}` }, ...montadores.map((e) => ({ value: e.id, label: e.name, description: [e.role, e.department].filter(Boolean).join(" · ") || undefined }))]}
              placeholder={`Todos os ${cfgSetor.plural}`}
              searchPlaceholder={`Buscar ${cfgSetor.sing}...`}
              emptyText={`Nenhum ${cfgSetor.sing} encontrado.`}
            />
          </div>
          {/* Quitação — o que a folha já pagou x o que ainda está em aberto. */}
          <div>
            <label className={lbl}>Pagamento</label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["todos", "aberto", "folha", "pago"] as PagStatus[]).map((s) => (
                <button key={s} type="button" onClick={() => setPagStatus(s)}
                  title={s === "folha" ? "Reivindicado por uma folha aprovada, ainda não pago" : undefined}
                  className={`h-9 px-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    pagStatus === s
                      ? (s === "pago" ? "bg-green-600 text-white"
                        : s === "folha" ? "bg-blue-600 text-white"
                        : s === "aberto" ? "bg-amber-500 text-white"
                        : "bg-foreground text-background")
                      : "bg-card text-muted-foreground hover:bg-muted/40"}`}>
                  {PAG_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{fmtDia(range.from)} – {fmtDia(range.to)}</div>
        </div>
      )}

      {/* ════ PRODUTIVIDADE ════ */}
      {tab === "produtividade" && (
        <div className="space-y-4">
          <StatGrid>
            <StatCard label={cfgSetor.plural.replace(/^./, (c) => c.toUpperCase())} value={String(agg.length)} icon={Users}
              hint={`${totals.fichas.toLocaleString("pt-BR")} fichas`} />
            <StatCard label="Pares" value={totals.pares.toLocaleString("pt-BR")} icon={Package}
              hint={`${totals.medio.toLocaleString("pt-BR")} méd · ${totals.dificil.toLocaleString("pt-BR")} dif`} />
            <StatCard label="Na folha / pago" value={fmtBRL(totals.valorFolha + totals.valorPago)} icon={CheckCircle}
              hint={`${fmtBRL(totals.valorFolha)} aprovado · ${fmtBRL(totals.valorPago)} pago`} />
            <StatCard label="A pagar" value={fmtBRL(totals.valorAberto)} icon={Clock} tone="primary"
              hint={`ainda livre · total ${fmtBRL(totals.valorTotal)}`} />
          </StatGrid>

          <Panel
            eyebrow={`${periodLabel[pMode]} · ${fmtDia(range.from)}–${fmtDia(range.to)}${pagStatus === "todos" ? "" : ` · ${PAG_LABEL[pagStatus]}`}`}
            title={`Rendimento por ${cfgSetor.sing}`}
            subtitle="Valor calculado pelo R$/par gravado em cada lançamento. A taxa se cadastra em Funcionários → Remuneração e entra congelada no apontamento."
            actions={<Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={agg.length === 0}
              onClick={() => imprimirRelatorio({
                rows: agg, totals, setorLabel: cfgSetor.label, oficioPlural: cfgSetor.plural,
                label: periodLabel[pMode], intervalo: `${fmtDia(range.from)} a ${fmtDia(range.to)}`, pagStatus,
              })}><Printer className="h-4 w-4" /> Imprimir relatório</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" style={{ minWidth: 760 }}>
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-3 py-2">{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                    <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Pares méd</th>
                    <th className="px-3 py-2 text-right text-red-600">Pares dif</th>
                    <th className="px-3 py-2 text-right">Pares</th>
                    <th className="px-3 py-2 text-right border-l border-border">R$/par cadastro</th>
                    <th className="px-3 py-2 text-right text-amber-600 border-l border-border">A pagar</th>
                    <th className="px-3 py-2 text-right text-blue-600">Na folha</th>
                    <th className="px-3 py-2 text-right text-green-600">Pago</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Sem lançamentos no período.</td></tr>}
                  {agg.map((r, i) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.nome}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{r.paresMedio.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{r.paresDificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-muted-foreground border-l border-border">
                        {r.taxaMedio > 0 || r.taxaDificil > 0
                          ? <><span className="text-amber-600">{fmtBRL(r.taxaMedio)}</span> · <span className="text-red-600">{fmtBRL(r.taxaDificil)}</span></>
                          : <span className="text-amber-600" title="Sem R$/par cadastrado — a produção fica valorada em zero e a folha não a reivindica.">não cadastrado</span>}
                      </td>
                      {r.porPar ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-600">{r.valorFolha > 0 ? fmtBRL(r.valorFolha) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-600">{r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtBRL(r.valorTotal)}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="px-3 py-2 text-center text-[11px] text-muted-foreground border-l border-border"
                          title="Recebe salário — a produção aqui é medição de produtividade, não pagamento por par.">
                          não se aplica · não é regime por par
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {agg.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/30">
                      <td className="px-3 py-2" /><td className="px-3 py-2">Total ({agg.length})</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600 border-l border-border">{totals.medio.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">{totals.dificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 border-l border-border" />
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600 border-l border-border">{fmtBRL(totals.valorAberto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-600">{fmtBRL(totals.valorFolha)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-600">{fmtBRL(totals.valorPago)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.valorTotal)}</td>
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
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Produção do período</h2>
            {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
            {!loading && <span className="text-xs text-muted-foreground">{fichasFiltradas.length} lançamento(s)</span>}
            <Button
              type="button" size="sm" className="ml-auto gap-1.5"
              disabled={fichasFiltradas.length === 0}
              onClick={gerarCalendario}
              title={`Gera um PDF em calendário: o que cada ${cfgSetor.sing} fez em cada dia do período, com médio/difícil e o que já foi pago.`}
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
                          <th className="px-3 py-2">{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                          <th className="px-3 py-2">Tamanhos (pares)</th>
                          <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Méd</th>
                          <th className="px-3 py-2 text-right text-red-600">Dif</th>
                          <th className="px-3 py-2 text-center border-l border-border">Fichas</th>
                          <th className="px-3 py-2 text-center">Pares</th>
                          <th className="px-3 py-2 text-right border-l border-border">Valor</th>
                          <th className="px-3 py-2 text-center">Pagamento</th>
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
                          const { vm, vd } = ratesOf(f);
                          const valor = pd.medio * vm + pd.dificil * vd;
                          const estado = estadoDe(f);
                          return (
                            <tr key={f.id} className="border-t border-border">
                              <td className="px-3 py-2 font-medium text-foreground">{f.montador || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground tabular-nums">{tamLabel}{!chamada && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">grade</span>}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{pd.medio ? pd.medio.toLocaleString("pt-BR") : "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{pd.dificil ? pd.dificil.toLocaleString("pt-BR") : "—"}</td>
                              <td className="px-3 py-2 text-center font-semibold tabular-nums text-primary border-l border-border">{chamada ? fichasDiaOf(f) : 1}</td>
                              <td className="px-3 py-2 text-center tabular-nums text-foreground">{pd.total.toLocaleString("pt-BR")}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold border-l border-border">
                                {valor > 0 ? fmtBRL(valor) : <span className="text-amber-600" title="Lançamento sem R$/par gravado.">R$ 0,00</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {estado === "pago" ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600"
                                    title={`Pago em ${fmtDia(f.pago_em!)}`}>
                                    <CheckCircle className="h-3 w-3" /> {fmtDia(f.pago_em!)}
                                  </span>
                                ) : estado === "folha" ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600"
                                    title="Reivindicado por uma folha aprovada, ainda não pago. Não pode entrar em outra folha.">
                                    <ClipboardText className="h-3 w-3" /> Na folha
                                  </span>
                                ) : estado === "aberto" ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                                    <Clock className="h-3 w-3" /> A pagar
                                  </span>
                                ) : (
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground"
                                    title="Recebe salário — esta produção é medição de produtividade, não pagamento por par.">—</span>
                                )}
                              </td>
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
      )}
    </div>
  );
}
