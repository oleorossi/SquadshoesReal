import { supabase } from '@/integrations/supabase/client';
import {
  calculateGradeBasedDm2,
  calculateConsumptionWithUnit,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
  isLinearWidthMissing,
  normalizeText,
  normalizeColorKey,
} from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';
import {
  computeStrapRollCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';

export type ConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
  /** Material de área (dm²/par) cuja ficha de componente não tem largura →
   *  não dá pra converter pra metros; valor fica em dm² e a UI deve avisar. */
  widthMissing?: boolean;
};

export const COMPONENT_ORDER = [
  'Cabedal', 'Forração', 'Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros',
] as const;

const classifyBomMaterial = (groupName: string, productName: string, category: string): string => {
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

const calcGroupPlateAreaDm2 = (group: any): number => {
  if (!group?.dimensions_length || !group?.dimensions_width) return 0;
  const unit = (group.dimensions_unit || 'mm').toLowerCase();
  let l = Number(group.dimensions_length);
  let w = Number(group.dimensions_width);
  if (unit === 'cm') { l *= 10; w *= 10; }
  if (unit === 'm') { l *= 1000; w *= 1000; }
  return (l * w) / 10000;
};

const addConsumptionRow = (map: Map<string, ConsumptionRow>, row: ConsumptionRow) => {
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
    return;
  }

  map.set(key, { componentType: row.componentType, groupName, materialName, productUnit, color, totalQuantity, widthMissing: row.widthMissing });
};

