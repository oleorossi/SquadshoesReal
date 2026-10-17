/**
 * Custo de linha na Precificação da ficha.
 *
 * - fixed_per_pair: usa cost_per_pair (kit base / ajuste)
 * - consumo_x_preco: quantity_per_unit × (preço do estoque ou estimado no rascunho)
 */

export type PricingLineKind = 'material' | 'ajuste';
export type PricingCostMode = 'fixed_per_pair' | 'consumo_x_preco';

export interface PricingSheetLineInput {
  line_kind?: PricingLineKind | string | null;
  cost_mode?: PricingCostMode | string | null;
  is_active?: boolean | null;
  quantity_per_unit?: number | null;
  cost_per_pair?: number | null;
  estimated_unit_price?: number | null;
  product_id?: string | null;
  products?: { unit_price?: number | null } | null;
}

export function allowsDraftMaterials(statusFicha: string | null | undefined): boolean {
  const status = (statusFicha || 'rascunho').trim().toLowerCase();
  return status === 'rascunho' || status === 'em_revisao';
}

export function lineDisplayName(line: {
  draft_name?: string | null;
  part_name?: string | null;
  products?: { name?: string | null } | null;
  line_kind?: string | null;
}): string {
  if (line.products?.name) return line.products.name;
  const draft = (line.draft_name || line.part_name || '').trim();
  if (draft) return draft;
  return line.line_kind === 'ajuste' ? 'Ajuste' : 'Material';
}

export function resolveUnitPrice(line: PricingSheetLineInput): number {
  if (line.product_id && line.products?.unit_price != null) {
    return Number(line.products.unit_price) || 0;
  }
  return Number(line.estimated_unit_price) || 0;
}

/** Custo R$/par da linha; 0 se inativa. */
export function pricingLineCostPerPair(line: PricingSheetLineInput): number {
  if (line.is_active === false) return 0;
  const mode = (line.cost_mode || 'consumo_x_preco') as PricingCostMode;
  if (mode === 'fixed_per_pair' || line.line_kind === 'ajuste') {
    const fixed = Number(line.cost_per_pair);
    if (Number.isFinite(fixed) && fixed !== 0) return fixed;
    // fallback: qty × preço estimado
  }
  const qty = Number(line.quantity_per_unit) || 0;
  return qty * resolveUnitPrice(line);
}

export function sumActivePricingLines(lines: PricingSheetLineInput[]): number {
  return lines.reduce((sum, line) => sum + pricingLineCostPerPair(line), 0);
}

/** Linha que ainda bloqueia validação/publicação. */
export function isUnlinkedDraftMaterial(line: {
  is_active?: boolean | null;
  line_kind?: string | null;
  product_id?: string | null;
}): boolean {
  if (line.is_active === false) return false;
  if ((line.line_kind || 'material') === 'ajuste') return false;
  return !line.product_id;
}
