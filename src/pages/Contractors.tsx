import AppLayout from "@/components/layout/AppLayout";
import ServiceOrderReturnDialog from '@/components/contractors/ServiceOrderReturnDialog';
import ServiceOrderDispatchDialog from '@/components/contractors/ServiceOrderDispatchDialog';
import { GenerateServiceOrdersWizard } from '@/components/contractors/GenerateServiceOrdersWizard';
import ConsolidatedServiceOrders from '@/components/contractors/ConsolidatedServiceOrders';
import { printServiceOrderRemessa } from '@/lib/printServiceOrderRemessa';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useCan } from '@/hooks/useAccessControl';
import { CircleNotch as Loader2, Plus, MagnifyingGlass as Search, PencilSimple as Pencil, Trash as Trash2, FileText, Handshake, Printer, X, Check, CaretUpDown as ChevronsUpDown, Upload, CheckCircle as CheckCircle2, Circle, ClipboardText as ClipboardList, CurrencyDollar as DollarSign, Clock, Users, ArrowRight, Package, Flask as FlaskConical, Scissors, Warning as AlertTriangle, WarningCircle as AlertCircle, CalendarBlank as Calendar, LockKey as Lock, Play, ClockCounterClockwise, ChartLineUp, FileArrowDown as FileDown, Funnel, Truck, DotsThreeVertical as MoreVertical, Archive, List as ListIcon, SquaresFour } from '@phosphor-icons/react';
import { ReceivePiecesDialog } from '@/components/bottlenecks/ReceivePiecesDialog';
import { SECTOR_LABEL, SectorKey } from '@/hooks/useSectorBottlenecks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import {
  useContractors, useServiceOrders, useServiceOrderOverview, useCreateContractor, useUpdateContractor, useDeleteContractor,
  useBulkReceiveServiceOrders, useArchiveServiceOrders,
  useCreateServiceOrder, useUpdateServiceOrder, useDeleteServiceOrder, useContractorSectorRate,
  Contractor, ServiceOrder, MaterialSent, ServiceOrderOverview,
} from '@/hooks/useContractors';
import { SERVICE_ORDER_SECTORS } from '@/lib/serviceOrderSectors';
import { OsPaymentBadge, OsBalanceLine } from '@/components/contractors/OsStatusIndicators';
import {
  OS_DONE_STATUSES, OS_CANCELLED_STATUSES, OS_PENDING_STATUSES, OS_STATUS,
  isOsDone, isOsCancelled, isOsActive, osStatusLabel, osStatusBadgeVariant,
  osStatusColor, osStatusDot,
  normalizeOsStatus,
} from '@/lib/osStatusMachine';
import {
  useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe, useDeleteArtisanalRecipe,
  ArtisanalRecipe, calcArtisanalRequirement,
} from '@/hooks/useArtisanalRecipes';
import { Switch } from '@/components/ui/switch';
import { useProducts, getBaseName } from '@/hooks/useProducts';
import { ContractorHistoryDialog } from '@/components/contractors/ContractorHistoryDialog';
import { ContractorRatesDialog } from '@/components/contractors/ContractorRatesDialog';
import { OutsourcingPlanningTab } from '@/components/contractors/OutsourcingPlanningTab';
const emptyRecipe: Partial<ArtisanalRecipe> = { name: '', artisanal_product_name: '', base_product_name: '', yield_per_meter: 1, labor_cost_per_meter: 0, active: true };

import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useAllGroupColors } from '@/hooks/useGroupColors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { toast } from 'sonner';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { SelectionTotalsBar } from '@/components/ui/selection-totals-bar';
import { generateCostReportPdf } from '@/lib/costReportPdf';
import { type CostReportRow, type DateBasis, summarizeRows, rowDateForBasis, inDateRange } from '@/lib/costReport';

const emptyContractor: Partial<Contractor> = { name: '', trade_name: '', cnpj_cpf: '', phone: '', email: '', address: '', city: '', state: '', service_type: '', notes: '', active: true, payment_days: 15 };
const emptyMaterial: MaterialSent = { material: '', color: '', meters: 0 };
const emptyOrder: Partial<ServiceOrder> & { materials_sent: MaterialSent[] } = {
  contractor_id: '', description: '', service_date: format(new Date(), 'yyyy-MM-dd'), service_time: '',
  quantity: 1, unit_price: 0, total_value: 0, status: 'Pendente', notes: '',
  material_name: '', material_meters: 0, material_color: '',
  materials_sent: [{ ...emptyMaterial }],
  sale_order_id: null,
  target_sector: null,     // setor terceirizado (obrigatório no form manual)
  is_avulsa: true,         // toda OS criada pelo form manual é avulsa
  order_id: null,          // vínculo opcional com a OP
  artisanal_recipe_id: null,
  artisanal_output_name: '',
  artisanal_output_color: '',
  artisanal_output_meters: 0,
  artisanal_for_order_meters: 0,
  artisanal_for_stock_meters: 0,
  artisanal_base_color: '',
  artisanal_stock_entry_done: false,
};

// Vocabulário canônico de status de OS centralizado em src/lib/osStatusMachine.ts
// (OS_DONE_STATUSES, OS_CANCELLED_STATUSES, OS_PENDING_STATUSES, isOsDone/Cancelled/Active,
//  osStatusLabel, osStatusBadgeVariant) — importado acima.

// Chips de filtro da lista de OSs. Labels seguem a linguagem do dono:
// 'Em Andamento' (DB) → "Em Processamento", 'Concluído' (DB) → "Entregue".
// Default 'active' = só Pendente + Em Processamento (o que precisa de ação).
const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: 'active', label: 'Ativas' },
  { value: 'all', label: 'Todas' },
  // "Na rua" e "Atrasados" vieram da antiga aba "Na Rua" (fundida aqui em
  // 2026-06-30). Filtram por pares em campo (qty_in_field) + prazo vencido —
  // tratados à parte de matchesStatusChip (precisam do overview/prazo).
  { value: 'na_rua', label: 'Na rua' },
  { value: 'atrasados', label: 'Atrasados' },
  { value: 'paradas', label: 'Paradas +15d' },
  // Rótulos = os canônicos de osStatusLabel (Pendente · Enviada · Recebida ·
  // Cancelada). Antes os chips diziam "Em Processamento"/"Entregue" enquanto o
  // badge da MESMA lista dizia "Enviada"/"Recebida" — três nomes pro mesmo
  // estado sem sair da página.
  { value: 'Pendente', label: 'Pendente' },
  { value: 'Em Andamento', label: 'Enviada' },
  { value: 'Concluído', label: 'Recebida' },
  { value: 'Cancelado', label: 'Cancelada' },
];
function matchesStatusChip(status: string, chip: string): boolean {
  switch (chip) {
    case 'all': return true;
    case 'active': return isOsActive(status);
    // Normalizar em vez de comparar texto: havia OS gravada como 'pendente'
    // minúsculo, 'enviada' e 'em_andamento' que os chips não pegavam — a OS
    // aparecia em "Ativas" e sumia do seu próprio estado.
    case 'Pendente': return normalizeOsStatus(status) === OS_STATUS.PENDENTE;
    case 'Em Andamento': return normalizeOsStatus(status) === OS_STATUS.EM_ANDAMENTO;
    case 'Concluído': return isOsDone(status);
    case 'Cancelado': return isOsCancelled(status);
    default: return status === chip;
  }
}

function getMaterials(order: ServiceOrder): MaterialSent[] {
  if (order.materials_sent && Array.isArray(order.materials_sent) && order.materials_sent.length > 0) return order.materials_sent;
  if (order.material_name || Number(order.material_meters) > 0) return [{ material: order.material_name || '', color: order.material_color || '', meters: Number(order.material_meters) || 0 }];
  return [];
}

