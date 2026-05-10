 import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 import { Save, Loader2, Search, X, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronRight, History } from "lucide-react";
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
 import StockHistory from "./StockHistory";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  quantity: number;
  unit: string;
  min_stock: number;
  stock_grade: Record<string, any> | null;
  group_id: string | null;
  active: boolean;
}

interface SoleConjugationRow {
  sole_group_id: string;
  size_key: string;
  sizes: number[];
}

// ── Sole helpers ────────────────────────────────────────────────────────────

function isSole(p: Product) {
  const cat = (p.category ?? "").toLowerCase();
  return cat === "solado" || cat === "sola" || cat.startsWith("solado");
}

function resolveSizeRange(grade: Record<string, any> | null): { from: number; to: number } | null {
  if (!grade || typeof grade !== "object" || Array.isArray(grade)) return null;
  const f = grade._size_from != null ? Number(grade._size_from) : null;
  const t = grade._size_to != null ? Number(grade._size_to) : null;
  if (f != null && t != null && !isNaN(f) && !isNaN(t) && t >= f) return { from: f, to: t };
  const keys = Object.keys(grade).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  if (keys.length > 0) return { from: keys[0], to: keys[keys.length - 1] };
  return null;
}

/**
 * Lista as CHAVES DE EXIBIÇÃO/ESTOQUE de um solado, considerando conjugações.
 *
 * Exemplo: solado com range 33–40 e conjugações 33/34 e 39/40 → retorna
 * ["33/34", "35", "36", "37", "38", "39/40"]. Sem conjugações, retorna
 * apenas inteiros como string ("33", "34", ...).
 *
 * Mesma lógica usada em SoladoGradeDialog — mantem consistência entre
 * editor inline e o modal completo.
 */
