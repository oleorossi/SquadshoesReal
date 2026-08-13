// FichaMontadoresPage.tsx — Squad Shoes
// "Ficha de Montadores" → CHAMADA DO DIA: produção diária por setor.
// O trabalhador lança os PARES produzidos por TAMANHO DE FICHA (12 / 15 / 18).
//   · fichas = Σ (pares ÷ tamanho)   · pares = Σ pares
// Roster do setor numa tela (visão Dia) + matriz pessoas × Seg–Dom por tamanho
// (visão Semana). Um único "Salvar" (upsert em lote por dia/pessoa).
//
// Cada par tem DIFICULDADE (Médio âmbar / Difícil verde) que paga R$/par
// diferente: valor_par_medio / valor_par_dificil por pessoa.
// Modelo 'chamada' em public.ficha_montadores: 1 linha por
// (dia, montador_id, setor) com
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useBlocker } from "react-router-dom";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEmployees } from "@/hooks/useEmployees";
import { useAccessControl } from "@/hooks/useAccessControl";
import { PagarProducaoDialog } from "@/components/hr/PagarProducaoDialog";
import { semanaDePagamento, eSemanaFechada } from "@/hooks/useFichaProducaoPagamento";
import { useProductionSectors, useEmployeeSectors } from "@/hooks/useSectorRoster";
import { useUrlTabState } from "@/hooks/useUrlTabState";
import { ratesOfRow, sumProducaoRows, type FichaMontadorRow } from "@/lib/montadorProduction";
import { adjustParesByFicha, fichasFromPares, isFichaLocked, parseParesEntry, rateForEntryCategory } from "@/lib/fichaMontadoresEntry";
import { searchMatchesAllTerms } from "@/lib/searchUtils";
import { toast } from "sonner";
import { Printer, ChartBar, ClipboardText, Users, CurrencyDollar, FloppyDisk, CaretLeft, CaretRight, Warning, CheckCircle, Clock, CalendarBlank, ListBullets, Plus, Minus, LockKey, ArrowDown, X } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";
/** Duas abas: LANÇAR e VER. "Produtividade" e "Relatórios" eram telas separadas
 *  fatiando os MESMOS lançamentos em eixos diferentes — pessoa numa, dia na
 *  outra — com o mesmo filtro, o mesmo motor (`sumProducaoRows`) e o mesmo total.
 *  Quem queria saber "quanto devo ao Jonathan e quando ele produziu" tinha que
 *  alternar entre abas e conferir de cabeça se o filtro era o mesmo dos dois
 *  lados. Unificadas em 07/08/2026 (decisão do dono). */
type Tab = "lancamento" | "producao";
/** Recortes do relatório. Compartilham período e filtros para que a navegação
 *  organize a leitura sem criar três versões do mesmo cálculo. */
type ReportView = "resumo" | "calendario" | "lancamentos";
/** Fallback dos setores por par — usado SÓ quando a view não responde ou não tem
 *  nenhum setor marcado. A fonte de verdade é `sector_settings.pays_by_pair`
 *  (via v_production_sectors), não esta lista: a Ficha roda a mesma dinâmica nos
 *  11 setores e qualquer um pode passar a pagar por par com um clique no
 *  cadastro, sem deploy. Sem o fallback, uma falha de leitura deixaria a tela sem
 *  aba nenhuma e ninguém conseguiria lançar produção. */
const SETORES_POR_PAR_FALLBACK = ["montagem", "solagem"] as const;
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
  atualizado_em?: string | null;
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
const WD_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const weekdayName = (iso: string) => WD_FULL[(new Date(iso + "T00:00:00").getDay() + 6) % 7] || "";
/** Os 7 dias da semana da data, SEGUNDA a DOMINGO.
 *
 *  Eram 5 (Seg–Sex) e isso escondia produção que É paga: a semana de folha é
 *  seg→dom, e o histórico tem 4 lançamentos em sábado (20/06 e 27/06) somando
 *  R$ 517,20 que a matriz não exibia nem deixava editar — só apareciam na visão
 *  Dia ou no calendário. Pior, `dataRange` monta o intervalo de BUSCA a partir
 *  daqui: com 5 dias, o sábado nem era carregado do banco.
 *
 *  ⚠ Isto alimenta três coisas ao mesmo tempo — a matriz semanal, o rótulo da
 *  semana e o intervalo de busca. Mexer no comprimento propaga para os três.
 *
 *  DERIVA de `semanaDePagamento`, a mesma função que monta `payroll_runs.period`.
 *  Não é estilo: assim a semana que se LANÇA e a que se PAGA não podem divergir
 *  por construção — não há dois cálculos para sair de sincronia. */
function weekDaysOf(iso: string) {
  const ini = new Date(semanaDePagamento(iso).from + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(ini); x.setDate(ini.getDate() + i); return isoOf(x); });
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

/** Intervalo {from,to} (ISO) do período da aba Produção.
 *  `semAnchor` é a semana que o usuário está olhando — a MESMA âncora da
 *  Chamada do dia, pra lançar e pagar nunca apontarem para semanas diferentes. */
