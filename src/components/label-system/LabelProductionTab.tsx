/**
 * Unified Label Production Tab — replaces the old Labels page.
 * Contains full printing logic for thermal, box, hangtag and master box labels,
 * integrated with production orders (OPs).
 *
 * Key behaviors:
 * - Labels are linked to OPs: when OPs change, labels update automatically via realtime
 * - packaging_mode on sale_orders controls which label types are available:
 *   · individual_amarrado → individual thermal + box label (no master)
 *   · individual_master   → individual thermal + master box label
 *   · colmeia             → ONLY master/external box label (NO individual)
 * - Print modes: per-OP (one at a time) or batch (all selected / by week)
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Tag, Search, Barcode, Settings2, BoxIcon, Package,
  RotateCcw, Factory, ScanLine, CalendarDays,
  Building2, Loader2, Layers, CheckCircle2, Pencil, Download
} from 'lucide-react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { supabase } from '@/integrations/supabase/client';
import { resolveProductImage } from '@/lib/imageFallback';
import { fetchMainMaterial } from '@/lib/labelUtils';
import { buildBoxIdentificationHtml, buildThermalLabelsHtml, buildThermalLabelsPdf, buildHangtagHtml, type BoxIdentificationData, type ThermalLabelConfig, DEFAULT_THERMAL_CONFIG } from '@/lib/printLabels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useOrders } from '@/hooks/useOrders';
import { useLabelTemplates, SQUAD_THERMAL_DEFAULT_ID, SQUAD_BOX_DEFAULT_ID } from '@/hooks/useLabelTemplates';


const LABEL_SIZES = [
  { id: '100x30', label: '100 × 30 mm', width: 100, height: 30, description: 'Padrão caixa individual (Elgin)' },
  { id: '110x30', label: '110 × 30 mm', width: 110, height: 30, description: 'Caixa individual grande' },
  { id: '100x40', label: '100 × 40 mm', width: 100, height: 40, description: 'Etiqueta média' },
  { id: '100x50', label: '100 × 50 mm', width: 100, height: 50, description: 'Etiqueta grande' },
  { id: '80x30',  label: '80 × 30 mm',  width: 80,  height: 30, description: 'Compacta' },
  { id: '60x30',  label: '60 × 30 mm',  width: 60,  height: 30, description: 'Mini' },
] as const;

/** Build a normalized strap signature string for grouping. Orders with different straps = different products.
 *  Uses sale_order_item_id as primary key; falls back to sale_order_id|reference_id|color|gradeHash
 *  so OPs created without item link still resolve their strap sequence correctly. */
function buildStrapSignature(order: any, strapLookup: Map<string, string>): string {
  // Primary: direct item link
  if (order.sale_order_item_id) {
    const sig = strapLookup.get(order.sale_order_item_id);
    if (sig) return sig;
  }
  // Fallback: composite key built from order attributes
  if (order.sale_order_id && order.reference_id) {
    const gradeHash = order.grade ? Object.entries(order.grade as Record<string, number>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, q]) => `${s}=${q}`)
      .join(',') : '';
    const color = order.color || '';
    const qty = Number(order.quantity) || 0;
    const byQuantityKey = `fbq|${order.sale_order_id}|${order.reference_id}|${color}|${qty}`;
    const byGradeKey = `fb|${order.sale_order_id}|${order.reference_id}|${color}|${gradeHash}`;
    return strapLookup.get(byQuantityKey) || strapLookup.get(byGradeKey) || '';
  }
  return '';
}

export interface GroupedReference {
  groupKey: string;
  referenceId: string;
  refName: string;
  refCode: string;
  colors: string[];
  totalQty: number;
  orderNumbers: string[];
  orders: any[];
  aggregatedGrade: Record<string, number>;
  saleOrderId: string;
  saleOrderNumber: string;
  clientName: string;
  clientOrderNumber: string;
  economicGroupName: string;
  packagingMode: string;
  strapsLabel: string;
}

export function groupOrdersByReference(orders: any[], saleOrdersMap: Map<string, any>, strapLookup?: Map<string, string>): GroupedReference[] {
  const map = new Map<string, GroupedReference>();
  const lookup = strapLookup || new Map<string, string>();
  for (const order of orders) {
    const refId = order.reference_id;
    if (!refId) continue;
    const soId = order.sale_order_id || '';
    const strapSig = buildStrapSignature(order, lookup);
    const key = `${soId}|${refId}|${order.color || ''}|${strapSig}`;
    const ref = order.technical_sheets;
    const so = soId ? saleOrdersMap.get(soId) : null;
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key,
        referenceId: refId,
        refName: ref?.name || '—',
        refCode: ref?.code || '',
        colors: [],
        totalQty: 0,
        orderNumbers: [],
        orders: [],
        aggregatedGrade: {},
        saleOrderId: soId,
        saleOrderNumber: so?.order_number || '',
        clientName: so?.client_name || '',
        clientOrderNumber: so?.client_order_number || '',
        economicGroupName: so?.clients?.economic_groups?.name || '',
        packagingMode: so?.packaging_mode || 'individual_amarrado',
        strapsLabel: strapSig,
      });
    }
    const group = map.get(key)!;
    group.orders.push(order);
    group.totalQty += order.quantity || 0;
    if (order.order_number) group.orderNumbers.push(order.order_number);
    if (order.color && !group.colors.includes(order.color)) group.colors.push(order.color);
    const grade = order.grade as Record<string, number> | null;
    if (grade) {
      for (const [size, qty] of Object.entries(grade)) {
        group.aggregatedGrade[size] = (group.aggregatedGrade[size] || 0) + (Number(qty) || 0);
      }
    }
  }
  return Array.from(map.values());
}

/** Returns which label types are allowed for a given packaging mode */
function getAllowedLabelTypes(packagingMode: string): { thermal: boolean; boxLabel: boolean; masterBox: boolean; hangtag: boolean } {
  switch (packagingMode) {
    case 'colmeia':
      // Colmeia = only external/master box label, NO individual
      return { thermal: false, boxLabel: false, masterBox: true, hangtag: true };
    case 'individual_master':
      // Individual + Master box
      return { thermal: true, boxLabel: false, masterBox: true, hangtag: true };
    case 'individual_amarrado':
    default:
      // Individual box + tied bundle (no master)
      return { thermal: true, boxLabel: true, masterBox: false, hangtag: true };
  }
}

function getPackagingBadge(mode: string) {
  switch (mode) {
    case 'colmeia': return { label: 'Colméia', variant: 'destructive' as const };
    case 'individual_master': return { label: 'Individual + Master', variant: 'default' as const };
    default: return { label: 'Individual + Amarrado', variant: 'secondary' as const };
  }
}

