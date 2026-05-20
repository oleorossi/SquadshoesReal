// AppLayout import removed since it was unused
import { useState, useMemo, useEffect } from 'react';
import { Stack as Layers, Plus, Trash as Trash2, CircleNotch as Loader2, FloppyDisk as Save, PencilSimple as Pencil, MagnifyingGlass as Search, Ruler, Percent, Package, ChartBar as BarChart3, CaretRight as ChevronRight, X, Image as ImageIcon, Folder as FolderEdit, Palette, Footprints, Check } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useComponentSheets, useAddComponentSheet, useUpdateComponentSheet, useDeleteComponentSheet,
  useBulkUpdateComponentSheets, useSoleGroups, usePropagateSoleToTechnicalSheets,
  ComponentSheetFormData,
} from '@/hooks/useComponentSheets';
import { useProducts } from '@/hooks/useProducts';
import { useUpdateGroup } from '@/hooks/useGroups';
import { supabase } from '@/integrations/supabase/client';
import { cn, getSoleModelName } from "@/lib/utils";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SoleTechnicalDetails } from "@/components/technical-sheets/SoleTechnicalDetails";
import { SolesComponentSheetTab } from "@/components/technical-sheets/SolesComponentSheetTab";
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { normalizeForSearch } from '@/lib/searchUtils';

const SIZES_INFANTIL = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
const SIZES_ADULTO = [34, 35, 36, 37, 38, 39, 40];
const DIM_UNITS = ['mm', 'cm', 'm', 'm linear', 'dm²', 'cm²', 'm²'];

const SIZE_GRADE_CATEGORIES = [
  { aliases: ['solado', 'sola'], label: 'Solado' },
  { aliases: ['palmilha', 'placa de palmilha', 'placa'], label: 'Palmilha' },
  { aliases: ['forro', 'forração', 'forracao'], label: 'Forro' },
  { aliases: ['cabedal', 'napa', 'couro', 'napa soft', 'camurça'], label: 'Cabedal' },
];

const CONSUMPTION_CATEGORIES = [
  { aliases: ['cola', 'adesivo', 'hotmel', 'primer'], label: 'Cola/Adesivo', unit: 'kg' },
];

const UNIT_CATEGORIES = [
  { aliases: ['componente', 'componentes', 'acessório', 'acessorio', 'embalagem', 'ferramentas'], label: 'Unidade', unit: 'un' },
];

function isUnitCategory(category?: string): boolean {
  if (!category) return false;
  const lower = category.toLowerCase().trim();
  return UNIT_CATEGORIES.some(c => c.aliases.some(a => lower.includes(a) || a.includes(lower)));
}

function matchesSizeGradeCategory(category?: string, name?: string, sku?: string): boolean {
  if (!category) return false;
  const lower = category.toLowerCase().trim();
  const lowerName = (name || '').toLowerCase();
  const lowerSku = (sku || '').toLowerCase();
  
  // Especial handling for EVA01 as requested
  if (lowerSku === 'eva01' || lowerName.includes('eva01')) return true;
  
  return SIZE_GRADE_CATEGORIES.some(c => c.aliases.some(a => lower.includes(a) || a.includes(lower)));
}

function getSizesForProduct(product?: { category?: string; name?: string; sku?: string }, shoeType?: string): number[] {
  if (matchesSizeGradeCategory(product?.category, product?.name, product?.sku)) {
    return shoeType === 'Infantil' ? SIZES_INFANTIL : SIZES_ADULTO;
  }
  return [];
}

function needsShoeType(product?: { category?: string; name?: string; sku?: string }): boolean {
  return matchesSizeGradeCategory(product?.category, product?.name, product?.sku);
}

function needsDimensions(product?: { category?: string; name?: string; sku?: string }): boolean {
  return matchesSizeGradeCategory(product?.category, product?.name, product?.sku);
}

function isConsumptionCategory(category?: string): boolean {
  if (!category) return false;
  const lower = category.toLowerCase().trim();
  return CONSUMPTION_CATEGORIES.some(c => c.aliases.some(a => lower.includes(a) || a.includes(lower)));
}

function isLiningOrInsoleCategory(product?: { category?: string; name?: string; sku?: string }): boolean {
  if (!product?.category) return false;
  const lower = product.category.toLowerCase().trim();
  const lowerName = (product.name || '').toLowerCase();
  const lowerSku = (product.sku || '').toLowerCase();
  
  const isEva01 = lowerSku === 'eva01' || lowerName.includes('eva01');
  
  return isEva01 || lower.includes('forração') || lower.includes('palmilha') || lower.includes('forro');
}

function getConsumptionUnit(category?: string): string {
  if (!category) return 'kg';
  const lower = category.toLowerCase().trim();
  const found = CONSUMPTION_CATEGORIES.find(c => c.aliases.some(a => lower.includes(a) || a.includes(lower)));
  return found?.unit || 'kg';
}

