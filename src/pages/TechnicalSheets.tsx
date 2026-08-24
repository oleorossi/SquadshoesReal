 // VariantOverviewHeader removido — variantes de cor não fazem mais parte da
 // ficha técnica (cor é definida no PV). Variantes de material aparecem na
 // tab "Variantes" da ficha. Componente substituído por inline <></> abaixo
 // pra não quebrar callers.
 function VariantOverviewHeader(_: { sheet: any }) {
   return null;
 }
 
 import { CaretRight as ChevronRight, CheckCircle } from '@phosphor-icons/react';
 
import React, { useState, useMemo, useEffect } from 'react';
import { buildBulkSolePatch, evaluateTechnicalSheetReadiness } from '@/lib/technicalSheetReadiness';
import type { TechnicalSheetAuditSignals } from '@/lib/technicalSheetReadiness';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useSearchParams, Link } from 'react-router-dom';
import { SignedImage } from '@/components/ui/signed-image';
import { useDisplaySizeKeys } from '@/lib/soleGradeKeys';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { FileText, Plus, Trash as Trash2, PencilSimple as Pencil, CircleNotch as Loader2, Package, Copy, Stack as Layers, Scissors, Drop as Droplets, Shield, Cube as Box, Footprints, FloppyDisk as Save, Wrench, Tag, ImageSquare as ImagePlus, Warning as AlertTriangle, ClockCounterClockwise as History, Factory, MagicWand as Wand2, ArrowsClockwise as RefreshCw, Gauge, ArrowLeft, ClipboardText as ClipboardCopy, Lock, Palette, CurrencyDollar as DollarSign, GridFour, ListBullets } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { RequiredMark } from '@/components/ui/required-mark';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FichaCortePrintTab } from '@/components/technical-sheets/FichaCortePrintTab';
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
import { TechnicalSheetCardGrid } from '@/components/technical-sheets/TechnicalSheetCardGrid';
import { QuickSheetSelector } from '@/components/technical-sheets/QuickSheetSelector';
import { AviamentoRangeTab } from '@/components/technical-sheets/AviamentoRangeTab';
import { TechnicalSheetReadinessRail } from '@/components/technical-sheets/TechnicalSheetReadinessRail';
import { useBomOperations } from '@/hooks/useBomOperations';
import { useSoleColorMappings, useUpsertSoleColorMapping } from '@/hooks/useSoleColorMappings';
 import { usePalmilhaColorMappings, useUpsertPalmilhaColorMapping, PALMILHA_DEFAULT_KEY } from '@/hooks/usePalmilhaColorMappings';
 import { useLiningColorMappings, useUpsertLiningColorMapping, LINING_DEFAULT_KEY } from '@/hooks/useLiningColorMappings';
 import { useComponentColorMappings, useAddComponentColorRow, useUpdateComponentColorRow, useDeleteComponentColorRow } from '@/hooks/useComponentColorMappings';
 import { useComponentColorDefaults } from '@/hooks/useComponentColorDefaults';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { useArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import { useProducts } from '@/hooks/useProducts';
import { useReadyStock } from '@/hooks/useReadyStock';
import { useCan } from '@/hooks/useAccessControl';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, CaretUpDown as ChevronsUpDown, Paperclip, Handshake } from '@phosphor-icons/react';
import { ReferenceTerceirizacoesPanel } from '@/components/technical-sheets/ReferenceTerceirizacoesPanel';
import { cn, getSoleModelName, parseSafeNumber, formatCurrency as globalFormatCurrency, safeToFixed } from '@/lib/utils';
import { needsWidthForConversion, effectiveConversionFactor } from '@/lib/purchaseConversion';
import { bomMaterialCostPerPair } from '@/lib/materialConsumption';
import { getShoeSizeMappings } from '@/utils/shoeUtils';
import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapIdentity,
  ensureTechnicalStrapLineIds,
  hasCanonicalTechnicalStrapIdentity,
  newTechnicalStrapLineId,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis } from '@/lib/strapIdentity';
import { referenceStrapBaseGroups } from '@/lib/referenceStrapBaseGroups';

import { useShoeCategories } from '@/hooks/useShoeCategories';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';
import { AppErrorBoundary } from '@/components/ErrorBoundary';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';
import { Link as Link2, Info } from '@phosphor-icons/react';
import { SoleSizeConjugationsEditor } from '@/components/inventory/SoleSizeConjugationsEditor';
import { ComponentGroupSelect, GroupMaterialSelect, SoleClassificationBadge, SoleProductSelect, DirectComponentSelect, NcmInlineEditor } from '@/components/technical-sheets/sheetSelectors';
const STATUSES = ['Ativo', 'Em desenvolvimento', 'Descontinuado'] as const;
const STATUS_FICHA = ['rascunho', 'em_revisao', 'validada', 'publicada'] as const;
const STATUS_FICHA_LABELS: Record<string, string> = { rascunho: 'Rascunho', em_revisao: 'Em Revisão', validada: 'Validada', publicada: 'Publicada' };
// GENDERS removido em 2026-05: campo `gender` foi marcado como dead code
// (nunca era lido em business logic, search, filtros ou cálculos).
const SOLE_PROCESSES = ['Injetada', 'Colada', 'Costurada', 'Vulcanizada'] as const;
const ACABAMENTOS_TIRAS = ['brilho', 'fosco', 'metálico', 'metalic', 'glow', 'texturizado', 'envernizado'] as const;
const MATERIAIS_SOLADO = ['TR', 'EVA', 'Borracha', 'PVC', 'TPU'] as const;
type CatalogView = 'cards' | 'list';
const normalizeGroupName = (value?: string | null) =>
  (value || '').trim().toLocaleLowerCase('pt-BR');

const COMPONENT_CATEGORIES = [
  // === Base do Solado (padrão, independente de cor) ===
  { key: 'Solado', label: 'Solado', icon: Footprints, color: 'text-muted-foreground', aliases: ['solado'], section: 'base' },
  { key: 'Palmilha', label: 'Palmilha', icon: Shield, color: 'text-blue-600', aliases: ['palmilha', 'placa de palmilha'], section: 'base' },
  { key: 'Forração', label: 'Forração', icon: Scissors, color: 'text-purple-600', aliases: ['forro', 'forração', 'forração da palmilha'], section: 'base' },
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
    <div className="text-xs text-muted-foreground mt-0.5 font-mono leading-tight">
      Placa: {safeArea.toFixed(1)} dm² → <span className="font-semibold text-primary">{pairs} pares/placa</span>
      <span className="ml-1 opacity-70">({aproveitamento}%)</span>
    </div>
  );
}

const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];

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
  product_id: '', group_id: null, quantity_per_unit: 0, consumption_per_size: {}, color: '', width: '', weight: '', supplier: '', notes: '', sizes: '', consumption_sector: '',
};

const CONSUMPTION_SECTORS = [
  'Corte Fibra', 'Corte Forração', 'Corte Cabedal', 'Costura Palmilha',
  'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem',
  'Acabamento',
] as const;

/** Sugestão inicial; a ficha sempre exige confirmação explícita do usuário. */
function suggestedConsumptionSector(category?: string | null): string {
  const normalized = normalizeForSearch(category || '');
  if (/solado|sola/.test(normalized)) return 'Solagem';
  if (/embal|caixa|etiqueta|papel/.test(normalized)) return 'Acabamento';
  if (/cola|adesivo|primer|quimic/.test(normalized)) return 'Colagem';
  if (/linha|fio/.test(normalized)) return 'Costura Palmilha';
  if (/aviamento|acessorio|elast|ilh[oó]|fivela|rebite|fachete|contraforte|coura[cç]a|refor[cç]/.test(normalized)) return 'Aviamento';
  return '';
}

