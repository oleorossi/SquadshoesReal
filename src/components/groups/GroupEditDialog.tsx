import React, { useState, useEffect, useMemo } from 'react';
import { PencilSimple as Pencil, Palette, FloppyDisk as Save, Package, Plus, MagnifyingGlass as Search, Ruler, CircleNotch as Loader2, Flask as FlaskConical, Stack as Layers, X, LinkSimple as Link2, ArrowRight, Check, Warning as AlertTriangle, ArrowsLeftRight, Rows, Info, Factory, SquaresFour } from '@phosphor-icons/react';
import { ProductGroup, useUpdateGroup, useGroups } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import GroupColorsTab from './GroupColorsTab';
import { MaterialClassificationRail } from './MaterialClassificationRail';
import GroupCompositionTab from './GroupCompositionTab';
import { useForceDeleteProductFlow } from '@/components/inventory/ForceDeleteProductDialog';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VariantListPanel, VariantBulkEditPanel } from '@/components/inventory/VariantManagerPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CONSUMPTION_UNITS_BY_GROUP } from '@/lib/measurementUnits';
import { sectorOfGroup, sectorLabel, SECTOR_OPTIONS } from '@/lib/categoryFromGroup';
import { CurrencyInput } from '@/components/ui/currency-input';
import { NumberInput } from '@/components/ui/number-input';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { getFootwearSectorGuide, normalizeTaxonomyName } from '@/lib/footwearMaterialTaxonomy';
import { isHeterogeneousGroup } from '@/lib/materialIdentity';

/** Abas da janela de grupo. `bulk` e `items` chegaram aqui em 22/08/2026, quando
 *  o `MasterVariantDialog` deixou de ser um segundo diálogo e virou painel. */
export type GroupEditTab =
  | 'general' | 'hierarchy' | 'specs' | 'packaging' | 'composition'
  | 'colors' | 'items' | 'bulk';

interface GroupEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ProductGroup;
  /** Aba de abertura. A lista de estoque tem um botão por assunto e todos abrem
   *  ESTA janela — nunca um diálogo paralelo. */
  initialTab?: GroupEditTab;
}

// Renderização condicional por tipo de grupo: campos só aparecem quando fazem
// sentido pra categoria. Solado precisa de tipos de caixa + peso; cabedal/napa
// precisa de material artesanal; cola/ferramenta só precisa do básico;
// componente é consumo unitário — não tem rendimento por numeração nem cor.
type GroupType = 'sole' | 'upper_material' | 'insole_part' | 'chemical' | 'tool' | 'last' | 'component';

