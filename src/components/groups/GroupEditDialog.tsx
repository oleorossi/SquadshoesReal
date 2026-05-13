import React, { useState, useEffect, useMemo } from 'react';
import { PencilSimple as Pencil, Palette, FloppyDisk as Save, Package, Plus, MagnifyingGlass as Search, Footprints, Ruler, CircleNotch as Loader2, Cube as BoxIcon, Flask as FlaskConical } from '@phosphor-icons/react';
import { ProductGroup, useUpdateGroup } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import GroupColorsManager from '@/components/groups/GroupColorsManager';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe } from '@/hooks/useArtisanalRecipes';
import { useContractors } from '@/hooks/useContractors';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MasterVariantDialog } from '@/components/inventory/MasterVariantDialog';
import { useDeleteProduct } from '@/hooks/useProducts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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

interface GroupEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ProductGroup;
}

// Renderização condicional por tipo de grupo: campos só aparecem quando fazem
// sentido pra categoria. Solado precisa de tipos de caixa + peso; cabedal/napa
// precisa de material artesanal; cola/ferramenta só precisa do básico.
// "generic" cobre o fallback "Componente" — mostra tudo (catch-all seguro).
type GroupType = 'sole' | 'upper_material' | 'insole_part' | 'chemical' | 'tool' | 'last' | 'generic';

function getGroupType(groupName: string): GroupType {
  switch (deriveCategoryFromGroup(groupName)) {
    case 'Solado': return 'sole';
    case 'Cabedal': return 'upper_material';
    case 'Palmilha':
    case 'Forração da Palmilha': return 'insole_part';
    case 'Cola / Químico': return 'chemical';
    case 'Ferramentas': return 'tool';
    case 'Fôrma': return 'last';
    // 'Componente' (fallback do deriveCategoryFromGroup) é tratado como cabedal:
    // na prática componentes sempre são insumos de cabedal (forros, debruns,
    // entretelas, etc.) — mesma matriz de campos.
    default: return 'upper_material';
  }
}

function getVisibleFields(type: GroupType) {
  const isSole = type === 'sole';
  const isUpper = type === 'upper_material';
  const isInsole = type === 'insole_part';
  const isChemical = type === 'chemical';
  const isTool = type === 'tool';
  const isLast = type === 'last';
  const isGeneric = type === 'generic';

  return {
    bomColorSource: isSole || isUpper || isInsole || isGeneric,
    sharedSpecs:    !isChemical && !isTool,
    artisanal:      isUpper || isGeneric,
    colorsManager:  isSole || isUpper || isInsole || isGeneric,
    boxTypes:       isSole || isLast,
    unitWeight:     isSole || isGeneric,
    yieldTab:       isSole || isUpper || isInsole || isGeneric,
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
    const q = search.toLowerCase();
    return allProducts
      .filter(p => p.group_id !== groupId && p.active)
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
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
      toast.success(`${selected.size} item(ns) adicionado(s) ao grupo "${groupName}"`);
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
      toast.success(`Rendimento salvo para o solado "${selectedModel.name}" (${selectedModel.ids.length} variante(s))!`);
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
  const products = allProducts.filter(p => p.group_id === group.id);

  const groupType = useMemo(() => getGroupType(group.name), [group.name]);
  const show = useMemo(() => getVisibleFields(groupType), [groupType]);
  const showYieldTab = show.yieldTab;

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [isBomColorSource, setIsBomColorSource] = useState(group.is_bom_color_source);
  const [boxTypeId, setBoxTypeId] = useState<string>((group as any).box_type_id || '__none__');
  const [boxTypeMasterId, setBoxTypeMasterId] = useState<string>((group as any).box_type_master_id || '__none__');
  const [boxTypeColmeiaId, setBoxTypeColmeiaId] = useState<string>((group as any).box_type_colmeia_id || '__none__');
  const [consumptionUnit, setConsumptionUnit] = useState<string>(group.consumption_unit || '__none__');
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
  const queryClient = useQueryClient();
  const deleteProduct = useDeleteProduct();

  const { data: boxTypes = [] } = useQuery({
    queryKey: ['box_types_active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('box_types').select('id, nome').eq('active', true).order('nome');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: recipes = [] } = useArtisanalRecipes();
  const { data: contractors = [] } = useContractors();
  const createRecipe = useCreateArtisanalRecipe();
  const updateRecipe = useUpdateArtisanalRecipe();

  useEffect(() => {
    setName(group.name);
    setDescription(group.description || '');
    setIsBomColorSource(group.is_bom_color_source);
    setBoxTypeId((group as any).box_type_id || '__none__');
    setBoxTypeMasterId((group as any).box_type_master_id || '__none__');
    setBoxTypeColmeiaId((group as any).box_type_colmeia_id || '__none__');
    setConsumptionUnit(group.consumption_unit || '__none__');

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
          box_type_id: boxTypeId === '__none__' ? null : boxTypeId,
          box_type_master_id: boxTypeMasterId === '__none__' ? null : boxTypeMasterId,
          box_type_colmeia_id: boxTypeColmeiaId === '__none__' ? null : boxTypeColmeiaId,
          consumption_unit: finalUnit,
        } as any,
      });

      // Propaga a unidade de consumo e outras specs para todos os itens do grupo
      const prevUnit = group.consumption_unit ?? null;
      const unitChanged = finalUnit !== prevUnit;

      if (products.length > 0) {
        const updateData: any = {};
        if (unitChanged) updateData.consumption_unit = finalUnit;

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
              toast.success(`Unidade de consumo aplicada em ${products.length} item(ns).`);
            }
            if (unitPrice > 0 || location.trim()) {
              toast.success(`Dados financeiros/estoque aplicados a ${products.length} item(ns).`);
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
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                            {groupName}
                          </div>
                          {units.map(u => (
                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {sharedSpecs
                      ? 'Esta unidade será aplicada a TODOS os itens deste grupo ao salvar (inclusive estoque).'
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
                      <p className="text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1">
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
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Peso de uma unidade (par de solados, um cabedal ou uma caixa) usado para cálculo do peso total de despacho.
                  </p>
                </div>
                )}
                {show.colorsManager && (
                  <GroupColorsManager groupId={group.id} groupName={group.name} />
                )}

                {/* Box Types */}
                {show.boxTypes && (
                <Card className="border-dashed">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BoxIcon className="h-4 w-4" /> Tipos de Caixa
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Caixa Individual</Label>
                      <Select value={boxTypeId} onValueChange={setBoxTypeId}>
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue placeholder="Selecionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhuma</SelectItem>
                          {boxTypes.map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Caixa Master</Label>
                      <Select value={boxTypeMasterId} onValueChange={setBoxTypeMasterId}>
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue placeholder="Selecionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhuma</SelectItem>
                          {boxTypes.map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Caixa Colmeia</Label>
                      <Select value={boxTypeColmeiaId} onValueChange={setBoxTypeColmeiaId}>
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue placeholder="Selecionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhuma</SelectItem>
                          {boxTypes.map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
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
                    <p className="text-[10px] text-muted-foreground">
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
                    <p className="text-[10px] text-muted-foreground">
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
          onDeleteVariant={(id: string) => { deleteProduct.mutate(id); }}
        />
      )}
    </>
  );
}
