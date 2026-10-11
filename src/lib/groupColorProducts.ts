import { supabase } from '@/integrations/supabase/client';
import { sanitizeUuidFields } from '@/lib/utils';
import { sectorOfGroup } from '@/lib/categoryFromGroup';
import { allocateUniqueSku } from '@/lib/productSku';

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

const colorKey = (value: string) => (value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

async function uniqueSku(preferred: string, groupName: string, color: string): Promise<string> {
  const base = `${skuToken(groupName, 'TIRA', 6)}-${skuToken(color, 'COR', 4)}`;
  return allocateUniqueSku([
    preferred.trim(),
    base,
    ...Array.from({ length: 6 }, (_, i) => `${base}-${i + 1}`),
  ]);
}

export interface GroupColorSpec {
  groupId: string;
  groupName: string;
  color: string;
  /** Unidade-base física informada explicitamente ao criar o primeiro SKU.
   *  `product_groups.consumption_unit` não serve para isso: um grupo pode
   *  consumir em dm² e manter o estoque em m ou placa. */
  stockUnit?: string;
}

export type CreateColorResult = {
  color: string;
  groupName: string;
  status: 'created' | 'skipped' | 'error';
  error?: string;
  /** O grupo estava vazio em "Coleção de itens" e virou "Linha com variantes"
   *  para receber esta cor. A janela do grupo precisa espelhar isso no estado
   *  local — senão o próximo "Salvar" da aba Geral desfaz a conversão. */
  convertedToVariantLine?: boolean;
};

/** Método de cálculo coerente com a unidade-base escolhida para a 1ª cor. */
export function calculationMethodForUnit(unit: string): 'meter' | 'weight' | 'unit' {
  if (unit === 'm' || unit === 'cm') return 'meter';
  if (unit === 'kg') return 'weight';
  return 'unit';
}

/**
 * Cria (ou reusa) UM produto do grupo numa cor. Idempotente: se já existe produto
 * ativo nessa cor no grupo, marca `skipped`. Herda unidade/preço/local/dims/yield
 * do último produto do grupo (mantém a família consistente).
 *
 * Primeira cor (spec `grupo-cor-obrigatoria.md`, D6): sem item-modelo, a unidade
 * vem de `stockUnit`. Grupo em "Coleção de itens" SEM nenhum produto vira
 * "Linha com variantes" — não existe item que possa divergir, então não há
 * heterogeneidade a proteger. Grupo com produto continua recusando.
 */
export async function createGroupColorProduct(spec: GroupColorSpec): Promise<CreateColorResult> {
  const color = (spec.color || '').trim();
  const res: CreateColorResult = { color, groupName: spec.groupName, status: 'skipped' };
  if (!color || !spec.groupId) return res;

  const { data: group } = await (supabase as any).from('product_groups')
    .select('is_artisanal_strap, is_family, shared_specs, is_bom_color_source, is_color_agnostic, sector, consumption_unit, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit')
    .eq('id', spec.groupId)
    .maybeSingle();
  const strapLikeName = /tira|elastic|tranç/i.test(spec.groupName || '');
  if (strapLikeName || group?.is_artisanal_strap === true) {
    return {
      ...res,
      status: 'error',
      error: 'Família de tira artesanal só pode ser criada pelo Hub de Tiras.',
    };
  }
  if (group?.is_family === true) {
    return { ...res, status: 'error', error: 'Família técnica não recebe variantes diretamente.' };
  }
  const refuseNonVariantLine: CreateColorResult = {
    ...res,
    status: 'error',
    error: 'Converta o grupo explicitamente para “Linha com variantes” antes de criar cores.',
  };
  if (group?.is_color_agnostic === true) return refuseNonVariantLine;

  const explicitStockUnit = String(spec.stockUnit || '').trim();
  const isVariantLine = Boolean(group?.shared_specs || group?.is_bom_color_source);
  let convertedToVariantLine = false;
  if (!isVariantLine) {
    // Ativo OU inativo: um item inativo ainda é identidade do grupo e vira
    // item-modelo abaixo — converter por cima dele seria decidir no lugar do dono.
    const { data: anyProduct } = await supabase.from('products')
      .select('id').eq('group_id', spec.groupId).limit(1);
    if ((anyProduct || []).length > 0) return refuseNonVariantLine;
    if (!explicitStockUnit) {
      return {
        ...res,
        status: 'error',
        error: 'Informe a unidade de estoque da primeira cor ou cadastre o primeiro item pelo formulário completo.',
      };
    }
    // `chk_shared_group_has_consumption_unit`: linha compartilhada exige
    // unidade técnica. O guard `shared_specs = false` evita sobrescrever uma
    // conversão concorrente.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: convertError } = await (supabase as any).from('product_groups')
      .update({ shared_specs: true, consumption_unit: group?.consumption_unit || explicitStockUnit })
      .eq('id', spec.groupId)
      .eq('shared_specs', false);
    if (convertError) return { ...res, status: 'error', error: convertError.message };
    convertedToVariantLine = true;
  }

  const { data: existing } = await supabase.from('products')
    .select('id, color, is_artisanal').eq('group_id', spec.groupId).eq('active', true);
  if ((existing || []).some((product: any) => product.is_artisanal === true)) {
    return {
      ...res,
      status: 'error',
      error: 'Grupo legado de tira detectado; resolva a identidade no Hub de Tiras.',
    };
  }
  if ((existing || []).some((p: any) => colorKey(p.color || '') === colorKey(color))) {
    return res; // já cadastrada nessa cor
  }

  let { data: last } = await supabase.from('products')
    .select('*').eq('group_id', spec.groupId).eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!last) {
    const { data: inactiveModel } = await supabase.from('products')
      .select('*').eq('group_id', spec.groupId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    last = inactiveModel;
  }
  // A trava antiga ("O grupo ainda não tem item-modelo") ficava ANTES desta e
  // tornava a rota da 1ª cor código morto: nenhum grupo novo ganhava cor pela
  // aba Cores. Sem modelo, a unidade explícita é o que basta.
  if (!last && !explicitStockUnit) {
    return {
      ...res,
      status: 'error',
      error: 'Informe a unidade de estoque da primeira cor ou cadastre o primeiro item pelo formulário completo.',
    };
  }

  const baseSku = (last?.sku || '').trim();
  const preferredSku = baseSku
    ? `${baseSku.replace(/-[A-Z0-9]+$/i, '')}-${skuToken(color, 'COR', 4)}`
    : `${skuToken(spec.groupName, 'TIRA', 6)}-${skuToken(color, 'COR', 4)}`;
  const finalSku = await uniqueSku(preferredSku, spec.groupName, color);
  // A primeira cor de um grupo-folha ainda não tem produto-modelo. Dimensões e
  // setor vêm do grupo, mas a unidade-base precisa ser uma escolha explícita:
  // nunca inferimos estoque a partir da unidade técnica de consumo.
  const defaultUnit = String(last?.unit || explicitStockUnit).trim();
  const purchaseUnit = last?.purchase_unit || defaultUnit;
  const productionUnit = last?.production_unit || defaultUnit;
  const purchaseOrderUnit = last?.purchase_order_unit || defaultUnit;
  const consumptionUnit = last?.consumption_unit || defaultUnit;
  const conversionRate = purchaseUnit === defaultUnit
    ? 1
    : Number(last?.conversion_rate) > 0 ? Number(last?.conversion_rate) : 1;

  const productData = sanitizeUuidFields({
    name: `${spec.groupName}: ${color}`,
    sku: finalSku,
    category: sectorOfGroup(group) || (last?.category || '').trim() || sectorOfGroup({ name: spec.groupName } as any),
    color,
    unit: defaultUnit,
    consumption_unit: consumptionUnit,
    unit_price: last?.unit_price || 0,
    technical_name: last?.technical_name || '',
    supplier_id: last?.supplier_id || null,
    supplier_lead_time_days: last?.supplier_lead_time_days || 0,
    location: last?.location || '', // products.location é NOT NULL — nunca null (igual ao dialog)
    max_stock: last?.max_stock || 0,
    safety_stock: last?.safety_stock || 0,
    purchase_unit: purchaseUnit,
    production_unit: productionUnit,
    conversion_rate: conversionRate,
    purchase_order_unit: purchaseOrderUnit,
    min_order_quantity: last?.min_order_quantity || 0,
    lead_time_days: last?.lead_time_days || 0,
    calculation_method: last?.calculation_method || calculationMethodForUnit(defaultUnit),
    price_wholesale: last?.price_wholesale || 0,
    price_retail: last?.price_retail || 0,
    group_id: spec.groupId,
    active: true,
    image_url: '',
    yield_per_meter: last?.yield_per_meter ?? null,
    yield_unit: last?.yield_unit ?? null,
    dimensions_length: group?.dimensions_length ?? last?.dimensions_length ?? null,
    dimensions_width: group?.dimensions_width ?? last?.dimensions_width ?? null,
    dimensions_thickness: group?.dimensions_thickness ?? last?.dimensions_thickness ?? null,
    dimensions_unit: group?.dimensions_unit ?? last?.dimensions_unit ?? null,
  });

  let { error } = await supabase.from('products').insert(productData as any);
  if (error && (error as any).code === '23505') {
    ({ error } = await supabase.from('products').insert({ ...productData, sku: await uniqueSku('', spec.groupName, color) } as any));
  }
  if (error) return { ...res, status: 'error', error: error.message, convertedToVariantLine };
  return { ...res, status: 'created', convertedToVariantLine };
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
    const key = `${s.groupId}::${colorKey(color)}`;
    if (!color || !s.groupId || seen.has(key)) continue;
    seen.add(key);
    // sequencial de propósito: cada criação lê o "último produto do grupo" e
    // resolve SKU único; rodar em paralelo poderia colidir SKU/duplicar cor.
    out.push(await createGroupColorProduct(s));
  }
  return out;
}
