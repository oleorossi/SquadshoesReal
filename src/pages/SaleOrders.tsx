import { useState, useMemo } from 'react';
import { getSignedUrl } from '@/lib/getSignedUrl';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { ShoppingCart, Plus, CircleNotch as Loader2, Copy, Printer, Factory, PencilSimple as Pencil, FileText, Funnel as Filter, X, MagnifyingGlass as Search, Package, CurrencyDollar as DollarSign, Clock, CaretDown as ChevronDown, ChartBar as BarChart3, ClipboardText as ClipboardList, ArrowsClockwise as RefreshCw, Tag, SquaresFour as LayoutDashboard, Lightning as Zap, FileXls as FileSpreadsheet, Receipt, XCircle, CheckCircle, Download, TrendUp as TrendingUp, Warning as AlertTriangle, ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react';
import { cn } from "@/lib/utils";
import MaterialConsumptionDialog from '@/components/sale-orders/MaterialConsumptionDialog';
import MarginDialog from '@/components/sale-orders/MarginDialog';
import { PvOutdatedBadge } from '@/components/sale-orders/PvOutdatedBadge';
import SummaryConsumptionPanel from '@/components/sale-orders/SummaryConsumptionPanel';
import SaleOrdersOverviewDialog from '@/components/sale-orders/SaleOrdersOverviewDialog';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SmartSearch, SmartSearchSuggestion } from '@/components/ui/smart-search';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSaleOrders, useSaleOrderAllItems, useCreateSaleOrder, useDeleteSaleOrder, useUpdateSaleOrder, useUpdateSaleOrderStatus, useResyncOPsFromSheets, useResyncOPsFromPV, SaleOrderFormData, SaleOrderItemFormData, PackagingMode } from '@/hooks/useSaleOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useClients, useEconomicGroups } from '@/hooks/useClients';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import SaleOrderFormPanel from '@/components/sale-orders/SaleOrderFormPanel';
import { useAuth } from '@/hooks/useAuth';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useEmitNfe, useNfeEmitidas, useCheckNfeStatus, useCancelNfe, useCompanies } from '@/hooks/useNfe';
import { NfeDevolucaoDialog } from '@/components/nfe/NfeDevolucaoDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { printHtml, buildSaleOrderPrintHtml } from '@/lib/printOrder';
import { printAllSectorsForSaleOrder } from '@/lib/printSaleOrderOPs';
import { autoCreateSolePO } from '@/lib/soleAutoPO';
import { buildThermalLabelsHtml } from '@/lib/printLabels';
import { openPrintWindow, writeRawPrintWindow } from '@/lib/printOrder';
import { todayISO, todayPlusDaysISO } from '@/lib/date';
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const STATUS_OPTIONS = ['Rascunho', 'Aprovado', 'Em Produção', 'Faturado', 'Finalizado s/ NF', 'Cancelado'] as const;

// Audit visual: cores anteriores text-{color}-400 em dark caíam abaixo do
// ratio WCAG AA (4.5:1) sobre o fundo /15. text-{color}-300 dá contraste
// adequado mantendo a paleta semântica original.
const STATUS_COLORS: Record<string, string> = {
  'Rascunho': 'bg-muted text-muted-foreground border-border',
  'Aprovado': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'Em Produção': 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'Faturado': 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'Finalizado s/ NF': 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'Cancelado': 'bg-destructive/15 text-destructive border-destructive/30',
};

const STATUS_DOT: Record<string, string> = {
  'Rascunho': 'bg-muted-foreground',
  'Aprovado': 'bg-emerald-500',
  'Em Produção': 'bg-blue-500',
  'Faturado': 'bg-violet-500',
  'Finalizado s/ NF': 'bg-amber-500',
  'Cancelado': 'bg-destructive',
};

const TERMINAL_BILLED_STATUSES = ['Faturado', 'Finalizado s/ NF'];

const emptyForm: SaleOrderFormData = {
  client_name: '', client_cnpj: '', client_contact: '', client_order_number: '',
  representative: '', payment_condition: '', delivery_deadline: '', delivery_week: '', delivery_month: '',
  notes: '', status: 'Rascunho',
  nfe: '', remessa: '', is_factoring: false, factoring_config_id: '', packaging_mode: 'individual_amarrado',
};

