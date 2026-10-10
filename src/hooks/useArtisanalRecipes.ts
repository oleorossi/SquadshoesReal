
export interface ArtisanalCalculation {
  currentStock: number;
  forOrderMeters: number;
  totalToProduce: number;
  baseMetersSend: number;
  laborCost: number;
  stockOk: boolean;
}

/**
 * Produção artesanal = só a falta do pedido: max(0, demanda − estoque).
 * Estoque mínimo foi removido (specs/remover-estoque-minimo.md) — não há mais
 * parcela "para estoque" recompondo piso.
 */
export function calcArtisanalRequirement(
  recipe: ArtisanalRecipe,
  targetMeters: number,
  currentStock: number,
): ArtisanalCalculation {
  const yield_factor = Number(recipe.yield_per_meter) || 1;
  const labor_cost = Number(recipe.labor_cost_per_meter) || 0;

  const demand = Math.max(0, Number(targetMeters) || 0);
  const physicalStock = Math.max(0, Number(currentStock) || 0);
  const forOrder = Math.max(0, demand - physicalStock);
  const totalToProduce = forOrder;
  const baseMetersSend = totalToProduce / yield_factor;
  const laborCostTotal = totalToProduce * labor_cost;

  return {
    currentStock: physicalStock,
    forOrderMeters: forOrder,
    totalToProduce,
    baseMetersSend,
    laborCost: laborCostTotal,
    stockOk: physicalStock >= demand,
  };
}
export interface ArtisanalRecipe {
  id: string;
  name: string;
  artisanal_product_name: string;
  base_product_name: string;
  yield_per_meter: number;
  labor_cost_per_meter: number;
  base_time_minutes: number;
  /** Largura de corte da tira artesanal em mm (corte do rolo no PV). Nullable. */
  cut_width_mm: number | null;
  default_contractor_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
