import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Product } from '@/types/inventory';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useProducts } from '@/hooks/useProducts';
import { useSoleConjugations } from '@/hooks/useSoleConjugations';
import { getSoleModelName } from '@/lib/utils';
import { toast } from 'sonner';
import { MagnifyingGlass as Search, Plus, Package, Palette, Info, Link as Link2, Check } from '@phosphor-icons/react';
import { normalizeForSearch } from '@/lib/searchUtils';

interface SoladoGradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

/**
 * Resolve the saved size range for a sole variant.
 * Priority: stock_grade._size_from/_size_to → min_stock_grade._size_from/_size_to → infer from grade keys.
 * Returns null if no range was ever saved.
 */
function resolveSizeRange(product: Product): { from: number; to: number } | null {
  const candidates = [product.stock_grade, product.min_stock_grade];
  for (const data of candidates) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const obj = data as Record<string, any>;
    const f = obj._size_from != null ? Number(obj._size_from) : null;
    const t = obj._size_to != null ? Number(obj._size_to) : null;
    if (f != null && t != null && !isNaN(f) && !isNaN(t) && t >= f) {
      return { from: f, to: t };
    }
    // Infer from numeric keys
    const keys = Object.keys(obj).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (keys.length > 0) return { from: keys[0], to: keys[keys.length - 1] };
  }
  return null;
}

function buildSizesFromRange(range: { from: number; to: number } | null): number[] {
  if (!range) return [];
  const sizes: number[] = [];
  for (let s = range.from; s <= range.to; s++) sizes.push(s);
  return sizes;
}