export default function Contractors({ embedded = false, activeTab, onActiveTabChange, openCreateOS, onCreateOSConsumed }: { embedded?: boolean; activeTab?: string; onActiveTabChange?: (v: string) => void; openCreateOS?: { contractorId?: string } | null; onCreateOSConsumed?: () => void } = {}) {
  const navigate = useNavigate();
  const { data: contractors = [], isLoading: loadingC } = useContractors();
  const { data: orders = [], isLoading: loadingO } = useServiceOrders();
  const { data: osOverview } = useServiceOrderOverview(); // Map por service_order_id: pagamento (AP) + saldo de recebimento
  const { data: products = [], isLoading: loadingP } = useProducts();
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: artisanalRecipes = [] } = useArtisanalRecipes({ onlyActive: true });
  const recipes = artisanalRecipes;
  const createContractor = useCreateContractor();
  const updateContractor = useUpdateContractor();
  const deleteContractor = useDeleteContractor();
  const createOrder = useCreateServiceOrder();
  const updateOrder = useUpdateServiceOrder();
  const deleteOrder = useDeleteServiceOrder();
  const createRecipe = useCreateArtisanalRecipe();
  const updateRecipe = useUpdateArtisanalRecipe();
  const deleteRecipe = useDeleteArtisanalRecipe();
  const bulkReceive = useBulkReceiveServiceOrders();
  const archiveOs = useArchiveServiceOrders();
  const queryClient = useQueryClient();

  const [genOsOpen, setGenOsOpen] = useState(false);
  // Gates de ação da área Terceirizados (criar OS / excluir OS). Admin e
  // usuários sem permissão granular sempre passam.
  const osPerm = useCan('/terceirizados');
  // Busca NÃO persiste: reseta ao sair e voltar pra tela (useState remonta limpo).
  const [search, setSearch] = useState('');
  // Aceita ?q= na URL — a busca global navega pra cá com ?q=<termo>, que
  // sobrepõe o valor persistido. REATIVO (deps no param, não só mount):
  // selecionar outra OS no ⌘K estando já em /terceirizados não remonta a
  // página (AppLayout keia só por pathname).
  const [urlSearchParams] = useSearchParams();
  const urlQ = urlSearchParams.get('q') || '';
  useEffect(() => {
    if (urlQ) setSearch(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);
  // Chave v2: o filtro antigo guardava status cru ('pending_quote' etc.) que não
  // existe mais nos chips; default novo = 'active' (Pendente + Em Processamento).
  const [statusFilter, setStatusFilter] = usePersistedState<string>('contractors-status-v2', 'active');
  // Modo de exibição das OS: 'list' (tabela densa, melhor pra varrer muitas OS)
  // ou 'cards'. Persistido por usuário. Default 'list' a pedido (melhor visão).
  const [osView, setOsView] = usePersistedState<'list' | 'cards'>('contractors-os-view', 'list');

  // ── Filtros do relatório de custos da OS, na URL (compartilháveis) ───────────
  // contractor=id do prestador (vazio=todos), from/to=período, basis=base de data.
  const [searchParams, setSearchParams] = useSearchParams();
  const contractorFilter = searchParams.get('contractor') ?? 'all';
  const osFromDate = searchParams.get('from') ?? '';
  const osToDate = searchParams.get('to') ?? '';
  const osBasis: DateBasis = searchParams.get('basis') === 'criacao' ? 'criacao' : 'vencimento';
  const setOsParam = useCallback((key: string, value: string | null) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (value) p.set(key, value); else p.delete(key);
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const hasOsReportFilters = !!(contractorFilter !== 'all' || osFromDate || osToDate);
  const clearOsReportFilters = useCallback(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      ['contractor', 'from', 'to', 'basis'].forEach(k => p.delete(k));
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const [selectedOsIds, setSelectedOsIds] = useState<Set<string>>(new Set());
  const [osPdfBusy, setOsPdfBusy] = useState(false);
  const [showArchivedOs, setShowArchivedOs] = useState(false);
  const toggleOsSelect = useCallback((id: string) => {
    setSelectedOsIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const [historyContractor, setHistoryContractor] = useState<Contractor | null>(null);
  const [ratesContractor, setRatesContractor] = useState<Contractor | null>(null);
  const [contractorDialog, setContractorDialog] = useState(false);
  const [orderDialog, setOrderDialog] = useState(false);
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Partial<Contractor>>(emptyContractor);
  const [editingOrder, setEditingOrder] = useState<Partial<ServiceOrder> & { materials_sent: MaterialSent[] }>(emptyOrder);
  const [editingRecipe, setEditingRecipe] = useState<Partial<ArtisanalRecipe>>(emptyRecipe);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingRecipe, setIsEditingRecipe] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<ServiceOrder | null>(null);

  const openReceiveDialog = (o: ServiceOrder) => {
    setReceiveTarget(o);
    setReceiveDialogOpen(true);
  };
  const [orderTab, setOrderTab] = useState('dados');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Busca do seletor de pedido (PV/OP) — filtro manual (shouldFilter=false) sobre
  // TODOS os pedidos, sem corte de 50 nem filtro de status que escondia pedidos.
  const [pvSearch, setPvSearch] = useState('');
  const [pvOpen, setPvOpen] = useState(false);
  // Seleção dos itens do PV vinculado à OS (mesmo modelo do atalho "Gerar OS" do
  // pedido): marca os itens cobertos e a soma dos pares vira a Quantidade da OS.
  const [osPvItemSel, setOsPvItemSel] = useState<Set<string>>(new Set());
  const osPvPrevRef = useRef<string | null>(null); // rastreia troca de PV p/ só sobrescrever a qtd numa mudança ativa
  // Artisanal OS state
  const [isArtisanal, setIsArtisanal] = useState(false);
  const [artRecipeId, setArtRecipeId] = useState('');
  const [artOutputColor, setArtOutputColor] = useState('');
  const [artBaseColor, setArtBaseColor] = useState('');
  const [artNeededForOrder, setArtNeededForOrder] = useState(0);

  // ── Rich color/material sources ──
  const { data: allGroupColors = [] } = useAllGroupColors();
  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    // inclui is_color_agnostic pra não colidir com a MESMA queryKey no PV
    // (SaleOrderItemForm), cujo guard de cor lê essa flag — selects divergentes
    // sob a mesma key faziam o campo sumir do cache conforme a navegação.
    queryFn: async () => { const { data } = await supabase.from('product_groups').select('id, name, colors, is_color_agnostic'); return data || []; },
    staleTime: 0, gcTime: 30_000,
  });
  const { data: groupSupplierMaterials = [] } = useQuery({
    queryKey: ['group_supplier_materials_for_colors'],
    queryFn: async () => { const { data } = await supabase.from('group_supplier_materials').select('group_id, color, material_name').eq('active', true); return data || []; },
    staleTime: 0, gcTime: 30_000,
  });

  // Itens do PV vinculado à OS aberta (ref · cor + pares). Alimenta o seletor de
  // itens do dialog e a guia de remessa (cartões por item).
  const { data: osPvItemsRaw = [] } = useQuery({
    queryKey: ['os_dialog_pv_items', editingOrder.sale_order_id],
    enabled: orderDialog && !!editingOrder.sale_order_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_order_items')
        .select('id, color, quantity, reference_id, technical_sheets(code, name)')
        .eq('sale_order_id', editingOrder.sale_order_id as string);
      return data || [];
    },
    staleTime: 60_000,
  });
  const osPvItems = useMemo(
    () => (osPvItemsRaw as any[]).map((it) => {
      const ts = it.technical_sheets;
      const code = ts?.code || ts?.name || '';
      const label = [code, it.color || '—'].filter(Boolean).join(' · ');
      return { id: it.id as string, label, pairs: Number(it.quantity) || 0 };
    }).filter((i) => i.pairs > 0),
    [osPvItemsRaw],
  );
  const osSelItems = useMemo(() => osPvItems.filter((i) => osPvItemSel.has(i.id)), [osPvItems, osPvItemSel]);
  const osSelPares = osSelItems.reduce((s, i) => s + i.pairs, 0);

  // Ao carregar os itens do PV: pré-marca todos. Só sobrescreve a Quantidade da OS
  // quando o usuário TROCA o PV ativamente (não na abertura de uma OS existente —
  // aí preserva a quantidade já gravada).
  useEffect(() => {
    if (!orderDialog) return;
    const pv = editingOrder.sale_order_id || null;
    if (pv && osPvItems.length > 0) {
      setOsPvItemSel(new Set(osPvItems.map((i) => i.id)));
      if (osPvPrevRef.current !== null && osPvPrevRef.current !== pv) {
        const sum = osPvItems.reduce((s, i) => s + i.pairs, 0);
        if (sum > 0) setEditingOrder((p) => ({ ...p, quantity: sum }));
      }
      osPvPrevRef.current = pv;
    } else if (!pv) {
      setOsPvItemSel(new Set());
      osPvPrevRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDialog, editingOrder.sale_order_id, osPvItems]);

  // Liga/desliga um item do PV e recalcula a Quantidade (Σ pares marcados).
  const toggleOsPvItem = (id: string) => {
    const next = new Set(osPvItemSel);
    next.has(id) ? next.delete(id) : next.add(id);
    setOsPvItemSel(next);
    const sum = osPvItems.filter((i) => next.has(i.id)).reduce((s, i) => s + i.pairs, 0);
    if (sum > 0) setEditingOrder((p) => ({ ...p, quantity: sum }));
  };

  const uniqueSortedColors = (colors: string[]) => Array.from(new Set(colors.map(c => c.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const getDerivedProductColor = (product: any) => { const n = product.name?.trim() || ''; if (n.includes(':')) return n.split(':').pop()?.trim() || ''; if (n.includes(' - ')) return n.split(' - ').pop()?.trim() || ''; return ''; };

  const getColorsForGroup = useCallback((groupId: string): string[] => {
    const all: string[] = [];
    const group = productGroups.find((g: any) => g.id === groupId);
    if (group?.colors) all.push(...group.colors.split(','));
    allGroupColors.filter(gc => gc.group_id === groupId).forEach(gc => all.push(gc.color_name));
    groupSupplierMaterials.forEach((m: any) => { if (m.group_id !== groupId) return; if (m.color?.trim()) { all.push(m.color.trim()); return; } const n = m.material_name?.trim() || ''; if (n.includes(':')) all.push(n.split(':').pop()?.trim() || ''); else if (n.includes(' - ')) all.push(n.split(' - ').pop()?.trim() || ''); });
    products.forEach(p => { if (p.group_id !== groupId) return; if (p.color?.trim()) all.push(p.color.trim()); const d = getDerivedProductColor(p); if (d) all.push(d); });
    return uniqueSortedColors(all);
  }, [products, productGroups, allGroupColors, groupSupplierMaterials]);

  const uniqueMaterials = useMemo(() => {
    const names = new Set<string>();
    productGroups.forEach((g: any) => names.add(g.name));
    products.forEach(p => { if (!p.group_id) { const base = getBaseName(p.name) || p.name; names.add(base); } });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products, productGroups]);

  const getColorsForMaterial = useCallback((materialName: string): string[] => {
    if (!materialName) return [];
    const group = productGroups.find((g: any) => g.name === materialName);
    if (group) return getColorsForGroup(group.id);
    const colors = new Set<string>();
    products.forEach(p => { const base = getBaseName(p.name) || p.name; if (base === materialName) { if (p.color?.trim()) colors.add(p.color.trim()); const d = getDerivedProductColor(p); if (d) colors.add(d); } });
    return uniqueSortedColors(Array.from(colors));
  }, [products, productGroups, getColorsForGroup]);

  // ── Stats ──
  const stats = useMemo(() => {
    const activeContractors = contractors.filter(c => c.active).length;
    // Normalizar, não comparar texto literal: uma OS fechada como 'received'
    // (o vocabulário do fluxo de gargalos) não entrava em concluídas E ainda
    // somava no valor total — os KPIs do topo divergiam dos chips logo abaixo,
    // na mesma tela.
    const pendingOrders = orders.filter(o => normalizeOsStatus(o.status) === OS_STATUS.PENDENTE).length;
    const inProgressOrders = orders.filter(o => normalizeOsStatus(o.status) === OS_STATUS.EM_ANDAMENTO).length;
    const completedOrders = orders.filter(o => isOsDone(o.status)).length;
    const totalValue = orders.filter(o => !isOsCancelled(o.status)).reduce((s, o) => s + Number(o.total_value || 0), 0);
    // OS de gargalo: criadas via /gargalos, aguardando contratada confirmar prazo.
    // Enquanto status=pending_quote E quoted_deadline=NULL, a OP vinculada está
    // BLOQUEADA de avançar pra Montagem (trigger DB).
    // 'quoted' incluído: era a ÚNICA grafia que o código realmente grava
    // (useBulkAssignServiceOrders). Contar só 'pending_quote'/'quoted_unconfirmed'
    // — que nenhum escritor do repo produz — deixava este KPI e o de OPs
    // bloqueadas estruturalmente em zero.
    const pendingQuotes = orders.filter(o =>
      (o.status === 'pending_quote' || o.status === 'quoted_unconfirmed' || o.status === 'quoted') &&
      !o.quoted_deadline
    );
    const blockedOps = new Set(pendingQuotes.map(o => o.order_id).filter(Boolean)).size;
    return { activeContractors, pendingOrders, inProgressOrders, completedOrders, totalValue,
             pendingQuotes: pendingQuotes.length, blockedOps };
  }, [contractors, orders]);

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  // ── Filtered data ──
  const filteredContractors = useMemo(() => {
    return contractors.filter(c =>
      searchMatchesAllTerms(search, c.name, c.trade_name, c.service_type, c.cnpj_cpf, c.phone, c.city, c.state));
  }, [contractors, search]);

  const sel = useMarqueeSelection(filteredContractors, (c) => c.id);
  const handleBulkDeleteContractors = async () => {
    const ids = Array.from(sel.selectedIds);
    const sampleLines = filteredContractors
      .filter(c => sel.selectedIds.has(c.id))
      .slice(0, 5)
      .map(c => `• ${c.name}${c.cnpj_cpf ? ` (${c.cnpj_cpf})` : ''}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'prestador',
      sampleLines,
      deleteOne: (id) => deleteContractor.mutateAsync(id),
      onAfter: () => sel.clear(),
    });
  };

  const searchedOrders = useMemo(() => {
    return orders.filter(o => {
      // Arquivadas (triagem P0.3) ficam fora das listas por default.
      if (!showArchivedOs && o.archived_at) return false;
      return searchMatchesAllTerms(
        search,
        o.description, o.order_number, o.contractors?.name,
        o.receipt_number, o.artisanal_output_name,
      );
    });
  }, [orders, search, showArchivedOs]);

  // ── Operacional "Na rua" (fundido da antiga aba, 2026-06-30) ──────────────
  // "Na rua" = OS com pares ainda em campo (overview.qty_in_field > 0).
  // "Atrasados" = na rua E com prazo (quoted_deadline) vencido.
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const osInField = useCallback(
    (o: ServiceOrder) => Number(osOverview?.get(o.id)?.qty_in_field ?? 0) > 0,
    [osOverview],
  );
  const osLate = useCallback(
    (o: ServiceOrder) => osInField(o) && !!o.quoted_deadline && o.quoted_deadline < todayISO,
    [osInField, todayISO],
  );
  // "Paradas +15d" = OS ativa criada/agendada há mais de 15 dias que nunca
  // avançou de status (triagem P0.3 — o gap real era o ciclo parado: OS Pendente
  // nunca vira Concluído e a conta a pagar nunca nasce).
  const osStale = useCallback((o: ServiceOrder) => {
    if (!isOsActive(o.status)) return false;
    const ref = o.service_date || o.created_at?.slice(0, 10);
    if (!ref) return false;
    const ageDays = Math.round((new Date(todayISO + 'T00:00:00').getTime() - new Date(ref + 'T00:00:00').getTime()) / 86400000);
    return ageDays > 15;
  }, [todayISO]);
  const matchChip = useCallback((o: ServiceOrder, chip: string) => {
    if (chip === 'na_rua') return osInField(o);
    if (chip === 'atrasados') return osLate(o);
    if (chip === 'paradas') return osStale(o);
    return matchesStatusChip(o.status, chip);
  }, [osInField, osLate, osStale]);

  const statusChipCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const chip of STATUS_CHIPS) counts[chip.value] = searchedOrders.filter(o => matchChip(o, chip.value)).length;
    return counts;
  }, [searchedOrders, matchChip]);

  // KPIs operacionais "na rua" (pares em campo + OS atrasadas) — substituem os
  // cards da antiga aba "Na Rua".
  const fieldStats = useMemo(() => {
    let itens = 0, pares = 0, atrasados = 0;
    for (const o of orders) {
      const inf = Number(osOverview?.get(o.id)?.qty_in_field ?? 0);
      if (inf > 0) {
        itens++; pares += inf;
        if (o.quoted_deadline && o.quoted_deadline < todayISO) atrasados++;
      }
    }
    return { itens, pares, atrasados };
  }, [orders, osOverview, todayISO]);

  // Total a pagar (OS com conta a pagar gerada e ainda não quitada).
  const aPagar = useMemo(() => {
    let count = 0, value = 0;
    for (const o of orders) {
      const ov = osOverview?.get(o.id);
      if (ov?.has_payable && ov.payment_status !== 'paid') { count++; value += Number(o.total_value || 0); }
    }
    return { count, value };
  }, [orders, osOverview]);

  // Faixa de prazo UNIFICADA do card (substitui as 2 exibições que existiam:
  // a da seção de gargalo + a do rodapé). Uma só, colorida pela urgência.
  const renderDeadlineBand = (o: ServiceOrder) => {
    if (!isOsActive(o.status) || !o.quoted_deadline) return null;
    const due = o.quoted_deadline;
    const lateDays = Math.round(
      (new Date(todayISO + 'T00:00:00').getTime() - new Date(due + 'T00:00:00').getTime()) / 86400000,
    );
    const fmt = `${due.slice(8, 10)}/${due.slice(5, 7)}`;
    const inField = osInField(o);
    let cls: string, text: string, Icon: typeof Truck;
    if (lateDays > 0) { cls = 'bg-red-500/10 text-red-700 dark:text-red-400'; text = `Atrasado +${lateDays}d · prazo ${fmt}`; Icon = AlertTriangle; }
    else if (lateDays === 0) { cls = 'bg-amber-500/10 text-amber-700 dark:text-amber-400'; text = `Vence hoje · ${fmt}`; Icon = Clock; }
    else { cls = 'bg-muted text-muted-foreground'; text = `${inField ? 'Na rua' : 'Prazo'} · vence ${fmt} (em ${-lateDays}d)`; Icon = inField ? Truck : Calendar; }
    return (
      <div className={cn('mt-2.5 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold', cls)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />{text}
      </div>
    );
  };

  // Prazo compacto (1 linha) pro modo lista. Mesma lógica da faixa, sem o box.
  const renderDeadlineInline = (o: ServiceOrder) => {
    if (!isOsActive(o.status) || !o.quoted_deadline) return <span className="text-xs text-muted-foreground">—</span>;
    const due = o.quoted_deadline;
    const lateDays = Math.round(
      (new Date(todayISO + 'T00:00:00').getTime() - new Date(due + 'T00:00:00').getTime()) / 86400000,
    );
    const fmt = `${due.slice(8, 10)}/${due.slice(5, 7)}`;
    if (lateDays > 0) return <span className="whitespace-nowrap text-xs font-semibold text-red-700 dark:text-red-400">+{lateDays}d · {fmt}</span>;
    if (lateDays === 0) return <span className="whitespace-nowrap text-xs font-semibold text-amber-700 dark:text-amber-400">hoje · {fmt}</span>;
    return <span className="whitespace-nowrap text-xs text-muted-foreground">{fmt} · em {-lateDays}d</span>;
  };

  // Ações contextuais da OS (Receber/Enviar/Processar/Entregue + menu) —
  // COMPARTILHADAS entre o card e a linha da tabela. Deriva o estado do próprio
  // `o` pra ser autocontido.
  const renderOsActions = (o: ServiceOrder) => {
    const isBottleneckOS = !!o.target_sector;
    const active = isOsActive(o.status);
    const isPendingReceive = isBottleneckOS
      && o.status !== 'received' && o.status !== 'Concluído'
      && o.status !== 'Cancelado' && o.status !== 'cancelled';
    return (
      <div className="flex shrink-0 items-center justify-end gap-1">
        {isBottleneckOS && active && isPendingReceive && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => openReceiveDialog(o)}>
            <CheckCircle2 className="h-3 w-3" /> Receber
          </Button>
        )}
        {(o as any).dispatch_tracked && active && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setDispatchDialogOs(o)}>
            <Truck className="h-3 w-3" /> Enviar
          </Button>
        )}
        {active && o.status !== 'Em Andamento' && !['pending_quote', 'quoted_unconfirmed'].includes(String(o.status)) && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" title="Mover para Em Processamento" onClick={() => markInProgress(o)}>
            <Play className="h-3 w-3" /> Processar
          </Button>
        )}
        {active && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs text-green-700 dark:text-green-400 border-green-500/40 hover:bg-green-500/10" title="Registrar retorno e marcar como Entregue" onClick={() => markDelivered(o)}>
            <CheckCircle2 className="h-3 w-3" /> Entregue
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mais ações da OS"><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => openEditOrder(o)}><Pencil className="mr-2 h-3.5 w-3.5" /> Editar</DropdownMenuItem>
            {o.receipt_number && (
              <DropdownMenuItem onClick={() => {
                const so = (saleOrders as any[]).find(s => s.id === o.sale_order_id);
                printServiceOrderRemessa(
                  {
                    order_number: o.order_number,
                    target_sector: o.target_sector || null,
                    description: o.description || '',
                    service_date: o.service_date || '',
                    quantity: Number(o.quantity || 0),
                    unit_price: Number(o.unit_price || 0),
                    total_value: Number(o.total_value || 0),
                    notes: o.notes || '',
                    materials_sent: getMaterials(o),
                    sale_order_number: so?.order_number || null,
                    client_order_number: so?.client_order_number || null,
                    client_name: so?.client_name || null,
                  },
                  contractors.find(c => c.id === o.contractor_id),
                );
              }}>
                <Printer className="mr-2 h-3.5 w-3.5" /> Recibo {o.receipt_number}
              </DropdownMenuItem>
            )}
            {osPerm.canDelete && <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleteOsTarget(o)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
              </DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // OS → linha do relatório de custos (pagamento/vencimento vêm do overview).
  const toOsCostRow = useCallback((o: ServiceOrder): CostReportRow => {
    const ov = osOverview?.get(o.id);
    return {
      id: o.id,
      number: o.order_number,
      provider: o.contractors?.name || '—',
      description: o.description || o.artisanal_output_name || '—',
      total: Number(o.total_value) || 0,
      createdAt: o.created_at,
      date: o.service_date || o.created_at,
      dueDate: ov?.payment_due_date ?? null,
      status: o.status,
      statusLabel: osStatusLabel(o.status),
      isPaid: ov?.is_paid ?? false,
      isCancelled: isOsCancelled(o.status),
    };
  }, [osOverview]);

  const filteredOrders = useMemo(
    () => searchedOrders.filter(o => {
      if (!matchChip(o, statusFilter)) return false;
      if (contractorFilter !== 'all' && o.contractor_id !== contractorFilter) return false;
      if (osFromDate || osToDate) {
        const r = toOsCostRow(o);
        if (!inDateRange(rowDateForBasis(r, osBasis), osFromDate || null, osToDate || null)) return false;
      }
      return true;
    }),
    [searchedOrders, statusFilter, matchChip, contractorFilter, osFromDate, osToDate, osBasis, toOsCostRow],
  );

  // Seleção PRESA AO FILTRO: derivar de `orders` deixava selecionada OS que o
  // filtro atual não mostra — e "Receber em lote" registra devolução e dispara
  // conta a pagar de verdade. Trocar de prestador/chip depois de selecionar
  // podia cobrar OS que o usuário não estava mais vendo.
  const selectedOrders = useMemo(
    () => filteredOrders.filter(o => selectedOsIds.has(o.id)),
    [filteredOrders, selectedOsIds],
  );
  const osSelectionSummary = useMemo(() => summarizeRows(selectedOrders.map(toOsCostRow)), [selectedOrders, toOsCostRow]);
  // Triagem P0.3: elegíveis pro recebimento total em lote (ativas, não arquivadas).

  const bulkReceivable = useMemo(
    () => selectedOrders.filter(o => isOsActive(o.status) && !o.archived_at),
    [selectedOrders],
  );

  // Quebra por prestador do que o recebimento em lote vai efetivamente cobrar.
  // A confirmação descrevia o efeito ("gera conta a pagar") mas não mostrava
  // quanto nem pra quem — e a ação cria dinheiro de verdade.
  const bulkReceivePreview = useMemo(() => {
    const byContractor = new Map<string, { name: string; os: number; pairs: number; value: number }>();
    let skipped = 0;
    for (const o of bulkReceivable) {
      if (o.dispatch_tracked) { skipped++; continue; }
      const ov = osOverview?.get(o.id);
      const pairs = Math.max(0, Number(ov?.qty_in_field ?? o.quantity ?? 0));
      if (pairs <= 0) { skipped++; continue; }
      const key = o.contractor_id || '—';
      const cur = byContractor.get(key) || { name: o.contractors?.name || 'Sem prestador', os: 0, pairs: 0, value: 0 };
      cur.os += 1;
      cur.pairs += pairs;
      cur.value += pairs * Number(o.unit_price || 0);
      byContractor.set(key, cur);
    }
    const rows = Array.from(byContractor.values()).sort((a, b) => b.value - a.value);
    return { rows, skipped, total: rows.reduce((s, r) => s + r.value, 0) };
  }, [bulkReceivable, osOverview]);
  const allOsSelected = filteredOrders.length > 0 && filteredOrders.every(o => selectedOsIds.has(o.id));
  const toggleSelectAllOs = useCallback(() => {
    setSelectedOsIds(prev => (filteredOrders.length > 0 && filteredOrders.every(o => prev.has(o.id))) ? new Set() : new Set(filteredOrders.map(o => o.id)));
  }, [filteredOrders]);

  const handleGenerateOsPdf = useCallback(async (scope: 'filtro' | 'selecao') => {
    const src = scope === 'selecao' ? selectedOrders : filteredOrders;
    if (src.length === 0) {
      toast.error(scope === 'selecao' ? 'Selecione ≥1 OS pra gerar o relatório.' : 'Nenhuma OS no filtro atual.');
      return;
    }
    setOsPdfBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const providerName = contractorFilter !== 'all'
        ? (contractors.find(c => c.id === contractorFilter)?.name ?? null)
        : null;
      await generateCostReportPdf({
        kind: 'OS',
        rows: src.map(toOsCostRow),
        period: { from: osFromDate || null, to: osToDate || null },
        basis: osBasis,
        providerName,
        generatedBy: auth?.user?.email || 'sistema',
        scope,
      });
      toast.success('Relatório PDF gerado.');
    } catch (err: any) {
      toast.error(err.message || 'Falha ao gerar o PDF.');
    } finally {
      setOsPdfBusy(false);
    }
  }, [selectedOrders, filteredOrders, toOsCostRow, osFromDate, osToDate, osBasis, contractorFilter, contractors]);

  // ── Artisanal helpers ──────────────────────────────────────────────────────
  const findProductByNameColor = useCallback((name: string, color: string) => {
    const group = productGroups.find((g: any) => g.name === name);
    return products.find(p => {
      if (group && p.group_id === group.id) {
        const pc = p.color?.trim() || '';
        return pc === color || getDerivedProductColor(p) === color;
      }
      if (!group) {
        const base = getBaseName(p.name) || p.name;
        if (base !== name) return false;
        const pc = p.color?.trim() || '';
        return pc === color || getDerivedProductColor(p) === color;
      }
      return false;
    });
  }, [products, productGroups]);

  const artisanalStockEntry = useCallback(async (
    osId: string, osNumber: string,
    outputName: string, outputColor: string,
    outputMeters: number, forOrderMeters: number,
  ) => {
    const prod = findProductByNameColor(outputName, outputColor);
    if (!prod) {
      toast.error(`Produto artesanal não encontrado: ${outputName} (${outputColor}) — entrada não realizada`);
      return;
    }
    const prevQty = Number(prod.quantity) || 0;
    const afterEntry = prevQty + outputMeters;
    const inResult = await adjustStockSafe({
      productId: prod.id,
      expectedPrevious: prevQty,
      newQty: afterEntry,
      reason: `Entrada produção artesanal OS ${osNumber}`,
    });
    if (!inResult.success) { toast.error('Erro ao dar entrada artesanal: ' + (inResult.errorMessage || '')); return; }
    toast.success(`Entrada: +${outputMeters.toFixed(2)}m de ${outputName} (${outputColor})`);

    // Immediate debit for the linked order
    if (forOrderMeters > 0) {
      const afterDebit = Math.max(0, afterEntry - forOrderMeters);
      const debitResult = await adjustStockSafe({
        productId: prod.id,
        expectedPrevious: afterEntry,
        newQty: afterDebit,
        reason: `Débito artesanal para pedido OS ${osNumber}`,
      });
      if (!debitResult.success) { toast.error('Erro ao debitar artesanal: ' + (debitResult.errorMessage || '')); return; }
      toast.info(`Baixa p/ pedido: -${forOrderMeters.toFixed(2)}m de ${outputName} (${outputColor})`);
    }

    const { error: eOS } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', osId);
    if (eOS) { toast.error('Erro ao atualizar OS: ' + eOS.message); return; }
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
  }, [findProductByNameColor, queryClient]);

  // Computed artisanal requirement (live, based on current OS dialog state)
  const artisanalCalc = useMemo(() => {
    if (!isArtisanal || !artRecipeId || !artOutputColor) return null;
    const recipe = recipes.find(r => r.id === artRecipeId);
    if (!recipe) return null;
    const outputProd = findProductByNameColor(recipe.artisanal_product_name, artOutputColor);
    const currentStock = Number(outputProd?.quantity) || 0;
    const minStock = Number(outputProd?.min_stock) || 0;
    return calcArtisanalRequirement(recipe, artNeededForOrder, currentStock, minStock);
  }, [isArtisanal, artRecipeId, artOutputColor, artNeededForOrder, recipes, findProductByNameColor]);

  const resetArtisanal = () => { setIsArtisanal(false); setArtRecipeId(''); setArtOutputColor(''); setArtBaseColor(''); setArtNeededForOrder(0); };

  // ── Handlers ──
  const handleSaveContractor = () => {
    if (!editingContractor.name?.trim()) return;
    if (isEditing && editingContractor.id) {
      updateContractor.mutate(editingContractor as Contractor, { onSuccess: () => setContractorDialog(false) });
    } else {
      createContractor.mutate(editingContractor, { onSuccess: () => setContractorDialog(false) });
    }
  };

  // Conta a pagar: criador ÚNICO é o banco (tg_create_ap_for_service_order,
  // disparado na transição pra status finalizado; valor = pares BONS devolvidos
  // × unit_price via service_order_payable_amount). O createPayableForOrder
  // client-side foi removido na Fase 1 de facção (3 escritores divergentes).

  // Reverse artisanal stock entries when a Concluído OS is cancelled.
  const cancelArtisanalOutput = useCallback(async (
    osId: string,
    orderNumber: string,
    order: Partial<ServiceOrder>,
  ) => {
    if (!order.artisanal_stock_entry_done) return;
    const recipe = artisanalRecipes.find((r) => r.id === order.artisanal_recipe_id);
    if (!recipe) {
      toast.warning('Receita artesanal não encontrada — verifique o estoque manualmente.');
      return;
    }

    const outputMeters = Number(order.artisanal_output_meters) || 0;
    // A base (MP) é estornada automaticamente pelo trigger server-side
    // tg_revert_service_order_base_on_cancel ao cancelar a OS — não calcular aqui.
    // Net stock credited = total output − for_order portion (which went directly to production)
    const netCredited = outputMeters - (Number(order.artisanal_for_order_meters) || 0);
    const outputName = (order.artisanal_output_name || recipe.artisanal_product_name || '').trim();

    if (order.sale_order_id) {
      // Path A (per-color PV distribution): a saída (tira) precisa de lookup por cor
      // e não dá pra automatizar com segurança. Bloqueia o cancel pra evitar a corrida
      // onde a AP é estornada + flag resetada mas o estoque da tira segue creditado.
      // A base (MP) é estornada automaticamente pelo trigger ao cancelar a OS no banco.
      toast.error(
        `OS artesanal vinculada ao PV — cancele manualmente:\n` +
        `1. Debite saída: -${netCredited.toFixed(2)}m de "${outputName}"\n` +
        `2. Cancele a conta a pagar da OS ${orderNumber}\n` +
        `(a base "${recipe.base_product_name}" é estornada automaticamente ao cancelar)`,
        { duration: 15000 },
      );
      return; // do NOT cancel AP or reset the flag without stock reversal
    } else {
      const outputColor = (order.artisanal_output_color || '').trim();

      // A base (MP) é estornada automaticamente pelo trigger server-side
      // tg_revert_service_order_base_on_cancel — não reverter aqui (evita duplo estorno).

      // Debit output product by the net credited amount
      if (netCredited > 0) {
        // Resolve por GRUPO (robusto p/ nomenclatura "GRUPO: COR"); fallback por nome.
        const outGroup = productGroups.find((g: any) => g.name === outputName);
        let outQuery = supabase.from('products').select('id, quantity, name, color, group_id');
        outQuery = outGroup ? outQuery.eq('group_id', outGroup.id) : outQuery.ilike('name', `${outputName}%`);
        const { data: outRows } = await outQuery.limit(50);
        const outMatch = (outRows || []).find((p: any) => {
          if (!outGroup) { const base = getBaseName(p.name) || p.name; if (base !== outputName) return false; }
          const pc = (p.color || '').trim().toLowerCase();
          return !outputColor || pc === outputColor.toLowerCase() || getDerivedProductColor(p).toLowerCase() === outputColor.toLowerCase();
        });
        if (outMatch) {
          const prev = Number(outMatch.quantity);
          const debitQty = Math.max(0, prev - netCredited);
          const res = await adjustStockSafe({
            productId: outMatch.id, expectedPrevious: prev, newQty: debitQty,
            reason: `Estorno saída artesanal "${recipe.name}" — OS ${orderNumber} cancelada`, orderId: osId,
          });
          if (res.success) toast.info(`Saída estornada: -${netCredited.toFixed(2)}m de ${outputName}`);
          else toast.error(`Erro ao estornar saída: ${res.errorMessage || ''}`);
        } else {
          toast.warning(`Produto "${outputName}" (${outputColor}) não encontrado — estorno manual necessário.`);
        }
      }
    }

    // Cancel the AP row (idempotent — skip if already paid)
    const { error: apCancelErr } = await supabase.from('accounts_payable')
      .update({ status: 'cancelled' })
      .eq('reference_type', 'service_order')
      .eq('reference_id', osId)
      .neq('status', 'paid');
    if (apCancelErr) { toast.error(`Erro ao cancelar conta a pagar: ${apCancelErr.message}`); return; }

    // Reset flag so the OS could be re-completed if needed
    const { error: flagErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: false }).eq('id', osId);
    if (flagErr) { toast.error(`Erro ao resetar flag da OS: ${flagErr.message} — cancele manualmente.`); return; }

    queryClient.invalidateQueries({ queryKey: ['accounts_payable'] }); queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
    toast.success('OS cancelada: conta a pagar cancelada e entradas de estoque revertidas.');
  }, [artisanalRecipes, productGroups, products, queryClient]);

  const debitStockForMaterials = async (materials: MaterialSent[], orderNumber: string, orderId?: string, saleOrderId?: string | null) => {
    const so = saleOrderId ? saleOrders.find((s: any) => s.id === saleOrderId) : null;
    const pvLabel = so ? ` | PV: ${so.order_number}${so.client_order_number ? ` (${so.client_order_number})` : ''}` : '';
    for (const mat of materials) {
      if (!mat.material || !mat.color || mat.meters <= 0) continue;
      const group = productGroups.find((g: any) => g.name === mat.material);
      const product = products.find(p => {
        if (group && p.group_id === group.id) { const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; return false; }
        if (!group) { const base = getBaseName(p.name) || p.name; if (base !== mat.material) return false; const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; }
        return false;
      });
      if (!product) { toast.warning(`Produto não encontrado: ${mat.material} (${mat.color}) — estoque não debitado`); continue; }
      const prevQty = product.quantity || 0;
      const newQty = Math.max(0, prevQty - mat.meters);
      const result = await adjustStockSafe({
        productId: product.id,
        expectedPrevious: prevQty,
        newQty,
        reason: `Débito automático para OS ${orderNumber}${pvLabel}`,
        orderId: orderId || null,
      });
      if (result.success) {
        toast.info(`Estoque debitado: ${mat.material} (${mat.color}) -${mat.meters}m`);
      } else toast.error(`Erro ao atualizar estoque: ${mat.material} — ${result.errorMessage || ''}`);
    }
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  // ── Artisanal production: debit base material + register artisanal output stock ──
  const produceArtisanalOutput = async (
    order: Partial<ServiceOrder>,
    orderNumber: string,
    orderId?: string,
  ) => {
    if (!order.artisanal_recipe_id) return;
    // Re-read the live flag from DB — the passed-in payload may come from a stale
    // React Query cache, allowing double-debit if two tabs save simultaneously.
    if (orderId) {
      const { data: liveOs } = await supabase.from('service_orders').select('artisanal_stock_entry_done').eq('id', orderId).single();
      if (liveOs?.artisanal_stock_entry_done) return;
    } else if (order.artisanal_stock_entry_done) {
      return;
    }
    const recipe = artisanalRecipes.find((r) => r.id === order.artisanal_recipe_id);
    if (!recipe) {
      toast.warning('Receita artesanal não encontrada — entrada de estoque ignorada.');
      return;
    }
    const outputMeters = Number(order.artisanal_output_meters) || 0;
    // A base (MP) é debitada na CRIAÇÃO da OS pelo trigger tg_debit_service_order_base.
    // Aqui (conclusão) só lançamos a entrada da tira + a baixa for_order.
    const outputName = (order.artisanal_output_name || recipe.artisanal_product_name || '').trim();
    const stockMetersTotal = Number(order.artisanal_for_stock_meters) || 0;
    const forOrderMetersTotal = Number(order.artisanal_for_order_meters) || 0;

    if (outputMeters <= 0 || !outputName) return;

    // Resolve o produto da tira (output) por GRUPO — robusto contra nomenclatura
    // "GRUPO: COR" e diferença de caixa. Fallback por nome só quando o grupo não existe.
    const outGroup = productGroups.find((g: any) => g.name === outputName);
    const findOutputProd = (color: string) => {
      const c = (color || '').trim().toLowerCase();
      return products.find((p: any) => {
        if (outGroup) { if (p.group_id !== outGroup.id) return false; }
        else { const base = getBaseName(p.name) || p.name; if (base !== outputName) return false; }
        const pc = (p.color || '').trim().toLowerCase();
        return pc === c || getDerivedProductColor(p).toLowerCase() === c;
      });
    };

    // ── Path A: OS vinculada a um PV → debit por cor dos itens do pedido ──
    if (order.sale_order_id) {
      const { data: soItems } = await supabase
        .from('sale_order_items')
        .select('color, quantity')
        .eq('sale_order_id', order.sale_order_id);

      const validItems = (soItems || []).filter(i => i.color && (i.quantity || 0) > 0);
      const totalQty = validItems.reduce((s, i) => s + (i.quantity || 0), 0);

      if (validItems.length > 0 && totalQty > 0) {
        // Track quantity overrides to avoid stale reads in the same batch
        const stockOverrides = new Map<string, number>();
        const getQty = (p: { id: string; quantity: number | null }) =>
          stockOverrides.has(p.id) ? stockOverrides.get(p.id)! : (p.quantity || 0);

        // Only mark artisanal_stock_entry_done when ALL colors succeed.
        let hadColorFailure = false;
        for (const item of validItems) {
          const fraction = (item.quantity || 0) / totalQty;
          const stockForColor = stockMetersTotal * fraction;
          const forOrderForColor = forOrderMetersTotal * fraction;
          const itemColor = (item.color || '').trim();

          // 1) A base (MP) já foi debitada na CRIAÇÃO da OS pelo trigger
          //    tg_debit_service_order_base — não debitar aqui (evita duplo débito).

          // 2) Register artisanal output in this color (for_stock portion).
          // Track the output product ID so step 3 can use it even if the product
          // was just created (stale React Query cache wouldn't have it yet).
          let outputProdId: string | null = null;
          if (stockForColor > 0) {
            const existing = findOutputProd(itemColor);
            if (existing) {
              outputProdId = existing.id;
              const prevOutQty = getQty(existing);
              const newOutQty = prevOutQty + stockForColor;
              const inResult = await adjustStockSafe({
                productId: existing.id,
                expectedPrevious: prevOutQty,
                newQty: newOutQty,
                reason: `Entrada artesanal "${recipe.name}" (${itemColor}) — OS ${orderNumber}`,
                orderId: orderId || null,
              });
              if (!inResult.success) {
                toast.error(`Erro ao registrar entrada artesanal (${itemColor}): ${inResult.errorMessage || ''}`);
                hadColorFailure = true;
                continue;
              }
              stockOverrides.set(existing.id, newOutQty);
              toast.success(`Entrada artesanal: +${stockForColor.toFixed(2)}m de ${outputName} (${itemColor})`);
            } else {
              const { data: newProdId, error: createErr } = await supabase.rpc('create_artisanal_product_with_stock', {
                p_name: outputName,
                p_color: itemColor || '',
                p_quantity: stockForColor,
                p_unit: 'm',
                p_order_id: orderId || null,
                p_reason: `Criação + entrada artesanal "${recipe.name}" (${itemColor}) — OS ${orderNumber}`,
              });
              if (!createErr && newProdId) {
                outputProdId = newProdId as string;
                stockOverrides.set(newProdId as string, stockForColor);
                toast.success(`Produto artesanal criado: ${outputName} (${itemColor}) +${stockForColor.toFixed(2)}m`);
              } else if (createErr) {
                toast.error('Erro ao criar produto artesanal: ' + createErr.message);
                hadColorFailure = true;
                continue;
              }
            }
          } else {
            // No stock entry — still resolve ID for immediate debit (step 3)
            const p = findOutputProd(itemColor);
            if (p) outputProdId = p.id;
          }

          // 3) Immediate debit for the order (for_order portion) in this color.
          // Uses outputProdId resolved above — avoids stale-cache miss when product was created in step 2.
          if (forOrderForColor > 0 && outputProdId) {
            const baseAfterEntry = stockOverrides.has(outputProdId)
              ? stockOverrides.get(outputProdId)!
              : (products.find(p => p.id === outputProdId)?.quantity || 0);
            const afterDebit = Math.max(0, baseAfterEntry - forOrderForColor);
            const debitResult = await adjustStockSafe({
              productId: outputProdId,
              expectedPrevious: baseAfterEntry,
              newQty: afterDebit,
              reason: `Débito artesanal para pedido (${itemColor}) — OS ${orderNumber}`,
              orderId: orderId || null,
            });
            if (!debitResult.success) {
              toast.error(`Erro ao debitar OP (${itemColor}): ${debitResult.errorMessage || ''}`);
              hadColorFailure = true;
              continue;
            }
            stockOverrides.set(outputProdId, afterDebit);
            toast.info(`Baixa p/ pedido: -${forOrderForColor.toFixed(2)}m de ${outputName} (${itemColor})`);
          }
        }

        if (orderId && !hadColorFailure) {
          const { error: doneErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', orderId);
          if (doneErr) toast.error(`Erro ao marcar OS como concluída: ${doneErr.message} — marque manualmente.`);
        } else if (orderId && hadColorFailure) {
          toast.warning('Saída artesanal parcialmente lançada — algumas cores falharam. Verifique o estoque e tente novamente.');
        }
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        return;
      }
    }

    // ── Path B: OS sem vínculo de PV → cor única selecionada manualmente ──
    const outputColor = (order.artisanal_output_color || '').trim();
    let hadFailure = false;

    // 1) A base (MP) já foi debitada na CRIAÇÃO da OS pelo trigger
    //    tg_debit_service_order_base — não debitar aqui (evita duplo débito).

    // Track output product info across steps 2 and 3
    let artisanalOutputProdId: string | null = null;
    let artisanalBaseAfterEntry = 0;

    // 2) Register artisanal output (for_stock portion)
    if (stockMetersTotal > 0) {
      const existing = findOutputProd(outputColor);
      if (existing) {
        artisanalOutputProdId = existing.id;
        artisanalBaseAfterEntry = (existing.quantity || 0) + stockMetersTotal;
        const inResult = await adjustStockSafe({
          productId: existing.id,
          expectedPrevious: existing.quantity || 0,
          newQty: artisanalBaseAfterEntry,
          reason: `Entrada artesanal "${recipe.name}" — OS ${orderNumber}`,
          orderId: orderId || null,
        });
        if (inResult.success) {
          toast.success(`Entrada de estoque artesanal: +${stockMetersTotal.toFixed(2)}m de ${outputName}`);
        } else {
          hadFailure = true;
          toast.error(`Erro ao registrar entrada artesanal: ${inResult.errorMessage || ''}`);
        }
      } else {
        const { data: newProdId, error: createErr } = await supabase.rpc('create_artisanal_product_with_stock', {
          p_name: outputName,
          p_color: outputColor || '',
          p_quantity: stockMetersTotal,
          p_unit: 'm',
          p_order_id: orderId || null,
          p_reason: `Criação + entrada artesanal "${recipe.name}" — OS ${orderNumber}`,
        });
        if (!createErr && newProdId) {
          artisanalOutputProdId = newProdId as string;
          artisanalBaseAfterEntry = stockMetersTotal;
          toast.success(`Produto artesanal criado: ${outputName} (+${stockMetersTotal.toFixed(2)}m)`);
        } else if (createErr) {
          hadFailure = true;
          toast.error('Erro ao criar produto artesanal: ' + createErr.message);
        }
      }
    }

    // 3) Immediate debit for the order (for_order portion)
    // Use artisanalOutputProdId tracked in step 2 — products.find() would miss
    // a product created in this same call (not yet in React Query cache).
    if (forOrderMetersTotal > 0 && artisanalOutputProdId) {
      const afterDebit = Math.max(0, artisanalBaseAfterEntry - forOrderMetersTotal);
      const debitResult = await adjustStockSafe({
        productId: artisanalOutputProdId,
        expectedPrevious: artisanalBaseAfterEntry,
        newQty: afterDebit,
        reason: `Débito artesanal para pedido — OS ${orderNumber}`,
        orderId: orderId || null,
      });
      if (debitResult.success) {
        toast.info(`Baixa p/ pedido: -${forOrderMetersTotal.toFixed(2)}m de ${outputName}`);
      } else {
        hadFailure = true;
        toast.error(`Erro ao debitar OP: ${debitResult.errorMessage || ''}`);
      }
    } else if (forOrderMetersTotal > 0 && !artisanalOutputProdId) {
      hadFailure = true;
      toast.warning(`Débito p/ pedido não realizado — produto artesanal não encontrado. Ajuste manualmente.`);
    }

    if (orderId && !hadFailure) {
      const { error: doneErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', orderId);
      if (doneErr) toast.error(`Erro ao marcar OS como concluída: ${doneErr.message} — marque manualmente.`);
    } else if (orderId && hadFailure) {
      toast.warning('Saída artesanal parcialmente lançada. Verifique o estoque e tente novamente.');
    }
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
  };

  // ── Ações rápidas de status (1 clique na linha, sem abrir o form) ──────────
  // "Marcar como Entregue": status → 'Concluído' + delivered_at (data real).
  // Reusa o mesmo claim atômico do checkbox de materiais pra evitar dupla conta
  // a pagar / duplo lançamento artesanal em duplo-clique ou abas concorrentes.
  // "Entregue" agora REGISTRA RETORNO (Fase 1 facção): dialog com pares
  // bons/defeito/perda — o banco fecha a OS, grava delivered_at e gera a
  // conta a pagar pelos pares bons. Caso comum (retorno total) = 2 cliques.
  const [returnDialogOs, setReturnDialogOs] = useState<ServiceOrder | null>(null);
  // Envio parcial em parcelas (checklist "Enviar pra rua" + movimentos).
  const [dispatchDialogOs, setDispatchDialogOs] = useState<ServiceOrder | null>(null);
  // Confirmação estilizada de exclusão de OS (substitui window.confirm nativo).
  const [deleteOsTarget, setDeleteOsTarget] = useState<ServiceOrder | null>(null);
  const markDelivered = useCallback((o: ServiceOrder) => {
    setReturnDialogOs(o);
  }, []);
  const handleReturnSaved = useCallback(async (info: { completed: boolean }) => {
    const o = returnDialogOs;
    if (!info.completed || !o) return;
    // Efeito que era do fluxo antigo de conclusão: saída artesanal (1×).
    if ((o as any).artisanal_recipe_id) {
      const { data: fresh } = await (supabase as any)
        .from('service_orders')
        .select('order_number, artisanal_stock_entry_done')
        .eq('id', o.id)
        .maybeSingle();
      if (fresh && !fresh.artisanal_stock_entry_done) {
        await produceArtisanalOutput(
          { ...o, artisanal_stock_entry_done: fresh.artisanal_stock_entry_done } as any,
          fresh.order_number || '',
          o.id,
        );
      }
    }
  }, [returnDialogOs, produceArtisanalOutput]);

  // "Em Processamento" (DB: 'Em Andamento') — passa pelo hook canônico, que já
  // bloqueia downgrade de OS Concluída e invalida o cache.
  const markInProgress = useCallback((o: ServiceOrder) => {
    updateOrder.mutate({ id: o.id, status: 'Em Andamento' } as any);
  }, [updateOrder]);

  // Dar baixa / reabrir um material da OS. Quando TODOS ficam baixados, a OS
  // fecha (status→Concluído) via claim atômico (.neq status) que evita
  // dupla-conta-a-pagar em clique duplo / abas concorrentes, e dispara a saída
  // de estoque artesanal 1×. Extraído do corpo da tabela pra reuso no card.
  const toggleMaterial = useCallback(async (o: ServiceOrder, index: number) => {
    const mats = getMaterials(o);
    const updatedMats = mats.map((mat, mi) => mi === index ? { ...mat, completed: !mat.completed } : mat);
    const allDone = updatedMats.length > 0 && updatedMats.every(mat => mat.completed);
    if (allDone && o.status !== 'Concluído') {
      // OS por par (não-artesanal, valor por par): a conclusão TEM que passar pelo
      // diálogo de retorno pra capturar pares bons/defeito — senão a conta a pagar
      // sai pelo valor CHEIO (qtd × preço) ignorando perda (auditoria 2026-07-02).
      // Persiste o check dos materiais e abre o retorno; NÃO conclui direto aqui.
      if (!(o as any).artisanal_recipe_id && Number(o.unit_price) > 0) {
        await supabase.from('service_orders').update({ materials_sent: updatedMats as any }).eq('id', o.id);
        queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        setReturnDialogOs({ ...o, materials_sent: updatedMats } as any);
        return;
      }
      // Artesanal / valor fixo: mantém a conclusão direta (valor não depende de retorno).
      const { data: claimed } = await supabase
        .from('service_orders')
        .update({ status: 'Concluído', materials_sent: updatedMats as any })
        .eq('id', o.id)
        .neq('status', 'Concluído')
        .select('id, order_number, artisanal_stock_entry_done');
      if (!claimed || claimed.length === 0) {
        queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        return;
      }
      toast.success('Todos os itens concluídos! OS marcada como Concluída.');
      queryClient.invalidateQueries({ queryKey: ['service_orders'] });
      queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
      queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
      const freshOs = claimed[0] as any;
      if ((o as any).artisanal_recipe_id && !freshOs.artisanal_stock_entry_done) {
        await produceArtisanalOutput({ ...o, artisanal_stock_entry_done: freshOs.artisanal_stock_entry_done } as any, freshOs.order_number || '', o.id);
      }
    } else {
      updateOrder.mutate({ id: o.id, materials_sent: updatedMats } as any);
    }
  }, [updateOrder, queryClient, produceArtisanalOutput, setReturnDialogOs]);


  // ── Bloco C: form manual disciplinado ──────────────────────────────────────
  // Tarifa vigente da contratada+setor → pré-preenche o preço (só quando vazio).
  const { data: sectorRate } = useContractorSectorRate(editingOrder.contractor_id, editingOrder.target_sector);
  useEffect(() => {
    if (!isArtisanal && sectorRate != null && sectorRate > 0 && !(Number(editingOrder.unit_price) > 0)) {
      setEditingOrder(p => ({ ...p, unit_price: sectorRate }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorRate]);
  const selectedOrderContractor = contractors.find(c => c.id === editingOrder.contractor_id);
  const isFabricaContractor = (selectedOrderContractor?.payment_days ?? 0) >= 999;
  // Salvar exige contratado + setor + preço (exceto artesanal, que deriva da receita).
  const manualOsValid = !!editingOrder.contractor_id
    && (isArtisanal || (!!editingOrder.target_sector && Number(editingOrder.unit_price) > 0));

  const handleSaveOrder = () => {
    if (!editingOrder.contractor_id) return;
    if (!isArtisanal && (!editingOrder.target_sector || !(Number(editingOrder.unit_price) > 0))) return;
    const recipe = isArtisanal ? recipes.find(r => r.id === artRecipeId) : null;

    // Build artisanal payload override
    let artPayload: Partial<ServiceOrder> = {};
    let artMaterials: MaterialSent[] = [];
    if (isArtisanal && recipe && artOutputColor && artisanalCalc) {
      const { forOrderMeters, forStockMeters, totalToProduce, baseMetersSend, laborCost } = artisanalCalc;
      artPayload = {
        artisanal_recipe_id: recipe.id,
        artisanal_output_name: recipe.artisanal_product_name,
        artisanal_output_color: artOutputColor,
        artisanal_output_meters: totalToProduce,
        artisanal_for_order_meters: forOrderMeters,
        artisanal_for_stock_meters: forStockMeters,
        artisanal_base_color: artOutputColor, // regra: a tira é cortada da NAPA da MESMA cor
        artisanal_stock_entry_done: false,
        description: editingOrder.description?.trim() ||
          `Produção artesanal: ${recipe.artisanal_product_name} (${artOutputColor}) — ${totalToProduce.toFixed(2)}m`,
        total_value: laborCost,
        unit_price: laborCost,
      };
      if (artOutputColor && baseMetersSend > 0) {
        artMaterials = [{ material: recipe.base_product_name, color: artOutputColor, meters: Number(baseMetersSend.toFixed(4)) }];
      }
    }

    const descFinal = (artPayload.description as string) || editingOrder.description || '';
    if (!descFinal.trim()) return;

    // Fix do bug: total = qty × unit_price (não copia unit_price pra total).
    // Artesanal mantém override via laborCost da receita (artPayload.total_value).
    const qty = Math.max(1, Number(editingOrder.quantity || 1));
    const unitPriceFinal = isArtisanal
      ? Number(artPayload.unit_price ?? editingOrder.unit_price ?? 0)
      : Number(editingOrder.unit_price ?? 0);
    const total = isArtisanal
      ? Number(artPayload.total_value ?? editingOrder.total_value ?? unitPriceFinal)
      : (qty * unitPriceFinal);
    const validMaterials = isArtisanal && artMaterials.length > 0
      ? artMaterials
      : (editingOrder.materials_sent || []).filter(m => (m.material?.trim()) && (m.color?.trim()) && m.meters > 0);

    const payload = {
      ...editingOrder,
      ...artPayload,
      description: descFinal,
      quantity: qty,
      unit_price: unitPriceFinal,
      total_value: total,
      materials_sent: validMaterials,
      material_name: validMaterials[0]?.material || '',
      material_color: validMaterials[0]?.color || '',
      material_meters: validMaterials[0]?.meters || 0,
      sale_order_id: editingOrder.sale_order_id || null,
    };

    const originalOrder = orders.find(o => o.id === editingOrder.id);
    const justCompleted = editingOrder.status === 'Concluído' && originalOrder?.status !== 'Concluído';
    // Qualquer transição → Cancelado (não só de Concluído): senão cancelar uma OS
    // Pendente/Em Andamento caía no diff (zero) e NÃO estornava os materiais que
    // foram debitados na criação — vazamento de estoque (auditoria 2026-07-02).
    const justCancelled = editingOrder.status === 'Cancelado' && originalOrder?.status !== 'Cancelado';
    const contractorName = contractors.find(c => c.id === editingOrder.contractor_id)?.name || '';

    const doArtisanalCompletion = async (osId: string, osNumber: string, ord: typeof payload) => {
      if (
        ord.artisanal_output_meters && ord.artisanal_output_meters > 0 &&
        ord.artisanal_output_name && ord.artisanal_output_color &&
        !ord.artisanal_stock_entry_done
      ) {
        await artisanalStockEntry(
          osId, osNumber,
          ord.artisanal_output_name, ord.artisanal_output_color,
          ord.artisanal_output_meters, ord.artisanal_for_order_meters || 0,
        );
      }
    };

    if (isEditing && editingOrder.id) {
      const osId = editingOrder.id;
      updateOrder.mutate(payload as ServiceOrder, {
        onSuccess: async () => {
          setOrderDialog(false);
          if (justCompleted) {
            // Conta a pagar: gerada pelo banco na transição de status.
            queryClient.invalidateQueries({ queryKey: ['accounts_payable'] }); queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
            if (payload.artisanal_recipe_id) {
              try {
                await produceArtisanalOutput(payload, originalOrder?.order_number || '', osId);
              } catch (e: any) {
                toast.error(`Falha ao registrar saída artesanal: ${e?.message || 'erro desconhecido'}`);
              }
            }
          } else if (justCancelled) {
            // Reverte estoque ao cancelar a OS.
            try {
              if ((originalOrder as any)?.artisanal_recipe_id) {
                // Artesanal: reversão da saída + base (trigger server-side).
                await cancelArtisanalOutput(osId, originalOrder?.order_number || '', originalOrder as any);
              } else {
                // Não-artesanal: re-credita os materiais enviados (debitados na
                // criação) — mesma resolução produto+cor do branch de diff.
                const matsToRestore = getMaterials(originalOrder as any)
                  .filter(m => m.material?.trim() && m.color?.trim() && Number(m.meters) > 0);
                for (const mat of matsToRestore) {
                  const product = products.find(p => {
                    const group = (productGroups as any[]).find((g: any) => g.name === mat.material);
                    if (group && p.group_id === group.id) { const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; return false; }
                    if (!group) { const base = getBaseName(p.name) || p.name; if (base !== mat.material) return false; const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; }
                    return false;
                  });
                  if (!product) { toast.warning(`Material "${mat.material} (${mat.color})" não encontrado — confira o estoque manualmente.`); continue; }
                  const prev = Number(product.quantity) || 0;
                  const r = await adjustStockSafe({ productId: product.id, expectedPrevious: prev, newQty: prev + mat.meters, reason: `Estorno material OS ${originalOrder?.order_number || ''} (cancelamento)`, orderId: osId });
                  if (r.success) toast.info(`Material restituído: ${mat.material} (${mat.color}) +${mat.meters.toFixed(2)}m`);
                  else toast.error(`Erro ao restituir ${mat.material}: ${r.errorMessage || ''}`);
                }
              }
            } catch (e: any) {
              toast.error(`Falha ao estornar materiais: ${e?.message || 'erro desconhecido'}`);
            }
          } else {
            // Diff materials and debit/restore incremental changes
            const prevMaterials = getMaterials(originalOrder as any);
            const key = (m: MaterialSent) => `${m.material}||${m.color}`;
            const prevMap = new Map(prevMaterials.map(m => [key(m), m.meters]));
            const newMap = new Map(validMaterials.map(m => [key(m), m.meters]));
            // Debit additions / increases
            const debits: MaterialSent[] = [];
            for (const [k, newM] of newMap) {
              const prevM = prevMap.get(k) ?? 0;
              const diff = newM - prevM;
              if (diff > 0) {
                const [mat, col] = k.split('||');
                debits.push({ material: mat, color: col, meters: diff });
              }
            }
            // Credit removals / decreases
            for (const [k, prevM] of prevMap) {
              const newM = newMap.get(k) ?? 0;
              const diff = prevM - newM;
              if (diff > 0) {
                const [mat, col] = k.split('||');
                debits.push({ material: mat, color: col, meters: -diff }); // negative = restore
              }
            }
            const toDebit = debits.filter(m => m.meters > 0);
            const toRestore = debits.filter(m => m.meters < 0).map(m => ({ ...m, meters: -m.meters }));
            if (toDebit.length > 0) {
              debitStockForMaterials(toDebit, originalOrder?.order_number || '', osId, payload.sale_order_id);
            }
            if (toRestore.length > 0) {
              // Restore removed materials (negative debit = re-credit)
              for (const mat of toRestore) {
                const product = products.find(p => {
                  const group = (productGroups as any[]).find((g: any) => g.name === mat.material);
                  if (group && p.group_id === group.id) { const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; return false; }
                  if (!group) { const base = getBaseName(p.name) || p.name; if (base !== mat.material) return false; const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; }
                  return false;
                });
                if (product) {
                  const prev = Number(product.quantity) || 0;
                  adjustStockSafe({ productId: product.id, expectedPrevious: prev, newQty: prev + mat.meters, reason: `Estorno remoção de material OS ${originalOrder?.order_number || ''}`, orderId: osId })
                    .then(r => { if (r.success) toast.info(`Material restituído: ${mat.material} (${mat.color}) +${mat.meters.toFixed(2)}m`); else toast.error(`Erro ao restituir ${mat.material}: ${r.errorMessage || ''}`); });
                }
              }
            }
          }
        },
      });
    } else {
      createOrder.mutate(payload, {
        onSuccess: async (data: any) => {
          setOrderDialog(false);
          try {
            await debitStockForMaterials(validMaterials, data?.order_number, data?.id, editingOrder.sale_order_id);
          } catch (e: any) {
            toast.error(`Falha ao debitar materiais: ${e?.message || 'erro desconhecido'}`);
          }
          if (editingOrder.status === 'Concluído') {
            // Conta a pagar: gerada pelo banco na transição de status.
            queryClient.invalidateQueries({ queryKey: ['accounts_payable'] }); queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
            if (payload.artisanal_recipe_id) {
              try {
                await produceArtisanalOutput(payload, data?.order_number, data?.id);
              } catch (e: any) {
                toast.error(`Falha ao registrar saída artesanal: ${e?.message || 'erro desconhecido'}`);
              }
            }
          }
        },
      });
    }
  };

  const openEditContractor = (c: Contractor) => { setEditingContractor(c); setIsEditing(true); setContractorDialog(true); };
  const openNewContractor = () => { setEditingContractor({ ...emptyContractor }); setIsEditing(false); setContractorDialog(true); };
  const openEditOrder = (o: ServiceOrder) => {
    const mats = getMaterials(o);
    setEditingOrder({ ...o, materials_sent: mats.length > 0 ? mats : [{ ...emptyMaterial }] });
    setIsEditing(true);
    setOrderDialog(true);
    // Restore artisanal state if order was artisanal
    if (o.artisanal_recipe_id) {
      setIsArtisanal(true);
      setArtRecipeId(o.artisanal_recipe_id);
      setArtOutputColor(o.artisanal_output_color || '');
      setArtBaseColor(o.artisanal_base_color || '');
      setArtNeededForOrder(o.artisanal_for_order_meters || 0);
    } else {
      resetArtisanal();
    }
  };
  const openNewOrder = (contractorId?: string) => {
    setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }], ...(contractorId ? { contractor_id: contractorId } : {}) });
    setIsEditing(false);
    setOrderDialog(true);
    resetArtisanal();
  };

  // Sinal do hub (/terceirizados): "Nova OS" pedida por outra aba (ex.: Na Rua)
  // abre o ÚNICO formulário canônico aqui — uma vez, e avisa o hub pra limpar o
  // sinal (evita reabrir ao só navegar pra esta aba depois).
  useEffect(() => {
    if (openCreateOS) {
      openNewOrder(openCreateOS.contractorId);
      onCreateOSConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateOS]);

  const updateMaterial = (index: number, field: keyof MaterialSent, value: string | number | boolean) => {
    setEditingOrder(prev => { const mats = [...(prev.materials_sent || [])]; mats[index] = { ...mats[index], [field]: value }; return { ...prev, materials_sent: mats }; });
  };
  const addMaterial = () => {
    setEditingOrder(prev => { const mats = prev.materials_sent || []; const last = mats[mats.length - 1]; const newMat: MaterialSent = last?.material ? { material: last.material, color: '', meters: 0 } : { ...emptyMaterial }; return { ...prev, materials_sent: [...mats, newMat] }; });
  };
  const removeMaterial = (index: number) => {
    setEditingOrder(prev => { const mats = (prev.materials_sent || []).filter((_, i) => i !== index); return { ...prev, materials_sent: mats.length > 0 ? mats : [{ ...emptyMaterial }] }; });
  };

  // Cor e label do status delegadas à state machine canônica (osStatusMachine.ts).
  const statusColor = osStatusBadgeVariant;
  const statusLabel = osStatusLabel;

  const handleSaveRecipe = () => {
    if (!editingRecipe.name?.trim() || !editingRecipe.artisanal_product_name?.trim() || !editingRecipe.base_product_name?.trim()) return;
    if (isEditingRecipe && editingRecipe.id) {
      updateRecipe.mutate(editingRecipe as ArtisanalRecipe, { onSuccess: () => setRecipeDialog(false) });
    } else {
      createRecipe.mutate(editingRecipe, { onSuccess: () => setRecipeDialog(false) });
    }
  };

  if (loadingC || loadingO || loadingP) {
    const spinner = <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    return embedded ? spinner : <AppLayout>{spinner}</AppLayout>;
  }

  const inner = (
      <div className={cn("space-y-5", !embedded && "page-enter")}>
        {/* Header — escondido quando embutido no hub /terceiros (o hub provê o seu) */}
        {!embedded && (
          <EditorialPageHeader
            sectionLabel="RH · TERCEIROS"
            title="Terceirizados"
            description="Gestão de prestadores, ordens de serviço e recibos"
          />
        )}

        {/* Stats */}
        {/* KPIs — auditoria 2026-06-28: ocultar os que ficam sempre em 0
            (Aguardando prazo / Concluídas) enquanto não houver dado, pra não
            virar ruído permanente. Reaparecem sozinhos quando o ciclo de vida
            da OS começar a finalizar. */}
        {/* KPIs OPERACIONAL-FIRST (otimização 2026-06-30): urgência primeiro
            (Atrasados → Na rua → Pendentes → A pagar), depois resumo. Cards de
            valor 0 ficam ocultos pra não virar ruído. */}
        <StatGrid>
          {fieldStats.atrasados > 0 && (
            <StatCard icon={AlertTriangle} label="Atrasados" value={fieldStats.atrasados} hint="OS com prazo vencido" tone="destructive" />
          )}
          {fieldStats.itens > 0 && (
            <StatCard icon={Truck} label="Na rua" value={fieldStats.pares} hint={`${fieldStats.itens} OS em campo`} />
          )}
          <StatCard icon={Clock} label="OS Pendentes" value={stats.pendingOrders} hint={`${stats.inProgressOrders} em andamento`} tone="warning" />
          {aPagar.count > 0 && (
            <StatCard icon={DollarSign} label="A pagar" value={formatCurrency(aPagar.value)} hint={`${aPagar.count} OS`} tone="warning" />
          )}
          {/* OS de gargalo aguardando prazo — cada uma mantém uma OP bloqueada. */}
          {(stats.pendingQuotes > 0 || stats.blockedOps > 0) && (
            <StatCard
              icon={AlertCircle}
              label="OS aguardando prazo"
              value={stats.pendingQuotes}
              hint={stats.blockedOps > 0 ? `${stats.blockedOps} ${stats.blockedOps === 1 ? 'OP bloqueada' : 'OPs bloqueadas'}` : 'fluxo de gargalos'}
              tone="destructive"
            />
          )}
          {stats.completedOrders > 0 && (
            <StatCard icon={CheckCircle2} label="OS Concluídas" value={stats.completedOrders} tone="success" />
          )}
          <StatCard icon={DollarSign} label="Valor Total OS" value={formatCurrency(stats.totalValue)} />
          <StatCard icon={Users} label="Prestadores Ativos" value={stats.activeContractors} hint={`${contractors.length} total`} />
        </StatGrid>

        <Tabs {...(embedded ? { value: activeTab ?? "orders", onValueChange: onActiveTabChange } : { defaultValue: "orders" })}>
          {/* No hub /terceiros a navegação por aba é a barra única do hub —
              a TabsList interna fica oculta e o painel ativo vem por props. */}
          {!embedded && (
            <TabsList>
              <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Ordens de Serviço</TabsTrigger>
              <TabsTrigger value="planning" className="gap-1.5"><ChartLineUp className="h-3.5 w-3.5" /> Planejamento</TabsTrigger>
              <TabsTrigger value="contractors" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Prestadores</TabsTrigger>
              <TabsTrigger value="recipes" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Receitas Artesanais</TabsTrigger>
            </TabsList>
          )}

          {/* ── ORDERS TAB ── */}
          <TabsContent value="orders" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                className="flex-1 min-w-[200px] max-w-sm"
                inputClassName="h-9"
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nº da OS, prestador, descrição…"
                resultCount={filteredOrders.length}
                totalCount={orders.length}
              />
              {/* Chips de status — default "Ativas" (Pendente + Em Processamento).
                  Labels: 'Em Andamento'→Em Processamento, 'Concluído'→Entregue.
                  Auditoria 2026-06-28: chips de estado específico só aparecem se
                  tiverem dado (ou estiverem selecionados); "Ativas"/"Todas" são
                  fixos. Some o ruído de "Em Processamento 0 / Entregue 0". */}
              <div className="flex items-center gap-1 flex-wrap">
                {STATUS_CHIPS.filter(chip =>
                  chip.value === 'active' || chip.value === 'all' ||
                  chip.value === statusFilter || (statusChipCounts[chip.value] ?? 0) > 0
                ).map(chip => (
                  <Button
                    key={chip.value}
                    size="sm"
                    variant={statusFilter === chip.value
                      ? ((chip.value === 'na_rua' || chip.value === 'atrasados') ? 'destructive' : 'default')
                      : 'outline'}
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => setStatusFilter(chip.value)}
                  >
                    {chip.label}
                    <span className={cn('text-[10px] font-mono tabular-nums', statusFilter === chip.value ? 'opacity-80' : 'text-muted-foreground')}>
                      {statusChipCounts[chip.value] ?? 0}
                    </span>
                  </Button>
                ))}
                {/* Triagem P0.3: arquivadas ficam fora das listas por default. */}
                <Button
                  size="sm"
                  variant={showArchivedOs ? 'secondary' : 'ghost'}
                  className="h-9 text-xs text-muted-foreground"
                  onClick={() => setShowArchivedOs(v => !v)}
                >
                  {showArchivedOs ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}
                </Button>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Filtros de relatório (prestador / período / base) + PDF num popover —
                    tiram o ruído da lista operacional. O ponto sinaliza filtro ativo. */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 relative">
                      <FileDown className="h-4 w-4" /> Relatório
                      {hasOsReportFilters && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Prestador</Label>
                      <Select value={contractorFilter} onValueChange={v => setOsParam('contractor', v === 'all' ? null : v)}>
                        <SelectTrigger className="mt-1 h-9 w-full">
                          <span className="flex items-center gap-1.5 truncate"><Funnel className="h-3.5 w-3.5 shrink-0" /><SelectValue placeholder="Todos os prestadores" /></span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os prestadores</SelectItem>
                          {contractors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> De</Label>
                        <Input type="date" value={osFromDate} onChange={e => setOsParam('from', e.target.value || null)} className="mt-1 h-9" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Até</Label>
                        <Input type="date" value={osToDate} onChange={e => setOsParam('to', e.target.value || null)} className="mt-1 h-9" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Base da data</Label>
                      <Select value={osBasis} onValueChange={v => setOsParam('basis', v === 'criacao' ? 'criacao' : null)}>
                        <SelectTrigger className="mt-1 h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vencimento">Por vencimento</SelectItem>
                          <SelectItem value="criacao">Por criação</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {hasOsReportFilters ? (
                        <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground" onClick={clearOsReportFilters}>
                          <X className="h-3.5 w-3.5" /> Limpar
                        </Button>
                      ) : <span />}
                      <Button size="sm" className="h-9 gap-1.5" disabled={osPdfBusy} onClick={() => handleGenerateOsPdf('filtro')}>
                        {osPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                        Gerar PDF ({filteredOrders.length})
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {osPerm.canCreate && <Button variant="outline" size="sm" onClick={() => setGenOsOpen(true)} className="h-9 gap-1.5"><Handshake className="h-4 w-4" /> Gerar OS por Pedido</Button>}
                {osPerm.canCreate && <Button size="sm" onClick={() => openNewOrder()} className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Nova OS</Button>}
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={search ? Search : ClipboardList}
                  title={search ? `Nenhum resultado para "${search}"` : 'Nenhuma OS encontrada'}
                  description={search || hasOsReportFilters || statusFilter !== 'all'
                    ? 'Ajuste a busca, os chips de status ou os filtros de relatório.'
                    : 'Crie a primeira ordem de serviço para uma contratada.'}
                  action={search
                    ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
                    : osPerm.canCreate ? <Button size="sm" className="gap-1.5" onClick={() => openNewOrder()}><Plus className="h-4 w-4" /> Nova OS</Button> : undefined}
                />
              </Panel>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{filteredOrders.length} OS</span>
                  <div className="flex items-center gap-3">
                    <div className="inline-flex items-center rounded-md border bg-card p-0.5">
                      <button
                        type="button"
                        onClick={() => setOsView('list')}
                        aria-pressed={osView === 'list'}
                        title="Modo lista"
                        className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors', osView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <ListIcon className="h-3.5 w-3.5" /> Lista
                      </button>
                      <button
                        type="button"
                        onClick={() => setOsView('cards')}
                        aria-pressed={osView === 'cards'}
                        title="Modo cartões"
                        className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors', osView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <SquaresFour className="h-3.5 w-3.5" /> Cartões
                      </button>
                    </div>
                    <button type="button" className="transition-colors hover:text-foreground" onClick={toggleSelectAllOs}>
                      {allOsSelected ? 'Limpar seleção' : 'Selecionar todas'}
                    </button>
                  </div>
                </div>
                {osView === 'cards' ? (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredOrders.map(o => {
                    const mats = getMaterials(o);
                    // Vínculo direto (legacy) OU terceirização integrada (source_sale_order_id).
                    const linkedPvId = o.sale_order_id || o.source_sale_order_id || null;
                    const so = linkedPvId ? saleOrders.find((s: any) => s.id === linkedPvId) : null;
                    const isAuto = !!o.source_sale_order_id;
                    const isBottleneckOS = !!o.target_sector;
                    const isPendingReceive = isBottleneckOS
                      && o.status !== 'received' && o.status !== 'Concluído'
                      && o.status !== 'Cancelado' && o.status !== 'cancelled';
                    const active = isOsActive(o.status);
                    const selected = selectedOsIds.has(o.id);
                    return (
                      <div
                        key={o.id}
                        className={cn(
                          'flex flex-col rounded-xl border bg-card p-3.5 transition-colors',
                          selected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border/60 hover:border-border',
                        )}
                      >
                        {/* Cabeçalho: seleção + Nº/prestador · total/status */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <Checkbox checked={selected} onCheckedChange={() => toggleOsSelect(o.id)} className="mt-0.5 shrink-0" aria-label={`Selecionar OS ${o.order_number}`} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm font-bold tracking-tight">{o.order_number}</span>
                                {o.artisanal_recipe_id && <span title="Produção artesanal"><FlaskConical className="h-3.5 w-3.5 text-primary" /></span>}
                              </div>
                              <p className="truncate text-sm font-medium text-foreground">{o.contractors?.name || 'Sem prestador'}</p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-base font-bold leading-none tabular-nums">
                              {Number(o.total_value) === 0 && o.status !== 'Concluído' && o.status !== 'Cancelado' && o.status !== 'cancelled'
                                ? <span className="text-sm font-medium text-muted-foreground">A definir</span>
                                : formatCurrency(Number(o.total_value))}
                            </p>
                            <div className="mt-1 flex justify-end">
                              <Badge variant="outline" className={cn('gap-1 text-[11px]', osStatusColor(o.status))}><span className={cn('h-1.5 w-1.5 rounded-full', osStatusDot(o.status))} />{statusLabel(o.status)}</Badge>
                            </div>
                          </div>
                        </div>

                        {/* Faixa de prazo UNIFICADA (otimização 2026-06-30) — única
                            exibição de prazo/atraso do card (antes duplicava). */}
                        {renderDeadlineBand(o)}

                        {/* Corpo: descrição + PV + materiais + gargalo */}
                        <div className="mt-2.5 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 text-sm text-muted-foreground">{o.description || '—'}</p>
                            {so && (
                              <div className="shrink-0 text-right leading-tight">
                                <span className="font-mono text-xs font-semibold text-primary">{so.order_number}</span>
                                {so.client_order_number && <span className="block text-[11px] text-muted-foreground">{so.client_order_number}</span>}
                                {isAuto && <Badge variant="outline" className="mt-0.5 h-4 bg-primary/5 px-1.5 text-[9px] text-primary border-primary/30">PV</Badge>}
                              </div>
                            )}
                          </div>

                          {o.artisanal_output_name && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>{o.artisanal_output_name} ({o.artisanal_output_color}) · {Number(o.artisanal_output_meters).toFixed(2)}m</span>
                              {o.artisanal_stock_entry_done && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                            </div>
                          )}

                          {mats.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {mats.map((m, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  title={m.completed ? 'Reabrir este item' : 'Dar baixa neste item'}
                                  onClick={() => toggleMaterial(o, i)}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                                    m.completed
                                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 line-through'
                                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                                  )}
                                >
                                  {m.completed ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                  <span className="font-medium">{m.material || '?'}</span>
                                  {m.color && <span>({m.color})</span>}
                                  <span className="font-mono">{Number(m.meters).toFixed(0)}m</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Setor + OP bloqueada (o prazo/atraso saiu pra faixa unificada). */}
                          {isBottleneckOS && (o.target_sector || (isPendingReceive && o.order_id)) && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              {o.target_sector && (
                                <span>{(o.target_sector in SECTOR_LABEL) ? SECTOR_LABEL[o.target_sector as SectorKey] : o.target_sector}</span>
                              )}
                              {isPendingReceive && o.order_id && (
                                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><Lock className="h-3 w-3" /> OP bloqueada</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Rodapé: pagamento + ações contextuais + menu (faixa) */}
                        <div className="-mx-3.5 -mb-3.5 mt-3 flex items-center justify-between gap-2 rounded-b-xl border-t border-border/60 bg-muted/30 px-3.5 pb-3 pt-2.5">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <OsPaymentBadge ov={osOverview?.get(o.id)} osStatus={o.status} />
                            <OsBalanceLine ov={osOverview?.get(o.id)} />
                          </div>
                          {renderOsActions(o)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:h-9 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead className="w-8"><Checkbox checked={allOsSelected} onCheckedChange={toggleSelectAllOs} aria-label="Selecionar todas" /></TableHead>
                        <TableHead>Nº OS</TableHead>
                        <TableHead>Prestador</TableHead>
                        <TableHead className="hidden md:table-cell">PV</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="hidden lg:table-cell">Prazo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map(o => {
                        const mats = getMaterials(o);
                        const linkedPvId = o.sale_order_id || o.source_sale_order_id || null;
                        const so = linkedPvId ? saleOrders.find((s: any) => s.id === linkedPvId) : null;
                        const isAuto = !!o.source_sale_order_id;
                        const selected = selectedOsIds.has(o.id);
                        const doneCount = mats.filter(m => m.completed).length;
                        const noValue = Number(o.total_value) === 0 && o.status !== 'Concluído' && o.status !== 'Cancelado' && o.status !== 'cancelled';
                        return (
                          <TableRow
                            key={o.id}
                            data-state={selected ? 'selected' : undefined}
                            className="cursor-pointer"
                            onClick={e => { if ((e.target as HTMLElement).closest('button,[role="checkbox"]')) return; openEditOrder(o); }}
                          >
                            <TableCell onClick={e => e.stopPropagation()}>
                              <Checkbox checked={selected} onCheckedChange={() => toggleOsSelect(o.id)} aria-label={`Selecionar OS ${o.order_number}`} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm font-bold">
                              <span className="inline-flex items-center gap-1">
                                {o.order_number}
                                {o.artisanal_recipe_id && <span title="Produção artesanal"><FlaskConical className="h-3 w-3 text-primary" /></span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">{o.contractors?.name || <span className="text-muted-foreground">Sem prestador</span>}</TableCell>
                            <TableCell className="hidden whitespace-nowrap md:table-cell">
                              {so
                                ? <span className="inline-flex items-center gap-1"><span className="font-mono text-xs font-semibold text-primary">{so.order_number}</span>{isAuto && <Badge variant="outline" className="h-4 bg-primary/5 px-1 text-[9px] text-primary border-primary/30">PV</Badge>}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="max-w-[260px]">
                              <p className="truncate text-sm text-muted-foreground">{o.description || o.artisanal_output_name || '—'}</p>
                              {mats.length > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{doneCount}/{mats.length} {mats.length === 1 ? 'material' : 'materiais'}</span>}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">{renderDeadlineInline(o)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right font-mono text-sm font-bold tabular-nums">
                              {noValue ? <span className="text-xs font-medium text-muted-foreground">A definir</span> : formatCurrency(Number(o.total_value))}
                            </TableCell>
                            <TableCell><Badge variant="outline" className={cn('gap-1 whitespace-nowrap text-[11px]', osStatusColor(o.status))}><span className={cn('h-1.5 w-1.5 rounded-full', osStatusDot(o.status))} />{statusLabel(o.status)}</Badge></TableCell>
                            {/* A tabela é a visão PADRÃO da tela e não tinha coluna de
                                pagamento — o estado só existia no rodapé do card, o que
                                fazia o pagamento parecer ausente do fluxo. */}
                            <TableCell className="whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                <OsPaymentBadge ov={osOverview?.get(o.id)} osStatus={o.status} />
                                <OsBalanceLine ov={osOverview?.get(o.id)} />
                              </div>
                            </TableCell>
                            <TableCell className="text-right" onClick={e => e.stopPropagation()}>{renderOsActions(o)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── CONSOLIDADA TAB (OS por prestador · modelo contêiner+linhas) ── */}

          {/* ── PLANNING TAB ── */}
          <TabsContent value="planning" className="mt-3">
            <OutsourcingPlanningTab />
          </TabsContent>

          {/* ── RECIPES TAB ── */}

          {/* ── CONTRACTORS TAB ── */}
          <TabsContent value="contractors" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                className="flex-1 min-w-[200px] max-w-sm"
                inputClassName="h-9"
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nome, CPF/CNPJ, tipo de serviço…"
                resultCount={filteredContractors.length}
                totalCount={contractors.length}
              />
              <div className="ml-auto">
                <Button size="sm" onClick={openNewContractor} className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Novo Prestador</Button>
              </div>
            </div>

            <Panel flush>
                <div className="rounded-md border-0 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead className="w-8">
                          <Checkbox
                            checked={filteredContractors.length > 0 && filteredContractors.every(c => sel.isSelected(c.id))}
                            onCheckedChange={(v) => filteredContractors.forEach(c => { if (!!v !== sel.isSelected(c.id)) sel.toggle(c.id); })}
                            aria-label="Selecionar todos"
                          />
                        </TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>CPF/CNPJ</TableHead>
                        <TableHead>Tipo de Serviço</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Cidade/UF</TableHead>
                        <TableHead className="w-[80px]">Prazo Pgto</TableHead>
                        <TableHead className="w-[70px]">Status</TableHead>
                        <TableHead className="text-right w-[170px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContractors.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="p-0">
                            <EmptyState
                              size="sm"
                              icon={search ? Search : Users}
                              title={search ? `Nenhum resultado para "${search}"` : 'Nenhum prestador cadastrado'}
                              action={search ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button> : undefined}
                            />
                          </TableCell>
                        </TableRow>
                      ) : filteredContractors.map(c => (
                        <TableRow
                          key={c.id}
                          className={`cursor-pointer hover:bg-muted/50 transition-colors ${sel.isSelected(c.id) ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                          onClick={e => { if ((e.target as HTMLElement).closest('button,[role="checkbox"]')) return; openEditContractor(c); }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={sel.isSelected(c.id)}
                              onCheckedChange={() => sel.toggle(c.id)}
                              aria-label={`Selecionar ${c.name}`}
                            />
                          </TableCell>
                          <TableCell className="text-sm font-medium">{c.name}</TableCell>
                          <TableCell className="text-sm font-mono text-xs">{c.cnpj_cpf || '—'}</TableCell>
                          <TableCell className="text-sm">{c.service_type || '—'}</TableCell>
                          <TableCell className="text-sm">{c.phone || '—'}</TableCell>
                          <TableCell className="text-sm">{c.city && c.state ? `${c.city}/${c.state}` : '—'}</TableCell>
                          <TableCell className="text-sm font-mono text-center">{c.payment_days}d</TableCell>
                          <TableCell><Badge variant={c.active ? 'default' : 'secondary'} className="text-xs">{c.active ? 'Ativo' : 'Inativo'}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-0.5">
                              <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" title="Histórico de OSs da terceirizada" onClick={() => setHistoryContractor(c)}>
                                <ClockCounterClockwise className="h-3.5 w-3.5" />
                                Histórico
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" title="Tabela de preços por serviço (R$/par com vigência)" onClick={() => setRatesContractor(c)}>
                                Tarifas
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${c.name}`} onClick={() => openEditContractor(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Excluir ${c.name}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Excluir o prestador “{c.name}”?</AlertDialogTitle><AlertDialogDescription>Prestadores com OS vinculadas não podem ser excluídos — nesse caso, inative em vez de excluir. Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteContractor.mutate(c.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
            </Panel>
          </TabsContent>
        </Tabs>
      </div>
  );

  const overlays = (
    <>
      {/* ── Artisanal Recipe Dialog ── */}
      <Dialog open={recipeDialog} onOpenChange={open => { setRecipeDialog(open); if (!open) { setEditingRecipe({ ...emptyRecipe }); setIsEditingRecipe(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-primary" /> {isEditingRecipe ? 'Editar' : 'Nova'} Receita Artesanal</DialogTitle>
            <DialogDescription>Cadastre a transformação de matéria-prima em produto artesanal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nome da Receita *</Label>
              <Input placeholder="Ex: Tira Overlock 5mm" value={editingRecipe.name || ''} onChange={e => setEditingRecipe(p => ({ ...p, name: e.target.value }))} className="h-9" />
            </div>
            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transformação</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Matéria-Prima Base *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                        {editingRecipe.base_product_name || 'Material base'}
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0" align="start">
                       <Command>
                         <CommandInput placeholder="Buscar grupo..." />
                         <CommandList>
                           <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                           <CommandGroup>
                             {productGroups.map((g: any) => (
                               <CommandItem
                                 key={g.id}
                                 value={g.name}
                                 onSelect={(v) => setEditingRecipe((p) => ({ ...p, base_product_name: v }))}
                                >
                                 <Check className={cn('mr-2 h-3.5 w-3.5', editingRecipe.base_product_name === g.name ? 'opacity-100' : 'opacity-0')} />
                                 {g.name}
                               </CommandItem>
                             ))}
                           </CommandGroup>
                         </CommandList>
                       </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0 mt-5" />
                <div className="flex-1 space-y-1.5">
                   <Label className="text-xs text-muted-foreground">Produto Artesanal (Resultado) *</Label>
                   <Popover>
                     <PopoverTrigger asChild>
                       <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                         {editingRecipe.artisanal_product_name || 'Produto produzido'}
                         <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                       </Button>
                     </PopoverTrigger>
                     <PopoverContent className="w-[260px] p-0" align="start">
                       <Command>
                         <CommandInput placeholder="Buscar grupo..." />
                         <CommandList>
                           <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                           <CommandGroup>
                             {productGroups.map((g: any) => (
                               <CommandItem
                                 key={g.id}
                                 value={g.name}
                                 onSelect={(v) => setEditingRecipe((p) => ({ ...p, artisanal_product_name: v }))}
                               >
                                 <Check className={cn('mr-2 h-3.5 w-3.5', editingRecipe.artisanal_product_name === g.name ? 'opacity-100' : 'opacity-0')} />
                                 {g.name}
                               </CommandItem>
                             ))}
                           </CommandGroup>
                         </CommandList>
                       </Command>
                     </PopoverContent>
                   </Popover>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Rendimento (m saída / 1m base) *</Label>
                  <NumberInput min={0.01} value={editingRecipe.yield_per_meter} onChange={n => setEditingRecipe(p => ({ ...p, yield_per_meter: n }))} className="h-9" placeholder="Ex: 88" />
                  {(editingRecipe.yield_per_meter || 0) > 0 && (
                    <p className="text-xs text-muted-foreground">1m base → {editingRecipe.yield_per_meter}m saída</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">MO por metro saída (R$)</Label>
                  <NumberInput min={0} value={editingRecipe.labor_cost_per_meter} onChange={n => setEditingRecipe(p => ({ ...p, labor_cost_per_meter: n }))} className="h-9" placeholder="0.00" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prestador Padrão</Label>
              <Select value={editingRecipe.default_contractor_id || '__none__'} onValueChange={v => setEditingRecipe(p => ({ ...p, default_contractor_id: v === '__none__' ? null : v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {contractors.filter(c => c.active).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Observações</Label>
              <Input value={editingRecipe.notes || ''} onChange={e => setEditingRecipe(p => ({ ...p, notes: e.target.value }))} className="h-9" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editingRecipe.active ?? true} onCheckedChange={v => setEditingRecipe(p => ({ ...p, active: v }))} />
              <Label>Receita ativa</Label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setRecipeDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveRecipe} disabled={createRecipe.isPending || updateRecipe.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Contractor Dialog ── */}
      <Dialog open={contractorDialog} onOpenChange={open => { setContractorDialog(open); if (!open) { setEditingContractor({ ...emptyContractor }); setIsEditing(false); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Handshake className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Novo'} Prestador</DialogTitle>
            <DialogDescription>Dados cadastrais e prazo de pagamento do prestador.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nome / Razão Social *</Label>
              <Input value={editingContractor.name || ''} onChange={e => setEditingContractor(p => ({ ...p, name: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nome Fantasia</Label>
              <Input value={editingContractor.trade_name || ''} onChange={e => setEditingContractor(p => ({ ...p, trade_name: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">CPF/CNPJ</Label>
              <Input value={editingContractor.cnpj_cpf || ''} onChange={e => setEditingContractor(p => ({ ...p, cnpj_cpf: e.target.value }))} className="h-9 font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
              <Input value={editingContractor.phone || ''} onChange={e => setEditingContractor(p => ({ ...p, phone: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input value={editingContractor.email || ''} onChange={e => setEditingContractor(p => ({ ...p, email: e.target.value }))} className="h-9" />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tipo de Serviço</Label>
              <Input placeholder="Ex: Costura, Palmilha, Pesponto..." value={editingContractor.service_type || ''} onChange={e => setEditingContractor(p => ({ ...p, service_type: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Prazo de Pagamento (dias)</Label>
              <NumberInput min={1} decimals={0} value={editingContractor.payment_days ?? 15} onChange={n => setEditingContractor(p => ({ ...p, payment_days: n || 15 }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <Select value={editingContractor.active ? 'true' : 'false'} onValueChange={v => setEditingContractor(p => ({ ...p, active: v === 'true' }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Ativo</SelectItem>
                  <SelectItem value="false">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Endereço</Label>
              <Input value={editingContractor.address || ''} onChange={e => setEditingContractor(p => ({ ...p, address: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Cidade</Label>
              <Input value={editingContractor.city || ''} onChange={e => setEditingContractor(p => ({ ...p, city: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">UF</Label>
              <Input value={editingContractor.state || ''} onChange={e => setEditingContractor(p => ({ ...p, state: e.target.value }))} maxLength={2} className="h-9 uppercase" />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
              <Textarea value={editingContractor.notes || ''} onChange={e => setEditingContractor(p => ({ ...p, notes: e.target.value }))} rows={2} className="resize-none" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setContractorDialog(false)} className="h-9">Cancelar</Button>
            <Button onClick={handleSaveContractor} disabled={createContractor.isPending || updateContractor.isPending} className="h-9">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Service Order Dialog ── */}
      <Dialog open={orderDialog} onOpenChange={open => { setOrderDialog(open); if (!open) { setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }] }); setIsEditing(false); setOrderTab('dados'); resetArtisanal(); setOsPvItemSel(new Set()); osPvPrevRef.current = null; } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Nova'} Ordem de Serviço</DialogTitle>
            <DialogDescription>Prestador, materiais enviados e cobrança da OS.</DialogDescription>
          </DialogHeader>

          <Tabs value={orderTab} onValueChange={setOrderTab}>
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
              <TabsTrigger value="foto" className="flex-1 gap-1"><Upload className="h-3.5 w-3.5" /> Foto Assinada</TabsTrigger>
            </TabsList>

            <TabsContent value="dados" className="mt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 flex items-center gap-2.5">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Prestador &amp; Vínculo</span>
                  <span className="h-px flex-1 bg-border/70" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Prestador *</Label>
                  <Select value={editingOrder.contractor_id || ''} onValueChange={v => setEditingOrder(p => ({ ...p, contractor_id: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o prestador" /></SelectTrigger>
                    <SelectContent>
                      {contractors.filter(c => c.active).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name} {c.payment_days ? `(${c.payment_days}d)` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Descrição do Serviço *</Label>
                  <Input value={editingOrder.description || ''} onChange={e => setEditingOrder(p => ({ ...p, description: e.target.value }))} className="h-9" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Setor / serviço {!isArtisanal && '*'}</Label>
                  <Select value={editingOrder.target_sector || ''} onValueChange={v => setEditingOrder(p => ({ ...p, target_sector: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o setor terceirizado" /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_ORDER_SECTORS.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editingOrder.contractor_id && editingOrder.target_sector && (
                    sectorRate != null && sectorRate > 0 ? (
                      <p className="text-[11px] text-muted-foreground">Tarifa vigente: <span className="font-mono font-semibold text-foreground">{formatCurrency(sectorRate)}/par</span> — pré-preenchida (ajustável).</p>
                    ) : (
                      <p className="text-[11px] text-amber-600">Sem tarifa p/ esta contratada neste setor — informe o preço (ou cadastre em Prestadores → Tabela de Preços).</p>
                    )
                  )}
                  {isFabricaContractor && (
                    <p className="flex items-center gap-1 text-[11px] text-amber-600"><AlertTriangle className="h-3 w-3" /> FÁBRICA é trabalho interno — não gera conta a pagar.</p>
                  )}
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    Pedido de Venda (PV) — rastreio
                    {/* Quando há múltiplos PVs vinculados (OS auto agregada),
                        mostra contagem como info de rastreabilidade */}
                    {(editingOrder.linked_sale_order_ids?.length || 0) > 1 && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-foreground/10 text-foreground" title="OS gerada a partir de múltiplos PVs">
                        +{(editingOrder.linked_sale_order_ids?.length || 0) - 1} PVs vinculados
                      </span>
                    )}
                  </Label>
                  <Popover open={pvOpen} onOpenChange={(o) => { setPvOpen(o); if (!o) setPvSearch(''); }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" aria-expanded={pvOpen} className="h-9 w-full justify-between text-sm font-normal">
                        {editingOrder.sale_order_id
                          ? (() => { const so = saleOrders.find((s: any) => s.id === editingOrder.sale_order_id); return so ? `${so.order_number}${so.client_order_number ? ` — ${so.client_order_number}` : ''}${so.client_name ? ` (${so.client_name})` : ''}` : 'Selecione'; })()
                          : 'Nenhum (opcional)'}
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    {/* shouldFilter=false + filtro manual sobre TODOS os pedidos + value=id
                        estável: corrige o seletor que não achava/selecionava o pedido
                        (antes filtrava por 3 status e cortava em 50 ANTES da busca). */}
                    <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[340px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput placeholder="Buscar por PV, cliente ou pedido do cliente..." value={pvSearch} onValueChange={setPvSearch} />
                        <CommandList>
                          <CommandEmpty>Nenhum pedido encontrado.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => { setEditingOrder(p => ({ ...p, sale_order_id: null })); setPvOpen(false); setPvSearch(''); }}>
                              <Check className={cn("mr-2 h-3.5 w-3.5", !editingOrder.sale_order_id ? "opacity-100" : "opacity-0")} />
                              Nenhum (sem vínculo)
                            </CommandItem>
                            {(() => {
                              const matches = (saleOrders as any[]).filter((so) =>
                                searchMatchesAllTerms(pvSearch, so.order_number, so.client_order_number, so.client_name));
                              return matches.slice(0, 80).map((so: any) => (
                                <CommandItem key={so.id} value={so.id} onSelect={() => { setEditingOrder(p => ({ ...p, sale_order_id: so.id })); setPvOpen(false); setPvSearch(''); }}>
                                  <Check className={cn("mr-2 h-3.5 w-3.5", editingOrder.sale_order_id === so.id ? "opacity-100" : "opacity-0")} />
                                  <span className="font-mono font-semibold mr-2">{so.order_number}</span>
                                  {so.client_order_number && <span className="text-muted-foreground mr-2">({so.client_order_number})</span>}
                                  <span className="text-sm truncate">{so.client_name || ''}</span>
                                </CommandItem>
                              ));
                            })()}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* ── Itens do PV vinculado (mesmo modelo do atalho "Gerar OS" do pedido) ── */}
                {editingOrder.sale_order_id && osPvItems.length > 0 && !isArtisanal && (
                  <div className="sm:col-span-2 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Itens do pedido</span>
                      <span className="text-[11px] text-muted-foreground">{osSelItems.length} de {osPvItems.length} · <b className="text-foreground">{osSelPares.toLocaleString('pt-BR')} pares</b></span>
                    </div>
                    <div className="space-y-1.5">
                      {osPvItems.map((it) => {
                        const on = osPvItemSel.has(it.id);
                        return (
                          <button
                            type="button" key={it.id} onClick={() => toggleOsPvItem(it.id)}
                            className={cn(
                              'w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                              on ? 'border-primary/40 bg-primary/10' : 'border-border bg-background hover:bg-muted/50',
                            )}
                          >
                            <span className={cn('h-4 w-4 rounded border grid place-items-center text-[10px] leading-none text-primary-foreground', on ? 'bg-primary border-primary' : 'border-muted-foreground/40')}>{on ? '✓' : ''}</span>
                            <span className="text-sm font-medium text-foreground flex-1 truncate">{it.label}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">{it.pairs.toLocaleString('pt-BR')} pares</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Marque os itens desta OS — a soma dos pares vira a <b className="text-foreground">Quantidade</b> e alimenta a guia de remessa.</p>
                  </div>
                )}

                {/* ── Artisanal Production Panel ── */}
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Produção Artesanal</span>
                    </div>
                    <Switch checked={isArtisanal} onCheckedChange={v => { setIsArtisanal(v); if (!v) resetArtisanal(); }} />
                  </div>

                  {isArtisanal && (
                    <div className="mt-3 space-y-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                      {/* Recipe picker */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">Receita Artesanal</Label>
                        <Select value={artRecipeId} onValueChange={v => { setArtRecipeId(v); setArtOutputColor(''); setArtBaseColor(''); const rec = recipes.find(r => r.id === v); if (rec?.default_contractor_id && !editingOrder.contractor_id) setEditingOrder(p => ({ ...p, contractor_id: rec.default_contractor_id! })); }}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a receita..." /></SelectTrigger>
                          <SelectContent>
                            {recipes.filter(r => r.active).map(r => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name} — {r.base_product_name} → {r.artisanal_product_name} ({r.yield_per_meter}×)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {artRecipeId && (() => {
                        const recipe = recipes.find(r => r.id === artRecipeId);
                        if (!recipe) return null;
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Cor do Produto Artesanal</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                                    {artOutputColor || 'Selecione a cor'}
                                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="start">
                                   <Command>
                                     <CommandInput placeholder="Buscar cor..." />
                                     <CommandList>
                                       <CommandEmpty>Nenhuma cor.</CommandEmpty>
                                       <CommandGroup>
                                         {getColorsForMaterial(recipe.artisanal_product_name).map(c => (
                                           <CommandItem
                                             key={c}
                                             value={c}
                                             onSelect={v => {
                                               setArtOutputColor(v);
                                               // Regra: a tira é cortada da NAPA da MESMA cor → base sempre = output
                                               setArtBaseColor(v);
                                             }}
                                           >
                                             <Check className={cn('mr-2 h-3.5 w-3.5', artOutputColor === c ? 'opacity-100' : 'opacity-0')} />
                                             {c}
                                           </CommandItem>
                                         ))}
                                       </CommandGroup>
                                     </CommandList>
                                   </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Cor da Matéria-Prima Base</Label>
                              <Input value={artBaseColor || artOutputColor || '—'} disabled className="h-9 bg-muted/40" />
                              <p className="text-[11px] text-muted-foreground">= cor do produto (a tira é cortada da NAPA da mesma cor).</p>
                            </div>
                            <div className="sm:col-span-2 space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Metros necessários para o pedido (m)</Label>
                              <NumberInput min={0} value={artNeededForOrder} onChange={n => setArtNeededForOrder(n)} className="h-9" placeholder="0.00" />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Calculation panel */}
                      {artisanalCalc && (() => {
                        const recipe = recipes.find(r => r.id === artRecipeId)!;
                        const { currentStock, minStock, forOrderMeters, forStockMeters, totalToProduce, baseMetersSend, laborCost, stockOk } = artisanalCalc;
                        return (
                          <div className="rounded-lg border bg-background p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Estoque atual de {recipe.artisanal_product_name} ({artOutputColor})</span>
                              <span className="font-mono font-semibold text-foreground">{currentStock.toFixed(2)}m</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Estoque mínimo</span>
                              <span className="font-mono">{minStock.toFixed(2)}m</span>
                            </div>
                            <Separator />

                            {stockOk ? (
                              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                <CheckCircle2 className="h-4 w-4" /> Estoque suficiente — produção não necessária
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {forOrderMeters > 0 && (
                                  <div className="flex items-center justify-between rounded bg-blue-500/10 px-2 py-1.5">
                                    <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">🔵 Para o pedido</span>
                                    <span className="font-mono text-sm font-bold text-blue-700 dark:text-blue-400">{forOrderMeters.toFixed(2)}m</span>
                                  </div>
                                )}
                                {forStockMeters > 0 && (
                                  <div className="flex items-center justify-between rounded bg-amber-500/10 px-2 py-1.5">
                                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">🟡 Para repor estoque mínimo</span>
                                    <span className="font-mono text-sm font-bold text-amber-700 dark:text-amber-400">{forStockMeters.toFixed(2)}m</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between rounded bg-emerald-500/10 px-2 py-1.5">
                                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">✅ Total a produzir</span>
                                  <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">{totalToProduce.toFixed(2)}m</span>
                                </div>
                                <Separator />
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{recipe.base_product_name} ({artBaseColor || 'cor?'}) a enviar <span className="text-muted-foreground/70">(÷ {recipe.yield_per_meter})</span></span>
                                  <span className="font-mono font-semibold">{baseMetersSend.toFixed(4)}m</span>
                                </div>
                                {laborCost > 0 && (
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Custo MO ({totalToProduce.toFixed(2)}m × R${recipe.labor_cost_per_meter.toFixed(2)})</span>
                                    <span className="font-mono font-semibold text-green-700 dark:text-green-400">
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(laborCost)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {!artisanalCalc && artRecipeId && (
                        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 rounded p-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          Selecione a cor e informe os metros necessários para calcular a produção.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Materials section — hidden in artisanal mode (auto-computed) */}
                {!isArtisanal && (
                <div className="sm:col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Materiais Enviados</span>
                  <span className="h-px flex-1 bg-border/70" />
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addMaterial}><Plus className="h-3 w-3" /> Adicionar</Button>
                </div>
                )}

                {!isArtisanal && (
                <div className="sm:col-span-2 space-y-2">
                  {(editingOrder.materials_sent || []).map((mat, idx) => (
                    <div key={idx} className={cn("flex items-end gap-2 p-3 rounded-lg border bg-muted/20 transition-colors", mat.completed ? "border-green-500/40 bg-green-500/10" : "border-border")}>
                      {/* Check de "dar baixa" só faz sentido editando uma OS existente —
                          numa OS nova ainda não há o que baixar. */}
                      {isEditing && (
                      <button type="button" className="shrink-0 self-center mb-1 hover:scale-110 transition-transform" title={mat.completed ? 'Marcar como pendente' : 'Dar baixa'} onClick={() => updateMaterial(idx, 'completed', !mat.completed)}>
                        {mat.completed ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                      </button>
                      )}
                      <div className={cn("flex-1 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Material</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-sm font-normal">{mat.material || "Material"}<ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" /></Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0" align="start">
                            <Command><CommandInput placeholder="Buscar material..." /><CommandList><CommandEmpty>Nenhum material.</CommandEmpty><CommandGroup>
                              {uniqueMaterials.map(m => (<CommandItem key={m} value={m} onSelect={v => { updateMaterial(idx, 'material', v); updateMaterial(idx, 'color', ''); }}><Check className={cn("mr-2 h-3.5 w-3.5", mat.material === m ? "opacity-100" : "opacity-0")} />{m}</CommandItem>))}
                            </CommandGroup></CommandList></Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className={cn("flex-1 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Cor</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-sm font-normal" disabled={!mat.material}>{mat.color || "Cor"}<ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" /></Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[200px] p-0" align="start">
                            <Command><CommandInput placeholder="Buscar cor..." /><CommandList><CommandEmpty>Nenhuma cor.</CommandEmpty><CommandGroup>
                              {getColorsForMaterial(mat.material).map(c => (<CommandItem key={c} value={c} onSelect={v => updateMaterial(idx, 'color', v)}><Check className={cn("mr-2 h-3.5 w-3.5", mat.color === c ? "opacity-100" : "opacity-0")} />{c}</CommandItem>))}
                            </CommandGroup></CommandList></Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className={cn("w-24 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Metros</Label>
                        <NumberInput min={0} placeholder="0.00" value={mat.meters} onChange={n => updateMaterial(idx, 'meters', n)} className="h-8 text-sm" />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Remover material" onClick={() => removeMaterial(idx)} disabled={(editingOrder.materials_sent || []).length <= 1}><X className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  ))}
                  {(() => {
                    const totalMeters = (editingOrder.materials_sent || []).reduce((sum, m) => sum + (Number(m.meters) || 0), 0);
                    return totalMeters > 0 ? (
                      <div className="flex justify-end pr-12">
                        <span className="text-xs font-semibold text-primary bg-primary/10 px-3 py-1 rounded-full font-mono">Total: {totalMeters.toFixed(2)}m</span>
                      </div>
                    ) : null;
                  })()}
                </div>
                )}

                {/* Artisanal summary when stock ok (no production needed) */}
                {isArtisanal && artisanalCalc?.stockOk && (
                  <div className="sm:col-span-2 flex items-center gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded p-3 text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Estoque suficiente — nenhum material precisa ser enviado para o terceirizado.
                  </div>
                )}

                <div className="sm:col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Cobrança</span>
                  <span className="h-px flex-1 bg-border/70" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Data</Label>
                  <Input type="date" value={editingOrder.service_date || ''} onChange={e => setEditingOrder(p => ({ ...p, service_date: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Hora</Label>
                  <Input type="time" value={editingOrder.service_time || ''} onChange={e => setEditingOrder(p => ({ ...p, service_time: e.target.value }))} className="h-9" />
                </div>
                {/* Quantidade × Valor por par = Total auto. Fix do bug em que o
                    input setava total_value = unit_price sem multiplicar pela qty.
                    Artesanal continua override via laborCost da receita. */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Quantidade (pares) {isArtisanal && <span className="text-muted-foreground/70 font-normal">(não aplicável)</span>}
                  </Label>
                  <NumberInput
                    min={1}
                    decimals={0}
                    value={editingOrder.quantity ?? 1}
                    disabled={isArtisanal}
                    onChange={n => setEditingOrder(p => ({ ...p, quantity: Math.max(1, Math.floor(n)) }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {isArtisanal ? 'Valor Total (R$)' : 'Valor por par (R$)'}
                    {isArtisanal && artisanalCalc && <span className="text-primary font-normal"> (calculado pela receita)</span>}
                  </Label>
                  <NumberInput
                    min={0}
                    value={editingOrder.unit_price ?? ''}
                    onChange={n => setEditingOrder(p => ({ ...p, unit_price: n }))}
                    className="h-9"
                  />
                </div>
                <div className="sm:col-span-2 flex items-end justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wide text-foreground">Total</span>
                    {!isArtisanal && (
                      <span className="mt-0.5 block">
                        = {(editingOrder.quantity || 1).toLocaleString('pt-BR')} × {formatCurrency(editingOrder.unit_price || 0)}
                      </span>
                    )}
                  </div>
                  <p className="display text-2xl leading-none tabular-nums text-foreground">
                    {formatCurrency(
                      isArtisanal
                        ? (editingOrder.total_value || editingOrder.unit_price || 0)
                        : ((editingOrder.quantity || 1) * (editingOrder.unit_price || 0))
                    )}
                  </p>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Status &amp; Observações</span>
                  <span className="h-px flex-1 bg-border/70" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                  <Select value={editingOrder.status || 'Pendente'} onValueChange={v => setEditingOrder(p => ({ ...p, status: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pendente">Pendente</SelectItem>
                      <SelectItem value="Em Andamento">Enviada</SelectItem>
                      {/* "Concluído" só p/ artesanal (valor fixo). OS por par conclui
                          pelo botão "Entregue" (registra pares bons/defeito) pra a
                          conta a pagar não sair pelo valor cheio. */}
                      {(isArtisanal || editingOrder.status === 'Concluído') && (
                        <SelectItem value="Concluído">Recebida</SelectItem>
                      )}
                      <SelectItem value="Cancelado">Cancelada</SelectItem>
                    </SelectContent>
                  </Select>
                  {!isArtisanal && editingOrder.status !== 'Concluído' && (
                    <p className="text-[11px] text-muted-foreground">
                      Para concluir, use o botão <span className="font-medium">Entregue</span> na lista — ele registra os pares bons/defeito e calcula o pagamento correto.
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
                  <Textarea value={editingOrder.notes || ''} onChange={e => setEditingOrder(p => ({ ...p, notes: e.target.value }))} rows={2} className="resize-none" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="foto" className="mt-3">
              {/* placeholder marker */}
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Anexe a foto da OS assinada pelo prestador.</p>
                {editingOrder.signed_photo_url ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border overflow-hidden">
                      <img src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/service-orders/${editingOrder.signed_photo_url}`} alt="OS Assinada" className="w-full max-h-[400px] object-contain bg-muted/30" />
                    </div>
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setEditingOrder(p => ({ ...p, signed_photo_url: null }))}><X className="h-3 w-3" /> Remover</Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors bg-muted/10">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Clique para enviar a foto</span>
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={async e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
                      if (file.size > 5 * 1024 * 1024) { toast.error('A foto deve ter no máximo 5MB.'); return; }
                      setUploadingPhoto(true);
                      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
                      const fileName = `os-${editingOrder.id || Date.now()}-${Date.now()}.${safeExt}`;
                      const { error } = await supabase.storage.from('service-orders').upload(fileName, file, { upsert: true });
                      if (error) toast.error('Erro ao enviar foto: ' + error.message);
                      else { setEditingOrder(p => ({ ...p, signed_photo_url: fileName })); toast.success('Foto enviada!'); }
                      setUploadingPhoto(false);
                    }} />
                    {uploadingPhoto && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </label>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {!manualOsValid && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                Para salvar, faltam:
                <ul className="mt-0.5 list-disc pl-4">
                  {!editingOrder.contractor_id && <li>selecionar o prestador</li>}
                  {!isArtisanal && !editingOrder.target_sector && <li>selecionar o setor</li>}
                  {!isArtisanal && !(Number(editingOrder.unit_price) > 0) && <li>informar o valor por par (maior que zero)</li>}
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
            <Button variant="outline" onClick={() => setOrderDialog(false)} className="h-9">Cancelar</Button>
            <Button className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => {
              const contractor = contractors.find(c => c.id === editingOrder.contractor_id);
              const so = (saleOrders as any[]).find(s => s.id === editingOrder.sale_order_id);
              const validMats = (editingOrder.materials_sent || []).filter(m => m.material?.trim());
              const qtyVal = Number(editingOrder.quantity || 1);
              const unitVal = Number(editingOrder.unit_price || 0);
              printServiceOrderRemessa(
                {
                  order_number: isEditing ? (orders.find(o => o.id === editingOrder.id)?.order_number || 'NOVA') : 'NOVA',
                  target_sector: editingOrder.target_sector || null,
                  description: editingOrder.description || '',
                  service_date: editingOrder.service_date || format(new Date(), 'yyyy-MM-dd'),
                  service_time: editingOrder.service_time || '',
                  quantity: qtyVal,
                  unit_price: isArtisanal ? 0 : unitVal,
                  total_value: isArtisanal ? Number(editingOrder.total_value || editingOrder.unit_price || 0) : qtyVal * unitVal,
                  notes: editingOrder.notes || '',
                  materials_sent: validMats,
                  sale_order_number: so?.order_number || null,
                  client_order_number: so?.client_order_number || null,
                  client_name: so?.client_name || null,
                },
                contractor ? {
                  name: contractor.name, trade_name: (contractor as any).trade_name,
                  cnpj_cpf: contractor.cnpj_cpf, phone: contractor.phone, payment_days: contractor.payment_days,
                } : undefined,
                { items: osSelItems },
              );
            }}><Printer className="h-4 w-4" /> Gerar PDF</Button>
            <Button onClick={handleSaveOrder} disabled={!manualOsValid || createOrder.isPending || updateOrder.isPending} className="h-9">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão de OS */}
      <AlertDialog open={!!deleteOsTarget} onOpenChange={(open) => { if (!open) setDeleteOsTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a OS {deleteOsTarget?.order_number}?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteOsTarget) deleteOrder.mutate(deleteOsTarget.id); setDeleteOsTarget(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overlays de fluxo da OS — precisam ficar FORA do Dialog da OS: o Radix
          desmonta o conteúdo do Dialog quando open=false, e os botões
          "Enviar"/"Entregue" dos cards da lista abrem estes dialogs com o
          dialog de OS fechado. */}
      <ServiceOrderReturnDialog
        open={!!returnDialogOs}
        onOpenChange={(o) => { if (!o) setReturnDialogOs(null); }}
        serviceOrder={returnDialogOs ? {
          id: returnDialogOs.id,
          order_number: returnDialogOs.order_number,
          quantity: returnDialogOs.quantity,
          description: returnDialogOs.description,
          contractorName: returnDialogOs.contractors?.name ?? null,
          dispatchTracked: (returnDialogOs as any).dispatch_tracked ?? false,
          contractorId: returnDialogOs.contractor_id ?? null,
        } : null}
        onSaved={handleReturnSaved}
      />

      <ServiceOrderDispatchDialog
        open={!!dispatchDialogOs}
        onOpenChange={(o) => { if (!o) setDispatchDialogOs(null); }}
        serviceOrder={dispatchDialogOs ? {
          id: dispatchDialogOs.id,
          order_number: dispatchDialogOs.order_number,
          quantity: dispatchDialogOs.quantity,
          description: dispatchDialogOs.description,
          contractorName: dispatchDialogOs.contractors?.name ?? null,
          contractorId: dispatchDialogOs.contractor_id ?? null,
        } : null}
        onReceive={() => { const o = dispatchDialogOs; if (o) openReceiveDialog(o); }}
      />

      <ContractorHistoryDialog
        contractorId={historyContractor?.id || null}
        contractorName={historyContractor ? (historyContractor.trade_name || historyContractor.name) : null}
        open={!!historyContractor}
        onOpenChange={(open) => { if (!open) setHistoryContractor(null); }}
      />

      <ContractorRatesDialog
        open={!!ratesContractor}
        onOpenChange={(open) => { if (!open) setRatesContractor(null); }}
        contractor={ratesContractor ? { id: ratesContractor.id, name: ratesContractor.trade_name || ratesContractor.name } : null}
      />

      <ReceivePiecesDialog
        open={receiveDialogOpen}
        onOpenChange={setReceiveDialogOpen}
        serviceOrder={receiveTarget ? {
          id: receiveTarget.id,
          order_number: receiveTarget.order_number,
          target_sector: receiveTarget.target_sector ?? null,
          quantity: receiveTarget.quantity,
          quoted_deadline: receiveTarget.quoted_deadline ?? null,
          bottleneck_week: receiveTarget.bottleneck_week ?? null,
          order_id: receiveTarget.order_id ?? null,
          description: receiveTarget.description,
          notes: receiveTarget.notes,
          contractors: receiveTarget.contractors ? { name: receiveTarget.contractors.name } : null,
        } : null}
      />

      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.selectedIds.size === 1 ? 'prestador' : 'prestadores'}
        actions={[
          {
            label: 'Excluir',
            variant: 'destructive',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteContractors,
          },
        ]}
      />

      {/* Rodapé fixo de seleção de OS: totais somados + relatório PDF + ações
          da triagem P0.3 (receber em lote / arquivar). */}
      <SelectionTotalsBar
        count={selectedOsIds.size}
        total={osSelectionSummary.total}
        paid={osSelectionSummary.paid}
        pending={osSelectionSummary.pending}
        onClear={() => setSelectedOsIds(new Set())}
        onGeneratePdf={() => handleGenerateOsPdf('selecao')}
        generating={osPdfBusy}
        extraActions={
          <>
            {bulkReceivable.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={bulkReceive.isPending}>
                    {bulkReceive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Receber {bulkReceivable.length}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Receber {bulkReceivable.length} OS por completo?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cada OS será marcada como Entregue e <strong>gera conta a pagar</strong> pelos
                      pares bons. OS de prestador interno (FÁBRICA) concluem sem gerar conta a pagar.
                      Retorno com perda/defeito deve usar o recebimento individual da OS.
                      {bulkReceivable.some(o => o.dispatch_tracked) && ' OS divididas entre prestadores serão puladas.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  {/* O que será efetivamente cobrado, por prestador. */}
                  {bulkReceivePreview.rows.length > 0 && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                      <div className="mb-1.5 font-semibold uppercase tracking-wider text-muted-foreground text-[10px]">
                        Será lançado
                      </div>
                      <div className="flex flex-col gap-1">
                        {bulkReceivePreview.rows.map(r => (
                          <div key={r.name} className="flex items-baseline justify-between gap-3">
                            <span className="truncate">{r.name} <span className="text-muted-foreground">· {r.os} OS · {r.pairs} pares</span></span>
                            <span className="font-mono font-semibold tabular-nums">{formatCurrency(r.value)}</span>
                          </div>
                        ))}
                        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-1 font-semibold">
                          <span>Total</span>
                          <span className="font-mono tabular-nums">{formatCurrency(bulkReceivePreview.total)}</span>
                        </div>
                      </div>
                      {bulkReceivePreview.skipped > 0 && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {bulkReceivePreview.skipped} OS serão puladas (divididas entre prestadores ou sem saldo na rua).
                        </p>
                      )}
                    </div>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                      bulkReceive.mutate(bulkReceivable.map(o => ({
                        id: o.id, order_number: o.order_number, quantity: o.quantity, dispatch_tracked: o.dispatch_tracked,
                      })), { onSuccess: () => setSelectedOsIds(new Set()) });
                    }}>
                      Receber em lote
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={archiveOs.isPending}>
                  <Archive className="h-3.5 w-3.5" /> Arquivar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Arquivar {selectedOsIds.size} OS?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Elas somem das listagens (o histórico é preservado e dá pra revê-las com
                    "Mostrar arquivadas"). Use pra encerrar a triagem de OS antigas que não
                    representam serviço real em aberto.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => {
                    archiveOs.mutate([...selectedOsIds], { onSuccess: () => setSelectedOsIds(new Set()) });
                  }}>
                    Arquivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />
    </>
  );

  return (
    <>
      {embedded ? inner : <AppLayout>{inner}</AppLayout>}
      {overlays}
      <GenerateServiceOrdersWizard
        open={genOsOpen}
        onOpenChange={setGenOsOpen}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        }}
      />
    </>
  );
}
