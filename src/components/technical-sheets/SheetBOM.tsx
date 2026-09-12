import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CircleNotch as Loader2, Plus, Trash as Trash2, PencilSimple as Pencil, ClipboardText as ClipboardCopy,
  Copy, CaretUpDown as ChevronsUpDown, Check, Package, Warning as AlertTriangle, Cube as Box,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useProducts } from '@/hooks/useProducts';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import {
  useSheetMaterials, useAddSheetMaterial, useUpdateSheetMaterial,
  useDeleteSheetMaterial, useBulkAddSheetMaterials, useTechnicalSheetsCatalog,
  type SheetMaterialFormData,
} from '@/hooks/useTechnicalSheets';
import {
  COMPONENT_CATEGORIES, matchCategory, emptyMaterialForm, suggestedConsumptionSector,
} from '@/lib/componentCategories';
import { bomMaterialCostPerPair } from '@/lib/materialConsumption';
import { needsWidthForConversion, effectiveConversionFactor } from '@/lib/purchaseConversion';
import { CONSUMPTION_SECTORS } from '@/lib/consumptionSector';
import { normalizeForSearch, searchMatchesAllTerms, rankBySearchScore } from '@/lib/searchUtils';
import { HighlightMatch } from '@/components/ui/highlight-match';
import { getSizesForCategory } from '@/lib/technicalSheetSizes';
import { cn, safeToFixed } from '@/lib/utils';
import { SectionTitle } from '@/components/technical-sheets/sheetFormFields';
import { DirectComponentSelect, GroupMaterialSelect, NcmInlineEditor } from '@/components/technical-sheets/sheetSelectors';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';