export default function TechnicalSheets({ embedded }: { embedded?: boolean } = {}) {
  const { data: sheets = [], isLoading } = useTechnicalSheets();
  const { data: stock = [] } = useReadyStock();
  // Map sheet_id -> array de variantes de material ativas. Usado pra exibir
  // badge na lista de fichas indicando que tem opções de material extra.
  const { data: materialVariantsBySheet } = useAllActiveReferenceMaterialVariants();
  const addSheet = useAddSheet();
  const deleteSheet = useDeleteSheet();
  const updateSheet = useUpdateSheet();
  const perm = useCan('/fichas-tecnicas');

  const cloneSheet = useCloneSheet();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<string>('');
  const [cloneNewName, setCloneNewName] = useState<string>('');
  const [cloneSearchTerm, setCloneSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Deep-link via ?ref=<id> (usado pelo IncompleteWeightWarning em outras
  // telas pra pular direto pra ficha que precisa cadastrar peso).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const refFromUrl = searchParams.get('ref');
    const createFromUrl = searchParams.get('new') === '1';
    if (createFromUrl && !perm.loading) {
      if (perm.canCreate) setDialogOpen(true);
      else toast.error('Você não tem permissão para criar ficha técnica.');
    }
    if (refFromUrl && refFromUrl !== expandedId) {
      setExpandedId(refFromUrl);
    }
    if ((refFromUrl && refFromUrl !== expandedId) || (createFromUrl && !perm.loading)) {
      // Remove só os comandos consumidos. `tab=variants`, por exemplo, precisa
      // permanecer pra abrir a ficha diretamente na seleção de materiais.
      const next = new URLSearchParams(searchParams);
      if (refFromUrl) next.delete('ref');
      if (createFromUrl && !perm.loading) next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [imageDialogSheet, setImageDialogSheet] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [soleFilter, setSoleFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [catalogView, setCatalogView] = useState<CatalogView>(() => {
    if (typeof window === 'undefined') return 'cards';
    try {
      return window.localStorage.getItem('technical-sheets-catalog-view') === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });
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
      result = result.filter((s: any) =>
        searchMatchesAllTerms(searchTerm, s.name, s.code, s.collection, s.shoe_category, s.colors, s.description, s.status)
      );
    }
    return result;
  }, [sheets, categoryFilter, soleFilter, searchTerm]);

  // Fichas candidatas do dialog de cópia (busca própria do dialog)
  const cloneFilteredSheets = useMemo(
    () => (sheets as any[]).filter((s: any) => searchMatchesAllTerms(cloneSearchTerm, s.name, s.code)),
    [sheets, cloneSearchTerm],
  );

  const handleCatalogViewChange = (view: CatalogView) => {
    setCatalogView(view);
    try {
      window.localStorage.setItem('technical-sheets-catalog-view', view);
    } catch {
      // A preferência permanece válida durante a sessão quando o navegador bloqueia o storage.
    }
  };

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
          const patch = buildBulkSolePatch(target, src, soleName, overwrite);
          if (Object.keys(patch).length === 0) { skippedNoChange++; return; }
          try {
            await updateSheet.mutateAsync({ id: target.id, data: patch });
            applied++;
          } catch (err) {
            console.error('Falha ao atualizar ficha', target.id, err);
            failed++;
          }
        }));
      }
      const parts = [`Solado "${soleName}" aplicado em ${applied} ${applied === 1 ? 'ficha' : 'fichas'}.`];
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
      <div className="space-y-4 page-enter editorial-stagger">
        <NonFiniteDevWatcher />
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · FICHAS"
          title="Fichas Técnicas"
          description="Materiais, consumos e custos"
          actions={
            <>
              <SheetsAuditButton onJumpToSheet={(id) => setExpandedId(id)} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2" aria-label="Abrir ferramentas das fichas técnicas">
                    <Wrench className="h-4 w-4" />
                    <span className="hidden sm:inline">Ferramentas</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem asChild className="gap-2">
                    <Link to="/fichas-tecnicas/padroes">
                      <Palette className="h-4 w-4" /> Padrões por cor
                    </Link>
                  </DropdownMenuItem>
                  {!expandedId && (
                    <DropdownMenuItem
                      onSelect={handleBulkApplySoleSettings}
                      disabled={bulkSoleApplying || filteredSheets.length === 0}
                      className="gap-2"
                    >
                      {bulkSoleApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      Aplicar solado em massa
                    </DropdownMenuItem>
                  )}
                  {perm.canCreate && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => { setCloneSourceId(''); setCloneNewName(''); setCloneSearchTerm(''); setCloneDialogOpen(true); }}
                        className="gap-2"
                      >
                        <ClipboardCopy className="h-4 w-4" /> Copiar ficha
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {perm.canCreate && (
                <Button onClick={() => setDialogOpen(true)} className="gap-2" aria-label="Criar nova ficha técnica" title="Nova ficha técnica">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Nova Ficha</span>
                </Button>
              )}
            </>
          }
        />

         {!expandedId && (
           <QuickSheetSelector
             sheets={sheets} 
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
              <DialogDescription>
                Aplicar em <span className="font-semibold text-foreground">{filteredSheets.length}</span> {filteredSheets.length === 1 ? 'ficha listada' : 'fichas listadas'}.
                Os dados (consumo, processo e grupo) serão copiados da ficha mais recente que utiliza o solado escolhido.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
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
                <p className="text-xs text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    Se desmarcado, apenas campos vazios serão preenchidos.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkSoleDialogOpen(false)} disabled={bulkSoleApplying}>
                Cancelar
              </Button>
              <Button onClick={runBulkApplySoleSettings} disabled={bulkSoleApplying || !bulkSoleSelected} className="gap-2">
                {bulkSoleApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {bulkSoleApplying ? 'Aplicando...' : 'Aplicar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Search & Filters — catálogo some durante a edição da ficha. */}
        {!expandedId && (
          <div className="flex flex-col gap-2 border-y border-border py-2 lg:flex-row lg:items-center">
            <SearchInput
              className="w-full lg:max-w-md lg:flex-1"
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Buscar por nome, código, coleção, cor…"
              resultCount={filteredSheets.length}
              totalCount={sheets.length}
            />
            <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:ml-auto lg:flex-wrap lg:overflow-visible lg:pb-0">
              {[
                { key: 'all', label: 'Todos' },
                { key: 'Feminino', label: 'Adulto' },
                { key: 'Infantil', label: 'Infantil' },
              ].map(f => (
                <Button
                  key={f.key}
                  variant={categoryFilter === f.key ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  aria-pressed={categoryFilter === f.key}
                  onClick={() => setCategoryFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
              <Select value={soleFilter} onValueChange={setSoleFilter}>
                <SelectTrigger className="h-8 w-[180px] shrink-0 text-xs">
                  <Footprints className="mr-1 h-3.5 w-3.5 opacity-70" />
                  <SelectValue placeholder="Filtrar por solado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os solados</SelectItem>
                  {soleOptions.map(s => (
                    <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="ml-1 shrink-0 font-mono text-xs" aria-live="polite">
                {filteredSheets.length} {filteredSheets.length === 1 ? 'ficha' : 'fichas'}
              </Badge>
              <div className="ml-1 flex shrink-0 items-center rounded-md border bg-background p-0.5" role="group" aria-label="Modo de visualização das fichas">
                <Button
                  type="button"
                  variant={catalogView === 'cards' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-pressed={catalogView === 'cards'}
                  onClick={() => handleCatalogViewChange('cards')}
                >
                  <GridFour className="h-3.5 w-3.5" />
                  Pranchetas
                </Button>
                <Button
                  type="button"
                  variant={catalogView === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-pressed={catalogView === 'list'}
                  onClick={() => handleCatalogViewChange('list')}
                >
                  <ListBullets className="h-3.5 w-3.5" />
                  Lista
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!expandedId && filteredSheets.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-0">
              <EmptyState
                icon={FileText}
                title={
                  sheets.length === 0
                    ? 'Nenhuma ficha técnica cadastrada'
                    : searchTerm.trim()
                      ? `Nenhum resultado para "${searchTerm}"`
                      : 'Nenhuma ficha encontrada'
                }
                description={sheets.length === 0 ? undefined : 'Ajuste a busca ou os filtros de categoria.'}
                action={sheets.length > 0 ? <Button variant="link" onClick={() => { setCategoryFilter('all'); setSoleFilter('all'); setSearchTerm(''); }}>Limpar filtros</Button> : undefined}
              />
            </CardContent>
          </Card>
        ) : expandedId ? (
          /* ── Detail View ── */
          (() => {
             try {
               const sheet = sheets.find(s => s.id === expandedId);
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
                          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase font-bold flex-wrap">
                            <span>{sheet.upper_material || 'Material s/ def.'}</span>
                            <ChevronRight className="h-2.5 w-2.5" />
                            {/* reference_color_variants não vem no select('*') de useTechnicalSheets —
                                cai sempre no fallback 'Sem cores' (comportamento atual preservado). */}
                            <span className="text-primary truncate max-w-[150px]">{(sheet as any).reference_color_variants?.[0]?.color || 'Sem cores'}</span>
                            <ChevronRight className="h-2.5 w-2.5" />
                            <span className="bg-primary/10 text-primary px-1 rounded">{globalFormatCurrency(sheet.sale_price || 0)}</span>
                          </div>
                        </div>
                        {/* SKU/code removido do header em 2026-05: a referência operacional
                            é o Nome do Modelo. SKU continua como coluna na lista, mas não
                            aparece mais como badge ao lado do nome. */}
                        {/* Badge "tem variante de material" — sinaliza que essa ref pode ser
                            cadastrada no PV em N versões de material principal (Napa, Santorini,…) */}
                        {(materialVariantsBySheet?.get(sheet.id)?.length ?? 0) > 0 && (
                          <Badge variant="secondary" className="px-2 py-0 h-5 text-xs bg-warning/10 text-warning border-warning/30 gap-1 shrink-0" title={materialVariantsBySheet!.get(sheet.id)!.map(v => v.material_name).join(', ')}>
                            <Package className="h-3 w-3" /> {materialVariantsBySheet!.get(sheet.id)!.length} Materiais
                          </Badge>
                        )}
                        {sheet.shoe_category && <Badge variant="outline" className="text-xs shrink-0">{sheet.shoe_category}</Badge>}
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
          /* ── Catálogo · opção 05 (pranchetas) ou relação nominal ── */
          catalogView === 'cards' ? (
            <TechnicalSheetCardGrid
              sheets={filteredSheets}
              materialVariantsBySheet={materialVariantsBySheet}
              canDelete={perm.canDelete}
              onOpenSheet={setExpandedId}
              onEditImage={setImageDialogSheet}
              onDeleteSheet={(id) => deleteSheet.mutate(id)}
            />
          ) : (
            <div className="overflow-hidden border-2 border-foreground bg-card">
              <div className="flex items-center justify-between border-b border-foreground bg-muted/30 px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Referências
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {filteredSheets.length}
                </span>
              </div>
              <div className="divide-y divide-border">
                {[...filteredSheets]
                  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
                  .map(sheet => (
                    <button
                      key={sheet.id}
                      type="button"
                      className="flex min-h-10 w-full items-center px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
                      aria-label={`Abrir ficha técnica ${sheet.name}`}
                      onClick={() => setExpandedId(sheet.id)}
                    >
                      <span className="truncate" title={sheet.name}>{sheet.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Ficha Técnica</DialogTitle>
            <DialogDescription className="sr-only">
              Preencha os dados de identificação para criar uma nova ficha técnica.
            </DialogDescription>
          </DialogHeader>
          <QuickCreateForm onCreated={(id) => { setDialogOpen(false); setExpandedId(id); }} onCancel={() => setDialogOpen(false)} />
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
            <DialogDescription className="sr-only">
              Escolha a ficha de origem e o nome da nova ficha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Ficha de Origem</Label>
              <SearchInput
                inputClassName="h-9"
                placeholder="Buscar por nome ou código…"
                value={cloneSearchTerm}
                onChange={setCloneSearchTerm}
                resultCount={cloneFilteredSheets.length}
                totalCount={sheets.length}
              />
              <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
                {cloneFilteredSheets.length === 0 && cloneSearchTerm.trim() && (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <p className="text-xs text-muted-foreground">Nenhum resultado para "{cloneSearchTerm}"</p>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setCloneSearchTerm('')}>
                      Limpar busca
                    </Button>
                  </div>
                )}
                {cloneFilteredSheets
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
                      <span className="text-xs text-muted-foreground shrink-0 ml-2 font-mono">{s.code}</span>
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
                <p className="text-xs text-muted-foreground">
                  Serão copiados: identificação, materiais (BOM) e mapeamentos de cor de solado e palmilha. A embalagem é herdada do tipo de solado.
                </p>
              </div>
            )}

            <DialogFooter className="pt-2">
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
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!imageDialogSheet} onOpenChange={(open) => { if (!open) setImageDialogSheet(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alterar Foto — {imageDialogSheet?.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Envie ou substitua a foto desta ficha técnica.
            </DialogDescription>
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
          <Button type="button" variant="destructive" size="icon" aria-label="Remover foto" className="absolute top-2 right-2 h-7 w-7"
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

function QuickCreateForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const addSheet = useAddSheet();
  const { data: shoeCategories = [] } = useShoeCategories();
  const shoeCategoryOptions = shoeCategories.length > 0 ? shoeCategories : SHOE_CATEGORIES;
  // Form reformulado em 2026-05: agora inclui campos essenciais (descrição,
  // coleção, status da ficha) pra reduzir asymmetry com edit. Removido
  // 'gender' — campo morto sem uso em business logic. Layout em 2 seções
  // (Identidade + Especificações) com Cancelar visível no rodapé.
  const [form, setForm] = useState({
    name: '', brand: '', model: '', code: '', shoe_category: '',
    sizes: '33-41', status: 'Ativo',
    collection: '', description: '',
    images: [] as string[],
  });
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nameMissing = touched && !form.name.trim();
  const categoryMissing = touched && !form.shoe_category;

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
    setTouched(true);
    if (!form.name.trim() || !form.shoe_category) {
      toast.error('Preencha Referência e Categoria.');
      return;
    }
    const result = await addSheet.mutateAsync(form);
    if (result) onCreated(result.id);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 mt-2">
      {/* ── Seção 1: Identidade ──────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" /> Identidade
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Foto (full width) */}
          <div className="md:col-span-2">
            <Label className="text-xs">Foto do Produto</Label>
            <div className="mt-1">
              {previewUrl ? (
                <div className="relative w-full h-36 rounded-lg border overflow-hidden bg-muted">
                  <SignedImage src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                  <Button type="button" variant="destructive" size="icon" aria-label="Remover foto" className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => { setPreviewUrl(null); setForm(f => ({ ...f, images: [] })); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer w-full">
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                  <div className="w-full h-28 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors">
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                      <>
                        <Package className="h-6 w-6 text-muted-foreground/50" />
                        <span className="text-xs text-muted-foreground">Clique pra adicionar foto</span>
                      </>
                    )}
                  </div>
                </label>
              )}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="qc-name" className="text-xs">Referência <RequiredMark /></Label>
            <Input
              id="qc-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              className={cn("mt-1 h-9", nameMissing && "border-destructive")}
              placeholder="Ex.: DS20 / SP101"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="qc-code" className="text-xs">Código interno / SKU <span className="text-muted-foreground normal-case font-normal">(opcional)</span></Label>
            <Input
              id="qc-code"
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              className="mt-1 h-9 font-mono"
              placeholder="Uso interno, se necessário"
            />
          </div>

          <div>
            <Label htmlFor="qc-category" className="text-xs">Categoria <RequiredMark /></Label>
            <Select value={form.shoe_category} onValueChange={v => setForm(f => ({ ...f, shoe_category: v, sizes: v === 'Infantil' ? '21-33' : '34-40' }))}>
              <SelectTrigger id="qc-category" className={cn("mt-1 h-9", categoryMissing && "border-destructive")}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>{shoeCategoryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="qc-brand" className="text-xs">Marca</Label>
            <Input id="qc-brand" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="mt-1 h-9" placeholder="Ex: Squad Shoes" />
          </div>
          <div>
            <Label htmlFor="qc-model" className="text-xs">Modelo</Label>
            <Input id="qc-model" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="mt-1 h-9" placeholder="Ex: Air Max Style" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="qc-description" className="text-xs">Descrição (opcional)</Label>
            <Input
              id="qc-description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="mt-1 h-9"
              placeholder="Detalhes do modelo, especificações breves…"
            />
          </div>
        </div>
      </div>

      {/* ── Seção 2: Especificações ───────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Footprints className="h-3.5 w-3.5" /> Especificações
        </div>

        <div>
          <Label htmlFor="qc-collection" className="text-xs">Coleção (opcional)</Label>
          <Input id="qc-collection" value={form.collection} onChange={e => setForm(f => ({ ...f, collection: e.target.value }))} className="mt-1 h-9" placeholder="Ex: Verão 2026" />
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Grade de Numeração</Label>
          <div className="flex gap-2 mb-2 flex-wrap">
            <Button type="button" variant={form.sizes === '34-40' || form.sizes === '33-41' ? 'default' : 'outline'} size="sm" className="gap-1.5 h-8"
              onClick={() => setForm(f => ({ ...f, sizes: '34-40' }))}>
              <Footprints className="h-3.5 w-3.5" /> Adulto (34-40)
            </Button>
            <Button type="button" variant={form.sizes === '21-33' ? 'default' : 'outline'} size="sm" className="gap-1.5 h-8"
              onClick={() => setForm(f => ({ ...f, sizes: '21-33' }))}>
              <Footprints className="h-3.5 w-3.5" /> Infantil (21-33)
            </Button>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="h-7 text-xs text-center px-1">BR</TableHead>
                  <TableHead className="h-7 text-xs text-center px-1">EU</TableHead>
                  <TableHead className="h-7 text-xs text-center px-1">US</TableHead>
                  <TableHead className="h-7 text-xs text-center px-1">UK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {getSizesForCategory(form.shoe_category).slice(0, 8).map(size => {
                    const mappings = getShoeSizeMappings(size);
                    return (
                      <TableCell key={size} className="p-0 border-r last:border-0">
                        <div className="grid grid-rows-4 text-xs font-mono">
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

      {/* ── Aviso de próximos passos + ações ──────────────────────── */}
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
        <span className="font-bold text-primary mt-0.5">→</span>
        <span>Após criar, você poderá completar materiais, consumo por setor, custos e variantes de cor na tela de edição.</span>
      </div>

      <div className="flex justify-end gap-2 pt-1 border-t pt-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={addSheet.isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={addSheet.isPending || uploading} className="gap-2">
          {addSheet.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar e abrir edição
        </Button>
      </div>
    </form>
  );
}

/* ===== Completeness Indicator ===== */
function SheetCompleteness({ sheet }: { sheet: any }) {
  const stageIcons = { identity: Tag, engineering: Wrench, stock: Package, production: Factory, release: Check };
  const checks = evaluateTechnicalSheetReadiness(sheet).map((stage) => ({
    label: stage.label,
    ok: stage.ready,
    icon: stageIcons[stage.key],
  }));
  const completed = checks.filter(c => c.ok).length;
  const pct = Math.round((completed / checks.length) * 100);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs font-semibold text-muted-foreground">Prontidão industrial</span>
          <Badge variant={pct === 100 ? 'default' : pct >= 60 ? 'secondary' : 'destructive'} className="text-xs font-mono">
            {pct}%
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{completed}/{checks.length} itens</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct === 100 ? 'bg-success' : pct >= 60 ? 'bg-primary' : 'bg-warning'
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
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-colors',
                c.ok
                  ? 'bg-success/10 text-success border-success/30'
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
  // A aba mora na URL (contrato do lote L6a). As abas acompanham a sequência
  // operacional: cadastro → materiais/consumo → produção → precificação →
  // complementos e documentação. Quem estava em Custos
  // ou Variantes e dava F5 voltava pra Identificação e perdia o lugar.
  const { value: abaAtiva, setValue: setAbaAtiva } = useUrlTabState({
    values: ['id', 'engineering', 'range-aviamento', 'production', 'costs', 'variants', 'media', 'ficha-corte', 'terceirizados'] as const,
    defaultValue: 'id',
  });
  const tabGuidance: Record<string, { eyebrow: string; title: string; description: string }> = {
    id: {
      eyebrow: 'ETAPA 1 · CADASTRO',
      title: 'Defina a identidade e a estrutura do modelo',
      description: 'Nome, categoria, grade, solado e informações comerciais que identificam a referência.',
    },
    engineering: {
      eyebrow: 'ETAPA 2 · ENGENHARIA',
      title: 'Monte os materiais e o consumo por par',
      description: 'Cadastre o BOM, confira unidades e consumos antes de liberar o modelo para a produção.',
    },
    production: {
      eyebrow: 'ETAPA 3 · PRODUÇÃO',
      title: 'Defina a rota, tempos e capacidade',
      description: 'Organize os setores, operações, lead time e capacidade necessários para fabricar esta referência.',
    },
    costs: {
      eyebrow: 'ETAPA 4 · PRECIFICAÇÃO',
      title: 'Revise custo, margem e preço de venda',
      description: 'Use o custo consolidado de material, mão de obra e overhead para orientar a precificação.',
    },
    variants: {
      eyebrow: 'COMPLEMENTO · MATERIAIS',
      title: 'Cadastre alternativas de material',
      description: 'As cores continuam no pedido de venda; aqui ficam as opções de material que alteram a composição.',
    },
    'range-aviamento': {
      eyebrow: 'COMPLEMENTO · AVIAMENTO',
      title: 'Configure os ranges das tiras e aviamentos',
      description: 'Disponível apenas para modelos com tiras e usado para manter o corte e a separação consistentes.',
    },
    'ficha-corte': {
      eyebrow: 'SAÍDA · CHÃO DE FÁBRICA',
      title: 'Confira a ficha antes de imprimir',
      description: 'Esta é a versão operacional que acompanha o trabalho no setor de corte.',
    },
    media: {
      eyebrow: 'DOCUMENTAÇÃO',
      title: 'Mantenha fotos, versões e especificações técnicas',
      description: 'Registre evidências do modelo e acompanhe as alterações que orientam a produção.',
    },
    terceirizados: {
      eyebrow: 'COMPLEMENTO · TERCEIROS',
      title: 'Defina os serviços terceirizáveis',
      description: 'Indique quais etapas desta referência podem ser enviadas a prestadores quando necessário.',
    },
  };
  const activeTabGuidance = tabGuidance[abaAtiva] ?? tabGuidance.id;
  const queryClient = useQueryClient();
  const updateSheet = useUpdateSheet();
  const { data: sheetAudit } = useQuery({
    queryKey: ['technical_sheet_audit', sheet.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_technical_sheets_audit')
        .select('*')
        .eq('id', sheet.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TechnicalSheetAuditSignals | null;
    },
    staleTime: 60_000,
  });
  // Mesma queryKey do componente pai — React Query dedupa, não é request extra.
  // Serve pra só mostrar as travas de "segue o material da variante" quando a
  // ficha realmente tem variante cadastrada.
  const { data: materialVariantsBySheet } = useAllActiveReferenceMaterialVariants();
  const { data: shoeCategories = [] } = useShoeCategories();
  const shoeCategoryOptions = shoeCategories.length > 0 ? shoeCategories : SHOE_CATEGORIES;
  const { data: products = [] } = useProducts();
  const strapCatalogQuery = useArtisanalStrapCatalog(false);
  const strapCatalog = strapCatalogQuery.data;
  const activeStrapMeasures = useMemo(() => {
    const activeTypeIds = new Set((strapCatalog?.types || [])
      .filter((type) => type.active)
      .map((type) => type.id));
    return (strapCatalog?.measures || [])
      .filter((measure) => measure.active && activeTypeIds.has(measure.strap_type_id))
      .sort((left, right) => {
        const leftType = strapCatalog?.types.find((type) => type.id === left.strap_type_id)?.name || '';
        const rightType = strapCatalog?.types.find((type) => type.id === right.strap_type_id)?.name || '';
        const typeOrder = leftType.localeCompare(rightType, 'pt-BR');
        if (typeOrder !== 0) return typeOrder;
        return Number(left.finished_width_mm) - Number(right.finished_width_mm);
      });
  }, [strapCatalog]);
  const { data: sheetMaterials = [] } = useSheetMaterials(sheet.id);
  const { data: soleColorMappings = [] } = useSoleColorMappings(sheet.id);
  // soleSizeKeys deve refletir a grade do solado com conjugações aplicadas
  // (ex: solado com 23/24 conjugado mostra "23/24" em vez de "23" e "24"
  // separados). Usado em todas as tabelas por numeração: cabedal, forro,
  // palmilha, fachete, tiras. Vazia até o solado ser selecionado.
  const upsertSoleColor = useUpsertSoleColorMapping();
   const { data: palmilhaColorMappings = [] } = usePalmilhaColorMappings(sheet.id);
   const upsertPalmilhaColor = useUpsertPalmilhaColorMapping();
   const { data: liningColorMappings = [] } = useLiningColorMappings(sheet.id);
   const upsertLiningColor = useUpsertLiningColorMapping();
   const { data: componentColorMappings = [] } = useComponentColorMappings(sheet.id);
   const addComponentColorRow = useAddComponentColorRow();
   const updateComponentColorRow = useUpdateComponentColorRow();
   const deleteComponentColorRow = useDeleteComponentColorRow();
    const bulkAddMaterials = useBulkAddSheetMaterials();
    const [isSoleFachetado, setIsSoleFachetado] = useState(false);
 
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: allSheets = [] } = useTechnicalSheets();
  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_for_straps'],
    queryFn: async () => {
      // consumption_unit ADICIONADO em 2026-05-31: sem ele, getUnitForGroupName
      // caía no fallback dimensions_unit (geralmente 'mm'), exibindo MM em
      // grupos cuja UoM canónica de BOM é 'm' (ex: ELÁSTICO SARJA).
      const { data, error } = await supabase.from('product_groups').select('id, name, parent_group_id, consumption_unit, dimensions_length, dimensions_width, dimensions_unit').order('name');
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
    // (ex.: fachete_consumption, fachete_consumption_per_size). Sem isso, ao
    // abrir uma ficha existente os valores desses campos sumiam do form e
    // qualquer save os zerava. (fachete_material foi promovido pra
    // SheetFormData/emptySheetForm em 2026-06-10 — hidrata no loop acima.)
    const EXTRA_DB_FIELDS = [
      'fachete_consumption', 'fachete_consumption_per_size',
      'lead_time_corte_dias', 'lead_time_costura_dias', 'lead_time_silk_dias',
      'lead_time_colagem_dias', 'lead_time_montagem_dias',
      'lead_time_acabamento_dias', 'lead_time_expedicao_dias',
      'lead_time_buffer_material_dias',
      'cutting_capacity_per_day', 'sewing_capacity_per_day',
      'silk_capacity_per_day', 'gluing_capacity_per_day',
      'assembly_capacity_per_day', 'soling_capacity_per_day',
      'expedition_capacity_per_day', 'finishing_capacity_per_day',
      'costura_capacity_per_day', 'costura_cabedal_capacity_per_day',
      'costura_palmilha_capacity_per_day',
      // production_sectors NÃO entra no form: tem caminho de escrita próprio
      // (ProductionSectorsTab → updateSheet direto). Hidratado aqui, o saveAll
      // reenviava o valor STALE (re-sync bloqueado com dirty=true) por cima do
      // que o painel acabou de salvar — setor removido "ressuscitava" e a
      // ficha dele voltava a sair na impressão.
      'shoe_category_id', 'primary_sole_id', 'upper_material_group_id',
      'assembly_time_minutes', 'process_difficulty',
    ];
    for (const key of EXTRA_DB_FIELDS) {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    }
    f.strap_colors = ensureTechnicalStrapLineIds(f.strap_colors);
    return f;
  });
  const activeStrapIdentityGroups = useMemo(() => {
    const selectedIds = new Set((form.strap_colors || [])
      .map((line) => line.identity_group_id)
      .filter(Boolean));
    return (strapCatalog?.groups || [])
      .filter((group) => selectedIds.has(group.id) || (strapCatalog?.products || []).some((product) => (
        product.group_id === group.id && product.active !== false && product.unit === 'm'
      )))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [form.strap_colors, strapCatalog]);
  const hasReferenceBaseStrapLine = useMemo(
    () => (form.strap_colors || []).some(line => strapIdentityBasis(line) === 'reference_base'),
    [form.strap_colors],
  );
  const strapsFollowLining = !!form.has_straps
    && !normalizeGroupName(form.upper_material)
    && !form.upper_material_group_id
    && !form.upper_material_product_id;
  const possibleReferenceNapaGroups = useMemo(() => {
    const liningGroupId = products.find(product => product.id === form.lining_material_product_id)?.group_id
      || groups.find(group => normalizeGroupName(group.name) === normalizeGroupName(form.lining_material))?.id
      || null;
    return referenceStrapBaseGroups({
      sheet: {
        id: sheet.id,
        has_straps: form.has_straps,
        upper_material: form.upper_material,
        upper_material_group_id: form.upper_material_group_id,
        upper_material_product_id: form.upper_material_product_id,
        lining_material: form.lining_material,
        lining_material_product_id: form.lining_material_product_id,
        variant_drives_lining: form.variant_drives_lining,
        // O trigger persiste exatamente este UUID no save. Antecipá-lo aqui
        // faz a aba Range mostrar imediatamente a mesma identidade operacional.
        strap_base_group_id: strapsFollowLining && hasReferenceBaseStrapLine
          ? liningGroupId
          : sheet.strap_base_group_id || null,
      },
      groups,
      products,
      variants: materialVariantsBySheet?.get(sheet.id) || [],
    });
  }, [
    sheet,
    strapsFollowLining,
    form.has_straps,
    hasReferenceBaseStrapLine,
    form.upper_material,
    form.upper_material_group_id,
    form.upper_material_product_id,
    form.lining_material,
    form.lining_material_product_id,
    form.variant_drives_lining,
    groups,
    products,
    materialVariantsBySheet,
  ]);
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
      'fachete_consumption','fachete_consumption_per_size',
      'lead_time_corte_dias','lead_time_costura_dias','lead_time_silk_dias',
      'lead_time_colagem_dias','lead_time_montagem_dias',
      'lead_time_acabamento_dias','lead_time_expedicao_dias',
      'lead_time_buffer_material_dias','cutting_capacity_per_day',
      'sewing_capacity_per_day','silk_capacity_per_day','gluing_capacity_per_day',
      'assembly_capacity_per_day','soling_capacity_per_day',
      'expedition_capacity_per_day','finishing_capacity_per_day',
      // production_sectors fora do form — vide comentário do init acima.
      'costura_capacity_per_day','costura_cabedal_capacity_per_day',
      'costura_palmilha_capacity_per_day','shoe_category_id',
      'primary_sole_id','upper_material_group_id','assembly_time_minutes','process_difficulty',
    ];
    for (const key of EXTRA) {
      if (sheet[key] !== undefined && sheet[key] !== null) {
        (f as any)[key] = sheet[key];
      }
    }
    f.strap_colors = ensureTechnicalStrapLineIds(f.strap_colors);
    setForm(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id, sheet.updated_at]);

  // Grade de tamanhos do solado com conjugações aplicadas (ex: 23/24 vira
  // 1 entrada em vez de 23 + 24). Bug visto em 19/05/2026: tabela "Consumo
  // por Numeração" só listava individuais, então consumo dos conjugados
  // ficava sempre 0 e BOM custo saía errado.
  const soleSizeKeysNumeric = useMemo(
    () => parseSizesFromRange(form.sizes, form.shoe_category),
    [form.sizes, form.shoe_category],
  );
  const soleSizeKeys = useDisplaySizeKeys({
    sizes: soleSizeKeysNumeric,
    soleGroupId: form.sole_group_id,
  });

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

    type UpperMaterialIdentity = SheetFormData & { upper_material_group_id?: string | null };
    const storedUpperMaterialGroupId = ((form as UpperMaterialIdentity).upper_material_group_id || null) as string | null;
    // UUID vence o texto legado. O fallback pelo nome mantém fichas anteriores à
    // coluna upper_material_group_id editáveis e permite gravar o vínculo no
    // próximo save sem exigir migração manual de cada ficha.
    const upperMaterialGroup = (groups || []).find((group) => group.id === storedUpperMaterialGroupId)
      || (groups || []).find((group) => normalizeGroupName(group.name) === normalizeGroupName(form.upper_material));

    const applyUpperMaterialGroup = (groupName: string, groupId?: string | null) => {
      const selectedGroup = (groupId
        ? (groups || []).find((group) => group.id === groupId)
        : null)
        || (groups || []).find((group) => normalizeGroupName(group.name) === normalizeGroupName(groupName));
      const nextGroupId = selectedGroup?.id || groupId || null;
      const nextGroupName = selectedGroup?.name || groupName;
      const previousGroupId = upperMaterialGroup?.id || storedUpperMaterialGroupId;

      setForm(current => {
        const currentUpperGroupId = ((current as UpperMaterialIdentity).upper_material_group_id || null) as string | null;
        const predominantTracksUpper = !current.cor_predominante_id
          || current.cor_predominante_id === previousGroupId
          || current.cor_predominante_id === currentUpperGroupId;
        // Preencher o UUID ausente de uma ficha legada não é troca de grupo e
        // não deve apagar um SKU pinado que continua pertencendo ao mesmo nome.
        const changedGroup = normalizeGroupName(current.upper_material) !== normalizeGroupName(nextGroupName)
          || (!!currentUpperGroupId && !!nextGroupId && currentUpperGroupId !== nextGroupId);

        return {
          ...current,
          upper_material: nextGroupName,
          upper_material_group_id: nextGroupId,
          // Não sobrescreve um grupo de cor escolhido manualmente nas
          // harmonizações. Se ele ainda acompanhava o Cabedal, mantém a sincronia.
          cor_predominante_id: predominantTracksUpper ? nextGroupId : current.cor_predominante_id,
          upper_material_product_id: changedGroup ? null : current.upper_material_product_id,
        };
      });
      setDirty(true);
    };

    const clearUpperMaterial = () => {
      const previousGroupId = upperMaterialGroup?.id || storedUpperMaterialGroupId;
      setForm(current => ({
        ...current,
        upper_material: '',
        upper_material_group_id: null,
        upper_material_product_id: null,
        upper_consumption: 0,
        upper_consumption_per_size: {},
        // Um override manual de cor predominante continua intacto.
        cor_predominante_id: previousGroupId && current.cor_predominante_id === previousGroupId
          ? null
          : current.cor_predominante_id,
      }));
      setDirty(true);
    };

    const selectedSoleProduct = useMemo(() => products.find((product) =>
      product.id === form.primary_sole_id,
    ) || products.find((product) =>
      product.group_id === form.sole_group_id
      && getSoleModelName(product.name, product.color) === form.sole_material,
    ), [products, form.primary_sole_id, form.sole_group_id, form.sole_material]);
    const facheteMaterialGroup = useMemo(() => groups.find((group) =>
      group.id === selectedSoleProduct?.fachete_material_group_id,
    ), [groups, selectedSoleProduct?.fachete_material_group_id]);

    React.useEffect(() => {
      setIsSoleFachetado(Boolean(selectedSoleProduct?.is_fachetado));
    }, [selectedSoleProduct?.id, selectedSoleProduct?.is_fachetado]);

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

        // lining_accessories NÃO é mais copiado de fichas antigas (2026-07-11):
        // é mecanismo legado de forração alternativa (pick-one) mantido só nas
        // fichas que já o têm — propagá-lo pra fichas novas criava alternativas
        // invisíveis (a UI de edição foi removida). Vários materiais = variações.
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
      // A ficha antiga pode ter herdado o legado "2 unidades por par". O
      // estoque, a compra e a baixa trabalham com pares completos, portanto o
      // consumo do solado é sempre 1 par/par.
      updateField('sole_consumption', 1);
      filled.push('consumo: 1 par/par');
      if (src.sole_process) {
        updateField('sole_process', src.sole_process);
        filled.push(`processo: ${src.sole_process}`);
      }
      if (src.sole_group_id) {
        updateField('sole_group_id', src.sole_group_id);
      }
      if (filled.length > 0) {
        toast.info(`Configurações de solado aplicadas: ${filled.join(', ')}`);
      }
    }
  };

  const autoFillFromSoleSpecs = async (soleProductId: string) => {
    if (!soleProductId) return;
    try {
      // 1. Try sole_technical_specs first (direct per-sole specs)
      // ⚠ Forro do CABEDAL (lining_consumption) NÃO vem mais do solado — desde
      // 2026-06-30 é cabedal a cabedal, definido aqui na ficha do modelo. Do
      // solado só puxamos o que é padronizado por solado: placa da palmilha e
      // forração da palmilha (napa que reveste a placa).
      const { data: specs } = await supabase
        .from('sole_technical_specs')
        .select('size, insole_consumption_dm2, insole_lining_consumption_dm2')
        .eq('sole_id', soleProductId);

      const hasDirectSpecs = specs && specs.some(s => s.insole_consumption_dm2 !== null || (s as any).insole_lining_consumption_dm2 !== null);

      if (hasDirectSpecs) {
        const insoleMap: Record<string, number> = {};
        const insoleLiningMap: Record<string, number> = {};
        specs!.forEach(s => {
          if (s.insole_consumption_dm2 !== null) insoleMap[String(s.size)] = Number(s.insole_consumption_dm2);
          const il = (s as any).insole_lining_consumption_dm2;
          if (il !== null && il !== undefined) insoleLiningMap[String(s.size)] = Number(il);
        });
        const insoleVals = Object.values(insoleMap);
        const insoleLiningVals = Object.values(insoleLiningMap);
        if (insoleVals.length > 0) {
          updateField('insole_consumption', Number((insoleVals.reduce((a, b) => a + b, 0) / insoleVals.length).toFixed(4)));
          updateField('insole_consumption_per_size', insoleMap);
          flashField('insole_consumption_per_size');
        }
        if (insoleLiningVals.length > 0) {
          updateField('insole_lining_consumption', Number((insoleLiningVals.reduce((a, b) => a + b, 0) / insoleLiningVals.length).toFixed(4)));
          updateField('insole_lining_consumption_per_size', insoleLiningMap);
          flashField('insole_lining_consumption_per_size');
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
          // Forro do cabedal: só o escalar como fallback. O consumo por número
          // vive no SOLADO (sole_technical_specs.lining_consumption_dm2), não na
          // ficha — não repopular lining_consumption_per_size aqui (2026-07-01).
          updateField('lining_consumption', Number(avg.toFixed(4)));
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

       // 2) Items globais marcados como `is_standard_sole_item` (cola, linha,
       // EVA, etc. que sempre entram). BUG 19/05/2026: query antiga incluía
       // `category.eq.Solado,category.eq.Componente` no .or() — isso despejava
       // TODOS os solados e componentes do estoque no BOM da nova ficha
       // (centenas de produtos), o que não fazia sentido nenhum.
       // Critério correto: só items explicitamente marcados como "padrão global".
       // BUG 02/08/2026: a flag estava marcada em 7 SOLADOS (não em cola/linha),
       // e o loop abaixo despejava os 7 no BOM de toda ficha nova a 1 par/par —
       // 56 linhas em 8 fichas, inflando custeio e MRP. O solado da referência
       // vem de `technical_sheets.sole_group_id`, nunca de linha de BOM, então
       // filtramos a categoria aqui além do CHECK do banco
       // (chk_standard_sole_item_not_a_sole, mig 20261102120000).
      const { data: globalStandardItems, error: globalError } = await supabase.from('products')
        .select('id, name, group_id, unit_price, unit, category')
        .eq('is_standard_sole_item', true)
        .eq('active', true)
        .not('category', 'ilike', '%solado%')
        .not('category', 'ilike', 'sola');

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
             toast.success(`${fromNew} ${fromNew === 1 ? 'material padrão do solado adicionado' : 'materiais padrão do solado adicionados'} ao BOM.`);
           } else if (fromNew > 0 && fromLegacy > 0) {
             toast.success(`${fromNew} do cadastro do solado + ${fromLegacy} legados adicionados ao BOM.`);
           } else {
             toast.success(`${newMaterials.length} ${newMaterials.length === 1 ? 'item padrão adicionado' : 'itens padrão adicionados'} ao BOM.`);
           }
         }
     } catch (err: any) {
       console.error("Error auto-filling standard items:", err);
     }
   };

   /**
    * Puxa a grade do solado (yield_per_size do component_sheet do solado)
    * para preencher a grade de consumo por numeração de qualquer item de cabedal.
    * Retorna a grade vazia por numeração; o consumo do Cabedal é preenchido
    * explicitamente em dm²/par pelo operador.
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

      // Aplica conjugações: 23/24 vira 1 entrada (key conjugado) em vez de
      // 23 e 24 separados — alinhado com o débito de estoque do solado.
      const sizes: (string | number)[] = soleSizeKeys.length > 0
        ? soleSizeKeys
        : parseSizesFromRange(form.sizes, form.shoe_category);
      const grid: Record<string, number> = {};
      sizes.forEach(s => { grid[String(s)] = 0; });
      return grid;
    } catch (err: any) {
      console.error("Error fetching sole grade:", err);
      toast.error("Erro ao puxar grade do solado: " + err.message);
      return null;
    }
  };

  const saveAll = async () => {
    try {
      // Cinto-e-suspensório: garante que production_sectors/aviamento_steps
      // jamais saem pelo save geral (escrita exclusiva do ProductionSectorsTab).
      const { production_sectors: _ps, aviamento_steps: _as, ...payload } = form as any;
      const hasUpperMaterial = String(payload.upper_material || '').trim().length > 0;
      if (hasUpperMaterial && !upperMaterialGroup) {
        toast.error(
          `O material de Cabedal “${payload.upper_material}” não corresponde a um grupo atual. Selecione novamente o tipo de material antes de salvar.`,
          { duration: 8000 },
        );
        setAbaAtiva('engineering');
        return;
      }
      if (hasUpperMaterial && upperMaterialGroup) {
        const upperPointsToContainer = (groups || []).some((group) => group.parent_group_id === upperMaterialGroup.id);
        if (upperPointsToContainer) {
          toast.error(
            `“${upperMaterialGroup.name}” é uma família de materiais. Escolha um tipo de material dentro dela antes de salvar.`,
            { duration: 8000 },
          );
          setAbaAtiva('engineering');
          return;
        }
        const upperHasActiveProduct = (products || []).some(product =>
          product.group_id === upperMaterialGroup.id && product.active !== false);
        if (!upperHasActiveProduct) {
          toast.error(
            `“${upperMaterialGroup.name}” ainda não possui item ativo. Cadastre ao menos um SKU/cor antes de usar este material.`,
            { duration: 8000 },
          );
          setAbaAtiva('engineering');
          return;
        }

        // Mantém o texto legado sincronizado, mas o UUID é a identidade estável.
        // Assim, renomear o grupo não deixa a ficha apontando para outro material.
        payload.upper_material_group_id = upperMaterialGroup.id;
        payload.upper_material = upperMaterialGroup.name;
      }
      const normalizedStraps = ensureTechnicalStrapLineIds(payload.strap_colors);
      if (form.has_straps) {
        if (!strapCatalog || strapCatalogQuery.isError) {
          toast.error('Não foi possível validar as famílias e medidas de tira. Recarregue o catálogo canônico.');
          return;
        }
        const invalidLines = normalizedStraps.filter((line) => (
          !hasCanonicalTechnicalStrapIdentity(line, strapCatalog.measures, strapCatalog.types)
        ));
        if (invalidLines.length > 0) {
          toast.error(`${invalidLines.length} tira(s) sem família, medida ou base de identidade canônicas. Preencha os campos destacados antes de salvar.`);
          setAbaAtiva('range-aviamento');
          return;
        }
      }
      payload.strap_colors = normalizedStraps;
      await updateSheet.mutateAsync({ id: sheet.id, data: payload });
      await queryClient.invalidateQueries({ queryKey: ['sheet_variant_cascade', sheet.id] });
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
      // Use average from per-size consumption when available
      const perSize = m.consumption_per_size as Record<string, number> | null;
      let avgConsumption = Number(m.quantity_per_unit);
      if (perSize && Object.keys(perSize).length > 0) {
        const vals = Object.values(perSize).filter(v => Number(v) > 0);
        if (vals.length > 0) {
          avgConsumption = vals.reduce((a, b) => a + Number(b), 0) / vals.length;
        }
      }
      total += avgConsumption * unitPrice;
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
                {/* SKU/code removido do header sticky em 2026-05: referência = Nome do Modelo. */}
                {form.shoe_category && (
                  <Badge variant="secondary" className="text-xs h-4.5">{form.shoe_category}</Badge>
                )}
                {form.status_ficha && (
                  <Badge
                    className={cn(
                      'text-xs h-4.5 uppercase tracking-wider',
                      form.status_ficha === 'publicada' && 'bg-success/10 text-success border-success/30',
                      form.status_ficha === 'em_revisao' && 'bg-warning/10 text-warning border-warning/30',
                      form.status_ficha === 'rascunho' && 'bg-muted text-muted-foreground border-border',
                    )}
                  >
                    {form.status_ficha === 'publicada' ? 'Publicada' : form.status_ficha === 'em_revisao' ? 'Em Revisão' : 'Rascunho'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                {form.ncm && (
                  <span className="font-mono">
                    NCM <span className={cn('font-bold', /^\d{8}$/.test(form.ncm) ? 'text-foreground' : 'text-warning')}>{form.ncm}</span>
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
                <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
                <Save className="h-3.5 w-3.5" /> Salvar
              </Button>
            ) : (
              <span className="text-xs text-success font-medium flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" /> Salvo
              </span>
            )}
          </div>
        </div>
      </div>

      <TechnicalSheetReadinessRail
        sheet={{ ...sheet, ...form, production_sectors: sheet.production_sectors }}
        audit={sheetAudit || undefined}
        onSelectTab={setAbaAtiva}
      />

      <Tabs
        value={abaAtiva}
        onValueChange={(nextTab) => {
          if (nextTab === 'variants' && dirty) {
            toast.info('Salve a ficha antes de editar as variantes de material.');
            return;
          }
          setAbaAtiva(nextTab as typeof abaAtiva);
        }}
      >
        <div className="rounded-xl border bg-muted/20 p-2 sm:p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 px-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary">{activeTabGuidance.eyebrow}</p>
              <p className="mt-0.5 text-sm font-bold text-foreground">{activeTabGuidance.title}</p>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">{activeTabGuidance.description}</p>
            </div>
            <div className="shrink-0 px-1 text-xs text-muted-foreground">
              {abaAtiva === 'engineering' ? `${sheetMaterials.length} material${sheetMaterials.length === 1 ? '' : 'is'} no BOM` :
                abaAtiva === 'costs' ? `Custo material: ${formatCurrency(materialCost)}/par` :
                  abaAtiva === 'production' ? 'Rota e capacidade do modelo' : null}
            </div>
          </div>
        </div>
        <TabsList indicator="none" aria-label="Etapas da ficha técnica" className="mt-3 flex h-auto flex-nowrap gap-1 overflow-x-auto rounded-lg border bg-muted/50 p-1.5 sm:flex-wrap sm:overflow-visible">
          {/* Cada tab agora mostra um indicador discreto de "completude" ou
              contagem (badge) pro usuário saber onde tem trabalho pendente. */}
          <TabsTrigger value="id" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Tag className="h-3.5 w-3.5" /> Identificação
            {form.name && form.code && form.shoe_category ? (
              <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-success/10 text-success text-xs font-bold">✓</span>
            ) : (
              <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-warning/10 text-warning text-xs font-bold">!</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="engineering" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Wrench className="h-3.5 w-3.5" /> Materiais & Consumo
            <Badge variant="outline" className="ml-1 h-4 px-1.5 text-xs font-mono">
              {sheetMaterials.length}
            </Badge>
          </TabsTrigger>
          {/* Aba só existe quando o modelo TEM tiras (config de tiras + range P/M/G). */}
          {form.has_straps && (
            <>
              <TabsTrigger value="range-aviamento" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Range Aviamento
              </TabsTrigger>
            </>
          )}
          {/* Aba "Escalonamento" movida pra menu lateral (/escalonamento) em 2026-06-28
              — virou calculadora independente (EscalonamentoCadPage). */}
          <TabsTrigger value="production" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Factory className="h-3.5 w-3.5" /> Produção
            {form.sole_group_id ? (
              <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-success/10 text-success text-xs font-bold">✓</span>
            ) : (
              <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-muted-foreground text-xs font-bold">·</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="costs" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <DollarSign className="h-3.5 w-3.5" /> Precificação
            {materialCost > 0 && (
              <span className="ml-1 text-xs font-mono text-muted-foreground">
                {formatCurrency(materialCost).replace('R$', '')}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="variants" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Palette className="h-3.5 w-3.5" /> Variantes
          </TabsTrigger>
          <TabsTrigger value="ficha-corte" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Scissors className="h-3.5 w-3.5" /> Imprimir Ficha
          </TabsTrigger>
          <TabsTrigger value="media" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <History className="h-3.5 w-3.5" /> Documentação
          </TabsTrigger>
          <TabsTrigger value="terceirizados" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md px-3 py-1.5">
            <Handshake className="h-3.5 w-3.5" /> Terceirizados
          </TabsTrigger>
        </TabsList>


        {/* TAB: Identificação — reorganizada em cards temáticos.
            (1) Dados Principais (Referência + Código interno + Marca + Modelo)
            (2) Categoria & Grade
            (3) Comercial & Tributário
            (4) Foto
            Removido "Gênero" — campo morto sem uso em business logic. */}
        <TabsContent value="id" className="mt-4 space-y-4">
          {/* CARD 1 — Dados Principais */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Dados Principais</h3>
              <span className="text-xs text-muted-foreground ml-auto">Identificação comercial do produto</span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <FieldInput label="Referência" value={form.name || ''} onChange={v => updateField('name', v)} placeholder="Ex.: ST 10" />
                <p className="mt-1 text-xs text-muted-foreground">Identificação principal da ficha, exibida na produção, pedidos e impressões.</p>
              </div>
              <FieldInput label="Código interno / SKU (opcional)" value={form.code || ''} onChange={v => updateField('code', v)} placeholder="Uso interno, se necessário" mono />
              <FieldInput label="Marca" value={form.brand || ''} onChange={v => updateField('brand', v)} placeholder="Ex: Squad Shoes" />
              <FieldInput label="Modelo" value={form.model || ''} onChange={v => updateField('model', v)} placeholder="Ex: Air Max Style" />
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Descrição</Label>
                <Textarea
                  value={form.description || ''}
                  onChange={e => updateField('description', e.target.value)}
                  rows={2}
                  placeholder="Detalhes do modelo, especificações, observações…"
                  className="mt-1"
                />
              </div>
              <FieldInput label="Coleção" value={form.collection || ''} onChange={v => updateField('collection', v)} placeholder="Ex: Verão 2026" />
            </div>
          </div>

          {/* CARD 2 — Categoria & Grade */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Footprints className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Categoria & Grade</h3>
              <span className="text-xs text-muted-foreground ml-auto">Define numeração automaticamente</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldSelect
                  label="Categoria"
                  value={form.shoe_category}
                  onChange={v => {
                    updateField('shoe_category', v);
                    updateField('sizes', v === 'Infantil' ? '21-33' : '34-40');
                  }}
                  options={[...shoeCategoryOptions]}
                  placeholder="Tipo"
                />
                <FieldSelect label="Status Produção" value={form.status} onChange={v => updateField('status', v)} options={[...STATUSES]} />
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 flex items-center gap-3 text-xs">
                <Footprints className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-muted-foreground uppercase text-xs tracking-wider">Grade Resultante</span>
                  <div className="text-sm font-mono text-foreground font-bold mt-0.5 break-words">
                    {soleSizeKeys.length > 0
                      ? soleSizeKeys.join(', ')
                      : (form.sizes || (form.shoe_category === 'Infantil' ? '21-33' : '34-40'))}
                    <span className="text-muted-foreground text-xs ml-2 font-sans normal-case font-normal">
                      derivada da categoria{form.sole_material ? ` + solado "${form.sole_material}"` : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* Editor de conjugações inline. Aparece quando há solado vinculado.
                  Sem ele, o user tinha que ir em Solados Hub pra cadastrar — fluxo
                  quebrado quando estava editando uma ficha. Reuso do componente
                  compartilhado que já existe em SolesCadastroTab/MasterVariantDialog. */}
              {form.sole_group_id && (
                <details className="rounded-md border bg-muted/20" open={soleSizeKeys.some(k => k.includes('/'))}>
                  <summary className="px-3 py-2 cursor-pointer text-xs font-semibold flex items-center gap-2 select-none">
                    <Link2 className="h-3.5 w-3.5 text-primary" />
                    Numerações Conjugadas
                    <span className="text-xs text-muted-foreground font-normal ml-1">
                      (ex: 33/34 = 1 par único)
                    </span>
                  </summary>
                  <div className="border-t px-3 py-3">
                    <SoleSizeConjugationsEditor
                      soleGroupId={form.sole_group_id}
                      sizeFrom={soleSizeKeysNumeric.length > 0 ? Math.min(...soleSizeKeysNumeric) : null}
                      sizeTo={soleSizeKeysNumeric.length > 0 ? Math.max(...soleSizeKeysNumeric) : null}
                    />
                  </div>
                </details>
              )}
            </div>
          </div>

          {/* CARD 3 — Status da Ficha & Custos */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Status da Ficha & Custos</h3>
              <span className="text-xs text-muted-foreground ml-auto">Revisão e overhead customizado</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                              s === 'em_revisao' ? 'bg-warning' :
                              s === 'validada' ? 'bg-blue-500' : 'bg-success'
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
                        if (v !== null && v < 0) { toast.error('O overhead não pode ser negativo'); return; }
                        updateField('custom_overhead' as any, v);
                      }}
                      className={cn('mt-1 h-9 text-sm font-mono', (form as any).custom_overhead < 0 && 'border-destructive focus-visible:ring-destructive')}
                      placeholder="Padrão global"
                      step="0.01"
                      min={0}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Se vazio, usa o overhead global.</p>
                </div>
              </div>

              {form.status_ficha === 'publicada' && (
                <div className="rounded-lg border border-success/30 bg-success/10 p-3 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-success" />
                  <span className="text-xs text-success">
                    Ficha publicada — campos críticos (cor e material) bloqueados. Mude pra "Em Revisão" pra alterar.
                  </span>
                </div>
              )}

              {materialCost > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Custo total de materiais (BOM)</span>
                  </div>
                  <span className="text-base font-bold font-mono text-foreground">{formatCurrency(materialCost)}</span>
                </div>
              )}
            </div>
          </div>

          {/* CARD 4 — Peso & Embalagem (alimenta cálculo automático em NF-e, romaneio, MDF-e e rota) */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Peso &amp; Embalagem</h3>
              <span className="text-xs text-muted-foreground ml-auto">Usado em NF-e, romaneio, MDF-e e rota</span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Peso do par (kg) — produto acabado</Label>
                <NumberInput
                  value={form.weight_per_pair_kg ?? ''}
                  onChange={v => {
                    if (v !== null && v < 0) { toast.error('Peso não pode ser negativo'); return; }
                    updateField('weight_per_pair_kg' as any, v);
                  }}
                  className="mt-1 h-9 text-sm font-mono"
                  placeholder="ex: 0,450"
                  step="0.001"
                  min={0}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Cabedal + forração + solado + ferragens montados. Sem este valor, o PV deste item entra como "peso incompleto" nas telas fiscais.
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Peso da caixinha individual (kg)</Label>
                <NumberInput
                  value={form.box_weight_kg ?? ''}
                  onChange={v => {
                    if (v !== null && v < 0) { toast.error('Peso não pode ser negativo'); return; }
                    updateField('box_weight_kg' as any, v);
                  }}
                  className="mt-1 h-9 text-sm font-mono"
                  placeholder="ex: 0,080 (opcional)"
                  step="0.001"
                  min={0}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Soma ao peso bruto da NF-e. Deixe vazio se a caixinha individual já está embutida no peso do par.
                </p>
              </div>
            </div>
          </div>

          {/* CARD 5 — Fotos */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Fotos do Produto</h3>
              <span className="text-xs text-muted-foreground ml-auto">Primeira foto vira capa do produto</span>
            </div>
            <div className="p-4">
              <SheetImageUpload images={form.images} onChange={(imgs) => updateField('images', imgs)} />
            </div>
          </div>
        </TabsContent>


        {/* TAB: Engenharia (BOM, Consumo & Custos) */}
        <TabsContent value="engineering" className="mt-4 space-y-4">

          {/* CARD DE RESUMO — mostra panorama do BOM logo no topo
              Materiais carregados | Custo de material | Tipo de solado |
              Status. Ajuda o usuário a entender onde está antes de scrollar. */}
          <div className="rounded-xl border bg-gradient-to-r from-card to-muted/20 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Materiais no BOM</div>
              <div className="text-xl font-bold font-mono mt-1">{sheetMaterials.length}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Custo de Material</div>
              <div className="text-xl font-bold font-mono mt-1">{formatCurrency(materialCost)}</div>
              <div className="text-xs text-muted-foreground">por par</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Solado</div>
              <div className="text-sm font-bold mt-1">{form.sole_material || <span className="text-muted-foreground italic font-normal">não definido</span>}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Grade</div>
              <div className="text-sm font-bold font-mono mt-1">{form.sizes || '—'}</div>
            </div>
          </div>

          {/* ═══ SECTION 0: Grupo de Solado (driver técnico central) ═══
              Visual: borda colorida só quando solado AINDA não foi selecionado
              (chama atenção). Depois de selecionar, neutral (não confunde com
              estado de erro, já que primary=vermelho no tema). */}
          <div className={cn(
            "rounded-xl border-2 p-5 space-y-4 shadow-sm transition-colors",
            form.sole_material
              ? "border-border bg-card"
              : "border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10"
          )}>
            <div className="flex items-center gap-3">
              <div className="bg-primary/15 p-2 rounded-lg">
                <Footprints className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Solado · Item Principal do Modelo</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Define grade, classificação (tradicional/palmilha pronta/conjugado) e materiais de consumo padrão (cola, linha, forração…). Tudo aplicado ao BOM ao salvar.
                </p>
              </div>
              <Badge variant="outline" className="text-xs bg-muted text-muted-foreground ml-auto">
                Driver técnico
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              O solado define a estrutura base do produto: fôrma, numeração, consumo de palmilha e forração. Selecione o grupo de solado antes de preencher os demais materiais.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <SoleProductSelect
                label="Solado"
                value={form.sole_material || ''}
                onChange={(productName, groupId, productId) => {
                   updateField('sole_material', productName);
                   updateField('sole_group_id', groupId);
                   updateField('primary_sole_id', productId || null);
                   autoFillSole(productName);
                   updateField('sole_consumption', productName || groupId || productId ? 1 : 0);
                   // Auto-fill NCM da última ficha cadastrada para esse solado.
                   // Trigger DB `tg_autofill_ncm_from_sole` aplica essa mesma
                   // regra no INSERT/UPDATE — chamamos aqui pra dar feedback
                   // visual imediato no formulário (sem precisar salvar).
                   if (!form.ncm || !/^\d{8}$/.test(form.ncm)) {
                     supabase.rpc('suggest_ncm_for_sheet', {
                       p_sole_group_id: groupId || null,
                       p_primary_sole_id: productId || null,
                       p_shoe_category: form.shoe_category || null,
                     }).then(({ data: suggested }) => {
                       if (suggested && /^\d{8}$/.test(String(suggested))) {
                         updateField('ncm', String(suggested));
                         flashField('ncm');
                         toast.success(`NCM ${suggested} preenchido com base no solado`);
                       }
                     });
                   }
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
                <Label className="text-xs text-muted-foreground">Consumo do solado (par/par)</Label>
                <NumberInput
                  value={form.sole_material || form.sole_group_id || form.primary_sole_id ? 1 : 0}
                  onChange={() => undefined}
                  className="mt-1 h-9 text-sm"
                  step="1"
                  decimals={0}
                  disabled
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  1 par completo (pé esquerdo + pé direito) para cada par de calçado.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end pt-2 border-t border-border/40">
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-2">
                  NCM da ficha
                  {form.ncm && /^\d{8}$/.test(form.ncm) ? (
                    <Badge variant="outline" className="h-4 text-xs font-mono">válido</Badge>
                  ) : form.ncm ? (
                    <Badge variant="outline" className="h-4 text-xs bg-warning/10 text-warning border-warning/30">precisa 8 dígitos</Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 text-xs bg-warning/10 text-warning border-warning/30">obrigatório p/ NF-e</Badge>
                  )}
                </Label>
                <Input
                  value={form.ncm || ''}
                  onChange={e => updateField('ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="8 dígitos — ex: 64022000"
                  className="mt-1 h-9 text-sm font-mono"
                  maxLength={8}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={!form.sole_group_id && !form.shoe_category}
                onClick={async () => {
                  const { data: suggested } = await supabase.rpc('suggest_ncm_for_sheet', {
                    p_sole_group_id: form.sole_group_id || null,
                    p_primary_sole_id: null,
                    p_shoe_category: form.shoe_category || null,
                  });
                  if (suggested && /^\d{8}$/.test(String(suggested))) {
                    updateField('ncm', String(suggested));
                    flashField('ncm');
                    toast.success(`NCM ${suggested} preenchido com base no solado/categoria`);
                  } else {
                    toast.warning('Nenhuma sugestão de NCM encontrada — solado sem histórico e categoria desconhecida.');
                  }
                }}
              >
                Sugerir do solado
              </Button>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              O NCM é definido principalmente pelo solado. Quando você troca o solado acima, o campo é preenchido automaticamente com o NCM da última ficha cadastrada para esse solado.
            </p>
            {form.sole_material && (
              <SoleClassificationBadge
                groupId={form.sole_group_id || ''}
                soleMaterial={form.sole_material}
                process={form.sole_process || ''}
                products={products || []}
              />
            )}
            {!form.sole_material && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-warning/10 border border-warning/30">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                <span className="text-xs text-warning">
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
              Defina o grupo de material para cada componente. No Material 1 do Cabedal, informe a área consumida em <strong className="text-foreground">dm² por par</strong>; o sistema converte essa área para a unidade de estoque usando a largura cadastrada no material.
            </p>

            {/* Helper: unidade do grupo via 1º produto ativo do grupo */}
            {(() => null)()}

            {/* Materiais Técnicos (Cabedal, Forro, Palmilha) */}
            <div className="space-y-6">
              {/* Cabedal */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cabedal</span>
                  </div>
                  {(() => {
                    if (form.has_straps) {
                      return (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Modelo de tiras
                        </span>
                      );
                    }
                    const ups = (form as any).upper_consumption_per_size || {};
                    const vals = Object.values(ups).map(Number).filter((v: number) => v > 0);
                    const avg = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : (Number(form.upper_consumption) || 0);
                    const complete = !!form.upper_material && avg > 0;
                    return complete ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        <CheckCircle className="h-3 w-3" weight="fill" /> Completo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                        <AlertTriangle className="h-3 w-3" weight="fill" /> {!form.upper_material ? 'Falta material' : 'Falta consumo'}
                      </span>
                    );
                  })()}
                </div>
                 {isSoleFachetado && (
                   <div className="p-3 border border-warning/30 bg-warning/10 rounded-lg space-y-2 animate-in fade-in slide-in-from-left-2 duration-300">
                     <div className="flex items-center gap-2">
                       <div className="h-5 w-5 rounded bg-warning/15 flex items-center justify-center">
                         <Wand2 className="h-3 w-3 text-warning" />
                       </div>
                       <Label className="text-xs font-bold text-warning">Forração de Salto (Fachete)</Label>
                     </div>
                     <div className="rounded-md border bg-background/70 p-3">
                       <div className="flex flex-wrap items-center justify-between gap-2">
                         <div>
                           <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Fonte do material</p>
                           <p className="mt-1 text-sm font-semibold">
                             {facheteMaterialGroup?.name || form.lining_material || 'Forração da ficha (fallback)'}
                           </p>
                         </div>
                         <Button variant="outline" size="sm" asChild>
                           <Link to="/solados?tab=cadastro">Configurar em Solados</Link>
                         </Button>
                       </div>
                       <p className="mt-2 text-xs text-muted-foreground">
                         O grupo vem do solado principal; o consumo por numeração vem das especificações do solado. Este valor não é duplicado na ficha.
                       </p>
                     </div>
                     {/* A trava do fachete MUDOU DE LUGAR (21/08/2026): agora vive
                         no diálogo da variante, junto de Cabedal e Forração, em
                         "Componentes que seguem esta variante". Aqui ela era a
                         terceira perna do no-op silencioso — quem cadastrava a
                         variante estava noutra aba e não achava esta caixa. Só o
                         estado atual é exibido; a edição é lá. */}
                     {((materialVariantsBySheet as any)?.get?.(sheet?.id) || []).length > 0 && (
                       <p className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                         <strong className="text-foreground">
                           {(form as any).variant_drives_fachete
                             ? 'O fachete segue o material da variante vendida.'
                             : 'O fachete usa sempre o grupo cadastrado no solado.'}
                         </strong>{' '}
                         Para mudar, abra a aba <strong>Variantes</strong> e edite
                         "Componentes que seguem esta variante" — a decisão vale para
                         todas as variantes desta ficha.
                       </p>
                     )}
                   </div>
                 )}
              {(() => {
                // Resolve a unidade de CONSUMO de um grupo (pra label da grade).
                // Prioridade (consumo NÃO é dimensão da peça):
                //   1) group.consumption_unit  — UoM canônica de consumo, quando cadastrada
                //   2) product.unit (variante ativa do grupo) — unidade de estoque real
                //   3) storedUnit (cache salvo na ficha)
                //   4) group.dimensions_unit — ÚLTIMO recurso; é dimensão física (largura
                //      de bobina, espessura, diâmetro), NÃO unidade de consumo. Antes
                //      estava em #2 e quebrava grupos como "Ilhós 51" (dimensions_unit=mm
                //      por causa do diâmetro físico) cujos produtos vendem por 'un'.
                //   5) 'un' default
                const getUnitForGroupName = (groupName: string, storedUnit?: string): string => {
                  if (!groupName?.trim()) return storedUnit?.trim() || 'un';
                  const g: any = (groups || []).find((x: any) => (x.name || '').trim() === groupName.trim());
                  // Unidade do ITEM selecionado (produto ativo do grupo) — é a fonte da verdade.
                  const prod = g ? ((products || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim())
                    || (products || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim())) : null;
                  const prodUnit = (prod?.unit || '').toString().trim();
                  // Material de ÁREA cortado de bobina (napa/couro/forro): produto LINEAR (m/cm).
                  // O consumo é SEMPRE gravado em dm²/par (a conversão p/ metro usa a largura da
                  // ficha de componente). Rótulo correto = dm²/par — INDEPENDENTE de a largura
                  // estar cadastrada. Detecta área pelo sinal de bobina (consumption_unit de área
                  // OU comprimento de rolo), igual ao cabedalWidthWarning. Antes exigia largura > 0,
                  // então sem largura o rótulo mostrava "(m/par)" enquanto o valor digitado é dm²/par
                  // (inconsistência que assustava o operador). O aviso âmbar continua sinalizando que
                  // falta a largura pra converter dm²→metro.
                  if (['m', 'cm', 'metro', 'metros', 'mt'].includes(prodUnit.toLowerCase())) {
                    const consUnit = (g?.consumption_unit || '').toString().trim().toLowerCase().replace(/2/g, '²');
                    const isAreaConsumption = ['dm²', 'm²', 'cm²'].includes(consUnit);
                    const hasRollDims = Number(g?.dimensions_length) > 0;
                    const width = Number(g?.dimensions_width) || 0;
                    if (width > 0 || isAreaConsumption || hasRollDims) return 'dm²';
                  }
                  // Senão, a unidade vem do ITEM SELECIONADO (produto) — NÃO do consumption_unit do
                  // grupo, que pode divergir (ex.: grupo ELÁSTICO SARJA tinha consumption_unit='m'
                  // mas o produto é 'un', fazendo o operador digitar valor errado).
                  if (prodUnit) return prodUnit;
                  const consumption = ((g?.consumption_unit) || '').toString().trim();
                  if (consumption) return consumption;
                  if (storedUnit?.trim()) return storedUnit.trim();
                  const dimsFallback = ((g?.dimensions_unit) || '').toString().trim();
                  if (dimsFallback) return dimsFallback;
                  return 'un';
                };
                // Aviso do quebra-silencioso nº 1: material de ÁREA (napa/couro,
                // cortado de bobina) cujo grupo NÃO tem largura cadastrada → o consumo
                // (gravado em dm²/par) não converte pra metro e infla ~100× no
                // PV/custeio. Detecta: produto linear (m/cm) + sinal de bobina
                // (consumption_unit de área OU comprimento de rolo) + largura ausente.
                // Materiais lineares NATIVOS (elástico, tira) NÃO disparam.
                const cabedalWidthWarning = (groupName?: string): boolean => {
                  const name = (groupName || '').trim();
                  if (!name) return false;
                  const g: any = (groups || []).find((x: any) => (x.name || '').trim() === name);
                  if (!g) return false;
                  const prod: any = (products || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim())
                    || (products || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim());
                  const prodUnit = (prod?.unit || '').toString().trim().toLowerCase();
                  if (!['m', 'cm', 'metro', 'metros', 'mt'].includes(prodUnit)) return false;
                  const consUnit = (g?.consumption_unit || '').toString().trim().toLowerCase().replace(/2/g, '²');
                  const isAreaConsumption = ['dm²', 'm²', 'cm²'].includes(consUnit);
                  const hasRollDims = Number(g?.dimensions_length) > 0;
                  const width = Number(g?.dimensions_width) || 0;
                  return (isAreaConsumption || hasRollDims) && width <= 0;
                };
                const renderWidthWarn = (groupName?: string) =>
                  cabedalWidthWarning(groupName) ? (
                    <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" weight="fill" />
                      <span className="text-[11px] leading-snug text-warning">
                        Sem largura cadastrada — o consumo pode inflar ~100×. Cadastre a largura em <strong>Materiais → Ficha de Componente (Dimensões)</strong>.
                      </span>
                    </div>
                  ) : null;

                // A trava por componente do MATERIAL PRINCIPAL da variante saiu
                // DAQUI em 21/08/2026 e passou a viver no diálogo da variante
                // (aba Variantes), junto com a escolha do material principal.
                //
                // ⚠ NÃO recriar esta caixa aqui. Ela era metade de uma duplicação:
                // o mesmo `variant_drives_*` editável em duas abas, com semânticas
                // diferentes — esta ignorava os pinos por componente, a do diálogo
                // desabilita quando há pino. Só um lugar edita a decisão.
                const sheetHasVariants = ((materialVariantsBySheet as any)?.get?.(sheet?.id) || []).length > 0;
                const renderVariantDrivesToggle = (
                  field: 'variant_drives_upper' | 'variant_drives_lining',
                  componentLabel: string,
                ) => {
                  if (!sheetHasVariants) return null;
                  const on = !!(form as any)[field];
                  return (
                    <p className="mt-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                      <strong className="text-foreground">
                        {on
                          ? `${componentLabel} segue o material da variante vendida.`
                          : `${componentLabel} usa sempre o material cadastrado aqui.`}
                      </strong>{' '}
                      Para mudar, abra a aba <strong>Variantes</strong> e edite
                      "Componentes que seguem esta variante".
                    </p>
                  );
                };
                // Tamanhos numéricos individuais (35, 36, 37...) e a versão
                // com conjugações aplicadas (substitui 23,24 → "23/24" quando
                // o solado tem conjugação cadastrada). Usar a lista conjugada
                // pra renderizar a grade — assim o user só preenche 1 célula
                // por conjugação, alinhada com o débito de estoque (que usa
                // get_sole_size_key() pra resolver o key conjugado).
                const cabedalSizesNumeric = parseSizesFromRange(form.sizes, form.shoe_category);
                const cabedalSizes: (string | number)[] = soleSizeKeys.length > 0
                  ? soleSizeKeys
                  : cabedalSizesNumeric;

                // Renderiza a grade de consumo por numeração. No Cabedal
                // principal, o valor canônico é sempre dm²/par; a unidade do
                // produto só entra depois, na conversão para baixa de estoque.
                // showPerFoot: readout "= X/pé" junto da média — guard anti-deriva
                // pé×par do CABEDAL (spec consumo-cabedal-padrao-par). O canônico é
                // POR PAR; o readout é só referência visual pra quem mede 1 peça.
                const renderSizeGrid = (
                  perSize: Record<string, number>,
                  unit: string,
                  onChangeGrid: (newPerSize: Record<string, number>) => void,
                  highlightColor: 'amber' | 'primary' | 'emerald' = 'primary',
                  showPerFoot = false,
                ) => {
                  const colorClass = highlightColor === 'emerald'
                    ? 'border-success/30'
                    : highlightColor === 'amber'
                    ? 'border-warning/30'
                    : 'border-primary/30';
                  const filledVals = cabedalSizes.map(s => Number(perSize[String(s)] || 0)).filter(v => v > 0);
                  const avg = filledVals.length > 0 ? (filledVals.reduce((a, b) => a + b, 0) / filledVals.length) : 0;
                  return (
                    <div className={`mt-2 p-2.5 rounded-md border bg-muted/30 ${colorClass}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                          Por numeração
                        </span>
                        {/* Quando o modelo tem TIRAS, o consumo é número-a-número
                            (cada tira tem seu cm/par). A "média" é enganosa nesse
                            caso — ocultamos pra evitar leitura errada. */}
                        {!form.has_straps && (
                          <span className="text-xs text-muted-foreground">
                            Média <strong className="tabular-nums text-foreground">{avg.toFixed(4)}</strong> {unit}/par
                            {showPerFoot && avg > 0 && (
                              <span className="ml-1.5 text-muted-foreground/70 tabular-nums">= {(avg / 2).toFixed(4)} {unit}/pé</span>
                            )}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cabedalSizes.map(size => {
                          const sizeKey = String(size);
                          return (
                            <div key={size} className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-mono text-muted-foreground">{size}</span>
                              <NumberInput
                                value={perSize[sizeKey] || 0}
                                onChange={v => {
                                  const next = { ...perSize, [sizeKey]: v };
                                  onChangeGrid(next);
                                }}
                                className="w-[58px] h-8 text-xs text-center tabular-nums"
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
                            className="h-8 text-xs"
                            title="Preenche a grade com a numeração do solado (não sobrescreve valores já digitados)"
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
                            className="h-8 text-xs"
                            title="Copia o valor do 1º número preenchido para todas as numerações"
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
                          label="Material 1 (Principal)"
                          value={form.upper_material}
                          onChange={v => {
                            applyUpperMaterialGroup(v);
                            autoFillConsumption(v, 'upper_material');
                            // MUTEX Cabedal × Tiras: selecionar cabedal significa que o modelo
                            // NÃO é de tiras. Auto-desliga has_straps + limpa strap_colors pra
                            // não ficar dado órfão. Reverso (ligar has_straps limpar cabedal)
                            // tá em outro handler abaixo.
                            if (v && form.has_straps) {
                              updateField('has_straps', false);
                              updateField('strap_colors' as any, []);
                              toast.info('Modelo trocado pra Cabedal — Tiras desativadas');
                            }
                          }}
                          // Callback estrutural opcional do seletor hierárquico. O
                          // onChange acima mantém compatibilidade pelo nome; este
                          // confirma o UUID estável da folha selecionada. O helper
                          // é idempotente porque o seletor dispara os dois callbacks.
                          onGroupSelect={(group) => applyUpperMaterialGroup(group.name, group.id)}
                        />
                        {form.upper_material && (
                          <Button variant="ghost" size="icon" aria-label="Limpar material do cabedal" className="h-9 w-9 text-destructive hover:text-destructive" onClick={clearUpperMaterial}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {renderWidthWarn(form.upper_material)}
                      {renderVariantDrivesToggle('variant_drives_upper', 'Cabedal')}

                      {/* Item específico (pin de SKU) do Cabedal Material 1 — opcional.
                          Fixa o produto exato pro débito (vence a cor do PV; perde só pra
                          variante). Em branco = resolve pela cor do PV. Auditoria 2026-06-28. */}
                      {form.upper_material && (() => {
                        const grp = upperMaterialGroup;
                        const itemsOfGroup = grp ? (products || []).filter((p: any) => p.group_id === grp.id) : [];
                        const activeItems = itemsOfGroup.filter((p: any) => p.active);
                        const pinId = (form as any).upper_material_product_id || '__none__';
                        const pinOrphanInactive = pinId !== '__none__' && !activeItems.some((p: any) => p.id === pinId) && itemsOfGroup.some((p: any) => p.id === pinId);
                        return (
                          <div className="mt-2">
                            <Label className="text-xs text-muted-foreground">
                              Item específico <span className="text-muted-foreground/60">(opcional — débito exato)</span>
                            </Label>
                            <Select
                              value={pinId}
                              onValueChange={(v) => updateField('upper_material_product_id' as any, v === '__none__' ? null : v)}
                            >
                              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Resolver pela cor (padrão)" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs">Resolver pela cor (padrão)</SelectItem>
                                {activeItems.map((p: any) => (
                                  <SelectItem key={p.id} value={p.id} className="text-xs">
                                    {p.name}{p.color ? ` (${p.color})` : ''} [{p.unit || 'un'}]
                                  </SelectItem>
                                ))}
                                {pinOrphanInactive && (
                                  <SelectItem value={pinId} className="text-xs">
                                    {(itemsOfGroup.find((p: any) => p.id === pinId)?.name) || 'Produto'} (inativo)
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                            {(form as any).upper_material_product_id ? (
                              <p className="text-xs text-success mt-1">Débito fixo neste item (ignora a cor do PV).</p>
                            ) : activeItems.length === 1 ? (
                              <p className="text-xs text-muted-foreground mt-1">Grupo tem 1 produto — o débito já é determinístico.</p>
                            ) : null}
                          </div>
                        );
                      })()}

                      {/* Tabela de consumo por numeração INLINE — quando o cabedal é
                          selecionado, o usuário precisa preencher quanto consome
                          de material por par em cada tamanho. Antes essa tabela
                          ficava lá embaixo numa seção separada e o usuário não
                          achava. Renderiza imediatamente após o seletor.
                          (A tabela completa multi-material ainda aparece abaixo
                          como cross-check.) */}
                      {form.upper_material && (
                        <div>
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Consumo de Cabedal por Numeração — POR PAR (dm²/par, não por pé)
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                            Informe a <strong className="text-foreground">área consumida pelo par (2 pés)</strong> número a número, sempre em dm².
                            A média alimenta o custo do PV e a conversão para a unidade de estoque.
                          </p>
                          {renderSizeGrid(
                            form.upper_consumption_per_size || {},
                            'dm²',
                            (newPerSize) => {
                              updateField('upper_consumption_per_size', newPerSize);
                              const filled = Object.values(newPerSize).filter(value => Number(value) > 0);
                              if (filled.length > 0) {
                                const avg = filled.reduce((sum, value) => sum + Number(value), 0) / filled.length;
                                updateField('upper_consumption', Math.round(avg * 10000) / 10000);
                              }
                            },
                            'amber',
                            true, // showPerFoot — readout "= X/pé" anti-deriva pé×par
                          )}
                        </div>
                      )}

                      {/* Corte a fio (2026-06-12): cabedal sem costura — não
                          gera a ficha de operador "Costura Cabedal". Só camada
                          de impressão; não altera fluxo/ondas de produção. */}
                      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                        <div className="space-y-0.5">
                          <Label htmlFor="upper-corte-a-fio" className="text-sm font-medium">
                            Corte a fio (cabedal sem costura)
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Quando ativo, o cabedal sai do corte com borda crua (sem costura) —
                            a ficha de operador "Costura Cabedal" não é gerada para este modelo.
                          </p>
                        </div>
                        <Switch
                          id="upper-corte-a-fio"
                          checked={!!(form as any).upper_corte_a_fio}
                          onCheckedChange={v => updateField('upper_corte_a_fio' as any, !!v)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Baixa de estoque: cabedal no início de <strong className="text-foreground">Corte Cabedal</strong>.
                      </p>
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
                            <Button variant="ghost" size="icon" aria-label="Remover componente" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
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
                    {/* Componentes Extras do Cabedal — cada um soma ao consumo principal
                        (mandatory=true → débito independente, não substitui o cabedal).
                        Ex: Napa principal (dm²) + Elástico Traseiro 6mm (m) +
                        Elástico Frente 8mm (m) + Tira reforço (m).
                        Cada componente tem label livre pra distinguir na ficha. */}
                    <div className="mt-3 pt-3 border-t border-dashed border-amber-300 dark:border-amber-800">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Plus className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            Materiais do Cabedal
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · o cabedal pode ter vários materiais; cada um tem seu consumo e debita estoque
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => {
                            const arr = [...(form.components_accessories || [])];
                            arr.push({ material: '', mandatory: true, label: '', consumption: 0, consumption_per_size: {} });
                            updateField('components_accessories', arr);
                          }}
                        >
                          <Plus className="h-3 w-3" /> Adicionar Material
                        </Button>
                      </div>

                      {(() => {
                        const mandatoryItems = (form.components_accessories || []).map((extra: any, rawIdx: number) => ({ extra, rawIdx })).filter(({ extra }) => extra.mandatory === true);
                        if (mandatoryItems.length === 0) {
                          return (
                            <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2.5">
                              <Layers className="h-4 w-4 shrink-0 text-muted-foreground/60 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                Só o <strong>Material 1</strong>. Adicione Material 2, 3… quando o cabedal tiver mais de um
                                material — cada um com seu próprio consumo e débito de estoque.
                              </p>
                            </div>
                          );
                        }
                        return mandatoryItems.map(({ extra, rawIdx }, displayIdx) => {
                          const unit = getUnitForGroupName(extra.material || '', extra.material_unit);
                          return (
                            <div key={rawIdx} className="space-y-2 border-l-2 border-amber-400/60 pl-3 mb-4">
                              {/* Material (grupo) + remover. Campo de nome livre removido —
                                  o material selecionado já identifica (Material 1, 2, 3…). */}
                              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                                <GroupMaterialSelect
                                label={`Material ${displayIdx + 2}`}
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
                                  // Trocar o grupo invalida o item fixado de outro grupo.
                                  const prevGrpName = (arr[rawIdx]?.material || '').trim();
                                  const clearPin = prevGrpName !== v.trim();
                                  arr[rawIdx] = {
                                    ...arr[rawIdx], material: v, mandatory: true, label: v,
                                    ...(material_unit ? { material_unit } : {}),
                                    ...(clearPin ? { product_id: null, product_name: null } : {}),
                                  };
                                  updateField('components_accessories', arr);
                                }}
                                />
                                <Button variant="ghost" size="icon" aria-label="Remover componente" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                                  const arr = [...(form.components_accessories || [])];
                                  arr.splice(rawIdx, 1);
                                  updateField('components_accessories', arr);
                                }}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>

                              {renderWidthWarn(extra.material)}

                              {/* Linha 2b: Item específico (opcional). Fixa o produto exato
                                  pro débito; em branco = resolve pela cor do PV (padrão). */}
                              {extra.material && (() => {
                                const grp = (groups || []).find((x: any) => (x.name || '').trim() === (extra.material || '').trim());
                                const itemsOfGroup = grp ? (products || []).filter((p: any) => p.group_id === grp.id && p.active) : [];
                                return (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">
                                      Item específico <span className="text-muted-foreground/60">(opcional — débito exato)</span>
                                    </Label>
                                    <Select
                                      value={extra.product_id || '__none__'}
                                      onValueChange={(v) => {
                                        const arr = [...(form.components_accessories || [])];
                                        if (v === '__none__') {
                                          arr[rawIdx] = { ...arr[rawIdx], product_id: null, product_name: null };
                                        } else {
                                          const prod = itemsOfGroup.find((p: any) => p.id === v);
                                          arr[rawIdx] = { ...arr[rawIdx], product_id: v, product_name: prod?.name || '' };
                                        }
                                        updateField('components_accessories', arr);
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs mt-1">
                                        <SelectValue placeholder="Resolver pela cor (padrão)" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__none__" className="text-xs">Resolver pela cor (padrão)</SelectItem>
                                        {itemsOfGroup.map((p: any) => (
                                          <SelectItem key={p.id} value={p.id} className="text-xs">
                                            {p.name}{p.color ? ` (${p.color})` : ''} [{p.unit || 'un'}]
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {extra.product_id && (
                                      <p className="text-xs text-success mt-1">
                                        Débito fixo neste item (ignora a cor do PV).
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Linha 3: Grade de consumo por numeração — MESMA lógica da
                                  Opção 1 (cabedal principal): cabeçalho + grade compartilhada
                                  (Puxar Grade do Solado / Replicar 1º / Média) + a média
                                  alimenta o custo do PV. */}
                              {extra.material && (
                                <div>
                                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Consumo do Material {displayIdx + 2} por Numeração ({unit}/par)
                                  </Label>
                                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                                    Preencha o consumo número a número. A média alimenta o custo do PV automaticamente.
                                  </p>
                                  {renderSizeGrid(
                                    extra.consumption_per_size || {},
                                    unit,
                                    (next) => {
                                      const arr = [...(form.components_accessories || [])];
                                      const vals = Object.values(next).filter((v: any) => Number(v) > 0).map(Number);
                                      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                                      arr[rawIdx] = { ...arr[rawIdx], consumption_per_size: next, consumption: Number(avg.toFixed(4)), mandatory: true };
                                      updateField('components_accessories', arr);
                                    },
                                    'amber',
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                    {/* ── Forração (forro do cabedal) ──
                        A ficha escolhe só o GRUPO/cor do material. As cores vêm dos
                        produtos deste grupo (mapa "Cor da Forração por Cor de Cabedal"
                        + débito por cor). O CONSUMO por número saiu daqui em 2026-07-01
                        e vive no SOLADO (Solados → Consumos → "Forro do Cabedal"), único
                        por referência — o motor lê `sole_technical_specs.lining_consumption_dm2`. */}
                    <div className="space-y-2 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Scissors className="h-3.5 w-3.5 text-purple-600" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Forração</span>
                          {form.lining_material && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Consumo por número no solado
                            </span>
                          )}
                        </div>
                        {form.sole_group_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              const soleId = products.find(p => p.group_id === form.sole_group_id)?.id;
                              if (soleId) autoFillFromSoleSpecs(soleId);
                              else toast.error('Não foi possível localizar o produto do solado para buscar consumos.');
                            }}
                          >
                            <RefreshCw className="h-3 w-3" /> Puxar do Solado
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
                        <GroupMaterialSelect
                          label="Grupo de material de forração"
                          value={form.lining_material}
                          onChange={v => {
                            const prev = (form.lining_material || '').trim();
                            updateField('lining_material', v);
                            if (prev !== (v || '').trim()) updateField('lining_material_product_id' as any, null);
                            autoFillConsumption(v, 'lining_material');
                          }}
                        />
                        {form.lining_material && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Limpar material do forro"
                            className="h-9 w-9 text-destructive hover:text-destructive"
                            onClick={() => {
                              updateField('lining_material', '');
                              updateField('lining_material_product_id' as any, null);
                              updateField('lining_consumption', 0);
                              updateField('lining_consumption_per_size' as any, {});
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {form.has_straps && hasReferenceBaseStrapLine && !form.upper_material && !storedUpperMaterialGroupId && !form.upper_material_product_id && (
                        <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                          Neste modelo sem cabedal, a <strong className="text-foreground">Forração é o material principal da referência</strong> e também será usada como napa-base das tiras.
                        </p>
                      )}

                      {renderWidthWarn(form.lining_material)}
                      {renderVariantDrivesToggle('variant_drives_lining', 'Forração')}

                      {/* Item específico (pin de SKU) da Forração — opcional (mesma lógica do Cabedal). */}
                      {form.lining_material && (() => {
                        const grp = (groups || []).find((x: any) => (x.name || '').trim() === (form.lining_material || '').trim());
                        const itemsOfGroup = grp ? (products || []).filter((p: any) => p.group_id === grp.id) : [];
                        const activeItems = itemsOfGroup.filter((p: any) => p.active);
                        const pinId = (form as any).lining_material_product_id || '__none__';
                        const pinOrphanInactive = pinId !== '__none__' && !activeItems.some((p: any) => p.id === pinId) && itemsOfGroup.some((p: any) => p.id === pinId);
                        return (
                          <div className="mt-2">
                            <Label className="text-xs text-muted-foreground">
                              Item específico <span className="text-muted-foreground/60">(opcional — débito exato)</span>
                            </Label>
                            <Select
                              value={pinId}
                              onValueChange={(v) => updateField('lining_material_product_id' as any, v === '__none__' ? null : v)}
                            >
                              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Resolver pela cor (padrão)" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs">Resolver pela cor (padrão)</SelectItem>
                                {activeItems.map((p: any) => (
                                  <SelectItem key={p.id} value={p.id} className="text-xs">
                                    {p.name}{p.color ? ` (${p.color})` : ''} [{p.unit || 'un'}]
                                  </SelectItem>
                                ))}
                                {pinOrphanInactive && (
                                  <SelectItem value={pinId} className="text-xs">
                                    {(itemsOfGroup.find((p: any) => p.id === pinId)?.name) || 'Produto'} (inativo)
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                            {(form as any).lining_material_product_id ? (
                              <p className="text-xs text-success mt-1">Débito fixo neste item (ignora a cor do PV).</p>
                            ) : activeItems.length === 1 ? (
                              <p className="text-xs text-muted-foreground mt-1">Grupo tem 1 produto — o débito já é determinístico.</p>
                            ) : null}
                          </div>
                        );
                      })()}

                      {/* Consumo do forro do cabedal por número saiu daqui (2026-07-01):
                          é definido no SOLADO (Solados → Consumos → "Forro do Cabedal"),
                          único por referência. A ficha só define o grupo/cor. */}
                      {form.lining_material && (
                        <p className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1.5">
                          <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                          <span>
                            O <strong>consumo</strong> do forro é por número, definido no{' '}
                            <strong>Solado</strong> (Solados → Consumos → “Forro do Cabedal”) —
                            vale pra todas as referências que usam esse solado. Aqui você escolhe só o material.
                          </span>
                        </p>
                      )}

                      {/* Forração multi-grupo REMOVIDA (2026-07-11): 1 ficha = 1 grupo
                          de forração (regra de negócio). Vários materiais = variações
                          de material (aba Variantes). A coluna lining_materials nunca
                          foi lida por nenhum motor de consumo/débito. */}
                    </div>
                  </>
                );
              })()}
              {/* Botões removidos: cada ref tem APENAS material principal de cabedal.
                  Variações de material (Napa, Santorini, …) → Tab "Variantes". */}
            </div>

            {/* Forração + Palmilha REMOVIDOS da UI (user pediu em 2026-05):
                'retirar de ficha técnica a partir de seleção de palmilha e
                de forração — tudo isso já está contido em solados'.
                Ambos os materiais vêm agora do cadastro do solado (Solados
                → Consumos → Forração/Palmilha). Os campos lining_material
                e insole_material continuam no DB pra compatibilidade com
                fichas legacy + autoFillFromSoleSpecs que popula via puxar
                do solado.
                Bloco original wrapped em {false && (...)} pra preservar
                código e reabilitar se necessário. */}
            {false && (
              <>
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
                      className="h-7 text-xs gap-1"
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
                      APENAS um material principal de forração. Botão "Outra Opção" e
                      blocos extras escondidos (mantidos no banco pra fichas legacy). */}
                </div>
              </div>

              {/* Palmilha */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-blue-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Palmilha · placa/EVA</span>
                  </div>
                  {form.sole_group_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
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
                  <GroupMaterialSelect label="Placa / EVA" value={form.insole_material} onChange={v => { updateField('insole_material', v); autoFillConsumption(v, 'insole_material'); }} />
                  {/* Tipo de Placa removido — vem do cadastro do Solado (insole_plate_product
                      duplicava o que já tá em Solados → Cadastro). */}

                  {(() => {
                    const soleProd = form.sole_group_id ? products.find(p => p.group_id === form.sole_group_id) : null;
                    const mode = (soleProd as any)?.insole_mode || 'cortar';
                    if (mode === 'pronta_na_cor') {
                      return (
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
                          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
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
              </>
            )}

            <Separator />

            {/* Componentes Diretos */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Box className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Componentes</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Componentes avulsos (ABS, fivelas, ilhós, elástico…). A unidade vem do cadastro do produto (un, m, cm, kg…).
              </p>

              {/* Opt-in: componentes que variam por cor predominante (poucos modelos). */}
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                <Checkbox
                  id="component-colors-enabled"
                  checked={!!form.component_colors_enabled}
                  onCheckedChange={v => updateField('component_colors_enabled', !!v)}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="component-colors-enabled" className="text-sm font-medium cursor-pointer">
                    Componentes variam por cor
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Ative para modelos cujos componentes mudam conforme a <strong className="text-foreground">cor predominante</strong> escolhida no pedido
                    (ex.: DS05 — Caramelo usa peças diferentes de Off White). A lista abaixo vira o padrão pras cores sem configuração própria.
                  </p>
                </div>
              </div>

              {form.component_colors_enabled && (
                <p className="text-xs text-muted-foreground -mb-1">
                  <span className="font-semibold uppercase tracking-wider">Padrão (fallback)</span> — usado só nas cores <em>sem</em> lista própria abaixo.
                </p>
              )}
              {(form.direct_components || []).map((comp: any, idx: number) => {
                // Preço e unidade vêm do produto VIVO, não do snapshot gravado no
                // JSONB da ficha: o snapshot só é reescrito quando o componente é
                // re-selecionado no dropdown, então corrigir o cadastro do material
                // não refletia aqui — a ficha seguia exibindo o custo velho. O
                // custeio real (calculate_order_cost_item) já lê products.unit_price
                // ao vivo; isto só alinha a UI com ele. Snapshot vira fallback pra
                // componente cujo produto foi desativado/removido.
                const liveProd = (products as any[]).find((p: any) => p.id === comp.product_id);
                const unit = ((liveProd?.unit ?? comp.unit) || 'un').toString().trim() || 'un';
                const unitPrice = Number(liveProd?.unit_price ?? comp.unit_price) || 0;
                return (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end border-l-2 border-green-400/30 pl-3">
                  <DirectComponentSelect
                    label={`Componente ${idx + 1}`}
                    value={comp.product_id || ''}
                    onChange={(pid, pname, price, prodUnit) => {
                      const arr = [...(form.direct_components || [])];
                      arr[idx] = { ...arr[idx], product_id: pid, product_name: pname, unit_price: price, unit: prodUnit };
                      updateField('direct_components', arr);
                    }}
                  />
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Qtd por par <span className="font-mono">({unit})</span>
                    </Label>
                    <NumberInput value={comp.quantity || 0} onChange={v => {
                      const arr = [...(form.direct_components || [])];
                      arr[idx] = { ...arr[idx], quantity: v };
                      updateField('direct_components', arr);
                    }} className="mt-1 h-9 text-sm" placeholder="0" step={unit === 'un' ? '1' : '0.01'} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Setor de consumo</Label>
                    <Select
                      value={comp.consumption_sector || 'Aviamento'}
                      onValueChange={(sector) => {
                        const arr = [...(form.direct_components || [])];
                        arr[idx] = { ...arr[idx], consumption_sector: sector };
                        updateField('direct_components', arr);
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONSUMPTION_SECTORS.map(sector => <SelectItem key={sector} value={sector}>{sector}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    {unitPrice > 0 && comp.quantity > 0 && (
                      // Mostra a conta inteira (qtd × R$/unidade), não só o total:
                      // "= R$ 20,00/par" sozinho não denuncia que o custo cadastrado
                      // está na unidade errada. Com "20 cm × R$ 1,0000/cm" na frente,
                      // um preço digitado por metro num produto em cm salta aos olhos.
                      <span className="text-xs text-muted-foreground font-mono mb-2">
                        {comp.quantity} {unit} × {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(unitPrice)}/{unit}
                        {' = '}
                        <strong className="text-foreground">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitPrice * comp.quantity)}/par</strong>
                      </span>
                    )}
                    <Button variant="ghost" size="icon" aria-label="Remover componente" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => {
                      const arr = [...(form.direct_components || [])];
                      arr.splice(idx, 1);
                      updateField('direct_components', arr);
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );})}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                      updateField('direct_components', [...(form.direct_components || []), { product_id: '', product_name: '', quantity: 1, unit_price: 0, unit: 'un', consumption_sector: 'Aviamento' }]);
              }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar Componente
              </Button>

              {form.component_colors_enabled && (
                <ComponentColorMappingPanel
                  sheetId={sheet.id}
                  corPredominanteId={form.cor_predominante_id}
                  products={products}
                  groups={groups}
                  mappings={componentColorMappings}
                  directComponents={Array.isArray(form.direct_components) ? form.direct_components : []}
                  addRow={addComponentColorRow}
                  updateRow={updateComponentColorRow}
                  deleteRow={deleteComponentColorRow}
                  onSetPredominante={(gid) => updateField('cor_predominante_id', gid)}
                />
              )}
            </div>
          </div>

          </div>

          {/* Tabela "Consumo por Numeração — Produção" REMOVIDA em 2026-05-31:
              era duplicação visual do mesmo upper_consumption_per_size que já
              é editado na seção "Especificações por Componente → Cabedal"
              (via renderSizeGrid inline). Manter as duas confundia o user
              ("qual delas é a real?") e dobrava o trabalho de preenchimento.
              A grade inline acima fixa o Cabedal principal em dm²/par e
              suporta "Puxar Grade do Solado" +
              "Replicar 1º". Fonte única. */}

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
                    updateField('strap_colors', ensureTechnicalStrapLineIds([
                      { label: 'TIRA 1', color: '' },
                      { label: 'TIRA 2', color: '' },
                      { label: 'TIRA 3', color: '' },
                    ]));
                  }
                  // MUTEX Tiras × Cabedal: ativar tiras significa que o modelo
                  // NÃO tem cabedal. Limpa nome, UUID, pin e consumo juntos pra
                  // não deixar identidade/custo fantasma (tira + cabedal somariam).
                  if (v && (form.upper_material || storedUpperMaterialGroupId)) {
                    clearUpperMaterial();
                    toast.info('Modelo trocado pra Tiras — Cabedal desativado');
                  }
                  // BUG ANTIGO: ao desmarcar 'Habilitar tiras', strap_colors
                  // ficava órfão no JSON. Resultado: PV não sabia se tinha
                  // tiras (has_straps=false mas strap_colors preenchido) e
                  // a seção de cores nunca aparecia.
                  // FIX: ao desmarcar, limpa strap_colors também.
                  if (!v && (form.strap_colors || []).length > 0) {
                    updateField('strap_colors', []);
                  }
                }}
              />
              <Label htmlFor="has-straps" className="text-sm font-medium">Habilitar tiras neste modelo</Label>
            </div>
            {form.has_straps && (
              <p className="text-xs text-muted-foreground">
                {hasReferenceBaseStrapLine
                  ? <>As tiras que seguem a referência usam o material definido em <strong className="text-foreground">Forração</strong>; tiras compradas prontas mantêm o próprio grupo.</>
                  : <>Estas tiras são compradas prontas e usam o próprio grupo configurado na aba <strong className="text-foreground">Range Aviamento</strong>.</>}
              </p>
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
            <SheetBOM sheetId={sheet.id} safetyPct={form.safety_margin_pct}
              onSafetyChange={v => updateField('safety_margin_pct', v)} shoeCategory={form.shoe_category} />
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
              <div className="mb-4 rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold">Setor de consumo dos componentes técnicos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Informe o setor físico responsável pelo consumo. O roteamento é obrigatório para liberar fichas novas.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    ['fibra', 'Fibra'],
                    ['forracao_palmilha', 'Forração da Palmilha'],
                    ['cabedal', 'Cabedal'],
                    ['solado', 'Solado'],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <Select
                        value={(form.component_consumption_sectors || {})[key] || ''}
                        onValueChange={(sector) => updateField('component_consumption_sectors', {
                          ...(form.component_consumption_sectors || {}), [key]: sector,
                        })}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{CONSUMPTION_SECTORS.map(sector => <SelectItem key={sector} value={sector}>{sector}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
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

        {/* TAB: Range Aviamento — faixas P/M/G próprias do setor de Aviamento */}
        <TabsContent value="range-aviamento" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/20 px-4 py-2.5 flex items-center gap-3">
            <Paperclip className="h-4 w-4 text-primary shrink-0" />
            <div>
              <div className="text-sm font-bold">Range Aviamento</div>
              <div className="text-xs text-muted-foreground">
                Define as faixas P/M/G do setor de Aviamento. A ficha de operador de Aviamento agrupa as numerações
                por faixa (segmento próprio, independente das facas de Corte Cabedal).
              </div>
            </div>
          </div>
            {form.has_straps && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Defina quantas tiras este modelo possui, a <strong>família, medida e base de identidade</strong> de cada uma
                  e o consumo por numeração <strong>por pé</strong> (em cm).
                  O sistema multiplica por <strong>2</strong> (par = 2 pés) ao calcular o consumo.
                  As <strong>cores</strong> de cada tira são escolhidas no lançamento do Pedido
                  de Venda; a identidade técnica fica fixa aqui por UUID.
                </p>

                {/* Handling time — only for strap models */}
                {(form.strap_colors || []).map((strap: any, idx: number) => {
                  // Conjugações aplicadas (23/24 vira 1 célula).
                  const strapSizes: (string | number)[] = soleSizeKeys.length > 0
                    ? soleSizeKeys
                    : parseSizesFromRange(form.sizes, form.shoe_category);
                  const consumptionPerSize: Record<string, number> = strap.consumption_per_size || {};
                  const filledSizes = strapSizes.filter(s => (consumptionPerSize[String(s)] || 0) > 0);
                  const avgConsumption = filledSizes.length > 0
                    ? filledSizes.map(s => parseSafeNumber(consumptionPerSize[String(s)])).reduce((sum, v) => sum + v, 0) / filledSizes.length
                    : parseSafeNumber(strap.consumption);
                  return (
                    <div key={strap.id || idx} className="p-3 rounded-lg border bg-background space-y-3">
                      {/* Header: numeração + ações.
                          O MATERIAL fica em linha própria abaixo (com label
                          explícito) — antes ficava num combobox sem label
                          espremido entre badge e média, parecia opcional. */}
                      <div className="flex items-center gap-3">
                        {/* Rótulo da tira — selecionável (antes era badge fixo
                            "TIRA N"). Permite marcar tira única ("TIRA") ou a
                            de trás ("TRASEIRA"). Se o valor gravado não estiver
                            na lista (cadastro antigo customizado), entra como
                            1ª opção pra não sumir da seleção. */}
                        {(() => {
                          const currentLabel = strap.label || `TIRA ${idx + 1}`;
                          const options = STRAP_LABEL_OPTIONS.includes(currentLabel as any)
                            ? [...STRAP_LABEL_OPTIONS]
                            : [currentLabel, ...STRAP_LABEL_OPTIONS];
                          return (
                            <Select
                              value={currentLabel}
                              onValueChange={(val) => {
                                const updated = [...(form.strap_colors || [])];
                                updated[idx] = { ...updated[idx], label: val };
                                updateField('strap_colors', updated);
                              }}
                            >
                              <SelectTrigger className="h-7 w-auto min-w-[112px] text-xs font-semibold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {options.map(opt => (
                                  <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          );
                        })()}
                        <span className="text-xs text-muted-foreground ml-auto">
                          Média: <strong>{safeToFixed(avgConsumption / 2, 1)} cm</strong>/pé
                        </span>
                        {(form.strap_colors || []).length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remover cor da tira"
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
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">
                            Base da identidade <span className="text-destructive">*</span>
                          </Label>
                          <Select
                            value={strapIdentityBasis(strap)}
                            onValueChange={(value) => {
                              const updated = [...(form.strap_colors || [])];
                              updated[idx] = applyTechnicalStrapIdentity(
                                updated[idx],
                                value as 'reference_base' | 'finished_product_group',
                                null,
                              );
                              updateField('strap_colors', updated);
                            }}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="reference_base">Segue a napa da referência</SelectItem>
                              <SelectItem value="finished_product_group">Grupo próprio · comprada pronta</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {strapIdentityBasis(strap) === 'reference_base' && (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Napa-base definida pela referência</Label>
                            <div className={cn(
                              'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border px-3 py-2',
                              possibleReferenceNapaGroups.length === 0 && 'border-warning/40 bg-warning/5',
                            )}>
                              {possibleReferenceNapaGroups.length > 0 ? possibleReferenceNapaGroups.map((group) => (
                                <Badge
                                  key={group.id}
                                  variant="secondary"
                                  className="font-mono text-xs"
                                  title={group.origins.join(' · ')}
                                >
                                  {group.name}
                                </Badge>
                              )) : (
                                <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Nenhum grupo de napa resolvido
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {possibleReferenceNapaGroups.length > 0
                                ? (strapsFollowLining
                                  ? 'A tira usa a Forração da ficha; quando a variante também dirige a Forração, ambas mudam juntas.'
                                  : 'O pedido seleciona automaticamente a napa correta conforme a variante de material.')
                                : (strapsFollowLining
                                  ? 'Selecione o grupo de Forração antes de liberar a produção.'
                                  : 'Configure o material padrão ou as variantes desta referência antes de liberar a produção.')}
                            </p>
                            {possibleReferenceNapaGroups.some((group) => !group.canonical) && (
                              <p className="text-xs font-medium text-warning">
                                Salve a ficha para consolidar o vínculo operacional deste grupo.
                              </p>
                            )}
                          </div>
                        )}
                        {strapIdentityBasis(strap) === 'finished_product_group' && (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">
                              Grupo do produto acabado <span className="text-destructive">*</span>
                            </Label>
                            <Select
                              value={strap.identity_group_id || ''}
                              onValueChange={(groupId) => {
                                const updated = [...(form.strap_colors || [])];
                                updated[idx] = applyTechnicalStrapIdentity(
                                  updated[idx],
                                  'finished_product_group',
                                  groupId,
                                );
                                updateField('strap_colors', updated);
                              }}
                            >
                              <SelectTrigger className={!strap.identity_group_id ? 'border-destructive focus:ring-destructive' : ''}>
                                <SelectValue placeholder="Selecione o grupo acabado" />
                              </SelectTrigger>
                              <SelectContent>
                                {activeStrapIdentityGroups.map((group) => (
                                  <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Origem fixa no PV: <strong>Comprar pronta</strong>.
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label className="text-xs font-semibold">
                            Família e medida canônicas <span className="text-destructive">*</span>
                          </Label>
                          <Link
                            to="/tiras-artesanais?tab=cadastro"
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Gerenciar catálogo de tiras
                          </Link>
                        </div>
                        <Select
                          value={strap.measure_id || ''}
                          disabled={
                            strapCatalogQuery.isLoading
                            || strapCatalogQuery.isError
                            || activeStrapMeasures.length === 0
                          }
                          onValueChange={(measureId) => {
                            const measure = activeStrapMeasures.find((entry) => entry.id === measureId);
                            if (!measure) return;
                            const updated = [...(form.strap_colors || [])];
                            updated[idx] = applyCanonicalTechnicalStrapMeasure(updated[idx], measure);
                            updateField('strap_colors', updated);
                          }}
                        >
                          <SelectTrigger className={cn(
                            'w-full',
                            !hasCanonicalTechnicalStrapIdentity(
                              strap,
                              strapCatalog?.measures || [],
                              strapCatalog?.types || [],
                            )
                              && 'border-destructive focus:ring-destructive',
                          )}>
                            <SelectValue
                              placeholder={strapCatalogQuery.isLoading
                                ? 'Carregando catálogo…'
                                : activeStrapMeasures.length === 0
                                  ? 'Catálogo sem família e medida ativa'
                                  : 'Selecione família e medida'}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {activeStrapMeasures.length === 0 ? (
                              <SelectItem value="__empty_strap_catalog__" disabled>
                                Nenhuma família e medida ativa
                              </SelectItem>
                            ) : activeStrapMeasures.map((measure) => {
                              const type = strapCatalog?.types.find((entry) => entry.id === measure.strap_type_id);
                              return (
                                <SelectItem key={measure.id} value={measure.id}>
                                  {type?.name || 'Família não identificada'} · {measure.display_name}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {strapCatalogQuery.isError ? (
                          <p className="text-xs font-medium text-destructive">Catálogo indisponível. Recarregue a página antes de salvar.</p>
                        ) : !strapCatalogQuery.isLoading && activeStrapMeasures.length === 0 ? (
                          <p className="text-xs font-medium text-destructive">
                            Nenhuma família e medida está ativa. Abra o catálogo de tiras para concluir o cadastro.
                          </p>
                        ) : !hasCanonicalTechnicalStrapIdentity(
                          strap,
                          strapCatalog?.measures || [],
                          strapCatalog?.types || [],
                        ) ? (
                          <p className="text-xs font-medium text-destructive">Selecione a identidade técnica; grupo ou nome antigo não resolvem esta tira.</p>
                        ) : null}
                        {(strap.group_name || strap.group_id) && (
                          <p className="text-xs text-muted-foreground">
                            Rótulo legado preservado para diagnóstico: <strong className="text-foreground">{strap.group_name || strap.group_id}</strong>. Ele não participa do cálculo.
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Consumo por Numeração (cm/pé)</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {strapSizes.map(size => {
                            const sizeKey = String(size);
                            return (
                              <div key={size} className="flex flex-col items-center gap-0.5">
                                <span className="text-xs font-mono text-muted-foreground">{size}</span>
                                <NumberInput
                                  // UI por PÉ; storage segue por PAR (÷2 ao exibir, ×2 ao salvar).
                                  // Mantém motores/SQL/fichas do operador intactos (todos usam par).
                                  value={Math.round(((consumptionPerSize[sizeKey] || 0) / 2) * 100) / 100}
                                  onChange={(footVal) => {
                                    const pairVal = (Number(footVal) || 0) * 2;
                                    const updated = [...(form.strap_colors || [])];
                                    const newPerSize = { ...(updated[idx].consumption_per_size || {}), [sizeKey]: pairVal };
                                    const filled = strapSizes.filter(s => (newPerSize[String(s)] || 0) > 0);
                                    const avg = filled.length > 0
                                      ? filled.reduce((sum, s) => sum + (newPerSize[String(s)] || 0), 0) / filled.length
                                      : 0;
                                    updated[idx] = { ...updated[idx], consumption_per_size: newPerSize, consumption: Math.round(avg * 100) / 100 };
                                    updateField('strap_colors', updated);
                                  }}
                                  className="w-[52px] h-7 text-xs text-center"
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
                            className="h-7 text-xs self-end"
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
                      <span className="text-xs text-muted-foreground">Cor definida no pedido</span>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const current = form.strap_colors || [];
                    const next = current.length + 1;
                    const technicalStrapLineId = newTechnicalStrapLineId();
                    // Pré-seleciona a mesma identidade canônica da última tira;
                    // continua editável quando esta linha usa outra medida.
                    // A cor permanece vazia porque é definida no pedido.
                    const last = current[current.length - 1];
                    updateField('strap_colors', [
                      ...current,
                      {
                        id: technicalStrapLineId,
                        technical_strap_line_id: technicalStrapLineId,
                        label: `TIRA ${next}`,
                        color: '',
                        strap_type_id: last?.strap_type_id,
                        measure_id: last?.measure_id,
                        group_id: last?.group_id,
                        group_name: last?.group_name,
                        identity_basis: strapIdentityBasis(last),
                        identity_group_id: strapIdentityBasis(last) === 'finished_product_group'
                          ? last?.identity_group_id || null
                          : null,
                        consumption: last?.consumption,
                        consumption_per_size: { ...(last?.consumption_per_size || {}) },
                      },
                    ]);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar Tira
                </Button>

                 {/* Catalog Models - pre-defined color combinations */}
                 <CatalogModelsPanel sheetId={sheet.id} strapColors={form.strap_colors || []} />
               </div>
             )}
          <AviamentoRangeTab form={form} updateField={updateField} />
        </TabsContent>

         {/* TAB: Produção & Embalagens */}
         <TabsContent value="production" className="mt-4 space-y-4">
           {/* Header explicativo — orienta o usuário do que essa aba faz */}
           <div className="rounded-lg border bg-muted/20 px-4 py-2.5 flex items-center gap-3">
             <Factory className="h-4 w-4 text-primary shrink-0" />
             <div>
               <div className="text-sm font-bold">Fluxo de Produção</div>
               <div className="text-xs text-muted-foreground">
                 Setores ativos + capacidades por dia + lead times. Define como a ficha entra no sistema de ondas.
               </div>
             </div>
           </div>
           <ProductionSectorsTab
             sectors={sheet.production_sectors || ['Corte Fibra', 'Corte Forração', 'Costura Palmilha', 'Costura Cabedal', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição']}
             insoleReadyMade={(sheet as any).insole_ready_made === true}
             aviamentoSteps={Array.isArray((sheet as any).aviamento_steps) ? ((sheet as any).aviamento_steps as string[]) : []}
             onSave={(sectors: string[], steps: string[]) => {
               const routingData: Partial<SheetFormData> & {
                 production_sectors: string[];
                 aviamento_steps?: string[];
               } = {
                 production_sectors: sectors,
                 ...(sectors.includes('Aviamento') ? { aviamento_steps: steps } : {}),
               };
               updateSheet.mutate({
                 id: sheet.id,
                 data: routingData,
               });
             }}
             saving={updateSheet.isPending}
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
            costuraCapacityPerDay={Number((sheet as any).costura_capacity_per_day ?? 0)}
            costuraCabedalCapacityPerDay={Number((sheet as any).costura_cabedal_capacity_per_day ?? 0)}
            costuraPalmilhaCapacityPerDay={Number((sheet as any).costura_palmilha_capacity_per_day ?? 0)}
            silkCapacityPerDay={Number((sheet as any).silk_capacity_per_day ?? 0)}
            gluingCapacityPerDay={Number((sheet as any).gluing_capacity_per_day ?? 0)}
            assemblyCapacityPerDay={Number((sheet as any).assembly_capacity_per_day ?? 0)}
            expeditionCapacityPerDay={Number((sheet as any).expedition_capacity_per_day ?? 0)}
            finishingCapacityPerDay={Number((sheet as any).finishing_capacity_per_day ?? 0)}
            onUpdateSheet={(data) => updateSheet.mutate({ id: sheet.id, data: data as any })}
            activeSectors={Array.isArray((sheet as any).production_sectors) ? ((sheet as any).production_sectors as string[]) : undefined}
            sheetSizes={sheet.sizes || ''}
            // Lê do FORM (não do sheet) e propaga toda edição pro form via
            // updateField — sem isso, o "Salvar" geral mandava o knife_size_ranges
            // ANTIGO (null) e sobrescrevia a faca cadastrada (perda silenciosa:
            // 0 fichas persistiam). (PV-00142, 2026-06-17.)
            knifeSizeRanges={Array.isArray((form as any).knife_size_ranges) ? ((form as any).knife_size_ranges as any[]) : null}
            onKnifeSizeRangesChange={(v) => updateField('knife_size_ranges' as any, v)}
          />
        </TabsContent>

        {/* TAB: Custos */}
        <TabsContent value="costs" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/20 px-4 py-2.5 flex items-center gap-3">
            <DollarSign className="h-4 w-4 text-primary shrink-0" />
            <div>
              <div className="text-sm font-bold">Preço de Custo</div>
              <div className="text-xs text-muted-foreground">
                Rollup de material (BOM) + mão de obra + overhead. Defina preço de venda e margem por canal.
              </div>
            </div>
          </div>
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

        {/* TAB: Terceirizados — serviços terceirizáveis desta referência */}
        <TabsContent value="terceirizados" className="mt-4 space-y-4">
          <ReferenceTerceirizacoesPanel sheetId={sheet.id} />
        </TabsContent>

        <TabsContent value="ficha-corte" className="mt-0">
          <FichaCortePrintTab sheet={sheet} />
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

  // Cores DISPONÍVEIS EM ESTOQUE (decisão 2026-06-02): só cores de produtos com
  // quantity>0 nos materiais do modelo (cabedal + forração). Antes listava a
  // paleta INTEIRA da forração (incl. cores sem material) → confuso. Agora só
  // aparece o que a fábrica realmente tem em estoque, e por adição sob demanda.
  const stockColors = useMemo(() => {
    const groupNames = [form.upper_material, form.lining_material].filter(Boolean) as string[];
    ((form as any).lining_accessories || []).forEach((c: any) => { if (c.material) groupNames.push(c.material); });
    const groupIds = new Set(groups.filter((g: any) => groupNames.includes(g.name)).map((g: any) => g.id));
    const set = new Set<string>();
    products
      .filter((p: any) => p.active && Number(p.quantity) > 0 && groupIds.has(p.group_id))
      .forEach((p: any) => {
        if (p.color?.trim()) p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) set.add(t); });
      });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [form, groups, products]);

  // Cores já engajadas: com registro de variante (com/sem foto) + as adicionadas
  // agora pelo usuário (ainda sem upload). Só estas viram slot de foto.
  const [addedColors, setAddedColors] = useState<string[]>([]);
  const shownColors = useMemo(() => {
    const set = new Set<string>();
    colorVariants.forEach((v: any) => { if (v.color?.trim()) set.add(v.color.trim()); });
    addedColors.forEach(c => { if (c.trim()) set.add(c.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [colorVariants, addedColors]);
  const pickableColors = useMemo(
    () => stockColors.filter(c => !shownColors.includes(c)),
    [stockColors, shownColors],
  );

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

  if (stockColors.length === 0 && shownColors.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-0">
          <EmptyState
            icon={ImagePlus}
            title="Nenhuma cor em estoque"
            description='As cores aparecem a partir dos produtos COM estoque (qtd > 0) nos materiais de cabedal/forração deste modelo. Dê entrada de estoque ou ajuste os materiais na aba "Materiais & BOM".'
            size="sm"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2"><ImagePlus className="h-4 w-4 text-primary" /> Fotos por Cor</h3>
        <p className="text-xs text-muted-foreground mt-1">Adicione uma cor (disponível em estoque) e suba a foto do produto naquela cor. A foto aparece no pedido e na ficha do operador ao escolher a cor.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value="" onValueChange={(c) => { if (c) setAddedColors(prev => (prev.includes(c) ? prev : [...prev, c])); }}>
          <SelectTrigger className="h-9 w-72">
            <SelectValue placeholder={pickableColors.length ? '+ Adicionar cor em estoque…' : 'Todas as cores em estoque já listadas'} />
          </SelectTrigger>
          <SelectContent>
            {pickableColors.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{stockColors.length} cor(es) em estoque</span>
      </div>

      {shownColors.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Selecione uma cor em estoque acima para subir a foto.</p>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {shownColors.map(color => {
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
                    <span className="text-xs">Sem foto</span>
                  </div>
                )}
                {uploading === color ? (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                ) : (
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(color, e)} />
                    <Plus className="h-6 w-6 text-white mb-1" />
                    <span className="text-xs text-white font-bold">{hasImage ? 'Alterar' : 'Upload'}</span>
                  </label>
                )}
                {hasImage && !uploading && (
                  <Button variant="destructive" size="icon" aria-label="Remover foto da cor" className="h-5 w-5 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 shadow-sm"
                    onClick={(e) => { e.stopPropagation(); handleRemove(color); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <span className="text-xs font-semibold mt-1.5 truncate w-full text-center px-1" title={color}>{color}</span>
              {hasImage && <Badge variant="default" className="text-[8px] h-3.5 px-1 mt-0.5">✓ com foto</Badge>}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

 const ALL_PRODUCTION_SECTORS = [
   // Sub-etapas paralelas de Corte (decisão 2026-05-12):
   //   - Corte Fibra: sempre (todo sapato tem palmilha)
   //   - Corte Forração: quando o modelo tem forração na palmilha
   // Costura dividida em DOIS setores independentes que trabalham lado a lado
   // (decisão do dono 2026-10-01, migration 20261001120000):
   //   - Costura Palmilha: costura palmilha + forração (interna)
   //   - Costura Cabedal: costura do cabedal (é a terceirizável)
   // ⚠ 'Corte Cabedal' NÃO é selecionável: o trigger
   // tg_normalize_production_sectors descarta ele do array (fora da lista
   // canônica), então o chip era salvo e sumia em silêncio. A impressão
   // decide esse setor sozinha por has_straps (modelo sem tiras = corta
   // cabedal) — não depende do roteiro.
   // ⚠ A ordem aqui espelha `canonical_stage_order()` no banco. Setor que
   // você adicionar aqui TEM que entrar na lista canônica do trigger também,
   // senão o usuário marca, salva, e o valor desaparece sem erro.
   { name: 'Corte Fibra',      order: 1 },
   { name: 'Corte Forração',   order: 2 },
   { name: 'Costura Palmilha', order: 3 },
   { name: 'Costura Cabedal',  order: 4 },
   { name: 'Aviamento',        order: 5 },
   { name: 'Silk',           order: 6 },
   { name: 'Colagem',        order: 7 },
   { name: 'Montagem',       order: 8 },
   { name: 'Solagem',        order: 9 },
   { name: 'Acabamento',     order: 10 },
   { name: 'Expedição',      order: 11 },
 ];

// Setores removidos automaticamente pelo trigger do banco
// (tg_strip_cut_sectors_when_ready_made) quando a palmilha é pronta na cor.
// O editor desabilita os chips pra não fingir que a seleção foi salva.
// Palmilha pronta na cor ⇒ não há palmilha pra cortar nem pra costurar. A
// costura de CABEDAL segue valendo (é outro componente).
const READY_MADE_STRIPPED_SECTORS = ['Corte Fibra', 'Corte Forração', 'Costura Palmilha'];
 
// Etapas fixas do setor Aviamento. Quando o user marca Aviamento em
// production_sectors, abre um sub-painel pra escolher quais dessas etapas
// se aplicam à ficha. A ficha de operador renderiza checklist por etapa.
const AVIAMENTO_STEPS = [
  'Frente',
  'Traseira',
  'Costura de tiras',
] as const;

// Rótulos disponíveis pra cada tira na "Configuração de Tiras" (onde se
// define material + consumo por numeração). Antes o rótulo era fixo
// "TIRA 1/2/3" (badge read-only); agora o usuário escolhe — útil pra marcar
// uma tira única ("TIRA") ou a de trás ("TRASEIRA"). UPPERCASE pra casar com
// os defaults antigos já gravados ('TIRA 1' etc.) sem precisar de migração.
// O label escolhido propaga pro pedido de venda ("Cores das Tiras"), pro
// resumo de tiras e pras fichas de operador (useOrderStraps lê strap.label).
const STRAP_LABEL_OPTIONS = [
  'TIRA',
  'TIRA 1',
  'TIRA 2',
  'TIRA 3',
  'FRENTE',
  'TRASEIRA',
  'LATERAL',
] as const;

function ProductionSectorsTab({
  sectors, onSave,
  aviamentoSteps,
  insoleReadyMade = false,
  saving = false,
}: {
  sectors: string[];
  onSave: (sectors: string[], aviamentoSteps: string[]) => void;
  aviamentoSteps: string[];
  /** Palmilha pronta na cor: o trigger do banco remove Corte Fibra/
   *  Corte Forração/Costura do roteiro — os chips ficam desabilitados. */
  insoleReadyMade?: boolean;
  saving?: boolean;
}) {
   const [localSectors, setLocalSectors] = useState<string[]>(sectors);
   const [localSteps, setLocalSteps] = useState<string[]>(aviamentoSteps);

   // Re-sincroniza com o valor PERSISTIDO quando a prop muda (refetch
   // pós-save). Sem isso, o painel continuava exibindo a seleção do usuário
   // mesmo quando um trigger do banco a revertia — e ele só descobria na
   // impressão, quando o setor "salvo" não saía (ou saía um removido).
   // Keyed pelo CONTEÚDO (JSON), não pela referência: o pai recria o array a
   // cada render e um dep cru resetaria a edição em andamento.
   const sectorsKey = JSON.stringify(sectors);
   const stepsKey = JSON.stringify(aviamentoSteps);
   useEffect(() => { setLocalSectors(JSON.parse(sectorsKey)); }, [sectorsKey]);
   useEffect(() => { setLocalSteps(JSON.parse(stepsKey)); }, [stepsKey]);

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

  const toggleStep = (step: string) => {
    setLocalSteps(prev =>
      prev.includes(step) ? prev.filter(s => s !== step) : [...prev, step],
    );
  };

  const isAviamentoActive = localSectors.includes('Aviamento');
  const hasChanges = JSON.stringify(localSectors) !== JSON.stringify(sectors)
    || (isAviamentoActive && JSON.stringify(localSteps) !== JSON.stringify(aviamentoSteps));

  return (
    <div className="space-y-4">
      <SectionTitle>Setores de Produção</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Selecione quais setores esta referência passa durante a produção. Apenas os setores marcados serão criados nas Ordens de Produção.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
         {ALL_PRODUCTION_SECTORS.map(sector => {
           const isActive = localSectors.includes(sector.name);
           // Pronta na cor: o trigger do banco remove esses setores em todo
           // save — marcar aqui era desfeito em silêncio (toast de sucesso
           // enganava e a ficha do setor nunca saía na impressão).
           const lockedByReadyMade = insoleReadyMade && READY_MADE_STRIPPED_SECTORS.includes(sector.name);
           return (
             <button
               key={sector.name}
               type="button"
               disabled={lockedByReadyMade}
               onClick={() => toggle(sector.name)}
               title={lockedByReadyMade
                 ? 'Indisponível: palmilha pronta na cor — o sistema remove este setor do roteiro automaticamente. Desligue "Palmilha pronta na cor" para usá-lo.'
                 : sector.name}
               className={cn(
                 'flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all min-w-0',
                 lockedByReadyMade
                   ? 'border-border bg-muted/20 text-muted-foreground/50 cursor-not-allowed opacity-60'
                   : isActive
                     ? 'border-primary bg-primary/10 text-primary cursor-pointer'
                     : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 cursor-pointer'
               )}
             >
               <Checkbox checked={isActive && !lockedByReadyMade} className="pointer-events-none shrink-0" />
               <span className="truncate">{sector.name}</span>
             </button>
           );
         })}
      </div>
      {insoleReadyMade && (
        <p className="text-xs text-warning">
          ⚠ Palmilha pronta na cor: Corte Fibra, Corte Forração e Costura são removidos do roteiro automaticamente.
        </p>
      )}

      {/* Sub-painel Aviamento: aparece só quando Aviamento está selecionado.
          Cada etapa marcada vira uma linha de checklist na ficha de operador
          de Aviamento (Frente/Traseira/Costura de tiras × numerações). */}
      {isAviamentoActive && (
        <div className="rounded-lg border-2 border-warning/30 bg-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-warning">
            <Factory className="h-4 w-4 shrink-0" />
            <span className="text-sm font-bold">Etapas de Aviamento</span>
            <span className="text-xs text-muted-foreground">
              Marque quais aplicar nesta ficha · vira checklist na ficha de operador
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {AVIAMENTO_STEPS.map(step => {
              const isStepActive = localSteps.includes(step);
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => toggleStep(step)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-all min-w-0',
                    isStepActive
                      ? 'border-warning/40 bg-warning/10 text-warning cursor-pointer'
                      : 'border-border bg-card text-muted-foreground hover:border-warning/40 cursor-pointer'
                  )}
                >
                  <Checkbox checked={isStepActive} className="pointer-events-none shrink-0" />
                  <span className="truncate">{step}</span>
                </button>
              );
            })}
          </div>
          {localSteps.length === 0 && (
            <p className="text-xs text-warning">
              ⚠ Nenhuma etapa marcada — ficha de operador vai aparecer sem checklist de Aviamento.
            </p>
          )}
        </div>
      )}

      {hasChanges && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {localSectors.length} setor(es){isAviamentoActive ? ` · ${localSteps.length} etapa(s) Aviamento` : ''}
          </span>
          <Button
            size="sm"
            onClick={() => onSave(localSectors, localSteps)}
            disabled={saving}
            className="gap-1"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Salvando...' : 'Salvar'}
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
            <div className="w-80 h-80 rounded-xl border-2 border-border overflow-hidden bg-muted cursor-zoom-in shadow-sm hover:shadow-md transition-shadow"
              onClick={() => setLightboxOpen(true)}>
              <img src={currentUrl} alt="Produto" className="w-full h-full object-cover" />
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                <div className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border flex items-center justify-center hover:bg-accent transition-colors">
                  <ImagePlus className="h-3.5 w-3.5 text-foreground" />
                </div>
              </label>
              <Button type="button" variant="destructive" size="icon" aria-label="Remover foto" className="h-7 w-7 rounded-md"
                onClick={(e) => { e.stopPropagation(); onChange([]); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center justify-center w-80 h-80 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-all bg-muted/20 hover:bg-muted/40">
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
      <p className="text-xs text-muted-foreground mb-4">
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
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-background/90 backdrop-blur border text-xs font-bold text-primary shadow-sm z-10">
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
                    <span className="text-xs text-white font-bold">{ci?.url ? 'Alterar' : 'Subir'}</span>
                  </label>
                )}
                {ci?.url && !uploading && (
                   <Button 
                    variant="destructive" 
                    size="icon"
                    aria-label="Remover foto da cor"
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
              <span className="text-xs font-semibold mt-1.5 truncate w-full text-center px-1" title={color}>{color}</span>
            </div>
          );
        })}
      </div>
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
        <p className="text-xs text-warning mt-1 flex items-center gap-1">
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
                className="h-7 text-xs gap-1"
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
      <p className="text-xs text-muted-foreground">
        Selecione o modelo de solado (agrupado por base, independente de cor). O sistema identifica automaticamente a variante correta para débito.
      </p>
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
    return products.filter((p: any) => searchMatchesAllTerms(search, p.name, p.sku, p.color, p.groupName));
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
                      <span className="text-xs text-muted-foreground">{p.groupName} • {p.sku || 'sem SKU'} • Estoque: {Number(p.quantity || 0).toLocaleString('pt-BR')}</span>
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

   /* ===== Component Color Mapping Panel (cor predominante → lista de componentes) =====
      Opt-in (technical_sheets.component_colors_enabled). Cada cor lista a lista COMPLETA
      de componentes; reusa DirectComponentSelect (grupo → produto) + NumberInput. */
   function ComponentColorMappingPanel({ sheetId, corPredominanteId, products, groups, mappings, directComponents, addRow, updateRow, deleteRow, onSetPredominante }: {
     sheetId: string;
     corPredominanteId: string | null;
     products: any[];
     groups: any[];
     mappings: any[];
     /** direct_components da ficha (form) — base pra mostrar quais cores são
      *  cobertas por regra GLOBAL (component_color_defaults) sem lista própria. */
     directComponents?: any[];
     addRow: any;
     updateRow: any;
     deleteRow: any;
     onSetPredominante: (groupId: string) => void;
   }) {
     // Regras GLOBAIS por cor — badge informativo por cor sem lista própria.
     const { data: globalColorRules = [] } = useComponentColorDefaults();
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

     // Grupos elegíveis pra "cor predominante": os que têm produtos ativos com cor
     // (o grupo que carrega as cores do modelo — normalmente o material do cabedal).
     const eligibleGroups = useMemo(() => {
       const gids = new Set(
         products.filter((p: any) => p.active && p.color?.trim() && p.group_id).map((p: any) => p.group_id),
       );
       return (groups || []).filter((g: any) => gids.has(g.id))
         .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
     }, [products, groups]);

     // cor (lower/trim) → linhas de componente daquela cor
     const byColor = useMemo(() => {
       const m = new Map<string, any[]>();
       for (const r of mappings) {
         const k = (r.cabedal_color || '').trim().toLowerCase();
         const arr = m.get(k) || [];
         arr.push(r);
         m.set(k, arr);
       }
       return m;
     }, [mappings]);

     // Cores SEM lista própria cobertas por regra GLOBAL (component_color_defaults):
     // pra cada grupo usado nos direct_components da ficha, regra exata da cor >
     // default do grupo. Mostra badge informativo — a regra age no motor de
     // consumo sem precisar configurar nada aqui.
     const globalRuleCoverage = useMemo(() => {
       const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
       const dcGroupIds = new Set<string>();
       for (const dc of directComponents || []) {
         const p = products.find((x: any) => x.id === dc?.product_id);
         if (p?.group_id) dcGroupIds.add(p.group_id);
       }
       const m = new Map<string, string[]>();
       if (dcGroupIds.size === 0) return m;
       for (const colorName of cabedelColors) {
         const names: string[] = [];
         for (const gid of dcGroupIds) {
           const exact = globalColorRules.find(r => r.active && !r.is_default && r.group_id === gid && norm(r.cabedal_color) === norm(colorName));
           const rule = exact || globalColorRules.find(r => r.active && r.is_default && r.group_id === gid);
           if (rule) {
             const p = products.find((x: any) => x.id === rule.product_id);
             if (p?.name) names.push(p.name);
           }
         }
         if (names.length > 0) m.set(colorName.toLowerCase(), names);
       }
       return m;
     }, [directComponents, products, cabedelColors, globalColorRules]);

     const configuredCount = cabedelColors.filter(c => (byColor.get(c.toLowerCase()) || []).length > 0).length;
     const ruleCoveredCount = cabedelColors.filter(c =>
       (byColor.get(c.toLowerCase()) || []).length === 0 && globalRuleCoverage.has(c.toLowerCase())).length;
     const ready = !!corPredominanteId && cabedelColors.length > 0;

     return (
       <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
         <div className="flex items-center gap-2">
           <Wand2 className="h-4 w-4 text-primary" />
           <h4 className="text-sm font-bold">Componentes por Cor</h4>
           {ready && (
             <Badge variant="outline" className="text-xs ml-auto">
               {configuredCount}/{cabedelColors.length} configuradas{ruleCoveredCount > 0 ? ` · ${ruleCoveredCount} por regra global` : ''}
             </Badge>
           )}
         </div>

         {/* Grupo de cor predominante — fonte das cores do modelo (ex.: o material do
             cabedal). É o mesmo campo usado pelas harmonizações de forração/palmilha/solado. */}
         <div className="flex flex-col sm:flex-row sm:items-center gap-2">
           <Label className="text-xs text-muted-foreground shrink-0">Grupo de cor predominante</Label>
           <Select value={corPredominanteId || ''} onValueChange={(v) => onSetPredominante(v)}>
             <SelectTrigger className="h-8 text-xs sm:max-w-xs"><SelectValue placeholder="Escolha o grupo que carrega as cores…" /></SelectTrigger>
             <SelectContent>
               {eligibleGroups.length === 0 && (
                 <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum grupo com cores cadastradas</div>
               )}
               {eligibleGroups.map((g: any) => (
                 <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
               ))}
             </SelectContent>
           </Select>
         </div>

         {!ready ? (
           <p className="text-xs text-muted-foreground">
             Escolha acima o grupo cujas cores o modelo usa (as mesmas escolhidas no pedido).
             Cada cor vira um card pra listar seus componentes. Lembre de <strong className="text-foreground">Salvar</strong> a ficha depois.
           </p>
         ) : (
         <>
         <p className="text-xs text-muted-foreground">
           Cada cor lista os componentes debitados quando ela for escolhida no pedido. Cor sem lista usa o padrão acima.
         </p>
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
           {cabedelColors.map(colorName => {
             const rows = byColor.get(colorName.toLowerCase()) || [];
             return (
               <div key={colorName} className="rounded-md border border-border bg-card p-3 space-y-2">
                 <div className="flex items-center gap-2">
                   <span className="text-xs font-semibold uppercase tracking-wider truncate">{colorName}</span>
                   <Badge variant="secondary" className="text-[10px] ml-auto">{rows.length} {rows.length === 1 ? 'item' : 'itens'}</Badge>
                 </div>
                 {rows.length === 0 && (
                   globalRuleCoverage.has(colorName.toLowerCase()) ? (
                     <div className="space-y-1">
                       <Badge variant="secondary" className="text-[10px]">
                         padrão global: {globalRuleCoverage.get(colorName.toLowerCase())!.join(' · ')}
                       </Badge>
                       <p className="text-[11px] text-muted-foreground italic">
                         Cor coberta por regra global (Padrões por Cor) — o consumo troca o SKU automaticamente; a quantidade segue a lista padrão.
                       </p>
                     </div>
                   ) : (
                     <p className="text-[11px] text-muted-foreground italic">Sem componentes próprios — usa a lista padrão acima.</p>
                   )
                 )}
                 {rows.map((r: any) => {
                   const prod = products.find((p: any) => p.id === r.product_id);
                   const unit = (prod?.unit || 'un').toString().trim() || 'un';
                   return (
                     <div key={r.id} className="flex items-end gap-2 border-l-2 border-primary/20 pl-2">
                       <div className="flex-1 min-w-0">
                         <DirectComponentSelect
                           label=""
                           value={r.product_id || ''}
                           onChange={(pid) => { if (pid && pid !== r.product_id) updateRow.mutate({ id: r.id, sheetId, productId: pid }); }}
                         />
                       </div>
                       <div className="w-16 shrink-0">
                         <Label className="text-[10px] text-muted-foreground">Qtd ({unit})</Label>
                         <NumberInput value={Number(r.quantity_per_unit) || 0}
                           onChange={v => updateRow.mutate({ id: r.id, sheetId, quantityPerUnit: v })}
                           className="mt-1 h-8 text-sm" placeholder="0" step={unit === 'un' ? '1' : '0.01'} />
                       </div>
                       <DeleteConfirmButton onConfirm={() => deleteRow.mutate({ id: r.id, sheetId })} title="Remover componente?" description="O componente sai da lista de materiais desta cor. Esta ação não pode ser desfeita." size="h-8 w-8 shrink-0" />
                     </div>
                   );
                 })}
                 <DirectComponentSelect
                   key={`add-${colorName}-${rows.length}`}
                   label="+ Adicionar componente"
                   value=""
                   onChange={(pid) => { if (pid) addRow.mutate({ sheetId, cabedalColor: colorName, productId: pid, quantityPerUnit: 1 }); }}
                 />
               </div>
             );
           })}
         </div>
         </>
         )}
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
           <Badge variant="outline" className="text-xs ml-auto">
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
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Cabedal</span>
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
      <p className="text-xs text-warning flex items-center gap-1">
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
        <Badge variant="outline" className="text-xs ml-auto">
         {palmilhaColorMappings.filter((m: any) => m.cabedal_color !== PALMILHA_DEFAULT_KEY && m.sole_color !== PALMILHA_DEFAULT_KEY).length}/{sourceColors.length} mapeados
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Para cada cor de cabedal, defina qual palmilha será utilizada. O padrão (exceto Preto) aplica a mesma palmilha para todas as demais cores.
      </p>

       {palmilhaModels.length > 0 && (
         <div className="flex flex-col gap-2 max-w-sm">
           <label className="text-xs font-medium uppercase text-muted-foreground">Modelo de Palmilha (Opcional p/ Unidades)</label>
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
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
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
                      <p className="text-xs text-warning">Sem cores no grupo</p>
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
                   className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                     defaultPalmilhaColor && defaultPalmilhaColor === currentPalmilhaColor
                       ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 font-semibold'
                       : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                   }`}
                 >
                   {defaultPalmilhaColor && defaultPalmilhaColor === currentPalmilhaColor
                     ? '✓ Padrão para todas as cores (exceto Preto)'
                     : 'Usar esta palmilha como padrão'}
                 </button>
               )}
               {isPreto && (
                 <p className="text-xs text-blue-600 dark:text-blue-400">
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
        <Badge variant="outline" className="text-xs ml-auto">
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
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Palmilha</span>
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
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                    defaultSoleColor === currentSole && currentSole
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {defaultSoleColor === currentSole && currentSole ? '✓ Padrão para todas as cores (exceto Preto)' : 'Usar esta cor de solado como padrão'}
                </button>
              )}
              {isPreto && (
                <p className="text-xs text-blue-600 dark:text-blue-400">
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




/* ===== Direct Component Select =====
   Lista TODOS os produtos ativos do estoque (não filtra por grupo). Mudado em
   2026-06-04: antes filtrava pelo grupo literal "Componentes" e só achava o
   que estivesse cadastrado nele (1 item no caso do user). O usuário cadastra
   ilhós, fivelas, elásticos, ABS em grupos próprios (ex: "Ilhós 51") —
   trancar pelo nome do grupo escondia 99% do estoque. */


function SheetBOM({ sheetId, safetyPct, onSafetyChange, shoeCategory }: {
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="mt-1 h-9 w-full justify-between text-sm font-normal">
                    {form.group_id ? (groups.find((g: any) => g.id === form.group_id)?.name || 'Grupo selecionado') : 'Selecionar grupo...'}
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
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
                              {g.description && <span className="text-xs text-muted-foreground">{g.description}</span>}
                              {g.colors && <span className="text-xs text-muted-foreground">Cores: {g.colors}</span>}
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


/* ===== Costs Tab ===== */
function CostsTab({ sheetId, form, groups }: {
  sheetId: string;
  form: SheetFormData; groups: { id: string; name: string }[];
}) {
  const { data: materials = [] } = useSheetMaterials(sheetId);
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: operations = [] } = useBomOperations(sheetId);
  const { data: costPolicy } = useCostPolicies();

  // BOM audit: warning quando grupo tem ≥5 variantes-cor (heurística de
  // BOM inflado por bulk insert/clone). Migration 20260531130000 criou
  // a view v_bom_audit_issues.
  const { data: bomIssues = [] } = useQuery({
    queryKey: ['bom_audit_issues', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_bom_audit_issues')
        .select('*')
        .eq('sheet_id', sheetId);
      if (error) throw error;
      return (data || []) as Array<{
        sheet_id: string; group_id: string | null; group_name: string;
        variants_count: number; colors_in_bom: string;
        issue_type: 'bom_color_variants_inflated' | 'bom_default_qty_per_unit';
        severity: 'critical' | 'warning';
      }>;
    },
  });

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
      const cost = Number(m.quantity_per_unit) * unitPrice;
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
        // Prioriza label custom (ex: "Elástico Traseiro 6mm") sobre genérico
        const customLabel = (extra.label || '').toString().trim();
        const label = customLabel
          ? `${customLabel} (${extra.material})`
          : extra.mandatory
            ? `Componente Extra (${extra.material})`
            : `Cabedal ${idx + 2}`;
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
        items.push({ label: comp.product_name || `Componente ${idx + 1}`, material: (comp.unit || 'un').toString().trim() || 'un', consumption: comp.quantity, pricePerUnit: comp.unit_price, cost: comp.quantity * comp.unit_price });
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

  // IMPORTANTE: chamar TODOS os hooks antes de qualquer early return.
  // Antes esse useOverheadHistory ficava depois do `if (!hasAnyData) return`,
  // causando "Rendered fewer/more hooks than during the previous render"
  // toda vez que a ficha alternava entre ter dados e não ter.
  const { data: overheadHistory = [] } = useOverheadHistory(sheetId);

  const hasAnyData = materials.length > 0 || specsCosts.length > 0 || strapsCosts.length > 0 || operations.length > 0;
  if (!hasAnyData) {
    return <div className="text-center py-8 text-muted-foreground"><p className="text-sm">Adicione materiais no BOM, operações ou preencha Especificações para calcular custos</p></div>;
  }

  return (
    <div className="space-y-6">
      {/* Warning: BOM com sintomas de bulk insert/clone errado.
          2 padrões cobertos pela view v_bom_audit_issues:
            - bom_color_variants_inflated: ≥5 variantes-cor do mesmo grupo
            - bom_default_qty_per_unit: ≥80% dos itens com qty_per_unit=1
              (default do cadastro, deveria ser fracionário) */}
      {bomIssues.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-bold text-warning">
                BOM possivelmente inflado — {bomIssues.length} alerta{bomIssues.length > 1 ? 's' : ''} detectado{bomIssues.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                Fichas saudáveis raramente têm mais de 2-3 cores do mesmo material no BOM.
                E <strong>consumo (qty/par) deve ser FRACIONÁRIO</strong> — ex: 0.005 lata de cola,
                não 1 lata por par. Itens com qty=1 inflam o custo em 50-100×.
                Revise em "Especificações por Componente" ou "Materiais".
              </p>
              <ul className="text-xs space-y-0.5 mt-1.5">
                {bomIssues.map((i, idx) => (
                  <li key={`${i.issue_type}-${i.group_id || idx}`} className="font-mono">
                    <span className={i.severity === 'critical' ? 'text-destructive font-bold' : 'text-warning'}>
                      {i.issue_type === 'bom_default_qty_per_unit'
                        ? `consumo default`
                        : `${i.variants_count}× cores`}
                    </span>
                    {' '}
                    <strong>{i.group_name}</strong>
                    <span className="text-muted-foreground"> · {i.colors_in_bom || '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <SectionTitle>Análise de Custo por Par</SectionTitle>
        {overheadHistory.length > 0 && (
           <Popover>
             <PopoverTrigger asChild>
               <Button variant="outline" size="sm" className="gap-2 h-7 text-xs">
                 <History className="h-3 w-3" />
                 Histórico de GGF
               </Button>
             </PopoverTrigger>
             <PopoverContent className="w-80 p-0" align="end">
               <div className="p-3 border-b bg-muted/30">
                 <h4 className="text-xs font-semibold">Histórico de Alterações GGF</h4>
                 <p className="text-xs text-muted-foreground">Últimas mudanças no overhead customizado</p>
               </div>
               <div className="max-h-60 overflow-y-auto">
                 {overheadHistory.map((entry) => (
                   <div key={entry.id} className="p-3 border-b last:border-0 text-xs space-y-1 hover:bg-muted/20 transition-colors">
                     <div className="flex items-center justify-between">
                       <span className="font-semibold text-primary">
                         {entry.new_value !== null ? formatCurrency(entry.new_value) : "Padrão"}
                       </span>
                       <span className="text-xs text-muted-foreground font-mono">
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
                    <Badge variant="outline" className="ml-2 text-[8px] bg-warning/10 text-warning border-warning/30">Customizado</Badge>
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
