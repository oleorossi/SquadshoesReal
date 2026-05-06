import AppLayout from "@/components/layout/AppLayout";
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Printer, Search, Barcode, Settings2, BoxIcon, Package, X, RotateCcw, Factory, RotateCw, ScanLine, CalendarDays, ChevronDown, ChevronRight, Building2, AlertTriangle, Download } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { addDays, addWeeks, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
// JsBarcode import removed - using BarcodeSVG component
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { supabase } from '@/integrations/supabase/client';
import { getSignedUrl } from '@/lib/getSignedUrl';
import { resolveProductImage } from '@/lib/imageFallback';
import { fetchMainMaterial, parseSizes } from '@/lib/labelUtils';
import { buildBoxIdentificationHtml, buildThermalLabelsHtml, buildThermalLabelsZpl, buildHangtagHtml, type BoxIdentificationData, type ThermalLabelConfig, DEFAULT_THERMAL_CONFIG } from '@/lib/printLabels';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useOrders } from '@/hooks/useOrders';

const LABEL_SIZES = [
  { id: '100x30', label: '100 × 30 mm', width: 100, height: 30, description: 'Padrão caixa individual (Elgin)' },
  { id: '110x30', label: '110 × 30 mm', width: 110, height: 30, description: 'Caixa individual grande' },
  { id: '100x40', label: '100 × 40 mm', width: 100, height: 40, description: 'Etiqueta média' },
  { id: '100x50', label: '100 × 50 mm', width: 100, height: 50, description: 'Etiqueta grande' },
  { id: '80x30',  label: '80 × 30 mm',  width: 80,  height: 30, description: 'Compacta' },
  { id: '60x30',  label: '60 × 30 mm',  width: 60,  height: 30, description: 'Mini' },
] as const;

import { BarcodeSVG } from '@/components/ui/barcode-svg';


/** Build a normalized strap signature string for grouping. Orders with different straps = different products. */
function buildStrapSignature(order: any, strapLookup: Map<string, string>): string {
  if (order.sale_order_item_id) {
    const sig = strapLookup.get(order.sale_order_item_id);
    if (sig) return sig;
  }
  if (order.sale_order_id && order.reference_id) {
    const gradeHash = order.grade ? Object.entries(order.grade as Record<string, number>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, q]) => `${s}=${q}`)
      .join(',') : '';
    const color = order.color || '';
    const qty = Number(order.quantity) || 0;
    return strapLookup.get(`fbq|${order.sale_order_id}|${order.reference_id}|${color}|${qty}`)
      || strapLookup.get(`fb|${order.sale_order_id}|${order.reference_id}|${color}|${gradeHash}`)
      || '';
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

