import { supabase } from '@/integrations/supabase/client';
import { sanitizeUuidFields } from '@/lib/utils';
import { sectorOfGroup } from '@/lib/categoryFromGroup';

/**
 * Criação de produtos "material × cor" — 1 grupo, N produtos, um por cor
 * (`products.color` = fonte única de cor). Espelha o insert do
 * `CreateStrapProductDialog` (mesmo productData), mas sem UI, pra permitir
 * cadastro EM LOTE (várias cores de uma vez) a partir do PV ou da tela de Grupos.
 */

const skuToken = (v: string, fb: string, max: number) => {
  const clean = (v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '');
  return (clean || fb).slice(0, max) || fb;
};

async function uniqueSku(preferred: string, groupName: string, color: string): Promise<string> {
  const base = `${skuToken(groupName, 'TIRA', 6)}-${skuToken(color, 'COR', 4)}`;
  const candidates = [preferred.trim(), base, ...Array.from({ length: 6 }, (_, i) => `${base}-${i + 1}`)];
  for (const cand of candidates) {
    if (!cand) continue;
    const { data } = await supabase.from('products').select('id').eq('sku', cand).limit(1).maybeSingle();
    if (!data) return cand;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export interface GroupColorSpec {
  groupId: string;
  groupName: string;
  color: string;
}

export type CreateColorResult = {
  color: string;
  groupName: string;
  status: 'created' | 'skipped' | 'error';
  error?: string;
};

/**
 * Cria (ou reusa) UM produto do grupo numa cor. Idempotente: se já existe produto
 * ativo nessa cor no grupo, marca `skipped`. Herda unidade/preço/local/dims/yield
 * do último produto do grupo (mantém a família consistente).
 */
export async function createGroupColorProduct(spec: GroupColorSpec): Promise<CreateColorResult> {
  const color = (spec.color || '').trim();
  const res: CreateColorResult = { color, groupName: spec.groupName, status: 'skipped' };
  if (!color || !spec.groupId) return res;

  const { data: existing } = await supabase.from('products')
    .select('id, color').eq('group_id', spec.groupId).eq('active', true);
  if ((existing || []).some((p: any) => (p.color || '').trim().toLowerCase() === color.toLowerCase())) {
    return res; // já cadastrada nessa cor
  }

  const { data: last } = await supabase.from('products')
    .select('*').eq('group_id', spec.groupId).eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const isStrapLike = /tira|elastic|tranç/i.test(spec.groupName || '');
  const baseSku = (last?.sku || '').trim();
  const preferredSku = baseSku
    ? `${baseSku.replace(/-[A-Z0-9]+$/i, '')}-${skuToken(color, 'COR', 4)}`
    : `${skuToken(spec.groupName, 'TIRA', 6)}-${skuToken(color, 'COR', 4)}`;
  const finalSku = await uniqueSku(preferredSku, spec.groupName, color);

  const productData = sanitizeUuidFields({
    name: `${spec.groupName}: ${color}`,
    sku: finalSku,
    category: (last?.category || '').trim() || sectorOfGroup({ name: spec.groupName } as any),
    color,
    unit: isStrapLike ? 'm' : (last?.unit || 'un'),
    unit_price: last?.unit_price || 0,
    location: last?.location || '', // products.location é NOT NULL — nunca null (igual ao dialog)
    min_stock: last?.min_stock || 0,
    max_stock: last?.max_stock || 0,
    quantity: 0,
    group_id: spec.groupId,
    active: true,
    image_url: '',
    yield_per_meter: last?.yield_per_meter ?? null,
    yield_unit: last?.yield_unit ?? null,
    dimensions_length: last?.dimensions_length ?? null,
    dimensions_width: last?.dimensions_width ?? null,
    dimensions_thickness: last?.dimensions_thickness ?? null,
    dimensions_unit: last?.dimensions_unit ?? null,
  });

  let { error } = await supabase.from('products').insert(productData as any);
  if (error && (error as any).code === '23505') {
    ({ error } = await supabase.from('products').insert({ ...productData, sku: await uniqueSku('', spec.groupName, color) } as any));
  }
  if (error) return { ...res, status: 'error', error: error.message };
  return { ...res, status: 'created' };
}

/**
 * Lote: cria N cores de uma vez. Deduplica (grupo+cor) dentro do próprio lote e
 * ignora entradas sem cor/grupo. Retorna um resultado por cor pra a UI resumir.
 */
export async function createGroupColorProducts(specs: GroupColorSpec[]): Promise<CreateColorResult[]> {
  const seen = new Set<string>();
  const out: CreateColorResult[] = [];
  for (const s of specs) {
    const color = (s.color || '').trim();
    const key = `${s.groupId}::${color.toLowerCase()}`;
    if (!color || !s.groupId || seen.has(key)) continue;
    seen.add(key);
    // sequencial de propósito: cada criação lê o "último produto do grupo" e
    // resolve SKU único; rodar em paralelo poderia colidir SKU/duplicar cor.
    out.push(await createGroupColorProduct(s));
  }
  return out;
}
