import { format, parseISO, addDays, isTuesday, nextTuesday, isBefore, startOfDay } from 'date-fns';
import { classifyBomMaterial } from './bomClassify';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, wholePackagingDemand, type CollectiveType } from './packagingPairsPerBox';

/**
 * Chave do mapa de datas-limite de compra (view purchase_projection_timeline).
 * Compartilhada entre o motor e a tela pra casar OP×material.
 */
export function buyByKey(orderId: string, productId: string): string {
  return `${orderId}::${productId}`;
}

export interface WeeklyOrder {
  id: string;
  reference_id: string;
  quantity: number;
  planned_start: string | null;
  planned_delivery: string | null;
  created_at: string;
  grade?: Record<string, number> | null;
  color?: string | null;
  sale_order_item_id?: string | null;
  /**
   * Modo de embalagem do PEDIDO (sale_orders.packaging_mode do PV da OP).
   * Usado pra filtrar caixas ALTERNATIVAS do BOM (colmeia × individual) —
   * sem ele o plano soma as duas e infla a compra de embalagem.
   */
  packaging_mode?: string | null;
}

/**
 * Linha de demanda já calculada pelo motor SQL (consumptionService).
 * Quando presente para uma OP, substitui a explosão do BOM nessa OP.
 */
export interface EngineDemandLine {
  orderId: string;
  productId: string;
  required: number;
  unit?: string | null;
  name?: string | null;
  category?: string | null;
  product?: SheetMaterial['products'];
}

export interface SheetMaterial {
  sheet_id: string;
  product_id: string;
  quantity_per_unit: number;
  products: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    category?: string | null;
    quantity: number;
    reserved_stock?: number;
    safety_stock?: number;
    supplier_lead_time_days?: number;
    lead_time_days?: number;
    unit_price: number;
    is_artisanal?: boolean;
  } | null;
}

export interface MaterialPlanRow {
  materialId: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  currentStock: number;
  virtualStock: number;
  weeklyPurchases: Record<string, number>;
  totalToBuy: number;
  estimatedCost: number;
}

export interface WeeklyPlanResult {
  sortedWeeks: string[];
  plan: MaterialPlanRow[];
}

