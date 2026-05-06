import { supabase } from '@/integrations/supabase/client';

export interface ValidationError {
  type: 'dimension_mismatch' | 'material_unavailable' | 'insufficient_stock' | 'invalid_specification';
  message: string;
  field?: string;
  material_id?: string;
  severity: 'critical' | 'high' | 'medium';
  suggested_action: string;
}

export interface ValidationWarning {
  type: string;
  message: string;
  material_id?: string;
  suggested_action?: string;
}

export interface ValidationResult {
  is_valid: boolean;
  dimensional_check: boolean;
  material_availability: boolean;
  cost_calculated: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  estimated_cost: number;
  estimated_production_time: number;
}

interface RefMaterial {
  id: string;
  product_id: string | null;
  quantity_needed: number;
  unit: string;
  waste_factor: number;
  is_critical: boolean;
  cut_length: number | null;
  cut_width: number | null;
  cut_thickness: number | null;
  cut_unit: string | null;
  products?: {
    name: string;
    sku: string;
    category: string;
    quantity: number;
    unit_price: number;
    unit: string;
    min_stock: number;
    dimensions_length?: number;
    dimensions_width?: number;
    dimensions_thickness?: number;
  } | null;
}

interface RefData {
  tolerance: number;
  final_length: number;
  final_width: number;
  final_height: number;
}

/** Run full validation for a technical reference, persist results */
export async function runFullValidation(refId: string): Promise<ValidationResult> {
  // 1. Fetch ref + materials with full product data
  const { data: ref, error: refErr } = await (supabase as any)
    .from('technical_references')
    .select('*')
    .eq('id', refId)
    .single();
  if (refErr) throw refErr;

  const { data: materials, error: matErr } = await (supabase as any)
    .from('technical_reference_materials')
    .select('*, products(name, sku, category, quantity, unit_price, unit, min_stock, dimensions_length, dimensions_width, dimensions_thickness)')
    .eq('technical_reference_id', refId)
    .order('sequence', { ascending: true });
  if (matErr) throw matErr;

  const mats: RefMaterial[] = materials || [];

  // Run validations
  const dimResult = validateDimensions(ref as RefData, mats);
  const stockResult = validateMaterialAvailability(mats);
  const costResult = calculateCost(mats);

  const allErrors = [...dimResult.errors, ...stockResult.errors];
  const allWarnings = [...dimResult.warnings, ...stockResult.warnings];

  const result: ValidationResult = {
    is_valid: allErrors.filter(e => e.severity === 'critical').length === 0,
    dimensional_check: dimResult.isValid,
    material_availability: stockResult.isValid,
    cost_calculated: true,
    errors: allErrors,
    warnings: allWarnings,
    estimated_cost: costResult,
    estimated_production_time: mats.length * 0.5, // placeholder hours
  };

  // Persist
  await (supabase as any)
    .from('technical_references')
    .update({
      is_valid: result.is_valid,
      dimensional_check: result.dimensional_check,
      material_availability: result.material_availability,
      cost_calculated: true,
      estimated_cost: result.estimated_cost,
      estimated_production_time: result.estimated_production_time,
      validation_errors: result.errors,
      validation_warnings: result.warnings,
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', refId);

  return result;
}

// ─── Dimensional validation ───────────────────────────────────────
function validateDimensions(ref: RefData, materials: RefMaterial[]) {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const mat of materials) {
    const product = mat.products;
    if (!product) {
      errors.push({
        type: 'material_unavailable',
        message: `Produto não encontrado (ID: ${mat.product_id})`,
        material_id: mat.id,
        severity: 'critical',
        suggested_action: 'Vincule um produto válido do estoque',
      });
      continue;
    }

    // Cut dimensions vs product dimensions (sheet fitting)
    if (mat.cut_length && mat.cut_width && product.dimensions_length && product.dimensions_width) {
      const cl = mat.cut_length;
      const cw = mat.cut_width;
      const pl = product.dimensions_length;
      const pw = product.dimensions_width;

      const fitsDirectly = cl <= pl && cw <= pw;
      const fitsRotated = cl <= pw && cw <= pl;

      if (!fitsDirectly && !fitsRotated) {
        errors.push({
          type: 'dimension_mismatch',
          message: `Dimensões de corte (${cl}×${cw}mm) excedem o material ${product.name} (${pl}×${pw}mm)`,
          material_id: mat.id,
          severity: 'critical',
          suggested_action: 'Reduzir dimensões de corte ou selecionar material maior',
        });
      } else if (!fitsDirectly && fitsRotated) {
        warnings.push({
          type: 'dimension_optimization',
          message: `${product.name}: corte requer rotação da peça para aproveitamento ótimo`,
          material_id: mat.id,
          suggested_action: 'Considere ajustar orientação do corte',
        });
      }
    }

    // Thickness check
    if (mat.cut_thickness && product.dimensions_thickness) {
      const diff = Math.abs(mat.cut_thickness - product.dimensions_thickness);
      if (diff > (ref.tolerance || 1)) {
        errors.push({
          type: 'dimension_mismatch',
          message: `Espessura requerida (${mat.cut_thickness}mm) incompatível com ${product.name} (${product.dimensions_thickness}mm). Tolerância: ±${ref.tolerance}mm`,
          material_id: mat.id,
          severity: 'high',
          suggested_action: 'Ajustar espessura ou selecionar material compatível',
        });
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

// ─── Material availability ────────────────────────────────────────
function validateMaterialAvailability(materials: RefMaterial[]) {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const mat of materials) {
    const product = mat.products;
    if (!product) continue;

    const totalRequired = mat.quantity_needed * (1 + mat.waste_factor / 100);

    if (product.quantity < totalRequired) {
      const shortage = totalRequired - product.quantity;
      errors.push({
        type: 'insufficient_stock',
        message: `${product.name}: necessário ${totalRequired.toFixed(2)} ${product.unit} (incl. ${mat.waste_factor}% desperdício), disponível ${product.quantity}`,
        material_id: mat.id,
        severity: product.quantity === 0 ? 'critical' : 'high',
        suggested_action: `Comprar ${shortage.toFixed(2)} ${product.unit} ou reduzir especificação`,
      });
    }

    // Min stock warning
    if (product.quantity - totalRequired < (product.min_stock || 0)) {
      warnings.push({
        type: 'stock_warning',
        message: `${product.name}: uso deixará estoque abaixo do mínimo (${product.min_stock} ${product.unit})`,
        material_id: mat.id,
        suggested_action: 'Considere reabastecer estoque após o uso',
      });
    }

    // High waste warning
    if (mat.waste_factor > 15) {
      warnings.push({
        type: 'high_waste',
        message: `${product.name}: fator de desperdício alto (${mat.waste_factor}%)`,
        material_id: mat.id,
        suggested_action: 'Verifique se o desperdício está dentro do esperado',
      });
    }
  }

  return { isValid: errors.filter(e => e.severity === 'critical').length === 0, errors, warnings };
}

// ─── Cost calculation ─────────────────────────────────────────────
function calculateCost(materials: RefMaterial[]): number {
  let total = 0;
  for (const mat of materials) {
    const product = mat.products;
    if (!product) continue;
    const totalQty = mat.quantity_needed * (1 + mat.waste_factor / 100);
    total += totalQty * (product.unit_price || 0);
  }
  return total;
}
