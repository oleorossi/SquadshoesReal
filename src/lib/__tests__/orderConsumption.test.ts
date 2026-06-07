import { describe, it, expect, vi } from 'vitest';

// O motor importa o client supabase (usado só pelos fetch*). Mockamos pra
// não instanciar nada — este teste exercita APENAS o cálculo puro.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  computeConsumptionForItems,
  type ConsumptionContext,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import {
  toBulkConsumptionRow,
  filterConsumptionForSector,
} from '@/hooks/useBulkOrderConsumption';

/**
 * GATE DE PARIDADE (ficha do operador ↔ modal "Consumo de Materiais").
 *
 * Ambos os caminhos chamam `computeConsumptionForItems` — a ficha só adapta o
 * shape via `toBulkConsumptionRow`, preservando a QUANTIDADE 1:1. Este teste
 * trava isso com valores golden hand-computados que exercitam TODAS as regras
 * canônicas (CLAUDE.md): dm²/par → metro linear pela largura da ficha; placa
 * via área do grupo; palmilha = PLACA + FORRAÇÃO; solado por numeração.
 *
 * Cenário (espelha o exemplo do user — setor Corte Palmilha):
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

    const palmForr = find('Palmilha', 'Forração Palmilha')!;
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

  it('Corte Palmilha exibe placa + forração da palmilha e oculta cabedal/solado/cola', () => {
    const bulk = computeConsumptionForItems([buildItem()], buildContext()).map(toBulkConsumptionRow);
    const filtered = filterConsumptionForSector(bulk, 'Corte Palmilha');

    expect(filtered.every(r => r.component === 'Palmilha')).toBe(true);
    const names = filtered.map(r => r.product_name).sort();
    expect(names).toContain('EVA PLACA');
    expect(names).toContain('NAPA FORRO');
    expect(filtered.find(r => r.product_name === 'SOLADO TR 01')).toBeUndefined();
    expect(filtered.find(r => r.component === 'Cabedal')).toBeUndefined();
    expect(filtered.find(r => r.component === 'Químicos')).toBeUndefined();
  });

  it('palmilha pronta (insole_ready_made) não gera nenhuma linha de palmilha', () => {
    const item = buildItem({ technical_sheets: buildSheet({ insole_ready_made: true }) });
    const rows = computeConsumptionForItems([item], buildContext());
    expect(rows.find(r => r.componentType === 'Palmilha')).toBeUndefined();
    // mas mantém cabedal/forração/solado normalmente
    expect(rows.find(r => r.componentType === 'Cabedal')).toBeDefined();
    expect(rows.find(r => r.componentType === 'Solado')).toBeDefined();
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
});