function getGroupType(sector: string): GroupType {
  switch (sector) {
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
    unitWeight:     isSole,
    // Rendimento por numeração: só pra materiais cujo CONSUMO varia com o
    // tamanho do calçado (cabedal, forração, palmilha, solado). Componente
    // NÃO entra — fivela/ilhós/ABS consomem 1 unidade por par, fim.
    dimensions:     isUpper || isInsole,
    // Embalagem: o débito de embalagem lê a caixa vinculada + pares/caixa DO
    // GRUPO DO SOLADO (product_groups.box_type_*_id). Sem esse elo o débito não
    // tem o que debitar. Aqui é somente leitura; a edição fica em /embalagens.
    packaging:      isSole,
  };
}

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

  const availableBase = useMemo(
    () => allProducts.filter(p => p.group_id !== groupId && p.active),
    [allProducts, groupId],
  );
  const available = useMemo(
    () => availableBase.filter(p => searchMatchesAllTerms(search, p.name, p.sku, p.category, p.color)),
    [availableBase, search],
  );

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
        <DialogDescription>Selecione produtos para incluir no grupo.</DialogDescription>
        </DialogHeader>

        <SearchInput
          ref={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nome, SKU, categoria ou cor…"
          resultCount={available.length}
          totalCount={availableBase.length}
        />

        <ScrollArea className="flex-1 min-h-0 max-h-[400px] -mx-6 px-6">
          {available.length === 0 ? (
            search ? (
              <EmptyState
                size="sm"
                icon={Search}
                title={`Nenhum resultado para "${search}"`}
                action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhum item disponível</p>
              </div>
            )
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
function GroupDimensionsEditor({ group }: { group: ProductGroup }) {
  const queryClient = useQueryClient();

  // Ficha de componente do grupo — dimensões do material (usadas na conversão
  // dm²→metro/placa do consumo). Editar aqui aplica a TODAS as fichas do grupo.
  // (O rendimento por numeração × solado saiu daqui — vive na gestão de Solados.)
  const { data: sheets = [], isLoading } = useQuery({
    queryKey: ['component_sheets_group', group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_sheets')
        .select('id, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit, products!inner(group_id)')
        .eq('products.group_id', group.id);
      if (error) throw error;
      return data;
    },
  });

  const [dimLength, setDimLength] = useState(Number(group.dimensions_length) || 0);
  const [dimWidth, setDimWidth] = useState(Number(group.dimensions_width) || 0);
  const [dimThickness, setDimThickness] = useState(Number(group.dimensions_thickness) || 0);
  const [dimUnit, setDimUnit] = useState(group.dimensions_unit || 'mm');
  const [saving, setSaving] = useState(false);

  // O grupo é a fonte. A ficha só recebe uma cópia sincronizada porque os
  // motores de consumo ainda leem component_sheets.dimensions_width.
  useEffect(() => {
    setDimLength(Number(group.dimensions_length) || 0);
    setDimWidth(Number(group.dimensions_width) || 0);
    setDimThickness(Number(group.dimensions_thickness) || 0);
    setDimUnit(group.dimensions_unit || 'mm');
  }, [group.id, group.dimensions_length, group.dimensions_width, group.dimensions_thickness, group.dimensions_unit]);

  const toMm = (value: number) => dimUnit === 'm' ? value * 1000 : dimUnit === 'cm' ? value * 10 : value;
  const widthMm = toMm(dimWidth);
  const lengthMm = toMm(dimLength);
  const previewLinearMeters = widthMm > 0 ? 100 / (widthMm / 10) : null;
  const plateAreaDm2 = widthMm > 0 && lengthMm > 0 ? (widthMm * lengthMm) / 10_000 : null;

  const handleSaveDimensions = async () => {
    if (widthMm <= 0) {
      toast.error('Informe a largura útil da bobina ou placa.');
      return;
    }
    setSaving(true);
    try {
      const { data: syncedSheets, error } = await (supabase as any).rpc('update_material_group_dimensions', {
        p_group_id: group.id,
        p_length: dimLength,
        p_width: dimWidth,
        p_thickness: dimThickness,
        p_unit: dimUnit,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['component_sheets_group', group.id] });
      queryClient.invalidateQueries({ queryKey: ['component_sheets'] });
      queryClient.invalidateQueries({ queryKey: ['product_groups'] });
      toast.success('Dimensões do grupo atualizadas', {
        description: Number(syncedSheets) > 0
          ? `${Number(syncedSheets)} ficha(s) de componente sincronizada(s).`
          : 'A próxima ficha criada herdará estas medidas.',
      });
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border-l-2 border-primary bg-muted/20 px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Fonte técnica</p>
          <p className="mt-1 text-sm font-semibold">Grupo de estoque</p>
          <p className="text-[11px] text-muted-foreground">Uma medida para todas as cores.</p>
        </div>
        <div className="border-l-2 border-foreground/20 bg-muted/20 px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Conversão linear</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {previewLinearMeters == null ? 'Largura pendente' : `100 dm² = ${previewLinearMeters.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`}
          </p>
          <p className="text-[11px] text-muted-foreground">Usa somente a largura útil.</p>
        </div>
        <div className="border-l-2 border-foreground/20 bg-muted/20 px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Área da placa</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {plateAreaDm2 == null ? 'Comprimento pendente' : `${plateAreaDm2.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dm²`}
          </p>
          <p className="text-[11px] text-muted-foreground">Largura × comprimento.</p>
        </div>
      </div>

      <Card className="border-foreground/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Geometria de compra e consumo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Largura útil *</Label>
              <NumberInput value={dimWidth} onChange={n => setDimWidth(n)} min={0} className="h-9 text-xs mt-1" />
              <p className="mt-1 text-[10px] text-muted-foreground">Largura da bobina; é o divisor dm² → m.</p>
            </div>
            <div>
              <Label className="text-xs">Comprimento da placa</Label>
              <NumberInput value={dimLength} onChange={n => setDimLength(n)} min={0} className="h-8 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">Espessura</Label>
              <NumberInput value={dimThickness} onChange={n => setDimThickness(n)} min={0} className="h-9 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={dimUnit} onValueChange={setDimUnit}>
                <SelectTrigger className="h-9 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">mm</SelectItem>
                  <SelectItem value="cm">cm</SelectItem>
                  <SelectItem value="m">m</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {widthMm <= 0 && (
            <div className="mt-3 flex items-start gap-2 border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
              Sem largura, o consumo em dm² não pode ser convertido para a unidade física do estoque.
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-[11px] text-muted-foreground">
              {sheets.length} ficha(s) vinculada(s) serão sincronizadas ao salvar.
            </p>
            <Button size="sm" onClick={handleSaveDimensions} disabled={saving || widthMm <= 0}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Salvar dimensões
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

/* ──────────────────────────────────────────────────
   Main Group Edit Dialog
   ────────────────────────────────────────────────── */
export default function GroupEditDialog({ open, onOpenChange, group, initialTab }: GroupEditDialogProps) {
  const updateGroup = useUpdateGroup();
  const { data: allProducts = [] } = useProducts();
  const { data: allGroups = [] } = useGroups();
  // Memoizado de propósito: os painéis de variante reidratam o formulário quando
  // a lista MUDA DE COMPOSIÇÃO. Um array novo a cada render (refetch do React
  // Query, digitação em outro campo) apagaria o que o usuário digitou.
  const products = useMemo(
    () => allProducts.filter(p => p.group_id === group.id),
    [allProducts, group.id],
  );
  /** Mais de um material no mesmo grupo (COMPONENTES DIVERSOS tem 8). */
  const grupoHeterogeneo = useMemo(() => isHeterogeneousGroup(products), [products]);

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

  // Filhos diretos desta família.
  const childrenGroups = useMemo(
    () => (childrenByParent.get(group.id) || []),
    [childrenByParent, group.id],
  );

  // Modelo Setor → Família → Grupo (specs/grupos-estoque.md):
  // tem filhos ⇒ família/container (não recebe item direto); sem filhos ⇒ grupo-folha.
  const [isFamily, setIsFamily] = useState(group.is_family === true || childrenGroups.length > 0);
  const [isFamilyPersisted, setIsFamilyPersisted] = useState(group.is_family === true || childrenGroups.length > 0);
  const isContainer = isFamily || childrenGroups.length > 0;
  const parentGroup = useMemo(
    () => (group.parent_group_id ? allGroups.find(g => g.id === group.parent_group_id) ?? null : null),
    [group.parent_group_id, allGroups],
  );
  const isCompositeMaterial = !isContainer && (
    /dublag/i.test(parentGroup?.name || '') || /dublad/i.test(group.name || '')
  );
  const productColors = useMemo(
    () => [...new Set(products
      .filter(product => product.active !== false)
      .map(product => String(product.color || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [products],
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

  // Setor explícito do grupo (editável — "mover para outro setor"). Inicia do
  // valor salvo; os campos visíveis derivam do setor ESCOLHIDO (não do nome).
  const [sector, setSector] = useState<string>(() => sectorOfGroup(group));
  const savedSector = useMemo(() => sectorOfGroup(group), [group]);
  const sectorChanged = sector !== savedSector;
  const groupType = useMemo(() => getGroupType(sector), [sector]);
  const show = useMemo(() => getVisibleFields(groupType), [groupType]);
  const showDimensionsTab = show.dimensions;
  const sectorGuide = useMemo(() => getFootwearSectorGuide(sector), [sector]);
  const isCanonicalStrapGroup = group.is_artisanal_strap === true
    || products.some((product: any) => product.is_artisanal === true)
    || /tira|elastic|tranç/i.test(group.name || '');
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [isBomColorSource, setIsBomColorSource] = useState(group.is_bom_color_source);
  const [consumptionUnit, setConsumptionUnit] = useState<string>(group.consumption_unit || '__none__');
  // "Especificações compartilhadas": todos os itens do grupo têm a MESMA unidade de
  // consumo/valor/dimensões. Persiste em product_groups.shared_specs. (O state havia sido
  // removido por engano no cleanup a089022, deixando o JSX órfão → crash "sharedSpecs is not defined".)
  const [sharedSpecs, setSharedSpecs] = useState<boolean>(group.shared_specs ?? false);
  // Material base sem cor (EVA, cola): desliga o color_mismatch no consumo/débito.
  const [isColorAgnostic, setIsColorAgnostic] = useState<boolean>(group.is_color_agnostic ?? false);
  const colorBehavior = isColorAgnostic ? 'agnostic' : isBomColorSource ? 'bom-source' : 'variant';
  const [saving, setSaving] = useState(false);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // Aba única desta janela. Cores, itens e edição em massa deixaram de morar num
  // segundo Dialog (`MasterVariantDialog`) em 22/08/2026 — são abas daqui.
  const [activeTab, setActiveTab] = useState<GroupEditTab>(initialTab ?? 'general');
  // Hierarquia (product_groups.parent_group_id) + peso unitário. State perdido no
  // merge bec3ed0 (JSX entrou sem as declarações) → crash 'parentGroupId is not
  // defined' ao abrir a edição. Restaurado 2026-06-07. [[group-edit-dropped-state]]
  const [parentGroupId, setParentGroupId] = useState<string>(group.parent_group_id || '');
  const [linkChildOpen, setLinkChildOpen] = useState(false);
  const [unitWeightKg, setUnitWeightKg] = useState<number>(group.unit_weight_kg || 0);
  const [purchaseMultiple, setPurchaseMultiple] = useState<number>((group as any).purchase_multiple || 0);

  const affectedProductsCount = useMemo(() => {
    if (!isContainer) return products.length;
    return allProducts.filter((product) => product.group_id && descendantIds.has(product.group_id)).length;
  }, [allProducts, descendantIds, isContainer, products.length]);

  const familyOptions = useMemo(
    () => groupsWithDepth.filter((candidate) => {
      if (candidate.id === group.id || descendantIds.has(candidate.id) || candidate.parent_group_id) return false;
      if (sectorOfGroup(candidate) !== sector) return false;
      const childCount = childrenByParent.get(candidate.id)?.length || 0;
      return candidate.is_family === true || childCount > 0 || candidate.id === parentGroupId;
    }),
    [childrenByParent, descendantIds, group.id, groupsWithDepth, parentGroupId, sector],
  );

  const linkableChildren = useMemo(
    () => availableToLinkAsChild.filter((candidate) => (
      !candidate.parent_group_id
      && candidate.is_family !== true
      && sectorOfGroup(candidate) === sector
      && (childrenByParent.get(candidate.id)?.length || 0) === 0
    )),
    [availableToLinkAsChild, childrenByParent, sector],
  );

  const selectedFamily = useMemo(
    () => (parentGroupId ? allGroups.find((candidate) => candidate.id === parentGroupId) ?? null : null),
    [allGroups, parentGroupId],
  );

  // ── Embalagem: o estado saiu daqui em 02/08/2026 junto com a edição.
  // A aba `packaging` agora só aponta pra Embalagens → Configuração por Solado
  // (`SolePackagingPanel`), que grava direto em `product_groups`.
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const forceDeleteFlow = useForceDeleteProductFlow();

  useEffect(() => {
    setName(group.name);
    setSector(sectorOfGroup(group));
    setDescription(group.description || '');
    setIsBomColorSource(group.is_bom_color_source);
    setIsColorAgnostic(group.is_color_agnostic ?? false);
    setConsumptionUnit(group.consumption_unit || '__none__');
    setSharedSpecs(group.shared_specs ?? false);
    setParentGroupId(group.parent_group_id || '');
    setIsFamily(group.is_family === true || childrenGroups.length > 0);
    setIsFamilyPersisted(group.is_family === true || childrenGroups.length > 0);
    setUnitWeightKg(group.unit_weight_kg || 0);
    setPurchaseMultiple((group as any).purchase_multiple || 0);
    setActiveTab(initialTab ?? 'general');
    // A hidratação pertence à abertura/troca do cadastro. Mudanças nas queries
    // de filhos ou itens não podem apagar campos ainda não salvos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, open, initialTab]);

  /** Abas que EXISTEM neste grupo. Família não tem Cores/Itens/Em massa, e
   *  Dimensões/Embalagem/Composição dependem do setor. */
  const abasVisiveis = useMemo<GroupEditTab[]>(() => {
    const out: GroupEditTab[] = ['general', 'hierarchy'];
    if (!isContainer) {
      if (showDimensionsTab) out.push('specs');
      if (show.packaging) out.push('packaging');
      if (isCompositeMaterial) out.push('composition');
      out.push('colors', 'items', 'bulk');
    }
    return out;
  }, [isContainer, showDimensionsTab, show.packaging, isCompositeMaterial]);

  useEffect(() => {
    // Aba pedida que não existe aqui deixaria a janela ABERTA E VAZIA: o Radix
    // não acha `TabsContent` com esse valor e não renderiza nada, sem erro. Pode
    // acontecer com `initialTab` vindo da lista, e também quando o usuário troca
    // o setor/estrutura na aba Geral e a aba corrente deixa de existir.
    if (!abasVisiveis.includes(activeTab)) setActiveTab('general');
  }, [abasVisiveis, activeTab]);

  useEffect(() => {
    // Receber o primeiro filho confirma o papel de família, sem reidratar o
    // restante do formulário nem expulsar o usuário da aba Hierarquia.
    if (childrenGroups.length > 0) {
      setIsFamily(true);
      setIsFamilyPersisted(true);
    }
  }, [childrenGroups.length]);

  /** Largura do grupo × largura legada dos itens (R3.4). O consumo canônico usa
   * dimensions_width da ficha; comprimento não substitui uma largura válida. */
  const larguraDivergente = useMemo(() => {
    const doGrupo = Number((group as any).dimensions_width) || 0;
    if (!doGrupo || products.length === 0) return null;
    const dosItens = [...new Set(
      products
        .map(p => Number((p as any).dimensions_width) || 0)
        .filter(w => w > 0 && w !== doGrupo),
    )];
    if (dosItens.length === 0) return null;
    return { grupo: doGrupo, itens: dosItens };
  }, [group, products]);

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
          // Setor explícito do grupo. Mudar dispara o trigger de cascata no banco
          // (tg_group_sector_cascade) que reclassifica products.category dos itens.
          sector: sector || null,
          is_bom_color_source: isColorAgnostic ? false : isBomColorSource,
          is_color_agnostic: isColorAgnostic,
          consumption_unit: finalUnit,
          shared_specs: sharedSpecs,
          parent_group_id: parentGroupId || null,
          is_family: isContainer,
          unit_weight_kg: unitWeightKg,
          purchase_multiple: purchaseMultiple > 0 ? purchaseMultiple : null,
          // ⚠ Embalagem NÃO entra mais neste payload (02/08/2026). Este diálogo
          // hidratava os slots no mount e os regravava a cada save — depois que
          // Solados virou a porta de edição, isso reescreveria com valor velho o
          // que acabou de ser configurado lá. Quem grava `box_type_*` /
          // `pairs_per_box_*` agora é só `SolePackagingPanel`.
        } as any,
      });

      // Moveu de setor: o banco já cascateou products.category — invalida os
      // caches do estoque pra os itens aparecerem na aba nova na hora.
      if (sectorChanged) {
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['paginated_products'] });
        queryClient.invalidateQueries({ queryKey: ['product_groups'] });
        toast.success(
          `${isContainer ? 'Família' : 'Grupo'} movido para "${sectorLabel(sector)}" — ${affectedProductsCount} ${affectedProductsCount === 1 ? 'item reclassificado' : 'itens reclassificados'}.`,
        );
      }

      // Propaga a unidade de consumo e outras specs para todos os itens do grupo
      const prevUnit = group.consumption_unit ?? null;
      const unitChanged = finalUnit !== prevUnit;

      if (products.length > 0) {
        const updateData: any = {};
        // sharedSpecs força a propagação da unidade de CONSUMO a todos os itens (mesmo sem
        // troca). NÃO sobrescrevemos products.unit (estoque): em material de área a unidade
        // de consumo é dm² mas a de estoque é m/placa — sobrescrever corromperia o estoque.
        if (unitChanged || sharedSpecs) updateData.consumption_unit = finalUnit;

        // Preço, localização e múltiplo de compra saíram daqui em 02/08/2026:
        // eram uma SEGUNDA porta gravando `products`, sem selo de divergência e
        // sem prévia, então achatavam valor próprio em silêncio. Porta única
        // agora é a aba "Em massa" desta mesma janela (`VariantBulkEditPanel`,
        // spec `estoque-cores-e-editores.md` R3.1).

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
          }
        }
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-6xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                  <Rows className="h-5 w-5" weight="bold" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-lg font-bold leading-tight">{group.name}</DialogTitle>
                  <DialogDescription className="sr-only">Edite setor, hierarquia, especificações e itens do grupo.</DialogDescription>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant="outline" className="h-5 gap-1 px-2 font-medium">
                      {isContainer ? `família · ${childrenGroups.length} subgrupo(s)` : 'grupo-folha'}
                    </Badge>
                    {!isContainer && (<><span>·</span><span>{products.length} {products.length === 1 ? 'item' : 'itens'}</span></>)}
                  </div>
                </div>
              </div>
              {products.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => setActiveTab('items')}
                >
                  <Palette className="h-3.5 w-3.5" />
                  Variantes de cor
                </Button>
              )}
            </div>
          </DialogHeader>

          <MaterialClassificationRail
            sector={sector}
            family={isContainer ? name : selectedFamily?.name || parentGroup?.name}
            group={isContainer ? null : name}
            compact
            className="mt-2"
          />

          {isContainer && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Esta é uma <strong className="text-foreground">família (container)</strong> — ela <strong className="text-foreground">não recebe itens diretamente</strong>. Os itens vivem nos grupos-folha dela (aba Hierarquia).</span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GroupEditTab)} className="mt-2">
            <TabsList indicator="none" className="h-auto w-full justify-start gap-1 overflow-x-auto border-y border-foreground/15 bg-muted/20 p-1">
              <TabsTrigger value="general" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <SquaresFour className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Geral</span><span className="block text-[9px] font-normal text-muted-foreground">identidade e regras</span></span>
              </TabsTrigger>
              <TabsTrigger value="hierarchy" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Factory className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Hierarquia</span><span className="block text-[9px] font-normal text-muted-foreground">setor e família</span></span>
              </TabsTrigger>
              {!isContainer && showDimensionsTab && <TabsTrigger value="specs" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Ruler className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Dimensões</span><span className="block text-[9px] font-normal text-muted-foreground">conversão física</span></span>
              </TabsTrigger>}
              {!isContainer && show.packaging && <TabsTrigger value="packaging" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Package className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Embalagem</span><span className="block text-[9px] font-normal text-muted-foreground">caixas do solado</span></span>
              </TabsTrigger>}
              {isCompositeMaterial && <TabsTrigger value="composition" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Layers className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Composição</span><span className="block text-[9px] font-normal text-muted-foreground">camadas da dublagem</span></span>
              </TabsTrigger>}
              {!isContainer && <TabsTrigger value="colors" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Palette className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Cores</span><span className="block text-[9px] font-normal text-muted-foreground">catálogo e duplicatas</span></span>
              </TabsTrigger>}
              {!isContainer && <TabsTrigger value="items" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Rows className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Itens</span><span className="block text-[9px] font-normal text-muted-foreground">{products.length} variante(s)</span></span>
              </TabsTrigger>}
              {/* Edição em massa dos campos de `products`. Era a aba "Aplicar a
                  todas as cores" de um SEGUNDO diálogo, que o botão "Editar N
                  itens" da lista de estoque abria no lugar desta janela. */}
              {!isContainer && <TabsTrigger value="bulk" className="min-w-[132px] flex-1 justify-start gap-2 rounded-sm border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <ArrowsLeftRight className="h-4 w-4 shrink-0" />
                <span><span className="block text-xs font-semibold">Em massa</span><span className="block text-[9px] font-normal text-muted-foreground">aplicar a todas as cores</span></span>
              </TabsTrigger>}
            </TabsList>

            {/* Tab: General */}
            <TabsContent value="general" className="mt-4 space-y-4">
              <Card className="border-foreground/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Rows className="h-4 w-4 text-primary" />
                    {isContainer ? 'Identidade da família' : 'Identidade do grupo / linha'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="edit-group-name">{isContainer ? 'Nome da família *' : 'Nome do grupo / linha *'}</Label>
                    <Input
                      id="edit-group-name"
                      value={name}
                      onChange={e => setName(e.target.value.toUpperCase())}
                      className="mt-1"
                      placeholder={isContainer ? 'Ex.: LAMINADOS SINTÉTICOS' : 'Ex.: NAPA SANTORINE PU 1,0 MM'}
                    />
                  </div>
                  <div className={show.unitWeight ? '' : 'sm:col-span-2'}>
                    <Label htmlFor="edit-group-desc">Descrição técnica</Label>
                    <Textarea
                      id="edit-group-desc"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="mt-1"
                      rows={3}
                      placeholder="Natureza, construção e uso deste cadastro."
                    />
                  </div>
                  {show.unitWeight && !isContainer && (
                    <div>
                      <Label htmlFor="edit-group-weight">Peso unitário (kg)</Label>
                      <NumberInput id="edit-group-weight" value={unitWeightKg} onChange={setUnitWeightKg} className="mt-1" placeholder="Ex.: 0,250" />
                      <p className="mt-1 text-xs text-muted-foreground">Peso de um par de solados usado no despacho.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {isContainer ? (
                <div className="flex items-start gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Família técnica, não item de estoque</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Use a aba Hierarquia para manter os grupos/linhas desta família. Cores, dimensões, custo e saldo pertencem aos grupos e itens abaixo dela.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Card className="border-foreground/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-sm font-bold">
                        <Palette className="h-4 w-4 text-primary" /> Como os itens variam
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div>
                        <Label className="text-xs">Regra de cor</Label>
                        <div role="radiogroup" aria-label="Regra de cor do grupo" className="mt-2 grid gap-2 sm:grid-cols-3">
                          {[
                            { value: 'variant', title: 'Varia por cor', text: 'Cada cor é um SKU com saldo e custo próprios.' },
                            { value: 'bom-source', title: 'Origina cores no BOM', text: 'Além de variar, oferece suas cores às referências.' },
                            { value: 'agnostic', title: 'Cor não se aplica', text: 'Consumo e débito resolvem apenas pelo grupo.' },
                          ].map((option) => {
                            const disabled = option.value === 'bom-source' && !show.bomColorSource;
                            const selected = colorBehavior === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={disabled}
                                onClick={() => {
                                  if (option.value === 'agnostic') { setIsColorAgnostic(true); setIsBomColorSource(false); }
                                  else if (option.value === 'bom-source') { setIsColorAgnostic(false); setIsBomColorSource(true); }
                                  else { setIsColorAgnostic(false); setIsBomColorSource(false); }
                                }}
                                className={`border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-primary bg-primary/5' : 'border-foreground/15 bg-background hover:border-foreground/40'}`}
                              >
                                <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                                  {option.title}{selected && <Check className="h-3.5 w-3.5 text-primary" weight="bold" />}
                                </span>
                                <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{option.text}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {show.sharedSpecs && (
                        <div className="border-t pt-4">
                          <Label className="text-xs">Estrutura do grupo</Label>
                          <div role="radiogroup" aria-label="Estrutura técnica do grupo" className="mt-2 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              role="radio"
                              aria-checked={sharedSpecs}
                              onClick={() => setSharedSpecs(true)}
                              className={`border px-3 py-3 text-left ${sharedSpecs ? 'border-primary bg-primary/5' : 'border-foreground/15 bg-background'}`}
                            >
                              <span className="flex items-center justify-between text-xs font-semibold">Linha com variantes {sharedSpecs && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                              <span className="mt-1 block text-[10px] text-muted-foreground">Cores compartilham composição, unidade e comportamento técnico.</span>
                            </button>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={!sharedSpecs}
                              onClick={() => setSharedSpecs(false)}
                              className={`border px-3 py-3 text-left ${!sharedSpecs ? 'border-primary bg-primary/5' : 'border-foreground/15 bg-background'}`}
                            >
                              <span className="flex items-center justify-between text-xs font-semibold">Coleção de itens { !sharedSpecs && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                              <span className="mt-1 block text-[10px] text-muted-foreground">Itens independentes; use somente como pasta organizacional.</span>
                            </button>
                          </div>

                          <div className="mt-4 max-w-md">
                            <Label className="text-xs">Unidade de consumo do grupo</Label>
                            <Select value={consumptionUnit} onValueChange={setConsumptionUnit}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Definida por item" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Definida por item</SelectItem>
                                {Object.entries(CONSUMPTION_UNITS_BY_GROUP).map(([groupName, units]) => (
                                  <React.Fragment key={groupName}>
                                    <div className="bg-muted/50 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{groupName}</div>
                                    {units.map(unit => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}
                                  </React.Fragment>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {sharedSpecs ? `Será aplicada às ${products.length} variantes ao salvar; a unidade de estoque é preservada.` : 'Deixe por item quando composição ou unidade mudarem dentro do grupo.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {show.artisanal && (
                    <div className="flex flex-col gap-3 border border-foreground/15 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <div><p className="text-sm font-medium">Tiras artesanais</p><p className="mt-1 text-xs text-muted-foreground">Receita, cor, rendimento e produto acabado têm cadastro canônico próprio.</p></div>
                      </div>
                      <Button type="button" variant="outline" onClick={() => { onOpenChange(false); navigate(`/tiras-artesanais?tab=cadastro&editor=1&mode=create&origin=grupos&baseGroupId=${encodeURIComponent(group.id)}`); }}>Abrir cadastro de tiras</Button>
                    </div>
                  )}

                  <Card className="border-foreground/20">
                    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-bold"><Package className="h-4 w-4 text-primary" /> Abastecimento compartilhado</CardTitle></CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                      <div>
                        <p className="text-xs leading-relaxed text-muted-foreground">Custo, localização, estoque mínimo e fornecedor continuam próprios de cada SKU. Use a edição em massa somente quando quiser substituir esses valores nas variantes.</p>
                        <Button type="button" variant="outline" size="sm" className="mt-3 h-9 gap-1.5" onClick={() => setActiveTab('bulk')} disabled={products.length === 0}>
                          <Palette className="h-4 w-4" /> Editar dados de {products.length} item(ns)
                        </Button>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Múltiplo de compra</Label>
                        <NumberInput value={purchaseMultiple} onChange={value => setPurchaseMultiple(value || 0)} min={0} step="1" placeholder="Ex.: 50" className="mt-1 h-9" />
                        <p className="mt-1 text-[10px] text-muted-foreground">0 = sem arredondamento de embalagem.</p>
                      </div>
                    </CardContent>
                  </Card>

                  {larguraDivergente && (
                    <div className="border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
                      <p className="font-semibold text-warning">Largura legada divergente</p>
                      <p className="mt-0.5 text-muted-foreground">O grupo registra <span className="font-mono">{larguraDivergente.grupo}</span>; itens antigos registram <span className="font-mono">{larguraDivergente.itens.join(', ')}</span>. A largura canônica é a da ficha do grupo e nunca o maior lado.</p>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Tab: Hierarquia — Setor de aplicação → Família técnica → Grupo. */}
            <TabsContent value="hierarchy" className="mt-4 space-y-4">
              <Card className="border-foreground/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2"><Factory className="h-4 w-4 text-primary" /> 1. Setor de aplicação</span>
                    <Badge variant="outline" className="font-mono text-[9px] uppercase">onde é usado</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {SECTOR_OPTIONS.map((option) => {
                      const guide = getFootwearSectorGuide(option.value);
                      const selected = sector === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setSector(option.value);
                            if (selectedFamily && sectorOfGroup(selectedFamily) !== option.value) setParentGroupId('');
                          }}
                          className={`min-h-[70px] border px-3 py-2.5 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-foreground/15 bg-background hover:border-foreground/40'}`}
                        >
                          <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                            {guide?.label || option.label}
                            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                          </span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{guide?.purpose || 'Aplicação principal deste material.'}</span>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {sectorChanged && (
                <div className="flex items-start gap-3 border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
                  <ArrowsLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-foreground">Mudança de setor: {sectorLabel(savedSector)} <ArrowRight className="inline h-3 w-3" /> {sectorLabel(sector)}</p>
                    <p className="mt-0.5 text-muted-foreground">Ao salvar, {affectedProductsCount} {affectedProductsCount === 1 ? 'item será reclassificado' : 'itens serão reclassificados'} junto com {isContainer ? 'esta família e seus grupos' : 'este grupo'}.</p>
                  </div>
                </div>
              )}

              <Card className="border-foreground/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> 2. Família técnica</span>
                    <Badge variant="outline" className="font-mono text-[9px] uppercase">o que o material é</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isContainer ? (
                    <div className="border-l-2 border-primary bg-muted/20 px-3 py-2.5">
                      <p className="text-xs font-semibold">{name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Este cadastro é a família técnica. Ela organiza grupos/linhas e não armazena itens diretamente.</p>
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="edit-group-parent">Família deste grupo</Label>
                      <Select value={parentGroupId || '__root__'} onValueChange={(value) => setParentGroupId(value === '__root__' ? '' : value)}>
                        <SelectTrigger id="edit-group-parent" className="mt-1"><SelectValue placeholder="Selecione uma família" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__root__">Sem família — grupo solto no setor</SelectItem>
                          {familyOptions.map((family) => <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground">A família classifica a natureza do material; não use cor, fornecedor ou modelo como família.</p>
                      {!parentGroupId && products.length === 0 && (
                        <button
                          type="button"
                          disabled={updateGroup.isPending || sectorChanged}
                          onClick={async () => {
                            try {
                              await updateGroup.mutateAsync({
                                id: group.id,
                                data: { is_family: true, parent_group_id: null },
                              });
                              setIsFamily(true);
                              setIsFamilyPersisted(true);
                              setParentGroupId('');
                            } catch { /* toast pelo hook */ }
                          }}
                          className="mt-3 flex w-full items-start gap-2 border border-dashed border-foreground/25 px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5"
                        >
                          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>
                            <span className="block text-xs font-semibold">Transformar este cadastro vazio em família técnica</span>
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              {sectorChanged
                                ? 'Salve primeiro a mudança de setor; depois transforme e vincule os grupos.'
                                : 'A função de família será salva antes de liberar o vínculo de grupos/linhas.'}
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {sectorGuide && (
                    <div>
                      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Vocabulário sugerido para {sectorGuide.label}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {sectorGuide.families.map((suggestion) => {
                          const existing = familyOptions.find((family) => normalizeTaxonomyName(family.name) === normalizeTaxonomyName(suggestion.name));
                          const active = existing?.id === parentGroupId || (isContainer && normalizeTaxonomyName(name) === normalizeTaxonomyName(suggestion.name));
                          return (
                            <button
                              key={suggestion.name}
                              type="button"
                              disabled={isContainer || !existing}
                              onClick={() => existing && setParentGroupId(existing.id)}
                              className={`border px-3 py-2 text-left ${active ? 'border-primary bg-primary/5' : 'border-foreground/15 bg-background'} disabled:cursor-default disabled:opacity-100`}
                            >
                              <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                                {suggestion.name}
                                {active ? <Check className="h-3.5 w-3.5 text-primary" /> : <Badge variant="outline" className="h-4 text-[8px]">{existing ? 'cadastrada' : 'sugerida'}</Badge>}
                              </span>
                              <span className="mt-1 block text-[10px] text-muted-foreground">{suggestion.examples}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {isContainer && (
                <Card className="border-foreground/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2"><Rows className="h-4 w-4 text-primary" /> 3. Grupos / linhas ({childrenGroups.length})</span>
                      <Popover open={linkChildOpen} onOpenChange={setLinkChildOpen}>
                        <PopoverTrigger asChild>
                          <Button type="button" size="sm" variant="outline" disabled={!isFamilyPersisted || sectorChanged} className="h-8 gap-1.5 text-xs"><Link2 className="h-3.5 w-3.5" /> Vincular grupo existente</Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="end">
                          <Command>
                            <CommandInput placeholder="Buscar grupo do mesmo setor..." />
                            <CommandList>
                              <CommandEmpty>Nenhum grupo solto disponível em {sectorLabel(sector)}.</CommandEmpty>
                              <CommandGroup heading={`Grupos soltos em ${sectorLabel(sector)}`}>
                                {linkableChildren.map((candidate) => (
                                  <CommandItem
                                    key={candidate.id}
                                    value={candidate.name}
                                    onSelect={async () => {
                                      try {
                                        await updateGroup.mutateAsync({ id: candidate.id, data: { parent_group_id: group.id } });
                                        setLinkChildOpen(false);
                                      } catch { /* toast pelo hook */ }
                                    }}
                                  >
                                    <Rows className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="truncate">{candidate.name}</span>
                                    <Badge variant="outline" className="ml-auto h-4 text-[8px]">{itemCountByGroup.get(candidate.id) || 0} itens</Badge>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {childrenGroups.length === 0 ? (
                      <div className="border border-dashed border-foreground/20 px-3 py-5 text-center text-xs text-muted-foreground">Família vazia. Vincule um grupo/linha do mesmo setor para começar.</div>
                    ) : (
                      <div className="divide-y divide-foreground/10 border-y border-foreground/15">
                        {childrenGroups.map((child) => (
                          <div key={child.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <Rows className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-xs font-semibold">{child.name}</span>
                              <Badge variant="secondary" className="h-4 shrink-0 font-mono text-[8px]">{itemCountByGroup.get(child.id) || 0} itens</Badge>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={async () => {
                                try { await updateGroup.mutateAsync({ id: child.id, data: { parent_group_id: null } }); }
                                catch { /* toast pelo hook */ }
                              }}
                            >
                              <X className="mr-1 h-3 w-3" /> Desvincular
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Tab: Dimensões — uma fonte no grupo, sincronizada com as fichas. */}
            {!isContainer && showDimensionsTab && (
              <TabsContent value="specs" className="mt-4">
                <GroupDimensionsEditor group={group} />
              </TabsContent>
            )}

            {/* Tab: Packaging — SAIU daqui em 02/08/2026.
                A edição virou porta única em Embalagens → Configuração por Solado, que
                grava exatamente nestas mesmas colunas de `product_groups`. Manter
                os dois editando repetiria o padrão de "dois donos do mesmo dado"
                que já custou caro em consumo de solado. Aqui fica só o ponteiro. */}
            {!isContainer && show.packaging && (
              <TabsContent value="packaging" className="space-y-4 mt-4">
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-3 text-sm text-muted-foreground">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">A embalagem deste solado é cadastrada no setor de Embalagens</p>
                    <p className="text-xs">
                      Os três modos (Tradicional, Amarrado e Colméia), com medidas, preço e estoque de cada
                      caixa, ficam em <strong>Embalagens → Configuração por Solado</strong>. É a
                      mesma configuração que o débito, os volumes da NF e o MRP leem.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => { onOpenChange(false); navigate(`/embalagens?tab=soles&soleGroupId=${group.id}`); }}
                >
                  <Package className="h-4 w-4" />
                  Abrir Embalagens
                </Button>
              </TabsContent>
            )}

            {isCompositeMaterial && (
              <TabsContent value="composition" className="space-y-4 mt-4">
                <GroupCompositionTab
                  groupId={group.id}
                  groupName={group.name}
                  groups={allGroups}
                  colors={productColors}
                />
              </TabsContent>
            )}

            {/* Tab: Cores — único lugar que vê as cores do grupo como CONJUNTO
                (duplicata, typo, largura divergente) e permite fundir. */}
            {!isContainer && <TabsContent value="colors" className="space-y-4 mt-4">
              {isColorAgnostic && (
                <div className="flex items-start justify-between gap-3 border border-foreground/20 bg-muted/20 px-3 py-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-semibold">Cor não se aplica a este grupo</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Os SKUs continuam na aba Itens, mas não são tratados como variantes de cor no consumo.</p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab('general')}>Alterar regra</Button>
                </div>
              )}
              {/* `createGroupColorProduct` recusa grupo que não é "Linha com
                  variantes" — a recusa só aparecia no submit, depois de o
                  usuário digitar a fila de cores inteira. Aqui ela aparece antes,
                  com as duas saídas: mudar a regra do grupo ou usar o cadastro
                  rápido da aba Itens, que copia o item-modelo e funciona sempre. */}
              {!isColorAgnostic && !isCanonicalStrapGroup && !sharedSpecs && !isBomColorSource && (
                <div className="flex flex-col gap-3 border border-warning/40 bg-warning/10 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" weight="fill" />
                    <div>
                      <p className="text-xs font-semibold">Cadastro em lote indisponível nesta regra</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        O grupo está como <strong>Coleção de itens</strong>, então criar cor pelo catálogo é recusado.
                        Use o cadastro rápido da aba Itens ou mude a estrutura para <strong>Linha com variantes</strong> na aba Geral.
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab('items')}>Cadastro rápido</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab('general')}>Alterar regra</Button>
                  </div>
                </div>
              )}
              {isCanonicalStrapGroup ? (
                <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">A fusão, criação e revisão de cores desta família pertencem ao catálogo canônico de Tiras.</p>
                  <Button type="button" variant="outline" onClick={() => { onOpenChange(false); navigate(`/tiras-artesanais?tab=cadastro&editor=1&mode=review&origin=grupos&baseGroupId=${encodeURIComponent(group.id)}`); }}>Revisar no Hub de Tiras</Button>
                </div>
              ) : !isColorAgnostic ? (
                <GroupColorsTab
                  groupId={group.id}
                  groupName={group.name}
                  products={products.filter(product => product.active !== false)}
                  groupWidth={(group as any).dimensions_width}
                />
              ) : null}
            </TabsContent>}

            {/* Tab: Itens — lista de variantes de cor.
                Antes era uma tabela crua (nome · SKU · cor · estoque) e a lista
                RICA vivia no `MasterVariantDialog`, um segundo diálogo. Agora é
                o mesmo painel nos dois lugares: uma janela só. */}
            {!isContainer && <TabsContent value="items" className="space-y-4 mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <Package className="h-4 w-4" />
                  Itens do Grupo ({products.length})
                </Label>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => isCanonicalStrapGroup
                  ? navigate(`/tiras-artesanais?tab=cadastro&editor=1&mode=create&origin=grupos&baseGroupId=${encodeURIComponent(group.id)}`)
                  : setAddDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  {isCanonicalStrapGroup ? 'Cadastrar no Hub' : 'Mover item existente'}
                </Button>
              </div>
              {/* Tiras acabadas têm um único writer: o catálogo canônico. */}
              {isCanonicalStrapGroup && (
                <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">Cores, produto acabado, piso e receita desta família são criados juntos no hub de Tiras.</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate(`/tiras-artesanais?tab=cadastro&editor=1&mode=create&origin=grupos&baseGroupId=${encodeURIComponent(group.id)}`); }}>
                    Abrir cadastro canônico
                  </Button>
                </div>
              )}
              {!isCanonicalStrapGroup && !isColorAgnostic && (
                <button
                  type="button"
                  onClick={() => setActiveTab('colors')}
                  className="flex w-full items-start gap-2 border border-dashed border-foreground/25 bg-muted/20 px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5"
                >
                  <Palette className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <span className="block text-xs font-semibold">Cadastrar várias cores de uma vez</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">A aba Cores busca no catálogo, compara grafias parecidas e cria em lote sem duplicar.</span>
                  </span>
                </button>
              )}
              {grupoHeterogeneo && (
                <div className="flex items-start gap-2 border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" weight="fill" />
                  <span className="text-muted-foreground">
                    Este grupo guarda <strong className="text-foreground">mais de um material</strong> — a coluna Nome distingue cada um.
                    O cadastro rápido de cor fica desligado aqui: ele copiaria os dados de um irmão qualquer.
                  </span>
                </div>
              )}
              <VariantListPanel
                groupName={group.name}
                variants={products}
                showName={grupoHeterogeneo}
                // Tira acabada nasce no Hub; grupo heterogêneo não tem irmão de
                // quem copiar unidade, conversão e custo sem inventar cadastro.
                allowAdd={!isCanonicalStrapGroup && !isColorAgnostic && !grupoHeterogeneo}
                onDeleteVariant={(id: string) => { forceDeleteFlow.tryDelete(id); }}
              />
            </TabsContent>}

            {/* Tab: Em massa — porta única dos campos que só existem em
                `products` (R2.12). Os de `product_groups` ficam nas outras abas. */}
            {!isContainer && <TabsContent value="bulk" className="space-y-4 mt-4">
              {products.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhum item neste grupo para editar em massa.</p>
              ) : (
                <VariantBulkEditPanel
                  variants={products}
                  onCancel={() => setActiveTab('items')}
                  onOpenGroupSpecs={() => setActiveTab(showDimensionsTab ? 'specs' : 'general')}
                />
              )}
            </TabsContent>}
          </Tabs>

          {/* Footer global do dialog — Salvar visível em TODAS as abas (antes
              vivia num CardFooter da aba Geral; nas outras abas não tinha como
              salvar/cancelar). */}
          <DialogFooter className="mt-4 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : sectorChanged
                  ? <ArrowsLeftRight className="h-4 w-4 mr-1.5" weight="bold" />
                  : <Save className="h-4 w-4 mr-1" />}
              {sectorChanged
                ? `Mover para ${sectorLabel(sector)} e salvar`
                : isContainer
                  ? 'Salvar família'
                  : 'Salvar grupo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddItemsToGroupDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        groupId={group.id}
        groupName={group.name}
      />

      {forceDeleteFlow.dialog}
    </>
  );
}
