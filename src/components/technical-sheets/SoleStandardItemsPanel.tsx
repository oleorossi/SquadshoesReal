import { useMemo, useState, useEffect, useRef } from 'react';
 import { Plus, Trash as Trash2, FloppyDisk as Save, CircleNotch as Loader2, Stack as Layers, MagicWand as Wand2, Sparkle as Sparkles, MagnifyingGlass as Search, X } from '@phosphor-icons/react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useProducts } from '@/hooks/useProducts';
import {
  useSoleStandardItems,
  useSoleSizeGrade,
  useUpsertSoleStandardItem,
  useRemoveSoleStandardItem,
} from '@/hooks/useSoleStandardItems';
import { productGroupingKey } from '@/lib/productNameNormalization';
import { normalizeForSearch } from '@/lib/searchUtils';

/**
 * Categorias de itens "padrão" que podem ser definidos por solado.
 * Estes itens são compartilhados entre praticamente todas as referências
 * (cola, palmilha, forro, linha, EVA).
 */
const STANDARD_CATEGORIES = [
    'cola', 'químico', 'quimico', 'palmilha', 'forro', 'forração', 'forracao', 'salto', 'salto fachetado',
    'linha', 'linhanyl', 'eva', 'adesivo', 'solvente', 'tinta', 'fita', 'prego', 'tachinha', 'espuma',
    'parafuso', 'metal', 'enfeite', 'caixa', 'papel', 'seda', 'etiqueta', 'fachete', 'fachetado', 'tira',
    'reforço', 'reforco', 'tnt', 'elástico', 'elastico', 'espuma', 'velcro', 'zíper', 'ziper'
];

function isStandardItem(p: any): boolean {
  if (p?.is_standard_sole_item === true) return true;
  const cat = (p?.category || '').toLowerCase();
  const name = (p?.name || '').toLowerCase();
  // Skip soles themselves
  if (cat.includes('solado') || cat === 'sola') return false;
  return STANDARD_CATEGORIES.some((s) => cat.includes(s) || name.includes(s));
}

function inferUnit(p: any): string {
  const cat = (p?.category || '').toLowerCase();
  if (cat.includes('cola') || cat.includes('quimi')) return 'g';
  if (cat.includes('linha')) return 'm';
  if (cat.includes('palmilha') || cat.includes('eva') || cat.includes('forro') || cat.includes('forra')) return 'dm²';
  return p?.unit || 'un';
}

interface Props {
  soleProductId: string;
}

