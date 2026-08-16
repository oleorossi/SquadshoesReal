import AppLayout from "@/components/layout/AppLayout";
import ServiceOrderReturnDialog from '@/components/contractors/ServiceOrderReturnDialog';
import ServiceOrderDispatchDialog from '@/components/contractors/ServiceOrderDispatchDialog';
import { GenerateServiceOrdersWizard } from '@/components/contractors/GenerateServiceOrdersWizard';
import { ServiceOrderGenerationGapsAlert } from '@/components/contractors/ServiceOrderGenerationGapsAlert';
import { ServiceOrderTimeline } from '@/components/contractors/ServiceOrderTimeline';
import { printServiceOrderReceipt, expandBaseGrade } from '@/lib/printServiceOrderReceipt';
import { thumbUrl } from '@/lib/imageThumb';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useCan } from '@/hooks/useAccessControl';
import { CircleNotch as Loader2, Plus, MagnifyingGlass as Search, PencilSimple as Pencil, Trash as Trash2, FileText, Handshake, Printer, X, Check, CaretUpDown as ChevronsUpDown, Upload, CheckCircle as CheckCircle2, Circle, ClipboardText as ClipboardList, CurrencyDollar as DollarSign, Clock, Users, Package, Flask as FlaskConical, Scissors, Warning as AlertTriangle, WarningCircle as AlertCircle, CalendarBlank as Calendar, LockKey as Lock, ClockCounterClockwise, ChartLineUp, FileArrowDown as FileDown, Funnel, Truck, DotsThreeVertical as MoreVertical, Archive, List as ListIcon, SquaresFour } from '@phosphor-icons/react';
import { SECTOR_LABEL, SectorKey } from '@/hooks/useSectorBottlenecks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
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
  isCanonicalStrapServiceOrder,
} from '@/hooks/useContractors';
import { SERVICE_ORDER_SECTORS } from '@/lib/serviceOrderSectors';
import { opNumberByPvItem, opNumbersForServiceOrder, type OpRefWithReference } from '@/lib/serviceOrderOps';
import { OsPaymentBadge, OsBalanceLine, OsWorkflowRail } from '@/components/contractors/OsStatusIndicators';
import { resolveServiceOrderWorkflow } from '@/lib/serviceOrderWorkflow';
import {
  OS_DONE_STATUSES, OS_CANCELLED_STATUSES, OS_PENDING_STATUSES, OS_STATUS,
  isOsDone, isOsCancelled, isOsActive, osStatusLabel, osStatusBadgeVariant,
  osStatusColor, osStatusDot,
  normalizeOsStatus,
} from '@/lib/osStatusMachine';
import { useProducts, getBaseName } from '@/hooks/useProducts';
import { ContractorHistoryDialog } from '@/components/contractors/ContractorHistoryDialog';
import { ContractorRatesDialog } from '@/components/contractors/ContractorRatesDialog';
import { OutsourcingPlanningTab } from '@/components/contractors/OutsourcingPlanningTab';
import { ContractorOperationsOverview } from '@/components/contractors/ContractorOperationsOverview';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useAllGroupColors } from '@/hooks/useGroupColors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { toast } from 'sonner';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { SelectionTotalsBar } from '@/components/ui/selection-totals-bar';
import { generateCostReportPdf } from '@/lib/costReportPdf';
import { type CostReportRow, type DateBasis, summarizeRows, rowDateForBasis, inDateRange } from '@/lib/costReport';
import { ContractorFormDialog, emptyContractor } from '@/components/contractors/ContractorFormDialog';

