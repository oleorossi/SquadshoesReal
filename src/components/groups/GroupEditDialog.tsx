import React, { useState, useEffect, useMemo } from 'react';
import { PencilSimple as Pencil, Palette, FloppyDisk as Save, Package, Plus, MagnifyingGlass as Search, Footprints, Ruler, CircleNotch as Loader2, Cube as BoxIcon, Flask as FlaskConical, Stack as Layers, X, LinkSimple as Link2 } from '@phosphor-icons/react';
import { ProductGroup, useUpdateGroup, useGroups } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import { useForceDeleteProductFlow } from '@/components/inventory/ForceDeleteProductDialog';
import GroupColorsManager from '@/components/groups/GroupColorsManager';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe } from '@/hooks/useArtisanalRecipes';
import { useContractors } from '@/hooks/useContractors';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MasterVariantDialog } from '@/components/inventory/MasterVariantDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { getSoleModelName } from '@/lib/utils';
import { CONSUMPTION_UNITS_BY_GROUP } from '@/lib/measurementUnits';
import { deriveCategoryFromGroup } from '@/lib/categoryFromGroup';
import { CurrencyInput } from '@/components/ui/currency-input';
import { normalizeForSearch } from '@/lib/searchUtils';

interface GroupEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ProductGroup;
}

// Renderização condicional por tipo de grupo: campos só aparecem quando fazem
// sentido pra categoria. Solado precisa de tipos de caixa + peso; cabedal/napa
// precisa de material artesanal; cola/ferramenta só precisa do básico;
// componente é consumo unitário — não tem rendimento por numeração nem cor.
type GroupType = 'sole' | 'upper_material' | 'insole_part' | 'chemical' | 'tool' | 'last' | 'component';

function getGroupType(groupName: string): GroupType {
  switch (deriveCategoryFromGroup(groupName)) {
    case 'Solado': return 'sole';
    case 'Cabedal': return 'upper_material';
    case 'Palmilha':
    case 'Forração da Palmilha': return 'insole_part';
    case 'Cola / Químico': return 'chemical';
    case 'Ferramentas': return 'tool';
    case 'Fôrma': return 'last';
    // 'Componente' (fivelas, ilhós, ABS, fitas, elásticos) — consumo unitário.
    // Antes caía como 'upper_material' e ganhava aba "Rendimento por
    // Numeração" sem sentido (fivela não rende por pé 33 vs 43).
    // Corrigido em 2026-05-17.
    default: return 'component';
  }
}

function getVisibleFields(type: GroupType) {
  const isSole = type === 'sole';
  const isUpper = type === 'upper_material';
  const isInsole = type === 'insole_part';
  const isChemical = type === 'chemical';
  const isTool = type === 'tool';
  const isLast = type === 'last';
  const isComponent = type === 'component';

  return {
    bomColorSource: isSole || isUpper || isInsole,
    sharedSpecs:    !isChemical && !isTool,
    // Receitas artesanais (sub-empreitada) só fazem sentido pra cabedal
    // (corte + costura sob medida). Componente, palmilha, cola não passam
    // por empreitada artesanal típica.
    artisanal:      isUpper,
    // Componente é consumo unitário — não tem variantes de cor que importam
    // no BOM (toda fivela "X" é igual independente da cor do calçado).
    colorsManager:  isSole || isUpper || isInsole,
    unitWeight:     isSole,
    // Rendimento por numeração: só pra materiais cujo CONSUMO varia com o
    // tamanho do calçado (cabedal, forração, palmilha, solado). Componente
    // NÃO entra — fivela/ilhós/ABS consomem 1 unidade por par, fim.
    yieldTab:       isSole || isUpper || isInsole,
  };
}

