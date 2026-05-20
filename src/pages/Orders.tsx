import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery } from '@tanstack/react-query';
import { ClipboardText as ClipboardList, Trash as Trash2, CircleNotch as Loader2, Warning as AlertTriangle, CheckCircle as CheckCircle2, Printer, Factory, Funnel as Filter, MagnifyingGlass as Search, Calendar, Stack as Layers, X, CaretDown as ChevronDown, Checks as CheckCheck, PencilSimple as Pencil, FileText, Square, CheckSquare, FileXls as FileSpreadsheet, Check, CaretUpDown as ChevronsUpDown, Package, Image as ImageIcon, Plus, CaretUp as ChevronUp, DotsThree as MoreHorizontal, Download, GridFour as LayoutGrid, List, ArrowRight } from '@phosphor-icons/react';
import { BulkActionsBar, MarqueeOverlay } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import OrdersKanbanBoard from '@/components/orders/OrdersKanbanBoard';
import { EmptyState } from '@/components/ui/empty-state';
import { autoCreateSolePO } from '@/lib/soleAutoPO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusPill, canonicalStatusToKey } from '@/components/ui/badges';
import { Checkbox } from '@/components/ui/checkbox';

import { useOrders, useCreateOrder, useDeleteOrder, useCheckStockAvailability, useUpdateOrderStatus } from '@/hooks/useOrders';
import { useTechnicalSheets, useSheetMaterials } from '@/hooks/useTechnicalSheets';
import { useProducts } from '@/hooks/useProducts';
import { useAllOrderStages, useCreateOrderStages, useRealtimeOrderStages, OrderStage } from '@/hooks/useOrderStages';
import { supabase } from '@/integrations/supabase/client';
import { printHtml, buildProductionOrderPrintHtml, openPrintWindow, writePrintWindow } from '@/lib/printOrder';
import { getClientLogoUrl } from '@/lib/getClientLogo';

import { useOrderStraps } from '@/hooks/useOrderStraps';
import { OrderFormData } from '@/types/references';
import { toast } from 'sonner';
import OrderStagesPipeline from '@/components/orders/OrderStagesPipeline';
import SectorStageDialog from '@/components/orders/SectorStageDialog';
import OrderConsumptionDialog from '@/components/orders/OrderConsumptionDialog';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, addWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';
// ExcelJS is imported dynamically in handleExportExcel to avoid large bundle on page load

type StockCheck = { product_id: string; product_name: string; required: number; available: number; sufficient: boolean };

const OP_STATUSES = ['Rascunho', 'Reservado', 'Em Produção', 'Finalizado', 'Cancelada'] as const;

const normalizeStatusValue = (value?: string | null) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const getCanonicalOrderStatus = (status?: string | null) => {
  const normalized = normalizeStatusValue(status);

  if (normalized === 'rascunho') return 'Rascunho';
  if (normalized === 'reservado') return 'Reservado';
  if (normalized === 'em producao') return 'Em Produção';
  if (['finalizado', 'concluida', 'concluido', 'completed'].includes(normalized)) return 'Finalizado';
  if (['cancelada', 'cancelado', 'cancelled'].includes(normalized)) return 'Cancelada';

  return status?.trim() || 'Rascunho';
};


const getOrderStatusMeta = (status?: string | null) => {
  const canonicalStatus = getCanonicalOrderStatus(status);

  return {
    canonicalStatus,
    badgeClassName: STATUS_COLORS[canonicalStatus] || '',
    label: STATUS_LABELS[canonicalStatus] || canonicalStatus,
  };
};

const STATUS_COLORS: Record<string, string> = {
  'Rascunho': 'bg-muted text-muted-foreground border-border',
  'Reservado': 'bg-primary/15 text-primary border-primary/30',
  'Em Produção': 'bg-warning/15 text-warning border-warning/30',
  'Finalizado': 'bg-success/15 text-success border-success/30',
  'Concluída': 'bg-success/15 text-success border-success/30',
  'Cancelada': 'bg-destructive/15 text-destructive border-destructive/30',
  'completed': 'bg-success/15 text-success border-success/30',
  'pending': 'bg-warning/15 text-warning border-warning/30',
};

const STATUS_LABELS: Record<string, string> = {
  'Rascunho': 'Rascunho',
  'Reservado': 'Reservado',
  'Em Produção': 'Em Produção',
  'Finalizado': 'Finalizada',
  'Concluída': 'Concluída',
  'Cancelada': 'Cancelada',
  'completed': 'Concluída',
  'pending': 'Pendente',
};

const getStatusBorderClass = (canonicalStatus: string) => {
  switch (canonicalStatus) {
    case 'Finalizado': return 'border-l-emerald-500';
    case 'Em Produção': return 'border-l-amber-500';
    case 'Reservado': return 'border-l-primary';
    case 'Cancelada': return 'border-l-muted-foreground/40';
    default: return 'border-l-muted-foreground/30'; // Rascunho
  }
};

const getStatusBgClass = (canonicalStatus: string) => {
  switch (canonicalStatus) {
    case 'Finalizado': return 'bg-emerald-500/5';
    case 'Em Produção': return 'bg-amber-500/5';
    case 'Reservado': return 'bg-primary/5';
    case 'Cancelada': return 'bg-muted/20';
    default: return '';
  }
};

// ════════════════════════════════════════════════════════════════════════
// Visual helpers — melhoria de layout das OPs
// ════════════════════════════════════════════════════════════════════════

/**
 * Mapeia nome de cor (em português) para hex aproximado.
 * Usado em dot/swatch ao lado do label de cor pra identificação visual rápida.
 * Cores não conhecidas viram cinza neutro.
 */
const COLOR_HEX_MAP: Record<string, string> = {
  'preto': '#1a1a1a', 'black': '#1a1a1a',
  'branco': '#ffffff', 'white': '#ffffff', 'off white': '#f5f0e8',
  'bege': '#d8c8a4', 'beige': '#d8c8a4',
  'caramelo': '#b8773a', 'caramel': '#b8773a',
  'whisky': '#a05d2c', 'new whisky': '#a05d2c',
  'tan': '#c69a6e', 'new tan': '#c69a6e',
  'cogumelo': '#9b8068',
  'champagne': '#e8d5b0', 'champanhe': '#e8d5b0',
  'rosado': '#e8b8b0', 'rosa': '#e8b8b0',
  'rosa claro': '#fadbe2', 'baby pink': '#fadbe2',
  'azul': '#3b6ea8', 'baby blue': '#a8c8e0',
  'verde': '#3a7d4a',
  'amarelo': '#e8c828', 'limoncello': '#f5e555',
  'cinza': '#888888', 'grafite': '#4a4a4a',
  'marrom': '#6b3a1f', 'malbec': '#5e1a26',
  'carmim': '#9c1a30', 'carmin': '#9c1a30',
  'cafe': '#3d2418', 'café': '#3d2418',
  'porcelana': '#f0e6dc',
  'grape': '#5e3a6e',
  'eban': '#1a1410', 'ébano': '#1a1410',
  'adocicado': '#c8a88f',
  'prata': '#c0c0c0', 'silver': '#c0c0c0',
  'ouro': '#e0b850', 'dourado': '#e0b850', 'gold': '#e0b850',
  'cristal': '#f0f0f5',
};

const ColorSwatch = ({ color, size = 12 }: { color?: string | null; size?: number }) => {
  if (!color || !color.trim()) return null;
  const norm = color.toLowerCase().trim();
  const hex = COLOR_HEX_MAP[norm] || COLOR_HEX_MAP[norm.replace(/[áàãâ]/g, 'a').replace(/[éê]/g, 'e').replace(/[íî]/g, 'i').replace(/[óôõ]/g, 'o').replace(/[úû]/g, 'u').replace(/ç/g, 'c')] || '#9aa3ae';
  return (
    <span
      className="inline-block rounded-full ring-1 ring-border/60 shrink-0"
      style={{ backgroundColor: hex, width: size, height: size }}
      title={color}
      aria-label={`Cor: ${color}`}
    />
  );
};

/**
 * Mostra progresso de setores como mini-barra com dots coloridos.
 * Cada dot = um setor; verde = concluído, amarelo = em andamento, cinza = pendente.
 */
