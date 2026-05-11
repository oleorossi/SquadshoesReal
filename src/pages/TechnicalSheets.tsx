 // VariantOverviewHeader removido — variantes de cor não fazem mais parte da
 // ficha técnica (cor é definida no PV). Variantes de material aparecem na
 // tab "Variantes" da ficha. Componente substituído por inline <></> abaixo
 // pra não quebrar callers.
 function VariantOverviewHeader(_: { sheet: any }) {
   return null;
 }
 
 import { ArrowRight, ChevronRight, Calculator, CheckCircle, HelpCircle } from 'lucide-react';
 function GuidedPathSelector({ sheets, products, onSelect }: { sheets: any[], products: any[], onSelect: (id: string) => void }) {
   const [selectedRef, setSelectedRef] = useState<string | null>(null);
   const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
   const [selectedColor, setSelectedColor] = useState<string | null>(null);
 
   const materials = useMemo(() => {
     if (!selectedRef) return [];
     const sheet = sheets.find(s => s.id === selectedRef);
     if (!sheet) return [];
     const mats = new Set<string>();
     if (sheet.upper_material) mats.add(sheet.upper_material);
     if (sheet.lining_material) mats.add(sheet.lining_material);
     if (sheet.sole_material) mats.add(sheet.sole_material);
     return Array.from(mats);
   }, [selectedRef, sheets]);
 
   const colors = useMemo(() => {
     if (!selectedRef || !selectedMaterial) return [];
     const sheet = sheets.find(s => s.id === selectedRef);
     if (!sheet || !sheet.reference_color_variants) return [];
     return sheet.reference_color_variants.map((v: any) => v.color).filter(Boolean);
   }, [selectedRef, selectedMaterial, sheets]);
 
   const totalPrice = useMemo(() => {
     if (!selectedRef) return 0;
     const sheet = sheets.find(s => s.id === selectedRef);
     return sheet?.sale_price || 0;
   }, [selectedRef, sheets]);
 
   return (
     <Card className="bg-gradient-to-r from-muted/50 to-background border-primary/10 shadow-sm overflow-hidden mb-6">
       <CardContent className="p-4 sm:p-6">
         <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-2 text-sm overflow-x-auto no-scrollbar pb-2 sm:pb-0">
           {/* 1. Referência */}
           <div className="flex items-center gap-2 bg-background p-2 rounded-lg border shadow-sm min-w-[200px]">
             <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</div>
             <Select value={selectedRef || ''} onValueChange={v => { setSelectedRef(v); setSelectedMaterial(null); setSelectedColor(null); }}>
               <SelectTrigger className="border-none focus:ring-0 h-7 bg-transparent px-1">
                 <SelectValue placeholder="Selecione Referência" />
               </SelectTrigger>
               <SelectContent>
                 {sheets.slice(0, 50).map(s => (
                   <SelectItem key={s.id} value={s.id}>{s.name} {s.code ? `(${s.code})` : ''}</SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>
 
           <ChevronRight className="hidden sm:block h-4 w-4 text-muted-foreground/30" />
 
           {/* 2. Material */}
           <div className={cn(
             "flex items-center gap-2 p-2 rounded-lg border shadow-sm min-w-[180px] transition-all",
             selectedRef ? "bg-background border-primary/20" : "bg-muted/30 opacity-50 grayscale"
           )}>
             <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">2</div>
             <Select value={selectedMaterial || ''} onValueChange={setSelectedMaterial} disabled={!selectedRef}>
               <SelectTrigger className="border-none focus:ring-0 h-7 bg-transparent px-1">
                 <SelectValue placeholder="Selecione Material *" />
               </SelectTrigger>
               <SelectContent>
                 {materials.map(m => (
                   <SelectItem key={m} value={m}>{m}</SelectItem>
                 ))}
                 {materials.length === 0 && <SelectItem value="none" disabled>Nenhum material</SelectItem>}
               </SelectContent>
             </Select>
           </div>
 
           <ChevronRight className="hidden sm:block h-4 w-4 text-muted-foreground/30" />
 
           {/* 3. Cor */}
           <div className={cn(
             "flex items-center gap-2 p-2 rounded-lg border shadow-sm min-w-[150px] transition-all",
             selectedMaterial ? "bg-background border-primary/20" : "bg-muted/30 opacity-50 grayscale"
           )}>
             <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">3</div>
             <Select value={selectedColor || ''} onValueChange={setSelectedColor} disabled={!selectedMaterial}>
               <SelectTrigger className="border-none focus:ring-0 h-7 bg-transparent px-1">
                 <SelectValue placeholder="Cor (filtrada)" />
               </SelectTrigger>
               <SelectContent>
                 {colors.map(c => (
                   <SelectItem key={c} value={c}>{c}</SelectItem>
                 ))}
                 {colors.length === 0 && <SelectItem value="none" disabled>Sem variantes</SelectItem>}
               </SelectContent>
             </Select>
           </div>
 
           <ChevronRight className="hidden sm:block h-4 w-4 text-muted-foreground/30" />
 
           {/* 4. Preço */}
           <div className={cn(
             "flex items-center gap-2 p-2 rounded-lg border shadow-sm min-w-[120px] transition-all",
             selectedRef ? "bg-primary/5 border-primary/30" : "bg-muted/30 opacity-50 grayscale"
           )}>
             <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
               <Calculator className="h-3 w-3" />
             </div>
             <div className="flex flex-col">
               <span className="text-[10px] text-muted-foreground uppercase font-bold leading-none mb-0.5">Preço</span>
               <span className="font-mono font-bold text-sm leading-none">
                 {totalPrice > 0 ? globalFormatCurrency(totalPrice) : '---'}
               </span>
             </div>
           </div>
 
           <div className="flex-1" />
 
           {/* Action */}
           <Button 
             disabled={!selectedRef} 
             onClick={() => selectedRef && onSelect(selectedRef)}
             className="h-10 px-6 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all"
           >
             <FileText className="h-4 w-4" />
             Abrir Ficha
           </Button>
         </div>
       </CardContent>
     </Card>
   );
 }
 
import React, { useState, useMemo } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Trash2, Pencil, Loader2, Package, Copy, Search,
   Layers, Scissors, Droplets, Shield, Box, Footprints, Save, Wrench, Tag,
    ImagePlus, AlertTriangle, History, Factory, Wand2, RefreshCw, Gauge, ArrowLeft, ClipboardCopy, Lock, Palette,
    DollarSign
} from 'lucide-react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  useTechnicalSheets, useAddSheet, useUpdateSheet, useDeleteSheet,
  useSheetMaterials, useAddSheetMaterial, useUpdateSheetMaterial, useDeleteSheetMaterial, useBulkAddSheetMaterials,
  SheetFormData, SheetMaterialFormData, emptySheetForm, useOverheadHistory, useCloneSheet,
} from '@/hooks/useTechnicalSheets';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import ComponentSheets from '@/pages/ComponentSheets';

 import { OperationsTab } from '@/components/technical-sheets/OperationsTab';
 // ColorVariantsTab removido — cor é definida no PV, não na ficha técnica.
 import { MaterialVariantsTab } from '@/components/technical-sheets/MaterialVariantsTab';
 import { useAllActiveReferenceMaterialVariants } from '@/hooks/useReferenceMaterialVariants';
import { VersionsTab } from '@/components/technical-sheets/VersionsTab';
import { TechnicalReferencePanel } from '@/components/technical-sheets/TechnicalReferencePanel';
import { NonFiniteDevWatcher } from '@/components/technical-sheets/NonFiniteDevWatcher';
import { SheetsAuditButton } from '@/components/technical-sheets/SheetsAuditPanel';
import { CatalogModelsPanel } from '@/components/technical-sheets/CatalogModelsPanel';
import { useBomOperations } from '@/hooks/useBomOperations';
import { useSoleColorMappings, useUpsertSoleColorMapping } from '@/hooks/useSoleColorMappings';
 import { usePalmilhaColorMappings, useUpsertPalmilhaColorMapping, PALMILHA_DEFAULT_KEY } from '@/hooks/usePalmilhaColorMappings';
 import { useLiningColorMappings, useUpsertLiningColorMapping, LINING_DEFAULT_KEY } from '@/hooks/useLiningColorMappings';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { useProducts } from '@/hooks/useProducts';
import { useReadyStock } from '@/hooks/useReadyStock';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn, getSoleModelName, parseSafeNumber, formatCurrency as globalFormatCurrency, safeToFixed } from '@/lib/utils';
import { getShoeSizeMappings } from '@/utils/shoeUtils';

import { SHOE_CATEGORIES } from '@/lib/shoeCategories';
import { AppErrorBoundary } from '@/components/ErrorBoundary';
const STATUSES = ['Ativo', 'Em desenvolvimento', 'Descontinuado'] as const;
const STATUS_FICHA = ['rascunho', 'em_revisao', 'validada', 'publicada'] as const;
const STATUS_FICHA_LABELS: Record<string, string> = { rascunho: 'Rascunho', em_revisao: 'Em Revisão', validada: 'Validada', publicada: 'Publicada' };
const GENDERS = ['Feminino', 'Masculino', 'Unissex', 'Infantil'] as const;
const SOLE_PROCESSES = ['Injetada', 'Colada', 'Costurada', 'Vulcanizada'] as const;
const ACABAMENTOS_TIRAS = ['brilho', 'fosco', 'metálico', 'metalic', 'glow', 'texturizado', 'envernizado'] as const;
const MATERIAIS_SOLADO = ['TR', 'EVA', 'Borracha', 'PVC', 'TPU'] as const;

const COMPONENT_CATEGORIES = [
  // === Base do Solado (padrão, independente de cor) ===
  { key: 'Solado', label: 'Solado', icon: Footprints, color: 'text-stone-600', aliases: ['solado'], section: 'base' },
  { key: 'Palmilha', label: 'Palmilha', icon: Shield, color: 'text-blue-600', aliases: ['palmilha', 'placa de palmilha'], section: 'base' },
  { key: 'Forro', label: 'Forro / Forração', icon: Scissors, color: 'text-purple-600', aliases: ['forro', 'forração', 'forração da palmilha'], section: 'base' },
  { key: 'Químico', label: 'Químicos', icon: Droplets, color: 'text-red-600', aliases: ['químico', 'quimico', 'cola', 'adesivo', 'hotmel', 'primer'], section: 'base' },
  // === Depende do Modelo ===
  { key: 'Cabedal', label: 'Cabedal', icon: Layers, color: 'text-amber-600', aliases: ['cabedal', 'napa', 'napa soft', 'couro', 'sintético', 'tecido', 'glow', 'metalic', 'velvet', 'tira', 'trança'], section: 'modelo' },
  { key: 'Componente', label: 'Componentes', icon: Box, color: 'text-pink-600', aliases: ['componente', 'componentes', 'acessório', 'acessorios', 'aviamento'], section: 'modelo' },
] as const;

function matchCategory(productCategory: string): string {
  const lower = productCategory.toLowerCase().trim();
  for (const cat of COMPONENT_CATEGORIES) {
    if (cat.key.toLowerCase() === lower) return cat.key;
    if (cat.aliases.some(a => lower.includes(a) || a.includes(lower))) return cat.key;
  }
  return 'Outros';
}

/** Calculate plate area in dm² from group dimensions (stored in mm by default) */
function calcPlateAreaDm2(group: any): number {
  if (!group?.dimensions_length || !group?.dimensions_width) return 0;
  const unit = (group.dimensions_unit || 'mm').toLowerCase();
  let l = Number(group.dimensions_length);
  let w = Number(group.dimensions_width);
  if (unit === 'cm') { l *= 10; w *= 10; }
  if (unit === 'm') { l *= 1000; w *= 1000; }
  return (l * w) / 10000;
}

function YieldFromPlate({ groupName, consumptionDm2, groups }: { groupName: string; consumptionDm2: number; groups: any[] }) {
  const group = groups?.find((g: any) => g.name === groupName);
  const area = calcPlateAreaDm2(group);
  if (area <= 0 || consumptionDm2 <= 0) return null;
  const safeArea = parseSafeNumber(area);
  const safeConsumption = parseSafeNumber(consumptionDm2);
  const pairs = Math.floor(safeArea / safeConsumption);
  const aproveitamento = ((pairs * safeConsumption) / safeArea * 100).toFixed(1);
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono leading-tight">
      Placa: {safeArea.toFixed(1)} dm² → <span className="font-semibold text-primary">{pairs} pares/placa</span>
      <span className="ml-1 opacity-70">({aproveitamento}%)</span>
    </div>
  );
}

const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];

function getSizesForCategory(shoeCategory?: string): number[] {
  return shoeCategory === 'Infantil' ? CHILD_SIZES : ADULT_SIZES;
}

