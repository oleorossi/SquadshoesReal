import { supabase } from '@/integrations/supabase/client';
import {
  calculateGradeBasedDm2,
  calculateConsumptionWithUnit,
  isLinearWidthMissing,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
  normalizeText,
} from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';

/**
 * Motor CANÔNICO de consumo de materiais.
 *
 * Extração FIEL do cálculo que vivia inline em
 * `src/components/sale-orders/MaterialConsumptionDialog.tsx` (`loadConsumption`).
 * Agora é a fonte única usada por:
 *   - o modal "Consumo de Materiais" (por PEDIDO/PV — agrega todos os itens), e
 *   - a ficha do operador (por ORDEM DE PRODUÇÃO via `useBulkOrderConsumption`,
 *     onde 1 OP = 1 `sale_order_item` = referência + cor + grade).
 *
 * Antes a ficha puxava de um caminho SQL divergente (`calculate_order_consumption`),
 * o que produzia nomes/quantidades desalinhados vs. o modal. Religar os dois ao
 * MESMO motor garante paridade por construção.
 *
 * Regra de cálculo: ver CLAUDE.md → "Regra de cálculo de consumo de materiais
 * (CANÔNICA)". Em resumo: um valor armazenado como dm²/par (área) NUNCA é exibido
 * cru — converte pra unidade física pela LARGURA da ficha de componente (napa/couro
 * → metros lineares; placa → nº de placas). Itens lineares diretos sem ficha (tiras/
 * elásticos) já estão na unidade nativa e NÃO convertem. Palmilha = PLACA (base) +
 * FORRAÇÃO (napa do forro). Solado é por par, segmentado por numeração.
 *
 * ⚠ Este módulo calcula APENAS o consumo previsto. A disponibilidade em estoque
 * (verde/vermelho) é responsabilidade de quem exibe — vive no modal, pois depende
 * do momento da consulta e a ficha do operador não precisa dela.
 *
 * ⚠ O caminho SQL (`calculate_order_consumption*`) CONTINUA existindo para
 * custeio/MRP (agregação de compra) — fora do escopo deste motor de UI.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Linha de consumo no formato canônico (igual ao do modal). */
export type MaterialConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
  widthMissing?: boolean;
  /** Breakdown agregado por numeração (somado entre items que casam em
   *  grupo+cor+unidade). Usado pelo Solado pra mostrar totais reais por Nº. */
  sizeBreakdown?: Record<string, number>;
};

/**
 * Item de consumo. Espelha EXATAMENTE o que o modal lê de `sale_order_items`
 * + join `technical_sheets`. Para a ficha do operador, montamos um destes por OP.
 */
export type ConsumptionItem = {
  reference_id: string;
  color: string | null;
  quantity: number;
  /** Grade BASE (por 1 ficha fechada). O total real vem de `quantity`. */
  grade?: Record<string, number> | null;
  fichas?: number | null;
  strap_colors?: any[] | null;
  /** Linha da ficha técnica (join `technical_sheets(...)`). */
  technical_sheets: any;
};

/** Contexto compartilhado: as consultas e mapas que o cálculo precisa. */
export type ConsumptionContext = {
  materials: any[];
  allProducts: any[];
  productGroups: any[];
  componentSheets: any[];
  soleColorMap: Map<string, string>;
  palmilhaColorMap: Map<string, { color: string; productId: string | null }>;
  palmilhaDefaultMap: Map<string, { color: string; productId: string | null }>;
  liningColorMap: Map<string, string>;
  liningDefaultMap: Map<string, string>;
  sheetStrapsMap: Map<string, any[]>;
};

/**
 * Colunas de `technical_sheets` que o motor lê — espelho EXATO do join usado
 * pelo modal (`sale_order_items → technical_sheets(...)`), com `id` a mais para
 * permitir o fetch standalone por referência (ficha do operador).
 *
 * ⚠ Mantenha em sincronia com o `select` do modal: alterar um lado exige o outro.
 */
export const TECHNICAL_SHEET_CONSUMPTION_COLUMNS = `
  id,
  upper_material,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_consumption,
  insole_material,
  insole_consumption,
  insole_has_lining,
  insole_ready_made,
  insole_lining_consumption,
  sole_material,
  sole_consumption,
  sole_color,
  sole_group_id,
  lining_accessories,
  components_accessories
`;

