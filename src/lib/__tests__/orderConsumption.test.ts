import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// O motor importa o client supabase (usado só pelos fetch*). Mockamos pra
// não instanciar nada — este teste exercita APENAS o cálculo puro.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  computeConsumptionForItems,
  resolveInsoleBaseProductCanonical,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionContext,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import {
  toBulkConsumptionRow,
  filterConsumptionForSector,
} from '@/hooks/useBulkOrderConsumption';

/**
 * ORÁCULO TS DE PARIDADE E CONTRATO DO ADAPTADOR.
 *
 * O relatório e a ficha não chamam mais `computeConsumptionForItems`: a
 * migration 123 os alimenta pelo motor SQL operacional. Estes goldens mantêm
 * o antigo motor como oráculo independente e travam que o adaptador visual
 * `toBulkConsumptionRow` não altera a quantidade recebida.
 *
 * Cenário (espelha o exemplo do user — setor Corte Fibra):
 *   item: ref 'sheet-1', cor PRETO, quantity 24, grade base soma 6 (→ 4 fichas)
 *   - Cabedal NAPA SOFT: 6 dm²/par × 24 = 144 dm² ÷ (1000mm/10) = 1.44 m
 *   - Forração NAPA FORRO: 4 dm²/par × 24 = 96 dm² ÷ (500mm/10) = 1.92 m
 *   - Palmilha PLACA EVA: 5 dm²/par × 24 = 120 dm² ÷ 50 dm²/placa = 2.40 placa
 *   - Palmilha FORRAÇÃO NAPA FORRO: 3 dm²/par × 24 = 72 dm² ÷ 50 = 1.44 m
 *   - Solado SOLADO TR 01: 1 par/par × 24 = 24 par, breakdown 4 por nº
 *   - BOM COLA: 0.01 kg/par × 24 = 0.24 kg
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function buildSheet(over: Record<string, any> = {}) {
  return {
    id: 'sheet-1',
    upper_material: 'NAPA SOFT',
    upper_consumption: 6.0,
    upper_consumption_per_size: null,
    lining_material: 'NAPA FORRO',
    lining_consumption: 4.0,
    insole_material: 'EVA PLACA',
    insole_consumption: 5.0,
    insole_has_lining: true,
    insole_ready_made: false,
    insole_lining_consumption: 3.0,
    sole_material: 'SOLADO TR 01',
    sole_consumption: 1,
    sole_color: 'PRETO',
    sole_group_id: null,
    lining_accessories: [],
    components_accessories: [],
    ...over,
  };
}

function buildItem(over: Partial<ConsumptionItem> = {}): ConsumptionItem {
  return {
    reference_id: 'sheet-1',
    color: 'PRETO',
    quantity: 24,
    grade: { '34': 1, '35': 1, '36': 1, '37': 1, '38': 1, '39': 1 },
    fichas: null,
    strap_colors: null,
    technical_sheets: buildSheet(),
    ...over,
  };
}

describe('material de tira por posição no oráculo TS', () => {
  it('soma posições da mesma base e separa UUIDs distintos mesmo com nome igual', () => {
    const positions = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ].map((id, index) => ({ id, technical_strap_line_id: id, label: 'TIRA',
      group_name: 'TIRA OVERLOCK 5MM', color: 'PRETO', consumption: 40,
      identity_basis: 'reference_base', material_mode: 'select_on_order',
      base_group_id: index === 1 ? 'base-b' : 'base-a', base_group_name: 'NAPA SOFT',
    }));
    const rows = computeConsumptionForItems([buildItem({ strap_colors: positions })], buildContext())
      .filter(row => row.componentType === 'Tiras');
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.materialFamilyId === 'base-a')?.totalQuantity).toBeCloseTo(19.2);
    expect(rows.find(row => row.materialFamilyId === 'base-b')?.totalQuantity).toBeCloseTo(9.6);
  });
});

function buildContext(): ConsumptionContext {
  return {
    materials: [
      {
        sheet_id: 'sheet-1',
        product_id: 'p-cola',
        group_id: 'g-cola',
        quantity_per_unit: 0.01,
        color: null,
        products: { name: 'COLA SUPER', unit: 'kg', category: 'Quimicos' },
        product_groups: { name: 'COLA' },
      },
    ],
    allProducts: [
      { id: 'p-napa-preto', name: 'NAPA SOFT PRETO', color: 'PRETO', group_id: 'g-napa', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
      { id: 'p-forro-preto', name: 'NAPA FORRO PRETO', color: 'PRETO', group_id: 'g-forro', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ],
    productGroups: [
      { id: 'g-napa', name: 'NAPA SOFT', dimensions_length: null, dimensions_width: null, dimensions_unit: null },
      { id: 'g-forro', name: 'NAPA FORRO', dimensions_length: null, dimensions_width: null, dimensions_unit: null },
      { id: 'g-eva', name: 'EVA PLACA', dimensions_length: 100, dimensions_width: 50, dimensions_unit: 'cm' },
      { id: 'g-cola', name: 'COLA', dimensions_length: null, dimensions_width: null, dimensions_unit: null },
    ],
    componentSheets: [
      { product_id: 'cs-napa', dimensions_width: 1.0, dimensions_length: 0, dimensions_unit: 'm', yield_per_size: {}, yield_per_sole: null, waste_pct: 0, products: { group_id: 'g-napa', name: 'NAPA SOFT PRETO', color: 'PRETO', unit: 'm' } },
      { product_id: 'cs-forro', dimensions_width: 0.5, dimensions_length: 0, dimensions_unit: 'm', yield_per_size: {}, yield_per_sole: null, waste_pct: 0, products: { group_id: 'g-forro', name: 'NAPA FORRO PRETO', color: 'PRETO', unit: 'm' } },
    ],
    soleColorMap: new Map(),
    palmilhaColorMap: new Map(),
    palmilhaDefaultMap: new Map(),
    liningColorMap: new Map(),
    liningDefaultMap: new Map(),
    sheetStrapsMap: new Map(),
    sheetSoleGroupMap: new Map(),
    soleConjugationsByGroup: new Map(),
    facheteSpecBySole: new Map(),
  };
}

describe('orderConsumption — motor canônico', () => {
  it('calcula cabedal/forração/palmilha(placa+forração)/solado/BOM em unidades físicas', () => {
    const rows = computeConsumptionForItems([buildItem()], buildContext());
    const find = (ct: string, mn: string) => rows.find(r => r.componentType === ct && r.materialName === mn);

    const cabedal = find('Cabedal', 'Cabedal')!;
    expect(cabedal.groupName).toBe('NAPA SOFT');
    expect(cabedal.productUnit).toBe('metro');
    expect(cabedal.totalQuantity).toBeCloseTo(1.44, 6);
    expect(cabedal.widthMissing).toBeFalsy();

    const forr = find('Forração', 'Forração')!;
    expect(forr.productUnit).toBe('metro');
    expect(forr.totalQuantity).toBeCloseTo(1.92, 6);

    const placa = find('Palmilha', 'Palmilha')!;
    expect(placa.groupName).toBe('EVA PLACA');
    expect(placa.productUnit).toBe('placa');
    expect(placa.totalQuantity).toBeCloseTo(2.4, 6);

    // componentType DISTINTO (audit E3 10/06/2026): forro da palmilha é
    // cortado no Corte Forração, não no Corte Palmilha.
    const palmForr = find('Forração Palmilha', 'Forração Palmilha')!;
    expect(palmForr.groupName).toBe('NAPA FORRO');
    expect(palmForr.productUnit).toBe('metro');
    expect(palmForr.totalQuantity).toBeCloseTo(1.44, 6);

    const solado = rows.find(r => r.componentType === 'Solado')!;
    expect(solado.groupName).toBe('SOLADO TR 01');
    expect(solado.productUnit).toBe('par');
    expect(solado.totalQuantity).toBe(24);
    expect(solado.sizeBreakdown).toEqual({ '34': 4, '35': 4, '36': 4, '37': 4, '38': 4, '39': 4 });

    const cola = find('Químicos', 'COLA SUPER')!;
    expect(cola.productUnit).toBe('kg');
    expect(cola.totalQuantity).toBeCloseTo(0.24, 6);
  });

  it('consome cabedal e tiras juntos quando has_straps está habilitado', () => {
    const item = buildItem({
      strap_colors: [{
        id: 'tira-1',
        label: 'TIRA 1',
        group_id: 'g-tira',
        group_name: 'TIRA CHATA 8MM',
        color: 'PRETO',
        consumption: 10,
        consumption_per_size: { '34': 10, '35': 10, '36': 10, '37': 10, '38': 10, '39': 10 },
      }],
      technical_sheets: buildSheet({ has_straps: true }),
    });

    const rows = computeConsumptionForItems([item], buildContext());
    const cabedal = rows.find((row) => row.componentType === 'Cabedal');
    const tira = rows.find((row) => row.componentType === 'Tiras');

    expect(cabedal?.groupName).toBe('NAPA SOFT');
    expect(cabedal?.totalQuantity).toBeCloseTo(1.44, 6);
    expect(tira?.groupName).toBe('TIRA CHATA 8MM');
    expect(tira?.totalQuantity).toBeCloseTo(2.4, 6);
  });

  it('unifica Material 1 + Material 2 quando ambos resolvem para o mesmo SKU', () => {
    const item = buildItem({
      technical_sheets: buildSheet({
        components_accessories: [{
          material: 'NAPA SOFT',
          consumption: 2,
          mandatory: true,
        }],
      }),
    });

    const cabedais = computeConsumptionForItems([item], buildContext())
      .filter((row) => row.componentType === 'Cabedal');

    expect(cabedais).toHaveLength(1);
    expect(cabedais[0].productIds).toEqual(['p-napa-preto']);
    // (6 + 2) dm²/par × 24 pares ÷ 100 dm²/m.
    expect(cabedais[0].totalQuantity).toBeCloseTo(1.92, 6);
  });

  it('consome Material 1 + Material 2 pela grade quando os escalares são zero', () => {
    const perSizeMain = { '34': 5, '35': 5, '36': 5, '37': 5, '38': 5, '39': 5 };
    const perSizeAdditional = { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 };
    const item = buildItem({
      technical_sheets: buildSheet({
        upper_consumption: 0,
        upper_consumption_per_size: perSizeMain,
        components_accessories: [{
          material: 'NAPA SOFT',
          consumption: 0,
          consumption_per_size: perSizeAdditional,
          mandatory: true,
        }],
      }),
    });

    const cabedais = computeConsumptionForItems([item], buildContext())
      .filter((row) => row.componentType === 'Cabedal');

    expect(cabedais).toHaveLength(1);
    expect(cabedais[0].productIds).toEqual(['p-napa-preto']);
    // (5 + 2) dm²/par × 24 pares ÷ 100 dm²/m.
    expect(cabedais[0].totalQuantity).toBeCloseTo(1.68, 6);
  });

  it('não unifica dois SKUs pinados diferentes do mesmo grupo/cor', () => {
    const ctx = buildContext();
    ctx.allProducts.push({
      id: 'p-napa-preto-b', name: 'NAPA SOFT PRETO B', color: 'PRETO',
      group_id: 'g-napa', quantity: 0, reserved_stock: 0, stock_grade: null,
      sole_classification: null,
    } as any);
    const item = buildItem({
      technical_sheets: buildSheet({
        upper_material_product_id: 'p-napa-preto',
        components_accessories: [{
          material: 'NAPA SOFT',
          product_id: 'p-napa-preto-b',
          consumption: 2,
          mandatory: true,
        }],
      }),
    });

    const cabedais = computeConsumptionForItems([item], ctx)
      .filter((row) => row.componentType === 'Cabedal');

    expect(cabedais).toHaveLength(2);
    expect(cabedais.map((row) => row.productIds?.[0]).sort())
      .toEqual(['p-napa-preto', 'p-napa-preto-b']);
    expect(cabedais.reduce((sum, row) => sum + row.totalQuantity, 0)).toBeCloseTo(1.92, 6);
  });

  it('consome sobra de napa de outra espessura como linha própria (CONHAQUE 1.2 + 1.0)', () => {
    const ctx = buildContext();
    ctx.productGroups.push({
      id: 'g-napa-12', name: 'NAPA CONHAQUE 1.2',
      dimensions_length: null, dimensions_width: 1000, dimensions_unit: 'mm',
    } as any);
    ctx.allProducts.push({
      id: 'p-napa-12', name: 'NAPA CONHAQUE 1.2 PRETO', color: 'PRETO',
      group_id: 'g-napa-12', quantity: 0, reserved_stock: 0, stock_grade: null,
      sole_classification: null,
    } as any);
    ctx.componentSheets.push({
      product_id: 'p-napa-12', group_id: 'g-napa-12',
      dimensions_width: 1000, dimensions_unit: 'mm',
    } as any);
    const item = buildItem({
      technical_sheets: buildSheet({
        upper_material: 'NAPA CONHAQUE 1.0',
        upper_material_product_id: 'p-napa-preto',
        components_accessories: [{
          material: 'NAPA CONHAQUE 1.2',
          product_id: 'p-napa-12',
          leftover: true,
          mandatory: true,
          consumption: 2,
        }],
      }),
    });

    const cabedais = computeConsumptionForItems([item], ctx)
      .filter((row) => row.componentType === 'Cabedal');

    expect(cabedais).toHaveLength(2);
    const sobra = cabedais.find((row) => (row.productIds || []).includes('p-napa-12'));
    expect(sobra?.materialName).toMatch(/^Sobra · /);
    expect(cabedais.map((row) => row.productIds?.[0]).sort())
      .toEqual(['p-napa-12', 'p-napa-preto']);
  });

  it('palmilha (placa+forração) vem da spec do SOLADO por número quando preenchida — não do escalar da ficha', () => {
    const ctx = buildContext();
    // Solado resolvido por P3 (primary_sole_id da ficha) → produto p-solado.
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // Specs do solado por numeração (dm²/par) — MESMA fonte que produção/ondas usam.
    ctx.insoleSpecBySole = new Map([['p-solado', { '34': 3, '35': 4, '36': 5, '37': 6, '38': 7, '39': 8 }]]);
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '34': 1, '35': 1.5, '36': 2, '37': 2.5, '38': 3, '39': 3.5 }]]);

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const find = (ct: string, mn: string) => rows.find(r => r.componentType === ct && r.materialName === mn);

    // Placa: Σ(valor_número × 4 pares) = 4×(3+4+5+6+7+8)=132 dm² ÷ 50 dm²/placa = 2.64.
    // (O escalar 5,0 daria 120/50 = 2.40 — prova que veio do solado, por número.)
    const placa = find('Palmilha', 'Palmilha')!;
    expect(placa.totalQuantity).toBeCloseTo(2.64, 6);

    // Forração palmilha: Σ(valor × 4)=4×13.5=54 dm² ÷ 50 (largura 0,5 m) = 1.08 m.
    // (O escalar 3,0 daria 72/50 = 1.44.)
    const palmForr = find('Forração Palmilha', 'Forração Palmilha')!;
    expect(palmForr.totalQuantity).toBeCloseTo(1.08, 6);
  });

  it('PARIDADE por numeração: override da ficha vence mapa canônico do solado e legado *_dm2', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // Fallback legado `*_dm2` do solado (menor precedência que o novo mapa).
    ctx.liningSpecBySole = new Map([['p-solado', { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 }]]);
    ctx.insoleSpecBySole = new Map([['p-solado', { '34': 3, '35': 3, '36': 3, '37': 3, '38': 3, '39': 3 }]]);
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '34': 4, '35': 4, '36': 4, '37': 4, '38': 4, '39': 4 }]]);
    // Padrão canônico do tipo de solado (vence o legado).
    ctx.liningConsumptionPerSizeBySole = new Map([['p-solado', { '34': 5, '35': 5, '36': 5, '37': 5, '38': 5, '39': 5 }]]);
    ctx.insoleConsumptionPerSizeBySole = new Map([['p-solado', { '34': 6, '35': 6, '36': 6, '37': 6, '38': 6, '39': 6 }]]);
    ctx.insoleLiningConsumptionPerSizeBySole = new Map([['p-solado', { '34': 7, '35': 7, '36': 7, '37': 7, '38': 7, '39': 7 }]]);

    // Override por ficha: deve vencer as duas fontes do solado em todos os tamanhos.
    const item = buildItem({ technical_sheets: buildSheet({
      lining_consumption_per_size: { '34': 8, '35': 8, '36': 8, '37': 8, '38': 8, '39': 8 },
      insole_consumption_per_size: { '34': 9, '35': 9, '36': 9, '37': 9, '38': 9, '39': 9 },
      insole_lining_consumption_per_size: { '34': 10, '35': 10, '36': 10, '37': 10, '38': 10, '39': 10 },
    }) });
    const rows = computeConsumptionForItems([item], ctx);

    // Grade base de 6 pares escalada para 24 → 4 pares por numeração.
    expect(rows.find(r => r.componentType === 'Forração')?.totalQuantity).toBeCloseTo(3.84, 6); // 8 × 24 dm² ÷ 50
    expect(rows.find(r => r.componentType === 'Palmilha')?.totalQuantity).toBeCloseTo(4.32, 6); // 9 × 24 dm² ÷ 50
    expect(rows.find(r => r.componentType === 'Forração Palmilha')?.totalQuantity).toBeCloseTo(4.8, 6); // 10 × 24 dm² ÷ 50
  });

  it('mapa canônico do solado vence legado *_dm2 e escalar da ficha sem override por número', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    ctx.liningSpecBySole = new Map([['p-solado', { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 }]]);
    ctx.insoleSpecBySole = new Map([['p-solado', { '34': 3, '35': 3, '36': 3, '37': 3, '38': 3, '39': 3 }]]);
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '34': 4, '35': 4, '36': 4, '37': 4, '38': 4, '39': 4 }]]);
    ctx.liningConsumptionPerSizeBySole = new Map([['p-solado', { '34': 5, '35': 5, '36': 5, '37': 5, '38': 5, '39': 5 }]]);
    ctx.insoleConsumptionPerSizeBySole = new Map([['p-solado', { '34': 6, '35': 6, '36': 6, '37': 6, '38': 6, '39': 6 }]]);
    ctx.insoleLiningConsumptionPerSizeBySole = new Map([['p-solado', { '34': 7, '35': 7, '36': 7, '37': 7, '38': 7, '39': 7 }]]);

    const rows = computeConsumptionForItems([buildItem()], ctx);

    // Sem *_consumption_per_size na ficha: 5/6/7 (canônico) vencem 2/3/4
    // (legado) e 4/5/3 (escalares da ficha), respectivamente.
    expect(rows.find(r => r.componentType === 'Forração')?.totalQuantity).toBeCloseTo(2.4, 6);
    expect(rows.find(r => r.componentType === 'Palmilha')?.totalQuantity).toBeCloseTo(2.88, 6);
    expect(rows.find(r => r.componentType === 'Forração Palmilha')?.totalQuantity).toBeCloseTo(3.36, 6);
  });

  it('tamanho ausente no mapa canônico cai no legado do solado e depois no escalar da ficha', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // 34 vem do mapa canônico; 35 só existe no legado; 36–39 caem no escalar 5.
    ctx.insoleConsumptionPerSizeBySole = new Map([['p-solado', { '34': 8 }]]);
    ctx.insoleSpecBySole = new Map([['p-solado', { '35': 6 }]]);

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const insole = rows.find(r => r.componentType === 'Palmilha')!;

    // 4 pares por tamanho × (8 canônico + 6 legado + 4×5 escalar) = 136 dm²;
    // a placa do contexto mede 50 dm².
    expect(insole.totalQuantity).toBeCloseTo(136 / 50, 6);
  });

  it('grade 33/34 casa consumo por numeração conjugada da ficha (cabedal)', () => {
    const item = buildItem({
      quantity: 10,
      grade: { '33': 4, '34': 6 },
      technical_sheets: buildSheet({
        upper_consumption: 99,
        upper_consumption_per_size: { '33/34': 5 },
      }),
    });
    const rows = computeConsumptionForItems([item], buildContext());
    const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
    expect(cabedal.totalQuantity).toBeCloseTo(50 / 100, 6);
  });

  it('zero explícito no consumo por numeração do cabedal não cai no escalar', () => {
    const item = buildItem({
      quantity: 8,
      grade: { '36': 4, '38': 4 },
      technical_sheets: buildSheet({
        upper_consumption: 6,
        upper_consumption_per_size: { '36': 0, '38': 5 },
      }),
    });
    const rows = computeConsumptionForItems([item], buildContext());
    const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
    expect(cabedal.totalQuantity).toBeCloseTo(20 / 100, 6);
  });

  it('PV-00125 CF 09 PRETO: motor da tela casa grade conjugada da ficha', () => {
    const item = buildItem({
      quantity: 12,
      fichas: 1,
      color: 'PRETO',
      grade: { '35': 2, '36': 2, '37': 3, '38': 2, '33/34': 1, '39/40': 2 },
      technical_sheets: buildSheet({
        upper_consumption: 20,
        upper_consumption_per_size: {
          '35': 20, '36': 20, '37': 20, '38': 20, '33/34': 20, '39/40': 20,
        },
      }),
    });
    const rows = computeConsumptionForItems([item], buildContext());
    const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
    // 12 pares × 20 dm² = 240 dm² ÷ 100 dm/m (largura 1 m) = 2.40 m
    expect(cabedal.totalQuantity).toBeCloseTo(2.4, 6);
  });

  it('forração de palmilha do SOLADO é emitida mesmo com insole_lining_consumption escalar = 0', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 }]]);
    const item = buildItem({ technical_sheets: buildSheet({ insole_lining_consumption: 0 }) });
    const rows = computeConsumptionForItems([item], ctx);
    const palmForr = rows.find(r => r.componentType === 'Forração Palmilha');
    expect(palmForr).toBeDefined();
    // Σ(2 × 4 pares)=48 dm² ÷ 50 = 0.96 m.
    expect(palmForr!.totalQuantity).toBeCloseTo(0.96, 6);
  });

  it('solado FACHETADO sem specs de fachete emite linha de AVISO (qtd 0), espelhando o SQL', () => {
    // Antes o motor de UI OMITIA silenciosamente o fachete quando o solado
    // fachetado não tinha consumo cadastrado → forração extra do salto sumia.
    // Agora emite uma linha neutra com `warning` (o modal a mostra em âmbar; a
    // ficha do operador a filtra). Espelha o consumption_warning do SQL by_grade.
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-sole-fach']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-sole-fach', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, is_fachetado: true },
    ];
    ctx.productGroups = [...ctx.productGroups, { id: 'g-solado', name: 'SOLADO TR 01', dimensions_length: null, dimensions_width: null, dimensions_unit: null }];
    // facheteSpecBySole permanece VAZIO → solado fachetado SEM consumo cadastrado.
    const rows = computeConsumptionForItems([buildItem()], ctx);
    const fachete = rows.find(r => r.componentType === 'Fachete');
    expect(fachete).toBeDefined();
    expect(fachete!.totalQuantity).toBe(0);
    expect(fachete!.warning).toBeTruthy();
  });

  it('sem spec de palmilha no solado, mantém o escalar da ficha (comportamento antigo)', () => {
    const rows = computeConsumptionForItems([buildItem()], buildContext());
    const placa = rows.find(r => r.componentType === 'Palmilha' && r.materialName === 'Palmilha')!;
    expect(placa.totalQuantity).toBeCloseTo(2.4, 6);
    const palmForr = rows.find(r => r.componentType === 'Forração Palmilha')!;
    expect(palmForr.totalQuantity).toBeCloseTo(1.44, 6);
  });

  // Anti-duplicidade FORRAÇÃO (cabedal × palmilha) — espelha o SQL by_grade
  // (migration 20260911120000). Ver auditoria PV-00146 (2026-07-10).
  it('SUPRIME a Forração (cabedal) fantasma quando o solado dirige o forro de PALMILHA e não tem forro de cabedal', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // Solado tem forro de PALMILHA (insole_lining) mas NÃO de cabedal (lining).
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 }]]);
    // liningSpecBySole (forro de cabedal do solado) permanece VAZIO.
    const item = buildItem({ technical_sheets: buildSheet({ sole_drives_consumption: true, lining_consumption: 5.7 }) });
    const rows = computeConsumptionForItems([item], ctx);
    // A Forração (cabedal) do escalar da ficha seria a MESMA napa do forro da
    // palmilha, contada 2× → suprimida.
    expect(rows.find(r => r.componentType === 'Forração')).toBeUndefined();
    // A Forração Palmilha (forro real) permanece.
    expect(rows.find(r => r.componentType === 'Forração Palmilha')).toBeDefined();
  });

  it('MANTÉM a Forração (cabedal) quando o solado NÃO tem forro de palmilha (calçado fechado, forro real)', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO TR 01 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // Solado SEM forro de palmilha (insoleLiningSpecBySole vazio) → gate não dispara.
    const item = buildItem({ technical_sheets: buildSheet({ sole_drives_consumption: true, lining_consumption: 5.7, insole_lining_consumption: 0 }) });
    const rows = computeConsumptionForItems([item], ctx);
    expect(rows.find(r => r.componentType === 'Forração')).toBeDefined();
  });

  it('PARIDADE: as bulk rows da ficha preservam required == totalQuantity do modal (1:1)', () => {
    const modalRows = computeConsumptionForItems([buildItem()], buildContext());
    const bulk = modalRows.map(toBulkConsumptionRow);

    expect(bulk).toHaveLength(modalRows.length);
    modalRows.forEach((m, i) => {
      expect(bulk[i].required).toBeCloseTo(m.totalQuantity, 9);
      expect(bulk[i].unit).toBe(m.productUnit);
      expect(bulk[i].product_name).toBe(m.groupName || m.materialName);
    });

    const sumModal = modalRows.reduce((s, r) => s + r.totalQuantity, 0);
    const sumBulk = bulk.reduce((s, r) => s + r.required, 0);
    expect(sumBulk).toBeCloseTo(sumModal, 9);
  });

  it('Corte Fibra exibe a placa; Corte Forração recebe a forração da palmilha (E3)', () => {
    const bulk = computeConsumptionForItems([buildItem()], buildContext()).map(toBulkConsumptionRow);
    const palmilha = filterConsumptionForSector(bulk, 'Corte Fibra');

    // Só a PLACA — a forração da palmilha é corte do setor Corte Forração.
    expect(palmilha.every(r => r.component === 'Palmilha')).toBe(true);
    expect(palmilha.map(r => r.product_name)).toContain('EVA PLACA');
    expect(palmilha.find(r => r.component === 'Forração Palmilha')).toBeUndefined();
    expect(palmilha.find(r => r.product_name === 'SOLADO TR 01')).toBeUndefined();
    expect(palmilha.find(r => r.component === 'Cabedal')).toBeUndefined();
    expect(palmilha.find(r => r.component === 'Químicos')).toBeUndefined();

    const forracao = filterConsumptionForSector(bulk, 'Corte Forração');
    expect(forracao.find(r => r.component === 'Forração Palmilha')).toBeDefined();
    expect(forracao.find(r => r.component === 'Forração')).toBeDefined();
    expect(forracao.find(r => r.component === 'Palmilha')).toBeUndefined();
  });

  it('Aviamento vê cabedal + forro, mas não a forração da palmilha (E4)', () => {
    const bulk = computeConsumptionForItems([buildItem()], buildContext()).map(toBulkConsumptionRow);
    const aviamento = filterConsumptionForSector(bulk, 'Aviamento');
    expect(aviamento.find(r => r.component === 'Cabedal')).toBeDefined();
    expect(aviamento.find(r => r.component === 'Forração')).toBeDefined();
    expect(aviamento.find(r => r.component === 'Forração Palmilha')).toBeUndefined();
    expect(aviamento.find(r => r.component === 'Solado')).toBeUndefined();
  });

  it('palmilha pronta (insole_ready_made) não gera nenhuma linha de palmilha', () => {
    const item = buildItem({ technical_sheets: buildSheet({ insole_ready_made: true }) });
    const rows = computeConsumptionForItems([item], buildContext());
    expect(rows.find(r => r.componentType === 'Palmilha')).toBeUndefined();
    expect(rows.find(r => r.componentType === 'Forração Palmilha')).toBeUndefined();
    // mas mantém cabedal/forração/solado normalmente
    expect(rows.find(r => r.componentType === 'Cabedal')).toBeDefined();
    expect(rows.find(r => r.componentType === 'Solado')).toBeDefined();
  });

  // ── Embalagem canônica por packaging_mode/slots UUID ──────────────────────
  // As duas caixas antigas continuam no BOM para preservar histórico, mas a
  // allow-list estrutural as remove do cálculo operacional. A linha exibida
  // vem exclusivamente do slot box_types do grupo de solado.
  function ctxComCaixas(): ConsumptionContext {
    const ctx = buildContext();
    ctx.materials = [
      ...ctx.materials,
      { sheet_id: 'sheet-1', product_id: 'p-cx-colmeia', group_id: 'g-embal', quantity_per_unit: 0.083, color: null, products: { name: 'CAIXA COLMEIA 11', unit: 'un', category: 'Embalagem' }, product_groups: { name: 'EMBALAGEM' } },
      { sheet_id: 'sheet-1', product_id: 'p-cx-individual', group_id: 'g-embal', quantity_per_unit: 1, color: null, products: { name: 'CAIXA INDIVIDUAL 11', unit: 'un', category: 'Embalagem' }, product_groups: { name: 'EMBALAGEM' } },
    ];
    ctx.productGroups.push({
      id: 'g-sole', name: 'SOLADO 11', dimensions_length: null, dimensions_width: null,
      dimensions_unit: null, box_type_id: 'bt-individual', box_type_master_id: 'bt-master',
      box_type_colmeia_id: 'bt-colmeia', box_type_fitilho_id: 'bt-fitilho',
      pairs_per_box_individual: 1, pairs_per_box_master: 12,
      pairs_per_box_colmeia: 12, pairs_per_box_fitilho: 12,
    });
    ctx.boxTypes = [
      { id: 'bt-individual', nome: 'CAIXA INDIVIDUAL 11', tipo: 'individual', quantity: 100, unit_price: 1, active: true },
      { id: 'bt-master', nome: 'CAIXA MASTER 11', tipo: 'master', quantity: 100, unit_price: 8, active: true },
      { id: 'bt-colmeia', nome: 'CAIXA COLMEIA 11', tipo: 'colmeia', quantity: 100, unit_price: 4, active: true },
      { id: 'bt-fitilho', nome: 'FITILHO', tipo: 'fitilho', quantity: 100, unit_price: 0.2, active: true, metros_per_amarrado_default: 1.5 },
    ];
    ctx.legacyPackagingProductIds = new Set(['p-cx-colmeia', 'p-cx-individual']);
    return ctx;
  }

  it('packaging_mode colmeia → mostra só CAIXA COLMEIA (não soma a individual)', () => {
    const item = buildItem({
      packagingMode: 'colmeia',
      technical_sheets: buildSheet({ sole_group_id: 'g-sole' }),
    });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1);
    expect(embal[0].materialName).toBe('CAIXA COLMEIA 11');
    // Regra de sobra por numeração: a grade de 6 pares é menor que a caixa de
    // 12; cada uma das 4 fichas viaja como uma caixa parcial.
    expect(embal[0].totalQuantity).toBe(4);
  });

  it('packaging_mode individual → mostra só CAIXA INDIVIDUAL', () => {
    const item = buildItem({
      packagingMode: 'individual',
      technical_sheets: buildSheet({ sole_group_id: 'g-sole' }),
    });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1);
    expect(embal[0].materialName).toBe('CAIXA INDIVIDUAL 11');
    expect(embal[0].totalQuantity).toBeCloseTo(24, 6);
  });

  it('individual_fitilho → mostra somente individual + fitilho em metros', () => {
    const item = buildItem({
      packagingMode: 'individual_fitilho',
      technical_sheets: buildSheet({ sole_group_id: 'g-sole' }),
    });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(2);
    const individual = embal.find(r => r.materialName === 'CAIXA INDIVIDUAL 11');
    const fitilho = embal.find(r => r.materialName === 'FITILHO');
    expect(individual?.totalQuantity).toBeCloseTo(24, 6);
    expect(fitilho?.productUnit).toBe('m');
    expect(fitilho?.totalQuantity).toBe(3);
  });

  it('SEM packaging_mode falha fechado e não escolhe nenhuma caixa do BOM', () => {
    const item = buildItem({ technical_sheets: buildSheet({ sole_group_id: 'g-sole' }) });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1);
    expect(embal[0]).toMatchObject({
      materialName: 'Embalagem não resolvida',
      totalQuantity: 0,
    });
    expect(embal[0].warning).toContain('Modo de embalagem');
  });

  it('produtos distintos no mesmo grupo/cor/unidade NÃO se fundem (PV-00147: dois binóculos)', () => {
    // "Binóculo 10mm" e "Binóculo 10mm Strass" vivem em COMPONENTES DIVERSOS,
    // ambos OURO LIGHT/un. A chave do acumulador não tinha o nome do material,
    // então o segundo caía em cima do primeiro: 4+4 un/par numa linha só e o
    // Strass sumia do modal de Consumo e da ficha de operador.
    const ctx = buildContext();
    ctx.allProducts.push(
      { id: 'p-bino', name: 'Binóculo 10mm', color: 'OURO LIGHT', group_id: 'g-comp', quantity: 0, reserved_stock: 0, unit: 'un', category: 'Componente' },
      { id: 'p-bino-strass', name: 'Binóculo 10mm Strass', color: 'OURO LIGHT', group_id: 'g-comp', quantity: 0, reserved_stock: 0, unit: 'un', category: 'Componente' },
    );
    ctx.productGroups.push({ id: 'g-comp', name: 'COMPONENTES DIVERSOS', dimensions_length: null, dimensions_width: null, dimensions_unit: null });
    const sheet = { ...buildSheet(), direct_components: [
      { product_id: 'p-bino', quantity: 4, unit: 'un' },
      { product_id: 'p-bino-strass', quantity: 4, unit: 'un' },
    ] };

    const rows = computeConsumptionForItems([buildItem({ technical_sheets: sheet })], ctx);
    const binos = rows.filter(r => r.groupName === 'COMPONENTES DIVERSOS');
    expect(binos).toHaveLength(2);
    expect(binos.map(r => r.materialName).sort()).toEqual(['Binóculo 10mm', 'Binóculo 10mm Strass']);
    for (const r of binos) expect(r.totalQuantity).toBeCloseTo(24 * 4, 6);
  });

  it('deduplica product_id repetido no fallback de direct_components (PV-00162/NL03)', () => {
    // A ficha viva tinha a mesma entrada ELÁSTICO 6MM, 20 cm/par, repetida 3×
    // no JSON. O SQL usa v_dc_seen e calcula 24×20 = 480 cm; o TS somava as
    // três cópias e mostrava 1.440 cm no relatório.
    const ctx = buildContext();
    ctx.allProducts.push({
      id: 'p-elastico', name: 'ELÁSTICO 6MM', color: 'PRETO', group_id: 'g-comp',
      quantity: 0, reserved_stock: 0, unit: 'cm', category: 'Componente',
    } as any);
    ctx.productGroups.push({
      id: 'g-comp', name: 'COMPONENTES', dimensions_length: null,
      dimensions_width: null, dimensions_unit: null,
    } as any);
    const duplicated = { product_id: 'p-elastico', quantity: 20, unit: 'cm' };
    const sheet = { ...buildSheet(), direct_components: [duplicated, duplicated, duplicated] };

    const rows = computeConsumptionForItems([buildItem({ technical_sheets: sheet })], ctx);
    const elastico = rows.filter((r) => r.productIds?.includes('p-elastico'));
    expect(elastico).toHaveLength(1);
    expect(elastico[0].totalQuantity).toBe(24 * 20);
  });

  it('solado fachetado gera linha Fachete (forração extra) convertida dm²→metro', () => {
    // Espelha o ramo de calculate_order_consumption (SQL). Solado is_fachetado
    // com fachete_lining_consumption_dm2 = 2 dm²/par em todas as numerações.
    // grade soma 6 → 4 fichas; 6 nº × 4 pares × 2 dm² = 48 dm². Material de
    // forração = NAPA FORRO (largura 0,5 m → 50 dm²/m): 48 ÷ 50 = 0,96 m.
    const ctx = buildContext();
    ctx.allProducts.push({
      id: 'p-sole-fach', name: 'SOLADO FACH', color: 'PRETO', group_id: 'g-sole',
      quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null,
      is_fachetado: true, fachete_material_group_id: null,
    } as any);
    ctx.soleColorMap.set('sheet-1::PRETO', 'p-sole-fach');
    ctx.facheteSpecBySole.set('p-sole-fach', { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 });

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const fachete = rows.find(r => r.componentType === 'Fachete');
    expect(fachete).toBeDefined();
    expect(fachete!.groupName).toBe('NAPA FORRO');
    expect(fachete!.productUnit).toBe('metro');
    expect(fachete!.totalQuantity).toBeCloseTo(0.96, 6);
    expect(fachete!.widthMissing).toBeFalsy();

    // Solado normal sem is_fachetado NÃO gera Fachete.
    const ctx2 = buildContext();
    ctx2.allProducts.push({
      id: 'p-sole-plain', name: 'SOLADO PLAIN', color: 'PRETO', group_id: 'g-sole',
      quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null,
      is_fachetado: false, fachete_material_group_id: null,
    } as any);
    ctx2.soleColorMap.set('sheet-1::PRETO', 'p-sole-plain');
    ctx2.facheteSpecBySole.set('p-sole-plain', { '37': 2 });
    const rows2 = computeConsumptionForItems([buildItem()], ctx2);
    expect(rows2.find(r => r.componentType === 'Fachete')).toBeUndefined();
  });

  it('solado listado no BOM não duplica o solado da ficha (sem bloco fantasma)', () => {
    // Repro PV-00141: o produto-solado ("01", categoria Solado) também aparece
    // no sheet_materials da ref. Antes virava um bloco de Solado fantasma somado
    // ao solado real da ficha. Com a ficha definindo sole_material/consumption,
    // o BOM-solado deve ser ignorado.
    const ctx = buildContext();
    ctx.materials.push({
      sheet_id: 'sheet-1', product_id: 'p-sole-bom', group_id: null,
      quantity_per_unit: 1, color: '',
      products: { name: '01', unit: 'par', category: 'Solado' },
      product_groups: null,
    } as any);

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const soles = rows.filter(r => r.componentType === 'Solado');
    // Apenas a linha vinda da ficha (1 par/par × 24), nada de bloco extra.
    expect(soles).toHaveLength(1);
    expect(soles[0].totalQuantity).toBe(24);
    expect(soles[0].groupName).toBe('SOLADO TR 01');
  });

  it('oculta napa de área do BOM cadastrada em cor que não é a do pedido', () => {
    // Repro PV-00141 (NUDE): o BOM trazia NAPA SANTORINE/ABACATE e NAPA SOFT/
    // ADOCICADO, cores estranhas ao pedido. Devem ser ocultadas; uma napa na
    // cor do pedido continua aparecendo.
    const ctx = buildContext();
    ctx.materials.push(
      { sheet_id: 'sheet-1', product_id: 'p-sant', group_id: 'g-sant', quantity_per_unit: 5.7, color: 'ABACATE',
        products: { name: 'NAPA SANTORINE', unit: 'm', category: 'Cabedal' }, product_groups: { name: 'NAPA SANTORINE' } } as any,
      { sheet_id: 'sheet-1', product_id: 'p-preto', group_id: 'g-napa2', quantity_per_unit: 5.7, color: 'PRETO',
        products: { name: 'NAPA EXTRA', unit: 'm', category: 'Cabedal' }, product_groups: { name: 'NAPA EXTRA' } } as any,
    );
    const rows = computeConsumptionForItems([buildItem({ color: 'PRETO' })], ctx);
    const cabedalGroups = rows.filter(r => r.componentType === 'Cabedal').map(r => r.groupName);
    expect(cabedalGroups).not.toContain('NAPA SANTORINE'); // cor ABACATE ≠ PRETO
    expect(cabedalGroups).toContain('NAPA EXTRA');          // cor PRETO == pedido
  });

  it('oculta tira do BOM cadastrada em cor que não é a do pedido (mantém a sem cor)', () => {
    // Repro PV-00141 (NUDE): o BOM trazia "Tira chata 8mm: COBRE", "Tira chata
    // 25mm: Caramelo/Off White" e "Tira chata 8mm: Ouro Light" — sobras de outra
    // colorway. Devem sumir; uma tira na cor do pedido e uma SEM cor continuam.
    const ctx = buildContext();
    ctx.materials.push(
      { sheet_id: 'sheet-1', product_id: 'p-tira-cobre', group_id: 'g-tira8', quantity_per_unit: 1, color: 'COBRE',
        products: { name: 'Tira chata 8mm: COBRE', unit: 'm', category: 'Componente', color: 'COBRE' }, product_groups: { name: 'Tira chata 8mm' } } as any,
      { sheet_id: 'sheet-1', product_id: 'p-tira-preto', group_id: 'g-tira25', quantity_per_unit: 1, color: 'PRETO',
        products: { name: 'Tira chata 25mm: Preto', unit: 'm', category: 'Componente', color: 'PRETO' }, product_groups: { name: 'Tira chata 25mm' } } as any,
      { sheet_id: 'sheet-1', product_id: 'p-tira-gen', group_id: 'g-tira10', quantity_per_unit: 1, color: '',
        products: { name: 'Tira chata 10mm', unit: 'm', category: 'Componente', color: '' }, product_groups: { name: 'Tira chata 10mm' } } as any,
    );
    const rows = computeConsumptionForItems([buildItem({ color: 'PRETO' })], ctx);
    const tiraGroups = rows.filter(r => r.componentType === 'Tiras').map(r => r.groupName);
    expect(tiraGroups).not.toContain('Tira chata 8mm');  // cor COBRE ≠ PRETO
    expect(tiraGroups).toContain('Tira chata 25mm');      // cor PRETO == pedido
    expect(tiraGroups).toContain('Tira chata 10mm');      // sem cor → sempre entra
  });

  it('mesma peça via direct_components (S-039) e via BOM sem cor (DS12) consolida numa linha', () => {
    // Repro PV-00141: BINÓCULO 6MM aparecia 2× — uma linha cor "DOURADO" (vinda
    // de direct_components, que usa a cor do produto) e outra cor "—" (vinda do
    // BOM, cuja linha não tinha cor). Com o fallback pra cor do produto no BOM,
    // a mesma peça consolida numa única linha somada.
    const ctx = buildContext();
    ctx.productGroups.push({ id: 'g-comp', name: 'COMPONENTES', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
    ctx.allProducts.push({ id: 'p-bino', name: 'BINÓCULO 6MM - DOURADO', color: 'DOURADO', group_id: 'g-comp', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);

    const itemA = buildItem({
      reference_id: 'sheet-A',
      technical_sheets: buildSheet({ id: 'sheet-A', direct_components: [{ product_id: 'p-bino', quantity: 8, unit: 'un', product_name: 'BINÓCULO 6MM - DOURADO' }] }),
    });
    ctx.materials.push({
      sheet_id: 'sheet-B', product_id: 'p-bino', group_id: 'g-comp', quantity_per_unit: 1, color: '',
      products: { name: 'BINÓCULO 6MM - DOURADO', unit: 'un', category: 'Componente', color: 'DOURADO' },
      product_groups: { name: 'COMPONENTES' },
    } as any);
    const itemB = buildItem({ reference_id: 'sheet-B', technical_sheets: buildSheet({ id: 'sheet-B' }) });

    const rows = computeConsumptionForItems([itemA, itemB], ctx);
    const binos = rows.filter(r => (r.materialName || '').includes('BINÓCULO'));
    expect(binos).toHaveLength(1);
    expect(binos[0].color).toBe('DOURADO');
    expect(binos[0].totalQuantity).toBe(8 * 24 + 1 * 24); // 192 (direct) + 24 (BOM) = 216
  });

  describe('componentes por cor (opt-in) — paridade com o SQL', () => {
    // Espelha o gate de calculate_order_consumption_by_grade: com a flag ligada e
    // mapeamento pra a cor do pedido, a lista por cor SUBSTITUI direct_components.
    function ctxComponentColors(): ConsumptionContext {
      const ctx = buildContext();
      ctx.productGroups.push({ id: 'g-comp', name: 'COMPONENTES', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push(
        { id: 'p-turq', name: 'ABS TURQUEZA AZUL 12MM', color: '', group_id: 'g-comp', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
        { id: 'p-marrom', name: 'ABS MARROM 12MM', color: '', group_id: 'g-comp', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
        { id: 'p-perola', name: 'REDONDO PEROLA 12MM', color: '', group_id: 'g-comp', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
        { id: 'p-fallback', name: 'ELASTICO PADRAO', color: '', group_id: 'g-comp', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
      );
      ctx.componentColorMap = new Map([
        ['sheet-C::caramelo', [{ productId: 'p-turq', quantityPerUnit: 8 }, { productId: 'p-marrom', quantityPerUnit: 8 }]],
        ['sheet-C::off white', [{ productId: 'p-perola', quantityPerUnit: 8 }, { productId: 'p-marrom', quantityPerUnit: 8 }]],
      ]);
      return ctx;
    }
    const sheetC = (over: Record<string, any> = {}) => buildSheet({
      id: 'sheet-C', component_colors_enabled: true,
      direct_components: [{ product_id: 'p-fallback', quantity: 2, unit: 'un', product_name: 'ELASTICO PADRAO' }],
      ...over,
    });
    // O modal agrega componentes por grupo+cor+unidade (Turqueza e Marrom, ambos
    // grupo COMPONENTES sem cor, fundem numa linha somada com o nome do 1º). O
    // DÉBITO (SQL) permanece por product_id — a paridade aqui é sobre a QUANTIDADE
    // agregada por cor + qual produto lidera a linha, o suficiente pra distinguir
    // Caramelo (Turqueza) de Off White (Pérola) e do fallback (Elástico).
    const compTotal = (rows: any[]) =>
      rows.filter(r => r.groupName === 'COMPONENTES').reduce((s: number, r: any) => s + r.totalQuantity, 0);
    const compNames = (rows: any[]) => rows.filter(r => r.groupName === 'COMPONENTES').map(r => r.materialName || '');

    it('Caramelo debita Turqueza + Marrom (16/par no total), sem Pérola nem fallback', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'CARAMELO', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      expect(compTotal(rows)).toBe((8 + 8) * 24); // 384 (turq 8 + marrom 8) × 24 pares
      expect(compNames(rows).some(n => n.includes('TURQUEZA'))).toBe(true);
      expect(compNames(rows).some(n => n.includes('PEROLA'))).toBe(false);
      expect(compNames(rows).some(n => n.includes('ELASTICO PADRAO'))).toBe(false);
    });

    it('Off White debita Pérola + Marrom (16/par no total), sem Turqueza', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'OFF WHITE', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      expect(compTotal(rows)).toBe((8 + 8) * 24); // 384 (perola 8 + marrom 8)
      expect(compNames(rows).some(n => n.includes('PEROLA'))).toBe(true);
      expect(compNames(rows).some(n => n.includes('TURQUEZA'))).toBe(false);
    });

    it('cor sem mapeamento cai no fallback direct_components', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'AZUL', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      expect(compTotal(rows)).toBe(2 * 24); // 48 (só o Elástico padrão)
      expect(compNames(rows).some(n => n.includes('ELASTICO PADRAO'))).toBe(true);
      expect(compNames(rows).some(n => n.includes('TURQUEZA') || n.includes('PEROLA'))).toBe(false);
    });

    it('cor sem mapeamento MARCA aviso na linha (PV-00147/DS22 — CAPUCCINO)', () => {
      // Regressão PV-00147: DS22 tinha a flag ligada e só OFF WHITE mapeado; o
      // item CAPUCCINO caiu no fallback e puxou ABS MARROM + ABS TURQUEZA (as
      // DUAS cores do mesmo ornamento) = 16/par em vez de 8/par. A quantidade
      // continua a do fallback (paridade com o SQL, que já gravou as reservas),
      // mas a linha precisa vir MARCADA pra a tela não exibir consumo inflado
      // como se fosse normal.
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'AZUL', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      const comp = rows.filter(r => r.groupName === 'COMPONENTES');
      expect(comp.length).toBeGreaterThan(0);
      expect(comp.every(r => !!r.warning)).toBe(true);
      expect(comp[0].warning).toContain('AZUL');
      expect(comp[0].warning).toMatch(/sem mapeamento/i);
    });

    it('cor MAPEADA não emite aviso de mapeamento faltando', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'OFF WHITE', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      const comp = rows.filter(r => r.groupName === 'COMPONENTES');
      expect(comp.some(r => /sem mapeamento/i.test(r.warning || ''))).toBe(false);
    });

    it('ficha SEM a flag ligada não emite aviso de mapeamento (não é o caso do bug)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'AZUL', technical_sheets: sheetC({ component_colors_enabled: false }) })],
        ctxComponentColors(),
      );
      const comp = rows.filter(r => r.groupName === 'COMPONENTES');
      expect(comp.some(r => /sem mapeamento/i.test(r.warning || ''))).toBe(false);
    });

    it('flag desligada: ignora o mapeamento e usa direct_components (regressão)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'CARAMELO', technical_sheets: sheetC({ component_colors_enabled: false }) })],
        ctxComponentColors(),
      );
      expect(compTotal(rows)).toBe(2 * 24); // 48 (fallback), mapeamento ignorado
      expect(compNames(rows).some(n => n.includes('ELASTICO PADRAO'))).toBe(true);
      expect(compNames(rows).some(n => n.includes('TURQUEZA'))).toBe(false);
    });

    it('match de cor insensível a acento/caixa/espaços de ponta (≡ SQL unaccent+btrim)', () => {
      // Auditoria 2026-07-09: SQL casa via lower(btrim(extensions.unaccent(...)));
      // o TS deve casar as MESMAS grafias via normalizeColorKey (' Óff Whíte ' →
      // 'off white'). Espaço INTERNO duplicado não casa em nenhum dos dois — é
      // achado de cadastro (cpc_cor_orfa_grupo_predominante), não divergência.
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: ' Óff Whíte ', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      expect(compTotal(rows)).toBe((8 + 8) * 24); // lista da cor, não o fallback
      expect(compNames(rows).some(n => n.includes('PEROLA'))).toBe(true);
      expect(compNames(rows).some(n => n.includes('ELASTICO PADRAO'))).toBe(false);
    });

    it('linha de componente carrega productIds dos produtos de ORIGEM', () => {
      // A disponibilidade (consumptionRows.rowAvailable) mede o estoque SÓ desses
      // ids. Sem eles, a linha caía no match por grupo+cor e — como a cor é '—' —
      // somava o grupo INTEIRO: no PV-00147 a Fivela 12mm (disponível 0) exibia
      // "em estoque 4.241", que era o estoque do Binóculo 10mm Strass, vizinho de
      // grupo em COMPONENTES DIVERSOS.
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-C', color: 'OFF WHITE', technical_sheets: sheetC() })],
        ctxComponentColors(),
      );
      const comp = rows.filter(r => r.groupName === 'COMPONENTES');
      expect(comp.length).toBeGreaterThan(0);
      const ids = comp.flatMap(r => r.productIds || []);
      expect(ids).toContain('p-perola');
      expect(ids).toContain('p-marrom');
      // Só os produtos que ORIGINARAM a linha — nunca os vizinhos de grupo.
      expect(ids).not.toContain('p-turq');
      expect(ids).not.toContain('p-fallback');
    });
  });

  describe('padrões GLOBAIS por cor (component_color_defaults) — paridade com o SQL', () => {
    // Espelha o lookup do by_grade (mig 20260928121000): no fallback de
    // direct_components, regra ativa do GRUPO do componente pra cor do pedido
    // (exata > default) troca o SKU mantendo a quantidade da ficha. A lista
    // por-cor da ficha (technical_sheet_component_colors) sempre vence.
    function ctxGlobalDefaults(): ConsumptionContext {
      const ctx = buildContext();
      ctx.productGroups.push({ id: 'g-strass', name: 'TIRA STRASS 6MM', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push(
        { id: 'p-fundo-transp', name: 'TIRA STRASS 6MM PRETO FUNDO TRANSPARENTE', color: 'PRETO', group_id: 'g-strass', quantity: 10, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
        { id: 'p-fundo-preto', name: 'TIRA STRASS 6MM PRETO FUNDO PRETO', color: 'PRETO', group_id: 'g-strass', quantity: 50, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
        { id: 'p-strass-branco', name: 'TIRA STRASS 6MM BRANCO', color: 'BRANCO', group_id: 'g-strass', quantity: 5, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'un', category: 'Componente' } as any,
      );
      ctx.componentColorDefaultMap = new Map([
        ['g-strass::preta', 'p-fundo-preto'],   // regra exata: cor Preta
        ['g-strass::*', 'p-strass-branco'],     // default (catch-all) do grupo
      ]);
      return ctx;
    }
    const sheetG = (over: Record<string, any> = {}) => buildSheet({
      id: 'sheet-G',
      direct_components: [{ product_id: 'p-fundo-transp', quantity: 4, unit: 'un', product_name: 'TIRA STRASS 6MM PRETO FUNDO TRANSPARENTE' }],
      ...over,
    });
    const strass = (rows: any[]) => rows.filter((r: any) => r.groupName === 'TIRA STRASS 6MM');

    it('regra EXATA troca o SKU mantendo a quantidade da ficha (Preta → fundo preto)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: 'PRETA', technical_sheets: sheetG() })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO PRETO');
      expect(s[0].totalQuantity).toBe(4 * 24); // quantidade da FICHA, intocada
      // Disponibilidade mede o SKU RESOLVIDO, não o original da ficha.
      expect(s[0].productIds).toContain('p-fundo-preto');
      expect(s[0].productIds).not.toContain('p-fundo-transp');
    });

    it('cor sem regra exata cai no DEFAULT (catch-all) do grupo', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: 'VERMELHA', technical_sheets: sheetG() })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('BRANCO');
      expect(s[0].totalQuantity).toBe(4 * 24);
    });

    it('lista por-cor da FICHA vence a regra global', () => {
      const ctx = ctxGlobalDefaults();
      ctx.componentColorMap = new Map([
        ['sheet-G::preta', [{ productId: 'p-fundo-transp', quantityPerUnit: 4 }]],
      ]);
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: 'PRETA', technical_sheets: sheetG({ component_colors_enabled: true }) })],
        ctx,
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO TRANSPARENTE'); // escolha manual da ficha
      expect(s[0].materialName).not.toContain('FUNDO PRETO');
    });

    it('pedido SEM cor não aplica regra (nem o default)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: '', technical_sheets: sheetG() })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO TRANSPARENTE'); // original da ficha
    });

    it('COLAPSO SOMA: 2 entradas do mesmo grupo resolvem pro mesmo SKU e somam', () => {
      // Ficha antiga listando 2 variantes do grupo (4/par + 3/par): com regra pra
      // cor, ambas caem no SKU da regra → UMA linha com 7/par (sem a soma, o
      // dedup derrubaria a 2ª em silêncio e o consumo cairia pela metade).
      const rows = computeConsumptionForItems(
        [buildItem({
          reference_id: 'sheet-G', color: 'PRETA',
          technical_sheets: sheetG({
            direct_components: [
              { product_id: 'p-fundo-transp', quantity: 4, unit: 'un', product_name: 'TIRA STRASS 6MM PRETO FUNDO TRANSPARENTE' },
              { product_id: 'p-strass-branco', quantity: 3, unit: 'un', product_name: 'TIRA STRASS 6MM BRANCO' },
            ],
          }),
        })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO PRETO');
      expect(s[0].totalQuantity).toBe((4 + 3) * 24);
      expect(s[0].productIds).toEqual(['p-fundo-preto']);
    });

    it('regra apontando produto MORTO/inativo mantém o original com aviso', () => {
      const ctx = ctxGlobalDefaults();
      ctx.componentColorDefaultMap = new Map([['g-strass::preta', 'p-apagado']]);
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: 'PRETA', technical_sheets: sheetG() })],
        ctx,
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO TRANSPARENTE'); // original preservado
      expect(s[0].totalQuantity).toBe(4 * 24);
      expect(s[0].warning).toMatch(/regra global/i);
    });

    it('match da regra é insensível a acento/caixa/espaços (≡ SQL unaccent+btrim)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: ' Prêta ', technical_sheets: sheetG() })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO PRETO');
    });

    it('flag de componentes-por-cor LIGADA sem lista pra cor: regra global ainda aplica (e o aviso de cor sem mapeamento permanece)', () => {
      const rows = computeConsumptionForItems(
        [buildItem({ reference_id: 'sheet-G', color: 'PRETA', technical_sheets: sheetG({ component_colors_enabled: true }) })],
        ctxGlobalDefaults(),
      );
      const s = strass(rows);
      expect(s).toHaveLength(1);
      expect(s[0].materialName).toContain('FUNDO PRETO');
      expect(s[0].warning).toMatch(/sem mapeamento/i);
    });
  });

  it('solado agrupa pelo MODELO (grupo) e soma cores embutidas no nome do produto', () => {
    // Grupo "SOLADO 204" com 2 produtos cuja COR vive no nome ("204 - CARAMELO"
    // / "204 - Preto"). Agrupar pelo nome do produto quebraria o mesmo solado em
    // 2 blocos; o motor deve agrupar pelo nome do GRUPO e somar por cor.
    const ctx = buildContext();
    ctx.productGroups.push({ id: 'g-sole-204', name: 'SOLADO 204', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
    ctx.allProducts.push(
      { id: 'sole-204-caramelo', name: '204 - CARAMELO', color: 'CARAMELO', group_id: 'g-sole-204', quantity: 0, reserved_stock: 0, stock_grade: { '34': 10, '35': 10 }, sole_classification: 'conjugado' } as any,
      { id: 'sole-204-preto', name: '204 - Preto', color: 'PRETO', group_id: 'g-sole-204', quantity: 0, reserved_stock: 0, stock_grade: { '34': 5 }, sole_classification: 'conjugado' } as any,
    );
    // Mapeia (sheet, cor) → produto-solado específico, pras duas cores.
    ctx.soleColorMap.set('sheet-1::CARAMELO', 'sole-204-caramelo');
    ctx.soleColorMap.set('sheet-1::PRETO', 'sole-204-preto');

    const sheet = buildSheet({ sole_material: 'SOLADO 204', sole_consumption: 1 });
    const rows = computeConsumptionForItems(
      [
        buildItem({ color: 'CARAMELO', technical_sheets: sheet }),
        buildItem({ color: 'PRETO', technical_sheets: sheet }),
      ],
      ctx,
    );

    const soles = rows.filter(r => r.componentType === 'Solado');
    // Um único MODELO (mesmo groupName) apesar de 2 produtos/cores distintos.
    expect(new Set(soles.map(r => r.groupName))).toEqual(new Set(['SOLADO 204']));
    // Duas linhas (uma por cor), cada uma com seu produto resolvido pro estoque.
    expect(soles).toHaveLength(2);
    const caramelo = soles.find(r => r.color === 'CARAMELO')!;
    const preto = soles.find(r => r.color === 'PRETO')!;
    expect(caramelo.soleProductId).toBe('sole-204-caramelo');
    expect(preto.soleProductId).toBe('sole-204-preto');
    expect(caramelo.totalQuantity).toBe(24);
    expect(preto.totalQuantity).toBe(24);
  });

  it('agregação multi-OP soma quantidades (2 OPs idênticas = 2×)', () => {
    const ctx = buildContext();
    const one = computeConsumptionForItems([buildItem()], ctx);
    const two = computeConsumptionForItems([buildItem(), buildItem()], ctx);
    const soleOne = one.find(r => r.componentType === 'Solado')!;
    const soleTwo = two.find(r => r.componentType === 'Solado')!;
    expect(soleTwo.totalQuantity).toBe(soleOne.totalQuantity * 2);
    expect(soleTwo.sizeBreakdown).toEqual({ '34': 8, '35': 8, '36': 8, '37': 8, '38': 8, '39': 8 });
  });

  // ── (a) Palmilha na unidade de ESTOQUE do produto (auditoria motores 2026-07-01)
  // O único produto vivo de placa (PLACA 1.0 EVA) tem unit='dm²' — débito e
  // estoque operam em dm². Emitir a linha em 'placa' tornava a comparação
  // verde/vermelho do modal ~150× inválida. Quando a unidade de estoque é de
  // ÁREA, a linha sai em dm² cru; 'par' e 'placa' seguem nos demais casos.
  it('palmilha com estoque em dm² (ficha de componente do grupo) emite a linha em dm², não em placas', () => {
    const ctx = buildContext();
    // Espelha o caso vivo: grupo EVA PLACA com ficha de componente cujo produto
    // tem unit='dm²' (PLACA 1.0 EVA). 5 dm²/par × 24 = 120 dm².
    ctx.allProducts.push({ id: 'p-placa-eva', name: 'PLACA 1.0 EVA', unit: 'dm²', color: '', group_id: 'g-eva', quantity: 76, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
    ctx.componentSheets.push({ product_id: 'p-placa-eva', dimensions_width: 1000, dimensions_length: 1500, dimensions_unit: 'mm', yield_per_size: {}, yield_per_sole: null, waste_pct: 0, products: { group_id: 'g-eva', name: 'PLACA 1.0 EVA', color: '', unit: 'dm²' } } as any);

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const placa = rows.find(r => r.componentType === 'Palmilha')!;
    expect(placa.groupName).toBe('EVA PLACA');
    expect(placa.productUnit).toBe('dm2');
    // dm² CRU (comparável 1:1 com products.quantity), sem conversão a placas.
    expect(placa.totalQuantity).toBeCloseTo(120, 6);

    // A Forração Palmilha (napa do forro, linear) NÃO muda com esse fix.
    const palmForr = rows.find(r => r.componentType === 'Forração Palmilha')!;
    expect(palmForr.productUnit).toBe('metro');
    expect(palmForr.totalQuantity).toBeCloseTo(1.44, 6);
  });

  it('palmilha com estoque em dm² via produto ÚNICO do grupo (sem ficha de componente) também emite dm²', () => {
    const ctx = buildContext();
    ctx.allProducts.push({ id: 'p-placa-eva', name: 'PLACA 1.0 EVA', unit: 'dm²', color: '', group_id: 'g-eva', quantity: 76, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const placa = rows.find(r => r.componentType === 'Palmilha')!;
    expect(placa.productUnit).toBe('dm2');
    expect(placa.totalQuantity).toBeCloseTo(120, 6);
  });

  it('palmilha sem forração com produto pinado por cor mantém a linha em par', () => {
    const ctx = buildContext();
    ctx.allProducts.push({ id: 'p-palm-pronta', name: 'PALMILHA PRONTA 123', unit: 'par', color: 'BEGE', group_id: 'g-eva', quantity: 100, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
    ctx.palmilhaColorMap.set('sheet-1::preto', { color: 'BEGE', productId: 'p-palm-pronta' });

    const rows = computeConsumptionForItems([buildItem({ technical_sheets: buildSheet({ insole_has_lining: false }) })], ctx);
    const palm = rows.find(r => r.componentType === 'Palmilha')!;
    expect(palm.productUnit).toBe('par');
    expect(palm.totalQuantity).toBe(24);
    expect(palm.materialName).toBe('PALMILHA PRONTA 123');
  });

  it('palmilha em fabricação prioriza a placa em dm² quando o grupo também contém palmilha pronta', () => {
    const products = [
      { id: 'p-pronta', name: 'PALMILHA: OURO LIGHT', color: 'OURO LIGHT', unit: 'm', group_id: 'g-palmilha', quantity: 90 },
      { id: 'p-placa', name: 'PLACA 1.0 EVA 3.0', color: 'BRANCA', unit: 'dm²', group_id: 'g-palmilha', quantity: 0 },
    ];
    const groups = [{ id: 'g-palmilha', name: 'PALMILHA' }];

    expect(resolveInsoleBaseProductCanonical('PALMILHA', 'PORCELANA', products, groups)?.id)
      .toBe('p-placa');
  });

  it('palmilha com produto PINADO em dm² emite dm² (unidade do produto vence o par legado)', () => {
    const ctx = buildContext();
    ctx.allProducts.push({ id: 'p-placa-pin', name: 'PLACA PINADA', unit: 'dm²', color: 'BEGE', group_id: 'g-eva', quantity: 100, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
    ctx.palmilhaColorMap.set('sheet-1::preto', { color: 'BEGE', productId: 'p-placa-pin' });

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const palm = rows.find(r => r.componentType === 'Palmilha')!;
    expect(palm.productUnit).toBe('dm2');
    expect(palm.totalQuantity).toBeCloseTo(120, 6);
    expect(palm.materialName).toBe('PLACA PINADA');
  });

  it('palmilha SEM unidade de estoque conhecida preserva o legado (placa via dimensões do grupo)', () => {
    // buildContext não tem produto nem ficha de componente no grupo EVA PLACA —
    // unidade desconhecida → segue o golden: 120 dm² ÷ 50 dm²/placa = 2,4 placa.
    const rows = computeConsumptionForItems([buildItem()], buildContext());
    const placa = rows.find(r => r.componentType === 'Palmilha')!;
    expect(placa.productUnit).toBe('placa');
    expect(placa.totalQuantity).toBeCloseTo(2.4, 6);
  });

  // ── (b) Solado nunca some do modal (auditoria motores 2026-07-01) ──────────
  // sole_consumption 0/null zerava o total e addConsumptionRow APAGAVA a linha,
  // enquanto SQL/débito ignoram o campo e baixam 1 par/par. Default = 1.
  it('sole_consumption 0 ou null NÃO apaga o solado — default 1 par/par', () => {
    for (const v of [0, null]) {
      const item = buildItem({ technical_sheets: buildSheet({ sole_consumption: v }) });
      const rows = computeConsumptionForItems([item], buildContext());
      const solado = rows.find(r => r.componentType === 'Solado');
      expect(solado, `sole_consumption=${v}`).toBeDefined();
      expect(solado!.totalQuantity).toBe(24);
      expect(solado!.groupName).toBe('SOLADO TR 01');
      expect(solado!.sizeBreakdown).toEqual({ '34': 4, '35': 4, '36': 4, '37': 4, '38': 4, '39': 4 });
    }
  });

  it('ignora multiplicador legado: duas peças físicas continuam sendo 1 par de estoque', () => {
    const item = buildItem({ technical_sheets: buildSheet({ sole_consumption: 2 }) });
    const rows = computeConsumptionForItems([item], buildContext());
    const solado = rows.find(r => r.componentType === 'Solado')!;
    expect(solado.totalQuantity).toBe(24);
  });

  it('ficha SEM sole_material/consumption mas com solado resolvido por mapping não duplica com o BOM', () => {
    // Com o default de 1 par/par, a linha da ficha passou a existir mesmo sem
    // sole_material — o dedup do BOM-solado precisa cobrir esse caso, senão o
    // mesmo solado aparece 2× (ficha + BOM).
    const ctx = buildContext();
    ctx.productGroups.push({ id: 'g-sole-01', name: 'SOLADO 01', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
    ctx.allProducts.push({ id: 'p-sole-01', name: '01 - PRETO', unit: 'par', color: 'PRETO', group_id: 'g-sole-01', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
    ctx.soleColorMap.set('sheet-1::PRETO', 'p-sole-01');
    ctx.materials.push({
      sheet_id: 'sheet-1', product_id: 'p-sole-01', group_id: 'g-sole-01', quantity_per_unit: 1, color: '',
      products: { name: '01 - PRETO', unit: 'par', category: 'Solado', color: 'PRETO' },
      product_groups: { name: 'SOLADO 01' },
    } as any);

    const item = buildItem({ technical_sheets: buildSheet({ sole_material: '', sole_consumption: 0 }) });
    const rows = computeConsumptionForItems([item], ctx);
    const soles = rows.filter(r => r.componentType === 'Solado');
    expect(soles).toHaveLength(1);
    expect(soles[0].groupName).toBe('SOLADO 01');
    expect(soles[0].totalQuantity).toBe(24);
    expect(soles[0].soleProductId).toBe('p-sole-01');
  });

  describe('variante de material do item (material_variant_id) — paridade com resolvers SQL', () => {
    // Contexto com um SEGUNDO grupo de napa (GLOW METALIC, largura 1,4 m —
    // diferente do 1,0 m da NAPA SOFT) pra provar que a conversão dm²→m usa a
    // ficha de componente do grupo DA VARIANTE, não o da ficha técnica.
    const buildVariantContext = (): ConsumptionContext => {
      const ctx = buildContext();
      ctx.productGroups.push({ id: 'g-glow', name: 'GLOW METALIC', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push({ id: 'p-glow-preto', name: 'GLOW METALIC PRETO', color: 'PRETO', group_id: 'g-glow', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
      ctx.componentSheets.push({ product_id: 'cs-glow', dimensions_width: 1.4, dimensions_length: 0, dimensions_unit: 'm', yield_per_size: {}, yield_per_sole: null, waste_pct: 0, products: { group_id: 'g-glow', name: 'GLOW METALIC PRETO', color: 'PRETO', unit: 'm' } } as any);
      ctx.materialVariantsById = new Map([
        ['var-glow', {
          id: 'var-glow', reference_id: 'sheet-1',
          upper_material_product_id: null, upper_material_group_id: 'g-glow', upper_consumption_override: null,
          lining_material_product_id: null, lining_material_group_id: null, lining_consumption_override: null,
          insole_material_product_id: null, insole_material_group_id: null, insole_consumption_override: null,
          sole_material_product_id: null, sole_consumption_override: null,
          main_material_group_id: null,
        }],
        // Variante que NÃO pina slot nenhum: só o material principal. É a forma
        // das 63 variantes de produção depois do backfill da mig 20261027120000.
        ['var-main', {
          id: 'var-main', reference_id: 'sheet-1',
          upper_material_product_id: null, upper_material_group_id: null, upper_consumption_override: null,
          lining_material_product_id: null, lining_material_group_id: null, lining_consumption_override: null,
          insole_material_product_id: null, insole_material_group_id: null, insole_consumption_override: null,
          sole_material_product_id: null, sole_consumption_override: null,
          main_material_group_id: 'g-glow',
        }],
      ]);
      return ctx;
    };

    it('grupo da variante troca o cabedal e a conversão dm²→m usa a LARGURA do grupo da variante', () => {
      const item = buildItem({ material_variant_id: 'var-glow' });
      const rows = computeConsumptionForItems([item], buildVariantContext());
      const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
      // 6 dm²/par × 24 = 144 dm² ÷ (1400 mm/10) = 1,028571 m (não 1,44 m da NAPA SOFT)
      expect(cabedal.groupName).toBe('GLOW METALIC');
      expect(cabedal.productUnit).toBe('metro');
      expect(cabedal.totalQuantity).toBeCloseTo(144 / 140, 6);
      // Forro NÃO foi trocado pela variante → segue o da ficha.
      const forr = rows.find(r => r.componentType === 'Forração')!;
      expect(forr.groupName).toBe('NAPA FORRO');
      expect(forr.totalQuantity).toBeCloseTo(1.92, 6);
    });

    // ── Material PRINCIPAL da variante (mig 20261027120000) ──────────────────
    // A variante só trocava o SLOT pinado; como as 63 variantes de produção
    // pinaram só o forro, o CABEDAL nunca trocava de família (I110 vendido em
    // GLOW METALIC saía com cabedal NAPA SOFT). O material principal cascateia,
    // mas SÓ nos slots que a ficha liberou — senão a PALHA do cabedal do DS21
    // viraria napa.
    it('material principal troca o cabedal quando a ficha libera o slot', () => {
      const item = buildItem({
        material_variant_id: 'var-main',
        technical_sheets: buildSheet({ variant_drives_upper: true }),
      });
      const rows = computeConsumptionForItems([item], buildVariantContext());
      const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
      expect(cabedal.groupName).toBe('GLOW METALIC');
      expect(cabedal.totalQuantity).toBeCloseTo(144 / 140, 6);
    });

    it('material principal NÃO toca o slot que a ficha não liberou (protege material de identidade)', () => {
      const item = buildItem({
        material_variant_id: 'var-main',
        technical_sheets: buildSheet({ variant_drives_upper: false }),
      });
      const rows = computeConsumptionForItems([item], buildVariantContext());
      const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
      expect(cabedal.groupName).toBe('NAPA SOFT');
      expect(cabedal.totalQuantity).toBeCloseTo(1.44, 6);
    });

    it('em sandália sem cabedal, a tira segue exatamente a Forração efetiva', () => {
      const strap = [{
        id: '1', label: 'FRENTE', color: 'PRETO',
        group_id: 'g-tira', group_name: 'Tira chata 8mm',
        consumption: 58,
        consumption_per_size: { '34': 58, '35': 58, '36': 58, '37': 58, '38': 58, '39': 58 },
      }];
      const item = (variantDrivesLining: boolean) => buildItem({
        material_variant_id: 'var-main',
        strap_colors: strap,
        technical_sheets: buildSheet({
          has_straps: true,
          upper_material: '',
          lining_material: 'NAPA FORRO',
          variant_drives_lining: variantDrivesLining,
        }),
      });

      const fromSheet = computeConsumptionForItems([item(false)], buildVariantContext())
        .find(row => row.componentType === 'Tiras')!;
      const fromVariant = computeConsumptionForItems([item(true)], buildVariantContext())
        .find(row => row.componentType === 'Tiras')!;

      expect(fromSheet.materialFamily).toBe('NAPA FORRO');
      expect(fromVariant.materialFamily).toBe('GLOW METALIC');
    });

    it('só ativa a herança especial com tiras ligadas e cabedal estruturalmente ausente', () => {
      const strap = [{
        id: '1', label: 'FRENTE', color: 'PRETO',
        group_id: 'g-tira', group_name: 'Tira chata 8mm',
        identity_basis: 'reference_base' as const,
        consumption: 58,
      }];
      const family = (sheet: Record<string, unknown>) => computeConsumptionForItems([
        buildItem({
          material_variant_id: 'var-glow',
          strap_colors: strap,
          technical_sheets: buildSheet({
            upper_material: '',
            lining_material: 'NAPA FORRO',
            ...sheet,
          }),
        }),
      ], buildVariantContext()).find(row => row.componentType === 'Tiras')?.materialFamily;

      // Com a regra ativa, o slot Cabedal da variante é ignorado.
      expect(family({ has_straps: true })).toBe('NAPA FORRO');
      // Sem o botão, preserva a precedência geral do resolvedor.
      expect(family({ has_straps: false })).toBe('GLOW METALIC');
      // Um UUID de cabedal também desativa a regra, mesmo com texto vazio.
      expect(family({ has_straps: true, upper_material_group_id: 'g-napa' })).toBe('GLOW METALIC');
      expect(family({ has_straps: true, upper_material_product_id: 'p-napa-preto' })).toBe('GLOW METALIC');
    });

    it('ignora variante inativa ou pertencente a outra referência', () => {
      const strap = [{
        id: '1', label: 'FRENTE', color: 'PRETO',
        group_id: 'g-tira', group_name: 'Tira chata 8mm',
        identity_basis: 'reference_base' as const,
        consumption: 58,
      }];
      const item = buildItem({
        material_variant_id: 'var-main',
        strap_colors: strap,
        technical_sheets: buildSheet({
          has_straps: true,
          upper_material: '',
          lining_material: 'NAPA FORRO',
          variant_drives_lining: true,
        }),
      });
      const familyWith = (variantPatch: Record<string, unknown>) => {
        const ctx = buildVariantContext();
        ctx.materialVariantsById!.set('var-main', {
          ...ctx.materialVariantsById!.get('var-main')!,
          ...variantPatch,
        });
        return computeConsumptionForItems([item], ctx)
          .find(row => row.componentType === 'Tiras')?.materialFamily;
      };

      expect(familyWith({ active: false })).toBe('NAPA FORRO');
      expect(familyWith({ reference_id: 'outra-ficha' })).toBe('NAPA FORRO');
    });

    it('pino do slot vence o material principal (precedência dos resolvers SQL)', () => {
      const ctx = buildVariantContext();
      ctx.productGroups.push({ id: 'g-sudani', name: 'NAPA SUDANI', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.materialVariantsById.set('var-both', {
        ...ctx.materialVariantsById.get('var-main')!,
        id: 'var-both',
        upper_material_group_id: 'g-glow',   // pino do slot
        main_material_group_id: 'g-sudani',  // material principal (perde)
      } as any);
      const item = buildItem({
        material_variant_id: 'var-both',
        technical_sheets: buildSheet({ variant_drives_upper: true }),
      });
      const cabedal = computeConsumptionForItems([item], ctx).find(r => r.componentType === 'Cabedal')!;
      expect(cabedal.groupName).toBe('GLOW METALIC');
    });

    it('item SEM variante no mesmo cálculo mantém o material da ficha (não contamina)', () => {
      const rows = computeConsumptionForItems(
        [buildItem(), buildItem({ material_variant_id: 'var-glow' })],
        buildVariantContext(),
      );
      const cabedais = rows.filter(r => r.componentType === 'Cabedal');
      const daFicha = cabedais.find(r => r.groupName === 'NAPA SOFT')!;
      const daVariante = cabedais.find(r => r.groupName === 'GLOW METALIC')!;
      expect(daFicha.totalQuantity).toBeCloseTo(1.44, 6);
      expect(daVariante.totalQuantity).toBeCloseTo(144 / 140, 6);
    });

    it('produto LEGADO pinado na variante prevalece sobre o grupo e nomeia a linha', () => {
      const ctx = buildVariantContext();
      const v = ctx.materialVariantsById!.get('var-glow')!;
      v.upper_material_product_id = 'p-glow-preto';
      const item = buildItem({ material_variant_id: 'var-glow' });
      const rows = computeConsumptionForItems([item], ctx);
      const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
      expect(cabedal.materialName).toBe('GLOW METALIC PRETO');
      expect(cabedal.groupName).toBe('GLOW METALIC');
    });

    it('override LEGADO de consumo da variante substitui o escalar da ficha', () => {
      const ctx = buildVariantContext();
      const v = ctx.materialVariantsById!.get('var-glow')!;
      v.upper_consumption_override = 3.5; // dm²/par (era 6.0 na ficha)
      const item = buildItem({ material_variant_id: 'var-glow' });
      const rows = computeConsumptionForItems([item], ctx);
      const cabedal = rows.find(r => r.componentType === 'Cabedal')!;
      // 3,5 dm²/par × 24 = 84 dm² ÷ 140 = 0,6 m
      expect(cabedal.totalQuantity).toBeCloseTo(84 / 140, 6);
    });

    it('variante troca o FORRO: Forração E Forração Palmilha saem do grupo da variante', () => {
      const ctx = buildVariantContext();
      ctx.productGroups.push({ id: 'g-forro2', name: 'FORRO PREMIUM', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push({ id: 'p-forro2', name: 'FORRO PREMIUM PRETO', color: 'PRETO', group_id: 'g-forro2', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
      ctx.componentSheets.push({ product_id: 'cs-forro2', dimensions_width: 0.8, dimensions_length: 0, dimensions_unit: 'm', yield_per_size: {}, yield_per_sole: null, waste_pct: 0, products: { group_id: 'g-forro2', name: 'FORRO PREMIUM PRETO', color: 'PRETO', unit: 'm' } } as any);
      const v = ctx.materialVariantsById!.get('var-glow')!;
      v.lining_material_group_id = 'g-forro2';
      const item = buildItem({ material_variant_id: 'var-glow' });
      const rows = computeConsumptionForItems([item], ctx);
      const forr = rows.find(r => r.componentType === 'Forração')!;
      // 4 dm²/par × 24 = 96 dm² ÷ (800 mm/10) = 1,2 m (não 1,92 m do forro da ficha)
      expect(forr.groupName).toBe('FORRO PREMIUM');
      expect(forr.totalQuantity).toBeCloseTo(96 / 80, 6);
      const palmForr = rows.find(r => r.componentType === 'Forração Palmilha')!;
      // 3 dm²/par × 24 = 72 dm² ÷ 80 = 0,9 m
      expect(palmForr.groupName).toBe('FORRO PREMIUM');
      expect(palmForr.totalQuantity).toBeCloseTo(72 / 80, 6);
    });

    it('solado pinado na variante escolhe o modelo e preserva Preto → Preto', () => {
      const ctx = buildVariantContext();
      ctx.productGroups.push({ id: 'g-sole-99', name: 'SOLADO 99', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push({ id: 'p-sole-99', name: '99 - PRETO', unit: 'par', color: 'PRETO', group_id: 'g-sole-99', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
      // Mapping da ficha apontaria outro modelo; o pin escolhe o SOLADO 99 e a
      // regra obrigatória mantém a variante preta dentro desse grupo.
      ctx.allProducts.push({ id: 'p-sole-01', name: '01 - PRETO', unit: 'par', color: 'PRETO', group_id: null, quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
      ctx.soleColorMap.set('sheet-1::PRETO', 'p-sole-01');
      const v = ctx.materialVariantsById!.get('var-glow')!;
      v.sole_material_product_id = 'p-sole-99';
      const item = buildItem({ material_variant_id: 'var-glow' });
      const rows = computeConsumptionForItems([item], ctx);
      const solado = rows.find(r => r.componentType === 'Solado')!;
      expect(solado.soleProductId).toBe('p-sole-99');
      expect(solado.groupName).toBe('SOLADO 99');
    });

    it('BOM por variante: linha específica SUBSTITUI a compartilhada do mesmo produto; linha de OUTRA variante fica fora', () => {
      const ctx = buildVariantContext();
      // Linha compartilhada (COLA 0.01/par) já existe no buildContext. Override
      // da var-glow no MESMO produto com qty maior + linha extra exclusiva.
      ctx.materials.push({
        sheet_id: 'sheet-1', product_id: 'p-cola', group_id: 'g-cola', quantity_per_unit: 0.02, color: null,
        material_variant_id: 'var-glow',
        products: { name: 'COLA SUPER', unit: 'kg', category: 'Quimicos' },
        product_groups: { name: 'COLA' },
      } as any);
      ctx.materials.push({
        sheet_id: 'sheet-1', product_id: 'p-glitter', group_id: 'g-cola', quantity_per_unit: 0.5, color: null,
        material_variant_id: 'var-glow',
        products: { name: 'GLITTER PÓ', unit: 'g', category: 'Quimicos' },
        product_groups: { name: 'COLA' },
      } as any);
      ctx.materials.push({
        sheet_id: 'sheet-1', product_id: 'p-outra', group_id: 'g-cola', quantity_per_unit: 9, color: null,
        material_variant_id: 'var-OUTRA',
        products: { name: 'MATERIAL DE OUTRA VARIANTE', unit: 'un', category: 'Quimicos' },
        product_groups: { name: 'COLA' },
      } as any);

      // COM variante: override (0.02) + exclusiva (0.5), sem a da outra variante.
      const rows = computeConsumptionForItems([buildItem({ material_variant_id: 'var-glow' })], ctx);
      const cola = rows.find(r => r.materialName === 'COLA SUPER')!;
      expect(cola.totalQuantity).toBeCloseTo(0.48, 6); // 0.02 × 24 (não 0.24)
      expect(rows.find(r => r.materialName === 'GLITTER PÓ')!.totalQuantity).toBeCloseTo(12, 6);
      expect(rows.find(r => r.materialName === 'MATERIAL DE OUTRA VARIANTE')).toBeUndefined();

      // SEM variante: só a compartilhada (0.01), nenhuma linha de variante.
      const rowsBase = computeConsumptionForItems([buildItem()], ctx);
      expect(rowsBase.find(r => r.materialName === 'COLA SUPER')!.totalQuantity).toBeCloseTo(0.24, 6);
      expect(rowsBase.find(r => r.materialName === 'GLITTER PÓ')).toBeUndefined();
      expect(rowsBase.find(r => r.materialName === 'MATERIAL DE OUTRA VARIANTE')).toBeUndefined();
    });
  });
});

/**
 * GUARD DE CONTRATO — colunas do fetch (`TECHNICAL_SHEET_CONSUMPTION_COLUMNS`).
 *
 * REGRA CANÔNICA (CLAUDE.md → "Forro/palmilha: fonte de verdade = SOLADO"):
 * toda coluna lida via `sheet.*` em `computeConsumptionForItems` PRECISA estar no
 * `.select()`, senão o campo chega `undefined` em produção e a regra que depende
 * dele vira no-op silencioso (TS loose não acusa símbolo/campo undefined). Foi
 * exatamente o que aconteceu com `sole_drives_consumption`: os testes de supressão
 * acima passam porque `buildSheet` injeta o campo na mão, mas o fetch real (ficha de
 * operador + modal) NÃO o buscava → `suppressCabedalForracao` nunca disparava → a
 * "Forração" (cabedal) fantasma aparecia junto da "Forração Palmilha" no Corte
 * Forração (mesma napa 2×). Bug PV-00146 / 2026-07-15.
 *
 * Este guard é AUTO-DERIVADO: lê o próprio `orderConsumption.ts`, extrai todos os
 * acessos `sheet.*` do motor e trava que cada um está no `.select()`. Assim ele
 * cobre QUALQUER coluna nova que o motor passe a ler — não precisa manter lista à
 * mão (uma lista manual desatualiza e não pega o campo novo esquecido).
 */