/** Convert plate dimensions to dm² based on the unit of the dimensions */
function calcAreaDm2(length: number, width: number, unit: string): number {
  const raw = length * width;
  switch (unit) {
    case 'mm': return raw / 10000;
    case 'cm': return raw / 100;
    case 'm': case 'm linear': return raw * 100;
    case 'dm²': return raw; // already in dm²
    case 'cm²': return raw / 100;
    case 'm²': return raw * 100;
    default: return raw / 10000; // fallback mm
  }
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

 export default function ComponentSheets({ 
   embedded, 
   filterProductIds, 
   hideSoles = false 
 }: { 
   embedded?: boolean; 
   filterProductIds?: string[];
   hideSoles?: boolean;
 } = {}) {
  const { data: sheets = [], isLoading } = useComponentSheets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groupEditOpen, setGroupEditOpen] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState<any[] | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<any>(null);
  const [selectedGroup, setSelectedGroup] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
   const [activeTopTab, setActiveTopTab] = useState<'general' | 'soles'>(hideSoles ? 'general' : 'general');
  const deleteSheet = useDeleteComponentSheet();

  // Sync selectedSheet with latest data from server after save/refetch
  useEffect(() => {
    if (selectedSheet && sheets.length > 0) {
      const updated = sheets.find((s: any) => s.id === selectedSheet.id);
      if (updated && updated.updated_at !== selectedSheet.updated_at) {
        setSelectedSheet(updated);

        const updatedGroupId = updated.group_id || updated.products?.group_id;
        const updatedGroup = sheets.filter((s: any) => {
          const sGroupId = s.group_id || s.products?.group_id;
          if (updatedGroupId) return sGroupId === updatedGroupId;
          return s.id === updated.id;
        });

        setSelectedGroup(updatedGroup.length > 0 ? updatedGroup : [updated]);
      }
    }
  }, [sheets, selectedSheet]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(sheets.map((s: any) => s.products?.category).filter(Boolean));
    return Array.from(cats).sort() as string[];
  }, [sheets]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    let items = sheets as any[];
    
    if (filterProductIds && filterProductIds.length > 0) {
      items = items.filter((s: any) => filterProductIds.includes(s.product_id));
    }

    if (search) {
      items = items.filter((s: any) =>
        s.products?normalizeForSearch(.name).includes(q) ||
        s.products?normalizeForSearch(.sku).includes(q) ||
        s.products?normalizeForSearch(.category).includes(q) ||
        s.product_groups?normalizeForSearch(.name).includes(q)
      );
    }

    if (categoryFilter !== 'all') {
      items = items.filter((s: any) => s.products?.category === categoryFilter);
    }

    // Group color variants ONLY when they share an explicit group_id.
    // Items without group_id are treated as individual/unique items.
    // When group_id exists, group ALL items under it regardless of name differences.
    const groupMap = new Map<string, any[]>();
    items.forEach((s: any) => {
      const groupId = s.group_id || s.products?.group_id;
      if (groupId) {
        const key = `grp_${groupId}`;
        const arr = groupMap.get(key) || [];
        arr.push(s);
        groupMap.set(key, arr);
      } else {
        // No group_id → treat as individual item (use unique sheet id)
        groupMap.set(`solo_${s.id}`, [s]);
      }
    });
    return Array.from(groupMap.values());
  }, [sheets, search, categoryFilter]);

  // Stats
  const totalSheets = sheets.length;
  const totalGroups = filtered.length;
  const avgWaste = sheets.length > 0
    ? (sheets.reduce((s: number, sh: any) => s + (sh.waste_pct || 0), 0) / sheets.length).toFixed(1)
    : '0';

  // Removed inline Wrapper component that was causing focus loss on every re-render

  if (isLoading) {
    return <><div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></>;
  }

  return (
    <>
      <div className="space-y-5 page-enter">
        {/* Header */}
        {!embedded && (
          <EditorialPageHeader
            sectionLabel="ENGENHARIA · COMPONENTES"
            title="Fichas de Componentes"
            description="Consumo por par, dimensões e perdas de cada material"
            actions={
              <>
                <Button variant="outline" onClick={() => setGroupEditOpen(true)} className="gap-2 shadow-sm">
                  <FolderEdit className="h-4 w-4" />
                  Edita Grupo
                </Button>
                <Button onClick={() => setDialogOpen(true)} className="gap-2 shadow-sm">
                  <Plus className="h-4 w-4" />
                  Nova Ficha
                </Button>
              </>
            }
          />
        )}

         <Tabs 
           value={hideSoles ? 'general' : activeTopTab} 
           onValueChange={(v) => setActiveTopTab(v as 'general' | 'soles')} 
           className="w-full"
         >
           {!hideSoles && (
             <TabsList className="grid w-full max-w-md grid-cols-2">
               <TabsTrigger value="general" className="gap-2">
                 <Layers className="h-4 w-4" />
                 Geral
               </TabsTrigger>
               <TabsTrigger value="soles" className="gap-2">
                 <Footprints className="h-4 w-4" />
                 Solados
               </TabsTrigger>
             </TabsList>
           )}
 
           {!hideSoles && (
             <TabsContent value="soles" className="mt-4">
               <SolesComponentSheetTab />
             </TabsContent>
           )}

          <TabsContent value="general" className="mt-4 space-y-6">

        {!embedded && (
          <StatGrid>
            <StatCard icon={Package} label="Fichas Cadastradas" value={totalSheets} />
            <StatCard icon={Layers} label="Grupos de Materiais" value={totalGroups} />
            <StatCard icon={Percent} label="Perda Média" value={avgWaste} unit="%" tone="destructive" />
          </StatGrid>
        )}

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, SKU ou categoria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Component List */}
        {filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-0">
              <EmptyState
                icon={Layers}
                title="Nenhuma ficha encontrada"
                description="Cadastre o consumo por par de cada material para cálculo automático de custos."
                action={
                  <Button onClick={() => setDialogOpen(true)} variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" /> Criar primeira ficha
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((group: any[]) => {
              const sheet = group[0];
              const prod = sheet.products;
              const groupInfo = sheet.product_groups;
              const yieldEntries = Object.entries(sheet.yield_per_size || {});
              const totalYield = yieldEntries.reduce((sum: number, [, v]: any) => sum + Number(v), 0);
              const avgYield = yieldEntries.length > 0 ? totalYield / yieldEntries.length : 0;
              const colors = groupInfo?.colors
                ? groupInfo.colors.split(',').map((c: string) => c.trim()).filter(Boolean)
                : [...new Set(group.map((s: any) => s.products?.color).filter(Boolean))];
              const baseName = groupInfo?.name || (() => {
                let name = prod?.name || '—';
                const color = prod?.color;
                if (color && color.trim()) {
                  const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  name = name
                    .replace(new RegExp(`:\\s*${escaped}\\s*$`, 'i'), '')
                    .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
                    .trim();
                }
                return name;
              })();
              const groupKey = (sheet.group_id || prod?.group_id) ? `grp_${sheet.group_id || prod?.group_id}` : baseName.toUpperCase();

              return (
                <Card
                  key={groupKey}
                  className="group hover:shadow-md transition-all duration-200 cursor-pointer border-border/60 overflow-hidden"
                  onClick={() => { setSelectedSheet(sheet); setSelectedGroup(group); }}
                >
                  <CardContent className="p-0">
                    {/* Card Header with image */}
                    <div className="flex gap-3 p-4 pb-3">
                      <div className="h-14 w-14 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
                        {prod?.image_url ? (
                          <img src={prod.image_url} alt={baseName} className="h-full w-full object-cover rounded-xl" />
                        ) : (
                          <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm text-foreground truncate">{baseName}</h3>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{prod?.category}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{prod?.sku}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {colors.length > 0 && (
                            <Badge variant="outline" className="text-[10px] gap-1 h-5 px-1.5 bg-muted/40">
                              <Palette className="h-2.5 w-2.5" />
                              {colors.length} {colors.length === 1 ? 'variante' : 'variantes'}
                            </Badge>
                          )}
                          {sheet.default_sole_group?.name && (
                            <Badge variant="outline" className="text-[10px] gap-1 h-5 px-1.5 bg-primary/5 text-primary border-primary/30">
                              <Footprints className="h-2.5 w-2.5" />
                              Solado: {sheet.default_sole_group.name}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metrics Row */}
                    <div className="grid grid-cols-3 border-t border-border/40 divide-x divide-border/40">
                      <div className="px-3 py-2.5 text-center">
                        <p className="text-xs text-muted-foreground">Dimensões</p>
                        <p className="text-xs font-mono font-medium text-foreground mt-0.5">
                          {sheet.dimensions_length > 0
                            ? `${sheet.dimensions_length}×${sheet.dimensions_width}`
                            : '—'}
                        </p>
                      </div>
                      <div className="px-3 py-2.5 text-center">
                        <p className="text-xs text-muted-foreground">Perda</p>
                        <p className="text-xs font-mono font-medium text-foreground mt-0.5">{sheet.waste_pct}%</p>
                      </div>
                      <div className="px-3 py-2.5 text-center">
                        <p className="text-xs text-muted-foreground">Consumo/par</p>
                        <p className="text-xs font-mono font-medium text-foreground mt-0.5">
                          {avgYield > 0 ? `~${avgYield.toFixed(1)}` : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Price footer */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border/40">
                      <span className="text-xs text-muted-foreground">
                        {formatCurrency(prod?.unit_price || 0)}/{prod?.unit}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Nova Ficha de Componente
            </DialogTitle>
          </DialogHeader>
          <CreateComponentForm onCreated={(id) => {
            setDialogOpen(false);
            // Find and open the newly created sheet
            const newSheet = (sheets as any[]).find((s: any) => s.id === id);
            if (newSheet) { setSelectedSheet(newSheet); setSelectedGroup([newSheet]); }
          }} />
        </DialogContent>
      </Dialog>

      {/* Detail Side Panel / Dialog */}
      <Dialog open={!!selectedSheet} onOpenChange={(open) => { if (!open) { setSelectedSheet(null); setSelectedGroup([]); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {selectedSheet && (
            <ComponentSheetDetail
              sheet={selectedSheet}
              siblingIds={selectedGroup.map((s: any) => s.id)}
              groupItems={selectedGroup}
              onDelete={() => {
                selectedGroup.forEach((s: any) => deleteSheet.mutate(s.id));
                setSelectedSheet(null);
                setSelectedGroup([]);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Group Edit: Step 1 - Select group */}
      <Dialog open={groupEditOpen && !groupEditTarget} onOpenChange={(open) => { if (!open) setGroupEditOpen(false); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderEdit className="h-5 w-5 text-primary" />
              Editar Grupo em Lote
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Selecione o grupo de componentes para editar o consumo de todos os itens de uma só vez.</p>
          <div className="space-y-2 mt-2">
            {filtered.map((group: any[]) => {
              const sheet = group[0];
              const prod = sheet.products;
              let baseName = prod?.name || '—';
              const color = prod?.color;
              if (color && color.trim()) {
                const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                baseName = baseName
                  .replace(new RegExp(`:\\s*${escaped}\\s*$`, 'i'), '')
                  .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
                  .trim();
              }
              const colors = [...new Set(group.map((s: any) => s.products?.color).filter(Boolean))];
              return (
                <button
                  key={sheet.id}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                  onClick={() => {
                    setGroupEditTarget(group);
                  }}
                >
                  <div className="h-10 w-10 rounded-lg bg-muted/50 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
                    {prod?.image_url ? (
                      <img src={prod.image_url} alt={baseName} className="h-full w-full object-cover rounded-lg" />
                    ) : (
                      <Layers className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{baseName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">{prod?.category}</Badge>
                      <span className="text-[10px] text-muted-foreground">{group.length} {group.length === 1 ? 'item' : 'itens'}</span>
                      {colors.length > 0 && (
                        <span className="text-[10px] text-muted-foreground truncate">{colors.slice(0, 3).join(', ')}{colors.length > 3 ? '...' : ''}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum grupo encontrado</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Edit: Step 2 - Edit consumption */}
      <Dialog open={!!groupEditTarget} onOpenChange={(open) => { if (!open) setGroupEditTarget(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {groupEditTarget && (
            <ComponentSheetDetail
              sheet={groupEditTarget[0]}
              siblingIds={groupEditTarget.map((s: any) => s.id)}
              groupItems={groupEditTarget}
              isGroupEdit
              onDelete={() => {
                groupEditTarget.forEach((s: any) => deleteSheet.mutate(s.id));
                setGroupEditTarget(null);
                setGroupEditOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Helper: extract base name ignoring color suffix ─── */
function getBaseName(name: string, color?: string): string {
  let base = name;
  if (color && color.trim()) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    base = base
      .replace(new RegExp(`:\\s*${escaped}\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
      .trim();
  }
  return base;
}

type ProductGroup = {
  key: string;
  label: string;
  category: string;
  products: any[];
};

/* ─── Create Form (group-based selection) ─── */
function CreateComponentForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { data: products = [] } = useProducts();
  const { data: existingSheets = [] } = useComponentSheets();
  const addSheet = useAddComponentSheet();

  const existingProductIds = new Set(existingSheets.map((s: any) => s.product_id));

  // Build groups from products (by group_id, then by base name)
  const availableGroups = useMemo(() => {
    const groupMap = new Map<string, ProductGroup>();

    products.forEach((p: any) => {
      // Skip products that already have sheets
      if (existingProductIds.has(p.id)) return;

      let key: string;
      let label: string;
      if (p.group_id) {
        key = `grp_${p.group_id}`;
        label = getBaseName(p.name, p.color);
      } else {
        label = getBaseName(p.name, p.color);
        key = label.toUpperCase();
      }

      const existing = groupMap.get(key);
      if (existing) {
        existing.products.push(p);
      } else {
        groupMap.set(key, { key, label, category: p.category, products: [p] });
      }
    });

    // Filter out groups where ALL products already have sheets
    return Array.from(groupMap.values()).filter(g =>
      g.products.some((p: any) => !existingProductIds.has(p.id))
    ).sort((a, b) => a.label.localeCompare(b.label));
  }, [products, existingProductIds]);

  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [shoeType, setShoeType] = useState<string>('Adulto');
  const [form, setForm] = useState<Omit<ComponentSheetFormData, 'product_id'>>({
    dimensions_length: 0,
    dimensions_width: 0,
    dimensions_thickness: 0,
    dimensions_unit: 'mm',
    yield_per_size: {},
    waste_pct: 8,
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedGroup = availableGroups.find(g => g.key === selectedGroupKey);
  const representativeProduct = selectedGroup?.products[0];
  const hasGrade = needsShoeType(representativeProduct);
  const sizes = getSizesForProduct(representativeProduct, shoeType);

  const actualCategories = useMemo(() => {
    const cats = new Set(availableGroups.map(g => g.category));
    return Array.from(cats).sort();
  }, [availableGroups]);

  const filteredGroups = catFilter && catFilter !== 'all'
    ? availableGroups.filter(g => g.category === catFilter)
    : availableGroups;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    setIsSubmitting(true);

    try {
      // Create a sheet for each product in the group that doesn't already have one
      const productsToCreate = selectedGroup.products.filter((p: any) => !existingProductIds.has(p.id));
      let firstId = '';

      for (const p of productsToCreate) {
        const result = await addSheet.mutateAsync({
          product_id: p.id,
          group_id: p.group_id || null,
          ...form,
        });
        if (!firstId && result) firstId = result.id;
      }

      if (firstId) onCreated(firstId);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      <div>
        <Label>Filtrar por Categoria</Label>
        <Select value={catFilter} onValueChange={v => setCatFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {actualCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Grupo de Material *</Label>
        <Select value={selectedGroupKey} onValueChange={v => {
          setSelectedGroupKey(v);
          const grp = availableGroups.find(g => g.key === v);
          // Auto-fill dimensions from the product's stored dimensions
          const rep = grp?.products[0];
          if (rep) {
            setForm(f => ({
              ...f,
              yield_per_size: {},
              dimensions_length: rep.dimensions_length || 0,
              dimensions_width: rep.dimensions_width || 0,
              dimensions_thickness: rep.dimensions_thickness || 0,
              dimensions_unit: rep.dimensions_unit || 'mm',
            }));
          } else {
            setForm(f => ({ ...f, yield_per_size: {} }));
          }
          if (grp && !needsShoeType(grp.products[0])) setShoeType('Adulto');
        }}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o grupo..." /></SelectTrigger>
          <SelectContent>
            {filteredGroups.map(g => (
              <SelectItem key={g.key} value={g.key}>
                <span className="flex items-center gap-2">
                  {g.label}
                  <span className="text-muted-foreground text-xs">• {g.category}</span>
                  <span className="text-muted-foreground text-xs">({g.products.length} {g.products.length === 1 ? 'item' : 'itens'})</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Show products in group */}
      {selectedGroup && (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Itens do grupo ({selectedGroup.products.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedGroup.products.map((p: any) => (
              <Badge key={p.id} variant="outline" className="text-[10px] py-0.5 font-normal">
                {p.color || p.name}
                <span className="text-muted-foreground ml-1 font-mono">({p.sku})</span>
              </Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Uma ficha será criada para cada item, compartilhando as mesmas especificações.
          </p>
        </div>
      )}

      {hasGrade && (
        <div>
          <Label className="text-xs">Tipo de Calçado</Label>
          <Select value={shoeType} onValueChange={v => { setShoeType(v); setForm(f => ({ ...f, yield_per_size: {} })); }}>
            <SelectTrigger className="mt-1 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Infantil">Infantil</SelectItem>
              <SelectItem value="Adulto">Adulto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        {representativeProduct && needsDimensions(representativeProduct) && (
          <p className="text-xs text-muted-foreground">
            Dimensões da placa/rolo de {representativeProduct?.category?.toLowerCase()}
          </p>
        )}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Base</Label>
            <Input type="number" step="0.1" value={form.dimensions_length || ''} onChange={e => setForm(f => ({ ...f, dimensions_length: Number(e.target.value) }))} className="mt-1" placeholder="1200" />
          </div>
          <div>
            <Label className="text-xs">Altura</Label>
            <Input type="number" step="0.1" value={form.dimensions_width || ''} onChange={e => setForm(f => ({ ...f, dimensions_width: Number(e.target.value) }))} className="mt-1" placeholder="800" />
          </div>
          <div>
            <Label className="text-xs">Espessura</Label>
            <Input type="number" step="0.1" value={form.dimensions_thickness || ''} onChange={e => setForm(f => ({ ...f, dimensions_thickness: Number(e.target.value) }))} className="mt-1" placeholder="3" />
          </div>
          <div>
            <Label className="text-xs">Unidade</Label>
            <Select value={form.dimensions_unit} onValueChange={v => setForm(f => ({ ...f, dimensions_unit: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DIM_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Perda estimada (%)</Label>
        <Input type="number" step="0.1" value={form.waste_pct} onChange={e => setForm(f => ({ ...f, waste_pct: Number(e.target.value) }))} className="mt-1 w-24" />
      </div>

      {/* Consumo por par (para COLA e similares) */}
      {!hasGrade && isConsumptionCategory(representativeProduct?.category) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Consumo por Par ({getConsumptionUnit(representativeProduct?.category)})</h3>
          <p className="text-xs text-muted-foreground">Quantidade de material gasto por par produzido</p>
          <div className="w-48">
            <NumberInput
              value={form.yield_per_size['unit'] || 0}
              onChange={v => {
                const newYield = { ...form.yield_per_size, unit: v };
                if (v === 0) delete newYield['unit'];
                setForm(f => ({ ...f, yield_per_size: newYield }));
              }}
              step="0.0001"
              placeholder="0,0050"
              className="h-9 text-sm"
            />
          </div>
        </div>
      )}

      {/* Consumo por par (para ACESSÓRIO, EMBALAGEM e similares - unidade) */}
      {!hasGrade && !isConsumptionCategory(representativeProduct?.category) && isUnitCategory(representativeProduct?.category) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Consumo por Par (un)</h3>
          <p className="text-xs text-muted-foreground">Quantidade de unidades gastas por par produzido</p>
          <div className="w-48">
            <NumberInput
              value={form.yield_per_size['unit'] || 1}
              onChange={v => {
                const newYield = { ...form.yield_per_size, unit: v };
                if (v === 0) delete newYield['unit'];
                setForm(f => ({ ...f, yield_per_size: newYield }));
              }}
              step="1"
              placeholder="1"
              className="h-9 text-sm"
            />
          </div>
        </div>
      )}

      {hasGrade && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Consumo por Par — Grade ({shoeType === 'Infantil' ? '25-36' : '34-40'})</h3>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {sizes.map(size => {
              const sizeStr = String(size);
              return (
                <div key={size} className="text-center">
                  <Label className="text-[11px] text-muted-foreground">{size}</Label>
                  <Input
                    type="number"
                    min={0}
                         step={0.0001}
                    value={form.yield_per_size[sizeStr] || ''}
                    onChange={e => {
                      const newYield = { ...form.yield_per_size };
                      if (e.target.value === '' || Number(e.target.value) === 0) {
                        delete newYield[sizeStr];
                      } else {
                        newYield[sizeStr] = Number(e.target.value);
                      }
                      setForm(f => ({ ...f, yield_per_size: newYield }));
                    }}
                    className="h-8 text-xs font-mono text-center"
                    placeholder="—"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting || !selectedGroupKey} className="gap-2">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Criar Fichas {selectedGroup ? `(${selectedGroup.products.filter((p: any) => !existingProductIds.has(p.id)).length})` : ''}
        </Button>
      </div>
    </form>
  );
}
/* ─── Detail Panel (opens in dialog) ─── */
function ComponentSheetDetail({ sheet, siblingIds = [], groupItems = [], onDelete, isGroupEdit = false }: {
  sheet: any;
  siblingIds?: string[];
  groupItems?: any[];
  onDelete: () => void;
  isGroupEdit?: boolean;
}) {
  const updateSheet = useUpdateComponentSheet();
  const bulkUpdate = useBulkUpdateComponentSheets();
  const groupInfo = sheet.product_groups;
  const groupId = sheet.group_id || sheet.products?.group_id;
  const [activeTab, setActiveTab] = useState<'specs' | 'yield' | 'consumption' | 'notes' | 'colors' | 'sole_specs'>('specs');
  const [currentSheet, setCurrentSheet] = useState(sheet);
  const [allColorsSelected, setAllColorsSelected] = useState(true);
  const prod = currentSheet.products;
  const hasGrade = needsShoeType(prod);
  const colors = useMemo(() => [...new Set(groupItems.map(s => s.products?.color).filter(Boolean))], [groupItems]);

  const shoeType = useMemo(() => {
    const existingKeys = Object.keys(currentSheet.yield_per_size || {}).map(Number);
    if (existingKeys.some(k => k < 34)) return 'Infantil';
    return 'Adulto';
  }, [currentSheet.yield_per_size]);

  const sizes = hasGrade
    ? getSizesForProduct(prod, shoeType)
    : (shoeType === 'Infantil' ? SIZES_INFANTIL : SIZES_ADULTO);

  const [form, setForm] = useState<ComponentSheetFormData>(() => ({
    product_id: sheet.product_id,
    dimensions_length: sheet.dimensions_length || 0,
    dimensions_width: sheet.dimensions_width || 0,
    dimensions_thickness: sheet.dimensions_thickness || 0,
    dimensions_unit: sheet.dimensions_unit || 'mm',
    yield_per_size: sheet.yield_per_size || {},
    waste_pct: sheet.waste_pct ?? 0,
    notes: sheet.notes || '',
  }));
  const [dirty, setDirty] = useState(false);
  const hasPlateDimensions = (form.dimensions_length > 0 && form.dimensions_width > 0) || hasGrade || isGroupEdit;

  // Sync form when active sheet changes OR when sheet updates from props
  useEffect(() => {
    if (!dirty || currentSheet.id !== form.product_id) {
      setForm({
        product_id: currentSheet.product_id,
        dimensions_length: currentSheet.dimensions_length || 0,
        dimensions_width: currentSheet.dimensions_width || 0,
        dimensions_thickness: currentSheet.dimensions_thickness || 0,
        dimensions_unit: currentSheet.dimensions_unit || 'mm',
        yield_per_size: currentSheet.yield_per_size || {},
        waste_pct: currentSheet.waste_pct ?? 0,
        notes: currentSheet.notes || '',
      });
      setDirty(false);
    }
  }, [currentSheet.id, currentSheet.updated_at]);

  const updateField = (key: keyof ComponentSheetFormData, value: any) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const saveAll = () => {
    const { product_id: _, ...data } = form;
    const isSharedConsumptionTab = activeTab === 'yield' || activeTab === 'consumption';
    const idsToUpdate = (isGroupEdit || isSharedConsumptionTab || allColorsSelected) && siblingIds.length > 0
      ? siblingIds
      : [currentSheet.id];
    const onSuccess = () => setDirty(false);
    const onError = () => setDirty(true);
    if (idsToUpdate.length === 1) {
      updateSheet.mutate({ id: idsToUpdate[0], data }, { onSuccess, onError });
    } else {
      bulkUpdate.mutate({ ids: idsToUpdate, data }, { onSuccess, onError });
    }
  };

  const costPerPairBySize = useMemo(() => {
    const result: Record<string, number> = {};
    const unitPrice = prod?.unit_price || 0;
    Object.entries(form.yield_per_size).forEach(([size, consumptionPerPair]) => {
      const consumption = Number(consumptionPerPair);
      if (consumption > 0) {
        const rawCost = unitPrice * consumption;
        result[size] = rawCost * (1 + form.waste_pct / 100);
      }
    });
    return result;
  }, [form.yield_per_size, form.waste_pct, prod?.unit_price]);

  // Derive base name
  let baseName = prod?.name || '—';
  const color = prod?.color;
  if (color && color.trim()) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    baseName = baseName
      .replace(new RegExp(`:\\s*${escaped}\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
      .trim();
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex flex-col p-6 pb-4 border-b border-border/40 space-y-4">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
            {prod?.image_url ? (
              <img src={prod.image_url} alt={baseName} className="h-full w-full object-cover rounded-xl" />
            ) : (
              <Layers className="h-7 w-7 text-muted-foreground/40" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">{baseName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">{prod?.category}</Badge>
                  <span className="text-xs text-muted-foreground font-mono">{prod?.sku}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir ficha?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tem certeza que deseja excluir {siblingIds.length > 1 ? `todas as ${siblingIds.length} fichas` : 'a ficha'} de <strong>{baseName}</strong>?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            
            {/* Group Items Selection (Colors) */}
            {!isGroupEdit && groupItems.length > 1 && (
              <div className="mt-4 pt-4 border-t border-border/40">
                {(activeTab === 'yield' || activeTab === 'consumption') ? (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md border bg-accent/10 border-accent/20">
                    <FolderEdit className="h-4 w-4 text-accent-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-accent-foreground">
                        Consumo compartilhado por grupo
                      </p>
                      <p className="text-[10px] text-accent-foreground/80 mt-0.5">
                        No consumo por par, a cor não altera o consumo. Tudo o que for salvo aqui será aplicado automaticamente às {groupItems.length} cores deste grupo.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Palette className="h-3 w-3" />
                        Cores Disponíveis no Grupo
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={allColorsSelected ? "default" : "outline"}
                          size="sm"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => setAllColorsSelected(!allColorsSelected)}
                        >
                          <Check className="h-3 w-3" />
                          {allColorsSelected ? 'Todas selecionadas' : 'Selecionar Todas'}
                        </Button>
                        <Badge variant="outline" className="text-[9px] font-mono h-4 px-1.5">
                          {allColorsSelected ? `${groupItems.length}/${groupItems.length}` : `1/${groupItems.length}`} itens
                        </Badge>
                      </div>
                    </div>
                    {allColorsSelected && (
                      <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-primary/5 rounded-md border border-primary/20">
                        <FolderEdit className="h-3.5 w-3.5 text-primary shrink-0" />
                        <p className="text-[10px] text-primary font-medium">
                          Modo lote ativo — as alterações serão salvas em todas as {groupItems.length} cores simultaneamente.
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {groupItems.map((item: any) => {
                        const isSelected = allColorsSelected || item.id === currentSheet.id;
                        const itemColor = item.products?.color || 'Padrão';
                        
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              if (allColorsSelected) return;
                              if (dirty) {
                                if (confirm('Você tem alterações não salvas. Deseja descartar e mudar de cor?')) {
                                  setCurrentSheet(item);
                                  setDirty(false);
                                }
                              } else {
                                setCurrentSheet(item);
                              }
                            }}
                            className={cn(
                              "group relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:shadow-sm",
                              isSelected 
                                ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary/20 ring-offset-1" 
                                : "bg-background text-muted-foreground border-border/60 hover:border-primary/40 hover:bg-muted/50"
                            )}
                          >
                            <div className={cn(
                              "h-2.5 w-2.5 rounded-full border border-black/10 shrink-0",
                              isSelected ? "bg-card" : "bg-muted-foreground/30"
                            )} />
                            {itemColor}
                            {isSelected && (
                              <div className="absolute -top-1 -right-1 h-3 w-3 bg-primary-foreground text-primary rounded-full flex items-center justify-center shadow-sm">
                                <Check className="h-2 w-2" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">
                      {allColorsSelected
                        ? '* Todas as cores selecionadas. As alterações serão aplicadas a todos os itens.'
                        : '* Clique em uma cor para editar individualmente, ou use "Selecionar Todas" para edição em lote.'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Group edit banner */}
      {isGroupEdit && siblingIds.length > 1 && (
        <div className="flex items-center gap-2 bg-accent/30 border-b border-accent/40 px-6 py-2.5">
          <FolderEdit className="h-4 w-4 text-accent-foreground shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-accent-foreground font-medium block">
              Edição em lote — todas as {siblingIds.length} cores
            </span>
            <p className="text-[10px] text-accent-foreground/70">As alterações abaixo serão aplicadas simultaneamente a todos os itens deste grupo.</p>
          </div>
        </div>
      )}

      {/* Unsaved banner */}
      {dirty && (
        <div className="flex items-center justify-between bg-primary/5 border-b border-primary/20 px-6 py-2.5">
          <span className="text-sm text-primary font-medium">Alterações não salvas</span>
          <Button size="sm" onClick={saveAll} disabled={updateSheet.isPending || bulkUpdate.isPending} className="gap-1.5 h-8">
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex-1">
        <TabsList className="w-full justify-start rounded-none border-b border-border/40 bg-transparent h-auto p-0 px-6">
          <TabsTrigger value="specs" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
            <Ruler className="h-4 w-4 mr-1.5" />
            Especificações
          </TabsTrigger>
          {(hasPlateDimensions || hasGrade) && (
            <TabsTrigger value="yield" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Consumo/Par (dm²)
            </TabsTrigger>
          )}
          {!hasPlateDimensions && !hasGrade && (isConsumptionCategory(prod?.category) || isUnitCategory(prod?.category)) && (
            <TabsTrigger value="consumption" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Consumo
            </TabsTrigger>
          )}
          <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
            <Pencil className="h-4 w-4 mr-1.5" />
            Observações
          </TabsTrigger>
          {(prod?normalizeForSearch(.category).includes('solado') || prod?normalizeForSearch(.category).includes('sola')) && (
            <TabsTrigger value="sole_specs" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
              <Footprints className="h-4 w-4 mr-1.5" />
              Specs Técnicas
            </TabsTrigger>
          )}
          {groupId && (
            <TabsTrigger value="colors" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">
              <Palette className="h-4 w-4 mr-1.5" />
              Cores / Itens
            </TabsTrigger>
          )}
        </TabsList>

        {/* Specs Tab */}
        <TabsContent value="specs" className="p-6 space-y-5 mt-0">
          {/* Info cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preço Unit.</p>
              <p className="text-sm font-mono font-bold text-foreground mt-1">{formatCurrency(prod?.unit_price || 0)}</p>
              <p className="text-[10px] text-muted-foreground">por {prod?.unit}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Estoque</p>
              <p className="text-sm font-mono font-bold text-foreground mt-1">{prod?.quantity}</p>
              <p className="text-[10px] text-muted-foreground">{prod?.unit}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Perda</p>
              <p className="text-sm font-mono font-bold text-foreground mt-1">{form.waste_pct}%</p>
              <p className="text-[10px] text-muted-foreground">estimada</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Variantes</p>
              <p className="text-sm font-mono font-bold text-foreground mt-1">{colors.length || 1}</p>
              <p className="text-[10px] text-muted-foreground">{colors.length === 1 ? 'cor' : 'cores'}</p>
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Ruler className="h-4 w-4 text-primary" />
              Dimensões do Material
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Base (comp.)</Label>
                <Input type="number" step="0.1" value={form.dimensions_length || ''} onChange={e => updateField('dimensions_length', Number(e.target.value))} className="mt-1 h-9 text-sm font-mono" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Altura (larg.)</Label>
                <Input type="number" step="0.1" value={form.dimensions_width || ''} onChange={e => updateField('dimensions_width', Number(e.target.value))} className="mt-1 h-9 text-sm font-mono" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Espessura</Label>
                <Input type="number" step="0.1" value={form.dimensions_thickness || ''} onChange={e => updateField('dimensions_thickness', Number(e.target.value))} className="mt-1 h-9 text-sm font-mono" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unidade</Label>
                <Select value={form.dimensions_unit} onValueChange={v => updateField('dimensions_unit', v)}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIM_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Waste */}
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5" />
              Perda estimada no corte (%)
            </Label>
            <Input type="number" step="0.1" value={form.waste_pct} onChange={e => updateField('waste_pct', Number(e.target.value))} className="mt-1 h-9 w-28 text-sm font-mono" />
          </div>

          {/* Default Sole */}
          <DefaultSoleSection sheet={currentSheet} />
        </TabsContent>

        {/* Yield Tab — dm² consumption per size with plate yield calc */}
        {(hasPlateDimensions || hasGrade) && (
          <TabsContent value="yield" className="p-6 space-y-5 mt-0">
            {isLiningOrInsoleCategory(prod) ? (
              /* Palmilha/Forro: read-only — redirect to inventory group editing */
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Consumo por Solado (DM²)</h3>
                  <p className="text-xs text-muted-foreground">
                    O consumo destes materiais é definido individualmente por cada solado
                  </p>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-lg border border-primary/20 bg-primary/5">
                  <FolderEdit className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-primary">Edição centralizada no Estoque</p>
                    <p className="text-xs text-primary/80 mt-0.5">
                      O consumo de placa EVA de palmilha é gerenciado exclusivamente na Edição de Grupo do módulo de Estoque.
                      Acesse Estoque → Grupo → Editar para ajustar os consumos por solado.
                    </p>
                  </div>
                </div>
                {/* Show current values as read-only */}
                {groupId && <SoleConsumptionMatrixReadOnly groupId={groupId} category={prod?.category} />}
              </div>
            ) : (
              /* Non-palmilha: editable as before */
              <>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Consumo por Par (dm²)</h3>
                    <p className="text-xs text-muted-foreground">
                      {`Quantidade em dm² consumida por par para cada numeração. O valor salvo é replicado automaticamente para todas as ${Math.max(groupItems.length, 1)} cores do grupo.`}
                    </p>
                  </div>
                </div>

                {/* Plate area info */}
                {form.dimensions_length > 0 && form.dimensions_width > 0 && (() => {
                  const areaDm2 = calcAreaDm2(form.dimensions_length, form.dimensions_width, form.dimensions_unit || 'mm');
                  return (
                    <div className="flex items-center gap-2 px-3 py-2 bg-accent/5 rounded-md border border-accent/10">
                      <Ruler className="h-4 w-4 text-accent-foreground" />
                      <span className="text-xs font-medium text-accent-foreground">Área da placa: {areaDm2.toFixed(2)} dm²</span>
                    </div>
                  );
                })()}

                {/* Grids for Adulto and Infantil */}
                {[
                  { label: 'Grade Adulto', sizes: SIZES_ADULTO },
                  { label: 'Grade Infantil', sizes: SIZES_INFANTIL }
                ].map((grade) => (
                  <div key={grade.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{grade.label}</h4>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2" onClick={() => {
                          const val = prompt(`Preencher toda a ${grade.label} com qual valor?`);
                          if (val && !isNaN(Number(val))) {
                            const newYield = { ...form.yield_per_size };
                            grade.sizes.forEach(s => { newYield[String(s)] = Number(val); });
                            updateField('yield_per_size', newYield);
                          }
                        }}>Preencher</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2 text-destructive" onClick={() => {
                          const newYield = { ...form.yield_per_size };
                          grade.sizes.forEach(s => { delete newYield[String(s)]; });
                          updateField('yield_per_size', newYield);
                        }}>Limpar</Button>
                      </div>
                    </div>
                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-7 bg-muted/40 border-b" style={{ gridTemplateColumns: `repeat(${grade.sizes.length}, 1fr)` }}>
                        {grade.sizes.map(size => (
                          <div key={size} className="text-center py-2 px-1 text-[10px] font-semibold text-muted-foreground border-r last:border-r-0">
                            {size}
                          </div>
                        ))}
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: `repeat(${grade.sizes.length}, 1fr)` }}>
                        {grade.sizes.map(size => {
                          const sizeStr = String(size);
                          return (
                            <div key={size} className="border-r last:border-r-0">
                              <Input
                                type="number"
                                min={0}
                                step={0.0001}
                                value={form.yield_per_size[sizeStr] || ''}
                                onChange={e => {
                                  const newYield = { ...form.yield_per_size };
                                  if (e.target.value === '' || Number(e.target.value) === 0) {
                                    delete newYield[sizeStr];
                                  } else {
                                    newYield[sizeStr] = Number(e.target.value);
                                  }
                                  updateField('yield_per_size', newYield);
                                }}
                                className="h-9 text-xs font-mono text-center border-0 rounded-none focus-visible:ring-1 focus-visible:ring-inset"
                                placeholder="—"
                              />
                            </div>
                          );
                        })}
                      </div>
                      {form.dimensions_length > 0 && form.dimensions_width > 0 && (
                        <div className="grid border-t bg-accent/5" style={{ gridTemplateColumns: `repeat(${grade.sizes.length}, 1fr)` }}>
                          {grade.sizes.map(size => {
                            const sizeStr = String(size);
                            const consumption = Number(form.yield_per_size[sizeStr] || 0);
                            const areaDm2 = calcAreaDm2(form.dimensions_length, form.dimensions_width, form.dimensions_unit || 'mm');
                            const pairsPerPlate = consumption > 0 ? Math.floor(areaDm2 / consumption) : 0;
                            return (
                              <div key={size} className="text-center py-1 text-[9px] font-mono font-medium text-accent-foreground border-r last:border-r-0">
                                {pairsPerPlate > 0 ? `${pairsPerPlate} pr` : '—'}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <p className="text-[10px] text-muted-foreground">
                  * Consumo em dm²/par. Pares/placa calculado com base nas dimensões informadas.
                </p>
                {/* Cost row */}
                <div className="rounded-lg border border-border/40 overflow-hidden mt-4">
                  <div className="bg-muted/40 border-b border-border/40 px-3 py-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Custo por Par Estimado</h4>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${sizes.length}, 1fr)` }}>
                    {sizes.map(size => {
                      const sizeStr = String(size);
                      const cost = costPerPairBySize[sizeStr];
                      return (
                        <div key={size} className="text-center py-2 px-0.5 text-[9px] font-mono text-muted-foreground border-r border-border/30 last:border-r-0">
                          {cost ? formatCurrency(cost) : '—'}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  * Custo/par = preço unitário × consumo dm² × (1 + {form.waste_pct}% perda)
                  {form.dimensions_length > 0 && form.dimensions_width > 0 && ' | Pares/placa = área da placa ÷ consumo dm²'}
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                    const val = prompt('Preencher todos os tamanhos com qual consumo por par (dm²)?');
                    if (val && Number(val) > 0) {
                      const newYield: Record<string, number> = {};
                      sizes.forEach(s => { newYield[String(s)] = Number(val); });
                      updateField('yield_per_size', newYield);
                    }
                  }}>
                    Preencher todos
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => updateField('yield_per_size', {})}>
                    Limpar
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* Consumption Tab (for items without plate dimensions: COLA, Acessório, etc.) */}
        {!hasPlateDimensions && !hasGrade && (isConsumptionCategory(prod?.category) || isUnitCategory(prod?.category)) && (
          <TabsContent value="consumption" className="p-6 space-y-5 mt-0">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Consumo por Par</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {isUnitCategory(prod?.category)
                  ? 'Quantidade de unidades gastas por par produzido'
                  : `Quantidade de ${prod?.category?.toLowerCase()} gasta por par produzido (em ${getConsumptionUnit(prod?.category)})`}
              </p>
            </div>

            <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-3">
              <Label className="text-xs text-muted-foreground font-semibold">
                Consumo por par ({isUnitCategory(prod?.category) ? 'un' : getConsumptionUnit(prod?.category)})
              </Label>
              <div className="w-48">
                <NumberInput
                  value={form.yield_per_size['unit'] || (isUnitCategory(prod?.category) ? 1 : 0)}
                  onChange={v => {
                    const newYield = { ...form.yield_per_size, unit: v };
                    if (v === 0) delete newYield['unit'];
                    updateField('yield_per_size', newYield);
                  }}
                  step={isUnitCategory(prod?.category) ? '1' : '0.0001'}
                  placeholder={isUnitCategory(prod?.category) ? '1' : '0,0050'}
                  className="h-10 text-sm"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {isUnitCategory(prod?.category)
                  ? 'Ex: 1 un por par (cada par usa 1 unidade deste item)'
                  : `Ex: 0,005 ${getConsumptionUnit(prod?.category)} por par. Use vírgula como separador decimal.`}
              </p>
              <p className="text-[10px] text-primary">
                💡 Preencha as dimensões da placa na aba Especificações para habilitar o consumo por numeração em dm².
              </p>
            </div>

            {/* Cost calculation */}
            {(form.yield_per_size['unit'] || 0) > 0 && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custo por Par</p>
                <p className="text-lg font-mono font-bold text-foreground mt-1">
                  {formatCurrency((prod?.unit_price || 0) * (form.yield_per_size['unit'] || 0) * (1 + form.waste_pct / 100))}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatCurrency(prod?.unit_price || 0)}/{isUnitCategory(prod?.category) ? 'un' : getConsumptionUnit(prod?.category)} × {form.yield_per_size['unit']} {isUnitCategory(prod?.category) ? 'un' : getConsumptionUnit(prod?.category)} × (1 + {form.waste_pct}% perda)
                </p>
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="notes" className="p-6 mt-0">
          <Textarea
            value={form.notes}
            onChange={e => updateField('notes', e.target.value)}
            rows={6}
            placeholder="Observações sobre o componente, substituições possíveis, especificações adicionais..."
            className="resize-none"
          />
        </TabsContent>

        {(prod?normalizeForSearch(.category).includes('solado') || prod?normalizeForSearch(.category).includes('sola')) && (
          <TabsContent value="sole_specs" className="p-6 mt-0">
            <SoleTechnicalDetails 
              soleId={currentSheet.product_id} 
              soleName={baseName} 
              shoeCategory={shoeType}
            />
          </TabsContent>
        )}

        {/* Colors / Group Tab */}
        {groupId && (
          <TabsContent value="colors" className="p-6 space-y-5 mt-0">
            <GroupColorsPanel
              groupId={groupId}
              groupColors={groupInfo?.colors || ''}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Sticky save footer */}
      {dirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 p-4 border-t border-border/40 bg-card">
          <Button variant="outline" size="sm" onClick={() => {
            setForm({
              product_id: sheet.product_id,
              dimensions_length: sheet.dimensions_length || 0,
              dimensions_width: sheet.dimensions_width || 0,
              dimensions_thickness: sheet.dimensions_thickness || 0,
              dimensions_unit: sheet.dimensions_unit || 'mm',
              yield_per_size: sheet.yield_per_size || {},
              waste_pct: sheet.waste_pct ?? 0,
              notes: sheet.notes || '',
            });
            setDirty(false);
          }}>
            Descartar
          </Button>
          <Button size="sm" onClick={saveAll} disabled={updateSheet.isPending || bulkUpdate.isPending} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Salvar alterações
          </Button>
        </div>
      )}
    </div>
  );
}

const PRODUCT_UNITS = ['par', 'dm²', 'm²', 'cm²', 'm', 'm linear', 'metros', 'kg', 'g', 'L', 'ml', 'un', 'jg', 'pc', 'rolo', 'cx', 'folha'];

/* ─── Inline editor for consumption per item (commits on blur) ─── */
function ConsumptionEditCell({
  initialValue,
  onCommit,
  disabled,
  step,
  placeholder,
}: {
  initialValue: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  step?: string;
  placeholder?: string;
}) {
  const [val, setVal] = useState(initialValue);
  useEffect(() => { setVal(initialValue); }, [initialValue]);
  return (
    <div onBlur={() => onCommit(val)}>
      <NumberInput
        value={val}
        onChange={setVal}
        disabled={disabled}
        step={step}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </div>
  );
}

/* ─── Group Colors Panel ─── */
function GroupColorsPanel({ groupId, groupColors }: {
  groupId: string;
  groupColors: string;
}) {
  const updateGroup = useUpdateGroup();
  const qc = useQueryClient();
  const [newColor, setNewColor] = useState('');

  const colorList = useMemo(() => {
    if (!groupColors) return [] as string[];
    return groupColors.split(',').map(c => c.trim()).filter(Boolean);
  }, [groupColors]);

  const { data: groupProducts = [] } = useQuery({
    queryKey: ['group_products', groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, color, unit, unit_price, quantity, active, category')
        .eq('group_id', groupId)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fichas de componente individuais (para edição de consumo por item, ex: cada cola)
  const productIds = useMemo(() => groupProducts.map((p: any) => p.id), [groupProducts]);
  const { data: itemSheets = [] } = useQuery({
    queryKey: ['component_sheets_by_products', productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_sheets')
        .select('id, product_id, yield_per_size, waste_pct')
        .in('product_id', productIds);
      if (error) throw error;
      return data || [];
    },
  });

  const sheetByProduct = useMemo(() => {
    const map = new Map<string, any>();
    (itemSheets as any[]).forEach((s) => map.set(s.product_id, s));
    return map;
  }, [itemSheets]);

  const groupCategory = (groupProducts[0] as any)?.category || '';
  const isConsumptionGroup = isConsumptionCategory(groupCategory);
  const consumptionUnit = getConsumptionUnit(groupCategory) || 'kg';

  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const updateItemConsumption = async (productId: string, value: number, wastePct?: number) => {
    if (!Number.isFinite(value) || value < 0) { toast.error('Consumo deve ser um número não-negativo.'); return; }
    if (wastePct !== undefined && (!Number.isFinite(wastePct) || wastePct < 0 || wastePct > 100)) { toast.error('Perda (%) deve ser entre 0 e 100.'); return; }
    setSavingItemId(productId);
    try {
      const existing = sheetByProduct.get(productId);
      const newYield = { ...(existing?.yield_per_size || {}), unit: value };
      if (!value || value <= 0) delete newYield.unit;
      const payload: any = {
        yield_per_size: newYield,
        ...(wastePct !== undefined ? { waste_pct: wastePct } : {}),
      };
      if (existing) {
        const { error } = await supabase.from('component_sheets').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('component_sheets').insert({
          product_id: productId,
          yield_per_size: newYield,
          waste_pct: wastePct ?? 8,
        } as any);
        if (error) throw error;
      }
      toast.success('Consumo atualizado!');
      qc.invalidateQueries({ queryKey: ['component_sheets_by_products', productIds] });
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSavingItemId(null);
    }
  };

  const saveColors = (newColors: string[]) => {
    updateGroup.mutate(
      { id: groupId, data: { colors: newColors.join(', ') } as any },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['component_sheets'] });
          qc.invalidateQueries({ queryKey: ['group_products', groupId] });
        },
      }
    );
  };

  const addColor = () => {
    const t = newColor.trim();
    if (!t) return;
    if (colorList.includes(t)) {
      toast.error('Cor já existe no grupo');
      return;
    }
    saveColors([...colorList, t]);
    setNewColor('');
  };

  const removeColor = (color: string) => {
    saveColors(colorList.filter(c => c !== color));
  };

  const [editingColor, setEditingColor] = useState<{ old: string; new: string } | null>(null);

  const confirmEditColor = () => {
    if (!editingColor) return;
    const t = editingColor.new.trim();
    if (!t || t === editingColor.old) {
      setEditingColor(null);
      return;
    }
    if (colorList.includes(t)) {
      toast.error('Cor já existe no grupo');
      return;
    }
    saveColors(colorList.map(c => c === editingColor.old ? t : c));
    setEditingColor(null);
  };

  const updateProductUnit = async (productId: string, unit: string) => {
    const { error } = await supabase
      .from('products')
      .update({ unit })
      .eq('id', productId);
    if (error) {
      toast.error(`Erro: ${error.message}`);
    } else {
      toast.success('Unidade atualizada!');
      qc.invalidateQueries({ queryKey: ['group_products', groupId] });
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    }
  };

  const [bulkUnit, setBulkUnit] = useState(groupProducts[0]?.unit || 'dm²');

  useEffect(() => {
    if (groupProducts.length > 0) {
      setBulkUnit(groupProducts[0].unit);
    }
  }, [groupProducts]);

  const applyBulkUnit = async () => {
    const ids = groupProducts.map(p => p.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from('products')
      .update({ unit: bulkUnit })
      .in('id', ids);
    if (error) {
      toast.error(`Erro: ${error.message}`);
    } else {
      toast.success(`Unidade "${bulkUnit}" aplicada a ${ids.length} itens!`);
      qc.invalidateQueries({ queryKey: ['group_products', groupId] });
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-primary/5 rounded-xl border border-primary/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Catálogo de Cores do Grupo
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Defina os nomes das cores que este material (grupo) pode possuir.
            </p>
          </div>
          <Badge variant="outline" className="text-[9px] font-mono h-4 px-1.5 uppercase tracking-widest">
            Metadados do Grupo
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          {colorList.map(color => (
            <div
              key={color}
              className="flex items-center gap-1.5 bg-background border border-border/60 rounded-lg px-2.5 py-1 group/color shadow-sm"
            >
              {editingColor?.old === color ? (
                <Input
                  autoFocus
                  value={editingColor.new}
                  onChange={e => setEditingColor({ ...editingColor, new: e.target.value })}
                  onBlur={confirmEditColor}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmEditColor(); }
                    if (e.key === 'Escape') setEditingColor(null);
                  }}
                  className="h-6 w-24 text-xs px-1.5 py-0"
                />
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  <span className="text-xs font-medium text-foreground">{color}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/color:opacity-100 transition-opacity ml-1 pl-1 border-l">
                    <button
                      type="button"
                      onClick={() => setEditingColor({ old: color, new: color })}
                      className="text-muted-foreground hover:text-primary p-0.5"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeColor(color)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {colorList.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-1">Nenhuma cor definida no catálogo do grupo.</p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
          <Input
            placeholder="Adicionar nova cor ao catálogo..."
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addColor(); }
            }}
            className="h-8 flex-1 max-w-xs text-xs"
          />
          <Button type="button" variant="outline" size="sm" onClick={addColor} disabled={!newColor.trim()} className="h-8 text-[10px] gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Itens (SKUs) Existentes no Grupo
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Estes são os produtos reais vinculados a este grupo e suas respectivas cores.
          </p>
        </div>

        <div className="border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider px-4">Cor do Item</TableHead>
                <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider">SKU</TableHead>
                <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider text-right">Estoque</TableHead>
                <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider text-right px-4">Preço</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupProducts.map(p => (
                <TableRow key={p.id} className="hover:bg-muted/20 transition-colors">
                  <TableCell className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-primary/20 border border-primary/30" />
                      <span className="text-xs font-medium">{p.color || 'Padrão'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-[10px] font-mono text-muted-foreground">{p.sku}</TableCell>
                  <TableCell className="py-2 text-right text-xs">
                    <Badge variant={p.quantity > 0 ? "secondary" : "outline"} className="text-[9px] h-4 font-mono">
                      {p.quantity} {p.unit}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 text-right text-[10px] font-mono pr-4">
                    {p.unit_price ? formatCurrency(p.unit_price) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {groupProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground italic">
                    Nenhum item vinculado a este grupo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {isConsumptionGroup && groupProducts.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                Consumo por Item ({consumptionUnit} por par)
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Defina o consumo individual de cada {groupCategory.toLowerCase()} no grupo. Salvo automaticamente ao sair do campo.
              </p>
            </div>
            <div className="border rounded-xl overflow-hidden shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider px-4">Item</TableHead>
                    <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider">SKU</TableHead>
                    <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider w-44">
                      Consumo / par ({consumptionUnit})
                    </TableHead>
                    <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider w-32">
                      Perda (%)
                    </TableHead>
                    <TableHead className="h-8 text-[10px] font-bold uppercase tracking-wider text-right px-4">Custo / par</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupProducts.map((p: any) => {
                    const sheet = sheetByProduct.get(p.id);
                    const consumption = Number(sheet?.yield_per_size?.unit || 0);
                    const wastePct = Number(sheet?.waste_pct ?? 8);
                    const costPerPair = (p.unit_price || 0) * consumption * (1 + wastePct / 100);
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/20">
                        <TableCell className="py-2 px-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full bg-primary/20 border border-primary/30" />
                            <span className="text-xs font-medium">{p.color || p.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-[10px] font-mono text-muted-foreground">{p.sku}</TableCell>
                        <TableCell className="py-2">
                          <ConsumptionEditCell
                            initialValue={consumption}
                            disabled={savingItemId === p.id}
                            step="0.0001"
                            placeholder="0,0050"
                            onCommit={(v) => {
                              if (v !== consumption) updateItemConsumption(p.id, v, wastePct);
                            }}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <ConsumptionEditCell
                            initialValue={wastePct}
                            disabled={savingItemId === p.id}
                            step="1"
                            placeholder="8"
                            onCommit={(v) => {
                              if (v !== wastePct) updateItemConsumption(p.id, consumption, v);
                            }}
                          />
                        </TableCell>
                        <TableCell className="py-2 text-right text-[10px] font-mono pr-4">
                          {costPerPair > 0 ? formatCurrency(costPerPair) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" />
          Unidade de Medida
        </h3>
        <p className="text-xs text-muted-foreground">
          Define a unidade de medida para todos os itens do grupo
        </p>
        <div className="flex items-center gap-3">
          <Select value={bulkUnit} onValueChange={setBulkUnit}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_UNITS.map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyBulkUnit}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> Aplicar a todos
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          Itens do Grupo ({groupProducts.length})
        </h3>
        <div className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/40">
          {groupProducts.map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{p.color || p.name}</span>
                  {!p.active && <Badge variant="secondary" className="text-[9px]">Inativo</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-muted-foreground font-mono">{p.sku}</span>
                  <span className="text-[10px] text-muted-foreground">Estoque: {p.quantity} {p.unit}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.unit_price)}/{p.unit}
                  </span>
                </div>
              </div>
              <Select
                value={p.unit}
                onValueChange={v => updateProductUnit(p.id, v)}
              >
                <SelectTrigger className="h-7 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_UNITS.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {groupProducts.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum item encontrado neste grupo
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SoleConsumptionMatrixReadOnly({ groupId, category }: { groupId: string; category?: string }) {
  const [loading, setLoading] = useState(true);
  const [soles, setSoles] = useState<any[]>([]);
  const [specs, setSpecs] = useState<Record<string, any>>({});

  const fetchSoles = async () => {
    setLoading(true);
    try {
      const { data: solesData } = await supabase
        .from('products')
        .select('id, name, sku, color')
        .ilike('category', '%solado%')
        .order('name');
      
      if (!solesData) return;

      const soleIds = solesData.map(s => s.id);
      const { data: specsData } = await supabase
        .from('sole_technical_specs')
        .select('*')
        .in('sole_id', soleIds);

      const groupedSoles = (solesData || []).reduce((acc: any[], sole: any) => {
        const modelName = getSoleModelName(sole.name, sole.color);
        const existing = acc.find(item => item.name === modelName);
        if (existing) {
          existing.ids.push(sole.id);
          existing.variantCount += 1;
          return acc;
        }
        acc.push({ ...sole, name: modelName, ids: [sole.id], variantCount: 1 });
        return acc;
      }, []).sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));

      setSoles(groupedSoles);

      const specsMap: Record<string, any> = {};
      specsData?.forEach(s => {
        const grouped = groupedSoles.find((sole: any) => sole.ids.includes(s.sole_id));
        if (!grouped) return;
        if (!specsMap[grouped.id]) specsMap[grouped.id] = {};
        if (!specsMap[grouped.id][s.size]) specsMap[grouped.id][s.size] = s;
      });
      setSpecs(specsMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSoles(); }, [groupId]);

  const isLining = normalizeForSearch(category).includes('forro') || normalizeForSearch(category).includes('forração');
  const field = isLining ? 'lining_consumption_dm2' : 'insole_consumption_dm2';

  if (loading) return <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const solesWithData = soles.filter(sole => {
    const soleSpecs = specs[sole.id];
    if (!soleSpecs) return false;
    return Object.values(soleSpecs).some((s: any) => s[field] > 0);
  });

  if (solesWithData.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-2">
        Nenhum consumo configurado ainda. Configure na Edição de Grupo em Estoque.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Footprints className="h-4 w-4" />
        Consumos Configurados (somente leitura)
      </h4>
      {solesWithData.map(sole => {
        const soleSpecs = specs[sole.id] || {};
        const isInfantil = normalizeForSearch(sole.name).includes('infantil') || normalizeForSearch(sole.name).includes('bebe') || normalizeForSearch(sole.name).includes('bebê');
        const sizes = isInfantil ? SIZES_INFANTIL : SIZES_ADULTO;
        const filledSizes = sizes.filter(s => soleSpecs[s]?.[field] > 0);
        if (filledSizes.length === 0) return null;

        return (
          <div key={sole.id} className="bg-muted/20 border border-border/40 rounded-lg p-3">
            <p className="text-xs font-semibold mb-2">{sole.name}</p>
            <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-12 gap-1">
              {filledSizes.map(size => (
                <div key={size} className="text-center">
                  <div className="text-[9px] font-bold text-muted-foreground bg-muted/50 rounded py-0.5">{size}</div>
                  <div className="text-xs font-mono mt-0.5">{soleSpecs[size]?.[field] || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Default Sole Section ─── */
function DefaultSoleSection({ sheet }: { sheet: any }) {
  const { data: soleGroups = [], isLoading } = useSoleGroups();
  const propagate = usePropagateSoleToTechnicalSheets();
  const [selectedSoleId, setSelectedSoleId] = useState<string>(sheet.default_sole_group_id || '');
  const currentName = sheet.default_sole_group?.name;

  useEffect(() => {
    setSelectedSoleId(sheet.default_sole_group_id || '');
  }, [sheet.default_sole_group_id, sheet.id]);

  const handlePropagate = () => {
    if (!selectedSoleId) {
      toast.error('Selecione um solado primeiro');
      return;
    }
    if (!confirm('Isso definirá este solado como padrão para todas as fichas técnicas que usam este componente. Continuar?')) {
      return;
    }
    propagate.mutate({ componentSheetId: sheet.id, soleGroupId: selectedSoleId });
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Footprints className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-primary">Solado Padrão</h3>
        {currentName && (
          <Badge variant="outline" className="text-[10px] bg-background">
            Atual: {currentName}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Define qual grupo de solado é padrão para este componente. Ao propagar, todas as fichas técnicas
        que utilizam este componente passarão a usar este solado automaticamente.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedSoleId} onValueChange={setSelectedSoleId} disabled={isLoading}>
          <SelectTrigger className="flex-1 h-9 text-sm bg-background">
            <SelectValue placeholder={isLoading ? 'Carregando solados...' : 'Selecione o solado padrão'} />
          </SelectTrigger>
          <SelectContent>
            {soleGroups.map((g: any) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handlePropagate}
          disabled={!selectedSoleId || propagate.isPending}
          className="gap-1.5 h-9"
          size="sm"
        >
          {propagate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Definir e Propagar
        </Button>
      </div>
    </div>
  );
}
