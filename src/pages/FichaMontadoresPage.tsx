// FichaMontadoresPage.tsx
// Página "Ficha de Montadores" — Squad Shoes
// Registra fichas de corte/montagem por dia na tabela public.ficha_montadores.
//
// A tabela NÃO está nos tipos gerados do Supabase (foi aplicada via SQL/MCP),
// então as queries usam o cast `(supabase as any)` — mesmo padrão de outras
// telas que tocam tabelas fora de src/integrations/supabase/types.ts.
//
// UI em design tokens (integra com o tema/dark mode). O bloco de IMPRESSÃO
// (PRINT_CSS + cardHTML) abre em window próprio e usa cores hardcoded de
// propósito — papel A4 precisa de tons garantidos, igual aos demais prints.
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, Plus } from "@phosphor-icons/react";

type Grade = "adulto" | "infantil";

interface Ficha {
  id: string;
  dia: string;
  montador: string | null;
  solado: string | null;
  grade: Grade;
  numeracoes: string[];
  quantidades: string[];
  total: number;
  copias: number;
  criado_em?: string;
}

const DEFAULTS: Record<Grade, { sizes: string[]; qtys: string[] }> = {
  adulto: {
    sizes: ["34", "35", "36", "37", "38", "39", "40"],
    qtys: ["1", "1", "3", "3", "3", "2", "2"],
  },
  infantil: {
    sizes: ["23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36"],
    qtys: Array(14).fill(""),
  },
};

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const sumQ = (a: string[]) => a.reduce((s, v) => s + (parseInt(v) || 0), 0);
const fmtDia = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/* ---------- Impressão (nova janela, A4 paisagem, várias fichas por folha) ----------
   Cores hardcoded INTENCIONAIS — impressão A4 precisa de tons garantidos,
   independentes do tema/dark mode (mesma regra dos demais prints do sistema). */
const PRINT_CSS = `
  *{box-sizing:border-box}
  body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a}
  .mono{font-family:'SF Mono','JetBrains Mono',Menlo,Consolas,monospace}
  .print-card{break-inside:avoid;page-break-inside:avoid;margin:0 0 8mm}
  .print-card:last-child{margin-bottom:0}
  .card{border:1px solid #000;padding:14px 16px}
  .page-num{float:right;font:600 11px/'SF Mono',monospace;letter-spacing:.08em;color:#888}
  .grade-tag{font-family:'SF Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#b08400;display:inline-block;margin-bottom:8px}
  .grade-tag.adulto{color:#444}
  .head{border:1.5px solid #1f1f1f;clear:both;padding:8px 12px}
  .meta{display:flex;border:1.5px solid #1f1f1f;border-top:none}
  .meta>div{flex:1;padding:6px 12px;border-right:1.5px solid #1f1f1f}
  .meta>div:last-child{border-right:none}
  .lbl{font-family:'SF Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:3px}
  .v-big{font-size:20px;font-weight:800}
  .v-mid{font-size:15px;font-weight:700;min-height:18px}
  table{width:100%;border-collapse:collapse;border:1.5px solid #1f1f1f;border-top:none;table-layout:fixed}
  th,td{border:1px solid #1f1f1f;text-align:center;height:40px;font-weight:700;font-size:15px}
  .rowlabel{font-family:'SF Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#444;text-align:left;padding:0 10px;width:160px}
  thead th{font-family:'SF Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#888;height:28px}
  .col-total{width:70px;color:#888}
  .ppf-cell{background:#f1f0ed;font-size:17px}
  @page{size:A4 landscape;margin:12mm}
`;

function cardHTML(f: {
  dia: string;
  montador: string | null;
  solado: string | null;
  grade: Grade;
  numeracoes: string[];
  quantidades: string[];
  total: number;
}) {
  const th = f.numeracoes.map((s) => `<th>${esc(s)}</th>`).join("");
  const td = f.quantidades.map((q) => `<td>${esc(q)}</td>`).join("");
  const tag = f.grade === "infantil" ? "Grade infantil" : "Grade adulta";
  return `<div class="print-card"><div class="card">
    <span class="page-num">1/1</span><span class="grade-tag${f.grade === "adulto" ? " adulto" : ""}">${tag}</span>
    <div class="head"><span class="lbl">Solado</span><div class="v-big">${esc(f.solado || "")}</div></div>
    <div class="meta">
      <div><span class="lbl">Montador</span><div class="v-mid">${esc(f.montador || "")}</div></div>
      <div><span class="lbl">Data</span><div class="v-mid">${fmtDia(f.dia)}</div></div>
    </div>
    <table>
      <thead><tr><th class="rowlabel">N°</th>${th}<th class="col-total">TOTAL</th></tr></thead>
      <tbody><tr><td class="rowlabel">Por ficha</td>${td}<td class="ppf-cell">${f.total}</td></tr></tbody>
    </table>
  </div></div>`;
}

