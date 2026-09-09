import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateBomForOrders } from '@/lib/bomConsumption';
import { computeConsumptionForItems, type ConsumptionContext, type ConsumptionItem } from '@/lib/orderConsumption';
import { annotateConsumptionAvailability } from '@/lib/consumptionRows';

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const promise = Promise.resolve({ data: db.tables[table] || [], error: null });
      const query = {
        select: () => query, in: () => query, eq: () => query,
        gt: () => query, or: () => query, not: () => query,
        order: () => query, limit: () => query, then: promise.then.bind(promise),
      };
      return query;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

const colors = ['CHAMPAGNE', 'COBRE', 'OURO LIGHT', 'PRATA'];
const groups = [
  { id: 'base', name: 'NAPA SOFT + MASSABOX', dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm', composite_layers: [{ composite_group_id: 'base' }] },
  { id: 'napa', name: 'NAPA SOFT', dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm' },
  { id: 'upper-glow', name: 'GLOW METALIC + MASSABOX', dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm', composite_layers: [{ composite_group_id: 'upper-glow' }] },
  { id: 'glow', name: 'GLOW METALIC', dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm' },
];
const products = groups.flatMap(group => (group.id.includes('glow') ? colors : ['PRETO']).map(color => ({
  id: `${group.id}-${color}`, name: `${group.name} - ${color}`, group_id: group.id, color, unit: 'm',
  quantity: group.id === 'upper-glow' ? 0 : 1000, reserved_stock: 0, stock_grade: null,
  sole_classification: null, active: true, category: 'Cabedal',
})));
const componentSheets = products.map(product => ({
  product_id: product.id, dimensions_width: 1370, dimensions_length: 1000,
  dimensions_unit: 'mm', yield_per_size: null, yield_per_sole: null, products: product,
}));
const variant = {
  id: 'variant-glow', reference_id: 'i701', active: true, main_material_group_id: 'glow',
  upper_material_group_id: 'upper-glow', upper_material_product_id: null, upper_consumption_override: null,
  lining_material_group_id: 'glow', lining_material_product_id: null, lining_consumption_override: null,
  insole_material_group_id: null, insole_material_product_id: null, insole_consumption_override: null,
  sole_material_product_id: null, sole_consumption_override: null,
};

// Recorte de cabedal/forração da I701 real, auditado em 05/09/2026.
// Solado/palmilha ficam fora deste recorte: a hipótese sob teste é a troca de
// identidade dos dois materiais do CABEDAL (2,74 + 2,28 dm² por par).
const sheet = {
  id: 'i701', upper_material: 'NAPA SOFT + MASSABOX', upper_material_group_id: 'base',
  upper_material_product_id: null, upper_consumption: 2.74,
  upper_consumption_per_size: { '28': 2.74 },
  components_accessories: [{
    label: 'NAPA SOFT + MASSABOX', material: 'NAPA SOFT + MASSABOX', mandatory: true,
    product_id: null, consumption: 2.28, material_unit: 'mm', consumption_per_size: { '28': 2.28 },
  }],
  lining_material: 'NAPA SOFT', lining_material_product_id: null,
  lining_consumption: 4.56, lining_accessories: [], variant_drives_upper: false, variant_drives_lining: true,
  insole_material: '', insole_consumption: 0, insole_has_lining: false,
  sole_material: '', sole_consumption: 0, sole_drives_consumption: false,
};

function context(): ConsumptionContext {
  return {
    materials: [], allProducts: products, productGroups: groups, componentSheets,
    materialVariantsById: new Map([[variant.id, variant]]),
    soleColorMap: new Map(), palmilhaColorMap: new Map(), palmilhaDefaultMap: new Map(),
    liningColorMap: new Map(), liningDefaultMap: new Map(), sheetStrapsMap: new Map(),
    sheetSoleGroupMap: new Map(), soleConjugationsByGroup: new Map(), facheteSpecBySole: new Map(),
  };
}

function item(color: string, useVariant = true): ConsumptionItem {
  return { reference_id: 'i701', technical_sheets: sheet, color, quantity: 137,
    grade: { '28': 137 }, material_variant_id: useVariant ? variant.id : null };
}

async function upperRowsFromBothEngines(
  testSheet: Record<string, unknown>,
  testVariant = variant,
  options: {
    color?: string;
    products?: typeof products;
    groups?: Array<(typeof groups)[number] & { is_color_agnostic?: boolean }>;
  } = {},
) {
  const ctx = context();
  const color = options.color ?? 'CHAMPAGNE';
  ctx.allProducts = options.products || products;
  ctx.productGroups = options.groups || groups;
  ctx.materialVariantsById = new Map([[testVariant.id, testVariant]]);
  const oracle = computeConsumptionForItems([{ ...item(color), technical_sheets: testSheet }], ctx);
  db.tables = {
    orders: [{ id: 'op', reference_id: 'i701', color, quantity: 137,
      grade: { '28': 137 }, sale_order_item_id: 'si', sale_order_id: 'pv' }],
    technical_sheets: [testSheet], sale_order_items: [{ id: 'si', material_variant_id: testVariant.id }],
    products: ctx.allProducts, product_groups: ctx.productGroups, component_sheets: componentSheets,
    reference_material_variants: [testVariant],
  };
  return [oracle, await calculateBomForOrders(['op'])]
    .map(rows => rows.filter(row => row.componentType === 'Cabedal'));
}

beforeEach(() => { db.tables = {}; });

describe('I701 · integração do material dublado nos motores', () => {
  it('a versão tradicional soma as duas parcelas do mesmo cabedal sem duplicar forração', () => {
    const rows = computeConsumptionForItems([item('PRETO', false)], context());
    const upper = rows.filter(row => row.componentType === 'Cabedal');
    expect(upper).toHaveLength(1);
    expect(upper[0].groupName).toBe('NAPA SOFT + MASSABOX');
    expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
    expect(rows.filter(row => row.componentType === 'Forração')).toHaveLength(1);
  });

  it.each(colors)('a variante %s usa Glow puro na forração e disponibilidade zero do dublado', async color => {
    const ctx = context();
    const computed = computeConsumptionForItems([item(color)], ctx);
    const annotated = await annotateConsumptionAvailability(computed, ctx);
    expect(annotated.rows.find(row => row.groupName === 'GLOW METALIC + MASSABOX')?.available).toBe(0);
    const lining = computed.find(row => row.componentType === 'Forração');
    expect(lining?.groupName).toBe('GLOW METALIC');
    expect(lining?.totalQuantity).toBeCloseTo(4.56, 6);
  });

  it.each(colors)('o oráculo TS troca as duas parcelas do cabedal %s para o composto Glow', color => {
    const upper = computeConsumptionForItems([item(color)], context())
      .filter(row => row.componentType === 'Cabedal');
    expect(upper.map(row => row.groupName)).toEqual(['GLOW METALIC + MASSABOX']);
    expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
  });

  it.each(colors)('a Lista de Separação troca as duas parcelas do cabedal %s para o composto Glow', async color => {
    db.tables = {
      orders: [{ id: 'op', reference_id: 'i701', color, quantity: 137,
        grade: { '28': 137 }, sale_order_item_id: 'si', sale_order_id: 'pv' }],
      technical_sheets: [sheet], sale_order_items: [{ id: 'si', material_variant_id: variant.id }],
      products, product_groups: groups, component_sheets: componentSheets,
      reference_material_variants: [variant],
    };
    const upper = (await calculateBomForOrders(['op'])).filter(row => row.componentType === 'Cabedal');
    expect(upper.map(row => row.groupName)).toEqual(['GLOW METALIC + MASSABOX']);
    expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
  });

  it('preserva o grupo de outro material obrigatório do cabedal', async () => {
    const testSheet = { ...sheet, components_accessories: [{ ...sheet.components_accessories[0], material: 'NAPA SOFT' }] };
    for (const upper of await upperRowsFromBothEngines(testSheet)) {
      expect(upper.map(row => row.groupName).sort()).toEqual(['GLOW METALIC + MASSABOX', 'NAPA SOFT']);
      expect(upper.find(row => row.groupName === 'GLOW METALIC + MASSABOX')?.totalQuantity).toBeCloseTo(2.74, 6);
    }
  });

  it('preserva o SKU explícito de um acessório do mesmo grupo', async () => {
    const testSheet = { ...sheet, components_accessories: [{ ...sheet.components_accessories[0], product_id: 'base-PRETO' }] };
    for (const upper of await upperRowsFromBothEngines(testSheet)) {
      expect(upper).toHaveLength(2);
      const pinned = upper.find(row => row.productIds?.includes('base-PRETO'));
      expect(pinned?.groupName).toBe('NAPA SOFT + MASSABOX');
      expect(pinned?.totalQuantity).toBeCloseTo(2.28, 6);
    }
  });

  it('preserva material explicitamente marcado como sobra', async () => {
    const testSheet = { ...sheet, components_accessories: [{ ...sheet.components_accessories[0], leftover: true }] };
    for (const upper of await upperRowsFromBothEngines(testSheet)) {
      expect(upper.map(row => row.groupName).sort()).toEqual(['GLOW METALIC + MASSABOX', 'NAPA SOFT + MASSABOX']);
    }
  });

  it('o grupo da variante vence o pin da ficha no principal e no adicional herdado', async () => {
    for (const upper of await upperRowsFromBothEngines({ ...sheet, upper_material_product_id: 'base-PRETO' })) {
      expect(upper).toHaveLength(1);
      expect(upper[0].productIds).toEqual(['upper-glow-CHAMPAGNE']);
      expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
    }
  });

  it('o SKU da variante dirige ambas as parcelas quando há pin legado explícito', async () => {
    for (const upper of await upperRowsFromBothEngines(sheet, { ...variant, upper_material_product_id: 'upper-glow-PRATA' })) {
      expect(upper).toHaveLength(1);
      expect(upper[0].productIds).toEqual(['upper-glow-PRATA']);
      expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
    }
  });

  it.each(['AZUL', 'CHAMPAGNE CLARO', 'OURO', ''])('cor %s ausente não usa estoque de outra cor do composto', async color => {
    const stockedProducts = products.map(product => product.id === 'upper-glow-CHAMPAGNE'
      ? { ...product, quantity: 1000 } : product);
    for (const upper of await upperRowsFromBothEngines(sheet, variant, { color, products: stockedProducts })) {
      expect(upper).toHaveLength(1);
      expect(upper[0].totalQuantity).toBeCloseTo(5.02, 6);
      expect(upper[0].productIds?.length || 0).toBe(0);
      expect(upper[0].colorMismatch).toBe(true);
      expect(upper[0].warning).toContain('não cadastrada');
      const annotated = await annotateConsumptionAvailability(upper, { ...context(), allProducts: stockedProducts });
      expect(annotated.rows[0].available).toBe(0);
    }
  });

  it('pin explícito da variante continua válido e disponível mesmo quando a cor do pedido difere', async () => {
    const stockedProducts = products.map(product => product.id === 'upper-glow-PRATA'
      ? { ...product, quantity: 1000 } : product);
    const pinned = { ...variant, upper_material_product_id: 'upper-glow-PRATA' };
    for (const upper of await upperRowsFromBothEngines(sheet, pinned, { color: 'AZUL', products: stockedProducts })) {
      expect(upper).toHaveLength(1);
      expect(upper[0].productIds).toEqual(['upper-glow-PRATA']);
      expect(upper[0].colorMismatch).toBeFalsy();
      const annotated = await annotateConsumptionAvailability(upper, { ...context(), allProducts: stockedProducts });
      expect(annotated.rows[0].available).toBe(1000);
    }
  });

  it('grupo explicitamente agnóstico mantém o SKU genérico e seu estoque', async () => {
    const agnosticGroups = groups.map(group => ({ ...group, composite_layers: [], is_color_agnostic: group.id === 'upper-glow' }));
    const stockedProducts = products.map(product => product.id === 'upper-glow-CHAMPAGNE'
      ? { ...product, quantity: 1000 } : product);
    for (const upper of await upperRowsFromBothEngines(sheet, variant, {
      color: 'AZUL', products: stockedProducts, groups: agnosticGroups,
    })) {
      expect(upper).toHaveLength(1);
      expect(upper[0].productIds).toEqual(['upper-glow-CHAMPAGNE']);
      expect(upper[0].colorMismatch).toBeFalsy();
      const annotated = await annotateConsumptionAvailability(upper, {
        ...context(), allProducts: stockedProducts, productGroups: agnosticGroups,
      });
      expect(annotated.rows[0].available).toBe(1000);
    }
  });
});
