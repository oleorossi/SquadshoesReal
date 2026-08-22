import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveConversionFactors } from '@/lib/unitConversion';
import { calculateConsumption, type ConsumptionLine } from '@/services/consumptionService';
import { classifyBomMaterial } from '@/lib/orderConsumption';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from '@/lib/packagingPairsPerBox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { CheckCircle as CheckCircle2, ArrowRight, ArrowLeft, TrendUp as TrendingUp, Package, Truck, Calendar, CurrencyDollar as DollarSign, ShoppingCart, Sparkle as Sparkles, CalendarBlank as CalendarDays } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, addDays, startOfWeek, endOfWeek, isAfter, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { roundUpToPurchaseMultiple, applyPurchaseMultiple } from '@/lib/purchaseMultiple';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

interface ConsumptionResult {
  needs: OrderMaterialNeed[];
  productsMap: Map<string, any>;
}

const EMPTY_NEEDS: OrderMaterialNeed[] = [];
const EMPTY_PRODUCTS_MAP = new Map<string, any>();
const MISSING_PURCHASE_DEADLINE_LABEL = 'Sem prazo de compra — resolver planejamento';
const UNSCHEDULED_WEEK_START = new Date(8640000000000000);

interface OrderMaterialNeed {
  order_id: string;
  order_number: string;
  sale_order_number: string;
  client_name: string;
  reference_name: string;
  quantity: number;
  delivery_date: string | null;
  purchase_deadline?: string | null;
  missing_purchase_deadline: boolean;
  week_label: string;
  week_start: Date;
  materials: MaterialLine[];
}

interface MaterialLine {
  product_id: string | null;
  name: string;
  type: string;
  consumption_per_pair: number;
  total_needed: number;
  total_needed_converted: number;
  unit: string;
  purchase_unit: string;
  conversion_rate: number;
  width_missing?: boolean;
}

interface WeeklyMaterialSummary {
  week_label: string;
  week_start: Date;
  orders_count: number;
  total_pairs: number;
  has_missing_purchase_deadline: boolean;
  materials: Map<string, AggregatedMaterial>;
}

interface AggregatedMaterial {
  material_key: string;
  name: string;
  type: string;
  total_needed: number;
  unit: string;
  current_stock: number;
  stock_after: number;
  unit_price: number;
  estimated_cost: number;
  selected: boolean;
  supplier_name?: string;
  supplier_id?: string;
  orders: string[];
  earliest_purchase_deadline?: string | null;
  missing_purchase_deadline?: boolean;
  product_id?: string;
  width_missing?: boolean;
}

const STEPS = [
  { id: 'analysis', title: 'Consumo por Semana', description: 'Consumo futuro baseado nos pedidos' },
  { id: 'recommendations', title: 'Recomendações', description: 'Revisar e selecionar itens para compra' },
  { id: 'suppliers', title: 'Fornecedores', description: 'Agrupamento por fornecedor' },
  { id: 'schedule', title: 'Cronograma', description: 'Cronograma financeiro' },
  { id: 'review', title: 'Revisão Final', description: 'Confirmar criação de OCs' },
];

