
export interface ArtisanalCalculation {
  currentStock: number;
  minStock: number;
  forOrderMeters: number;
  forStockMeters: number;
  totalToProduce: number;
  baseMetersSend: number;
  laborCost: number;
  stockOk: boolean;
}

export function calcArtisanalRequirement(
  recipe: ArtisanalRecipe,
  targetMeters: number,
  currentStock: number,
  minStock: number
): ArtisanalCalculation {
  const yield_factor = Number(recipe.yield_per_meter) || 1;
  const labor_cost = Number(recipe.labor_cost_per_meter) || 0;

  const demand = Math.max(0, Number(targetMeters) || 0);
  const physicalStock = Math.max(0, Number(currentStock) || 0);
  const stockFloor = Math.max(0, Number(minStock) || 0);
  // O saldo atende primeiro a demanda; apenas o que falta para a demanda e para
  // recompor o piso vira produção. Equivale a max(0, D + M - C), sem contar o
  // mesmo estoque duas vezes.
  const forOrder = Math.max(0, demand - physicalStock);
  const stockAfterOrder = Math.max(0, physicalStock - demand);
  const forStock = Math.max(0, stockFloor - stockAfterOrder);
  const totalToProduce = forOrder + forStock;
  const baseMetersSend = totalToProduce / yield_factor;
  const laborCostTotal = totalToProduce * labor_cost;

  return {
    currentStock: physicalStock,
    minStock: stockFloor,
    forOrderMeters: forOrder,
    forStockMeters: forStock,
    totalToProduce,
    baseMetersSend,
    laborCost: laborCostTotal,
    stockOk: stockAfterOrder >= stockFloor,
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
