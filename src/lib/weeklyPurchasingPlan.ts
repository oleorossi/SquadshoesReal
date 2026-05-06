 import { startOfWeek, format, parseISO, addDays, isTuesday, nextTuesday } from 'date-fns';

export interface WeeklyOrder {
  id: string;
  reference_id: string;
  quantity: number;
  planned_start: string | null;
  planned_delivery: string | null;
  created_at: string;
  grade?: Record<string, number> | null;
}

export interface SheetMaterial {
  sheet_id: string;
  product_id: string;
  quantity_per_unit: number;
  consumption_per_size?: Record<string, number> | null;
  products: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    quantity: number;
    min_stock?: number;
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
  minStock: number;
  virtualStock: number;
  weeklyPurchases: Record<string, number>;
  totalToBuy: number;
  estimatedCost: number;
}

export interface WeeklyPlanResult {
  sortedWeeks: string[];
  plan: MaterialPlanRow[];
}

/**
 * Calculate required amount using per-size consumption when grade is available.
 * Falls back to quantity_per_unit × total quantity when no grade/per-size data.
 */
function calculateRequiredAmount(
  mat: SheetMaterial,
  order: WeeklyOrder,
  wastePct: number
): number {
  const multiplier = 1 + wastePct / 100;
  const perSize = mat.consumption_per_size;
  const grade = order.grade;

  // Use per-size consumption with grade when both available
  if (perSize && grade && Object.keys(perSize).length > 0 && Object.keys(grade).length > 0) {
    let total = 0;
    for (const [size, pairs] of Object.entries(grade)) {
      const pairsNum = Number(pairs) || 0;
      if (pairsNum <= 0) continue;
      const consumptionForSize = perSize[size] !== undefined ? Number(perSize[size]) : (Number(mat.quantity_per_unit) || 0);
      total += pairsNum * consumptionForSize;
    }
    return total * multiplier;
  }

  // Fallback: average consumption × total quantity
  return order.quantity * mat.quantity_per_unit * multiplier;
}

export function generateWeeklyPurchasingPlan(
  orders: WeeklyOrder[],
  sheetMaterials: SheetMaterial[],
  wastePctMap: Record<string, number>
): WeeklyPlanResult {
  const weeklyDemands: Record<string, Record<string, number>> = {};

  const materialsBySheet = new Map<string, SheetMaterial[]>();
  for (const sm of sheetMaterials) {
    const arr = materialsBySheet.get(sm.sheet_id) || [];
    arr.push(sm);
    materialsBySheet.set(sm.sheet_id, arr);
  }

  const productMap = new Map<string, SheetMaterial['products']>();
  for (const sm of sheetMaterials) {
    if (sm.products && !productMap.has(sm.product_id)) {
      productMap.set(sm.product_id, sm.products);
    }
  }

  for (const order of orders) {
    const dateStr = order.planned_start || order.planned_delivery || order.created_at;
    if (!dateStr) continue;

     const date = parseISO(dateStr);
     // Se a data já for terça-feira, usamos ela, caso contrário pegamos a próxima terça
     const targetTuesday = isTuesday(date) ? date : nextTuesday(date);
     const weekKey = format(targetTuesday, 'dd/MM/yyyy');

    if (!weeklyDemands[weekKey]) weeklyDemands[weekKey] = {};

    const materials = materialsBySheet.get(order.reference_id) || [];
    for (const mat of materials) {
      if (!mat.products || mat.products.is_artisanal) continue;

      // A quebra (waste) vem da ficha técnica (sheet_id) que é a reference_id da OP
      const wastePct = wastePctMap[order.reference_id] || 0;
      const requiredAmount = calculateRequiredAmount(mat, order, wastePct);

      if (!weeklyDemands[weekKey][mat.product_id]) {
        weeklyDemands[weekKey][mat.product_id] = 0;
      }
      weeklyDemands[weekKey][mat.product_id] += requiredAmount;
    }
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
      minStock: prod!.min_stock || 0,
      // O estoque virtual inicial já desconta o estoque mínimo para garantir segurança
      virtualStock: (prod!.quantity || 0) - (prod!.min_stock || 0),
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
