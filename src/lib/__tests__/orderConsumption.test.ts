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

  it('Corte Palmilha exibe a placa; Corte Forração recebe a forração da palmilha (E3)', () => {
    const bulk = computeConsumptionForItems([buildItem()], buildContext()).map(toBulkConsumptionRow);
    const palmilha = filterConsumptionForSector(bulk, 'Corte Palmilha');

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

  // ── Embalagem: filtro de caixa por packaging_mode (bug PV-00141) ───────────
  // A ficha lista DUAS caixas no BOM como alternativas (colmeia 0.083/par +
  // individual 1/par), ambas no grupo "EMBALAGEM". Sem filtro, addConsumptionRow
  // funde as duas e soma a qtd; com packaging_mode, mostra só a do modo.
  function ctxComCaixas(): ConsumptionContext {
    const ctx = buildContext();
    ctx.materials = [
      ...ctx.materials,
      { sheet_id: 'sheet-1', product_id: 'p-cx-colmeia', group_id: 'g-embal', quantity_per_unit: 0.083, color: null, products: { name: 'CAIXA COLMEIA 11', unit: 'un', category: 'Embalagem' }, product_groups: { name: 'EMBALAGEM' } },
      { sheet_id: 'sheet-1', product_id: 'p-cx-individual', group_id: 'g-embal', quantity_per_unit: 1, color: null, products: { name: 'CAIXA INDIVIDUAL 11', unit: 'un', category: 'Embalagem' }, product_groups: { name: 'EMBALAGEM' } },
    ];
    return ctx;
  }

  it('packaging_mode colmeia → mostra só CAIXA COLMEIA (não soma a individual)', () => {
    const item = buildItem({ packagingMode: 'colmeia' });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1);
    expect(embal[0].materialName).toBe('CAIXA COLMEIA 11');
    expect(embal[0].totalQuantity).toBeCloseTo(24 * 0.083, 6); // 1.992, não 25.992
  });

  it('packaging_mode individual → mostra só CAIXA INDIVIDUAL', () => {
    const item = buildItem({ packagingMode: 'individual' });
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1);
    expect(embal[0].materialName).toBe('CAIXA INDIVIDUAL 11');
    expect(embal[0].totalQuantity).toBeCloseTo(24, 6);
  });

  it('SEM packaging_mode → comportamento legado (funde as duas caixas, qtd somada)', () => {
    const item = buildItem(); // sem packagingMode
    const rows = computeConsumptionForItems([item], ctxComCaixas());
    const embal = rows.filter(r => r.componentType === 'Embalagem');
    expect(embal).toHaveLength(1); // fundidas no grupo EMBALAGEM
    expect(embal[0].totalQuantity).toBeCloseTo(24 * (0.083 + 1), 6); // 25.992
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

  it('palmilha pronta comprada por PAR (produto pinado unit=par) mantém a linha em par', () => {
    const ctx = buildContext();
    ctx.allProducts.push({ id: 'p-palm-pronta', name: 'PALMILHA PRONTA 123', unit: 'par', color: 'BEGE', group_id: 'g-eva', quantity: 100, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
    ctx.palmilhaColorMap.set('sheet-1::preto', { color: 'BEGE', productId: 'p-palm-pronta' });

    const rows = computeConsumptionForItems([buildItem()], ctx);
    const palm = rows.find(r => r.componentType === 'Palmilha')!;
    expect(palm.productUnit).toBe('par');
    expect(palm.totalQuantity).toBe(24);
    expect(palm.materialName).toBe('PALMILHA PRONTA 123');
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

  it('sole_consumption > 1 mantém o multiplicador (banco vivo: ficha STX usa 2)', () => {
    const item = buildItem({ technical_sheets: buildSheet({ sole_consumption: 2 }) });
    const rows = computeConsumptionForItems([item], buildContext());
    const solado = rows.find(r => r.componentType === 'Solado')!;
    expect(solado.totalQuantity).toBe(48);
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

    it('solado pinado na variante prevalece sobre a cascata de cor (resolve_sole_for_variant)', () => {
      const ctx = buildVariantContext();
      ctx.productGroups.push({ id: 'g-sole-99', name: 'SOLADO 99', dimensions_length: null, dimensions_width: null, dimensions_unit: null } as any);
      ctx.allProducts.push({ id: 'p-sole-99', name: '99 - PRETO', unit: 'par', color: 'PRETO', group_id: 'g-sole-99', quantity: 0, reserved_stock: 0, stock_grade: null, sole_classification: null } as any);
      // Mapping de cor apontaria pra outro solado — o pin da variante deve vencer.
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