function imprimirFichas(
  list: Array<{
    dia: string;
    montador: string | null;
    solado: string | null;
    grade: Grade;
    numeracoes: string[];
    quantidades: string[];
    total: number;
    copias?: number;
  }>,
  expandByCopias: boolean,
) {
  const cards = list
    .flatMap((f) => {
      const n = expandByCopias ? Math.max(1, f.copias || 1) : 1;
      return Array.from({ length: n }, () => cardHTML(f));
    })
    .join("");
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de Montadores</title><style>${PRINT_CSS}</style></head><body>${cards}<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    alert("Permita pop-ups neste site para imprimir.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

/* ---------- Componente ---------- */
export default function FichaMontadoresPage() {
  // A tabela ficha_montadores não está nos tipos gerados → cast como nas demais
  // telas que tocam tabelas fora de types.ts (ex.: MaterialConsumptionDialog).
  const db = supabase as any;

  const [dia, setDia] = useState(todayISO());
  const [montador, setMontador] = useState("");
  const [solado, setSolado] = useState("");
  const [grade, setGrade] = useState<Grade>("adulto");
  const [sizes, setSizes] = useState<string[]>(DEFAULTS.adulto.sizes);
  const [qtys, setQtys] = useState<string[]>(DEFAULTS.adulto.qtys);
  const [copias, setCopias] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const total = useMemo(() => sumQ(qtys), [qtys]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("ficha_montadores")
      .select("*")
      .order("dia", { ascending: false })
      .order("criado_em", { ascending: false });
    if (error) setMsg({ type: "err", text: "Erro ao carregar: " + error.message });
    else setFichas((data ?? []) as Ficha[]);
    setLoading(false);
  }, [db]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function novaFicha() {
    setEditingId(null);
    setDia(todayISO());
    setMontador("");
    setSolado("");
    setGrade("adulto");
    setSizes(DEFAULTS.adulto.sizes);
    setQtys(DEFAULTS.adulto.qtys);
    setCopias(1);
    setMsg(null);
  }

  function trocarGrade(g: Grade) {
    setGrade(g);
    setSizes([...DEFAULTS[g].sizes]);
    setQtys([...DEFAULTS[g].qtys]);
  }

  const setSize = (i: number, v: string) => setSizes((a) => a.map((x, j) => (j === i ? v : x)));
  const setQty = (i: number, v: string) =>
    setQtys((a) => a.map((x, j) => (j === i ? v.replace(/[^\d]/g, "") : x)));
  const addCol = () => {
    setSizes((a) => [...a, ""]);
    setQtys((a) => [...a, ""]);
  };
  const remCol = () => {
    if (sizes.length <= 1) return;
    setSizes((a) => a.slice(0, -1));
    setQtys((a) => a.slice(0, -1));
  };

  async function salvar() {
    // `dia` alimenta a coluna `dia date NOT NULL` — se o operador limpar o campo
    // de data, "" estoura um erro de cast opaco no Postgres. Valida antes e cai
    // pra hoje como defesa extra (o input nunca deveria chegar vazio aqui).
    if (!dia) {
      setMsg({ type: "err", text: "Informe a data da ficha." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const payload = {
      dia: dia || todayISO(),
      montador: montador.trim() || null,
      solado: solado.trim() || null,
      grade,
      numeracoes: sizes,
      quantidades: qtys,
      total,
      copias,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editingId
      ? await db.from("ficha_montadores").update(payload).eq("id", editingId)
      : await db.from("ficha_montadores").insert(payload);
    if (error) {
      setMsg({ type: "err", text: "Erro ao salvar: " + error.message });
    } else {
      setMsg({ type: "ok", text: editingId ? "Ficha atualizada." : "Ficha salva." });
      await carregar();
      if (!editingId) novaFicha();
    }
    setSaving(false);
  }

  function abrir(f: Ficha) {
    setEditingId(f.id);
    setDia(f.dia);
    setMontador(f.montador ?? "");
    setSolado(f.solado ?? "");
    setGrade(f.grade);
    setSizes(f.numeracoes ?? []);
    setQtys(f.quantidades ?? []);
    setCopias(f.copias ?? 1);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function excluir(f: Ficha) {
    if (!window.confirm("Excluir esta ficha?")) return;
    const { error } = await db.from("ficha_montadores").delete().eq("id", f.id);
    if (error) setMsg({ type: "err", text: "Erro ao excluir: " + error.message });
    else {
      if (editingId === f.id) novaFicha();
      await carregar();
    }
  }

  const grupos = useMemo(() => {
    const m = new Map<string, Ficha[]>();
    for (const f of fichas) {
      if (!m.has(f.dia)) m.set(f.dia, []);
      m.get(f.dia)!.push(f);
    }
    return Array.from(m.entries());
  }, [fichas]);

  const lbl = "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";

  return (
    <div className="w-full space-y-6">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · MONTADORES"
        title="Ficha de Montadores"
        description="Registre as fichas de corte por dia. O TOTAL soma sozinho as numerações."
        meta={<><span className="font-bold">{fichas.length}</span> FICHA{fichas.length === 1 ? "" : "S"} SALVA{fichas.length === 1 ? "" : "S"}</>}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              imprimirFichas(
                [{ dia, montador: montador || null, solado: solado || null, grade, numeracoes: sizes, quantidades: qtys, total, copias }],
                true,
              )
            }
          >
            <Printer className="h-4 w-4" /> Imprimir / PDF
          </Button>
        }
      />

      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            msg.type === "ok"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ---- Formulário ---- */}
      <Panel
        eyebrow={editingId ? "EDITANDO FICHA" : "NOVA FICHA"}
        title="Dados da ficha"
        actions={
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["adulto", "infantil"] as Grade[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => trocarGrade(g)}
                className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  grade === g
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={lbl}>Data</label>
            <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Montador</label>
            <Input value={montador} placeholder="Nome do montador" onChange={(e) => setMontador(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Solado</label>
            <Input value={solado} placeholder="Ex.: Solado Ricardo Tratorado" onChange={(e) => setSolado(e.target.value)} />
          </div>
        </div>

        {/* Grade de numerações */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-center" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th className="border border-border px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ width: 110 }}>
                  N°
                </th>
                {sizes.map((s, i) => (
                  <th key={i} className="border border-border p-0">
                    <input
                      className="h-9 w-full bg-transparent text-center text-sm font-bold outline-none focus:bg-muted/50"
                      value={s}
                      onChange={(e) => setSize(i, e.target.value)}
                    />
                  </th>
                ))}
                <th className="border border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ width: 64 }}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Por ficha
                </td>
                {qtys.map((q, i) => (
                  <td key={i} className="border border-border p-0">
                    <input
                      inputMode="numeric"
                      className="h-10 w-full bg-transparent text-center text-base font-bold outline-none focus:bg-muted/50"
                      value={q}
                      onChange={(e) => setQty(i, e.target.value)}
                    />
                  </td>
                ))}
                <td className="border border-border bg-muted text-lg font-bold text-foreground">{total}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tamanhos</span>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={remCol}>– col</Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={addCol}>+ col</Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cópias</span>
            <Input
              type="number"
              min={1}
              value={copias}
              onChange={(e) => setCopias(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-8 w-16 text-center"
            />
          </div>

          <div className="ml-auto flex flex-wrap gap-2">
            {editingId && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={novaFicha}>
                <Plus className="h-4 w-4" /> Nova ficha
              </Button>
            )}
            <Button type="button" onClick={salvar} disabled={saving || !dia} size="sm" className="h-9">
              {saving ? "Salvando…" : editingId ? "Atualizar ficha" : "Salvar ficha"}
            </Button>
          </div>
        </div>
      </Panel>

      {/* ---- Fichas salvas, por dia ---- */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Fichas salvas</h2>
          {loading && <span className="text-xs text-muted-foreground">carregando…</span>}
          {!loading && <span className="text-xs text-muted-foreground">{fichas.length} no total</span>}
        </div>

        {!loading && fichas.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhuma ficha salva ainda.
          </p>
        )}

        <div className="space-y-5">
          {grupos.map(([d, lista]) => (
            <div key={d}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {fmtDia(d)} <span className="font-normal text-muted-foreground">· {lista.length} ficha(s)</span>
                </h3>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => imprimirFichas(lista, true)}>
                  <Printer className="h-3.5 w-3.5" /> Imprimir o dia
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Montador</th>
                      <th className="px-3 py-2">Solado</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2 text-center">Total</th>
                      <th className="px-3 py-2 text-center">Cópias</th>
                      <th className="px-3 py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((f) => (
                      <tr key={f.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{f.montador || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{f.solado || "—"}</td>
                        <td className="px-3 py-2 capitalize text-muted-foreground">{f.grade}</td>
                        <td className="px-3 py-2 text-center font-semibold text-foreground">{f.total}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{f.copias}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => abrir(f)} className="mr-3 text-xs font-medium text-primary hover:underline">
                            Abrir
                          </button>
                          <button onClick={() => excluir(f)} className="text-xs font-medium text-muted-foreground hover:text-red-600 dark:hover:text-red-400">
                            Excluir
                          </button>
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
    </div>
  );
}
