// FichaMontadoresPage.tsx — Squad Shoes
// "Ficha de Montadores" → CHAMADA DO DIA: lançamento da PRODUÇÃO DIÁRIA dos
// montadores (quantas fichas cada um fechou por dia). Roster do setor Montagem
// numa tela só, um stepper por montador, um único "Salvar o dia" (upsert em
// lote). Visão "Semana" = matriz montadores × Seg–Sex pro gestor fechar a semana.
// Detalhe opcional por referência/cor (a soma = total do dia).
//
// Modelo 'chamada' em public.ficha_montadores: 1 linha por (dia, montador_id) com
// fichas_dia + detalhe jsonb + origem='chamada'. Compat com Produtividade: grava
// total=fichas_dia, copias=1 → paresDaFicha = fichas_dia (agg não muda de fórmula).
// Fichas antigas de grade ficam origem='legacy' (histórico intacto).
//
// Print (relatório/dia) abre em window próprio com cores hardcoded de propósito.
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatGrid, StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useEmployees } from "@/hooks/useEmployees";
import { toast } from "sonner";
import { Printer, Plus, Minus, ChartBar, ClipboardText, ListChecks, Users, Package, CurrencyDollar, FloppyDisk, CaretLeft, CaretRight, X } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";
type Tab = "lancamento" | "produtividade" | "fichas";
type ChamadaView = "dia" | "semana";
type PeriodMode = "hoje" | "semana" | "q1" | "q2" | "mes" | "custom";

interface DetItem { reference_id: string | null; referencia: string | null; cor: string | null; qtd: number; }

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
  total: number;
  copias: number;
  valor_par: number | null;
  fichas_dia?: number | null;  // modelo 'chamada'
  detalhe?: DetItem[] | null;  // modelo 'chamada'
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

// É um registro do modelo novo (produção diária)? origem='chamada'; ou, antes da
// migration (sem coluna origem), uma linha sem grade (numeracoes vazias).
const isChamada = (f: Ficha) =>
  f.origem === "chamada" || (f.origem == null && Array.isArray(f.numeracoes) && f.numeracoes.length === 0);
const fichasDiaOf = (f: Ficha) => Number(f.fichas_dia ?? f.total) || 0;

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

/** Intervalo {from,to} (ISO) do período escolhido (Produtividade + Fichas). */
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
    <table><thead><tr><th>Montador</th><th style="text-align:right">Fichas</th><th style="text-align:right">Pares</th><th style="text-align:right">Valor/ficha</th><th style="text-align:right">Pagamento</th></tr></thead>
    <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#888">Sem dados no período.</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL (${rows.length} montador${rows.length === 1 ? "" : "es"})</td><td class="n">${totals.fichas}</td><td class="n">${totals.pares}</td><td class="n"></td><td class="n">${fmtBRL(totals.pago)}</td></tr></tfoot></table>
    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}

interface AggRow { key: string; nome: string; fichas: number; pares: number; pago: number; valorPar: number; }

