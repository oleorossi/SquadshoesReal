/**
 * Lista de Separação — demanda via motor SQL canônico (mesmo do Consumo do PV).
 * Substitui calculateBomForOrders como fonte de quantidade na UI de picking.
 * As linhas de materiais adicionais saem de calculate_order_consumption_by_grade
 * (sheet_material_lines_required, mig 20270101045900): inativa/fora do consumo
 * não conta, per_size soma a grade, perda % entra, repetidas somam.
 */
import {
  fetchCanonicalConsumptionReport,
  materializeCanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';
import type { ConsumptionRow as CanonicalConsumptionRow } from '@/lib/consumptionRows';
import type { ConsumptionRow } from '@/lib/bomConsumption';

/** Adapta o shape anotado do canônico para o shape da Lista de Separação. */
export function toPickingConsumptionRows(rows: CanonicalConsumptionRow[]): ConsumptionRow[] {
  return rows
    .filter((row) => (row.totalQuantity > 0 || !!row.warning) && row.componentType !== 'Solado')
    .map((row) => ({
      componentType: row.componentType,
      groupName: row.groupName,
      materialName: row.materialName,
      productUnit: row.productUnit,
      color: row.color,
      totalQuantity: row.totalQuantity,
      widthMissing: row.widthMissing,
      plateEquivalent: row.plateEquivalent,
      warning: row.warning,
      colorMismatch: (row as { colorMismatch?: boolean }).colorMismatch,
      strapVariantId: row.strapVariantId,
      recipeId: row.recipeId,
      baseProductId: row.baseProductId,
      technicalStrapLineIds: row.technicalStrapLineIds,
      strapBaseRequiredM: row.artisanal?.baseQty,
      strapBaseName: row.artisanal?.baseName,
      strapConfirmedYieldMPerM: row.artisanal?.yieldPerMeter,
      boxTypeId: row.boxTypeIds?.[0] ?? null,
      productIds: row.productIds,
    }));
}

export async function calculatePickingListFromCanonical(orderIds: string[]): Promise<ConsumptionRow[]> {
  if (orderIds.length === 0) return [];
  const report = await fetchCanonicalConsumptionReport({ orderIds });
  const { rows } = await materializeCanonicalConsumptionReport(report);
  return toPickingConsumptionRows(rows);
}