const SectorProgressDots = ({
  completed, inProgress = 0, total,
}: { completed: number; inProgress?: number; total: number }) => {
  if (total === 0) return null;
  const pct = Math.round((completed / total) * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${completed} de ${total} setores concluídos (${pct}%)`}>
      <span className="inline-flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < completed;
          const isActive = !isDone && i < completed + inProgress;
          return (
            <span
              key={i}
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                isDone && 'bg-emerald-500',
                isActive && 'bg-amber-500 ring-1 ring-amber-500/30',
                !isDone && !isActive && 'bg-muted-foreground/25',
              )}
            />
          );
        })}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </span>
  );
};

// Helper to get week options
function getWeekOptions() {
  const options = [];
  const today = new Date();
  for (let i = -2; i <= 6; i++) {
    const weekStart = startOfWeek(addWeeks(today, i), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(addWeeks(today, i), { weekStartsOn: 1 });
    const label = i === 0 ? 'Esta semana' : i === 1 ? 'Próxima semana' : i === -1 ? 'Semana passada' : 
      `${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')}`;
    options.push({
      value: `${format(weekStart, 'yyyy-MM-dd')}|${format(weekEnd, 'yyyy-MM-dd')}`,
      label,
      start: weekStart,
      end: weekEnd,
    });
  }
  return options;
}

 export default function Orders({ hideHeader = false }: { hideHeader?: boolean }) {
  const navigate = useNavigate();
  const { data: orders = [], isLoading, isError } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const { data: products = [] } = useProducts();
  
  // Only fetch stages for currently loaded orders (much faster than fetching ALL stages)
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  
  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_ops'],
    queryFn: async () => {
      // economic_group_id NÃO existe em sale_orders — está em clients.
      // O agrupamento por grupo econômico é resolvido via clientsForGroup
      // (próxima query) cruzando por cnpj/razao_social.
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, client_cnpj, client_order_number, status, representative, delivery_week, delivery_month, billing_week, total, nfe, remessa, delivery_deadline');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: clientsForGroup = [] } = useQuery({
    queryKey: ['clients_for_ops_group'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, razao_social, cnpj, economic_group_id, economic_groups:economic_group_id (id, name)');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const { getStrapsLabel } = useOrderStraps();
  const createOrder = useCreateOrder();
  const deleteOrder = useDeleteOrder();
  const checkStock = useCheckStockAvailability();
  const updateStatus = useUpdateOrderStatus();
  const createStages = useCreateOrderStages();

  useRealtimeOrderStages();

  const packagingProducts = useMemo(() => products.filter(p => p.category === 'Embalagem' && p.active), [products]);

  const { data: boxTypesForOrders = [] } = useQuery({
    queryKey: ['box_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 60 * 1000,
  });

  // Filters state (persisted across navigation) — filters panel is always visible
  const [searchTerm, setSearchTerm] = usePersistedState('searchTerm', '');
  const [statusFilter, setStatusFilter] = usePersistedState<string>('statusFilter', 'active');
  const [referenceFilter, setReferenceFilter] = usePersistedState<string>('referenceFilter', 'all');
  const [colorFilter, setColorFilter] = usePersistedState<string>('colorFilter', 'all');
  const [weekFilter, setWeekFilter] = usePersistedState<string>('weekFilter', 'all');
  const [segmentFilter, setSegmentFilter] = usePersistedState<string>('segmentFilter', 'all');
  const [groupByRefColor, setGroupByRefColor] = usePersistedState('groupByRefColor', false);
  const [groupByEconomic, setGroupByEconomic] = usePersistedState('groupByEconomicGroup', false);
  const [filtersOpen, setFiltersOpen] = usePersistedState('orders-filters-open', true);
  const [viewMode, setViewMode] = usePersistedState<'list' | 'kanban'>('orders-view-mode', 'list');
  const [approving, setApproving] = useState(false);


  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stockCheckResult, setStockCheckResult] = useState<StockCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [selectedStage, setSelectedStage] = useState<OrderStage | null>(null);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [selectedOrderNumber, setSelectedOrderNumber] = useState('');
  const [detailOrders, setDetailOrders] = useState<typeof orders>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [consumptionOrderIds, setConsumptionOrderIds] = useState<string[]>([]);
  const [consumptionTitle, setConsumptionTitle] = useState('');
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);

  const [form, setForm] = useState<OrderFormData & { color: string; planned_start: string; planned_delivery: string; production_line: string; responsible: string; packaging_type: string; packaging_product_id: string; packaging_quantity: number; sale_order_id: string }>({
    reference_id: '', quantity: 1, notes: '', color: '', planned_start: '', planned_delivery: '', production_line: '', responsible: '', packaging_type: '', packaging_product_id: '', packaging_quantity: 0, sale_order_id: '',
  });

  const normalizedStatusFilter = statusFilter;

  // Get unique colors and references for filters
  const uniqueColors = useMemo(() => {
    const colors = new Set<string>();
    orders.forEach(o => {
      if ((o as any).color) colors.add((o as any).color);
    });
    return Array.from(colors).sort();
  }, [orders]);

  const weekOptions = useMemo(() => getWeekOptions(), []);

  const saleOrderMetaById = useMemo(() => {
    return new Map(
      saleOrders.map((saleOrder: any) => [
        saleOrder.id,
        {
          orderNumber: saleOrder.order_number,
          clientName: saleOrder.client_name,
          clientCnpj: saleOrder.client_cnpj || '',
          clientOrderNumber: saleOrder.client_order_number || '',
          representative: saleOrder.representative || '',
          deliveryWeek: saleOrder.delivery_week || '',
          deliveryMonth: saleOrder.delivery_month || '',
          nfe: saleOrder.nfe || '',
          remessa: saleOrder.remessa || '',
          status: saleOrder.status || '',
        },
      ]),
    );
  }, [saleOrders]);

  // Segmento (Adulto / Infantil) por reference_id
  const segmentByRefId = useMemo(() => {
    const map: Record<string, 'Adulto' | 'Infantil'> = {};
    references.forEach((r: any) => {
      const cat = (r.shoe_category || '').toLowerCase();
      map[r.id] = cat.includes('infantil') || cat.includes('kids') || cat.includes('crian') || cat.includes('bebe') || cat.includes('bebê')
        ? 'Infantil'
        : 'Adulto';
    });
    return map;
  }, [references]);

  // O(1) stage lookup — replaces allStages.filter(s => s.order_id === id) inside render loops
  const stagesByOrderId = useMemo(() => {
    const map = new Map<string, typeof allStages>();
    for (const stage of allStages) {
      const list = map.get(stage.order_id);
      if (list) list.push(stage); else map.set(stage.order_id, [stage]);
    }
    return map;
  }, [allStages]);

  // O(1) reference lookup by id
  const referenceById = useMemo(() =>
    new Map(references.map((r: any) => [r.id, r])),
    [references],
  );

  // O(1) sale order full-object lookup by id
  const saleOrderById = useMemo(() =>
    new Map(saleOrders.map((so: any) => [so.id, so])),
    [saleOrders],
  );

  // Filter and group orders
  const filteredOrders = useMemo(() => {
    const searchLower = normalizeForSearch(searchTerm);
    const searchDigits = searchLower.replace(/\D/g, '');

    return orders.filter(order => {
      const canonicalStatus = getCanonicalOrderStatus(order.status);
      const linkedSaleOrderId = (order as any).sale_order_id;
      const linkedSaleOrder = linkedSaleOrderId ? saleOrderMetaById.get(linkedSaleOrderId) : null;
      
      if (normalizedStatusFilter === 'active') {
        // "Abertas / em produção": mostrar tudo exceto Finalizado e Cancelada.
        // Não depende do status do PV vinculado — um OP Em Produção NUNCA some.
        if (canonicalStatus === 'Finalizado' || canonicalStatus === 'Cancelada') return false;
      } else if (normalizedStatusFilter === 'all') {
        // "Todas": sem filtro de status
      } else if (canonicalStatus !== normalizedStatusFilter) {
        return false;
      }

      // Search filter — wide multi-field matching
      if (searchLower) {
        const cnpjDigits = (linkedSaleOrder?.clientCnpj || '').replace(/\D/g, '');
        const ts: any = (order as any).technical_sheets || {};
        const candidates: (string | null | undefined)[] = [
          (order as any).order_number,
          ts.name,
          ts.code,
          (order as any).color,
          (order as any).notes,
          (order as any).production_line,
          (order as any).responsible,
          (order as any).packaging_type,
          String((order as any).quantity ?? ''),
          linkedSaleOrder?.orderNumber,
          linkedSaleOrder?.clientName,
          linkedSaleOrder?.clientOrderNumber,
          linkedSaleOrder?.representative,
          linkedSaleOrder?.nfe,
          linkedSaleOrder?.remessa,
          linkedSaleOrder?.deliveryWeek,
          linkedSaleOrder?.deliveryMonth,
        ];
        const matchesText = candidates.some(v => (v || '').toString().toLowerCase().includes(searchLower));
        const matchesCnpj = searchDigits.length >= 3 && cnpjDigits.includes(searchDigits);
        if (!matchesText && !matchesCnpj) return false;
      }

      // Reference filter
      if (referenceFilter !== 'all' && order.reference_id !== referenceFilter) return false;

      // Color filter
      if (colorFilter !== 'all' && (order as any).color !== colorFilter) return false;

      // Segment filter (Adulto / Infantil)
      if (segmentFilter !== 'all') {
        const seg = segmentByRefId[order.reference_id] || 'Adulto';
        if (seg !== segmentFilter) return false;
      }

      // Week filter (by planned_delivery)
      if (weekFilter !== 'all') {
        const [startStr, endStr] = weekFilter.split('|');
        const deliveryDate = (order as any).planned_delivery;
        if (!deliveryDate) return false;
        const delivery = parseISO(deliveryDate);
        const start = parseISO(startStr);
        const end = parseISO(endStr);
        if (!isWithinInterval(delivery, { start, end })) return false;
      }

      return true;
    });
  }, [orders, saleOrderMetaById, searchTerm, normalizedStatusFilter, referenceFilter, colorFilter, weekFilter, segmentFilter, segmentByRefId]);

  // Marquee + multi-select (Cmd/Ctrl/Shift click, drag-select, Esc to clear).
  // Substitui o state local de seleção; expõe APIs `selectedOrderIds`/toggle/clear
  // compatíveis com os handlers e checkboxes existentes.
  const sel = useMarqueeSelection(filteredOrders, (o) => o.id);
  const selectedOrderIds = sel.selectedIds;

  // Map: client cnpj -> economic_group {id, name}, and razao_social -> group
  const clientGroupByCnpj = useMemo(() => {
    const map = new Map<string, { id: string; name: string } | null>();
    (clientsForGroup as any[]).forEach((c: any) => {
      const cnpj = (c.cnpj || '').replace(/\D/g, '');
      const eg = c.economic_groups ? { id: c.economic_groups.id, name: c.economic_groups.name } : null;
      if (cnpj) map.set(cnpj, eg);
    });
    return map;
  }, [clientsForGroup]);

  const clientGroupByName = useMemo(() => {
    const map = new Map<string, { id: string; name: string } | null>();
    (clientsForGroup as any[]).forEach((c: any) => {
      const eg = c.economic_groups ? { id: c.economic_groups.id, name: c.economic_groups.name } : null;
      if (c.razao_social) map.set((c.razao_social || '').toLowerCase().trim(), eg);
    });
    return map;
  }, [clientsForGroup]);

  const getEconomicGroupForOrder = (order: any): { id: string; name: string } | null => {
    const so = order.sale_order_id ? saleOrderMetaById.get(order.sale_order_id) : null;
    if (!so) return null;
    const cnpjDigits = (so.clientCnpj || '').replace(/\D/g, '');
    if (cnpjDigits && clientGroupByCnpj.has(cnpjDigits)) {
      return clientGroupByCnpj.get(cnpjDigits) || null;
    }
    const nameKey = (so.clientName || '').toLowerCase().trim();
    if (nameKey && clientGroupByName.has(nameKey)) {
      return clientGroupByName.get(nameKey) || null;
    }
    return null;
  };

  // Group orders by reference + color
  const groupedOrders = useMemo(() => {
    if (!groupByRefColor) return null;

    const groups: Record<string, typeof filteredOrders> = {};
    filteredOrders.forEach(order => {
      const refName = (order as any).technical_sheets?.name || 'Sem referência';
      const color = (order as any).color || 'Sem cor';
      const key = `${refName}|||${color}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(order);
    });

    return Object.entries(groups)
      .map(([key, orders]) => {
        const [refName, color] = key.split('|||');
        const totalQty = orders.reduce((sum, o) => sum + o.quantity, 0);
        return { refName, color, orders, totalQty };
      })
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders, groupByRefColor]);

  // Group orders by economic group → reference + color
  const economicGroupedOrders = useMemo(() => {
    if (!groupByEconomic) return null;

    type Sub = { refName: string; color: string; orders: typeof filteredOrders; totalQty: number };
    type EG = { groupId: string; groupName: string; subgroups: Sub[]; totalQty: number; opCount: number };

    const groups = new Map<string, { groupName: string; subs: Map<string, typeof filteredOrders> }>();
    filteredOrders.forEach(order => {
      const eg = getEconomicGroupForOrder(order as any);
      const groupId = eg?.id || '__no_group__';
      const groupName = eg?.name || 'Sem grupo econômico';
      const refName = (order as any).technical_sheets?.name || 'Sem referência';
      const color = (order as any).color || 'Sem cor';
      const subKey = `${refName}|||${color}`;
      if (!groups.has(groupId)) groups.set(groupId, { groupName, subs: new Map() });
      const g = groups.get(groupId)!;
      if (!g.subs.has(subKey)) g.subs.set(subKey, []);
      g.subs.get(subKey)!.push(order);
    });

    const result: EG[] = [];
    groups.forEach((g, groupId) => {
      const subgroups: Sub[] = [];
      g.subs.forEach((orders, key) => {
        const [refName, color] = key.split('|||');
        const totalQty = orders.reduce((s, o) => s + o.quantity, 0);
        subgroups.push({ refName, color, orders, totalQty });
      });
      subgroups.sort((a, b) => b.totalQty - a.totalQty);
      const totalQty = subgroups.reduce((s, x) => s + x.totalQty, 0);
      const opCount = subgroups.reduce((s, x) => s + x.orders.length, 0);
      result.push({ groupId, groupName: g.groupName, subgroups, totalQty, opCount });
    });
    return result.sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders, groupByEconomic, clientGroupByCnpj, clientGroupByName, saleOrderMetaById]);

  const hasActiveFilters = searchTerm || statusFilter !== 'active' || referenceFilter !== 'all' || colorFilter !== 'all' || weekFilter !== 'all' || segmentFilter !== 'all';
  const activeFilterCount = [
    statusFilter !== 'active',
    referenceFilter !== 'all',
    colorFilter !== 'all',
    weekFilter !== 'all',
    segmentFilter !== 'all',
    groupByRefColor,
    groupByEconomic,
  ].filter(Boolean).length;

  const toggleOrderSelection = (orderId: string) => {
    sel.toggle(orderId);
  };

  const toggleSelectAll = () => {
    if (selectedOrderIds.size === filteredOrders.length) {
      sel.clear();
    } else {
      sel.selectAll();
    }
  };

  // Orders to use for reports: selected if any, otherwise all filtered
  const effectiveOrders = selectedOrderIds.size > 0
    ? filteredOrders.filter(o => selectedOrderIds.has(o.id))
    : filteredOrders;

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('active');
    setReferenceFilter('all');
    setColorFilter('all');
    setWeekFilter('all');
    setSegmentFilter('all');
    setGroupByRefColor(false);
    setGroupByEconomic(false);
    sel.clear();
  };

  // ── Bulk action handlers (usados pela BulkActionsBar) ──────────────────
  const handleBulkAdvance = async (ids: Set<string>) => {
    // TODO: implementar RPC advance_op_stage (não existe ainda — só advance_wave_stage).
    // Por ora, mostra toast informativo. Quando RPC existir, iterar:
    // for (const id of ids) await supabase.rpc('advance_op_stage', { p_order_id: id });
    toast.info(`Avançar setor — em implementação (${ids.size} OPs selecionadas)`);
  };

  const handleBulkPrintWorksheets = (ids: Set<string>) => {
    if (ids.size === 0) return;
    navigate('/imprimir-fichas?orderIds=' + Array.from(ids).join(','));
  };

  const handleBulkCancel = async (ids: Set<string>) => {
    if (ids.size === 0) return;
    const confirmed = window.confirm(
      `Cancelar ${ids.size} OP(s)? Esta ação marcará as OPs como "Cancelada" e não pode ser desfeita facilmente.`,
    );
    if (!confirmed) return;
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'Cancelada', updated_at: new Date().toISOString() } as any)
        .in('id', Array.from(ids));
      if (error) throw error;
      toast.success(`${ids.size} OP(s) cancelada(s)`);
      sel.clear();
    } catch (err: any) {
      toast.error(`Erro ao cancelar OPs: ${err.message}`);
    }
  };

  const handleBulkExport = (ids: Set<string>) => {
    const opsToExport = filteredOrders.filter(o => ids.has(o.id));
    handleExportExcel(opsToExport);
  };

  const SIZES_ALL = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];
  

  const handleApproveAll = async () => {
    if (effectiveOrders.length === 0) {
      toast.error('Nenhuma OP selecionada para aprovar.');
      return;
    }
    setApproving(true);
    try {
      // 1. Create stages for orders that don't have them yet
      const ordersWithoutStages = effectiveOrders.filter(o => {
        const stages = stagesByOrderId.get(o.id) || [];
        return stages.length === 0;
      });

      // Fetch production_sectors for all unique references
      const refIds = [...new Set(ordersWithoutStages.map(o => o.reference_id))];
      const sectorsMap = new Map<string, string[]>();
      if (refIds.length > 0) {
        const { data: sheetsData, error: sheetsErr } = await supabase
          .from('technical_sheets')
          .select('id, production_sectors')
          .in('id', refIds);
        if (sheetsErr) throw new Error(`Falha ao carregar fichas técnicas: ${sheetsErr.message}`);
        sheetsData?.forEach((s: any) => {
          const sectors = Array.isArray(s.production_sectors) && s.production_sectors.length > 0
            ? s.production_sectors.map((x: any) => String(x))
            : ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'];
          sectorsMap.set(s.id, sectors);
        });
      }

      const DEFAULT_STAGES = [
        { name: 'Corte Palmilha', order: 1 }, { name: 'Corte Forração', order: 2 },
        { name: 'Mesa', order: 3 }, { name: 'Silk', order: 4 },
        { name: 'Colagem', order: 5 }, { name: 'Montagem', order: 6 },
        { name: 'Solagem', order: 7 }, { name: 'Acabamento', order: 8 },
        { name: 'Expedição', order: 9 },
      ];

      // Build all rows up-front so we can do a single bulk insert (was N+1 inside loop).
      const allRows = ordersWithoutStages.flatMap(order => {
        const sectorNames = sectorsMap.get(order.reference_id) || DEFAULT_STAGES.map(s => s.name);
        return sectorNames.map((name: string, idx: number) => {
          const defaultStage = DEFAULT_STAGES.find(s => s.name === name);
          return {
            order_id: order.id,
            stage_name: name,
            stage_order: defaultStage?.order || idx + 1,
            status: 'pendente',
            quantity_total: order.quantity,
            quantity_processed: 0,
            observations: '',
            defects: '',
          };
        });
      });
      if (allRows.length > 0) {
        const { error: stagesErr } = await supabase.from('order_stages').insert(allRows);
        if (stagesErr) throw new Error(`Falha ao criar etapas de produção: ${stagesErr.message}`);
      }
      if (ordersWithoutStages.length > 0) {
        toast.success(`Controle por setor criado para ${ordersWithoutStages.length} OP(s)`);
      }

      toast.success(`${ordersWithoutStages.length > 0 ? `Controle por setor criado para ${ordersWithoutStages.length} OP(s). ` : ''}Todas as OPs aprovadas!`);
    } catch (err: any) {
      toast.error(`Erro ao aprovar: ${err.message}`);
    } finally {
      setApproving(false);
    }
  };
  const handleManualStatusChange = async (order: any, newStatus: string) => {
    const prevStatus = order.status as string;
    // Reserve→Debit: Reservado → Em Produção apenas consome as reservas (já criadas)
    if (newStatus === 'Em Produção' && prevStatus === 'Reservado') {
      const { error: consumeErr } = await (supabase.rpc as any)('consume_all_reservations_for_order', {
        p_order_id: order.id,
      });
      if (consumeErr) {
        toast.error(`Erro ao confirmar picking: ${consumeErr.message}`);
        return;
      }
      toast.success('Picking confirmado — material debitado.');
      updateStatus.mutate({ id: order.id, status: newStatus });
      return;
    }
    if (newStatus === 'Em Produção' && prevStatus === 'Rascunho') {
      try {
        // Atomic claim: prevent double-debit when two tabs/clicks race on the same OP.
        // Only one caller can flip from 'Rascunho' to 'Em Debito'; the loser gets 0 rows.
        const { data: claimed, error: claimErr } = await supabase
          .from('orders')
          .update({ status: 'Em Debito' as any, updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .eq('status', 'Rascunho')
          .select('id');
        if (claimErr) { toast.error(`Erro ao iniciar débito: ${claimErr.message}`); return; }
        if (!claimed || claimed.length === 0) {
          toast.warning('Status já alterado por outro usuário — recarregue.');
          return;
        }
        const stockCheck = await checkStock(order.reference_id, order.quantity, order.color);
        const insufficient = (stockCheck || []).filter((s: any) => !s.sufficient);
        if (insufficient.length > 0) {
          // Release the claim so the OP goes back to Rascunho
          await supabase.from('orders').update({ status: 'Rascunho', updated_at: new Date().toISOString() }).eq('id', order.id);
          const msg = insufficient.map((s: any) => `${s.product_name}: necessário ${Number(s.required ?? 0).toFixed(2)}, disponível ${Number(s.available ?? 0).toFixed(2)}`).join(' | ');
          toast.error(`Estoque insuficiente — ${msg}`);
          return;
        }
        const grade = order.grade && Object.keys(order.grade).length > 0 ? order.grade : null;
        // Reserve→Debit (Phase 1): cria reservas soft primeiro
        const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
          p_reference_id: order.reference_id,
          p_order_quantity: order.quantity,
          p_color: order.color || '',
          p_order_id: order.id,
          p_order_grade: grade,
          p_force_soft: true,
        } as any);
        if (debitErr) {
          await supabase.from('orders').update({ status: 'Rascunho', updated_at: new Date().toISOString() }).eq('id', order.id);
          toast.error(`Erro ao reservar estoque: ${debitErr.message}`);
          return;
        }
        const { error: soleErr } = await supabase.rpc('debit_sole_stock_by_grade', {
          p_reference_id: order.reference_id,
          p_order_id: order.id,
          p_color: order.color || '',
          p_order_grade: grade || {},
          p_force_soft: true,
        } as any);
        if (soleErr) {
          // Roll back in canonical order: release reservations → sole grade → product stocks
          await (supabase.rpc as any)('release_order_reservations', { p_order_id: order.id });
          await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: order.id });
          await supabase.rpc('restore_product_stocks_for_order', { p_order_id: order.id } as any);
          await supabase.from('orders').update({ status: 'Rascunho', updated_at: new Date().toISOString() }).eq('id', order.id);
          const po = await autoCreateSolePO({
            referenceId: order.reference_id,
            orderId: order.id,
            color: order.color || '',
            grade: grade || {},
            orderRef: (order as any).order_number || String(order.id).slice(0, 8),
          });
          if (po) {
            toast.warning(
              `Solado insuficiente — OC ${po.poNumber} criada automaticamente (${po.supplierName}). OP mantida em Rascunho.`,
              { duration: 8000 }
            );
          } else {
            toast.error(`Estoque de solado insuficiente: ${soleErr.message}`);
          }
          return;
        }
        // Reserve→Debit (Phase 1): aplica o débito real (consome reservas, decrementa stock)
        const { error: consumeErr } = await (supabase.rpc as any)('consume_all_reservations_for_order', {
          p_order_id: order.id,
        });
        if (consumeErr) {
          await (supabase.rpc as any)('release_order_reservations', { p_order_id: order.id });
          await supabase.from('orders').update({ status: 'Rascunho', updated_at: new Date().toISOString() }).eq('id', order.id);
          toast.error(`Erro ao consumir reservas: ${consumeErr.message}`);
          return;
        }
      } catch (err: any) {
        // Release the 'Em Debito' claim so the OP returns to Rascunho on any unexpected error.
        await supabase.from('orders').update({ status: 'Rascunho', updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'Em Debito' as any);
        toast.error(`Erro ao validar estoque: ${err.message}`);
        return;
      }
    }
    updateStatus.mutate({ id: order.id, status: newStatus });
  };

  const handleExportExcel = async (ordersToExport: typeof filteredOrders) => {
    if (ordersToExport.length === 0) {
      toast.error('Nenhuma OP selecionada para exportar.');
      return;
    }

    // Build sale order index and client group index
    const soById: Record<string, any> = {};
    (saleOrders || []).forEach((so: any) => { soById[so.id] = so; });
    const clientByCnpj: Record<string, any> = {};
    const groupByCnpj: Record<string, string> = {};
    (clientsForGroup || []).forEach((c: any) => {
      if (c.cnpj) {
        clientByCnpj[c.cnpj] = c;
        const g = (c.economic_groups as any);
        if (g?.name) groupByCnpj[c.cnpj] = g.name;
      }
    });

    // ── Wave data for each order ──────────────────────────────────────────────
    // Canonical post-rename order (migration 20260506120000); legacy values
    // mapped to their new equivalent so XLS export still works for in-flight
    // orders that haven't been migrated yet.
    // Ordem canônica pós PR1-PR3: prep (palmilha‖forração‖mesa) → costura → restantes.
    const STAGE_ORDER_XLS = [
      'corte_palmilha', 'corte_forracao', 'mesa', 'costura', 'silk', 'colagem',
      'montagem', 'solagem', 'acabamento', 'expedicao',
    ];
    const STAGE_LABEL_XLS: Record<string, string> = {
      corte_palmilha: 'Corte Palmilha',
      corte_forracao: 'Corte Forração',
      mesa: 'Aviamento',
      costura: 'Costura',
      silk: 'Silk',
      colagem: 'Colagem',
      montagem: 'Montagem',
      solagem: 'Solagem',
      acabamento: 'Acabamento',
      expedicao: 'Expedição',
      // legacy aliases
      corte: 'Corte',
      palmilha: 'Palmilha',
    };
    // Legacy stage normalisation: 'corte'/'palmilha' → corte_palmilha.
    // Cuidado: 'costura' agora é setor canônico próprio (PR 2) — NÃO normalizar pra corte_forracao.
    const normalizeStage = (s?: string | null): string => {
      if (!s) return '';
      if (s === 'corte' || s === 'palmilha') return 'corte_palmilha';
      return s;
    };

    type WaveInfo = {
      waveCode: string;
      currentStage: string;
      nextStage: string;
      prevMontagem: string;
    };
    const waveInfoBySaleOrderId: Record<string, WaveInfo> = {};

    const saleOrderIds = [...new Set(ordersToExport.map((o: any) => o.sale_order_id).filter(Boolean))];
    if (saleOrderIds.length > 0) {
      const { data: sources } = await (supabase as any)
        .from('production_wave_item_sources')
        .select('sale_order_id, wave_item_id')
        .in('sale_order_id', saleOrderIds);

      const waveItemIds = [...new Set((sources || []).map((s: any) => s.wave_item_id).filter(Boolean))];
      if (waveItemIds.length > 0) {
        const { data: waveItems } = await (supabase as any)
          .from('production_wave_items')
          .select('id, wave_id')
          .in('id', waveItemIds);

        const waveItemToWaveId = new Map((waveItems || []).map((wi: any) => [wi.id, wi.wave_id]));
        const waveIds = [...new Set((waveItems || []).map((wi: any) => wi.wave_id).filter(Boolean))];

        if (waveIds.length > 0) {
          const [{ data: waves }, { data: montagemStages }] = await Promise.all([
            (supabase as any)
              .from('production_waves')
              .select('id, code, current_stage, week_start, status')
              .in('id', waveIds)
              // Production waves use Portuguese status values ('Cancelada' etc).
              // The previous filter `'cancelled'` matched nothing, leaving cancelled waves visible.
              .not('status', 'in', '("Cancelada","cancelada","cancelled","Cancelled")'),
            (supabase as any)
              .from('production_wave_stages')
              .select('wave_id, started_at, finished_at')
              .in('wave_id', waveIds)
              .eq('stage', 'montagem'),
          ]);

          const waveMap = new Map((waves || []).map((w: any) => [w.id, w]));
          const montagemMap = new Map((montagemStages || []).map((s: any) => [s.wave_id, s]));

          for (const source of (sources || [])) {
            if (!source.sale_order_id || waveInfoBySaleOrderId[source.sale_order_id]) continue;
            const waveId = waveItemToWaveId.get(source.wave_item_id);
            if (!waveId) continue;
            const wave = waveMap.get(waveId);
            if (!wave) continue;

            const cs: string = normalizeStage((wave as any).current_stage || '');
            const csIdx = STAGE_ORDER_XLS.indexOf(cs);
            const montagemIdx = STAGE_ORDER_XLS.indexOf('montagem');
            const nextStage = csIdx >= 0 && csIdx < STAGE_ORDER_XLS.length - 1
              ? STAGE_LABEL_XLS[STAGE_ORDER_XLS[csIdx + 1]] || '—'
              : '—';

            const montagemRecord = montagemMap.get(waveId);
            let prevMontagem: string;
            if (cs === 'montagem') {
              const since = (montagemRecord as any)?.started_at
                ? ` (desde ${format(parseISO((montagemRecord as any).started_at), 'dd/MM')})`
                : '';
              prevMontagem = `Em andamento${since}`;
            } else if (csIdx > montagemIdx || (wave as any).status === 'finished') {
              prevMontagem = (montagemRecord as any)?.started_at
                ? format(parseISO((montagemRecord as any).started_at), 'dd/MM/yyyy')
                : '—';
            } else {
              prevMontagem = (wave as any).week_start
                ? `~${format(parseISO((wave as any).week_start), 'dd/MM/yyyy')}`
                : '—';
            }

            waveInfoBySaleOrderId[source.sale_order_id] = {
              waveCode: (wave as any).code || '—',
              currentStage: cs ? STAGE_LABEL_XLS[cs] || cs : '—',
              nextStage,
              prevMontagem,
            };
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Ordens de Produção');
    worksheet.columns = [
      { header: 'Nº OP', key: 'order_number', width: 14 },
      { header: 'Referência', key: 'reference', width: 25 },
      { header: 'Cor', key: 'color', width: 18 },
      { header: 'Qtd Pares', key: 'quantity', width: 12 },
      { header: 'Grade', key: 'grade', width: 35 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Grupo Econômico', key: 'grupo', width: 25 },
      { header: 'Razão Social', key: 'razao_social', width: 30 },
      { header: 'Nº Pedido Sistema', key: 'nf_sistema', width: 18 },
      { header: 'Nº Pedido Cliente', key: 'nf_cliente', width: 18 },
      { header: 'Cidade/UF', key: 'cidade', width: 20 },
      { header: 'Semana Faturamento', key: 'semana', width: 20 },
      { header: 'Entrega Planejada', key: 'delivery', width: 16 },
      { header: 'Onda', key: 'onda', width: 14 },
      { header: 'Setor Atual', key: 'setor_atual', width: 14 },
      { header: 'Próximo Setor', key: 'prox_setor', width: 14 },
      { header: 'Previsão Montagem', key: 'prev_montagem', width: 20 },
    ];
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    // Highlight wave columns with a light blue header
    [14, 15, 16, 17].forEach(col => {
      const cell = headerRow.getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
    });

    ordersToExport.forEach(order => {
      const so = soById[(order as any).sale_order_id] || null;
      const cnpj = so?.client_cnpj || '';
      const client = clientByCnpj[cnpj];
      const grupo = groupByCnpj[cnpj] || '';
      const cidade = client ? [client.cidade, client.estado].filter(Boolean).join('/') : '';
      const semana = so?.billing_week || so?.delivery_week || '';
      const gradeStr = order.grade
        ? Object.entries(order.grade as Record<string, number>)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')
        : '';
      const waveInfo = waveInfoBySaleOrderId[(order as any).sale_order_id] || null;
      worksheet.addRow({
        order_number: (order as any).order_number || '',
        reference: (order as any).technical_sheets?.name || (order as any).technical_sheets?.code || '',
        color: (order as any).color || '',
        quantity: order.quantity,
        grade: gradeStr,
        status: order.status,
        grupo,
        razao_social: so?.client_name || '',
        nf_sistema: so?.order_number || '',
        nf_cliente: so?.client_order_number || '',
        cidade,
        semana,
        delivery: (order as any).planned_delivery ? format(parseISO((order as any).planned_delivery), 'dd/MM/yyyy') : '',
        onda: waveInfo?.waveCode || '—',
        setor_atual: waveInfo?.currentStage || '—',
        prox_setor: waveInfo?.nextStage || '—',
        prev_montagem: waveInfo?.prevMontagem || '—',
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ordens_producao_${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    toast.success('Arquivo Excel gerado com sucesso!');
  };

  const handlePrepareOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    try {
      const result = await checkStock(form.reference_id, form.quantity, form.color);
      setStockCheckResult(result);
      setDialogOpen(false);
      setConfirmOpen(true);
    } catch (err: any) {
      toast.error(`Erro ao verificar estoque: ${err.message}`);
    } finally {
      setChecking(false);
    }
  };

  const handleConfirmOrder = () => {
    createOrder.mutate({
      reference_id: form.reference_id,
      quantity: form.quantity,
      notes: form.notes,
      color: form.color,
      planned_start: form.planned_start || undefined,
      planned_delivery: form.planned_delivery || undefined,
      production_line: form.production_line,
      responsible: form.responsible,
      packaging_type: form.packaging_type,
      packaging_product_id: form.packaging_product_id || undefined,
      packaging_quantity: form.packaging_quantity,
      sale_order_id: form.sale_order_id || undefined,
    } as any);
    setConfirmOpen(false);
    setForm({ reference_id: '', quantity: 1, notes: '', color: '', planned_start: '', planned_delivery: '', production_line: '', responsible: '', packaging_type: '', packaging_product_id: '', packaging_quantity: 0, sale_order_id: '' });
    setStockCheckResult([]);
  };

  const handleInitStages = (orderId: string, quantity: number, referenceId?: string) => {
    createStages.mutate({ orderId, quantity, referenceId });
  };

  const allSufficient = stockCheckResult.every(s => s.sufficient);
  const selectedRefName = (referenceById.get(form.reference_id) as any)?.name || '';

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar ordens de produção</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e tente novamente.</p>
      </div>
    );
  }

   return (
     <>
       <div className="w-full space-y-4 page-enter editorial-stagger">
         {!hideHeader && (
           <EditorialPageHeader
             sectionLabel="PCP · ORDENS"
             title="Ordens de Produção"
             description="Gestão de OPs com controle por setor de produção"
           />
         )}

        {/* ── Toolbar principal ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px] max-w-[380px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar OP, referência, cor, cliente, NF-e…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-8 h-9"
            />
            {searchTerm && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearchTerm('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 shrink-0">
            {[
              { value: 'active',      label: 'Abertas' },
              { value: 'Em Produção', label: 'Em Prod.' },
              { value: 'Reservado',   label: 'Reservado' },
              { value: 'Finalizado',  label: 'Finalizado' },
              { value: 'all',         label: 'Todas' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  normalizedStatusFilter === opt.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
                {normalizedStatusFilter === opt.value && filteredOrders.length > 0 && (
                  <span className="ml-1 opacity-60 font-mono text-[10px]">{filteredOrders.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* View mode toggle: Lista | Kanban */}
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5 shrink-0">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="gap-1 h-8 px-2.5"
              title="Visualização em lista"
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden md:inline text-xs">Lista</span>
            </Button>
            <Button
              variant={viewMode === 'kanban' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('kanban')}
              className="gap-1 h-8 px-2.5"
              title="Visualização kanban (fluxo de produção)"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden md:inline text-xs">Kanban</span>
            </Button>
          </div>

          {/* Filtros avançados toggle */}
          <Button
            variant={hasActiveFilters && activeFilterCount > 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFiltersOpen(v => !v)}
            className="gap-1.5 h-9 shrink-0"
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{activeFilterCount}</Badge>
            ) : (
              <span className="hidden sm:inline">Filtros</span>
            )}
            {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>

          <div className="flex-1" />

          {/* Nova OP */}
          <Button size="sm" className="gap-1.5 h-9 shrink-0" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Nova OP
          </Button>

          {/* Aprovar */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleApproveAll}
            disabled={approving || effectiveOrders.length === 0}
            className="gap-1.5 h-9 shrink-0"
          >
            {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            <span>Aprovar{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ''}</span>
          </Button>

          {/* ── Dropdown: Imprimir / Exportar ── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={effectiveOrders.length === 0}
                className="gap-1.5 h-9 shrink-0"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Imprimir</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                {selectedOrderIds.size > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">{selectedOrderIds.size}</Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                {selectedOrderIds.size > 0 ? `${selectedOrderIds.size} OP(s) selecionadas` : `${effectiveOrders.length} OP(s) visíveis`}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />


              <DropdownMenuItem
                onClick={() => {
                  const ids = selectedOrderIds.size > 0 ? Array.from(selectedOrderIds) : effectiveOrders.map(o => o.id);
                  setConsumptionOrderIds(ids);
                  setConsumptionTitle(selectedOrderIds.size > 0 ? `${selectedOrderIds.size} OP(s) selecionadas` : `${effectiveOrders.length} OP(s)`);
                }}
                className="gap-2 cursor-pointer"
              >
                <Package className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Consumo de Material</p>
                  <p className="text-xs text-muted-foreground">Lista de matérias-primas</p>
                </div>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => handleExportExcel(effectiveOrders)}
                disabled={selectedOrderIds.size === 0}
                className="gap-2 cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Exportar Excel</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedOrderIds.size > 0 ? `${selectedOrderIds.size} selecionadas` : 'Selecione OPs primeiro'}
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Painel de filtros (colapsável) ── */}
        {filtersOpen && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filtros e Agrupamento</span>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground gap-1 px-2">
                  <X className="h-3 w-3" /> Limpar
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {/* Status */}
              <Select value={normalizedStatusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Abertas / em produção</SelectItem>
                  {OP_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  <SelectItem value="all">Todas as OPs</SelectItem>
                </SelectContent>
              </Select>

              {/* Reference */}
              <Select value={referenceFilter} onValueChange={setReferenceFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Referência" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as referências</SelectItem>
                  {references.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.code} — {r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Color */}
              <Select value={colorFilter} onValueChange={setColorFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Cor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as cores</SelectItem>
                  {uniqueColors.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Week */}
              <Select value={weekFilter} onValueChange={setWeekFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Semana entrega" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as semanas</SelectItem>
                  {weekOptions.map(w => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Segmento */}
              <Select value={segmentFilter} onValueChange={setSegmentFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Segmento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os segmentos</SelectItem>
                  <SelectItem value="Adulto">Adulto</SelectItem>
                  <SelectItem value="Infantil">Infantil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Agrupamento */}
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
              <span className="text-xs text-muted-foreground">Agrupar por:</span>
              <Button
                variant={groupByRefColor ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setGroupByRefColor(!groupByRefColor); if (!groupByRefColor) setGroupByEconomic(false); }}
                className="gap-1.5 h-7 text-xs"
              >
                <Layers className="h-3.5 w-3.5" />
                Referência + Cor
              </Button>
              <Button
                variant={groupByEconomic ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setGroupByEconomic(!groupByEconomic); if (!groupByEconomic) setGroupByRefColor(false); }}
                className="gap-1.5 h-7 text-xs"
              >
                <Layers className="h-3.5 w-3.5" />
                Grupo Econômico
              </Button>
            </div>

          </CardContent>
        </Card>
        )}

        {/* ── Barra de resumo + seleção ── */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5">
            <Checkbox
              checked={selectedOrderIds.size === filteredOrders.length && filteredOrders.length > 0}
              onCheckedChange={toggleSelectAll}
              id="select-all-ops"
            />
            <Label htmlFor="select-all-ops" className="cursor-pointer text-xs font-medium text-foreground">
              {selectedOrderIds.size > 0 ? `${selectedOrderIds.size} selecionada(s)` : 'Selecionar todas'}
            </Label>
          </div>
          <span className="text-muted-foreground">
            {filteredOrders.length} de {orders.length} OPs
            {groupByRefColor && groupedOrders && ` · ${groupedOrders.length} grupos`}
            {groupByEconomic && economicGroupedOrders && ` · ${economicGroupedOrders.length} grupos econômicos`}
          </span>
        </div>

        <div
          ref={sel.containerRef}
          onMouseDown={sel.onContainerMouseDown}
          data-marquee-container
          className="relative"
        >
        {filteredOrders.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={ClipboardList}
              title="Nenhuma ordem de produção"
              description="Crie OPs a partir de pedidos aprovados ou ajuste os filtros acima."
            />
          </Panel>
        ) : viewMode === 'kanban' ? (
          <OrdersKanbanBoard
            orders={filteredOrders as any}
            stagesByOrderId={stagesByOrderId as any}
            saleOrderById={saleOrderById as any}
            onSelectOrder={(o: any) => { setDetailOrders([o]); setDetailTitle(`OP ${o.order_number || '—'}`); setDetailDialogOpen(true); }}
          />
        ) : groupByEconomic && economicGroupedOrders ? (
          /* Economic group view */
          <div className="space-y-4">
            {economicGroupedOrders.map((eg) => {
              const groupOrderIds = eg.subgroups.flatMap(s => s.orders.map(o => o.id));
              const selectedInGroup = groupOrderIds.filter(id => selectedOrderIds.has(id)).length;
              const allGroupSelected = groupOrderIds.length > 0 && selectedInGroup === groupOrderIds.length;
              const someGroupSelected = selectedInGroup > 0 && selectedInGroup < groupOrderIds.length;
              const toggleGroupSelection = () => {
                // Toggle individual sem modificador apenas adiciona/remove sem limpar o resto.
                if (allGroupSelected) {
                  groupOrderIds.forEach(id => {
                    if (selectedOrderIds.has(id)) sel.toggle(id);
                  });
                } else {
                  groupOrderIds.forEach(id => {
                    if (!selectedOrderIds.has(id)) sel.toggle(id);
                  });
                }
              };
              return (
              <Card key={eg.groupId} className="border-l-4 border-l-primary">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={allGroupSelected}
                        ref={(el: any) => { if (el) { const input = el.querySelector?.('input'); if (input) input.indeterminate = someGroupSelected; } }}
                        onCheckedChange={toggleGroupSelection}
                        onClick={(e) => e.stopPropagation()}
                        title={allGroupSelected ? 'Desmarcar todas do grupo' : 'Selecionar todas do grupo'}
                      />
                      <Layers className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-base">{eg.groupName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {selectedInGroup > 0 && (
                        <Badge variant="default" className="text-xs">{selectedInGroup}/{groupOrderIds.length} selecionadas</Badge>
                      )}
                      <Badge variant="secondary" className="text-sm">{eg.opCount} OPs</Badge>
                      <Badge variant="outline" className="text-sm font-mono">Total: {eg.totalQty} pares</Badge>
                    </div>
                  </div>
                  <div className="space-y-3 pl-4">
                    {eg.subgroups.map((sub, i) => (
                      <div key={i} className="border-l-2 border-l-muted pl-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-sm">
                            <span className="font-medium">{sub.refName}</span>
                            <span className="text-muted-foreground mx-2">•</span>
                            <span>{sub.color}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">{sub.orders.length} OPs</Badge>
                            <Badge variant="outline" className="text-xs font-mono">{sub.totalQty} pares</Badge>
                          </div>
                        </div>
                        <div className="space-y-1 pl-2">
                          {sub.orders.map(order => {
                            const so = saleOrderById.get((order as any).sale_order_id);
                            return (
                              <div key={order.id} data-marquee-item data-marquee-id={order.id} className={`flex items-center justify-between py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-muted/50 ${selectedOrderIds.has(order.id) ? 'ring-1 ring-primary/50 bg-primary/5' : ''}`} onClick={(e) => { e.stopPropagation(); setDetailOrders([order]); setDetailTitle(`OP ${(order as any).order_number}`); setDetailDialogOpen(true); }}>
                                <div className="flex items-center gap-3 flex-wrap">
                                  <Checkbox
                                    checked={selectedOrderIds.has(order.id)}
                                    onCheckedChange={() => toggleOrderSelection(order.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <span className="font-mono text-xs font-semibold">{(order as any).order_number}</span>
                                  <span className="text-xs text-muted-foreground font-mono">{order.quantity} pares</span>
                                  {so && <span className="text-xs text-muted-foreground">• {so.client_name} — Ped. {so.order_number}</span>}
                                  <StatusPill status={canonicalStatusToKey(order.status)} />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" aria-label="Editar" onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}/edit`); }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        ) : groupByRefColor && groupedOrders ? (
          /* Grouped view */
          <div className="space-y-4">
            {groupedOrders.map((group, idx) => (
              <Card key={idx} className="border-l-4 border-l-primary">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Layers className="h-5 w-5 text-primary" />
                      <div>
                        <span className="font-semibold">{group.refName}</span>
                        <span className="text-muted-foreground mx-2">•</span>
                        <span className="text-sm">{group.color}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="text-sm">
                        {group.orders.length} OPs
                      </Badge>
                      <Badge variant="outline" className="text-sm font-mono">
                        Total: {group.totalQty} pares
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2 pl-8">
                    {group.orders.map(order => {
                      const statusMeta = getOrderStatusMeta(order.status);
                      const orderStages = stagesByOrderId.get(order.id) || [];
                      const hasStages = orderStages.length > 0;
                      const completedStages = orderStages.filter(s => s.status === 'concluido').length;
                      const totalStages = orderStages.length;
                      const deliveryDate = (order as any).planned_delivery;
                      
                      return (
                        <div key={order.id} data-marquee-item data-marquee-id={order.id} className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors border-l-4 ${getStatusBorderClass(statusMeta.canonicalStatus)} ${getStatusBgClass(statusMeta.canonicalStatus)} ${selectedOrderIds.has(order.id) ? 'ring-2 ring-primary/50' : ''} hover:bg-muted/50`} onClick={(e) => { e.stopPropagation(); setDetailOrders([order]); setDetailTitle(`OP ${(order as any).order_number}`); setDetailDialogOpen(true); }}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <Checkbox
                              checked={selectedOrderIds.has(order.id)}
                              onCheckedChange={() => toggleOrderSelection(order.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="font-mono text-sm font-semibold tabular-nums">{(order as any).order_number}</span>
                            <span className="text-sm text-muted-foreground font-mono tabular-nums">{order.quantity} pares</span>
                            {(order as any).color && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <ColorSwatch color={(order as any).color} />
                                {(order as any).color}
                              </span>
                            )}
                            {(() => { const so = saleOrderById.get((order as any).sale_order_id); return so ? <span className="text-xs text-muted-foreground">• {so.client_name} — Ped. {so.order_number}</span> : null; })()}
                            {deliveryDate && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(parseISO(deliveryDate), 'dd/MM', { locale: ptBR })}
                              </span>
                            )}
                            <StatusPill status={canonicalStatusToKey(order.status)} />
                            {hasStages && <SectorProgressDots completed={completedStages} total={totalStages} />}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Consumo" aria-label="Ver consumo da OP" onClick={(e) => { e.stopPropagation(); setConsumptionOrderIds([order.id]); setConsumptionTitle(`OP ${(order as any).order_number || '—'}`); }}>
                              <Package className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar OP" aria-label="Editar OP" onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}/edit`); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Imprimir OP" aria-label="Imprimir OP" onClick={async (e) => {
                              e.stopPropagation();
                              const { data: mats } = await supabase.from('reference_materials').select('*, products(name, unit)').eq('reference_id', order.reference_id);
                              printHtml(`OP ${(order as any).order_number}`, buildProductionOrderPrintHtml(order, mats || []));
                            }}>
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteOrderId(order.id); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          /* Regular list view — grouped by sale order */
          <div className="space-y-4">
            {(() => {
              // Group by sale_order_id
              const saleOrderGroups = new Map<string, typeof filteredOrders>();
              for (const order of filteredOrders) {
                const key = (order as any).sale_order_id || '__avulso__';
                if (!saleOrderGroups.has(key)) saleOrderGroups.set(key, []);
                saleOrderGroups.get(key)!.push(order);
              }
              const sortedGroups = Array.from(saleOrderGroups.entries()).sort(([a], [b]) => {
                if (a === '__avulso__') return 1;
                if (b === '__avulso__') return -1;
                return 0;
              });

              return sortedGroups.map(([groupKey, groupOrds]) => {
                const saleOrder = groupKey !== '__avulso__' ? saleOrderById.get(groupKey) : null;
                const groupTotalPairs = groupOrds.reduce((s, o) => s + o.quantity, 0);

                // If single OP without sale order, render directly
                if (groupKey === '__avulso__') {
                  return groupOrds.map(order => {
                    const statusMeta = getOrderStatusMeta(order.status);
                    const orderStages = stagesByOrderId.get(order.id) || [];
                    const hasStages = orderStages.length > 0;
                    const completedStages = orderStages.filter(s => s.status === 'concluido').length;
                    const totalStages = orderStages.length;

                    return (
                      <Card key={order.id} data-marquee-item data-marquee-id={order.id} className={`group cursor-pointer hover:border-primary/50 transition-colors border-l-4 ${getStatusBorderClass(statusMeta.canonicalStatus)} ${selectedOrderIds.has(order.id) ? 'ring-2 ring-primary/50' : ''}`} onClick={() => { setDetailOrders([order]); setDetailTitle(`OP ${(order as any).order_number}`); setDetailDialogOpen(true); }}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="shrink-0 cursor-pointer p-1 -m-1" onClick={(e) => { e.stopPropagation(); toggleOrderSelection(order.id); }}>
                                {selectedOrderIds.has(order.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                              </span>
                              <span className="font-mono text-sm font-semibold tabular-nums">{(order as any).order_number || '—'}</span>
                              <span className="font-medium">{(order as any).technical_sheets?.name ?? '—'}</span>
                              <span className="text-sm text-muted-foreground font-mono tabular-nums">{order.quantity} pares</span>
                              {(order as any).color && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <ColorSwatch color={(order as any).color} />
                                  {(order as any).color}
                                </span>
                              )}
                              {(() => { const so = saleOrderById.get((order as any).sale_order_id); return so ? <span className="text-xs text-muted-foreground">• {so.client_name} — Ped. {so.order_number}</span> : null; })()}
                              <StatusPill status={canonicalStatusToKey(order.status)} />
                              {(order as any).due_date && (() => {
                                // Normaliza ambas as datas para meia-noite local antes de comparar.
                                const dueRaw = new Date((order as any).due_date);
                                const due = new Date(dueRaw.getFullYear(), dueRaw.getMonth(), dueRaw.getDate());
                                const today = new Date(); today.setHours(0,0,0,0);
                                const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
                                const isLate = diffDays < 0 && order.status !== 'Finalizado' && order.status !== 'Cancelada' && order.status !== 'finalizado' && order.status !== 'cancelado';
                                const isDue = diffDays >= 0 && diffDays <= 3;
                                if (!isLate && !isDue) return null;
                                return (
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${isLate ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600'}`}>
                                    <AlertTriangle className="h-3 w-3" />
                                    {isLate ? `${Math.abs(diffDays)}d atraso` : `vence em ${diffDays}d`}
                                  </span>
                                );
                              })()}
                              {hasStages && <SectorProgressDots completed={completedStages} total={totalStages} />}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Consumo" aria-label="Ver consumo da OP" onClick={(e) => { e.stopPropagation(); setConsumptionOrderIds([order.id]); setConsumptionTitle(`OP ${(order as any).order_number || '—'}`); }}>
                                <Package className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Detalhes" aria-label="Ver detalhes" onClick={(e) => { e.stopPropagation(); setDetailOrders([order]); setDetailTitle(`OP ${(order as any).order_number}`); setDetailDialogOpen(true); }}>
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Editar OP" aria-label="Editar OP" onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}/edit`); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  });
                }

                // Group card for sale order
                return (
                  <Card key={groupKey} className="border-l-4 border-l-primary">
                    <CardContent className="p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer hover:bg-muted/30 rounded-lg p-2 -m-2 transition-colors"
                        onClick={() => {
                          setDetailOrders(groupOrds);
                          setDetailTitle(saleOrder ? `Pedido ${saleOrder.order_number} — ${saleOrder.client_name}` : `Pedido`);
                          setDetailDialogOpen(true);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <ClipboardList className="h-5 w-5 text-primary" />
                          <div>
                            <span className="font-semibold">{saleOrder ? `Pedido ${saleOrder.order_number}` : 'Pedido'}</span>
                            {saleOrder && (
                              <>
                                <span className="text-muted-foreground mx-2">•</span>
                                <span className="text-sm text-muted-foreground">{saleOrder.client_name}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary" className="text-sm">{groupOrds.length} OPs</Badge>
                          <Badge variant="outline" className="text-sm font-mono">Total: {groupTotalPairs} pares</Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>

                      {/* Individual OPs list */}
                      <div className="space-y-1 mt-3 pl-8">
                        {groupOrds.map(order => {
                          const statusMeta = getOrderStatusMeta(order.status);
                          const orderStages = stagesByOrderId.get(order.id) || [];
                          const hasStages = orderStages.length > 0;
                          const completedStages = orderStages.filter(s => s.status === 'concluido').length;
                          const totalStages = orderStages.length;

                          return (
                            <div
                              key={order.id}
                              className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors border-l-4 ${getStatusBorderClass(statusMeta.canonicalStatus)} ${getStatusBgClass(statusMeta.canonicalStatus)} ${selectedOrderIds.has(order.id) ? 'ring-2 ring-primary/50' : ''} hover:bg-muted/50`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailOrders([order]);
                                setDetailTitle(`OP ${(order as any).order_number}`);
                                setDetailDialogOpen(true);
                              }}
                            >
                              <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                                <Checkbox
                                  checked={selectedOrderIds.has(order.id)}
                                  onCheckedChange={() => toggleOrderSelection(order.id)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <span className="font-mono text-sm font-semibold tabular-nums">{(order as any).order_number}</span>
                                <span className="text-sm font-medium">{(order as any).technical_sheets?.name ?? '—'}</span>
                                <span className="text-sm text-muted-foreground font-mono tabular-nums">{order.quantity} pares</span>
                                {(order as any).color && (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <ColorSwatch color={(order as any).color} />
                                    {(order as any).color}
                                  </span>
                                )}
                                <StatusPill status={canonicalStatusToKey(order.status)} />
                                {hasStages && <SectorProgressDots completed={completedStages} total={totalStages} />}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Consumo" aria-label="Ver consumo da OP" onClick={(e) => { e.stopPropagation(); setConsumptionOrderIds([order.id]); setConsumptionTitle(`OP ${(order as any).order_number || '—'}`); }}>
                                  <Package className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Detalhes" aria-label="Ver detalhes" onClick={(e) => { e.stopPropagation(); setDetailOrders([order]); setDetailTitle(`OP ${(order as any).order_number}`); setDetailDialogOpen(true); }}>
                                  <FileText className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Editar OP" aria-label="Editar OP" onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}/edit`); }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              });
            })()}
          </div>
        )}
        {sel.marqueeRect && <MarqueeOverlay rect={sel.marqueeRect} />}
        </div>
      </div>

      {/* BulkActionsBar — aparece quando há OPs selecionadas */}
      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.count === 1 ? 'OP selecionada' : 'OPs selecionadas'}
        actions={[
          { label: 'Avançar Setor', icon: <ArrowRight className="h-3.5 w-3.5" />, onClick: handleBulkAdvance },
          { label: 'Imprimir Fichas', icon: <Printer className="h-3.5 w-3.5" />, variant: 'outline', onClick: handleBulkPrintWorksheets },
          { label: 'Cancelar OPs', icon: <X className="h-3.5 w-3.5" />, variant: 'destructive', onClick: handleBulkCancel },
          { label: 'Exportar', icon: <Download className="h-3.5 w-3.5" />, variant: 'outline', onClick: handleBulkExport },
        ]}
      />

      {/* Detail dialog for OP(s) */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 mt-2">
            {detailOrders.map(order => {
              const ref = referenceById.get(order.reference_id) as any;
              const orderStages = stagesByOrderId.get(order.id) || [];
              const hasStages = orderStages.length > 0;
              const completedStages = orderStages.filter(s => s.status === 'concluido').length;
              const totalStages = orderStages.length;
              const grade = order.grade as Record<string, number> | null;
              const activeSizes = grade ? SIZES_ALL.filter(s => Number(grade[s]) > 0) : [];

              return (
                <div key={order.id} className="border rounded-lg p-4 space-y-4">
                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Foto da Referência */}
                    <div className="w-full md:w-32 aspect-square rounded-lg border bg-muted overflow-hidden shrink-0">
                      {(() => {
                        const colorVariant = (order as any).technical_sheets?.reference_color_variants?.find(
                          (v: any) => (v.color?.toLowerCase().trim() || "") === ((order as any).color?.toLowerCase().trim() || "")
                        );
                        const imageUrl = colorVariant?.image_url || (order as any).technical_sheets?.image_url;
                        
                        return imageUrl ? (
                          <img 
                            src={imageUrl} 
                            alt={ref?.name} 
                            className="w-full h-full object-cover transition-transform hover:scale-110 duration-300" 
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-8 w-8 mb-1 opacity-20" />
                            <span className="text-[10px]">Sem foto</span>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex-1 flex flex-col sm:flex-row justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-mono text-base font-bold">{(order as any).order_number || '—'}</span>
                          <StatusPill status={canonicalStatusToKey(order.status)} />
                        </div>
                        <div className="text-sm space-y-0.5">
                          <p><strong>Referência:</strong> {ref?.code} — {ref?.name}</p>
                          {(order as any).color && <p><strong>Cor:</strong> {(order as any).color}</p>}
                          <p><strong>Quantidade:</strong> {order.quantity} pares</p>
                          {(order as any).planned_start && <p><strong>Início:</strong> {format(parseISO((order as any).planned_start), 'dd/MM/yyyy')}</p>}
                          {(order as any).planned_delivery && <p><strong>Entrega:</strong> {format(parseISO((order as any).planned_delivery), 'dd/MM/yyyy')}</p>}
                          {(order as any).production_line && <p><strong>Linha:</strong> {(order as any).production_line}</p>}
                          {(order as any).responsible && <p><strong>Responsável:</strong> {(order as any).responsible}</p>}
                          {order.notes && <p><strong>Obs:</strong> {order.notes}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Select value={order.status} onValueChange={v => handleManualStatusChange(order, v)}>
                        <SelectTrigger className="h-8 w-[130px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OP_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Consumo" aria-label="Ver consumo da OP" onClick={() => { setConsumptionOrderIds([order.id]); setConsumptionTitle(`OP ${(order as any).order_number || '—'}`); }}>
                        <Package className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Imprimir OP" aria-label="Imprimir OP" onClick={async () => {
                        const { data: mats } = await supabase.from('reference_materials').select('*, products(name, unit)').eq('reference_id', order.reference_id);
                        printHtml(`OP ${(order as any).order_number}`, buildProductionOrderPrintHtml(order, mats || []));
                      }}>
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { setDetailDialogOpen(false); setDeleteOrderId(order.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                  {/* Grade */}
                  {grade && activeSizes.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            {activeSizes.map(s => (
                              <TableHead key={s} className="text-center text-xs px-2">{s}</TableHead>
                            ))}
                            <TableHead className="text-center text-xs px-2 font-bold">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            {activeSizes.map(s => (
                              <TableCell key={s} className="text-center font-mono text-sm px-2">{grade[s] || 0}</TableCell>
                            ))}
                            <TableCell className="text-center font-mono text-sm font-bold px-2">
                              {activeSizes.reduce((sum, s) => sum + (Number(grade[s]) || 0), 0)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Stages pipeline */}
                  {hasStages ? (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">Setores ({completedStages}/{totalStages}):</span>
                      <OrderStagesPipeline
                        stages={orderStages}
                        onStageClick={(stage) => {
                          setSelectedStage(stage);
                          setSelectedOrderNumber((order as any).order_number || '');
                          setStageDialogOpen(true);
                        }}
                      />
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => handleInitStages(order.id, order.quantity)}
                    >
                      <Factory className="h-3.5 w-3.5" />
                      Iniciar Controle por Setor
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sector stage dialog */}
      <SectorStageDialog
        stage={selectedStage}
        open={stageDialogOpen}
        onOpenChange={setStageDialogOpen}
        orderNumber={selectedOrderNumber}
      />

      {/* Order consumption dialog */}
      <OrderConsumptionDialog
        open={consumptionOrderIds.length > 0}
        onOpenChange={(v) => { if (!v) setConsumptionOrderIds([]); }}
        orderIds={consumptionOrderIds}
        title={consumptionTitle}
      />

      {/* OP form dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setForm({ reference_id: '', quantity: 1, notes: '', color: '', planned_start: '', planned_delivery: '', production_line: '', responsible: '', packaging_type: '', packaging_product_id: '', packaging_quantity: 0, sale_order_id: '' });
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Ordem de Produção</DialogTitle>
          </DialogHeader>
          <form onSubmit={handlePrepareOrder} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Cliente / Pedido de Venda */}
              <div className="sm:col-span-2">
                <Label>Cliente / Pedido de Venda</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="mt-1 h-9 w-full justify-between text-sm font-normal"
                    >
                      {form.sale_order_id
                        ? (() => {
                            const so = saleOrderById.get(form.sale_order_id);
                            return so ? `${so.client_name} — Ped. ${so.order_number}` : "Selecione";
                          })()
                        : "Buscar cliente ou pedido..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[450px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Digite o nome do cliente ou nº do pedido..." />
                      <CommandList>
                        <CommandEmpty>Nenhum pedido encontrado.</CommandEmpty>
                        <CommandGroup>
                          {saleOrders
                            .filter((s: any) => s.status !== 'cancelado')
                            .map((s: any) => (
                              <CommandItem
                                key={s.id}
                                value={`${s.client_name} ${s.order_number} ${s.client_order_number || ''}`}
                                onSelect={() => setForm(f => ({ ...f, sale_order_id: s.id }))}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    form.sale_order_id === s.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span className="font-medium">{s.client_name}</span>
                                  <span className="text-xs text-muted-foreground">Ped. {s.order_number}{s.client_order_number ? ` • Ref. ${s.client_order_number}` : ''}</span>
                                </div>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="sm:col-span-2">
                <Label>Referência *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="mt-1 h-9 w-full justify-between text-sm font-normal"
                    >
                      {form.reference_id
                        ? (() => { const r = referenceById.get(form.reference_id) as any; return r ? `${r.code} - ${r.name}` : ''; })()
                        : "Selecione a referência"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[450px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar referência..." />
                      <CommandList>
                        <CommandEmpty>Nenhuma referência encontrada.</CommandEmpty>
                        <CommandGroup>
                          {references.map((r) => (
                            <CommandItem
                              key={r.id}
                              value={`${r.code} ${r.name}`}
                              onSelect={() => setForm(f => ({ ...f, reference_id: r.id }))}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.reference_id === r.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {r.code} - {r.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {form.reference_id && <div className="sm:col-span-2"><OrderMaterialPreview referenceId={form.reference_id} quantity={form.quantity} /></div>}

              <div>
                <Label>Quantidade (pares) *</Label>
                <Input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} required className="mt-1 font-mono" />
              </div>
              <div>
                <Label>Cor / Variação</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="mt-1 h-9 w-full justify-between text-sm font-normal"
                    >
                      {form.color || "Selecione ou digite a cor"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[250px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Buscar ou digitar cor..."
                        onValueChange={(v) => {
                          setForm(f => ({ ...f, color: v }));
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>
                          Pressione Enter para usar "{form.color}"
                        </CommandEmpty>
                        <CommandGroup>
                          {uniqueColors.map((c) => (
                            <CommandItem
                              key={c}
                              value={c}
                              onSelect={(v) => setForm(f => ({ ...f, color: v }))}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.color === c ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {c}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Data Início Planejada</Label>
                <Input type="date" value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Data Entrega Planejada</Label>
                <Input type="date" value={form.planned_delivery} onChange={e => setForm(f => ({ ...f, planned_delivery: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Linha de Produção</Label>
                <Input value={form.production_line} onChange={e => setForm(f => ({ ...f, production_line: e.target.value }))} className="mt-1" placeholder="Ex: Linha 1" />
              </div>
              <div>
                <Label>Responsável</Label>
                <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} className="mt-1" />
              </div>

              {/* Embalagem */}
              <div className="sm:col-span-2 border-t pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Embalagem</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Tipo de Embalagem</Label>
                    <Select value={form.packaging_type} onValueChange={v => setForm(f => ({ ...f, packaging_type: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Caixa Individual">Caixa Individual</SelectItem>
                        <SelectItem value="Caixa Corrugada">Caixa Corrugada</SelectItem>
                        {boxTypesForOrders.map(bt => (
                          <SelectItem key={bt.id} value={bt.nome}>
                            {bt.nome} ({bt.comprimento_cm}×{bt.largura_cm}×{bt.altura_cm} cm)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Produto Embalagem (Estoque)</Label>
                    <Select value={form.packaging_product_id} onValueChange={v => setForm(f => ({ ...f, packaging_product_id: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {packagingProducts.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} (Disp: {p.quantity})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Qtd Embalagem</Label>
                    <Input type="number" min={0} value={form.packaging_quantity} onChange={e => setForm(f => ({ ...f, packaging_quantity: Number(e.target.value) }))} className="mt-1 font-mono" />
                  </div>
                </div>
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={!form.reference_id || form.quantity < 1 || checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Verificar Estoque e Lançar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {allSufficient ? (
                <><CheckCircle2 className="h-5 w-5 text-success" /> Confirmar OP</>
              ) : (
                <><AlertTriangle className="h-5 w-5 text-destructive" /> Estoque Insuficiente</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm">
                  OP: <strong>{selectedRefName}</strong> — Quantidade: <strong>{form.quantity} pares</strong>
                </p>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs">Material</TableHead>
                        <TableHead className="text-xs text-right">Necessário</TableHead>
                        <TableHead className="text-xs text-right">Disponível</TableHead>
                        <TableHead className="text-xs text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockCheckResult.map(s => (
                        <TableRow key={s.product_id}>
                          <TableCell className="text-sm">{s.product_name}</TableCell>
                          <TableCell className="text-sm text-right font-mono">{Number(s.required).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                          <TableCell className="text-sm text-right font-mono">{Number(s.available).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                          <TableCell className="text-center">
                            {s.sufficient ? (
                              <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-xs">OK</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-xs">Insuficiente</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!allSufficient && (
                  <p className="text-sm text-destructive font-medium">
                    Estoque insuficiente. Deseja criar como Rascunho (sem baixa)?
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setConfirmOpen(false); setDialogOpen(true); }}>Voltar</AlertDialogCancel>
            {!allSufficient && (
              <AlertDialogAction onClick={() => {
                createOrder.mutate({ ...form, status_override: 'Rascunho' } as any);
                setConfirmOpen(false);
                setForm({ reference_id: '', quantity: 1, notes: '', color: '', planned_start: '', planned_delivery: '', production_line: '', responsible: '', packaging_type: '', packaging_product_id: '', packaging_quantity: 0, sale_order_id: '' });
                setStockCheckResult([]);
              }} className="bg-muted text-muted-foreground hover:bg-muted/80">
                Salvar como Rascunho
              </AlertDialogAction>
            )}
            {allSufficient && (
              <AlertDialogAction onClick={handleConfirmOrder}>Confirmar e Debitar</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete order confirmation */}
      <AlertDialog open={!!deleteOrderId} onOpenChange={(open) => { if (!open) setDeleteOrderId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Ordem de Produção?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A OP será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteOrderId) { deleteOrder.mutate(deleteOrderId); setDeleteOrderId(null); } }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}

function OrderMaterialPreview({ referenceId, quantity }: { referenceId: string; quantity: number }) {
  const { data: materials = [] } = useSheetMaterials(referenceId);
  if (materials.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">Materiais que serão debitados:</p>
      {materials.map(m => (
        <div key={m.id} className="flex justify-between text-sm">
          <span>{(m as any).products?.name}</span>
          <span className="font-mono text-muted-foreground">
            {(Number(m.quantity_per_unit) * quantity).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {(m as any).products?.unit}
          </span>
        </div>
      ))}
    </div>
  );
}