/** Classifica um material de BOM (sheet_materials) num componentType. */
export const classifyBomMaterial = (groupName: string, productName: string, category: string): string => {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
  if (normalized.includes('cabedal') || normalized.includes('napa') || normalized.includes('velvet') || normalized.includes('couro')) return 'Cabedal';
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (normalized.includes('forração') || normalized.includes('forracao') || normalized.includes('forro')) return 'Forração';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Outros';
};

/** Área da placa em dm² a partir das dimensões do grupo (mm por padrão). */
export const calcGroupPlateAreaDm2 = (group: any): number => {
  if (!group?.dimensions_length || !group?.dimensions_width) return 0;
  const unit = (group.dimensions_unit || 'mm').toLowerCase();
  let l = Number(group.dimensions_length);
  let w = Number(group.dimensions_width);
  if (unit === 'cm') { l *= 10; w *= 10; }
  if (unit === 'm') { l *= 1000; w *= 1000; }
  return (l * w) / 10000;
};

/** Acumula uma linha no mapa, somando por (componentType, grupo, cor, unidade). */
const addConsumptionRow = (map: Map<string, MaterialConsumptionRow>, row: MaterialConsumptionRow) => {
  const totalQuantity = Number(row.totalQuantity) || 0;
  const groupName = row.groupName?.trim();
  if (!groupName || totalQuantity <= 0) return;

  const productUnit = row.productUnit?.trim() || 'un';
  const color = row.color?.trim() || '—';
  const materialName = row.materialName?.trim() || groupName;
  const key = `${row.componentType}||${groupName}||${color}||${productUnit}`;
  const existing = map.get(key);

  if (existing) {
    existing.totalQuantity += totalQuantity;
    if (row.widthMissing) existing.widthMissing = true;
    // Soma breakdown por numeração quando ambos têm (Solado).
    if (row.sizeBreakdown) {
      existing.sizeBreakdown = existing.sizeBreakdown || {};
      for (const [size, qty] of Object.entries(row.sizeBreakdown)) {
        existing.sizeBreakdown[size] = (existing.sizeBreakdown[size] || 0) + qty;
      }
    }
    return;
  }

  map.set(key, {
    componentType: row.componentType,
    groupName,
    materialName,
    productUnit,
    color,
    totalQuantity,
    widthMissing: row.widthMissing,
    sizeBreakdown: row.sizeBreakdown,
  });
};

/**
 * Busca a linha de `technical_sheets` (colunas de consumo) por referência.
 * Usado pela ficha do operador, que parte de IDs de referência (não tem o join
 * que o modal ganha de graça via `sale_order_items`).
 */