const emptyItem: SaleOrderItemFormData = {
  reference_id: '', color: '', grade: {}, unit_price: 0, quantity: 0, fichas: 1, observation: null,
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR') : '—';

const formatDateShort = (d: string) =>
  new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// Lookup batch de min_billing_date pra todos os PVs ativos da view sale_order_min_billing.
// Usado pra marcar em vermelho linhas com delivery_deadline < min_billing_date.
function useMinBillingMap() {
  return useQuery<Map<string, string>>({
    queryKey: ['sale_order_min_billing_map'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_min_billing' as any)
        .select('sale_order_id, min_billing_date');
      const out = new Map<string, string>();
      if (error || !data) return out;
      for (const row of data as any[]) {
        if (row.sale_order_id && row.min_billing_date) {
          out.set(row.sale_order_id, row.min_billing_date);
        }
      }
      return out;
    },
    staleTime: 60_000,
  });
}

export default function SaleOrders() {
  const { data: orders = [], isLoading, isError, error } = useSaleOrders();
  const { data: allSaleItems = [] } = useSaleOrderAllItems();
  const { data: minBillingMap = new Map<string, string>() } = useMinBillingMap();
  const { data: references = [] } = useTechnicalSheets();
  const { data: clients = [] } = useClients();
  const { data: economicGroups = [] } = useEconomicGroups();
  const { data: representatives = [] } = useRepresentatives();
  const createOrder = useCreateSaleOrder();
  const updateOrder = useUpdateSaleOrder();
  const deleteOrder = useDeleteSaleOrder();
  const updateStatus = useUpdateSaleOrderStatus();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const emitNfe = useEmitNfe();
  const checkNfeStatus = useCheckNfeStatus();
  const cancelNfe = useCancelNfe();
  const { data: companies = [] } = useCompanies();
  const [nfeCompanyId, setNfeCompanyId] = useState('');
  const [cancelNfeTarget, setCancelNfeTarget] = useState<{ id: string; numero: string | null } | null>(null);
  const [cancelJustificativa, setCancelJustificativa] = useState('');
  const [devolucaoTarget, setDevolucaoTarget] = useState<{ id: string; numero: string | null } | null>(null);
  const resyncOPs = useResyncOPsFromSheets();
  const resyncPVOPs = useResyncOPsFromPV();
  // bulkSyncFinancial removido em 2026-05 — sync acontece automaticamente no faturamento
  const navigate = useNavigate();

  // Sugestões para SmartSearch (PV): Cliente, Representante, Referência
  const searchSuggestions = useMemo(() => {
    return (term: string): SmartSearchSuggestion[] => {
      const q = term.toLowerCase().trim();
      if (!q) return [];
      const out: SmartSearchSuggestion[] = [];

      // Clientes (name)
      const clientMatches = (clients as any[])
        .filter((c: any) => {
          const name = (c.razao_social || c.nome_fantasia || '').toLowerCase();
          const cnpj = (c.cnpj || '').toLowerCase();
          return name.includes(q) || cnpj.includes(q);
        })
        .slice(0, 5);
      for (const c of clientMatches) {
        out.push({ field: 'name', value: c.razao_social || c.nome_fantasia || '', meta: 'Cliente' });
      }

      // Representantes (category — usado como agrupamento)
      const repMatches = (representatives as any[])
        .filter((r: any) => (r.name || '').toLowerCase().includes(q))
        .slice(0, 5);
      for (const r of repMatches) {
        out.push({ field: 'category', value: r.name, meta: 'Representante' });
      }

      // Referências (sku)
      const refMatches = (references as any[])
        .filter((r: any) => (r.code || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))
        .slice(0, 5);
      for (const r of refMatches) {
        out.push({ field: 'sku', value: r.code || r.name, meta: r.name });
      }

      return out;
    };
  }, [clients, representatives, references]);

  const { data: userRoles = [] } = useQuery({
    queryKey: ['user_roles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user!.id);
      return data?.map(r => r.role) || [];
    },
  });
  const isAdmin = userRoles.includes('admin');
  // Produção/almoxarifado veem PVs pra contexto de produção, mas SEM valores
  // (preço unit, total, comissão). canSeeFinancialValues=false bloqueia colunas
  // e KPIs financeiros sem retirar a navegação.
  const { canSeeFinancialValues } = useAccessControl();

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SaleOrderFormData>(emptyForm);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [items, setItems] = useState<SaleOrderItemFormData[]>([{ ...emptyItem }]);

  const closeCreateDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setForm(emptyForm);
      setItems([{ ...emptyItem }]);
      setSelectedClientId('');
    }
  };

  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = useState<any[]>([]);
  const [loadingOrderItems, setLoadingOrderItems] = useState(false);
  const { data: selectedOrderNfes = [] } = useNfeEmitidas(selectedOrder?.id);

  const [dupDialog, setDupDialog] = useState(false);
  const [dupOrderId, setDupOrderId] = useState<string | null>(null);
  const [dupSelectedClients, setDupSelectedClients] = useState<string[]>([]);
  const [dupGroupId, setDupGroupId] = useState<string>('');
  const [dupClientSearch, setDupClientSearch] = useState('');
  const [generatingOPs, setGeneratingOPs] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<{ items: any[]; totalQty: number; totalValue: number; orders: any[] }>({ items: [], totalQty: 0, totalValue: 0, orders: [] });
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [consumptionDialogOpen, setConsumptionDialogOpen] = useState(false);
  const [marginDialogOpen, setMarginDialogOpen] = useState(false);
  const [quickConsumptionId, setQuickConsumptionId] = useState<string | null>(null);
  const [quickConsumptionNumber, setQuickConsumptionNumber] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SaleOrderFormData>(emptyForm);
  const [editItems, setEditItems] = useState<SaleOrderItemFormData[]>([{ ...emptyItem }]);
  const [editSelectedClientId, setEditSelectedClientId] = useState<string>('');

  const closeEditDialog = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      setEditForm(emptyForm);
      setEditItems([{ ...emptyItem }]);
      setEditSelectedClientId('');
      setEditOrderId(null);
    }
  };
  // Filter & selection states (persisted across navigation)
  const [searchTerm, setSearchTerm] = usePersistedState('searchTerm', '');
  const [filterStatus, setFilterStatus] = usePersistedState<string>('filterStatus', 'all');
  const [filterRep, setFilterRep] = usePersistedState<string>('filterRep', 'all');
  const [filterGroup, setFilterGroup] = usePersistedState<string>('filterGroup', 'all');
  const [filterSegment, setFilterSegment] = usePersistedState<string>('filterSegment', 'all');
  const [filterMonth, setFilterMonth] = usePersistedState<string>('filterMonth', 'all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = usePersistedState('showFilters', false);
  const [mainTab, setMainTab] = usePersistedState<string>('saleOrderMainTab', 'ativos');

  // Derived data
  const clientGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach(c => { if (c.economic_group_id) map[c.razao_social] = c.economic_group_id; });
    return map;
  }, [clients]);

  // Map: client name (lowercased) -> client record (for CNPJ + client_number lookups)
  const clientByName = useMemo(() => {
    const map: Record<string, typeof clients[number]> = {};
    clients.forEach(c => { if (c.razao_social) map[c.razao_social.toLowerCase()] = c; });
    return map;
  }, [clients]);

  // Map: digits-only CNPJ -> client record (replaces O(n) .find() in dup-order
  // detection, which was scanning all clients for every duplicate-check call).
  const clientByCnpj = useMemo(() => {
    const map = new Map<string, typeof clients[number]>();
    clients.forEach(c => {
      const cnpj = (c.cnpj || '').replace(/\D/g, '');
      if (cnpj) map.set(cnpj, c);
    });
    return map;
  }, [clients]);

  // Reference lookup: id -> { code, name } for searching by referência (code or name)
  const refById = useMemo(() => {
    const map: Record<string, { code: string; name: string }> = {};
    references.forEach((r: any) => {
      map[r.id] = { code: (r.code || '').toLowerCase(), name: (r.name || '').toLowerCase() };
    });
    return map;
  }, [references]);

  // Index: sale_order_id -> Set of searchable strings from items (ref code, ref name, color)
  const itemsBySaleOrder = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!map[id]) map[id] = new Set();
      const ref = refById[it.reference_id];
      if (ref?.code) map[id].add(ref.code);
      if (ref?.name) map[id].add(ref.name);
      if (it.color) map[id].add(String(it.color).toLowerCase());
    });
    return map;
  }, [allSaleItems, refById]);

  // Index: sale_order_id -> total pairs (sum of item.quantity)
  const pairsBySaleOrder = useMemo(() => {
    const map: Record<string, number> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      map[id] = (map[id] || 0) + (Number(it.quantity) || 0);
    });
    return map;
  }, [allSaleItems]);

  // Index: sale_order_id -> Set of segments (Adulto / Infantil) based on items' references
  const segmentsBySaleOrder = useMemo(() => {
    const refSegment: Record<string, 'Adulto' | 'Infantil'> = {};
    references.forEach((r: any) => {
      const cat = (r.shoe_category || '').toLowerCase();
      refSegment[r.id] = cat.includes('infantil') || cat.includes('kids') || cat.includes('crian') || cat.includes('bebe') || cat.includes('bebê')
        ? 'Infantil'
        : 'Adulto';
    });
    const map: Record<string, Set<'Adulto' | 'Infantil'>> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!map[id]) map[id] = new Set();
      const seg = refSegment[it.reference_id];
      if (seg) map[id].add(seg);
    });
    return map;
  }, [allSaleItems, references]);

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Tab gating: ativos => não-terminais; faturados => Faturado + Finalizado s/ NF
      const isBilled = TERMINAL_BILLED_STATUSES.includes(order.status);
      if (mainTab === 'faturados') {
        if (!isBilled) return false;
      } else {
        if (isBilled) return false;
      }
      if (filterStatus !== 'all' && order.status !== filterStatus) return false;
      if (filterRep !== 'all' && order.representative !== filterRep) return false;
      if (filterGroup !== 'all') {
        const grp = clientGroupMap[order.client_name];
        if (grp !== filterGroup) return false;
      }
      if (filterSegment !== 'all') {
        const segs = segmentsBySaleOrder[order.id];
        if (!segs || !segs.has(filterSegment as 'Adulto' | 'Infantil')) return false;
      }
      if (filterMonth !== 'all' && order.delivery_month !== filterMonth) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        if (!q) return true;
        const client = clientByName[(order.client_name || '').toLowerCase()];
        const cnpjDigits = (client?.cnpj || (order as any).client_cnpj || '').replace(/\D/g, '');
        const qDigits = q.replace(/\D/g, '');
        const itemTokens = itemsBySaleOrder[order.id];
        const candidates = [
          order.order_number,
          order.client_name,
          order.client_order_number,
          order.representative,
          order.payment_condition,
          order.nfe,
          order.remessa,
          order.delivery_week,
          order.delivery_month,
          order.notes,
          order.status,
          (order as any).client_number,
          client?.client_number,
          client?.nome_fantasia,
        ];
        const matchesText = candidates.some(v => (v || '').toString().toLowerCase().includes(q));
        const matchesCnpj = qDigits.length >= 3 && cnpjDigits.includes(qDigits);
        const matchesItem = itemTokens && Array.from(itemTokens).some(t => t.includes(q));
        if (!matchesText && !matchesCnpj && !matchesItem) return false;
      }
      return true;
    });
  }, [orders, mainTab, filterStatus, filterRep, filterGroup, filterSegment, segmentsBySaleOrder, searchTerm, clientGroupMap, clientByName, itemsBySaleOrder]);

  const activeCount = useMemo(() => orders.filter(o => o.status !== 'Rascunho' && o.status !== 'Cancelado' && !TERMINAL_BILLED_STATUSES.includes(o.status)).length, [orders]);
  const billedCount = useMemo(() => orders.filter(o => TERMINAL_BILLED_STATUSES.includes(o.status)).length, [orders]);

  const pendingOrders = useMemo(() => orders.filter(o => o.status === 'Rascunho'), [orders]);

  const activeFiltersCount = [filterStatus !== 'all', filterRep !== 'all', filterGroup !== 'all', filterSegment !== 'all', filterMonth !== 'all'].filter(Boolean).length;

  // KPI calculations
  const kpis = useMemo(() => {
    const total = filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const drafts = filteredOrders.filter(o => o.status === 'Rascunho').length;
    const approved = filteredOrders.filter(o => o.status === 'Aprovado').length;
    const inProduction = filteredOrders.filter(o => o.status === 'Em Produção').length;
    return { total, pending: drafts, approved, inProduction, count: filteredOrders.length };
  }, [filteredOrders]);

  const totalPares = useMemo(() =>
    filteredOrders.reduce((s, o) => s + (pairsBySaleOrder[o.id] || 0), 0),
  [filteredOrders, pairsBySaleOrder]);

  const uniqueMonths = useMemo(() => {
    const months = new Set(orders.map(o => o.delivery_month).filter(Boolean));
    return Array.from(months).sort();
  }, [orders]);

  const uniqueReps = useMemo(() => {
    const reps = new Set(orders.map(o => o.representative).filter(Boolean));
    return Array.from(reps).sort();
  }, [orders]);

  const dupSourceClientId = useMemo(() => {
    if (!dupOrderId) return null;
    const order = orders.find(o => o.id === dupOrderId);
    if (order?.client_id) return order.client_id;

    const normalizedOrderName = (order?.client_name || '').trim().toLowerCase();
    const normalizedOrderCnpj = (order?.client_cnpj || '').replace(/\D/g, '');

    // Prefer CNPJ match (more reliable), fall back to name match.
    const matchedClient =
      (normalizedOrderCnpj && clientByCnpj.get(normalizedOrderCnpj)) ||
      (normalizedOrderName.length > 0 && clientByName[normalizedOrderName]) ||
      null;

    return matchedClient?.id ?? null;
  }, [dupOrderId, orders, clientByCnpj, clientByName]);

  const dupGroupClients = useMemo(() => {
    if (!dupGroupId) return [];
    return clients.filter(c => c.economic_group_id === dupGroupId && c.active && c.id !== dupSourceClientId);
  }, [dupGroupId, clients, dupSourceClientId]);

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map(id => deleteOrder.mutateAsync(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    setSelectedIds(new Set());
    if (failed === 0) {
      toast.success(`${ids.length} pedido(s) excluído(s)`);
    } else {
      toast.error(`${ids.length - failed} excluído(s), ${failed} falha(s).`);
    }
  };

  const handleBulkStatusChange = async (status: string) => {
    const ids = Array.from(selectedIds);
    // Pré-check só se o status alvo é Aprovado/Em Produção (estados que
    // disparam o pipeline produtivo). Cancelar/Rascunho não precisam de
    // viabilidade — são ações de "desistir" ou "voltar atrás".
    if (status === 'Aprovado' || status === 'Em Produção') {
      const targets = filteredOrders.filter((o) => ids.includes(o.id));
      const infeasibleOrders = targets.filter((o) => {
        const min = minBillingMap.get(o.id);
        return min && o.delivery_deadline && o.delivery_deadline < min;
      });
      if (infeasibleOrders.length > 0) {
        const list = infeasibleOrders
          .slice(0, 5)
          .map((o) => `• ${o.order_number} (${formatDate(o.delivery_deadline)} → mín ${formatDate(minBillingMap.get(o.id) || null)})`)
          .join('\n');
        const more = infeasibleOrders.length > 5 ? `\n... e mais ${infeasibleOrders.length - 5}` : '';
        const ok = window.confirm(
          `${infeasibleOrders.length} pedido(s) com data INVIÁVEL — produção não cabe no prazo:\n\n${list}${more}\n\n` +
          'Mover para "' + status + '" mesmo assim? (Recomendado: ajustar a data primeiro)'
        );
        if (!ok) return;
      }
    }
    const results = await Promise.allSettled(ids.map(id => updateStatus.mutateAsync({ id, status })));
    const failed = results.filter(r => r.status === 'rejected').length;
    setSelectedIds(new Set());
    if (failed === 0) {
      toast.success(`${ids.length} pedido(s) atualizado(s) para "${status}"`);
    } else {
      toast.error(`${ids.length - failed} atualizado(s), ${failed} falha(s).`);
    }
  };

  // Generate next 6 months for bulk week/month change
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return months;
  }, []);

  const [bulkMonth, setBulkMonth] = useState<string>('');
  const [bulkWeek, setBulkWeek] = useState<string>('');

  const bulkWeekOptions = useMemo(() => {
    if (!bulkMonth) return [] as { value: string; label: string }[];
    const [year, month] = bulkMonth.split('-').map(Number);
    const weeks: { value: string; label: string }[] = [];
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let weekStart = new Date(firstDay);
    const dayOfWeek = weekStart.getDay();
    if (dayOfWeek !== 1) weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
    let weekNum = 1;
    while (weekStart <= lastDay) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 4);
      weeks.push({
        value: `S${weekNum}`,
        label: `Semana ${weekNum} (${weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
      });
      weekStart.setDate(weekStart.getDate() + 7);
      weekNum++;
    }
    return weeks;
  }, [bulkMonth]);

  const handleBulkUpdateDelivery = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkMonth && !bulkWeek) {
      toast.info('Selecione mês e/ou semana para aplicar.');
      return;
    }
    const updates: any = {};
    if (bulkMonth) {
      updates.delivery_month = bulkMonth;
    }
    if (bulkWeek) {
      updates.delivery_week = bulkWeek;
    }
    
    // Sync billing_week for production wave engine
    if (bulkMonth && bulkWeek) {
      updates.billing_week = `${bulkMonth}-${bulkWeek}`;
    } else if (bulkWeek) {
      updates.billing_week = bulkWeek;
    } else if (bulkMonth) {
      // Month-only update: clear billing_week to prevent stale month-week mismatch
      // (e.g., billing_week="2026-04-S2" while delivery_month="2026-05"). The wave
      // engine falls back to delivery_month when billing_week is null.
      updates.billing_week = null;
    }

    // Only allow editing delivery dates for PVs in editable statuses.
    // Faturado/Expedido PVs have NF-e issued against the old delivery date;
    // Cancelado/Concluído PVs should be immutable.
    const PROTECTED_STATUSES = ['Faturado', 'Finalizado s/ NF', 'Expedido', 'Cancelado', 'Concluído'];
    const editableIds = orders
      .filter(o => selectedIds.has(o.id) && !PROTECTED_STATUSES.includes(o.status))
      .map(o => o.id);
    const skipped = selectedIds.size - editableIds.length;
    if (skipped > 0) toast.info(`${skipped} pedido(s) ignorado(s) — status não permite edição de entrega.`);
    if (editableIds.length === 0) return;

    const { data: updated, error } = await supabase.from('sale_orders').update(updates)
      .in('id', editableIds)
      .not('status', 'in', '("Faturado","Finalizado s/ NF","Expedido","Cancelado","Concluído")')
      .select('id');
    if (error) {
      toast.error(`Erro ao atualizar: ${error.message}`);
      return;
    }
    const racedCount = editableIds.length - (updated?.length ?? 0);
    if (racedCount > 0) toast.warning(`${racedCount} pedido(s) ignorado(s) — status mudou enquanto editava.`);
    queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
    toast.success(`${updated?.length ?? 0} pedido(s) atualizado(s)`);
    setBulkMonth('');
    setBulkWeek('');
    setSelectedIds(new Set());
  };

  const handleBulkPrint = async () => {
    if (selectedIds.size === 0) return;
    const selectedOrders = orders.filter(o => selectedIds.has(o.id));
    const allHtmlParts: string[] = [];
    for (const order of selectedOrders) {
      const { data: oi } = await supabase.from('sale_order_items').select('*, technical_sheets(name, code, image_url, images)').eq('sale_order_id', order.id);
      // Fetch color variant images
      const refIds = [...new Set((oi || []).map(i => i.reference_id))];
      const { data: colorVariants } = await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds);
      allHtmlParts.push(await buildSaleOrderPrintHtml(order, oi || [], colorVariants || []));
    }
    const combinedHtml = allHtmlParts.join('<div style="page-break-before:always"></div>');
    printHtml(`Pedidos de Venda (${selectedOrders.length})`, combinedHtml);
  };

  const handleOpenSummary = async () => {
    if (selectedIds.size === 0) { toast.info('Selecione pelo menos um pedido.'); return; }
    setLoadingSummary(true);
    setSummaryDialogOpen(true);
    const selectedOrders = orders.filter(o => selectedIds.has(o.id));

    // Batch query 1: all items for ALL selected orders in one request
    const { data: allOI = [] } = await supabase
      .from('sale_order_items')
      .select('*, technical_sheets(name, code, image_url, images)')
      .in('sale_order_id', selectedOrders.map(o => o.id));

    // Batch query 2: all color variants for all reference IDs in one request
    const refIds = [...new Set(allOI.map((i: any) => i.reference_id).filter(Boolean))];
    const { data: colorVariants = [] } = refIds.length > 0
      ? await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds)
      : { data: [] as any[] };

    // Pre-build Maps for O(1) lookup
    const orderMetaById = new Map(selectedOrders.map(o => [o.id, o]));
    const variantByKey = new Map<string, string>();
    const variantAnyByRef = new Map<string, string>();
    for (const v of (colorVariants as any[])) {
      if (!v.image_url) continue;
      const key = `${v.reference_id}|${v.color}`;
      if (!variantByKey.has(key)) variantByKey.set(key, v.image_url);
      if (!variantAnyByRef.has(v.reference_id)) variantAnyByRef.set(v.reference_id, v.image_url);
    }

    const allItems = (allOI as any[]).map(item => {
      const order = orderMetaById.get(item.sale_order_id);
      const variantImg = variantByKey.get(`${item.reference_id}|${item.color}`)
        || variantAnyByRef.get(item.reference_id)
        || item.technical_sheets?.image_url
        || (item.technical_sheets?.images as any)?.[0]
        || '';
      return { ...item, order_number: order?.order_number, client_name: order?.client_name, variant_image_url: variantImg };
    });

    const totalQty = allItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const totalValue = allItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
    setSummaryData({ items: allItems, totalQty, totalValue, orders: selectedOrders });
    setLoadingSummary(false);
  };

  const printSummary = () => {
    const rows = summaryData.items.map(item => {
      const imgUrl = item.variant_image_url || item.technical_sheets?.image_url || (item.technical_sheets?.images as any)?.[0] || '';
      const ref = item.technical_sheets?.code || item.technical_sheets?.name || '—';
      const subtotal = Number(item.quantity) * Number(item.unit_price);
      return `<tr>
        <td style="padding:6px;border:1px solid #ccc;text-align:center">
          ${imgUrl ? `<img src="${imgUrl}" style="width:50px;height:50px;object-fit:cover;border-radius:4px" />` : '—'}
        </td>
        <td style="padding:6px;border:1px solid #ccc;font-weight:bold">${ref}</td>
        <td style="padding:6px;border:1px solid #ccc">${item.color || '—'}</td>
        <td style="padding:6px;border:1px solid #ccc;font-family:monospace;font-size:11px">${item.order_number}</td>
        <td style="padding:6px;border:1px solid #ccc">${item.client_name}</td>
        <td style="padding:6px;border:1px solid #ccc;text-align:right;font-family:monospace">${item.quantity}</td>
        <td style="padding:6px;border:1px solid #ccc;text-align:right;font-family:monospace">${formatCurrency(Number(item.unit_price))}</td>
        <td style="padding:6px;border:1px solid #ccc;text-align:right;font-family:monospace;font-weight:bold">${formatCurrency(subtotal)}</td>
      </tr>`;
    }).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111;font-weight:bold">
        <h2 style="margin:0 0 4px;font-size:18px">Resumo de Pedidos</h2>
        <p style="margin:0 0 12px;font-size:12px;color:#333">${summaryData.orders.length} pedido(s) | ${summaryData.totalQty} pares | ${formatCurrency(summaryData.totalValue)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f0f0f0">
              <th style="padding:6px;border:1px solid #ccc;width:60px">Foto</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:left">Ref.</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:left">Cor</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:left">Pedido</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:left">Cliente</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:right">Qtd</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:right">Preço</th>
              <th style="padding:6px;border:1px solid #ccc;text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#f0f0f0">
              <td colspan="5" style="padding:8px;border:1px solid #ccc;font-weight:bold;text-align:right">TOTAL</td>
              <td style="padding:8px;border:1px solid #ccc;text-align:right;font-family:monospace;font-weight:bold">${summaryData.totalQty}</td>
              <td style="padding:8px;border:1px solid #ccc"></td>
              <td style="padding:8px;border:1px solid #ccc;text-align:right;font-family:monospace;font-weight:bold;font-size:14px">${formatCurrency(summaryData.totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    printHtml('Resumo de Pedidos', html);
  };

  const clearFilters = () => {
    setFilterStatus('all');
    setFilterRep('all');
    setFilterGroup('all');
    setFilterSegment('all');
    setFilterMonth('all');
    setSearchTerm('');
  };

  // Form handlers
  const handleClientSelect = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setForm(f => ({ ...f, client_name: client.razao_social, client_cnpj: client.cnpj || '', client_contact: client.contato || '' }));
    }
  };

  const handleEditClientSelect = (clientId: string) => {
    setEditSelectedClientId(clientId);
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setEditForm(f => ({ ...f, client_name: client.razao_social, client_cnpj: client.cnpj || '', client_contact: client.contato || '' }));
    }
  };

  const openEditDialog = async (order: any) => {
    setEditOrderId(order.id);
    const rep = representatives.find(r => r.name === order.representative);
    setEditForm({
      client_name: order.client_name || '', client_cnpj: order.client_cnpj || '',
      client_contact: order.client_contact || '', client_order_number: order.client_order_number || '',
      representative: rep?.id || order.representative_id || '',
      payment_condition: order.payment_condition || '', delivery_deadline: order.delivery_deadline || '',
      delivery_week: order.delivery_week || '', delivery_month: order.delivery_month || '',
      notes: order.notes || '', status: order.status || 'Rascunho',
      nfe: order.nfe || '', remessa: order.remessa || '',
      is_factoring: order.is_factoring || false,
      factoring_config_id: order.factoring_config_id || '',
      packaging_mode: (order.packaging_mode || 'individual_amarrado') as PackagingMode,
    });
    const client = clients.find(c => c.id === order.client_id)
      || clients.find(c => c.razao_social === order.client_name);
    setEditSelectedClientId(client?.id || '');

    const { data: orderItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', order.id);
    if (orderItems && orderItems.length > 0) {
      setEditItems(orderItems.map(i => {
        const grade = (i.grade as Record<string, number>) || {};
        const gradeTotal = Object.values(grade).reduce((s, v) => s + (Number(v) || 0), 0);
        const qty = Number(i.quantity) || 0;
        const fichas = gradeTotal > 0 ? Math.max(1, Math.round(qty / gradeTotal)) : 1;
        return { reference_id: i.reference_id, color: i.color || '', grade, unit_price: Number(i.unit_price) || 0, quantity: qty, fichas, strap_colors: (i.strap_colors as any[]) || [], material_variant_id: (i as any).material_variant_id || null };
      }));
    } else {
      setEditItems([{ ...emptyItem }]);
    }
    setEditDialogOpen(true);
    setDetailDialogOpen(false);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOrderId) return;
    const validItems = editItems.filter(i => i.reference_id);
    if (validItems.some(i => !i.color?.trim())) { toast.error('Selecione uma cor para todos os itens.'); return; }
    const total = validItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const rep = representatives.find(r => r.id === editForm.representative);
    const commission_value = rep ? total * rep.commission_pct / 100 : 0;
    updateOrder.mutate({ id: editOrderId, order: { ...editForm, representative: rep?.name || editForm.representative }, items: validItems, client_id: editSelectedClientId || null, representative_id: editForm.representative || null, commission_value });
    setEditDialogOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.reference_id);
    if (validItems.some(i => !i.color?.trim())) { toast.error('Selecione uma cor para todos os itens.'); return; }
    const total = validItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const rep = representatives.find(r => r.id === form.representative);
    const commission_value = rep ? total * rep.commission_pct / 100 : 0;
    createOrder.mutate({ order: { ...form, representative: rep?.name || form.representative }, items: validItems, client_id: selectedClientId || null, representative_id: form.representative || null, commission_value });
    setDialogOpen(false);
    setForm(emptyForm);
    setSelectedClientId('');
    setItems([{ ...emptyItem }]);
  };

  const openDupDialog = (orderId: string) => {
    setDupOrderId(orderId);
    setDupGroupId('');
    setDupSelectedClients([]);
    setDupClientSearch('');
    setDupDialog(true);
  };

  const handleDuplicate = async () => {
    if (!dupOrderId || dupSelectedClients.length === 0) return;
    const order = orders.find(o => o.id === dupOrderId);
    if (!order) return;
    const { data: orderItems, error: itemsFetchError } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', dupOrderId);
    if (itemsFetchError) {
      toast.error(`Erro ao ler itens do pedido original: ${itemsFetchError.message}`);
      return;
    }
    if (!orderItems || orderItems.length === 0) {
      toast.error('O pedido original não possui itens — duplicação cancelada.');
      return;
    }

    // Validate material_variant_id references before copying: variants may have been
    // deactivated or deleted since the original order was placed. Copying a stale ID
    // would silently block NF-e emission (emit-nfe returns 400 for inactive variants).
    const variantIdsInOrder = [...new Set(
      orderItems.map(i => (i as any).material_variant_id).filter(Boolean)
    )] as string[];
    let activeVariantIds = new Set<string>();
    if (variantIdsInOrder.length > 0) {
      const { data: activeVariants } = await (supabase as any)
        .from('reference_material_variants')
        .select('id')
        .in('id', variantIdsInOrder)
        .eq('active', true);
      activeVariantIds = new Set((activeVariants || []).map((v: any) => v.id));
      const staleCount = variantIdsInOrder.filter(id => !activeVariantIds.has(id)).length;
      if (staleCount > 0) {
        toast.warning(`${staleCount} variação(ões) de material inativa(s) — o campo será limpo nos itens copiados. Revise antes de faturar.`);
      }
    }

    let successCount = 0;
    const failures: string[] = [];
    for (const clientId of dupSelectedClients) {
      const client = clients.find(c => c.id === clientId);
      if (!client) continue;
      const newOrder: SaleOrderFormData = { client_name: client.razao_social, client_cnpj: client.cnpj || '', client_contact: client.contato || '', client_order_number: '', representative: order.representative || '', payment_condition: order.payment_condition || '', delivery_deadline: order.delivery_deadline || '', delivery_week: order.delivery_week || '', delivery_month: order.delivery_month || '', notes: order.notes || '', status: 'Rascunho', nfe: '', remessa: '', is_factoring: false, factoring_config_id: null as any, packaging_mode: (order.packaging_mode || 'individual_amarrado') as PackagingMode };
      const newItems: SaleOrderItemFormData[] = (orderItems || []).map(i => {
        const vid = (i as any).material_variant_id;
        return {
          reference_id: i.reference_id,
          color: i.color || '',
          grade: (i.grade as Record<string, number>) || {},
          unit_price: Number(i.unit_price) || 0,
          quantity: Number(i.quantity) || 0,
          fichas: (i as any).fichas || 1,
          strap_colors: (i.strap_colors as any[]) || [],
          material_variant_id: (vid && activeVariantIds.has(vid)) ? vid : null,
        };
      });
      try {
        await createOrder.mutateAsync({ order: newOrder, items: newItems, client_id: client.id });
        successCount++;
      } catch (err: any) {
        const msg = err?.message || 'erro desconhecido';
        failures.push(`${client.razao_social}: ${msg}`);
      }
    }
    if (successCount > 0) toast.success(`${successCount} pedido(s) duplicado(s)!`);
    if (failures.length > 0) {
      toast.error(`${failures.length} duplicação(ões) falharam`, { description: failures.slice(0, 3).join(' | ') });
    }
    if (failures.length === 0) setDupDialog(false);
  };

  const toggleDupClient = (clientId: string) => setDupSelectedClients(prev => prev.includes(clientId) ? prev.filter(id => id !== clientId) : [...prev, clientId]);
  const toggleAllDupClients = () => {
    if (dupSelectedClients.length === dupGroupClients.length) setDupSelectedClients([]);
    else setDupSelectedClients(dupGroupClients.map(c => c.id));
  };

  const openOrderDetails = async (order: any) => {
    setSelectedOrder(order);
    setDetailDialogOpen(true);
    setLoadingOrderItems(true);
    const { data: items, error } = await supabase.from('sale_order_items').select('*, technical_sheets(name, code, image_url, images)').eq('sale_order_id', order.id).order('created_at', { ascending: true });
    
    if (error) {
      toast.error(`Erro: ${error.message}`);
      setSelectedOrderItems([]);
    } else {
      // Fetch color variant images
      const refIds = [...new Set((items || []).map(i => i.reference_id))];
      const { data: colorVariants } = await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds);
      
      const mappedItems = (items || []).map(item => {
        const variant = colorVariants?.find(v => v.reference_id === item.reference_id && v.color === item.color);
        return { ...item, variant_image_url: variant?.image_url || '' };
      });
      // Sort by reference (code/name) then by color so items of the same reference appear together
      mappedItems.sort((a: any, b: any) => {
        const refA = (a.technical_sheets?.code || a.technical_sheets?.name || a.reference_id || '').toString();
        const refB = (b.technical_sheets?.code || b.technical_sheets?.name || b.reference_id || '').toString();
        const cmp = refA.localeCompare(refB, 'pt-BR', { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.color || '').localeCompare(b.color || '', 'pt-BR', { sensitivity: 'base' });
      });
      setSelectedOrderItems(mappedItems);
    }
    setLoadingOrderItems(false);
  };

  const handleBulkGenerateOPs = async () => {
    if (pendingOrders.length === 0) { toast.info('Nenhum pedido pendente.'); return; }

    // Pré-check de viabilidade: bloqueia approval em massa de PVs com
    // delivery_deadline anterior à data mínima viável (capacidade dos
    // 9 setores + buffer + supplier descontando POs pending). Pré-2026-06
    // o sistema aprovava sem checar — geravam OPs que entravam em ondas
    // com purchase_deadline já vencido.
    const infeasibleOrders = pendingOrders.filter((o) => {
      const min = minBillingMap.get(o.id);
      return min && o.delivery_deadline && o.delivery_deadline < min;
    });
    if (infeasibleOrders.length > 0) {
      const list = infeasibleOrders
        .slice(0, 5)
        .map((o) => `• ${o.order_number} (${formatDate(o.delivery_deadline)} → mín ${formatDate(minBillingMap.get(o.id) || null)})`)
        .join('\n');
      const more = infeasibleOrders.length > 5 ? `\n... e mais ${infeasibleOrders.length - 5}` : '';
      const ok = window.confirm(
        `${infeasibleOrders.length} pedido(s) com data INVIÁVEL — produção não cabe no prazo:\n\n${list}${more}\n\n` +
        'Aprovar mesmo assim? (Recomendado: ajustar a data primeiro)'
      );
      if (!ok) return;
    }

    setGeneratingOPs(true);
    let ordersProcessed = 0, opsCreated = 0;
    const errors: string[] = [];
    for (const order of pendingOrders) {
      try {
        // Atomic claim: flip status to Aprovado FIRST so only one concurrent
        // call (double-click, two browser tabs) wins the pipeline for this PV.
        const { data: pvClaimed, error: pvClaimErr } = await supabase
          .from('sale_orders')
          .update({ status: 'Aprovado' })
          .eq('id', order.id)
          .in('status', ['Pendente', 'Rascunho'])
          .select('id');
        if (pvClaimErr) { errors.push(`${order.order_number}: ${pvClaimErr.message}`); continue; }
        if (!pvClaimed || pvClaimed.length === 0) {
          errors.push(`${order.order_number}: já aprovado ou status alterado — ignorado.`);
          continue;
        }

        // AR idempotency: only insert if no active AR row exists for this PV
        const { data: existingBulkAR } = await supabase
          .from('accounts_receivable')
          .select('id')
          .eq('sale_order_id', order.id)
          .neq('status', 'cancelled')
          .limit(1);
        if (!existingBulkAR || existingBulkAR.length === 0) {
          const { error: arError } = await supabase.from('accounts_receivable').insert({ description: `PV ${order.order_number} - ${order.client_name}`, client_name: order.client_name, client_cnpj: order.client_cnpj || '', sale_order_id: order.id, category: 'venda', due_date: order.delivery_deadline || todayPlusDaysISO(30), amount: Number(order.total), amount_received: 0, status: 'pending', notes: order.payment_condition ? `Condição: ${order.payment_condition}` : '' } as any);
          if (arError) { errors.push(`${order.order_number}: ${arError.message}`); continue; }
        }
        const { data: pvItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', order.id);
        if (pvItems && pvItems.length > 0) {
          const createdBulkOps: Array<{ id: string; reference_id: string; quantity: number }> = [];
          let pvHadFailures = false;
          const pkgMode = (order as any).packaging_mode || 'individual_amarrado';
          for (const item of pvItems) {
            const grade = item.grade as Record<string, number> | null;
            const fichas = (item as any).fichas || 1;
            const scaledGrade: Record<string, number> = {};
            if (grade) {
              for (const [size, qty] of Object.entries(grade)) {
                const val = (Number(qty) || 0) * fichas;
                if (val > 0) scaledGrade[size] = val;
              }
            }
            const { data: createdOp, error: opError } = await supabase.from('orders').insert({ reference_id: item.reference_id, quantity: item.quantity, color: item.color || '', grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}), sale_order_id: order.id, sale_order_item_id: item.id, notes: `Gerada automaticamente do ${order.order_number}`, status: 'Reservado' }).select('id, reference_id, quantity').single();
            if (opError) { errors.push(`${order.order_number}: OP - ${opError.message}`); pvHadFailures = true; continue; }

            let opHadCriticalFailure = false;
            const { error: debitError } = await supabase.rpc('hybrid_debit_stock_for_order', { p_reference_id: item.reference_id, p_order_quantity: item.quantity, p_color: item.color || '', p_order_id: createdOp?.id || null, p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || null) } as any);
            if (debitError) { errors.push(`${order.order_number}: Estoque - ${debitError.message}`); opHadCriticalFailure = true; }

            if (!opHadCriticalFailure) {
              // FIX A3: process_order_stock_out removido — hybrid_debit_stock_for_order já cobre o BOM.

              // Debit sole stock by grade — capture error and attempt auto-PO
              if (Object.keys(scaledGrade).length > 0) {
                const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
                  p_reference_id: item.reference_id,
                  p_order_id: createdOp.id,
                  p_color: item.color || '',
                  p_order_grade: scaledGrade,
                } as any);
                if (soleError) {
                  errors.push(`${order.order_number}: Solado - ${soleError.message}`);
                  try {
                    const po = await autoCreateSolePO({
                      referenceId: item.reference_id,
                      orderId: createdOp.id,
                      color: item.color || '',
                      grade: scaledGrade,
                      orderRef: order.order_number,
                    });
                    if (po) errors.push(`${order.order_number}: OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}).`);
                  } catch (_e) { /* logged */ }
                }
              }
              // Debit strap materials
              const strapColors = item.strap_colors as any[];
              if (strapColors && strapColors.length > 0) {
                const { error: strapError } = await supabase.rpc('debit_strap_stock', { p_strap_colors: strapColors, p_order_quantity: item.quantity, p_order_id: createdOp?.id || null, p_order_grade: item.grade || null } as any);
                if (strapError) errors.push(`${order.order_number}: Tiras - ${strapError.message}`);
              }
              // Debit packaging stock — use the per-mode RPC (has internal SELECT FOR UPDATE
              // since 20260517130000). The atomic variant requires a resolved product id
              // and cannot do the packaging_configs lookup that this path needs.
              const { error: pkgError } = await supabase.rpc('debit_packaging_for_order', {
                p_sale_order_id: order.id,
                p_order_id: createdOp.id,
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_packaging_mode: pkgMode,
              } as any);
              if (pkgError) errors.push(`${order.order_number}: Embalagem - ${pkgError.message}`);

              createdBulkOps.push(createdOp);
              opsCreated++;
            } else {
              // Critical debit failed — run restore chain for any partial debits before cancelling.
              pvHadFailures = true;
              try {
                await supabase.rpc('release_order_reservations', { p_order_id: createdOp.id } as any);
              } catch (_) { /* best-effort */ }
              try {
                await supabase.rpc('restore_sole_grade_for_order', { p_order_id: createdOp.id } as any);
              } catch (_) { /* best-effort */ }
              try {
                await supabase.rpc('restore_product_stocks_for_order', { p_order_id: createdOp.id } as any);
              } catch (_) { /* best-effort */ }
              await supabase.from('orders')
                .update({ status: 'Cancelada', notes: 'Cancelada — falha no débito em aprovação em massa' })
                .eq('id', createdOp.id);
            }
          }
          // Generate production stages only for successfully debited OPs
          if (createdBulkOps.length > 0) {
            const refIds = [...new Set(createdBulkOps.map(op => op.reference_id))];
            const { data: sheetsData } = await supabase
              .from('technical_sheets')
              .select('id, production_sectors')
              .in('id', refIds);
            const sectorsMap = new Map<string, string[]>();
            sheetsData?.forEach((s: any) => {
              const sectors = Array.isArray(s.production_sectors) && s.production_sectors.length > 0
                ? s.production_sectors.map((x: any) => String(x))
                : ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'];
              sectorsMap.set(s.id, sectors);
            });
            const DEFAULT_STAGES = [
              { name: 'Corte Palmilha', order: 1 }, { name: 'Corte Forração', order: 2 },
              { name: 'Mesa', order: 3 }, { name: 'Silk', order: 4 },
              { name: 'Colagem', order: 5 }, { name: 'Montagem', order: 6 },
              { name: 'Solagem', order: 7 }, { name: 'Acabamento', order: 8 },
              { name: 'Expedição', order: 9 },
            ];
            for (const op of createdBulkOps) {
              const sectorNames = sectorsMap.get(op.reference_id) || DEFAULT_STAGES.map(s => s.name);
              const rows = sectorNames.map((name: string, idx: number) => {
                const ds = DEFAULT_STAGES.find(s => s.name === name);
                return {
                  order_id: op.id, stage_name: name,
                  stage_order: ds?.order || idx + 1, status: 'pendente',
                  quantity_total: op.quantity, quantity_processed: 0,
                };
              });
              await supabase.from('order_stages').insert(rows);
            }
          }
          if (pvHadFailures) {
            errors.push(`${order.order_number}: aprovação não concluída — corrija o estoque e reaprove.`);
            // Restore stock and cancel the OPs that DID succeed so they don't remain as
            // orphaned 'Reservado' OPs under a 'Pendente' PV, which would cause
            // double-debit if the PV is re-approved.
            if (createdBulkOps.length > 0) {
              const successOpIds = createdBulkOps.map(op => op.id);
              for (const op of createdBulkOps) {
                try { await supabase.rpc('release_order_reservations', { p_order_id: op.id } as any); } catch (_) {}
                try { await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id } as any); } catch (_) {}
                try { await supabase.rpc('restore_product_stocks_for_order', { p_order_id: op.id } as any); } catch (_) {}
              }
              await supabase.from('order_stages').delete().in('order_id', successOpIds);
              await supabase.from('orders')
                .update({ status: 'Cancelada', notes: 'Cancelada — aprovação em massa parcialmente falhou' })
                .in('id', successOpIds);
            }
            // Revert the atomic claim to the original status — a Rascunho PV that
            // fails approval must return to Rascunho, not be silently promoted to Pendente.
            await supabase.from('sale_orders').update({ status: order.status }).eq('id', order.id);
            continue;
          }
        }
        ordersProcessed++;
      } catch (err: any) { errors.push(`${order.order_number}: ${err.message}`); }
    }
    setGeneratingOPs(false);
    queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['accounts_receivable'] });
    queryClient.invalidateQueries({ queryKey: ['order_stages'] });
    if (ordersProcessed > 0) toast.success(`${ordersProcessed} pedido(s) aprovado(s), ${opsCreated} OP(s) gerada(s) com etapas!`);
    if (errors.length > 0) toast.warning(`Avisos: ${errors.slice(0, 3).join('; ')}`);
  };

  const handleExportSaleOrdersExcel = async (ordersToExport: typeof filteredOrders) => {
    if (ordersToExport.length === 0) { toast.error('Nenhum pedido para exportar.'); return; }

    // Build reference lookup: sale_order_id -> list of "Ref Nome/Código Cor"
    const refsByOrder: Record<string, string[]> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!refsByOrder[id]) refsByOrder[id] = [];
      const ref = refById[it.reference_id];
      const label = [ref?.code, ref?.name].filter(Boolean).join(' - ') || it.reference_id;
      const entry = it.color ? `${label} (${it.color})` : label;
      if (!refsByOrder[id].includes(entry)) refsByOrder[id].push(entry);
    });

    // Economic group lookup
    const groupById: Record<string, string> = {};
    economicGroups.forEach((g: any) => { groupById[g.id] = g.name; });

    // Sort by economic group name, then by client name (keeps stores from same group together)
    const sorted = [...ordersToExport].sort((a, b) => {
      const aGroupId = clientGroupMap[a.client_name] || '';
      const bGroupId = clientGroupMap[b.client_name] || '';
      const aGroup = groupById[aGroupId] || '';
      const bGroup = groupById[bGroupId] || '';
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup, 'pt-BR');
      return (a.client_name || '').localeCompare(b.client_name || '', 'pt-BR');
    });

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Pedidos de Venda');
    ws.columns = [
      { header: 'Grupo Econômico', key: 'grupo', width: 25 },
      { header: 'Razão Social', key: 'razao_social', width: 32 },
      { header: 'Nº Pedido Sistema', key: 'order_number', width: 18 },
      { header: 'Nº Pedido Cliente', key: 'client_order_number', width: 18 },
      { header: 'Cidade/UF', key: 'cidade', width: 22 },
      { header: 'Valor Total', key: 'total', width: 16 },
      { header: 'Qtd Pares', key: 'pares', width: 12 },
      { header: 'Referências', key: 'referencias', width: 50 },
      { header: 'Semana Faturamento', key: 'semana', width: 20 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Representante', key: 'representante', width: 22 },
    ];

    // Header style
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    sorted.forEach(order => {
      const client = clientByName[(order.client_name || '').toLowerCase()];
      const groupId = clientGroupMap[order.client_name] || '';
      const groupName = groupById[groupId] || '';
      const cidade = client ? [client.cidade, (client as any).estado].filter(Boolean).join('/') : '';
      const semana = (order as any).billing_week || order.delivery_week || '';
      ws.addRow({
        grupo: groupName,
        razao_social: order.client_name || '',
        order_number: order.order_number || '',
        client_order_number: order.client_order_number || '',
        cidade,
        total: Number(order.total || 0),
        pares: pairsBySaleOrder[order.id] || 0,
        referencias: (refsByOrder[order.id] || []).join(', '),
        semana,
        status: order.status || '',
        representante: order.representative || '',
      });
    });

    // Format currency column
    ws.getColumn('total').numFmt = '"R$"#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos_venda_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(`Excel gerado com ${sorted.length} pedido(s)!`);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-destructive font-medium">Erro ao carregar pedidos</p>
          <p className="text-sm text-muted-foreground">{error?.message || 'Tente recarregar a página'}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      
    );
  }

  return (
    <>
      <div className="w-full space-y-6 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · PV"
          title="Pedidos de Venda"
          description="Gestão comercial e geração de ordens de produção"
          actions={
            <>
            <Button onClick={() => navigate('/sales/new')} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo Pedido</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (selectedIds.size === 0) { toast.info('Selecione pelo menos um pedido.'); return; }
                const ids = Array.from(selectedIds).join(',');
                navigate(`/sales/consumo?ids=${ids}`);
              }}
              className="gap-2"
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Consumo</span>
              {selectedIds.size > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>}
            </Button>
            {/* "Sync Financeiro" removido em 2026-05: a sincronização
                financeira já acontece automaticamente ao faturar (via
                syncFinancialRecords no auto_bill_sale_order_on_finishing).
                Botão manual confundia usuários e abria espaço pra duplo-debit. */}
            <Button
              variant="outline"
              onClick={() => handleExportSaleOrdersExcel(selectedIds.size > 0 ? filteredOrders.filter(o => selectedIds.has(o.id)) : filteredOrders)}
              className="gap-2"
              title="Exportar Excel com todos os pedidos visíveis (ou selecionados)"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span className="hidden sm:inline">Excel</span>
              {selectedIds.size > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>}
            </Button>
            {selectedIds.size > 0 && (
              <>
                <Button variant="default" onClick={() => setOverviewOpen(true)} className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">Visão Geral</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>
                </Button>
                <Button variant="outline" onClick={handleOpenSummary} className="gap-2">
                  <ClipboardList className="h-4 w-4" />
                  <span className="hidden sm:inline">Resumo</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>
                </Button>
                <Button variant="outline" onClick={handleBulkPrint} className="gap-2">
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">Imprimir</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>
                </Button>
                <Button variant="outline" onClick={async () => {
                  if (selectedIds.size === 0) return;
                  const pw = openPrintWindow('Etiquetas térmicas');
                  try {
                    const selectedOrders = orders.filter(o => selectedIds.has(o.id));
                    const labels: Parameters<typeof buildThermalLabelsHtml>[0] = [];
                    for (const order of selectedOrders) {
                      const displayOrderNumber = order.client_order_number || order.order_number || '';
                      const { data: linkedOps } = await supabase.from('orders').select('id, order_number, reference_id, color, grade, quantity').eq('sale_order_id', order.id);
                      if (!linkedOps || linkedOps.length === 0) continue;
                      for (const op of linkedOps) {
                        const { data: refData } = await supabase.from('technical_sheets').select('image_url, images, shoe_category, code, name').eq('id', op.reference_id).single();
                        const rawRefImageUrl = ((refData as any)?.images as string[] | null)?.[0] || refData?.image_url || '';
                        const refImageUrl = await getSignedUrl(rawRefImageUrl);
                        const color = op.color || '';
                        const { data: variant } = await supabase.from('reference_color_variants').select('image_url').eq('reference_id', op.reference_id).eq('color', color).maybeSingle();
                        const imgUrl = variant?.image_url ? await getSignedUrl(variant.image_url) : refImageUrl;
                        const { data: matData } = await supabase.from('sheet_materials').select('products(name)').eq('sheet_id', op.reference_id).limit(1).maybeSingle();
                        const mainMaterial = (matData?.products as any)?.name || '';
                        const grade = op.grade as Record<string, number> | null;
                        if (grade && Object.keys(grade).length > 0) {
                          for (const [size, qty] of Object.entries(grade)) {
                            const count = Number(qty) || 0;
                            for (let i = 0; i < count; i++) {
                              labels.push({ 
                                refCode: refData?.code || '', 
                                refName: refData?.name || '', 
                                mainMaterial, 
                                color, 
                                size, 
                                barcode: refData?.barcode || op.order_number || '', 
                                imageUrl: imgUrl, 
                                shoeCategory: refData?.shoe_category || '', 
                                clientOrderNumber: displayOrderNumber 
                              });
                            }
                          }
                        } else {
                          const opQty = Number(op.quantity) || 0;
                          for (let i = 0; i < opQty; i++) {
                            labels.push({ 
                              refCode: refData?.code || '', 
                              refName: refData?.name || '', 
                              mainMaterial, 
                              color, 
                              size: '—', 
                              barcode: refData?.barcode || op.order_number || '', 
                              imageUrl: imgUrl, 
                              shoeCategory: refData?.shoe_category || '', 
                              clientOrderNumber: displayOrderNumber 
                            });
                          }
                        }
                      }
                    }
                    if (labels.length === 0) { toast.info('Nenhuma etiqueta para gerar.'); return; }
                    const logoUrl = new URL(logoImg, window.location.origin).href;
                    const html = buildThermalLabelsHtml(labels, logoUrl, { width: 100, height: 30 });
                    writeRawPrintWindow(pw, html);
                    toast.success(`${labels.length} etiqueta(s) gerada(s)`);
                  } catch (err: any) { toast.error(err.message); }
                }} className="gap-2">
                  <Tag className="h-4 w-4" />
                  <span className="hidden sm:inline">Etiquetas</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{selectedIds.size}</Badge>
                </Button>
              </>
            )}
            {pendingOrders.length > 0 && (
              <Button variant="outline" onClick={handleBulkGenerateOPs} disabled={generatingOPs} className="gap-2" title={`Aprovar ${pendingOrders.length} pendente(s)`}>
                {generatingOPs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Factory className="h-4 w-4" />}
                <span className="hidden sm:inline">Gerar OPs</span>
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{pendingOrders.length}</Badge>
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Isso irá estornar e re-debitar o estoque de TODAS as OPs ativas com base nas fichas técnicas atualizadas. Continuar?')) {
                    resyncOPs.mutate();
                  }
                }}
                disabled={resyncOPs.isPending}
                className="gap-2"
                title="Resincronizar OPs com fichas técnicas atualizadas"
              >
                {resyncOPs.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="hidden sm:inline">Resync Fichas</span>
              </Button>
            )}
            </>
          }
        />

        {/* Main tabs: Ativos vs Faturados */}
        <div className="flex items-center gap-1 border-b">
          <button
            type="button"
            onClick={() => setMainTab('ativos')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2',
              mainTab === 'ativos'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Pedidos Ativos
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{activeCount}</Badge>
          </button>
          <button
            type="button"
            onClick={() => setMainTab('faturados')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2',
              mainTab === 'faturados'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Faturados / Sem NF
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{billedCount}</Badge>
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Pedidos</p>
                <p className="text-xl font-bold">{kpis.count}</p>
                <p className="text-[10px] text-muted-foreground">{totalPares.toLocaleString('pt-BR')} pares</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Pendentes</p>
                <p className="text-xl font-bold">{kpis.pending}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Aprovados</p>
                <p className="text-xl font-bold">{kpis.approved}</p>
                <p className="text-[10px] text-muted-foreground">{kpis.inProduction} em produção</p>
              </div>
            </CardContent>
          </Card>
          {canSeeFinancialValues && (
            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <DollarSign className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Valor Total</p>
                  <p className="text-lg font-bold font-mono">{formatCurrency(kpis.total)}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <SmartSearch
                value={searchTerm}
                onChange={setSearchTerm}
                getSuggestions={searchSuggestions}
                placeholder="Buscar PV, cliente, representante, referência…"
              />
            </div>
            <Button
              variant={showFilters || activeFiltersCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="gap-2 h-9"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge variant="default" className="ml-1 h-5 px-1.5 text-[10px]">{activeFiltersCount}</Badge>
              )}
            </Button>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Limpar
              </Button>
            )}
          </div>

          {/* Filter Row */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Representante</Label>
                <Select value={filterRep} onValueChange={setFilterRep}>
                  <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {uniqueReps.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Grupo Econômico</Label>
                <Select value={filterGroup} onValueChange={setFilterGroup}>
                  <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {economicGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Segmento</Label>
                <Select value={filterSegment} onValueChange={setFilterSegment}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="Adulto">Adulto</SelectItem>
                    <SelectItem value="Infantil">Infantil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Mês Fat.</Label>
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {uniqueMonths.map(m => {
                      const [y, mo] = m.split('-').map(Number);
                      const label = new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                      return <SelectItem key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg border bg-primary/5 border-primary/20">
            <span className="text-sm font-medium">{selectedIds.size} pedido(s) selecionado(s)</span>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {/* Change Delivery Month/Week */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 h-8 text-xs">
                    <Clock className="h-3.5 w-3.5" /> Mês / Semana <ChevronDown className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3 space-y-2" align="end">
                  <div>
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">Mês de Faturamento</Label>
                    <Select value={bulkMonth} onValueChange={(v) => { setBulkMonth(v); setBulkWeek(''); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o mês..." /></SelectTrigger>
                      <SelectContent>
                        {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">Semana de Faturamento</Label>
                    <Select value={bulkWeek} onValueChange={setBulkWeek} disabled={!bulkMonth}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={bulkMonth ? "Selecione a semana..." : "Selecione o mês primeiro"} /></SelectTrigger>
                      <SelectContent>
                        {bulkWeekOptions.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" className="w-full h-8 text-xs" onClick={handleBulkUpdateDelivery} disabled={!bulkMonth && !bulkWeek}>
                    Aplicar a {selectedIds.size} pedido(s)
                  </Button>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 h-8 text-xs">
                    Alterar Status <ChevronDown className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1" align="end">
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                      onClick={() => handleBulkStatusChange(s)}
                    >
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                      {s}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <DeleteConfirmButton
                onConfirm={handleBulkDelete}
                title={`Excluir ${selectedIds.size} pedido(s)?`}
                size="h-8 w-8"
                iconSize="h-3.5 w-3.5"
              />
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        {filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ShoppingCart className="h-10 w-10 mb-3 opacity-50" />
              <p>{orders.length === 0 ? 'Nenhum pedido de venda' : 'Nenhum pedido encontrado com os filtros atuais'}</p>
              {activeFiltersCount > 0 && (
                <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">Limpar filtros</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="font-semibold">Nº Pedido</TableHead>
                  <TableHead className="font-semibold">Nº Cliente</TableHead>
                  <TableHead className="font-semibold">Cliente</TableHead>
                  <TableHead className="font-semibold">Cidade</TableHead>
                  {canSeeFinancialValues && <TableHead className="font-semibold text-right">Total</TableHead>}
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold text-right">Pares</TableHead>
                  <TableHead className="font-semibold">Entrega / Fat.</TableHead>
                  <TableHead className="font-semibold text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map(order => {
                  const isSelected = selectedIds.has(order.id);
                  const isOverdue = order.delivery_deadline && new Date(order.delivery_deadline) < new Date() && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado';
                  const isInformal = (order as any).nfe_required === false;
                  return (
                    <TableRow
                      key={order.id}
                      className={cn(
                        "group transition-colors cursor-pointer",
                        isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/50",
                        isOverdue && "border-l-4 border-l-destructive",
                        isInformal && !isSelected && "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]"
                      )}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, a, [role="combobox"], [role="checkbox"], [data-radix-collection-item], [role="menuitem"]')) return;
                        openOrderDetails(order);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(order.id)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openOrderDetails(order); }}
                              className="font-mono text-sm text-primary hover:underline font-bold text-left w-fit"
                            >
                              {order.order_number || '—'}
                            </button>
                            {isInformal && (
                              <Badge variant="outline" className="h-4 px-1.5 text-[9px] uppercase font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40">
                                Sem NF
                              </Badge>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground uppercase font-medium">{formatDate(order.created_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {order.client_order_number || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col max-w-[220px]">
                          <span className="font-semibold text-sm truncate">{order.client_name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{order.client_cnpj || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm truncate max-w-[120px]">
                            {(() => {
                              const client = clientByName[(order.client_name || '').toLowerCase()];
                              return client ? [client.cidade, client.estado].filter(Boolean).join('/') : '—';
                            })()}
                          </span>
                        </div>
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end">
                            <span className="font-mono font-bold text-sm text-primary">{formatCurrency(Number(order.total))}</span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select value={order.status} onValueChange={async (v) => {
                          try {
                            await updateStatus.mutateAsync({ id: order.id, status: v });
                          } catch (err: any) {
                            toast.error(`Erro ao atualizar status: ${err.message}`);
                          }
                        }}>
                          <SelectTrigger className="h-7 w-[130px] text-xs border-0 bg-transparent p-0 shadow-none">
                            <Badge variant="outline" className={`${STATUS_COLORS[order.status] || ''} text-xs`}>
                              <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${STATUS_DOT[order.status]}`} />
                              {order.status}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map(s => (
                              <SelectItem key={s} value={s}>
                                <span className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                                  {s}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-semibold">
                        {(pairsBySaleOrder[order.id] || 0).toLocaleString('pt-BR')}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-xs',
                          (isOverdue || isInfeasible) ? 'text-destructive font-semibold' : 'text-muted-foreground'
                        )}
                        title={
                          isInfeasible && minBilling
                            ? `DATA INVIÁVEL — mínima necessária: ${formatDate(minBilling)} (considera estoque, supplier lead time descontando POs em trânsito, e capacidade dos 9 setores).`
                            : isOverdue
                              ? 'Prazo de entrega já passou.'
                              : undefined
                        }
                      >
                        <div className="flex flex-col">
                          <span>
                            {formatDate(order.delivery_deadline)}
                            {(isOverdue || isInfeasible) && <span className="ml-1 text-[10px]">⚠</span>}
                          </span>
                          {isInfeasible && minBilling && (
                            <span className="text-[10px] font-mono text-destructive font-bold">
                              MÍN: {formatDate(minBilling)}
                            </span>
                          )}
                          {!isInfeasible && (order.delivery_month || order.delivery_week) && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {[order.delivery_month, order.delivery_week].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerar PDF" onClick={async () => {
                            const { data: oi } = await supabase.from('sale_order_items').select('*, technical_sheets(name, code, image_url, images)').eq('sale_order_id', order.id);
                            const refIds = [...new Set((oi || []).map(i => i.reference_id))];
                            const { data: colorVariants } = await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds);
                            printHtml(`PV ${order.order_number}`, await buildSaleOrderPrintHtml(order, oi || [], colorVariants || []));
                          }}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar por grupo" onClick={() => openDupDialog(order.id)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => navigate(`/sales/edit/${order.id}`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Consumo de materiais" onClick={() => { setQuickConsumptionId(order.id); setQuickConsumptionNumber(order.order_number); }}>
                            <Package className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                              title="Forçar Produção (admin)"
                              onClick={async () => {
                                if (!confirm(`Forçar produção do pedido ${order.order_number}?\n\nIsso irá colocar o pedido em "Em Produção", criar OPs ausentes e gerar etapas. Apenas administradores podem executar.`)) return;
                                try {
                                  const { data, error } = await supabase.rpc('force_sale_order_production', { p_sale_order_id: order.id } as any);
                                  if (error) throw error;
                                  const r = (data as any) || {};
                                  toast.success(`Produção forçada • ${r.created_ops ?? 0} OP(s) criada(s), ${r.updated_ops ?? 0} atualizada(s), ${r.created_stages ?? 0} etapa(s) geradas`);
                                  queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
                                  queryClient.invalidateQueries({ queryKey: ['orders'] });
                                  queryClient.invalidateQueries({ queryKey: ['order_stages'] });
                                } catch (err: any) {
                                  toast.error(`Erro ao forçar produção: ${err.message}`);
                                }
                              }}
                            >
                              <Zap className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <DeleteConfirmButton onConfirm={() => deleteOrder.mutate(order.id)} title="Excluir pedido?" size="h-7 w-7" iconSize="h-3.5 w-3.5" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* Table Footer Summary */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/30 text-sm">
              <span className="text-muted-foreground">{filteredOrders.length} pedido(s){filteredOrders.length !== orders.length ? ` de ${orders.length}` : ''}</span>
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground">
                  Total: <span className="font-bold font-mono text-foreground">{formatCurrency(filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0))}</span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NEW ORDER DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={closeCreateDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo Pedido de Venda</DialogTitle></DialogHeader>
          <SaleOrderFormPanel form={form} setForm={setForm} items={items} setItems={setItems} clients={clients} representatives={representatives} references={references} isAdmin={isAdmin} selectedClientId={selectedClientId} onClientSelect={handleClientSelect} onSubmit={handleSubmit} onCancel={() => closeCreateDialog(false)} isPending={createOrder.isPending} submitLabel="Criar Pedido" />
        </DialogContent>
      </Dialog>

      {/* ORDER DETAILS DIALOG */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 flex-wrap">
                <span>Pedido {selectedOrder?.order_number || ''}</span>
                {selectedOrder && <Badge variant="outline" className={STATUS_COLORS[selectedOrder.status] || ''}><span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${STATUS_DOT[selectedOrder.status]}`} />{selectedOrder.status}</Badge>}
                <PvOutdatedBadge saleOrderId={selectedOrder?.id || null} />
              </div>
              {selectedOrder && (
                <div className="flex items-center gap-2">
                  {isAdmin && <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailDialogOpen(false); navigate(`/sales/edit/${selectedOrder.id}`); }}><Pencil className="h-3.5 w-3.5" /> Editar</Button>}
                  {/* Botão "Aprovar" individual — só aparece em Rascunho.
                      Sem esse botão, o usuário só conseguia aprovar via "Gerar OPs"
                      em massa (o que aprovava TODOS os Rascunhos de uma vez).
                      Aqui flipa apenas o status (sem gerar OPs ainda). */}
                  {isAdmin && selectedOrder.status === 'Rascunho' && (
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                      onClick={async () => {
                        if (!confirm(`Aprovar o pedido ${selectedOrder.order_number}? Isso permite incluir em ondas de produção.`)) return;
                        const { error } = await supabase
                          .from('sale_orders')
                          .update({ status: 'Aprovado' })
                          .eq('id', selectedOrder.id)
                          .eq('status', 'Rascunho');
                        if (error) {
                          toast.error(`Erro ao aprovar: ${error.message}`);
                          return;
                        }
                        toast.success(`Pedido ${selectedOrder.order_number} aprovado.`);
                        queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
                        setDetailDialogOpen(false);
                      }}
                    >
                      <CheckCircle className="h-3.5 w-3.5" /> Aprovar
                    </Button>
                  )}
                  {isAdmin && (selectedOrder.status === 'Aprovado' || selectedOrder.status === 'Em Produção') && (
                    <Button variant="outline" size="sm" className="gap-2" disabled={resyncPVOPs.isPending} onClick={() => {
                      if (confirm('Isso irá excluir as OPs atuais e recriar com base nos itens atuais do pedido. Continuar?')) {
                        resyncPVOPs.mutate(selectedOrder.id);
                      }
                    }}>
                      {resyncPVOPs.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Resync OPs
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setConsumptionDialogOpen(true)}><ClipboardList className="h-3.5 w-3.5" /> Consumo de materiais</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setMarginDialogOpen(true)}><TrendingUp className="h-3.5 w-3.5" /> Margem</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={async () => { try { await printAllSectorsForSaleOrder(selectedOrder.id, selectedOrder.order_number); } catch (err: any) { toast.error(err.message); } }}><FileText className="h-3.5 w-3.5" /> OPs</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={async () => { const { data: oi } = await supabase.from('sale_order_items').select('*, technical_sheets(name, code, image_url, images)').eq('sale_order_id', selectedOrder.id); const refIds = [...new Set((oi || []).map(i => i.reference_id))]; const { data: colorVariants } = await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds); printHtml(`PV ${selectedOrder.order_number}`, await buildSaleOrderPrintHtml(selectedOrder, oi || [], colorVariants || [])); }}><FileText className="h-3.5 w-3.5" /> Gerar PDF</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                    const pw = openPrintWindow('Etiquetas térmicas');
                    try {
                      const { data: linkedOps } = await supabase.from('orders').select('id, order_number, reference_id, color, grade, quantity, sale_order_id').eq('sale_order_id', selectedOrder.id);
                      if (!linkedOps || linkedOps.length === 0) { toast.info('Nenhuma OP vinculada a este pedido.'); pw.close(); return; }
                      const labels: Parameters<typeof buildThermalLabelsHtml>[0] = [];
                      const displayOrderNumber = selectedOrder.client_order_number || selectedOrder.order_number || '';
                      
                      for (const op of linkedOps) {
                        const { data: refData } = await supabase.from('technical_sheets').select('image_url, images, shoe_category, code, name').eq('id', op.reference_id).single();
                        const rawRefImgUrl = ((refData as any)?.images as string[] | null)?.[0] || refData?.image_url || '';
                        const refImageUrl = await getSignedUrl(rawRefImgUrl);
                        const color = op.color || '';
                        
                        const { data: variant } = await supabase.from('reference_color_variants').select('image_url').eq('reference_id', op.reference_id).eq('color', color).maybeSingle();
                        const imgUrl = variant?.image_url ? await getSignedUrl(variant.image_url) : refImageUrl;
                        
                        const { data: matData } = await supabase.from('sheet_materials').select('products(name)').eq('sheet_id', op.reference_id).limit(1).maybeSingle();
                        const mainMaterial = (matData?.products as any)?.name || '';
                        
                        const grade = op.grade as Record<string, number> | null;
                        if (grade && Object.keys(grade).length > 0) {
                          for (const [size, qty] of Object.entries(grade)) {
                            const count = Number(qty) || 0;
                            for (let i = 0; i < count; i++) {
                              labels.push({ 
                                refCode: refData?.code || '', 
                                refName: refData?.name || '', 
                                mainMaterial, 
                                color, 
                                size, 
                                barcode: refData?.barcode || op.order_number || '', 
                                imageUrl: imgUrl, 
                                shoeCategory: refData?.shoe_category || '', 
                                clientOrderNumber: displayOrderNumber 
                              });
                            }
                          }
                        } else {
                          const opQty = Number(op.quantity) || 0;
                          for (let i = 0; i < opQty; i++) {
                            labels.push({ 
                              refCode: refData?.code || '', 
                              refName: refData?.name || '', 
                              mainMaterial, 
                              color, 
                              size: '—', 
                              barcode: refData?.barcode || op.order_number || '', 
                              imageUrl: imgUrl, 
                              shoeCategory: refData?.shoe_category || '', 
                              clientOrderNumber: displayOrderNumber 
                            });
                          }
                        }
                      }
                      if (labels.length === 0) { toast.info('Nenhuma etiqueta para gerar.'); pw.close(); return; }
                      const logoUrl = new URL(logoImg, window.location.origin).href;
                      const html = buildThermalLabelsHtml(labels, logoUrl, { width: 100, height: 30 });
                      writeRawPrintWindow(pw, html);
                      toast.success(`${labels.length} etiqueta(s) gerada(s)`);
                    } catch (err: any) { toast.error(err.message); pw.close(); }
                  }}><Tag className="h-3.5 w-3.5" /> Etiquetas</Button>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/40 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <p><span className="font-semibold">Representante:</span> {selectedOrder.representative || '—'}</p>
                      <p><span className="font-semibold">Cliente:</span> {selectedOrder.client_name || '—'}</p>
                      <p><span className="font-semibold">CNPJ:</span> <span className="font-mono">{selectedOrder.client_cnpj || '—'}</span></p>
                      <p><span className="font-semibold">Contato:</span> {selectedOrder.client_contact || '—'}</p>
                      {selectedOrder.client_order_number && <p><span className="font-semibold">Nº Pedido Cliente:</span> <span className="font-mono">{selectedOrder.client_order_number}</span></p>}
                      <p><span className="font-semibold">Criado em:</span> {new Date(selectedOrder.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="text-right space-y-0.5">
                      <p><span className="font-semibold">Pagamento:</span> {selectedOrder.payment_condition || '—'}</p>
                      <p><span className="font-semibold">Entrega:</span> {selectedOrder.delivery_deadline ? new Date(selectedOrder.delivery_deadline).toLocaleDateString('pt-BR') : '—'}</p>
                      {canSeeFinancialValues && selectedOrder.commission_value > 0 && <p><span className="font-semibold">Comissão:</span> <span className="font-mono">{formatCurrency(Number(selectedOrder.commission_value))}</span></p>}
                    </div>
                  </div>
                </div>
                {selectedOrder.notes && <div className="px-4 py-2 border-t text-sm"><span className="font-semibold">Observação:</span> {selectedOrder.notes}</div>}
              </div>

              <div className="rounded-lg border bg-card overflow-hidden">
                {loadingOrderItems ? (
                  <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...</div>
                ) : selectedOrderItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">Nenhum item</div>
                ) : (
                  <div className="divide-y">
                    <div className={cn(
                      'grid items-center bg-muted/60 px-4 py-2 text-xs font-semibold text-muted-foreground',
                      canSeeFinancialValues
                        ? 'grid-cols-[1fr_auto_auto_auto_auto_auto]'
                        : 'grid-cols-[1fr_auto_auto_auto]'
                    )}>
                      <span>Ref. / Descrição</span>
                      <span className="w-20 text-right">PDV</span>
                      <span className="w-[220px] text-center">Grade</span>
                      <span className="w-16 text-center">Qtd</span>
                      {canSeeFinancialValues && <span className="w-20 text-right">Unitário</span>}
                      {canSeeFinancialValues && <span className="w-24 text-right">Total</span>}
                    </div>
                    {selectedOrderItems.map((item) => {
                      const grade = (item.grade || {}) as Record<string, number>;
                      const gradeEntries = Object.entries(grade).filter(([, qty]) => Number(qty) > 0).sort((a, b) => Number(a[0]) - Number(b[0]));
                      const gradePairs = gradeEntries.reduce((s, [, qty]) => s + Number(qty), 0);
                      const totalQty = Number(item.quantity || 0);
                      const fichas = gradePairs > 0 ? Math.round(totalQty / gradePairs) : 1;
                      const unit = Number(item.unit_price || 0);
                      const refName = (item as any).technical_sheets?.name || '—';
                      const refCode = (item as any).technical_sheets?.code || '';
                      const tsImages = (item as any).technical_sheets?.images as string[] | null;
                      const refImage = item.variant_image_url || (tsImages && tsImages.length > 0 ? tsImages[0] : ((item as any).technical_sheets?.image_url || ''));
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'grid items-start px-4 py-3 gap-2 hover:bg-muted/20 transition-colors',
                            canSeeFinancialValues
                              ? 'grid-cols-[1fr_auto_auto_auto_auto_auto]'
                              : 'grid-cols-[1fr_auto_auto_auto]',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            {refImage ? <img src={refImage} alt={refName} className="h-12 w-12 rounded object-cover border shrink-0" /> : <div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-muted-foreground text-[10px] shrink-0">Sem foto</div>}
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold">{refCode} - {refName}</p>
                              <p className="text-sm">{item.color || '—'}</p>
                              {(item.strap_colors as any[])?.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2 p-2 rounded bg-muted/30 border border-border/40">
                                  <p className="text-[9px] font-bold text-muted-foreground uppercase w-full">Cores das Tiras:</p>
                                  {(item.strap_colors as any[]).map((s: any, sIdx: number) => (
                                    <div key={sIdx} className="flex items-center gap-1.5 bg-background px-2 py-0.5 rounded border text-[10px]">
                                      <span className="font-semibold text-muted-foreground truncate max-w-[60px]">{s.label || `TIRA ${sIdx + 1}`}:</span>
                                      <span className="font-bold text-primary">{s.color || '—'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="w-20 text-right text-sm font-mono pt-1" />
                          <div className="w-[220px] text-center space-y-1 pt-0.5">
                            {gradeEntries.length > 0 ? (
                              <>
                                <p className="text-[10px] text-muted-foreground">Grade: {gradePairs} pares × {fichas} fichas</p>
                                <div className="flex justify-center gap-0">
                                  <table className="border-collapse">
                                    <thead><tr>{gradeEntries.map(([size]) => <th key={size} className="px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium border border-border/50 bg-muted/40">{size}</th>)}</tr></thead>
                                    <tbody>
                                      <tr>{gradeEntries.map(([size, qty]) => <td key={size} className="px-1.5 py-0.5 text-xs font-mono font-semibold text-center border border-border/50">{qty}</td>)}</tr>
                                      {fichas > 1 && <tr className="bg-muted/40">{gradeEntries.map(([size, qty]) => <td key={size} className="px-1.5 py-0.5 text-xs font-mono font-bold text-center border border-border/50">{Number(qty) * fichas}</td>)}</tr>}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                          <div className="w-16 text-center font-mono font-bold text-sm pt-1">{totalQty}</div>
                          {canSeeFinancialValues && (
                            <>
                              <div className="w-20 text-right font-mono text-sm pt-1">{formatCurrency(unit)}</div>
                              <div className="w-24 text-right font-mono font-bold text-sm pt-1">{formatCurrency(totalQty * unit)}</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-1 text-sm">
                <p><span className="text-muted-foreground">Itens:</span> <span className="font-bold font-mono">{selectedOrderItems.reduce((s, i) => s + Number(i.quantity || 0), 0)}</span></p>
                {canSeeFinancialValues && (
                  <p><span className="text-muted-foreground">Total:</span> <span className="font-bold font-mono text-lg">{loadingOrderItems ? '—' : formatCurrency(selectedOrderItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0))}</span></p>
                )}
              </div>

              {/* PV informal: aviso no lugar do painel NF-e */}
              {(selectedOrder as any).nfe_required === false && selectedOrderNfes.length === 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <p className="font-semibold text-amber-700 dark:text-amber-300">Pedido informal — sem NF-e</p>
                    <p className="text-muted-foreground mt-0.5">
                      Material e produção debitam normalmente. Não emite nota, não gera conta a receber.
                      Vai pra <strong>Finalizado s/ NF</strong> ao ser expedido.
                    </p>
                  </div>
                </div>
              )}

              {/* NF-e panel — só pra PVs formais (nfe_required=true) ou que já têm NF emitida */}
              {(selectedOrder as any).nfe_required !== false && (selectedOrder.status === 'Faturado' || selectedOrder.status === 'Aprovado' || selectedOrderNfes.length > 0) && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Receipt className="h-4 w-4" />
                      NF-e
                    </div>
                    <div className="flex items-center gap-2">
                      {companies.length > 0 && (
                        <Select value={nfeCompanyId || '__primary__'} onValueChange={v => setNfeCompanyId(v === '__primary__' ? '' : v)}>
                          <SelectTrigger className="h-7 text-xs w-52">
                            <SelectValue placeholder="Empresa principal" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__primary__">Empresa principal</SelectItem>
                            {companies.map(c => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome_fantasia || c.razao_social}
                                {c.is_primary ? ' ★' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {(selectedOrder.status === 'Faturado' || selectedOrder.status === 'Aprovado') && (
                        <Button size="sm" className="h-7 text-xs gap-1.5" disabled={emitNfe.isPending}
                          onClick={() => emitNfe.mutate({ saleOrderId: selectedOrder.id, companyId: nfeCompanyId || undefined })}>
                          {emitNfe.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />}
                          Emitir NF-e
                        </Button>
                      )}
                    </div>
                  </div>
                  {selectedOrderNfes.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-4 py-3">Nenhuma NF-e emitida para este pedido.</p>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {selectedOrderNfes.map((nfe: any) => (
                        <div key={nfe.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {nfe.status === 'autorizada' && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
                              {nfe.status === 'processando' && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                              {(nfe.status === 'rejeitada' || nfe.status === 'erro') && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                              {nfe.status === 'cancelada' && <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-medium capitalize">{nfe.status}</span>
                              {nfe.numero && <span className="text-muted-foreground">NF {nfe.numero}/{nfe.serie}</span>}
                              {nfe.cnpj_emitente && <span className="text-xs text-muted-foreground">CNPJ {nfe.cnpj_emitente}</span>}
                            </div>
                            {nfe.motivo_rejeicao && <p className="text-xs text-red-500 mt-0.5 truncate" title={nfe.motivo_rejeicao}>{nfe.motivo_rejeicao}</p>}
                            <p className="text-xs text-muted-foreground">{new Date(nfe.created_at).toLocaleString('pt-BR')}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {nfe.status === 'processando' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Verificar status" onClick={() => checkNfeStatus.mutate(nfe.id)}>
                                {checkNfeStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              </Button>
                            )}
                            {nfe.danfe_url && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="DANFE" asChild>
                                <a href={nfe.danfe_url} target="_blank" rel="noopener noreferrer"><Download className="h-3 w-3" /></a>
                              </Button>
                            )}
                            {nfe.xml_url && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="XML" asChild>
                                <a href={nfe.xml_url} target="_blank" rel="noopener noreferrer"><FileText className="h-3 w-3" /></a>
                              </Button>
                            )}
                            {nfe.status === 'autorizada' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" title="Cancelar NF-e"
                                onClick={() => { setCancelNfeTarget({ id: nfe.id, numero: nfe.numero }); setCancelJustificativa(''); }}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            )}
                            {nfe.status === 'autorizada' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700" title="Emitir NF-e de devolução"
                                onClick={() => setDevolucaoTarget({ id: nfe.id, numero: nfe.numero })}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* NF-e cancel dialog */}
      <Dialog open={!!cancelNfeTarget} onOpenChange={() => setCancelNfeTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-4 w-4" /> Cancelar NF-e {cancelNfeTarget?.numero}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">A justificativa deve ter ao menos 15 caracteres e será enviada à SEFAZ.</p>
            <div>
              <Label>Justificativa</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px]"
                value={cancelJustificativa}
                onChange={e => setCancelJustificativa(e.target.value)}
                placeholder="Motivo do cancelamento..."
              />
              <p className="text-xs text-muted-foreground mt-1">{cancelJustificativa.length}/15 mínimo</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCancelNfeTarget(null)}>Voltar</Button>
            <Button variant="destructive"
              disabled={cancelJustificativa.trim().length < 15 || cancelNfe.isPending}
              onClick={async () => {
                if (!cancelNfeTarget) return;
                await cancelNfe.mutateAsync({ nfeId: cancelNfeTarget.id, justificativa: cancelJustificativa, dataEmissao: (cancelNfeTarget as any).data_emissao });
                setCancelNfeTarget(null);
              }}>
              {cancelNfe.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
              Confirmar Cancelamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* NF-e devolução dialog */}
      {devolucaoTarget && selectedOrder && (
        <NfeDevolucaoDialog
          open={!!devolucaoTarget}
          onOpenChange={(v) => { if (!v) setDevolucaoTarget(null); }}
          nfeId={devolucaoTarget.id}
          nfeNumero={devolucaoTarget.numero}
          saleOrderId={selectedOrder.id}
          clientName={selectedOrder.client_name}
        />
      )}

      {/* DUPLICATE DIALOG */}
      <Dialog open={dupDialog} onOpenChange={setDupDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Duplicar por Grupo Econômico</DialogTitle></DialogHeader>
          {/* Audit visual: aviso explícito sobre impacto de estoque/reservas.
              Usuário não esperava que duplicar PV gerasse N reservas novas. */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mt-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-700 dark:text-amber-300">
              <p className="font-semibold mb-1">A duplicação reservará insumos novamente</p>
              <p>
                Cada cliente selecionado vira um novo PV com mesmos itens — gerando reservas
                independentes em <span className="font-mono">products.reserved_stock</span>. Verifique
                a disponibilidade de materiais antes de confirmar pra evitar superalocação.
              </p>
            </div>
          </div>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Grupo Econômico</Label>
              <Select value={dupGroupId} onValueChange={v => { setDupGroupId(v); setDupSelectedClients([]); setDupClientSearch(''); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um grupo" /></SelectTrigger>
                <SelectContent>{economicGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {dupGroupId && dupGroupClients.length > 0 && (() => {
              const searchLower = dupClientSearch.toLowerCase().trim();
              const filteredClients = searchLower
                ? dupGroupClients.filter(c =>
                    c.razao_social.toLowerCase().includes(searchLower) ||
                    (c.nome_fantasia && c.nome_fantasia.toLowerCase().includes(searchLower)) ||
                    (c.cnpj && c.cnpj.includes(searchLower))
                  )
                : dupGroupClients;
              return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Lojas do Grupo</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllDupClients} className="text-xs">{dupSelectedClients.length === dupGroupClients.length ? 'Desmarcar todos' : 'Selecionar todos'}</Button>
                </div>
                <Input
                  placeholder="Pesquisar loja..."
                  value={dupClientSearch}
                  onChange={e => setDupClientSearch(e.target.value)}
                  className="h-9"
                />
                <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
                  {filteredClients.map(c => (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={dupSelectedClients.includes(c.id)} onCheckedChange={() => toggleDupClient(c.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.razao_social}</div>
                        {c.cnpj && <div className="text-xs text-muted-foreground font-mono">{c.cnpj}</div>}
                      </div>
                    </label>
                  ))}
                  {filteredClients.length === 0 && <p className="text-xs text-muted-foreground p-3">Nenhuma loja encontrada.</p>}
                </div>
                <p className="text-xs text-muted-foreground">{dupSelectedClients.length} de {dupGroupClients.length} selecionadas</p>
              </div>
              );
            })()}
            {dupGroupId && dupGroupClients.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cliente ativo neste grupo.</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDupDialog(false)}>Cancelar</Button>
              <Button onClick={handleDuplicate} disabled={dupSelectedClients.length === 0 || createOrder.isPending}>
                {createOrder.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                Duplicar ({dupSelectedClients.length})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={editDialogOpen} onOpenChange={closeEditDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Pedido de Venda</DialogTitle></DialogHeader>
          <SaleOrderFormPanel form={editForm} setForm={setEditForm} items={editItems} setItems={setEditItems} clients={clients} representatives={representatives} references={references} isAdmin={isAdmin} selectedClientId={editSelectedClientId} onClientSelect={handleEditClientSelect} onSubmit={handleEditSubmit} onCancel={() => closeEditDialog(false)} isPending={updateOrder.isPending} submitLabel="Salvar Alterações" />
        </DialogContent>
      </Dialog>

      {/* Summary Dialog */}
      <Dialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Consumo de Materiais — {summaryData.orders.length} pedido(s)</DialogTitle>
          </DialogHeader>
          {loadingSummary ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <SummaryConsumptionPanel saleOrderIds={summaryData.orders.map((o: any) => o.id)} />
          )}
        </DialogContent>
      </Dialog>

      <SaleOrdersOverviewDialog
        open={overviewOpen}
        onOpenChange={setOverviewOpen}
        orders={orders.filter(o => selectedIds.has(o.id))}
      />

      <MaterialConsumptionDialog
        open={consumptionDialogOpen}
        onOpenChange={setConsumptionDialogOpen}
        saleOrderId={selectedOrder?.id || null}
        orderNumber={selectedOrder?.order_number || ''}
      />

      <MaterialConsumptionDialog
        open={!!quickConsumptionId}
        onOpenChange={(v) => { if (!v) setQuickConsumptionId(null); }}
        saleOrderId={quickConsumptionId}
        orderNumber={quickConsumptionNumber}
      />

      <MarginDialog
        open={marginDialogOpen}
        onOpenChange={setMarginDialogOpen}
        saleOrderId={selectedOrder?.id || null}
        orderNumber={selectedOrder?.order_number || ''}
        total={Number(selectedOrder?.total) || 0}
      />
    </>
  );
}