const SIZES = ['15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

function AddItemsToGroupDialog({ open, onOpenChange, groupId, groupName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
}) {
  const { data: allProducts = [] } = useProducts();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const available = useMemo(() => {
    const q = normalizeForSearch(search);
    return allProducts
      .filter(p => p.group_id !== groupId && p.active)
      .filter(p => !q || normalizeForSearch(p.name).includes(q) || normalizeForSearch(p.sku).includes(q) || normalizeForSearch(p.category).includes(q));
  }, [allProducts, groupId, search]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ group_id: groupId })
        .in('id', Array.from(selected));
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${selected.size} ${selected.size === 1 ? 'item adicionado' : 'itens adicionados'} ao grupo "${groupName}"`);
      setSelected(new Set());
      toast.success("Grupo de material atualizado/adicionado");
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
            Adicionar itens ao grupo "{groupName}"
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input ref={searchRef} placeholder="Buscar item..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <ScrollArea className="flex-1 min-h-0 max-h-[400px] -mx-6 px-6">
          {available.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhum item disponível</p>
            </div>
          ) : (
            <div className="space-y-1">
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
        </ScrollArea>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">{selected.size} {selected.size === 1 ? 'selecionado' : 'selecionados'}</span>
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

/* ──────────────────────────────────────────────────
   Sole-specific Yield Editor
   ────────────────────────────────────────────────── */
function SoleYieldEditor({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const { data: allProducts = [] } = useProducts();

  // Load sole products and group by model (strip color suffix)
  const soleProducts = useMemo(() => allProducts.filter(p => p.category === 'Solado' && p.active), [allProducts]);

  // Group soles by base model name (e.g. "01 - Preto" & "01 - Caramelo" → "01")
  const soleModels = useMemo(() => {
    const modelMap = new Map<string, { name: string; ids: string[] }>();
    soleProducts.forEach(p => {
      const baseName = getSoleModelName(p.name, p.color);
      if (!modelMap.has(baseName)) {
        modelMap.set(baseName, { name: baseName, ids: [] });
      }
      modelMap.get(baseName)!.ids.push(p.id);
    });
    return Array.from(modelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [soleProducts]);

  // Load component sheets for this group
  const { data: sheets = [], isLoading } = useQuery({
    queryKey: ['component_sheets_group', groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_sheets')
        .select('id, product_id, yield_per_size, yield_per_sole, waste_pct, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit')
        .eq('group_id', groupId);
      if (error) throw error;
      return data;
    },
  });

  // Use the first sheet as the canonical one for group-level editing
  const sheet = sheets[0] as any;

  const [selectedModelName, setSelectedModelName] = useState<string>('');
  const [yieldGrid, setYieldGrid] = useState<Record<string, number>>({});
  const [wastePct, setWastePct] = useState(8);
  const [dimLength, setDimLength] = useState(0);
  const [dimWidth, setDimWidth] = useState(0);
  const [dimThickness, setDimThickness] = useState(0);
  const [dimUnit, setDimUnit] = useState('mm');
  const [saving, setSaving] = useState(false);

  const selectedModel = useMemo(() => soleModels.find(m => m.name === selectedModelName), [soleModels, selectedModelName]);

  // Current yield_per_sole map
  const yieldPerSole = useMemo(() => {
    if (!sheet?.yield_per_sole || typeof sheet.yield_per_sole !== 'object') return {} as Record<string, Record<string, number>>;
    return sheet.yield_per_sole as Record<string, Record<string, number>>;
  }, [sheet]);

  // Init dimensions from sheet
  useEffect(() => {
    if (sheet) {
      const wp = Number(sheet.waste_pct);
      setWastePct(Number.isFinite(wp) ? wp : 8);
      setDimLength(Number(sheet.dimensions_length) || 0);
      setDimWidth(Number(sheet.dimensions_width) || 0);
      setDimThickness(Number(sheet.dimensions_thickness) || 0);
      setDimUnit(sheet.dimensions_unit || 'mm');
    }
  }, [sheet]);

  // When model selection changes, load yield grid from the first product ID of that model
  useEffect(() => {
    if (selectedModel && selectedModel.ids.length > 0) {
      // Try to find existing yield data for any of the model's product IDs
      const existingId = selectedModel.ids.find(id => yieldPerSole[id] && Object.values(yieldPerSole[id]).some(v => Number(v) > 0));
      if (existingId) {
        setYieldGrid({ ...yieldPerSole[existingId] });
      } else {
        setYieldGrid({});
      }
    }
  }, [selectedModelName, yieldPerSole, selectedModel]);

  const handleYieldChange = (size: string, value: string) => {
    const num = parseFloat(value);
    setYieldGrid(prev => ({
      ...prev,
      [size]: Number.isFinite(num) ? num : 0,
    }));
  };

  // Get the grade sizes from the selected sole product — check sole_technical_specs first, then stock_grade
  const { data: soleTechSizes } = useQuery({
    queryKey: ['sole_tech_sizes', selectedModel?.ids],
    enabled: !!selectedModel && selectedModel.ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sole_technical_specs')
        .select('size')
        .in('sole_id', selectedModel!.ids);
      if (error) throw error;
      return [...new Set((data || []).map(d => String(d.size)))].sort((a, b) => Number(a) - Number(b));
    },
  });

  const soleGradeSizes = useMemo(() => {
    // 1. Check sole_technical_specs sizes
    if (soleTechSizes && soleTechSizes.length > 0) return soleTechSizes;
    // 2. Fallback to stock_grade keys on the product
    if (!selectedModel) return null;
    const modelProducts = soleProducts.filter(p => selectedModel.ids.includes(p.id));
    const gradeKeys = new Set<string>();
    modelProducts.forEach(p => {
      const grade = (p as any).stock_grade || (p as any).min_stock_grade;
      if (grade && typeof grade === 'object') {
        Object.keys(grade).forEach(k => {
          if (SIZES.includes(k)) gradeKeys.add(k);
        });
      }
    });
    return gradeKeys.size > 0 ? Array.from(gradeKeys).sort((a, b) => Number(a) - Number(b)) : null;
  }, [selectedModel, soleProducts, soleTechSizes]);

  // Sizes restricted strictly by sole grade — only show sizes the sole covers
  const activeSizes = useMemo(() => {
    if (soleGradeSizes && soleGradeSizes.length > 0) return soleGradeSizes;
    // No grade defined on sole: fallback to adult range
    return SIZES.filter(s => Number(s) >= 33 && Number(s) <= 40);
  }, [soleGradeSizes]);

  // Fill handler: copy the first non-zero value to all other sizes in the grid
  const handleFill = () => {
    const firstValue = activeSizes.map(s => yieldGrid[s]).find(v => Number(v) > 0);
    if (!firstValue) {
      toast.info('Digite um valor em pelo menos uma numeração primeiro.');
      return;
    }
    const filled: Record<string, number> = { ...yieldGrid };
    activeSizes.forEach(s => {
      if (!Number(filled[s])) filled[s] = firstValue;
    });
    setYieldGrid(filled);
    toast.success('Grade preenchida!');
  };

  const handleSaveYield = async () => {
    if (!selectedModel || !sheet) return;
    setSaving(true);
    try {
      // Save the same yield grid for ALL product IDs of this sole model
      const updated = { ...yieldPerSole };
      selectedModel.ids.forEach(id => {
        updated[id] = yieldGrid;
      });

      // Update ALL component sheets in this group
      const sheetIds = sheets.map(s => s.id);
      const { error } = await supabase
        .from('component_sheets')
        .update({
          yield_per_sole: updated,
          waste_pct: wastePct,
          dimensions_length: dimLength,
          dimensions_width: dimWidth,
          dimensions_thickness: dimThickness,
          dimensions_unit: dimUnit,
        } as any)
        .in('id', sheetIds);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['component_sheets_group', groupId] });
      queryClient.invalidateQueries({ queryKey: ['component_sheets'] });
      toast.success(`Rendimento salvo para o solado "${selectedModel.name}" (${selectedModel.ids.length} ${selectedModel.ids.length === 1 ? 'variante' : 'variantes'})!`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDimensions = async () => {
    if (!sheet) return;
    setSaving(true);
    try {
      const sheetIds = sheets.map(s => s.id);
      const { error } = await supabase
        .from('component_sheets')
        .update({
          waste_pct: wastePct,
          dimensions_length: dimLength,
          dimensions_width: dimWidth,
          dimensions_thickness: dimThickness,
          dimensions_unit: dimUnit,
        } as any)
        .in('id', sheetIds);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['component_sheets_group', groupId] });
      queryClient.invalidateQueries({ queryKey: ['component_sheets'] });
      toast.success('Dimensões atualizadas para todo o grupo!');
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Models that already have yield data
  const modelsWithData = useMemo(() => {
    return soleModels.filter(model =>
      model.ids.some(id => yieldPerSole[id] && Object.values(yieldPerSole[id]).some(v => Number(v) > 0))
    );
  }, [soleModels, yieldPerSole]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Ruler className="h-6 w-6 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhuma ficha de componente encontrada para este grupo.</p>
        <p className="text-xs mt-1">Adicione materiais ao grupo primeiro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Dimensions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Dimensões do Material
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Comprimento</Label>
              <Input type="number" value={dimLength || ''} onChange={e => setDimLength(Number(e.target.value))} className="h-8 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">Largura</Label>
              <Input type="number" value={dimWidth || ''} onChange={e => setDimWidth(Number(e.target.value))} className="h-8 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">Espessura</Label>
              <Input type="number" value={dimThickness || ''} onChange={e => setDimThickness(Number(e.target.value))} className="h-8 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={dimUnit} onValueChange={setDimUnit}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">mm</SelectItem>
                  <SelectItem value="cm">cm</SelectItem>
                  <SelectItem value="m">metro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Perda (%)</Label>
              <Input type="number" min="0" step="0.1" value={String(wastePct)} onChange={e => { const v = parseFloat(e.target.value); setWastePct(Number.isFinite(v) ? v : 0); }} className="h-8 text-xs mt-1" />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" variant="outline" onClick={handleSaveDimensions} disabled={saving}>
              <Save className="h-3.5 w-3.5 mr-1" /> Salvar Dimensões
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sole-specific yield */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Footprints className="h-4 w-4" />
            Rendimento por Numeração × Solado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Soles with data badges */}
          {modelsWithData.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {modelsWithData.map(model => (
                <Badge
                  key={model.name}
                  variant={selectedModelName === model.name ? 'default' : 'secondary'}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedModelName(model.name)}
                >
                  {model.name}
                </Badge>
              ))}
            </div>
          )}

          <div>
            <Label className="text-xs">Selecionar Solado (modelo)</Label>
            <Select value={selectedModelName} onValueChange={setSelectedModelName}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="Escolha o modelo de solado..." />
              </SelectTrigger>
              <SelectContent>
                {soleModels.map(m => (
                  <SelectItem key={m.name} value={m.name} className="text-xs">
                    {m.name} ({m.ids.length} variante{m.ids.length > 1 ? 's' : ''})
                    {modelsWithData.some(mwd => mwd.name === m.name) && ' ✓'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedModelName ? (
            <>
              <p className="text-xs text-muted-foreground">
                Consumo em dm² por par para o solado <strong>{selectedModelName}</strong>:
              </p>
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      {activeSizes.map(s => (
                        <TableHead key={s} className="text-xs text-center px-2 min-w-[60px] font-bold">{s}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      {activeSizes.map(s => (
                        <TableCell key={s} className="px-1 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={yieldGrid[s] || ''}
                            onChange={e => handleYieldChange(s, e.target.value)}
                            className="h-9 text-sm text-center w-16 px-1"
                            placeholder="0"
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={handleFill} disabled={saving || !selectedModelName}>
                  <Ruler className="h-3.5 w-3.5 mr-1" /> Preencher
                </Button>
                <Button size="sm" onClick={handleSaveYield} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Salvar Rendimento
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Selecione um solado para definir o rendimento por numeração.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────────
   Main Group Edit Dialog
   ────────────────────────────────────────────────── */
export default function GroupEditDialog({ open, onOpenChange, group }: GroupEditDialogProps) {
  const updateGroup = useUpdateGroup();
  const { data: allProducts = [] } = useProducts();
  const { data: allGroups = [] } = useGroups();
  const products = allProducts.filter(p => p.group_id === group.id);

  // ── Hierarquia de grupos (product_groups.parent_group_id) ─────────────────
  // Derivados perdidos no merge bec3ed0 (a UI de Pai/Subgrupos entrou sem eles).
  // Anti-ciclo: PAI não pode ser o próprio grupo nem um descendente; FILHO não
  // pode ser o próprio grupo nem um ancestral.
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, ProductGroup[]>();
    for (const g of allGroups) {
      const k = g.parent_group_id || null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return m;
  }, [allGroups]);

  const descendantIds = useMemo(() => {
    const out = new Set<string>();
    const stack = [group.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of childrenByParent.get(id) || []) {
        if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
      }
    }
    return out;
  }, [childrenByParent, group.id]);

  const ancestorIds = useMemo(() => {
    const byId = new Map(allGroups.map(g => [g.id, g] as const));
    const out = new Set<string>();
    let cur = byId.get(group.id)?.parent_group_id || null;
    let guard = 0;
    while (cur && !out.has(cur) && guard++ < 1000) {
      out.add(cur);
      cur = byId.get(cur)?.parent_group_id || null;
    }
    return out;
  }, [allGroups, group.id]);

  // Todos os grupos em ordem hierárquica, com profundidade (indentação dos selects).
  const groupsWithDepth = useMemo(() => {
    const out: Array<ProductGroup & { depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const g of childrenByParent.get(parentId) || []) {
        out.push({ ...g, depth });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [childrenByParent]);

  // Opções de PAI: exclui o próprio grupo e seus descendentes (evita ciclo).
  const validParentOptions = useMemo(
    () => groupsWithDepth.filter(g => g.id !== group.id && !descendantIds.has(g.id)),
    [groupsWithDepth, group.id, descendantIds],
  );

  // Filhos diretos desta família.
  const childrenGroups = useMemo(
    () => (childrenByParent.get(group.id) || []),
    [childrenByParent, group.id],
  );

  // Grupos que podem virar FILHO: nem o próprio, nem um ancestral, nem já-filho.
  const availableToLinkAsChild = useMemo(
    () => groupsWithDepth.filter(g => g.id !== group.id && !ancestorIds.has(g.id) && g.parent_group_id !== group.id),
    [groupsWithDepth, group.id, ancestorIds],
  );

  // Contagem de itens (produtos) por grupo — chip nos subgrupos.
  const itemCountByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allProducts) {
      if (p.group_id) m.set(p.group_id, (m.get(p.group_id) || 0) + 1);
    }
    return m;
  }, [allProducts]);

  const groupType = useMemo(() => getGroupType(group.name), [group.name]);
  const show = useMemo(() => getVisibleFields(groupType), [groupType]);
  const showYieldTab = show.yieldTab;

  /**
   * Detecta se o grupo é de Solado pra mostrar campos específicos
   * (Silk padrão, Tipos de Caixa). Heurística: produtos da categoria
   * Solado/Sola, ou nome do grupo contém "solado".
   */
  const isSoleGroup = useMemo(() => {
    const nameMatch = normalizeForSearch(group.name).includes('solado') ||
                      normalizeForSearch(group.name).includes('sola');
    const productMatch = products.some(p => {
      const c = (p.category || '').toLowerCase();
      return c === 'solado' || c === 'sola' || c.startsWith('solado');
    });
    return nameMatch || productMatch;
  }, [group.name, products]);

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [isBomColorSource, setIsBomColorSource] = useState(group.is_bom_color_source);
  const [consumptionUnit, setConsumptionUnit] = useState<string>(group.consumption_unit || '__none__');
  // "Especificações compartilhadas": todos os itens do grupo têm a MESMA unidade de
  // consumo/valor/dimensões. Persiste em product_groups.shared_specs. (O state havia sido
  // removido por engano no cleanup a089022, deixando o JSX órfão → crash "sharedSpecs is not defined".)
  const [sharedSpecs, setSharedSpecs] = useState<boolean>(group.shared_specs ?? false);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [location, setLocation] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState('');

  // Artisanal recipe state
  const [isArtisanal, setIsArtisanal] = useState(false);
  const [artBaseMaterial, setArtBaseMaterial] = useState('');
  const [artYieldPerMeter, setArtYieldPerMeter] = useState<number>(1);
  const [artLaborCost, setArtLaborCost] = useState<number>(0);
  const [artContractorId, setArtContractorId] = useState<string>('__none__');
  const [artNotes, setArtNotes] = useState('');
  const [existingRecipeId, setExistingRecipeId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [variantsDialogOpen, setVariantsDialogOpen] = useState(false);
  // Hierarquia (product_groups.parent_group_id) + peso unitário. State perdido no
  // merge bec3ed0 (JSX entrou sem as declarações) → crash 'parentGroupId is not
  // defined' ao abrir a edição. Restaurado 2026-06-07. [[group-edit-dropped-state]]
  const [parentGroupId, setParentGroupId] = useState<string>(group.parent_group_id || '');
  const [linkChildOpen, setLinkChildOpen] = useState(false);
  const [unitWeightKg, setUnitWeightKg] = useState<number>(group.unit_weight_kg || 0);
  const queryClient = useQueryClient();
  const forceDeleteFlow = useForceDeleteProductFlow();

  const { data: recipes = [] } = useArtisanalRecipes();
  const { data: contractors = [] } = useContractors();
  const createRecipe = useCreateArtisanalRecipe();
  const updateRecipe = useUpdateArtisanalRecipe();

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || '');
    setIsBomColorSource(group.is_bom_color_source);
    setConsumptionUnit(group.consumption_unit || '__none__');
    setSharedSpecs(group.shared_specs ?? false);
    setParentGroupId(group.parent_group_id || '');
    setUnitWeightKg(group.unit_weight_kg || 0);

    // If all products in group share the same price/location, set them as defaults
    if (products.length > 0) {
      const firstP = products[0];
      const allSamePrice = products.every(p => Number(p.unit_price) === Number(firstP.unit_price));
      const allSameLocation = products.every(p => p.location === firstP.location);
      
      if (allSamePrice) setUnitPrice(Number(firstP.unit_price) || 0);
      else setUnitPrice(0);
      
      if (allSameLocation) setLocation(firstP.location || '');
      else setLocation('');
    }
  }, [group, products.length]);

  // Load artisanal recipe for this group whenever recipes or products change
  useEffect(() => {
    const groupNameLower = group.name.toLowerCase();
    const recipe = recipes.find(r => r.artisanal_product_name.toLowerCase() === groupNameLower);
    const anyArtisanal = allProducts.filter(p => p.group_id === group.id).some(p => (p as any).is_artisanal);
    if (recipe) {
      setIsArtisanal(true);
      setExistingRecipeId(recipe.id);
      setArtBaseMaterial(recipe.base_product_name);
      setArtYieldPerMeter(Number(recipe.yield_per_meter) || 1);
      setArtLaborCost(Number(recipe.labor_cost_per_meter) || 0);
      setArtContractorId(recipe.default_contractor_id || '__none__');
      setArtNotes(recipe.notes || '');
    } else {
      setIsArtisanal(anyArtisanal);
      setExistingRecipeId(null);
      setArtBaseMaterial('');
      setArtYieldPerMeter(1);
      setArtLaborCost(0);
      setArtContractorId('__none__');
      setArtNotes('');
    }
  }, [group.id, group.name, recipes, allProducts]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Nome do grupo é obrigatório');
      return;
    }

    setSaving(true);
    const finalUnit = consumptionUnit === '__none__' ? null : consumptionUnit;
    
    try {
      await updateGroup.mutateAsync({
        id: group.id,
        data: {
          name,
          description,
          is_bom_color_source: isBomColorSource,
          consumption_unit: finalUnit,
          shared_specs: sharedSpecs,
          parent_group_id: parentGroupId || null,
          unit_weight_kg: unitWeightKg,
        } as any,
      });

      // Propaga a unidade de consumo e outras specs para todos os itens do grupo
      const prevUnit = group.consumption_unit ?? null;
      const unitChanged = finalUnit !== prevUnit;

      if (products.length > 0) {
        const updateData: any = {};
        // sharedSpecs força a propagação da unidade de CONSUMO a todos os itens (mesmo sem
        // troca). NÃO sobrescrevemos products.unit (estoque): em material de área a unidade
        // de consumo é dm² mas a de estoque é m/placa — sobrescrever corromperia o estoque.
        if (unitChanged || sharedSpecs) updateData.consumption_unit = finalUnit;

        // Mass update price and location if provided
        if (unitPrice > 0) updateData.unit_price = unitPrice;
        if (location.trim()) updateData.location = location.trim();

        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase
            .from('products')
            .update(updateData)
            .eq('group_id', group.id);

          if (error) {
            toast.error(`Erro ao atualizar itens do grupo: ${error.message}`);
          } else {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['paginated_products'] });
            if (unitChanged) {
              toast.success(`Unidade de consumo aplicada em ${products.length} ${products.length === 1 ? 'item' : 'itens'}.`);
            }
            if (unitPrice > 0 || location.trim()) {
              toast.success(`Dados financeiros/estoque aplicados a ${products.length} ${products.length === 1 ? 'item' : 'itens'}.`);
            }
          }
        }
      }

      // Propagate artisanal flag
      if (products.length > 0) {
        await supabase
          .from('products')
          .update({ is_artisanal: isArtisanal } as any)
          .eq('group_id', group.id);
      }

      if (isArtisanal && artBaseMaterial) {
        const recipePayload = {
          name: `Receita: ${name}`,
          artisanal_product_name: name,
          base_product_name: artBaseMaterial,
          yield_per_meter: artYieldPerMeter,
          labor_cost_per_meter: artLaborCost,
          default_contractor_id: artContractorId === '__none__' ? null : artContractorId,
          notes: artNotes || null,
          active: true,
        };
        if (existingRecipeId) {
          await updateRecipe.mutateAsync({ id: existingRecipeId, ...recipePayload });
        } else {
          const created = await createRecipe.mutateAsync(recipePayload);
          setExistingRecipeId((created as any).id || null);
        }
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProductName = async (productId: string) => {
    const { error } = await supabase.from('products').update({ name: editProductName }).eq('id', productId);
    if (error) {
      toast.error('Erro ao renomear produto');
    } else {
      toast.success('Produto renomeado!');
    }
    setEditingProductId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-5xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Editar grupo de material</span>
              {products.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 mr-6"
                  onClick={() => setVariantsDialogOpen(true)}
                >
                  <Palette className="h-3.5 w-3.5" />
                  Gerenciar variantes de cor
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue={showYieldTab ? "specs" : "general"} className="mt-2">
            <TabsList className="grid w-full" style={{ gridTemplateColumns: showYieldTab ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}>
              <TabsTrigger value="general">Geral</TabsTrigger>
              {showYieldTab && <TabsTrigger value="specs">Rendimento / Solado</TabsTrigger>}
              <TabsTrigger value="items">Itens ({products.length})</TabsTrigger>
            </TabsList>

            {/* Tab: General */}
            <TabsContent value="general" className="space-y-4 mt-4">
              {show.bomColorSource && (
                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Palette className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Fonte de cores para BOM</p>
                      <p className="text-xs text-muted-foreground">
                        Habilite para que as cores deste grupo apareçam como opções nas variantes de cor
                      </p>
                    </div>
                  </div>
                  <Switch checked={isBomColorSource} onCheckedChange={setIsBomColorSource} />
                </div>
              )}

              {/* Especificações Compartilhadas */}
              {show.sharedSpecs && (
              <div className="rounded-lg border-2 border-primary/20 p-4 bg-primary/5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Layers className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Itens com mesmas especificações técnicas</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando ativado, todos os itens do grupo compartilham a mesma unidade de consumo, valor e dimensões — útil para grupos como <strong>"Napa Soft"</strong> em que todas as cores têm o mesmo comportamento técnico.
                        <br />
                        Mantenha desativado quando o grupo contém variantes diferentes (ex.: <strong>"Cola"</strong>, em que cada cola tem composição, valor e consumo próprios).
                      </p>
                    </div>
                  </div>
                  <Switch checked={sharedSpecs} onCheckedChange={setSharedSpecs} />
                </div>

                <div>
                  <Label className="text-xs">Unidade de Medida de Consumo</Label>
                  <Select value={consumptionUnit} onValueChange={setConsumptionUnit}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Selecionar unidade..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma (definida por item)</SelectItem>
                      {Object.entries(CONSUMPTION_UNITS_BY_GROUP).map(([groupName, units]) => (
                        <React.Fragment key={groupName}>
                          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                            {groupName}
                          </div>
                          {units.map(u => (
                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sharedSpecs
                      ? 'Esta unidade de consumo será aplicada a TODOS os itens deste grupo ao salvar. A unidade de estoque de cada item é preservada.'
                      : 'Ao alterar esta unidade, ela será aplicada a todos os itens do grupo para padronização.'}
                  </p>
                </div>
              </div>
              )}

              {/* Artesanal */}
              {show.artisanal && (
              <div className="rounded-lg border-2 border-amber-200 p-4 bg-amber-50/50 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <FlaskConical className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Material Artesanal</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando ativado, todos os itens deste grupo são marcados como artesanais e uma receita de conversão é criada automaticamente.
                      </p>
                    </div>
                  </div>
                  <Switch checked={isArtisanal} onCheckedChange={setIsArtisanal} />
                </div>

                {isArtisanal && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <Label className="text-xs">Material Base (Matéria-Prima)</Label>
                      <Input
                        list="art-base-material-list"
                        value={artBaseMaterial}
                        onChange={e => setArtBaseMaterial(e.target.value)}
                        placeholder="Ex: Napa Crua, Lona Base..."
                        className="mt-1 h-9"
                      />
                      <datalist id="art-base-material-list">
                        {allProducts.filter(p => p.active && !p.group_id).map(p => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Rendimento (m² saída / m base)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={artYieldPerMeter || ''}
                          onChange={e => setArtYieldPerMeter(parseFloat(e.target.value) || 1)}
                          className="mt-1 h-9"
                          placeholder="Ex: 0.85"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Custo MO (R$/m)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={artLaborCost || ''}
                          onChange={e => setArtLaborCost(parseFloat(e.target.value) || 0)}
                          className="mt-1 h-9"
                          placeholder="Ex: 2.50"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Terceirizado Padrão</Label>
                      <Select value={artContractorId} onValueChange={setArtContractorId}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue placeholder="Nenhum (opcional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhum</SelectItem>
                          {contractors.filter(c => c.active).map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {artYieldPerMeter > 0 && (
                      <p className="text-xs text-amber-700 bg-amber-100 rounded px-2 py-1">
                        Cada 1 m de base gera {artYieldPerMeter.toFixed(2)} m² de produto acabado
                        {artLaborCost > 0 ? ` · MO: R$ ${artLaborCost.toFixed(2)}/m` : ''}
                      </p>
                    )}
                    <div>
                      <Label className="text-xs">Observações</Label>
                      <Textarea
                        value={artNotes}
                        onChange={e => setArtNotes(e.target.value)}
                        className="mt-1"
                        rows={2}
                        placeholder="Observações sobre o processo artesanal..."
                      />
                    </div>
                  </div>
                )}
              </div>
              )}

              <div className="space-y-3">
                <div>
                  <Label htmlFor="edit-group-name">Nome do grupo de material *</Label>
                  <Input id="edit-group-name" value={name} onChange={e => setName(e.target.value)} className="mt-1" placeholder="Ex: Solados, Santorine, Colas" />
                </div>
                <div>
                  <Label htmlFor="edit-group-parent" className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" /> Grupo Pai (hierarquia)
                  </Label>
                  <Select
                    value={parentGroupId || '__root__'}
                    onValueChange={(v) => setParentGroupId(v === '__root__' ? '' : v)}
                  >
                    <SelectTrigger id="edit-group-parent" className="mt-1">
                      <SelectValue placeholder="Sem pai (grupo raiz)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__root__">Sem pai (grupo raiz)</SelectItem>
                      {validParentOptions.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {`${'  '.repeat(g.depth)}${g.depth > 0 ? '└ ' : ''}${g.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use pra agrupar variações (ex.: "Componentes" → "Tira chata", "Tira Strass").
                    Próprio grupo e descendentes ficam ocultos pra evitar ciclos.
                  </p>
                </div>

                {/* Subgrupos — filhos diretos desta família */}
                <div className="rounded-lg border p-3 bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        Subgrupos da família ({childrenGroups.length})
                      </span>
                    </div>
                    <Popover open={linkChildOpen} onOpenChange={setLinkChildOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                          <Link2 className="h-3 w-3" /> Vincular grupo
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="end">
                        <Command>
                          <CommandInput placeholder="Buscar grupo..." />
                          <CommandList>
                            <CommandEmpty>Nenhum grupo disponível</CommandEmpty>
                            <CommandGroup heading="Tornar filho deste grupo">
                              {availableToLinkAsChild.map(g => (
                                <CommandItem
                                  key={g.id}
                                  value={g.name}
                                  onSelect={async () => {
                                    try {
                                      await updateGroup.mutateAsync({
                                        id: g.id,
                                        data: { parent_group_id: group.id },
                                      });
                                      setLinkChildOpen(false);
                                    } catch {
                                      // toast tratado pelo hook
                                    }
                                  }}
                                  className="text-sm"
                                >
                                  <span className="text-muted-foreground mr-1.5">
                                    {'  '.repeat(g.depth)}{g.depth > 0 ? '└ ' : ''}
                                  </span>
                                  <span className="truncate">{g.name}</span>
                                  {g.parent_group_id && (
                                    <Badge variant="outline" className="ml-auto text-xs h-4">
                                      tem pai
                                    </Badge>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {childrenGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      Sem subgrupos. Vincule outros grupos como filhos desta família — ex.: "Forração" como pai de "Napa Sud Dani", "Napa Santorini", "Napa Soft", "Nobuck".
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {childrenGroups.map(c => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded border bg-card px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground text-xs font-mono shrink-0">└</span>
                            <span className="text-sm font-medium truncate">{c.name}</span>
                            <Badge variant="secondary" className="text-xs h-4 font-mono shrink-0">
                              {itemCountByGroup.get(c.id) ?? 0} itens
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={async () => {
                              try {
                                await updateGroup.mutateAsync({
                                  id: c.id,
                                  data: { parent_group_id: null },
                                });
                              } catch {
                                // toast tratado pelo hook
                              }
                            }}
                            title="Desvincular (remove o pai, mas mantém o grupo)"
                          >
                            <X className="h-3 w-3 mr-0.5" /> Desvincular
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="edit-group-desc">Descrição</Label>
                  <Textarea id="edit-group-desc" value={description} onChange={e => setDescription(e.target.value)} className="mt-1" rows={2} />
                </div>
                {show.unitWeight && (
                <div>
                  <Label htmlFor="edit-group-weight">Peso Unitário (kg)</Label>
                  <Input
                    id="edit-group-weight"
                    type="number"
                    step="0.001"
                    value={unitWeightKg || ''}
                    onChange={e => setUnitWeightKg(parseFloat(e.target.value) || 0)}
                    className="mt-1"
                    placeholder="Ex: 0.250"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Peso de uma unidade (par de solados, um cabedal ou uma caixa) usado para cálculo do peso total de despacho.
                  </p>
                </div>
                )}
                {show.colorsManager && (
                  <GroupColorsManager groupId={group.id} groupName={group.name} />
                )}

              </div>

              <Card className="border-2 border-primary/10">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    Configurações de Itens (Em Massa)
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Preço Unitário (R$)</Label>
                    <CurrencyInput
                      value={unitPrice}
                      onChange={v => setUnitPrice(v || 0)}
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground">
                      Se preenchido, aplicará este preço a TODOS os itens do grupo.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Localização Física</Label>
                    <Input
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      placeholder="Ex: Prateleira A1"
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground">
                      Se preenchido, aplicará esta localização a TODOS os itens.
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-3 pt-4 border-t bg-muted/5">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-1" />}
                    Salvar Grupo e Itens
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* Tab: Specs / Yield per Sole */}
            {showYieldTab && (
              <TabsContent value="specs" className="mt-4">
                <SoleYieldEditor groupId={group.id} />
              </TabsContent>
            )}

            {/* Tab: Items */}
            <TabsContent value="items" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <Package className="h-4 w-4" />
                  Itens do Grupo ({products.length})
                </Label>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar
                </Button>
              </div>
              {products.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhum item neste grupo.</p>
              ) : (
                <div className="rounded-md border overflow-x-auto max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="text-xs">Nome</TableHead>
                        <TableHead className="text-xs">SKU</TableHead>
                        <TableHead className="text-xs">Cor</TableHead>
                        <TableHead className="text-xs text-right">Estoque</TableHead>
                        <TableHead className="text-xs text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs font-medium">
                            {editingProductId === p.id ? (
                              <div className="flex gap-1">
                                <Input
                                  value={editProductName}
                                  onChange={e => setEditProductName(e.target.value)}
                                  className="h-6 text-xs"
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveProductName(p.id); if (e.key === 'Escape') setEditingProductId(null); }}
                                  autoFocus
                                />
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleSaveProductName(p.id)}>
                                  <Save className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              p.name
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{p.sku}</TableCell>
                          <TableCell className="text-xs">{p.color || '—'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{p.quantity} {p.unit}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  setEditingProductId(p.id);
                                  setEditProductName(p.name);
                                }}
                                title="Renomear"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-primary"
                                onClick={() => window.open(`/estoque/${p.id}`, '_blank')}
                                title="Editar Material Completo"
                              >
                                <Package className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AddItemsToGroupDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        groupId={group.id}
        groupName={group.name}
      />

      {/* Gerenciador de variantes de cor — pra incluir/excluir/editar variantes
          do grupo direto daqui, sem precisar ir até a tabela do estoque. */}
      {variantsDialogOpen && (
        <MasterVariantDialog
          open={variantsDialogOpen}
          onOpenChange={setVariantsDialogOpen}
          baseName={group.name}
          variants={products}
          onEditVariant={() => { /* no-op: o usuário já está no GroupEditDialog */ }}
          onDeleteVariant={(id: string) => { forceDeleteFlow.tryDelete(id); }}
        />
      )}
      {forceDeleteFlow.dialog}
    </>
  );
}