export async function fetchTechnicalSheetsForConsumption(
  refIds: string[],
): Promise<Map<string, any>> {
  const unique = [...new Set(refIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await (supabase as any)
    .from('technical_sheets')
    .select(TECHNICAL_SHEET_CONSUMPTION_COLUMNS)
    .in('id', unique);
  if (error) throw error;
  const m = new Map<string, any>();
  for (const s of (data || []) as any[]) m.set(s.id, s);
  return m;
}

/**
 * Roda as consultas de contexto (idênticas às do modal) e monta os mapas de
 * resolução de cor (solado/palmilha/forro) + straps. Reutilizável por qualquer
 * caller (modal por PV ou ficha por OP).
 */
export async function fetchConsumptionContext(refIds: string[]): Promise<ConsumptionContext> {
  const unique = [...new Set(refIds.filter(Boolean))];

  const [{ data: materials, error: materialsError }, { data: allProducts }, { data: productGroups }, { data: componentSheets }, { data: sheetStrapData }, { data: soleColorMappings }, { data: palmilhaColorMappings }, { data: liningColorMappings }] = await Promise.all([
    supabase
      .from('sheet_materials')
      .select('sheet_id, product_id, group_id, quantity_per_unit, color, products(name, unit, category), product_groups(name)')
      .in('sheet_id', unique),
    supabase
      .from('products')
      .select('id, name, color, group_id, quantity, reserved_stock, stock_grade, sole_classification')
      .eq('active', true),
    supabase
      .from('product_groups')
      .select('id, name, dimensions_length, dimensions_width, dimensions_unit'),
    supabase
      .from('component_sheets')
      .select('product_id, dimensions_width, dimensions_length, dimensions_unit, yield_per_size, yield_per_sole, waste_pct, products!inner(group_id, name, color, unit)'),
    supabase
      .from('technical_sheets')
      .select('id, strap_colors')
      .in('id', unique),
    (supabase as any).from('technical_sheet_sole_colors').select('sheet_id, product_color, sole_product_id').in('sheet_id', unique),
    (supabase as any).from('technical_sheet_palmilha_colors').select('sheet_id, cabedal_color, palmilha_color, palmilha_product_id').in('sheet_id', unique),
    (supabase as any).from('technical_sheet_lining_colors').select('sheet_id, cabedal_color, lining_color').in('sheet_id', unique),
  ]);

  if (materialsError) throw materialsError;

  // (sheet_id, cor do cabedal) → produto-solado específico
  const soleColorMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_product_id);
  }
  const palmilhaColorMap = new Map<string, { color: string; productId: string | null }>();
  for (const m of (palmilhaColorMappings || []) as any[]) {
    palmilhaColorMap.set(`${m.sheet_id}::${(m.cabedal_color || '').toLowerCase()}`, { color: m.palmilha_color, productId: m.palmilha_product_id });
  }
  const palmilhaDefaultMap = new Map<string, { color: string; productId: string | null }>();
  for (const m of (palmilhaColorMappings || []) as any[]) {
    if (m.cabedal_color === '__DEFAULT__') palmilhaDefaultMap.set(m.sheet_id, { color: m.palmilha_color, productId: m.palmilha_product_id });
  }

  const liningColorMap = new Map<string, string>();
  for (const m of (liningColorMappings || []) as any[]) {
    liningColorMap.set(`${m.sheet_id}::${(m.cabedal_color || '').toLowerCase()}`, m.lining_color);
  }
  const liningDefaultMap = new Map<string, string>();
  for (const m of (liningColorMappings || []) as any[]) {
    if (m.cabedal_color === '__DEFAULT__') liningDefaultMap.set(m.sheet_id, m.lining_color);
  }

  // reference_id → strap_colors da ficha
  const sheetStrapsMap = new Map<string, any[]>();
  for (const s of (sheetStrapData || [])) {
    if (Array.isArray((s as any).strap_colors)) sheetStrapsMap.set((s as any).id, (s as any).strap_colors as any[]);
  }

  return {
    materials: materials || [],
    allProducts: allProducts || [],
    productGroups: productGroups || [],
    componentSheets: componentSheets || [],
    soleColorMap,
    palmilhaColorMap,
    palmilhaDefaultMap,
    liningColorMap,
    liningDefaultMap,
    sheetStrapsMap,
  };
}

/**
 * Núcleo do cálculo: itera os itens (cada um = 1 OP/`sale_order_item`) e produz
 * as linhas de consumo agregadas por (componentType, grupo, cor, unidade).
 *
 * Extração VERBATIM do loop de `loadConsumption` do modal — qualquer mudança de
 * regra deve passar pelos testes de paridade (`orderConsumption.test.ts`).
 */