function periodRange(mode: PeriodMode, cFrom: string, cTo: string, semAnchor: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  switch (mode) {
    case "hoje": { const t = todayISO(); return { from: t, to: t }; }
    // Seg→Dom, do mesmo helper que a folha usa pra montar o período — a janela
    // exibida aqui É a que vira `payroll_runs.period` ao pagar. Duas definições
    // de "semana" fariam a tela mostrar um intervalo e a folha cobrar outro.
    case "semana": return semanaDePagamento(semAnchor);
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
/** `pago` na célula = o dia já foi quitado por uma folha (payroll_run_id). */
interface CalCell { pares: number; medio: number; dificil: number; fichas: number; pago: boolean; }
interface CalRow {
  key: string; nome: string; cells: Record<string, CalCell>;
  medio: number; dificil: number; pares: number; fichas: number;
  valorPago: number; valorAberto: number; valorTotal: number;
}

/* ---------- RELATÓRIO ÚNICO (A4 paisagem): rendimento + calendário ----------
 * Eram dois botões e dois documentos — "Imprimir relatório" (retrato, por
 * pessoa) e "Calendário em PDF" (paisagem, pessoa × dia). Quem conferia a
 * semana precisava gerar os dois e juntar no grampo. Agora é um documento só
 * (decisão do dono, 07/08/2026): o rendimento em cima, o calendário embaixo,
 * mesmo período e mesmo filtro.
 *
 * PAISAGEM porque o calendário manda: ele tem uma coluna por DIA do período —
 * 7 numa semana, até 31 num mês. A tabela de rendimento tem 9 colunas e cabe
 * folgada em paisagem; o contrário não é verdade.
 *
 * ⚠ Os seletores de tabela são NAMESPACED (.rend / .cal). Os dois documentos
 * tinham CSS próprio com os mesmos seletores genéricos (table, th, td); juntar
 * sem escopo faria um reescrever o outro em silêncio. */
function imprimirRelatorio(p: {
  rows: AggRow[]; totals: AggTotals; setorLabel: string; oficioPlural: string; oficioLabel: string;
  label: string; intervalo: string; pagStatus: PagStatus;
  cal: { rows: CalRow[]; days: string[] };
}) {
  const { rows, totals } = p;
  const nf = (n: number) => (Number(n) || 0).toLocaleString("pt-BR");

  // O DIFÍCIL SÓ EXISTE NO PAPEL SE EXISTIR NO PERÍODO (decisão do dono,
  // 07/08/2026). Sem nenhum par difícil, some o PAR de colunas: "méd" sozinha
  // seria cópia exata de "Pares", e duas colunas com o mesmo número é pior que
  // nenhuma. Uma decisão só, aplicada às duas tabelas.
  const temDificil = totals.dificil > 0;
  const colsDiff = temDificil ? 2 : 0;

  const filtro = {
    todos: "Mostrando toda a produção do período.",
    aberto: "Filtrado: SOMENTE produção ainda livre, que nenhuma folha reivindicou.",
    folha: "Filtrado: SOMENTE produção reivindicada por folha aprovada e ainda não paga.",
    pago: "Filtrado: SOMENTE produção já paga.",
    na: "Filtrado: SOMENTE quem não é regime por par (produção como medição).",
  }[p.pagStatus];

  // ── 1. Rendimento por pessoa ──────────────────────────────────────────────
  const bodyRend = rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.nome)}</td><td class="n">${r.fichas}</td>`
    + (temDificil ? `<td class="n med">${r.paresMedio}</td><td class="n dif">${r.paresDificil || "—"}</td>` : "")
    + `<td class="n">${r.pares}</td>`
    + (r.porPar
      ? `<td class="n ab">${r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</td>`
        + `<td class="n fl">${r.valorFolha > 0 ? fmtBRL(r.valorFolha) : "—"}</td>`
        + `<td class="n pg">${r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</td>`
        + `<td class="n">${fmtBRL(r.valorTotal)}</td>`
      : `<td class="n na" colspan="4">não é regime por par</td>`)
    + `</tr>`).join("");

  // ── 2. Calendário pessoa × dia ────────────────────────────────────────────
  const { rows: cRows, days } = p.cal;
  const dayHead = days.map((d) => {
    const we = dowIdx(d) >= 5;
    return `<th class="day${we ? " we" : ""}">${WD_SHORT7[dowIdx(d)]}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`;
  }).join("");
  const bodyCal = cRows.map((r) => {
    const cells = days.map((d) => {
      const c = r.cells[d]; const we = dowIdx(d) >= 5;
      if (!c || c.pares <= 0) return `<td class="c${we ? " we" : ""}">·</td>`;
      // Com uma dificuldade só, o split embaixo repetiria o número grande acima.
      const sp = temDificil
        ? [c.medio > 0 ? `<span class="med">${c.medio}</span>` : "", c.dificil > 0 ? `<span class="dif">${c.dificil}</span>` : ""].filter(Boolean).join("<span class='x'>·</span>")
        : "";
      return `<td class="c has${we ? " we" : ""}${c.pago ? "" : " ab"}"><b>${c.pares}</b>${sp ? `<div class="sp">${sp}</div>` : ""}</td>`;
    }).join("");
    return `<tr><td class="mont">${esc(r.nome)}</td>${cells}`
      + (temDificil ? `<td class="n med">${r.medio || "—"}</td><td class="n dif">${r.dificil || "—"}</td>` : "")
      + `<td class="n b">${nf(r.pares)}</td><td class="n f">${r.fichas}</td>`
      + `<td class="n pgo">${r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</td>`
      + `<td class="n abt">${r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</td></tr>`;
  }).join("");
  const dayTot = days.map((d) => {
    const s = cRows.reduce((a, r) => a + (r.cells[d]?.pares || 0), 0);
    return `<td class="c${dowIdx(d) >= 5 ? " we" : ""}">${s || ""}</td>`;
  }).join("");
  const tMed = cRows.reduce((s, r) => s + r.medio, 0), tDif = cRows.reduce((s, r) => s + r.dificil, 0);
  const tPar = cRows.reduce((s, r) => s + r.pares, 0), tFic = cRows.reduce((s, r) => s + r.fichas, 0);
  const tPago = cRows.reduce((s, r) => s + r.valorPago, 0);
  const tAberto = cRows.reduce((s, r) => s + r.valorAberto, 0);

  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:17px;margin:0 0 2px} .sub{font-size:10.5px;color:#555;margin-bottom:3px}
    .filtro{font-size:9.5px;color:#555;margin-bottom:10px}
    .kpis{display:grid;grid-template-columns:1.2fr repeat(3,1fr);border:1px solid #333;margin:8px 0 12px}
    .kpi{padding:7px 9px;border-right:1px solid #bbb}.kpi:last-child{border-right:0}.kpi.total{background:#111;color:#fff}
    .kpi small{display:block;font-size:7.5px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px}.kpi.total small{color:#bbb}
    .kpi b{display:block;font-size:13px;font-variant-numeric:tabular-nums}.kpi span{font-size:8px;color:#777}.kpi.total span{color:#ccc}
    .kpi.open b{color:#b45309}.kpi.sheet b{color:#1d4ed8}.kpi.paid b{color:#15803d}
    h2{font-size:12px;margin:14px 0 5px;text-transform:uppercase;letter-spacing:.06em;color:#333;border-bottom:1.5px solid #333;padding-bottom:2px}
    section{break-inside:avoid}
    .med{color:#b45309} .dif{color:#0f7a4a} .pg{color:#15803d} .ab{color:#b45309} .fl{color:#1d4ed8}
    /* ── rendimento por pessoa ── */
    .rend table{width:100%;border-collapse:collapse;font-size:11px}
    .rend th,.rend td{border:1px solid #333;padding:4px 7px}
    .rend th{background:#f1f0ed;text-align:left;font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#444}
    .rend td.n{text-align:right;font-variant-numeric:tabular-nums} .rend tfoot td{font-weight:800;background:#f6f5f2}
    .rend td.na{text-align:center;color:#888;font-size:9.5px}
    /* ── calendário pessoa × dia ── */
    .cal table{width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed}
    .cal th,.cal td{border:1px solid #bbb;padding:2px 3px;text-align:center;overflow:hidden}
    .cal th{background:#f1f0ed;font-size:8px;text-transform:uppercase;color:#444}
    .cal th.day{width:22px;line-height:1.05} .cal th.day.we,.cal td.c.we{background:#f4f2ee}
    .cal td.mont,.cal th.mont{text-align:left;font-weight:700;white-space:nowrap;width:96px;background:#fafafa}
    .cal td.c{color:#bbb} .cal td.c.has{color:#111} .cal td.c b{font-size:9px;font-weight:800} .cal td.c .sp{font-size:6.5px;line-height:1}
    .cal td.c.ab{background:#fff7ed} .cal td.c.ab.we{background:#f7efe4}
    .cal td.c .med{color:#b45309;font-weight:700} .cal td.c .dif{color:#0f7a4a;font-weight:700} .cal td.c .x{color:#bbb;margin:0 1px}
    .cal td.n{text-align:right;font-variant-numeric:tabular-nums;width:34px}
    .cal td.n.med{color:#b45309;font-weight:700} .cal td.n.dif{color:#0f7a4a;font-weight:700}
    .cal td.n.b{font-weight:800} .cal td.n.pgo{font-weight:800;width:56px;color:#15803d} .cal td.n.abt{font-weight:800;width:56px;color:#b45309}
    .cal td.n.f{color:#1d4ed8;font-weight:700;width:28px}
    .cal th.sum{background:#e9e7e2}
    .cal tfoot td{font-weight:800;background:#f6f5f2} .cal tfoot td.c{color:#111}
    .lg{font-size:8.5px;color:#555;margin:4px 0 0} .lg b.med{color:#b45309} .lg b.dif{color:#0f7a4a}
    @page{size:A4 landscape;margin:9mm}`;

  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório — ${esc(p.setorLabel)}</title><style>${css}</style></head><body>
    <h1>Produção e pagamento — ${esc(p.setorLabel)}</h1>
    <div class="sub">${esc(p.label)} · ${esc(p.intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <div class="filtro">${esc(filtro)} Valores calculados pelo R$/par gravado em cada lançamento.</div>

    <div class="kpis">
      <div class="kpi total"><small>Total do período</small><b>${fmtBRL(totals.valorTotal)}</b><span>${nf(totals.pares)} pares · ${nf(totals.fichas)} fichas · ${rows.length} pessoa(s)</span></div>
      <div class="kpi open"><small>A pagar</small><b>${fmtBRL(totals.valorAberto)}</b><span>livre para fechar</span></div>
      <div class="kpi sheet"><small>Na folha</small><b>${fmtBRL(totals.valorFolha)}</b><span>aprovado, não quitado</span></div>
      <div class="kpi paid"><small>Pago</small><b>${fmtBRL(totals.valorPago)}</b><span>sem pendência</span></div>
    </div>

    <section class="rend">
      <h2>Rendimento por ${esc(p.oficioPlural)}</h2>
      <table><thead><tr><th>${esc(p.oficioPlural.replace(/^./, (c) => c.toUpperCase()))}</th><th style="text-align:right">Fichas</th>
        ${temDificil ? '<th style="text-align:right" class="med">Pares méd</th><th style="text-align:right" class="dif">Pares dif</th>' : ""}
        <th style="text-align:right">Pares</th>
        <th style="text-align:right" class="ab">A pagar</th><th style="text-align:right" class="fl">Na folha</th>
        <th style="text-align:right" class="pg">Pago</th>
        <th style="text-align:right">Total</th></tr></thead>
      <tbody>${bodyRend || `<tr><td colspan="${7 + colsDiff}" style="text-align:center;color:#888">Sem dados no período.</td></tr>`}</tbody>
      <tfoot><tr><td>TOTAL (${rows.length})</td><td class="n">${totals.fichas}</td>
        ${temDificil ? `<td class="n med">${totals.medio}</td><td class="n dif">${totals.dificil}</td>` : ""}
        <td class="n">${totals.pares}</td>
        <td class="n ab">${fmtBRL(totals.valorAberto)}</td><td class="n fl">${fmtBRL(totals.valorFolha)}</td>
        <td class="n pg">${fmtBRL(totals.valorPago)}</td>
        <td class="n">${fmtBRL(totals.valorTotal)}</td></tr></tfoot></table>
    </section>

    <section class="cal">
      <h2>Calendário — o que cada ${esc(p.oficioLabel.toLowerCase())} fez em cada dia</h2>
      <table>
        <thead><tr><th class="mont">${esc(p.oficioLabel)}</th>${dayHead}${temDificil ? '<th class="sum">Méd</th><th class="sum">Dif</th>' : ""}<th class="sum">Pares</th><th class="sum">Fichas</th><th class="sum">Pago</th><th class="sum">A pagar</th></tr></thead>
        <tbody>${bodyCal || `<tr><td colspan="${days.length + (temDificil ? 7 : 5)}" style="text-align:center;color:#888;padding:12px">Sem lançamentos no período.</td></tr>`}</tbody>
        <tfoot><tr><td class="mont">TOTAL (${cRows.length})</td>${dayTot}${temDificil ? `<td class="n med">${nf(tMed)}</td><td class="n dif">${nf(tDif)}</td>` : ""}<td class="n b">${nf(tPar)}</td><td class="n f">${tFic}</td><td class="n pgo">${fmtBRL(tPago)}</td><td class="n abt">${fmtBRL(tAberto)}</td></tr></tfoot>
      </table>
      <div class="lg">Cada célula = <b>pares do dia</b>${temDificil ? '; embaixo o split <b class="med">médio</b> · <b class="dif">difícil</b>' : ""}. Célula com fundo claro = dia <b>ainda não pago</b>. Colunas cinza = fim de semana.</div>
    </section>

    <script>window.onload=function(){window.focus();window.print();};</script></body></html>`);
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

interface FichaCounterProps {
  value: number;
  tamanho: number;
  diff: Diff;
  pessoa: string;
  locked?: boolean;
  onChange: (value: number) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Contador da bancada: os botões acompanham a ficha FÍSICA, mas o campo e o
 * estado continuam em PARES. Assim a interação fica rápida sem trocar a unidade
 * do domínio nem esconder lançamentos incompletos.
 */
function FichaCounter({ value, tamanho, diff, pessoa, locked, onChange, onKeyDown }: FichaCounterProps) {
  const medio = diff === "medio";
  const fichasCount = fichasFromPares(value, tamanho);
  const tone = medio
    ? "border-amber-500/40 bg-amber-500/[0.045] focus-within:border-amber-600"
    : "border-green-600/40 bg-green-600/[0.045] focus-within:border-green-600";
  const accent = medio ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400";

  const parse = (raw: string) => {
    const parsed = parseParesEntry(raw, tamanho);
    if (parsed == null) {
      toast.error(`Use pares inteiros ou a abreviação de ficha, por exemplo: 7f = ${7 * tamanho} pares.`);
      return;
    }
    onChange(parsed);
  };

  return (
    <div className={`inline-grid min-w-[190px] grid-cols-[44px_minmax(88px,1fr)_44px] overflow-hidden rounded-lg border transition-colors ${locked ? "border-border bg-muted/50 opacity-70" : tone}`}>
      <button type="button" disabled={locked || value < tamanho}
        onClick={() => onChange(adjustParesByFicha(value, tamanho, -1))}
        className="flex min-h-11 items-center justify-center border-r border-border/70 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
        aria-label={`Remover uma ficha de ${tamanho} pares de ${pessoa}`}>
        <Minus className="h-4 w-4" weight="bold" />
      </button>
      <label className="relative flex min-w-0 flex-col items-center justify-center bg-background/75 px-1 py-1">
        <span className="sr-only">Pares de {DIFF_LABEL[diff]}, ficha {tamanho}, {pessoa}</span>
        <input inputMode="numeric" enterKeyHint="next" readOnly={locked}
          value={value || ""} placeholder="0"
          onFocus={(event) => event.target.select()}
          onChange={(event) => parse(event.target.value)}
          onKeyDown={onKeyDown}
          data-ficha-entry={`${diff}-${tamanho}`}
          className="h-6 w-full bg-transparent text-center font-mono text-base font-bold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/35 read-only:cursor-not-allowed"
          aria-label={`${DIFF_LABEL[diff]} · ficha de ${tamanho} pares — ${pessoa}${locked ? " (fechado pela folha, somente leitura)" : ""}`} />
        <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${accent}`}>
          {fichasCount} {fichasCount === 1 ? "ficha" : "fichas"} · pares
        </span>
      </label>
      <button type="button" disabled={locked}
        onClick={() => onChange(adjustParesByFicha(value, tamanho, 1))}
        className="flex min-h-11 flex-col items-center justify-center border-l border-border/70 text-foreground transition-colors hover:bg-background/70 disabled:cursor-not-allowed disabled:opacity-35"
        aria-label={`Adicionar uma ficha de ${tamanho} pares para ${pessoa}`}>
        <Plus className="h-4 w-4" weight="bold" />
        <span className="font-mono text-[8px] font-bold uppercase tracking-wider">1 ficha</span>
      </button>
    </div>
  );
}

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  const db = supabase;
  const { value: tab, setValue: setTab } = useUrlTabState<Tab>({
    values: ["lancamento", "producao"],
    defaultValue: "lancamento",
    aliases: { produtividade: "producao", relatorios: "producao" },
    migrateFrom: "ficha-montadores-tab",
  });
  const [reportView, setReportView] = useState<ReportView>("resumo");
  // Setores do fluxo (v_production_sectors, em flow_order) filtrados pelos que são
  // pagos por par. O RÓTULO continua vindo do banco (não hard-coded); só a seleção
  // de QUAIS setores aparecem é desta tela — ela cobre pagamento por produção, e
  // não o fluxo inteiro. Fallback se a view não trouxer um deles: mostra assim
  // mesmo, com o rótulo capitalizado, pra a aba nunca sumir por falha de cadastro.
  const { data: allSectors = [] } = useProductionSectors();
  const sectors = useMemo(() => {
    const porPar = allSectors.filter((s) => s.paysByPair);
    if (porPar.length) return porPar;
    const byKey = new Map(allSectors.map((s) => [s.key, s]));
    return SETORES_POR_PAR_FALLBACK.map((key) =>
      byKey.get(key) ?? {
        key, label: key.replace(/^./, (c) => c.toUpperCase()),
        flowOrder: 0, headcount: null, paysByPair: true,
        // No fallback, a Solagem segue sem dificuldade — mesmo estado do banco.
        paysByDifficulty: key !== "solagem",
      },
    );
  }, [allSectors]);
  // Setor ativo — abas independentes na mesma tela, dados separados por
  // ficha_montadores.setor (que guarda a CHAVE canônica).
  const [setor, setSetor] = useState<string>("montagem");
  // Se o setor ativo deixar de pagar por par (desmarcado no cadastro), a aba
  // some e `setor` ficaria apontando pro nada — a tela mostraria roster vazio
  // sem dizer por quê. Cai no primeiro setor disponível.
  useEffect(() => {
    if (sectors.length && !sectors.some((s) => s.key === setor)) setSetor(sectors[0].key);
  }, [sectors, setor]);
  const cfgSetor = useMemo(() => {
    const s = sectors.find((x) => x.key === setor);
    return {
      id: setor, label: s?.label ?? "Setor",
      // DEFAULT true no banco; na dúvida mostra a dificuldade (não esconde dado).
      paysByDifficulty: s?.paysByDifficulty !== false,
      ...oficioOf(setor),
    };
  }, [sectors, setor]);
  /** Dificuldades que este setor usa. Solagem = taxa única → só "médio". */
  const diffsAtivos = useMemo<Diff[]>(
    () => (cfgSetor.paysByDifficulty ? DIFFS : ["medio"]),
    [cfgSetor.paysByDifficulty],
  );

  // ── chamada do dia / semana ──
  const [chamadaView, setChamadaView] = useState<ChamadaView>("dia");
  const [chamadaDia, setChamadaDia] = useState(todayISO());
  // Âncora ÚNICA da semana: serve à matriz de lançamento E ao período da aba
  // Produção. Uma noção só de "a semana que estou olhando" — lançar numa semana
  // e pagar outra por descuido deixa de ser possível.
  const [semanaAnchor, setSemanaAnchor] = useState(todayISO());
  const deslocarSemana = useCallback((semanas: number) => {
    setSemanaAnchor((a) => isoOf(new Date(new Date(a + "T00:00:00").getTime() + semanas * 7 * 864e5)));
  }, []);
  const [semSize, setSemSize] = useState<number>(12);
  // Não há mais "dificuldade ativa": médio e difícil aparecem juntos na semana,
  // e o setor de taxa única (Solagem) simplesmente não renderiza a faixa verde.
  // Mostrar as 6 combinações (3 tamanhos × 2 dificuldades) na visão Dia. Fica
  // FECHADO por padrão: ficha 15/18 e par difícil existem, mas são raros — em
  // todo o histórico nenhum foi lançado. Deixá-los sempre à vista cobrava 6
  // campos por pessoa/dia pra preencher 1. Ver `colunasDia` abaixo: a coluna
  // rara aparece sozinha quando JÁ tem número, mesmo com o detalhe fechado, pra
  // nenhum lançamento existente ficar invisível.
  const [detalharDia, setDetalharDia] = useState(false);
  // A régua ativa espelha a ficha que está na mão do encarregado. Trocar a
  // régua não altera dados; só muda qual combinação recebe os cliques rápidos.
  const [diaSize, setDiaSize] = useState<number>(12);
  const [diaDiff, setDiaDiff] = useState<Diff>("medio");
  useEffect(() => {
    if (!diffsAtivos.includes(diaDiff)) setDiaDiff("medio");
  }, [diffsAtivos, diaDiff]);
  const [busca, setBusca] = useState("");
  // Dia: pares por montador por dificuldade × tamanho
  const [pares, setPares] = useState<Record<string, DiffSizeMap>>({});
  const [origPares, setOrigPares] = useState<Record<string, DiffSizeMap>>({});
  // Semana: pares por (montador|dia) por dificuldade × tamanho
  const [week, setWeek] = useState<Record<string, DiffSizeMap>>({});
  const [origWeek, setOrigWeek] = useState<Record<string, DiffSizeMap>>({});
  const [savingDia, setSavingDia] = useState(false);
  const [savingSem, setSavingSem] = useState(false);
  const [confirmarZerar, setConfirmarZerar] = useState<ChamadaView | null>(null);
  const [confirmarDescartarDock, setConfirmarDescartarDock] = useState(false);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const loadRequestRef = useRef(0);

  // ── filtro de período (Produtividade + Relatórios) ──
  // Declarado aqui em cima, antes do carregamento, porque a busca no banco é
  // recortada por data: o intervalo que a tela consegue exibir sai da união
  // destes filtros com o dia/semana da Chamada.
  // SEMANA é o padrão: a cadência de pagamento de montador e solador é semanal
  // (decisão do dono, 07/08/2026), e é esta janela que vira o período da folha
  // quando se paga por aqui. Abrir na quinzena convidava a pagar a janela errada.
  const [pMode, setPMode] = useState<PeriodMode>("semana");
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const range = useMemo(() => periodRange(pMode, cFrom, cTo, semanaAnchor), [pMode, cFrom, cTo, semanaAnchor]);
  /** A janela é uma SEMANA FECHADA (segunda + 6 dias)? Habilita o pagamento.
   *  Validado pelo VALOR das datas, não pelo botão clicado: digitar 15/06–21/06
   *  no Personalizado é a mesma janela que o preset "semana" produz, e recusar
   *  uma e aceitar a outra seria arbitrário. Pagar fora de semana fecharia a
   *  janela inteira contra as semanais (tg_payroll_block_period_overlap). */
  const janelaESemanaFechada = useMemo(
    () => eSemanaFechada(range.from, range.to), [range.from, range.to],
  );

  // ── dados ──
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);

  /** Intervalo a buscar = união do que TODAS as abas podem mostrar (dia da
   *  chamada, semana ancorada e período dos relatórios), com 1 dia de folga em
   *  cada ponta. Navegar para um dia JÁ dentro do intervalo não muda a união e
   *  não refaz a busca; sair dele (passar do fim do período, por exemplo) refaz
   *  — que é o correto, senão a tela mostraria um dia sem os lançamentos dele. */
  const dataRange = useMemo(() => {
    const wd = weekDaysOf(semanaAnchor);
    // wd[6] = domingo. Com wd[4] (sexta) o fim de semana ficava FORA do intervalo
    // buscado: o sábado nem chegava do banco, então não aparecia em lugar nenhum.
    const cands = [chamadaDia, wd[0], wd[6], range.from, range.to].filter(Boolean) as string[];
    const shift = (iso: string, days: number) =>
      isoOf(new Date(new Date(iso + "T00:00:00").getTime() + days * 864e5));
    return { from: shift(cands.reduce((a, b) => (a < b ? a : b)), -1), to: shift(cands.reduce((a, b) => (a > b ? a : b)), 1) };
  }, [chamadaDia, semanaAnchor, range.from, range.to]);

  const { data: employees = [] } = useEmployees();
  const { data: employeeSectors = [] } = useEmployeeSectors();
  // Ver a produção e o status pago/a pagar é do módulo 'ficha_montadores'; APERTAR
  // o botão que paga é do módulo 'ficha_pagamento', concedido à parte. Sem essa
  // separação, 'producao', 'rh' e até 'consulta' (somente-leitura) — todos com
  // ficha_montadores — passariam a poder registrar pagamento de salário.
  const { canAccessModule } = useAccessControl();
  const podePagarProducao = canAccessModule("ficha_pagamento");
  const [pagarAlvo, setPagarAlvo] = useState<{ id: string; nome: string; valor: number } | null>(null);

  // Trabalhadores do SETOR ativo, pela view canônica (department + alocação
  // explícita, normalizados por capacity_sector_key). Carrega junto o R$/par do
  // cadastro, que é a fonte do snapshot no apontamento.
  const colaboradoresDoSetor = useMemo(
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

  // A chamada é o livro que alimenta a folha por produção. Por isso só mostra
  // quem realmente recebe por par: mensalistas lotados em Montagem/Solagem não
  // podem receber um lançamento que pareça pagar produção mas não entra no
  // cálculo. Lançamentos históricos deles continuam visíveis nos relatórios.
  const montadores = useMemo(
    () => colaboradoresDoSetor.filter((employee) => String(employee.payment_type || "").toLowerCase() === "producao"),
    [colaboradoresDoSetor],
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
      .filter((e) => e.active && String(e.payment_type || "").toLowerCase() === "producao")
      .map((e) => {
        const lot = lotacao.get(e.id);
        const foraDosSetores = !lot || !sectors.some((s) => s.key === lot.key);
        const semTaxa = !(Number(e.valor_par_medio) > 0);
        return { id: e.id, name: e.name, lotacao: lot?.label || null, foraDosSetores, semTaxa };
      })
      .filter((p) => p.foraDosSetores || p.semTaxa)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [employees, employeeSectors, sectors]);

  const carregar = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    // Invalida imediatamente o snapshot do contexto anterior. Sem isto, ao
    // trocar Montagem por Solagem a tela ainda podia semear por alguns frames os
    // lançamentos antigos (ou mantê-los se a leitura nova falhasse).
    setFichas([]);
    setPares({}); setOrigPares({});
    setWeek({}); setOrigWeek({});
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
    // Troca rápida de setor/período pode inverter a ordem das respostas.
    // Uma resposta velha nunca pode reidratar o rascunho do contexto novo.
    if (requestId !== loadRequestRef.current) return;
    if (error) {
      setFichas([]);
      setPares({}); setOrigPares({});
      setWeek({}); setOrigWeek({});
      toast.error("Erro ao carregar: " + error.message);
    } else setFichas((data ?? []) as unknown as Ficha[]);
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
  const setPS = (mid: string, diff: Diff, sz: number, v: number) => {
    setSalvoEm(null);
    setPares((p) => {
      const cur = p[mid] || emptyDiffMap();
      return { ...p, [mid]: { ...cur, [diff]: { ...cur[diff], [sz]: Math.max(0, v) } } };
    });
  };
  // ── helpers Semana ──
  // Memoizado porque `valorSemanaDe` depende dele: sem isto a identidade mudava
  // a cada render e o useCallback de baixo recriava sempre, à toa.
  const weekMap = useCallback(
    (mid: string, day: string): DiffSizeMap => week[`${mid}|${day}`] || emptyDiffMap(),
    [week],
  );
  const setWeekCell = (mid: string, day: string, diff: Diff, sz: number, v: number) => {
    setSalvoEm(null);
    setWeek((w) => {
      const k = `${mid}|${day}`; const cur = w[k] || emptyDiffMap();
      return { ...w, [k]: { ...cur, [diff]: { ...cur[diff], [sz]: Math.max(0, v) } } };
    });
  };

  const rosterFiltrado = useMemo(
    () => montadores.filter((e) => searchMatchesAllTerms(busca, e.name, e.role, e.department, e.external_id)),
    [montadores, busca],
  );

  /** A régua mostra uma combinação por vez no fluxo rápido. A grade completa
   *  continua disponível para conferência e exceções. */
  const colunasDia = useMemo(() => {
    if (!detalharDia) return [{ sz: diaSize, diff: diaDiff }];
    const cols: { sz: number; diff: Diff }[] = [];
    for (const sz of SIZES) {
      for (const diff of DIFFS) {
        // Setor de taxa única (Solagem) não oferece a coluna Difícil — lançar
        // ali valoraria o par a R$ 0,00 em silêncio, porque não há R$/par
        // difícil cadastrado. A coluna ainda aparece se JÁ houver número nela,
        // pra um lançamento existente nunca ficar invisível.
        const temDado = montadores.some((e) => ((pares[e.id] || emptyDiffMap())[diff][sz] || 0) > 0);
        if (!diffsAtivos.includes(diff) && !temDado) continue;
        cols.push({ sz, diff });
      }
    }
    return cols;
  }, [montadores, pares, detalharDia, diffsAtivos, diaSize, diaDiff]);

  const foraDaRegua = useMemo(() => montadores.reduce((sum, employee) => {
    const dm = pares[employee.id] || emptyDiffMap();
    return sum + SIZES.reduce((sizeSum, size) => sizeSum + DIFFS.reduce(
      (diffSum, diff) => diffSum + (size === diaSize && diff === diaDiff ? 0 : (dm[diff][size] || 0)),
      0,
    ), 0);
  }, 0), [montadores, pares, diaSize, diaDiff]);

  const totalDiaPares = useMemo(() => montadores.reduce((sum, employee) => sum + paresOfDiffMap(pares[employee.id] || emptyDiffMap()), 0), [montadores, pares]);
  const totalDiaFichas = useMemo(() => montadores.reduce((sum, employee) => sum + fichasOfDiffMap(pares[employee.id] || emptyDiffMap()), 0), [montadores, pares]);
  const reguaPares = useMemo(
    () => montadores.reduce((sum, employee) => sum + ((pares[employee.id] || emptyDiffMap())[diaDiff][diaSize] || 0), 0),
    [montadores, pares, diaDiff, diaSize],
  );
  const reguaFichas = useMemo(
    () => montadores.reduce((sum, employee) => sum + fichasFromPares((pares[employee.id] || emptyDiffMap())[diaDiff][diaSize] || 0, diaSize), 0),
    [montadores, pares, diaDiff, diaSize],
  );
  const dirtyDia = useMemo(
    () => montadores.filter((e) => JSON.stringify(pares[e.id] || emptyDiffMap()) !== JSON.stringify(origPares[e.id] || emptyDiffMap())).length,
    [montadores, pares, origPares],
  );
  const dirtyDiaVisivel = useMemo(
    () => rosterFiltrado.filter((e) => JSON.stringify(pares[e.id] || emptyDiffMap()) !== JSON.stringify(origPares[e.id] || emptyDiffMap())).length,
    [rosterFiltrado, pares, origPares],
  );
  const deltaDiaPares = useMemo(() => {
    const original = montadores.reduce((sum, employee) => sum + paresOfDiffMap(origPares[employee.id] || emptyDiffMap()), 0);
    return totalDiaPares - original;
  }, [montadores, origPares, totalDiaPares]);

  const weekDays = useMemo(() => weekDaysOf(semanaAnchor), [semanaAnchor]);
  /** (montador|dia) reivindicado por uma folha OU já pago. Nos dois estados o
   *  apontamento está fechado: mudar pares quebraria o snapshot da folha. */
  const diaFechado = useMemo(() => {
    const s = new Map<string, "folha" | "pago">();
    for (const f of fichas) {
      if (!f.montador_id || !isFichaLocked(f)) continue;
      s.set(`${f.montador_id}|${f.dia}`, f.pago_em ? "pago" : "folha");
    }
    return s;
  }, [fichas]);
  const weekLabel = `${fmtDia(weekDays[0])} – ${fmtDia(weekDays[6])}`;
  const semParesTotal = useMemo(() => Object.values(week).reduce((s, m) => s + paresOfDiffMap(m), 0), [week]);
  const semFichasTotal = useMemo(() => Object.values(week).reduce((s, m) => s + fichasOfDiffMap(m), 0), [week]);
  const dirtySem = useMemo(() => {
    let total = 0;
    for (const employee of montadores) {
      for (const day of weekDays) {
        const key = `${employee.id}|${day}`;
        if (JSON.stringify(week[key] || emptyDiffMap()) !== JSON.stringify(origWeek[key] || emptyDiffMap())) total += 1;
      }
    }
    return total;
  }, [montadores, weekDays, week, origWeek]);
  const deltaSemPares = useMemo(() => {
    const original = Object.values(origWeek).reduce((sum, map) => sum + paresOfDiffMap(map), 0);
    return semParesTotal - original;
  }, [origWeek, semParesTotal]);
  const existingChamada = useMemo(() => {
    const byKey = new Map<string, Ficha>();
    for (const ficha of fichas) {
      if (isChamada(ficha) && ficha.montador_id) byKey.set(`${ficha.montador_id}|${ficha.dia}`, ficha);
    }
    return byKey;
  }, [fichas]);
  const temRascunho = dirtyDia > 0 || dirtySem > 0;
  const confirmarDescarte = useCallback(() => (
    !temRascunho || window.confirm("Há lançamentos não salvos. Descartar as alterações e mudar de contexto?")
  ), [temRascunho]);
  const limparContextoCarregado = useCallback(() => {
    // A próxima consulta é assíncrona; a interface não deve continuar exibindo
    // nem reutilizar fichas que pertenciam ao setor/período anterior.
    loadRequestRef.current += 1;
    setLoading(true);
    setFichas([]);
    setPares({}); setOrigPares({});
    setWeek({}); setOrigWeek({});
    setSalvoEm(null);
  }, []);

  // Protege links, Voltar e qualquer outra navegação do router. Trocas de
  // setor/data são estado local e usam confirmarDescarte diretamente.
  const navigationBlocker = useBlocker(temRascunho);
  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (window.confirm("Há lançamentos não salvos. Sair desta tela e descartá-los?")) {
      setPares(origPares);
      setWeek(origWeek);
      navigationBlocker.proceed();
    } else navigationBlocker.reset();
  }, [navigationBlocker, origPares, origWeek]);
  useEffect(() => {
    if (!temRascunho) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [temRascunho]);

  const fichasHoje = useMemo(() => {
    const t = todayISO();
    return fichas.filter((f) => isChamada(f) && f.dia === t).reduce((s, f) => s + fichasDiaOf(f), 0);
  }, [fichas]);

  // Regime de cada pessoa — decide se a produção dela é PAGAMENTO ou só medição.
  // Vem de employees (não do roster do setor) pra cobrir também quem lançou
  // produção num setor e depois foi transferido pra outro.
  const regimePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, String(e.payment_type || "mensalista").toLowerCase());
    return m;
  }, [employees]);

  /** Grava o lote em UMA transação no banco. A RPC valida a estrutura, preserva
   *  snapshots antigos e aplica delete/update/insert juntos: ou tudo entra, ou
   *  nada muda. */
  async function persistirLote(itens: { dia: string; e: { id: string; name: string }; dm: DiffSizeMap }[]) {
    const bloqueados: string[] = [];
    for (const it of itens) {
      const emp = montadores.find((employee) => employee.id === it.e.id);
      if (regimePor.get(it.e.id) !== "producao" || paresOfDiffMap(it.dm) <= 0) continue;
      const existing = existingChamada.get(`${it.e.id}|${it.dia}`);
      const original = existing ? diffSizeMapOf(existing) : emptyDiffMap();
      const medioAntes = paresOfMap(original.medio) > 0;
      const dificilAntes = paresOfMap(original.dificil) > 0;
      // Categoria já presente conserva/valida o snapshot histórico; categoria
      // que nasce neste save precisa da taxa vigente, que a RPC captura.
      const vm = rateForEntryCategory({
        hadPairs: medioAntes,
        snapshotRate: existing?.valor_par_medio ?? existing?.valor_par,
        currentRate: emp?.valor_par_medio,
      });
      const vd = rateForEntryCategory({
        hadPairs: dificilAntes,
        snapshotRate: existing?.valor_par_dificil,
        currentRate: emp?.valor_par_dificil,
      });
      if (paresOfMap(it.dm.medio) > 0 && !(vm > 0)) bloqueados.push(it.e.name);
      else if (paresOfMap(it.dm.dificil) > 0 && !(vd > 0)) bloqueados.push(it.e.name);
    }
    if (bloqueados.length) return { gravados: 0, erros: [], bloqueados: Array.from(new Set(bloqueados)) };

    const payload = itens.map((item) => {
      const existing = existingChamada.get(`${item.e.id}|${item.dia}`);
      return {
        dia: item.dia,
        montador_id: item.e.id,
        // Concorrência otimista: a RPC recusa se alguém alterou esta mesma linha
        // desde que o lote foi carregado. NULL identifica um INSERT esperado.
        expected_id: existing?.id ?? null,
        expected_atualizado_em: existing?.atualizado_em ?? null,
        detalhe: SIZES
          .filter((size) => (item.dm.medio[size] || 0) > 0 || (item.dm.dificil[size] || 0) > 0)
          .map((size) => ({ tamanho: size, medio: item.dm.medio[size] || 0, dificil: item.dm.dificil[size] || 0 })),
      };
    });
    // A RPC nasce nesta migration; os tipos gerados do Supabase só passam a
    // conhecê-la na próxima regeneração automática.
    const saveBatch = db.rpc as unknown as (
      name: "save_ficha_montadores_batch",
      args: { p_setor: string; p_items: typeof payload },
    ) => Promise<{ data: { gravados?: number } | null; error: { message: string } | null }>;
    const { data, error } = await saveBatch("save_ficha_montadores_batch", { p_setor: setor, p_items: payload });
    if (error) return { gravados: 0, erros: [error.message], bloqueados: [] };
    return { gravados: Number(data?.gravados) || 0, erros: [], bloqueados: [] };
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
    try {
      const changed = montadores.filter((e) => JSON.stringify(mapOf(e.id)) !== JSON.stringify(origPares[e.id] || emptyDiffMap()));
      const { gravados, erros, bloqueados } = await persistirLote(
        changed.map((e) => ({ dia: chamadaDia, e, dm: mapOf(e.id) })),
      );
      avisarBloqueio(bloqueados);
      if (erros.length) {
        toast.error(`Nada foi alterado. Corrija e tente novamente: ${erros.join(" · ")}`);
        return;
      }
      if (bloqueados.length) return;
      if (gravados) {
        await carregar();
        setSalvoEm(new Date());
        toast.success(`Dia salvo — ${gravados} ${gravados === 1 ? "lançamento" : "lançamentos"}.`);
      } else toast.message("Nada para salvar.");
    } finally {
      setSavingDia(false);
    }
  }

  async function salvarSemana() {
    setSavingSem(true);
    try {
      const itens: { dia: string; e: { id: string; name: string }; dm: DiffSizeMap }[] = [];
      for (const e of montadores) {
        for (const day of weekDays) {
          const k = `${e.id}|${day}`;
          if (JSON.stringify(week[k] || emptyDiffMap()) === JSON.stringify(origWeek[k] || emptyDiffMap())) continue;
          itens.push({ dia: day, e, dm: week[k] || emptyDiffMap() });
        }
      }
      const { gravados, erros, bloqueados } = await persistirLote(itens);
      avisarBloqueio(bloqueados);
      if (erros.length) {
        toast.error(`Nada foi alterado. Corrija e tente novamente: ${erros.join(" · ")}`);
        return;
      }
      if (bloqueados.length) return;
      if (gravados) {
        await carregar();
        setSalvoEm(new Date());
        toast.success(`Semana salva — ${gravados} lançamento${gravados === 1 ? "" : "s"}.`);
      } else toast.message("Nada para salvar.");
    } finally {
      setSavingSem(false);
    }
  }

  function avancarEntrada(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const slice = event.currentTarget.dataset.fichaEntry;
    if (!slice) return;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-ficha-entry="${slice}"]`))
      .filter((input) => input.offsetParent !== null && !input.readOnly && !input.disabled);
    const current = inputs.indexOf(event.currentTarget);
    const next = inputs[current + (event.shiftKey ? -1 : 1)];
    if (next) {
      next.focus();
      next.select();
    }
  }

  const salvarDiaRef = useRef(salvarDia);
  const salvarSemanaRef = useRef(salvarSemana);
  salvarDiaRef.current = salvarDia;
  salvarSemanaRef.current = salvarSemana;
  useEffect(() => {
    const onSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      const dirty = chamadaView === "dia" ? dirtyDia : dirtySem;
      if (!dirty) return;
      event.preventDefault();
      if (chamadaView === "dia" && !savingDia) void salvarDiaRef.current();
      if (chamadaView === "semana" && !savingSem) void salvarSemanaRef.current();
    };
    window.addEventListener("keydown", onSaveShortcut);
    return () => window.removeEventListener("keydown", onSaveShortcut);
  }, [chamadaView, dirtyDia, dirtySem, savingDia, savingSem]);

  function zerarDia() {
    setSalvoEm(null);
    setPares((current) => {
      const next = { ...current };
      for (const employee of montadores) {
        if (!diaFechado.has(`${employee.id}|${chamadaDia}`)) next[employee.id] = emptyDiffMap();
      }
      return next;
    });
    setConfirmarZerar(null);
  }
  function zerarSemana() {
    setSalvoEm(null);
    setWeek((current) => {
      const next = { ...current };
      for (const employee of montadores) {
        for (const day of weekDays) {
          if (!diaFechado.has(`${employee.id}|${day}`)) next[`${employee.id}|${day}`] = emptyDiffMap();
        }
      }
      return next;
    });
    setConfirmarZerar(null);
  }
  function descartarRascunhoAtual() {
    if (chamadaView === "dia") setPares(origPares);
    else setWeek(origWeek);
  }
  function descartarTodosRascunhos() {
    setPares(origPares);
    setWeek(origWeek);
  }
  function iniciarTrocaDeContexto(invalidarFichas = false) {
    descartarTodosRascunhos();
    // Setor sempre muda a identidade das linhas. Dia/semana podem continuar no
    // dataRange já carregado; nesse caso limpá-lo deixaria a tela sem nova query.
    if (invalidarFichas) limparContextoCarregado();
  }
  function abrirDia(f: Ficha) {
    if (!confirmarDescarte()) return;
    iniciarTrocaDeContexto();
    setTab("lancamento"); setChamadaView("dia"); setChamadaDia(f.dia);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function excluir(f: Ficha) {
    if (isFichaLocked(f)) {
      toast.error("Este lançamento já está vinculado à folha e não pode ser excluído.");
      return;
    }
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
  /** Taxa REPRESENTATIVA do setor, só para a legenda da barra. Usa a mais comum
   *  entre quem é por par — se as pessoas tiverem taxas diferentes, a legenda
   *  vira "vários" em vez de mentir escolhendo uma. */
  const taxaSetor = useMemo(() => {
    const vms = new Set<number>(), vds = new Set<number>();
    for (const e of montadores) {
      if (String(e.payment_type || "").toLowerCase() !== "producao") continue;
      const vm = Number(e.valor_par_medio) || 0, vd = Number(e.valor_par_dificil) || 0;
      if (vm > 0) vms.add(vm);
      if (vd > 0) vds.add(vd);
    }
    return { vm: vms.size === 1 ? [...vms][0] : 0, vd: vds.size === 1 ? [...vds][0] : 0 };
  }, [montadores]);
  /** R$ da semana de uma pessoa pelas taxas do CADASTRO — é uma prévia do que
   *  aquilo vai valer, não o valor pago. Quem paga usa o snapshot gravado na
   *  linha (aba Produção); os dois só divergem se a taxa mudar depois. */
  const valorSemanaDe = useCallback((id: string) => {
    const t = taxaCadastro.get(id) || { vm: 0, vd: 0 };
    let med = 0, dif = 0;
    for (const d of weekDays) {
      const cel = weekMap(id, d);
      med += paresOfMap(cel.medio);
      dif += paresOfMap(cel.dificil);
    }
    return { med, dif, total: med * t.vm + dif * t.vd };
  }, [taxaCadastro, weekDays, weekMap]);

  // pMode/cFrom/cTo e `range` ficam lá em cima (antes de `carregar`) — a busca
  // no banco depende deles. Aqui só os filtros que não afetam o intervalo.
  const [filtroMontador, setFiltroMontador] = useState<string>("__all__");
  // Quitação: separa o que a folha já pagou do que ainda está em aberto.
  const [pagStatus, setPagStatus] = useState<PagStatus>("todos");

  const estadoDe = useCallback((f: Ficha): PagEstado => {
    if (f.pago_em) return "pago";
    if (f.payroll_run_id) return "folha";
    if (!f.montador_id || regimePor.get(f.montador_id) !== "producao") return "na";
    return "aberto";
  }, [regimePor]);

  const fichasFiltradas = useMemo(
    () => fichas.filter((f) =>
      f.dia >= range.from && f.dia <= range.to
      && (filtroMontador === "__all__" || f.montador_id === filtroMontador)
      && (pagStatus === "todos" || estadoDe(f) === pagStatus)),
    [fichas, range, filtroMontador, pagStatus, estadoDe],
  );

  /**
   * RESUMO DO PERÍODO (spec `resumo-e-calendario-montadores.md` R1).
   *
   * Delega a `sumProducaoRows` — o MESMO motor que a folha executa. Recalcular
   * aqui faria o resumo poder divergir do holerite, e aí o operador perde a
   * confiança nos dois números.
   *
   * Respeita os filtros porque parte de `fichasFiltradas`: com "A pagar"
   * marcado, o total é o que ainda se deve, que é o que vai pra folha.
   */
  const resumoPeriodo = useMemo(() => {
    const base = sumProducaoRows(fichasFiltradas as unknown as FichaMontadorRow[]);
    // Lançamento sem `detalhe` tem o total contado como MÉDIO pelo fallback do
    // motor. São 33 de 50 na base — o relatório avisa em vez de fingir precisão.
    const semDetalhe = fichasFiltradas.filter(
      (f) => isChamada(f) && !(Array.isArray(f.detalhe) && f.detalhe.length),
    ).length;
    // `sumProducaoRows` PULA linha legado por grade — regra da folha, pra não
    // contar produção duas vezes. Mas a lista de dias logo abaixo EXIBE essas
    // linhas, então o total do resumo ficaria menor que a soma visível na mesma
    // tela. Zero ocorrências hoje (50/50 são 'chamada'); o aviso existe pra que,
    // se voltar, o operador saiba por que os dois números não batem.
    const legado = fichasFiltradas.filter((f) => !isChamada(f)).length;
    return { ...base, semDetalhe, legado };
  }, [fichasFiltradas]);

  /**
   * CALENDÁRIO em grade de mês (R2): pares por DIA, somando todos os montadores
   * que passaram no filtro. Semana começa na SEGUNDA (`dowIdx`), igual ao PDF.
   */
  const calendario = useMemo(() => {
    const porDia = new Map<string, { pares: number; medio: number; dificil: number; pago: boolean }>();
    for (const f of fichasFiltradas) {
      const pd = isChamada(f)
        ? paresDiffOf(f)
        : { medio: paresDaFicha(f), dificil: 0, total: paresDaFicha(f) };
      if (pd.total <= 0) continue;
      const c = porDia.get(f.dia) || { pares: 0, medio: 0, dificil: 0, pago: true };
      c.pares += pd.total; c.medio += pd.medio; c.dificil += pd.dificil;
      // Dia com QUALQUER lançamento em aberto conta como não pago — a marca
      // existe pra cobrar, então erra pro lado de sinalizar (igual ao PDF).
      c.pago = c.pago && estadoDe(f) === "pago";
      porDia.set(f.dia, c);
    }
    const dias = daysInRange(range.from, range.to);
    const meses = [...new Set(dias.map((d) => d.slice(0, 7)))];
    return { porDia, dias, meses, temDificil: [...porDia.values()].some((c) => c.dificil > 0) };
  }, [fichasFiltradas, range, estadoDe]);

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
    // ZERADOS — quem é regime por par e não lançou nada no período. Sem eles, um
    // montador parado a semana inteira fica indistinguível de um que não existe,
    // e o card de contagem não bate com o cabeçalho da página (4 no topo, 3 na
    // tabela). A ausência é informação: é ela que se cobra na segunda-feira.
    //
    // Só com o filtro de pagamento em "Tudo": pedir "A PAGAR" e receber linhas de
    // R$ 0,00 contradiz o próprio filtro. E só regime por par — mensalista zerado
    // seria linha permanente que nunca tem o que receber.
    if (pagStatus === "todos") {
      for (const e of montadores) {
        if (String(e.payment_type || "").toLowerCase() !== "producao") continue;
        if (filtroMontador !== "__all__" && e.id !== filtroMontador) continue;
        if (m.has(e.id)) continue;
        rows.push({
          key: e.id, nome: e.name, fichas: 0,
          paresMedio: 0, paresDificil: 0, pares: 0,
          taxaMedio: 0, taxaDificil: 0, porPar: true,
          valorPago: 0, valorFolha: 0, valorAberto: 0, valorTotal: 0,
        });
      }
    }
    for (const r of rows) {
      const t = taxaCadastro.get(r.key);
      r.taxaMedio = t?.vm ?? 0; r.taxaDificil = t?.vd ?? 0;
    }
    // Ordena por pares: os zerados caem naturalmente no fim.
    return rows.sort((a, b) => b.pares - a.pares);
  }, [fichasFiltradas, taxaCadastro, estadoDe, montadores, pagStatus, filtroMontador]);
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
  /** Monta as linhas pessoa × dia do calendário. Deixou de imprimir sozinho: o
   *  calendário virou a segunda seção do relatório único, e esta função só
   *  fornece o dado. Devolve null quando não há o que imprimir. */
  function montarCalendario(): { rows: CalRow[]; days: string[] } | null {
    const days = daysInRange(range.from, range.to);
    if (!days.length) return null;
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
    return { rows, days };
  }

  /** Um botão, um documento: rendimento por pessoa + calendário na mesma folha. */
  function imprimirRelatorioCompleto() {
    const cal = montarCalendario();
    if (!cal) { toast.error("Selecione um período válido."); return; }
    imprimirRelatorio({
      rows: agg, totals, setorLabel: cfgSetor.label,
      oficioPlural: cfgSetor.plural,
      oficioLabel: cfgSetor.sing.replace(/^./, (c) => c.toUpperCase()),
      label: periodLabel[pMode], intervalo: `${fmtDia(range.from)} a ${fmtDia(range.to)}`,
      pagStatus, cal,
    });
  }

  const lbl = "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";
  const TABS: { id: Tab; label: string; description: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: "lancamento", label: "Lançar produção", description: "Registre pares por pessoa e dia", icon: ClipboardText },
    { id: "producao", label: "Conferir e pagar", description: "Confira totais, folha e quitação", icon: ChartBar },
  ];

  // estilo dos inputs de pares por dificuldade (Médio âmbar · Difícil verde)
  const cellM = "h-9 w-14 rounded-md border border-amber-500/40 bg-amber-500/5 text-center text-sm font-bold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-amber-600";
  const cellD = "h-9 w-14 rounded-md border border-green-600/40 bg-green-600/5 text-center text-sm font-bold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-green-600";

  return (
    <div className="w-full space-y-5">
      <EditorialPageHeader
        sectionLabel={`PRODUÇÃO · ${cfgSetor.label.toUpperCase()}`}
        title="Ficha de produção"
        description="Lance os pares do dia e feche a semana no mesmo lugar. O valor por par fica congelado em cada apontamento e segue para a folha."
        meta={<><span className="font-bold">{montadores.length}</span> PESSOA{montadores.length === 1 ? "" : "S"} POR PAR · <span className="font-bold">{fichasHoje}</span> FICHA{fichasHoje === 1 ? "" : "S"} HOJE</>}
      />

      {/* Contexto compacto: a bancada de lançamento é o herói da tela; esta
          faixa só responde onde estou e qual trabalho vou fazer. */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <span className="shrink-0 pl-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Setor</span>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {sectors.map((s) => {
            const gente = employeeSectors.filter((r) => r.sector_key === s.key && String(r.payment_type || "").toLowerCase() === "producao").length;
            return (
              <button key={s.key} type="button" onClick={() => {
                if (s.key === setor) return;
                if (!confirmarDescarte()) return;
                iniciarTrocaDeContexto(true); setSetor(s.key);
              }}
                title={`${s.label} — ${gente} ${gente === 1 ? "pessoa recebe" : "pessoas recebem"} por produção`}
                className={`whitespace-nowrap border-r border-border px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors last:border-r-0 ${setor === s.key ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>
                {s.label}
                <span className={`ml-1.5 font-mono text-[10px] ${setor === s.key ? "text-background/70" : "text-muted-foreground/60"}`}>{gente}</span>
              </button>
            );
          })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Etapa da ficha" className="flex overflow-hidden rounded-lg border border-border bg-background">
              {TABS.map((item) => (
                <button key={item.id} type="button" onClick={() => { if (item.id !== tab) setTab(item.id); }} title={item.description}
                  className={`flex min-h-9 items-center gap-2 border-r border-border px-3 text-xs font-semibold transition-colors last:border-r-0 ${tab === item.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                  <item.icon className="h-4 w-4" /> {item.label}
                </button>
              ))}
            </nav>
            <Button asChild type="button" variant="ghost" size="sm" className="h-9 shrink-0 justify-start text-xs sm:justify-center">
              <Link to="/rh?tab=funcionarios">Equipe e R$/par</Link>
            </Button>
          </div>
        </div>
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


      {/* ════ CHAMADA DO DIA ════ */}
      {tab === "lancamento" && (
        <div className={`space-y-4 ${(chamadaView === "dia" ? dirtyDia : dirtySem) > 0 ? "pb-[calc(120px+env(safe-area-inset-bottom))]" : ""}`}>
          {/* controles */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            {chamadaView === "dia" ? (
              <div>
                <label className={lbl}>Data</label>
                <div className="flex items-center gap-1">
                  <Input type="date" value={chamadaDia} onChange={(event) => {
                    const next = event.target.value;
                    if (!next) return;
                    if (next === chamadaDia || confirmarDescarte()) {
                      if (next !== chamadaDia) iniciarTrocaDeContexto();
                      setChamadaDia(next);
                      if (next) setSemanaAnchor(next);
                    }
                  }} className="h-9 w-40" />
                  {chamadaDia !== todayISO() && (
                    <Button type="button" variant="outline" size="sm" className="h-9 px-3 text-xs" onClick={() => {
                      if (!confirmarDescarte()) return;
                      iniciarTrocaDeContexto();
                      setChamadaDia(todayISO()); setSemanaAnchor(todayISO());
                    }}>Hoje</Button>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className={lbl}>Semana</label>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => {
                    if (!confirmarDescarte()) return;
                    iniciarTrocaDeContexto(); deslocarSemana(-1);
                  }} aria-label="Semana anterior"><CaretLeft className="h-4 w-4" /></Button>
                  <div className="h-9 inline-flex items-center rounded-md border border-border bg-card px-3 text-sm font-medium tabular-nums">{weekLabel}</div>
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => {
                    if (!confirmarDescarte()) return;
                    iniciarTrocaDeContexto(); deslocarSemana(1);
                  }} aria-label="Próxima semana"><CaretRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
            <div className="min-w-[180px] flex-1 basis-full sm:basis-auto">
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
            <div className="ml-auto flex w-full overflow-hidden rounded-md border border-border bg-card sm:w-auto">
              {(["dia", "semana"] as ChamadaView[]).map((v) => (
                <button key={v} type="button" onClick={() => {
                  if (v === chamadaView) return;
                  if (!confirmarDescarte()) return;
                  iniciarTrocaDeContexto();
                  if (v === "semana") setSemanaAnchor(chamadaDia);
                  setChamadaView(v);
                }}
                  className={`flex-1 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors sm:flex-none ${chamadaView === v ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{v}</button>
              ))}
            </div>
          </div>

          {montadores.length === 0 ? (
            <Panel>
              <EmptyState icon={Users} title={`Nenhum ${cfgSetor.sing} por par em ${cfgSetor.label}`}
                description={`Defina setor, regime “Por par” e R$/par no cadastro antes de lançar. Pessoas mensalistas deste setor não aparecem na chamada porque não compõem a folha por produção.`}
                action={<Button asChild variant="outline" size="sm"><Link to="/rh?tab=funcionarios">Abrir Funcionários</Link></Button>} />
            </Panel>
          ) : chamadaView === "dia" ? (
            <Panel
              flush
              eyebrow="BANCADA DE LANÇAMENTO"
              title={`${weekdayName(chamadaDia)} · ${fmtDia(chamadaDia)}`}
              subtitle={detalharDia
                ? "Grade completa para conferência. Médio (âmbar) e Difícil (verde) mantêm seus R$/par separados."
                : `Régua ativa: ficha ${diaSize}, ${DIFF_LABEL[diaDiff].toLowerCase()}. Clique em +1 ficha ou digite os pares; 7f vira ${7 * diaSize} pares.`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant={detalharDia ? "default" : "outline"} size="sm" className="h-8"
                    aria-pressed={detalharDia} onClick={() => setDetalharDia((v) => !v)}>
                    {detalharDia ? "Voltar à régua" : "Conferir grade"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-primary" onClick={() => setConfirmarZerar("dia")}>Zerar o dia</Button>
                </div>
              }
            >
              {/* A régua é a assinatura da tela: primeiro o encarregado escolhe
                  a ficha física que está contando; depois percorre as pessoas. */}
              <section aria-label="Régua de lançamento" className="border-b border-border bg-foreground text-background">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-background/55">Ficha</span>
                      <div className="flex overflow-hidden rounded-md border border-background/25">
                        {SIZES.map((size) => (
                          <button key={size} type="button" onClick={() => { setDiaSize(size); setDetalharDia(false); }}
                            className={`min-h-9 border-r border-background/20 px-3 font-mono text-xs font-bold last:border-r-0 ${diaSize === size ? "bg-background text-foreground" : "text-background/70 hover:bg-background/10 hover:text-background"}`}>
                            {size}<span className="ml-1 text-[8px] uppercase opacity-65">pares</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {diffsAtivos.length > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-background/55">Dificuldade</span>
                        <div className="flex overflow-hidden rounded-md border border-background/25">
                          {diffsAtivos.map((diff) => (
                            <button key={diff} type="button" onClick={() => { setDiaDiff(diff); setDetalharDia(false); }}
                              className={`min-h-9 border-r border-background/20 px-3 text-xs font-bold last:border-r-0 ${diaDiff === diff ? (diff === "medio" ? "bg-amber-500 text-white" : "bg-green-600 text-white") : "text-background/70 hover:bg-background/10 hover:text-background"}`}>
                              {DIFF_LABEL[diff]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-background/55 sm:ml-auto">
                      <ArrowDown className="mr-1 inline h-3 w-3" /> Enter avança · ⌘/Ctrl+S salva
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-5 border-t border-background/15 px-4 py-3 font-mono tabular-nums lg:border-l lg:border-t-0">
                    <div>
                      <span className="block text-[9px] uppercase tracking-wider text-background/55">Nesta régua</span>
                      <strong className="text-lg">{reguaPares.toLocaleString("pt-BR")}</strong><span className="ml-1 text-[9px] uppercase text-background/55">pares</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[9px] uppercase tracking-wider text-background/55">Fichas</span>
                      <strong className="text-lg text-primary">{reguaFichas}</strong>
                    </div>
                  </div>
                </div>
                {!detalharDia && foraDaRegua > 0 && (
                  <button type="button" onClick={() => setDetalharDia(true)} className="block w-full border-t border-background/15 px-4 py-2 text-left font-mono text-[10px] text-background/65 hover:bg-background/10 hover:text-background">
                    + {foraDaRegua.toLocaleString("pt-BR")} pares em outros tamanhos/dificuldades — conferir grade
                  </button>
                )}
              </section>
              {/* No celular, cada pessoa vira uma ficha de apontamento. A grade
                  desktop continua densa, mas o telefone não precisa arrastar uma
                  tabela para descobrir nome, total e botão de salvar. */}
              <div className="divide-y divide-border/60 md:hidden">
                {rosterFiltrado.map((e) => {
                  const dm = mapOf(e.id);
                  const pp = paresOfDiffMap(dm), ff = fichasOfDiffMap(dm);
                  const fechado = diaFechado.get(`${e.id}|${chamadaDia}`);
                  const alterado = JSON.stringify(dm) !== JSON.stringify(origPares[e.id] || emptyDiffMap());
                  return (
                    <div key={e.id} className={`p-4 ${alterado ? "border-l-2 border-l-amber-500 bg-amber-500/[0.025]" : pp > 0 ? "border-l-2 border-l-primary bg-primary/[0.025]" : "border-l-2 border-l-transparent"}`}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                            {e.name}
                            {fechado && <span title={fechado === "pago" ? "Dia pago" : "Dia na folha"}><LockKey className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{[e.role, e.department].filter(Boolean).join(" · ") || cfgSetor.label}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono tabular-nums">
                          <span className="block text-base font-bold text-foreground">{pp.toLocaleString("pt-BR")}</span>
                          <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">pares · <b className="text-primary">{ff} fichas</b></span>
                        </div>
                      </div>
                      {!detalharDia ? (
                        <div className="flex items-center justify-between gap-3">
                          <FichaCounter value={dm[diaDiff][diaSize] || 0} tamanho={diaSize} diff={diaDiff} pessoa={e.name}
                            locked={Boolean(fechado) || loading || savingDia}
                            onChange={(value) => setPS(e.id, diaDiff, diaSize, value)} onKeyDown={avancarEntrada} />
                          {alterado && <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-amber-600">alterado</span>}
                        </div>
                      ) : <div className="grid grid-cols-2 gap-2">
                        {colunasDia.map(({ sz, diff }) => (
                          <label key={`${sz}-${diff}`} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${diff === "medio" ? "border-amber-500/30 bg-amber-500/5" : "border-green-600/30 bg-green-600/5"}`}>
                            <span>
                              <span className="block text-[11px] font-bold text-foreground">Ficha {sz}</span>
                              <span className={`block text-[9px] font-bold uppercase tracking-wider ${diff === "medio" ? "text-amber-600" : "text-green-700 dark:text-green-400"}`}>{DIFF_LABEL[diff]}</span>
                            </span>
                            <input inputMode="numeric" enterKeyHint="next" readOnly={Boolean(fechado) || loading || savingDia} value={dm[diff][sz] || ""} placeholder="0"
                              onFocus={(ev) => ev.target.select()}
                              onChange={(ev) => {
                                const value = parseParesEntry(ev.target.value, sz);
                                if (value != null) setPS(e.id, diff, sz, value);
                              }}
                              onKeyDown={avancarEntrada}
                              data-ficha-entry={`${diff}-${sz}`}
                              className={`${diff === "medio" ? cellM : cellD} h-10 w-16 bg-background`}
                              aria-label={`${DIFF_LABEL[diff]} · ficha de ${sz} pares — ${e.name}`} />
                          </label>
                        ))}
                      </div>}
                      {fechado && <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"><LockKey className="h-3 w-3" /> {fechado === "pago" ? "Dia pago" : "Dia já incluído na folha"} · somente leitura</p>}
                    </div>
                  );
                })}
                {rosterFiltrado.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum resultado para "{busca}".
                    <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={() => setBusca("")}>Limpar busca</Button>
                  </div>
                )}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse" style={{ minWidth: colunasDia.length > 1 ? 760 : 480 }}>
                  <thead>
                    <tr className="border-b-2 border-border/80 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left align-bottom" style={{ minWidth: 180 }}>{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                      {colunasDia.map(({ sz, diff }) => (
                        <th key={`${sz}-${diff}`} className="border-l border-border px-2 py-1.5 text-center align-bottom" style={{ width: detalharDia ? 72 : 224 }}>
                          <span className="block text-[11px] leading-tight">{sz}<span className="ml-0.5 font-mono text-[9px] normal-case text-muted-foreground/70">pares</span></span>
                          {/* Rótulo da dificuldade sempre presente: cor sozinha não
                              informa (daltonismo / impressão em P&B). */}
                          <span className={`block text-[10px] font-bold leading-tight ${diff === "medio" ? "text-amber-600" : "text-green-700 dark:text-green-400"}`}>{DIFF_LABEL[diff]}</span>
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
                      const fechado = diaFechado.get(`${e.id}|${chamadaDia}`);
                      const alterado = JSON.stringify(dm) !== JSON.stringify(origPares[e.id] || emptyDiffMap());
                      return (
                        <tr key={e.id} className={`border-b border-border/50 transition-colors ${fechado ? "bg-muted/30" : "hover:bg-primary/[0.03]"}`} style={{ borderLeft: `2px solid ${alterado ? "hsl(var(--warning))" : pp > 0 ? "hsl(var(--primary))" : "transparent"}` }}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                              {e.name}
                              {alterado && <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-amber-600">alterado</span>}
                              {fechado && <span title={fechado === "pago" ? "Dia pago" : "Dia na folha"}><LockKey className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{[e.role, e.department].filter(Boolean).join(" · ") || "Montagem"}</div>
                          </td>
                          {colunasDia.map(({ sz, diff }) => (
                            <td key={`${sz}-${diff}`} className="border-l border-border px-2 py-1.5 text-center">
                              {!detalharDia ? (
                                <FichaCounter value={dm[diff][sz] || 0} tamanho={sz} diff={diff} pessoa={e.name}
                                  locked={Boolean(fechado) || loading || savingDia}
                                  onChange={(value) => setPS(e.id, diff, sz, value)} onKeyDown={avancarEntrada} />
                              ) : (
                                <input inputMode="numeric" enterKeyHint="next" readOnly={Boolean(fechado) || loading || savingDia}
                                  value={dm[diff][sz] || ""} placeholder="0"
                                  onFocus={(ev) => ev.target.select()}
                                  onChange={(ev) => {
                                    const value = parseParesEntry(ev.target.value, sz);
                                    if (value != null) setPS(e.id, diff, sz, value);
                                  }}
                                  onKeyDown={avancarEntrada}
                                  data-ficha-entry={`${diff}-${sz}`}
                                  className={diff === "medio" ? cellM : cellD}
                                  aria-label={`${DIFF_LABEL[diff]} · ficha de ${sz} pares — ${e.name}${fechado ? " (somente leitura)" : ""}`} />
                              )}
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
                          <td key={`${sz}-${diff}`} className={`border-l border-border px-1 py-2.5 text-center ${diff === "medio" ? "text-amber-600" : "text-green-700 dark:text-green-400"}`}>{col || ""}</td>
                        );
                      })}
                      <td className="border-l border-border px-3 py-2.5 text-right text-foreground">{totalDiaPares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2.5 text-right text-primary" style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{totalDiaFichas}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3.5">
                <span className="text-[11px] text-muted-foreground" aria-live="polite">
                  <strong className="text-foreground">{totalDiaPares.toLocaleString("pt-BR")}</strong> pares · <strong className="text-primary">{totalDiaFichas}</strong> fichas
                  {dirtyDia > 0
                    ? <span className="ml-2 font-semibold text-amber-600">● {dirtyDia} pessoa{dirtyDia === 1 ? "" : "s"} alterada{dirtyDia === 1 ? "" : "s"}</span>
                    : salvoEm && <span className="ml-2 font-medium text-green-600"><CheckCircle className="mr-1 inline h-3 w-3" />Salvo às {salvoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
                </span>
                <Button type="button" onClick={salvarDia} disabled={savingDia || dirtyDia === 0} className="h-10 gap-2">
                  <FloppyDisk className="h-4 w-4" /> {savingDia ? "Salvando…" : "Salvar alterações"}
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel
              flush
              eyebrow={`SEMANA ${weekLabel}`}
              title="Semana por pessoa"
              subtitle={diffsAtivos.length > 1
                ? "Médio e difícil visíveis ao mesmo tempo, sem trocar de fatia. O valor à direita é prévia pelas taxas do cadastro."
                : "Pares por dia. Este setor paga taxa única — não separa médio e difícil."}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {/* As taxas viram legenda: já que as duas dificuldades estão
                      sempre à vista, não há o que selecionar. */}
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-600">
                    Médio {taxaSetor.vm > 0 ? fmtBRL(taxaSetor.vm) : "—"}
                  </span>
                  {diffsAtivos.length > 1 && (
                    <span className="rounded border border-green-600/40 bg-green-600/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-green-700 dark:text-green-400">
                      Difícil {taxaSetor.vd > 0 ? fmtBRL(taxaSetor.vd) : "—"}
                    </span>
                  )}
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {SIZES.map((sz) => (
                      <button key={sz} type="button" onClick={() => setSemSize(sz)}
                        title={`Os campos passam a lançar fichas de ${sz} pares`}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${semSize === sz ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{sz}</button>
                    ))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-primary" onClick={() => setConfirmarZerar("semana")}>Zerar semana</Button>
                </div>
              }
            >
              {/* Uma linha por pessoa, com as duas dificuldades à vista. Substituiu
                  a matriz que editava UMA fatia (dificuldade × tamanho) por vez:
                  eram até 6 passadas na mesma grade, e a marca +N existia só pra
                  avisar do que a célula não conseguia mostrar. */}
              <div className="overflow-x-auto">
                <div className="min-w-[680px] divide-y divide-border/60 sm:min-w-0">
                {rosterFiltrado.map((e) => {
                  const porPar = String(e.payment_type || "").toLowerCase() === "producao";
                  const v = valorSemanaDe(e.id);
                  const rowFichas = weekDays.reduce((s, d) => s + fichasOfDiffMap(weekMap(e.id, d)), 0);
                  const nada = v.med + v.dif === 0;
                  const linhaDiff = (df: Diff) => (
                    <>
                      <span className={`text-center font-mono text-[10px] font-bold ${df === "medio" ? "text-amber-600" : "text-green-700 dark:text-green-400"}`}
                        title={df === "medio" ? "Pares de dificuldade média" : "Pares de dificuldade difícil"}>
                        {df === "medio" ? "M" : "D"}
                      </span>
                      {weekDays.map((d) => {
                        const cel = weekMap(e.id, d);
                        const val = cel[df][semSize] || 0;
                        // Pares do dia nessa dificuldade que estão em OUTRO tamanho.
                        // O tamanho é a única dimensão que continua atrás de um
                        // seletor (100% do histórico usa 12), então a marca fica.
                        const fora = paresOfMap(cel[df]) - val;
                        const fechamento = diaFechado.get(`${e.id}|${d}`);
                        const travado = Boolean(fechamento);
                        return (
                          <div key={d} className="relative">
                            <input inputMode="numeric" enterKeyHint="next" readOnly={travado || loading || savingSem}
                              value={val || ""} placeholder="·"
                              onFocus={(ev) => ev.target.select()}
                              onChange={(ev) => {
                                const value = parseParesEntry(ev.target.value, semSize);
                                if (value != null) setWeekCell(e.id, d, df, semSize, value);
                              }}
                              onKeyDown={avancarEntrada}
                              data-ficha-entry={`${df}-${semSize}`}
                              title={travado ? (fechamento === "pago" ? "Dia pago — o lançamento está congelado." : "Dia já incluído na folha — o lançamento está congelado.") : "Digite pares ou use 7f para sete fichas."}
                              className={`h-10 min-w-11 w-full rounded border text-center text-sm font-semibold tabular-nums outline-none transition-colors placeholder:text-muted-foreground/40 ${
                                travado
                                  ? "cursor-not-allowed border-border bg-muted/60 text-muted-foreground"
                                  : df === "medio"
                                    ? "border-amber-500/40 bg-card text-foreground focus:border-amber-600"
                                    : "border-green-600/40 bg-card text-foreground focus:border-green-600"
                              } ${dowIdx(d) >= 5 ? "opacity-70" : ""}`}
                              aria-label={`${e.name} ${fmtDia(d)} — ${DIFF_LABEL[df]}, ficha de ${semSize}${travado ? " (na folha, somente leitura)" : ""}`} />
                            {travado && (
                              <LockKey className="pointer-events-none absolute -right-1 -top-1 h-3 w-3 text-muted-foreground" aria-hidden />
                            )}
                            {fora > 0 && (
                              <span className="pointer-events-none absolute -bottom-0.5 right-0.5 font-mono text-[9px] font-bold leading-none text-primary"
                                title={`${fora} pares deste dia estão em outro tamanho de ficha`}>+{fora}</span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                  return (
                    <div key={e.id} className={`grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:gap-4 ${nada ? "opacity-60" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-semibold text-foreground">{e.name}</span>
                          {nada && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">sem lançamento na semana</span>}
                          {porPar && !(Number(e.valor_par_medio) > 0) && (
                            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600" title="Sem R$/par no cadastro — a produção não vira pagamento.">sem R$/par</span>
                          )}
                        </div>
                        <div className="mt-2 grid items-center gap-1"
                          style={{ gridTemplateColumns: `16px repeat(${weekDays.length}, minmax(38px,1fr))` }}>
                          <span />
                          {weekDays.map((d, i) => (
                            <span key={d} className={`text-center font-mono text-[9px] uppercase tracking-wide ${dowIdx(d) >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                              {WD_SHORT[i]} {d.slice(8)}
                            </span>
                          ))}
                          {diffsAtivos.map((df) => <Fragment key={df}>{linhaDiff(df)}</Fragment>)}
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-3 border-t border-border/60 pt-2 text-left font-mono tabular-nums sm:block sm:border-0 sm:pt-0 sm:text-right" style={{ minWidth: 126 }}>
                        {porPar ? (
                          <>
                            <span className="block text-base font-bold text-foreground"
                              title="Prévia pelas taxas do cadastro. O pagamento usa o valor congelado em cada lançamento.">
                              {fmtBRL(v.total)}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              <span className="font-bold text-amber-600">{v.med.toLocaleString("pt-BR")} méd</span>
                              {v.dif > 0 && <> · <span className="font-bold text-green-700 dark:text-green-400">{v.dif.toLocaleString("pt-BR")} dif</span></>}
                            </span>
                          </>
                        ) : (
                          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground" title="Recebe salário — a produção aqui é medição de produtividade.">não é por par</span>
                        )}
                        <span className="block text-[10px] text-muted-foreground">{rowFichas} fichas</span>
                      </div>
                    </div>
                  );
                })}
                {rosterFiltrado.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum resultado para "{busca}".
                    <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={() => setBusca("")}>Limpar busca</Button>
                  </div>
                )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <span className="text-[11px] text-muted-foreground" aria-live="polite">Semana {weekLabel} (todos os tamanhos): <strong className="text-foreground">{semParesTotal.toLocaleString("pt-BR")}</strong> pares · <strong className="text-primary">{semFichasTotal}</strong> fichas
                  {dirtySem > 0 && <span className="ml-2 font-semibold text-amber-600">● {dirtySem} dia{dirtySem === 1 ? "" : "s"} alterado{dirtySem === 1 ? "" : "s"}</span>}
                </span>
                <Button type="button" onClick={salvarSemana} disabled={savingSem || dirtySem === 0} className="h-10 gap-2">
                  <FloppyDisk className="h-4 w-4" /> {savingSem ? "Salvando…" : "Salvar alterações"}
                </Button>
              </div>
            </Panel>
          )}

          {(chamadaView === "dia" ? dirtyDia : dirtySem) > 0 && (
            <aside aria-label="Alterações não salvas" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-sticky flex w-[min(94vw,760px)] -translate-x-1/2 flex-col gap-3 rounded-xl border-2 border-foreground bg-background p-3 shadow-sharp sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning text-warning-foreground">
                  <FloppyDisk className="h-5 w-5" />
                </span>
                <div className="min-w-0" aria-live="polite">
                  <p className="truncate text-sm font-bold text-foreground">
                    {chamadaView === "dia"
                      ? `${dirtyDia} pessoa${dirtyDia === 1 ? "" : "s"} com alteração`
                      : `${dirtySem} dia${dirtySem === 1 ? "" : "s"} com alteração`}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {(chamadaView === "dia" ? deltaDiaPares : deltaSemPares) >= 0 ? "+" : ""}
                    {(chamadaView === "dia" ? deltaDiaPares : deltaSemPares).toLocaleString("pt-BR")} pares no rascunho
                    {chamadaView === "dia" && dirtyDia > dirtyDiaVisivel && ` · ${dirtyDia - dirtyDiaVisivel} fora da busca`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                <Button type="button" variant="outline" className="h-10 flex-1 gap-1.5 sm:flex-none" onClick={() => setConfirmarDescartarDock(true)}>
                  <X className="h-4 w-4" /> Descartar
                </Button>
                <Button type="button" className="h-10 flex-1 gap-1.5 sm:flex-none"
                  disabled={chamadaView === "dia" ? savingDia : savingSem}
                  onClick={() => { if (chamadaView === "dia") void salvarDia(); else void salvarSemana(); }}>
                  <FloppyDisk className="h-4 w-4" />
                  {chamadaView === "dia" ? (savingDia ? "Salvando…" : "Salvar o dia") : (savingSem ? "Salvando…" : "Salvar semana")}
                </Button>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* ════ filtro de período (Produtividade + Fichas) ════ */}
      {tab !== "lancamento" && (
        <Panel
          eyebrow="FECHAMENTO SEMANAL"
          title={`Conferência de ${cfgSetor.label}`}
          subtitle="O período, a pessoa e o status abaixo controlam todas as visões e o relatório impresso."
          actions={<Button type="button" variant="outline" size="sm" className="h-9 w-9 gap-1.5 p-0 sm:w-auto sm:px-3" disabled={agg.length === 0}
            title="Gera rendimento por pessoa e calendário no mesmo documento, respeitando todos os filtros."
            aria-label="Imprimir relatório"
            onClick={imprimirRelatorioCompleto}><Printer className="h-4 w-4" /><span className="hidden sm:inline">Imprimir relatório</span></Button>}
        >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={lbl}>Período</label>
            <div className="flex flex-wrap gap-1">
            {(Object.keys(periodLabel) as PeriodMode[]).map((m) => (
              <button key={m} type="button"
                // "Esta semana" volta pra semana corrente: o rótulo promete isso.
                // Navegar com as setas move a âncora; o preset a traz de volta.
                onClick={() => { setPMode(m); if (m === "semana") setSemanaAnchor(todayISO()); }}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${pMode === m ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:bg-muted/40"}`}>{periodLabel[m]}</button>
            ))}
            </div>
          </div>
          {/* Navegação de semana — só faz sentido no modo semana. Traz o valor em
              aberto junto: percorrendo as semanas dá pra ver ONDE ainda há dívida
              sem ler a tabela inteira. */}
          {pMode === "semana" && (
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0"
                onClick={() => deslocarSemana(-1)} aria-label="Semana anterior"><CaretLeft className="h-4 w-4" /></Button>
              <div className="inline-flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2 text-xs font-medium tabular-nums sm:px-3 sm:text-sm">
                <span>{fmtDia(range.from)} – {fmtDia(range.to)}</span>
                {totals.valorAberto > 0
                  ? <span className="hidden font-mono text-xs font-bold text-amber-600 sm:inline">{fmtBRL(totals.valorAberto)} a pagar</span>
                  : totals.valorTotal > 0
                    ? <span className="hidden font-mono text-xs font-bold text-green-600 sm:inline">quitada</span>
                    : <span className="hidden font-mono text-xs text-muted-foreground sm:inline">sem produção</span>}
              </div>
              <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0"
                onClick={() => deslocarSemana(1)} aria-label="Próxima semana"><CaretRight className="h-4 w-4" /></Button>
            </div>
          )}
          {pMode === "custom" && (
            <div className="flex flex-wrap items-end gap-2">
              <div><label className={lbl}>De</label><Input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="h-9 w-36 sm:w-40" /></div>
              <div><label className={lbl}>Até</label><Input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="h-9 w-36 sm:w-40" /></div>
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
            <div className="flex max-w-full overflow-x-auto rounded-md border border-border">
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
          <div className="ml-auto self-center text-xs text-muted-foreground">{fmtDia(range.from)} – {fmtDia(range.to)}</div>
        </div>
        </Panel>
      )}

      {tab === "producao" && (
        <nav aria-label="Visões do relatório" className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/30 p-1">
          {([
            { id: "resumo", label: "Resumo", short: "Totais e pessoas", icon: ChartBar },
            { id: "calendario", label: "Calendário", short: "Ritmo por dia", icon: CalendarBlank },
            { id: "lancamentos", label: "Lançamentos", short: "Linhas e ajustes", icon: ListBullets },
          ] as { id: ReportView; label: string; short: string; icon: ComponentType<{ className?: string }> }[]).map((view) => (
            <button key={view.id} type="button" onClick={() => setReportView(view.id)} aria-current={reportView === view.id ? "page" : undefined}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors sm:justify-start sm:px-3 ${reportView === view.id ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}>
              <view.icon className={`h-4 w-4 shrink-0 ${reportView === view.id ? "text-primary" : ""}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold sm:text-sm">{view.label}</span>
                <span className="hidden truncate text-[10px] text-muted-foreground sm:block">{view.short}</span>
              </span>
            </button>
          ))}
        </nav>
      )}

      {/* ════ 1. QUEM produziu e QUANTO devo — a parte acionável ════ */}
      {tab === "producao" && reportView === "resumo" && (
        <div className="space-y-4">
          {/* Faixa de fechamento: a pergunta operacional é onde o dinheiro está,
              não quatro indicadores independentes com o mesmo peso. */}
          <section aria-label="Situação do fechamento" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="grid grid-cols-3 md:grid-cols-[1.25fr_repeat(3,1fr)]">
              <div className="col-span-3 border-b border-border bg-foreground p-4 text-background md:col-span-1 md:border-b-0 md:border-r">
                <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-background/65">
                  <CurrencyDollar className="h-4 w-4" /> Total do período
                </div>
                <p className="mt-2 font-mono text-2xl font-bold tracking-tight tabular-nums">{fmtBRL(totals.valorTotal)}</p>
                <p className="mt-1 text-xs text-background/70">
                  {totals.pares.toLocaleString("pt-BR")} pares · {totals.fichas.toLocaleString("pt-BR")} fichas · {agg.length} pessoa{agg.length === 1 ? "" : "s"}
                </p>
              </div>
              {[
                { label: "A pagar", value: totals.valorAberto, hint: "livre para fechar", icon: Clock, tone: "text-amber-600", bg: "bg-amber-500" },
                { label: "Na folha", value: totals.valorFolha, hint: "aprovado, não quitado", icon: ClipboardText, tone: "text-blue-600", bg: "bg-blue-600" },
                { label: "Pago", value: totals.valorPago, hint: "sem pendência", icon: CheckCircle, tone: "text-green-600", bg: "bg-green-600" },
              ].map((item) => {
                const pct = totals.valorTotal > 0 ? Math.min(100, (item.value / totals.valorTotal) * 100) : 0;
                return (
                  <div key={item.label} className="min-w-0 border-r border-border p-3 last:border-r-0 sm:p-4">
                    <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider sm:text-[11px] ${item.tone}`}>
                      <item.icon className="hidden h-4 w-4 sm:block" /> {item.label}
                    </div>
                    <p className="mt-2 truncate font-mono text-xs font-bold tabular-nums text-foreground sm:text-lg" title={fmtBRL(item.value)}>{fmtBRL(item.value)}</p>
                    <p className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">{item.hint}</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className={`h-full rounded-full ${item.bg}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {(resumoPeriodo.taxaVariou || resumoPeriodo.legado > 0 || resumoPeriodo.semDetalhe > 0) && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
              <Warning className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                {resumoPeriodo.taxaVariou && <p>O R$/par mudou no período. Cada lançamento preserva a taxa vigente no dia.</p>}
                {resumoPeriodo.legado > 0 && <p><b>{resumoPeriodo.legado}</b> lançamento(s) antigo(s) aparecem no histórico, mas não entram no total da folha.</p>}
                {resumoPeriodo.semDetalhe > 0 && <p><b>{resumoPeriodo.semDetalhe}</b> lançamento(s) sem dificuldade detalhada entram como médio, seguindo o motor da folha.</p>}
              </div>
            </div>
          )}

          <Panel
            eyebrow={`${periodLabel[pMode]} · ${fmtDia(range.from)}–${fmtDia(range.to)}${pagStatus === "todos" ? "" : ` · ${PAG_LABEL[pagStatus]}`}`}
            title={`Rendimento por ${cfgSetor.sing}`}
            subtitle="Valor calculado pelo R$/par gravado em cada lançamento. A taxa se cadastra em Funcionários → Remuneração e entra congelada no apontamento."
            actions={<span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Ordenado por pares</span>}
          >
            {/* Cartões no celular; tabela de conferência no desktop. */}
            <div className="divide-y divide-border/60 md:hidden">
              {agg.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sem lançamentos no período.</p>}
              {agg.map((r, i) => (
                <article key={r.key} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">{r.nome}</h3>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{r.fichas} fichas · R$/par {r.taxaMedio > 0 ? fmtBRL(r.taxaMedio) : "não cadastrado"}{r.taxaDificil > 0 ? ` / ${fmtBRL(r.taxaDificil)}` : ""}</p>
                    </div>
                    <div className="shrink-0 text-right font-mono tabular-nums">
                      <span className="block text-lg font-bold text-foreground">{r.pares.toLocaleString("pt-BR")}</span>
                      <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">pares</span>
                    </div>
                  </div>
                  {r.porPar ? (
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-center font-mono tabular-nums">
                      <div><span className="block text-[9px] font-bold uppercase tracking-wider text-amber-600">A pagar</span><b className="mt-1 block text-xs text-foreground">{r.valorAberto > 0 ? fmtBRL(r.valorAberto) : "—"}</b></div>
                      <div><span className="block text-[9px] font-bold uppercase tracking-wider text-blue-600">Na folha</span><b className="mt-1 block text-xs text-foreground">{r.valorFolha > 0 ? fmtBRL(r.valorFolha) : "—"}</b></div>
                      <div><span className="block text-[9px] font-bold uppercase tracking-wider text-green-600">Pago</span><b className="mt-1 block text-xs text-foreground">{r.valorPago > 0 ? fmtBRL(r.valorPago) : "—"}</b></div>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">Medição de produtividade · não recebe por par</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      <b className="text-amber-600">{r.paresMedio.toLocaleString("pt-BR")} méd</b>
                      {r.paresDificil > 0 && <> · <b className="text-green-700 dark:text-green-400">{r.paresDificil.toLocaleString("pt-BR")} dif</b></>}
                    </span>
                    {podePagarProducao && r.porPar && r.valorAberto > 0 && !r.key.startsWith("txt:") && (
                      <Button size="sm" variant="outline" className="h-8" disabled={!janelaESemanaFechada}
                        title={janelaESemanaFechada ? undefined : "O pagamento só pode ser fechado em uma semana completa (segunda a domingo)."}
                        onClick={() => setPagarAlvo({ id: r.key, nome: r.nome, valor: r.valorAberto })}>Pagar</Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm" style={{ minWidth: 760 }}>
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-3 py-2">{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                    <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Pares méd</th>
                    <th className="px-3 py-2 text-right text-green-700 dark:text-green-400">Pares dif</th>
                    <th className="px-3 py-2 text-right">Pares</th>
                    <th className="px-3 py-2 text-right border-l border-border">R$/par cadastro</th>
                    <th className="px-3 py-2 text-right text-amber-600 border-l border-border">A pagar</th>
                    <th className="px-3 py-2 text-right text-blue-600">Na folha</th>
                    <th className="px-3 py-2 text-right text-green-600">Pago</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    {podePagarProducao && <th className="px-3 py-2 text-right">Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {agg.length === 0 && <tr><td colSpan={podePagarProducao ? 11 : 10} className="px-3 py-8 text-center text-muted-foreground">Sem lançamentos no período.</td></tr>}
                  {agg.map((r, i) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.nome}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 border-l border-border">{r.paresMedio.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">{r.paresDificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-muted-foreground border-l border-border">
                        {r.taxaMedio > 0 || r.taxaDificil > 0
                          ? <><span className="text-amber-600">{fmtBRL(r.taxaMedio)}</span> · <span className="text-green-700 dark:text-green-400">{fmtBRL(r.taxaDificil)}</span></>
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
                      {podePagarProducao && (
                        <td className="px-3 py-2 text-right">
                          {/* `key` só é employee_id quando o lançamento tem montador_id;
                              linha de nome solto (prefixo txt:) não tem quem pagar. */}
                          {r.porPar && r.valorAberto > 0 && !r.key.startsWith("txt:") ? (
                            <Button size="sm" variant="outline" className="h-7"
                              disabled={!janelaESemanaFechada}
                              title={janelaESemanaFechada
                                ? undefined
                                : "O pagamento é semanal: navegue até uma semana (seg→dom) para pagar. Pagar uma janela maior tomaria os dias de todas as semanas dentro dela."}
                              onClick={() => setPagarAlvo({ id: r.key, nome: r.nome, valor: r.valorAberto })}>
                              Pagar
                            </Button>
                          ) : <span className="text-muted-foreground">—</span>}
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
                      <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">{totals.dificil.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 border-l border-border" />
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600 border-l border-border">{fmtBRL(totals.valorAberto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-600">{fmtBRL(totals.valorFolha)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-600">{fmtBRL(totals.valorPago)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.valorTotal)}</td>
                      {podePagarProducao && <td className="px-3 py-2" />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ════ 2. QUANDO foi produzido, a que taxa e em que ritmo ════
           Mesmo filtro e mesmo motor do bloco acima — os totais TÊM que bater.
           Se um dia divergirem, é bug, não arredondamento. */}
      {tab === "producao" && reportView !== "resumo" && fichasFiltradas.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-end gap-2 border-b border-border pb-3">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{reportView === "calendario" ? "Ritmo de produção" : "Auditoria operacional"}</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{reportView === "calendario" ? "Calendário do período" : "Lançamentos por dia"}</h2>
            </div>
            {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
            {!loading && <span className="text-xs text-muted-foreground">{fichasFiltradas.length} lançamento(s)</span>}
            {/* O botão "Calendário em PDF" saiu daqui: o calendário virou a
                segunda seção do "Imprimir relatório", lá em cima. Um documento
                só, com o mesmo período e o mesmo filtro — quem conferia a semana
                gerava os dois e juntava no grampo. */}
            <span className="ml-auto text-[11px] text-muted-foreground">
              O calendário sai junto em <strong className="text-foreground">Imprimir relatório</strong>.
            </span>
          </div>

          {/* ══ RESUMO DO PERÍODO (R1) ══ */}
          {reportView === "calendario" && !loading && fichasFiltradas.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap">
                <div className="flex min-w-0 flex-1 basis-[340px] flex-col gap-2 p-4">
                  <div className="grid grid-cols-[74px_1fr_auto] items-baseline gap-2.5">
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-amber-600">Médio</span>
                    <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                      <b className="font-semibold text-foreground">{resumoPeriodo.paresMedio.toLocaleString("pt-BR")}</b> pares × {fmtBRL(resumoPeriodo.taxaMedio)}
                    </span>
                    <span className="text-right font-mono text-sm font-semibold tabular-nums">{fmtBRL(resumoPeriodo.brutoMedio)}</span>
                  </div>
                  {/* R1.4 — sem par difícil no período, a linha nem existe: seria
                      uma linha de zeros em todo relatório de montagem comum. */}
                  {resumoPeriodo.paresDificil > 0 && (
                    <div className="grid grid-cols-[74px_1fr_auto] items-baseline gap-2.5">
                      <span className="rounded bg-green-600/10 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-green-400">Difícil</span>
                      <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                        <b className="font-semibold text-foreground">{resumoPeriodo.paresDificil.toLocaleString("pt-BR")}</b> pares × {fmtBRL(resumoPeriodo.taxaDificil)}
                      </span>
                      <span className="text-right font-mono text-sm font-semibold tabular-nums">{fmtBRL(resumoPeriodo.brutoDificil)}</span>
                    </div>
                  )}
                </div>
                <div className="flex basis-[226px] flex-col justify-center gap-0.5 border-l border-border bg-muted/40 px-5 py-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Total do período</span>
                  <span className="font-mono text-[29px] font-bold leading-tight tracking-tight tabular-nums">{fmtBRL(resumoPeriodo.bruto)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{resumoPeriodo.pares.toLocaleString("pt-BR")} pares</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3.5 border-t border-border px-4 py-2 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                <span><b className="font-semibold text-foreground/80">{resumoPeriodo.fichas.toLocaleString("pt-BR")}</b> fichas</span>
                <span><b className="font-semibold text-foreground/80">{resumoPeriodo.dias}</b> dias produtivos</span>
                <span><b className="font-semibold text-foreground/80">{Math.round(resumoPeriodo.pares / (resumoPeriodo.dias || 1)).toLocaleString("pt-BR")}</b> pares/dia</span>
              </div>
              {resumoPeriodo.taxaVariou && (
                <p className="flex gap-2 border-t border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-600">
                  <Warning className="h-4 w-4 shrink-0" />
                  O R$/par mudou dentro do período — a taxa exibida é média ponderada. Cada lançamento manteve a sua.
                </p>
              )}
              {resumoPeriodo.legado > 0 && (
                <p className="flex gap-2 border-t border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-600">
                  <Warning className="h-4 w-4 shrink-0" />
                  <span><b>{resumoPeriodo.legado}</b> lançamento(s) no formato antigo (por grade) aparecem na lista abaixo mas <b>não entram neste total</b> — a folha não paga por eles.</span>
                </p>
              )}
              {resumoPeriodo.semDetalhe > 0 && (
                <p className="flex gap-2 border-t border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-600">
                  <Warning className="h-4 w-4 shrink-0" />
                  <span><b>{resumoPeriodo.semDetalhe}</b> lançamento(s) sem quebra por tamanho — o total deles entra como <b>médio</b>, igual ao motor da folha.</span>
                </p>
              )}
            </div>
          )}

          {/* ══ CALENDÁRIO em grade de mês (R2) ══ */}
          {reportView === "calendario" && !loading && fichasFiltradas.length > 0 && (
            <div className="mb-5 space-y-4">
              {calendario.meses.map((mes) => {
                const [ano, m] = mes.split("-").map(Number);
                const primeiro = new Date(ano, m - 1, 1);
                const ultimo = new Date(ano, m, 0);
                // dowIdx é 0=Seg … 6=Dom (convenção do projeto, igual ao PDF).
                const offset = (primeiro.getDay() + 6) % 7;
                const celulas: JSX.Element[] = [];
                for (let i = 0; i < offset; i++) {
                  celulas.push(<div key={`v${i}`} className="invisible" aria-hidden />);
                }
                for (let dd = 1; dd <= ultimo.getDate(); dd++) {
                  const iso = `${ano}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
                  const dentro = calendario.dias.includes(iso);
                  const c = calendario.porDia.get(iso);
                  const fds = dowIdx(iso) >= 5;
                  if (!dentro) { celulas.push(<div key={iso} className="invisible" aria-hidden />); continue; }
                  if (!c) {
                    // R2.4 — dia vazio DENTRO do período fica visível: a falta é informação.
                    celulas.push(
                      <div key={iso} className={`min-h-11 rounded-md border border-dashed border-border p-1 sm:min-h-[58px] sm:p-1.5 ${fds ? "bg-muted/40" : ""}`}>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{dd}</span>
                      </div>,
                    );
                    continue;
                  }
                  celulas.push(
                    <div key={iso}
                      className={`flex min-h-11 min-w-0 flex-col overflow-hidden rounded-md border p-1 sm:min-h-[58px] sm:p-1.5 ${c.pago ? "border-border bg-card" : "border-amber-500/40 bg-amber-500/10"} ${fds && c.pago ? "bg-muted/40" : ""}`}
                      title={`${fmtDia(iso)} — ${c.pares.toLocaleString("pt-BR")} pares${c.pago ? "" : " · ainda não pago"}`}>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{dd}</span>
                      <span className="mt-auto truncate font-mono text-[11px] font-bold leading-none tracking-tight tabular-nums text-foreground sm:text-[17px]">{c.pares.toLocaleString("pt-BR")}</span>
                      <span className="hidden font-mono text-[8.5px] uppercase tracking-wider text-muted-foreground sm:block">pares</span>
                      {calendario.temDificil && (
                        <span className="hidden font-mono text-[9px] leading-tight sm:block">
                          <span className="font-bold text-amber-600">{c.medio}</span>
                          {c.dificil > 0 && <> · <span className="font-bold text-green-700 dark:text-green-400">{c.dificil}</span></>}
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
                      {WD_SHORT7.map((w) => (
                        <span key={w} className="pb-0.5 text-center font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">{w}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 sm:gap-1">{celulas}</div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-3.5 font-mono text-[11px] text-muted-foreground">
                <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-500/40 bg-amber-500/10 align-[-1px]" />dia ainda não pago</span>
                <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted/40 align-[-1px]" />fim de semana</span>
                <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-border align-[-1px]" />sem lançamento</span>
              </div>
            </div>
          )}
          {reportView === "lancamentos" && <div className="space-y-5">
            {grupos.map(([d, lista]) => {
              const diaFichas = lista.reduce((s, f) => s + (isChamada(f) ? fichasDiaOf(f) : 1), 0);
              const diaPares = lista.reduce((s, f) => s + (isChamada(f) ? paresOfFicha(f) : paresDaFicha(f)), 0);
              return (
                <div key={d}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">{fmtDia(d)} <span className="font-normal text-muted-foreground">· {diaFichas} fichas · {diaPares.toLocaleString("pt-BR")} pares</span></h3>
                  </div>
                  <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border md:hidden">
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
                        <article key={f.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-foreground">{f.montador || "—"}</h4>
                              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">{tamLabel}{!chamada ? " · grade" : ""}</p>
                            </div>
                            <div className="shrink-0 text-right font-mono tabular-nums">
                              <span className="block text-base font-bold text-foreground">{pd.total.toLocaleString("pt-BR")}</span>
                              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">pares · <b className="text-primary">{chamada ? fichasDiaOf(f) : 1} fichas</b></span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                            <span className="text-xs">
                              <b className="text-amber-600">{pd.medio.toLocaleString("pt-BR")} méd</b>
                              {pd.dificil > 0 && <> · <b className="text-green-700 dark:text-green-400">{pd.dificil.toLocaleString("pt-BR")} dif</b></>}
                            </span>
                            <b className="font-mono text-xs tabular-nums text-foreground">{valor > 0 ? fmtBRL(valor) : "R$ 0,00"}</b>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            {estado === "pago" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-green-600"><CheckCircle className="h-3.5 w-3.5" /> Pago {fmtDia(f.pago_em!)}</span>
                            ) : estado === "folha" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600"><ClipboardText className="h-3.5 w-3.5" /> Na folha</span>
                            ) : estado === "aberto" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600"><Clock className="h-3.5 w-3.5" /> A pagar</span>
                            ) : <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Sem pagamento por par</span>}
                            <span className="flex items-center gap-3">
                              <button onClick={() => abrirDia(f)} className="text-xs font-medium text-primary hover:underline">Abrir</button>
                              {isFichaLocked(f)
                                ? <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Lançamento fechado pela folha"><LockKey className="h-3 w-3" /> Protegido</span>
                                : <button onClick={() => excluir(f)} className="text-xs font-medium text-muted-foreground hover:text-primary">Excluir</button>}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">{cfgSetor.sing.replace(/^./, (c) => c.toUpperCase())}</th>
                          <th className="px-3 py-2">Tamanhos (pares)</th>
                          <th className="px-3 py-2 text-right text-amber-600 border-l border-border">Méd</th>
                          <th className="px-3 py-2 text-right text-green-700 dark:text-green-400">Dif</th>
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
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">{pd.dificil ? pd.dificil.toLocaleString("pt-BR") : "—"}</td>
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
                                {isFichaLocked(f)
                                  ? <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Lançamento fechado pela folha"><LockKey className="h-3 w-3" /> Protegido</span>
                                  : <button onClick={() => excluir(f)} className="text-xs font-medium text-muted-foreground hover:text-primary">Excluir</button>}
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
          </div>}
        </section>
      )}

      {tab === "producao" && reportView !== "resumo" && !loading && fichasFiltradas.length === 0 && (
        <Panel>
          <EmptyState icon={reportView === "calendario" ? CalendarBlank : ListBullets}
            title="Nenhum lançamento neste recorte"
            description="Ajuste o período, a pessoa ou o status de pagamento. Todas as visões usam os mesmos filtros."
            action={<Button type="button" variant="outline" size="sm" onClick={() => { setPMode("semana"); setFiltroMontador("__all__"); setPagStatus("todos"); }}>Limpar filtros</Button>} />
        </Panel>
      )}

      <AlertDialog open={confirmarZerar != null} onOpenChange={(open) => { if (!open) setConfirmarZerar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmarZerar === "semana" ? "Zerar a semana?" : "Zerar o dia?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarZerar === "semana"
                ? `Todos os pares editáveis de ${weekLabel} voltarão a zero. Dias já incluídos na folha permanecem intactos.`
                : `Todos os pares editáveis de ${weekdayName(chamadaDia)}, ${fmtDia(chamadaDia)}, voltarão a zero. Lançamentos na folha permanecem intactos.`}
              {" "}A exclusão só chega ao banco depois de salvar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter lançamentos</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarZerar === "semana" ? zerarSemana : zerarDia} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Zerar e revisar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmarDescartarDock} onOpenChange={setConfirmarDescartarDock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações não salvas?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho {chamadaView === "dia" ? `de ${fmtDia(chamadaDia)}` : `da semana ${weekLabel}`} voltará aos últimos valores salvos. Esta ação não altera o banco.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => { descartarRascunhoAtual(); setConfirmarDescartarDock(false); }}>
              Descartar rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pagarAlvo && (
        <PagarProducaoDialog
          open
          onOpenChange={(o) => { if (!o) setPagarAlvo(null); }}
          employeeId={pagarAlvo.id}
          employeeName={pagarAlvo.nome}
          from={range.from}
          to={range.to}
          valorAberto={pagarAlvo.valor}
          onPago={() => { setPagarAlvo(null); void carregar(); }}
        />
      )}
    </div>
  );
}
