import { supabase } from '@/integrations/supabase/client';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';
import { stripColorFromName } from '@/lib/utils';

export interface QuickGroupVariantInput {
  groupId: string;
  templateProductId: string;
  color: string;
  quantity: number;
  unitPrice: number;
  requestId?: string;
}

export interface QuickGroupVariantResult {
  success: boolean;
  replayed: boolean;
  product_id: string;
  template_product_id: string;
  color: string;
  sku: string;
  component_sheet_source: 'template' | 'group' | 'none';
}

export interface RecommendedVariantTemplate {
  product: Product | null;
  matchingCount: number;
  totalCount: number;
  hasTie: boolean;
}

export interface QuickVariantSheetPattern {
  product_id: string;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_thickness: number | null;
  dimensions_unit: string | null;
  yield_per_size: Record<string, unknown> | null;
  yield_per_sole: Record<string, unknown> | null;
  default_sole_group_id: string | null;
  notes: string | null;
}

export const normalizeQuickVariantColor = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

export const formatQuickVariantColor = (value: string) => value.trim().toUpperCase();

export function quickVariantMaterialIdentity(product: Product): string {
  const withoutCurrentColor = stripColorFromName(product.name || '', product.color).trim();
  return normalizeQuickVariantColor(
    withoutCurrentColor.replace(/\s+-\s+.*$/, '').trim() || withoutCurrentColor,
  );
}

/**
 * Campos que definem se dois itens oferecem o mesmo padrão operacional para o
 * atalho. A geometria não entra: `product_groups.dimensions_*` é a fonte e
 * prevalece sobre o item escolhido.
 */
export function quickVariantTemplateSignature(
  product: Product,
  sheet: QuickVariantSheetPattern | null = null,
): string {
  return JSON.stringify([
    product.category || '',
    product.unit || '',
    product.location || '',
    Number(product.min_stock) || 0,
    Number(product.max_stock) || 0,
    Number(product.safety_stock) || 0,
    Number(product.yield_per_meter) || 0,
    product.yield_unit || '',
    product.technical_name || '',
    Number(product.dimensions_length) || 0,
    Number(product.dimensions_width) || 0,
    Number(product.dimensions_height) || 0,
    Number(product.dimensions_thickness) || 0,
    product.dimensions_unit || '',
    Number(product.pairs_per_package) || 1,
    product.purchase_unit || product.unit || '',
    product.production_unit || product.unit || '',
    product.purchase_order_unit || product.purchase_unit || product.unit || '',
    Number(product.conversion_rate) || 1,
    Number(product.min_order_quantity) || 0,
    Number(product.lead_time_days) || 0,
    product.calculation_method || '',
    product.supplier_id || '',
    product.is_chemical === true,
    Number(product.supplier_lead_time_days) || 0,
    product.requires_sewing === true,
    product.consumption_unit || '',
    product.preferred_supplier_id || '',
    product.brand || '',
    product.ncm || '',
    product.default_bin_location_id || '',
    Number(product.purchase_multiple) || 0,
    Number(product.material_preparation_days) || 0,
    Number(product.unit_price) || 0,
    sheet ? {
      dimensions_length: Number(sheet.dimensions_length) || 0,
      dimensions_width: Number(sheet.dimensions_width) || 0,
      dimensions_thickness: Number(sheet.dimensions_thickness) || 0,
      dimensions_unit: sheet.dimensions_unit || '',
      yield_per_size: sheet.yield_per_size || {},
      yield_per_sole: sheet.yield_per_sole || {},
      default_sole_group_id: sheet.default_sole_group_id || '',
      notes: sheet.notes || '',
    } : null,
  ]);
}

/**
 * Sugere o padrão mais frequente sem escolher `variants[0]` ou o item mais
 * novo. Em empate não inventa um vencedor: a UI exige seleção explícita.
 */
