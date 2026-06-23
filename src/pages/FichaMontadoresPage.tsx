// FichaMontadoresPage.tsx — Squad Shoes
// "Ficha de Montadores": lançamento diário de fichas de corte/montagem +
// PRODUTIVIDADE por montador (filtros dia/semana/quinzena, pares e pagamento por
// par) + relatório. Tabela public.ficha_montadores (montador_id→employees,
// solado_id→products, valor_par). Não está nos tipos gerados → cast (supabase as any).
//
// Print (PRINT_CSS/cardHTML/relatório) abre em window próprio com cores hardcoded
// de propósito — papel A4 precisa de tons garantidos (igual aos demais prints).
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatGrid, StatCard } from "@/components/ui/stat-card";
import { useEmployees } from "@/hooks/useEmployees";
import { toast } from "sonner";
import { Printer, Plus, ChartBar, ClipboardText, ListChecks, Users, Package, CurrencyDollar } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";
type Tab = "lancamento" | "produtividade" | "fichas";
type PeriodMode = "hoje" | "semana" | "q1" | "q2" | "mes" | "custom";

interface Ficha {
  id: string;
  dia: string;
  montador: string | null;
  montador_id: string | null;
  solado: string | null;
  solado_id: string | null;
  cor: string | null;
  grade: Grade;
  numeracoes: string[];
  quantidades: string[];
  total: number;
  copias: number;
  valor_par: number | null;
  criado_em?: string;
}

const DEFAULTS: Record<Grade, { sizes: string[]; qtys: string[] }> = {
  adulto: { sizes: ["34", "35", "36", "37", "38", "39", "40"], qtys: ["1", "1", "3", "3", "3", "2", "2"] },
  infantil: {
    sizes: ["23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36"],
    qtys: Array(14).fill(""),
  },
};