export async function calculateBomForOrders(orderIds: string[]): Promise<ConsumptionRow[]> {
  if (orderIds.length === 0) return [];

  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, reference_id, color, quantity, grade, sale_order_item_id')
    .in('id', orderIds);

  if (ordersError) throw ordersError;
  if (!ordersData || ordersData.length === 0) return [];

  const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];
  const saleOrderItemIds = [...new Set(ordersData.map(o => o.sale_order_item_id).filter(Boolean))] as string[];

  const [
    { data: sheetsData },
    { data: materials, error: materialsError },
    { data: allProducts },
    { data: productGroups },
    { data: componentSheets },
    { data: saleOrderItems },
    { data: soleColorMappings },
  ] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, upper_material, upper_consumption, upper_consumption_per_size, lining_material, lining_consumption, insole_material, insole_consumption, insole_ready_made, insole_has_lining, insole_lining_consumption, sole_material, sole_consumption, sole_color, sole_group_id, lining_accessories, components_accessories, strap_colors, sole_drives_consumption')
      .in('id', refIds),
    supabase
      .from('sheet_materials')
      .select('sheet_id, product_id, group_id, quantity_per_unit, color, products(name, unit, category), product_groups(name)')
      .in('sheet_id', refIds),
    supabase.from('products').select('id, name, color, group_id, sole_classification').eq('active', true),
    supabase.from('product_groups').select('id, name, dimensions_length, dimensions_width, dimensions_unit'),
    supabase
      .from('component_sheets')
      .select('product_id, dimensions_width, dimensions_length, dimensions_unit, yield_per_size, yield_per_sole, waste_pct, products!inner(group_id, name, color, unit)'),
    saleOrderItemIds.length > 0
      ? supabase.from('sale_order_items').select('id, strap_colors, fichas').in('id', saleOrderItemIds)
      : Promise.resolve({ data: [] }),
    (supabase as any)
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id')
      .in('sheet_id', refIds),
  ]);

  if (materialsError) throw materialsError;

  const sheetsMap = new Map((sheetsData || []).map(s => [s.id, s]));
  const saleItemsMap = new Map((saleOrderItems || []).map((si: any) => [si.id, si]));
  const soleColorMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.product_color)}`, m.sole_product_id);
  }

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
    opts: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
  ) => getPreferredComponentSheetFromCandidates(getComponentSheetsForGroup(groupName), opts);

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

  const countGroupProducts = (groupName: string): number => {
    const group = (productGroups || []).find((g: any) => g.name === groupName);
    if (!group) return 0;
    return (allProducts || []).filter((p: any) => p.group_id === group.id).length;
  };

  const resolveOption = (
    mainGroup: string, mainConsumption: number,
    alternatives: any[], color: string
  ): { group: string; consumption: number } | null => {
    if (mainGroup && mainConsumption > 0) {
      if (!color || color === '—' || groupHasColor(mainGroup, color)) {
        return { group: mainGroup, consumption: mainConsumption };
      }
    }
    for (const alt of alternatives) {
      const altGroup = alt.material?.trim();
      const altConsumption = Number(alt.consumption) || 0;
      if (altGroup && altConsumption > 0 && groupHasColor(altGroup, color)) {
        return { group: altGroup, consumption: altConsumption };
      }
    }
    const candidates = [
      ...(mainGroup && mainConsumption > 0 ? [{ group: mainGroup, consumption: mainConsumption }] : []),
      ...alternatives.filter((a: any) => a.material?.trim() && (Number(a.consumption) || 0) > 0).map((a: any) => ({ group: a.material.trim(), consumption: Number(a.consumption) })),
    ];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => countGroupProducts(b.group) - countGroupProducts(a.group));
    return candidates[0];
  };

  const consumptionMap = new Map<string, ConsumptionRow>();

  for (const order of ordersData) {
    const sheet = sheetsMap.get(order.reference_id) as any;
    if (!sheet) continue;

    const saleItem = order.sale_order_item_id ? saleItemsMap.get(order.sale_order_item_id) as any : null;
    const item = {
      reference_id: order.reference_id,
      color: order.color || '—',
      quantity: order.quantity,
      grade: order.grade as Record<string, number> | null,
      fichas: 1,
      strap_colors: saleItem?.strap_colors ?? null,
    };
    const itemQuantity = Number(item.quantity) || 0;
    const orderColor = item.color || '—';

    // Cabedal
    const allCabedalAccessories = Array.isArray(sheet?.components_accessories)
      ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
      : [];
    const upperAlts = allCabedalAccessories.filter((e: any) => !e.mandatory);
    const mandatoryCabedalMaterials = allCabedalAccessories.filter((e: any) => e.mandatory === true);
    const upperMatch = resolveOption(sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0, upperAlts, orderColor);
    if (upperMatch) {
      const upperSheet = getPreferredGroupSheet(upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const isPrincipal = upperMatch.group === (sheet?.upper_material || '');
      const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
      const overridePerSize = isPrincipal
        ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
        : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
      const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize, undefined, sheet?.sole_drives_consumption);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal', groupName: upperMatch.group, materialName: 'Cabedal',
        productUnit: 'metro', color: orderColor, totalQuantity: upperTotal,
      });
    }

    for (const mandMat of mandatoryCabedalMaterials) {
      const mandConsumption = Number(mandMat.consumption) || 0;
      if (!mandMat.material || mandConsumption <= 0) continue;
      const mandSheet = getPreferredGroupSheet(mandMat.material, { color: orderColor, mode: 'linear', preferYield: true });
      const mandOverride = (mandMat.consumption_per_size && Object.keys(mandMat.consumption_per_size).length > 0) ? mandMat.consumption_per_size : null;
      const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride, undefined, sheet?.sole_drives_consumption);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal', groupName: mandMat.material, materialName: 'Material Fixo',
        productUnit: 'metro', color: orderColor, totalQuantity: mandTotal,
      });
    }

    // Forro
    const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
    const liningMatch = resolveOption(sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0, liningAlts, orderColor);
    if (liningMatch) {
      const liningSheet = getPreferredGroupSheet(liningMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const soleProductId = soleColorMap.get(`${order.reference_id}::${normalizeColorKey(orderColor)}`) || null;
      const { total: liningTotal } = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', undefined, soleProductId, sheet?.sole_drives_consumption);
      addConsumptionRow(consumptionMap, {
        componentType: 'Forração', groupName: liningMatch.group, materialName: 'Forração',
        productUnit: 'metro', color: orderColor, totalQuantity: liningTotal,
      });
    }

    // Palmilha — PULADA INTEIRA quando é palmilha pronta (solado já vem forrado
    // de fábrica): a grade não cobra placa. Mesma regra do orderConsumption.ts
    // (motor canônico). Antes o BOM contava placa mesmo na palmilha pronta,
    // inflando consumo/compra (MRP)/custo.
    const soleProductIdForInsole = soleColorMap.get(`${order.reference_id}::${normalizeColorKey(orderColor)}`) || null;
    const insoleSoleProd = soleProductIdForInsole
      ? (allProducts || []).find((p: any) => p.id === soleProductIdForInsole)
      : null;
    const isPalmilhaPronta = (sheet?.insole_ready_made === true)
      || ((insoleSoleProd as any)?.sole_classification === 'palmilha_pronta');
    if (!isPalmilhaPronta) {
      const insoleGroupName = sheet?.insole_material || '';
      const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
      const insoleSheet = getPreferredGroupSheet(insoleGroupName, { mode: 'plate', preferYield: true });
      const insoleDm2 = calculateGradeBasedDm2(item, Number(sheet?.insole_consumption) || 0, insoleSheet, undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
      const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
      // Aplica waste_pct também no caminho que usa dimensões do grupo, para
      // manter paridade com convertDm2ToPlates() (fallback).
      const insoleWastePct = Number(insoleSheet?.waste_pct) || 0;
      const insolePlates = groupPlateArea > 0
        ? (insoleDm2 / groupPlateArea) * (1 + insoleWastePct / 100)
        : convertDm2ToPlates(insoleDm2, insoleSheet);
      addConsumptionRow(consumptionMap, {
        componentType: 'Palmilha', groupName: insoleGroupName, materialName: 'Palmilha',
        productUnit: 'placa', color: '—', totalQuantity: insolePlates,
      });
    }

    // Solado — cor REAL do solado resolvido (soleColorMap, espelha resolve_sole_color
    // do débito) em vez de chutar Preto/Caramelo por heurística de string (auditoria
    // 2026-06-14, Área 2). Fallback pra cor do pedido; só por último um rótulo neutro.
    const soleColor = ((insoleSoleProd as any)?.color || orderColor || '—').trim() || '—';
    const solePerPair = sheet?.sole_material ? 1 : 0;
    addConsumptionRow(consumptionMap, {
      componentType: 'Solado', groupName: sheet?.sole_material || '', materialName: 'Solado',
      productUnit: 'par', color: soleColor, totalQuantity: solePerPair * itemQuantity,
    });

    // Tiras
    const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const sheetStraps: any[] = Array.isArray(sheet?.strap_colors) ? (sheet.strap_colors as any[]) : [];
    const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
    for (const strap of resolvedStraps) {
      const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
        grade: (item.grade as Record<string, number>) || {},
        quantity: itemQuantity,
        fichas: item.fichas,
      });
      addConsumptionRow(consumptionMap, {
        componentType: 'Tiras', groupName: strap.group_name || strap.label || 'Tira',
        materialName: strap.label || strap.group_name || 'Tira',
        productUnit: 'metro', color: strap.color || orderColor,
        totalQuantity: strapConsumptionCm / 100,
      });
    }

    // BOM materials
    const specGroupsWithConsumption = new Map<string, number>();
    if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
    if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
    if (sheet?.insole_material && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
    if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

    const itemMaterials = (materials || []).filter((m) => m.sheet_id === order.reference_id);
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
      const unitLc = (productUnit || '').toString().toLowerCase().trim();
      const isLinearUnit = ['m', 'metro', 'mt', 'meters', 'metros', 'cm'].includes(unitLc);
      const rawQty = (Number(material.quantity_per_unit) || 0) * itemQuantity;
      let totalQty = rawQty;
      let widthMissing = false;

      // Materiais de ÁREA cortados de bobina (napa/couro): têm ficha de
      // componente e quantity_per_unit está em dm²/par. Converter para metros
      // lineares pela largura — senão aparece ~100× inflado. Tiras/itens
      // lineares sem ficha passam direto. (Espelha o motor canônico —
      // orderConsumption.ts, caminho BOM.)
      const cs = (componentSheets || []).find((c: any) => c.product_id === material.product_id) || null;
      if (isLinearUnit && cs) {
        if (!isLinearWidthMissing(cs as any, productUnit)) {
          totalQty = convertDm2ToLinearMeters(rawQty, cs as any);
          productUnit = 'metro';
        } else {
          // Ficha de área SEM largura → não dá pra converter dm²→metro.
          // Mantém o valor em dm² (regra canônica) e marca o aviso.
          widthMissing = true;
          totalQty = rawQty;
          productUnit = 'dm2';
        }
      } else if (unitLc === 'cm') {
        totalQty = rawQty / 100;
        productUnit = 'metro';
      }

      addConsumptionRow(consumptionMap, {
        componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
        groupName, materialName: product.name || groupName, productUnit,
        color: material.color || '—', totalQuantity: totalQty,
        widthMissing,
      });
    }
  }

  return Array.from(consumptionMap.values()).sort((a, b) => {
    const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as any) - COMPONENT_ORDER.indexOf(b.componentType as any);
    if (typeDiff !== 0) return typeDiff;
    return a.groupName.localeCompare(b.groupName, 'pt-BR') ||
           a.materialName.localeCompare(b.materialName, 'pt-BR') ||
           a.color.localeCompare(b.color, 'pt-BR');
  });
}

export function formatUnit(unit: string): string {
  const labels: Record<string, string> = {
    metro: 'm', m: 'm', dm2: 'dm²', par: 'par', un: 'un', kg: 'kg', litro: 'L', placa: 'placas',
  };
  return labels[unit] || unit || 'un';
}

// ─── Sole breakdown by size + color (for Picking List) ──────────────────────

export type SoleBreakdownRow = {
  soleGroup: string;
  soleColor: string;
  sizes: Record<string, number>;
  total: number;
};

export type SoleBreakdownResult = {
  rows: SoleBreakdownRow[];
  allSizes: string[];
  grandTotal: number;
};

/**
 * Retorna o consumo de solados por (grupo + cor) × numeração para uma lista de
 * OPs. Usado na Lista de Separação pra mostrar quantos pares de cada solado
 * em cada cor e em cada número precisam ser puxados do estoque/comprados.
 *
 * Resolução de cor segue o mesmo padrão do PrintWorkSheetsPage/SolagemWorkSheet:
 * mapping em `technical_sheet_sole_colors` (cabedal_color → sole_product) tem
 * prioridade; fallback usa `technical_sheets.sole_color` (texto livre).
 */
export async function calculateSoleBreakdownByGrade(orderIds: string[]): Promise<SoleBreakdownResult> {
  if (orderIds.length === 0) return { rows: [], allSizes: [], grandTotal: 0 };

  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, reference_id, color, quantity, grade')
    .in('id', orderIds);

  if (ordersError) throw ordersError;
  if (!ordersData || ordersData.length === 0) return { rows: [], allSizes: [], grandTotal: 0 };

  const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];

  const [
    { data: sheets },
    { data: soleMappings },
  ] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, sole_material, sole_color')
      .in('id', refIds),
    (supabase as any)
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name, color, group_id)')
      .in('sheet_id', refIds),
  ]);

  const sheetMap = new Map<string, any>((sheets || []).map((s: any) => [s.id, s]));

  // Pré-busca de product_groups dos solados mapeados (uma única ida ao banco).
  const groupIds = [
    ...new Set(((soleMappings || []) as any[])
      .map(m => m.products?.group_id)
      .filter(Boolean) as string[]),
  ];
  const { data: groups } = groupIds.length > 0
    ? await supabase.from('product_groups').select('id, name').in('id', groupIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const groupNameById = new Map<string, string>((groups || []).map((g: any) => [g.id, g.name]));

  // sheet_id::cabedal_color → { group, color }
  const soleMap = new Map<string, { group: string; color: string }>();
  for (const m of (soleMappings || []) as any[]) {
    const key = `${m.sheet_id}::${(m.product_color || '').toLowerCase().trim()}`;
    const groupName = (m.products?.group_id && groupNameById.get(m.products.group_id))
      || m.products?.name
      || '';
    const colorName = m.products?.color || '';
    if (groupName || colorName) {
      soleMap.set(key, { group: groupName, color: colorName });
    }
  }

  const breakdown = new Map<string, SoleBreakdownRow>();
  const sizeSet = new Set<string>();

  for (const order of ordersData) {
    const sheet = sheetMap.get(order.reference_id);
    if (!sheet) continue;
    const colorLower = (order.color || '').toLowerCase().trim();
    const mapped = soleMap.get(`${order.reference_id}::${colorLower}`);
    const soleGroup = (mapped?.group || (sheet.sole_material || '').toString().trim() || '—').trim() || '—';
    const soleColor = (mapped?.color || (sheet.sole_color || '').toString().trim() || '—').trim() || '—';

    const grade = (order.grade as Record<string, number> | null) || {};
    const baseSum = Object.values(grade).reduce((s, v) => s + (Number(v) || 0), 0);
    const orderTotal = Number(order.quantity) || 0;
    if (orderTotal <= 0) continue;
    const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;

    const key = `${soleGroup}||${soleColor}`;
    if (!breakdown.has(key)) {
      breakdown.set(key, { soleGroup, soleColor, sizes: {}, total: 0 });
    }
    const row = breakdown.get(key)!;

    if (baseSum > 0) {
      for (const [size, qty] of Object.entries(grade)) {
        const scaled = Math.round((Number(qty) || 0) * multiplier);
        if (scaled > 0) {
          row.sizes[size] = (row.sizes[size] || 0) + scaled;
          sizeSet.add(size);
        }
      }
    } else {
      // Sem grade: registra como tamanho '—' pra não perder o total.
      row.sizes['—'] = (row.sizes['—'] || 0) + orderTotal;
      sizeSet.add('—');
    }
    row.total = Object.values(row.sizes).reduce((s, v) => s + v, 0);
  }

  const allSizes = Array.from(sizeSet).sort((a, b) => {
    if (a === '—') return 1;
    if (b === '—') return -1;
    const na = parseFloat(a), nb = parseFloat(b);
    return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
  });
  const rows = Array.from(breakdown.values()).sort((a, b) =>
    a.soleGroup.localeCompare(b.soleGroup, 'pt-BR') || a.soleColor.localeCompare(b.soleColor, 'pt-BR')
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return { rows, allSizes, grandTotal };
}

// ─── Tiras artesanais — corte do rolo (40m × 1370mm) ────────────────────────

/**
 * Agrega o consumo de TIRAS ARTESANAIS de uma lista de OPs e calcula quanto
 * cortar do rolo (40 m × 1370 mm) por tira/cor. Bloco SEPARADO dos materiais
 * BOM normais — exibido em vermelho na Lista de Separação e no Resumo de
 * Consumo do PV.
 *
 * `metros_necessarios` é o total de metros LINEARES de tira do conjunto inteiro
 * de OPs (não por par): mesma base que alimenta as linhas "Tiras" do BOM.
 * A largura de corte vem do cadastro do GRUPO da tira
 * (`product_groups.dimensions_width` normalizado a mm). A detecção de "artesanal"
 * segue a prioridade flag-da-tira → flag-do-grupo → heurístico (ver strapRollCut).
 */
export async function calculateArtisanalStrapRollCut(orderIds: string[]): Promise<ArtisanalStrapCutRow[]> {
  if (orderIds.length === 0) return [];

  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, reference_id, color, quantity, grade, sale_order_item_id')
    .in('id', orderIds);

  if (ordersError) throw ordersError;
  if (!ordersData || ordersData.length === 0) return [];

  const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];
  const saleOrderItemIds = [...new Set(ordersData.map(o => o.sale_order_item_id).filter(Boolean))] as string[];

  const [{ data: sheetsData }, { data: saleOrderItems }, { data: productGroups }, { data: dimProducts }] = await Promise.all([
    supabase.from('technical_sheets').select('id, strap_colors').in('id', refIds),
    saleOrderItemIds.length > 0
      ? supabase.from('sale_order_items').select('id, strap_colors, fichas').in('id', saleOrderItemIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('product_groups').select('id, name, dimensions_width, dimensions_unit'),
    // Largura cadastrada por PRODUTO (fallback quando o grupo não tem largura).
    // CreateStrapProductDialog grava a largura no produto, não no grupo.
    supabase.from('products').select('group_id, dimensions_width, dimensions_unit').gt('dimensions_width', 0).eq('active', true),
  ]);

  const sheetStrapsMap = new Map<string, any[]>(
    (sheetsData || []).map((s: any) => [s.id, Array.isArray(s.strap_colors) ? s.strap_colors : []]),
  );
  const saleItemsMap = new Map((saleOrderItems || []).map((si: any) => [si.id, si]));

  // Largura de corte por grupo (normalizado a mm) + nome canônico. Prioridade:
  // largura do PRÓPRIO grupo (cadastro de família) → largura de qualquer produto
  // do grupo (o caso comum, gravado pelo cadastro de tira).
  const groupNameByNorm = new Map<string, string>();
  const groupIdToNorm = new Map<string, string>();
  const ownWidth = new Map<string, number>();
  for (const g of (productGroups || []) as any[]) {
    const norm = normalizeText(g.name);
    groupNameByNorm.set(norm, g.name);
    groupIdToNorm.set(g.id, norm);
    ownWidth.set(norm, normalizeWidthToMm(g.dimensions_width, g.dimensions_unit));
  }
  const prodWidth = new Map<string, number>();
  for (const p of (dimProducts || []) as any[]) {
    const norm = groupIdToNorm.get(p.group_id);
    if (!norm) continue;
    const w = normalizeWidthToMm(p.dimensions_width, p.dimensions_unit);
    if (w > (prodWidth.get(norm) || 0)) prodWidth.set(norm, w);
  }
  const widthForNorm = (norm: string): number => (ownWidth.get(norm) || prodWidth.get(norm) || 0);

  // Flag de cadastro `is_artisanal_strap` no grupo — query DEFENSIVA: se a coluna
  // ainda não foi migrada no banco, o PostgREST retorna erro e seguimos só com
  // flag-por-tira + heurístico (não quebra o painel).
  const groupArtisanalFlag = new Map<string, boolean>();
  {
    const { data: flagged, error: flagErr } = await supabase
      .from('product_groups')
      .select('name, is_artisanal_strap' as any);
    if (!flagErr && Array.isArray(flagged)) {
      for (const g of flagged as any[]) {
        if (g?.is_artisanal_strap) groupArtisanalFlag.set(normalizeText(g.name), true);
      }
    }
  }

  // Acumula metros de tira por (grupo+cor) só para as tiras detectadas artesanais.
  const agg = new Map<string, { groupName: string; color: string; norm: string; metros: number }>();

  for (const order of ordersData) {
    const sheetStraps: any[] = sheetStrapsMap.get(order.reference_id) || [];
    const saleItem = order.sale_order_item_id ? saleItemsMap.get(order.sale_order_item_id) : null;
    const itemStraps: any[] = Array.isArray(saleItem?.strap_colors) ? saleItem.strap_colors : [];
    const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
    if (resolvedStraps.length === 0) continue;

    const itemQuantity = Number(order.quantity) || 0;
    const grade = (order.grade as Record<string, number>) || {};

    for (const strap of resolvedStraps) {
      const groupName = (strap.group_name || strap.label || 'Tira').toString().trim();
      const norm = normalizeText(groupName);
      const artisanal = isArtisanalStrap({
        strapFlag: (strap as any).is_artisanal_strap,
        groupFlag: groupArtisanalFlag.get(norm),
        name: `${groupName} ${strap.label || ''}`,
      });
      if (!artisanal) continue;

      const cm = calculateStrapConsumptionCm(strap, {
        grade,
        quantity: itemQuantity,
        fichas: saleItem?.fichas,
      });
      const metros = cm / 100;
      if (metros <= 0) continue;

      const color = (strap.color || order.color || '—').toString().trim() || '—';
      const key = `${norm}||${color.toLowerCase()}`;
      const existing = agg.get(key);
      if (existing) existing.metros += metros;
      else agg.set(key, { groupName: groupNameByNorm.get(norm) || groupName, color, norm, metros });
    }
  }

  const rows: ArtisanalStrapCutRow[] = Array.from(agg.entries()).map(([key, v]) => {
    const largura_mm = widthForNorm(v.norm);
    return {
      key,
      groupName: v.groupName,
      color: v.color,
      largura_mm,
      metros_necessarios: v.metros,
      cut: computeStrapRollCut({ largura_mm, metros_necessarios: v.metros }),
    };
  });

  rows.sort((a, b) => a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
  return rows;
}