/* ── Color variant grade editor ── */
function ColorGradeEditor({
  product,
  sizes,
  sizeKeys,
  onGradeChange,
}: {
  product: Product;
  /** Number-based sizes, used when no conjugations are configured */
  sizes: number[];
  /** String-based size keys, used when conjugations are active (overrides sizes) */
  sizeKeys?: string[];
  onGradeChange: (productId: string, grade: Record<string, number>, total: number) => void;
}) {
  const [grade, setGrade] = useState<Record<string, number>>({});

  // Resolved list of display keys: either the conjugated string keys or the numeric sizes
  const effectiveKeys: string[] = useMemo(
    () => (sizeKeys && sizeKeys.length > 0 ? sizeKeys : sizes.map(String)),
    [sizeKeys, sizes],
  );

  useEffect(() => {
    const existing = product.stock_grade as Record<string, any> | null;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      // Strip metadata keys (_size_from / _size_to) from the editable grade
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(existing)) {
        if (k.startsWith('_')) continue;
        const n = Number(v);
        if (Number.isFinite(n)) cleaned[k] = n;
      }
      setGrade(cleaned);
    } else {
      setGrade({});
    }
  }, [product]);

  // Sum only keys that are currently visible (effectiveKeys). The full grade
  // object can contain legacy individual size keys (e.g. "33", "34") that have
  // since been merged into a conjugated bucket ("33/34"). Summing all keys
  // would double-count those sizes and inflate the displayed total.
  const total = effectiveKeys.length > 0
    ? effectiveKeys.reduce((s, k) => s + (grade[k] || 0), 0)
    : Object.values(grade).reduce((s, v) => s + (v || 0), 0);

  const updateKey = (key: string, value: number) => {
    // Audit visual: força inteiro — par de solado é unidade discreta. Antes
    // step="1" no NumberInput permitia digitação livre de "12.5" pares,
    // criando estoque fracionado que confundia auditoria.
    const intValue = Math.max(0, Math.floor(Number(value) || 0));
    const next = { ...grade, [key]: intValue };
    setGrade(next);
    const newTotal = effectiveKeys.length > 0
      ? effectiveKeys.reduce((s, k) => s + (next[k] || 0), 0)
      : Object.values(next).reduce((s, v) => s + (v || 0), 0);
    onGradeChange(product.id, next, newTotal);
  };

  // Notify parent whenever the underlying product (and therefore its
  // baseline grade) changes. The previous empty-deps version only fired
  // once on mount, so when the dialog reused this component for a
  // different color variant the parent kept seeing the first product's
  // total. product.id covers tab switches; the grade contents are
  // captured via the same useEffect that resets local grade state above.
  useEffect(() => {
    onGradeChange(product.id, grade, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // Show conjugation notice only when some of the keys are actually conjugated pairs
  const isConjugated = sizeKeys && sizeKeys.some(k => k.includes('/'));

  return (
    <div className="space-y-4">
      {isConjugated && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
          Numerações conjugadas ativas — estoque por pool de tamanhos
        </div>
      )}
      <div>
        <Label className="text-xs font-semibold">Quantidade por tamanho (pares)</Label>
        {effectiveKeys.length === 0 ? (
          <div className="mt-2 p-3 rounded-md border border-dashed text-sm text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            Faixa de numeração não cadastrada. Defina a grade em <strong className="mx-0.5">Gestão de Solados → Grade & Consumos</strong>.
          </div>
        ) : (
          <div
            className="grid gap-2 mt-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(effectiveKeys.length, 8)}, minmax(0, 1fr))` }}
          >
            {effectiveKeys.map(key => {
              const curVal = grade[key] || 0;
              return (
                <div key={key} className="text-center">
                  <span className="text-xs text-muted-foreground font-medium">{key}</span>
                  <NumberInput
                    min={0}
                    step="1"
                    decimals={0}
                    value={curVal}
                    onChange={v => updateKey(key, Math.max(0, Math.floor(Number(v) || 0)))}
                    className="h-9 text-sm text-center px-1"
                    placeholder="0"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div>
          <p className="text-sm font-medium">Total de pares</p>
          <p className="text-xs text-muted-foreground">
            Estoque anterior: {Number(product.quantity || 0).toLocaleString('pt-BR')} pares
          </p>
        </div>
        <span className="display text-2xl tabular-nums font-mono">{total}</span>
      </div>
    </div>
  );
}

/* ── Add to group sub-dialog ── */
function AddToGroupDialog({ open, onOpenChange, groupId, groupName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string | null;
  groupName: string;
}) {
  const { data: allProducts = [] } = useProducts();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Products list has a 5-min staleTime in useProducts; if the user creates a
  // sole elsewhere and immediately opens this dialog they wouldn't see it
  // until staleTime expires. Force a refetch on every open so the list is
  // current and reset transient state.
  useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSearch('');
      setSelected(new Set());
    }
  }, [open, queryClient]);

  const { available, alreadyInGroup } = useMemo(() => {
    const q = normalizeForSearch(search);
    const matchesSearch = (p: any) =>
      !q || normalizeForSearch(p.name).includes(q) || normalizeForSearch(p.sku).includes(q) || normalizeForSearch(p.category).includes(q);
    const active = allProducts.filter(p => p.active && matchesSearch(p));
    return {
      available: active.filter(p => p.group_id !== groupId),
      alreadyInGroup: groupId ? active.filter(p => p.group_id === groupId) : [],
    };
  }, [allProducts, groupId, search]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!groupId || selected.size === 0) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ group_id: groupId })
        .in('id', Array.from(selected));
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${selected.size} item(ns) adicionado(s) ao grupo "${groupName}"`);
      setSelected(new Set());
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col" onOpenAutoFocus={(e) => { e.preventDefault(); setTimeout(() => searchRef.current?.focus(), 0); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Adicionar ao grupo "{groupName}"
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input ref={searchRef} placeholder="Buscar item..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <ScrollArea className="flex-1 min-h-0 max-h-[400px] -mx-6 px-6">
          {available.length === 0 && alreadyInGroup.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhum item disponível</p>
            </div>
          ) : (
            <div className="space-y-3">
              {available.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1 pb-0.5">
                    Disponíveis ({available.length})
                  </p>
                  {available.map(p => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-accent transition-colors ${selected.has(p.id) ? 'bg-primary/5 border border-primary/20' : 'border border-transparent'}`}
                    >
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          <span>{p.sku}</span>
                          <span>•</span>
                          <span>{p.category}</span>
                          {p.color && <><span>•</span><span>{p.color}</span></>}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {Number(p.quantity).toLocaleString('pt-BR')} {p.unit}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
              {alreadyInGroup.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border/50">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1 pb-0.5">
                    Já no grupo ({alreadyInGroup.length})
                  </p>
                  {alreadyInGroup.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-2 rounded-md opacity-60 border border-transparent"
                      title="Já pertence a este grupo"
                    >
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate line-through decoration-muted-foreground">{p.name}</p>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          <span>{p.sku}</span>
                          {p.color && <><span>•</span><span>{p.color}</span></>}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">no grupo</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">{selected.size} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={saving || selected.size === 0}>
              {saving ? 'Adicionando...' : `Adicionar ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Dialog ── */
export function SoladoGradeDialog({ open, onOpenChange, product }: SoladoGradeDialogProps) {
  const queryClient = useQueryClient();
  const { data: allProducts = [] } = useProducts();
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, { grade: Record<string, number>; total: number }>>({});

  // Load conjugations for this sole's group — enables conjugated size keys when configured
  const { data: conjugations = [] } = useSoleConjugations(product?.group_id ?? null);

  // Infer size range from conjugation sizes when no stored metadata is available.
  // For a sole with only [33/34] and [39/40] configured this gives {from:33, to:40},
  // so individual sizes 35–38 can still be shown.
  const inferredRangeFromConjugations = useMemo(() => {
    if (conjugations.length === 0) return null;
    const allSizes = conjugations.flatMap(c => c.sizes);
    if (allSizes.length === 0) return null;
    return { from: Math.min(...allSizes), to: Math.max(...allSizes) };
  }, [conjugations]);

  // Color variants of the SAME sole model only.
  // Filtering by group_id alone groups all soles together (e.g. "01", "204", "Saltinho Bloco")
  // — we additionally match by base model name so the dialog only shows colors of the
  // same reference (e.g. "01 - Caramelo" + "01 - Preto").
  const colorVariants = useMemo(() => {
    if (!product) return [];
    const baseName = getSoleModelName(product.name || '', product.color).toLowerCase();
    if (!product.group_id) return [product];
    return allProducts
      .filter(p => p.group_id === product.group_id && p.active)
      .filter(p => getSoleModelName(p.name || '', p.color).toLowerCase() === baseName)
      .sort((a, b) => (a.color || '').localeCompare(b.color || ''));
  }, [product, allProducts]);

  // The size range is defined per-variant when registering the sole (MasterVariantDialog).
  // We use the range saved on the active variant — adulto/infantil toggle removed.
  const activeVariant = useMemo(
    () => colorVariants.find(v => v.id === activeTab) || product,
    [colorVariants, activeTab, product],
  );

  const storedSizeRange = useMemo(
    () => (activeVariant ? resolveSizeRange(activeVariant) : null),
    [activeVariant],
  );

  // Effective range: stored metadata has priority, then conjugation inference
  const sizeRange = storedSizeRange ?? inferredRangeFromConjugations;

  const sizes = useMemo(() => buildSizesFromRange(sizeRange), [sizeRange]);

  // True when at least one conjugation entry covers more than one individual size
  const hasAnyConjugation = conjugations.some(c => c.sizes.length > 1);

  // Effective size key list for display and validation:
  //   • Iterates sizeRange.from…to
  //   • If a size is in a conjugation → use the conjugated key (deduplicated)
  //   • Otherwise → use the individual size string
  // This correctly handles "mixed" soles where only some sizes are conjugated.
  const effectiveSizeKeys = useMemo((): string[] => {
    if (!sizeRange) {
      // No range at all — fall back to explicit conjugation keys only
      return conjugations.length > 0
        ? [...conjugations].sort((a, b) => a.display_order - b.display_order).map(c => c.size_key)
        : [];
    }
    if (conjugations.length > 0) {
      const result: string[] = [];
      const added = new Set<string>();
      const sortedConj = [...conjugations].sort((a, b) => a.display_order - b.display_order);
      for (let s = sizeRange.from; s <= sizeRange.to; s++) {
        const conj = sortedConj.find(c => c.sizes.includes(s));
        if (conj) {
          if (!added.has(conj.size_key)) { result.push(conj.size_key); added.add(conj.size_key); }
        } else {
          result.push(String(s));
        }
      }
      return result;
    }
    return Array.from({ length: sizeRange.to - sizeRange.from + 1 }, (_, i) => String(sizeRange.from + i));
  }, [sizeRange, conjugations]);

  const lastProductIdRef = useRef<string | null>(null);

  // Reset activeTab only when the product itself changes (not on every re-open for the same product).
  // Always clear pending changes so a previously-aborted session doesn't bleed into the new one.
  useEffect(() => {
    if (product && open) {
      if (lastProductIdRef.current !== product.id) {
        setActiveTab(product.id);
        lastProductIdRef.current = product.id;
      }
      setPendingChanges({});
    }
  }, [product?.id, open]);

  const handleGradeChange = (productId: string, grade: Record<string, number>, total: number) => {
    setPendingChanges(prev => ({ ...prev, [productId]: { grade, total } }));
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const updates: Array<{ id: string; grade: Record<string, number>; total: number }> = [];

      // All color variants of the same model share the same size range.
      const rangeForStorage = sizeRange; // may be stored or conjugation-inferred

      // Build map: individual numeric size → conjugated key. Used to consolidate
      // legacy stock_grade entries (e.g. "33":5, "34":7) into the new conjugated
      // bucket ("33/34": 12) when conjugations were added AFTER stock was already
      // recorded. Without this consolidation the filter below would silently drop
      // those values and zero out existing stock — see audit B1.
      const sortedConjForConsolidation = [...conjugations].sort(
        (a, b) => a.display_order - b.display_order,
      );
      const individualToConjugated: Record<string, string> = {};
      for (const conj of sortedConjForConsolidation) {
        for (const sz of conj.sizes) {
          individualToConjugated[String(sz)] = conj.size_key;
        }
      }

      for (const variant of colorVariants) {
        const variantRange = resolveSizeRange(variant) ?? inferredRangeFromConjugations;
        const resolvedRange = rangeForStorage ?? variantRange;

        // Valid keys: effective mixed list (conjugated + individual) when available,
        // otherwise fall back to numeric range.
        const validSizeKeys: Set<string> =
          effectiveSizeKeys.length > 0
            ? new Set(effectiveSizeKeys)
            : new Set(buildSizesFromRange(variantRange).map(String));

        if (pendingChanges[variant.id]) {
          // Preserve metadata + filter to valid sizes, consolidating legacy
          // individual keys into their conjugated bucket on the way in.
          const cleanGrade: Record<string, any> = {};
          for (const [k, v] of Object.entries(pendingChanges[variant.id].grade)) {
            if (validSizeKeys.size === 0 || validSizeKeys.has(k)) {
              cleanGrade[k] = v;
            } else if (individualToConjugated[k] && validSizeKeys.has(individualToConjugated[k])) {
              // Legacy individual key (e.g. "33") that's now part of a
              // conjugation (e.g. "33/34"): sum its value into the conjugated
              // bucket so existing stock isn't silently zeroed.
              const target = individualToConjugated[k];
              const numeric = typeof v === 'number' ? v : Number(v);
              if (Number.isFinite(numeric)) {
                cleanGrade[target] = (Number(cleanGrade[target]) || 0) + numeric;
              }
            }
            // else: truly invalid key (out of range) → drop silently
          }
          // Always store range metadata so future dialog opens (and SaleOrderItemForm)
          // can reconstruct the effective key list correctly.
          if (resolvedRange) {
            cleanGrade._size_from = resolvedRange.from;
            cleanGrade._size_to = resolvedRange.to;
          }
          updates.push({ id: variant.id, grade: cleanGrade, total: pendingChanges[variant.id].total });
        }
        // Variante NÃO editada → pula. Fix 18/05/2026: antes empurrava o
        // grade existente pro array de updates, causando 2 problemas:
        // (1) Toast inflado: "Grade de 2 variações atualizada" quando só
        //     1 cor foi de fato editada. User reportou: "ao salvar a grade
        //     do solado por cor o botão aparece como se estivesse salvando
        //     a quantidade das duas cores".
        // (2) UPDATE desnecessário em adjust_stock: trigger
        //     check_grade_quantity_coherence ainda valida, mas se houver
        //     drift histórico SUM(stock_grade) ≠ quantity, falha aqui sem
        //     necessidade. Bug de cancelar OP (mig 20260517120000) era
        //     diferente, mas mesma classe.
      }

      if (updates.length === 0) {
        toast.info('Nenhuma alteração para salvar');
        return;
      }

      for (const { id, grade, total } of updates) {
        const variant = colorVariants.find(v => v.id === id);
        const previousQty = Number(variant?.quantity ?? 0);
        const delta = total - previousQty;
        const { data, error } = await supabase.rpc('adjust_stock' as any, {
          p_product_id: id,
          p_expected_previous_qty: previousQty,
          p_new_qty: total,
          p_delta: delta,
          p_reason: `Ajuste manual de grade — ${variant?.name || id}`,
          p_new_grade: grade,
        });
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        if (result && result.success === false) {
          throw new Error(
            result.error_message === 'CONCURRENCY_ERROR'
              ? `Estoque do solado "${variant?.name || id}" foi alterado por outro usuário. Recarregue.`
              : (result.error_message || 'Falha ao salvar grade'),
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Mensagem precisa: só conta as cores que de fato foram editadas
      // (não inclui as preservadas como antes — vide fix do bloco else acima).
      const updatedNames = updates
        .map(u => colorVariants.find(v => v.id === u.id)?.color || '')
        .filter(Boolean);
      const msg = updates.length === 1
        ? `Grade da cor "${updatedNames[0] || 'solado'}" atualizada!`
        : `Grade atualizada em ${updates.length} cores: ${updatedNames.join(', ')}`;
      toast.success(msg);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!product) return null;

  const groupName = product.name?.split(' ')[0] || 'Solado';
  const hasMultipleColors = colorVariants.length > 1;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Estoque por Numeração
            </DialogTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{getSoleModelName(product.name || '', product.color)}</Badge>
              {sizeRange ? (
                <Badge variant="secondary">
                  Faixa: {sizeRange.from}–{sizeRange.to}
                  {!storedSizeRange && inferredRangeFromConjugations && (
                    <span className="ml-1 opacity-60">(inferida)</span>
                  )}
                </Badge>
              ) : (
                <Badge variant="destructive">Sem faixa cadastrada</Badge>
              )}
              {hasAnyConjugation && (
                <Badge
                  variant="outline"
                  className="text-xs h-5 gap-1 px-1.5 border-primary/40 text-primary bg-primary/5"
                  title="Esta grade contém numerações conjugadas (ex: 23/24)"
                >
                  <Link2 className="h-3 w-3" /> Conjugado
                </Badge>
              )}
              {!hasMultipleColors && product.color && <Badge variant="secondary">{product.color}</Badge>}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto">
            {hasMultipleColors ? (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full flex flex-wrap h-auto gap-1 p-1">
                  {colorVariants.map(v => {
                    const qty = pendingChanges[v.id]?.total ?? Number(v.quantity || 0);
                    return (
                      <TabsTrigger
                        key={v.id}
                        value={v.id}
                        className="flex-1 min-w-[100px] gap-1.5 text-xs py-2"
                      >
                        <span className="truncate">{v.color || 'Sem cor'}</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 ml-1">
                          {qty}
                        </Badge>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {colorVariants.map(v => (
                  <TabsContent key={v.id} value={v.id} className="mt-4">
                    <ColorGradeEditor
                      product={v}
                      sizes={sizes}
                      sizeKeys={effectiveSizeKeys.length > 0 ? effectiveSizeKeys : undefined}
                      onGradeChange={handleGradeChange}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <ColorGradeEditor
                product={product}
                sizes={sizes}
                sizeKeys={effectiveSizeKeys.length > 0 ? effectiveSizeKeys : undefined}
                onGradeChange={handleGradeChange}
              />
            )}
          </div>

          <div className="flex flex-col gap-2 pt-3 border-t mt-2">
            {effectiveSizeKeys.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Faixa de numeração não cadastrada. Defina a grade do solado em{' '}
                  <strong>Gestão de Solados → Grade & Consumos</strong> antes de salvar.
                </span>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              {product.group_id && (
                <Button type="button" variant="secondary" className="gap-2" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Adicionar Cor
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={saving || effectiveSizeKeys.length === 0}
              >
                {saving ? 'Salvando...' : `Salvar Grade (${colorVariants.length} cor${colorVariants.length > 1 ? 'es' : ''})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {product.group_id && (
        <AddToGroupDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          groupId={product.group_id}
          groupName={groupName}
        />
      )}
    </>
  );
}
