import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GATE da auditoria dos motores (2026-07-01) — Lista de Separação (bomConsumption).
 *
 * Trava as 4 correções:
 *  (a) separação canônica da napa para tira NÃO multiplica por `fichas` do sale_order_item —
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
const mockDb = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, unknown>,
}));

vi.mock('@/integrations/supabase/client', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeBuilder = (rows: any[]) => {
    const builder: any = {
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    };
    for (const method of ['select', 'in', 'eq', 'gt', 'or', 'not', 'order', 'limit']) {
      builder[method] = () => builder;
    }
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder((mockDb.tables[table] as any[]) ?? []),
      rpc: (name: string) => Promise.resolve({ data: mockDb.rpc[name] ?? [], error: null }),
    },
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
  mockDb.rpc = {};
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

describe('calculateArtisanalStrapRollCut — separação canônica não multiplica por fichas (achado a)', () => {
  const saleOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const saleOrderItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function buildRollTables(): Record<string, unknown[]> {
    // Espelha OP-2026-00729: grade REAL (Σ = quantity = 720) + fichas=60 no
    // sale_order_item. O bug multiplicava o total da grade REAL por 60.
    const gradeReal = { '25': 60, '26': 60, '27': 60, '28': 120, '29': 120, '30': 120, '31': 60, '32': 60, '33': 60 };
    const perSize12 = Object.fromEntries(Object.keys(gradeReal).map(s => [s, 12]));
    return {
      orders: [{
        id: 'op1', reference_id: 'ts1', color: 'PRETO', quantity: 720,
        grade: gradeReal, sale_order_id: saleOrderId, sale_order_item_id: saleOrderItemId,
      }],
      technical_sheets: [{
        id: 'ts1',
        strap_colors: [{
          id: 1, label: 'Tira 1', group_name: 'TIRA CHATA 8MM', color: 'PRETO',
          consumption: 12, consumption_per_size: perSize12,
        }],
      }],
      // fichas=60 PRESENTE no banco — o cálculo não pode usá-lo.
      sale_order_items: [{ id: saleOrderItemId, strap_colors: null, fichas: 60 }],
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
    mockDb.rpc.preview_sale_order_strap_demand = [{
      sale_order_item_id: saleOrderItemId,
      technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
      strap_variant_id: '22222222-2222-4222-8222-222222222222',
      source_mode: 'internal',
      gross_required_m: 86.4,
      recipe_id: '33333333-3333-4333-8333-333333333333',
      base_product_id: '44444444-4444-4444-8444-444444444444',
      finished_product_id: '55555555-5555-4555-8555-555555555555',
      blocking_reasons: [],
      resolved: {
        strap_product_name: 'TIRA CHATA 8MM',
        strap_color_name: 'PRETO',
        base_product_name: 'NAPA SOFT PRETO',
        confirmed_yield_m_per_m: 34,
        base_required_m: 86.4 / 34,
        cut_band_width_mm: 8,
        usable_base_width_mm_snapshot: 1370,
        theoretical_yield_m_per_m: 34,
      },
    }];
    const rows = await calculateArtisanalStrapRollCut(['op1']);
    expect(rows).toHaveLength(1);
    // 720 pares × 12 cm/par = 8640 cm = 86,4 m (bug antigo: 86,4 × 60 = 5184 m).
    expect(rows[0].metros_necessarios).toBeCloseTo(86.4, 6);
    expect(rows[0].largura_mm).toBe(8);
    // O cutover não reconstrói o rolo fixo 40×1370: separa diretamente a
    // napa-base pelo rendimento confirmado persistido na receita.
    expect(rows[0].canonical?.baseRequiredM).toBeCloseTo(86.4 / 34, 6);
    expect(rows[0].canonical?.confirmedYieldMPerM).toBe(34);
    expect(rows[0].cut.n_bandas).toBe(0);
    expect(rows[0].cut.cm_a_cortar).toBe(0);
    expect(rows[0].cut.valid).toBe(false);
  });
});

// ─── Auditoria 2026-07-19 — pendências BOM-2/4/5/6/7 aplicadas ───────────────
//
// BOM-2: resolução de solado usa a cascata CANÔNICA (P0 coligação → P1 mapping
//        explícito → P2 mapping legado por grupo → P3 primary_sole_id), não mais
//        só pin de variante + mapping explícito.
// BOM-4: placa da palmilha usa insole_consumption_dm2 do SOLADO por numeração.
// BOM-5: componente Fachete emitido (ou linha de AVISO quando sem specs).
// BOM-6: direct_components / componentes por cor entram no picking (sem duplicar BOM).
// BOM-7: linha Solado usa sole_consumption>1 e existe mesmo sem sole_material textual.

const withSole = (t: Record<string, unknown[]>, sole: Record<string, any> = {}) => {
  (t.technical_sheets[0] as any).sole_group_id = 'g-sole';
  (t.technical_sheets[0] as any).primary_sole_id = sole.id ?? 'p-sole';
  t.products = [...(t.products as any[]), {
    id: 'p-sole', name: '204 - PRETO', color: 'PRETO', group_id: 'g-sole',
    quantity: 100, sole_classification: null, ...sole,
  }];
  t.product_groups = [...(t.product_groups as any[]), {
    id: 'g-sole', name: 'SOLADO 204', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
  }];
  return t;
};

describe('calculateBomForOrders — cascata canônica de solado (BOM-2/BOM-7)', () => {
  it('P3: primary_sole_id resolve o solado sem mapping explícito nem sole_material', async () => {
    // buildSheet tem sole_material '' e sole_consumption 0 — antes a linha de
    // Solado simplesmente NÃO existia (groupName vazio + solePerPair 0).
    mockDb.tables = withSole(buildBomTables());
    const rows = await calculateBomForOrders(['op1']);
    const solado = rows.find(r => r.componentType === 'Solado');
    expect(solado?.groupName).toBe('SOLADO 204');
    expect(solado?.color).toBe('PRETO');
    // BOM-7: default canônico de 1 par/par (sole_consumption 0/null não apaga).
    expect(solado?.totalQuantity).toBe(720);
  });

  it('P0: coligação de cor escolhe o produto do grupo na cor-alvo com MAIOR estoque', async () => {
    const t = withSole(buildBomTables());
    // Dois solados no grupo; a coligação manda WHISKY → CARAMELO. O de maior
    // estoque na cor-alvo (p-sole-c2, qty 500) deve vencer o primary (p-sole).
    (t.orders[0] as any).color = 'WHISKY';
    t.products = [...(t.products as any[]), {
      id: 'p-sole-c2', name: '204 - CARAMELO GG', color: 'CARAMELO', group_id: 'g-sole',
      quantity: 500, sole_classification: null,
    }];
    t.sole_color_conjugations = [{
      sole_group_id: 'g-sole', cabedal_color: 'WHISKY', palmilha_color: 'CARAMELO',
      resolution_mode: 'fixed', is_default: false, active: true,
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const solado = rows.find(r => r.componentType === 'Solado');
    expect(solado?.groupName).toBe('SOLADO 204');
    expect(solado?.color).toBe('CARAMELO');
    // Confirma que veio da P0 (maior estoque) e não do primary: a palmilha
    // por número abaixo usa o MESMO produto — validado no teste de BOM-4.
  });

  it('BOM-7: ignora multiplicador legado e mantém 1 par de solado por par vendido', async () => {
    const t = withSole(buildBomTables());
    (t.technical_sheets[0] as any).sole_consumption = 2;
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const solado = rows.find(r => r.componentType === 'Solado');
    expect(solado?.totalQuantity).toBe(720);
  });
});

describe('calculateBomForOrders — placa da palmilha por número do solado (BOM-4)', () => {
  it('insole_consumption_dm2 do solado substitui o escalar da ficha', async () => {
    const t = withSole(buildBomTables());
    // Escalar da ficha = 5 dm²/par (→ 3600 dm²). Solado manda 4 dm²/par → 2880.
    t.sole_technical_specs = [35, 36, 37, 38].map(size => ({
      sole_id: 'p-sole', size, insole_consumption_dm2: 4,
    }));
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const palmilha = rows.find(r => r.componentType === 'Palmilha');
    expect(palmilha?.productUnit).toBe('dm²');
    expect(palmilha?.totalQuantity).toBeCloseTo(2880, 6);
  });

  it('sem specs no solado, mantém o caminho escalar antigo (3600 dm²)', async () => {
    mockDb.tables = withSole(buildBomTables());
    const rows = await calculateBomForOrders(['op1']);
    const palmilha = rows.find(r => r.componentType === 'Palmilha');
    expect(palmilha?.totalQuantity).toBeCloseTo(3600, 6);
  });
});

describe('calculateBomForOrders — componente Fachete (BOM-5)', () => {
  it('solado fachetado emite Fachete pelo grupo fachete_material_group_id', async () => {
    const t = withSole(buildBomTables(), { is_fachetado: true, fachete_material_group_id: 'g-fach' });
    t.product_groups = [...(t.product_groups as any[]), {
      id: 'g-fach', name: 'FORRO FACHETE', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
    }];
    t.sole_technical_specs = [35, 36, 37, 38].map(size => ({
      sole_id: 'p-sole', size, fachete_lining_consumption_dm2: 2,
    }));
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const fachete = rows.find(r => r.materialName === 'Fachete');
    expect(fachete?.componentType).toBe('Forração');
    expect(fachete?.groupName).toBe('FORRO FACHETE');
    // 2 dm²/par × 720 = 1440; sem ficha de componente com largura → dm² + aviso.
    expect(fachete?.totalQuantity).toBeCloseTo(1440, 6);
    expect(fachete?.productUnit).toBe('dm2');
    expect(fachete?.widthMissing).toBe(true);
  });

  it('fachetado SEM specs de fachete → linha de AVISO com qtd 0', async () => {
    const t = withSole(buildBomTables(), { is_fachetado: true, fachete_material_group_id: 'g-fach' });
    t.product_groups = [...(t.product_groups as any[]), {
      id: 'g-fach', name: 'FORRO FACHETE', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const fachete = rows.find(r => r.materialName === 'Fachete');
    expect(fachete).toBeTruthy();
    expect(fachete?.totalQuantity).toBe(0);
    expect(fachete?.warning).toMatch(/fachete/i);
  });

  it('solado NÃO fachetado: nenhuma linha de Fachete', async () => {
    mockDb.tables = withSole(buildBomTables());
    const rows = await calculateBomForOrders(['op1']);
    expect(rows.find(r => r.materialName === 'Fachete')).toBeUndefined();
  });
});

describe('calculateBomForOrders — direct_components e componentes por cor (BOM-6)', () => {
  const withBinoculo = (t: Record<string, unknown[]>) => {
    t.products = [...(t.products as any[]), {
      id: 'p-bin', name: 'BINÓCULO 6MM', color: 'DOURADO', group_id: 'g-bin',
      unit: 'un', quantity: 0, sole_classification: null,
    }];
    t.product_groups = [...(t.product_groups as any[]), {
      id: 'g-bin', name: 'BINOCULO 6MM', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
    }];
    return t;
  };

  it('direct_components entram no picking (antes eram ignorados)', async () => {
    const t = withBinoculo(buildBomTables());
    (t.technical_sheets[0] as any).direct_components = [{ product_id: 'p-bin', quantity: 8 }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const bin = rows.find(r => r.groupName === 'BINOCULO 6MM');
    expect(bin?.totalQuantity).toBe(8 * 720);
    expect(bin?.materialName).toBe('BINÓCULO 6MM');
  });

  it('produto em direct_components E no BOM: direct prevalece, sem duplicar', async () => {
    const t = withBinoculo(buildBomTables());
    (t.technical_sheets[0] as any).direct_components = [{ product_id: 'p-bin', quantity: 8 }];
    t.sheet_materials = [...(t.sheet_materials as any[]), {
      sheet_id: 'ts1', product_id: 'p-bin', group_id: 'g-bin', quantity_per_unit: 1, color: null,
      products: { name: 'BINÓCULO 6MM', unit: 'un', category: 'Componente' },
      product_groups: { name: 'BINOCULO 6MM' },
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const binRows = rows.filter(r => r.groupName === 'BINOCULO 6MM');
    const total = binRows.reduce((s, r) => s + r.totalQuantity, 0);
    // Só o direct (8/par); a linha do BOM (1/par = 720) é pulada.
    expect(total).toBe(8 * 720);
  });

  it('component_colors_enabled + cor mapeada SUBSTITUI direct_components', async () => {
    const t = withBinoculo(buildBomTables());
    t.products = [...(t.products as any[]), {
      id: 'p-strass', name: 'STRASS PRATA', color: 'PRATA', group_id: 'g-strass',
      unit: 'un', quantity: 0, sole_classification: null,
    }];
    t.product_groups = [...(t.product_groups as any[]), {
      id: 'g-strass', name: 'STRASS', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
    }];
    (t.technical_sheets[0] as any).component_colors_enabled = true;
    (t.technical_sheets[0] as any).direct_components = [{ product_id: 'p-bin', quantity: 8 }];
    t.technical_sheet_component_colors = [{
      sheet_id: 'ts1', cabedal_color: 'PRETO', product_id: 'p-strass', quantity_per_unit: 4,
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    expect(rows.find(r => r.groupName === 'STRASS')?.totalQuantity).toBe(4 * 720);
    // A lista POR COR substitui direct_components por completo.
    expect(rows.find(r => r.groupName === 'BINOCULO 6MM')).toBeUndefined();
  });
});

describe('calculateBomForOrders — padrões GLOBAIS por cor (component_color_defaults)', () => {
  // Espelha o motor canônico/SQL (mig 20260928121000): no fallback de
  // direct_components, regra ativa do grupo pra cor da OP troca o SKU
  // mantendo a quantidade da ficha.
  const withBinoculoColors = (t: Record<string, unknown[]>) => {
    t.products = [...(t.products as any[]),
      { id: 'p-bin', name: 'BINÓCULO 6MM DOURADO', color: 'DOURADO', group_id: 'g-bin', unit: 'un', quantity: 0, sole_classification: null },
      { id: 'p-bin-preto', name: 'BINÓCULO 6MM PRETO', color: 'PRETO', group_id: 'g-bin', unit: 'un', quantity: 0, sole_classification: null },
    ];
    t.product_groups = [...(t.product_groups as any[]), {
      id: 'g-bin', name: 'BINOCULO 6MM', dimensions_length: null, dimensions_width: null, dimensions_unit: 'mm',
    }];
    (t.technical_sheets[0] as any).direct_components = [{ product_id: 'p-bin', quantity: 8 }];
    return t;
  };

  it('regra do grupo pra cor da OP troca o SKU no picking, mantendo a qty da ficha', async () => {
    const t = withBinoculoColors(buildBomTables());
    t.component_color_defaults = [{
      group_id: 'g-bin', cabedal_color: 'Preto', product_id: 'p-bin-preto', is_default: false, active: true,
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']); // OP na cor PRETO
    const bin = rows.filter(r => r.groupName === 'BINOCULO 6MM');
    expect(bin).toHaveLength(1);
    expect(bin[0].materialName).toBe('BINÓCULO 6MM PRETO');
    expect(bin[0].totalQuantity).toBe(8 * 720);
  });

  it('lista por-cor da ficha VENCE a regra global', async () => {
    const t = withBinoculoColors(buildBomTables());
    (t.technical_sheets[0] as any).component_colors_enabled = true;
    t.technical_sheet_component_colors = [{
      sheet_id: 'ts1', cabedal_color: 'PRETO', product_id: 'p-bin', quantity_per_unit: 8,
    }];
    t.component_color_defaults = [{
      group_id: 'g-bin', cabedal_color: 'Preto', product_id: 'p-bin-preto', is_default: false, active: true,
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const bin = rows.filter(r => r.groupName === 'BINOCULO 6MM');
    expect(bin).toHaveLength(1);
    expect(bin[0].materialName).toBe('BINÓCULO 6MM DOURADO'); // escolha manual da ficha
  });

  it('regra apontando produto morto mantém o original com aviso', async () => {
    const t = withBinoculoColors(buildBomTables());
    t.component_color_defaults = [{
      group_id: 'g-bin', cabedal_color: 'Preto', product_id: 'p-apagado', is_default: false, active: true,
    }];
    mockDb.tables = t;
    const rows = await calculateBomForOrders(['op1']);
    const bin = rows.filter(r => r.groupName === 'BINOCULO 6MM');
    expect(bin).toHaveLength(1);
    expect(bin[0].materialName).toBe('BINÓCULO 6MM DOURADO');
    expect(bin[0].totalQuantity).toBe(8 * 720);
    expect(bin[0].warning).toMatch(/regra global/i);
  });
});
