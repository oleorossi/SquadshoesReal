import { supabase } from '@/integrations/supabase/client';
import { sanitizeUuidFields } from '@/lib/utils';
import { stripSearchNorm } from '@/lib/searchUtils';
import { createProductWithStock, type CreateProductWithStockInput } from '@/lib/stockCommand';
import { allocateUniqueSku, copySkuCandidates } from '@/lib/productSku';

export interface DuplicateGroupFlags {
  is_artisanal_strap?: boolean | null;
  is_color_agnostic?: boolean | null;
  shared_specs?: boolean | null;
  is_bom_color_source?: boolean | null;
  name?: string | null;
}

export interface DuplicateProductResult {
  productId: string;
  sku: string;
  color: string;
  colorSuffixed: boolean;
  copiedComponentSheet: boolean;
}

const OMIT_ON_COPY = new Set([
  'id',
  'created_at',
  'updated_at',
  'search_norm',
  'quantity',
  'current_stock',
  'reserved_stock',
  'stock_grade',
  'blocked_qty',
  'quarantine_qty',
  'gestaoclick_id',
  'strap_migration_cutover_id',
  'strap_migration_reason',
  'strap_migration_status',
  'sku',
  'color',
  'name',
  'product_groups',
  'lot_number',
  'expiration_date',
]);

/** Linha com variantes: o gatilho recusa duas cores ativas iguais no grupo. */
export function variantLineEnforcesUniqueColor(group: DuplicateGroupFlags | null | undefined): boolean {
  if (!group) return false;
  if (group.is_color_agnostic) return false;
  return Boolean(group.shared_specs || group.is_bom_color_source);
}

/**
 * Cor da cópia. Em linha com variantes sufixa ` CÓPIA` / ` CÓPIA2` pra passar
 * em `tg_guard_unique_active_group_color`. Fora da trava, mantém a cor.
 */
export function copiedColor(
  color: string | null | undefined,
  enforceUnique: boolean,
): { color: string; colorSuffixed: boolean } {
  const c = (color || '').trim();
  if (!enforceUnique || !c) return { color: c, colorSuffixed: false };
  const match = c.match(/^(.*?)\s+CÓPIA(\d*)$/i);
  if (match) {
    const next = match[2] ? Number(match[2]) + 1 : 2;
    return { color: `${match[1]} CÓPIA${next}`, colorSuffixed: true };
  }
  return { color: `${c} CÓPIA`, colorSuffixed: true };
}

/** Se o nome termina com a cor (ou `NOME: COR`), acompanha o sufixo da cópia. */
export function copiedName(name: string, originalColor: string, newColor: string): string {
  const original = (name || '').trim();
  const from = (originalColor || '').trim();
  const to = (newColor || '').trim();
  if (!original || !from || from === to) return original;
  if (original.toUpperCase().endsWith(from.toUpperCase())) {
    return original.slice(0, original.length - from.length) + to;
  }
  const needle = `: ${from}`;
  const idx = original.toUpperCase().lastIndexOf(needle.toUpperCase());
  if (idx >= 0) {
    return `${original.slice(0, idx)}: ${to}`;
  }
  return original;
}

export function artisanalBlockReason(
  product: { is_artisanal?: boolean | null; name?: string | null },
  group: DuplicateGroupFlags | null | undefined,
): string | null {
  if (product.is_artisanal === true || group?.is_artisanal_strap === true) {
    return 'Tira artesanal só pode ser criada pelo Hub de Tiras.';
  }
  return null;
}

export function buildDuplicateCatalog(
  source: Record<string, unknown>,
  opts: { sku: string; color: string; name: string },
): Record<string, unknown> {
  const catalog: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (OMIT_ON_COPY.has(key)) continue;
    catalog[key] = value;
  }
  return {
    ...catalog,
    name: opts.name,
    sku: opts.sku,
    color: opts.color,
    quantity: 0,
    reserved_stock: 0,
    current_stock: 0,
    blocked_qty: 0,
    quarantine_qty: 0,
    stock_grade: {},
    active: true,
  };
}

async function copyComponentSheet(sourceProductId: string, targetProductId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('component_sheets')
    .select('dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id, notes, group_id')
    .eq('product_id', sourceProductId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler ficha de componente: ${error.message}`);
  if (!data) return false;
  const { error: upsertError } = await supabase
    .from('component_sheets')
    .upsert({
      product_id: targetProductId,
      dimensions_length: data.dimensions_length,
      dimensions_width: data.dimensions_width,
      dimensions_thickness: data.dimensions_thickness,
      dimensions_unit: data.dimensions_unit,
      yield_per_size: data.yield_per_size,
      yield_per_sole: data.yield_per_sole,
      default_sole_group_id: data.default_sole_group_id,
      notes: data.notes,
      group_id: data.group_id,
    } as never, { onConflict: 'product_id' });
  if (upsertError) throw new Error(`Falha ao copiar ficha de componente: ${upsertError.message}`);
  return true;
}

export async function duplicateProduct(sourceId: string): Promise<DuplicateProductResult> {
  const { data: source, error: sourceError } = await supabase
    .from('products')
    .select('*')
    .eq('id', sourceId)
    .single();
  if (sourceError || !source) {
    throw new Error(sourceError?.message || 'Material não encontrado.');
  }

  let group: DuplicateGroupFlags | null = null;
  if (source.group_id) {
    const { data: groupRow, error: groupError } = await supabase
      .from('product_groups')
      .select('is_artisanal_strap, is_color_agnostic, shared_specs, is_bom_color_source, name')
      .eq('id', source.group_id)
      .maybeSingle();
    if (groupError) throw new Error(`Falha ao ler o grupo: ${groupError.message}`);
    group = groupRow as DuplicateGroupFlags | null;
  }

  const blocked = artisanalBlockReason(source, group);
  if (blocked) throw new Error(blocked);

  const enforceColor = variantLineEnforcesUniqueColor(group);
  const { color, colorSuffixed } = copiedColor(source.color, enforceColor);
  const name = copiedName(source.name, source.color || '', color);
  const sku = await allocateUniqueSku(copySkuCandidates(source.sku));

  const catalog = stripSearchNorm(sanitizeUuidFields(
    buildDuplicateCatalog(source as Record<string, unknown>, { sku, color, name }),
  ));
  const product: CreateProductWithStockInput = {
    ...catalog,
    name,
    sku,
    category: String(source.category || ''),
    unit: String(source.unit || 'un'),
    quantity: 0,
    reason: `Cópia de ${source.sku}`,
  };

  const created = await createProductWithStock(product);
  if (!created.success || !created.product_id) {
    throw new Error(created.errors?.[0]?.error || 'Falha ao duplicar o material.');
  }

  const copiedComponentSheet = await copyComponentSheet(sourceId, created.product_id);
  return {
    productId: created.product_id,
    sku,
    color,
    colorSuffixed,
    copiedComponentSheet,
  };
}

export async function duplicateProducts(ids: string[]): Promise<DuplicateProductResult[]> {
  const results: DuplicateProductResult[] = [];
  for (const id of ids) {
    results.push(await duplicateProduct(id));
  }
  return results;
}
