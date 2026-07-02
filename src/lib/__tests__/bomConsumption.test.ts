import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GATE da auditoria dos motores (2026-07-01) — Lista de Separação (bomConsumption).
 *
 * Trava as 4 correções:
 *  (a) corte do rolo artesanal NÃO multiplica por `fichas` do sale_order_item —
 *      `orders.grade` é a grade REAL da OP (Σ = quantity); passar fichas gerava
 *      supercontagem de 30–92× (OP-2026-00729: 60×).
 *  (b) `calculateBomForOrders` não hardcoda `fichas: 1` — o fallback exato
 *      (quantity ÷ gradeTotal) é escala-invariante (grade base OU real).
 *  (c) Embalagem filtrada por `packaging_mode` do PV (shouldShowCaixaForMode) —
 *      antes a Lista mostrava colmeia E individual juntas.
 *  (d) Palmilha sai na unidade de ESTOQUE do produto-placa quando ela é dm²
 *      (ex.: PLACA 1.0 EVA, unit='dm²'), com equivalência em placas como info
 *      secundária — antes saía só em "placas" e a comparação com estoque
 *      (dm²) era inválida.
 */

// Tabelas fake por teste. O mock do client devolve TODAS as linhas da tabela
// (os filtros .in/.eq/.gt são no-ops) — os cenários são montados já filtrados.
const mockDb = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock('@/integrations/supabase/client', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeBuilder = (rows: any[]) => {
    const builder: any = {
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    };
    for (const method of ['select', 'in', 'eq', 'gt', 'not', 'order', 'limit']) {
      builder[method] = () => builder;
    }
    return builder;
  };
  return {
    supabase: { from: (table: string) => makeBuilder((mockDb.tables[table] as any[]) ?? []) },
  };
});

import { calculateBomForOrders, calculateArtisanalStrapRollCut } from '@/lib/bomConsumption';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Fixture base: 1 OP de 720 pares, ficha com palmilha + tira + 2 caixas ───

const GRADE_BASE = { '35': 2, '36': 4, '37': 4, '38': 2 }; // Σ = 12 (1 ficha)
const GRADE_REAL = { '35': 120, '36': 240, '37': 240, '38': 120 }; // Σ = 720

function buildSheet(over: Record<string, any> = {}) {
  return {
    id: 'ts1',
    upper_material: '',
    upper_consumption: 0,
    upper_consumption_per_size: null,
    lining_material: '',
    lining_consumption: 0,
    lining_consumption_per_size: null,
    insole_material: 'PALMILHA',
    insole_consumption: 5, // dm²/par
    insole_ready_made: false,
    insole_has_lining: false,
    insole_lining_consumption: 0,
    sole_material: '',
    sole_consumption: 0,
    sole_color: '',
    sole_group_id: null,
    lining_accessories: [],
    components_accessories: [],
    strap_colors: [{
      id: 1,
      label: 'Tira 1',
      group_name: 'TIRA CHATA 8MM',
      color: 'PRETO',
      consumption: 10, // cm/par
      consumption_per_size: { '35': 10, '36': 10, '37': 10, '38': 10 },
    }],
    sole_drives_consumption: false,
    ...over,
  };
}