/* ---------- Sub-form: adicionar uma referência ao detalhe de um montador ---------- */
function DetalheAdd({ references, onAdd }: { references: { id: string; code: string | null; name: string | null }[]; onAdd: (d: DetItem) => void }) {
  const [refId, setRefId] = useState("");
  const [refNome, setRefNome] = useState("");
  const [cor, setCor] = useState("");
  const [qtd, setQtd] = useState(1);
  const lblXs = "block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";
  function add() {
    if (qtd <= 0) return;
    onAdd({ reference_id: refId || null, referencia: refNome || null, cor: cor.trim() || null, qtd });
    setRefId(""); setRefNome(""); setCor(""); setQtd(1);
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-[180px] flex-1">
        <label className={lblXs}>Referência</label>
        <SearchableSelect
          value={refId}
          onChange={(id) => { setRefId(id); const r = references.find((x) => x.id === id); setRefNome(r ? (r.name || r.code || "") : ""); }}
          options={references.map((r) => ({ value: r.id, label: r.name || r.code || "", description: r.name && r.code ? r.code : undefined, keywords: r.code || undefined }))}
          placeholder="Referência"
          searchPlaceholder="Buscar referência ou código..."
          emptyText="Nenhuma referência."
        />
      </div>
      <div className="w-28">
        <label className={lblXs}>Cor</label>
        <Input value={cor} onChange={(e) => setCor(e.target.value)} list="cores-montagem" placeholder="Cor" autoComplete="off" className="h-9" />
      </div>
      <div className="w-16">
        <label className={lblXs}>Qtd</label>
        <Input type="number" min={1} value={qtd} onChange={(e) => setQtd(Math.max(1, parseInt(e.target.value) || 1))} className="h-9 text-center" />
      </div>
      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={add}><Plus className="h-3.5 w-3.5" /> Adicionar</Button>
    </div>
  );
}

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  const db = supabase as any;
  const [tab, setTab] = useState<Tab>("lancamento");

  // ── chamada do dia / semana ──
  const [chamadaView, setChamadaView] = useState<ChamadaView>("dia");
  const [chamadaDia, setChamadaDia] = useState(todayISO());
  const [semanaAnchor, setSemanaAnchor] = useState(todayISO());
  const [busca, setBusca] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [origCounts, setOrigCounts] = useState<Record<string, number>>({});
  const [detalhe, setDetalhe] = useState<Record<string, DetItem[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({});
  const [origWeek, setOrigWeek] = useState<Record<string, number>>({});
  const [savingDia, setSavingDia] = useState(false);
  const [savingSem, setSavingSem] = useState(false);

  // ── dados ──
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: employees = [] } = useEmployees();
  // Só funcionários do setor Montagem (montadores). Casa por cargo OU setor.
  const montadores = useMemo(
    () => [...(employees as any[])]
      .filter((e) => e.active && /montagem|montador/i.test(`${e.role || ""} ${e.department || ""}`))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [employees],
  );
  // Referências (fichas técnicas) — pro detalhe opcional.
  const { data: references = [] } = useQuery({
    queryKey: ["references-list-montadores"],
    queryFn: async () => {
      const { data, error } = await db.from("technical_sheets").select("id,code,name").order("name");
      if (error) throw error;
      return (data || []) as { id: string; code: string | null; name: string | null }[];
    },
  });

  // Cores já usadas (autocomplete do campo Cor do detalhe).
  const { data: coresCatalogo = [] } = useQuery({
    queryKey: ["cores-distinct-montadores"],
    queryFn: async () => {
      const { data, error } = await db.from("products").select("color").not("color", "is", null);
      if (error) throw error;
      return (data || []).map((r: any) => (r.color || "").trim()).filter(Boolean) as string[];
    },
  });
  const coresSugeridas = useMemo(() => {
    const s = new Set<string>(coresCatalogo);
    for (const f of fichas) {
      const det = isChamada(f) && Array.isArray(f.detalhe) ? f.detalhe : [];
      for (const d of det) { const c = (d.cor || "").trim(); if (c) s.add(c); }
      const c0 = ((f as any).cor || "").trim(); if (c0) s.add(c0);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [coresCatalogo, fichas]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("ficha_montadores").select("*").order("dia", { ascending: false }).order("criado_em", { ascending: false });
    if (error) toast.error("Erro ao carregar: " + error.message);
    else setFichas((data ?? []) as Ficha[]);
    setLoading(false);
  }, [db]);
  useEffect(() => { carregar(); }, [carregar]);

  // Semeia a contagem do dia a partir do que já está no banco (edição = sobrescrita).
  useEffect(() => {
    const c: Record<string, number> = {};
    const d: Record<string, DetItem[]> = {};
    for (const f of fichas) {
      if (!isChamada(f) || !f.montador_id || f.dia !== chamadaDia) continue;
      c[f.montador_id] = fichasDiaOf(f);
      if (Array.isArray(f.detalhe) && f.detalhe.length) d[f.montador_id] = f.detalhe;
    }
    setCounts(c); setOrigCounts(c); setDetalhe(d); setExpanded({});
  }, [fichas, chamadaDia]);

  // Semeia a matriz da semana.
  useEffect(() => {
    const days = weekDaysOf(semanaAnchor);
    const w: Record<string, number> = {};
    for (const f of fichas) {
      if (!isChamada(f) || !f.montador_id) continue;
      if (days.includes(f.dia)) w[`${f.montador_id}|${f.dia}`] = fichasDiaOf(f);
    }
    setWeekCounts(w); setOrigWeek(w);
  }, [fichas, semanaAnchor]);

  // ── helpers de contagem (dia) ──
  const sumDet = (mid: string) => (detalhe[mid] || []).reduce((s, d) => s + (Number(d.qtd) || 0), 0);
  const hasDet = (mid: string) => (detalhe[mid] || []).length > 0;
  const effCount = (mid: string) => (hasDet(mid) ? sumDet(mid) : (counts[mid] || 0));
  const setCount = (mid: string, v: number) => setCounts((c) => ({ ...c, [mid]: Math.max(0, v) }));
  const setWeek = (mid: string, day: string, v: number) => setWeekCounts((c) => ({ ...c, [`${mid}|${day}`]: Math.max(0, v) }));
  const toggleExpand = (mid: string) => setExpanded((p) => ({ ...p, [mid]: !p[mid] }));
  const addDet = (mid: string, d: DetItem) => setDetalhe((p) => ({ ...p, [mid]: [...(p[mid] || []), d] }));
  const removeDet = (mid: string, idx: number) => setDetalhe((p) => ({ ...p, [mid]: (p[mid] || []).filter((_, i) => i !== idx) }));

  const rosterFiltrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? montadores.filter((e) => `${e.name} ${e.role || ""} ${e.department || ""}`.toLowerCase().includes(q)) : montadores;
  }, [montadores, busca]);

  const totalDia = useMemo(() => montadores.reduce((s, e) => s + effCount(e.id), 0), [montadores, counts, detalhe]);
  const dirtyDia = useMemo(() => montadores.filter((e) => effCount(e.id) !== (origCounts[e.id] || 0)).length, [montadores, counts, detalhe, origCounts]);

  const weekDays = useMemo(() => weekDaysOf(semanaAnchor), [semanaAnchor]);
  const weekLabel = `${fmtDia(weekDays[0])} – ${fmtDia(weekDays[4])}`;
  const grandWeek = useMemo(() => Object.values(weekCounts).reduce((s, v) => s + (v || 0), 0), [weekCounts]);

  const fichasHoje = useMemo(() => {
    const t = todayISO();
    return fichas.filter((f) => isChamada(f) && f.dia === t).reduce((s, f) => s + fichasDiaOf(f), 0);
  }, [fichas]);

  // Persiste 1 montador (modelo 'chamada'): update se já existe linha do dia, senão insert; delete se zerou.
  async function persistChamada(dia: string, e: { id: string; name: string }, val: number): Promise<string | null> {
    const existing = fichas.find((f) => isChamada(f) && f.montador_id === e.id && f.dia === dia);
    if (val <= 0) {
      if (!existing) return null;
      const { error } = await db.from("ficha_montadores").delete().eq("id", existing.id);
      return error ? error.message : null;
    }
    const det = detalhe[e.id]?.length ? detalhe[e.id] : null;
    const payload: any = {
      dia, montador: e.name, montador_id: e.id,
      fichas_dia: val, total: val, copias: 1, grade: "adulto", numeracoes: [], quantidades: [],
      cor: null, referencia: null, reference_id: null, detalhe: det, origem: "chamada",
      valor_par: existing?.valor_par ?? 0, atualizado_em: new Date().toISOString(),
    };
    const write = (pl: any) => existing
      ? db.from("ficha_montadores").update(pl).eq("id", existing.id)
      : db.from("ficha_montadores").insert(pl);
    let { error } = await write(payload);
    // Resiliente: se a migration ainda não subiu, regrava sem a(s) coluna(s) nova(s).
    if (error && /column|could not find/i.test(error.message || "")) {
      const msg = (error.message || "").toLowerCase();
      const retry: any = { ...payload };
      if (msg.includes("fichas_dia")) delete retry.fichas_dia;
      if (msg.includes("detalhe")) delete retry.detalhe;
      if (msg.includes("origem")) delete retry.origem;
      ({ error } = await write(retry));
    }
    return error ? error.message : null;
  }

  async function salvarDia() {
    setSavingDia(true);
    const changed = montadores.filter((e) => effCount(e.id) !== (origCounts[e.id] || 0));
    let ok = 0; const erros: string[] = [];
    for (const e of changed) {
      const err = await persistChamada(chamadaDia, e, effCount(e.id));
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
        const v = weekCounts[k] || 0;
        if (v === (origWeek[k] || 0)) continue;
        const m = await persistChamada(day, e, v);
        if (m) err++; else ok++;
      }
    }
    await carregar();
    setSavingSem(false);
    if (err) toast.error(`Falha em ${err} célula(s).`);
    if (ok) toast.success(`Semana salva — ${ok} lançamento${ok === 1 ? "" : "s"}.`);
    if (!ok && !err) toast.message("Nada para salvar.");
  }

  function zerarDia() { setCounts({}); setDetalhe({}); }
  function zerarSemana() {
    setWeekCounts((w) => { const n = { ...w }; for (const k in n) n[k] = 0; return n; });
  }
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
  async function persistRateMontador(key: string, valor: number) {
    if (key.startsWith("txt:")) return;
    const { error } = await db.from("ficha_montadores").update({ valor_par: valor }).eq("montador_id", key);
    if (error) { toast.error("Erro ao salvar valor/ficha: " + error.message); return; }
    setFichas((fs) => fs.map((f) => (f.montador_id === key ? { ...f, valor_par: valor } : f)));
  }

  // ── valor/ficha por montador (Produtividade) ──
  const aggKeyOf = (f: { montador_id?: string | null; montador?: string | null }) =>
    f.montador_id || `txt:${(f.montador || "—").toLowerCase()}`;
  const seedValorPorMontador = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of fichas) { const key = aggKeyOf(f); const v = Number(f.valor_par) || 0; if (v > (m[key] || 0)) m[key] = v; }
    return m;
  }, [fichas]);
  const [valorPorMontador, setValorPorMontador] = useState<Record<string, number>>({});
  useEffect(() => {
    setValorPorMontador((prev) => {
      let changed = false; const next = { ...prev };
      for (const key in seedValorPorMontador) { if (next[key] == null) { next[key] = seedValorPorMontador[key]; changed = true; } }
      return changed ? next : prev;
    });
  }, [seedValorPorMontador]);

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
      // modelo 'chamada': cada linha = fichas_dia fichas; legado: 1 ficha por linha.
      const fichasContrib = isChamada(f) ? fichasDiaOf(f) : 1;
      const pares = paresDaFicha(f);
      const cur = m.get(key) || { key, nome: f.montador || "(sem montador)", fichas: 0, pares: 0, pago: 0, valorPar: 0 };
      cur.fichas += fichasContrib; cur.pares += pares;
      m.set(key, cur);
    }
    const rows = Array.from(m.values());
    for (const r of rows) { r.valorPar = valorPorMontador[r.key] ?? 0; r.pago = r.pares * r.valorPar; }
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
    { id: "lancamento", label: "Chamada do dia", icon: ClipboardText },
    { id: "produtividade", label: "Produtividade", icon: ChartBar },
    { id: "fichas", label: "Fichas salvas", icon: ListChecks },
  ];

  return (
    <div className="w-full space-y-6">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · MONTADORES"
        title="Ficha de Montadores"
        description="Bata quantas fichas cada montador fechou no dia — o time inteiro numa tela. Opcional: detalhe por referência."
        meta={<><span className="font-bold">{montadores.length}</span> MONTADOR{montadores.length === 1 ? "" : "ES"} · <span className="font-bold">{fichasHoje}</span> FICHA{fichasHoje === 1 ? "" : "S"} HOJE</>}
      />

      {/* datalist de cores (usado pelo detalhe) */}
      <datalist id="cores-montagem">
        {coresSugeridas.map((c) => <option key={c} value={c} />)}
      </datalist>

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
            <div className="min-w-[200px] flex-1">
              <label className={lbl}>Buscar</label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar montador…" className="h-9" />
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
              <EmptyState icon={Users} title="Nenhum montador cadastrado"
                description='Defina funcionários com cargo ou setor "Montagem" em Funcionários para lançar a produção.' />
            </Panel>
          ) : chamadaView === "dia" ? (
            <Panel
              flush
              eyebrow="CONTAGEM DO DIA"
              title={`${weekdayName(chamadaDia)} · ${fmtDia(chamadaDia)}`}
              actions={<Button type="button" variant="outline" size="sm" className="h-8" onClick={zerarDia}>Zerar tudo</Button>}
            >
              {/* cabeçalho da lista */}
              <div className="grid items-center border-b-2 border-border/80 bg-muted/40 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ gridTemplateColumns: "1fr 168px" }}>
                <span>Montador</span><span className="text-right">Fichas</span>
              </div>
              {rosterFiltrado.map((e) => {
                const val = effCount(e.id);
                const det = detalhe[e.id] || [];
                const locked = det.length > 0;
                const isExp = !!expanded[e.id] || locked;
                return (
                  <div key={e.id} className="border-b border-border/50 transition-colors hover:bg-primary/[0.03]" style={{ borderLeft: `2px solid ${val > 0 ? "hsl(var(--primary))" : "transparent"}` }}>
                    <div className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: "1fr 168px" }}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{e.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{[e.role, e.department].filter(Boolean).join(" · ") || "Montagem"}</span>
                          <button type="button" onClick={() => toggleExpand(e.id)} className="inline-flex shrink-0 items-center gap-1 font-semibold text-muted-foreground hover:text-foreground">
                            <Plus className="h-3 w-3" /> {isExp ? "fechar" : "detalhar"}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" disabled={locked} onClick={() => setCount(e.id, (counts[e.id] || 0) - 1)} aria-label={`Diminuir fichas de ${e.name}`}><Minus className="h-4 w-4" /></Button>
                        <input
                          inputMode="numeric"
                          disabled={locked}
                          value={locked ? val : (counts[e.id] ?? 0)}
                          onFocus={(ev) => ev.target.select()}
                          onChange={(ev) => setCount(e.id, parseInt(ev.target.value.replace(/[^\d]/g, "")) || 0)}
                          className="h-9 w-14 rounded-md border border-border bg-card text-center text-base font-bold tabular-nums text-foreground outline-none transition-colors focus:border-foreground disabled:bg-muted/40 disabled:text-muted-foreground"
                          aria-label={`Fichas de ${e.name}`}
                        />
                        <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" disabled={locked} onClick={() => setCount(e.id, (counts[e.id] || 0) + 1)} aria-label={`Aumentar fichas de ${e.name}`}><Plus className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-3 pt-0.5">
                        <div className="rounded-md border border-dashed border-border bg-muted/20 p-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {det.length === 0 && <span className="text-[11px] text-muted-foreground">Sem detalhe — opcional. A soma das referências vira o total do dia.</span>}
                            {det.map((d, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground">
                                {d.referencia || "ref"}{d.cor ? ` · ${d.cor}` : ""} ×{d.qtd}
                                <button type="button" onClick={() => removeDet(e.id, idx)} className="opacity-60 hover:opacity-100" aria-label="Remover"><X className="h-3 w-3" /></button>
                              </span>
                            ))}
                          </div>
                          <DetalheAdd references={references as any[]} onAdd={(d) => addDet(e.id, d)} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {rosterFiltrado.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum montador encontrado para "{busca}".</div>
              )}
              {/* rodapé: total + salvar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-foreground px-4 py-3.5">
                <div className="flex items-baseline gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total do dia</span>
                  <span className="text-3xl leading-none tabular-nums text-primary" style={{ fontFamily: "var(--font-display)" }}>{totalDia}</span>
                  {dirtyDia > 0 && <span className="text-[11px] font-semibold text-amber-600">● {dirtyDia} alterado{dirtyDia === 1 ? "" : "s"}</span>}
                </div>
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
              actions={<Button type="button" variant="outline" size="sm" className="h-8" onClick={zerarSemana}>Zerar tudo</Button>}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-center">
                  <thead>
                    <tr className="border-b-2 border-border/80 bg-muted/40">
                      <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ minWidth: 150 }}>Montador</th>
                      {weekDays.map((d, i) => (
                        <th key={d} className="px-1 py-2.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" style={{ minWidth: 60 }}>{WD_SHORT[i]} {d.slice(8)}</th>
                      ))}
                      <th className="border-l-2 border-border px-2 py-2.5 text-[11px] font-bold uppercase text-foreground" style={{ width: 54 }}>Tot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterFiltrado.map((e) => {
                      const rt = weekDays.reduce((s, d) => s + (weekCounts[`${e.id}|${d}`] || 0), 0);
                      return (
                        <tr key={e.id} className="border-b border-border/50">
                          <td className="sticky left-0 z-10 bg-card px-4 py-1.5 text-left"><span className="whitespace-nowrap text-sm font-semibold text-foreground">{e.name}</span></td>
                          {weekDays.map((d) => (
                            <td key={d} className="px-1 py-1">
                              <input inputMode="numeric"
                                value={weekCounts[`${e.id}|${d}`] || ""}
                                placeholder="·"
                                onFocus={(ev) => ev.target.select()}
                                onChange={(ev) => setWeek(e.id, d, parseInt(ev.target.value.replace(/[^\d]/g, "")) || 0)}
                                className="h-8 w-full rounded border border-border/70 bg-card text-center text-sm font-semibold tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground"
                                aria-label={`${e.name} ${fmtDia(d)}`} />
                            </td>
                          ))}
                          <td className="border-l-2 border-border text-center font-mono text-sm font-bold tabular-nums text-foreground">{rt}</td>
                        </tr>
                      );
                    })}
                    {rosterFiltrado.length === 0 && (
                      <tr><td colSpan={weekDays.length + 2} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum montador encontrado para "{busca}".</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-foreground bg-muted/30">
                      <td className="sticky left-0 z-10 bg-muted/30 px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Total / dia</td>
                      {weekDays.map((d) => {
                        const ct = rosterFiltrado.reduce((s, e) => s + (weekCounts[`${e.id}|${d}`] || 0), 0);
                        return <td key={d} className="font-mono text-sm font-bold tabular-nums text-foreground">{ct}</td>;
                      })}
                      <td className="border-l-2 border-border text-center tabular-nums text-primary" style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>{grandWeek}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <span className="text-[11px] text-muted-foreground">Semana {weekLabel} · <strong className="text-foreground">{grandWeek}</strong> fichas</span>
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
            <StatCard label="Pares" value={totals.pares.toLocaleString("pt-BR")} icon={Package} />
            <StatCard label="Pagamento" value={fmtBRL(totals.pago)} icon={CurrencyDollar} />
          </StatGrid>

          <Panel
            eyebrow={`${periodLabel[pMode]} · ${fmtDia(range.from)}–${fmtDia(range.to)}`}
            title="Rendimento por montador"
            actions={<Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={agg.length === 0} onClick={() => imprimirRelatorio(agg, periodLabel[pMode], `${fmtDia(range.from)} a ${fmtDia(range.to)}`, totals)}><Printer className="h-4 w-4" /> Imprimir relatório</Button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="px-3 py-2 w-8">#</th><th className="px-3 py-2">Montador</th><th className="px-3 py-2 text-right">Fichas</th><th className="px-3 py-2 text-right">Pares</th><th className="px-3 py-2 text-right">Valor/ficha</th><th className="px-3 py-2 text-right">Pagamento</th></tr>
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
                        <div className="ml-auto w-28" onBlur={() => persistRateMontador(r.key, valorPorMontador[r.key] ?? 0)}>
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
            <h2 className="text-lg font-semibold text-foreground">Lançamentos do período</h2>
            {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
            {!loading && <span className="text-xs text-muted-foreground">{fichasFiltradas.length} lançamento(s)</span>}
          </div>
          {!loading && fichasFiltradas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum lançamento no período selecionado.</p>
          )}
          <div className="space-y-5">
            {grupos.map(([d, lista]) => {
              const totalDoDia = lista.reduce((s, f) => s + (isChamada(f) ? fichasDiaOf(f) : paresDaFicha(f)), 0);
              return (
                <div key={d}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">{fmtDia(d)} <span className="font-normal text-muted-foreground">· {lista.length} montador(es) · {totalDoDia} fichas</span></h3>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr><th className="px-3 py-2">Montador</th><th className="px-3 py-2">Detalhe</th><th className="px-3 py-2 text-center">Fichas</th><th className="px-3 py-2 text-right">Ações</th></tr>
                      </thead>
                      <tbody>
                        {lista.map((f) => {
                          const chamada = isChamada(f);
                          const detLabel = chamada && Array.isArray(f.detalhe) && f.detalhe.length
                            ? f.detalhe.map((x) => `${x.referencia || "ref"}${x.cor ? ` ${x.cor}` : ""}×${x.qtd}`).join(", ")
                            : (f.referencia || f.solado || "—");
                          return (
                            <tr key={f.id} className="border-t border-border">
                              <td className="px-3 py-2 font-medium text-foreground">{f.montador || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{detLabel}{!chamada && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">grade</span>}</td>
                              <td className="px-3 py-2 text-center font-semibold tabular-nums text-foreground">{chamada ? fichasDiaOf(f) : paresDaFicha(f)}</td>
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
