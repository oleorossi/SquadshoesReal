import { useState, useMemo, useEffect } from 'react';
import { resolveConversionFactors, areSameUnit } from '@/lib/unitConversion';
import { areaToStockDivisor } from '@/lib/materialConsumption';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { CheckCircle as CheckCircle2, ArrowRight, ArrowLeft, MagnifyingGlass as Search, TrendUp as TrendingUp, Package, Truck, Calendar, CurrencyDollar as DollarSign, ShoppingCart, Sparkle as Sparkles, CalendarBlank as CalendarDays } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, addDays, startOfWeek, endOfWeek, isAfter, isBefore, addWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';
import { roundUpToPurchaseMultiple } from '@/lib/purchaseMultiple';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

interface OrderMaterialNeed {
  order_id: string;
  order_number: string;
  sale_order_number: string;
  client_name: string;
  reference_name: string;
  quantity: number;
  delivery_date: string | null;
  week_label: string;
  week_start: Date;
  materials: MaterialLine[];
}

interface MaterialLine {
  product_id: string | null;
  name: string;
  type: string; // cabedal, forro, palmilha, solado, componente
  consumption_per_pair: number;
  total_needed: number; // in consumption unit (dm²)
  total_needed_converted: number; // converted to purchase_order_unit
  unit: string; // consumption unit
  purchase_unit: string; // purchase_order_unit for display
  conversion_rate: number;
  width_missing?: boolean; // área sem largura na ficha → conversão dm²→física indefinida
}

interface WeeklyMaterialSummary {
  week_label: string;
  week_start: Date;
  orders_count: number;
  total_pairs: number;
  materials: Map<string, AggregatedMaterial>;
}