const pad = (n: number) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const isoOf = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const sumQ = (a: string[]) => a.reduce((s, v) => s + (parseInt(v) || 0), 0);
const fmtDia = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paresDaFicha = (f: { total: number; copias: number }) => (Number(f.total) || 0) * Math.max(1, Number(f.copias) || 1);
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Intervalo {from,to} (ISO) do período escolhido. */
function periodRange(mode: PeriodMode, cFrom: string, cTo: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  switch (mode) {
    case "hoje": { const t = todayISO(); return { from: t, to: t }; }
    case "semana": {
      const dow = (now.getDay() + 6) % 7; // 0 = segunda
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

/* ---------- Impressão das FICHAS (A4 paisagem, 6 por folha) ---------- */
const PRINT_CSS = `
  *{box-sizing:border-box} body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a}
  .page{display:grid;grid-template-columns:repeat(2,1fr);gap:6mm;align-content:start;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  .print-card{break-inside:avoid;page-break-inside:avoid;min-width:0;display:flex}
  .card{border:1px solid #000;padding:7px 9px;width:100%;display:flex;flex-direction:column}
  .page-num{float:right;font:600 9px/1 'SF Mono',monospace;letter-spacing:.06em;color:#888}
  .grade-tag{font-family:'SF Mono',monospace;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#b08400;display:inline-block;margin-bottom:4px}
  .grade-tag.adulto{color:#444}
  .head{border:1.5px solid #1f1f1f;clear:both;padding:4px 9px}
  .meta{display:flex;border:1.5px solid #1f1f1f;border-top:none}
  .meta>div{flex:1;padding:3px 9px;border-right:1.5px solid #1f1f1f}
  .meta>div:last-child{border-right:none}
  .lbl{font-family:'SF Mono',monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:2px}
  .v-big{font-size:15px;font-weight:800;line-height:1.1}
  .v-mid{font-size:11px;font-weight:700;min-height:13px;line-height:1.1}
  table{width:100%;border-collapse:collapse;border:1.5px solid #1f1f1f;border-top:none;table-layout:fixed;margin-top:5px}
  th,td{border:1px solid #1f1f1f;text-align:center;height:24px;font-weight:700;font-size:12px}
  .rowlabel{font-family:'SF Mono',monospace;font-size:8px;letter-spacing:.04em;text-transform:uppercase;color:#444;text-align:left;padding:0 6px;width:56px;line-height:1.05}
  thead th{font-family:'SF Mono',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888;height:16px}
  .col-total{width:38px;color:#888}
  .ppf-cell{background:#f1f0ed;font-size:13px}
  @page{size:A4 landscape;margin:8mm}
`;
function cardHTML(f: { dia: string; montador: string | null; solado: string | null; cor?: string | null; grade: Grade; numeracoes: string[]; quantidades: string[]; total: number }) {
  const th = f.numeracoes.map((s) => `<th>${esc(s)}</th>`).join("");
  const td = f.quantidades.map((q) => `<td>${esc(q)}</td>`).join("");
  const tag = f.grade === "infantil" ? "Grade infantil" : "Grade adulta";
  return `<div class="print-card"><div class="card">
    <span class="page-num">1/1</span><span class="grade-tag${f.grade === "adulto" ? " adulto" : ""}">${tag}</span>
    <div class="head"><span class="lbl">Solado</span><div class="v-big">${esc(f.solado || "")}</div></div>
    <div class="meta"><div><span class="lbl">Montador</span><div class="v-mid">${esc(f.montador || "")}</div></div>
      <div><span class="lbl">Cor</span><div class="v-mid">${esc(f.cor || "")}</div></div>
      <div><span class="lbl">Data</span><div class="v-mid">${fmtDia(f.dia)}</div></div></div>
    <table><thead><tr><th class="rowlabel">N°</th>${th}<th class="col-total">TOTAL</th></tr></thead>
      <tbody><tr><td class="rowlabel">Por ficha</td>${td}<td class="ppf-cell">${f.total}</td></tr></tbody></table>
  </div></div>`;
}
function openPrint(html: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita pop-ups neste site para imprimir."); return; }
  w.document.write(html); w.document.close();
}
function imprimirFichas(list: Array<Ficha>, expandByCopias: boolean) {
  const cards = list.flatMap((f) => Array.from({ length: expandByCopias ? Math.max(1, f.copias || 1) : 1 }, () => cardHTML(f)));
  const PER = 6;
  const pages: string[] = [];
  for (let i = 0; i < cards.length; i += PER) pages.push(`<div class="page">${cards.slice(i, i + PER).join("")}</div>`);
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de Montadores</title><style>${PRINT_CSS}</style></head><body>${pages.join("") || '<div class="page"></div>'}<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

/* ---------- Impressão do RELATÓRIO de produtividade (A4 retrato) ---------- */
function imprimirRelatorio(rows: AggRow[], label: string, intervalo: string, totals: { pares: number; pago: number; fichas: number }) {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111}
    h1{font-size:18px;margin:0 0 2px} .sub{font-size:11px;color:#555;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #333;padding:6px 8px}
    th{background:#f1f0ed;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#444}
    td.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:800;background:#f6f5f2}
    @page{size:A4 portrait;margin:12mm}`;
  const body = rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.nome)}</td><td class="n">${r.fichas}</td><td class="n">${r.pares}</td><td class="n">${fmtBRL(r.valorPar)}</td><td class="n">${fmtBRL(r.pago)}</td></tr>`).join("");
  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Produtividade — Montadores</title><style>${css}</style></head><body>
    <h1>Produtividade dos Montadores</h1>
    <div class="sub">${esc(label)} · ${esc(intervalo)} — gerado em ${fmtDia(todayISO())}</div>
    <table><thead><tr><th>Montador</th><th style="text-align:right">Fichas</th><th style="text-align:right">Pares</th><th style="text-align:right">Valor/par</th><th style="text-align:right">Pagamento</th></tr></thead>
    <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#888">Sem dados no período.</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL (${rows.length} montador${rows.length === 1 ? "" : "es"})</td><td class="n">${totals.fichas}</td><td class="n">${totals.pares}</td><td class="n"></td><td class="n">${fmtBRL(totals.pago)}</td></tr></tfoot></table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

interface AggRow { key: string; nome: string; fichas: number; pares: number; pago: number; valorPar: number; }

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  const db = supabase as any;
  const [tab, setTab] = useState<Tab>("lancamento");

  // ── form (lançamento) ──
  const [dia, setDia] = useState(todayISO());
  const [montadorId, setMontadorId] = useState<string>("");
  const [montadorNome, setMontadorNome] = useState("");
  const [soladoId, setSoladoId] = useState<string>("");
  const [soladoNome, setSoladoNome] = useState("");
  const [cor, setCor] = useState("");
  const [valorPar, setValorPar] = useState(0);
  const [grade, setGrade] = useState<Grade>("adulto");
  const [sizes, setSizes] = useState<string[]>(DEFAULTS.adulto.sizes);
  const [qtys, setQtys] = useState<string[]>(DEFAULTS.adulto.qtys);
  const [copias, setCopias] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── dados ──
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: employees = [] } = useEmployees();
  // Só funcionários do CARGO montagem (montadores) entram no select — pedido do
  // dono. Casa por cargo/role OU setor/department contendo "montagem"/"montador".
  const montadores = useMemo(
    () => [...(employees as any[])]
      .filter((e) => e.active && /montagem|montador/i.test(`${e.role || ""} ${e.department || ""}`))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [employees],
  );
  const { data: solados = [] } = useQuery({
    queryKey: ["solados-list-montadores"],
    queryFn: async () => {
      const { data, error } = await db.from("products").select("id,name,color").eq("category", "Solado").eq("active", true).order("name");
      if (error) throw error;
      return (data || []) as { id: string; name: string; color: string | null }[];
    },
  });

  const total = useMemo(() => sumQ(qtys), [qtys]);
  // Valor/par por montador é definido no RELATÓRIO (aba Produtividade), não na
  // ficha. O seed vem do MAIOR valor_par já gravado pra cada montador — reusa a
  // coluna existente, sem migration. Fichas novas nascem com valor_par 0 (o MAX
  // ignora o 0), e a aba Produtividade é a fonte da verdade do cálculo.
  const aggKeyOf = (f: { montador_id?: string | null; montador?: string | null }) =>
    f.montador_id || `txt:${(f.montador || "—").toLowerCase()}`;
  const seedValorPorMontador = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of fichas) {
      const key = aggKeyOf(f);
      const v = Number(f.valor_par) || 0;
      if (v > (m[key] || 0)) m[key] = v;
    }
    return m;
  }, [fichas]);
  // Valor/par editável por montador no relatório. Seed preenche só quem ainda
  // não foi editado à mão (não sobrescreve edição do usuário, inclusive 0).
  const [valorPorMontador, setValorPorMontador] = useState<Record<string, number>>({});
  useEffect(() => {
    setValorPorMontador((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key in seedValorPorMontador) {
        if (next[key] == null) { next[key] = seedValorPorMontador[key]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [seedValorPorMontador]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("ficha_montadores").select("*").order("dia", { ascending: false }).order("criado_em", { ascending: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    else setFichas((data ?? []) as Ficha[]);
    setLoading(false);
  }, [db]);
  useEffect(() => { carregar(); }, [carregar]);

  function novaFicha() {
    setEditingId(null); setDia(todayISO());
    setMontadorId(""); setMontadorNome(""); setSoladoId(""); setSoladoNome(""); setCor(""); setValorPar(0);
    setGrade("adulto"); setSizes(DEFAULTS.adulto.sizes); setQtys(DEFAULTS.adulto.qtys); setCopias(1);
  }
  function trocarGrade(g: Grade) { setGrade(g); setSizes([...DEFAULTS[g].sizes]); setQtys([...DEFAULTS[g].qtys]); }
  const setSize = (i: number, v: string) => setSizes((a) => a.map((x, j) => (j === i ? v : x)));
  const setQty = (i: number, v: string) => setQtys((a) => a.map((x, j) => (j === i ? v.replace(/[^\d]/g, "") : x)));
  const addCol = () => { setSizes((a) => [...a, ""]); setQtys((a) => [...a, ""]); };
  const remCol = () => { if (sizes.length <= 1) return; setSizes((a) => a.slice(0, -1)); setQtys((a) => a.slice(0, -1)); };

  function pickMontador(id: string) {
    setMontadorId(id);
    const e = montadores.find((x) => x.id === id);
    setMontadorNome(e?.name ?? "");
  }
  function pickSolado(id: string) {
    setSoladoId(id);
    const s = (solados as any[]).find((x) => x.id === id);
    setSoladoNome(s ? `${s.name}${s.color ? " " + s.color : ""}` : "");
  }

  async function salvar() {
    if (!dia) { setMsg({ type: "err", text: "Informe a data da ficha." }); return; }
    if (!montadorId) { setMsg({ type: "err", text: "Selecione o montador." }); return; }
    setSaving(true); setMsg(null);
    const payload: any = {
      dia, montador: montadorNome || null, montador_id: montadorId || null,
      solado: soladoNome || null, solado_id: soladoId || null, cor: cor.trim() || null,
      grade, numeracoes: sizes, quantidades: qtys, total, copias, valor_par: valorPar || 0,
      atualizado_em: new Date().toISOString(),
    };
    const save = (pl: any) => editingId
      ? db.from("ficha_montadores").update(pl).eq("id", editingId)
      : db.from("ficha_montadores").insert(pl);
    let { error } = await save(payload);
    // Resiliente: se a coluna `cor` ainda não existe no banco (migration pendente),
    // grava sem ela em vez de quebrar a ficha (página de uso diário).
    if (error && /['"\s]cor['"\s]|column .*cor|'cor'/i.test(error.message || "")) {
      const { cor: _omit, ...semCor } = payload;
      ({ error } = await save(semCor));
    }
    if (error) setMsg({ type: "err", text: "Erro ao salvar: " + error.message });
    else { setMsg({ type: "ok", text: editingId ? "Ficha atualizada." : "Ficha salva." }); await carregar(); if (!editingId) novaFicha(); }
    setSaving(false);
  }
  function abrir(f: Ficha) {
    setTab("lancamento"); setEditingId(f.id); setDia(f.dia);
    setMontadorId(f.montador_id ?? ""); setMontadorNome(f.montador ?? "");
    setSoladoId(f.solado_id ?? ""); setSoladoNome(f.solado ?? ""); setCor((f as any).cor ?? ""); setValorPar(Number(f.valor_par) || 0);
    setGrade(f.grade); setSizes(f.numeracoes ?? []); setQtys(f.quantidades ?? []); setCopias(f.copias ?? 1); setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function excluir(f: Ficha) {
    if (!window.confirm("Excluir esta ficha?")) return;
    const { error } = await db.from("ficha_montadores").delete().eq("id", f.id);
    if (error) setMsg({ type: "err", text: "Erro ao excluir: " + error.message });
    else { if (editingId === f.id) novaFicha(); await carregar(); }
  }
  // Persiste o valor/par definido por montador no relatório. Reusa a coluna
  // valor_par (sem migration): grava em TODAS as fichas daquele montador, pra o
  // seed (MAX valor_par) sobreviver ao reload. Fichas sem montador_id ficam só
  // em memória (não dá pra casar com segurança).
  async function persistRateMontador(key: string, valor: number) {
    if (key.startsWith("txt:")) return;
    const { error } = await db.from("ficha_montadores").update({ valor_par: valor }).eq("montador_id", key);
    if (error) { setMsg({ type: "err", text: "Erro ao salvar valor/par: " + error.message }); return; }
    setFichas((fs) => fs.map((f) => (f.montador_id === key ? { ...f, valor_par: valor } : f)));
  }

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

  const agg = useMemo<AggRow[]>(() => {
    const m = new Map<string, AggRow>();
    for (const f of fichasFiltradas) {
      const key = aggKeyOf(f);
      const pares = paresDaFicha(f);
      const cur = m.get(key) || { key, nome: f.montador || "(sem montador)", fichas: 0, pares: 0, pago: 0, valorPar: 0 };
      cur.fichas += 1; cur.pares += pares;
      m.set(key, cur);
    }
    // pago = pares × valor/par definido por montador NO RELATÓRIO.
    const rows = Array.from(m.values());
    for (const r of rows) {
      r.valorPar = valorPorMontador[r.key] ?? 0;
      r.pago = r.pares * r.valorPar;
    }
    return rows.sort((a, b) => b.pares - a.pares);
  }, [fichasFiltradas, valorPorMontador]);
  const totals = useMemo(
    () => agg.reduce((s, r) => ({ fichas: s.fichas + r.fichas, pares: s.pares + r.pares, pago: s.pago + r.pago }), { fichas: 0, pares: 0, pago: 0 }),
    [agg],
  );

  const grupos = useMemo(() => {
    const m = new Map<string, Ficha[]>();
    for (const f of fichasFiltradas) { if (!m.has(f.dia)) m.set(f.dia, []); m.get(f.dia)!.push(f); }
    return Array.from(m.entries());
  }, [fichasFiltradas]);

  const lbl = "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";
  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "lancamento", label: "Lançamento", icon: ClipboardText },
    { id: "produtividade", label: "Produtividade", icon: ChartBar },
    { id: "fichas", label: "Fichas salvas", icon: ListChecks },
  ];

  return (
    <div className="w-full space-y-6">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · MONTADORES"
        title="Ficha de Montadores"
        description="Lance as fichas por dia e acompanhe o rendimento (pares e pagamento) de cada montador por período."
        meta={<><span className="font-bold">{fichas.length}</span> FICHA{fichas.length === 1 ? "" : "S"}</>}
      />

      {/* abas */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`rounded-md px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>{msg.text}</div>
      )}

      {/* ════ LANÇAMENTO ════ */}
      {tab === "lancamento" && (
        <Panel
          eyebrow={editingId ? "EDITANDO FICHA" : "NOVA FICHA"}
          title="Dados da ficha"
          actions={
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-border">
                {(["adulto", "infantil"] as Grade[]).map((g) => (
                  <button key={g} type="button" onClick={() => trocarGrade(g)}
                    className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${grade === g ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted/40"}`}>{g}</button>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5"
                onClick={() => imprimirFichas([{ id: "x", dia, montador: montadorNome || null, montador_id: montadorId || null, solado: soladoNome || null, solado_id: soladoId || null, cor: cor || null, grade, numeracoes: sizes, quantidades: qtys, total, copias, valor_par: valorPar }], true)}>
                <Printer className="h-4 w-4" /> Imprimir
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={lbl}>Data</label>
              <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Montador *</label>
              <Select value={montadorId} onValueChange={pickMontador}>
                <SelectTrigger><SelectValue placeholder="Selecione o montador" /></SelectTrigger>
                <SelectContent>
                  {montadores.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum funcionário com cargo "Montagem". Defina o cargo em Funcionários.</div>
                  )}
                  {montadores.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={lbl}>Solado</label>
              <Select value={soladoId} onValueChange={pickSolado}>
                <SelectTrigger><SelectValue placeholder="Selecione o solado" /></SelectTrigger>
                <SelectContent>
                  {(solados as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.color ? ` · ${s.color}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={lbl}>Cor</label>
              <Input value={cor} placeholder="Cor da montagem" onChange={(e) => setCor(e.target.value)} />
            </div>
          </div>

          {/* grade de numerações */}
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grade de numerações</span>
              <span className="text-[11px] text-muted-foreground/70">pares por ficha</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="w-full border-collapse text-center" style={{ minWidth: 520 }}>
                <thead>
                  <tr className="bg-muted/30">
                    <th className="border-b border-r border-border px-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 110 }}>N°</th>
                    {sizes.map((s, i) => (
                      <th key={i} className="border-b border-r border-border p-0">
                        <input className="h-9 w-full bg-transparent text-center text-sm font-bold text-foreground outline-none transition-colors focus:bg-primary/5" value={s} onChange={(e) => setSize(i, e.target.value)} />
                      </th>
                    ))}
                    <th className="border-b border-border bg-primary/5 text-[10px] font-bold uppercase tracking-wider text-primary" style={{ width: 64 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-r border-border px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Por ficha</td>
                    {qtys.map((q, i) => (
                      <td key={i} className="border-r border-border p-0">
                        <input inputMode="numeric" className="h-11 w-full bg-transparent text-center text-base font-bold tabular-nums text-foreground outline-none transition-colors focus:bg-primary/5" value={q} onChange={(e) => setQty(i, e.target.value)} />
                      </td>
                    ))}
                    <td className="bg-primary/5 text-lg font-bold tabular-nums text-primary">{total}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tamanhos</span>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={remCol}>– col</Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addCol}>+ col</Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cópias</span>
              <Input type="number" min={1} value={copias} onChange={(e) => setCopias(Math.max(1, parseInt(e.target.value) || 1))} className="h-8 w-16 text-center" />
            </div>
            {/* prévia do rendimento desta ficha */}
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pares (total × cópias)</span>
              <strong className="text-base font-bold tabular-nums text-primary leading-none">{total * Math.max(1, copias)}</strong>
            </div>

            <div className="ml-auto flex flex-wrap gap-2">
              {editingId && <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={novaFicha}><Plus className="h-4 w-4" /> Nova ficha</Button>}
              <Button type="button" onClick={salvar} disabled={saving || !dia || !montadorId} size="sm" className="h-9">
                {saving ? "Salvando…" : editingId ? "Atualizar ficha" : "Salvar ficha"}
              </Button>
            </div>
          </div>
        </Panel>
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
          <div className="min-w-[200px]">
            <label className={lbl}>Montador</label>
            <Select value={filtroMontador} onValueChange={setFiltroMontador}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os montadores</SelectItem>
                {montadores.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{fmtDia(range.from)} – {fmtDia(range.to)}</div>
        </div>
      )}

      {/* ════ PRODUTIVIDADE ════ */}
      {tab === "produtividade" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Montadores", value: String(agg.length) },
              { label: "Fichas", value: String(totals.fichas) },
              { label: "Pares (total × cópias)", value: totals.pares.toLocaleString("pt-BR"), accent: true },
              { label: "Pagamento", value: fmtBRL(totals.pago) },
            ].map((k) => (
              <div key={k.label} className={`rounded-lg border p-3 transition-colors ${k.accent ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-border"}`}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{k.label}</p>
                <p className={`mt-1 tabular-nums font-bold leading-none ${k.accent ? "text-2xl text-primary" : "text-xl text-foreground"}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <Panel
            eyebrow={`${periodLabel[pMode]} · ${fmtDia(range.from)}–${fmtDia(range.to)}`}
            title="Rendimento por montador"
            actions={<Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={agg.length === 0} onClick={() => imprimirRelatorio(agg, periodLabel[pMode], `${fmtDia(range.from)} a ${fmtDia(range.to)}`, totals)}><Printer className="h-4 w-4" /> Imprimir relatório</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="px-3 py-2 w-8">#</th><th className="px-3 py-2">Montador</th><th className="px-3 py-2 text-right">Fichas</th><th className="px-3 py-2 text-right">Pares</th><th className="px-3 py-2 text-right">Valor/par</th><th className="px-3 py-2 text-right">Pagamento</th></tr>
                </thead>
                <tbody>
                  {agg.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Sem lançamentos no período.</td></tr>}
                  {agg.map((r, i) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.nome}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.fichas}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{r.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right">
                        {/* Valor/par por montador — fonte do cálculo. Digita → recalcula
                            na hora; sai do campo → persiste (reusa valor_par). */}
                        <div
                          className="ml-auto w-28"
                          onBlur={() => persistRateMontador(r.key, valorPorMontador[r.key] ?? 0)}
                        >
                          <CurrencyInput
                            value={valorPorMontador[r.key] ?? 0}
                            onChange={(v) => setValorPorMontador((p) => ({ ...p, [r.key]: v }))}
                            className="h-8 text-right"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtBRL(r.pago)}</td>
                    </tr>
                  ))}
                </tbody>
                {agg.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/30">
                      <td className="px-3 py-2" /><td className="px-3 py-2">Total ({agg.length})</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.fichas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{totals.pares.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.pago)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ════ FICHAS SALVAS (período) ════ */}
      {tab === "fichas" && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Fichas do período</h2>
            {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
            {!loading && <span className="text-xs text-muted-foreground">{fichasFiltradas.length} ficha(s)</span>}
          </div>
          {!loading && fichasFiltradas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhuma ficha no período selecionado.</p>
          )}
          <div className="space-y-5">
            {grupos.map(([d, lista]) => (
              <div key={d}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">{fmtDia(d)} <span className="font-normal text-muted-foreground">· {lista.length} ficha(s)</span></h3>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => imprimirFichas(lista, true)}><Printer className="h-3.5 w-3.5" /> Imprimir o dia</Button>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="px-3 py-2">Montador</th><th className="px-3 py-2">Solado</th><th className="px-3 py-2">Cor</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2 text-center">Total</th><th className="px-3 py-2 text-center">Cópias</th><th className="px-3 py-2 text-right">Pares</th><th className="px-3 py-2 text-right">Ações</th></tr>
                    </thead>
                    <tbody>
                      {lista.map((f) => (
                        <tr key={f.id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{f.montador || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{f.solado || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{(f as any).cor || "—"}</td>
                          <td className="px-3 py-2 capitalize text-muted-foreground">{f.grade}</td>
                          <td className="px-3 py-2 text-center font-semibold text-foreground">{f.total}</td>
                          <td className="px-3 py-2 text-center text-muted-foreground">{f.copias}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{paresDaFicha(f).toLocaleString("pt-BR")}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => abrir(f)} className="mr-3 text-xs font-medium text-primary hover:underline">Abrir</button>
                            <button onClick={() => excluir(f)} className="text-xs font-medium text-muted-foreground hover:text-red-600 dark:hover:text-red-400">Excluir</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