export default function PurchasePlanningWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('all');
  const computeBuyQty = (deficit: number, prod: any): number => {
    const moq = Number(prod?.min_order_quantity) || 0;
    let qty = Math.ceil(Math.max(0, deficit));
    if (moq > 1) qty = Math.ceil(qty / moq) * moq;
    return applyPurchaseMultiple(qty, prod?.purchase_multiple, prod?.product_groups?.purchase_multiple);
  };
  const [selectedMaterials, setSelectedMaterials] = useState<AggregatedMaterial[]>([]);
  const [creating, setCreating] = useState(false);

  const {
    data: consumption,
    isPending: loading,
    error: consumptionError,
  } = useQuery({
    queryKey: ['purchase_planning_consumption'],
    queryFn: fetchOrderConsumption,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
  const orderNeeds = consumption?.needs ?? EMPTY_NEEDS;
  const productsMap = consumption?.productsMap ?? EMPTY_PRODUCTS_MAP;
  const loadError = consumptionError
    ? ((consumptionError as any)?.message || 'Não foi possível carregar o planejamento de compras.')
    : null;

  async function fetchOrderConsumption(): Promise<ConsumptionResult> {
    try {
      const parseDateValue = (value?: string | null) => {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      const { data: orders = [], error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id,
          color, grade, sale_order_id, sale_order_item_id,
          sale_orders!orders_sale_order_id_fkey(order_number, delivery_deadline, delivery_week, delivery_month, client_name, packaging_mode)
        `)
        .in('status', ['Reservado', 'Em Produção'])
        .order('planned_delivery', { ascending: true });
      if (ordersError) throw ordersError;

      const activeOrders = (orders as any[]).filter(o => o.reference_id);
      if (activeOrders.length === 0) {
        return { needs: [], productsMap: new Map<string, any>() };
      }

      const orderIds = Array.from(new Set(activeOrders.map(o => o.id).filter(Boolean)));
      const purchaseDeadlineByOrder = new Map<string, string>();
      if (orderIds.length > 0) {
        const { data: timelineRows, error: timelineRowsErr } = await (supabase as any)
          .from('purchase_projection_timeline')
          .select('order_id, data_limite_compra')
          .in('order_id', orderIds);
        if (timelineRowsErr) throw timelineRowsErr;
        for (const row of (timelineRows || []) as any[]) {
          if (!row.order_id || !row.data_limite_compra) continue;
          const prev = purchaseDeadlineByOrder.get(row.order_id);
          if (!prev || row.data_limite_compra < prev) {
            purchaseDeadlineByOrder.set(row.order_id, row.data_limite_compra);
          }
        }
      }

      const soiIds = Array.from(new Set(activeOrders.map(o => o.sale_order_item_id).filter(Boolean)));
      const refIds = Array.from(new Set(activeOrders.map(o => o.reference_id).filter(Boolean)));
      const [productsRes, soiRes, resvRes, sheetsRes] = await Promise.all([
        supabase
          .from('products')
          .select(`
            id, name, sku, quantity, unit, unit_price, reserved_stock, safety_stock,
            min_order_quantity, category, group_id, supplier_id, purchase_order_unit,
            conversion_rate, purchase_multiple, is_artisanal,
            supplier_ref:suppliers!products_supplier_id_fkey(name, trade_name),
            product_groups!products_group_id_fkey(purchase_multiple)
          `),
        soiIds.length > 0
          ? supabase.from('sale_order_items').select('id, material_variant_id').in('id', soiIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase
          .from('material_reservations')
          .select('product_id, quantity_reserved, quantity_consumed')
          .in('order_id', orderIds)
          .in('status', ['reserved', 'partially_consumed']),
        supabase.from('technical_sheets').select('id, name').in('id', refIds),
      ]);

      if (productsRes.error) {
        console.error('[PurchasePlanning] Products query error:', productsRes.error);
      }

      const productRows = (productsRes.data ?? []) as any[];
      const getSupplierName = (product: any) =>
        product?.supplier_ref?.trade_name || product?.supplier_ref?.name || '';
      const pMap = new Map<string, any>(productRows.map(p => [p.id, p]));
      const sheetNameById = new Map<string, string>();
      for (const s of (sheetsRes.data ?? []) as any[]) sheetNameById.set(s.id, s.name || '');
      const variantBySoi = new Map<string, string | null>();
      for (const r of (soiRes.data ?? []) as any[]) {
        variantBySoi.set(r.id, r.material_variant_id ?? null);
      }
      const ownReservedByProduct = new Map<string, number>();
      for (const r of (resvRes.data ?? []) as any[]) {
        if (!r.product_id) continue;
        const give = Math.max(0, (Number(r.quantity_reserved) || 0) - (Number(r.quantity_consumed) || 0));
        ownReservedByProduct.set(r.product_id, (ownReservedByProduct.get(r.product_id) || 0) + give);
      }
      const availableStock = (p: any) =>
        Math.max(0, (Number(p?.quantity) || 0) - (Number(p?.reserved_stock) || 0) + (ownReservedByProduct.get(p?.id) || 0));

      let failedOrders = 0;
      const consumptionByOrder = await Promise.all(
        activeOrders.map(async (order): Promise<ConsumptionLine[] | null> => {
          try {
            const variantId = order.sale_order_item_id
              ? variantBySoi.get(order.sale_order_item_id) ?? null
              : null;
            const grade =
              order.grade && typeof order.grade === 'object' && !Array.isArray(order.grade)
                ? (order.grade as Record<string, number>)
                : null;
            const summary = await calculateConsumption({
              referenceId: order.reference_id,
              quantity: Number(order.quantity) || 0,
              color: order.color,
              materialVariantId: variantId,
              grade,
            });
            return summary.lines;
          } catch (err) {
            failedOrders++;
            console.error('[PurchasePlanning] Falha no consumo canônico da OP', order.order_number, err);
            return null;
          }
        }),
      );
      if (failedOrders > 0) {
        toast.warning(`${failedOrders} OP(s) ficaram fora do plano — falha ao calcular o consumo. Veja o console.`);
      }

      const areaProductIds = new Set<string>();
      for (const lines of consumptionByOrder) {
        for (const l of lines ?? []) {
          if (l.product_id && l.unit == null) areaProductIds.add(l.product_id);
        }
      }
      const convInfo = new Map<string, { dm2_per_unit: number; conversion_warning: string | null }>();
      await Promise.all(
        Array.from(areaProductIds).map(async (pid) => {
          const { data } = await supabase.rpc('get_material_conversion_info', { p_product_id: pid });
          const row: any = Array.isArray(data) ? data[0] : data;
          if (row) {
            convInfo.set(pid, {
              dm2_per_unit: Number(row.dm2_per_unit) || 1,
              conversion_warning: row.conversion_warning ?? null,
            });
          }
        }),
      );

      const needs: OrderMaterialNeed[] = [];
      activeOrders.forEach((order, idx) => {
        const lines = consumptionByOrder[idx];
        if (lines == null) return;
        const saleOrder = Array.isArray(order.sale_orders) ? order.sale_orders[0] : order.sale_orders;
        const deliveryDate = order.planned_delivery || saleOrder?.delivery_deadline || null;
        const purchaseDeadline = purchaseDeadlineByOrder.get(order.id) || null;
        const schedulingDate = parseDateValue(purchaseDeadline);
        const missingPurchaseDeadline = schedulingDate == null;
        const weekStart = missingPurchaseDeadline
          ? new Date(UNSCHEDULED_WEEK_START)
          : startOfWeek(schedulingDate!, { weekStartsOn: 1 });
        const weekEnd = missingPurchaseDeadline ? null : endOfWeek(schedulingDate!, { weekStartsOn: 1 });
        const weekLabel = missingPurchaseDeadline
          ? MISSING_PURCHASE_DEADLINE_LABEL
          : `${format(weekStart, 'dd/MM', { locale: ptBR })} - ${format(weekEnd!, 'dd/MM', { locale: ptBR })}`;
        const qty = Number(order.quantity) || 0;
        const packagingMode = saleOrder?.packaging_mode || null;
        const caixaTypes = new Set<CollectiveType>();
        for (const l of lines) {
          if (classifyBomMaterial('', l.product_name || '', l.category || '') !== 'Embalagem') continue;
          const t = caixaCollectiveTypeFromName(l.product_name);
          if (t) caixaTypes.add(t);
        }
        const materials: MaterialLine[] = [];
        for (const line of lines) {
          if (!line.product_id) continue;
          const prod = pMap.get(line.product_id);
          if (prod?.is_artisanal) continue;
          if (
            packagingMode &&
            classifyBomMaterial('', line.product_name || '', line.category || '') === 'Embalagem' &&
            !shouldShowCaixaForMode(line.product_name, packagingMode, caixaTypes)
          ) continue;
          const stockUnit = prod?.unit || line.unit || 'un';
          const required = Number(line.required) || 0;
          const isAreaLine = line.unit == null;
          const conv = isAreaLine && line.product_id ? convInfo.get(line.product_id) : undefined;
          const widthMissing = !!line.conversion_warning || (isAreaLine && !!conv?.conversion_warning);
          const needInStock = isAreaLine && !widthMissing
            ? required / Math.max(conv?.dm2_per_unit || 1, 1)
            : required;
          const purchaseUnit = prod?.purchase_order_unit || stockUnit;
          const convRate = prod?.conversion_rate;
          const { stockToPurchaseDivisor } = resolveConversionFactors(stockUnit, stockUnit, purchaseUnit, convRate);
          const totalNeededConverted = needInStock / stockToPurchaseDivisor;
          const stockInPurchaseUnit = (prod ? availableStock(prod) : 0) / stockToPurchaseDivisor;
          const priceInPurchaseUnit = (Number(prod?.unit_price) || 0) * stockToPurchaseDivisor;
          materials.push({
            product_id: line.product_id,
            name: line.product_name,
            type: line.component || 'Componente',
            consumption_per_pair: Number(line.consumption_per_unit) || 0,
            total_needed: required,
            total_needed_converted: widthMissing ? required : totalNeededConverted,
            unit: line.unit || 'dm²',
            purchase_unit: purchaseUnit,
            conversion_rate: convRate,
            width_missing: widthMissing,
            _stock: stockInPurchaseUnit,
            _price: priceInPurchaseUnit,
            _supplier: getSupplierName(prod),
            _supplier_id: prod?.supplier_id ?? undefined,
            _product_id: line.product_id,
          } as any);
        }
        needs.push({
          order_id: order.id,
          order_number: order.order_number,
          sale_order_number: saleOrder?.order_number || '',
          client_name: saleOrder?.client_name || '',
          reference_name: sheetNameById.get(order.reference_id) || '',
          quantity: qty,
          delivery_date: deliveryDate,
          purchase_deadline: purchaseDeadline,
          missing_purchase_deadline: missingPurchaseDeadline,
          week_label: weekLabel,
          week_start: weekStart,
          materials,
        });
      });
      needs.sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
      return { needs, productsMap: pMap };
    } catch (err: any) {
      console.error('[PurchasePlanning] Error fetching order consumption:', err, err?.message, err?.details, err?.hint);
      throw err;
    }
  }

  const availableWeeks = useMemo(() => {
    const weeks = new Map<string, Date>();
    orderNeeds.forEach(o => {
      if (!weeks.has(o.week_label)) weeks.set(o.week_label, o.week_start);
    });
    return Array.from(weeks.entries()).sort((a, b) => a[1].getTime() - b[1].getTime());
  }, [orderNeeds]);

  const weeklySummaries = useMemo(() => {
    const weekMap = new Map<string, WeeklyMaterialSummary>();
    for (const order of orderNeeds) {
      if (!weekMap.has(order.week_label)) {
        weekMap.set(order.week_label, {
          week_label: order.week_label,
          week_start: order.week_start,
          orders_count: 0,
          total_pairs: 0,
          has_missing_purchase_deadline: false,
          materials: new Map(),
        });
      }
      const week = weekMap.get(order.week_label)!;
      week.orders_count++;
      week.total_pairs += order.quantity;
      week.has_missing_purchase_deadline ||= order.missing_purchase_deadline;
      for (const mat of order.materials) {
        const matAny = mat as any;
        const key = matAny._product_id || `${mat.name.toLowerCase()}_${mat.type}`;
        if (!week.materials.has(key)) {
          week.materials.set(key, {
            material_key: key,
            name: mat.name,
            type: mat.type,
            total_needed: 0,
            unit: mat.purchase_unit,
            current_stock: matAny._stock || 0,
            stock_after: 0,
            unit_price: matAny._price || 0,
            estimated_cost: 0,
            selected: false,
            supplier_name: matAny._supplier || undefined,
            supplier_id: matAny._supplier_id || undefined,
            orders: [],
            earliest_purchase_deadline: order.purchase_deadline || null,
            missing_purchase_deadline: order.missing_purchase_deadline,
            product_id: matAny._product_id || undefined,
            width_missing: matAny.width_missing || false,
          });
        }
        const agg = week.materials.get(key)!;
        agg.total_needed += mat.total_needed_converted;
        if (matAny.width_missing) agg.width_missing = true;
        if (order.missing_purchase_deadline) agg.missing_purchase_deadline = true;
        agg.orders.push(order.order_number);
        if (order.purchase_deadline && (!agg.earliest_purchase_deadline || order.purchase_deadline < agg.earliest_purchase_deadline)) {
          agg.earliest_purchase_deadline = order.purchase_deadline;
        }
      }
    }
    for (const [, week] of Array.from(weekMap)) {
      for (const [, mat] of Array.from(week.materials)) {
        mat.stock_after = mat.current_stock - mat.total_needed;
        const deficit = Math.max(0, mat.total_needed - mat.current_stock);
        mat.estimated_cost = mat.width_missing ? 0 : deficit * mat.unit_price;
        mat.selected = !mat.width_missing && !mat.missing_purchase_deadline && mat.stock_after < 0;
      }
    }
    return Array.from(weekMap.values()).sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
  }, [orderNeeds, productsMap]);

  const filteredSummaries = useMemo(() => {
    if (selectedWeek === 'all') return weeklySummaries;
    return weeklySummaries.filter(w => w.week_label === selectedWeek);
  }, [weeklySummaries, selectedWeek]);

  const allMaterialsFlat = useMemo(() => {
    const merged = new Map<string, AggregatedMaterial>();
    for (const week of filteredSummaries) {
      for (const [key, mat] of Array.from(week.materials)) {
        if (!merged.has(key)) {
          merged.set(key, { ...mat, orders: [...mat.orders] });
        } else {
          const existing = merged.get(key)!;
          existing.total_needed += mat.total_needed;
          if (mat.width_missing) existing.width_missing = true;
          if (mat.missing_purchase_deadline) existing.missing_purchase_deadline = true;
          existing.orders = Array.from(new Set([...existing.orders, ...mat.orders]));
          if (mat.earliest_purchase_deadline && (!existing.earliest_purchase_deadline || mat.earliest_purchase_deadline < existing.earliest_purchase_deadline)) {
            existing.earliest_purchase_deadline = mat.earliest_purchase_deadline;
          }
          existing.stock_after = existing.current_stock - existing.total_needed;
          const deficit = Math.max(0, existing.total_needed - existing.current_stock);
          existing.estimated_cost = existing.width_missing ? 0 : deficit * existing.unit_price;
          existing.selected = !existing.width_missing && !existing.missing_purchase_deadline && existing.stock_after < 0;
        }
      }
    }
    let arr = Array.from(merged.values());
    if (search) arr = arr.filter(m => searchMatchesAllTerms(search, m.name, m.type));
    return arr.sort((a, b) => a.stock_after - b.stock_after);
  }, [filteredSummaries, search]);

  const deficitCount = useMemo(() => allMaterialsFlat.filter(m => m.stock_after < 0).length, [allMaterialsFlat]);
  const totalPairsAll = useMemo(() => filteredSummaries.reduce((s, w) => s + w.total_pairs, 0), [filteredSummaries]);
  const totalOrdersAll = useMemo(() => filteredSummaries.reduce((s, w) => s + w.orders_count, 0), [filteredSummaries]);

  const handleProceedToRecommendations = () => {
    setSelectedMaterials(allMaterialsFlat.map(m => ({ ...m })));
    setCurrentStep(1);
  };
  const toggleMaterial = (key: string) => {
    setSelectedMaterials(prev => prev.map(m => m.material_key === key ? { ...m, selected: !m.selected } : m));
  };

  const handleCreatePOs = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const eligible = selectedMaterials.filter(m => m.selected && m.stock_after < 0);
      const blocked = eligible.filter(m => m.width_missing);
      const planningBlocked = eligible.filter(m => m.missing_purchase_deadline);
      const active = eligible.filter(m => !m.width_missing && !m.missing_purchase_deadline);
      if (blocked.length > 0) {
        toast.warning(`${blocked.length} material(is) de área sem largura na ficha ficaram FORA da OC — a quantidade não é confiável.`);
      }
      if (planningBlocked.length > 0) {
        toast.error(`${planningBlocked.length} material(is) ficaram FORA da OC por estarem sem prazo de compra.`);
      }
      const bySupplier = new Map<string, AggregatedMaterial[]>();
      active.forEach(m => {
        const key = m.supplier_name || 'Sem Fornecedor';
        if (!bySupplier.has(key)) bySupplier.set(key, []);
        bySupplier.get(key)!.push(m);
      });
      let count = 0;
      for (const [supplierName, items] of Array.from(bySupplier)) {
        const lines = items.filter(item => item.product_id).map(item => {
          const deficit = Math.max(0, item.total_needed - item.current_stock);
          const qty = computeBuyQty(deficit, productsMap.get(item.product_id!));
          return { product_id: item.product_id!, current_stock: item.current_stock, qty, unit_price: item.unit_price, unit: item.unit };
        });
        const totalValue = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
        const supplierId = items.find(i => i.supplier_id)?.supplier_id ?? null;
        const idempSig = items.filter(i => i.product_id).map(i => `${i.product_id}:${Math.ceil(Math.max(0, i.total_needed - i.current_stock))}`).sort().join('|');
        const idempKey = `wizard|${supplierId || supplierName}|${idempSig}`;
        const buyBy = items.map(i => i.earliest_purchase_deadline).filter(Boolean).sort()[0] || null;
        const { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
          supplier_name: supplierName,
          supplier_id: supplierId,
          total_value: totalValue,
          notes: 'Plano de compras baseado em pedidos',
          auto_generated: true,
          status: 'pending',
          idempotency_key: idempKey,
          ...(buyBy ? { purchase_by_date: buyBy } : {}),
        }).select('id').single();
        if (poErr) throw poErr;
        const poItems = lines.map(l => ({
          purchase_order_id: po.id,
          product_id: l.product_id,
          current_stock: l.current_stock,
          min_stock: 0,
          max_stock: 0,
          suggested_quantity: l.qty,
          quantity: l.qty,
          unit_price: l.unit_price,
          unit: l.unit,
        }));
        if (poItems.length === 0) {
          await supabase.from('purchase_orders').delete().eq('id', po.id);
          continue;
        }
        const { error: itemsErr } = await supabase.from('purchase_order_items').insert(poItems);
        if (itemsErr) throw itemsErr;
        count++;
      }
      toast.success(`${count} ${count === 1 ? 'Ordem de Compra criada' : 'Ordens de Compra criadas'} com sucesso!`);
      setCurrentStep(0);
      setSelectedMaterials([]);
    } catch (err: any) {
      toast.error(`Erro ao criar OCs: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const stockBadge = (stockAfter: number) => {
    if (stockAfter < 0) return <Badge variant="destructive">Déficit</Badge>;
    if (stockAfter === 0) return <Badge variant="default">Justo</Badge>;
    return <Badge variant="secondary">OK</Badge>;
  };
  const widthMissingBadge = (
    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20" title="Ficha de componente sem largura — quantidade não confiável.">
      Largura?
    </Badge>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Carregando consumo dos pedidos...</p>
        </CardContent>
      </Card>
    );
  }
  if (loadError && orderNeeds.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <div className="space-y-2">
            <p className="font-semibold">Não foi possível carregar o planejamento</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </div>
          <Button variant="outline" onClick={() => void fetchOrderConsumption()}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Passo {currentStep + 1} de {STEPS.length}</p>
            <Progress value={((currentStep + 1) / STEPS.length) * 100} className="w-48" />
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                  i < currentStep ? 'bg-primary text-primary-foreground' :
                  i === currentStep ? 'bg-primary/20 text-primary border-2 border-primary' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {i < currentStep ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`text-xs hidden lg:inline ${i === currentStep ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{step.title}</span>
                {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {currentStep === 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Consumo Futuro por Semana</CardTitle>
              <CardDescription>Necessidades de materiais baseadas nos pedidos em aberto ({totalOrdersAll} OPs, {totalPairsAll.toLocaleString()} pares)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <Label>Filtrar Semana</Label>
                  <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as semanas</SelectItem>
                      {availableWeeks.map(([label]) => (<SelectItem key={label} value={label}>{label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Buscar material</Label>
                  <SearchInput placeholder="Buscar material por nome…" value={search} onChange={setSearch} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-primary/30 bg-primary/5"><CardContent className="pt-4 pb-3 text-center"><p className="display text-2xl tabular-nums text-primary">{totalOrdersAll}</p><p className="text-xs text-muted-foreground">OPs em aberto</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3 text-center"><p className="display text-2xl tabular-nums">{totalPairsAll.toLocaleString()}</p><p className="text-xs text-muted-foreground">Pares totais</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3 text-center"><p className="display text-2xl tabular-nums">{availableWeeks.length}</p><p className="text-xs text-muted-foreground">Semanas</p></CardContent></Card>
                <Card className={deficitCount > 0 ? 'border-destructive/30 bg-destructive/5' : ''}><CardContent className="pt-4 pb-3 text-center"><p className={`display text-2xl tabular-nums ${deficitCount > 0 ? 'text-destructive' : ''}`}>{deficitCount}</p><p className="text-xs text-muted-foreground">Materiais em déficit</p></CardContent></Card>
              </div>
              {filteredSummaries.map(week => (
                <Card key={week.week_label}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4" />{week.has_missing_purchase_deadline ? week.week_label : `Semana ${week.week_label}`}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{week.orders_count} OPs</Badge>
                        {week.has_missing_purchase_deadline && <Badge variant="destructive">Resolver planejamento</Badge>}
                        <Badge variant="secondary">{week.total_pairs.toLocaleString()} pares</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-lg overflow-auto max-h-[350px]">
                      <Table>
                        <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Necessário</TableHead><TableHead className="text-right">Estoque Atual</TableHead><TableHead className="text-right">Saldo Após</TableHead><TableHead className="text-right">Custo Est.</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {(() => {
                            let mats = Array.from(week.materials.values());
                            if (search) mats = mats.filter(m => searchMatchesAllTerms(search, m.name, m.type));
                            return mats.sort((a, b) => a.stock_after - b.stock_after).map(mat => (
                              <TableRow key={mat.material_key} className={(!mat.width_missing && mat.stock_after < 0) || mat.missing_purchase_deadline ? 'bg-destructive/5' : ''}>
                                <TableCell><p className="font-medium text-sm">{mat.name}</p><p className="text-xs text-muted-foreground">{mat.orders.length} OP(s)</p></TableCell>
                                <TableCell><Badge variant="outline" className="text-xs">{mat.type}</Badge></TableCell>
                                <TableCell className={`text-right ${mat.width_missing ? 'text-muted-foreground' : ''}`}>{fmtQty(mat.total_needed)} {mat.unit}</TableCell>
                                <TableCell className="text-right">{fmtQty(mat.current_stock)} {mat.unit}</TableCell>
                                <TableCell className={`text-right font-semibold ${!mat.width_missing && mat.stock_after < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{mat.width_missing ? '—' : `${fmtQty(mat.stock_after)} ${mat.unit}`}</TableCell>
                                <TableCell className="text-right">{!mat.width_missing && mat.estimated_cost > 0 ? fmt(mat.estimated_cost) : '—'}</TableCell>
                                <TableCell>{mat.missing_purchase_deadline ? <Badge variant="destructive">Sem prazo de compra</Badge> : mat.width_missing ? widthMissingBadge : stockBadge(mat.stock_after)}</TableCell>
                              </TableRow>
                            ));
                          })()}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredSummaries.length === 0 && (<Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pedido em aberto encontrado.</CardContent></Card>)}
              <div className="flex justify-between items-center pt-2">
                <p className="text-sm text-muted-foreground">{allMaterialsFlat.length} materiais • {deficitCount} em déficit</p>
                <Button onClick={handleProceedToRecommendations} disabled={allMaterialsFlat.length === 0}>Recomendações <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Recomendações de Compra</CardTitle>
              <CardDescription>Selecione os materiais em déficit para incluir no plano</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                <div><p className="text-sm text-muted-foreground">Itens selecionados</p><p className="display text-2xl tabular-nums">{selectedMaterials.filter(m => m.selected).length} / {selectedMaterials.length}</p></div>
                <div className="text-right"><p className="text-sm text-muted-foreground">Investimento estimado</p><p className="display text-2xl tabular-nums text-primary">{fmt(selectedMaterials.filter(m => m.selected).reduce((s, m) => s + m.estimated_cost, 0))}</p></div>
              </div>
              <div className="border rounded-lg overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Material</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Déficit</TableHead><TableHead className="text-right">Preço Unit.</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Fornecedor</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {selectedMaterials.map(m => {
                      const deficit = Math.max(0, m.total_needed - m.current_stock);
                      return (
                        <TableRow key={m.material_key} className={!m.selected ? 'opacity-50' : ''}>
                          <TableCell><Checkbox checked={m.selected} disabled={m.missing_purchase_deadline} onCheckedChange={() => toggleMaterial(m.material_key)} /></TableCell>
                          <TableCell>
                            <p className="font-medium text-sm flex items-center gap-1.5">{m.name}{m.width_missing && widthMissingBadge}{m.missing_purchase_deadline && <Badge variant="destructive">Sem prazo de compra</Badge>}</p>
                            <p className={m.missing_purchase_deadline ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{m.missing_purchase_deadline ? 'Resolver planejamento antes de gerar a OC.' : `${m.orders.length} OP(s)`}</p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{m.type}</Badge></TableCell>
                          <TableCell className={`text-right font-semibold ${m.width_missing ? 'text-muted-foreground' : 'text-destructive'}`}>{m.width_missing ? '—' : (deficit > 0 ? `${fmtQty(deficit)} ${m.unit}` : '—')}</TableCell>
                          <TableCell className="text-right">{m.unit_price > 0 ? fmt(m.unit_price) : '—'}</TableCell>
                          <TableCell className="text-right font-semibold">{!m.width_missing && m.estimated_cost > 0 ? fmt(m.estimated_cost) : '—'}</TableCell>
                          <TableCell className="text-sm">{m.supplier_name || '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(0)}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
                <Button onClick={() => setCurrentStep(2)}>Fornecedores <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Agrupamento por Fornecedor</CardTitle>
              <CardDescription>Itens agrupados por fornecedor para geração de OCs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const active = selectedMaterials.filter(m => m.selected && m.stock_after < 0 && !m.missing_purchase_deadline);
                const bySupplier = new Map<string, AggregatedMaterial[]>();
                active.forEach(m => {
                  const key = m.supplier_name || 'Sem Fornecedor';
                  if (!bySupplier.has(key)) bySupplier.set(key, []);
                  bySupplier.get(key)!.push(m);
                });
                if (bySupplier.size === 0) return <div className="text-center py-8 text-muted-foreground">Nenhum material com déficit selecionado.</div>;
                return Array.from(bySupplier).map(([supplier, items]) => (
                  <Card key={supplier} className="border-l-4 border-l-primary">
                    <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-base">{supplier}</CardTitle><Badge>{items.length} itens • {fmt(items.reduce((s, i) => s + i.estimated_cost, 0))}</Badge></div></CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {items.map(item => {
                          const deficit = Math.max(0, item.total_needed - item.current_stock);
                          const prod = item.product_id ? productsMap.get(item.product_id) : null;
                          const buyQty = computeBuyQty(deficit, prod);
                          const surplus = Math.max(0, buyQty - deficit);
                          return (
                            <div key={item.material_key} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                              <span>{item.name} <Badge variant="outline" className="text-xs ml-1">{item.type}</Badge></span>
                              <span className="font-medium">{fmtQty(buyQty)}{surplus > 0.0001 && (<span className="ml-1 text-blue-600 dark:text-blue-400">+{fmtQty(surplus)}</span>)} {item.unit} × {fmt(item.unit_price)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ));
              })()}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(1)}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
                <Button onClick={() => setCurrentStep(3)}>Cronograma <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> Cronograma Financeiro</CardTitle>
              <CardDescription>Previsão de impacto financeiro</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card><CardContent className="pt-4 text-center"><DollarSign className="h-8 w-8 mx-auto text-primary mb-2" /><p className="display text-2xl tabular-nums">{fmt(selectedMaterials.filter(m => m.selected && m.stock_after < 0).reduce((s, m) => s + m.estimated_cost, 0))}</p><p className="text-xs text-muted-foreground">Investimento Total</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><Package className="h-8 w-8 mx-auto text-primary mb-2" /><p className="display text-2xl tabular-nums">{selectedMaterials.filter(m => m.selected && m.stock_after < 0).length}</p><p className="text-xs text-muted-foreground">Itens no Plano</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><Calendar className="h-8 w-8 mx-auto text-primary mb-2" /><p className="display text-2xl tabular-nums">{format(addDays(new Date(), 7), 'dd/MM')}</p><p className="text-xs text-muted-foreground">Data Sugerida de Envio</p></CardContent></Card>
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(2)}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
                <Button onClick={() => setCurrentStep(4)}>Revisão Final <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {currentStep === 4 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Revisão Final</CardTitle>
              <CardDescription>Confirme a criação das Ordens de Compra</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 text-center space-y-2">
                <p className="display text-3xl tabular-nums text-primary">{fmt(selectedMaterials.filter(m => m.selected && m.stock_after < 0).reduce((s, m) => s + m.estimated_cost, 0))}</p>
                <p className="text-muted-foreground">{selectedMaterials.filter(m => m.selected && m.stock_after < 0).length} itens em {new Set(selectedMaterials.filter(m => m.selected && m.stock_after < 0).map(m => m.supplier_name || 'Sem Fornecedor')).size} OC(s)</p>
                <p className="text-xs text-muted-foreground">Baseado nos pedidos em aberto</p>
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(3)}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
                <Button onClick={handleCreatePOs} disabled={creating}>{creating ? 'Criando...' : 'Criar Ordens de Compra'}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