function buildBomTables(over: {
  grade?: Record<string, number>;
  packagingMode?: string | null;
} = {}): Record<string, unknown[]> {
  return {
    orders: [{
      id: 'op1',
      reference_id: 'ts1',
      color: 'PRETO',
      quantity: 720,
      grade: over.grade ?? GRADE_BASE,
      sale_order_item_id: 'si1',
      sale_order_id: 'so1',
    }],
    technical_sheets: [buildSheet()],
    // `null` explícito = PV sem modo (não usar ?? aqui, senão null vira 'colmeia').
    sale_orders: [{ id: 'so1', packaging_mode: over.packagingMode === undefined ? 'colmeia' : over.packagingMode }],
    sale_order_items: [{ id: 'si1', strap_colors: null, fichas: 60 }],
    products: [
      { id: 'p-placa', name: 'PLACA 1.0 EVA', color: null, group_id: 'g-palm', sole_classification: null },
      { id: 'p-cx-col', name: 'CAIXA COLMEIA 11', color: null, group_id: 'g-cx-col', sole_classification: null },
      { id: 'p-cx-ind', name: 'CAIXA INDIVIDUAL 11', color: null, group_id: 'g-cx-ind', sole_classification: null },
    ],
    product_groups: [
      { id: 'g-palm', name: 'PALMILHA', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm' },
      { id: 'g-cx-col', name: 'CAIXA COLMEIA 11', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm' },
      { id: 'g-cx-ind', name: 'CAIXA INDIVIDUAL 11', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm' },
    ],
    // Placa 1000 × 1500 mm = 150 dm²/placa; produto estocado em dm².
    component_sheets: [{
      product_id: 'p-placa',
      dimensions_width: 1000,
      dimensions_length: 1500,
      dimensions_unit: 'mm',
      yield_per_size: null,
      yield_per_sole: null,
      waste_pct: 0,
      products: { group_id: 'g-palm', name: 'PLACA 1.0 EVA', color: null, unit: 'dm²' },
    }],
    sheet_materials: [
      {
        sheet_id: 'ts1', product_id: 'p-cx-col', group_id: 'g-cx-col', quantity_per_unit: 1, color: null,
        products: { name: 'CAIXA COLMEIA 11', unit: 'un', category: 'Embalagem' },
        product_groups: { name: 'CAIXA COLMEIA 11' },
      },
      {
        sheet_id: 'ts1', product_id: 'p-cx-ind', group_id: 'g-cx-ind', quantity_per_unit: 1, color: null,
        products: { name: 'CAIXA INDIVIDUAL 11', unit: 'un', category: 'Embalagem' },
        product_groups: { name: 'CAIXA INDIVIDUAL 11' },
      },
    ],
    technical_sheet_sole_colors: [],
    sole_technical_specs: [],
  };
}

beforeEach(() => {
  mockDb.tables = {};
});

// ─── (b) fichas hardcoded — fallback exato escala-invariante ─────────────────

describe('calculateBomForOrders — tiras sem fichas hardcoded (achado b)', () => {
  it('grade BASE (Σ=12, qty=720): consumo da tira escala por quantity/gradeTotal (60×)', async () => {
    mockDb.tables = buildBomTables({ grade: GRADE_BASE });
    const rows = await calculateBomForOrders(['op1']);
    const tira = rows.find(r => r.componentType === 'Tiras');
    // 12 pares/ficha × 10 cm/par = 120 cm/ficha × (720/12) = 7200 cm = 72 m.
    // Com o antigo `fichas: 1` dava 1,2 m (subcontagem de 60×).
    expect(tira?.totalQuantity).toBeCloseTo(72, 6);
    expect(tira?.productUnit).toBe('metro');
  });

  it('grade REAL (Σ=720, qty=720): mesmo total — cálculo é escala-invariante', async () => {
    mockDb.tables = buildBomTables({ grade: GRADE_REAL });
    const rows = await calculateBomForOrders(['op1']);
    const tira = rows.find(r => r.componentType === 'Tiras');
    expect(tira?.totalQuantity).toBeCloseTo(72, 6);
  });
});

// ─── (c) Embalagem filtrada por packaging_mode ───────────────────────────────

describe('calculateBomForOrders — filtro de caixa por packaging_mode (achado c)', () => {
  it('packaging_mode=colmeia: só a CAIXA COLMEIA aparece (individual filtrada)', async () => {
    mockDb.tables = buildBomTables({ packagingMode: 'colmeia' });
    const rows = await calculateBomForOrders(['op1']);
    const caixas = rows.filter(r => r.componentType === 'Embalagem');
    expect(caixas).toHaveLength(1);
    expect(caixas[0].materialName).toBe('CAIXA COLMEIA 11');
    expect(caixas[0].totalQuantity).toBe(720);
  });

  it('packaging_mode=individual: só a CAIXA INDIVIDUAL aparece', async () => {
    mockDb.tables = buildBomTables({ packagingMode: 'individual' });
    const rows = await calculateBomForOrders(['op1']);
    const caixas = rows.filter(r => r.componentType === 'Embalagem');
    expect(caixas).toHaveLength(1);
    expect(caixas[0].materialName).toBe('CAIXA INDIVIDUAL 11');
  });

  it('sem packaging_mode: NÃO filtra (degrada com elegância, mostra as duas)', async () => {
    mockDb.tables = buildBomTables({ packagingMode: null });
    const rows = await calculateBomForOrders(['op1']);
    const caixas = rows.filter(r => r.componentType === 'Embalagem');
    expect(caixas).toHaveLength(2);
  });
});

// ─── (d) Palmilha na unidade de ESTOQUE (dm²) com equivalência em placas ─────

describe('calculateBomForOrders — palmilha em dm² quando o produto é dm² (achado d)', () => {
  it('produto-placa com unit=dm²: linha sai em dm² + plateEquivalent', async () => {
    mockDb.tables = buildBomTables();
    const rows = await calculateBomForOrders(['op1']);
    const palmilha = rows.find(r => r.componentType === 'Palmilha');
    // 5 dm²/par × 720 = 3600 dm² (perda 0). Placa 150 dm² ⇒ 24 placas.
    expect(palmilha?.productUnit).toBe('dm²');
    expect(palmilha?.totalQuantity).toBeCloseTo(3600, 6);
    expect(palmilha?.plateEquivalent).toBeCloseTo(24, 6);
  });

  it('produto-placa com unit=placa: mantém comportamento antigo (placas)', async () => {
    const tables = buildBomTables();
    (tables.component_sheets as any[])[0].products.unit = 'placa';
    mockDb.tables = tables;
    const rows = await calculateBomForOrders(['op1']);
    const palmilha = rows.find(r => r.componentType === 'Palmilha');
    expect(palmilha?.productUnit).toBe('placa');
    expect(palmilha?.totalQuantity).toBeCloseTo(24, 6);
    expect(palmilha?.plateEquivalent).toBeUndefined();
  });
});

// ─── (a) Corte do rolo artesanal — sem multiplicar por fichas ────────────────

describe('calculateArtisanalStrapRollCut — não multiplica por fichas (achado a)', () => {
  function buildRollTables(): Record<string, unknown[]> {
    // Espelha OP-2026-00729: grade REAL (Σ = quantity = 720) + fichas=60 no
    // sale_order_item. O bug multiplicava o total da grade REAL por 60.
    const gradeReal = { '25': 60, '26': 60, '27': 60, '28': 120, '29': 120, '30': 120, '31': 60, '32': 60, '33': 60 };
    const perSize12 = Object.fromEntries(Object.keys(gradeReal).map(s => [s, 12]));
    return {
      orders: [{
        id: 'op1', reference_id: 'ts1', color: 'PRETO', quantity: 720,
        grade: gradeReal, sale_order_item_id: 'si1',
      }],
      technical_sheets: [{
        id: 'ts1',
        strap_colors: [{
          id: 1, label: 'Tira 1', group_name: 'TIRA CHATA 8MM', color: 'PRETO',
          consumption: 12, consumption_per_size: perSize12,
        }],
      }],
      // fichas=60 PRESENTE no banco — o cálculo não pode usá-lo.
      sale_order_items: [{ id: 'si1', strap_colors: null, fichas: 60 }],
      product_groups: [{
        id: 'g-tira', name: 'TIRA CHATA 8MM',
        dimensions_width: 8, dimensions_unit: 'mm', is_artisanal_strap: true,
      }],
      products: [],
      artisanal_recipes: [],
    };
  }

  it('grade REAL + fichas=60 no item: metros = Σ(pares × cm/par), UMA vez (não ×60)', async () => {
    mockDb.tables = buildRollTables();
    const rows = await calculateArtisanalStrapRollCut(['op1']);
    expect(rows).toHaveLength(1);
    // 720 pares × 12 cm/par = 8640 cm = 86,4 m (bug antigo: 86,4 × 60 = 5184 m).
    expect(rows[0].metros_necessarios).toBeCloseTo(86.4, 6);
    expect(rows[0].largura_mm).toBe(8);
    // ceil(86,4 / 34) = 3 bandas × 8 mm = 24 mm = 2,4 cm do rolo.
    expect(rows[0].cut.n_bandas).toBe(3);
    expect(rows[0].cut.cm_a_cortar).toBeCloseTo(2.4, 6);
  });
});
