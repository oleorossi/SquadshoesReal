import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveConversionFactors } from '@/lib/unitConversion';
import { calculateConsumption, validateConsumptionPayload, type ConsumptionLine } from '@/services/consumptionService';
import { classifyBomMaterial } from '@/lib/orderConsumption';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from '@/lib/packagingPairsPerBox';
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
import { format, addDays, startOfWeek, endOfWeek, isAfter, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';
import { roundUpToPurchaseMultiple, applyPurchaseMultiple } from '@/lib/purchaseMultiple';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Retorno da queryFn de consumo — as duas estruturas que a tela consome. */
interface ConsumptionResult {
  needs: OrderMaterialNeed[];
  productsMap: Map<string, any>;
}

// Referências estáveis pro fallback de `data === undefined` (primeiro render e erro).
// Literais inline (`?? []`) criariam objeto novo a cada render e invalidariam os
// useMemo que dependem de orderNeeds/productsMap.
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
  /** Data-limite de compra (data_limite_compra da projeção) — backward do faturamento. */
  purchase_deadline?: string | null;
  missing_purchase_deadline: boolean;
  week_label: string;
  week_start: Date;
  materials: MaterialLine[];
}

interface MaterialLine {
  product_id: string | null;
  name: string;
  type: string; // component da linha canônica (Cabedal, Forração, Palmilha, Solado, …)
  consumption_per_pair: number;
  total_needed: number; // na unidade de CONSUMO da linha canônica (dm² p/ área)
  total_needed_converted: number; // convertido pra purchase_order_unit
  unit: string; // unidade de consumo
  purchase_unit: string; // purchase_order_unit for display
  conversion_rate: number;
  width_missing?: boolean; // área sem largura na ficha → conversão dm²→física indefinida
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
  /** Data-limite de compra MAIS CEDO entre os pedidos que precisam deste material. */
  earliest_purchase_deadline?: string | null;
  missing_purchase_deadline?: boolean;
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
  // ⚠ PERF (2026-07-26): isto era `useEffect(() => { fetchOrderConsumption(); }, [])`,
  // sem React Query — logo sem cache e sem dedupe. Cada montagem da tela refazia o
  // trabalho inteiro: 1 RPC calculate_order_consumption_by_grade POR OP ativa (75 hoje,
  // ~92ms cada = ~7s de CPU de banco disparados em paralelo) + 1
  // get_material_conversion_info por material de área. Envolto em useQuery, voltar pra
  // tela dentro do staleTime custa zero. Invalidar ['purchase_planning_consumption']
  // se mexer em ficha técnica/BOM e precisar refletir na hora.

  // Quantidade FINAL de compra: déficit → inteiro → lote mínimo (moq) → múltiplo
  // de compra (embalagem). Fonte única usada na criação da OC E na exibição da
  // revisão (pra o número e o excedente em azul baterem com o que será comprado).
  const computeBuyQty = (deficit: number, prod: any): number => {
    const moq = Number(prod?.min_order_quantity) || 0;
    let qty = Math.ceil(Math.max(0, deficit));
    if (moq > 1) qty = Math.ceil(qty / moq) * moq;
    // Fallback pro múltiplo do GRUPO: desde 02/08/2026 o múltiplo de compra é
    // cadastrado só em `product_groups` (a aplicação em massa nos itens saiu do
    // editor de grupo). Ler só `products.purchase_multiple` fazia o
    // planejamento comprar 187 enquanto a geração de OC — que já usava o
    // fallback — comprava 200.
    return applyPurchaseMultiple(qty, prod?.purchase_multiple, prod?.product_groups?.purchase_multiple);
  };
  const [selectedMaterials, setSelectedMaterials] = useState<AggregatedMaterial[]>([]);
  const [creating, setCreating] = useState(false);

  // Consumo por OP via motor CANÔNICO (RPC calculate_order_consumption_by_grade)
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