export function computeConsumptionForItems(
  items: ConsumptionItem[],
  ctx: ConsumptionContext,
): MaterialConsumptionRow[] {
  const {
    componentSheets,
    productGroups,
    allProducts,
    materials,
    soleColorMap,
    palmilhaColorMap,
    palmilhaDefaultMap,
    liningColorMap,
    liningDefaultMap,
    sheetStrapsMap,
  } = ctx;

  const getComponentSheetsForGroup = (groupName: string) => {
    const normalizedGroup = normalizeText(groupName);
    return (componentSheets || []).filter((cs: any) => {
      const prod = cs.products as any;
      if (!prod?.group_id) return false;
      const group = (productGroups || []).find((g: any) => g.id === prod.group_id);
      return normalizeText(group?.name) === normalizedGroup;
    });
  };

  const getPreferredGroupSheet = (
    groupName: string,
    {
      color,
      mode = 'any',
      preferYield = false,
    }: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
  ) => getPreferredComponentSheetFromCandidates(getComponentSheetsForGroup(groupName), { color, mode, preferYield });

  // Helper: o grupo (por nome) contém algum produto que casa na cor?
  const groupHasColor = (groupName: string, color: string): boolean => {
    if (!groupName || !color || color === '—') return false;
    const normalizedColor = color.toLowerCase().trim();
    const group = (productGroups || []).find((g: any) => g.name === groupName);
    if (!group) return false;

    return (allProducts || []).some((p: any) => {
      if (p.group_id !== group.id) return false;
      const pName = (p.name || '').toLowerCase();
      const pColor = (p.color || '').toLowerCase();

      if (pColor === normalizedColor || pName === normalizedColor) return true;
      const afterDelimiter = pName.includes(':') ? pName.split(':').pop()?.trim() : pName.includes('-') ? pName.split('-').pop()?.trim() : '';
      if (afterDelimiter && afterDelimiter === normalizedColor) return true;
      if (pColor.length > 3 && normalizedColor.length > 3) {
        if (normalizedColor.includes(pColor) || pColor.includes(normalizedColor)) return true;
      }
      return false;
    });
  };

  // Conta produtos por grupo (ranking de fallback).
  const countGroupProducts = (groupName: string): number => {
    const group = (productGroups || []).find((g: any) => g.name === groupName);
    if (!group) return 0;
    return (allProducts || []).filter((p: any) => p.group_id === group.id).length;
  };

  const resolveOption = (
    mainGroup: string, mainConsumption: number,
    alternatives: any[], orderColor: string,
  ): { group: string; consumption: number } | null => {
    // Try main first
    if (mainGroup && mainConsumption > 0) {
      if (!orderColor || orderColor === '—' || groupHasColor(mainGroup, orderColor)) {
        return { group: mainGroup, consumption: mainConsumption };
      }
    }
    // Try alternatives
    for (const alt of alternatives) {
      const altGroup = alt.material?.trim();
      const altConsumption = Number(alt.consumption) || 0;
      if (altGroup && altConsumption > 0 && groupHasColor(altGroup, orderColor)) {
        return { group: altGroup, consumption: altConsumption };
      }
    }
    // Fallback: grupo com mais variantes (mais provável de carregar a cor)
    const candidates = [
      ...(mainGroup && mainConsumption > 0 ? [{ group: mainGroup, consumption: mainConsumption }] : []),
      ...alternatives.filter((a: any) => a.material?.trim() && (Number(a.consumption) || 0) > 0).map((a: any) => ({ group: a.material.trim(), consumption: Number(a.consumption) })),
    ];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => countGroupProducts(b.group) - countGroupProducts(a.group));
    return candidates[0];
  };

  const consumptionMap = new Map<string, MaterialConsumptionRow>();

  for (const item of items) {
    const orderColor = item.color || '—';
    const itemQuantity = Number(item.quantity) || 0;
    const sheet = item.technical_sheets as any;

    // Cabedal: resolve which option matches the order color
    const allCabedalAccessories = Array.isArray(sheet?.components_accessories)
      ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
      : [];
    const upperAlts = allCabedalAccessories.filter((e: any) => !e.mandatory);
    const mandatoryCabedalMaterials = allCabedalAccessories.filter((e: any) => e.mandatory === true);
    const upperMatch = resolveOption(
      sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0,
      upperAlts, orderColor,
    );
    if (upperMatch) {
      const upperSheet = getPreferredGroupSheet(upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const isPrincipal = upperMatch.group === (sheet?.upper_material || '');
      const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
      const overridePerSize = isPrincipal
        ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
        : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
      const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal',
        groupName: upperMatch.group,
        materialName: 'Cabedal',
        productUnit: 'metro',
        color: orderColor,
        totalQuantity: upperTotal,
        widthMissing: isLinearWidthMissing(upperSheet, 'm'),
      });
    }

    // Materiais mandatórios do cabedal — sempre consumidos, independente da cor
    for (const mandMat of mandatoryCabedalMaterials) {
      const mandConsumption = Number(mandMat.consumption) || 0;
      if (!mandMat.material || mandConsumption <= 0) continue;
      const mandSheet = getPreferredGroupSheet(mandMat.material, { color: orderColor, mode: 'linear', preferYield: true });
      const mandOverride = (mandMat.consumption_per_size && Object.keys(mandMat.consumption_per_size).length > 0)
        ? mandMat.consumption_per_size
        : null;
      const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal',
        groupName: mandMat.material,
        materialName: 'Material Fixo',
        productUnit: 'metro',
        color: orderColor,
        totalQuantity: mandTotal,
        widthMissing: isLinearWidthMissing(mandSheet, 'm'),
      });
    }

    // Forro: resolve which option matches the order color
    const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
    const liningMatch = resolveOption(
      sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0,
      liningAlts, orderColor,
    );
    if (liningMatch) {
      const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || liningDefaultMap.get(item.reference_id) || orderColor;
      const liningSheet = getPreferredGroupSheet(liningMatch.group, { color: mappedLiningColor, mode: 'linear', preferYield: true });
      const soleProductId = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
      const { total: liningTotal } = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', undefined, soleProductId, sheet?.sole_drives_consumption);
      addConsumptionRow(consumptionMap, {
        componentType: 'Forração',
        groupName: liningMatch.group,
        materialName: 'Forração',
        productUnit: 'metro',
        color: mappedLiningColor,
        totalQuantity: liningTotal,
        widthMissing: isLinearWidthMissing(liningSheet, 'm'),
      });
    }

    // Palmilha = PLACA (base) + FORRAÇÃO (napa do forro). Pulada INTEIRA quando
    // a palmilha é pronta (insole_ready_made ou solado classificado
    // palmilha_pronta) — espelha o ramo SQL: pronta = não debita nada.
    const soleProductIdForInsole = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
    const insoleSoleProd = soleProductIdForInsole ? (allProducts || []).find((p: any) => p.id === soleProductIdForInsole) : null;
    const isPalmilhaPronta = (sheet?.insole_ready_made === true)
      || ((insoleSoleProd as any)?.sole_classification === 'palmilha_pronta');

    if (!isPalmilhaPronta) {
      const palmMapping = palmilhaColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || palmilhaDefaultMap.get(item.reference_id);
      const insoleGroupName = sheet?.insole_material || '';
      const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
      const palmColor = palmMapping?.color || '—';
      const palmProductId = palmMapping?.productId;

      // PLACA (base): produto específico (unidade) ou material convertido a placas
      if (palmProductId) {
        const prod = (allProducts || []).find((p: any) => p.id === palmProductId);
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: prod?.name || 'Palmilha',
          productUnit: 'par',
          color: prod?.color || palmColor,
          totalQuantity: itemQuantity,
        });
      } else {
        const insoleSheet = getPreferredGroupSheet(insoleGroupName, { mode: 'plate', preferYield: true });
        const insoleDm2 = calculateGradeBasedDm2(item, Number(sheet?.insole_consumption) || 0, insoleSheet, undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
        const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
        const insolePlates = groupPlateArea > 0 ? (insoleDm2 / groupPlateArea) : convertDm2ToPlates(insoleDm2, insoleSheet);

        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: 'Palmilha',
          productUnit: 'placa',
          color: palmColor,
          totalQuantity: insolePlates,
        });
      }

      // FORRAÇÃO da palmilha: napa do forro (lining_material) que cobre a placa.
      // Linha linear ADICIONAL (mesma napa do Forro do cabedal). Só quando há
      // forro (insole_has_lining) e área de forração da palmilha > 0.
      const insoleLiningCons = Number(sheet?.insole_lining_consumption) || 0;
      const liningGroupForPalm = sheet?.lining_material || '';
      if (insoleLiningCons > 0 && liningGroupForPalm && sheet?.insole_has_lining !== false) {
        const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || liningDefaultMap.get(item.reference_id) || orderColor;
        const forrSheet = getPreferredGroupSheet(liningGroupForPalm, { color: mappedLiningColor, mode: 'linear', preferYield: true });
        const { total: forrTotal } = calculateConsumptionWithUnit(item, insoleLiningCons, forrSheet, 'metro', undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: liningGroupForPalm,
          materialName: 'Forração Palmilha',
          productUnit: 'metro',
          color: mappedLiningColor,
          totalQuantity: forrTotal,
          widthMissing: isLinearWidthMissing(forrSheet, 'm'),
        });
      }
    }

    // Solado: resolver cor real via technical_sheet_sole_colors (match case/acento-
    // insensitive — "Caramelo" vs "CARAMELO" precisa casar).
    const orderColorNorm = (orderColor || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    let soleProductIdResolved: string | null = null;
    for (const [k, v] of soleColorMap.entries()) {
      const [skId, skColor] = k.split('::');
      if (skId !== item.reference_id) continue;
      const kNorm = (skColor || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      if (kNorm === orderColorNorm) { soleProductIdResolved = v; break; }
    }
    const soleProduct = soleProductIdResolved
      ? (allProducts || []).find((p: any) => p.id === soleProductIdResolved)
      : null;
    const soleColor = soleProduct?.color || orderColor || sheet?.sole_color || '—';

    // Breakdown de numerações escalado pro TOTAL real do item.
    const grade = (item as any).grade as Record<string, number> | null | undefined;
    const scaledBreakdown: Record<string, number> = {};
    if (grade && typeof grade === 'object') {
      // Mantém numerações conjugadas (ex: "33/34") — só descarta meta (_size_*).
      const isSize = (k: string) => !k.startsWith('_');
      const baseSum = Object.entries(grade).reduce((s, [k, v]) => isSize(k) ? s + (Number(v) || 0) : s, 0);
      const multiplier = baseSum > 0 ? itemQuantity / baseSum : 0;
      for (const [size, qty] of Object.entries(grade)) {
        if (!isSize(size)) continue;
        const scaled = Math.round((Number(qty) || 0) * multiplier);
        if (scaled > 0) scaledBreakdown[size] = scaled;
      }
    }

    addConsumptionRow(consumptionMap, {
      componentType: 'Solado',
      groupName: soleProduct?.name || sheet?.sole_material || '',
      // materialName usado só como fallback se sizeBreakdown vier vazio.
      materialName: 'Solado',
      productUnit: 'par',
      color: soleColor,
      totalQuantity: (Number(sheet?.sole_consumption) || 0) * itemQuantity,
      sizeBreakdown: Object.keys(scaledBreakdown).length > 0 ? scaledBreakdown : undefined,
    });

    const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const sheetStraps: any[] = sheetStrapsMap.get(item.reference_id) || [];
    const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
    for (const strap of resolvedStraps) {
      const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
        grade: (item as any).grade || {},
        quantity: itemQuantity,
        fichas: (item as any).fichas,
      });

      addConsumptionRow(consumptionMap, {
        componentType: 'Tiras',
        groupName: strap.group_name || strap.label || 'Tira',
        materialName: strap.label || strap.group_name || 'Tira',
        productUnit: 'metro',
        color: strap.color || orderColor,
        totalQuantity: strapConsumptionCm / 100,
      });
    }

    const specGroupsWithConsumption = new Map<string, number>();
    if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
    if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
    if (sheet?.insole_material && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
    if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

    const itemMaterials = (materials || []).filter((material: any) => material.sheet_id === item.reference_id);
    for (const material of itemMaterials) {
      const product = material.products as any;
      const group = material.product_groups as any;
      if (!product) continue;

      const groupName = group?.name || product.category || product.name || 'Outros';
      const groupKey = groupName.toLowerCase();
      const specHasGroup = specGroupsWithConsumption.has(groupKey);
      if (specHasGroup) {
        const bomType = classifyBomMaterial(groupName, product.name || '', product.category || '');
        const isUpperGroup = upperMatch?.group?.toLowerCase() === groupKey;
        const isLiningGroup = liningMatch?.group?.toLowerCase() === groupKey;
        const isInsoleGroup = sheet?.insole_material?.toLowerCase() === groupKey;
        const isSoleGroup = sheet?.sole_material?.toLowerCase() === groupKey;
        const shouldSkip = (isUpperGroup && bomType === 'Cabedal') ||
                           (isLiningGroup && bomType === 'Forração') ||
                           (isInsoleGroup && (bomType === 'Palmilha' || product.category?.toLowerCase().includes('palmilha'))) ||
                           (isSoleGroup && bomType === 'Solado');
        if (shouldSkip) continue;
      }

      let productUnit = product.unit || 'un';
      const unitLc = productUnit.toLowerCase();
      const isLinearUnit = ['m', 'metro', 'mt', 'meters', 'metros', 'cm'].includes(unitLc);
      const rawQty = (Number(material.quantity_per_unit) || 0) * itemQuantity;
      let totalQty = rawQty;
      let widthMissing = false;

      // Materiais de ÁREA cortados de bobina (napa/couro): têm ficha de componente
      // e quantity_per_unit está em dm²/par. Converter para metros lineares pela
      // largura — senão aparece ~100× inflado. Tiras/itens sem ficha passam direto.
      const cs = (componentSheets || []).find((c: any) => c.product_id === material.product_id) || null;
      if (isLinearUnit && cs) {
        if (!isLinearWidthMissing(cs as any, productUnit)) {
          totalQty = convertDm2ToLinearMeters(rawQty, cs as any);
          productUnit = 'metro';
        } else {
          // tem ficha de área mas sem largura → não dá pra converter; marca aviso
          widthMissing = true;
          totalQty = unitLc === 'cm' ? rawQty / 100 : rawQty;
          productUnit = unitLc === 'cm' ? 'metro' : productUnit;
        }
      } else if (unitLc === 'cm') {
        totalQty = rawQty / 100;
        productUnit = 'metro';
      }

      addConsumptionRow(consumptionMap, {
        componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
        groupName,
        materialName: product.name || groupName,
        productUnit,
        color: material.color || '—',
        totalQuantity: totalQty,
        widthMissing,
      });
    }
  }

  return Array.from(consumptionMap.values());
}