export function generateWeeklyPurchasingPlan(
  orders: WeeklyOrder[],
  sheetMaterials: SheetMaterial[],
  /** @deprecated Ignorado — demanda vem só do motor SQL (`engineDemand`). */
  _componentSheets: unknown[] = [],
  buyByDates: Map<string, string> = new Map(),
  engineDemand: EngineDemandLine[] | null = null,
): WeeklyPlanResult {
  const weeklyDemands: Record<string, Record<string, number>> = {};

  const productMap = new Map<string, SheetMaterial['products']>();
  for (const sm of sheetMaterials) {
    if (sm.products && !productMap.has(sm.product_id)) {
      productMap.set(sm.product_id, sm.products);
    }
  }

  const engineByOrder = new Map<string, EngineDemandLine[]>();
  if (engineDemand) {
    for (const line of engineDemand) {
      if (!line.orderId || !line.productId) continue;
      const arr = engineByOrder.get(line.orderId) || [];
      arr.push(line);
      engineByOrder.set(line.orderId, arr);
      if (line.product && !productMap.has(line.productId)) {
        productMap.set(line.productId, line.product);
      }
    }
  }

  const today = startOfDay(new Date());

  const addDemand = (
    order: WeeklyOrder,
    productId: string,
    prod: NonNullable<SheetMaterial['products']>,
    requiredAmount: number,
    fallbackProdDate: Date | null,
  ) => {
    if (requiredAmount <= 0) return;
    const vkey = buyByKey(order.id, productId);
    let buyDate: Date | null = buyByDates.has(vkey) ? parseISO(buyByDates.get(vkey)!) : null;
    if (!buyDate && fallbackProdDate) {
      const leadDays = prod.supplier_lead_time_days ?? prod.lead_time_days ?? 0;
      buyDate = leadDays > 0 ? addDays(fallbackProdDate, -leadDays) : fallbackProdDate;
    }
    if (!buyDate) return;
    const effectiveBuyDate = isBefore(buyDate, today) ? today : buyDate;
    const targetTuesday = isTuesday(effectiveBuyDate) ? effectiveBuyDate : nextTuesday(effectiveBuyDate);
    const weekKey = format(targetTuesday, 'dd/MM/yyyy');
    if (!weeklyDemands[weekKey]) weeklyDemands[weekKey] = {};
    weeklyDemands[weekKey][productId] = (weeklyDemands[weekKey][productId] || 0) + requiredAmount;
  };

  for (const order of orders) {
    const prodDateStr = order.planned_start || order.planned_delivery || order.created_at;
    const fallbackProdDate = prodDateStr ? parseISO(prodDateStr) : null;

    const engineLines = engineByOrder.get(order.id);
    if (engineLines) {
      const caixaTypes = new Set<CollectiveType>();
      for (const line of engineLines) {
        const prod = line.product || productMap.get(line.productId);
        if (!prod) continue;
        if (classifyBomMaterial('', line.name || prod.name || '', line.category || prod.category || '') !== 'Embalagem') continue;
        const t = caixaCollectiveTypeFromName(line.name || prod.name);
        if (t) caixaTypes.add(t);
      }
      for (const line of engineLines) {
        const prod = line.product || productMap.get(line.productId);
        if (!prod || prod.is_artisanal) continue;
        const materialName = line.name || prod.name || '';
        const materialCategory = line.category || prod.category || '';
        if (
          order.packaging_mode &&
          classifyBomMaterial('', materialName, materialCategory) === 'Embalagem' &&
          !shouldShowCaixaForMode(materialName, order.packaging_mode, caixaTypes)
        ) continue;

        // Demanda já vem convertida do motor SQL (unit preenchido). Sem unit =
        // linha incompleta: não reconverter localmente (era o 3º motor).
        let requiredAmount = Number(line.required) || 0;
        if (line.unit == null) {
          continue;
        }
        if (classifyBomMaterial('', materialName, materialCategory) === 'Embalagem') {
          requiredAmount = wholePackagingDemand(requiredAmount, prod.unit);
        }
        addDemand(order, line.productId, prod, requiredAmount, fallbackProdDate);
      }
      continue;
    }

    // Sem linhas do motor SQL para esta OP: não cair no BOM local (convert
    // paralelo removido — decisão unificação motores 18/10/2026).
  }

  const sortedWeeks = Object.keys(weeklyDemands).sort((a, b) => {
    const [d1, m1, y1] = a.split('/');
    const [d2, m2, y2] = b.split('/');
    return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
  });

  const planMap = new Map<string, MaterialPlanRow>();

  productMap.forEach((prod, id) => {
    planMap.set(id, {
      materialId: id,
      name: prod!.name,
      sku: prod!.sku || '',
      unit: prod!.unit || 'un',
      unitPrice: prod!.unit_price || 0,
      currentStock: prod!.quantity || 0,
      // Estoque mínimo foi removido (specs/remover-estoque-minimo.md): o saldo
      // inteiro (menos o estoque de segurança) atende a demanda dos PVs.
      virtualStock: Math.max(0, (prod!.quantity || 0) - (prod!.safety_stock || 0)),
      weeklyPurchases: {},
      totalToBuy: 0,
      estimatedCost: 0,
    });
  });

  for (const week of sortedWeeks) {
    for (const [materialId, demand] of Object.entries(weeklyDemands[week])) {
      const row = planMap.get(materialId);
      if (!row) continue;
      const available = row.virtualStock;
      if (available >= demand) {
        row.virtualStock -= demand;
        row.weeklyPurchases[week] = 0;
      } else {
        const toBuy = demand - available;
        row.weeklyPurchases[week] = toBuy;
        row.virtualStock = 0;
        row.totalToBuy += toBuy;
        row.estimatedCost += toBuy * row.unitPrice;
      }
    }
  }

  const plan = Array.from(planMap.values()).filter(
    (r) => r.totalToBuy > 0 || Object.values(r.weeklyPurchases).some((v) => v > 0)
  );
  plan.sort((a, b) => b.totalToBuy - a.totalToBuy);
  return { sortedWeeks, plan };
}