function ReferenceCard({ group, selected, onToggle }: { group: GroupedReference; selected: boolean; onToggle: () => void }) {
  const sizes = Object.entries(group.aggregatedGrade)
    .filter(([, v]) => (v as number) > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, v]) => `${s}(${v})`)
    .join(', ');
  const pkgBadge = getPackagingBadge(group.packagingMode);
  const allowed = getAllowedLabelTypes(group.packagingMode);

  return (
    <Card 
      className={cn(
        "transition-all cursor-pointer select-none",
        selected ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md" : "hover:border-primary/40 hover:bg-muted/30"
      )}
      onClick={onToggle}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Checkbox checked={selected} onCheckedChange={onToggle} />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm truncate">{group.refName}</span>
                {group.refCode && group.refCode !== group.refName && (
                  <Badge variant="outline" className="font-mono text-[10px] h-4.5 px-1.5 opacity-70">
                    {group.refCode}
                  </Badge>
                )}
              </div>
              {group.clientName && (
                <Badge variant="secondary" className="text-[10px] h-4.5 max-w-[100px] truncate shrink-0">
                  {group.clientName}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80 truncate">
                Cores: {group.colors.join(', ') || '—'}
              </span>
              <span className="shrink-0">
                Total: <strong className="text-foreground">{group.totalQty}</strong> prs
              </span>
            </div>

            {group.strapsLabel && (
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-[9px] h-4 bg-accent/50 border-accent text-accent-foreground">
                  🔗 {group.strapsLabel.replace(/\|/g, ' — ')}
                </Badge>
              </div>
            )}

            {sizes && (
              <div className="bg-muted/40 rounded px-1.5 py-1">
                <p className="text-[10px] text-muted-foreground font-mono leading-tight">
                  <span className="font-semibold text-foreground/70 mr-1">Grade:</span>
                  {sizes}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <Badge variant={pkgBadge.variant} className="text-[9px] h-4 px-1.5 uppercase tracking-wider">
                {pkgBadge.label}
              </Badge>
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-medium uppercase tracking-tighter">
                <span className={cn(allowed.thermal ? "text-primary" : "opacity-50")}>
                  {allowed.thermal ? '✓' : '✗'} Térmica
                </span>
                <span className="opacity-30">|</span>
                <span className={cn(allowed.masterBox ? "text-primary" : "opacity-50")}>
                  {allowed.masterBox ? '✓' : '✗'} Master
                </span>
              </div>
            </div>
            
            <p className="text-[10px] text-muted-foreground font-mono mt-1.5 pt-1.5 border-t border-border/40 opacity-70">
              OPs: {group.orderNumbers.join(', ')}
            </p>

          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function PrintHistoryTable() {
  const { data: history, isLoading } = useQuery({
    queryKey: ['print_history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('print_jobs').select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    },
    staleTime: 30000
  });

  if (isLoading) return <div className="p-20 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary/30" /></div>;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b bg-muted/30">
            <th className="p-4 font-semibold text-xs uppercase tracking-wider">Lote/Identificação</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider">Data e Hora</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider text-center">Etiquetas</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-muted/50">
          {history?.map(j => (
            <tr key={j.id} className="hover:bg-muted/10 transition-colors">
              <td className="p-4 font-medium text-xs">{j.batch_name}</td>
              <td className="p-4 text-muted-foreground text-xs">{new Date(j.created_at).toLocaleString('pt-BR')}</td>
              <td className="p-4 text-center font-mono text-xs">{j.total_labels}</td>
              <td className="p-4 text-center">
                <Badge variant={j.status === 'completed' ? 'secondary' : 'outline'} className="text-[9px] uppercase tracking-tighter px-2 h-5">
                  {j.status === 'completed' ? 'Processado' : j.status}
                </Badge>
              </td>
            </tr>
          ))}
          {(!history || history.length === 0) && (
            <tr><td colSpan={4} className="p-20 text-center text-muted-foreground italic text-xs">Nenhum histórico de impressão disponível no momento.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LabelProductionTab() {
  const queryClient = useQueryClient();
  const { data: allOrders = [] } = useOrders();
  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_labels'],
    queryFn: async () => {
      // Endereço/cidade/UF/transportadora vêm via JOIN — usados pra preencher
      // o rótulo da caixa externa (campos opcionais que omitimos se faltarem).
      const { data, error } = await supabase
        .from('sale_orders')
        .select(`
          *,
          clients(id, razao_social, cnpj, endereco, bairro, cidade, estado, cep, economic_group_id, economic_groups(name)),
          transport_companies:transport_company_id(nome)
        `);
      if (error) throw error;
      return data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  // Fetch sale_order_items with strap_colors to build strap lookup for grouping
  const { data: strapLookup = new Map<string, string>() } = useQuery({
    queryKey: ['sale_order_items_strap_lookup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('id, sale_order_id, reference_id, color, quantity, grade, strap_colors')
        .not('strap_colors', 'is', null);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const item of data || []) {
        const straps = item.strap_colors as any[];
        if (Array.isArray(straps) && straps.length > 0) {
          const sig = straps
            .filter((s: any) => s.label && s.color)
            .map((s: any) => `${s.label}:${s.color}`)
            .join('|');
          if (sig) {
            map.set(item.id, sig);
            if (item.sale_order_id && item.reference_id) {
              const color = item.color || '';
              const qty = Number((item as any).quantity) || 0;
              if (qty > 0) {
                map.set(`fbq|${item.sale_order_id}|${item.reference_id}|${color}|${qty}`, sig);
              }
              const gradeObj = (item.grade && typeof item.grade === 'object' && !Array.isArray(item.grade))
                ? item.grade as Record<string, number> : {};
              const gradeHash = Object.entries(gradeObj)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([s, q]) => `${s}=${q}`)
                .join(',');
              map.set(`fb|${item.sale_order_id}|${item.reference_id}|${color}|${gradeHash}`, sig);
            }
          }
        }
      }
      return map;
    },
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('labels-tab-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sale_orders_for_labels'] });
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') { /* realtime error — subscription will retry */ }
      });
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const saleOrdersMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const so of saleOrders) map.set(so.id, so);
    return map;
  }, [saleOrders]);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelSize, setLabelSize] = useState('100x30');
  const [activeTab, setActiveTab] = useState('individual');
  const [statusTab, setStatusTab] = useState<'producao' | 'imprimidos' | 'finalizados'>('producao');

  // Track which order IDs have been printed
  const { data: printedOrderIds = new Set<string>() } = useQuery({
    queryKey: ['printed_order_ids'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.from('print_jobs').select('order_ids').not('order_ids', 'is', null).gte('created_at', thirtyDaysAgo);
      if (error) throw error;
      const ids = new Set<string>();
      for (const row of data || []) {
        const arr = row.order_ids as any;
        if (Array.isArray(arr)) arr.forEach((id: string) => ids.add(id));
      }
      return ids;
    },
    staleTime: 30000,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [labelConfig, setLabelConfig] = useState<ThermalLabelConfig>({ ...DEFAULT_THERMAL_CONFIG });
  const [serializationStart, setSerializationStart] = useState(1);
  const [useSerialization, setUseSerialization] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  // billing_week dropdown — '__all__' lista tudo, demais valores são keys
  // como "2026-05-S4" provenientes de sale_orders.billing_week
  const [billingWeekFilter, setBillingWeekFilter] = useState<string>('__all__');
  const [showScanner, setShowScanner] = useState(false);
  const [pairsPerFicha, setPairsPerFicha] = useState(12);
  const [fichasPerBox, setFichasPerBox] = useState(1);
  const [thermalMode, setThermalMode] = useState<'quantity' | 'ficha'>('quantity');
  const [printMode, setPrintMode] = useState<'batch' | 'per_op'>('batch');
  const [selectedThermalTemplateId, setSelectedThermalTemplateId] = useState(SQUAD_THERMAL_DEFAULT_ID);
  const [selectedBoxTemplateId, setSelectedBoxTemplateId] = useState(SQUAD_BOX_DEFAULT_ID);

  const { templates: allLabelTemplates } = useLabelTemplates();
  const thermalTemplates = useMemo(() => allLabelTemplates.filter(t => (t.category === 'thermal' || t.category === 'individual_box') && t.is_active), [allLabelTemplates]);
  const boxTemplates = useMemo(() => allLabelTemplates.filter(t => (t.category === 'master_box' || t.category === 'shipping') && t.is_active), [allLabelTemplates]);

  // Strap label overrides — allows user to edit strap text per group for labels
  const [strapsLabelOverrides, setStrapsLabelOverrides] = useState<Record<string, string>>({});
  const [editingStrapsGroup, setEditingStrapsGroup] = useState<string | null>(null);
  const [editingStrapsText, setEditingStrapsText] = useState('');

  const getEffectiveStrapsLabel = (group: GroupedReference) => {
    if (strapsLabelOverrides[group.groupKey] !== undefined) return strapsLabelOverrides[group.groupKey];
    return group.strapsLabel || '';
  };

  const currentSize = LABEL_SIZES.find(s => s.id === labelSize) || LABEL_SIZES[0];

  const productionOrders = allOrders.filter((o: any) => !!o.sale_order_id);
  const finishedSaleOrderIds = useMemo(
    () => new Set(
      saleOrders.filter((so: any) => ['Faturado', 'Expedido', 'Concluído'].includes(so.status)).map((so: any) => so.id)
    ),
    [saleOrders]
  );
  const activeOrdersAll = productionOrders.filter((o: any) =>
    o.status !== 'Finalizado' && !finishedSaleOrderIds.has(o.sale_order_id)
  );
  // Split active orders into printed vs not printed
  const activeOrders = activeOrdersAll.filter((o: any) => !printedOrderIds.has(o.id));
  const printedActiveOrders = activeOrdersAll.filter((o: any) => printedOrderIds.has(o.id));
  const finishedOrders = productionOrders.filter((o: any) =>
    o.status === 'Finalizado' || finishedSaleOrderIds.has(o.sale_order_id)
  );
  const currentOrders = statusTab === 'producao' ? activeOrders : statusTab === 'imprimidos' ? printedActiveOrders : finishedOrders;

  // Available billing_weeks for the dropdown — collected from current orders'
  // associated sale_orders. Sorted by year-month-week (ascending).
  const availableBillingWeeks = useMemo(() => {
    const set = new Set<string>();
    for (const o of currentOrders as any[]) {
      const bw = saleOrdersMap.get(o.sale_order_id)?.billing_week;
      if (bw) set.add(bw);
    }
    return Array.from(set).sort();
  }, [currentOrders, saleOrdersMap]);

  const periodFilteredOrders = useMemo(() => {
    let result = currentOrders;

    // Filtro 1: billing_week específica (dropdown estilo faturamento)
    if (billingWeekFilter !== '__all__') {
      result = result.filter((o: any) => {
        const bw = saleOrdersMap.get(o.sale_order_id)?.billing_week;
        return bw === billingWeekFilter;
      });
    }

    // Filtro 2: período "rápido" (Semana atual / Mês atual / Todos)
    if (periodFilter === 'all') return result;
    const now = new Date();
    let start: Date; let end: Date;
    switch (periodFilter) {
      case 'week': start = startOfWeek(now); end = endOfWeek(now); break;
      case 'month': start = startOfMonth(now); end = endOfMonth(now); break;
      default: return result;
    }
    return result.filter((o: any) => {
      const deadline = saleOrdersMap.get(o.sale_order_id)?.delivery_deadline;
      if (!deadline) return true;
      const d = parseISO(deadline);
      return isWithinInterval(d, { start, end });
    });
  }, [currentOrders, periodFilter, billingWeekFilter, saleOrdersMap]);

  const groupedRefs = groupOrdersByReference(periodFilteredOrders, saleOrdersMap, strapLookup);
  const filtered = groupedRefs.filter((g) => {
    const q = search.toLowerCase();
    return !search || g.refName?.toLowerCase().includes(q) || g.refCode?.toLowerCase().includes(q) || g.clientName?.toLowerCase().includes(q) || g.economicGroupName?.toLowerCase().includes(q) || g.saleOrderNumber?.toLowerCase().includes(q);
  });

  const groupedByEconomicGroup = useMemo(() => {
    const map = new Map<string, GroupedReference[]>();
    for (const g of filtered) {
      const egName = g.economicGroupName || 'Clientes Individuais';
      if (!map.has(egName)) map.set(egName, []);
      map.get(egName)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Determine which label types are allowed for the current selection
  const selectionLabelTypes = useMemo(() => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return { thermal: true, boxLabel: true, masterBox: true, hangtag: true };
    // Intersection: only show types that ALL selected items support
    let thermal = true, boxLabel = true, masterBox = true, hangtag = true;
    for (const g of selectedGroups) {
      const allowed = getAllowedLabelTypes(g.packagingMode);
      if (!allowed.thermal) thermal = false;
      if (!allowed.boxLabel) boxLabel = false;
      if (!allowed.masterBox) masterBox = false;
      if (!allowed.hangtag) hangtag = false;
    }
    return { thermal, boxLabel, masterBox, hangtag };
  }, [filtered, selected]);

  // Check if any selected group uses colmeia (to show warning)
  const hasColmeiaSelected = useMemo(() => {
    return filtered.filter(g => selected.has(g.groupKey)).some(g => g.packagingMode === 'colmeia');
  }, [filtered, selected]);

  const getOrderFichaMetrics = (order: any) => {
    const baseGrade = (order?.grade && typeof order.grade === 'object' ? order.grade : {}) as Record<string, number>;
    const gradeEntries = Object.entries(baseGrade)
      .map(([size, qty]) => [size, Number(qty) || 0] as const)
      .filter(([, qty]) => qty > 0)
      .sort(([a], [b]) => Number(a) - Number(b));
    const pairsInOneFicha = gradeEntries.reduce((sum, [, qty]) => sum + qty, 0);
    const totalPairs = Number(order?.quantity) || 0;
    const explicitFichas = Number(order?.fichas);
    const derivedFichas = pairsInOneFicha > 0 && totalPairs > 0 ? totalPairs / pairsInOneFicha : 1;
    const numFichas = Math.max(1, Math.ceil(explicitFichas > 0 ? explicitFichas : derivedFichas || 1));
    return {
      gradeText: gradeEntries.map(([size, qty]) => `${size}(${qty})`).join(' '),
      pairsInOneFicha: pairsInOneFicha || Math.max(1, Number(pairsPerFicha) || 1),
      numFichas,
    };
  };

  const handlePrintHangtags = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return;
    setIsGenerating(true);
    try {
      const { data: careData } = await supabase.from('care_instructions').select('*');
      const labels: any[] = [];
      let currentSerial = serializationStart;
      const logoUrl = new URL(logoImg, window.location.origin).href;
      for (const group of selectedGroups) {
        const mainMaterial = await fetchMainMaterial(group.referenceId).catch(() => '');
        const care = careData?.find(c => mainMaterial.toLowerCase().includes(c.name.toLowerCase())) || careData?.[0];
        for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
          const safeQty = Math.min(Number(qty) || 0, 500);
          for (let i = 0; i < safeQty; i++) {
            labels.push({
              refCode: group.refCode, refName: group.refName, color: group.colors[0] || '', size,
              barcode: group.refCode ? `${group.refCode}${size.padStart(2, '0')}${currentSerial.toString().padStart(4, '0')}` : group.groupKey,
              qrcode: group.refCode ? `https://squadshoes.com.br/product/${group.refCode}` : '',
              composition: mainMaterial, careSymbols: care?.symbols || [],
              logoUrl, brandName: 'SQUAD SHOES',
            });
            if (useSerialization) currentSerial++;
          }
        }
      }
      setPrintHtml(buildHangtagHtml(labels));
      const orderIds = selectedGroups.flatMap(g => g.orders.map((o: any) => o.id));
      await supabase.from('print_jobs').insert({ batch_name: `Hangtags - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed', order_ids: orderIds } as any);
      queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
      toast.success(`${labels.length} hangtags geradas.`);
    } catch (err: any) { toast.error(err.message); } finally { setIsGenerating(false); }
  };

  const handlePrintIndividual = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    // Filter out groups that don't allow thermal labels
    const thermalGroups = selectedGroups.filter(g => getAllowedLabelTypes(g.packagingMode).thermal);
    if (thermalGroups.length === 0) {
      toast.error('Nenhum pedido selecionado permite etiquetas individuais (verifique o tipo de embalagem).');
      return;
    }
    setIsGenerating(true);
    try {
      const labels: any[] = [];
      const logoUrl = new URL(logoImg, window.location.origin).href;
      const uniqueRefIds = [...new Set(thermalGroups.map(g => g.referenceId))];
      const [refDataMap, materialMap] = await Promise.all([
        supabase.from('technical_sheets').select('id, image_url, images, code, shoe_category').in('id', uniqueRefIds)
          .then(({ data }) => { const map = new Map<string, any>(); for (const r of data || []) map.set(r.id, r); return map; }),
        Promise.all(uniqueRefIds.map(async id => [id, await fetchMainMaterial(id).catch(() => '')] as const)).then(entries => new Map(entries)),
      ]);
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of thermalGroups) {
        const colorName = group.colors[0] || '';
        const key = `${group.referenceId}|${colorName}`;
        if (!imageKeys.has(key)) { imageKeys.add(key); imageRequests.push({ key, referenceId: group.referenceId, colorName }); }
        if (thermalMode === 'ficha') {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderKey = `${group.referenceId}|${orderColor}`;
            if (!imageKeys.has(orderKey)) { imageKeys.add(orderKey); imageRequests.push({ key: orderKey, referenceId: group.referenceId, colorName: orderColor }); }
          }
        }
      }
      const imageResults = await Promise.all(imageRequests.map(async ({ key, referenceId, colorName }) => {
        const url = await resolveProductImage({ referenceId, colorName, fallbackUrl: logoUrl }).catch(() => logoUrl);
        return [key, url] as const;
      }));
      const imageMap = new Map(imageResults);

      for (const group of thermalGroups) {
        const mainMaterial = materialMap.get(group.referenceId) || '';
        const refData = refDataMap.get(group.referenceId);
        const colorName = group.colors[0] || '';
        const productImageUrl = imageMap.get(`${group.referenceId}|${colorName}`) || logoUrl;
        if (thermalMode === 'quantity') {
          for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
            for (let i = 0; i < Math.min(qty as number, 2000); i++) {
              labels.push({ refCode: group.refCode, refName: group.refName, mainMaterial, color: colorName, size, barcode: group.refCode || group.groupKey, imageUrl: productImageUrl, shoeCategory: refData?.shoe_category || '', strapsLabel: getEffectiveStrapsLabel(group) });
            }
          }
        } else {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderImageUrl = imageMap.get(`${group.referenceId}|${orderColor}`) || productImageUrl;
            const { gradeText, pairsInOneFicha, numFichas } = getOrderFichaMetrics(order);
            for (let i = 0; i < numFichas; i++) {
              labels.push({ refCode: group.refCode, refName: group.refName, mainMaterial, color: orderColor, size: gradeText || `${pairsInOneFicha} PRS`, barcode: group.refCode || order.order_number || group.groupKey, imageUrl: orderImageUrl, shoeCategory: refData?.shoe_category || '', strapsLabel: getEffectiveStrapsLabel(group) });
            }
          }
        }
      }
      const orderIds = thermalGroups.flatMap(g => g.orders.map((o: any) => o.id));
      await supabase.from('print_jobs').insert({ batch_name: `Térmicas - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed', order_ids: orderIds } as any).throwOnError();
      queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
      setPrintHtml(buildThermalLabelsHtml(labels, logoUrl, { width: currentSize.width, height: currentSize.height }, labelConfig));
      toast.success(`${labels.length} etiquetas térmicas geradas.`);
    } catch (err: any) { toast.error(err?.message || 'Erro ao gerar etiquetas'); } finally { setIsGenerating(false); }
  };

  const handleDownloadPdf = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    const thermalGroups = selectedGroups.filter(g => getAllowedLabelTypes(g.packagingMode).thermal);
    if (thermalGroups.length === 0) {
      toast.error('Nenhum pedido selecionado permite etiquetas individuais.');
      return;
    }
    setIsGenerating(true);
    try {
      const uniqueRefIds = [...new Set(thermalGroups.map(g => g.referenceId))];
      const [refDataMap, materialMap] = await Promise.all([
        supabase.from('technical_sheets').select('id, code, shoe_category').in('id', uniqueRefIds)
          .then(({ data }) => { const map = new Map<string, any>(); for (const r of data || []) map.set(r.id, r); return map; }),
        Promise.all(uniqueRefIds.map(async id => [id, await fetchMainMaterial(id).catch(() => '')] as const)).then(entries => new Map(entries)),
      ]);

      const labels: { refCode: string; refName: string; mainMaterial: string; color: string; size: string; barcode: string; shoeCategory?: string; clientOrderNumber?: string; qty?: number; strapsLabel?: string; }[] = [];
      for (const group of thermalGroups) {
        const mainMaterial = materialMap.get(group.referenceId) || '';
        const refData = refDataMap.get(group.referenceId);
        const colorName = group.colors[0] || '';
        if (thermalMode === 'quantity') {
          for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
            for (let i = 0; i < Math.min(qty as number, 2000); i++) {
              labels.push({
                refCode: group.refCode, refName: group.refName, mainMaterial,
                color: colorName, size, barcode: group.refCode || group.groupKey,
                shoeCategory: refData?.shoe_category || '',
                clientOrderNumber: group.clientOrderNumber || '',
                strapsLabel: getEffectiveStrapsLabel(group),
              });
            }
          }
        } else {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const { gradeText, pairsInOneFicha, numFichas } = getOrderFichaMetrics(order);
            for (let i = 0; i < numFichas; i++) {
              labels.push({
                refCode: group.refCode, refName: group.refName, mainMaterial,
                color: orderColor, size: gradeText || `${pairsInOneFicha} PRS`,
                barcode: group.refCode || order.order_number || group.groupKey,
                shoeCategory: refData?.shoe_category || '',
                clientOrderNumber: group.clientOrderNumber || '',
                qty: pairsInOneFicha,
                strapsLabel: getEffectiveStrapsLabel(group),
              });
            }
          }
        }
      }
      if (labels.length === 0) {
        toast.error('Nada para gerar.');
        return;
      }
      const blob = await buildThermalLabelsPdf(
        labels,
        { width: currentSize.width, height: currentSize.height },
        '62.406.033/0001-93',
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `etiquetas-${currentSize.id}-${labels.length}un-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const orderIds = thermalGroups.flatMap(g => g.orders.map((o: any) => o.id));
      await supabase.from('print_jobs').insert({ batch_name: `PDF ${currentSize.label} - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed', order_ids: orderIds } as any);
      queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
      toast.success(`PDF gerado: ${labels.length} etiquetas (${currentSize.label}). Abra e imprima.`);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrintBoxLabels = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    // Filter: only groups that allow master/box labels
    const boxGroups = selectedGroups.filter(g => {
      const allowed = getAllowedLabelTypes(g.packagingMode);
      return allowed.masterBox || allowed.boxLabel;
    });
    if (boxGroups.length === 0) {
      toast.error('Nenhum pedido selecionado permite rótulo de caixa externa.');
      return;
    }
    setIsGenerating(true);
    try {
      const logoUrl = new URL(logoImg, window.location.origin).href;
      const refDataMap = new Map<string, any>();
      const materialMap = new Map<string, string>();
      const imageMap = new Map<string, string>();
      const uniqueRefIds = [...new Set(boxGroups.map(g => g.referenceId))];
      await Promise.all(uniqueRefIds.map(async (refId) => {
        const [{ data: refData }, material] = await Promise.all([
          supabase.from('technical_sheets').select('image_url, images, code, shoe_category').eq('id', refId).single(),
          fetchMainMaterial(refId).catch(() => ''),
        ]);
        refDataMap.set(refId, refData);
        materialMap.set(refId, material);
      }));
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of boxGroups) {
        for (const order of group.orders) {
          const key = `${group.referenceId}|${order.color || ''}`;
          if (!imageKeys.has(key)) { imageKeys.add(key); imageRequests.push({ key, referenceId: group.referenceId, colorName: order.color || '' }); }
        }
      }
      const imageResults = await Promise.all(imageRequests.map(async ({ key, referenceId, colorName }) => {
        const url = await resolveProductImage({ referenceId, colorName, fallbackUrl: logoUrl }).catch(() => logoUrl);
        return [key, url] as const;
      }));
      imageResults.forEach(([k, v]) => imageMap.set(k, v));

      const boxItems: BoxIdentificationData[] = [];
      for (const group of boxGroups) {
        const refData = refDataMap.get(group.referenceId);
        const mainMaterial = materialMap.get(group.referenceId) || '';
        for (const order of group.orders) {
          // Parse grade defensivamente — Supabase devolve JSONB como objeto JS,
          // mas se vier string (caso de cache antigo, .raw, ou serialização
          // intermediária), parseamos. Antes assumíamos sempre objeto.
          let grade: Record<string, number> | null = null;
          const rawGrade = (order as any).grade;
          if (rawGrade && typeof rawGrade === 'object' && !Array.isArray(rawGrade)) {
            grade = rawGrade as Record<string, number>;
          } else if (typeof rawGrade === 'string' && rawGrade.trim().startsWith('{')) {
            try { grade = JSON.parse(rawGrade); } catch { grade = null; }
          }
          const sizes = grade ? Object.keys(grade).sort((a, b) => Number(a) - Number(b)) : [];
          const gradeItems = sizes.map(size => ({ size, qty: Number(grade?.[size]) || 0 }));
          // grade já é por ficha (sum(grade) = pares em 1 ficha; quantity = pares
          // totais = sum(grade) × fichas). Nº de fichas vem de pairsPerFicha
          // configurado pelo usuário OU do próprio sum(grade) se não setado.
          const pairsInOneFicha = gradeItems.reduce((sum, g) => sum + g.qty, 0);
          const fichas = pairsPerFicha > 0
            ? Math.ceil(order.quantity / pairsPerFicha)
            : (pairsInOneFicha > 0 ? Math.max(1, Math.round(order.quantity / pairsInOneFicha)) : 1);
          const totalMasterBoxes = Math.ceil(fichas / (fichasPerBox || 1));
          const so = saleOrdersMap.get(order.sale_order_id);
          const finalImageUrl = imageMap.get(`${group.referenceId}|${order.color || ''}`) || logoUrl;
          // Cada ficha imprime a grade COMPLETA (não dividir por fichas — a grade
          // do PV já representa a distribuição de 1 ficha). Bug anterior: dividia
          // por fichas e perdia tudo no floor (1/50 = 0), só a última ficha
          // herdava o resto via remainder. Resultado: 49 etiquetas em branco com
          // "CORRUGADO 0 PRS" e 1 etiqueta completa no final.
          //
          // Se pairsPerFicha (config do usuário) for diferente de sum(grade),
          // escala proporcionalmente — cada caixa contém pairsPerFicha pares.
          const useScale = pairsInOneFicha > 0 && pairsPerFicha > 0 && pairsPerFicha !== pairsInOneFicha;
          const scale = useScale ? pairsPerFicha / pairsInOneFicha : 1;
          let gradePerFicha = gradeItems.map(g => ({ size: g.size, qty: Math.round(g.qty * scale) }));
          // Defesa: se escala fracionária derrubou tudo pra 0 mas a grade
          // original tem qty (pairsInOneFicha > 0), usa a grade direta — melhor
          // mostrar a distribuição da ficha do que etiqueta zerada.
          if (gradePerFicha.reduce((s, g) => s + g.qty, 0) === 0 && pairsInOneFicha > 0) {
            gradePerFicha = gradeItems.map(g => ({ size: g.size, qty: g.qty }));
          }
          if (import.meta.env.DEV && pairsInOneFicha === 0) {
            console.warn('[LabelProductionTab] order sem grade utilizável:', {
              order_number: order.order_number, rawGrade, gradeItems,
            });
          }
          // Calcula o "range" do tamanho para o destaque grande no canto da
          // etiqueta — ex.: 29-36, ou só "36" se houver um tamanho só.
          const sizeKeys = gradePerFicha.map(g => g.size).filter(s => s && !isNaN(Number(s)));
          const sizeNumbers = sizeKeys.map(Number).sort((a, b) => a - b);
          const sizeRangeLabel = sizeNumbers.length > 1
            ? `${sizeNumbers[0]}-${sizeNumbers[sizeNumbers.length - 1]}`
            : (sizeNumbers.length === 1 ? String(sizeNumbers[0]) : '');

          // Endereço completo do destinatário formatado em uma linha
          const client = so?.clients;
          const recipientAddress = client
            ? [client.endereco, client.bairro].filter(Boolean).join(', ') || undefined
            : undefined;
          const recipientCity = client?.cidade || undefined;
          const recipientUf = client?.estado || undefined;
          // Code do cliente: usa os últimos 5 dígitos do CNPJ como identificador
          // numérico curto (fallback razoável quando não há campo dedicado).
          const recipientCode = client?.cnpj
            ? client.cnpj.replace(/\D/g, '').slice(-5)
            : undefined;
          const transporter = so?.transport_companies?.nome || undefined;

          for (let f = 0; f < fichas; f++) {
            const currentBoxNumber = Math.ceil((f + 1) / (fichasPerBox || 1));
            boxItems.push({
              orderNumber: order.order_number || '', refCode: refData?.code || group.refCode || '', refName: group.refName || '',
              color: order.color || '—', boxNumber: currentBoxNumber, totalBoxes: totalMasterBoxes,
              senderName: 'SQUAD SHOES IND. E COM. DE CALÇADOS LTDA', senderCnpj: '62.406.033/0001-93',
              senderAddress: 'Rua Armando Krug, 525 · Bairro Canabarro · Teutônia/RS',
              recipientName: so?.client_name || '',
              recipientCnpj: so?.client_cnpj || '',
              recipientCode,
              recipientAddress,
              recipientCity,
              recipientUf,
              transporter,
              clientOrderNumber: so?.client_order_number || '',
              shoeCategory: refData?.shoe_category || '',
              mainMaterial,
              grade: gradePerFicha,
              barcode: order.order_number,
              imageUrl: finalImageUrl,
              nfe: so?.nfe || '',
              remessa: so?.remessa || '',
              strapsLabel: getEffectiveStrapsLabel(group),
              sizeRangeLabel,
              totalPairsInRemessa: order.quantity,
              taloes: fichas,
              lote: order.order_number,
              pageNumber: undefined, // computado abaixo, depois do loop
              pageTotal: undefined,
            });
          }
        }
      }
      // Preenche pageNumber/pageTotal agora que conhecemos o total de etiquetas
      const totalItems = boxItems.length;
      for (let i = 0; i < boxItems.length; i++) {
        boxItems[i].pageNumber = i + 1;
        boxItems[i].pageTotal = totalItems;
      }
      setPrintHtml(buildBoxIdentificationHtml(boxItems));
      const orderIds = boxGroups.flatMap(g => g.orders.map((o: any) => o.id));
      await supabase.from('print_jobs').insert({ batch_name: `Rótulos Caixa - ${new Date().toLocaleString()}`, total_labels: boxItems.length, status: 'completed', order_ids: orderIds } as any);
      queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
    } catch (err: any) { toast.error(err.message); } finally { setIsGenerating(false); }
  };

  useEffect(() => {
    if (printHtml) {
      const w = window.open('', '_blank', 'width=900,height=700');
      if (w) {
        w.document.write(printHtml);
        w.document.close();
        const fallbackTimer = setTimeout(() => { try { w.print(); } catch {} }, 6000);
        w.onload = () => {
          clearTimeout(fallbackTimer);
          const imagesReady = (w as any)._imagesReady;
          if (imagesReady && typeof imagesReady.then === 'function') {
            imagesReady.then(() => { setTimeout(() => w.print(), 300); });
          } else { setTimeout(() => w.print(), 600); }
        };
      } else {
        toast.error('Popup bloqueado pelo navegador. Permita popups para imprimir.');
      }
      setPrintHtml(null);
    }
  }, [printHtml]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2 text-foreground">
            <Tag className="h-5 w-5 text-primary" />
            Geração & Impressão
          </h2>
          <p className="text-xs text-muted-foreground">Etiquetas vinculadas às OPs — alterações na OP atualizam automaticamente</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowScanner(!showScanner)} className="h-8"><ScanLine className="h-4 w-4 mr-2" />Leitor</Button>
          <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)} className="h-8"><Settings2 className="h-4 w-4 mr-2" />Ajustes</Button>
        </div>
      </div>

      {showConfig && (
        <Card className="animate-in slide-in-from-top-2 border-primary/20 shadow-lg">
          <CardHeader className="bg-muted/50 py-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Configurações de Impressão
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Barcode className="h-3 w-3" /> Caixa Individual (Térmica)
                </h4>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Template Ativo</Label>
                  <Select value={selectedThermalTemplateId} onValueChange={setSelectedThermalTemplateId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {thermalTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.dimensions.width}×{t.dimensions.height}mm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Tamanho da Etiqueta</Label>
                    <Select value={labelSize} onValueChange={setLabelSize}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LABEL_SIZES.map(s => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Margem (%)</Label>
                    <Slider value={[labelConfig.marginPct]} onValueChange={([v]) => setLabelConfig({ ...labelConfig, marginPct: v })} min={0} max={20} step={1} className="py-2" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries({ showImage: 'Imagem', showBarcode: 'Cód. Barras', showCode: 'Cód. Interno', showMaterial: 'Material', showCategory: 'Categoria', showPedido: 'Pedido', showSize: 'Tamanho' }).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Checkbox id={`check-${key}`} checked={(labelConfig as any)[key]} onCheckedChange={(v) => setLabelConfig({ ...labelConfig, [key]: !!v })} />
                      <Label htmlFor={`check-${key}`} className="text-xs cursor-pointer">{label}</Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4 md:border-l md:pl-8">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <BoxIcon className="h-3 w-3" /> Rótulo Caixa (Master)
                </h4>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Template Ativo</Label>
                  <Select value={selectedBoxTemplateId} onValueChange={setSelectedBoxTemplateId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {boxTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.dimensions.width}×{t.dimensions.height}mm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Pares por Ficha (Etiqueta)</Label>
                    <div className="flex items-center gap-3">
                      <Input type="number" value={pairsPerFicha} onChange={e => setPairsPerFicha(Number(e.target.value))} className="h-8 text-xs font-mono w-24" />
                      <span className="text-[10px] text-muted-foreground italic">Gera 1 etiqueta p/ ficha</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Fichas por Caixa Master</Label>
                    <div className="flex items-center gap-3">
                      <Input type="number" value={fichasPerBox} onChange={e => setFichasPerBox(Number(e.target.value))} className="h-8 text-xs font-mono w-24" />
                      <span className="text-[10px] text-muted-foreground italic">Quantas fichas p/ caixa</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print Mode + Period Filter */}
      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={statusTab} onValueChange={(v: any) => setStatusTab(v)}>
          <TabsList>
            <TabsTrigger value="producao" className="gap-2 h-9 px-4"><Factory className="h-4 w-4" />Em Produção ({activeOrders.length > 0 ? groupOrdersByReference(activeOrders, saleOrdersMap, strapLookup).length : 0})</TabsTrigger>
            <TabsTrigger value="imprimidos" className="gap-2 h-9 px-4"><CheckCircle2 className="h-4 w-4" />Imprimidos ({printedActiveOrders.length > 0 ? groupOrdersByReference(printedActiveOrders, saleOrdersMap, strapLookup).length : 0})</TabsTrigger>
            <TabsTrigger value="finalizados" className="gap-2 h-9 px-4"><RotateCcw className="h-4 w-4" />Finalizados</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-muted/30">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">Modo de Impressão:</Label>
          <RadioGroup value={printMode} onValueChange={(v: any) => setPrintMode(v)} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="batch" id="print-batch" className="h-3.5 w-3.5" />
              <Label htmlFor="print-batch" className="text-xs cursor-pointer">Lote (Semana)</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="per_op" id="print-per-op" className="h-3.5 w-3.5" />
              <Label htmlFor="print-per-op" className="text-xs cursor-pointer">Por OP</Label>
            </div>
          </RadioGroup>
        </div>

        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="h-9 w-40 text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="week">Esta Semana</SelectItem>
            <SelectItem value="month">Este Mês</SelectItem>
          </SelectContent>
        </Select>

        {/* Filtro por semana de faturamento — espelha como o financeiro/PV usa billing_week (formato "2026-05-S4") */}
        <Select value={billingWeekFilter} onValueChange={setBillingWeekFilter}>
          <SelectTrigger className="h-9 w-48 text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Semana faturamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as semanas</SelectItem>
            {availableBillingWeeks.map(bw => (
              <SelectItem key={bw} value={bw}>{bw}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-primary/10 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar modelo, cor ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="flex items-center gap-2">
              {printMode === 'batch' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map(g => g.groupKey)))} className="h-8 text-[11px]">Selecionar Tudo</Button>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} className="h-8 text-[11px]">Limpar</Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {selected.size > 0 && (
            <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20 animate-in fade-in zoom-in-95">
              {hasColmeiaSelected && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700">
                  <Package className="h-4 w-4 flex-shrink-0" />
                  <p className="text-xs">
                    <strong>Atenção:</strong> Itens com embalagem <strong>Colméia</strong> não geram etiquetas individuais — apenas rótulo de caixa externa.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {selectionLabelTypes.hangtag && (
                  <Button onClick={handlePrintHangtags} className="gap-2 h-9 shadow-md bg-primary hover:bg-primary/90"><Tag className="h-4 w-4" />Hangtags ({selected.size})</Button>
                )}
                {selectionLabelTypes.thermal && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Button onClick={handlePrintIndividual} variant="secondary" className="gap-2 h-9 border shadow-sm rounded-r-none"><Barcode className="h-4 w-4" />Térmicas</Button>
                      <Select value={thermalMode} onValueChange={(v: any) => setThermalMode(v)}>
                        <SelectTrigger className="h-9 w-[130px] text-[10px] rounded-l-none border-l-0 bg-secondary"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="quantity">Qtd. Total (1:1)</SelectItem>
                          <SelectItem value="ficha">Por Ficha (nº)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button onClick={handleDownloadPdf} variant="outline" size="sm" className="gap-1.5 h-9 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" title="Baixar PDF — abre em qualquer leitor (Preview, Adobe, navegador) e imprime direto">
                        <Download className="h-3.5 w-3.5" />PDF
                      </Button>
                    </div>
                    <span className="text-[9px] text-muted-foreground truncate max-w-[200px]">
                      Template: {thermalTemplates.find(t => t.id === selectedThermalTemplateId)?.name || 'Padrão'}
                    </span>
                  </div>
                )}
                {(selectionLabelTypes.masterBox || selectionLabelTypes.boxLabel) && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Button onClick={handlePrintBoxLabels} variant="outline" className="gap-2 h-9 shadow-sm rounded-r-none"><BoxIcon className="h-4 w-4" />Rótulo Caixa Externa</Button>
                      <Button
                        variant="outline"
                        className="h-9 px-2 rounded-l-none border-l-0"
                        title="Ajustar texto das tiras nas etiquetas"
                        onClick={() => {
                          const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
                          if (selectedGroups.length === 0) { toast.error('Selecione ao menos um item.'); return; }
                          const firstGroup = selectedGroups[0];
                          setEditingStrapsGroup(firstGroup.groupKey);
                          setEditingStrapsText(getEffectiveStrapsLabel(firstGroup).replace(/\|/g, ' | '));
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="text-[9px] text-muted-foreground truncate max-w-[200px]">
                      Template: {boxTemplates.find(t => t.id === selectedBoxTemplateId)?.name || 'Padrão'}
                    </span>
                  </div>
                )}
              </div>
              <div className="border-t border-primary/20 pt-3 flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch id="serial-switch" checked={useSerialization} onCheckedChange={setUseSerialization} />
                  <Label htmlFor="serial-switch" className="text-xs cursor-pointer font-medium">Serialização Automática</Label>
                </div>
                {useSerialization && (
                  <div className="flex items-center gap-3 animate-in slide-in-from-left-2">
                    <span className="text-xs text-muted-foreground font-mono">Início:</span>
                    <Input type="number" className="w-24 h-8 text-xs font-mono" value={serializationStart} onChange={e => setSerializationStart(Number(e.target.value))} />
                  </div>
                )}
              </div>
            </div>
          )}
          {selected.size === 0 && <div className="text-center py-4 text-xs text-muted-foreground italic flex items-center justify-center gap-2"><Tag className="h-3 w-3 opacity-40" /> Selecione itens abaixo para habilitar opções de impressão</div>}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 bg-muted/50 p-1">
          <TabsTrigger value="individual" className="gap-2 px-6 h-8 text-xs font-semibold">Lista de Referências</TabsTrigger>
          <TabsTrigger value="history" className="gap-2 px-6 h-8 text-xs font-semibold">Histórico de Lotes</TabsTrigger>
        </TabsList>

        <TabsContent value="individual">
          <div className="grid grid-cols-1 gap-8">
            {groupedByEconomicGroup.map(([egName, refs]) => (
              <div key={egName} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-1.5 rounded-full"><Building2 className="h-3.5 w-3.5 text-primary" /></div>
                  <h3 className="font-bold text-xs uppercase tracking-widest text-primary/80">{egName}</h3>
                  <div className="h-px bg-primary/10 flex-1"></div>
                  {printMode === 'batch' && (
                    <Button variant="ghost" size="sm" className="text-[10px] h-6" onClick={() => {
                      const next = new Set(selected);
                      const allSelected = refs.every(r => next.has(r.groupKey));
                      refs.forEach(r => allSelected ? next.delete(r.groupKey) : next.add(r.groupKey));
                      setSelected(next);
                    }}>
                      {refs.every(r => selected.has(r.groupKey)) ? 'Desmarcar Grupo' : 'Selecionar Grupo'}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {refs.map(g => (
                    <ReferenceCard key={g.groupKey} group={g} selected={selected.has(g.groupKey)} onToggle={() => {
                      if (printMode === 'per_op') {
                        // In per-OP mode, only allow one selection at a time
                        const next = new Set<string>();
                        if (!selected.has(g.groupKey)) next.add(g.groupKey);
                        setSelected(next);
                      } else {
                        const next = new Set(selected);
                        if (next.has(g.groupKey)) next.delete(g.groupKey); else next.add(g.groupKey);
                        setSelected(next);
                      }
                    }} />
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div className="p-20 text-center text-muted-foreground border-2 border-dashed rounded-xl flex flex-col items-center gap-4">
              <Search className="h-8 w-8 opacity-20" />
              <p className="text-sm font-medium">Nenhuma referência encontrada para os filtros atuais.</p>
            </div>}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card className="border-primary/5 shadow-sm">
            <CardContent className="pt-6">
              <PrintHistoryTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Strap label edit dialog */}
      <Dialog open={!!editingStrapsGroup} onOpenChange={(open) => { if (!open) setEditingStrapsGroup(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Tiras / Observação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Edite o texto que aparecerá nas etiquetas no campo de tiras. Use para corrigir nomes ou adicionar observações.
            </p>
            <Textarea
              value={editingStrapsText}
              onChange={(e) => setEditingStrapsText(e.target.value)}
              placeholder="Ex: Tira 1: Branca | Tira 2: Preta"
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => {
              if (editingStrapsGroup) {
                setStrapsLabelOverrides(prev => {
                  const next = { ...prev };
                  delete next[editingStrapsGroup];
                  return next;
                });
              }
              setEditingStrapsGroup(null);
              toast.info('Texto das tiras restaurado ao original.');
            }}>
              Restaurar Original
            </Button>
            <Button size="sm" onClick={() => {
              if (editingStrapsGroup) {
                const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
                const newOverrides = { ...strapsLabelOverrides };
                for (const g of selectedGroups) {
                  newOverrides[g.groupKey] = editingStrapsText.replace(/ \| /g, '|').replace(/\| /g, '|').replace(/ \|/g, '|');
                }
                setStrapsLabelOverrides(newOverrides);
                toast.success(`Texto das tiras ajustado para ${selectedGroups.length} referência(s).`);
              }
              setEditingStrapsGroup(null);
            }}>
              Aplicar a Todos Selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isGenerating && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
          <div className="bg-background p-10 rounded-2xl shadow-2xl border border-primary/20 flex flex-col items-center gap-6 max-w-xs w-full">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div className="text-center space-y-2">
              <p className="font-bold text-lg">Gerando etiquetas...</p>
              <p className="text-xs text-muted-foreground">O processo de renderização pode levar alguns segundos.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