export function SheetBOM({ sheetId, safetyPct, onSafetyChange, shoeCategory }: {
  sheetId: string; safetyPct: number;
  onSafetyChange: (v: number) => void; shoeCategory?: string;
}) {
  const MATERIAL_SIZES = getSizesForCategory(shoeCategory);
  const { data: materials = [], isLoading } = useSheetMaterials(sheetId);
  const { data: products = [] } = useProducts();
  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_bom'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, description, colors').order('name');
      if (error) throw error;
      return data;
    },
  });
  const { data: sheets = [] } = useTechnicalSheetsCatalog();
  const { data: componentSheets = [] } = useComponentSheets();
  const addMaterial = useAddSheetMaterial();
  const updateMaterial = useUpdateSheetMaterial(sheetId);
  const deleteMaterial = useDeleteSheetMaterial(sheetId);
  const bulkAdd = useBulkAddSheetMaterials();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; data: SheetMaterialFormData } | null>(null);
  const [form, setForm] = useState(emptyMaterialForm);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const componentSheetMap = useMemo(() => {
    const map: Record<string, (typeof componentSheets)[number]> = {};
    componentSheets.forEach((cs) => { map[cs.product_id] = cs; });
    return map;
  }, [componentSheets]);

  const usedProductIds = new Set(materials.map(m => m.product_id));
  const usedGroupIds = new Set(materials.map((m: any) => m.group_id).filter(Boolean));
  const unusedGroups = useMemo(() => {
    const unused = (groups || []).filter((g) => !usedGroupIds.has(g.id));
    if (!groupSearch.trim()) return unused;
    const hits = unused.filter((g) =>
      searchMatchesAllTerms(groupSearch, g.name, g.description, g.colors),
    );
    return rankBySearchScore(hits, groupSearch, (g) => g.name, (g) => g.description);
  }, [groups, materials, groupSearch]);
  const availableProducts = products.filter(p => p.active);
  const otherSheets = sheets.filter((s) => s.id !== sheetId && !(
    s as typeof s & { retired_at?: string | null }
  ).retired_at);

  const groupedMaterials = useMemo(() => {
    const groups: Record<string, typeof materials> = {};
    // Initialize in COMPONENT_CATEGORIES order to preserve hierarchy
    COMPONENT_CATEGORIES.forEach(cat => { groups[cat.key] = []; });
    groups['Outros'] = [];
     materials.forEach(m => {
       const rawCat = (m as any).products?.category || 'Outros';
       const cat = matchCategory(rawCat);
       
       // As categorias abaixo são tratadas via Especificações Técnicas (modern specs) 
       // na parte superior da aba. Para evitar confusão visual e duplicidade
       // no motor de débito de estoque (BOM vs Specs), ocultamos essas categorias do BOM legado.
       if (['Solado', 'Cabedal', 'Forração', 'Palmilha'].includes(cat)) return;

       if (!groups[cat]) groups[cat] = [];
       groups[cat].push(m);
     });
    // Remove empty categories
    Object.keys(groups).forEach(k => { if (groups[k].length === 0) delete groups[k]; });
    return groups;
  }, [materials]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

  const calcAreaDm2FromComponentSheet = (cs: any): number => {
    if (!cs?.dimensions_length || !cs?.dimensions_width) return 0;
    const unit = (cs.dimensions_unit || 'mm').toLowerCase();
    const length = Number(cs.dimensions_length || 0);
    const width = Number(cs.dimensions_width || 0);
    if (length <= 0 || width <= 0) return 0;
    if (unit === 'mm') return (length * width) / 10000;
    if (unit === 'cm') return (length * width) / 100;
    if (unit === 'm') return (length * width) * 100;
    return 0;
  };

  const isDm2ConsumptionCategory = (category?: string) => {
    const cat = (category || '').toLowerCase();
    return cat.includes('cabedal') || cat.includes('forro') || cat.includes('forração') || cat.includes('palmilha');
  };

  /** Get the consumption unit — always prefer the product's registered unit from inventory */
  const getConsumptionUnit = (productId: string): string => {
    const cs = componentSheetMap[productId];
    const prod = cs?.products || products.find((p: any) => p.id === productId);
    const registeredUnit = (prod?.unit || '').trim();
    const category = (prod?.category || '').toLowerCase().trim();

    // 1. If the product has a registered unit in inventory, use it
    if (registeredUnit) {
      const lower = registeredUnit.toLowerCase();
      // Normalize common variants
      if (['dm²', 'dm2', 'decímetro quadrado', 'decimetro quadrado'].includes(lower)) return 'dm²';
      if (['m²', 'm2', 'metro quadrado'].includes(lower)) return 'm²';
      if (['kg', 'quilo', 'quilograma'].includes(lower)) return 'kg';
      if (['m', 'metro', 'metros'].includes(lower)) return 'm';
      if (['un', 'unidade', 'unidades', 'pç', 'peça', 'par', 'pares'].includes(lower)) return registeredUnit;
      if (['ml', 'litro', 'l', 'g', 'cm'].includes(lower)) return registeredUnit;
      return registeredUnit;
    }

    // 2. Fallback by category when no unit is registered
    if (['cola', 'adesivo', 'hotmel', 'primer', 'químico', 'quimico'].some(a => category.includes(a))) return 'kg';
    if (['componente', 'acessório', 'acessorio', 'embalagem', 'aviamento', 'ferramentas'].some(a => category.includes(a))) return 'un';

    // 3. If component sheet has plate dimensions → dm²
    if (cs) {
      const hasPlate = cs.dimensions_length > 0 && cs.dimensions_width > 0;
      if (hasPlate) return 'dm²';
    }

    return 'dm²';
  };

  const handleGroupSelect = (groupId: string) => {
    // Find a representative product from this group
    const groupProducts = products.filter(p => p.group_id === groupId && p.active);
    const rep = groupProducts[0];
    if (!rep) return;
    
    const cs = componentSheetMap[rep.id];
    const yieldPerSize: Record<string, number> = {};
    
    if (cs) {
      const dims: string[] = [];
      if (cs.dimensions_length) dims.push(`${cs.dimensions_length}`);
      if (cs.dimensions_width) dims.push(`${cs.dimensions_width}`);
      if (cs.dimensions_thickness) dims.push(`${cs.dimensions_thickness}`);
      const dimStr = dims.length > 0 ? `${dims.join(' × ')} ${cs.dimensions_unit || 'mm'}` : '';

      // Build per-size consumption from yield_per_size
      const yieldEntries = Object.entries(cs.yield_per_size || {});
      yieldEntries.forEach(([size, v]: [string, any]) => {
        const numVal = Number(v);
        if (Number.isFinite(numVal) && numVal > 0) yieldPerSize[size] = numVal;
      });

      const avgConsumption = yieldEntries.length > 0
        ? yieldEntries.reduce((sum: number, [, v]: [string, any]) => sum + Number(v), 0) / yieldEntries.length
        : 0;

      setForm(f => ({
        ...f,
        product_id: rep.id,
        group_id: groupId,
        consumption_sector: f.consumption_sector || suggestedConsumptionSector(rep.category),
        width: dimStr || f.width,
        weight: f.weight,
        quantity_per_unit: avgConsumption > 0 ? Math.round(avgConsumption * 10000) / 10000 : f.quantity_per_unit,
        consumption_per_size: Object.keys(yieldPerSize).length > 0 ? yieldPerSize : f.consumption_per_size,
      }));
    } else {
      setForm(f => ({ ...f, product_id: rep.id, group_id: groupId, consumption_sector: f.consumption_sector || suggestedConsumptionSector(rep.category) }));
    }
  };

  const handleProductSelect = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    const cs = componentSheetMap[productId];
    const yieldPerSize: Record<string, number> = {};

    if (cs) {
      const yieldEntries = Object.entries(cs.yield_per_size || {});
      yieldEntries.forEach(([size, v]: [string, any]) => {
        const numVal = Number(v);
        if (Number.isFinite(numVal) && numVal > 0) yieldPerSize[size] = numVal;
      });
      const avgConsumption = yieldEntries.length > 0
        ? yieldEntries.reduce((sum: number, [, v]: [string, any]) => sum + Number(v), 0) / yieldEntries.length
        : 0;

      setForm(f => ({
        ...f,
        product_id: productId,
        group_id: prod?.group_id || null,
        consumption_sector: f.consumption_sector || suggestedConsumptionSector(prod?.category),
        quantity_per_unit: avgConsumption > 0 ? Math.round(avgConsumption * 10000) / 10000 : f.quantity_per_unit,
        consumption_per_size: Object.keys(yieldPerSize).length > 0 ? yieldPerSize : f.consumption_per_size,
      }));
    } else {
      setForm(f => ({ ...f, product_id: productId, group_id: prod?.group_id || null, consumption_sector: f.consumption_sector || suggestedConsumptionSector(prod?.category) }));
    }
  };

  /** Products within the selected group for the product picker */
  const groupProductsForSelection = useMemo(() => {
    if (!form.group_id) return [];
    return products.filter(p => p.group_id === form.group_id && p.active);
  }, [form.group_id, products]);

  /** Recalculate average from per-size consumption */
  const recalcAvgFromPerSize = (perSize: Record<string, number>) => {
    const vals = Object.values(perSize).filter(v => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  const getCostPerPair = (m: any) => {
    const prod = (m as any).products;
    const unitPrice = Number(prod?.unit_price || 0);
    const cs = componentSheetMap[m.product_id] || null;
    // Regra canônica: material de área (dm²/par) com produto em unidade física
    // (m/cm/placa) é convertido pela largura/área da ficha ANTES de × preço
    // (senão infla ~100×). Itens diretos (cola/caixa/tira) seguem qty × preço × perda.
    return bomMaterialCostPerPair(Number(m.quantity_per_unit), unitPrice, prod?.unit, cs).cost;
  };

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const hasPerSize = Object.values(form.consumption_per_size || {}).some(v => Number(v) > 0);
    if (!form.product_id || !form.consumption_sector || (form.quantity_per_unit <= 0 && !hasPerSize)) return;

    const prod = products.find(p => p.id === form.product_id);
    const isSolado = normalizeForSearch(prod?.category).includes('solado') || normalizeForSearch(prod?.category).includes('sola');

    if (isSolado) {
      try {
        const { data: structures } = await supabase
          .from('sole_structures')
          .select('*')
          .eq('sole_id', form.product_id);
        
        const { data: specs } = await supabase
          .from('sole_technical_specs')
          .select('*')
          .eq('sole_id', form.product_id);

        if (structures && structures.length > 0) {
          const toAdd: SheetMaterialFormData[] = [{ ...form }];
          
          for (const struct of structures) {
            if (!struct.default_group_id) continue;

            // Forro do CABEDAL não é auto-adicionado do solado (2026-06-30): é
            // cabedal a cabedal, definido na própria ficha do modelo. Só a
            // estrutura de Palmilha (placa) entra automaticamente do solado.
            if (struct.component_type === 'Forro') continue;

            // Check if already in materials
            const alreadyExists = materials.some((m: any) => m.group_id === struct.default_group_id);
            if (alreadyExists) continue;

            const groupProds = products.filter(p => p.group_id === struct.default_group_id && p.active);
            const rep = groupProds[0];
            if (!rep) continue;

            const perSize: Record<string, number> = {};
            specs?.forEach(s => {
              if (s.insole_consumption_dm2 && Number(s.insole_consumption_dm2) > 0) perSize[String(s.size)] = Number(s.insole_consumption_dm2);
            });

            const avg = Object.values(perSize).length > 0 
              ? Object.values(perSize).reduce((a, b) => a + b, 0) / Object.values(perSize).length 
              : 0;

            toAdd.push({
              product_id: rep.id,
              group_id: struct.default_group_id,
              quantity_per_unit: avg,
              consumption_per_size: perSize,
              color: '',
              width: '',
              weight: '',
              supplier: '',
              notes: `Automático via Solado ${prod?.name}`,
              sizes: '',
              consumption_sector: suggestedConsumptionSector(rep.category),
            });
          }

          if (toAdd.length > 1) {
            await bulkAdd.mutateAsync({ sheetId, materials: toAdd });
            setAdding(false);
            setForm(emptyMaterialForm);
            return;
          }
        }
      } catch (err) {
        console.error('Erro ao buscar estruturas do solado:', err);
      }
    }

    try {
      await addMaterial.mutateAsync({ sheetId, data: form });
      setAdding(false);
      setForm(emptyMaterialForm);
    } catch (err) {
      // toast is already handled by the hook
    }
  };


  const handleEdit = (m: any) => {
    setEditing({
      id: m.id,
      data: {
        product_id: m.product_id,
        group_id: m.group_id || null,
        quantity_per_unit: m.quantity_per_unit,
        consumption_per_size: m.consumption_per_size || {},
        color: m.color || '',
        width: m.width || '',
        weight: m.weight || '',
        supplier: m.supplier || '',
        notes: m.notes || '',
        sizes: m.sizes || '',
        consumption_sector: m.consumption_sector || '',
      },
    });
  };

  const handleUpdateSubmit = async () => {
    if (!editing) return;
    try {
      await updateMaterial.mutateAsync({ id: editing.id, data: editing.data });
      setEditing(null);
    } catch (err) {
      // toast is already handled by the hook
    }
  };

  const handleCopyFrom = async (sourceSheetId: string) => {
    const { data } = await supabase.from('sheet_materials')
      .select('product_id, group_id, quantity_per_unit, color, width, weight, supplier, notes, sizes, consumption_sector')
      .eq('sheet_id', sourceSheetId);
    if (!data?.length) { toast.error('Ficha sem materiais'); return; }
    const toAdd = (data as any[]).filter(m => !usedProductIds.has(m.product_id)).map(m => ({ ...m, sizes: m.sizes || '' }));
    if (!toAdd.length) { toast.info('Todos os materiais já estão na ficha'); return; }
    bulkAdd.mutate({ sheetId, materials: toAdd }, { onSuccess: () => setShowCopyDialog(false) });
  };

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Bill of Materials (BOM)</SectionTitle>
        <div className="flex gap-1">
          {otherSheets.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowCopyDialog(!showCopyDialog)} className="gap-1 h-7 text-xs"><Copy className="h-3 w-3" /> Copiar</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(!adding)} className="gap-1 h-7 text-xs"><Plus className="h-3 w-3" /> Material</Button>
        </div>
      </div>

      {showCopyDialog && (
        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Copiar materiais de outra ficha:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
            {otherSheets.map((s: any) => (
              <Button key={s.id} variant="ghost" size="sm" className="justify-start h-auto py-2 text-left" onClick={() => handleCopyFrom(s.id)}>
                <span className="text-sm font-medium">{s.name}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <div className="p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-primary">Adicionar Material ao BOM</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Group selector */}
            <div className="col-span-2 sm:col-span-3">
              <Label className="text-xs">Grupo de Material</Label>
              <Popover onOpenChange={(open) => { if (!open) setGroupSearch(''); }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="mt-1 h-9 w-full justify-between text-sm font-normal">
                    {form.group_id ? (groups.find((g: any) => g.id === form.group_id)?.name || 'Grupo selecionado') : 'Selecionar grupo...'}
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar grupo..." value={groupSearch} onValueChange={setGroupSearch} />
                    <CommandList>
                      <CommandEmpty>Nenhum grupo encontrado</CommandEmpty>
                      <CommandGroup>
                        {unusedGroups.map((g) => (
                          <CommandItem key={g.id} value={g.id} onSelect={() => handleGroupSelect(g.id)}>
                            <Check className={cn("mr-2 h-4 w-4", form.group_id === g.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col">
                              <span className="text-sm"><HighlightMatch text={g.name} term={groupSearch} /></span>
                              {g.description && <span className="text-xs text-muted-foreground"><HighlightMatch text={g.description} term={groupSearch} /></span>}
                              {g.colors && <span className="text-xs text-muted-foreground">Cores: <HighlightMatch text={g.colors} term={groupSearch} /></span>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Product selector within group */}
            {form.group_id && groupProductsForSelection.length > 1 && (
              <div className="col-span-2 sm:col-span-3">
                <Label className="text-xs font-semibold text-primary">Item Específico do Grupo</Label>
                <Select value={form.product_id} onValueChange={handleProductSelect}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecionar item..." /></SelectTrigger>
                  <SelectContent>
                    {groupProductsForSelection.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {p.color && <Badge variant="outline" className="text-xs">{p.color}</Badge>}
                          <span className="text-xs text-muted-foreground font-mono">{p.unit}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.unit_price || 0)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {groupProductsForSelection.length} itens no grupo — cada item pode ter preço e consumo diferentes
                </p>
              </div>
            )}

            {/* Fallback: individual product for items without group */}
            {!form.group_id && (
              <div className="col-span-2 sm:col-span-3">
                <Label className="text-xs text-muted-foreground">Ou selecione um produto individual (sem grupo)</Label>
                <Select value={form.product_id} onValueChange={handleProductSelect}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Produto individual..." /></SelectTrigger>
                  <SelectContent>
                    {availableProducts.filter(p => !p.group_id).map(p => (
                      <SelectItem key={p.id} value={p.id} disabled={usedProductIds.has(p.id)}>
                        <span className="flex items-center gap-2">
                          {p.name}
                          <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>
                          <Badge variant="outline" className="text-xs">{p.category}</Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Selected product info card */}
            {form.product_id && (() => {
              const prod = products.find(p => p.id === form.product_id);
              const cs = componentSheetMap[form.product_id];
              if (!prod) return null;
              return (
                <div className="col-span-2 sm:col-span-3 rounded-md border border-accent bg-accent/10 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold">{prod.name}</span>
                    {prod.color && <Badge variant="outline" className="text-xs">{prod.color}</Badge>}
                    <Badge variant="secondary" className="text-xs ml-auto">{getConsumptionUnit(prod.id)}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Preço un.:</span> <span className="font-mono font-semibold">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.unit_price || 0)}</span></div>
                    <div><span className="text-muted-foreground">Estoque:</span> <span className="font-mono">{(prod.quantity ?? 0).toLocaleString('pt-BR')}</span></div>
                    {cs && cs.dimensions_length > 0 && (
                      <div><span className="text-muted-foreground">Dim.:</span> <span className="font-mono">{cs.dimensions_length}×{cs.dimensions_width} {cs.dimensions_unit}</span></div>
                    )}
                  </div>
                  {!cs && (
                    <div className="flex items-center gap-2 mt-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span className="text-xs">Sem Ficha de Componente — custo será Qtd/par × Preço unitário</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Setor de consumo <span className="text-destructive">*</span></Label>
              <Select value={form.consumption_sector} onValueChange={v => setForm(f => ({ ...f, consumption_sector: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                <SelectContent>
                  {CONSUMPTION_SECTORS.map(sector => <SelectItem key={sector} value={sector}>{sector}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Setor físico responsável pelo consumo deste material.
              </p>
            </div>
          </div>

          {/* Per-size consumption grid */}
          <div>
            <Label className="text-xs font-semibold">Consumo por Numeração ({getConsumptionUnit(form.product_id)}/par)</Label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Defina o consumo unitário para cada tamanho. O cálculo industrial usa exclusivamente estes valores por numeração.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MATERIAL_SIZES.map(size => {
                const sizeKey = String(size);
                const perSize = form.consumption_per_size || {};
                return (
                  <div key={size} className="flex flex-col items-center gap-0.5">
                    <span className="text-xs font-mono text-muted-foreground">{size}</span>
                    <NumberInput
                      value={perSize[sizeKey] || 0}
                      onChange={(val) => {
                        const newPerSize = { ...perSize, [sizeKey]: val };
                        const avg = recalcAvgFromPerSize(newPerSize);
                        setForm(f => ({
                          ...f,
                          consumption_per_size: newPerSize,
                          quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : f.quantity_per_unit,
                        }));
                      }}
                      className="w-[78px] h-7 text-xs text-center font-mono"
                      placeholder="0"
                      step="0.001"
                      unit={getConsumptionUnit(form.product_id)}
                    />
                  </div>
                );
              })}
              <div className="flex flex-col gap-0.5 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const perSize = form.consumption_per_size || {};
                    // Find the last filled value
                    let lastVal = 0;
                    for (let i = MATERIAL_SIZES.length - 1; i >= 0; i--) {
                      const v = Number(perSize[String(MATERIAL_SIZES[i])] || 0);
                      if (v > 0) { lastVal = v; break; }
                    }
                    if (lastVal <= 0) return;
                    const newPerSize: Record<string, number> = {};
                    MATERIAL_SIZES.forEach(s => {
                      const existing = Number(perSize[String(s)] || 0);
                      newPerSize[String(s)] = existing > 0 ? existing : lastVal;
                    });
                    const avg = recalcAvgFromPerSize(newPerSize);
                    setForm(f => ({ ...f, consumption_per_size: newPerSize, quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : f.quantity_per_unit }));
                  }}
                >
                  Preencher Vazios
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => { setAdding(false); setForm(emptyMaterialForm); }}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd} disabled={!form.product_id || !form.consumption_sector || (form.quantity_per_unit <= 0 && Object.values(form.consumption_per_size || {}).every(v => Number(v) <= 0)) || addMaterial.isPending}>
              {addMaterial.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Adicionar'}
            </Button>
          </div>
        </div>
      )}

      {/* Materials Table */}
      {materials.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs">Material / Grupo</TableHead>
                <TableHead className="text-xs">Cat.</TableHead>
                <TableHead className="text-xs font-mono">NCM</TableHead>
                <TableHead className="text-xs font-mono">SKU</TableHead>
                <TableHead className="text-xs">Dimensões</TableHead>
                <TableHead className="text-xs">Un.</TableHead>
                <TableHead className="text-xs text-right">Qtd/Par</TableHead>
                <TableHead className="text-xs text-center">Rend.</TableHead>
                <TableHead className="text-xs">Forn.</TableHead>
                <TableHead className="text-xs">Setor</TableHead>
                <TableHead className="text-xs text-right">Custo/Par</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const entries = Object.entries(groupedMaterials);
                let lastSection = '';
                const rows: React.ReactNode[] = [];
                
                entries.forEach(([cat, mats]) => {
                  const catConfig = COMPONENT_CATEGORIES.find(c => c.key === cat);
                  const CatIcon = catConfig?.icon || Box;
                  const section = catConfig?.section || 'modelo';
                  
                  // Add section header when transitioning
                  if (section !== lastSection) {
                    lastSection = section;
                    rows.push(
                      <TableRow key={`section-${section}`} className="border-t-2 border-primary/20">
                        <TableCell colSpan={12} className="py-2 bg-primary/5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-primary">
                              {section === 'base' ? '📐 Base do Solado — Consumo padrão' : '🎨 Depende do Modelo'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {section === 'base' ? '(indiferente à cor do solado)' : '(específico por referência)'}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  
                  rows.push(
                    <TableRow key={`cat-${cat}`} className="bg-muted/20">
                      <TableCell colSpan={12} className="py-1.5">
                        <div className="flex items-center gap-2">
                          <CatIcon className={`h-3.5 w-3.5 ${catConfig?.color || 'text-muted-foreground'}`} />
                          <span className="text-xs font-semibold">{catConfig?.label || cat}</span>
                          <Badge variant="outline" className="text-xs">{mats.length}</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  
                  mats.forEach(m => {
                    const prod = (m as any).products;
                    const groupInfo = (m as any).product_groups;
                    const cs = componentSheetMap[m.product_id];
                    const costPair = getCostPerPair(m);
                    const areaDm2 = cs ? calcAreaDm2FromComponentSheet(cs) : 0;
                    const pairsPerPlate = areaDm2 > 0 && Number(m.quantity_per_unit) > 0 ? Math.floor(areaDm2 / Number(m.quantity_per_unit)) : 0;
                    const displayName = groupInfo?.name || prod?.name || '—';
                    const perSize = (m as any).consumption_per_size || {};
                    const perSizeEntries = Object.entries(perSize).filter(([, v]: [string, any]) => Number(v) > 0);

                    // Aviso de conversão incompleta: produto comprado em unidade diferente
                    // do estoque mas sem fator/largura cadastrado → débito errado.
                    let conversionIssue: string | null = null;
                    if (prod) {
                      const ctx = {
                        unit: prod.unit || 'un',
                        purchase_unit: prod.purchase_unit,
                        conversion_rate: prod.conversion_rate,
                        dimensions_width: prod.dimensions_width,
                      };
                      const hasDifferentUnits = ctx.purchase_unit && ctx.purchase_unit !== ctx.unit;
                      if (hasDifferentUnits) {
                        if (needsWidthForConversion(ctx) && (!ctx.dimensions_width || ctx.dimensions_width <= 0)) {
                          conversionIssue = `Falta largura — ${ctx.purchase_unit} → ${ctx.unit} requer dimensions_width.`;
                        } else if (effectiveConversionFactor(ctx) === 1 && ctx.purchase_unit !== ctx.unit) {
                          conversionIssue = `Falta fator — informe quantos ${ctx.unit} cabem em 1 ${ctx.purchase_unit}.`;
                        }
                      }
                    }

                    // Consumo de ÁREA (dm²→metro) usa a largura da FICHA DE COMPONENTE.
                    // Se a FT existe mas está SEM largura e o produto é linear (m/cm), o
                    // consumo infla ~100× no PV/custeio (bug clássico de napa no BOM,
                    // 2026-05-30). Alta confiança: só dispara quando a FT existe (cs) —
                    // material linear nativo (elástico) não tem FT, então não alarma.
                    if (!conversionIssue && cs && Number(cs.dimensions_width || 0) <= 0) {
                      const u = (prod?.unit || '').toString().trim().toLowerCase();
                      if (['m', 'cm', 'metro', 'metros', 'mt'].includes(u)) {
                        conversionIssue = 'Ficha de componente sem largura — consumo de área pode inflar ~100×.';
                      }
                    }

                    rows.push(
                      <TableRow key={m.id}>
                        <TableCell className="text-xs font-medium">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              {displayName}
                              {groupInfo && <Badge variant="outline" className="text-[8px]">Grupo</Badge>}
                              {cs && <Badge variant="outline" className="text-[8px] bg-accent/30 border-accent">FT</Badge>}
                              {conversionIssue && (
                                <Badge variant="outline" className="text-[8px] border-warning text-warning gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Conversão
                                </Badge>
                              )}
                            </div>
                            {conversionIssue && (
                              <span className="text-xs text-warning">{conversionIssue}</span>
                            )}
                            {prod?.name && groupInfo && prod.name !== groupInfo.name && (
                              <span className="text-xs text-muted-foreground">Item: {prod.name}{prod.color ? ` (${prod.color})` : ''}</span>
                            )}
                            {perSizeEntries.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 mt-0.5">
                                {perSizeEntries.map(([size, qty]: [string, any]) => (
                                  <span key={size} className="text-xs font-mono bg-muted px-1 rounded">{size}:{safeToFixed(qty, 2)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{prod?.category ?? '—'}</TableCell>
                        <TableCell className="text-xs font-mono p-1">
                          <NcmInlineEditor productId={m.product_id} currentNcm={prod?.ncm || ''} />
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {prod?.sku || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {cs && cs.dimensions_length > 0
                            ? `${cs.dimensions_length}×${cs.dimensions_width}×${cs.dimensions_thickness} ${cs.dimensions_unit}`
                            : m.width || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{getConsumptionUnit(m.product_id)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                        <TableCell className="text-xs text-center font-mono">
                          {pairsPerPlate > 0 ? `~${pairsPerPlate}p` : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{m.supplier || '—'}</TableCell>
                        <TableCell className="text-xs"><Badge variant={(m as any).consumption_sector ? 'outline' : 'destructive'} className="text-[10px]">{(m as any).consumption_sector || 'Revisar'}</Badge></TableCell>
                        <TableCell className="text-xs text-right font-mono">{formatCurrency(costPair)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" aria-label="Editar material" className="h-6 w-6 text-primary hover:text-primary" onClick={() => handleEdit(m)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <DeleteConfirmButton onConfirm={() => deleteMaterial.mutate(m.id)} title="Remover material?" size="h-6 w-6" iconSize="h-3 w-3" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  });
                });
                return rows;
              })()}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Edit Material Dialog */}
      {editing && (
        <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Material no BOM</DialogTitle>
              <DialogDescription className="sr-only">
                Consumo por par, cor e consumo por numeração do material.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Material / Grupo</Label>
                <div className="p-2 rounded bg-muted text-sm">
                  {editing.data.group_id
                    ? (groups.find((g: any) => g.id === editing.data.group_id)?.name || products.find(p => p.id === editing.data.product_id)?.name || '—')
                    : (products.find(p => p.id === editing.data.product_id)?.name || 'Material não encontrado')}
                  {(() => {
                    const prod = products.find(p => p.id === editing.data.product_id);
                    return prod ? <span className="text-muted-foreground ml-2 text-xs">({prod.unit || 'un'} — {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.unit_price || 0)})</span> : null;
                  })()}
                </div>
              </div>

              {/* Product selection within group */}
              {editing.data.group_id && (() => {
                const groupProds = products.filter(p => p.group_id === editing.data.group_id && p.active);
                if (groupProds.length <= 1) return null;
                return (
                  <div>
                    <Label className="text-xs font-semibold text-primary">Item Específico</Label>
                    <Select value={editing.data.product_id} onValueChange={pid => {
                      const prod = products.find(p => p.id === pid);
                      const cs = componentSheetMap[pid];
                      const newPerSize: Record<string, number> = {};
                      if (cs?.yield_per_size) {
                        Object.entries(cs.yield_per_size).forEach(([size, v]: [string, any]) => {
                          const numVal = Number(v);
                          if (Number.isFinite(numVal) && numVal > 0) newPerSize[size] = numVal;
                        });
                      }
                      const avg = recalcAvgFromPerSize(newPerSize);
                      setEditing(ed => ed ? { ...ed, data: { ...ed.data, product_id: pid, consumption_per_size: Object.keys(newPerSize).length > 0 ? newPerSize : ed.data.consumption_per_size, quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : ed.data.quantity_per_unit } } : null);
                    }}>
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {groupProds.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="flex items-center gap-2">
                              <span>{p.name}</span>
                              {p.color && <Badge variant="outline" className="text-xs">{p.color}</Badge>}
                              <span className="text-xs text-muted-foreground font-mono">{p.unit}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Fornecedor</Label>
                  <Input value={editing.data.supplier} onChange={e => setEditing(ed => ed ? { ...ed, data: { ...ed.data, supplier: e.target.value } } : null)} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Setor de consumo <span className="text-destructive">*</span></Label>
                  <Select value={editing.data.consumption_sector} onValueChange={v => setEditing(ed => ed ? { ...ed, data: { ...ed.data, consumption_sector: v } } : null)}>
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                    <SelectContent>{CONSUMPTION_SECTORS.map(sector => <SelectItem key={sector} value={sector}>{sector}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Per-size consumption grid */}
              <div>
                <Label className="text-xs font-semibold">Consumo por Numeração ({getConsumptionUnit(editing.data.product_id)}/par)</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {MATERIAL_SIZES.map(size => {
                    const sizeKey = String(size);
                    const perSize = editing.data.consumption_per_size || {};
                    return (
                      <div key={size} className="flex flex-col items-center gap-0.5">
                        <span className="text-xs font-mono text-muted-foreground">{size}</span>
                        <NumberInput
                          value={perSize[sizeKey] || 0}
                          onChange={(val) => {
                            const newPerSize = { ...perSize, [sizeKey]: val };
                            const avg = recalcAvgFromPerSize(newPerSize);
                            setEditing(ed => ed ? { ...ed, data: { ...ed.data, consumption_per_size: newPerSize, quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : ed.data.quantity_per_unit } } : null);
                          }}
                          className="w-[78px] h-7 text-xs text-center font-mono"
                          placeholder="0"
                          step="0.001"
                          unit={getConsumptionUnit(editing.data.product_id)}
                        />
                      </div>
                    );
                  })}
                  <div className="flex flex-col gap-0.5 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const perSize = editing.data.consumption_per_size || {};
                        let lastVal = 0;
                        for (let i = MATERIAL_SIZES.length - 1; i >= 0; i--) {
                          const v = Number(perSize[String(MATERIAL_SIZES[i])] || 0);
                          if (v > 0) { lastVal = v; break; }
                        }
                        if (lastVal <= 0) return;
                        const newPerSize: Record<string, number> = {};
                        MATERIAL_SIZES.forEach(s => {
                          const existing = Number(perSize[String(s)] || 0);
                          newPerSize[String(s)] = existing > 0 ? existing : lastVal;
                        });
                        const avg = recalcAvgFromPerSize(newPerSize);
                        setEditing(ed => ed ? { ...ed, data: { ...ed.data, consumption_per_size: newPerSize, quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : ed.data.quantity_per_unit } } : null);
                      }}
                    >
                      Preencher Vazios
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            
            <DialogFooter className="pt-4">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={handleUpdateSubmit} disabled={updateMaterial.isPending}>
                {updateMaterial.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

