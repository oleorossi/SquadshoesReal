// Types for the enhanced packaging system

export const PACKAGING_MATERIALS = [
  { value: 'cardboard', label: 'Papelão' },
  { value: 'plastic', label: 'Plástico' },
  { value: 'wood', label: 'Madeira' },
  { value: 'metal', label: 'Metal' },
] as const;

export const PROTECTION_LEVELS = [
  { value: 'basic', label: 'Básico' },
  { value: 'reinforced', label: 'Reforçado' },
  { value: 'heavy_duty', label: 'Alta Resistência' },
] as const;

export const PADDING_MATERIALS = [
  { value: 'bubble_wrap', label: 'Plástico Bolha' },
  { value: 'foam', label: 'Espuma' },
  { value: 'paper', label: 'Papel' },
  { value: 'air_cushions', label: 'Almofadas de Ar' },
] as const;

export const FRAGILE_SIDES = [
  { value: 'top', label: 'Topo' },
  { value: 'bottom', label: 'Base' },
  { value: 'left', label: 'Esquerda' },
  { value: 'right', label: 'Direita' },
  { value: 'front', label: 'Frente' },
  { value: 'back', label: 'Trás' },
] as const;

export const LABEL_TYPES = [
  { value: 'product_info', label: 'Informações do Produto' },
  { value: 'barcode', label: 'Código de Barras' },
  { value: 'qr_code', label: 'QR Code' },
  { value: 'shipping', label: 'Envio' },
  { value: 'handling', label: 'Manuseio' },
  { value: 'custom', label: 'Personalizada' },
] as const;

export interface LabelSpec {
  id: string;
  name: string;
  type: string;
  width_mm: number;
  height_mm: number;
  side: string;
  include_product_name: boolean;
  include_sku: boolean;
  include_quantity: boolean;
  include_barcode: boolean;
  notes?: string;
}

export interface PackagingConfigForm {
  packaging_type: string;
  nome: string;
  pairs_per_box: number;
  // Internal dimensions
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  peso_kg: number;
  // External dimensions
  ext_comprimento_cm: number;
  ext_largura_cm: number;
  ext_altura_cm: number;
  // Specs
  material: string;
  protection_level: string;
  stackable: boolean;
  max_stack_height: number;
  max_weight_kg: number;
  cost_per_unit: number;
  minimum_order: number;
  // Padding
  padding_required: boolean;
  padding_material: string;
  padding_thickness_mm: number;
  // Orientation
  can_be_inverted: boolean;
  can_be_rotated: boolean;
  fragile_sides: string[];
  // Labels
  label_config: LabelSpec[];
  // Links
  product_id: string;
  supplier_id: string;
  notes: string;
}

export const emptyPackagingForm: PackagingConfigForm = {
  packaging_type: 'individual',
  nome: '',
  pairs_per_box: 1,
  comprimento_cm: 0,
  largura_cm: 0,
  altura_cm: 0,
  peso_kg: 0,
  ext_comprimento_cm: 0,
  ext_largura_cm: 0,
  ext_altura_cm: 0,
  material: 'cardboard',
  protection_level: 'basic',
  stackable: true,
  max_stack_height: 0,
  max_weight_kg: 0,
  cost_per_unit: 0,
  minimum_order: 0,
  padding_required: false,
  padding_material: 'paper',
  padding_thickness_mm: 0,
  can_be_inverted: true,
  can_be_rotated: true,
  fragile_sides: [],
  label_config: [],
  product_id: '',
  supplier_id: '',
  notes: '',
};

export function configToForm(cfg: any): PackagingConfigForm {
  return {
    packaging_type: cfg.packaging_type || 'individual',
    nome: cfg.nome || '',
    pairs_per_box: cfg.pairs_per_box || 1,
    comprimento_cm: Number(cfg.comprimento_cm) || 0,
    largura_cm: Number(cfg.largura_cm) || 0,
    altura_cm: Number(cfg.altura_cm) || 0,
    peso_kg: Number(cfg.peso_kg) || 0,
    ext_comprimento_cm: Number(cfg.ext_comprimento_cm) || 0,
    ext_largura_cm: Number(cfg.ext_largura_cm) || 0,
    ext_altura_cm: Number(cfg.ext_altura_cm) || 0,
    material: cfg.material || 'cardboard',
    protection_level: cfg.protection_level || 'basic',
    stackable: cfg.stackable ?? true,
    max_stack_height: Number(cfg.max_stack_height) || 0,
    max_weight_kg: Number(cfg.max_weight_kg) || 0,
    cost_per_unit: Number(cfg.cost_per_unit) || 0,
    minimum_order: Number(cfg.minimum_order) || 0,
    padding_required: cfg.padding_required ?? false,
    padding_material: cfg.padding_material || 'paper',
    padding_thickness_mm: Number(cfg.padding_thickness_mm) || 0,
    can_be_inverted: cfg.can_be_inverted ?? true,
    can_be_rotated: cfg.can_be_rotated ?? true,
    fragile_sides: cfg.fragile_sides || [],
    label_config: cfg.label_config || [],
    product_id: cfg.product_id || '',
    supplier_id: cfg.supplier_id || '',
    notes: cfg.notes || '',
  };
}

export interface IndividualPackaging {
  id: string;
  product_name: string;
  product_reference: string;
  internal_code: string;
  packaging_type: string;
  material: string;
  dimensions: {
    length: number;
    width: number;
    height: number;
    volume: number;
    weight: number;
  };
  unit_cost: number;
  current_stock: number;
  minimum_stock: number;
  supplier_name: string | null;
  notes: string | null;
  is_active: boolean;
}

export function formToSaveData(form: PackagingConfigForm) {
  return {
    packaging_type: form.packaging_type,
    nome: form.nome,
    pairs_per_box: form.pairs_per_box,
    comprimento_cm: form.comprimento_cm,
    largura_cm: form.largura_cm,
    altura_cm: form.altura_cm,
    peso_kg: form.peso_kg,
    ext_comprimento_cm: form.ext_comprimento_cm,
    ext_largura_cm: form.ext_largura_cm,
    ext_altura_cm: form.ext_altura_cm,
    material: form.material,
    protection_level: form.protection_level,
    stackable: form.stackable,
    max_stack_height: form.max_stack_height,
    max_weight_kg: form.max_weight_kg,
    cost_per_unit: form.cost_per_unit,
    minimum_order: form.minimum_order,
    padding_required: form.padding_required,
    padding_material: form.padding_material,
    padding_thickness_mm: form.padding_thickness_mm,
    can_be_inverted: form.can_be_inverted,
    can_be_rotated: form.can_be_rotated,
    fragile_sides: form.fragile_sides,
    label_config: form.label_config,
    product_id: form.product_id || null,
    supplier_id: form.supplier_id || null,
    notes: form.notes || null,
  };
}

export interface PackagingResult {
  method: 'amarrado' | 'master' | 'colmeia';
  individualBoxId: string;
  masterBoxId?: string;
  quantityMaster: number;
  remainingIndividual: number;
}