export function ReferenceCard({ group, selected, onToggle }: { group: GroupedReference; selected: boolean; onToggle: () => void }) {
  const sizes = Object.entries(group.aggregatedGrade)
    .filter(([, v]) => (v as number) > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, v]) => `${s}(${v})`)
    .join(', ');

  return (
    <Card className={`transition-all ${selected ? 'ring-2 ring-primary border-primary bg-primary/5 shadow-md' : 'hover:shadow-sm'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate max-w-[150px]">{group.refName}</span>
              {group.refCode && <Badge variant="outline" className="font-mono text-[9px] h-4">{group.refCode}</Badge>}
              {group.clientName && <Badge variant="secondary" className="text-[9px] h-4 max-w-[80px] truncate">{group.clientName}</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
              <span className="truncate">Cores: {group.colors.join(', ') || '—'}</span>
              <span>Total: <strong>{group.totalQty}</strong></span>
            </div>
            {group.strapsLabel && (
              <div className="flex items-center gap-1 mt-1">
                <Badge variant="outline" className="text-[9px] h-4 bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
                  🔗 {group.strapsLabel}
                </Badge>
              </div>
            )}
            {sizes && (
              <p className="text-[9px] text-muted-foreground mt-1 font-mono leading-tight">Grade: {sizes}</p>
            )}
            <p className="text-[8px] text-muted-foreground mt-1 truncate opacity-70">
              OPs: {group.orderNumbers.join(', ')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Utility functions moved to @/lib/labelUtils.ts for Fast Refresh compatibility

export default function Labels() {
  const queryClient = useQueryClient();
  const { data: allOrders = [], isLoading } = useOrders();
  const { data: saleOrders = [], isLoading: isLoadingSO } = useQuery({
    queryKey: ['sale_orders_for_labels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sale_orders').select('*, clients(economic_group_id, economic_groups(name))');
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

  // Realtime: auto-refresh labels when production orders change
  useEffect(() => {
    const channel = supabase
      .channel('labels-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sale_orders_for_labels'] });
      })
      .subscribe();
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
  const [statusTab, setStatusTab] = useState<'producao' | 'finalizados'>('producao');
  const [showConfig, setShowConfig] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [labelConfig, setLabelConfig] = useState<ThermalLabelConfig>({ ...DEFAULT_THERMAL_CONFIG });
  const [serializationStart, setSerializationStart] = useState(1);
  const [useSerialization, setUseSerialization] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [showScanner, setShowScanner] = useState(false);
  const [pairsPerFicha, setPairsPerFicha] = useState(12);
  const [fichasPerBox, setFichasPerBox] = useState(1);
  const [thermalMode, setThermalMode] = useState<'quantity' | 'ficha'>('quantity');
  
  const printFrameRef = useRef<HTMLIFrameElement>(null); // kept for compat
  const currentSize = LABEL_SIZES.find(s => s.id === labelSize) || LABEL_SIZES[0];

  const productionOrders = allOrders.filter((o: any) => !!o.sale_order_id);
  
  // Orders are "finished" if their own status is Finalizado OR the parent sale order is Faturado/Expedido
  const finishedSaleOrderIds = new Set(
    saleOrders.filter((so: any) => ['Faturado', 'Expedido', 'Concluído'].includes(so.status)).map((so: any) => so.id)
  );
  const activeOrders = productionOrders.filter((o: any) => 
    o.status !== 'Finalizado' && !finishedSaleOrderIds.has(o.sale_order_id)
  );
  const finishedOrders = productionOrders.filter((o: any) => 
    o.status === 'Finalizado' || finishedSaleOrderIds.has(o.sale_order_id)
  );
  const currentOrders = statusTab === 'producao' ? activeOrders : finishedOrders;

  const periodFilteredOrders = useMemo(() => {
    if (periodFilter === 'all') return currentOrders;
    const now = new Date();
    let start: Date; let end: Date;
    switch (periodFilter) {
      case 'week': start = startOfWeek(now); end = endOfWeek(now); break;
      case 'month': start = startOfMonth(now); end = endOfMonth(now); break;
      default: return currentOrders;
    }
    return currentOrders.filter((o: any) => {
      const deadline = saleOrdersMap.get(o.sale_order_id)?.delivery_deadline;
      if (!deadline) return true;
      const d = parseISO(deadline);
      return isWithinInterval(d, { start, end });
    });
  }, [currentOrders, periodFilter, saleOrdersMap]);

  const groupedRefs = groupOrdersByReference(periodFilteredOrders, saleOrdersMap, strapLookup);
  const filtered = groupedRefs.filter((g) => {
    const q = search.toLowerCase();
    return !search || g.refName?.toLowerCase().includes(q) || g.refCode?.toLowerCase().includes(q) || g.clientName?.toLowerCase().includes(q) || g.economicGroupName?.toLowerCase().includes(q) || g.saleOrderNumber?.toLowerCase().includes(q);
  });

  const groupedByEconomicGroup = useMemo(() => {
    const map = new Map<string, GroupedReference[]>();
    for (const g of filtered) {
      const egName = g.economicGroupName || 'Sem Grupo Econômico';
      if (!map.has(egName)) map.set(egName, []);
      map.get(egName)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const getOrderFichaMetrics = useCallback((order: any) => {
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
  }, [pairsPerFicha]);

  /** Preview counts for each print type — avoids surprise waste on large batches */
  const selectedStats = useMemo(() => {
    const groups = filtered.filter(g => selected.has(g.groupKey));
    let hangtagCount = 0;
    let thermalQtyCount = 0;
    let thermalFichaCount = 0;
    let boxLabelCount = 0;
    for (const group of groups) {
      const gradeTotal = Object.values(group.aggregatedGrade).reduce((s, v) => s + Number(v), 0);
      hangtagCount += gradeTotal;
      thermalQtyCount += gradeTotal;
      for (const order of group.orders) {
        const { numFichas } = getOrderFichaMetrics(order);
        thermalFichaCount += numFichas;
        boxLabelCount += pairsPerFicha > 0 ? Math.ceil((Number(order.quantity) || 0) / pairsPerFicha) : 1;
      }
    }
    const thermalCount = thermalMode === 'quantity' ? thermalQtyCount : thermalFichaCount;
    return { hangtagCount, thermalCount, boxLabelCount };
  }, [filtered, selected, thermalMode, pairsPerFicha, getOrderFichaMetrics]);

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
        const mainMaterial = await fetchMainMaterial(group.referenceId);
        const care = careData?.find(c => mainMaterial.toLowerCase().includes(c.name.toLowerCase())) || careData?.[0];

        for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
          for (let i = 0; i < (qty as number); i++) {
            labels.push({
              refCode: group.refCode,
              refName: group.refName,
              color: group.colors[0] || '',
              size: size,
              barcode: group.refCode ? `${group.refCode}${size.padStart(2, '0')}${currentSerial.toString().padStart(4, '0')}` : group.groupKey,
              qrcode: group.refCode ? `https://squadshoes.com.br/product/${group.refCode}` : '',
              composition: mainMaterial,
              careSymbols: care?.symbols || [],
              logoUrl: logoUrl,
              brandName: 'SQUAD SHOES',
            });
            if (useSerialization) currentSerial++;
          }
        }
      }
      setPrintHtml(buildHangtagHtml(labels));
      await supabase.from('print_jobs').insert({ batch_name: `Hangtags - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed' });
      toast.success(`${labels.length} hangtags geradas.`);
    } catch (err: any) { toast.error(err.message); } finally { setIsGenerating(false); }
  };

  /**
   * Build the minimal label list (no images needed) shared by ZPL and preview count.
   * Returns one entry per pair in quantity mode, or per ficha in ficha mode.
   */
  const buildZplLabelList = () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    const labels: { refCode: string; refName: string; mainMaterial: string; color: string; size: string; barcode: string }[] = [];
    for (const group of selectedGroups) {
      if (thermalMode === 'quantity') {
        for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
          for (let i = 0; i < (qty as number); i++) {
            labels.push({
              refCode: group.refCode,
              refName: group.refName,
              mainMaterial: '',
              color: group.colors[0] || '',
              size,
              barcode: group.refCode || group.groupKey,
            });
          }
        }
      } else {
        for (const order of group.orders) {
          const { numFichas, gradeText } = getOrderFichaMetrics(order);
          for (let f = 0; f < numFichas; f++) {
            labels.push({
              refCode: group.refCode,
              refName: group.refName,
              mainMaterial: '',
              color: order.color || group.colors[0] || '',
              size: gradeText || String(pairsPerFicha),
              barcode: order.order_number || group.refCode || group.groupKey,
            });
          }
        }
      }
    }
    return labels;
  };

  const handleDownloadZpl = () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return;
    const labels = buildZplLabelList();
    if (labels.length === 0) return;
    const zpl = buildThermalLabelsZpl(labels, { width: currentSize.width, height: currentSize.height });
    const blob = new Blob([zpl], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etiquetas-${currentSize.id}-${labels.length}un-${Date.now()}.zpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    supabase.from('print_jobs').insert({ batch_name: `ZPL ${currentSize.label} - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed' });
    toast.success(`Arquivo ZPL gerado: ${labels.length} etiquetas para Elgin (${currentSize.label}).`);
  };

  const handlePrintIndividual = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return;
    setIsGenerating(true);
    try {
      const labels: any[] = [];
      const logoUrl = new URL(logoImg, window.location.origin).href;

      // --- Pre-fetch all data in parallel to avoid sequential waterfall ---
      const uniqueRefIds = [...new Set(selectedGroups.map(g => g.referenceId))];

      // Batch fetch technical_sheets and materials in parallel
      const [refDataMap, materialMap] = await Promise.all([
        // Fetch all technical sheets at once
        supabase
          .from('technical_sheets')
          .select('id, image_url, images, code, shoe_category')
          .in('id', uniqueRefIds)
          .then(({ data }) => {
            const map = new Map<string, any>();
            for (const r of data || []) map.set(r.id, r);
            return map;
          }),
        // Fetch all main materials in parallel
        Promise.all(uniqueRefIds.map(async id => [id, await fetchMainMaterial(id)] as const))
          .then(entries => new Map(entries)),
      ]);

      // Collect all unique (referenceId, colorName) pairs to resolve images in parallel
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of selectedGroups) {
        const colorName = group.colors[0] || '';
        const key = `${group.referenceId}|${colorName}`;
        if (!imageKeys.has(key)) {
          imageKeys.add(key);
          imageRequests.push({ key, referenceId: group.referenceId, colorName });
        }
        // Also pre-resolve per-order colors in ficha mode
        if (thermalMode === 'ficha') {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderKey = `${group.referenceId}|${orderColor}`;
            if (!imageKeys.has(orderKey)) {
              imageKeys.add(orderKey);
              imageRequests.push({ key: orderKey, referenceId: group.referenceId, colorName: orderColor });
            }
          }
        }
      }

      // Resolve all product images in parallel
      const imageResults = await Promise.all(
        imageRequests.map(async ({ key, referenceId, colorName }) => {
          const url = await resolveProductImage({ referenceId, colorName, fallbackUrl: logoUrl });
          return [key, url] as const;
        })
      );
      const imageMap = new Map(imageResults);

      // --- Build labels using pre-fetched data (no more awaits) ---
      for (const group of selectedGroups) {
        const mainMaterial = materialMap.get(group.referenceId) || '';
        const refData = refDataMap.get(group.referenceId);
        const colorName = group.colors[0] || '';
        const productImageUrl = imageMap.get(`${group.referenceId}|${colorName}`) || logoUrl;

        if (thermalMode === 'quantity') {
          // One label per pair (current default)
          for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
            for (let i = 0; i < (qty as number); i++) {
              labels.push({
                refCode: group.refCode,
                refName: group.refName,
                mainMaterial,
                color: colorName,
                size,
                barcode: group.refCode || group.groupKey,
                imageUrl: productImageUrl,
                shoeCategory: refData?.shoe_category || '',
              });
            }
          }
        } else {
          // Ficha mode: print the grade of 1 ficha, repeated by the number of fichas in the OP
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderImageUrl = imageMap.get(`${group.referenceId}|${orderColor}`) || productImageUrl;

            const { gradeText, pairsInOneFicha, numFichas } = getOrderFichaMetrics(order);

            for (let i = 0; i < numFichas; i++) {
              labels.push({
                refCode: group.refCode,
                refName: group.refName,
                mainMaterial,
                color: orderColor,
                size: gradeText || `${pairsInOneFicha} PRS`,
                barcode: group.refCode || order.order_number || group.groupKey,
                imageUrl: orderImageUrl,
                shoeCategory: refData?.shoe_category || '',
              });
            }
          }
        }
      }
      setPrintHtml(buildThermalLabelsHtml(labels, logoUrl, { width: currentSize.width, height: currentSize.height }, labelConfig));
      await supabase.from('print_jobs').insert({ batch_name: `Térmicas - ${new Date().toLocaleString()}`, total_labels: labels.length, status: 'completed' }).throwOnError();
      toast.success(`${labels.length} etiquetas térmicas geradas.`);
    } catch (err: any) { toast.error(err?.message || 'Erro ao gerar etiquetas'); } finally { setIsGenerating(false); }
  };

  const handlePrintBoxLabels = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return;
    setIsGenerating(true);
    try {
      const logoUrl = new URL(logoImg, window.location.origin).href;

      // 1. Pre-fetch all ref data and materials in parallel
      const refDataMap = new Map<string, any>();
      const materialMap = new Map<string, string>();
      const imageMap = new Map<string, string>();

      const uniqueRefIds = [...new Set(selectedGroups.map(g => g.referenceId))];
      await Promise.all(uniqueRefIds.map(async (refId) => {
        const [{ data: refData }, material] = await Promise.all([
          supabase.from('technical_sheets').select('image_url, images, code, shoe_category').eq('id', refId).single(),
          fetchMainMaterial(refId),
        ]);
        refDataMap.set(refId, refData);
        materialMap.set(refId, material);
      }));

      // 2. Pre-resolve all unique images in parallel
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of selectedGroups) {
        for (const order of group.orders) {
          const key = `${group.referenceId}|${order.color || ''}`;
          if (!imageKeys.has(key)) {
            imageKeys.add(key);
            imageRequests.push({ key, referenceId: group.referenceId, colorName: order.color || '' });
          }
        }
      }
      const imageResults = await Promise.all(
        imageRequests.map(async ({ key, referenceId, colorName }) => {
          const url = await resolveProductImage({ referenceId, colorName, fallbackUrl: logoUrl });
          return [key, url] as const;
        })
      );
      imageResults.forEach(([k, v]) => imageMap.set(k, v));

      // 3. Build box items using pre-fetched data (no awaits in loop)
      const boxItems: BoxIdentificationData[] = [];
      for (const group of selectedGroups) {
        const refData = refDataMap.get(group.referenceId);
        const mainMaterial = materialMap.get(group.referenceId) || '';

        for (const order of group.orders) {
          const grade = order.grade as Record<string, number> | null;
          const sizes = grade ? Object.keys(grade).sort((a, b) => Number(a) - Number(b)) : [];
          const gradeItems = sizes.map(size => ({ size, qty: Number(grade?.[size]) || 0 }));
          const totalPairs = gradeItems.reduce((sum, g) => sum + g.qty, 0);
          const fichas = pairsPerFicha > 0 ? Math.ceil(order.quantity / pairsPerFicha) : (totalPairs > 0 ? Math.max(1, Math.round(order.quantity / totalPairs)) : 1);
          const totalMasterBoxes = Math.ceil(fichas / (fichasPerBox || 1));
          const so = saleOrdersMap.get(order.sale_order_id);
          const finalImageUrl = imageMap.get(`${group.referenceId}|${order.color || ''}`) || logoUrl;

          // Pre-compute base quantities per size per ficha; last ficha absorbs remainder
          const baseGradePerFicha = gradeItems.map(g => ({
            size: g.size,
            base: fichas > 0 ? Math.floor(g.qty / fichas) : g.qty,
            remainder: fichas > 0 ? g.qty % fichas : 0,
          }));

          for (let f = 0; f < fichas; f++) {
            const isLastFicha = f === fichas - 1;
            const currentBoxNumber = Math.ceil((f + 1) / (fichasPerBox || 1));
            const gradeForThisFicha = baseGradePerFicha.map(g => ({
              size: g.size,
              qty: isLastFicha ? g.base + g.remainder : g.base,
            })).filter(g => g.qty > 0);
            boxItems.push({
              orderNumber: order.order_number || '',
              refCode: refData?.code || group.refCode || '',
              refName: group.refName || '',
              color: order.color || '—',
              boxNumber: currentBoxNumber,
              totalBoxes: totalMasterBoxes,
              senderName: 'SQUAD SHOES IND. E COM. DE CALÇADOS LTDA',
              senderCnpj: '62.406.033/0001-93',
              recipientName: so?.client_name || '',
              recipientCnpj: so?.client_cnpj || '',
              clientOrderNumber: so?.client_order_number || '',
              shoeCategory: refData?.shoe_category || '',
              mainMaterial: mainMaterial,
              grade: gradeForThisFicha,
              barcode: order.order_number,
              imageUrl: finalImageUrl,
              nfe: so?.nfe || '',
              remessa: so?.remessa || '',
            });
          }
        }
      }
      setPrintHtml(buildBoxIdentificationHtml(boxItems));
      await supabase.from('print_jobs').insert({ batch_name: `Rótulos Caixa - ${new Date().toLocaleString()}`, total_labels: boxItems.length, status: 'completed' });
    } catch (err: any) { toast.error(err.message); } finally { setIsGenerating(false); }
  };

  useEffect(() => {
    if (printHtml) {
      const w = window.open('', '_blank', 'width=900,height=700');
      if (w) {
        w.document.write(printHtml);
        w.document.close();
        w.onload = () => {
          // Wait for all images to load before printing
          const imagesReady = (w as any)._imagesReady;
          if (imagesReady && typeof imagesReady.then === 'function') {
            imagesReady.then(() => {
              setTimeout(() => w.print(), 300);
            });
          } else {
            setTimeout(() => w.print(), 600);
          }
        };
        // fallback if onload doesn't fire
        setTimeout(() => {
          try { w.print(); } catch {}
        }, 6000);
      } else {
        toast.error('Popup bloqueado pelo navegador. Permita popups para imprimir.');
      }
      setPrintHtml(null);
    }
  }, [printHtml]);

  return (
    
      <div className="space-y-5 page-enter">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2 text-primary">
              <Tag className="h-6 w-6" />
              Gestão de Etiquetas
            </h2>
            <p className="text-sm text-muted-foreground">Sistema centralizado para identificação de calçados</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowScanner(!showScanner)} className="h-8"><ScanLine className="h-4 w-4 mr-2" />Leitor</Button>
            <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)} className="h-8"><Settings2 className="h-4 w-4 mr-2" />Ajustes</Button>
          </div>
        </div>
        {showConfig && (
          <Card className="mb-6 animate-in slide-in-from-top-2 border-primary/20 shadow-lg">
            <CardHeader className="bg-muted/50 py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Settings2 className="h-4 w-4" /> Configurações de Impressão
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Individual Label Config */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Barcode className="h-3 w-3" /> Caixa Individual (Térmica)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Tamanho da Etiqueta</Label>
                      <Select value={labelSize} onValueChange={setLabelSize}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LABEL_SIZES.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Margem (%)</Label>
                      <Slider value={[labelConfig.marginPct]} onValueChange={([v]) => setLabelConfig({ ...labelConfig, marginPct: v })} min={0} max={20} step={1} className="py-2" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {Object.entries({
                      showImage: 'Imagem',
                      showBarcode: 'Cód. Barras',
                      showCode: 'Cód. Interno',
                      showMaterial: 'Material',
                      showCategory: 'Categoria',
                      showPedido: 'Pedido',
                      showSize: 'Tamanho',
                    }).map(([key, label]) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox id={`check-${key}`} checked={(labelConfig as any)[key]} onCheckedChange={(v) => setLabelConfig({ ...labelConfig, [key]: !!v })} />
                        <Label htmlFor={`check-${key}`} className="text-xs cursor-pointer">{label}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Master Label Config */}
                <div className="space-y-4 md:border-l md:pl-8">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <BoxIcon className="h-3 w-3" /> Rótulo Caixa (Master)
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Pares por Ficha (Etiqueta)</Label>
                      <div className="flex items-center gap-3">
                        <Input type="number" value={pairsPerFicha} onChange={e => setPairsPerFicha(Number(e.target.value))} className="h-8 text-xs font-mono w-24" />
                        <span className="text-[10px] text-muted-foreground italic">Gera 1 etiqueta p/ ficha</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground opacity-70">Ex: 36 pares com 12/ficha = 3 etiquetas</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Fichas por Caixa Master</Label>
                      <div className="flex items-center gap-3">
                        <Input type="number" value={fichasPerBox} onChange={e => setFichasPerBox(Number(e.target.value))} className="h-8 text-xs font-mono w-24" />
                        <span className="text-[10px] text-muted-foreground italic">Quantas fichas p/ caixa</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground opacity-70">Define a numeração "Caixa 1 de X"</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={statusTab} onValueChange={(v: any) => { setStatusTab(v); setSelected(new Set()); }}>
          <TabsList className="mb-4">
            <TabsTrigger value="producao" className="gap-2 h-9 px-4"><Factory className="h-4 w-4" />Em Produção</TabsTrigger>
            <TabsTrigger value="finalizados" className="gap-2 h-9 px-4"><RotateCcw className="h-4 w-4" />Finalizados</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="mb-6 border-primary/10 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar modelo, cor ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map(g => g.groupKey)))} className="h-8 text-[11px]">Selecionar Tudo</Button>
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} className="h-8 text-[11px]">Limpar</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
              {selected.size > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-6 p-4 bg-primary/5 rounded-lg border border-primary/20 animate-in fade-in zoom-in-95">
                    <div className="flex gap-2 flex-wrap">
                      <Button onClick={handlePrintHangtags} className="gap-2 h-9 shadow-md bg-primary hover:bg-primary/90">
                        <Tag className="h-4 w-4" />
                        Hangtags
                        <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">{selectedStats.hangtagCount}</span>
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button onClick={handlePrintIndividual} variant="secondary" className="gap-2 h-9 border shadow-sm rounded-r-none">
                          <Barcode className="h-4 w-4" />
                          Térmicas
                          <span className="ml-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-bold">{selectedStats.thermalCount}</span>
                        </Button>
                        <Select value={thermalMode} onValueChange={(v: any) => setThermalMode(v)}>
                          <SelectTrigger className="h-9 w-[130px] text-[10px] rounded-l-none border-l-0 bg-secondary">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="quantity">Qtd. Total (1:1)</SelectItem>
                            <SelectItem value="ficha">Por Ficha (nº)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handlePrintBoxLabels} variant="outline" className="gap-2 h-9 shadow-sm">
                        <BoxIcon className="h-4 w-4" />
                        Rótulo Caixa
                        <span className="ml-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-bold">{selectedStats.boxLabelCount}</span>
                      </Button>
                      <Button onClick={handleDownloadZpl} variant="outline" className="gap-2 h-9 shadow-sm border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" title="Gera arquivo .zpl para impressão direta na Elgin — sem configurações de navegador">
                        <Download className="h-4 w-4" />
                        Elgin ZPL
                        <span className="ml-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold">{selectedStats.thermalCount}</span>
                      </Button>
                    </div>
                    <div className="border-l border-primary/20 pl-6 flex items-center gap-6">
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
                  {selectedStats.thermalCount > 150 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Lote grande: <strong>{selectedStats.thermalCount}</strong> etiquetas térmicas serão impressas. Confirme o modo antes de iniciar para evitar desperdício de papel.</span>
                    </div>
                  )}
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
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {refs.map(g => (
                      <ReferenceCard key={g.groupKey} group={g} selected={selected.has(g.groupKey)} onToggle={() => {
                        const next = new Set(selected);
                        if (next.has(g.groupKey)) next.delete(g.groupKey); else next.add(g.groupKey);
                        setSelected(next);
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

        {/* print via window.open now */}
        {isGenerating && (
          <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
            <div className="bg-background p-10 rounded-2xl shadow-2xl border border-primary/20 flex flex-col items-center gap-6 max-w-xs w-full">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center space-y-2">
                <p className="font-bold text-lg">Gerando etiquetas...</p>
                <p className="text-xs text-muted-foreground">Aguarde enquanto as imagens e códigos de barras são carregados.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    
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