function getSoleEffectiveKeys(
  grade: Record<string, any> | null,
  conjugations: Array<{ size_key: string; sizes: number[] }>,
): string[] {
  const range = resolveSizeRange(grade);
  if (!range) {
    // Sem range: exibe só os keys já presentes no estoque (incluindo conjugados)
    if (!grade) return [];
    return Object.keys(grade).filter(k => !k.startsWith('_'));
  }

  if (conjugations.length === 0) {
    const out: string[] = [];
    for (let s = range.from; s <= range.to; s++) out.push(String(s));
    return out;
  }

  // Mapa size→size_key para evitar inserir duplicatas
  const sizeToKey = new Map<number, string>();
  for (const c of conjugations) for (const s of c.sizes) sizeToKey.set(s, c.size_key);

  const seen = new Set<string>();
  const out: string[] = [];
  for (let s = range.from; s <= range.to; s++) {
    const key = sizeToKey.get(s) || String(s);
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

function gradeTotal(grade: Record<string, number>): number {
  return Object.entries(grade)
    .filter(([k]) => !k.startsWith('_'))
    .reduce((s, [, v]) => s + (Number(v) || 0), 0);
}

// ── Main page ───────────────────────────────────────────────────────────────

// E6 (audit): filtros persistem em localStorage. Antes: F5/troca de aba zerava
// filtros aplicados — usuário tinha que reaplicar toda vez que voltava.
const STOCK_FILTERS_KEY = "stock-adjustment-filters-v1";
function loadStoredFilters() {
  try {
    const raw = localStorage.getItem(STOCK_FILTERS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      categoryFilter?: string;
      statusFilter?: "all" | "ok" | "low" | "zero" | "pending";
      unitFilter?: string;
      typeFilter?: "all" | "soles" | "regular";
    };
  } catch {
    return null;
  }
}

export default function StockAdjustmentPage() {
  const qc = useQueryClient();
  const stored = loadStoredFilters();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(stored?.categoryFilter ?? "all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "low" | "zero" | "pending">(stored?.statusFilter ?? "all");
  const [unitFilter, setUnitFilter] = useState(stored?.unitFilter ?? "all");
  const [typeFilter, setTypeFilter] = useState<"all" | "soles" | "regular">(stored?.typeFilter ?? "all");

  useEffect(() => {
    try {
      localStorage.setItem(
        STOCK_FILTERS_KEY,
        JSON.stringify({ categoryFilter, statusFilter, unitFilter, typeFilter }),
      );
    } catch {}
  }, [categoryFilter, statusFilter, unitFilter, typeFilter]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
   const [historyProductId, setHistoryProductId] = useState<string | null>(null);
   const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Regular products: productId → raw string
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Soles: productId → sizeStr → raw string
  const [soleDrafts, setSoleDrafts] = useState<Record<string, Record<string, string>>>({});
  // Expanded sole rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Refs for keyboard navigation
  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sizeRefs = useRef<Record<string, Record<string, HTMLInputElement | null>>>({});

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["stock-adjustment-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, category, color, quantity, unit, min_stock, stock_grade, group_id, active")
        .order("category")
        .order("name")
        .order("color");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        id: p.id,
        name: p.name ?? "",
        sku: p.sku ?? null,
        category: p.category ?? null,
        color: p.color && p.color !== "" ? p.color : null,
        quantity: Number(p.quantity ?? 0),
        unit: p.unit ?? "un",
        min_stock: Number(p.min_stock ?? 0),
        stock_grade: p.stock_grade ?? null,
        group_id: p.group_id ?? null,
        active: p.active !== false,
      }));
    },
  });

  // Conjugações de todos os solados em tela. Carrega uma vez (todas as regras)
  // e indexa por sole_group_id — queries repetidas seriam wasteful.
  const { data: allConjugations = [] } = useQuery<SoleConjugationRow[]>({
    queryKey: ["sole-size-conjugations-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sole_size_conjugations")
        .select("sole_group_id, size_key, sizes");
      if (error) throw error;
      return (data || []) as SoleConjugationRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const conjugationsByGroup = useMemo(() => {
    const m = new Map<string, Array<{ size_key: string; sizes: number[] }>>();
    for (const c of allConjugations) {
      const arr = m.get(c.sole_group_id) ?? [];
      arr.push({ size_key: c.size_key, sizes: c.sizes });
      m.set(c.sole_group_id, arr);
    }
    return m;
  }, [allConjugations]);

  const getConjugationsFor = useCallback(
    (groupId: string | null) => (groupId ? conjugationsByGroup.get(groupId) ?? [] : []),
    [conjugationsByGroup],
  );

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[];
    return cats.sort();
  }, [products]);

  const units = useMemo(() => {
    const us = Array.from(new Set(products.map((p) => p.unit).filter(Boolean))) as string[];
    return us.sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.color ?? "").toLowerCase().includes(q);
      const matchCategory = categoryFilter === "all" || p.category === categoryFilter;
      const matchUnit = unitFilter === "all" || p.unit === unitFilter;
      const matchType =
        typeFilter === "all" ||
        (typeFilter === "soles" ? isSole(p) : !isSole(p));
      let matchStatus = true;
      if (statusFilter === "zero") matchStatus = p.quantity <= 0;
      else if (statusFilter === "low") matchStatus = p.min_stock > 0 && p.quantity <= p.min_stock && p.quantity > 0;
      else if (statusFilter === "ok") matchStatus = !(p.min_stock > 0 && p.quantity <= p.min_stock) && p.quantity > 0;
      else if (statusFilter === "pending") matchStatus = !!drafts[p.id] || !!soleDrafts[p.id];
      return matchSearch && matchCategory && matchUnit && matchType && matchStatus;
    });
  }, [products, search, categoryFilter, unitFilter, typeFilter, statusFilter, drafts, soleDrafts]);

  cellRefs.current = cellRefs.current.slice(0, filtered.length);

  // ── Pending changes ────────────────────────────────────────────────────

  const pendingRegular = useMemo(() =>
    filtered.filter((p) => !isSole(p)).filter((p) => {
      const raw = drafts[p.id];
      if (!raw && raw !== "0") return false;
      const val = parseFloat(raw.replace(",", "."));
      return !isNaN(val) && val !== p.quantity;
    }).map((p) => {
      const newQty = parseFloat(drafts[p.id].replace(",", "."));
      return { product: p, newQty, delta: newQty - p.quantity };
    }),
    [filtered, drafts]
  );

  const pendingSoles = useMemo(() =>
    filtered.filter(isSole).filter((p) => {
      const sd = soleDrafts[p.id];
      if (!sd) return false;
      return Object.keys(sd).some((k) => {
        const v = parseFloat((sd[k] ?? "").replace(",", "."));
        if (isNaN(v)) return false;
        const orig = Number((p.stock_grade as any)?.[k] ?? 0);
        return v !== orig;
      });
    }).map((p) => {
      const sd = soleDrafts[p.id] ?? {};
      const existing = (p.stock_grade as Record<string, any>) ?? {};
      // Merge: existing grade + overrides from drafts. Usa as chaves efetivas
      // (que respeitam conjugações), ao invés de inteiros.
      const newGrade: Record<string, number> = {};
      const conjs = getConjugationsFor(p.group_id);
      const keys = getSoleEffectiveKeys(p.stock_grade, conjs);
      keys.forEach((key) => {
        const raw = sd[key];
        const val = raw !== undefined ? parseFloat(raw.replace(",", ".")) : NaN;
        newGrade[key] = isNaN(val) ? Number(existing[key] ?? 0) : val;
      });
      // Preserve metadata keys
      const range = resolveSizeRange(p.stock_grade);
      if (range) { newGrade._size_from = range.from as any; newGrade._size_to = range.to as any; }
      const newTotal = gradeTotal(newGrade);
      return { product: p, newGrade, newTotal, delta: newTotal - p.quantity };
    }),
    [filtered, soleDrafts, getConjugationsFor]
  );

  const totalPending = pendingRegular.length + pendingSoles.length;

  // ── Keyboard navigation ────────────────────────────────────────────────

  const navigateTo = useCallback((index: number) => {
    const el = cellRefs.current[index];
    if (el) { el.focus(); el.select(); }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      navigateTo(rowIndex + 1);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      navigateTo(rowIndex - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateTo(rowIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateTo(rowIndex - 1);
    } else if (e.key === "Escape") {
      const productId = filtered[rowIndex]?.id;
      if (productId) {
        setDrafts((prev) => { const next = { ...prev }; delete next[productId]; return next; });
        (e.target as HTMLInputElement).blur();
      }
    }
  }, [filtered, navigateTo]);

  const handleSizeKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLInputElement>,
    productId: string,
    keys: string[],
    sizeIndex: number,
    rowIndex: number,
  ) => {
    const nextSizeEl = sizeRefs.current[productId]?.[keys[sizeIndex + 1]];
    const prevSizeEl = sizeRefs.current[productId]?.[keys[sizeIndex - 1]];

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      if (nextSizeEl) { nextSizeEl.focus(); nextSizeEl.select(); }
      else navigateTo(rowIndex + 1);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (prevSizeEl) { prevSizeEl.focus(); prevSizeEl.select(); }
      else navigateTo(rowIndex - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (nextSizeEl) { nextSizeEl.focus(); nextSizeEl.select(); }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (prevSizeEl) { prevSizeEl.focus(); prevSizeEl.select(); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateTo(rowIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateTo(rowIndex - 1);
    } else if (e.key === "Escape") {
      setSoleDrafts((prev) => { const next = { ...prev }; delete next[productId]; return next; });
      (e.target as HTMLInputElement).blur();
    }
  }, [navigateTo]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (totalPending === 0) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe o motivo do ajuste antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      // Process Regular Products via RPC
      for (const { product, newQty, delta } of pendingRegular) {
        if (newQty < 0) {
          toast.error(`Novo estoque de "${product.name}" seria negativo (${newQty}). Corrija o valor.`);
          setSaving(false);
          return;
        }
        const { data, error: rpcErr } = await supabase.rpc("adjust_stock", {
          p_product_id: product.id,
          p_expected_previous_qty: product.quantity,
          p_new_qty: newQty,
          p_delta: delta,
          p_reason: `Ajuste manual — ${reason.trim()}`,
        });

        if (rpcErr) throw rpcErr;

        const result = Array.isArray(data) ? data[0] : data;
        if (!result.success) {
          if (result.error_message === "CONCURRENCY_ERROR") {
            toast.error(
              `Conflito: O estoque de "${product.name}" mudou para ${result.current_db_qty} enquanto você editava. Por favor, revise os valores.`,
              { duration: 6000 }
            );
            setSaving(false);
            qc.invalidateQueries({ queryKey: ["stock-adjustment-products"] });
            return;
          }
          throw new Error(result.error_message || "Erro desconhecido no ajuste.");
        }
      }

      // Process Soles via RPC
      for (const { product, newGrade, newTotal, delta } of pendingSoles) {
        // Validate: no per-size bucket may be negative
        for (const k of Object.keys(newGrade)) {
          if (k.startsWith('_')) continue; // metadata keys
          if ((newGrade[k] as number) < 0) {
            toast.error(`Tamanho ${k} de "${product.name}" ficaria negativo. Corrija o valor.`);
            setSaving(false);
            return;
          }
        }
        if (newTotal < 0) {
          toast.error(`Novo estoque total de "${product.name}" seria negativo (${newTotal}). Corrija.`);
          setSaving(false);
          return;
        }
        const { data, error: rpcErr } = await supabase.rpc("adjust_stock", {
          p_product_id: product.id,
          p_expected_previous_qty: product.quantity,
          p_new_qty: newTotal,
          p_delta: delta,
          p_reason: `Ajuste grade solado — ${reason.trim()}`,
          p_new_grade: newGrade,
        });

        if (rpcErr) throw rpcErr;

        const result = Array.isArray(data) ? data[0] : data;
        if (!result.success) {
          if (result.error_message === "CONCURRENCY_ERROR") {
            toast.error(
              `Conflito: O estoque de "${product.name}" mudou para ${result.current_db_qty} enquanto você editava. Por favor, revise os valores.`,
              { duration: 6000 }
            );
            setSaving(false);
            qc.invalidateQueries({ queryKey: ["stock-adjustment-products"] });
            return;
          }
          throw new Error(result.error_message || "Erro desconhecido no ajuste.");
        }
      }

      toast.success(
        `${totalPending} produto${totalPending > 1 ? "s" : ""} ajustado${totalPending > 1 ? "s" : ""}.`
      );
       setDrafts({});
       setSoleDrafts({});
       setExpanded(new Set());
       setReason("");
       qc.invalidateQueries({ queryKey: ["products"] });
       qc.invalidateQueries({ queryKey: ["stock-adjustment-products"] });
     } catch (err: any) {
       toast.error("Erro ao salvar: " + err.message);
     } finally {
       setSaving(false);
     }
   };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] page-enter">

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-border shrink-0">
        <SlidersHorizontal className="h-4 w-4 text-primary shrink-0" />
        <h1 className="text-base font-semibold mr-2 shrink-0">Ajuste de Estoque</h1>

        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="ok">OK</SelectItem>
            <SelectItem value="low">Estoque baixo</SelectItem>
            <SelectItem value="zero">Zerados</SelectItem>
            <SelectItem value="pending">Com alterações</SelectItem>
          </SelectContent>
        </Select>

        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="h-8 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas un.</SelectItem>
            {units.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="h-8 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tipos</SelectItem>
            <SelectItem value="soles">Apenas solados</SelectItem>
            <SelectItem value="regular">Sem solados</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* E10 (audit): tooltip informa que a operação fica registrada no histórico
            com identidade do operador. Antes: usuário não sabia se mudanças tinham
            audit trail (existe em stock_movements via trigger, mas era invisível). */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Input
                placeholder="Motivo do ajuste (obrigatório)…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={cn(
                  "h-8 text-sm w-72",
                  !reason.trim() && totalPending > 0 && "border-destructive focus-visible:ring-destructive"
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                Cada ajuste fica registrado no histórico do produto com seu usuário,
                data/hora e motivo. Use o botão <span className="font-semibold">Hist.</span> da
                linha pra revisar movimentações anteriores.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {totalPending > 0 && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 rounded px-2 py-1 shrink-0">
            {totalPending} pendente{totalPending > 1 ? "s" : ""}
          </span>
        )}

        {/* E2: bloqueia Salvar quando motivo vazio. Antes: toast.error após click,
            ainda permitia request fail e confundia user. Agora: feedback visual
            no campo + botão indisponível com tooltip explicativo. */}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || totalPending === 0 || !reason.trim()}
          className="h-8 gap-1.5 shrink-0"
          title={!reason.trim() && totalPending > 0 ? 'Preencha o motivo do ajuste antes de salvar' : undefined}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar
        </Button>

        {totalPending > 0 && (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground shrink-0"
            onClick={() => { setDrafts({}); setSoleDrafts({}); }}>
            <X className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Spreadsheet */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto border-x border-b border-border rounded-b-lg">
          <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
               <col style={{ width: 44 }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: 88 }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: 48 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 108 }} />
               <col style={{ width: 44 }} />
               <col style={{ width: 76 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/80 backdrop-blur-sm border-b border-border">
                 <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center py-2 border-r border-border/40">#</th>
                 <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center py-2 border-r border-border/40">Hist.</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left px-3 py-2 border-r border-border/40">Produto</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left px-2 py-2 border-r border-border/40">Cor</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left px-2 py-2 border-r border-border/40">SKU</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left px-2 py-2 border-r border-border/40">Categoria</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center py-2 border-r border-border/40">Un.</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right px-3 py-2 border-r border-border/40">Atual</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-primary text-right px-3 py-2 border-r border-border/40">Nova Qtd ✎</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right px-3 py-2">Variação</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-muted-foreground text-sm">
                    {/* E8 (audit): empty state distingue "nenhum produto cadastrado"
                        de "filtros zeraram resultado". Hint pra reset rápido se for filtro. */}
                    {(search || categoryFilter !== 'all' || statusFilter !== 'all') ? (
                      <>
                        <p>Nenhum produto bate com os filtros atuais.</p>
                        <button
                          type="button"
                          className="mt-2 text-xs text-primary hover:underline"
                          onClick={() => {
                            setSearch('');
                            setCategoryFilter('all');
                            setStatusFilter('all');
                          }}
                        >
                          Limpar todos os filtros
                        </button>
                      </>
                    ) : (
                      'Nenhum produto cadastrado.'
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((product, rowIndex) => {
                  const sole = isSole(product);
                  const isExpanded = expanded.has(product.id);
                  const isEven = rowIndex % 2 === 0;

                  if (sole) {
                    // ── Sole row ─────────────────────────────────────────
                    const conjs = getConjugationsFor(product.group_id);
                    const keys = getSoleEffectiveKeys(product.stock_grade, conjs);
                    const range = resolveSizeRange(product.stock_grade);
                    const sd = soleDrafts[product.id] ?? {};
                    const existing = (product.stock_grade as Record<string, any>) ?? {};

                    // Compute draft total
                    let draftTotal = product.quantity;
                    let hasSoleDraft = false;
                    if (Object.keys(sd).length > 0) {
                      let t = 0;
                      keys.forEach((key) => {
                        const raw = sd[key];
                        const val = raw !== undefined ? parseFloat(raw.replace(",", ".")) : NaN;
                        t += isNaN(val) ? Number(existing[key] ?? 0) : val;
                      });
                      draftTotal = t;
                      hasSoleDraft = pendingSoles.some((c) => c.product.id === product.id);
                    }
                    const delta = draftTotal - product.quantity;
                    const isLow = product.min_stock > 0 && product.quantity <= product.min_stock;
                    const hasConjugations = conjs.length > 0;

                    return [
                      // Main sole row
                      <tr key={product.id}
                        className={cn(
                          "border-b border-border/30 transition-colors",
                          hasSoleDraft ? "bg-amber-50/70 dark:bg-amber-950/25" : isEven ? "bg-background" : "bg-muted/20",
                          isExpanded && "border-b-0"
                        )}
                      >
                         <td className="text-[11px] text-muted-foreground/50 text-center select-none border-r border-border/30 py-0">{rowIndex + 1}</td>
                         <td className="text-center border-r border-border/30 py-0">
                           <TooltipProvider>
                             <Tooltip>
                               <TooltipTrigger asChild>
                                 <Button 
                                   variant="ghost" 
                                   size="icon" 
                                   className="h-6 w-6 text-muted-foreground hover:text-primary"
                                   onClick={() => { setHistoryProductId(product.id); setIsHistoryOpen(true); }}
                                 >
                                   <History className="h-3.5 w-3.5" />
                                 </Button>
                               </TooltipTrigger>
                               <TooltipContent>Ver histórico detalhado</TooltipContent>
                             </Tooltip>
                           </TooltipProvider>
                         </td>
                        <td className="px-3 py-1.5 border-r border-border/30">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isLow && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                            {!product.active && <span className="text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded px-1 py-0.5 shrink-0">inativo</span>}
                            <span className="truncate font-medium text-foreground text-[13px]">{product.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-[12px] text-muted-foreground border-r border-border/30 truncate">{product.color ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground border-r border-border/30">{product.sku ?? "—"}</td>
                        <td className="px-2 py-1.5 text-[12px] text-muted-foreground border-r border-border/30 truncate">{product.category ?? "—"}</td>
                        <td className="text-[11px] text-muted-foreground text-center border-r border-border/30">{product.unit}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[13px] border-r border-border/30 tabular-nums select-none">
                          <span className={isLow ? "text-amber-600 font-semibold" : "text-foreground"}>{product.quantity.toLocaleString("pt-BR")}</span>
                        </td>
                        {/* Sole: toggle expand instead of a quantity input */}
                        <td className="py-0 border-r border-border/30">
                          <button
                            ref={(el) => { cellRefs.current[rowIndex] = el as any; }}
                            onClick={() => toggleExpand(product.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(product.id); }
                              else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); navigateTo(rowIndex + 1); }
                              else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); navigateTo(rowIndex - 1); }
                              else if (e.key === "ArrowDown") { e.preventDefault(); navigateTo(rowIndex + 1); }
                              else if (e.key === "ArrowUp") { e.preventDefault(); navigateTo(rowIndex - 1); }
                            }}
                            className={cn(
                              "w-full h-[33px] px-3 flex items-center justify-between gap-1.5 text-[12px] font-mono",
                              "hover:bg-muted/40 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/60",
                              hasSoleDraft ? "text-foreground font-semibold" : "text-muted-foreground",
                              keys.length === 0 && "opacity-40 cursor-not-allowed"
                            )}
                            disabled={keys.length === 0}
                            title={keys.length === 0 ? "Nenhuma numeração cadastrada neste solado" : (hasConjugations ? "Solado com conjugações de numeração" : "")}
                          >
                            <span className="flex items-center gap-1">
                              {isExpanded
                                ? <ChevronDown className="h-3 w-3 shrink-0" />
                                : <ChevronRight className="h-3 w-3 shrink-0" />}
                              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
                                {keys.length > 0
                                  ? (range ? `Grade ${range.from}–${range.to}` : `${keys.length} key(s)`)
                                  : "Sem grade"}
                              </span>
                              {hasConjugations && (
                                /* E5 (audit): tooltip lista quais numerações estão conjugadas
                                   neste solado. Antes: badge "conj." não dizia ao usuário
                                   *quais* eram, exigindo abrir o cadastro do solado. */
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 rounded cursor-help">
                                        conj.
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <p className="text-xs font-semibold mb-1">Numerações conjugadas:</p>
                                      <p className="text-[11px]">
                                        {conjs.map((c) => c.size_key).join(' · ')}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </span>
                            {hasSoleDraft && (
                              <span className="tabular-nums">{draftTotal.toLocaleString("pt-BR")}</span>
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums">
                          {hasSoleDraft ? (
                            <span className={cn("font-semibold", delta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                              {delta > 0 ? "+" : ""}{delta.toLocaleString("pt-BR")}
                            </span>
                          ) : <span className="text-muted-foreground/25">—</span>}
                        </td>
                      </tr>,

                      // Expanded grade sub-row
                      isExpanded && keys.length > 0 && (
                        <tr key={`${product.id}-grade`}
                          className={cn(
                            "border-b border-border/40",
                            hasSoleDraft ? "bg-amber-50/40 dark:bg-amber-950/15" : isEven ? "bg-muted/10" : "bg-muted/25"
                          )}
                        >
                          <td colSpan={10} className="px-4 py-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {keys.map((key, sizeIndex) => {
                                const raw = sd[key];
                                const origVal = Number(existing[key] ?? 0);
                                const draftVal = raw !== undefined ? parseFloat(raw.replace(",", ".")) : NaN;
                                const isDirtyCell = raw !== undefined && !isNaN(draftVal) && draftVal !== origVal;
                                const isConjugated = key.includes('/');

                                if (!sizeRefs.current[product.id]) sizeRefs.current[product.id] = {};

                                return (
                                  <div key={key} className="flex flex-col items-center gap-0.5">
                                    <span className={cn(
                                      "text-[10px] font-semibold tabular-nums",
                                      isConjugated ? "text-primary" : "text-muted-foreground",
                                    )}>{key}</span>
                                    <input
                                      ref={(el) => { sizeRefs.current[product.id][key] = el; }}
                                      type="text"
                                      inputMode="decimal"
                                      value={raw ?? ""}
                                      placeholder={String(origVal)}
                                      onChange={(e) =>
                                        setSoleDrafts((prev) => ({
                                          ...prev,
                                          [product.id]: { ...(prev[product.id] ?? {}), [key]: e.target.value },
                                        }))
                                      }
                                      onKeyDown={(e) => handleSizeKeyDown(e, product.id, keys, sizeIndex, rowIndex)}
                                      onFocus={(e) => e.target.select()}
                                      className={cn(
                                        "h-8 text-center font-mono text-[12px] tabular-nums",
                                        isConjugated ? "w-14 border-primary/40" : "w-12 border-border/60",
                                        "border rounded-sm outline-none",
                                        "placeholder:text-muted-foreground/30",
                                        isDirtyCell
                                          ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40 font-semibold text-foreground"
                                          : "bg-background focus:border-primary focus:ring-1 focus:ring-primary/50"
                                      )}
                                    />
                                  </div>
                                );
                              })}

                              {/* Totals */}
                              <div className="ml-4 pl-4 border-l border-border/40 flex flex-col items-start gap-0.5">
                                <span className="text-[10px] text-muted-foreground">Total</span>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="font-mono text-[13px] text-muted-foreground">{product.quantity}</span>
                                  {hasSoleDraft && (
                                    <>
                                      <span className="text-muted-foreground/40 text-xs">→</span>
                                      <span className={cn("font-mono text-[14px] font-bold",
                                        draftTotal > product.quantity ? "text-green-600" :
                                        draftTotal < product.quantity ? "text-red-600" : "text-foreground"
                                      )}>
                                        {draftTotal.toLocaleString("pt-BR")}
                                      </span>
                                    </>
                                  )}
                                  <span className="text-[11px] text-muted-foreground">{product.unit}</span>
                                </div>
                              </div>

                              {/* Clear sole drafts */}
                              {hasSoleDraft && (
                                <button
                                  onClick={() => setSoleDrafts((prev) => { const next = { ...prev }; delete next[product.id]; return next; })}
                                  className="ml-2 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                                  title="Desfazer alterações deste solado"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  }

                  // ── Regular product row ───────────────────────────────
                  const raw = drafts[product.id];
                  const draftNum = raw !== undefined ? parseFloat(raw.replace(",", ".")) : NaN;
                  const hasDraft = raw !== undefined && raw !== "" && !isNaN(draftNum);
                  const isDirty = hasDraft && draftNum !== product.quantity;
                  const delta = isDirty ? draftNum - product.quantity : 0;
                  const isLow = product.min_stock > 0 && product.quantity <= product.min_stock;

                  return (
                    <tr key={product.id}
                      className={cn(
                        "border-b border-border/30 last:border-0 transition-colors",
                        isDirty ? "bg-amber-50/70 dark:bg-amber-950/25" : isEven ? "bg-background" : "bg-muted/20"
                      )}
                    >
                       <td className="text-[11px] text-muted-foreground/50 text-center select-none border-r border-border/30 py-0">{rowIndex + 1}</td>
                       <td className="text-center border-r border-border/30 py-0">
                         <TooltipProvider>
                           <Tooltip>
                             <TooltipTrigger asChild>
                               <Button 
                                 variant="ghost" 
                                 size="icon" 
                                 className="h-6 w-6 text-muted-foreground hover:text-primary"
                                 onClick={() => { setHistoryProductId(product.id); setIsHistoryOpen(true); }}
                               >
                                 <History className="h-3.5 w-3.5" />
                               </Button>
                             </TooltipTrigger>
                             <TooltipContent>Ver histórico detalhado</TooltipContent>
                           </Tooltip>
                         </TooltipProvider>
                       </td>
                      <td className="px-3 py-1.5 border-r border-border/30">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isLow && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                          {!product.active && <span className="text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded px-1 py-0.5 shrink-0">inativo</span>}
                          <span className="truncate font-medium text-foreground text-[13px]">{product.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-[12px] text-muted-foreground border-r border-border/30 truncate">{product.color ?? "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground border-r border-border/30">{product.sku ?? "—"}</td>
                      <td className="px-2 py-1.5 text-[12px] text-muted-foreground border-r border-border/30 truncate">{product.category ?? "—"}</td>
                      <td className="text-[11px] text-muted-foreground text-center border-r border-border/30">{product.unit}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[13px] border-r border-border/30 tabular-nums select-none">
                        <span className={isLow ? "text-amber-600 font-semibold" : "text-foreground"}>
                          {product.quantity % 1 === 0
                            ? product.quantity.toLocaleString("pt-BR")
                            : product.quantity.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </span>
                      </td>
                      <td className="py-0 border-r border-border/30 p-0">
                        <input
                          ref={(el) => { cellRefs.current[rowIndex] = el; }}
                          type="text"
                          inputMode="decimal"
                          value={raw ?? ""}
                          placeholder={String(product.quantity)}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex)}
                          onFocus={(e) => e.target.select()}
                          className={cn(
                            "w-full h-[33px] px-3 text-right font-mono text-[13px] tabular-nums",
                            "border-0 outline-none bg-transparent",
                            "focus:bg-card",
                            "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/60",
                            "placeholder:text-muted-foreground/30",
                            isDirty && "bg-amber-50 dark:bg-amber-950/30 font-semibold text-foreground"
                          )}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums">
                        {isDirty ? (
                          <span className={cn("font-semibold", delta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                            {delta > 0 ? "+" : ""}
                            {delta % 1 === 0
                              ? delta.toLocaleString("pt-BR")
                              : delta.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </span>
                        ) : <span className="text-muted-foreground/25">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between pt-2 shrink-0 text-[11px] text-muted-foreground select-none">
        <span>
          {filtered.length.toLocaleString("pt-BR")} produto{filtered.length !== 1 ? "s" : ""}
          {products.length !== filtered.length && ` (de ${products.length.toLocaleString("pt-BR")})`}
          {" · "}Tab/Enter próxima linha · ↑↓ navegar · ↔ entre numerações · Esc cancelar célula
        </span>
        {totalPending > 0 && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {totalPending} ajuste{totalPending > 1 ? "s" : ""} não salvo{totalPending > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* History dialog */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de Movimentações</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <StockHistory filterProductId={historyProductId || undefined} hideHeader={true} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