export function SoleStandardItemsPanel({ soleProductId }: Props) {
  const { data: products = [] } = useProducts();
  const { data: rows = [], isLoading } = useSoleStandardItems(soleProductId);
  const { data: sizes = [] } = useSoleSizeGrade(soleProductId);
  const upsert = useUpsertSoleStandardItem();
  const remove = useRemoveSoleStandardItem();

  // Highlight: id do entry recém-habilitado como Item Padrão de Solado.
  // Setado pelo evento global 'sole-standard-item-enabled' disparado por
  // ProductFormDialog após salvar com is_standard_sole_item = true.
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Catálogo de itens padrão AGRUPADO por modelo (group_id ou nome).
  // O usuário escolhe o "modelo" (ex: NAPA SOFT, COLA PVC) — não a variante de cor.
  // O id selecionado é o do produto representante (primeira variante do grupo).
  type StandardEntry = {
    id: string; // id do produto representante (âncora persistida)
    groupKey: string; // chave de agrupamento (group_id ou nome normalizado)
    displayName: string;
    category: string;
    variantCount: number;
    representative: any;
    isStd: boolean; // categoria "padrão" (cola/palmilha/forro…) — só pra ordenar no topo
  };

  // Qualquer produto pode ser item de solado, EXCETO os próprios solados.
  // (Antes filtrava por isStandardItem e deixava produtos de fora — pedido user.)
  const isSelectableItem = (p: any) => {
    const cat = (p?.category || '').toLowerCase();
    return !(cat.includes('solado') || cat === 'sola');
  };

  const standardCatalog = useMemo<StandardEntry[]>(() => {
    const items = (products as any[]).filter(isSelectableItem);
    const map = new Map<string, any[]>();
    items.forEach((p) => {
      // Regra global: agrupar SEMPRE por nome normalizado (sem cor).
      // Ver src/lib/productNameNormalization.ts.
      const key = productGroupingKey(p.name || '');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    const entries: StandardEntry[] = [];
    map.forEach((variants, key) => {
      const sorted = [...variants].sort((a, b) =>
        (a.color || '').localeCompare(b.color || '') || (a.sku || '').localeCompare(b.sku || '')
      );
      const rep = sorted[0];
      entries.push({
        id: rep.id,
        groupKey: key,
        displayName: rep.name || '—',
        category: rep.category || '',
        variantCount: sorted.length,
        representative: rep,
        isStd: isStandardItem(rep),
      });
    });
    // Itens "padrão" (palmilha, forração, cola…) primeiro; depois alfabético.
    return entries.sort((a, b) =>
      (a.isStd === b.isStd) ? a.displayName.localeCompare(b.displayName, 'pt-BR') : (a.isStd ? -1 : 1)
    );
  }, [products]);

  // Mapa: id de qualquer variante -> entry (resolve rows persistidas)
  const entryByAnyId = useMemo(() => {
    const map = new Map<string, StandardEntry>();
    const items = (products as any[]).filter(isSelectableItem);
    items.forEach((p) => {
      const key = productGroupingKey(p.name || '');
      const entry = standardCatalog.find((e) => e.groupKey === key);
      if (entry) map.set(p.id, entry);
    });
    return map;
  }, [products, standardCatalog]);

  // Group existing rows by entry.id (resolvendo qualquer variante para seu representante)
  const itemsConfigured = useMemo(() => {
    const map = new Map<string, { unit: string; bySize: Record<number, number> }>();
    rows.forEach((r) => {
      const entry = entryByAnyId.get(r.standard_item_id);
      const key = entry?.id || r.standard_item_id;
      const e = map.get(key) || { unit: r.unit, bySize: {} };
      e.bySize[r.size] = Number(r.consumption);
      e.unit = r.unit;
      map.set(key, e);
    });
    return map;
  }, [rows, entryByAnyId]);

  // Local drafts: itemId -> { unit, bySize }
   const [drafts, setDrafts] = useState<Record<string, { unit: string; bySize: Record<number, number> }>>({});
   const [adding, setAdding] = useState<string>('');
   const [searchTerm, setSearchTerm] = useState('');

  // Reset drafts when sole or persisted rows change
  useEffect(() => {
    const initial: typeof drafts = {};
    itemsConfigured.forEach((v, k) => {
      initial[k] = { unit: v.unit, bySize: { ...v.bySize } };
    });
    setDrafts(initial);
  }, [itemsConfigured]);

  const handleAddItem = () => {
    if (!adding) return;
    if (drafts[adding]) return;
    const entry = standardCatalog.find((p) => p.id === adding);
    setDrafts((prev) => ({
      ...prev,
      [adding]: {
        unit: inferUnit(entry?.representative),
        bySize: Object.fromEntries(sizes.map((s) => [s, 0])),
      },
    }));
    setAdding('');
  };

  const updateCell = (itemId: string, size: number, value: number) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        bySize: { ...prev[itemId].bySize, [size]: value },
      },
    }));
  };

  const updateUnit = (itemId: string, unit: string) => {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], unit } }));
  };

  const fillEmpty = (itemId: string) => {
    const draft = drafts[itemId];
    if (!draft) return;
    const firstNonZero = Object.values(draft.bySize).find((v) => v > 0) || 0;
    if (!firstNonZero) return;
    const nextBy: Record<number, number> = {};
    sizes.forEach((s) => {
      nextBy[s] = draft.bySize[s] && draft.bySize[s] > 0 ? draft.bySize[s] : firstNonZero;
    });
    setDrafts((prev) => ({ ...prev, [itemId]: { ...draft, bySize: nextBy } }));
  };

  const handleSave = async (itemId: string) => {
    const draft = drafts[itemId];
    if (!draft) return;
    await upsert.mutateAsync({
      sole_product_id: soleProductId,
      standard_item_id: itemId,
      unit: draft.unit,
      values: draft.bySize,
    });
  };

  const handleRemove = async (itemId: string) => {
    await remove.mutateAsync({ sole_product_id: soleProductId, standard_item_id: itemId });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const draftEntries = Object.entries(drafts);
   // Use standardCatalog as base, but allow searching all products if not found in catalog
   const availableToAdd = useMemo(() => {
     const query = normalizeForSearch(searchTerm);
     if (!query) return standardCatalog.filter((p) => !drafts[p.id]);
 
     // Search in full products list when searching, but still group by model
     const filteredProducts = (products as any[]).filter((p) => {
       const name = (p.name || '').toLowerCase();
       const sku = (p.sku || '').toLowerCase();
       const cat = (p.category || '').toLowerCase();
       return (name.includes(query) || sku.includes(query) || cat.includes(query)) && 
              !(cat.includes('solado') || cat === 'sola');
     });
 
     const map = new Map<string, any[]>();
     filteredProducts.forEach((p) => {
       const key = productGroupingKey(p.name || '');
       if (!map.has(key)) map.set(key, []);
       map.get(key)!.push(p);
     });
 
     const entries: StandardEntry[] = [];
     map.forEach((variants, key) => {
       const sorted = [...variants].sort((a, b) =>
         (a.color || '').localeCompare(b.color || '') || (a.sku || '').localeCompare(b.sku || '')
       );
       const rep = sorted[0];
       if (!drafts[rep.id]) {
         entries.push({
           id: rep.id,
           groupKey: key,
           displayName: rep.name || '—',
           category: rep.category || '',
           variantCount: sorted.length,
           representative: rep,
           isStd: isStandardItem(rep),
         });
       }
     });
     return entries.sort((a, b) =>
       (a.isStd === b.isStd) ? a.displayName.localeCompare(b.displayName, 'pt-BR') : (a.isStd ? -1 : 1)
     );
   }, [standardCatalog, drafts, searchTerm, products]);

  // Resolver entry destacada e scrollar até ela quando aparecer.
  useEffect(() => {
    if (!highlightedEntryId) return;
    // Aguardar próximo frame para garantir que o DOM refletiu o catálogo atualizado.
    const id = window.requestAnimationFrame(() => {
      const node = highlightedRef.current ?? triggerRef.current;
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    const t = window.setTimeout(() => setHighlightedEntryId(null), 6000);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [highlightedEntryId]);

  // Escutar o evento global emitido após salvar um produto com a flag habilitada
  // e localizar a entry correspondente (por productId ou por nome).
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      const productId: string | null = detail.productId ?? null;
      const name: string = detail.name ?? '';
      let target: StandardEntry | undefined;
      if (productId) target = entryByAnyId.get(productId);
      if (!target && name) {
        const key = productGroupingKey(name);
        target = standardCatalog.find((e) => e.groupKey === key);
      }
      if (target) setHighlightedEntryId(target.id);
    };
    window.addEventListener('sole-standard-item-enabled', handler as EventListener);
    return () => window.removeEventListener('sole-standard-item-enabled', handler as EventListener);
  }, [entryByAnyId, standardCatalog]);

  const highlightedEntry = highlightedEntryId
    ? standardCatalog.find((e) => e.id === highlightedEntryId)
    : null;
  const highlightedAlreadyAdded = highlightedEntryId ? !!drafts[highlightedEntryId] : false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sizes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4 text-xs text-amber-800">
        Este solado ainda não possui grade de numeração definida. Cadastre a grade em{' '}
        <span className="font-semibold">Estoque → Solado → Editar grade</span> antes de definir consumo de itens padrão.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4" data-testid="sole-standard-items-panel">
      {highlightedEntry && (
        <div
          ref={highlightedRef}
          data-testid="sole-standard-highlight-banner"
          data-highlighted-id={highlightedEntry.id}
          className="flex items-center justify-between gap-3 rounded-md border-2 border-primary/60 bg-primary/5 p-3 ring-2 ring-primary/30 ring-offset-2 ring-offset-background animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary truncate">
                "{highlightedEntry.displayName}" disponível como Item Padrão de Solado
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {highlightedAlreadyAdded
                  ? 'Já adicionado a este solado — confira abaixo.'
                  : 'Selecione no campo abaixo para configurar o consumo por numeração.'}
              </p>
            </div>
          </div>
          {!highlightedAlreadyAdded && (
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1 text-xs shrink-0"
              onClick={() => {
                setAdding(highlightedEntry.id);
                triggerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <Plus className="h-3 w-3" /> Selecionar
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2">
              Itens padrão deste solado
              <Badge variant="outline" className="text-xs">
                {sizes.length} numerações • {sizes[0]}–{sizes[sizes.length - 1]}
              </Badge>
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define o consumo de <strong>Cola</strong>, <strong>Palmilha</strong>, <strong>Linha</strong>, EVA e outros materiais que vão junto com este solado em toda referência que o usar.
            </p>
          </div>
        </div>
         <div className="flex items-center gap-2 relative">
           <div className="relative">
             <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
             <Select value={adding} onValueChange={setAdding}>
               <SelectTrigger ref={triggerRef} className="h-8 w-72 text-xs pl-8">
                 <SelectValue placeholder="Buscar item (cola, linha, EVA…)" />
               </SelectTrigger>
               <SelectContent className="max-h-[300px]">
                 <div className="p-2 sticky top-0 bg-popover z-10 border-b border-border/50">
                   <div className="relative">
                     <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                     <Input
                       placeholder="Digitar para buscar no estoque..."
                       value={searchTerm}
                       onChange={(e) => setSearchTerm(e.target.value)}
                       onKeyDown={(e) => e.stopPropagation()}
                       className="h-7 text-xs pl-7 pr-7"
                     />
                     {searchTerm && (
                       <button
                         onClick={(e) => { e.stopPropagation(); setSearchTerm(''); }}
                         className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                       >
                         <X className="h-3 w-3" />
                       </button>
                     )}
                   </div>
                 </div>
                 {availableToAdd.length === 0 ? (
                   <div className="px-2 py-4 text-xs text-muted-foreground text-center italic">
                     {searchTerm ? 'Nenhum item encontrado' : 'Todos itens já adicionados'}
                   </div>
                 ) : (
                   availableToAdd.map((entry) => (
                     <SelectItem
                       key={entry.id}
                       value={entry.id}
                       className={
                         'text-xs ' +
                         (entry.id === highlightedEntryId
                           ? 'bg-primary/10 font-semibold text-primary'
                           : '')
                       }
                     >
                       <div className="flex flex-col">
                         <span>{entry.displayName}</span>
                         <span className="text-xs text-muted-foreground">
                           {entry.category} {entry.variantCount > 1 && `• ${entry.variantCount} cores`}
                         </span>
                       </div>
                       {entry.id === highlightedEntryId && (
                         <Sparkles className="inline h-3 w-3 ml-1 text-primary" />
                       )}
                     </SelectItem>
                   ))
                 )}
               </SelectContent>
             </Select>
           </div>
          <Button size="sm" variant="outline" disabled={!adding} onClick={handleAddItem} className="h-8 gap-1">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
      </div>

      {draftEntries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-background/40 p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Nenhum item padrão definido. Selecione acima (ex: <span className="font-mono">Cola PVC</span>,{' '}
            <span className="font-mono">EVA 3MM</span>, <span className="font-mono">LINHANYL</span>) para configurar o
            consumo por numeração.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {draftEntries.map(([itemId, draft]) => {
            const entry = standardCatalog.find((p) => p.id === itemId);
            const persisted = itemsConfigured.get(itemId);
            const isDirty =
              !persisted ||
              persisted.unit !== draft.unit ||
              sizes.some((s) => (persisted.bySize[s] ?? 0) !== (draft.bySize[s] ?? 0));

            return (
              <div key={itemId} className="rounded-md border border-border/60 bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{entry?.displayName || itemId}</span>
                    {entry && entry.variantCount > 1 && (
                      <Badge variant="secondary" className="text-xs">{entry.variantCount} cores</Badge>
                    )}
                    <Badge variant="outline" className="text-xs">{entry?.category}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Unidade:</span>
                    <Select value={draft.unit} onValueChange={(v) => updateUnit(itemId, v)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['un', 'g', 'kg', 'ml', 'l', 'cm', 'm', 'dm²', 'cm²'].map((u) => (
                          <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => fillEmpty(itemId)} className="h-7 gap-1 text-xs" title="Preencher vazios com o primeiro valor">
                      <Wand2 className="h-3 w-3" /> Preencher
                    </Button>
                    <Button size="sm" variant={isDirty ? 'default' : 'ghost'} disabled={!isDirty || upsert.isPending} onClick={() => handleSave(itemId)} className="h-7 gap-1 text-xs">
                      {upsert.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Salvar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(itemId)} className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Remover item padrão">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-20 text-xs">Numeração</TableHead>
                        {sizes.map((s) => (
                          <TableHead key={s} className="text-center text-xs min-w-[64px]">
                            {s}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell
                          className="text-xs text-muted-foreground font-mono"
                          title={
                            draft.unit === 'par'
                              ? 'Pares de solado consumidos por par de sapato (1:1 para solados normais)'
                              : `Quantidade em ${draft.unit} consumida por par de sapato`
                          }
                        >
                          {draft.unit === 'par' ? 'par/par sap.' : `${draft.unit}/par`}
                        </TableCell>
                        {sizes.map((s) => (
                          <TableCell key={s} className="p-1 text-center">
                            <NumberInput
                              value={draft.bySize[s] ?? 0}
                              onChange={(v) => updateCell(itemId, s, Number(v) || 0)}
                              step="0.01"
                              min={0}
                              decimals={4}
                              className="h-7 w-16 text-center text-xs mx-auto"
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