      // 1. OPs ativas + PV. grade/color/sale_order_item_id alimentam o motor
      // canônico; packaging_mode filtra caixas alternativas do BOM.
      const { data: orders = [], error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id,
          color, grade, sale_order_id, sale_order_item_id,
          sale_orders!orders_sale_order_id_fkey(order_number, delivery_deadline, delivery_week, delivery_month, client_name, packaging_mode)
        `)
        // Status REAIS de orders no backend (audit 2026-05): 'Pronto' não existe.
        .in('status', ['Reservado', 'Em Produção'])
        .order('planned_delivery', { ascending: true });
      if (ordersError) throw ordersError;

      const activeOrders = (orders as any[]).filter(o => o.reference_id);
      if (activeOrders.length === 0) {
        return { needs: [], productsMap: new Map<string, any>() };
      }

      // 2b. Data-LIMITE de compra por OP (auditoria 2026-06-14, Top10 #3).
      // Antes o Wizard agrupava as necessidades pela semana de ENTREGA do cliente
      // → sugeria comprar TARDE (o oposto da função do MRP). A view
      // purchase_projection_timeline já calcula data_limite_compra por OP×material
      // (cadeia de lead time produção + buffer fornecedor, server-side). Usamos a
      // data-limite MAIS CEDO entre os materiais da OP (deadline vinculante);
      // fallback pra entrega quando a view não cobre o material.
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

      // 3. Cadastros: produtos (estoque líquido, fornecedor, unidade de compra),
      // variante de material dos itens do PV (orders.sale_order_item_id →
      // sale_order_items.material_variant_id) e reservas ATIVAS das PRÓPRIAS OPs.
      const soiIds = Array.from(new Set(activeOrders.map(o => o.sale_order_item_id).filter(Boolean)));
      const refIds = Array.from(new Set(activeOrders.map(o => o.reference_id).filter(Boolean)));
      const [productsRes, soiRes, resvRes, sheetsRes] = await Promise.all([
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
            is_artisanal,
            supplier_ref:suppliers!products_supplier_id_fkey(name, trade_name)
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

      // Devolução das reservas PRÓPRIAS (F3-6, espelho do CTE own_res do
      // compute_materials_per_pv): a demanda do Wizard é BRUTA (consumo total
      // das OPs Reservado/Em Produção) — netar contra estoque já descontado das
      // reservas DESSAS MESMAS OPs contava o material 2× (demanda + reserva) e
      // recomendava recomprar o que a própria OP já reservou.
      const ownReservedByProduct = new Map<string, number>();
      for (const r of (resvRes.data ?? []) as any[]) {
        if (!r.product_id) continue;
        const give = Math.max(0, (Number(r.quantity_reserved) || 0) - (Number(r.quantity_consumed) || 0));
        ownReservedByProduct.set(r.product_id, (ownReservedByProduct.get(r.product_id) || 0) + give);
      }
      // Disponível pro plano = líquido (quantity − reserved_stock) + reservas
      // das próprias OPs analisadas.
      const availableStock = (p: any) =>
        Math.max(
          0,
          (Number(p?.quantity) || 0) - (Number(p?.reserved_stock) || 0) + (ownReservedByProduct.get(p?.id) || 0),
        );

      // 4. Consumo CANÔNICO por OP — mesma RPC dos motores SQL de compra
      // (calculate_order_consumption_by_grade: variante do PV, cor, per-size,
      // fonte solado e supressão forro-cabedal do lado do servidor). Substitui
      // a explosão própria por campos escalares + match por NOME que fazia o
      // Wizard ser o 4º motor de consumo (F3-6): sem loss própria, sem somar
      // estoque de todas as cores do grupo. OP sem grade cai no wrapper escalar
      // (calculate_order_consumption — paridade garantida com o by_grade).
      let failedOrders = 0;
      const consumptionByOrder = await Promise.all(
        activeOrders.map(async (order): Promise<ConsumptionLine[] | null> => {
          try {
            const variantId = order.sale_order_item_id
              ? variantBySoi.get(order.sale_order_item_id) ?? null
              : null;
            const grade =
              order.grade && typeof order.grade === 'object' && !Array.isArray(order.grade) &&
              Object.keys(order.grade).length > 0
                ? order.grade
                : null;
            if (grade) {
              const { data, error } = await supabase.rpc('calculate_order_consumption_by_grade', {
                p_reference_id: order.reference_id,
                p_grade: grade,
                p_color: order.color ?? '',
                ...(variantId ? { p_material_variant_id: variantId } : {}),
              });
              if (error) throw error;
              return validateConsumptionPayload((data as unknown) ?? []);
            }
            const summary = await calculateConsumption({
              referenceId: order.reference_id,
              quantity: Number(order.quantity) || 0,
              color: order.color,
              materialVariantId: variantId,
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
        toast.warning(
          `${failedOrders} OP(s) ficaram fora do plano — falha ao calcular o consumo. Veja o console.`,
        );
      }

      // 4b. Conversão dm²→unidade física do produto: mesma fonte dos motores
      // SQL (get_material_conversion_info — largura da ficha de componente).
      // No payload da RPC, linha de ÁREA vem com unit null (contrato do motor:
      // fn_projected_demand / compute_materials_per_pv / get_wave_material_needs
      // dividem por dm2_per_unit exatamente assim).
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

      // 6. Necessidades por OP a partir das linhas canônicas
      const needs: OrderMaterialNeed[] = [];

      activeOrders.forEach((order, idx) => {
        const lines = consumptionByOrder[idx];
        if (lines == null) return; // consumo falhou — OP fora do plano (toast acima)

        const saleOrder = Array.isArray(order.sale_orders) ? order.sale_orders[0] : order.sale_orders;
        const deliveryDate = order.planned_delivery || saleOrder?.delivery_deadline || null;
        // Agrupa pela DATA-LIMITE DE COMPRA (quando comprar) e não pela entrega
        // (quando entregar). Sem prazo calculado não existe semana segura para
        // compra: o item fica explicitamente pendente de planejamento.
        const purchaseDeadline = purchaseDeadlineByOrder.get(order.id) || null;
        const schedulingDate = parseDateValue(purchaseDeadline);
        const missingPurchaseDeadline = schedulingDate == null;
        const weekStart = missingPurchaseDeadline
          ? new Date(UNSCHEDULED_WEEK_START)
          : startOfWeek(schedulingDate!, { weekStartsOn: 1 });
        const weekEnd = missingPurchaseDeadline
          ? null
          : endOfWeek(schedulingDate!, { weekStartsOn: 1 });
        const weekLabel = missingPurchaseDeadline
          ? MISSING_PURCHASE_DEADLINE_LABEL
          : `${format(weekStart, 'dd/MM', { locale: ptBR })} - ${format(weekEnd!, 'dd/MM', { locale: ptBR })}`;

        const qty = Number(order.quantity) || 0;
        const packagingMode = saleOrder?.packaging_mode || null;

        // Filtro de caixa por packaging_mode — espelho TS do
        // filter_caixa_by_packaging_mode que os motores SQL aplicam sobre a
        // mesma RPC. Só age quando a ficha lista ≥2 tipos de caixa alternativos.
        const caixaTypes = new Set<CollectiveType>();
        for (const l of lines) {
          if (classifyBomMaterial('', l.product_name || '', l.category || '') !== 'Embalagem') continue;
          const t = caixaCollectiveTypeFromName(l.product_name);
          if (t) caixaTypes.add(t);
        }

        const materials: MaterialLine[] = [];
        for (const line of lines) {
          if (!line.product_id) continue; // linha de AVISO puro (required 0 + warning)
          const prod = pMap.get(line.product_id);
          if (prod?.is_artisanal) continue; // artesanal = OS interna, não OC (F3-2)
          if (
            packagingMode &&
            classifyBomMaterial('', line.product_name || '', line.category || '') === 'Embalagem' &&
            !shouldShowCaixaForMode(line.product_name, packagingMode, caixaTypes)
          ) {
            continue; // caixa alternativa que o packaging_mode do PV não usa
          }

          const stockUnit = prod?.unit || line.unit || 'un';
          const required = Number(line.required) || 0;
          const isAreaLine = line.unit == null;
          const conv = isAreaLine && line.product_id ? convInfo.get(line.product_id) : undefined;
          // Área sem largura na ficha de componente → conversão indefinida
          // (valor ~100× em dm² cru): marca e deixa FORA da OC, como antes.
          const widthMissing = !!line.conversion_warning || (isAreaLine && !!conv?.conversion_warning);
          const needInStock = isAreaLine && !widthMissing
            ? required / Math.max(conv?.dm2_per_unit || 1, 1)
            : required;

          // estoque→compra pelo conversion_rate (ex.: PLACA EVA dm²→placa ÷150);
          // preço convertido pelo MESMO fator (convenção de purchase_order_items).
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

      // Sort by week
      needs.sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
      return { needs, productsMap: pMap };
    } catch (err: any) {
      console.error('[PurchasePlanning] Error fetching order consumption:', err, err?.message, err?.details, err?.hint);
      // Relança pro React Query registrar o erro — a UI lê `loadError` do próprio
      // estado da query, e o retry/backoff global do QueryClient passa a valer aqui.
      // Sem toast local: o QueryCache.onError global (src/App.tsx) já emite um,
      // com id estável por queryKey, então não duplica entre as tentativas de retry.
      throw err;
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
          has_missing_purchase_deadline: false,
          materials: new Map(),
        });
      }
      const week = weekMap.get(order.week_label)!;
      week.orders_count++;
      week.total_pairs += order.quantity;
      week.has_missing_purchase_deadline ||= order.missing_purchase_deadline;

      for (const mat of order.materials) {
        // Chave por PRODUTO (não nome+tipo): o mesmo material usado em 2
        // componentes (ex.: napa no cabedal E na forração) soma as aplicações
        // e avalia o estoque UMA vez — regra canônica do modal de consumo.
        const matAny = mat as any;
        const key = matAny._product_id || `${mat.name.toLowerCase()}_${mat.type}`;
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
            earliest_purchase_deadline: order.purchase_deadline || null,
            missing_purchase_deadline: order.missing_purchase_deadline,
            product_id: matAny._product_id || undefined,
            width_missing: matAny.width_missing || false,
          });
        }
        const agg = week.materials.get(key)!;
        // Use converted quantity (in purchase unit) for comparison with stock
        agg.total_needed += mat.total_needed_converted;
        if (matAny.width_missing) agg.width_missing = true;
        if (order.missing_purchase_deadline) agg.missing_purchase_deadline = true;
        agg.orders.push(order.order_number);
        if (order.purchase_deadline && (!agg.earliest_purchase_deadline || order.purchase_deadline < agg.earliest_purchase_deadline)) {
          agg.earliest_purchase_deadline = order.purchase_deadline;
        }
      }
    }

    // Calculate stock_after and estimated_cost (both now in purchase unit)
    for (const [, week] of Array.from(weekMap)) {
      for (const [, mat] of Array.from(week.materials)) {
        mat.stock_after = mat.current_stock - mat.total_needed;
        const deficit = Math.max(0, mat.total_needed - mat.current_stock);
        // Área sem largura na ficha → quantidade ~100× inflada e comparação com
        // estoque INVÁLIDA: não estima custo nem auto-seleciona (a OC já bloqueia
        // esses itens — auto-marcar só pré-ticava uma linha que cairia fora).
        mat.estimated_cost = mat.width_missing ? 0 : deficit * mat.unit_price;
        mat.selected = !mat.width_missing && !mat.missing_purchase_deadline && mat.stock_after < 0; // auto-select deficit items
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
          if (mat.missing_purchase_deadline) existing.missing_purchase_deadline = true;
          existing.orders = Array.from(new Set([...existing.orders, ...mat.orders]));
          if (mat.earliest_purchase_deadline && (!existing.earliest_purchase_deadline || mat.earliest_purchase_deadline < existing.earliest_purchase_deadline)) {
            existing.earliest_purchase_deadline = mat.earliest_purchase_deadline;
          }
          existing.stock_after = existing.current_stock - existing.total_needed;
          const deficit = Math.max(0, existing.total_needed - existing.current_stock);
          // Área sem largura → quantidade inflada/comparação inválida (ver acima).
          existing.estimated_cost = existing.width_missing ? 0 : deficit * existing.unit_price;
          existing.selected = !existing.width_missing && !existing.missing_purchase_deadline && existing.stock_after < 0;
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
      const planningBlocked = eligible.filter(m => m.missing_purchase_deadline);
      const active = eligible.filter(m => !m.width_missing && !m.missing_purchase_deadline);
      if (blocked.length > 0) {
        toast.warning(
          `${blocked.length} material(is) de área sem largura na ficha (${blocked.slice(0, 3).map(m => m.name).join(', ')}${blocked.length > 3 ? '…' : ''}) ficaram FORA da OC — a quantidade não é confiável. Cadastre a largura em Materiais → Ficha de Componente → Dimensões.`,
        );
      }
      if (planningBlocked.length > 0) {
        toast.error(
          `${planningBlocked.length} material(is) ficaram FORA da OC por estarem sem prazo de compra — resolva o planejamento antes de comprar.`,
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
        // pelo fator estoque→compra na montagem das linhas) — fix A3.2.
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
        // Comprar até = data-limite de compra MAIS CEDO entre os materiais desta OC.
        const buyBy = items.map(i => i.earliest_purchase_deadline).filter(Boolean).sort()[0] || null;
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
            ...(buyBy ? { purchase_by_date: buyBy } : {}),
          })
          .select('id')
          .single();
        if (poErr) throw poErr;

        const poItems = items
          .filter(item => item.product_id) // Only include items with a valid product_id
          .map(item => {
          const deficit = Math.max(0, item.total_needed - item.current_stock);
          // Lote mínimo (min_order_quantity) + múltiplo de compra (embalagem):
          // mesma lógica da revisão (computeBuyQty) pra não divergir.
          const qty = computeBuyQty(deficit, productsMap.get(item.product_id!));
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

  // Material de área cuja ficha de componente não tem largura → não dá pra
  // converter dm²→unidade física, a quantidade fica ~100× inflada e a
  // comparação com estoque é inválida. Status âmbar (cor semântica permitida).
  const widthMissingBadge = (
    <Badge
      className="bg-amber-500/10 text-amber-600 border-amber-500/20"
      title="Ficha de componente sem largura — quantidade não confiável. Cadastre em Materiais → Ficha de Componente → Dimensões."
    >
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
                        {week.has_missing_purchase_deadline ? week.week_label : `Semana ${week.week_label}`}
                      </CardTitle>
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
                              // Área sem largura: linha NEUTRA (não vermelha) — a
                              // comparação com estoque é inválida (qtd ~100× inflada).
                              <TableRow key={mat.material_key} className={(!mat.width_missing && mat.stock_after < 0) || mat.missing_purchase_deadline ? 'bg-destructive/5' : ''}>
                                <TableCell>
                                  <p className="font-medium text-sm">{mat.name}</p>
                                  <p className="text-xs text-muted-foreground">{mat.orders.length} OP(s)</p>
                                </TableCell>
                                <TableCell><Badge variant="outline" className="text-xs">{mat.type}</Badge></TableCell>
                                <TableCell className={`text-right ${mat.width_missing ? 'text-muted-foreground' : ''}`}>{fmtQty(mat.total_needed)} {mat.unit}</TableCell>
                                <TableCell className="text-right">{fmtQty(mat.current_stock)} {mat.unit}</TableCell>
                                <TableCell className={`text-right font-semibold ${!mat.width_missing && mat.stock_after < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {mat.width_missing ? '—' : `${fmtQty(mat.stock_after)} ${mat.unit}`}
                                </TableCell>
                                <TableCell className="text-right">{!mat.width_missing && mat.estimated_cost > 0 ? fmt(mat.estimated_cost) : '—'}</TableCell>
                                <TableCell>
                                  {mat.missing_purchase_deadline
                                    ? <Badge variant="destructive">Sem prazo de compra</Badge>
                                    : mat.width_missing ? widthMissingBadge : stockBadge(mat.stock_after)}
                                </TableCell>
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
                            <Checkbox
                              checked={m.selected}
                              disabled={m.missing_purchase_deadline}
                              onCheckedChange={() => toggleMaterial(m.material_key)}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-sm flex items-center gap-1.5">
                              {m.name}
                              {m.width_missing && widthMissingBadge}
                              {m.missing_purchase_deadline && <Badge variant="destructive">Sem prazo de compra</Badge>}
                            </p>
                            <p className={m.missing_purchase_deadline ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                              {m.missing_purchase_deadline ? 'Resolver planejamento antes de gerar a OC.' : `${m.orders.length} OP(s)`}
                            </p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{m.type}</Badge></TableCell>
                          <TableCell className={`text-right font-semibold ${m.width_missing ? 'text-muted-foreground' : 'text-destructive'}`}>
                            {m.width_missing ? '—' : (deficit > 0 ? `${fmtQty(deficit)} ${m.unit}` : '—')}
                          </TableCell>
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
                const active = selectedMaterials.filter(m => m.selected && m.stock_after < 0 && !m.missing_purchase_deadline);
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
                          const prod = item.product_id ? productsMap.get(item.product_id) : null;
                          const buyQty = computeBuyQty(deficit, prod);
                          const surplus = Math.max(0, buyQty - deficit);
                          return (
                            <div key={item.material_key} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                              <span>{item.name} <Badge variant="outline" className="text-xs ml-1">{item.type}</Badge></span>
                              <span className="font-medium">
                                {fmtQty(buyQty)}
                                {surplus > 0.0001 && (
                                  <span
                                    className="ml-1 text-blue-600 dark:text-blue-400"
                                    title={`+${fmtQty(surplus)} ${item.unit} comprado a mais pra fechar o múltiplo de compra (embalagem)`}
                                  >
                                    +{fmtQty(surplus)}
                                  </span>
                                )}{' '}
                                {item.unit} × {fmt(item.unit_price)}
                              </span>
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