export function recommendVariantTemplate(
  products: Product[],
  sheetsByProduct: Map<string, QuickVariantSheetPattern | null> = new Map(),
): RecommendedVariantTemplate {
  const active = products.filter(product => product.active !== false);
  if (active.length === 0) {
    return { product: null, matchingCount: 0, totalCount: 0, hasTie: false };
  }

  const groups = new Map<string, Product[]>();
  for (const product of active) {
    const signature = quickVariantTemplateSignature(product, sheetsByProduct.get(product.id) || null);
    groups.set(signature, [...(groups.get(signature) || []), product]);
  }
  const ranked = [...groups.values()].sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    const leftName = left.map(item => item.name || '').sort((a, b) => a.localeCompare(b, 'pt-BR'))[0] || '';
    const rightName = right.map(item => item.name || '').sort((a, b) => a.localeCompare(b, 'pt-BR'))[0] || '';
    return leftName.localeCompare(rightName, 'pt-BR');
  });
  const hasTie = ranked.length > 1 && ranked[0].length === ranked[1].length;
  const candidates = ranked[0].slice().sort((left, right) => {
    const leftCreated = String(left.created_at || '');
    const rightCreated = String(right.created_at || '');
    return leftCreated.localeCompare(rightCreated)
      || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR');
  });

  return {
    product: hasTie ? null : candidates[0] || null,
    matchingCount: ranked[0]?.length || 0,
    totalCount: active.length,
    hasTie,
  };
}

export function quickVariantEligibility(group: ProductGroup, products: Product[]): string | null {
  if (group.is_family) return 'Famílias técnicas não recebem itens diretamente.';
  const active = products.filter(product => product.active !== false);
  if (
    group.is_artisanal_strap
    || active.some(product => product.is_artisanal === true)
    || /TIRA|ELASTIC|TRANC/.test(normalizeQuickVariantColor(group.name || ''))
  ) return 'Variações de tira devem ser criadas no Hub de Tiras.';
  if (group.is_color_agnostic) return 'Este grupo não usa cor como identidade do item.';
  if (!group.shared_specs && !group.is_bom_color_source) {
    return 'Configure o grupo como linha com variantes antes de usar este atalho.';
  }
  if (String(group.sector || '').trim().toUpperCase() === 'SOLADO') {
    return 'Solado exige estoque por numeração; use o editor de solados.';
  }
  if (new Set(active.map(quickVariantMaterialIdentity).filter(Boolean)).size > 1) {
    return 'Este grupo mistura materiais diferentes; use o cadastro completo.';
  }
  if (active.length === 0) {
    return 'Cadastre o primeiro item pelo formulário completo para definir o padrão.';
  }
  return null;
}

export function canUseQuickGroupVariantForRoles(roles: string[]): boolean {
  return roles.some(role => ['admin', 'gerente', 'almoxarifado'].includes(role));
}

function friendlyQuickVariantError(error: { code?: string; message?: string }): Error {
  const message = error.message || 'Não foi possível criar a variação.';
  if (message.includes('COLOR_ALREADY_EXISTS') || error.code === '23505') {
    return new Error('Esta cor já possui um item neste grupo.');
  }
  if (message.includes('UNIT_PRICE_MISMATCH')) {
    return new Error('O valor unitário precisa ser exatamente igual ao item-modelo escolhido.');
  }
  if (message.includes('FRACTIONAL_DISCRETE_UNIT')) {
    return new Error('Esta unidade aceita somente quantidade inteira.');
  }
  if (error.code === '42501' || message.toLowerCase().includes('permission denied')) {
    return new Error('Seu perfil não tem permissão para criar produto e saldo inicial.');
  }
  if (message.includes('SKU_ALREADY_EXISTS')) {
    return new Error('O SKU foi usado por outra operação. Tente novamente para gerar outro código.');
  }
  return new Error(message);
}

export async function createQuickGroupVariant(
  input: QuickGroupVariantInput,
): Promise<QuickGroupVariantResult> {
  const requestId = input.requestId || globalThis.crypto?.randomUUID?.();
  if (!requestId) throw new Error('O navegador não oferece UUID seguro para esta operação.');

  // A RPC foi adicionada depois da última geração de types.ts. O cast fica
  // restrito a esta borda até a próxima geração automática.
  const { data, error } = await supabase.rpc('create_group_color_variant' as never, {
    p_group_id: input.groupId,
    p_template_product_id: input.templateProductId,
    p_color: input.color,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_request_id: requestId,
  } as never);
  if (error) throw friendlyQuickVariantError(error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('O servidor retornou uma resposta inválida ao criar a variação.');
  }

  const result = data as unknown as QuickGroupVariantResult;
  if (!result.success || !result.product_id) {
    throw new Error('A variação não foi criada. Nenhuma alteração foi mantida.');
  }
  return result;
}