const emptyMaterial: MaterialSent = { material: '', color: '', meters: 0 };
type SaleOrderLookup = Pick<Tables<'sale_orders'>, 'id' | 'order_number' | 'client_order_number' | 'client_name'>;
const emptyOrder: Partial<ServiceOrder> & { materials_sent: MaterialSent[] } = {
  contractor_id: '', description: '', service_date: format(new Date(), 'yyyy-MM-dd'), service_time: '',
  quantity: 1, unit_price: 0, total_value: 0, status: 'Pendente', notes: '',
  material_name: '', material_meters: 0, material_color: '',
  materials_sent: [{ ...emptyMaterial }],
  sale_order_id: null,
  target_sector: null,     // setor terceirizado (obrigatório no form manual)
  is_avulsa: true,         // toda OS criada pelo form manual é avulsa
  dispatch_tracked: true,  // OS nova só entra "na rua" depois de uma remessa explícita
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

/** Colunas de `sale_order_items` que o papel da OS precisa (grade + foto). */
const OS_PV_ITEM_COLUMNS = 'id, color, quantity, grade, reference_id, technical_sheets(code, name, image_url)';

interface PvItemRow {
  id: string;
  color?: string | null;
  quantity?: number | null;
  grade?: unknown;
  reference_id?: string | null;
  technical_sheets?: { code?: string | null; name?: string | null; image_url?: string | null } | null;
}

/**
 * Linhas de `sale_order_items` → itens do papel da OS. Compartilhado entre o
 * seletor do dialog e a impressão pelo menu da lista, pra que os dois papéis
 * saiam idênticos (era só o dialog que montava isso).
 */
function mapPvItemsForReceipt(rows: PvItemRow[]) {
  return (rows || []).map((it) => {
    const ts = it.technical_sheets;
    const code = ts?.name || ts?.code || '';
    const pairs = Number(it.quantity) || 0;
    return {
      id: it.id as string,
      label: [code, it.color || '—'].filter(Boolean).join(' · '),
      pairs,
      ref_code: code || null,
      ref_name: ts?.name || null,
      color: it.color || null,
      // `grade` do item é a grade BASE (1 ficha, ~12 pares) — expandir pro
      // total do item antes de imprimir.
      size_breakdown: expandBaseGrade(it.grade as Record<string, number> | null, pairs),
      // 80px de exibição (quadro de 20mm); o dpr 3 default já entrega
      // nitidez pra A4 a 300dpi sem inflar o arquivo.
      photo_url: ts?.image_url ? thumbUrl(ts.image_url, 80) || null : null,
    };
  }).filter((i) => i.pairs > 0);
}

export default function Contractors({ embedded = false, activeTab, onActiveTabChange, openCreateOS, onCreateOSConsumed }: { embedded?: boolean; activeTab?: string; onActiveTabChange?: (v: string) => void; openCreateOS?: { contractorId?: string } | null; onCreateOSConsumed?: () => void } = {}) {
  const navigate = useNavigate();
  const { data: contractors = [], isLoading: loadingC } = useContractors();
  const { data: orders = [], isLoading: loadingO } = useServiceOrders();
  const { data: osOverview } = useServiceOrderOverview(); // Map por service_order_id: pagamento (AP) + saldo de recebimento
  const { data: products = [] } = useProducts();
  const { data: saleOrders = [] } = useSaleOrders();
  const createContractor = useCreateContractor();
  const updateContractor = useUpdateContractor();
  const deleteContractor = useDeleteContractor();
  const createOrder = useCreateServiceOrder();
  const updateOrder = useUpdateServiceOrder();
  const deleteOrder = useDeleteServiceOrder();
  const bulkReceive = useBulkReceiveServiceOrders();
  const archiveOs = useArchiveServiceOrders();
  const queryClient = useQueryClient();

  const [genOsOpen, setGenOsOpen] = useState(false);
  // Gates de ação da área Terceirizados (criar OS / excluir OS). Admin e
  // usuários sem permissão granular sempre passam.
  const osPerm = useCan('/terceirizados');
  // Buscas independentes: um termo digitado em OS não deve esvaziar a lista de
  // prestadores quando o usuário troca de aba (e vice-versa).
  const [orderSearch, setOrderSearch] = useState('');
  const [contractorSearch, setContractorSearch] = useState('');
  // Aceita ?q= na URL — a busca global navega pra cá com ?q=<termo>, que
  // sobrepõe o valor persistido. REATIVO (deps no param, não só mount):
  // selecionar outra OS no ⌘K estando já em /terceirizados não remonta a
  // página (AppLayout keia só por pathname).
  const [urlSearchParams] = useSearchParams();
  const urlQ = urlSearchParams.get('q') || '';
  useEffect(() => {
    if (urlQ) setOrderSearch(urlQ);

  }, [urlQ]);
  // Chave v2: o filtro antigo guardava status cru ('pending_quote' etc.) que não
  // existe mais nos chips; default novo = 'active' (Pendente + Em Processamento).
  const [statusFilter, setStatusFilter] = usePersistedState<string>('contractors-status-v2', 'active');
  // Modo de exibição das OS: 'list' (tabela densa, melhor pra varrer muitas OS)
  // ou 'cards'. Persistido por usuário. Default 'list' a pedido (melhor visão).
  const [osView, setOsView] = usePersistedState<'list' | 'cards'>('contractors-os-view', 'list');
  const [osSort, setOsSort] = usePersistedState<'urgency' | 'recent' | 'deadline'>('contractors-os-sort', 'urgency');
  const [standaloneTab, setStandaloneTab] = useState('orders');
  const currentTab = embedded ? activeTab ?? 'orders' : standaloneTab;
  const handleTabChange = (value: string) => {
    if (embedded) onActiveTabChange?.(value);
    else setStandaloneTab(value);
  };

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
  const [editingContractor, setEditingContractor] = useState<Partial<Contractor>>(emptyContractor);
  const [editingOrder, setEditingOrder] = useState<Partial<ServiceOrder> & { materials_sent: MaterialSent[] }>(emptyOrder);
  const [isEditing, setIsEditing] = useState(false);
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
  // ── Rich color/material sources ──
  const { data: allGroupColors = [] } = useAllGroupColors();
  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    // inclui is_color_agnostic pra não colidir com a MESMA queryKey no PV
    // (SaleOrderItemForm), cujo guard de cor lê essa flag — selects divergentes
    // sob a mesma key faziam o campo sumir do cache conforme a navegação.
    queryFn: async () => { const { data, error } = await supabase.from('product_groups').select('id, name, colors, is_color_agnostic'); if (error) throw error; return data || []; },
    staleTime: 0, gcTime: 30_000,
  });
  const { data: groupSupplierMaterials = [] } = useQuery({
    queryKey: ['group_supplier_materials_for_colors'],
    queryFn: async () => { const { data, error } = await supabase.from('group_supplier_materials').select('group_id, color, material_name').eq('active', true); if (error) throw error; return data || []; },
    staleTime: 0, gcTime: 30_000,
  });

  // Itens do PV vinculado à OS aberta (ref · cor + pares). Alimenta o seletor de
  // itens do dialog e a guia de remessa (cartões por item).
  const editingPvId = editingOrder.sale_order_id
    || editingOrder.source_sale_order_id
    || editingOrder.linked_sale_order_ids?.[0]
    || null;
  const { data: osPvItemsRaw = [] } = useQuery({
    queryKey: ['os_dialog_pv_items', editingPvId],
    enabled: orderDialog && !!editingPvId,
    queryFn: async () => {
      // `grade` e `image_url` entram pro papel da OS: o canhoto confere por
      // NUMERAÇÃO e a foto identifica o modelo na bancada. Sem eles o papel
      // ainda sai, mas só com o total (ver printServiceOrderReceipt).
      const { data, error } = await supabase
        .from('sale_order_items')
        .select(OS_PV_ITEM_COLUMNS)
        .eq('sale_order_id', editingPvId as string);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
  const osPvItems = useMemo(() => mapPvItemsForReceipt(osPvItemsRaw as any[]), [osPvItemsRaw]);
  const osSelItems = useMemo(() => osPvItems.filter((i) => osPvItemSel.has(i.id)), [osPvItems, osPvItemSel]);
  const osSelPares = osSelItems.reduce((s, i) => s + i.pairs, 0);

  // ── OPs dos pedidos ligados às OS ──────────────────────────────────────────
  // Alimentam o nº de ordem de produção na lista, na busca, no papel impresso e
  // no seletor de itens do dialog. Derivadas SEMPRE na leitura (nunca gravadas
  // na OS), pra que uma OS criada antes de "Gerar OPs" ganhe o número sozinha.
  const linkedSaleOrderIdsOf = useCallback((o: ServiceOrder): string[] => Array.from(new Set([
    o.sale_order_id,
    o.source_sale_order_id,
    ...(o.linked_sale_order_ids || []),
  ].filter(Boolean) as string[])), []);
  const osSaleOrderIds = useMemo(
    () => Array.from(new Set(orders.flatMap(linkedSaleOrderIdsOf))).sort(),
    [orders, linkedSaleOrderIdsOf],
  );
  const { data: opsForOs = [] } = useQuery({
    queryKey: ['ops_for_service_orders', osSaleOrderIds],
    enabled: osSaleOrderIds.length > 0,
    queryFn: async () => {
      // `color` + referência vêm junto: a própria OP sabe de qual modelo/cor é,
      // então o rótulo "OP-00231 · I901 · OFF WHITE" da lista sai daqui, sem
      // uma segunda consulta a sale_order_items.
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, sale_order_item_id, sale_order_id, status, color, technical_sheets(code, name)')
        .in('sale_order_id', osSaleOrderIds);
      if (error) throw error;
      return (data || []) as unknown as OpRefWithReference[];
    },
    staleTime: 60_000,
  });
  // Pré-computa OS → nºs de OP e rótulo UMA vez. A busca roda a cada tecla sobre
  // ~380 OS; resolver por OS ali dentro varreria a lista de OPs a cada linha.
  const opInfoByOsId = useMemo(() => {
    const opsByPv = new Map<string, OpRefWithReference[]>();
    const byNumber = new Map<string, OpRefWithReference>();
    for (const op of opsForOs) {
      if (op?.order_number) byNumber.set(op.order_number, op);
      if (!op?.sale_order_id) continue;
      const list = opsByPv.get(op.sale_order_id);
      list ? list.push(op) : opsByPv.set(op.sale_order_id, [op]);
    }

    const out = new Map<string, { numbers: string[]; label: string | null }>();
    for (const o of orders) {
      const linkedIds = linkedSaleOrderIdsOf(o);
      const pvOps = linkedIds.flatMap(id => opsByPv.get(id) || []);
      // Sem seleção gravada (OS antiga) → todas as OPs do PV.
      const numbers = opNumbersForServiceOrder(pvOps, o.selected_sale_order_item_ids ?? null);
      const label = numbers.length > 0
        ? numbers.map((n) => {
            const op = byNumber.get(n);
            const ref = op?.technical_sheets?.name || op?.technical_sheets?.code || '';
            return [n, ref, op?.color].filter(Boolean).join(' · ');
          }).join(' — ')
        : null;
      out.set(o.id, { numbers, label });
    }
    return out;
  }, [orders, opsForOs, linkedSaleOrderIdsOf]);
  const opNumbersOf = useCallback(
    (o: Pick<ServiceOrder, 'id'> | null | undefined): string[] => (o?.id ? opInfoByOsId.get(o.id)?.numbers || [] : []),
    [opInfoByOsId],
  );
  /**
   * Linha descritiva da OS na lista. O que VOCÊ escreveu vence sempre; só quando
   * não há descrição (padrão das OS novas desde 02/08/2026) cai no derivado
   * "OP-00231 · I901 · OFF WHITE".
   */
  const osListLine = useCallback(
    (o: ServiceOrder): string => (o?.description?.trim() || o?.artisanal_output_name?.trim()
      || (o?.id ? opInfoByOsId.get(o.id)?.label : null) || '—'),
    [opInfoByOsId],
  );
  const osOpByItem = useMemo(() => opNumberByPvItem(opsForOs), [opsForOs]);

  /**
   * Itens do papel da OS, buscados na hora de imprimir pelo menu da lista.
   * Devolve `[]` quando a OS não tem seleção gravada — OS anterior à migration
   * 20261103120000. Nesse caso o papel segue exatamente como sempre foi: curto,
   * caindo no texto da descrição que ela já tem. Imprimir "todos os itens do PV"
   * ali seria pior que nada: sairiam 3 cores num papel cujo total diz 180 pares.
   */
  const fetchReceiptItemsForOs = useCallback(async (o: ServiceOrder) => {
    const ids = o?.selected_sale_order_item_ids;
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const { data, error } = await supabase
      .from('sale_order_items')
      .select(OS_PV_ITEM_COLUMNS)
      .in('id', ids);
    if (error) { toast.error('Não foi possível carregar os itens do pedido para o papel.'); return []; }
    return mapPvItemsForReceipt(data as unknown as PvItemRow[]);
  }, []);

  // Ao carregar os itens do PV: pré-marca a seleção GRAVADA na OS; sem registro
  // (OS anterior à migration 20261103120000 ou criada fora do atalho do PV),
  // cai em todos — o comportamento de sempre. Isso fecha um furo real: antes
  // remarcava todos incondicionalmente, então abrir a OS só pra corrigir o
  // prazo e salvar trocava silenciosamente o escopo (e as OPs) da OS.
  // Só sobrescreve a Quantidade quando o usuário TROCA o PV ativamente (não na
  // abertura de uma OS existente — aí preserva a quantidade já gravada).
  useEffect(() => {
    if (!orderDialog) return;
    const pv = editingPvId;
    if (pv && osPvItems.length > 0) {
      const saved = (editingOrder as any).selected_sale_order_item_ids as string[] | null | undefined;
      const known = new Set(osPvItems.map((i) => i.id));
      const restored = Array.isArray(saved) ? saved.filter((id) => known.has(id)) : null;
      setOsPvItemSel(new Set(restored ?? osPvItems.map((i) => i.id)));
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
  }, [orderDialog, editingPvId, osPvItems]);

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
    const visibleOperationalOrders = orders.filter(o => !o.archived_at);
    // Normalizar, não comparar texto literal: uma OS fechada como 'received'
    // (o vocabulário do fluxo de gargalos) não entrava em concluídas E ainda
    // somava no valor total — os KPIs do topo divergiam dos chips logo abaixo,
    // na mesma tela.
    const pendingOrders = visibleOperationalOrders.filter(o => normalizeOsStatus(o.status) === OS_STATUS.PENDENTE).length;
    const inProgressOrders = visibleOperationalOrders.filter(o => normalizeOsStatus(o.status) === OS_STATUS.EM_ANDAMENTO).length;
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
      searchMatchesAllTerms(contractorSearch, c.name, c.trade_name, c.service_type, c.cnpj_cpf, c.phone, c.city, c.state));
  }, [contractors, contractorSearch]);

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
      // Pedido e OP entram na busca: com a descrição nascendo vazia (02/08/2026),
      // procurar por "I901" deixou de achar OS — o que repõe isso são códigos
      // estáveis (PV-00151, OP-00231), que não dependem de alguém ter digitado.
      const linkedOrders = linkedSaleOrderIdsOf(o)
        .map(id => (saleOrders as SaleOrderLookup[]).find(s => s.id === id))
        .filter((so): so is SaleOrderLookup => so !== undefined);
      return searchMatchesAllTerms(
        orderSearch,
        o.description, o.order_number, o.contractors?.name,
        o.receipt_number, o.artisanal_output_name,
        ...linkedOrders.flatMap(so => [so.order_number, so.client_order_number]),
        ...opNumbersOf(o),
      );
    });
  }, [orders, orderSearch, showArchivedOs, saleOrders, opNumbersOf, linkedSaleOrderIdsOf]);

  // ── Operacional "Na rua" (fundido da antiga aba, 2026-06-30) ──────────────
  // "Na rua" = OS com pares ainda em campo (overview.qty_in_field > 0).
  // "Atrasados" = na rua E com prazo (quoted_deadline) vencido.
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const osInField = useCallback(
    (o: ServiceOrder) => !o.archived_at && isOsActive(o.status) && Number(osOverview?.get(o.id)?.qty_in_field ?? 0) > 0,
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
      if (o.archived_at || !isOsActive(o.status)) continue;
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
      if (ov?.has_payable && ov.payment_status !== 'paid') {
        count++;
        // A conta pode ser parcial (retornos por tranche). O valor da OS inteira
        // inflava o KPI depois do primeiro recebimento.
        value += Number(ov.payable_open_amount ?? ov.payable_amount ?? o.total_value ?? 0);
      }
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

  // Uma ação principal por estado. As alternativas continuam no menu, mas a
  // linha deixa de apresentar quatro conclusões concorrentes ao mesmo tempo.
  const renderOsActions = (o: ServiceOrder) => {
    if (isCanonicalStrapServiceOrder(o)) {
      return (
        <Button size="sm" variant="outline" className="h-9 gap-1 px-2.5 text-xs" onClick={() => navigate('/tiras-artesanais?tab=producao&origin=terceirizados')}>
          <FlaskConical className="h-3.5 w-3.5" /> Abrir no Hub de Tiras
        </Button>
      );
    }
    const active = isOsActive(o.status);
    const ov = osOverview?.get(o.id);
    const workflow = resolveServiceOrderWorkflow({
      status: o.status,
      dispatchTracked: o.dispatch_tracked,
      quantity: o.quantity,
      qtyDispatched: ov?.qty_dispatched,
      qtyInField: ov?.qty_in_field,
      qtyToDispatch: ov?.qty_to_dispatch,
      qtyReturnedGood: ov?.qty_returned_good,
      qtyReturnedDefect: ov?.qty_returned_defect,
      qtyLoss: ov?.qty_loss,
      hasPayable: ov?.has_payable,
      isPaid: ov?.is_paid,
    });

    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        {workflow.primaryAction === 'conference' && (
          <Button size="sm" variant="outline" className="h-9 gap-1 px-2.5 text-xs" onClick={() => openCanonicalOrReturn(o)}>
            <CheckCircle2 className="h-3 w-3" /> Conferir retorno
          </Button>
        )}
        {workflow.primaryAction === 'dispatch' && (
          <Button size="sm" variant="outline" className="h-9 gap-1 px-2.5 text-xs" onClick={() => openCanonicalOrDispatch(o)}>
            <Truck className="h-3 w-3" /> Enviar{workflow.qtyDispatched > 0 ? ' saldo' : ''}
          </Button>
        )}
        {workflow.primaryAction === 'finance' && (
          <Button size="sm" variant="outline" className="h-9 gap-1 px-2.5 text-xs" onClick={() => navigate(`/finance?tab=payable&q=${encodeURIComponent(o.order_number)}`)}>
            <DollarSign className="h-3 w-3" /> Ver financeiro
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Mais ações da OS ${o.order_number}`}><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {workflow.canConference && workflow.primaryAction !== 'conference' && (
              <DropdownMenuItem onClick={() => openCanonicalOrReturn(o)}><CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Conferir retorno</DropdownMenuItem>
            )}
            {workflow.canDispatch && workflow.primaryAction !== 'dispatch' && (
              <DropdownMenuItem onClick={() => openCanonicalOrDispatch(o)}><Truck className="mr-2 h-3.5 w-3.5" /> Enviar saldo</DropdownMenuItem>
            )}
            {workflow.canOpenFinance && workflow.primaryAction !== 'finance' && (
              <DropdownMenuItem onClick={() => navigate(`/finance?tab=payable&q=${encodeURIComponent(o.order_number)}`)}><DollarSign className="mr-2 h-3.5 w-3.5" /> Ver no financeiro</DropdownMenuItem>
            )}
            {active && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => openEditOrder(o)}><Pencil className="mr-2 h-3.5 w-3.5" /> Editar</DropdownMenuItem>
            {/* Impressão do papel da OS. O guard antigo era `o.receipt_number &&`,
                mas 385 das 386 OS têm essa coluna como string VAZIA (falsy) —
                o item de menu nunca aparecia. Quem identifica a OS é o
                order_number, que sempre existe. */}
            <DropdownMenuItem onClick={async () => {
              const so = (saleOrders as SaleOrderLookup[]).find(s => linkedSaleOrderIdsOf(o).includes(s.id));
              // Itens do papel: buscados sob demanda (o dialog só carrega os do
              // PV aberto). Só saem os que a OS realmente cobre — sem a seleção
              // gravada isso imprimiria as 3 cores do pedido com o total de
              // pares de uma. OS antiga (sem registro) segue no papel curto,
              // caindo no texto da descrição que ela já tem.
              const items = await fetchReceiptItemsForOs(o);
              printServiceOrderReceipt(
                {
                  order_number: o.order_number,
                  target_sector: o.target_sector || null,
                  description: o.description || '',
                  service_date: o.service_date || '',
                  quoted_deadline: o.quoted_deadline || null,
                  quantity: Number(o.quantity || 0),
                  notes: o.notes || '',
                  materials_sent: getMaterials(o),
                  sale_order_number: so?.order_number || null,
                  client_order_number: so?.client_order_number || null,
                  op_numbers: opNumbersOf(o),
                  client_name: so?.client_name || null,
                },
                contractors.find(c => c.id === o.contractor_id),
                { items },
              );
            }}>
              <Printer className="mr-2 h-3.5 w-3.5" /> Imprimir OS
            </DropdownMenuItem>
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

  const renderMobileOsRow = (o: ServiceOrder) => {
    const selected = selectedOsIds.has(o.id);
    const linkedPvId = linkedSaleOrderIdsOf(o)[0] || null;
    const so = linkedPvId ? (saleOrders as SaleOrderLookup[]).find(s => s.id === linkedPvId) : null;
    const noValue = Number(o.total_value) === 0 && isOsActive(o.status);
    const checkboxId = `mobile-os-${o.id}`;

    return (
      <article key={o.id} className={cn('overflow-hidden rounded-lg border bg-card', selected && 'border-primary/50 ring-1 ring-primary/20')}>
        <div className="flex items-start gap-1 p-2.5">
          <label htmlFor={checkboxId} className={cn('flex h-11 w-10 shrink-0 items-center justify-center', isCanonicalStrapServiceOrder(o) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')} aria-label={`Selecionar OS ${o.order_number}`}>
            <Checkbox id={checkboxId} checked={selected} disabled={isCanonicalStrapServiceOrder(o)} onCheckedChange={() => toggleOsSelect(o.id)} />
          </label>
          <button
            type="button"
            onClick={() => openEditOrder(o)}
            className="min-w-0 flex-1 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Abrir OS ${o.order_number}`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-mono text-sm font-bold tracking-tight">{o.order_number}</span>
                <span className="block truncate text-sm font-semibold">{o.contractors?.name || 'Sem prestador'}</span>
              </span>
              <Badge variant="outline" className={cn('shrink-0 gap-1 text-[11px]', osStatusColor(o.status))}>
                <span className={cn('h-1.5 w-1.5 rounded-full', osStatusDot(o.status))} />
                {statusLabel(o.status)}
              </Badge>
            </span>
            <span className="mt-2 block line-clamp-2 text-xs text-muted-foreground">{osListLine(o)}</span>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {so && <span className="font-mono font-semibold text-primary">PV {so.order_number}</span>}
              <span>{renderDeadlineInline(o)}</span>
              <span className="ml-auto font-mono font-bold tabular-nums">
                {noValue ? 'A definir' : formatCurrency(Number(o.total_value))}
              </span>
            </span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <OsPaymentBadge ov={osOverview?.get(o.id)} osStatus={o.status} expectsPayable={Number(o.contractors?.payment_days ?? 30) < 999} />
            <OsBalanceLine ov={osOverview?.get(o.id)} />
          </div>
          {renderOsActions(o)}
        </div>
        <div className="border-t px-3 pb-2">
          <OsWorkflowRail order={o} ov={osOverview?.get(o.id)} />
        </div>
      </article>
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

  const orderedFilteredOrders = useMemo(() => {
    const result = [...filteredOrders];
    const timestamp = (o: ServiceOrder) => new Date(o.created_at || o.service_date || 0).getTime();
    if (osSort === 'recent') return result.sort((a, b) => timestamp(b) - timestamp(a));
    if (osSort === 'deadline') {
      return result.sort((a, b) => {
        const aDue = a.quoted_deadline || '9999-12-31';
        const bDue = b.quoted_deadline || '9999-12-31';
        return aDue.localeCompare(bDue) || timestamp(b) - timestamp(a);
      });
    }
    const rank = (o: ServiceOrder) => {
      if (osLate(o)) return 0;
      if (isOsActive(o.status) && o.quoted_deadline === todayISO) return 1;
      if (osInField(o)) return 2;
      if (osStale(o)) return 3;
      if (normalizeOsStatus(o.status) === OS_STATUS.PENDENTE) return 4;
      if (isOsActive(o.status)) return 5;
      return 6;
    };
    return result.sort((a, b) => rank(a) - rank(b) || timestamp(b) - timestamp(a));
  }, [filteredOrders, osSort, osLate, osInField, osStale, todayISO]);

  // Seleção PRESA AO FILTRO: derivar de `orders` deixava selecionada OS que o
  // filtro atual não mostra — e "Receber em lote" registra devolução e dispara
  // conta a pagar de verdade. Trocar de prestador/chip depois de selecionar
  // podia cobrar OS que o usuário não estava mais vendo.
  const selectedOrders = useMemo(
    () => filteredOrders.filter(o => selectedOsIds.has(o.id) && !isCanonicalStrapServiceOrder(o)),
    [filteredOrders, selectedOsIds],
  );
  const osSelectionSummary = useMemo(() => summarizeRows(selectedOrders.map(toOsCostRow)), [selectedOrders, toOsCostRow]);
  // Triagem P0.3: elegíveis pro recebimento total em lote (ativas, não arquivadas).

  const bulkReceivable = useMemo(
    () => selectedOrders.filter(o => isOsActive(o.status) && !o.archived_at),
    [selectedOrders],
  );
  const bulkReceivableLegacy = useMemo(
    () => bulkReceivable.filter(o => !o.dispatch_tracked),
    [bulkReceivable],
  );

  // Quebra por prestador do que o recebimento em lote vai efetivamente cobrar.
  // A confirmação descrevia o efeito ("gera conta a pagar") mas não mostrava
  // quanto nem pra quem — e a ação cria dinheiro de verdade.
  const bulkReceivePreview = useMemo(() => {
    const byContractor = new Map<string, { name: string; os: number; pairs: number; value: number }>();
    let skipped = 0;
    for (const o of bulkReceivableLegacy) {
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
  }, [bulkReceivableLegacy, osOverview]);
  const selectableOrders = filteredOrders.filter((order) => !isCanonicalStrapServiceOrder(order));
  const allOsSelected = selectableOrders.length > 0 && selectableOrders.every(o => selectedOsIds.has(o.id));
  const toggleSelectAllOs = useCallback(() => {
    setSelectedOsIds(prev => (selectableOrders.length > 0 && selectableOrders.every(o => prev.has(o.id))) ? new Set() : new Set(selectableOrders.map(o => o.id)));
  }, [selectableOrders]);

  const handleGenerateOsPdf = useCallback(async (scope: 'filtro' | 'selecao') => {
    const src = (scope === 'selecao' ? selectedOrders : filteredOrders)
      .filter((order) => !isCanonicalStrapServiceOrder(order));
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
  const openCanonicalOrReturn = useCallback((order: ServiceOrder) => {
    if (isCanonicalStrapServiceOrder(order)) {
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
      return;
    }
    setReturnDialogOs(order);
  }, [navigate]);
  const openCanonicalOrDispatch = useCallback((order: ServiceOrder) => {
    if (isCanonicalStrapServiceOrder(order)) {
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
      return;
    }
    setDispatchDialogOs(order);
  }, [navigate]);
  const handleReturnSaved = useCallback(async (info: { completed: boolean }) => {
    const o = returnDialogOs;
    if (!info.completed || !o) return;
    if (isCanonicalStrapServiceOrder(o)) {
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
    }
  }, [returnDialogOs, navigate]);

  // Dar baixa / reabrir um material da OS. Quando TODOS ficam baixados, a OS
  // fecha (status→Concluído) via claim atômico (.neq status) que evita
  // dupla-conta-a-pagar em clique duplo / abas concorrentes, e dispara a saída
  // de estoque artesanal 1×. Extraído do corpo da tabela pra reuso no card.
  const toggleMaterial = useCallback(async (o: ServiceOrder, index: number) => {
    if (isCanonicalStrapServiceOrder(o)) {
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
      return;
    }
    const mats = getMaterials(o);
    const updatedMats = mats.map((mat, mi) => mi === index ? { ...mat, completed: !mat.completed } : mat);
    const allDone = updatedMats.length > 0 && updatedMats.every(mat => mat.completed);
    if (allDone && o.status !== 'Concluído') {
      // OS por par (não-artesanal, valor por par): a conclusão TEM que passar pelo
      // diálogo de retorno pra capturar pares bons/defeito — senão a conta a pagar
      // sai pelo valor CHEIO (qtd × preço) ignorando perda (auditoria 2026-07-02).
      // Persiste o check dos materiais e abre o retorno; NÃO conclui direto aqui.
      if (!isCanonicalStrapServiceOrder(o) && Number(o.unit_price) > 0) {
        await supabase.from('service_orders').update({ materials_sent: updatedMats as any }).eq('id', o.id);
        queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        setReturnDialogOs({ ...o, materials_sent: updatedMats } as any);
        return;
      }
      // Valor fixo não-artesanal: mantém a conclusão direta.
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
    } else {
      updateOrder.mutate({ id: o.id, materials_sent: updatedMats } as any);
    }
  }, [updateOrder, queryClient, setReturnDialogOs, navigate]);


  // ── Bloco C: form manual disciplinado ──────────────────────────────────────
  // Tarifa vigente da contratada+setor → pré-preenche o preço (só quando vazio).
  const { data: sectorRate } = useContractorSectorRate(editingOrder.contractor_id, editingOrder.target_sector);
  useEffect(() => {
    if (sectorRate != null && sectorRate > 0 && !(Number(editingOrder.unit_price) > 0)) {
      setEditingOrder(p => ({ ...p, unit_price: sectorRate }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorRate]);
  const selectedOrderContractor = contractors.find(c => c.id === editingOrder.contractor_id);
  const isFabricaContractor = (selectedOrderContractor?.payment_days ?? 0) >= 999;
  // Produção de tiras não pode mais nascer nesta tela; o hub é a porta única.
  const manualOsValid = !!editingOrder.contractor_id
    && !!editingOrder.target_sector
    && Number(editingOrder.unit_price) > 0;

  const handleSaveOrder = () => {
    if (isCanonicalStrapServiceOrder(editingOrder as ServiceOrder)) {
      toast.error('Esta OS pertence ao fluxo canônico de tiras. Faça a operação no Hub de Tiras Artesanais.');
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
      return;
    }
    if (!editingOrder.contractor_id) return;
    if (!editingOrder.target_sector || !(Number(editingOrder.unit_price) > 0)) return;

    // Descrição é OPCIONAL (02/08/2026) e a coluna é NOT NULL → grava ''.
    // ⚠ Havia aqui um `if (!descFinal.trim()) return;` — early return SILENCIOSO.
    // Com a descrição nascendo vazia, ele transformaria "Salvar" num clique sem
    // efeito e sem mensagem em toda OS nova. O que o form realmente exige está
    // em `manualOsValid` (prestador + setor + preço), que nunca cobrou descrição.
    const descFinal = editingOrder.description || '';

    // Fix do bug: total = qty × unit_price (não copia unit_price pra total).
    const qty = Math.max(1, Number(editingOrder.quantity || 1));
    const unitPriceFinal = Number(editingOrder.unit_price ?? 0);
    const total = qty * unitPriceFinal;
    const validMaterials = (editingOrder.materials_sent || [])
      .filter(m => (m.material?.trim()) && (m.color?.trim()) && m.meters > 0);

    const payload = {
      ...editingOrder,
      description: descFinal,
      quantity: qty,
      unit_price: unitPriceFinal,
      total_value: total,
      materials_sent: validMaterials,
      material_name: validMaterials[0]?.material || '',
      material_color: validMaterials[0]?.color || '',
      material_meters: validMaterials[0]?.meters || 0,
      sale_order_id: editingOrder.sale_order_id || null,
      // Regrava a seleção de itens que está na tela. Sem isto, o spread de
      // `editingOrder` devolveria o valor antigo e — pior — a OS abriria com
      // "todos marcados" e salvaria isso por cima do escopo real. Sem PV, não
      // há o que registrar.
      selected_sale_order_item_ids: editingOrder.sale_order_id
        ? osPvItems.filter((i) => osPvItemSel.has(i.id)).map((i) => i.id)
        : null,
    };

    const originalOrder = orders.find(o => o.id === editingOrder.id);
    const justCompleted = editingOrder.status === 'Concluído' && originalOrder?.status !== 'Concluído';
    // Qualquer transição → Cancelado (não só de Concluído): senão cancelar uma OS
    // Pendente/Em Andamento caía no diff (zero) e NÃO estornava os materiais que
    // foram debitados na criação — vazamento de estoque (auditoria 2026-07-02).
    const justCancelled = editingOrder.status === 'Cancelado' && originalOrder?.status !== 'Cancelado';
    const contractorName = contractors.find(c => c.id === editingOrder.contractor_id)?.name || '';

    if (isEditing && editingOrder.id) {
      const osId = editingOrder.id;
      updateOrder.mutate(payload as ServiceOrder, {
        onSuccess: async () => {
          setOrderDialog(false);
          if (justCompleted) {
            // Conta a pagar: gerada pelo banco na transição de status.
            queryClient.invalidateQueries({ queryKey: ['accounts_payable'] }); queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
          } else if (justCancelled) {
            // Reverte estoque ao cancelar a OS.
            try {
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
          }
        },
      });
    }
  };

  const openEditContractor = (c: Contractor) => { setEditingContractor(c); setIsEditing(true); setContractorDialog(true); };
  const openNewContractor = () => { setEditingContractor({ ...emptyContractor }); setIsEditing(false); setContractorDialog(true); };
  const openEditOrder = (o: ServiceOrder) => {
    if (isCanonicalStrapServiceOrder(o)) {
      navigate('/tiras-artesanais?tab=producao&origin=terceirizados');
      return;
    }
    const mats = getMaterials(o);
    setEditingOrder({ ...o, materials_sent: mats.length > 0 ? mats : [{ ...emptyMaterial }] });
    setIsEditing(true);
    setOrderDialog(true);
  };
  const openNewOrder = (contractorId?: string) => {
    setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }], ...(contractorId ? { contractor_id: contractorId } : {}) });
    setIsEditing(false);
    setOrderDialog(true);
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

  // O catálogo completo de materiais é usado apenas nos formulários. A lista
  // operacional não deve ficar bloqueada enquanto ele carrega em segundo plano.
  if (loadingC || loadingO) {
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

        {currentTab === 'orders' && (
          <ContractorOperationsOverview
            overdueOrders={fieldStats.atrasados}
            inFieldOrders={fieldStats.itens}
            inFieldPairs={fieldStats.pares}
            pendingOrders={stats.pendingOrders}
            inProgressOrders={stats.inProgressOrders}
            amountDue={aPagar.value}
            amountDueOrders={aPagar.count}
            completedOrders={stats.completedOrders}
            totalValue={stats.totalValue}
            activeContractors={stats.activeContractors}
            totalContractors={contractors.length}
            onFilter={(filter) => {
              setOrderSearch('');
              setShowArchivedOs(false);
              clearOsReportFilters();
              setStatusFilter(filter);
            }}
          />
        )}

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          {/* No hub /terceiros a navegação por aba é a barra única do hub —
              a TabsList interna fica oculta e o painel ativo vem por props. */}
          {!embedded && (
            <TabsList>
              <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Ordens de Serviço</TabsTrigger>
              <TabsTrigger value="planning" className="gap-1.5"><ChartLineUp className="h-3.5 w-3.5" /> Planejamento</TabsTrigger>
              <TabsTrigger value="contractors" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Prestadores</TabsTrigger>
            </TabsList>
          )}

          {/* ── ORDERS TAB ── */}
          <TabsContent value="orders" className="mt-3 space-y-3">
            <ServiceOrderGenerationGapsAlert />
            <section aria-label="Busca, filtros e ações das ordens" className="overflow-hidden rounded-lg border bg-card">
              <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
                <SearchInput
                  className="w-full min-w-0 flex-1 lg:max-w-md"
                  inputClassName="h-10 lg:h-9"
                  value={orderSearch}
                  onChange={setOrderSearch}
                  placeholder="Buscar OS, prestador, PV ou descrição…"
                  resultCount={filteredOrders.length}
                  totalCount={orders.length}
                />

                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                  {/* Filtros de relatório (prestador / período / base) + PDF num popover. */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="relative h-10 gap-1.5 lg:h-9">
                        <FileDown className="h-4 w-4" /> Relatório
                        {hasOsReportFilters && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[calc(100vw-2rem)] space-y-3 sm:w-80">
                      <div>
                        <Label className="text-xs text-muted-foreground">Prestador</Label>
                        <Select value={contractorFilter} onValueChange={v => setOsParam('contractor', v === 'all' ? null : v)}>
                          <SelectTrigger aria-label="Prestador do relatório" className="mt-1 h-10 w-full sm:h-9">
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
                          <Label className="flex items-center gap-1 text-xs text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> De</Label>
                          <Input aria-label="Data inicial do relatório" type="date" value={osFromDate} onChange={e => setOsParam('from', e.target.value || null)} className="mt-1 h-10 sm:h-9" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Até</Label>
                          <Input aria-label="Data final do relatório" type="date" value={osToDate} onChange={e => setOsParam('to', e.target.value || null)} className="mt-1 h-10 sm:h-9" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Base da data</Label>
                        <Select value={osBasis} onValueChange={v => setOsParam('basis', v === 'criacao' ? 'criacao' : null)}>
                          <SelectTrigger aria-label="Base de data do relatório" className="mt-1 h-10 w-full sm:h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vencimento">Por vencimento</SelectItem>
                            <SelectItem value="criacao">Por criação</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        {hasOsReportFilters ? (
                          <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground sm:h-9" onClick={clearOsReportFilters}>
                            <X className="h-3.5 w-3.5" /> Limpar
                          </Button>
                        ) : <span />}
                        <Button size="sm" className="h-10 gap-1.5 sm:h-9" disabled={osPdfBusy} onClick={() => handleGenerateOsPdf('filtro')}>
                          {osPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          Gerar PDF ({filteredOrders.length})
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {osPerm.canCreate && (
                    <Button variant="outline" size="sm" onClick={() => openNewOrder()} className="h-10 gap-1.5 lg:h-9">
                      <Plus className="h-4 w-4" /> OS avulsa
                    </Button>
                  )}
                  {osPerm.canCreate && (
                    <Button size="sm" onClick={() => setGenOsOpen(true)} className="col-span-2 h-10 gap-1.5 sm:col-span-1 lg:h-9">
                      <Handshake className="h-4 w-4" /> Gerar por pedido
                    </Button>
                  )}
                </div>
              </div>

              {/* Filtros operacionais ficam numa faixa própria e rolável em
                  telas estreitas. Assim a barra não vira quatro linhas no celular. */}
              <div className="flex items-center gap-2 border-t bg-muted/20 px-3 py-2">
                <div role="group" aria-label="Filtrar ordens por situação" className="min-w-0 flex-1 overflow-x-auto">
                  <div className="flex min-w-max items-center gap-1">
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
                    className="h-10 gap-1.5 text-xs sm:h-9"
                    onClick={() => setStatusFilter(chip.value)}
                    aria-pressed={statusFilter === chip.value}
                  >
                    {chip.label}
                    <span className={cn('text-[10px] font-mono tabular-nums', statusFilter === chip.value ? 'opacity-80' : 'text-muted-foreground')}>
                      {statusChipCounts[chip.value] ?? 0}
                    </span>
                  </Button>
                ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={showArchivedOs ? 'secondary' : 'ghost'}
                  className="h-10 shrink-0 px-2 text-xs text-muted-foreground sm:h-9"
                  onClick={() => setShowArchivedOs(v => !v)}
                  aria-pressed={showArchivedOs}
                >
                  <Archive className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">{showArchivedOs ? 'Ocultar arquivadas' : 'Arquivadas'}</span>
                </Button>
              </div>
            </section>

            {filteredOrders.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={orderSearch ? Search : ClipboardList}
                  title={orderSearch ? `Nenhum resultado para "${orderSearch}"` : 'Nenhuma OS encontrada'}
                  description={orderSearch || hasOsReportFilters || statusFilter !== 'all'
                    ? 'Ajuste a busca, os chips de status ou os filtros de relatório.'
                    : 'Crie a primeira ordem de serviço para uma contratada.'}
                  action={orderSearch
                    ? <Button variant="outline" size="sm" onClick={() => setOrderSearch('')}>Limpar busca</Button>
                    : osPerm.canCreate ? <Button size="sm" className="gap-1.5" onClick={() => setGenOsOpen(true)}><Handshake className="h-4 w-4" /> Gerar por pedido</Button> : undefined}
                />
              </Panel>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 px-0.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono">{filteredOrders.length} OS</span>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <Select value={osSort} onValueChange={v => setOsSort(v as typeof osSort)}>
                      <SelectTrigger aria-label="Ordenar ordens de serviço" className="h-10 w-[156px] bg-card text-xs sm:h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgency">Mais urgentes</SelectItem>
                        <SelectItem value="recent">Mais recentes</SelectItem>
                        <SelectItem value="deadline">Prazo mais próximo</SelectItem>
                      </SelectContent>
                    </Select>
                    <div role="group" aria-label="Modo de exibição" className="inline-flex items-center rounded-md border bg-card p-0.5">
                      <button
                        type="button"
                        onClick={() => setOsView('list')}
                        aria-pressed={osView === 'list'}
                        title="Modo lista"
                        className={cn('inline-flex h-9 items-center gap-1 rounded px-2 transition-colors sm:h-7', osView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <ListIcon className="h-3.5 w-3.5" /> Lista
                      </button>
                      <button
                        type="button"
                        onClick={() => setOsView('cards')}
                        aria-pressed={osView === 'cards'}
                        title="Modo cartões"
                        className={cn('inline-flex h-9 items-center gap-1 rounded px-2 transition-colors sm:h-7', osView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <SquaresFour className="h-3.5 w-3.5" /> Cartões
                      </button>
                    </div>
                    <button type="button" disabled={selectableOrders.length === 0} className="h-10 rounded px-1 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-auto" onClick={toggleSelectAllOs}>
                      {allOsSelected ? 'Limpar seleção' : 'Selecionar todas'}
                    </button>
                  </div>
                </div>
                {osView === 'cards' ? (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {orderedFilteredOrders.map(o => {
                    const mats = getMaterials(o);
                    // Vínculo direto (legacy) OU terceirização integrada (source_sale_order_id).
                    const linkedPvId = linkedSaleOrderIdsOf(o)[0] || null;
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
                            <Checkbox checked={selected} disabled={isCanonicalStrapServiceOrder(o)} onCheckedChange={() => toggleOsSelect(o.id)} className="mt-0.5 shrink-0" aria-label={`Selecionar OS ${o.order_number}`} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm font-bold tracking-tight">{o.order_number}</span>
                                {isCanonicalStrapServiceOrder(o) && <span title="Produção canônica de tiras"><FlaskConical className="h-3.5 w-3.5 text-primary" /></span>}
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
                            <p className="line-clamp-2 text-sm text-muted-foreground">{osListLine(o)}</p>
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
                        <div className="-mx-3.5 -mb-3.5 mt-3 rounded-b-xl border-t border-border/60 bg-muted/30 px-3.5 pb-3 pt-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <OsPaymentBadge ov={osOverview?.get(o.id)} osStatus={o.status} orderNumber={o.order_number} expectsPayable={Number(o.contractors?.payment_days ?? 30) < 999} />
                              <OsBalanceLine ov={osOverview?.get(o.id)} />
                            </div>
                            {renderOsActions(o)}
                          </div>
                          <OsWorkflowRail order={o} ov={osOverview?.get(o.id)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                ) : (
                <>
                <div className="space-y-2 md:hidden">
                  {orderedFilteredOrders.map(renderMobileOsRow)}
                </div>
                <div className="hidden overflow-x-auto rounded-lg border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:h-9 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead className="w-8"><Checkbox checked={allOsSelected} disabled={selectableOrders.length === 0} onCheckedChange={toggleSelectAllOs} aria-label="Selecionar todas" /></TableHead>
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
                      {orderedFilteredOrders.map(o => {
                        const mats = getMaterials(o);
                        const linkedPvId = linkedSaleOrderIdsOf(o)[0] || null;
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
                              <Checkbox checked={selected} disabled={isCanonicalStrapServiceOrder(o)} onCheckedChange={() => toggleOsSelect(o.id)} aria-label={`Selecionar OS ${o.order_number}`} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm font-bold">
                              <button type="button" onClick={() => openEditOrder(o)} className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Abrir OS ${o.order_number}`}>
                                {o.order_number}
                                {isCanonicalStrapServiceOrder(o) && <span title="Produção canônica de tiras"><FlaskConical className="h-3 w-3 text-primary" /></span>}
                              </button>
                            </TableCell>
                            <TableCell className="text-sm">{o.contractors?.name || <span className="text-muted-foreground">Sem prestador</span>}</TableCell>
                            <TableCell className="hidden whitespace-nowrap md:table-cell">
                              {so
                                ? <span className="inline-flex items-center gap-1"><span className="font-mono text-xs font-semibold text-primary">{so.order_number}</span>{isAuto && <Badge variant="outline" className="h-4 bg-primary/5 px-1 text-[9px] text-primary border-primary/30">PV</Badge>}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="max-w-[260px]">
                              <p className="truncate text-sm text-muted-foreground" title={osListLine(o)}>{osListLine(o)}</p>
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
                                <OsPaymentBadge ov={osOverview?.get(o.id)} osStatus={o.status} orderNumber={o.order_number} expectsPayable={Number(o.contractors?.payment_days ?? 30) < 999} />
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
                </>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                className="w-full min-w-0 flex-1 sm:max-w-md"
                inputClassName="h-10 sm:h-9"
                value={contractorSearch}
                onChange={setContractorSearch}
                placeholder="Buscar por nome, CPF/CNPJ, tipo de serviço…"
                resultCount={filteredContractors.length}
                totalCount={contractors.length}
              />
              <div className="sm:ml-auto">
                <Button size="sm" onClick={openNewContractor} className="h-10 w-full gap-1.5 sm:h-9 sm:w-auto"><Plus className="h-4 w-4" /> Novo prestador</Button>
              </div>
            </div>

            <div className="space-y-2 md:hidden">
              {filteredContractors.length === 0 ? (
                <Panel flush>
                  <EmptyState
                    size="sm"
                    icon={contractorSearch ? Search : Users}
                    title={contractorSearch ? `Nenhum resultado para "${contractorSearch}"` : 'Nenhum prestador cadastrado'}
                    action={contractorSearch ? <Button variant="outline" size="sm" onClick={() => setContractorSearch('')}>Limpar busca</Button> : undefined}
                  />
                </Panel>
              ) : filteredContractors.map(c => {
                const selected = sel.isSelected(c.id);
                const checkboxId = `mobile-contractor-${c.id}`;
                return (
                  <article key={c.id} className={cn('overflow-hidden rounded-lg border bg-card', selected && 'border-primary/50 ring-1 ring-primary/20')}>
                    <div className="flex items-start gap-1 p-2.5">
                      <label htmlFor={checkboxId} className="flex h-11 w-10 shrink-0 cursor-pointer items-center justify-center" aria-label={`Selecionar ${c.name}`}>
                        <Checkbox id={checkboxId} checked={selected} onCheckedChange={() => sel.toggle(c.id)} />
                      </label>
                      <button type="button" onClick={() => openEditContractor(c)} className="min-w-0 flex-1 rounded p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-bold">{c.name}</span>
                          <Badge variant={c.active ? 'default' : 'secondary'} className="shrink-0 text-xs">{c.active ? 'Ativo' : 'Inativo'}</Badge>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{c.service_type || 'Serviço não informado'}</span>
                        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {c.phone && <span>{c.phone}</span>}
                          {c.city && c.state && <span>{c.city}/{c.state}</span>}
                          <span className="font-mono">Pgto. {c.payment_days}d</span>
                        </span>
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1 border-t bg-muted/30 p-2">
                      <Button variant="ghost" size="sm" className="h-10 gap-1 text-xs" onClick={() => setHistoryContractor(c)}><ClockCounterClockwise className="h-3.5 w-3.5" /> Histórico</Button>
                      <Button variant="ghost" size="sm" className="h-10 text-xs" onClick={() => setRatesContractor(c)}>Tarifas</Button>
                      <Button variant="ghost" size="sm" className="h-10 gap-1 text-xs" onClick={() => openEditContractor(c)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden md:block">
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
                              icon={contractorSearch ? Search : Users}
                              title={contractorSearch ? `Nenhum resultado para "${contractorSearch}"` : 'Nenhum prestador cadastrado'}
                              action={contractorSearch ? <Button variant="outline" size="sm" onClick={() => setContractorSearch('')}>Limpar busca</Button> : undefined}
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
            </div>
          </TabsContent>
        </Tabs>
      </div>
  );

  const overlays = (
    <>
      {/* ── Contractor Dialog ── */}
      <ContractorFormDialog
        open={contractorDialog}
        onOpenChange={setContractorDialog}
        value={editingContractor}
        onChange={setEditingContractor}
        isEditing={isEditing}
        onEditingChange={setIsEditing}
        onSave={handleSaveContractor}
        saving={createContractor.isPending || updateContractor.isPending}
      />

      {/* ── Service Order Dialog ── */}
      <Dialog open={orderDialog} onOpenChange={open => { setOrderDialog(open); if (!open) { setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }] }); setIsEditing(false); setOrderTab('dados'); setOsPvItemSel(new Set()); osPvPrevRef.current = null; } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Nova'} Ordem de Serviço</DialogTitle>
            <DialogDescription>Prestador, materiais enviados e cobrança da OS.</DialogDescription>
          </DialogHeader>

          <Tabs value={orderTab} onValueChange={setOrderTab}>
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
              <TabsTrigger value="foto" className="flex-1 gap-1"><Upload className="h-3.5 w-3.5" /> Foto Assinada</TabsTrigger>
              {isEditing && editingOrder.id && (
                <TabsTrigger value="historico" className="flex-1 gap-1"><ClockCounterClockwise className="h-3.5 w-3.5" /> Histórico</TabsTrigger>
              )}
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
                  <Label className="text-xs font-medium text-muted-foreground">Descrição do Serviço (opcional)</Label>
                  <Input value={editingOrder.description || ''} onChange={e => setEditingOrder(p => ({ ...p, description: e.target.value }))} className="h-9" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Setor / serviço *</Label>
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
                {editingOrder.sale_order_id && osPvItems.length > 0 && (
                  <div className="sm:col-span-2 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Itens do pedido</span>
                      <span className="text-[11px] text-muted-foreground">{osSelItems.length} de {osPvItems.length} · <b className="text-foreground">{osSelPares.toLocaleString('pt-BR')} pares</b></span>
                    </div>
                    <div className="space-y-1.5">
                      {osPvItems.map((it) => {
                        const on = osPvItemSel.has(it.id);
                        const opNo = osOpByItem.get(it.id);
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
                            {opNo
                              ? <span className="mono shrink-0 text-[11px] font-semibold text-primary">{opNo}</span>
                              : <span className="shrink-0 text-[11px] text-muted-foreground">sem OP</span>}
                            <span className="text-xs tabular-nums text-muted-foreground">{it.pairs.toLocaleString('pt-BR')} pares</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Marque os itens desta OS — a soma dos pares vira a <b className="text-foreground">Quantidade</b>, define as <b className="text-foreground">OPs</b> da OS e alimenta a guia de remessa.</p>
                  </div>
                )}

                {/* ── Artisanal Production Panel ── */}
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-primary" />
                      <div>
                        <span className="block text-sm font-medium">Produção de tiras artesanais</span>
                        <span className="block text-[11px] text-muted-foreground">Lotes, remessas e parciais ficam no hub canônico.</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => navigate('/tiras-artesanais?tab=producao&origin=terceirizados')}
                    >
                      Abrir hub
                    </Button>
                  </div>

                </div>

                {/* Materiais enviados da OS manual. Tiras usam o hub canônico. */}
                <div className="sm:col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">Materiais Enviados</span>
                  <span className="h-px flex-1 bg-border/70" />
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addMaterial}><Plus className="h-3 w-3" /> Adicionar</Button>
                </div>

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
                {/* Quantidade × Valor por par = Total auto. */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Quantidade (pares)</Label>
                  <NumberInput
                    min={1}
                    decimals={0}
                    value={editingOrder.quantity ?? 1}
                    onChange={n => setEditingOrder(p => ({ ...p, quantity: Math.max(1, Math.floor(n)) }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Valor por par (R$)</Label>
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
                    <span className="mt-0.5 block">
                      = {(editingOrder.quantity || 1).toLocaleString('pt-BR')} × {formatCurrency(editingOrder.unit_price || 0)}
                    </span>
                  </div>
                  <p className="display text-2xl leading-none tabular-nums text-foreground">
                    {formatCurrency((editingOrder.quantity || 1) * (editingOrder.unit_price || 0))}
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
                      {editingOrder.status === 'Concluído' && (
                        <SelectItem value="Concluído">Recebida</SelectItem>
                      )}
                      <SelectItem value="Cancelado">Cancelada</SelectItem>
                    </SelectContent>
                  </Select>
                  {editingOrder.status !== 'Concluído' && (
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

            {isEditing && editingOrder.id && (
              <TabsContent value="historico" className="mt-4">
                <ServiceOrderTimeline serviceOrderId={editingOrder.id} />
              </TabsContent>
            )}

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
                  {!editingOrder.target_sector && <li>selecionar o setor</li>}
                  {!(Number(editingOrder.unit_price) > 0) && <li>informar o valor por par (maior que zero)</li>}
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
              // Papel único (Modelo A): sem preço nem total. Os itens marcados
              // levam grade por numeração e foto — é o que alimenta o canhoto.
              printServiceOrderReceipt(
                {
                  order_number: isEditing ? (orders.find(o => o.id === editingOrder.id)?.order_number || 'NOVA') : 'NOVA',
                  target_sector: editingOrder.target_sector || null,
                  description: editingOrder.description || '',
                  service_date: editingOrder.service_date || format(new Date(), 'yyyy-MM-dd'),
                  quoted_deadline: editingOrder.quoted_deadline || null,
                  quantity: qtyVal,
                  notes: editingOrder.notes || '',
                  materials_sent: validMats,
                  sale_order_number: so?.order_number || null,
                  client_order_number: so?.client_order_number || null,
                  // OPs dos itens marcados AGORA na tela (não os gravados) — o
                  // papel tem que refletir o que está sendo impresso.
                  op_numbers: opNumbersForServiceOrder(
                    opsForOs, osSelItems.map((i) => i.id), editingOrder.sale_order_id || null,
                  ),
                  client_name: so?.client_name || null,
                },
                contractor ? {
                  name: contractor.name, trade_name: (contractor as any).trade_name,
                  cnpj_cpf: contractor.cnpj_cpf, phone: contractor.phone,
                } : undefined,
                { items: osSelItems },
              );
            }}><Printer className="h-4 w-4" /> Imprimir OS</Button>
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
          unitPrice: returnDialogOs.unit_price ?? 0,
          paymentDays: contractors.find((c) => c.id === returnDialogOs.contractor_id)?.payment_days ?? 30,
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
        onReceive={() => { const o = dispatchDialogOs; if (o) openCanonicalOrReturn(o); }}
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

      {currentTab === 'contractors' && sel.selectedIds.size > 0 && (
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
      )}

      {/* Rodapé fixo de seleção de OS: totais somados + relatório PDF + ações
          da triagem P0.3 (receber em lote / arquivar). */}
      {currentTab === 'orders' && selectedOrders.length > 0 && (
      <SelectionTotalsBar
        count={selectedOrders.length}
        total={osSelectionSummary.total}
        paid={osSelectionSummary.paid}
        pending={osSelectionSummary.pending}
        onClear={() => setSelectedOsIds(new Set())}
        onGeneratePdf={() => handleGenerateOsPdf('selecao')}
        generating={osPdfBusy}
        extraActions={
          <>
            {bulkReceivableLegacy.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={bulkReceive.isPending}>
                    {bulkReceive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Receber {bulkReceivableLegacy.length} legada(s)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Receber {bulkReceivableLegacy.length} OS legada(s) por completo?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cada OS será marcada como Entregue e <strong>gera conta a pagar</strong> pelos
                      pares bons. OS de prestador interno (FÁBRICA) concluem sem gerar conta a pagar.
                      Retorno com perda/defeito e toda OS nova devem usar a conferência individual.
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
                      bulkReceive.mutate(bulkReceivableLegacy.map(o => ({
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
                  <AlertDialogTitle>Arquivar {selectedOrders.length} OS?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Elas somem das listagens (o histórico é preservado e dá pra revê-las com
                    "Mostrar arquivadas"). Use pra encerrar a triagem de OS antigas que não
                    representam serviço real em aberto.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => {
                    archiveOs.mutate(selectedOrders.map(o => o.id), { onSuccess: () => setSelectedOsIds(new Set()) });
                  }}>
                    Arquivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />
      )}
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