function parseSizesFromRange(sizesStr?: string, shoeCategory?: string): number[] {
  if (sizesStr && sizesStr.includes('-')) {
    const [start, end] = sizesStr.split('-').map(Number);
    if (!isNaN(start) && !isNaN(end) && start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return getSizesForCategory(shoeCategory);
}

const emptyMaterialForm: SheetMaterialFormData = {
  product_id: '', group_id: null, quantity_per_unit: 0, consumption_per_size: {}, color: '', width: '', weight: '', supplier: '', notes: '', sizes: '',
};

export default function TechnicalSheets({ embedded }: { embedded?: boolean } = {}) {
  const { data: sheets = [], isLoading } = useTechnicalSheets();
  const { data: stock = [] } = useReadyStock();
  // Map sheet_id -> array de variantes de material ativas. Usado pra exibir
  // badge na lista de fichas indicando que tem opções de material extra.
  const { data: materialVariantsBySheet } = useAllActiveReferenceMaterialVariants();
  const addSheet = useAddSheet();
  const deleteSheet = useDeleteSheet();
  const updateSheet = useUpdateSheet();

  const cloneSheet = useCloneSheet();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<string>('');
  const [cloneNewName, setCloneNewName] = useState<string>('');
  const [cloneSearchTerm, setCloneSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [imageDialogSheet, setImageDialogSheet] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [soleFilter, setSoleFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [bulkSoleApplying, setBulkSoleApplying] = useState(false);
  const [bulkSoleDialogOpen, setBulkSoleDialogOpen] = useState(false);
   const [bulkSoleSelected, setBulkSoleSelected] = useState<string>('');
    const [bulkSoleOverwrite, setBulkSoleOverwrite] = useState(false);

  // Distinct sole list from sheets (sorted, with count of reference sheets per sole)
  const soleOptions = useMemo(() => {
    const map = new Map<string, { total: number; refs: number }>();
    (sheets as any[]).forEach((s: any) => {
      if (!s.sole_material) return;
      const cur = map.get(s.sole_material) || { total: 0, refs: 0 };
      cur.total += 1;
      if (s.sole_consumption > 0 || s.sole_process || s.sole_group_id) cur.refs += 1;
      map.set(s.sole_material, cur);
    });
    return Array.from(map.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sheets]);

  const filteredSheets = useMemo(() => {
    let result = sheets;
    if (categoryFilter === 'Infantil') result = result.filter((s: any) => s.shoe_category === 'Infantil');
    else if (categoryFilter === 'Feminino') result = result.filter((s: any) => s.shoe_category !== 'Infantil');
    if (soleFilter !== 'all') {
      result = result.filter((s: any) => s.sole_material === soleFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter((s: any) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.code || '').toLowerCase().includes(q) ||
        (s.collection || '').toLowerCase().includes(q) ||
        (s.shoe_category || '').toLowerCase().includes(q) ||
        (s.colors || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.status || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [sheets, categoryFilter, soleFilter, searchTerm]);

  /** Open the bulk-sole dialog so the user can choose which sole to apply */
  const handleBulkApplySoleSettings = () => {
    if (filteredSheets.length === 0) {
      toast.error('Nenhuma ficha listada para aplicar');
      return;
    }
    if (soleOptions.length === 0) {
      toast.error('Nenhum solado cadastrado em fichas existentes');
      return;
    }
    setBulkSoleSelected('');
    setBulkSoleOverwrite(false);
    setBulkSoleDialogOpen(true);
  };

  /** Apply the selected sole (with reference patch) to all listed sheets */
  const runBulkApplySoleSettings = async () => {
    const soleName = bulkSoleSelected;
    if (!soleName) { toast.error('Selecione um solado'); return; }
    const overwrite = bulkSoleOverwrite;
    setBulkSoleApplying(true);
    let applied = 0;
    let skippedNoCandidate = 0;
    let skippedNoChange = 0;
    let failed = 0;
    try {
      const sheetsArr = filteredSheets as any[];
      const referenceCandidates = (sheets as any[])
        .filter((s: any) =>
          s.sole_material === soleName &&
          (s.sole_consumption > 0 || s.sole_process || s.sole_group_id)
        )
        .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      if (referenceCandidates.length === 0) {
        toast.error(`Nenhuma ficha de referência encontrada para o solado "${soleName}"`);
        setBulkSoleApplying(false);
        return;
      }

      const BATCH_SIZE = 5;
      for (let i = 0; i < sheetsArr.length; i += BATCH_SIZE) {
        const batch = sheetsArr.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (target) => {
          const isInfantil = target.shoe_category === 'Infantil';
          const src =
            referenceCandidates.find((s: any) => (isInfantil ? s.shoe_category === 'Infantil' : s.shoe_category !== 'Infantil') && s.id !== target.id) ||
            referenceCandidates.find((s: any) => s.id !== target.id) ||
            referenceCandidates[0];
          if (!src) { skippedNoCandidate++; return; }
          const patch: any = {};
          if (overwrite || !target.sole_material) {
            if (target.sole_material !== soleName) patch.sole_material = soleName;
          }
          if (src.sole_consumption > 0 && (overwrite || !target.sole_consumption)) {
            if (target.sole_consumption !== src.sole_consumption) patch.sole_consumption = src.sole_consumption;
          }
          if (src.sole_process && (overwrite || !target.sole_process)) {
            if (target.sole_process !== src.sole_process) patch.sole_process = src.sole_process;
          }
          if (src.sole_group_id && (overwrite || !target.sole_group_id)) {
            if (target.sole_group_id !== src.sole_group_id) patch.sole_group_id = src.sole_group_id;
          }
          if (Object.keys(patch).length === 0) { skippedNoChange++; return; }
          try {
            await updateSheet.mutateAsync({ id: target.id, ...patch });
            applied++;
          } catch (err) {
            console.error('Falha ao atualizar ficha', target.id, err);
            failed++;
          }
        }));
      }
      const parts = [`Solado "${soleName}" aplicado em ${applied} ficha(s).`];
      if (skippedNoCandidate) parts.push(`${skippedNoCandidate} sem ficha de referência.`);
      if (skippedNoChange) parts.push(`${skippedNoChange} já sincronizadas.`);
      if (failed) parts.push(`${failed} falharam.`);
      if (applied > 0) toast.success(parts.join(' '));
      else toast.warning(parts.join(' '));
      setBulkSoleDialogOpen(false);
    } catch (e: any) {
      toast.error('Erro ao aplicar em massa: ' + (e?.message || e));
    } finally {
      setBulkSoleApplying(false);
    }
  };

  if (isLoading) {
    return <><div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></>;
  }

  return (
    <>
      <div className="space-y-5 page-enter">
        <NonFiniteDevWatcher />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
             <h1 className="text-xl font-bold tracking-tight">Fichas Técnicas</h1>
             <p className="text-sm text-muted-foreground">Materiais, consumos e custos</p>
          </div>
          <div className="flex items-center gap-2">
            <SheetsAuditButton onJumpToSheet={(id) => setExpandedId(id)} />
            <Button
              variant="outline"
              onClick={handleBulkApplySoleSettings}
              disabled={bulkSoleApplying || filteredSheets.length === 0}
              className="gap-2"
              title="Aplica consumo, processo e grupo do solado em todas as fichas listadas, baseado em outras fichas que usam o mesmo solado"
            >
              {bulkSoleApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Aplicar Solado em Massa</span>
            </Button>
            <Button variant="outline" onClick={() => { setCloneSourceId(''); setCloneNewName(''); setCloneSearchTerm(''); setCloneDialogOpen(true); }} className="gap-2">
              <ClipboardCopy className="h-4 w-4" />
              <span className="hidden sm:inline">Copiar</span>
            </Button>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova Ficha</span>
            </Button>
          </div>
        </div>

         {!expandedId && (
           <GuidedPathSelector 
             sheets={sheets} 
             products={[]} 
             onSelect={(id) => setExpandedId(id)} 
           />
         )}
 
        {/* Bulk Apply Sole Dialog */}
        <Dialog open={bulkSoleDialogOpen} onOpenChange={setBulkSoleDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                Aplicar Solado em Massa
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">
                Aplicar em <span className="font-semibold text-foreground">{filteredSheets.length}</span> ficha(s) listada(s).
                Os dados (consumo, processo e grupo) serão copiados da ficha mais recente que utiliza o solado escolhido.
              </div>

              <div className="space-y-2">
                <Label>Solado a aplicar</Label>
                <Select value={bulkSoleSelected} onValueChange={setBulkSoleSelected}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um solado" />
                  </SelectTrigger>
                  <SelectContent>
                    {soleOptions.map(s => (
                      <SelectItem key={s.name} value={s.name} disabled={s.refs === 0}>
                        <span className="flex items-center justify-between gap-3 w-full">
                          <span>{s.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {s.refs > 0 ? `${s.refs} ref. disponível` : 'sem referência'}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Apenas solados com pelo menos uma ficha de referência (com consumo, processo ou grupo definidos) podem ser aplicados.
                </p>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-md border bg-muted/30">
                <Checkbox
                  id="bulk-sole-overwrite"
                  checked={bulkSoleOverwrite}
                  onCheckedChange={(v) => setBulkSoleOverwrite(!!v)}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="bulk-sole-overwrite" className="text-sm font-medium cursor-pointer">
                    Sobrescrever valores existentes
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Se desmarcado, apenas campos vazios serão preenchidos.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkSoleDialogOpen(false)} disabled={bulkSoleApplying}>
                Cancelar
              </Button>
              <Button onClick={runBulkApplySoleSettings} disabled={bulkSoleApplying || !bulkSoleSelected} className="gap-2">
                {bulkSoleApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {bulkSoleApplying ? 'Aplicando...' : 'Aplicar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, código, coleção..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { key: 'all', label: 'Todos' },
              { key: 'Feminino', label: 'Adulto' },
              { key: 'Infantil', label: 'Infantil' },
            ].map(f => (
              <Button
                key={f.key}
                variant={categoryFilter === f.key ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setCategoryFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
            <Select value={soleFilter} onValueChange={setSoleFilter}>
              <SelectTrigger className="h-8 text-xs w-[180px]">
                <Footprints className="h-3.5 w-3.5 mr-1 opacity-70" />
                <SelectValue placeholder="Filtrar por solado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os solados</SelectItem>
                {soleOptions.map(s => (
                  <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="text-xs font-mono ml-1">
              {filteredSheets.length}
            </Badge>
          </div>
        </div>

        {/* Empty State */}
        {filteredSheets.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 opacity-50" />
              </div>
              <p className="font-medium">{sheets.length === 0 ? 'Nenhuma ficha técnica cadastrada' : 'Nenhuma ficha encontrada'}</p>
              {sheets.length > 0 && <Button variant="link" onClick={() => { setCategoryFilter('all'); setSearchTerm(''); }}>Limpar filtros</Button>}
            </CardContent>
          </Card>
        ) : expandedId ? (
          /* ── Detail View ── */
          (() => {
             try {
               const sheet = filteredSheets.find((s: any) => s.id === expandedId);
               if (!sheet) {
                 return (
                   <Card className="border-dashed">
                     <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-4">
                       <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                         <AlertTriangle className="h-6 w-6 text-destructive" />
                       </div>
                       <div className="text-center">
                         <p className="font-semibold text-foreground">Ficha não encontrada</p>
                         <p className="text-sm">Não foi possível carregar os dados desta referência ou ela não existe mais.</p>
                       </div>
                       <Button variant="outline" onClick={() => setExpandedId(null)} className="gap-2">
                         <ArrowLeft className="h-4 w-4" />
                         Voltar para a Lista
                       </Button>
                     </CardContent>
                   </Card>
                 );
               }
               return (
                 <div className="space-y-4">
                   <div className="flex items-center gap-3">
                     <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setExpandedId(null)}>
                       <ArrowLeft className="h-4 w-4" /> Voltar à lista
                     </Button>
                     <Separator orientation="vertical" className="h-5" />
                     <div className="flex items-center gap-2 min-w-0">
                       {sheet.images && Array.isArray(sheet.images) && sheet.images.length > 0 ? (
                         <SignedImage src={String(sheet.images[0])} alt={sheet.name} className="h-8 w-8 rounded object-cover border shrink-0" />
                       ) : (
                         <div className="h-8 w-8 rounded bg-muted flex items-center justify-center border shrink-0">
                           <Package className="h-4 w-4 text-muted-foreground/40" />
                         </div>
                       )}
                        <div className="flex flex-col">
                          <h3 className="font-bold text-lg truncate leading-tight">{sheet.name}</h3>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase font-bold flex-wrap">
                            <span>{sheet.upper_material || 'Material s/ def.'}</span>
                            <ChevronRight className="h-2.5 w-2.5" />
                            <span className="text-primary truncate max-w-[150px]">{sheet.reference_color_variants?.[0]?.color || 'Sem cores'}</span>
                            <ChevronRight className="h-2.5 w-2.5" />
                            <span className="bg-primary/10 text-primary px-1 rounded">{globalFormatCurrency(sheet.sale_price || 0)}</span>
                          </div>
                        </div>
                        {sheet.code && <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">{sheet.code}</span>}
                        {/* Badge "tem variante de material" — sinaliza que essa ref pode ser
                            cadastrada no PV em N versões de material principal (Napa, Santorini,…) */}
                        {(materialVariantsBySheet?.get(sheet.id)?.length ?? 0) > 0 && (
                          <Badge variant="secondary" className="px-2 py-0 h-5 text-[10px] bg-amber-100 text-amber-800 border-amber-300 gap-1 shrink-0" title={materialVariantsBySheet!.get(sheet.id)!.map(v => v.material_name).join(', ')}>
                            <Package className="h-3 w-3" /> {materialVariantsBySheet!.get(sheet.id)!.length} Materiais
                          </Badge>
                        )}
                        {sheet.shoe_category && <Badge variant="outline" className="text-[10px] shrink-0">{sheet.shoe_category}</Badge>}
                     </div>
                   </div>
 
                   {/* ── Technical Summary & Completeness ── */}
                    <AppErrorBoundary
                      key={sheet.id}
                      fallbackTitle="Não foi possível abrir esta Ficha Técnica"
                    >
                      <SheetCompleteness sheet={sheet} />
                      <VariantOverviewHeader sheet={sheet} />
                      <Card>
                        <CardContent className="p-4 sm:p-6">
                          <SheetDetail sheet={sheet} onSaveSuccess={() => setExpandedId(null)} />
                        </CardContent>
                      </Card>
                    </AppErrorBoundary>
                 </div>
               );
             } catch (error) {
               console.error("Error rendering technical sheet detail:", error);
               return (
                 <Card className="border-destructive/20 bg-destructive/5">
                   <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-4">
                     <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                       <AlertTriangle className="h-6 w-6 text-destructive" />
                     </div>
                     <div className="text-center">
                       <p className="font-semibold text-foreground">Erro ao carregar Ficha Técnica</p>
                       <p className="text-sm">Ocorreu um erro inesperado ao processar os dados desta referência.</p>
                     </div>
                     <div className="flex gap-2">
                       <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
                         <RefreshCw className="h-4 w-4" />
                         Recarregar
                       </Button>
                       <Button onClick={() => setExpandedId(null)} className="gap-2">
                         <ArrowLeft className="h-4 w-4" />
                         Voltar para a Lista
                       </Button>
                     </div>
                   </CardContent>
                 </Card>
               );
              }
           })()
        ) : (
          /* ── List View (Table) ── */
          <div className="rounded-lg border bg-card overflow-hidden">
             <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-14" />
                  <TableHead className="font-semibold">Referência</TableHead>
                  <TableHead className="font-semibold">Código</TableHead>
                  <TableHead className="font-semibold hidden md:table-cell">Solado / Cabedal</TableHead>
                  <TableHead className="font-semibold">Categoria</TableHead>
                  <TableHead className="font-semibold">Ficha</TableHead>
                  <TableHead className="font-semibold text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSheets.map((sheet: any) => {
                  const statusFichaColors: Record<string, string> = {
                    publicada: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800',
                    validada: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
                    em_revisao: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
                    rascunho: 'bg-muted text-muted-foreground border-border',
                  };
                  return (
                    <TableRow
                      key={sheet.id}
                      className="cursor-pointer hover:bg-muted/60 transition-colors group"
                      onClick={() => setExpandedId(sheet.id)}
                    >
                      <TableCell className="px-3">
                        {sheet.images && Array.isArray(sheet.images) && sheet.images.length > 0 && typeof sheet.images[0] === 'string' ? (
                          <SignedImage src={sheet.images[0]} alt={sheet.name} className="h-10 w-10 rounded-md object-cover border bg-muted/30" />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center border">
                            <Package className="h-4 w-4 text-muted-foreground/30" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm flex items-center gap-1.5">
                            {sheet.name}
                            {(materialVariantsBySheet?.get(sheet.id)?.length ?? 0) > 0 && (
                              <Badge variant="secondary" className="px-1.5 py-0 h-4 text-[9px] bg-amber-100 text-amber-800 border-amber-300" title={materialVariantsBySheet!.get(sheet.id)!.map(v => v.material_name).join(', ')}>
                                <Package className="h-2.5 w-2.5 mr-0.5" /> {materialVariantsBySheet!.get(sheet.id)!.length} Materiais
                              </Badge>
                            )}
                          </span>
                          {sheet.collection && <span className="text-xs text-muted-foreground">{sheet.collection}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{sheet.code || '—'}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col gap-0.5">
                          {sheet.sole_material && (
                            <span className="text-[10px] text-muted-foreground">
                              <Footprints className="h-3 w-3 inline mr-1 opacity-60" />{sheet.sole_material}
                            </span>
                          )}
                          {sheet.upper_material && (
                            <span className="text-[10px] text-muted-foreground">
                              <Layers className="h-3 w-3 inline mr-1 opacity-60" />{sheet.upper_material}
                            </span>
                          )}
                          {!sheet.sole_material && !sheet.upper_material && (
                            <span className="text-[10px] text-muted-foreground/40">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-medium">
                          {sheet.shoe_category || 'Geral'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {sheet.status_ficha && (
                          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', statusFichaColors[sheet.status_ficha] || statusFichaColors.rascunho)}>
                            {STATUS_FICHA_LABELS[sheet.status_ficha] || sheet.status_ficha}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setImageDialogSheet(sheet); }}>
                            <ImagePlus className="h-3.5 w-3.5" />
                          </Button>
                          <DeleteConfirmButton onConfirm={() => deleteSheet.mutate(sheet.id)} title="Excluir ficha?" size="h-7 w-7" iconSize="h-3 w-3" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Ficha Técnica</DialogTitle>
          </DialogHeader>
          <QuickCreateForm onCreated={(id) => { setDialogOpen(false); setExpandedId(id); }} />
        </DialogContent>
      </Dialog>

      {/* Clone / Copy sheet dialog */}
      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCopy className="h-5 w-5 text-primary" />
              Copiar Ficha Técnica
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Ficha de Origem</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="Buscar por nome ou código..."
                  value={cloneSearchTerm}
                  onChange={e => setCloneSearchTerm(e.target.value)}
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
                {(sheets as any[])
                  .filter((s: any) => {
                    const q = cloneSearchTerm.toLowerCase();
                    return !q || s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q);
                  })
                  .slice(0, 30)
                  .map((s: any) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setCloneSourceId(s.id);
                        setCloneNewName(`Cópia de ${s.name || s.code || 'Ficha'}`);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                        cloneSourceId === s.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted/40'
                      }`}
                    >
                      <span className="truncate">{s.name || '(sem nome)'}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2 font-mono">{s.code}</span>
                    </button>
                  ))}
              </div>
            </div>

            {cloneSourceId && (
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Nome da Nova Ficha *</Label>
                <Input
                  className="h-9"
                  value={cloneNewName}
                  onChange={e => setCloneNewName(e.target.value)}
                  placeholder="Nome da nova referência..."
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Serão copiados: identificação, materiais (BOM), embalagens, mapeamentos de cor de solado e palmilha.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setCloneDialogOpen(false)}>Cancelar</Button>
              <Button
                disabled={!cloneSourceId || !cloneNewName.trim() || cloneSheet.isPending}
                onClick={async () => {
                  const newId = await cloneSheet.mutateAsync({ sourceId: cloneSourceId, newName: cloneNewName.trim() });
                  setCloneDialogOpen(false);
                  setExpandedId(newId);
                }}
              >
                {cloneSheet.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                Copiar Ficha
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!imageDialogSheet} onOpenChange={(open) => { if (!open) setImageDialogSheet(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alterar Foto — {imageDialogSheet?.name}</DialogTitle>
          </DialogHeader>
          {imageDialogSheet && (
            <SheetImageEditor sheet={imageDialogSheet} onSaved={() => setImageDialogSheet(null)} updateSheet={updateSheet} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SheetImageEditor({ sheet, onSaved, updateSheet }: { sheet: any; onSaved: () => void; updateSheet: ReturnType<typeof useUpdateSheet> }) {
  const currentImage = sheet.images && Array.isArray(sheet.images) && sheet.images.length > 0 ? sheet.images[0] : null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage);
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      setPreviewUrl(publicUrl);
    } catch (err: any) {
      toast.error(`Erro ao enviar imagem: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!previewUrl) return;
    updateSheet.mutate({ id: sheet.id, data: { images: [previewUrl] } as any }, {
      onSuccess: () => { toast.success('Foto atualizada!'); onSaved(); },
    });
  };

  return (
    <div className="space-y-4">
      {previewUrl ? (
        <div className="relative w-full h-64 rounded-lg border overflow-hidden bg-muted">
          <SignedImage src={previewUrl} alt={sheet.name} className="w-full h-full object-contain" />
          <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7"
            onClick={() => setPreviewUrl(null)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <label className="cursor-pointer w-full">
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          <div className="w-full h-48 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors">
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> : (
              <>
                <ImagePlus className="h-10 w-10 text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground">Clique para selecionar uma nova foto</span>
              </>
            )}
          </div>
        </label>
      )}
      {previewUrl && !uploading && (
        <label className="cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          <div className="text-sm text-primary hover:underline text-center">Escolher outra imagem</div>
        </label>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onSaved}>Cancelar</Button>
        <Button onClick={handleSave} disabled={!previewUrl || previewUrl === currentImage || updateSheet.isPending}>
          {updateSheet.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Salvar Foto
        </Button>
      </div>
    </div>
  );
}

function QuickCreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const addSheet = useAddSheet();
  const [form, setForm] = useState({ name: '', brand: '', model: '', code: '', shoe_category: '', gender: '', sizes: '33-41', status: 'Ativo', images: [] as string[] });
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      setForm(f => ({ ...f, images: [publicUrl] }));
      setPreviewUrl(publicUrl);
      toast.success('Imagem enviada!');
    } catch (err: any) {
      toast.error(`Erro ao enviar imagem: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await addSheet.mutateAsync(form);
    if (result) onCreated(result.id);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col gap-2">
          <Label>Foto do Produto</Label>
          {previewUrl ? (
            <div className="relative w-full h-40 rounded-lg border overflow-hidden bg-muted">
              <SignedImage src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
              <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6"
                onClick={() => { setPreviewUrl(null); setForm(f => ({ ...f, images: [] })); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <label className="cursor-pointer w-full">
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              <div className="w-full h-32 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors">
                {uploading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
                  <>
                    <Package className="h-8 w-8 text-muted-foreground/50" />
                    <span className="text-xs text-muted-foreground">Clique para adicionar foto</span>
                  </>
                )}
              </div>
            </label>
          )}
        </div>
        <div>
          <Label>Marca</Label>
          <Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="mt-1" placeholder="Ex: Squad Shoes" />
        </div>
        <div>
          <Label>Modelo</Label>
          <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="mt-1" placeholder="Ex: Air Max Style" />
        </div>
        <div className="col-span-2">
          <Label>Nome da Ficha / Referência</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" placeholder="Ex: Sandália MONALISA" />
        </div>
        <div>
          <Label>SKU / Código</Label>
          <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="mt-1 font-mono" placeholder="Ex: MON-893767-003" />
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={form.shoe_category} onValueChange={v => setForm(f => ({ ...f, shoe_category: v, sizes: v === 'Infantil' ? '25-36' : '34-40' }))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>{SHOE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Gênero</Label>
          <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Gênero" /></SelectTrigger>
            <SelectContent>{GENDERS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label className="mb-1.5 block">Grade de Numeração</Label>
          <div className="flex gap-2 mb-2">
            <Button type="button" variant={form.sizes === '34-40' || form.sizes === '33-41' ? 'default' : 'outline'} size="sm" className="gap-1.5"
              onClick={() => setForm(f => ({ ...f, sizes: '34-40' }))}>
              <Footprints className="h-3.5 w-3.5" /> Adulto (34-40)
            </Button>
            <Button type="button" variant={form.sizes === '25-36' ? 'default' : 'outline'} size="sm" className="gap-1.5"
              onClick={() => setForm(f => ({ ...f, sizes: '25-36' }))}>
              <Footprints className="h-3.5 w-3.5" /> Infantil (25-36)
            </Button>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="h-7 text-[10px] text-center px-1">BR</TableHead>
                  <TableHead className="h-7 text-[10px] text-center px-1">EU</TableHead>
                  <TableHead className="h-7 text-[10px] text-center px-1">US</TableHead>
                  <TableHead className="h-7 text-[10px] text-center px-1">UK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {getSizesForCategory(form.shoe_category).slice(0, 8).map(size => {
                    const mappings = getShoeSizeMappings(size);
                    return (
                      <TableCell key={size} className="p-0 border-r last:border-0">
                        <div className="grid grid-rows-4 text-[10px] font-mono">
                          <div className="px-2 py-0.5 border-b bg-primary/10 font-bold text-center">{mappings.br}</div>
                          <div className="px-2 py-0.5 border-b text-center">{mappings.eu}</div>
                          <div className="px-2 py-0.5 border-b text-center">{mappings.us}</div>
                          <div className="px-2 py-0.5 text-center">{mappings.uk}</div>
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="submit" disabled={addSheet.isPending || uploading}>Criar e Editar</Button>
      </div>
    </form>
  );
}

/* ===== Completeness Indicator ===== */
function SheetCompleteness({ sheet }: { sheet: any }) {
  const checks = [
    { label: 'Identificação', ok: !!(sheet.name && sheet.code && sheet.shoe_category), icon: Tag },
    { label: 'Foto', ok: !!(sheet.images && Array.isArray(sheet.images) && sheet.images.length > 0 && sheet.images[0]), icon: ImagePlus },
    { label: 'Solado', ok: !!sheet.sole_material, icon: Footprints },
    { label: 'Cabedal', ok: !!sheet.upper_material, icon: Layers },
    { label: 'Forração', ok: !!sheet.lining_material, icon: Scissors },
    { label: 'Palmilha', ok: !!sheet.insole_material, icon: Shield },
    { label: 'Setores', ok: !!(sheet.production_sectors && sheet.production_sectors.length > 0), icon: Factory },
    { label: 'Status', ok: sheet.status_ficha === 'publicada' || sheet.status_ficha === 'validada', icon: Check },
  ];
  const completed = checks.filter(c => c.ok).length;
  const pct = Math.round((completed / checks.length) * 100);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs font-semibold text-muted-foreground">Preenchimento da Ficha</span>
          <Badge variant={pct === 100 ? 'default' : pct >= 60 ? 'secondary' : 'destructive'} className="text-[10px] font-mono">
            {pct}%
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{completed}/{checks.length} itens</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct === 100 ? 'bg-green-500' : pct >= 60 ? 'bg-primary' : 'bg-amber-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checks.map(c => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors',
                c.ok
                  ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
                  : 'bg-muted/50 text-muted-foreground border-border'
              )}
            >
              {c.ok ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3 opacity-50" />}
              {c.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== SHEET DETAIL (all tabs) ===== */
function SheetDetail({ sheet, onSaveSuccess }: { sheet: any; onSaveSuccess: () => void }) {
  const queryClient = useQueryClient();
  const updateSheet = useUpdateSheet();
  const { data: products = [] } = useProducts();
  const { data: sheetMaterials = [] } = useSheetMaterials(sheet.id);
  const { data: soleColorMappings = [] } = useSoleColorMappings(sheet.id);
  const upsertSoleColor = useUpsertSoleColorMapping();
   const { data: palmilhaColorMappings = [] } = usePalmilhaColorMappings(sheet.id);
   const upsertPalmilhaColor = useUpsertPalmilhaColorMapping();
   const { data: liningColorMappings = [] } = useLiningColorMappings(sheet.id);
   const upsertLiningColor = useUpsertLiningColorMapping();
    const bulkAddMaterials = useBulkAddSheetMaterials();
    const [isSoleFachetado, setIsSoleFachetado] = useState(false);
 
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: allSheets = [] } = useTechnicalSheets();
  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_for_straps'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, dimensions_length, dimensions_width, dimensions_unit, box_type_id').order('name');
      if (error) {
        console.error('[TechnicalSheets] Falha ao carregar product_groups:', error);
        return [];
      }
      return data ?? [];
    },
  });
  const [form, setForm] = useState<SheetFormData>(() => {
    const f = { ...emptySheetForm };
    Object.keys(f).forEach(key => {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    });
    // Hidrata campos extras que existem no DB mas não no emptySheetForm
    // (ex.: fachete_material, fachete_consumption, fachete_consumption_per_size).
    // Sem isso, ao abrir uma ficha existente os valores desses campos sumiam
    // do form e qualquer save os zerava.
    const EXTRA_DB_FIELDS = [
      'fachete_material', 'fachete_consumption', 'fachete_consumption_per_size',
      'lead_time_corte_dias', 'lead_time_costura_dias', 'lead_time_silk_dias',
      'lead_time_colagem_dias', 'lead_time_montagem_dias',
      'lead_time_acabamento_dias', 'lead_time_expedicao_dias',
      'lead_time_buffer_material_dias',
      'cutting_capacity_per_day', 'sewing_capacity_per_day',
      'silk_capacity_per_day', 'gluing_capacity_per_day',
      'assembly_capacity_per_day', 'soling_capacity_per_day',
      'expedition_capacity_per_day', 'finishing_capacity_per_day',
      'costura_capacity_per_day',
      'production_sectors', 'shoe_category_id', 'primary_sole_id',
      'assembly_time_minutes', 'process_difficulty',
    ];
    for (const key of EXTRA_DB_FIELDS) {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    }
    return f;
  });
  const [dirty, setDirty] = useState(false);

  // Quando o sheet prop muda (após re-fetch pós-save), sincroniza form pra
  // refletir os dados frescos do banco — antes o useState init só rodava
  // 1x e ignorava mudanças subsequentes, deixando a UI defasada.
  React.useEffect(() => {
    if (dirty) return; // não sobrescreve mudanças não-salvas do usuário
    const f = { ...emptySheetForm };
    Object.keys(f).forEach(key => {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    });
    const EXTRA = [
      'fachete_material','fachete_consumption','fachete_consumption_per_size',
      'lead_time_corte_dias','lead_time_costura_dias','lead_time_silk_dias',
      'lead_time_colagem_dias','lead_time_montagem_dias',
      'lead_time_acabamento_dias','lead_time_expedicao_dias',
      'lead_time_buffer_material_dias','cutting_capacity_per_day',
      'sewing_capacity_per_day','silk_capacity_per_day','gluing_capacity_per_day',
      'assembly_capacity_per_day','soling_capacity_per_day',
      'expedition_capacity_per_day','finishing_capacity_per_day',
      'costura_capacity_per_day','production_sectors','shoe_category_id',
      'primary_sole_id','assembly_time_minutes','process_difficulty',
    ];
    for (const key of EXTRA) {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    }
    setForm(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id, sheet.updated_at]);

  // Set de campos recentemente importados/auto-preenchidos. Cada entrada
  // some sozinha após 2s. Usado pra aplicar flash verde nas linhas/inputs
  // que receberam valor de "Puxar do Solado" ou autoFillFromSoleSpecs.
  const [flashFields, setFlashFields] = useState<Set<string>>(new Set());
  const flashField = (key: string) => {
    setFlashFields(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setTimeout(() => {
      setFlashFields(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 2_000);
  };

    const updateField = (key: keyof SheetFormData, value: any) => {
      setForm(f => ({ ...f, [key]: value }));
      setDirty(true);
    };

    React.useEffect(() => {
      if (form.sole_material && products.length > 0) {
        const soleProd = products.find((p: any) => p.name + (p.color ? ` (${p.color})` : '') === form.sole_material || p.name === form.sole_material);
        if (soleProd) {
          setIsSoleFachetado(!!soleProd.is_fachetado);
        }
      }
    }, [form.sole_material, products, form.shoe_category]);

  /** Auto-fill consumption from last sheet that used the same group, filtered by adult/infantil */
  const autoFillConsumption = (groupName: string, materialField: 'upper_material' | 'lining_material' | 'insole_material') => {
    const consumptionField = materialField === 'upper_material' ? 'upper_consumption'
      : materialField === 'lining_material' ? 'lining_consumption' : 'insole_consumption';

    const isInfantil = form.shoe_category === 'Infantil';
    const candidates = allSheets
      .filter((s: any) =>
        s.id !== sheet.id &&
        s[materialField] === groupName &&
        s[consumptionField] > 0 &&
        (isInfantil ? s.shoe_category === 'Infantil' : s.shoe_category !== 'Infantil')
      )
      .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    if (candidates.length > 0) {
      const lastConsumption = candidates[0][consumptionField];
      if (lastConsumption > 0) {
        updateField(consumptionField, lastConsumption);
        toast.info(`Consumo preenchido automaticamente: ${safeToFixed(lastConsumption, 4)} dm²/par (baseado em "${candidates[0].name}")`);

        if (materialField === 'lining_material' && Array.isArray(candidates[0].lining_accessories) && (candidates[0].lining_accessories as any[]).length > 0) {
          updateField('lining_accessories' as any, candidates[0].lining_accessories);
        }
        if (materialField === 'upper_material' && Array.isArray(candidates[0].components_accessories) && (candidates[0].components_accessories as any[]).length > 0) {
          updateField('components_accessories', candidates[0].components_accessories);
        }
      }
    }
  };

  /** Auto-fill sole specs from last sheet that used the same sole_material, filtered by adult/infantil */
  const autoFillSole = async (soleName: string) => {
    const isInfantil = form.shoe_category === 'Infantil';
    const candidates = allSheets
      .filter((s: any) =>
        s.id !== sheet.id &&
        s.sole_material === soleName &&
        (isInfantil ? s.shoe_category === 'Infantil' : s.shoe_category !== 'Infantil')
      )
      .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    if (candidates.length > 0) {
      const src = candidates[0];
      const filled: string[] = [];
      if (src.sole_consumption > 0) {
        updateField('sole_consumption', src.sole_consumption);
        filled.push(`consumo: ${src.sole_consumption}`);
      }
      if (src.sole_process) {
        updateField('sole_process', src.sole_process);
        filled.push(`processo: ${src.sole_process}`);
      }
      if (src.sole_group_id) {
        updateField('sole_group_id', src.sole_group_id);
        
        // Auto-fill box if the sole product has one
        const product = products.find((p: any) => p.name + (p.color ? ` (${p.color})` : '') === soleName);
        if (product?.box_type_id) {
          updateField('box_type_id', product.box_type_id);
          filled.push(`caixa: ${product.box_type_id}`);
        }
      }
      if (filled.length > 0) {
        toast.info(`Configurações de solado aplicadas: ${filled.join(', ')}`);
      }
    }
  };

  const autoFillPackagingFromSole = async (soleProductId: string) => {
    if (!sheet?.id) return;
    try {
      // Fetch packaging associations from sole_structures
      const { data: structures } = await supabase
        .from('sole_structures')
        .select('component_type, default_material_id')
        .eq('sole_id', soleProductId)
        .in('component_type', ['Embalagem Individual', 'Embalagem Colmeia', 'Embalagem Master']);

      if (!structures || structures.length === 0) return;

      const typeMap: Record<string, string> = {
        'Embalagem Individual': 'individual',
        'Embalagem Colmeia': 'colmeia',
        'Embalagem Master': 'master',
      };

      // Fetch box details for each packaging
      const boxIds = structures.filter(s => s.default_material_id).map(s => s.default_material_id!);
      if (boxIds.length === 0) return;

      const { data: boxes } = await supabase
        .from('box_types')
        .select('id, nome, comprimento_cm, largura_cm, altura_cm, peso_kg, unit_price, supplier_id')
        .in('id', boxIds);

      if (!boxes || boxes.length === 0) return;

      // Check existing packaging_configs for this sheet to avoid duplicates
      const { data: existingConfigs } = await supabase
        .from('packaging_configs')
        .select('packaging_type, box_type_id')
        .eq('sheet_id', sheet.id);

      const existingSet = new Set((existingConfigs || []).map(c => `${c.packaging_type}_${c.box_type_id}`));

      let added = 0;
      for (const struct of structures) {
        if (!struct.default_material_id) continue;
        const pkgType = typeMap[struct.component_type];
        if (!pkgType) continue;

        const dedupKey = `${pkgType}_${struct.default_material_id}`;
        if (existingSet.has(dedupKey)) continue;

        const box = boxes.find(b => b.id === struct.default_material_id);
        if (!box) continue;

        const defaultPairs = pkgType === 'individual' ? 1 : 12;
        const { error } = await supabase.from('packaging_configs').insert({
          sheet_id: sheet.id,
          packaging_type: pkgType,
          box_type_id: box.id,
          pairs_per_box: defaultPairs,
          nome: box.nome,
          comprimento_cm: box.comprimento_cm,
          largura_cm: box.largura_cm,
          altura_cm: box.altura_cm,
          peso_kg: box.peso_kg || 0,
          cost_per_unit: box.unit_price || 0,
          supplier_id: box.supplier_id || null,
        } as any);
        if (!error) added++;
      }

      if (added > 0) {
        queryClient.invalidateQueries({ queryKey: ['packaging_configs', sheet.id] });
        toast.success(`${added} embalagem(ns) vinculada(s) automaticamente do solado!`);
      }
    } catch (err: any) {
      console.error("Error auto-filling packaging:", err);
    }
  };

  const autoFillFromSoleSpecs = async (soleProductId: string) => {
    if (!soleProductId) return;
    try {
      // 1. Try sole_technical_specs first (direct per-sole specs)
      const { data: specs } = await supabase
        .from('sole_technical_specs')
        .select('size, lining_consumption_dm2, insole_consumption_dm2')
        .eq('sole_id', soleProductId);

      const hasDirectSpecs = specs && specs.some(s => s.lining_consumption_dm2 !== null || s.insole_consumption_dm2 !== null);

      if (hasDirectSpecs) {
        const liningMap: Record<string, number> = {};
        const insoleMap: Record<string, number> = {};
        specs!.forEach(s => {
          if (s.lining_consumption_dm2 !== null) liningMap[String(s.size)] = Number(s.lining_consumption_dm2);
          if (s.insole_consumption_dm2 !== null) insoleMap[String(s.size)] = Number(s.insole_consumption_dm2);
        });
        const liningVals = Object.values(liningMap);
        const insoleVals = Object.values(insoleMap);
        if (liningVals.length > 0) {
          updateField('lining_consumption', Number((liningVals.reduce((a, b) => a + b, 0) / liningVals.length).toFixed(4)));
          updateField('lining_consumption_per_size', liningMap);
          flashField('lining_consumption_per_size');
        }
        if (insoleVals.length > 0) {
          updateField('insole_consumption', Number((insoleVals.reduce((a, b) => a + b, 0) / insoleVals.length).toFixed(4)));
          updateField('insole_consumption_per_size', insoleMap);
          flashField('insole_consumption_per_size');
        }
        toast.success("Consumos técnicos do solado aplicados com sucesso!");
        return;
      }

      // 2. Fallback: pull from component_sheets.yield_per_sole for the lining/insole groups
      const liningGroupName = form.lining_material;
      const insoleGroupName = form.insole_material;
      const groupNames = [liningGroupName, insoleGroupName].filter(Boolean);

      if (groupNames.length === 0) {
        toast.info("Selecione os grupos de Forração e/ou Palmilha primeiro.");
        return;
      }

      // Find group IDs
      const matchedGroups = (groups || []).filter((g: any) => groupNames.includes(g.name));
      if (matchedGroups.length === 0) {
        toast.info("Nenhum grupo de material encontrado para puxar consumos.");
        return;
      }

      const groupIds = matchedGroups.map((g: any) => g.id);
      const { data: csData } = await supabase
        .from('component_sheets')
        .select('product_id, yield_per_sole, products!inner(group_id)')
        .in('group_id', groupIds);

      if (!csData || csData.length === 0) {
        toast.info("Nenhuma ficha de componentes encontrada. Configure o consumo por solado na edição do grupo em Estoque.");
        return;
      }

      let liningApplied = false;
      let insoleApplied = false;

      // For each group, find the yield_per_sole entry for this soleProductId
      for (const cs of csData) {
        const yps = cs.yield_per_sole as Record<string, Record<string, number>> | null;
        if (!yps || !yps[soleProductId]) continue;

        const sizeMap = yps[soleProductId];
        const vals = Object.values(sizeMap).filter(v => Number(v) > 0);
        if (vals.length === 0) continue;

        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const productGroupId = (cs as any).products?.group_id;

        const liningGroup = matchedGroups.find((g: any) => g.name === liningGroupName);
        const insoleGroup = matchedGroups.find((g: any) => g.name === insoleGroupName);

        if (liningGroup && productGroupId === liningGroup.id && !liningApplied) {
          updateField('lining_consumption', Number(avg.toFixed(4)));
          updateField('lining_consumption_per_size', sizeMap);
          flashField('lining_consumption_per_size');
          liningApplied = true;
        }
        if (insoleGroup && productGroupId === insoleGroup.id && !insoleApplied) {
          updateField('insole_consumption', Number(avg.toFixed(4)));
          updateField('insole_consumption_per_size', sizeMap);
          flashField('insole_consumption_per_size');
          insoleApplied = true;
        }
      }

      if (liningApplied || insoleApplied) {
        const parts = [];
        if (liningApplied) parts.push('forração');
        if (insoleApplied) parts.push('palmilha');
        toast.success(`Consumos de ${parts.join(' e ')} aplicados do grupo!`);
      } else {
        toast.info("Consumo para este solado não encontrado nas fichas de componentes. Configure na edição do grupo em Estoque.");
      }

      // 3. Pull packaging associations from sole_structures
      await autoFillPackagingFromSole(soleProductId);
    } catch (err: any) {
      console.error("Error auto-filling from sole specs:", err);
      toast.error("Erro ao puxar dados do solado: " + err.message);
    }
  };

   /**
    * Auto-fills standard sole items (glue, thread, EVA, etc) into the BOM
    * based on the selected sole product.
    */
   const autoFillStandardItemsFromSole = async (soleProductId: string) => {
     try {
       // Resolve o solado (pra obter group_id e sole_classification)
       const soleProd = (products as any[]).find(p => p.id === soleProductId);
       const soleGroupId = soleProd?.group_id;
       const soleClass = soleProd?.sole_classification as 'tradicional' | 'palmilha_pronta' | 'conjugado' | undefined;

       // CAMINHO NOVO (Fase 1+ reformulação): sole_standard_materials POR GRUPO
       // com filtro applies_to vs sole_classification. Tem prioridade sobre
       // os caminhos legacy abaixo.
       let standardByGroup: any[] = [];
       if (soleGroupId) {
         const { data } = await (supabase as any)
           .from('sole_standard_materials')
           .select('material_product_id, consumption_per_pair, unit_override, applies_to, notes, products!material_product_id(group_id, color, unit)')
           .eq('sole_group_id', soleGroupId);
         standardByGroup = (data || []).filter((row: any) => {
           const a = row.applies_to;
           if (a === 'any') return true;
           if (!soleClass) return false;
           if (a === 'palmilha_cortada') return soleClass === 'tradicional' || soleClass === 'conjugado';
           if (a === 'palmilha_pronta') return soleClass === 'palmilha_pronta';
           return false;
         });
       }

       // Mantém legacy: 1) sole_standard_items_consumption (por tamanho)
       const { data: standardCons, error: consError } = await supabase
         .from('sole_standard_items_consumption')
         .select('standard_item_id, size, consumption, unit')
         .eq('sole_product_id', soleProductId);
       if (consError) throw consError;

       // 2) Items globais (legacy is_standard_sole_item)
      const { data: globalStandardItems, error: globalError } = await supabase.from('products')
        .select('id, name, group_id, unit_price, unit, category')
        .or('is_standard_sole_item.eq.true,category.eq.Solado,category.eq.Componente')
        .eq('active', true);

       if (globalError) throw globalError;

       if (
         standardByGroup.length === 0 &&
         (!standardCons || standardCons.length === 0) &&
         (!globalStandardItems || globalStandardItems.length === 0)
       ) {
         return;
       }

       const newMaterials: any[] = [];
       const existingProductIds = new Set(sheetMaterials.map((m: any) => m.product_id));

       // NOVO CAMINHO: insere os materiais padrão do grupo (por par)
       for (const row of standardByGroup) {
         const pid = row.material_product_id;
         if (existingProductIds.has(pid)) continue;
         newMaterials.push({
           product_id: pid,
           group_id: row.products?.group_id,
           quantity_per_unit: Number(row.consumption_per_pair) || 0,
           consumption_per_size: {},
           color: row.products?.color || '',
           notes: row.notes || `Padrão do solado (${row.applies_to === 'any' ? 'sempre' : row.applies_to})`,
           sizes: form.sizes,
         });
         existingProductIds.add(pid);
       }

       // Process specific sole standard items first
       if (standardCons && standardCons.length > 0) {
         const itemsMap = new Map<string, { unit: string; bySize: Record<string, number> }>();
         standardCons.forEach(c => {
           const entry = itemsMap.get(c.standard_item_id) || { unit: c.unit, bySize: {} };
           entry.bySize[String(c.size)] = Number(c.consumption);
           itemsMap.set(c.standard_item_id, entry);
         });

         for (const [productId, info] of itemsMap.entries()) {
           if (existingProductIds.has(productId)) continue;
           const prod = (products as any[]).find(p => p.id === productId);
           if (!prod) continue;

           const avg = Object.values(info.bySize).reduce((a, b) => a + b, 0) / Object.values(info.bySize).length;
           newMaterials.push({
             product_id: productId,
             group_id: prod.group_id,
             quantity_per_unit: Number(avg.toFixed(4)),
             consumption_per_size: info.bySize,
             color: prod.color || '',
             notes: 'Item padrão do solado',
             sizes: form.sizes
           });
           existingProductIds.add(productId);
         }
       }

       // Process global standard items (fixed consumption 1 or based on category)
       if (globalStandardItems && globalStandardItems.length > 0) {
         globalStandardItems.forEach(item => {
           if (existingProductIds.has(item.id)) return;
           newMaterials.push({
             product_id: item.id,
             group_id: item.group_id,
             quantity_per_unit: 1, // Default to 1 unit
             consumption_per_size: {},
             color: '',
             notes: 'Item padrão global',
             sizes: form.sizes
           });
           existingProductIds.add(item.id);
         });
       }

         if (newMaterials.length > 0) {
           bulkAddMaterials.mutate({ sheetId: sheet.id, materials: newMaterials });
           const fromNew = standardByGroup.length;
           const fromLegacy = newMaterials.length - fromNew;
           if (fromNew > 0 && fromLegacy === 0) {
             toast.success(`${fromNew} material(is) padrão do solado adicionados ao BOM.`);
           } else if (fromNew > 0 && fromLegacy > 0) {
             toast.success(`${fromNew} do cadastro do solado + ${fromLegacy} legados adicionados ao BOM.`);
           } else {
             toast.success(`${newMaterials.length} item(ns) padrão adicionados ao BOM.`);
           }
         }
     } catch (err: any) {
       console.error("Error auto-filling standard items:", err);
     }
   };

   /**
    * Puxa a grade do solado (yield_per_size do component_sheet do solado)
    * para preencher a grade de consumo por numeração de qualquer item de cabedal.
    * Retorna mapa { '33': 0.28, '34': 0.30, ... } em metros/par.
    */
   const fetchSoleGradeForCabedal = async (): Promise<Record<string, number> | null> => {
    if (!form.sole_group_id) {
      toast.error("Selecione o Grupo de Solado primeiro.");
      return null;
    }
    try {
      const soleProduct = (products || []).find((p: any) => p.group_id === form.sole_group_id);
      if (!soleProduct) {
        toast.error("Produto do solado não localizado.");
        return null;
      }

      // Try sole_technical_specs first (per-size consumption_dm2 → convert to template grid)
      const { data: specs } = await supabase
        .from('sole_technical_specs')
        .select('size')
        .eq('sole_id', soleProduct.id);

      const sizes = parseSizesFromRange(form.sizes, form.shoe_category);
      const grid: Record<string, number> = {};
      sizes.forEach(s => { grid[String(s)] = 0; });

      if (specs && specs.length > 0) {
        // Just fill the grid template with sizes that exist in sole specs (value 0 for user to fill)
        const knownSizes = new Set(specs.map(s => String(s.size)));
        sizes.forEach(s => {
          if (knownSizes.has(String(s))) grid[String(s)] = 0;
        });
        return grid;
      }

      return grid;
    } catch (err: any) {
      console.error("Error fetching sole grade:", err);
      toast.error("Erro ao puxar grade do solado: " + err.message);
      return null;
    }
  };

  const saveAll = async () => {
    try {
      await updateSheet.mutateAsync({ id: sheet.id, data: form });
      setDirty(false);
      onSaveSuccess();
    } catch (err) {
      // toast is already handled by the hook
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

  // Compute material cost from BOM (uses per-size average when available)
  const materialCost = useMemo(() => {
    if (!sheetMaterials.length) return 0;
    const csMap: Record<string, any> = {};
    componentSheets.forEach((cs: any) => { csMap[cs.product_id] = cs; });
    let total = 0;
    sheetMaterials.forEach((m: any) => {
      const cs = csMap[m.product_id];
      const unitPrice = Number(m.products?.unit_price || 0);
      const wastePct = cs ? (cs.waste_pct || 0) : 0;
      // Use average from per-size consumption when available
      const perSize = m.consumption_per_size as Record<string, number> | null;
      let avgConsumption = Number(m.quantity_per_unit);
      if (perSize && Object.keys(perSize).length > 0) {
        const vals = Object.values(perSize).filter(v => Number(v) > 0);
        if (vals.length > 0) {
          avgConsumption = vals.reduce((a, b) => a + Number(b), 0) / vals.length;
        }
      }
      total += avgConsumption * unitPrice * (1 + wastePct / 100);
    });
    return total;
  }, [sheetMaterials, componentSheets]);

  return (
    <div className="space-y-4">
      {/* Sticky toolbar: identidade da ficha + ações sempre visíveis */}
      <div className="sticky top-2 z-30 bg-background/95 backdrop-blur-md border rounded-lg shadow-md">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="bg-primary/10 p-1.5 rounded-md shrink-0">
              <Tag className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm truncate">{form.name || sheet.name || '(sem nome)'}</span>
                {form.code && form.code !== form.name && (
                  <Badge variant="outline" className="text-[10px] h-4.5 font-mono">{form.code}</Badge>
                )}
                {form.shoe_category && (
                  <Badge variant="secondary" className="text-[10px] h-4.5">{form.shoe_category}</Badge>
                )}
                {form.status_ficha && (
                  <Badge
                    className={cn(
                      'text-[10px] h-4.5 uppercase tracking-wider',
                      form.status_ficha === 'publicada' && 'bg-emerald-500/15 text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800',
                      form.status_ficha === 'em_revisao' && 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800',
                      form.status_ficha === 'rascunho' && 'bg-muted text-muted-foreground border-border',
                    )}
                  >
                    {form.status_ficha === 'publicada' ? 'Publicada' : form.status_ficha === 'em_revisao' ? 'Em Revisão' : 'Rascunho'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                {form.ncm && (
                  <span className="font-mono">
                    NCM <span className={cn('font-bold', /^\d{8}$/.test(form.ncm) ? 'text-foreground' : 'text-amber-600')}>{form.ncm}</span>
                  </span>
                )}
                {form.sole_material && (
                  <span>Solado: <span className="font-semibold text-foreground">{form.sole_material}</span></span>
                )}
                <span>Materiais: <span className="font-semibold text-foreground">{sheetMaterials.length}</span></span>
                <span>Custo/par: <span className="font-mono font-bold text-foreground">{formatCurrency(materialCost)}</span></span>
              </div>
            </div>
          </div>
          <div className="shrink-0">
            {dirty ? (
              <Button size="sm" onClick={saveAll} disabled={updateSheet.isPending} className="gap-1.5 h-8">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <Save className="h-3.5 w-3.5" /> Salvar
              </Button>
            ) : (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Salvo
              </span>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="id">
        <TabsList className="flex flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible h-auto gap-1 bg-muted/50 p-1.5 rounded-lg border">
          <TabsTrigger value="id" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5"><Tag className="h-3.5 w-3.5" /> Identificação</TabsTrigger>
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          <TabsTrigger value="engineering" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Wrench className="h-3.5 w-3.5" /> BOM, Consumo & Custos
          </TabsTrigger>
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          <TabsTrigger value="production" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Factory className="h-3.5 w-3.5" /> Fluxo de Produção
          </TabsTrigger>
          <Separator orientation="vertical" className="h-5 mx-0.5" />
           <TabsTrigger value="media" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5"><History className="h-3.5 w-3.5" /> Fotos & Histórico</TabsTrigger>
           <Separator orientation="vertical" className="h-5 mx-0.5" />
           <TabsTrigger value="variants" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
             <Palette className="h-3.5 w-3.5" /> Variantes
           </TabsTrigger>
           <Separator orientation="vertical" className="h-5 mx-0.5" />
           <TabsTrigger value="costs" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
             <DollarSign className="h-3.5 w-3.5" /> Preço de Custo
           </TabsTrigger>
        </TabsList>


        {/* TAB: Identificação */}
        <TabsContent value="id" className="mt-4 space-y-6">
          <SectionTitle>Identificação do Produto</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <FieldInput label="SKU / Código (modelo_id)" value={form.code} onChange={v => updateField('code', v)} placeholder="MON-893767-003" mono />
            <FieldInput label="Nome do Modelo" value={form.name} onChange={v => updateField('name', v)} placeholder="Sandália MONALISA" />
            <FieldSelect 
              label="Categoria" 
              value={form.shoe_category} 
              onChange={v => {
                updateField('shoe_category', v);
                // Auto-sync sizes grid from category (Adulto 34-40 / Infantil 25-36)
                updateField('sizes', v === 'Infantil' ? '25-36' : '34-40');
              }} 
              options={[...SHOE_CATEGORIES]} 
              placeholder="Tipo" 
            />
            <FieldSelect label="Gênero" value={form.gender} onChange={v => updateField('gender', v)} options={[...GENDERS]} placeholder="Gênero" />
            <FieldSelect label="Status Produção" value={form.status} onChange={v => updateField('status', v)} options={[...STATUSES]} />
            {/* "Modelo de Caixa" removido em 2026-05: o sistema deriva a
                embalagem automaticamente do solado vinculado (sole_structures
                → packaging_configs) — não há motivo pra forçar seleção manual
                aqui. A coluna box_type_id continua no DB pra retrocompatibilidade
                e pode ser usada via PackagingTab quando necessário. */}
          </div>
          {/* Grade derivada automaticamente da Categoria + Solado */}
          <div className="rounded-md border bg-muted/30 p-3 flex items-center gap-3 text-xs">
            <Footprints className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Grade de Numeração</span>
              <div className="text-sm font-mono text-foreground mt-0.5">
                {form.sizes || (form.shoe_category === 'Infantil' ? '25-36' : '34-40')}
                <span className="text-muted-foreground text-[10px] ml-2 font-sans normal-case">
                  (derivada da categoria{form.sole_material ? ` e do solado "${form.sole_material}"` : ''})
                </span>
              </div>
            </div>
          </div>
          <Separator />
          <SectionTitle>Status da Ficha & Revisão</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Status da Ficha</Label>
              <Select value={form.status_ficha || 'rascunho'} onValueChange={v => updateField('status_ficha', v)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_FICHA.map(s => (
                    <SelectItem key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full',
                          s === 'rascunho' ? 'bg-muted-foreground' :
                          s === 'em_revisao' ? 'bg-amber-500' :
                          s === 'validada' ? 'bg-blue-500' : 'bg-green-500'
                        )} />
                        {STATUS_FICHA_LABELS[s]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
             <div>
               <Label className="text-xs text-muted-foreground">Overhead Customizado (R$/par)</Label>
                <div className="relative">
                  <NumberInput 
                    value={(form as any).custom_overhead ?? ''} 
                    onChange={v => {
                      if (v !== null && v < 0) {
                        toast.error("O overhead não pode ser negativo");
                        return;
                      }
                      updateField('custom_overhead' as any, v);
                    }} 
                    className={cn(
                      "mt-1 h-9 text-sm font-mono",
                      (form as any).custom_overhead < 0 && "border-destructive focus-visible:ring-destructive"
                    )} 
                    placeholder="Padrão global" 
                    step="0.01" 
                    min={0}
                  />
                  {(form as any).custom_overhead < 0 && (
                    <span className="text-[10px] text-destructive absolute -bottom-4 left-0">Valor inválido</span>
                  )}
                </div>
               <p className="text-[10px] text-muted-foreground mt-1">Se vazio, usa o overhead global.</p>
             </div>
          </div>
          {form.status_ficha === 'publicada' && (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-700 dark:text-green-400">
                Ficha publicada — campos críticos (cor e material) estão bloqueados. Para alterar, mude o status para "Em Revisão" com justificativa.
              </span>
            </div>
          )}
          <Separator />
          <SectionTitle>Foto do Produto</SectionTitle>
          <SheetImageUpload images={form.images} onChange={(imgs) => updateField('images', imgs)} />
          <Separator />

          {materialCost > 0 && (
            <>
              <Separator />
              <SectionTitle>Custo de Produção (Material)</SectionTitle>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Custo total de materiais (BOM)</span>
                  </div>
                  <span className="text-lg font-bold font-mono text-foreground">{formatCurrency(materialCost)}</span>
                </div>
              </div>
            </>
          )}
        </TabsContent>


        {/* TAB: Engenharia (BOM, Consumo & Custos) */}
        <TabsContent value="engineering" className="mt-4 space-y-6">

          {/* ═══ SECTION 0: Grupo de Solado (driver técnico central) ═══
              Visual reforçado — solado é o item principal: borda 2px, sombra,
              tipografia forte, fundo gradiente sutil. Materiais "padrão"
              herdados desse solado caem direto no BOM ao selecionar. */}
          <div className="rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-primary/15 p-2 rounded-lg">
                <Footprints className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Solado · Item Principal do Modelo</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Define grade, classificação (tradicional/palmilha pronta/conjugado) e materiais de consumo padrão (cola, linha, forração…). Tudo aplicado ao BOM ao salvar.
                </p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground ml-auto">
                Driver técnico
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              O solado define a estrutura base do produto: fôrma, numeração, consumo de palmilha e forração. Selecione o grupo de solado antes de preencher os demais materiais.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <SoleProductSelect
                label="Solado"
                value={form.sole_material || ''}
                onChange={(productName, groupId, productId) => {
                   updateField('sole_material', productName);
                   updateField('sole_group_id', groupId);
                   autoFillSole(productName);
                   // Auto-sync ficha.sizes a partir do range agregado (MIN/MAX)
                   // das variantes do solado — mesma lógica do trigger DB
                   // tg_sync_ficha_sizes_from_sole. Regra de produto:
                   // solado é fonte da verdade do range físico produzível.
                   if (groupId && products && products.length > 0) {
                     const variants = products.filter((p: any) =>
                       p.group_id === groupId && p.category === 'Solado' && p.stock_grade);
                     let minFrom: number | null = null;
                     let maxTo: number | null = null;
                     for (const v of variants) {
                       const g = (v as any).stock_grade as Record<string, any>;
                       const sf = g?._size_from != null ? Number(g._size_from) : null;
                       const st = g?._size_to != null ? Number(g._size_to) : null;
                       if (sf != null) minFrom = minFrom == null ? sf : Math.min(minFrom, sf);
                       if (st != null) maxTo = maxTo == null ? st : Math.max(maxTo, st);
                     }
                     if (minFrom != null && maxTo != null && minFrom <= maxTo) {
                       const newSizes = `${minFrom}-${maxTo}`;
                       if (newSizes !== form.sizes) {
                         updateField('sizes', newSizes);
                         flashField('sizes');
                         toast.success(`Grade atualizada para ${newSizes} (faixa do solado)`);
                       }
                     }
                   }
                   if (productId) {
                     // Check if sole is fachetado
                     const soleProd = products.find(p => p.id === productId);
                     setIsSoleFachetado(!!soleProd?.is_fachetado);

                     // Auto-fill lining/insole specs from sole technical specs
                     autoFillFromSoleSpecs(productId);
                     // Auto-fill standard items like glue/EVA/thread
                     autoFillStandardItemsFromSole(productId);
                   } else {
                     setIsSoleFachetado(false);
                   }
                 }}
              />
              <div>
                <Label className="text-xs text-muted-foreground">Processo de Colagem</Label>
                <Select value={form.sole_process || ''} onValueChange={v => updateField('sole_process', v)}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecionar processo..." /></SelectTrigger>
                  <SelectContent>
                    {SOLE_PROCESSES.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Consumo Solado (un/par)</Label>
                <NumberInput value={form.sole_consumption || 0} onChange={v => updateField('sole_consumption', v)} className="mt-1 h-9 text-sm" placeholder="1" step="1" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox 
                  id="sole-drives-cons" 
                  checked={form.sole_drives_consumption} 
                  onCheckedChange={v => updateField('sole_drives_consumption', !!v)} 
                />
                <Label htmlFor="sole-drives-cons" className="text-xs font-semibold cursor-pointer">Consumo por Grade</Label>
              </div>
            </div>
            {form.sole_material && (
              <SoleClassificationBadge
                groupId={form.sole_group_id || ''}
                soleMaterial={form.sole_material}
                process={form.sole_process || ''}
                products={products || []}
              />
            )}
            {!form.sole_material && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Defina o grupo de solado para habilitar o preenchimento automático de palmilha e forração.
                </span>
              </div>
            )}
          </div>

          {/* Regra padrão: sandália preta → solado preto, demais cores → solado caramelo */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Especificações por Componente</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Defina o grupo de material para cada componente. Para o Cabedal, informe o consumo na unidade do próprio item; demais componentes são tratados pela lógica técnica do solado.
            </p>

            {/* Helper: unidade do grupo via 1º produto ativo do grupo */}
            {(() => null)()}

            {/* Materiais Técnicos (Cabedal, Forro, Palmilha) */}
            <div className="space-y-6">
              {/* Cabedal */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-amber-600" />
                   <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cabedal</span>
                 </div>
                 {isSoleFachetado && (
                   <div className="p-3 border border-amber-200 bg-amber-50/30 rounded-lg space-y-2 animate-in fade-in slide-in-from-left-2 duration-300">
                     <div className="flex items-center gap-2">
                       <div className="h-5 w-5 rounded bg-amber-100 flex items-center justify-center">
                         <Wand2 className="h-3 w-3 text-amber-600" />
                       </div>
                       <Label className="text-xs font-bold text-amber-800">Forração de Salto (Fachete)</Label>
                     </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                       <div>
                         <Label className="text-[10px] text-muted-foreground uppercase">Material do Fachete</Label>
                         <Select 
                           value={form.fachete_material || ''} 
                           onValueChange={v => updateField('fachete_material', v)}
                         >
                           <SelectTrigger className="h-8 text-xs mt-1">
                             <SelectValue placeholder="Selecionar grupo..." />
                           </SelectTrigger>
                           <SelectContent>
                             {(groups || []).map((g: any) => (
                               <SelectItem key={g.id} value={g.name} className="text-xs">{g.name}</SelectItem>
                             ))}
                           </SelectContent>
                         </Select>
                       </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground uppercase">Consumo Médio (dm²)</Label>
                          <Input 
                            type="number" 
                            value={form.fachete_consumption || 0} 
                            onChange={e => updateField('fachete_consumption', Number(e.target.value))}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="pt-2 border-t border-amber-200">
                        <Label className="text-[10px] text-amber-800 font-semibold uppercase mb-2 block">Consumo de Fachete por Numeração (dm²)</Label>
                        <div className="overflow-x-auto pb-2">
                          <div className="flex gap-1.5 min-w-max">
                            {(form.sizes || '').split(',').map((size: string) => {
                              const s = size.trim();
                              if (!s) return null;
                              return (
                                <div key={s} className="flex flex-col items-center gap-1">
                                  <span className="text-[9px] font-bold text-amber-700">{s}</span>
                                  <Input
                                    type="number"
                                    className="w-12 h-7 text-[10px] px-1 text-center"
                                    value={(form.fachete_consumption_per_size as any)?.[s] || ''}
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      const next = { ...(form.fachete_consumption_per_size as any) || {} };
                                      if (val > 0) next[s] = val; else delete next[s];
                                      updateField('fachete_consumption_per_size', next);
                                    }}
                                  />
                                </div>
                              );
                            })}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 self-end mb-0.5 text-amber-600 hover:text-amber-700 hover:bg-amber-100"
                              title="Preencher restante"
                              onClick={() => {
                                const grid = { ...(form.fachete_consumption_per_size as any) || {} };
                                const firstVal = Object.values(grid).find(v => Number(v) > 0);
                                if (!firstVal) return;
                                (form.sizes || '').split(',').forEach((sz: string) => {
                                  const s = sz.trim();
                                  if (s && !grid[s]) grid[s] = Number(firstVal);
                                });
                                updateField('fachete_consumption_per_size', grid);
                              }}
                            >
                              <Wand2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                     </div>
                   </div>
                 )}
              {(() => {
                // Resolves the measurement unit for a product group.
                // Priority (BOM UOM rule — dimension UOM beats stock UOM):
                //   1) unit cached at selection time (extra.material_unit)
                //   2) group.consumption_unit (canonical industrial UoM)
                //   3) group.dimensions_unit (fallback dimensional UoM)
                //   4) first active product in the group that has a unit
                //   5) any product in the group with a unit
                const getUnitForGroupName = (groupName: string, storedUnit?: string): string => {
                  // UoM canónica do grupo tem prioridade sobre cache antigo (storedUnit)
                  // para corrigir fichas onde foi cacheado o unit errado da variante.
                  if (!groupName?.trim()) return storedUnit?.trim() || 'un';
                  const g: any = (groups || []).find((x: any) => (x.name || '').trim() === groupName.trim());
                  const groupUnit = ((g?.consumption_unit || g?.dimensions_unit) || '').toString().trim();
                  if (groupUnit) return groupUnit;
                  if (storedUnit?.trim()) return storedUnit.trim();
                  if (!g) return 'un';
                  const prod = (products || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim())
                    || (products || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim());
                  return (prod?.unit || '').toString().trim() || 'un';
                };
                const cabedalSizes = parseSizesFromRange(form.sizes, form.shoe_category);

                // Renderiza grade de consumo por numeração (em metros/par)
                const renderSizeGrid = (
                  perSize: Record<string, number>,
                  unit: string,
                  onChangeGrid: (newPerSize: Record<string, number>) => void,
                  highlightColor: 'amber' | 'primary' | 'emerald' = 'primary',
                ) => {
                  const colorClass = highlightColor === 'emerald'
                    ? 'border-emerald-300 dark:border-emerald-800'
                    : highlightColor === 'amber'
                    ? 'border-amber-300 dark:border-amber-800'
                    : 'border-primary/30';
                  const filledVals = cabedalSizes.map(s => Number(perSize[String(s)] || 0)).filter(v => v > 0);
                  const avg = filledVals.length > 0 ? (filledVals.reduce((a, b) => a + b, 0) / filledVals.length) : 0;
                  return (
                    <div className={`mt-2 p-2.5 rounded-md border bg-muted/30 ${colorClass}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Consumo desta Opção ({unit}/par) — custo por cor/material
                        </Label>
                        {/* Quando o modelo tem TIRAS, o consumo é número-a-número
                            (cada tira tem seu cm/par). A "média" é enganosa nesse
                            caso — ocultamos pra evitar leitura errada. */}
                        {!form.has_straps && (
                          <span className="text-[10px] text-muted-foreground">
                            Média: <strong>{avg.toFixed(4)}</strong>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cabedalSizes.map(size => {
                          const sizeKey = String(size);
                          return (
                            <div key={size} className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] font-mono text-muted-foreground">{size}</span>
                              <NumberInput
                                value={perSize[sizeKey] || 0}
                                onChange={v => {
                                  const next = { ...perSize, [sizeKey]: v };
                                  onChangeGrid(next);
                                }}
                                className="w-[58px] h-7 text-[10px] text-center"
                                placeholder="0"
                                step="0.0001"
                              />
                            </div>
                          );
                        })}
                        <div className="flex flex-col gap-1 self-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px]"
                            onClick={async () => {
                              const grid = await fetchSoleGradeForCabedal();
                              if (grid) {
                                // Preserve existing values, only fill empty sizes from sole template
                                const merged = { ...grid, ...perSize };
                                onChangeGrid(merged);
                                toast.success("Grade do solado aplicada. Preencha os consumos por numeração.");
                              }
                            }}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Puxar Grade do Solado
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px]"
                            onClick={() => {
                              const firstFilled = cabedalSizes.map(s => perSize[String(s)] || 0).find(v => v > 0);
                              if (!firstFilled || firstFilled <= 0) {
                                toast.info("Preencha o primeiro número antes de replicar.");
                                return;
                              }
                              const next: Record<string, number> = {};
                              cabedalSizes.forEach(s => { next[String(s)] = firstFilled; });
                              onChangeGrid(next);
                            }}
                          >
                            Replicar 1º
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
                        <GroupMaterialSelect
                          label="Opção 1 (Principal)"
                          value={form.upper_material}
                          onChange={v => { updateField('upper_material', v); autoFillConsumption(v, 'upper_material'); }}
                        />
                        {form.upper_material && (
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                            updateField('upper_material', '');
                            updateField('upper_consumption', 0);
                            updateField('upper_consumption_per_size' as any, {});
                          }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Acessórios alternativos de cabedal removidos da UI conforme decisão
                        do usuário: cada referência tem APENAS um material principal.
                        Variações de material (Napa, Santorini, …) são gerenciadas em
                        Variantes de Material (não como acessórios). Mantemos render
                        condicional só pra fichas legacy que ainda têm dados gravados —
                        em fichas novas o array fica vazio e nada renderiza. */}
                    {false && (form.components_accessories || []).map((extra: any, rawIdx: number) => ({ extra, rawIdx })).filter(({ extra }) => extra.material !== undefined && !extra.id && !extra.mandatory).map(({ extra, rawIdx }, displayIdx) => {
                      const unit = getUnitForGroupName(extra.material || '', extra.material_unit);
                      return (
                        <div key={rawIdx} className="space-y-2 border-l-2 border-primary/30 pl-3">
                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
                            <GroupMaterialSelect
                              label={`Opção ${displayIdx + 2}`}
                              value={extra.material || ''}
                              onChange={v => {
                                const arr = [...(form.components_accessories || [])];
                                const grp = (groups || []).find((x: any) => (x.name || '').trim() === v.trim());
                                const resolvedProd = grp
                                  ? ((products || []).find((p: any) => p.group_id === grp.id && p.active && (p.unit || '').trim())
                                     || (products || []).find((p: any) => p.group_id === grp.id && (p.unit || '').trim()))
                                  : null;
                                // Prioriza UoM canónica do grupo (consumption_unit/dimensions_unit)
                                // sobre o unit do produto — variantes podem estar mal cadastradas.
                                const material_unit =
                                  ((grp as any)?.consumption_unit || '').toString().trim()
                                  || ((grp as any)?.dimensions_unit || '').toString().trim()
                                  || (resolvedProd?.unit || '').trim()
                                  || undefined;
                                arr[rawIdx] = { ...arr[rawIdx], material: v, ...(material_unit ? { material_unit } : {}) };
                                updateField('components_accessories', arr);
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                              const arr = [...(form.components_accessories || [])];
                              arr.splice(rawIdx, 1);
                              updateField('components_accessories', arr);
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                               {extra.material && renderSizeGrid(
                                 extra.consumption_per_size || {},
                                 unit,
                                 (next) => {
                              const arr = [...(form.components_accessories || [])];
                              const vals = Object.values(next).filter((v: any) => Number(v) > 0).map(Number);
                              const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                              arr[rawIdx] = { ...arr[rawIdx], consumption_per_size: next, consumption: Number(avg.toFixed(4)) };
                              updateField('components_accessories', arr);
                            },
                            'primary',
                          )}
                        </div>
                      );
                    })}

                    {/* Materiais mandatórios também ocultos — pertencem a outro
                        local (Materiais Padrão do Solado: cola, palmilha, linha). */}
                    {false && (form.components_accessories || []).map((extra: any, rawIdx: number) => ({ extra, rawIdx })).filter(({ extra }) => extra.mandatory === true).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-dashed border-emerald-300 dark:border-emerald-800">
                        <div className="flex items-center gap-2 mb-2">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Materiais Sempre Consumidos</span>
                        </div>
                        {(form.components_accessories || []).map((extra: any, rawIdx: number) => ({ extra, rawIdx })).filter(({ extra }) => extra.mandatory === true).map(({ extra, rawIdx }, displayIdx) => {
                          const unit = getUnitForGroupName(extra.material || '', extra.material_unit);
                          return (
                            <div key={rawIdx} className="space-y-2 border-l-2 border-emerald-400/60 pl-3 mb-3">
                              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
                                <GroupMaterialSelect
                                  label={`Material Fixo ${displayIdx + 1}`}
                                  value={extra.material || ''}
                                  onChange={v => {
                                    const arr = [...(form.components_accessories || [])];
                                    const grp = (groups || []).find((x: any) => (x.name || '').trim() === v.trim());
                                    const resolvedProd = grp
                                      ? ((products || []).find((p: any) => p.group_id === grp.id && p.active && (p.unit || '').trim())
                                         || (products || []).find((p: any) => p.group_id === grp.id && (p.unit || '').trim()))
                                      : null;
                                    const material_unit =
                                      ((grp as any)?.consumption_unit || '').toString().trim()
                                      || ((grp as any)?.dimensions_unit || '').toString().trim()
                                      || (resolvedProd?.unit || '').trim()
                                      || undefined;
                                    arr[rawIdx] = { ...arr[rawIdx], material: v, mandatory: true, ...(material_unit ? { material_unit } : {}) };
                                    updateField('components_accessories', arr);
                                  }}
                                />
                                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                                  const arr = [...(form.components_accessories || [])];
                                  arr.splice(rawIdx, 1);
                                  updateField('components_accessories', arr);
                                }}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {extra.material && renderSizeGrid(
                                extra.consumption_per_size || {},
                                unit,
                                (next) => {
                                  const arr = [...(form.components_accessories || [])];
                                  const vals = Object.values(next).filter((v: any) => Number(v) > 0).map(Number);
                                  const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                                  arr[rawIdx] = { ...arr[rawIdx], consumption_per_size: next, consumption: Number(avg.toFixed(4)), mandatory: true };
                                  updateField('components_accessories', arr);
                                },
                                'emerald',
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              {/* Botões removidos: cada ref tem APENAS material principal de cabedal.
                  Variações de material (Napa, Santorini, …) → Tab "Variantes". */}
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Forro */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scissors className="h-3.5 w-3.5 text-purple-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Forração</span>
                  </div>
                  {form.sole_group_id && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 text-[10px] gap-1"
                      onClick={() => {
                        const soleId = products.find(p => p.group_id === form.sole_group_id)?.id;
                        if (soleId) autoFillFromSoleSpecs(soleId);
                        else toast.error("Não foi possível localizar o produto do solado para buscar consumos.");
                      }}
                    >
                      <RefreshCw className="h-3 w-3" /> Puxar do Solado
                    </Button>
                  )}
                </div>
                <div className="space-y-3">
                  <GroupMaterialSelect label="Material Principal" value={form.lining_material} onChange={v => { updateField('lining_material', v); autoFillConsumption(v, 'lining_material'); }} />

                  {/* Acessórios alternativos de forração removidos. Cada ref tem
                      APENAS um material principal de forro. Botão "Outra Opção" e
                      blocos extras escondidos (mantidos no banco pra fichas legacy). */}
                </div>
              </div>

              {/* Palmilha */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-blue-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Palmilha</span>
                  </div>
                  {form.sole_group_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] gap-1"
                      onClick={() => {
                        const soleId = products.find(p => p.group_id === form.sole_group_id)?.id;
                        if (soleId) autoFillFromSoleSpecs(soleId);
                        else toast.error("Não foi possível localizar o produto do solado para buscar consumos.");
                      }}
                    >
                      <RefreshCw className="h-3 w-3" /> Puxar do Solado
                    </Button>
                  )}
                </div>
                <div className="space-y-3">
                  <GroupMaterialSelect label="Material" value={form.insole_material} onChange={v => { updateField('insole_material', v); autoFillConsumption(v, 'insole_material'); }} />
                  <InsolePlateProductSelect label="Tipo de Placa" value={form.insole_plate_product} onChange={v => updateField('insole_plate_product', v)} />
                  
                  {(() => {
                    const soleProd = form.sole_group_id ? products.find(p => p.group_id === form.sole_group_id) : null;
                    const mode = (soleProd as any)?.insole_mode || 'cortar';
                    if (mode === 'pronta_na_cor') {
                      return (
                        <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-2">
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                            Modo <strong>Pronta na cor</strong> ativo: consumo automático de 1 par por unidade.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            </div>

            <Separator />



            <Separator />

            {/* Componentes Diretos */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Box className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Componentes (un)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Componentes avulsos medidos por unidade (ex: ABS, fivelas, ilhós).
              </p>
              {(form.direct_components || []).map((comp: any, idx: number) => (
                <div key={idx} className="grid grid-cols-3 gap-4 items-end border-l-2 border-green-400/30 pl-3">
                  <DirectComponentSelect
                    label={`Componente ${idx + 1}`}
                    value={comp.product_id || ''}
                    onChange={(pid, pname, price) => {
                      const arr = [...(form.direct_components || [])];
                      arr[idx] = { ...arr[idx], product_id: pid, product_name: pname, unit_price: price };
                      updateField('direct_components', arr);
                    }}
                  />
                  <div>
                    <Label className="text-xs text-muted-foreground">Qtd por par (un)</Label>
                    <NumberInput value={comp.quantity || 0} onChange={v => {
                      const arr = [...(form.direct_components || [])];
                      arr[idx] = { ...arr[idx], quantity: v };
                      updateField('direct_components', arr);
                    }} className="mt-1 h-9 text-sm" placeholder="0" step="1" />
                  </div>
                  <div className="flex items-end gap-2">
                    {comp.unit_price > 0 && comp.quantity > 0 && (
                      <span className="text-xs text-muted-foreground font-mono mb-2">
                        = {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(comp.unit_price * comp.quantity)}/par
                      </span>
                    )}
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                      const arr = [...(form.direct_components || [])];
                      arr.splice(idx, 1);
                      updateField('direct_components', arr);
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                updateField('direct_components', [...(form.direct_components || []), { product_id: '', product_name: '', quantity: 1, unit_price: 0 }]);
              }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar Componente
              </Button>
            </div>
          </div>

           {/* ═══ SECTION: Consumo por Numeração para Produção ═══ */}
          </div>

          {/* ═══ SECTION: Consumo por Numeração para Produção ═══ */}
          {false && null}
           {(form.upper_material || form.lining_material || form.insole_material) && (() => {
             const soleProd = form.sole_group_id ? products.find(p => p.group_id === form.sole_group_id) : null;
             const insoleMode = (soleProd as any)?.insole_mode || 'cortar';
             const insoleIsPronta = insoleMode === 'pronta_na_cor';
 
            const sizes = parseSizesFromRange(form.sizes, form.shoe_category);
            // Resolves the measurement unit for a group name, used to label input fields.
            const resolveGroupUnit = (groupName: string): string => {
              if (!groupName?.trim()) return 'dm²';
              const g = (groups || []).find((x: any) => (x.name || '').trim() === groupName.trim());
              if (!g) return 'dm²';
              const prod = (products || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim())
                || (products || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim());
              return (prod?.unit || '').toString().trim() || 'dm²';
            };
            type MaterialRow = {
              label: string;
              field: 'upper_consumption_per_size' | 'lining_consumption_per_size' | 'insole_consumption_per_size';
              scalarField: 'upper_consumption' | 'lining_consumption' | 'insole_consumption';
              groupName: string;
              show: boolean;
            };
            const rows: MaterialRow[] = ([
               { label: 'Cabedal',  field: 'upper_consumption_per_size',  scalarField: 'upper_consumption',  groupName: form.upper_material || '',  show: !!form.upper_material },
               { label: 'Forração', field: 'lining_consumption_per_size', scalarField: 'lining_consumption', groupName: form.lining_material || '', show: !!form.lining_material },
                { label: 'Palmilha', field: 'insole_consumption_per_size', scalarField: 'insole_consumption', groupName: form.insole_material || '', show: !!form.insole_material && !insoleIsPronta },
                { label: 'Salto Fachetado', field: 'fachete_consumption_per_size' as any, scalarField: 'fachete_consumption' as any, groupName: form.fachete_material || '', show: isSoleFachetado && !!form.fachete_material },
             ] as MaterialRow[]).filter(r => r.show);
 
             if (rows.length === 0) return null;

            // Split sizes em faixas Infantil (<33) / Adulto (>=33). Quando ambas
            // existem, exibe Tabs pra reduzir scroll horizontal em mobile.
            // Conjugados aqui são raros (sizes vem como number[]), então não
            // entram nesta divisão — ficam representados pelo número base.
            const infantilSizes = sizes.filter((s: number) => s < 33);
            const adultoSizes   = sizes.filter((s: number) => s >= 33);
            const hasInfantil   = infantilSizes.length > 0;
            const hasAdulto     = adultoSizes.length > 0;
            const splitNeeded   = hasInfantil && hasAdulto;

            const renderTable = (visibleSizes: number[]) => (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-[10px] font-semibold text-muted-foreground py-1.5 pr-3 min-w-[80px]">Material</th>
                      {visibleSizes.map(s => (
                        <th key={s} className="text-center text-[10px] font-mono text-muted-foreground py-1.5 px-0.5 w-[62px]">{s}</th>
                      ))}
                      <th className="text-right text-[10px] font-semibold text-muted-foreground py-1.5 pl-3 min-w-[72px]">Média</th>
                      <th className="min-w-[90px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const perSize: Record<string, number> = form[row.field] || {};
                      // Média calcula em CIMA DE TODAS as numerações preenchidas
                      // (não só das visíveis), pra refletir a média real da ficha.
                      const filledVals = sizes.map((s: number) => Number(perSize[String(s)] || 0)).filter((v: number) => v > 0);
                      const avg = filledVals.length > 0 ? filledVals.reduce((a: number, b: number) => a + b, 0) / filledVals.length : 0;
                      const isFlashing = flashFields.has(row.field);
                      return (
                        <tr
                          key={row.field}
                          className={`border-t border-border/40 transition-colors duration-700 ${isFlashing ? 'bg-green-500/10' : ''}`}
                        >
                          <td className="text-[11px] font-medium py-1.5 pr-3">
                            {row.label}
                            {isFlashing && (
                              <span className="ml-1 text-[9px] font-bold text-green-600 dark:text-green-400 animate-pulse">
                                ✓ importado
                              </span>
                            )}
                            <span className="ml-1 text-[9px] font-normal text-muted-foreground">({resolveGroupUnit(row.groupName)})</span>
                          </td>
                          {visibleSizes.map(size => {
                            const sizeKey = String(size);
                            return (
                              <td key={size} className="px-0.5 py-1">
                                <NumberInput
                                  value={perSize[sizeKey] || 0}
                                  onChange={v => {
                                    const next = { ...perSize, [sizeKey]: v };
                                    updateField(row.field, next);
                                    const vals = Object.values(next).filter((x: any) => Number(x) > 0).map(Number);
                                    if (vals.length > 0) updateField(row.scalarField, Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)));
                                  }}
                                  className="w-[62px] h-7 text-[10px] text-center"
                                  placeholder="0"
                                  step="0.0001"
                                />
                              </td>
                            );
                          })}
                          <td className="text-right text-[10px] font-mono text-muted-foreground pl-3">
                            {avg > 0 ? avg.toFixed(4) : '—'}
                          </td>
                          <td className="pl-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] whitespace-nowrap"
                              onClick={() => {
                                const firstFilled = sizes.map((s: number) => perSize[String(s)] || 0).find((v: number) => v > 0);
                                if (!firstFilled || firstFilled <= 0) { toast.info("Preencha o primeiro número antes de replicar."); return; }
                                const next: Record<string, number> = {};
                                // Replica em TODAS as numerações da ficha, não só nas visíveis
                                sizes.forEach((s: number) => { next[String(s)] = firstFilled; });
                                updateField(row.field, next);
                                updateField(row.scalarField, firstFilled);
                              }}
                            >
                              Replicar 1º
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );

            return (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Consumo por Numeração — Produção</h3>
                    <span className="text-xs text-muted-foreground">unidade do material/par — alimenta o débito de estoque por grade</span>
                  </div>
                  {form.sole_group_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] gap-1"
                      onClick={() => {
                        const soleId = products.find((p: any) => p.group_id === form.sole_group_id)?.id;
                        if (soleId) autoFillFromSoleSpecs(soleId);
                        else toast.error("Não foi possível localizar o produto do solado.");
                      }}
                    >
                      <RefreshCw className="h-3 w-3" /> Puxar do Solado
                    </Button>
                  )}
                </div>
                {splitNeeded ? (
                  <Tabs defaultValue={adultoSizes.length >= infantilSizes.length ? 'adulto' : 'infantil'}>
                    <TabsList className="h-8">
                      <TabsTrigger value="infantil" className="text-xs h-7">
                        Infantil ({infantilSizes.length})
                      </TabsTrigger>
                      <TabsTrigger value="adulto" className="text-xs h-7">
                        Adulto ({adultoSizes.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="infantil" className="mt-2">{renderTable(infantilSizes)}</TabsContent>
                    <TabsContent value="adulto" className="mt-2">{renderTable(adultoSizes)}</TabsContent>
                  </Tabs>
                ) : (
                  renderTable(sizes)
                )}
              </div>
            );
          })()}

          {/* ═══ SECTION 2: Tiras ═══ */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Scissors className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Configuração de Tiras</h3>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Checkbox
                id="has-straps"
                checked={form.has_straps}
                onCheckedChange={v => {
                  updateField('has_straps', !!v);
                  if (v && (!form.strap_colors || form.strap_colors.length === 0)) {
                    updateField('strap_colors', [
                      { id: '1', label: 'TIRA 1', color: '' },
                      { id: '2', label: 'TIRA 2', color: '' },
                      { id: '3', label: 'TIRA 3', color: '' },
                    ]);
                  }
                }}
              />
              <Label htmlFor="has-straps" className="text-sm font-medium">Habilitar tiras neste modelo</Label>
            </div>
            {form.has_straps && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Defina quantas tiras este modelo possui e o consumo por numeração (em cm). As cores de cada tira serão configuradas no lançamento do Pedido de Venda.
                </p>

                {/* Handling time — only for strap models */}
                {(form.strap_colors || []).map((strap: any, idx: number) => {
                  const strapSizes = parseSizesFromRange(form.sizes, form.shoe_category);
                  const consumptionPerSize: Record<string, number> = strap.consumption_per_size || {};
                  const filledSizes = strapSizes.filter(s => (consumptionPerSize[String(s)] || 0) > 0);
                  const avgConsumption = filledSizes.length > 0
                    ? filledSizes.reduce((sum, s) => sum + parseSafeNumber(consumptionPerSize[String(s)]), 0) / filledSizes.length
                    : parseSafeNumber(strap.consumption);
                  return (
                    <div key={strap.id || idx} className="p-3 rounded-lg border bg-background space-y-3">
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="font-semibold text-xs whitespace-nowrap">{strap.label || `TIRA ${idx + 1}`}</Badge>
                        <Select
                          value={strap.group_id || ''}
                          onValueChange={(val) => {
                            const updated = [...(form.strap_colors || [])];
                            const selectedGroup = groups?.find((g: any) => g.id === val);
                            updated[idx] = { ...updated[idx], group_id: val, group_name: selectedGroup?.name || '' };
                            updateField('strap_colors', updated);
                          }}
                        >
                          <SelectTrigger className="w-[200px] h-8 text-xs">
                            <SelectValue placeholder="Grupo de material..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(groups || []).map((g: any) => (
                              <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground ml-auto">
                          Média: <strong>{safeToFixed(avgConsumption, 1)} cm</strong>/par
                        </span>
                        {(form.strap_colors || []).length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => {
                              const updated = (form.strap_colors || []).filter((_: any, i: number) => i !== idx);
                              updateField('strap_colors', updated);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Consumo por Numeração (cm/par)</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {strapSizes.map(size => {
                            const sizeKey = String(size);
                            return (
                              <div key={size} className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] font-mono text-muted-foreground">{size}</span>
                                <NumberInput
                                  value={consumptionPerSize[sizeKey] || 0}
                                  onChange={(val) => {
                                    const updated = [...(form.strap_colors || [])];
                                    const newPerSize = { ...(updated[idx].consumption_per_size || {}), [sizeKey]: val };
                                    const filled = strapSizes.filter(s => (s === size ? val : (newPerSize[String(s)] || 0)) > 0);
                                    const avg = filled.length > 0
                                      ? filled.reduce((sum, s) => sum + (s === size ? val : (newPerSize[String(s)] || 0)), 0) / filled.length
                                      : 0;
                                    updated[idx] = { ...updated[idx], consumption_per_size: newPerSize, consumption: Math.round(avg * 100) / 100 };
                                    updateField('strap_colors', updated);
                                  }}
                                  className="w-[52px] h-7 text-[10px] text-center"
                                  placeholder="0"
                                  step="0.1"
                                />
                              </div>
                            );
                          })}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px] self-end"
                            onClick={() => {
                              const firstVal = consumptionPerSize[String(strapSizes[0])] || 0;
                              if (firstVal <= 0) return;
                              const updated = [...(form.strap_colors || [])];
                              const newPerSize: Record<string, number> = {};
                              strapSizes.forEach(s => { newPerSize[String(s)] = firstVal; });
                              updated[idx] = { ...updated[idx], consumption_per_size: newPerSize, consumption: firstVal };
                              updateField('strap_colors', updated);
                            }}
                          >
                            Replicar 1º
                          </Button>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground">Cor definida no pedido</span>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const next = (form.strap_colors || []).length + 1;
                    updateField('strap_colors', [
                      ...(form.strap_colors || []),
                      { id: String(next), label: `TIRA ${next}`, color: '', consumption_per_size: {} },
                    ]);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar Tira
                </Button>

                 {/* Catalog Models - pre-defined color combinations */}
                 <CatalogModelsPanel sheetId={sheet.id} strapColors={form.strap_colors || []} />
               </div>
             )}
 
             {/* ═══ SECTION: Harmonização de Cores (Mapeamentos) ═══ */}
             <div className="space-y-4">
               <div className="flex items-center gap-2">
                 <Wand2 className="h-4 w-4 text-primary" />
                 <h3 className="text-sm font-semibold">Harmonização de Cores</h3>
               </div>
               <div className="grid grid-cols-1 gap-6">
                 {/* Palmilha Mapping */}
                  <PalmilhaColorMappingPanel
                    sheetId={sheet.id}
                    corPredominanteId={form.cor_predominante_id}
                    corSoladoId={form.cor_solado_id}
                    insoleGroupName={form.insole_material || ''}
                    palmilhaColorMappings={palmilhaColorMappings}
                    upsertPalmilha={upsertPalmilhaColor}
                    products={products}
                    groups={groups}
                  />
 
                 {/* Forração Mapping */}
                 <ForracaoColorMappingPanel
                   sheetId={sheet.id}
                   corPredominanteId={form.cor_predominante_id}
                   liningGroupName={form.lining_material || ''}
                   liningColorMappings={liningColorMappings}
                   upsertLining={upsertLiningColor}
                   products={products}
                   groups={groups}
                 />
               </div>
             </div>
          </div>

          {/* ═══ SECTION 3: BOM (Bill of Materials) ═══ */}
          <div className="rounded-lg border bg-card p-4">
            <SheetBOM sheetId={sheet.id} lossPct={form.consumption_loss_pct} safetyPct={form.safety_margin_pct}
              onLossChange={v => updateField('consumption_loss_pct', v)} onSafetyChange={v => updateField('safety_margin_pct', v)} shoeCategory={form.shoe_category} />
          </div>

          {/* ═══ SECTION 4: Consumos Técnicos de Componentes ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ═══ SECTION 4: Consumos Técnicos de Componentes ═══ */}
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-4">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Consumos Técnicos
                </h3>
              </div>
              <ComponentSheets
                embedded
                filterProductIds={sheetMaterials.map((m: any) => m.product_id).filter(Boolean)}
                hideSoles={true}
              />
            </div>

            {/* ═══ SECTION 5: Análise de Custos Unificada ═══ */}
            <div className="rounded-lg border bg-card p-4 h-full">
              <CostsTab sheetId={sheet.id} form={form} groups={groups || []} />
            </div>
          </div>
        </TabsContent>

         {/* TAB: Produção & Embalagens */}
         <TabsContent value="production" className="mt-4 space-y-6">
           <ProductionSectorsTab
             sectors={sheet.production_sectors || ['Corte', 'Forração', 'Silk', 'Colagem', 'Montagem', 'Acabamento', 'Expedição']}
             onChange={(sectors: string[]) => {
               updateSheet.mutate({ id: sheet.id, data: { production_sectors: sectors } as any });
             }}
           />
          <Separator />
          <OperationsTab
            sheetId={sheet.id}
            assemblyTimeMinutes={Number(sheet.assembly_time_minutes || 0)}
            processDifficulty={sheet.process_difficulty || 'medio'}
            dailyCapacityPairs={0 /* coluna removida — capacidades agora são por setor */}
            leadTimeCorteDias={Number((sheet as any).lead_time_corte_dias ?? 2)}
            leadTimeCosturaDias={Number((sheet as any).lead_time_costura_dias ?? 3)}
            leadTimeSilkDias={Number((sheet as any).lead_time_silk_dias ?? 1)}
            leadTimeColagemDias={Number((sheet as any).lead_time_colagem_dias ?? 1)}
            leadTimeMontagemDias={Number((sheet as any).lead_time_montagem_dias ?? 2)}
            leadTimeAcabamentoDias={Number((sheet as any).lead_time_acabamento_dias ?? 1)}
            leadTimeExpedicaoDias={Number((sheet as any).lead_time_expedicao_dias ?? 2)}
            leadTimeBufferMaterialDias={Number((sheet as any).lead_time_buffer_material_dias ?? 2)}
            cuttingCapacityPerDay={Number((sheet as any).cutting_capacity_per_day ?? 0)}
            sewingCapacityPerDay={Number((sheet as any).sewing_capacity_per_day ?? 0)}
            silkCapacityPerDay={Number((sheet as any).silk_capacity_per_day ?? 0)}
            gluingCapacityPerDay={Number((sheet as any).gluing_capacity_per_day ?? 0)}
            assemblyCapacityPerDay={Number((sheet as any).assembly_capacity_per_day ?? 0)}
            expeditionCapacityPerDay={Number((sheet as any).expedition_capacity_per_day ?? 0)}
            finishingCapacityPerDay={Number((sheet as any).finishing_capacity_per_day ?? 0)}
            onUpdateSheet={(data) => updateSheet.mutate({ id: sheet.id, data: data as any })}
            activeSectors={Array.isArray((sheet as any).production_sectors) ? ((sheet as any).production_sectors as string[]) : undefined}
          />
        </TabsContent>

        {/* TAB: Custos */}
        <TabsContent value="costs" className="mt-4 space-y-6">
          <CostsTab sheetId={sheet.id} form={form} groups={groups || []} />
        </TabsContent>

         {/* TAB: Variantes — apenas MATERIAL (cor é definida no PV)
              Conforme requisito: a mesma referência pode ter até 5 opções de
              material; cada material+ref tem SKU próprio; no PV aparece
              UMA referência agrupando cores de TODOS os materiais cadastrados. */}
         <TabsContent value="variants" className="mt-4 space-y-6">
           <Card>
             <CardHeader className="pb-3">
               <CardTitle className="text-sm font-semibold flex items-center gap-2">
                 <Package className="h-4 w-4 text-primary" /> Variações de Material
               </CardTitle>
               <p className="text-xs text-muted-foreground mt-1">
                 Cadastre aqui até 5 opções de <strong>material principal</strong> (ex.: Napa, Santorini, Metálica).
                 Cada uma tem SKU próprio. As <strong>cores</strong> são definidas no pedido de venda.
               </p>
             </CardHeader>
             <CardContent>
               <MaterialVariantsTab sheetId={sheet.id} sheetCode={sheet.code} />
             </CardContent>
           </Card>
         </TabsContent>
 
         {/* TAB: Fotos & Histórico */}
        <TabsContent value="media" className="mt-4 space-y-6">
          <PhotosByColorTab sheetId={sheet.id} form={form} groups={groups || []} products={products} />
          <Separator />
          <VersionsTab sheetId={sheet.id} form={form} updateField={updateField} />
          <Separator />
          <TechnicalReferencePanel sheetId={sheet.id} sheetName={sheet.name || ''} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ===== Photos by Color Tab ===== */
function PhotosByColorTab({ sheetId, form, groups, products }: {
  sheetId: string;
  form: SheetFormData;
  groups: any[];
  products: any[];
}) {
  const qc = useQueryClient();
  const { data: colorVariants = [], isLoading } = useQuery({
    queryKey: ['color_variants_photos', sheetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_color_variants')
        .select('*')
        .eq('reference_id', sheetId)
        .order('color');
      if (error) throw error;
      return data || [];
    },
  });

  const availableColors = useMemo(() => {
    const colorSet = new Set<string>();
    const groupNames = [form.lining_material].filter(Boolean);
    ((form as any).lining_accessories || []).forEach((c: any) => { if (c.material) groupNames.push(c.material); });

    for (const gName of groupNames) {
      const group = groups.find((g: any) => g.name === gName);
      if (!group) continue;
      products.filter((p: any) => p.group_id === group.id && p.active).forEach((p: any) => {
        if (p.color?.trim()) p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) colorSet.add(t); });
      });
    }
    colorVariants.forEach((v: any) => { if (v.color?.trim()) colorSet.add(v.color.trim()); });
    return Array.from(colorSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [form, groups, products, colorVariants]);

  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (color: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(color);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `color-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      const existing = colorVariants.find((v: any) => v.color === color);
      if (existing) {
        await supabase.from('reference_color_variants').update({ image_url: publicUrl }).eq('id', existing.id);
      } else {
        await supabase.from('reference_color_variants').insert({ reference_id: sheetId, color, image_url: publicUrl });
      }
      qc.invalidateQueries({ queryKey: ['color_variants_photos', sheetId] });
      qc.invalidateQueries({ queryKey: ['color_variants', sheetId] });
      toast.success(`Foto para ${color} salva!`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setUploading(null);
    }
  };

  const handleRemove = async (color: string) => {
    const existing = colorVariants.find((v: any) => v.color === color);
    if (existing) {
      await supabase.from('reference_color_variants').update({ image_url: '' }).eq('id', existing.id);
      qc.invalidateQueries({ queryKey: ['color_variants_photos', sheetId] });
      qc.invalidateQueries({ queryKey: ['color_variants', sheetId] });
      toast.success(`Foto de ${color} removida`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (availableColors.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <ImagePlus className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm font-medium">Nenhuma cor disponível</p>
          <p className="text-xs">Configure os grupos de material em Forro / Forração na aba "Materiais & BOM" para que as cores apareçam aqui.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2"><ImagePlus className="h-4 w-4 text-primary" /> Fotos por Cor</h3>
        <p className="text-xs text-muted-foreground mt-1">Faça upload da foto do produto em cada cor. Estas fotos serão exibidas no pedido de venda ao selecionar a cor.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {availableColors.map(color => {
          const variant = colorVariants.find((v: any) => v.color === color);
          const hasImage = variant?.image_url;
          return (
            <div key={color} className="relative group flex flex-col items-center">
              <div className="w-full aspect-square rounded-lg border-2 border-border bg-muted overflow-hidden flex items-center justify-center relative shadow-sm group-hover:border-primary/50 transition-colors">
                {hasImage ? (
                  <SignedImage src={variant.image_url} alt={color} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
                    <ImagePlus className="h-8 w-8" />
                    <span className="text-[9px]">Sem foto</span>
                  </div>
                )}
                {uploading === color ? (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                ) : (
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(color, e)} />
                    <Plus className="h-6 w-6 text-white mb-1" />
                    <span className="text-[10px] text-white font-bold">{hasImage ? 'Alterar' : 'Upload'}</span>
                  </label>
                )}
                {hasImage && !uploading && (
                  <Button variant="destructive" size="icon" className="h-5 w-5 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 shadow-sm"
                    onClick={(e) => { e.stopPropagation(); handleRemove(color); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <span className="text-[10px] font-semibold mt-1.5 truncate w-full text-center px-1" title={color}>{color}</span>
              {hasImage && <Badge variant="default" className="text-[8px] h-3.5 px-1 mt-0.5">✓ com foto</Badge>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

 const ALL_PRODUCTION_SECTORS = [
   { name: 'Corte', order: 1 },
   { name: 'Forração', order: 2 },
    { name: 'Aviamento', order: 3 },
    { name: 'Silk', order: 4 },
    { name: 'Colagem', order: 5 },
    { name: 'Montagem', order: 6 },
    { name: 'Solagem', order: 7 },
    { name: 'Acabamento', order: 8 },
    { name: 'Expedição', order: 9 },
 ];
 
 function ProductionSectorsTab({ sectors, onChange }: { sectors: string[]; onChange: (sectors: string[]) => void }) {
   const [localSectors, setLocalSectors] = useState<string[]>(sectors);
 
   const toggle = (sectorName: string) => {
    setLocalSectors(prev => {
      const next = prev.includes(sectorName)
        ? prev.filter(s => s !== sectorName)
        : [...prev, sectorName].sort((a, b) => {
            const orderA = ALL_PRODUCTION_SECTORS.find(s => s.name === a)?.order || 99;
            const orderB = ALL_PRODUCTION_SECTORS.find(s => s.name === b)?.order || 99;
            return orderA - orderB;
          });
      return next;
    });
  };

  const hasChanges = JSON.stringify(localSectors) !== JSON.stringify(sectors);

  return (
    <div className="space-y-4">
      <SectionTitle>Setores de Produção</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Selecione quais setores esta referência passa durante a produção. Apenas os setores marcados serão criados nas Ordens de Produção.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
         {ALL_PRODUCTION_SECTORS.map(sector => {
           const isActive = localSectors.includes(sector.name);
           return (
             <button
               key={sector.name}
               type="button"
               onClick={() => toggle(sector.name)}
               className={cn(
                 'flex items-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all',
                 isActive
                   ? 'border-primary bg-primary/10 text-primary cursor-pointer'
                   : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 cursor-pointer'
               )}
             >
               <Checkbox checked={isActive} className="pointer-events-none" />
               <span>{sector.name}</span>
             </button>
           );
         })}
      </div>
      {hasChanges && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {localSectors.length} setor(es) selecionado(s)
          </span>
          <Button size="sm" onClick={() => onChange(localSectors)} className="gap-1">
            <Save className="h-3.5 w-3.5" /> Salvar Setores
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {localSectors.map(s => (
          <Badge key={s} variant="default" className="text-xs">{s}</Badge>
        ))}
        {localSectors.length === 0 && (
          <span className="text-sm text-destructive">⚠ Nenhum setor selecionado — a OP usará todos os setores padrão.</span>
        )}
      </div>
    </div>
  );
}

/* ===== SHEET IMAGE UPLOAD ===== */
function SheetImageUpload({ images, onChange }: { images: any[]; onChange: (imgs: any[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const currentUrl = Array.isArray(images) && images.length > 0 ? (typeof images[0] === 'string' ? images[0] : null) : null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      onChange([publicUrl]);
      toast.success('Imagem enviada!');
    } catch (err: any) {
      toast.error(`Erro ao enviar imagem: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex items-start gap-4">
        {currentUrl ? (
          <div className="relative group">
            <div className="w-56 h-56 rounded-xl border-2 border-border overflow-hidden bg-muted cursor-zoom-in shadow-sm hover:shadow-md transition-shadow"
              onClick={() => setLightboxOpen(true)}>
              <img src={currentUrl} alt="Produto" className="w-full h-full object-cover" />
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                <div className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border flex items-center justify-center hover:bg-accent transition-colors">
                  <ImagePlus className="h-3.5 w-3.5 text-foreground" />
                </div>
              </label>
              <Button type="button" variant="destructive" size="icon" className="h-7 w-7 rounded-md"
                onClick={(e) => { e.stopPropagation(); onChange([]); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center justify-center w-56 h-56 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-all bg-muted/20 hover:bg-muted/40">
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> : (
              <>
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <ImagePlus className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Adicionar foto</span>
                <span className="text-xs text-muted-foreground/60 mt-1">JPG, PNG ou WebP</span>
              </>
            )}
          </label>
        )}
      </div>
      {lightboxOpen && currentUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}>
          <img src={currentUrl} alt="Produto ampliado" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/* ===== REUSABLE FIELD COMPONENTS ===== */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

function FieldInput({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} className={`mt-1 h-9 text-sm ${mono ? 'font-mono' : ''}`} placeholder={placeholder} />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function ModelColorGallery({ colorPredominanteId, products, colorImages, onChange, sheetId }: {
  colorPredominanteId: string | null;
  products: any[];
  colorImages: any[];
  onChange: (val: any[]) => void;
  sheetId: string;
}) {
  const { data: stock = [] } = useReadyStock();
  const availableColors = useMemo(() => {
    if (!colorPredominanteId) return [];
    const groupProducts = products.filter((p: any) => p.active && p.group_id === colorPredominanteId);
    const colors = new Set<string>();
    groupProducts.forEach((p: any) => {
      if (p.color?.trim()) {
        p.color.split(',').forEach((c: string) => {
          const t = c.trim();
          if (t) colors.add(t);
        });
      }
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [colorPredominanteId, products]);

  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (color: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(color);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `color-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      
      const newImages = [...(colorImages || [])];
      const idx = newImages.findIndex(ci => ci.color === color);
      if (idx >= 0) {
        newImages[idx] = { ...newImages[idx], url: publicUrl };
      } else {
        newImages.push({ color, url: publicUrl });
      }
      onChange(newImages);
      toast.success(`Foto para ${color} enviada!`);
    } catch (err: any) {
      toast.error(`Erro ao enviar imagem: ${err.message}`);
    } finally {
      setUploading(null);
    }
  };

  if (!colorPredominanteId || availableColors.length === 0) return null;

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/5">
      <div className="flex items-center gap-2 mb-2">
        <Droplets className="h-4 w-4 text-primary" />
        <SectionTitle>Fotos por Cor do Modelo</SectionTitle>
      </div>
      <p className="text-[10px] text-muted-foreground mb-4">
        Estas fotos serão exibidas no estoque de pronta entrega e no catálogo ao selecionar a cor.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {availableColors.map(color => {
          const ci = (colorImages || []).find(c => c.color === color);
          const colorStock = stock.filter((s: any) => s.reference_id === sheetId && s.color === color).reduce((sum: number, s: any) => sum + s.quantity, 0);
          return (
            <div key={color} className="relative group flex flex-col items-center">
              <div className="w-full aspect-square rounded-lg border-2 border-border bg-muted overflow-hidden flex items-center justify-center relative shadow-sm group-hover:border-primary/50 transition-colors">
                {ci?.url ? (
                  <img src={ci.url} alt={color} className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground/30" />
                )}
                {colorStock > 0 && (
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-background/90 backdrop-blur border text-[9px] font-bold text-primary shadow-sm z-10">
                    {colorStock}p
                  </div>
                )}
                {uploading === color ? (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : (
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(color, e)} />
                    <Plus className="h-6 w-6 text-white mb-1" />
                    <span className="text-[10px] text-white font-bold">{ci?.url ? 'Alterar' : 'Subir'}</span>
                  </label>
                )}
                {ci?.url && !uploading && (
                   <Button 
                    variant="destructive" 
                    size="icon" 
                    className="h-5 w-5 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 shadow-sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        const newImages = (colorImages || []).filter(c => c.color !== color);
                        onChange(newImages);
                    }}
                   >
                     <Trash2 className="h-3 w-3" />
                   </Button>
                )}
              </div>
              <span className="text-[10px] font-semibold mt-1.5 truncate w-full text-center px-1" title={color}>{color}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Component Group Select (for Cores tab — selects group and shows available colors) ===== */

function ComponentGroupSelect({ label, value, onChange, groups, products, required }: {
  label: string; value: string | null; onChange: (v: string | null) => void;
  groups: any[]; products: any[]; required?: boolean;
}) {
  const availableColors = useMemo(() => {
    if (!value) return [];
    const groupProducts = products.filter((p: any) => p.active && p.group_id === value);
    const colors = new Set<string>();
    groupProducts.forEach((p: any) => {
      if (p.color?.trim()) {
        p.color.split(',').forEach((c: string) => {
          const t = c.trim();
          if (t) colors.add(t);
        });
      }
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [value, products]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}{required && ' *'}</Label>
      <Select value={value || 'none'} onValueChange={v => onChange(v === 'none' ? null : v)}>
        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecionar grupo..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Nenhum —</SelectItem>
          {groups.map((g: any) => (
            <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {availableColors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Cores disponíveis:</span>
          {availableColors.map(c => (
            <Badge key={c} variant="outline" className="text-[10px] h-5">{c}</Badge>
          ))}
        </div>
      )}
      {value && availableColors.length === 0 && (
        <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Nenhuma cor cadastrada neste grupo
        </p>
      )}
    </div>
  );
}

/* ===== Sole Color Mapping Panel ===== */
function SoleColorMappingPanel({ sheetId, corPredominanteId, groups, products, soleColorMappings, upsertSoleColor }: {
  sheetId: string;
  corPredominanteId: string | null;
  groups: any[];
  products: any[];
  soleColorMappings: any[];
  upsertSoleColor: any;
}) {
  const productColors = useMemo(() => {
    if (!corPredominanteId) return [];
    const groupProducts = products.filter((p: any) => p.active && p.group_id === corPredominanteId);
    const colors = new Set<string>();
    groupProducts.forEach((p: any) => {
      if (p.color?.trim()) {
        p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) colors.add(t); });
      }
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [corPredominanteId, products]);

  // Group sole products by base model (strip color suffix)
  const normalizeBaseSole = (name: string, color?: string | null): string => {
    return getSoleModelName(name, color).toLowerCase();
  };

  const soleModels = useMemo(() => {
    const allSoles = products
      .filter((p: any) => p.active && p.category === 'Solado' && p.group_id);
    
    const modelMap = new Map<string, { key: string; displayName: string; groupId: string; groupName: string; ids: string[]; totalStock: number }>();
    allSoles.forEach((p: any) => {
      const key = normalizeBaseSole(p.name, p.color);
      const displayName = getSoleModelName(p.name, p.color);
      const groupName = groups.find((g: any) => g.id === p.group_id)?.name || '';
      const existing = modelMap.get(key);
      if (existing) {
        existing.ids.push(p.id);
        existing.totalStock += Number(p.quantity || 0);
      } else {
        modelMap.set(key, {
          key,
          displayName,
          groupId: p.group_id,
          groupName,
          ids: [p.id],
          totalStock: Number(p.quantity || 0),
        });
      }
    });
    return Array.from(modelMap.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  }, [products, groups]);

  const soleFillOptions = useMemo(() => {
    return soleModels.map(m => ({
      key: m.key,
      displayName: m.displayName,
      representativeId: m.ids[0],
      groupId: m.groupId,
    }));
  }, [soleModels]);

  const getMappedProductId = (color: string) => {
    const m = soleColorMappings.find((sc: any) => sc.product_color === color);
    return m?.sole_product_id || null;
  };

  // Find which model a product ID belongs to
  const getModelForProductId = (productId: string | null) => {
    if (!productId) return null;
    return soleModels.find(m => m.ids.includes(productId)) || null;
  };

  const handleChange = (color: string, modelKey: string | null) => {
    if (!modelKey || modelKey === 'none') {
      upsertSoleColor.mutate({ sheetId, productColor: color, soleGroupId: null, soleProductId: null });
      return;
    }
    const model = soleModels.find(m => m.key === modelKey);
    if (!model) return;
    upsertSoleColor.mutate({
      sheetId,
      productColor: color,
      soleGroupId: model.groupId,
      soleProductId: model.ids[0],
    });
  };

  const fillAllWith = (modelKey: string) => {
    const model = soleModels.find(m => m.key === modelKey);
    if (!model) return;
    productColors.forEach(color => {
      upsertSoleColor.mutate({ sheetId, productColor: color, soleGroupId: model.groupId, soleProductId: model.ids[0] });
    });
    toast.success('Todas as cores preenchidas!');
  };

  if (productColors.length === 0) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">Material do Solado por Cor</Label>
        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Selecione o "Material Predominante (Cabedal)" acima para que as cores fiquem disponíveis.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Footprints className="h-3.5 w-3.5" />
          Modelo de Solado por Cor do Produto
        </Label>
        {soleFillOptions.length > 0 && soleFillOptions.length <= 6 && (
          <div className="flex flex-wrap gap-1.5">
            {soleFillOptions.map(opt => (
              <Button
                key={opt.key}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1"
                onClick={() => fillAllWith(opt.key)}
              >
                <Wand2 className="h-3 w-3" />
                Preencher com {opt.displayName}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        {productColors.map(color => {
          const currentProductId = getMappedProductId(color);
          const currentModel = getModelForProductId(currentProductId);
          return (
            <div key={color} className="flex items-center gap-3 rounded-md border bg-background p-2">
              <Badge variant="secondary" className="shrink-0 min-w-[80px] justify-center">{color}</Badge>
              <span className="text-xs text-muted-foreground shrink-0">→</span>
              <Select value={currentModel?.key || 'none'} onValueChange={v => handleChange(color, v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Selecionar modelo de solado..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhum —</SelectItem>
                  {soleModels.map((m) => (
                    <SelectItem key={m.key} value={m.key} className="text-xs">
                      {m.displayName} ({m.ids.length} cor{m.ids.length !== 1 ? 'es' : ''} • {m.totalStock.toLocaleString('pt-BR')} un)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Selecione o modelo de solado (agrupado por base, independente de cor). O sistema identifica automaticamente a variante correta para débito.
      </p>
    </div>
  );
}

/* ===== Group Material Select — seleciona o tipo de material (grupo) ===== */
function GroupMaterialSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, description').order('name');
      if (error) throw error;
      return data;
    },
  });

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g: any) => g.name?.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q));
  }, [groups, search]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {value || 'Selecionar material...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar grupo de material..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhum grupo encontrado</CommandEmpty>
              <CommandGroup heading={`Grupos disponíveis (${filtered.length})`}>
                {filtered.map((g: any) => (
                  <CommandItem key={g.id} value={g.id} onSelect={() => { onChange(g.name); setOpen(false); setSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === g.name ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm">{g.name}</span>
                      {g.description && <span className="text-[10px] text-muted-foreground">{g.description}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ===== Insole Plate Product Select (products from Palmilha groups) ===== */
function InsolePlateProductSelect({ label, value, onChange }: { label: string; value: string; onChange: (productName: string) => void }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products_palmilha_groups'],
    queryFn: async () => {
      const { data: groups } = await supabase.from('product_groups').select('id, name').ilike('name', '%palmilha%');
      if (!groups || groups.length === 0) return [];
      const groupIds = groups.map(g => g.id);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, unit_price, quantity')
        .in('group_id', groupIds)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []).map((p: any) => ({ ...p, groupName: groups.find(g => g.id === p.group_id)?.name || '' }));
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.color?.toLowerCase().includes(q) || p.groupName?.toLowerCase().includes(q));
  }, [products, search]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {value || 'Selecionar placa...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar placa de palmilha..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhuma placa encontrada nos grupos de palmilha.</CommandEmpty>
              <CommandGroup heading={`Placas disponíveis (${filtered.length})`}>
                {filtered.map((p: any) => (
                  <CommandItem key={p.id} value={p.id} onSelect={() => { onChange(p.name + (p.color ? ` (${p.color})` : '')); setOpen(false); setSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === (p.name + (p.color ? ` (${p.color})` : '')) ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm">{p.name} {p.color ? `(${p.color})` : ''}</span>
                      <span className="text-[10px] text-muted-foreground">{p.groupName} • {p.sku || 'sem SKU'} • Estoque: {Number(p.quantity || 0).toLocaleString('pt-BR')}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

   /* ===== Forração Color Mapping Panel (cabedal color → lining color) ===== */
   function ForracaoColorMappingPanel({ sheetId, corPredominanteId, liningGroupName, liningColorMappings, upsertLining, products, groups }: {
     sheetId: string;
     corPredominanteId: string | null;
     liningGroupName: string;
     liningColorMappings: any[];
     upsertLining: any;
     products: any[];
     groups: any[];
   }) {
     const cabedelColors = useMemo(() => {
       if (!corPredominanteId) return [];
       const groupProducts = products.filter((p: any) => p.active && p.group_id === corPredominanteId);
       const colors = new Set<string>();
       groupProducts.forEach((p: any) => {
         if (p.color?.trim()) {
           p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) colors.add(t); });
         }
       });
       return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
     }, [corPredominanteId, products]);
 
     const liningGroup = groups.find((g: any) => g.name === liningGroupName);
     const liningColors = useMemo(() => {
       if (!liningGroup) return [];
       const colors = products
         .filter((p: any) => p.group_id === liningGroup.id && p.color?.trim())
         .map((p: any) => p.color as string);
       return [...new Set(colors)].sort();
     }, [products, liningGroup]);
 
     const mappingMap = useMemo(() => {
       const m = new Map<string, string>();
       liningColorMappings.forEach((mc: any) => m.set((mc.cabedal_color || '').toLowerCase(), mc.lining_color));
       return m;
     }, [liningColorMappings]);
 
     const defaultLining = mappingMap.get(LINING_DEFAULT_KEY) || '';
 
     if (cabedelColors.length === 0) return null;
 
     return (
       <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-4 space-y-3">
         <div className="flex items-center gap-2">
           <Scissors className="h-4 w-4 text-purple-600" />
           <h3 className="text-sm font-bold">Cor da Forração por Cor de Cabedal</h3>
           <Badge variant="outline" className="text-[9px] ml-auto">
             {liningColorMappings.filter((m: any) => m.cabedal_color !== LINING_DEFAULT_KEY).length}/{cabedelColors.length} mapeados
           </Badge>
         </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cabedelColors.map(colorName => {
              const currentLining = mappingMap.get(colorName.toLowerCase()) || (colorName.toLowerCase() === 'preto' ? 'Preto' : defaultLining);
              return (
                <div key={colorName} className="flex flex-col gap-2 p-2 rounded-md border bg-card">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Cabedal</span>
                      <span className="text-xs font-medium truncate">{colorName}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">→</span>
                    <div className="flex-1 min-w-0">
                      <Select
                        value={currentLining}
                        onValueChange={v => upsertLining.mutate({ sheetId, cabedelColor: colorName, liningColor: v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cor forração..." /></SelectTrigger>
                        <SelectContent>
                          {liningColors.map(lc => (
                            <SelectItem key={lc} value={lc} className="text-xs">{lc}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
         </div>
       </div>
     );
   }
 
   /* ===== Palmilha Color Mapping Panel (cabedal color → palmilha color) ===== */
    function PalmilhaColorMappingPanel({ sheetId, corPredominanteId, corSoladoId, insoleGroupName, palmilhaColorMappings, upsertPalmilha, products, groups, insoleMode }: {
   sheetId: string;
   corPredominanteId: string | null;
   corSoladoId?: string | null;
   insoleGroupName: string;
   palmilhaColorMappings: any[];
   upsertPalmilha: any;
   products: any[];
   groups: any[];
   insoleMode?: string;
 }) {
   const [sourceType, setSourceType] = useState<'cabedal' | 'solado'>('cabedal');

  // Cabedal colors come from the predominant color group (same source as SoleColorMappingPanel)
  const sourceColors = useMemo(() => {
    const groupId = sourceType === 'cabedal' ? corPredominanteId : corSoladoId;
    if (!groupId) return [];
    const groupProducts = products.filter((p: any) => p.active && p.group_id === groupId);
    const colors = new Set<string>();
    groupProducts.forEach((p: any) => {
      if (p.color?.trim()) {
        p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) colors.add(t); });
      }
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [corPredominanteId, corSoladoId, products, sourceType]);

   const normalizeBasePalmilha = (name: string, color?: string | null): string => {
     return getSoleModelName(name, color).toLowerCase();
   };

   const palmilhaModels = useMemo(() => {
     const insoleGroup = groups.find((g: any) => g.name === insoleGroupName);
     if (!insoleGroup) return [];
     const allPalmilhas = products.filter((p: any) => p.active && p.group_id === insoleGroup.id);
     const modelMap = new Map<string, { key: string; displayName: string; groupId: string; groupName: string; ids: string[] }>();
     allPalmilhas.forEach((p: any) => {
       const key = normalizeBasePalmilha(p.name, p.color);
       const displayName = getSoleModelName(p.name, p.color);
       const existing = modelMap.get(key);
       if (existing) {
         existing.ids.push(p.id);
       } else {
         modelMap.set(key, { key, displayName, groupId: p.group_id, groupName: insoleGroupName, ids: [p.id] });
       }
     });
     return Array.from(modelMap.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
   }, [products, groups, insoleGroupName]);

   const availablePalmilhaColors = useMemo(() => {
     const insoleGroup = groups.find((g: any) => g.name === insoleGroupName);
     if (!insoleGroup) return [];
     const colors = products.filter((p: any) => p.group_id === insoleGroup.id && p.color?.trim()).map((p: any) => p.color as string);
     return [...new Set(colors)].sort();
   }, [products, groups, insoleGroupName]);

   const mappingMap = useMemo(() => {
     const m = new Map<string, any>();
     palmilhaColorMappings.forEach((mc: any) => m.set((mc.cabedal_color || '').toLowerCase(), mc));
     return m;
   }, [palmilhaColorMappings]);

   const defaultMapping = mappingMap.get(PALMILHA_DEFAULT_KEY);
   const defaultPalmilhaColor = defaultMapping?.palmilha_color || '';

   const [selectedModelKey, setSelectedModelKey] = useState<string | null>(() => {
     const firstWithProduct = palmilhaColorMappings.find(m => m.palmilha_product_id);
     if (firstWithProduct) {
       const product = products.find(p => p.id === firstWithProduct.palmilha_product_id);
       if (product) return normalizeBasePalmilha(product.name, product.color);
     }
     return null;
   });

   if (sourceColors.length === 0) {
    return (
      <p className="text-[10px] text-amber-600 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Nenhuma cor encontrada no grupo de cor predominante. Configure as cores do produto primeiro.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-bold">Cor da Palmilha por Cor de Cabedal</h3>
        <Badge variant="outline" className="text-[9px] ml-auto">
         {palmilhaColorMappings.filter((m: any) => m.cabedal_color !== PALMILHA_DEFAULT_KEY && m.sole_color !== PALMILHA_DEFAULT_KEY).length}/{sourceColors.length} mapeados
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Para cada cor de cabedal, defina qual palmilha será utilizada. O padrão (exceto Preto) aplica a mesma palmilha para todas as demais cores.
      </p>

       {palmilhaModels.length > 0 && (
         <div className="flex flex-col gap-2 max-w-sm">
           <label className="text-[10px] font-medium uppercase text-muted-foreground">Modelo de Palmilha (Opcional p/ Unidades)</label>
           <Select value={selectedModelKey || 'none'} onValueChange={v => setSelectedModelKey(v === 'none' ? null : v)}>
             <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o modelo..." /></SelectTrigger>
             <SelectContent>
               <SelectItem value="none">Apenas cores (Material)</SelectItem>
               {palmilhaModels.map(m => (
                 <SelectItem key={m.key} value={m.key} className="text-xs">{m.displayName}</SelectItem>
               ))}
             </SelectContent>
           </Select>
         </div>
       )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sourceColors.map(colorName => {
          const isPreto = colorName.toLowerCase() === 'preto';
          const mapping = mappingMap.get(colorName.toLowerCase());
          const currentPalmilhaColor = mapping?.palmilha_color || (isPreto ? 'Preto' : defaultPalmilhaColor);
          const currentProductId = mapping?.palmilha_product_id || null;
          const model = selectedModelKey ? palmilhaModels.find(m => m.key === selectedModelKey) : null;
          return (
            <div key={colorName} className="flex flex-col gap-2 p-2 rounded-md border bg-card">
              <div className="flex items-center gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {sourceType === 'cabedal' ? 'Cabedal' : 'Solado'}
                  </span>
                  <span className="text-xs font-medium truncate">{colorName}</span>
                </div>
                <span className="text-muted-foreground text-xs">→</span>
                <div className="flex-1 min-w-0">
                  {model ? (
                    <Select
                      value={currentProductId || 'none'}
                      onValueChange={v => {
                        const pid = v === 'none' ? null : v;
                        const p = products.find(prod => prod.id === pid);
                        upsertPalmilha.mutate({
                          sheetId,
                          cabedelColor: sourceType === 'cabedal' ? colorName : '',
                          soleColor: sourceType === 'solado' ? colorName : '',
                          palmilhaColor: p?.color || '',
                          palmilhaProductId: pid,
                          palmilhaGroupId: model.groupId
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs truncate">
                        <SelectValue placeholder="Selecione palmilha..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs text-muted-foreground">Nenhuma</SelectItem>
                        {products.filter(p => p.group_id === model.groupId && normalizeBasePalmilha(p.name, p.color) === model.key).map(p => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">{p.color || p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    availablePalmilhaColors.length > 0 ? (
                      <Select
                        value={currentPalmilhaColor}
                        onValueChange={v => upsertPalmilha.mutate({
                          sheetId,
                          cabedelColor: sourceType === 'cabedal' ? colorName : '',
                          soleColor: sourceType === 'solado' ? colorName : '',
                          palmilhaColor: v
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cor palmilha..." /></SelectTrigger>
                        <SelectContent>
                          {availablePalmilhaColors.map(pc => (
                            <SelectItem key={pc} value={pc} className="text-xs">{pc}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-[10px] text-amber-600">Sem cores no grupo</p>
                    )
                  )}
                </div>
              </div>
              {!isPreto && !model && availablePalmilhaColors.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                     const palmilhaToSet = currentPalmilhaColor || availablePalmilhaColors[0];
                     if (!palmilhaToSet) return;
                     if (defaultPalmilhaColor === palmilhaToSet) {
                       upsertPalmilha.mutate({ sheetId, cabedelColor: PALMILHA_DEFAULT_KEY, palmilhaColor: '' });
                     } else {
                       upsertPalmilha.mutate({ sheetId, cabedelColor: PALMILHA_DEFAULT_KEY, palmilhaColor: palmilhaToSet });
                     }
                   }}
                   className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                     defaultPalmilhaColor && defaultPalmilhaColor === currentPalmilhaColor
                       ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-semibold'
                       : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                   }`}
                 >
                   {defaultPalmilhaColor && defaultPalmilhaColor === currentPalmilhaColor
                     ? '✓ Padrão para todas as cores (exceto Preto)'
                     : 'Usar esta palmilha como padrão'}
                 </button>
               )}
               {isPreto && (
                 <p className="text-[9px] text-blue-600 dark:text-blue-400">
                   Regra recomendada: cabedal preto → palmilha preta.
                 </p>
               )}
             </div>
           );
         })}
       </div>
    </div>
  );
}

/* ===== Sole Color by Insole Color Mapping Panel (legacy, not rendered) ===== */
const TODAS_AS_CORES_KEY = '__TODAS_EXCETO_PRETO__';

function InsoleColorMappingPanel({ sheetId, soleGroupId, insoleGroupName, insoleColorMappings, upsertInsoleColor, products, groups }: {
  sheetId: string;
  soleGroupId: string;
  insoleGroupName: string;
  insoleColorMappings: any[];
  upsertInsoleColor: any;
  products: any[];
  groups: any[];
}) {
  const soleColors = useMemo(() => {
    const colors = products
      .filter((p: any) => p.group_id === soleGroupId && p.color)
      .map((p: any) => p.color as string);
    return [...new Set(colors)].sort();
  }, [products, soleGroupId]);

  const insoleGroup = groups.find((g: any) => g.name === insoleGroupName);
  const insoleColors = useMemo(() => {
    if (!insoleGroup) return [];
    const colors = products
      .filter((p: any) => p.group_id === insoleGroup.id && p.color)
      .map((p: any) => p.color as string);
    return [...new Set(colors)].sort();
  }, [products, insoleGroup]);

  const mappingMap = useMemo(() => {
    const m = new Map<string, string>();
    insoleColorMappings.forEach((ic: any) => m.set(ic.insole_color, ic.sole_color));
    return m;
  }, [insoleColorMappings]);

  const defaultSoleColor = mappingMap.get(TODAS_AS_CORES_KEY) || '';

  const handleToggleTodas = (soleColor: string) => {
    if (defaultSoleColor === soleColor) {
      upsertInsoleColor.mutate({ sheetId, insoleColor: TODAS_AS_CORES_KEY, soleColor: '' });
    } else {
      upsertInsoleColor.mutate({ sheetId, insoleColor: TODAS_AS_CORES_KEY, soleColor });
    }
  };

  if (soleColors.length === 0 || insoleColors.length === 0) return null;

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-bold">Cor do Solado pela Cor da Palmilha</h3>
        <Badge variant="outline" className="text-[9px] ml-auto">
          {insoleColorMappings.filter((m: any) => m.insole_color !== TODAS_AS_CORES_KEY).length}/{insoleColors.length} mapeados
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Defina qual cor de solado será usada para cada cor de palmilha. Use a opção de padrão para aplicar a mesma cor de solado em todas as cores, exceto Preto.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {insoleColors.map(insoleColor => {
          const currentSole = mappingMap.get(insoleColor) || (insoleColor.toLowerCase() === 'preto' ? 'Preto' : defaultSoleColor);
          const isPreto = insoleColor.toLowerCase() === 'preto';
          return (
            <div key={insoleColor} className="flex flex-col gap-2 p-2 rounded-md border bg-card">
              <div className="flex items-center gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Palmilha</span>
                  <span className="text-xs font-medium truncate">{insoleColor}</span>
                </div>
                <span className="text-muted-foreground text-xs">→</span>
                <div className="flex-1 min-w-0">
                  <Select
                    value={currentSole}
                    onValueChange={v => {
                      upsertInsoleColor.mutate({ sheetId, insoleColor, soleColor: v });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Cor solado..." />
                    </SelectTrigger>
                    <SelectContent>
                      {soleColors.map(sc => (
                        <SelectItem key={sc} value={sc} className="text-xs">{sc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!isPreto && (
                <button
                  type="button"
                  onClick={() => handleToggleTodas(currentSole || 'Caramelo')}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                    defaultSoleColor === currentSole && currentSole
                      ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {defaultSoleColor === currentSole && currentSole ? '✓ Padrão para todas as cores (exceto Preto)' : 'Usar esta cor de solado como padrão'}
                </button>
              )}
              {isPreto && (
                <p className="text-[9px] text-blue-600 dark:text-blue-400">
                  Regra recomendada: palmilha preta usa solado preto.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Sole Classification Badge =====
 * Mostra o tipo do solado (tradicional/palmilha_pronta/conjugado) + número
 * de conjugações/coligações cadastradas, ajudando o usuário a saber se o
 * solado está totalmente configurado.
 */
function SoleClassificationBadge({ groupId, soleMaterial, process, products }: {
  groupId: string;
  soleMaterial: string;
  process: string;
  products: any[];
}) {
  // Pega a classificação do produto específico (não agrega o grupo — pode ter
  // variantes com tipos diferentes em teoria, embora a recomendação seja
  // separar em grupos próprios).
  const matchedProduct = products.find(p => {
    if (p.group_id !== groupId) return false;
    const n = (p.name || '').toLowerCase().trim();
    const m = (soleMaterial || '').toLowerCase().trim();
    return n === m || n.startsWith(m + ' ') || n.startsWith(m + '-');
  });
  const classification = (matchedProduct as any)?.sole_classification || 'tradicional';

  // Query auxiliar pra contar conjugações/coligações
  const { data: extras } = useQuery({
    queryKey: ['sole_extras', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { count: conjCount } = await supabase
        .from('sole_size_conjugations')
        .select('*', { count: 'exact', head: true })
        .eq('sole_group_id', groupId);
      return { conjCount: conjCount || 0 };
    },
    staleTime: 5 * 60_000,
  });

  const styles = {
    tradicional: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', fg: 'text-emerald-700 dark:text-emerald-400', label: 'TRADICIONAL', hint: 'Cada número individual · palmilha cortada (dm²)' },
    palmilha_pronta: { bg: 'bg-violet-50 dark:bg-violet-950/30', border: 'border-violet-200 dark:border-violet-800', fg: 'text-violet-700 dark:text-violet-400', label: 'PALMILHA PRONTA', hint: 'Palmilha em un · coligação cor cabedal → palmilha' },
    conjugado: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', fg: 'text-amber-700 dark:text-amber-400', label: 'CONJUGADO', hint: 'Algumas numerações agrupadas (ex.: 33/34)' },
  } as const;
  const s = styles[classification as keyof typeof styles] || styles.tradicional;

  return (
    <div className={`p-3 rounded-md border-2 ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Check className={`h-3.5 w-3.5 ${s.fg}`} />
        <span className={`text-xs font-bold uppercase tracking-wider ${s.fg}`}>{s.label}</span>
        <span className="text-xs font-medium text-foreground">
          {soleMaterial}{process && ` • ${process}`}
        </span>
        {classification === 'conjugado' && extras && (
          <Badge variant="outline" className="text-[10px] h-5">
            {extras.conjCount} conjugação{extras.conjCount !== 1 ? 'ões' : ''} cadastrada{extras.conjCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <p className={`text-[10px] mt-1 ${s.fg} opacity-80`}>{s.hint}</p>
      {classification === 'conjugado' && extras?.conjCount === 0 && (
        <p className="text-[10px] mt-1 text-destructive font-semibold">
          ⚠ Nenhuma conjugação cadastrada — configure em Solados → editar este solado → aba Conjugações.
        </p>
      )}
    </div>
  );
}

/* ===== Sole Product Select (products from Solado groups — color-independent) ===== */
function SoleProductSelect({ label, value, onChange }: { label: string; value: string; onChange: (productName: string, groupId: string | null, productId?: string) => void }) {
  const { data: soleModels = [] } = useQuery({
    queryKey: ['products_solado_groups_unified'],
    queryFn: async () => {
      const { data: groups } = await supabase.from('product_groups').select('id, name').ilike('name', '%solado%');
      if (!groups || groups.length === 0) return [];
      const groupIds = groups.map(g => g.id);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, unit_price, quantity')
        .in('group_id', groupIds)
        .eq('active', true)
        .order('name');
      if (error) throw error;

      // Deduplicate by base model — sole is color-independent
      const normalizeBaseName = (name: string, color?: string | null): string => {
        return getSoleModelName(name, color).toLowerCase();
      };

      const modelMap = new Map<string, { id: string; name: string; group_id: string; groupName: string; totalStock: number; variantCount: number; sku: string | null }>();
      (data || []).forEach((p: any) => {
        const key = normalizeBaseName(p.name, p.color);
        const groupName = groups.find(g => g.id === p.group_id)?.name || '';
        const displayName = getSoleModelName(p.name, p.color);
        const existing = modelMap.get(key);
        if (existing) {
          existing.totalStock += Number(p.quantity || 0);
          existing.variantCount += 1;
        } else {
          modelMap.set(key, {
            id: p.id,
            name: displayName,
            group_id: p.group_id,
            groupName,
            totalStock: Number(p.quantity || 0),
            variantCount: 1,
            sku: p.sku,
          });
        }
      });
      return Array.from(modelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return soleModels;
    const q = search.toLowerCase();
    return soleModels.filter((m) => m.name?.toLowerCase().includes(q) || m.sku?.toLowerCase().includes(q) || m.groupName?.toLowerCase().includes(q));
  }, [soleModels, search]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {value || 'Selecionar solado...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar solado..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhum solado encontrado nos grupos de solado.</CommandEmpty>
              <CommandGroup heading={`Modelos de solado (${filtered.length})`}>
                {filtered.map((m) => (
                  <CommandItem key={m.id} value={m.id} onSelect={() => { onChange(m.name, m.group_id, m.id); setOpen(false); setSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === m.name ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.groupName} • {m.variantCount} cor{m.variantCount !== 1 ? 'es' : ''} • Estoque total: {m.totalStock.toLocaleString('pt-BR')}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ===== Direct Component Select (products from "Componentes" group) ===== */
function DirectComponentSelect({ label, value, onChange }: { label: string; value: string; onChange: (productId: string, productName: string, unitPrice: number) => void }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products_componentes_group'],
    queryFn: async () => {
      // Find the group named "Componentes"
      const { data: groups } = await supabase.from('product_groups').select('id').ilike('name', 'componentes').limit(1);
      if (!groups || groups.length === 0) return [];
      const groupId = groups[0].id;
      const { data, error } = await supabase.from('products').select('id, name, sku, unit_price, color').eq('group_id', groupId).eq('active', true).order('name');
      if (error) throw error;
      return data || [];
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.color?.toLowerCase().includes(q));
  }, [products, search]);

  const selected = products.find((p: any) => p.id === value);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {selected ? `${selected.name}${selected.color ? ` (${selected.color})` : ''}` : 'Selecionar componente...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar componente..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhum componente encontrado. Verifique se existe um grupo "Componentes" com produtos.</CommandEmpty>
              <CommandGroup heading={`Componentes (${filtered.length})`}>
                {filtered.map((p: any) => (
                  <CommandItem key={p.id} value={p.id} onSelect={() => { onChange(p.id, p.name, Number(p.unit_price || 0)); setOpen(false); setSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm">{p.name} {p.color ? `(${p.color})` : ''}</span>
                      {p.sku && <span className="text-[10px] text-muted-foreground font-mono">{p.sku}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ===== BOM / Materials ===== */
/**
 * Editor inline de NCM por produto.
 * Clica no NCM da linha do BOM → abre popover com input + save.
 * Atualiza products.ncm direto. Validação leve: aceita 8 dígitos OU vazio
 * (avisa visualmente em amber se diferente de 8 dígitos).
 */
function NcmInlineEditor({ productId, currentNcm }: { productId: string; currentNcm: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentNcm);

  useEffect(() => { if (open) setValue(currentNcm); }, [open, currentNcm]);

  const save = useMutation({
    mutationFn: async () => {
      const cleaned = value.replace(/\D/g, '');
      const { error } = await supabase
        .from('products')
        .update({ ncm: cleaned || null } as any)
        .eq('id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('NCM atualizado.');
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isValid = !currentNcm || /^\d{8}$/.test(currentNcm);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'px-1.5 py-0.5 rounded text-[11px] font-mono w-full text-left hover:bg-muted transition-colors',
            !isValid && 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
            !currentNcm && 'text-muted-foreground/60 italic',
          )}
          title={currentNcm ? (isValid ? 'Clique pra editar NCM' : 'NCM precisa ter 8 dígitos — clique pra corrigir') : 'Clique pra adicionar NCM'}
        >
          {currentNcm || '+ NCM'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-2">
        <Label className="text-[10px] uppercase tracking-wider font-bold">NCM (8 dígitos)</Label>
        <Input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="00000000"
          maxLength={20}
          className="font-mono text-sm h-8"
          onKeyDown={e => { if (e.key === 'Enter') save.mutate(); if (e.key === 'Escape') setOpen(false); }}
        />
        <p className="text-[10px] text-muted-foreground">
          Usado na emissão de NF-e. Validação: 8 dígitos numéricos.
        </p>
        <div className="flex justify-end gap-1.5 pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SheetBOM({ sheetId, lossPct, safetyPct, onLossChange, onSafetyChange, shoeCategory }: {
  sheetId: string; lossPct: number; safetyPct: number;
  onLossChange: (v: number) => void; onSafetyChange: (v: number) => void; shoeCategory?: string;
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
  const { data: sheets = [] } = useTechnicalSheets();
  const { data: componentSheets = [] } = useComponentSheets();
  const addMaterial = useAddSheetMaterial();
  const updateMaterial = useUpdateSheetMaterial(sheetId);
  const deleteMaterial = useDeleteSheetMaterial(sheetId);
  const bulkAdd = useBulkAddSheetMaterials();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; data: SheetMaterialFormData } | null>(null);
  const [form, setForm] = useState(emptyMaterialForm);
  const [showCopyDialog, setShowCopyDialog] = useState(false);

  const componentSheetMap = useMemo(() => {
    const map: Record<string, any> = {};
    componentSheets.forEach((cs: any) => { map[cs.product_id] = cs; });
    return map;
  }, [componentSheets]);

  const usedProductIds = new Set(materials.map(m => m.product_id));
  const usedGroupIds = new Set(materials.map((m: any) => m.group_id).filter(Boolean));
  const availableProducts = products.filter(p => p.active);
  const otherSheets = sheets.filter((s: any) => s.id !== sheetId);

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
       if (['Solado', 'Cabedal', 'Forro', 'Palmilha'].includes(cat)) return;

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
      const weightStr = cs.waste_pct ? `Perda: ${cs.waste_pct}%` : '';

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
        width: dimStr || f.width,
        weight: weightStr || f.weight,
        quantity_per_unit: avgConsumption > 0 ? Math.round(avgConsumption * 10000) / 10000 : f.quantity_per_unit,
        consumption_per_size: Object.keys(yieldPerSize).length > 0 ? yieldPerSize : f.consumption_per_size,
      }));
    } else {
      setForm(f => ({ ...f, product_id: rep.id, group_id: groupId }));
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
        quantity_per_unit: avgConsumption > 0 ? Math.round(avgConsumption * 10000) / 10000 : f.quantity_per_unit,
        consumption_per_size: Object.keys(yieldPerSize).length > 0 ? yieldPerSize : f.consumption_per_size,
      }));
    } else {
      setForm(f => ({ ...f, product_id: productId, group_id: prod?.group_id || null }));
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
    const cs = componentSheetMap[m.product_id];
    const wastePct = cs ? (cs.waste_pct || 0) : 0;
    const rawCost = Number(m.quantity_per_unit) * unitPrice;
    return rawCost * (1 + wastePct / 100);
  };

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const hasPerSize = Object.values(form.consumption_per_size || {}).some(v => Number(v) > 0);
    if (!form.product_id || (form.quantity_per_unit <= 0 && !hasPerSize)) return;

    const prod = products.find(p => p.id === form.product_id);
    const isSolado = prod?.category?.toLowerCase().includes('solado') || prod?.category?.toLowerCase().includes('sola');

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
            
            // Check if already in materials
            const alreadyExists = materials.some((m: any) => m.group_id === struct.default_group_id);
            if (alreadyExists) continue;

            const groupProds = products.filter(p => p.group_id === struct.default_group_id && p.active);
            const rep = groupProds[0];
            if (!rep) continue;

            const field = struct.component_type === 'Forro' ? 'lining_consumption_dm2' : 'insole_consumption_dm2';
            const perSize: Record<string, number> = {};
            specs?.forEach(s => {
              if (s[field] && Number(s[field]) > 0) perSize[String(s.size)] = Number(s[field]);
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
      .select('product_id, group_id, quantity_per_unit, color, width, weight, supplier, notes, sizes')
      .eq('sheet_id', sourceSheetId);
    if (!data?.length) { toast.error('Ficha sem materiais'); return; }
    const toAdd = data.filter(m => !usedProductIds.has(m.product_id)).map(m => ({ ...m, sizes: m.sizes || '' }));
    if (!toAdd.length) { toast.info('Todos os materiais já estão na ficha'); return; }
    bulkAdd.mutate({ sheetId, materials: toAdd });
    setShowCopyDialog(false);
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="mt-1 h-9 w-full justify-between text-sm font-normal">
                    {form.group_id ? (groups.find((g: any) => g.id === form.group_id)?.name || 'Grupo selecionado') : 'Selecionar grupo...'}
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar grupo..." />
                    <CommandList>
                      <CommandEmpty>Nenhum grupo encontrado</CommandEmpty>
                      <CommandGroup>
                        {groups.filter((g: any) => !usedGroupIds.has(g.id)).map((g: any) => (
                          <CommandItem key={g.id} value={g.id} onSelect={() => handleGroupSelect(g.id)}>
                            <Check className={cn("mr-2 h-4 w-4", form.group_id === g.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col">
                              <span className="text-sm">{g.name}</span>
                              {g.description && <span className="text-[10px] text-muted-foreground">{g.description}</span>}
                              {g.colors && <span className="text-[10px] text-muted-foreground">Cores: {g.colors}</span>}
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
                          {p.color && <Badge variant="outline" className="text-[10px]">{p.color}</Badge>}
                          <span className="text-xs text-muted-foreground font-mono">{p.unit}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.unit_price || 0)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {groupProductsForSelection.length} itens no grupo — cada item pode ter preço e consumo diferentes
                </p>
              </div>
            )}

            {/* Fallback: individual product for items without group */}
            {!form.group_id && (
              <div className="col-span-2 sm:col-span-3">
                <Label className="text-[10px] text-muted-foreground">Ou selecione um produto individual (sem grupo)</Label>
                <Select value={form.product_id} onValueChange={handleProductSelect}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Produto individual..." /></SelectTrigger>
                  <SelectContent>
                    {availableProducts.filter(p => !p.group_id).map(p => (
                      <SelectItem key={p.id} value={p.id} disabled={usedProductIds.has(p.id)}>
                        <span className="flex items-center gap-2">
                          {p.name}
                          <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>
                          <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
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
                    {prod.color && <Badge variant="outline" className="text-[10px]">{prod.color}</Badge>}
                    <Badge variant="secondary" className="text-[10px] ml-auto">{getConsumptionUnit(prod.id)}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Preço un.:</span> <span className="font-mono font-semibold">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.unit_price || 0)}</span></div>
                    <div><span className="text-muted-foreground">Estoque:</span> <span className="font-mono">{(prod.quantity ?? 0).toLocaleString('pt-BR')}</span></div>
                    {cs && cs.waste_pct > 0 && <div><span className="text-muted-foreground">Perda:</span> <span className="font-mono">{cs.waste_pct}%</span></div>}
                    {cs && cs.dimensions_length > 0 && (
                      <div><span className="text-muted-foreground">Dim.:</span> <span className="font-mono">{cs.dimensions_length}×{cs.dimensions_width} {cs.dimensions_unit}</span></div>
                    )}
                  </div>
                  {!cs && (
                    <div className="flex items-center gap-2 mt-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span className="text-[10px]">Sem Ficha de Componente — custo será Qtd/par × Preço unitário</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
          </div>

          {/* Per-size consumption grid */}
          <div>
            <Label className="text-xs font-semibold">Consumo por Numeração ({getConsumptionUnit(form.product_id)}/par)</Label>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              Defina o consumo unitário para cada tamanho. O cálculo industrial usa exclusivamente estes valores por numeração.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MATERIAL_SIZES.map(size => {
                const sizeKey = String(size);
                const perSize = form.consumption_per_size || {};
                return (
                  <div key={size} className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">{size}</span>
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
                      className="w-[60px] h-7 text-[10px] text-center font-mono"
                      placeholder="0"
                      step="0.001"
                    />
                  </div>
                );
              })}
              <div className="flex flex-col gap-0.5 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px]"
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
            <Button size="sm" onClick={handleAdd} disabled={!form.product_id || (form.quantity_per_unit <= 0 && Object.values(form.consumption_per_size || {}).every(v => Number(v) <= 0)) || addMaterial.isPending}>
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
                <TableHead className="text-[11px]">Material / Grupo</TableHead>
                <TableHead className="text-[11px]">Cat.</TableHead>
                <TableHead className="text-[11px] font-mono">NCM</TableHead>
                <TableHead className="text-[11px] font-mono">SKU</TableHead>
                <TableHead className="text-[11px]">Dimensões</TableHead>
                <TableHead className="text-[11px]">Un.</TableHead>
                <TableHead className="text-[11px] text-right">Qtd/Par</TableHead>
                <TableHead className="text-[11px] text-center">Rend.</TableHead>
                <TableHead className="text-[11px]">Forn.</TableHead>
                <TableHead className="text-[11px] text-right">Custo/Par</TableHead>
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
                        <TableCell colSpan={11} className="py-2 bg-primary/5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-primary">
                              {section === 'base' ? '📐 Base do Solado — Consumo padrão' : '🎨 Depende do Modelo'}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {section === 'base' ? '(indiferente à cor do solado)' : '(específico por referência)'}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  
                  rows.push(
                    <TableRow key={`cat-${cat}`} className="bg-muted/20">
                      <TableCell colSpan={11} className="py-1.5">
                        <div className="flex items-center gap-2">
                          <CatIcon className={`h-3.5 w-3.5 ${catConfig?.color || 'text-muted-foreground'}`} />
                          <span className="text-xs font-semibold">{catConfig?.label || cat}</span>
                          <Badge variant="outline" className="text-[10px]">{mats.length}</Badge>
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
                    rows.push(
                      <TableRow key={m.id}>
                        <TableCell className="text-xs font-medium">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              {displayName}
                              {groupInfo && <Badge variant="outline" className="text-[8px]">Grupo</Badge>}
                              {cs && <Badge variant="outline" className="text-[8px] bg-accent/30 border-accent">FT</Badge>}
                            </div>
                            {prod?.name && groupInfo && prod.name !== groupInfo.name && (
                              <span className="text-[10px] text-muted-foreground">Item: {prod.name}{prod.color ? ` (${prod.color})` : ''}</span>
                            )}
                            {perSizeEntries.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 mt-0.5">
                                {perSizeEntries.map(([size, qty]: [string, any]) => (
                                  <span key={size} className="text-[9px] font-mono bg-muted px-1 rounded">{size}:{safeToFixed(qty, 2)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{prod?.category ?? '—'}</TableCell>
                        <TableCell className="text-[11px] font-mono p-1">
                          <NcmInlineEditor productId={m.product_id} currentNcm={prod?.ncm || ''} />
                        </TableCell>
                        <TableCell className="text-[11px] font-mono text-muted-foreground">
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
                        <TableCell className="text-xs text-right font-mono">{formatCurrency(costPair)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-primary hover:text-primary" onClick={() => handleEdit(m)}>
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
                              {p.color && <Badge variant="outline" className="text-[10px]">{p.color}</Badge>}
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
                        <span className="text-[10px] font-mono text-muted-foreground">{size}</span>
                        <NumberInput
                          value={perSize[sizeKey] || 0}
                          onChange={(val) => {
                            const newPerSize = { ...perSize, [sizeKey]: val };
                            const avg = recalcAvgFromPerSize(newPerSize);
                            setEditing(ed => ed ? { ...ed, data: { ...ed.data, consumption_per_size: newPerSize, quantity_per_unit: avg > 0 ? Math.round(avg * 10000) / 10000 : ed.data.quantity_per_unit } } : null);
                          }}
                          className="w-[60px] h-7 text-[10px] text-center font-mono"
                          placeholder="0"
                          step="0.001"
                        />
                      </div>
                    );
                  })}
                  <div className="flex flex-col gap-0.5 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px]"
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
            
            <div className="flex justify-end gap-2 pt-4">
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button size="sm" onClick={handleUpdateSubmit} disabled={updateMaterial.isPending}>
                {updateMaterial.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


/* ===== Costs Tab ===== */
function CostsTab({ sheetId, form, groups }: {
  sheetId: string;
  form: SheetFormData; groups: { id: string; name: string }[];
}) {
  const { data: materials = [] } = useSheetMaterials(sheetId);
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: operations = [] } = useBomOperations(sheetId);
  const { data: costPolicy } = useCostPolicies();

  const { data: groupsWithPricing = [] } = useQuery({
    queryKey: ['product_groups_pricing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, package_price, package_weight_kg, dimensions_length, dimensions_width, dimensions_unit').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: groupAvgPrices = [] } = useQuery({
    queryKey: ['product_groups_avg_prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('group_id, unit_price')
        .eq('active', true)
        .not('group_id', 'is', null);
      if (error) throw error;
      const groupMap: Record<string, { total: number; count: number }> = {};
      (data || []).forEach((p: any) => {
        if (!p.group_id || !p.unit_price) return;
        if (!groupMap[p.group_id]) groupMap[p.group_id] = { total: 0, count: 0 };
        groupMap[p.group_id].total += Number(p.unit_price);
        groupMap[p.group_id].count += 1;
      });
      return Object.entries(groupMap).map(([id, v]) => ({ id, avg_price: v.total / v.count }));
    },
  });

  const componentSheetMap = useMemo(() => {
    const map: Record<string, any> = {};
    componentSheets.forEach((cs: any) => { map[cs.product_id] = cs; });
    return map;
  }, [componentSheets]);

  // De-duplication: skip legacy sheet_materials entries whose category is already
  // accounted for in modern Especificações (Cabedal/Forração/Palmilha/Sola/Tiras),
  // preventing double-counting that inflates the total cost.
  const specsCoveredCategories = useMemo(() => {
    const set = new Set<string>();
    const upperPerSizeFilled = Object.values(((form as any).upper_consumption_per_size || {}) as Record<string, number>)
      .some(v => Number(v) > 0);
    if (form.upper_material && (form.upper_consumption > 0 || upperPerSizeFilled)) set.add('Cabedal');
    if (form.lining_material && form.lining_consumption > 0) set.add('Forração');
    if (form.insole_material && form.insole_consumption > 0) set.add('Palmilha');
    if (form.sole_material && form.sole_consumption > 0) { set.add('Sola'); set.add('Solado'); }
    if (form.has_straps && form.strap_colors?.length) set.add('Tiras');
    return set;
  }, [form]);

  const categoryCosts = useMemo(() => {
    const costs: Record<string, number> = {};
    let total = 0;
    const skipped: string[] = [];
    materials.forEach(m => {
      const rawCat = (m as any).products?.category || 'Outros';
      const cat = matchCategory(rawCat);
      // Skip if this category is already covered by Especificações (avoids duplicidade)
      if (specsCoveredCategories.has(cat)) { skipped.push(rawCat); return; }
      const cs = componentSheetMap[m.product_id];
      const unitPrice = Number((m as any).products?.unit_price || 0);
      const wastePct = cs ? (cs.waste_pct || 0) : 0;
      const cost = Number(m.quantity_per_unit) * unitPrice * (1 + wastePct / 100);
      costs[cat] = (costs[cat] || 0) + cost;
      total += cost;
    });
    return { costs, total, skippedLegacyCount: skipped.length };
  }, [materials, componentSheetMap, specsCoveredCategories]);

  const getGroupPlateAreaDm2 = (group: any): number => {
    if (!group?.dimensions_length || !group?.dimensions_width) return 0;
    const unit = (group.dimensions_unit || 'mm').toLowerCase();
    let l = Number(group.dimensions_length);
    let w = Number(group.dimensions_width);
    if (unit === 'cm') { l *= 10; w *= 10; }
    if (unit === 'm') { l *= 1000; w *= 1000; }
    return (l * w) / 10000;
  };

  const getGroupPricePerDm2 = (groupName: string) => {
    const group = groupsWithPricing.find(g => g.name === groupName);
    if (!group) return 0;
    const plateArea = getGroupPlateAreaDm2(group);
    if (plateArea > 0 && group.package_price && group.package_price > 0) return group.package_price / plateArea;
    if (group.package_price && group.package_weight_kg && group.package_weight_kg > 0) return group.package_price / group.package_weight_kg;
    const avg = groupAvgPrices.find(a => a.id === group.id);
    const avgPrice = avg?.avg_price || 0;
    // avg_price is price per unit (plate). Convert to price per dm² if plate area is known.
    if (avgPrice > 0 && plateArea > 0) return avgPrice / plateArea;
    return avgPrice;
  };

  const getGroupPricePerDm2ById = (groupId: string) => {
    const group = groupsWithPricing.find(g => g.id === groupId);
    if (!group) return 0;
    const plateArea = getGroupPlateAreaDm2(group);
    if (plateArea > 0 && group.package_price && group.package_price > 0) return group.package_price / plateArea;
    if (group.package_price && group.package_weight_kg && group.package_weight_kg > 0) return group.package_price / group.package_weight_kg;
    const avg = groupAvgPrices.find(a => a.id === groupId);
    const avgPrice = avg?.avg_price || 0;
    if (avgPrice > 0 && plateArea > 0) return avgPrice / plateArea;
    return avgPrice;
  };

  const specsCosts = useMemo(() => {
    const items: { label: string; material: string; consumption: number; pricePerUnit: number; cost: number }[] = [];
    // Helper: o consumo efetivo SEMPRE prioriza a grade por numeração (consumption_per_size).
    // O campo "consumption" (média) é usado apenas como fallback quando a grade está vazia.
    const effectiveConsumption = (perSize: Record<string, number> | null | undefined, fallbackAvg: number): number => {
      if (perSize && typeof perSize === 'object') {
        const vals = Object.values(perSize).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return Number(fallbackAvg) || 0;
    };
    const upperEff = effectiveConsumption((form as any).upper_consumption_per_size, form.upper_consumption);
    if (form.upper_material && upperEff > 0) {
      const price = getGroupPricePerDm2(form.upper_material);
      items.push({ label: 'Cabedal', material: form.upper_material, consumption: upperEff, pricePerUnit: price, cost: upperEff * price });
    }
    (form.components_accessories || []).forEach((extra: any, idx: number) => {
      const eff = effectiveConsumption(extra.consumption_per_size, extra.consumption);
      if (extra.material && eff > 0 && !extra.id) {
        const price = getGroupPricePerDm2(extra.material);
        const label = extra.mandatory ? `Material Fixo (${extra.material})` : `Cabedal ${idx + 2}`;
        items.push({ label, material: extra.material, consumption: eff, pricePerUnit: price, cost: eff * price });
      }
    });
    if (form.lining_material && form.lining_consumption > 0) {
      const price = getGroupPricePerDm2(form.lining_material);
      items.push({ label: 'Forração', material: form.lining_material, consumption: form.lining_consumption, pricePerUnit: price, cost: form.lining_consumption * price });
    }
    // lining_accessories are alternative options, NOT additive — only primary forração counts for cost
    if (form.insole_material && form.insole_consumption > 0) {
      const price = getGroupPricePerDm2(form.insole_material);
      items.push({ label: 'Palmilha', material: form.insole_material, consumption: form.insole_consumption, pricePerUnit: price, cost: form.insole_consumption * price });
    }
    if (form.sole_material && form.sole_consumption > 0) {
      const price = getGroupPricePerDm2(form.sole_material);
      items.push({ label: 'Sola', material: form.sole_material, consumption: form.sole_consumption, pricePerUnit: price, cost: form.sole_consumption * price });
    }
    // Direct components (unit-based)
    (form.direct_components || []).forEach((comp: any, idx: number) => {
      if (comp.product_id && comp.quantity > 0 && comp.unit_price > 0) {
        items.push({ label: comp.product_name || `Componente ${idx + 1}`, material: 'un', consumption: comp.quantity, pricePerUnit: comp.unit_price, cost: comp.quantity * comp.unit_price });
      }
    });
    return items;
  }, [form, groupsWithPricing]);

  const strapsCosts = useMemo(() => {
    if (!form.has_straps || !form.strap_colors?.length) return [];
    return (form.strap_colors || []).map((strap: any) => {
      const groupId = strap.group_id;
      const perSize: Record<string, number> = strap.consumption_per_size || {};
      const filledVals = (Object.values(perSize) as any[]).map(v => Number(v)).filter(v => v > 0);
      const consumption = filledVals.length > 0 ? filledVals.reduce((a, b) => a + b, 0) / filledVals.length : Number(strap.consumption || 0);
      if (!groupId || consumption <= 0) return null;
      const price = getGroupPricePerDm2ById(groupId);
      const group = groupsWithPricing.find(g => g.id === groupId);
      return { label: strap.label || 'Tira', material: group?.name || '—', consumption, pricePerUnit: price, cost: consumption * price };
    }).filter(Boolean) as { label: string; material: string; consumption: number; pricePerUnit: number; cost: number }[];
  }, [form, groupsWithPricing]);

  const specsTotalCost = specsCosts.reduce((s, i) => s + i.cost, 0);
  const strapsTotalCost = strapsCosts.reduce((s, i) => s + i.cost, 0);
  const bomTotalCost = categoryCosts.total;
  const modTotalCost = operations.reduce((s: number, op: any) => s + Number(op.cost_per_pair || 0), 0);
   const overheadPerPair = (form as any).custom_overhead !== null && (form as any).custom_overhead !== undefined
     ? Number((form as any).custom_overhead)
     : (costPolicy?.overhead_rate_per_pair || 0);
  const packagingPerPair = costPolicy?.packaging_cost_per_pair || 0;
  const materialTotal = bomTotalCost + specsTotalCost + strapsTotalCost;
  const grandTotal = materialTotal + modTotalCost + overheadPerPair + packagingPerPair;
  const formatCurrency = (v: any) => globalFormatCurrency(v);

  const hasAnyData = materials.length > 0 || specsCosts.length > 0 || strapsCosts.length > 0 || operations.length > 0;
  if (!hasAnyData) {
    return <div className="text-center py-8 text-muted-foreground"><p className="text-sm">Adicione materiais no BOM, operações ou preencha Especificações para calcular custos</p></div>;
  }

  const { data: overheadHistory = [] } = useOverheadHistory(sheetId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle>Análise de Custo por Par</SectionTitle>
        {overheadHistory.length > 0 && (
           <Popover>
             <PopoverTrigger asChild>
               <Button variant="outline" size="sm" className="gap-2 h-7 text-[10px]">
                 <History className="h-3 w-3" />
                 Histórico de GGF
               </Button>
             </PopoverTrigger>
             <PopoverContent className="w-80 p-0" align="end">
               <div className="p-3 border-b bg-muted/30">
                 <h4 className="text-xs font-semibold">Histórico de Alterações GGF</h4>
                 <p className="text-[10px] text-muted-foreground">Últimas mudanças no overhead customizado</p>
               </div>
               <div className="max-h-60 overflow-y-auto">
                 {overheadHistory.map((entry) => (
                   <div key={entry.id} className="p-3 border-b last:border-0 text-[11px] space-y-1 hover:bg-muted/20 transition-colors">
                     <div className="flex items-center justify-between">
                       <span className="font-semibold text-primary">
                         {entry.new_value !== null ? formatCurrency(entry.new_value) : "Padrão"}
                       </span>
                       <span className="text-[10px] text-muted-foreground font-mono">
                         {new Date(entry.created_at).toLocaleDateString('pt-BR')}
                       </span>
                     </div>
                     <div className="flex items-center justify-between text-muted-foreground">
                       <span>De: {entry.old_value !== null ? formatCurrency(entry.old_value) : "Padrão"}</span>
                       <span className="italic">{entry.profiles?.full_name || "Sistema"}</span>
                     </div>
                   </div>
                 ))}
               </div>
             </PopoverContent>
           </Popover>
        )}
      </div>

      {materials.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Materiais BOM</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Componente</TableHead>
                <TableHead className="text-xs text-center">Itens</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
                <TableHead className="text-xs text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPONENT_CATEGORIES.map(catConfig => {
                const catCost = categoryCosts.costs[catConfig.key] || 0;
                if (catCost === 0) return null;
                const pct = grandTotal > 0 ? (catCost / grandTotal * 100) : 0;
                const CatIcon = catConfig.icon;
                const groupMats = materials.filter(m => matchCategory((m as any).products?.category || '') === catConfig.key);
                return (
                  <TableRow key={catConfig.key}>
                    <TableCell className="text-sm"><div className="flex items-center gap-2"><CatIcon className={`h-4 w-4 ${catConfig.color}`} /><span className="font-medium">{catConfig.label}</span></div></TableCell>
                    <TableCell className="text-sm text-center font-mono">{groupMats.length}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{formatCurrency(catCost)}</TableCell>
                    <TableCell className="text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                        <span className="text-xs font-mono text-muted-foreground w-12 text-right">{safeToFixed(pct, 1)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell className="text-sm">Subtotal BOM</TableCell>
                <TableCell className="text-sm text-center font-mono">{materials.length}</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(bomTotalCost)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {specsCosts.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Especificações Técnicas</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Componente</TableHead>
                <TableHead className="text-xs">Material / Grupo</TableHead>
                <TableHead className="text-xs text-right">Consumo/par</TableHead>
                <TableHead className="text-xs text-right">Preço/un</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {specsCosts.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm font-medium">{item.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.material}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.consumption.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.pricePerUnit > 0 ? formatCurrency(item.pricePerUnit) : <span className="text-destructive text-xs">Sem preço</span>}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-semibold">{formatCurrency(item.cost)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={4} className="text-sm">Subtotal Especificações</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(specsTotalCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {strapsCosts.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tiras</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Tira</TableHead>
                <TableHead className="text-xs">Material / Grupo</TableHead>
                <TableHead className="text-xs text-right">Consumo (dm²/par)</TableHead>
                <TableHead className="text-xs text-right">Preço/dm²</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strapsCosts.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm font-medium">{item.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.material}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.consumption.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.pricePerUnit > 0 ? formatCurrency(item.pricePerUnit) : <span className="text-destructive text-xs">Sem preço</span>}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-semibold">{formatCurrency(item.cost)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={4} className="text-sm">Subtotal Tiras</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(strapsTotalCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableBody>
            <TableRow className="bg-muted/20">
              <TableCell className="text-sm font-bold">Material (BOM + Especificações + Tiras)</TableCell>
              <TableCell className="text-sm text-right font-mono font-bold">{formatCurrency(materialTotal)}</TableCell>
            </TableRow>
            {modTotalCost > 0 && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">Mão de Obra Direta (MOD)</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(modTotalCost)}</TableCell>
              </TableRow>
            )}
             {(overheadPerPair > 0 || (form as any).custom_overhead !== null) && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">
                  Overhead Alocado
                  {(form as any).custom_overhead !== null && (
                    <Badge variant="outline" className="ml-2 text-[8px] bg-amber-50 text-amber-600 border-amber-200">Customizado</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(overheadPerPair)}</TableCell>
              </TableRow>
            )}
            {packagingPerPair > 0 && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">Embalagem</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(packagingPerPair)}</TableCell>
              </TableRow>
            )}
            <TableRow className="bg-muted/30 font-bold">
              <TableCell className="text-sm">Custo Padrão por Par</TableCell>
              <TableCell className="text-sm text-right font-mono font-bold">{formatCurrency(grandTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* PackagingTab is now imported from src/components/technical-sheets/PackagingTab.tsx */