interface AggregatedMaterial {
  material_key: string;
  name: string;
  type: string;
  total_needed: number; // in purchase unit (converted)
  unit: string; // purchase_order_unit for display
  current_stock: number; // in stock unit
  stock_after: number; // in purchase unit
  unit_price: number; // R$ per PURCHASE unit (já convertido de R$/un estoque)
  estimated_cost: number;
  selected: boolean;
  supplier_name?: string;
  supplier_id?: string; // FK suppliers — gravado na OC
  orders: string[];
  product_id?: string; // representative product id for PO item creation
  width_missing?: boolean; // alguma linha de área sem largura → quantidade não confiável
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
  const [orderNeeds, setOrderNeeds] = useState<OrderMaterialNeed[]>([]);
  const [productsMap, setProductsMap] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedMaterials, setSelectedMaterials] = useState<AggregatedMaterial[]>([]);
  const [creating, setCreating] = useState(false);

  // Fetch orders and their material needs from technical sheets
  useEffect(() => {
    fetchOrderConsumption();
  }, []);

  async function fetchOrderConsumption() {
    setLoading(true);
    setLoadError(null);
    try {
      const parseDateValue = (value?: string | null) => {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      // 1. Fetch active orders with their sale_order info
      const { data: orders = [], error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id,
          sale_order_id,
          sale_orders!orders_sale_order_id_fkey(order_number, delivery_deadline, delivery_week, delivery_month, client_name)
        `)
        // Status REAIS de orders no backend (audit 2026-05): 'Pronto' não existe.
        .in('status', ['Reservado', 'Em Produção'])
        .order('planned_delivery', { ascending: true });
      if (ordersError) throw ordersError;

      // 2. Get unique reference_ids
      const refIds = Array.from(new Set((orders as any[]).map(o => o.reference_id).filter(Boolean)));
      if (refIds.length === 0) {
        setOrderNeeds([]);
        setLoading(false);
        return;
      }

      // 2b. Data-LIMITE de compra por OP (auditoria 2026-06-14, Top10 #3).
      // Antes o Wizard agrupava as necessidades pela semana de ENTREGA do cliente
      // → sugeria comprar TARDE (o oposto da função do MRP). A view
      // purchase_projection_timeline já calcula data_limite_compra por OP×material
      // (cadeia de lead time produção + buffer fornecedor, server-side). Usamos a
      // data-limite MAIS CEDO entre os materiais da OP (deadline vinculante);
      // fallback pra entrega quando a view não cobre o material.
      const orderIds = Array.from(new Set((orders as any[]).map(o => o.id).filter(Boolean)));
      const purchaseDeadlineByOrder = new Map<string, string>();
      if (orderIds.length > 0) {
        const { data: timelineRows } = await (supabase as any)
          .from('purchase_projection_timeline')
          .select('order_id, data_limite_compra')
          .in('order_id', orderIds);
        for (const row of (timelineRows || []) as any[]) {
          if (!row.order_id || !row.data_limite_compra) continue;
          const prev = purchaseDeadlineByOrder.get(row.order_id);
          if (!prev || row.data_limite_compra < prev) {
            purchaseDeadlineByOrder.set(row.order_id, row.data_limite_compra);
          }
        }
      }

      // 3. Fetch technical sheets, products, groups, recent PO items, component sheets
      const [sheetsRes, productsRes, groupsRes, poItemsRes, compSheetsRes] = await Promise.all([
        supabase
          .from('technical_sheets')
          .select(`
            id, name, 
            upper_material, upper_consumption, 
            lining_material, lining_consumption, 
            insole_material, insole_consumption,
            sole_material, sole_consumption, sole_type,
            direct_components,
            consumption_loss_pct
          `)
          .in('id', refIds),
        supabase
          .from('products')
          .select(`
            id,
            name,
            sku,
            quantity,
            unit,
            unit_price,
            reserved_stock,
            safety_stock,
            min_order_quantity,
            category,
            group_id,
            supplier_id,
            purchase_order_unit,
            conversion_rate,
            purchase_multiple,
            supplier_ref:suppliers!products_supplier_id_fkey(name, trade_name)
          `),
        supabase
          .from('product_groups')
          .select('id, name'),
        // Get the most recent PO item unit per product
        supabase
          .from('purchase_order_items')
          .select('product_id, unit, created_at')
          .order('created_at', { ascending: false }),
        // Component sheets — largura/área da ficha p/ converter material de área
        // (dm²/par) → unidade física (m/placa). A conversão dm²→m NÃO mora em
        // conversion_rate (mora aqui). Sem isto o Wizard inflava ~100×.
        supabase
          .from('component_sheets')
          .select('product_id, group_id, dimensions_width, dimensions_length, dimensions_unit, waste_pct'),
      ]);

      if (sheetsRes.error) throw sheetsRes.error;
      if (productsRes.error) {
        console.error('[PurchasePlanning] Products query error:', productsRes.error);
      }
      if (groupsRes.error) {
        console.error('[PurchasePlanning] Product groups query error:', groupsRes.error);
      }

      const sheetsMap = new Map(((sheetsRes.data ?? []) as any[]).map(s => [s.id, s]));
      const productRows = (productsRes.data ?? []) as any[];
      const getSupplierName = (product: any) =>
        product?.supplier_ref?.trade_name || product?.supplier_ref?.name || '';

      // Build product_id → last PO unit lookup (most recent PO item unit per product)
      const poUnitMap = new Map<string, string>();
      for (const poi of (poItemsRes.data ?? []) as any[]) {
        if (poi.product_id && poi.unit && !poUnitMap.has(poi.product_id)) {
          poUnitMap.set(poi.product_id, poi.unit);
        }
      }

      // Helper: get the best display unit for a product (PO unit > product.unit)
      const getDisplayUnit = (product: any): string => {
        if (!product) return 'un';
        const poUnit = poUnitMap.get(product.id);
        if (poUnit) return poUnit;
        return product.unit || 'un';
      };

      const pMap = new Map(productRows.map(p => [p.id, p]));
      setProductsMap(pMap);

      // Ficha de componente por produto e por grupo (pra converter dm²→unidade
      // física pela largura/área — mesma fonte do modal de consumo e da view).
      const csByProduct = new Map<string, any>();
      const csByGroup = new Map<string, any>();
      for (const cs of (compSheetsRes.data ?? []) as any[]) {
        if (cs.product_id && !csByProduct.has(cs.product_id)) csByProduct.set(cs.product_id, cs);
        if (cs.group_id && !csByGroup.has(cs.group_id)) csByGroup.set(cs.group_id, cs);
      }
      const componentSheetFor = (productId?: string | null, groupId?: string | null): any =>
        (productId && csByProduct.get(productId)) || (groupId && csByGroup.get(groupId)) || null;

      // Build group name → group id lookup
      const groupNameMap = new Map<string, string>();
      const groupIdMap = new Map<string, string>();
      for (const g of (groupsRes.data ?? []) as any[]) {
        groupNameMap.set(g.name?.toLowerCase(), g.id);
        groupIdMap.set(g.id, g.name);
      }

      // Disponível líquido = quantity − reserved_stock (fix A3.1 — reservas de OPs
      // ativas não podem contar como estoque livre pro plano de compras)
      const availableStock = (p: any) =>
        Math.max(0, (Number(p?.quantity) || 0) - (Number(p?.reserved_stock) || 0));

      // Build group_id → aggregated stock/price from all products in that group
      const groupStockMap = new Map<string, { total_stock: number; avg_price: number; supplier: string; supplier_id: string | null; product_count: number; purchase_unit: string; conversion_rate: number; stock_unit: string }>();
      for (const p of productRows) {
        if (!p.group_id) continue;
        const existing = groupStockMap.get(p.group_id) || { total_stock: 0, avg_price: 0, supplier: '', supplier_id: null, product_count: 0, purchase_unit: '', conversion_rate: 0, stock_unit: '' };
        existing.total_stock += availableStock(p);
        existing.avg_price += Number(p.unit_price) || 0;
        existing.product_count++;
        const supplierName = getSupplierName(p);
        if (!existing.supplier && supplierName) existing.supplier = supplierName;
        if (!existing.supplier_id && p.supplier_id) existing.supplier_id = p.supplier_id;
        // Prefer PO unit from actual purchase orders, fallback to product.unit
        const displayUnit = getDisplayUnit(p);
        if (!existing.purchase_unit && displayUnit) existing.purchase_unit = displayUnit;
        // Use the highest conversion_rate in the group (e.g. 137 dm²/m vs 1)
        // to ensure proper unit conversion from production to purchase unit
        const pConvRate = Number(p.conversion_rate) || 0;
        if (pConvRate > existing.conversion_rate) existing.conversion_rate = pConvRate;
        if (!existing.stock_unit && p.unit) existing.stock_unit = p.unit;
        groupStockMap.set(p.group_id, existing);
      }
      // Finalize avg_price
      for (const [, info] of groupStockMap) {
        if (info.product_count > 0) info.avg_price = info.avg_price / info.product_count;
      }

      // Helper: resolve a material name to stock info (try group first, then direct product match)
      function resolveMaterial(materialName: string): { stock: number; price: number; supplier: string; supplier_id?: string; purchase_unit: string; conversion_rate: number; stock_unit: string; product_id?: string } {
        if (!materialName) return { stock: 0, price: 0, supplier: '', purchase_unit: 'un', conversion_rate: 1, stock_unit: 'un' };
        const nameLower = materialName.toLowerCase().trim();

        // Helper to extract purchase info from a product (prefer PO history unit)
        const getProductPurchaseInfo = (p: any) => ({
          purchase_unit: getDisplayUnit(p),
          conversion_rate: Number(p?.conversion_rate) || 1,
          stock_unit: p?.unit || 'un',
        });

        // Helper: find a representative product_id from a group
        const findProductIdForGroup = (gId: string): string | undefined => {
          for (const p of productRows) {
            if (p.group_id === gId && p.id) return p.id;
          }
          return undefined;
        };

        // 1. Try exact group name match
        const groupId = groupNameMap.get(nameLower);
        if (groupId) {
          const info = groupStockMap.get(groupId);
          if (info) {
            return { stock: info.total_stock, price: info.avg_price, supplier: info.supplier, supplier_id: info.supplier_id || undefined, purchase_unit: info.purchase_unit || 'un', conversion_rate: info.conversion_rate || 1, stock_unit: info.stock_unit || 'un', product_id: findProductIdForGroup(groupId) };
          }
        }

        // 2. Try finding products whose group name matches
        for (const [gName, gId] of groupNameMap) {
          if (gName.includes(nameLower) || nameLower.includes(gName)) {
            const info = groupStockMap.get(gId);
            if (info) {
              return { stock: info.total_stock, price: info.avg_price, supplier: info.supplier, supplier_id: info.supplier_id || undefined, purchase_unit: info.purchase_unit || 'un', conversion_rate: info.conversion_rate || 1, stock_unit: info.stock_unit || 'un', product_id: findProductIdForGroup(gId) };
            }
          }
        }

        // 3. Try direct product name match (startsWith for variants like "NAPA SOFT: BLUE")
        let totalStock = 0;
        let totalPrice = 0;
        let count = 0;
        let supplier = '';
        let supplierId: string | undefined;
        let purchaseInfo = { purchase_unit: 'un', conversion_rate: 1, stock_unit: 'un' };
        let firstProductId: string | undefined;
        for (const p of productRows) {
          const pName = p.name?.toLowerCase() || '';
          if (pName === nameLower || pName.startsWith(nameLower + ':') || pName.startsWith(nameLower + ' ')) {
            totalStock += availableStock(p);
            totalPrice += Number(p.unit_price) || 0;
            count++;
            const supplierName = getSupplierName(p);
            if (!supplier && supplierName) supplier = supplierName;
            if (!supplierId && p.supplier_id) supplierId = p.supplier_id;
            const pInfo = getProductPurchaseInfo(p);
            // Use the highest conversion_rate found across variants
            if (pInfo.conversion_rate > purchaseInfo.conversion_rate) {
              purchaseInfo = pInfo;
            }
            if (!firstProductId) firstProductId = p.id;
          }
        }
        if (count > 0) return { stock: totalStock, price: totalPrice / count, supplier, supplier_id: supplierId, ...purchaseInfo, product_id: firstProductId };

        return { stock: 0, price: 0, supplier: '', purchase_unit: 'un', conversion_rate: 1, stock_unit: 'un' };
      }

      // 6. Build material needs per order
      const needs: OrderMaterialNeed[] = [];
      const today = new Date();

      for (const order of orders as any[]) {
        const sheet = sheetsMap.get(order.reference_id);
        if (!sheet) continue;

        const saleOrder = Array.isArray(order.sale_orders) ? order.sale_orders[0] : order.sale_orders;
        const deliveryDate = order.planned_delivery || saleOrder?.delivery_deadline || null;
        // Agrupa pela DATA-LIMITE DE COMPRA (quando comprar) e não pela entrega
        // (quando entregar) — ver bloco 2b. Fallback pra entrega quando a view não
        // cobre a OP. Auditoria 2026-06-14, Top10 #3.
        const purchaseDeadline = purchaseDeadlineByOrder.get(order.id) || null;
        const schedulingDate = purchaseDeadline || deliveryDate;
        const schedulingDateObj = parseDateValue(schedulingDate) ?? addWeeks(today, 4);
        const weekStart = startOfWeek(schedulingDateObj, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(schedulingDateObj, { weekStartsOn: 1 });
        const weekLabel = `${format(weekStart, 'dd/MM', { locale: ptBR })} - ${format(weekEnd, 'dd/MM', { locale: ptBR })}`;

        const qty = Number(order.quantity) || 0;
        const lossPct = Number(sheet.consumption_loss_pct) || 5;
        const lossFactor = 1 + lossPct / 100;

        const materials: MaterialLine[] = [];

        // Helper: build a material line with unit conversion
        function buildMaterialLine(
          materialName: string,
          type: string,
          consumptionPerPair: number,
          rawUnit: string,
          applyLoss: boolean,
          productIdOverride?: string | null,
          stockOverride?: number,
          priceOverride?: number,
          supplierOverride?: string,
          purchaseUnitOverride?: string,
          convRateOverride?: number,
          supplierIdOverride?: string,
        ): MaterialLine & { _stock: number; _price: number; _supplier: string } {
          const resolved = productIdOverride === undefined
            ? resolveMaterial(materialName)
            : { stock: stockOverride ?? 0, price: priceOverride ?? 0, supplier: supplierOverride ?? '', supplier_id: supplierIdOverride, purchase_unit: purchaseUnitOverride ?? rawUnit, conversion_rate: convRateOverride ?? 1, stock_unit: rawUnit, product_id: productIdOverride ?? undefined };

          const totalNeededRaw = consumptionPerPair * qty * (applyLoss ? lossFactor : 1);
          const convRate = resolved.conversion_rate || 1;
          const purchaseUnit = resolved.purchase_unit || rawUnit;
          // Use unified conversion logic to handle both area→linear and stock→package cases
          let { needToStockDivisor } = resolveConversionFactors(
            rawUnit,                    // consumption unit (e.g. dm², kg, par)
            resolved.stock_unit,        // stock unit (e.g. m, kg, par)
            purchaseUnit,               // purchase unit (e.g. metro, un, par)
            convRate,
          );
          const { stockToPurchaseDivisor } = resolveConversionFactors(rawUnit, resolved.stock_unit, purchaseUnit, convRate);
          // CORREÇÃO dm² (auditoria 2026-06-14): material de ÁREA (dm²/par) com produto
          // em unidade física (m/cm/placa) converte pela LARGURA da ficha de componente,
          // NÃO pelo conversion_rate (que costuma ser 1 nesses casos → resolveConversionFactors
          // devolvia 1:1 e inflava a quantidade ~100×). Ver areaToStockDivisor / CLAUDE.md.
          let widthMissing = false;
          const rawIsArea = ['dm²', 'dm2', 'cm²', 'cm2', 'm²', 'm2'].includes((rawUnit || '').toLowerCase().trim());
          if (rawIsArea && !areSameUnit(rawUnit, resolved.stock_unit)) {
            const prodRow = resolved.product_id ? pMap.get(resolved.product_id) : null;
            const cs = componentSheetFor(resolved.product_id, prodRow?.group_id);
            const div = areaToStockDivisor(resolved.stock_unit, cs);
            if (div && div > 0) needToStockDivisor = div;      // dm² → m/placa pela ficha
            else widthMissing = true;                          // sem largura: não dá pra converter
          }
          const needInStock = totalNeededRaw / needToStockDivisor;
          const totalNeededConverted = needInStock / stockToPurchaseDivisor;
          const stockInPurchaseUnit = resolved.stock / stockToPurchaseDivisor;
          // unit_price em products é R$/unidade de ESTOQUE; déficit/qty estão em
          // unidade de COMPRA → converte o preço pelo MESMO fator estoque→compra
          // usado nas quantidades (fix A3.2 — antes investimento e unit_price da
          // OC ficavam errados pelo fator de conversão, ex.: R$ 8 em vez de R$ 800).
          const priceInPurchaseUnit = resolved.price * stockToPurchaseDivisor;

          return {
            product_id: resolved.product_id ?? productIdOverride ?? null,
            name: materialName,
            type,
            consumption_per_pair: consumptionPerPair,
            total_needed: totalNeededRaw,
            total_needed_converted: totalNeededConverted,
            unit: rawUnit,
            purchase_unit: purchaseUnit,
            conversion_rate: convRate,
            width_missing: widthMissing,
            _stock: stockInPurchaseUnit,
            _price: priceInPurchaseUnit,
            _supplier: resolved.supplier,
            _supplier_id: resolved.supplier_id ?? undefined,
            _product_id: resolved.product_id ?? productIdOverride ?? undefined,
          } as any;
        }

        // Upper/Cabedal
        if (sheet.upper_consumption > 0) {
          materials.push(buildMaterialLine(sheet.upper_material || 'Cabedal', 'Cabedal', sheet.upper_consumption, 'dm²', true));
        }

        // Lining/Forro
        if (sheet.lining_consumption > 0) {
          materials.push(buildMaterialLine(sheet.lining_material || 'Forração', 'Forração', sheet.lining_consumption, 'dm²', true));
        }

        // Insole/Palmilha
        if (sheet.insole_consumption > 0) {
          materials.push(buildMaterialLine(sheet.insole_material || 'Palmilha', 'Palmilha', sheet.insole_consumption, 'dm²', true));
        }

        // Sole/Solado
        if (sheet.sole_consumption > 0) {
          materials.push(buildMaterialLine(sheet.sole_material || sheet.sole_type || 'Solado', 'Solado', sheet.sole_consumption, 'par', false));
        }

        // Direct components
        if (Array.isArray(sheet.direct_components)) {
          for (const comp of sheet.direct_components as any[]) {
            const product = comp.product_id ? pMap.get(comp.product_id) : null;
            const compUnit = product?.unit || 'un';
            materials.push(buildMaterialLine(
              comp.product_name || 'Componente',
              'Componente',
              Number(comp.quantity) || 0,
              compUnit,
              false,
              comp.product_id || null,
              product ? availableStock(product) : 0,
              product ? Number(product.unit_price) || 0 : 0,
              getSupplierName(product),
              getDisplayUnit(product),
              Number(product?.conversion_rate) || 1,
              product?.supplier_id || undefined,
            ));
          }
        }

        needs.push({
          order_id: order.id,
          order_number: order.order_number,
          sale_order_number: saleOrder?.order_number || '',
          client_name: saleOrder?.client_name || '',
          reference_name: sheet.name || '',
          quantity: qty,
          delivery_date: deliveryDate,
          week_label: weekLabel,
          week_start: weekStart,
          materials,
        });
      }

      // Sort by week
      needs.sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
      setOrderNeeds(needs);
    } catch (err: any) {
      console.error('[PurchasePlanning] Error fetching order consumption:', err, err?.message, err?.details, err?.hint);
      setOrderNeeds([]);
      setLoadError(err?.message || 'Não foi possível carregar o planejamento de compras.');
      toast.error('Erro ao carregar consumo dos pedidos: ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  }

  // Available weeks for filter
  const availableWeeks = useMemo(() => {
    const weeks = new Map<string, Date>();
    orderNeeds.forEach(o => {
      if (!weeks.has(o.week_label)) weeks.set(o.week_label, o.week_start);
    });
    return Array.from(weeks.entries()).sort((a, b) => a[1].getTime() - b[1].getTime());
  }, [orderNeeds]);

  // Aggregate materials by week
  const weeklySummaries = useMemo(() => {
    const weekMap = new Map<string, WeeklyMaterialSummary>();

    for (const order of orderNeeds) {
      if (!weekMap.has(order.week_label)) {
        weekMap.set(order.week_label, {
          week_label: order.week_label,
          week_start: order.week_start,
          orders_count: 0,
          total_pairs: 0,
          materials: new Map(),
        });
      }
      const week = weekMap.get(order.week_label)!;
      week.orders_count++;
      week.total_pairs += order.quantity;

      for (const mat of order.materials) {
        const key = `${mat.name.toLowerCase()}_${mat.type}`;
        const matAny = mat as any;
        if (!week.materials.has(key)) {
          week.materials.set(key, {
            material_key: key,
            name: mat.name,
            type: mat.type,
            total_needed: 0,
            unit: mat.purchase_unit, // Use purchase unit for display
            current_stock: matAny._stock || 0,
            stock_after: 0,
            unit_price: matAny._price || 0,
            estimated_cost: 0,
            selected: false,
            supplier_name: matAny._supplier || undefined,
            supplier_id: matAny._supplier_id || undefined,
            orders: [],
            product_id: matAny._product_id || undefined,
            width_missing: matAny.width_missing || false,
          });
        }
        const agg = week.materials.get(key)!;
        // Use converted quantity (in purchase unit) for comparison with stock
        agg.total_needed += mat.total_needed_converted;
        if (matAny.width_missing) agg.width_missing = true;
        agg.orders.push(order.order_number);
      }
    }

    // Calculate stock_after and estimated_cost (both now in purchase unit)
    for (const [, week] of Array.from(weekMap)) {
      for (const [, mat] of Array.from(week.materials)) {
        mat.stock_after = mat.current_stock - mat.total_needed;
        const deficit = Math.max(0, mat.total_needed - mat.current_stock);
        mat.estimated_cost = deficit * mat.unit_price;
        mat.selected = mat.stock_after < 0; // auto-select deficit items
      }
    }

    return Array.from(weekMap.values()).sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
  }, [orderNeeds, productsMap]);

  // Filtered view
  const filteredSummaries = useMemo(() => {
    if (selectedWeek === 'all') return weeklySummaries;
    return weeklySummaries.filter(w => w.week_label === selectedWeek);
  }, [weeklySummaries, selectedWeek]);

  // All materials across selected weeks for next steps
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
          existing.orders = Array.from(new Set([...existing.orders, ...mat.orders]));
          existing.stock_after = existing.current_stock - existing.total_needed;
          const deficit = Math.max(0, existing.total_needed - existing.current_stock);
          existing.estimated_cost = deficit * existing.unit_price;
          existing.selected = existing.stock_after < 0;
        }
      }
    }
    let arr = Array.from(merged.values());
    if (search) {
      const q = normalizeForSearch(search);
      arr = arr.filter(m => normalizeForSearch(m.name).includes(q) || normalizeForSearch(m.type).includes(q));
    }
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
    setSelectedMaterials(prev =>
      prev.map(m => m.material_key === key ? { ...m, selected: !m.selected } : m)
    );
  };

  const handleCreatePOs = async () => {
    if (creating) return; // guard contra double-click (fix A3.3a)
    setCreating(true);
    try {
      const eligible = selectedMaterials.filter(m => m.selected && m.stock_after < 0);
      // Material de ÁREA sem largura na ficha → conversão dm²→física indefinida →
      // quantidade inflada (~100×). NÃO gera OC pra esses (evita pedido absurdo);
      // avisa pra cadastrar a largura. Auditoria 2026-06-14.
      const blocked = eligible.filter(m => m.width_missing);
      const active = eligible.filter(m => !m.width_missing);
      if (blocked.length > 0) {
        toast.warning(
          `${blocked.length} material(is) de área sem largura na ficha (${blocked.slice(0, 3).map(m => m.name).join(', ')}${blocked.length > 3 ? '…' : ''}) ficaram FORA da OC — a quantidade não é confiável. Cadastre a largura em Materiais → Ficha de Componente → Dimensões.`,
        );
      }
      const bySupplier = new Map<string, AggregatedMaterial[]>();
      active.forEach(m => {
        const key = m.supplier_name || 'Sem Fornecedor';
        if (!bySupplier.has(key)) bySupplier.set(key, []);
        bySupplier.get(key)!.push(m);
      });

      let count = 0;
      for (const [supplierName, items] of Array.from(bySupplier)) {
        // estimated_cost já está em R$ de unidade de COMPRA (preço convertido
        // pelo fator estoque→compra em buildMaterialLine) — fix A3.2.
        const totalValue = items.reduce((s, i) => s + i.estimated_cost, 0);
        // FK do fornecedor quando algum produto do grupo tem (fix A3.3b) —
        // sem ele a OC caía no default de prazo de pagamento.
        const supplierId = items.find(i => i.supplier_id)?.supplier_id ?? null;
        // Idempotência DETERMINÍSTICA (auditoria 2026-06-14, Área 6): o trigger
        // tg_purchase_order_idempotency rejeita a MESMA key em 30s, mas
        // crypto.randomUUID() gerava key nova a cada submit → o trigger nunca
        // via repetição (dois cliques = 2 OCs). Agora a key é hash do payload
        // (fornecedor + itens ordenados com déficit) — double-click colide e a
        // 2ª OC é rejeitada; após 30s um re-pedido idêntico é liberado.
        const idempSig = items
          .filter(i => i.product_id)
          .map(i => `${i.product_id}:${Math.ceil(Math.max(0, i.total_needed - i.current_stock))}`)
          .sort()
          .join('|');
        const idempKey = `wizard|${supplierId || supplierName}|${idempSig}`;
        const { data: po, error: poErr } = await supabase
          .from('purchase_orders')
          .insert({
            supplier_name: supplierName,
            supplier_id: supplierId,
            total_value: totalValue,
            notes: `Plano de compras baseado em pedidos`,
            auto_generated: true,
            status: 'pending',
            idempotency_key: idempKey,
          })
          .select('id')
          .single();
        if (poErr) throw poErr;

        const poItems = items
          .filter(item => item.product_id) // Only include items with a valid product_id
          .map(item => {
          const deficit = Math.max(0, item.total_needed - item.current_stock);
          // Respeita o lote mínimo de compra (min_order_quantity): arredonda pro
          // próximo múltiplo. Antes pedia o déficit cru (fracionava papelão/bobina).
          const prod = productsMap.get(item.product_id!);
          const moq = Number(prod?.min_order_quantity) || 0;
          let qty = Math.ceil(deficit);
          if (moq > 1) qty = Math.ceil(qty / moq) * moq;
          // Múltiplo de compra (embalagem): arredonda pra cima (ex.: 187 → 200 c/ 50).
          qty = roundUpToPurchaseMultiple(qty, prod?.purchase_multiple);
          return {
            purchase_order_id: po.id,
            product_id: item.product_id!,
            current_stock: item.current_stock,
            min_stock: 0,
            max_stock: 0,
            suggested_quantity: qty,
            quantity: qty,
            unit_price: item.unit_price, // R$/unidade de COMPRA (convenção de purchase_order_items)
            unit: item.unit,
          };
        });

        if (poItems.length === 0) {
          // No valid items — delete the empty PO
          await supabase.from('purchase_orders').delete().eq('id', po.id);
          continue;
        }

        const { error: itemsErr } = await supabase
          .from('purchase_order_items')
          .insert(poItems);
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
          <Button variant="outline" onClick={() => void fetchOrderConsumption()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
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
                <span className={`text-xs hidden lg:inline ${i === currentStep ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  {step.title}
                </span>
                {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 0: Weekly consumption analysis */}
      {currentStep === 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" /> Consumo Futuro por Semana
              </CardTitle>
              <CardDescription>
                Necessidades de materiais baseadas nos pedidos em aberto ({totalOrdersAll} OPs, {totalPairsAll.toLocaleString()} pares)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <Label>Filtrar Semana</Label>
                  <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as semanas</SelectItem>
                      {availableWeeks.map(([label]) => (
                        <SelectItem key={label} value={label}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Buscar material</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Nome do material..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  </div>
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="display text-2xl tabular-nums text-primary">{totalOrdersAll}</p>
                    <p className="text-xs text-muted-foreground">OPs em aberto</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="display text-2xl tabular-nums">{totalPairsAll.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Pares totais</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="display text-2xl tabular-nums">{availableWeeks.length}</p>
                    <p className="text-xs text-muted-foreground">Semanas</p>
                  </CardContent>
                </Card>
                <Card className={deficitCount > 0 ? 'border-destructive/30 bg-destructive/5' : ''}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className={`display text-2xl tabular-nums ${deficitCount > 0 ? 'text-destructive' : ''}`}>{deficitCount}</p>
                    <p className="text-xs text-muted-foreground">Materiais em déficit</p>
                  </CardContent>
                </Card>
              </div>

              {/* Weekly breakdown */}
              {filteredSummaries.map(week => (
                <Card key={week.week_label}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Semana {week.week_label}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{week.orders_count} OPs</Badge>
                        <Badge variant="secondary">{week.total_pairs.toLocaleString()} pares</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-lg overflow-auto max-h-[350px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Material</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead className="text-right">Necessário</TableHead>
                            <TableHead className="text-right">Estoque Atual</TableHead>
                            <TableHead className="text-right">Saldo Após</TableHead>
                            <TableHead className="text-right">Custo Est.</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            let mats = Array.from(week.materials.values());
                            if (search) {
                              const q = normalizeForSearch(search);
                              mats = mats.filter(m => normalizeForSearch(m.name).includes(q) || normalizeForSearch(m.type).includes(q));
                            }
                            return mats.sort((a, b) => a.stock_after - b.stock_after).map(mat => (
                              <TableRow key={mat.material_key} className={mat.stock_after < 0 ? 'bg-destructive/5' : ''}>
                                <TableCell>
                                  <p className="font-medium text-sm">{mat.name}</p>
                                  <p className="text-xs text-muted-foreground">{mat.orders.length} OP(s)</p>
                                </TableCell>
                                <TableCell><Badge variant="outline" className="text-xs">{mat.type}</Badge></TableCell>
                                <TableCell className="text-right">{fmtQty(mat.total_needed)} {mat.unit}</TableCell>
                                <TableCell className="text-right">{fmtQty(mat.current_stock)} {mat.unit}</TableCell>
                                <TableCell className={`text-right font-semibold ${mat.stock_after < 0 ? 'text-destructive' : ''}`}>
                                  {fmtQty(mat.stock_after)} {mat.unit}
                                </TableCell>
                                <TableCell className="text-right">{mat.estimated_cost > 0 ? fmt(mat.estimated_cost) : '—'}</TableCell>
                                <TableCell>{stockBadge(mat.stock_after)}</TableCell>
                              </TableRow>
                            ));
                          })()}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredSummaries.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum pedido em aberto encontrado.
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-between items-center pt-2">
                <p className="text-sm text-muted-foreground">
                  {allMaterialsFlat.length} materiais • {deficitCount} em déficit
                </p>
                <Button onClick={handleProceedToRecommendations} disabled={allMaterialsFlat.length === 0}>
                  Recomendações <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 1: Recommendations */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" /> Recomendações de Compra
              </CardTitle>
              <CardDescription>Selecione os materiais em déficit para incluir no plano</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                <div>
                  <p className="text-sm text-muted-foreground">Itens selecionados</p>
                  <p className="display text-2xl tabular-nums">{selectedMaterials.filter(m => m.selected).length} / {selectedMaterials.length}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Investimento estimado</p>
                  <p className="display text-2xl tabular-nums text-primary">
                    {fmt(selectedMaterials.filter(m => m.selected).reduce((s, m) => s + m.estimated_cost, 0))}
                  </p>
                </div>
              </div>

              <div className="border rounded-lg overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Déficit</TableHead>
                      <TableHead className="text-right">Preço Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Fornecedor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedMaterials.map(m => {
                      const deficit = Math.max(0, m.total_needed - m.current_stock);
                      return (
                        <TableRow key={m.material_key} className={!m.selected ? 'opacity-50' : ''}>
                          <TableCell>
                            <Checkbox checked={m.selected} onCheckedChange={() => toggleMaterial(m.material_key)} />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-sm">{m.name}</p>
                            <p className="text-xs text-muted-foreground">{m.orders.length} OP(s)</p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{m.type}</Badge></TableCell>
                          <TableCell className="text-right text-destructive font-semibold">
                            {deficit > 0 ? fmtQty(deficit) : '—'} {deficit > 0 ? m.unit : ''}
                          </TableCell>
                          <TableCell className="text-right">{m.unit_price > 0 ? fmt(m.unit_price) : '—'}</TableCell>
                          <TableCell className="text-right font-semibold">{m.estimated_cost > 0 ? fmt(m.estimated_cost) : '—'}</TableCell>
                          <TableCell className="text-sm">{m.supplier_name || '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(0)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={() => setCurrentStep(2)}>
                  Fornecedores <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Suppliers */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" /> Agrupamento por Fornecedor
              </CardTitle>
              <CardDescription>Itens agrupados por fornecedor para geração de OCs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const active = selectedMaterials.filter(m => m.selected && m.stock_after < 0);
                const bySupplier = new Map<string, AggregatedMaterial[]>();
                active.forEach(m => {
                  const key = m.supplier_name || 'Sem Fornecedor';
                  if (!bySupplier.has(key)) bySupplier.set(key, []);
                  bySupplier.get(key)!.push(m);
                });

                if (bySupplier.size === 0) {
                  return (
                    <div className="text-center py-8 text-muted-foreground">
                      Nenhum material com déficit selecionado.
                    </div>
                  );
                }

                return Array.from(bySupplier).map(([supplier, items]) => (
                  <Card key={supplier} className="border-l-4 border-l-primary">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{supplier}</CardTitle>
                        <Badge>{items.length} itens • {fmt(items.reduce((s, i) => s + i.estimated_cost, 0))}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {items.map(item => {
                          const deficit = Math.max(0, item.total_needed - item.current_stock);
                          return (
                            <div key={item.material_key} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                              <span>{item.name} <Badge variant="outline" className="text-xs ml-1">{item.type}</Badge></span>
                              <span className="font-medium">{fmtQty(deficit)} {item.unit} × {fmt(item.unit_price)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ));
              })()}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={() => setCurrentStep(3)}>
                  Cronograma <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Schedule */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" /> Cronograma Financeiro
              </CardTitle>
              <CardDescription>Previsão de impacto financeiro</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <DollarSign className="h-8 w-8 mx-auto text-primary mb-2" />
                    <p className="display text-2xl tabular-nums">{fmt(selectedMaterials.filter(m => m.selected && m.stock_after < 0).reduce((s, m) => s + m.estimated_cost, 0))}</p>
                    <p className="text-xs text-muted-foreground">Investimento Total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <Package className="h-8 w-8 mx-auto text-primary mb-2" />
                    <p className="display text-2xl tabular-nums">{selectedMaterials.filter(m => m.selected && m.stock_after < 0).length}</p>
                    <p className="text-xs text-muted-foreground">Itens no Plano</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <Calendar className="h-8 w-8 mx-auto text-primary mb-2" />
                    <p className="display text-2xl tabular-nums">{format(addDays(new Date(), 7), 'dd/MM')}</p>
                    <p className="text-xs text-muted-foreground">Data Sugerida de Envio</p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={() => setCurrentStep(4)}>
                  Revisão Final <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 4: Review */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" /> Revisão Final
              </CardTitle>
              <CardDescription>Confirme a criação das Ordens de Compra</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 text-center space-y-2">
                <p className="display text-3xl tabular-nums text-primary">
                  {fmt(selectedMaterials.filter(m => m.selected && m.stock_after < 0).reduce((s, m) => s + m.estimated_cost, 0))}
                </p>
                <p className="text-muted-foreground">
                  {selectedMaterials.filter(m => m.selected && m.stock_after < 0).length} itens em{' '}
                  {new Set(selectedMaterials.filter(m => m.selected && m.stock_after < 0).map(m => m.supplier_name || 'Sem Fornecedor')).size} OC(s)
                </p>
                <p className="text-xs text-muted-foreground">Baseado nos pedidos em aberto</p>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setCurrentStep(3)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={handleCreatePOs} disabled={creating}>
                  {creating ? 'Criando...' : 'Criar Ordens de Compra'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