describe('orderConsumption — contrato de colunas do fetch', () => {
  const fetchedCols = new Set(
    TECHNICAL_SHEET_CONSUMPTION_COLUMNS.split(',').map(c => c.trim()).filter(Boolean),
  );

  /** Campos que o motor efetivamente lê de `sheet` (fonte: o próprio código, sem
   *  comentários — pra não capturar `sheet.x` citado em documentação). Cobre
   *  `sheet.x`, `sheet?.x`, `(sheet as any).x` e `(sheet as any)?.x`. */
  const sheetFieldsReadByEngine = (): Set<string> => {
    // vitest roda da raiz do repo (root do vitest.config); import.meta.url aqui
    // não é scheme file, então resolvemos pelo cwd.
    const src = readFileSync(resolve(process.cwd(), 'src/lib/orderConsumption.ts'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')          // comentários de bloco
      .replace(/(^|[^:])\/\/.*$/gm, '$1');          // comentários de linha (preserva http://)
    const re = /(?:\(\s*sheet\s+as\s+any\s*\)|\bsheet)\s*\??\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const fields = new Set<string>();
    for (const m of code.matchAll(re)) fields.add(m[1]);
    return fields;
  };

  it('busca TODA coluna que o motor lê via sheet.* (auto-derivado — não desatualiza)', () => {
    const read = sheetFieldsReadByEngine();
    // Sanidade: o motor lê muitos campos de sheet — se a regex achou pouco, ela
    // quebrou e o guard estaria passando vazio (falso verde).
    expect(read.size).toBeGreaterThan(15);
    const missing = [...read].filter(c => !fetchedCols.has(c)).sort();
    expect(
      missing,
      `campos lidos via sheet.* mas AUSENTES de TECHNICAL_SHEET_CONSUMPTION_COLUMNS: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('inclui sole_drives_consumption (anti-duplicidade Forração — migration 20260911120000)', () => {
    expect(fetchedCols.has('sole_drives_consumption')).toBe(true);
  });

  // MESMO guard pro select inline da Lista de Separação (bomConsumption.ts) —
  // ficava sem trava e o mesmo bug do sole_drives_consumption (coluna lida sem
  // estar no .select() → no-op silencioso com TS loose) podia voltar por lá
  // (auditoria 2026-07-19, TEST-1).
  it('bomConsumption: busca TODA coluna que lê via sheet.* (auto-derivado)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/bomConsumption.ts'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const selectMatch = code.match(/\.from\('technical_sheets'\)\s*\.select\('([^']+)'\)/);
    expect(selectMatch, 'select de technical_sheets não encontrado em bomConsumption.ts').toBeTruthy();
    const bomCols = new Set(selectMatch![1].split(',').map(c => c.trim()).filter(Boolean));
    const re = /(?:\(\s*sheet\s+as\s+any\s*\)|\bsheet)\s*\??\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const read = new Set<string>();
    for (const m of code.matchAll(re)) read.add(m[1]);
    expect(read.size).toBeGreaterThan(8);
    const missing = [...read].filter(c => !bomCols.has(c)).sort();
    expect(
      missing,
      `bomConsumption lê via sheet.* colunas AUSENTES do .select(): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * MESMA classe de bug, outro `.select()`: o de `products` (`allProducts`).
   *
   * O guard acima só cobre `sheet.*` (technical_sheets) — e foi por essa fresta
   * que passou o `p.active`: o select de `products` aplica `.eq('active', true)`
   * mas NÃO projeta `active`, então `(p) => p.id === pin && p.active` lia
   * `undefined` em toda linha e o pin de SKU da ficha (Material 1 / Forro 1)
   * NUNCA disparava — anulando o F2-04 em silêncio, com modal/ficha de operador
   * resolvendo por GRUPO enquanto custeio/reserva/débito usavam o SKU pinado.
   * (Auditoria 04/08/2026 — achado independente por dois motores.)
   *
   * Auto-derivado como os demais: qualquer campo novo lido de um produto passa a
   * ser exigido no `.select()` automaticamente.
   */
  it('busca TODA coluna que o motor lê de allProducts via p.* (auto-derivado)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/orderConsumption.ts'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const selectMatch = code.match(/\.from\('products'\)[\s\S]{0,400}?\.select\('([^']+)'\)/);
    expect(selectMatch, "select de products não encontrado em orderConsumption.ts").toBeTruthy();
    const productCols = new Set(selectMatch![1].split(',').map(c => c.trim()).filter(Boolean));
    // `p` é o identificador usado em todos os callbacks sobre allProducts.
    const re = /\bp\s*\??\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const read = new Set<string>();
    for (const m of code.matchAll(re)) read.add(m[1]);
    // Sanidade: se a regex quebrar, o guard passaria vazio (falso verde).
    expect(read.size).toBeGreaterThan(3);
    const missing = [...read].filter(c => !productCols.has(c)).sort();
    expect(
      missing,
      `campos lidos de allProducts via p.* mas AUSENTES do .select() de products: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  // Travas dos fixes da auditoria 2026-07-19 (specs/auditoria-debito-ficha-grade.md):
  // BOM-1 — Lista de Separação emite a Forração da Palmilha (napa da placa);
  // BOM-3 — e aplica a supressão anti-duplicidade cabedal×palmilha;
  // TS-1 — visão de consumo por OP não força fichas=1 (grade base legada
  //        subcontava per-size/tiras ~50×; fichas null usa o fallback exato).
  it('fixes da auditoria de débito não regridem (BOM-1/BOM-3/TS-1)', () => {
    const bomSrc = readFileSync(resolve(process.cwd(), 'src/lib/bomConsumption.ts'), 'utf8');
    expect(bomSrc).toContain("materialName: 'Forração Palmilha'");
    expect(bomSrc).toContain('suppressCabedalForracao');
    expect(bomSrc).toContain('insoleLiningSpecBySole');
    const dialogSrc = readFileSync(resolve(process.cwd(), 'src/components/orders/OrderConsumptionDialog.tsx'), 'utf8');
    expect(dialogSrc).not.toMatch(/fichas:\s*1[,\s]/);
    expect(dialogSrc).toContain('fetchCanonicalConsumptionReport');
    expect(dialogSrc).not.toContain('computeConsumptionForItems');
    const bulkSrc = readFileSync(resolve(process.cwd(), 'src/hooks/useBulkOrderConsumption.ts'), 'utf8');
    expect(bulkSrc).toContain('fetchCanonicalConsumptionReport');
    expect(bulkSrc).not.toContain('computeConsumptionForItems');
  });

  // Segmentação por cor × família de napa (2026-07-22, specs/tira-base-napa-por-
  // ficha-tecnica.md): a base de uma TIRA segue a napa da FICHA da referência
  // (upper/lining). Mesma tira+cor cortada de napas diferentes NÃO colapsa —
  // senão a napa da minoria some (PV-00148: 111,36 m de tira CAPUCCINO puxam
  // NAPA MADRID, não NAPA SOFT).
  it('tira herda a família da ficha (napa) e NÃO colapsa entre napas diferentes', () => {
    const ctx = buildContext();
    const strap = [{
      id: '1', label: 'FRENTE', color: 'CAPUCCINO',
      group_id: 'g-tira', group_name: 'Tira chata 8mm',
      consumption: 58,
      consumption_per_size: { '34': 58, '35': 58, '36': 58, '37': 58, '38': 58, '39': 58 },
    }];
    const soft = buildItem({
      reference_id: 'r-soft', color: 'CAPUCCINO', strap_colors: strap,
      technical_sheets: buildSheet({ upper_material: 'NAPA SOFT' }),
    });
    const madrid = buildItem({
      reference_id: 'r-madrid', color: 'CAPUCCINO', strap_colors: strap,
      technical_sheets: buildSheet({ upper_material: 'NAPA MADRID' }),
    });
    const tiras = computeConsumptionForItems([soft, madrid], ctx)
      .filter(r => r.componentType === 'Tiras' && r.groupName === 'Tira chata 8mm' && r.color === 'CAPUCCINO');
    // Duas linhas — uma por família; sem o gate de família colapsariam em uma só.
    expect(tiras).toHaveLength(2);
    expect(tiras.map(t => t.materialFamily).sort()).toEqual(['NAPA MADRID', 'NAPA SOFT']);
    // Cada linha carrega a mesma metragem (mesma tira/qtd), só muda a napa-base.
    expect(tiras[0].totalQuantity).toBeCloseTo(tiras[1].totalQuantity, 5);
  });

  it('tira comprada pronta mantém grupo próprio e não recebe família de napa', () => {
    const strap = [{
      id: '1', label: 'FRENTE', color: 'PRETO',
      group_id: 'g-tira-pronta', group_name: 'Tira pronta 8mm',
      identity_basis: 'finished_product_group' as const,
      consumption: 58,
    }];
    const item = buildItem({
      strap_colors: strap,
      technical_sheets: buildSheet({ upper_material: '', lining_material: 'NAPA FORRO' }),
    });
    const tira = computeConsumptionForItems([item], buildContext())
      .find(row => row.componentType === 'Tiras')!;

    expect(tira.materialFamily ?? null).toBeNull();
  });

  it('a base estrutural da tira não muda por alternativa legada de Forração/cor', () => {
    const ctx = buildContext();
    ctx.productGroups.push({
      id: 'g-glow', name: 'GLOW METALIC',
      dimensions_length: null, dimensions_width: null, dimensions_unit: null,
    } as any);
    ctx.allProducts.push({
      id: 'p-glow-capuccino', name: 'GLOW METALIC CAPUCCINO', color: 'CAPUCCINO',
      group_id: 'g-glow', quantity: 0, reserved_stock: 0, stock_grade: null,
      sole_classification: null,
    } as any);
    const strap = [{
      id: '1', label: 'FRENTE', color: 'CAPUCCINO',
      group_id: 'g-tira', group_name: 'Tira chata 8mm',
      identity_basis: 'reference_base' as const,
      consumption: 58,
    }];
    const item = buildItem({
      color: 'CAPUCCINO',
      strap_colors: strap,
      technical_sheets: buildSheet({
        upper_material: '',
        lining_material: 'NAPA FORRO',
        lining_accessories: [{ material: 'GLOW METALIC', consumption: 4 }],
      }),
    });
    const rows = computeConsumptionForItems([item], ctx);

    expect(rows.find(row => row.componentType === 'Forração')?.groupName).toBe('GLOW METALIC');
    expect(rows.find(row => row.componentType === 'Tiras')?.materialFamily).toBe('NAPA FORRO');
  });

  // Fallback: sem napa na ficha, a tira segue como antes (uma linha, sem família).
  it('tira sem napa na ficha não ganha família (uma linha só)', () => {
    const ctx = buildContext();
    const strap = [{
      id: '1', label: 'FRENTE', color: 'CAPUCCINO',
      group_id: 'g-tira', group_name: 'Tira chata 8mm',
      consumption: 58, consumption_per_size: { '34': 58, '35': 58, '36': 58, '37': 58, '38': 58, '39': 58 },
    }];
    const a = buildItem({ reference_id: 'a', color: 'CAPUCCINO', strap_colors: strap, technical_sheets: buildSheet({ upper_material: '', lining_material: '' }) });
    const b = buildItem({ reference_id: 'b', color: 'CAPUCCINO', strap_colors: strap, technical_sheets: buildSheet({ upper_material: '', lining_material: '' }) });
    const tiras = computeConsumptionForItems([a, b], ctx)
      .filter(r => r.componentType === 'Tiras' && r.groupName === 'Tira chata 8mm' && r.color === 'CAPUCCINO');
    expect(tiras).toHaveLength(1);
    expect(tiras[0].materialFamily ?? null).toBeNull();
  });
});

/**
 * CONS-8 (auditoria 2026-09-25) — componente que NÃO resolve produto parava de
 * ser emitido e sumia em silêncio do modal, da ficha, da reserva e do débito.
 * Agora vira linha de AVISO (qtd 0 ou marcada), espelhando o `source=unresolved`
 * do SQL `calculate_order_consumption_by_grade` (mig 20260925131000).
 */
describe('orderConsumption — componente não resolvido vira AVISO (CONS-8)', () => {
  it('componente direto com product_id apagado emite linha de aviso (EC06/I90/S-039.)', () => {
    const ctx = buildContext();
    const item = buildItem({
      technical_sheets: buildSheet({
        direct_components: [
          { product_id: 'p-fantasma', product_name: 'BINÓCULO 6MM', quantity: 8, unit: 'un' },
        ],
      }),
    });
    const rows = computeConsumptionForItems([item], ctx);
    const orphan = rows.find(r => r.materialName === 'BINÓCULO 6MM');
    expect(orphan).toBeDefined();
    expect(orphan!.totalQuantity).toBe(0);
    expect(orphan!.warning).toMatch(/não resolve produto ativo/i);
    expect(orphan!.warning).toContain('8/par');
  });

  it('ficha com consumo de palmilha e insole_material vazio emite aviso (NL01–NL04)', () => {
    const ctx = buildContext();
    const item = buildItem({
      technical_sheets: buildSheet({ insole_material: '', insole_consumption: 4.4343 }),
    });
    const rows = computeConsumptionForItems([item], ctx);
    const palm = rows.filter(r => r.componentType === 'Palmilha');
    expect(palm).toHaveLength(1);
    expect(palm[0].totalQuantity).toBe(0);
    expect(palm[0].warning).toMatch(/Material da Palmilha/i);
  });

  it('solado em texto livre sem produto resolvido marca a linha com aviso (BT01/BT02)', () => {
    const ctx = buildContext();
    // buildContext não resolve solado (sem mapping/primary) e a ficha só tem o
    // texto 'SOLADO TR 01' — mesmo caso do "Solado Ricardo Tratorado".
    const rows = computeConsumptionForItems([buildItem()], ctx);
    const solado = rows.find(r => r.componentType === 'Solado')!;
    expect(solado.soleProductId ?? null).toBeNull();
    expect(solado.totalQuantity).toBe(24); // quantidade preservada
    expect(solado.warning).toMatch(/não resolve produto no estoque/i);
  });

  it('tamanho sem spec no solado E escalar 0 avisa que contribuiu ZERO (I90/I91 infantil)', () => {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'INFANTIL', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
    ];
    // Specs só do 39 — a grade do item vai de 34 a 39.
    ctx.insoleLiningSpecBySole = new Map([['p-solado', { '39': 2 }]]);
    const item = buildItem({ technical_sheets: buildSheet({ insole_lining_consumption: 0 }) });
    const rows = computeConsumptionForItems([item], ctx);
    const palmForr = rows.find(r => r.componentType === 'Forração Palmilha')!;
    expect(palmForr.warning).toMatch(/contribuíram ZERO/i);
    expect(palmForr.warning).toContain('34');
  });
});

/**
 * Consumo padrão POR MODELO de solado (`sole_group_standard_items`, 02/08/2026).
 *
 * Contrato: vínculo VIVO — a ficha não guarda cópia. O item entra no cálculo a
 * partir do cadastro do solado, com quantidade por par (grade opcional), e
 * SUPRIME a linha do mesmo produto no BOM da ficha (dedup anti-BOM), pra que
 * corrigir na origem não conviva com uma cópia velha.
 */
describe('orderConsumption — itens padrão por MODELO de solado (vínculo vivo)', () => {
  function ctxWithSole() {
    const ctx = buildContext();
    ctx.sheetPrimarySoleMap = new Map([['sheet-1', 'p-solado']]);
    ctx.allProducts = [
      ...ctx.allProducts,
      { id: 'p-solado', name: 'SOLADO 204 PRETO', color: 'PRETO', group_id: 'g-solado', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null },
      { id: 'p-cola', name: 'COLA PVC', color: null, group_id: 'g-cola', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null, unit: 'g', category: 'Quimicos' },
    ];
    return ctx;
  }

  it('quantidade por par vale para TODAS as numerações, sem grade cadastrada', () => {
    const ctx = ctxWithSole();
    ctx.soleGroupStandardItemsBySole = new Map([
      ['p-solado', [{ standardItemId: 'p-cola', perPair: 20, perSize: {}, unit: 'g' }]],
    ]);
    const rows = computeConsumptionForItems([buildItem()], ctx);
    const cola = rows.find(r => r.materialName === 'COLA PVC')!;
    // 24 pares × 20 g/par = 480 g — o valor único cobre as 6 numerações.
    expect(cola.totalQuantity).toBeCloseTo(480, 6);
  });

  it('grade por numeração vence o valor por par naquele tamanho', () => {
    const ctx = ctxWithSole();
    ctx.soleGroupStandardItemsBySole = new Map([
      ['p-solado', [{ standardItemId: 'p-cola', perPair: 10, perSize: { '39': 30 }, unit: 'g' }]],
    ]);
    const rows = computeConsumptionForItems([buildItem()], ctx);
    const cola = rows.find(r => r.materialName === 'COLA PVC')!;
    // 5 numerações × 4 pares × 10 g + 4 pares (39) × 30 g = 200 + 120 = 320 g.
    expect(cola.totalQuantity).toBeCloseTo(320, 6);
  });

  it('cadastro por modelo SUBSTITUI o legado por numeração do mesmo produto', () => {
    const ctx = ctxWithSole();
    // Legado diria 1 g/par em cada numeração (24 g no total).
    ctx.soleStandardItemsBySole = new Map([
      ['p-solado', ['34', '35', '36', '37', '38', '39'].map(s => ({
        standardItemId: 'p-cola', size: Number(s), consumption: 1, unit: 'g',
      }))],
    ]);
    ctx.soleGroupStandardItemsBySole = new Map([
      ['p-solado', [{ standardItemId: 'p-cola', perPair: 20, perSize: {}, unit: 'g' }]],
    ]);
    const rows = computeConsumptionForItems([buildItem()], ctx);
    const colaRows = rows.filter(r => r.materialName === 'COLA PVC');
    expect(colaRows).toHaveLength(1);
    // 480, não 504 — o legado não soma por cima.
    expect(colaRows[0].totalQuantity).toBeCloseTo(480, 6);
  });

  it('linha zerada e sem grade não gera consumo', () => {
    const ctx = ctxWithSole();
    ctx.soleGroupStandardItemsBySole = new Map([
      ['p-solado', [{ standardItemId: 'p-cola', perPair: 0, perSize: {}, unit: 'g' }]],
    ]);
    const rows = computeConsumptionForItems([buildItem()], ctx);
    expect(rows.find(r => r.materialName === 'COLA PVC')).toBeUndefined();
  });
});
