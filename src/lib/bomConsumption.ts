import { supabase } from '@/integrations/supabase/client';
import {
  calculateGradeBasedDm2,
  calculateConsumptionWithUnit,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  convertToProductUnit,
  getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
  isLinearWidthMissing,
  normalizeText,
  normalizeColorKey,
  LINEAR_UNITS,
} from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';
import { mergePerSizeConsumption, resolveSoleProductIdCanonical, resolveMaterialProductCanonical } from '@/lib/orderConsumption';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from '@/lib/packagingPairsPerBox';
import {
  aggregateArtisanalStrapCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  type ArtisanalStrapAggInput,
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
  /** Equivalência em PLACAS (informação secundária) quando a linha de palmilha
   *  sai em dm² — a unidade de ESTOQUE do produto-placa (ex.: PLACA 1.0 EVA,
   *  unit='dm²'). Estoque/débito/compra são em dm²; exibir só "placas" tornava
   *  a comparação com estoque inválida (auditoria 2026-07-01). */
  plateEquivalent?: number;
  /** Aviso não-bloqueante (ex.: solado fachetado sem specs de fachete). A linha
   *  entra mesmo com qtd 0 só pra alertar o gap de cadastro — espelha o
   *  `warning` do motor canônico (orderConsumption.ts). */
  warning?: string;
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
  if (!groupName) return;
  // Linha SÓ de aviso (ex.: fachete sem specs) entra com qtd 0 pra alertar o
  // gap de cadastro (paridade com o motor canônico); as demais de qtd 0 saem.
  if (totalQuantity <= 0 && !row.warning) return;

  const productUnit = row.productUnit?.trim() || 'un';
  const color = row.color?.trim() || '—';
  const materialName = row.materialName?.trim() || groupName;
  // Nome do material na chave — paridade com orderConsumption.ts: produtos
  // distintos do mesmo grupo/cor/unidade (ex.: "Binóculo 10mm" × "Binóculo 10mm
  // Strass" em COMPONENTES DIVERSOS/OURO LIGHT) são linhas separadas, senão a
  // Lista de Separação some com um deles.
  const key = `${row.componentType}||${groupName}||${materialName}||${color}||${productUnit}`;
  const existing = map.get(key);

  if (existing) {
    existing.totalQuantity += totalQuantity;
    if (row.widthMissing) existing.widthMissing = true;
    if (row.warning && !existing.warning) existing.warning = row.warning;
    // Equivalência em placas soma junto (é linear na mesma proporção do dm²).
    if (row.plateEquivalent) existing.plateEquivalent = (existing.plateEquivalent || 0) + row.plateEquivalent;
    return;
  }

  map.set(key, { componentType: row.componentType, groupName, materialName, productUnit, color, totalQuantity, widthMissing: row.widthMissing, plateEquivalent: row.plateEquivalent, warning: row.warning });
};

export async function calculateBomForOrders(orderIds: string[]): Promise<ConsumptionRow[]> {
  if (orderIds.length === 0) return [];

  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, reference_id, color, quantity, grade, sale_order_item_id, sale_order_id')
    .in('id', orderIds);

  if (ordersError) throw ordersError;
  if (!ordersData || ordersData.length === 0) return [];

  const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];
  const saleOrderItemIds = [...new Set(ordersData.map(o => o.sale_order_item_id).filter(Boolean))] as string[];
  const saleOrderIds = [...new Set(ordersData.map(o => o.sale_order_id).filter(Boolean))] as string[];

  const [
    { data: sheetsData },
    { data: materials, error: materialsError },
    { data: allProducts },
    { data: productGroups },
    { data: componentSheets },
    { data: saleOrderItems },
    { data: soleColorMappings },
    { data: saleOrdersPkg },
  ] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, upper_material, upper_material_product_id, upper_consumption, upper_consumption_per_size, lining_material, lining_material_product_id, lining_consumption, lining_consumption_per_size, insole_material, insole_consumption, insole_consumption_per_size, insole_ready_made, insole_has_lining, insole_lining_consumption, insole_lining_consumption_per_size, sole_material, sole_consumption, sole_color, sole_group_id, primary_sole_id, lining_accessories, components_accessories, strap_colors, sole_drives_consumption, direct_components, component_colors_enabled')
      .in('id', refIds),
    supabase
      .from('sheet_materials')
      // material_variant_id: NULL = linha compartilhada; preenchido = específica
      // de uma variante (semântica get_effective_bom) — escopo aplicado no loop.
      .select('sheet_id, product_id, group_id, quantity_per_unit, color, material_variant_id, products(name, unit, category), product_groups(name)')
      .in('sheet_id', refIds),
    // `quantity` entra pra cascata canônica de solado (P0/P2 escolhem por maior
    // estoque); `unit` pra unidade de estoque; `is_fachetado`/
    // `fachete_material_group_id` pro componente Fachete (BOM-2/BOM-5);
    // `category` pra classificar itens-padrão do solado (F2-01).
    supabase.from('products').select('id, name, color, category, group_id, quantity, unit, sole_classification, is_fachetado, fachete_material_group_id').eq('active', true),
    supabase.from('product_groups').select('id, name, dimensions_length, dimensions_width, dimensions_unit'),
    supabase
      .from('component_sheets')
      .select('product_id, dimensions_width, dimensions_length, dimensions_unit, yield_per_size, yield_per_sole, waste_pct, products!inner(group_id, name, color, unit)'),
    saleOrderItemIds.length > 0
      ? supabase.from('sale_order_items').select('id, strap_colors, fichas, material_variant_id').in('id', saleOrderItemIds)
      : Promise.resolve({ data: [] }),
    (supabase as any)
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id, sole_group_id')
      .in('sheet_id', refIds),
    // packaging_mode do PV — a ficha pode listar VÁRIAS caixas no BOM (colmeia +
    // individual) como alternativas; o pedido escolhe uma via packaging_mode e a
    // Lista de Separação deve mostrar SÓ a do modo (espelha o modal/orderConsumption).
    saleOrderIds.length > 0
      ? supabase.from('sale_orders').select('id, packaging_mode').in('id', saleOrderIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (materialsError) throw materialsError;

  const sheetsMap = new Map((sheetsData || []).map(s => [s.id, s]));
  const saleItemsMap = new Map((saleOrderItems || []).map((si: any) => [si.id, si]));

  // Variantes de material das fichas envolvidas (troca de grupo por componente
  // + pin de solado). Mesma precedência do motor canônico/resolvers SQL.
  const variantsById = new Map<string, any>();
  {
    const variantIds = [...new Set((saleOrderItems || []).map((si: any) => si.material_variant_id).filter(Boolean))];
    if (variantIds.length > 0) {
      const { data: variantRows } = await (supabase as any)
        .from('reference_material_variants')
        .select('id, reference_id, upper_material_product_id, upper_material_group_id, lining_material_product_id, lining_material_group_id, insole_material_product_id, insole_material_group_id, insole_consumption_override, sole_material_product_id, sole_consumption_override')
        .in('id', variantIds);
      for (const v of (variantRows || []) as any[]) variantsById.set(v.id, v);
    }
  }
  const packagingModeBySaleOrder = new Map<string, string | null>(
    (saleOrdersPkg || []).map((so: any) => [so.id, so.packaging_mode ?? null]),
  );
  const soleColorMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.product_color)}`, m.sole_product_id);
  }
  // Cascata CANÔNICA de solado (BOM-2): antes a Lista de Separação só conhecia
  // pin da variante + mapping explícito (P1) — pedidos que dependem de
  // coligação de cor (P0), mapping legado por grupo (P2) ou primary_sole_id
  // (P3) resolviam solado DIFERENTE do que o débito baixa. Mapas idênticos aos
  // do motor canônico (fetchConsumptionContext/orderConsumption.ts).
  const soleColorGroupMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (!m.sole_product_id && m.sole_group_id) soleColorGroupMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_group_id);
  }
  const sheetSoleGroupMap = new Map<string, string>();
  const sheetPrimarySoleMap = new Map<string, string>();
  for (const s of (sheetsData || []) as any[]) {
    if (s.id && s.sole_group_id) sheetSoleGroupMap.set(s.id, s.sole_group_id);
    if (s.id && s.primary_sole_id) sheetPrimarySoleMap.set(s.id, s.primary_sole_id);
  }
  const soleConjugationsByGroup = new Map<
    string,
    Array<{ cabedal_color: string; palmilha_color: string; is_default: boolean }>
  >();
  {
    const soleGroupIds = Array.from(new Set(sheetSoleGroupMap.values()));
    if (soleGroupIds.length > 0) {
      const { data: conjugations } = await (supabase as any)
        .from('sole_color_conjugations')
        .select('sole_group_id, cabedal_color, palmilha_color, is_default, active')
        .in('sole_group_id', soleGroupIds)
        .eq('active', true);
      for (const c of (conjugations || []) as any[]) {
        const arr = soleConjugationsByGroup.get(c.sole_group_id) || [];
        arr.push({ cabedal_color: c.cabedal_color, palmilha_color: c.palmilha_color, is_default: !!c.is_default });
        soleConjugationsByGroup.set(c.sole_group_id, arr);
      }
    }
  }

  // Componentes por cor (opt-in via component_colors_enabled) — BOM-6. Chave
  // (sheet_id::corNormalizada), mesma paridade de match do SQL/motor canônico.
  const componentColorMap = new Map<string, Array<{ productId: string; quantityPerUnit: number }>>();
  {
    const { data: componentColorMappings } = await (supabase as any)
      .from('technical_sheet_component_colors')
      .select('sheet_id, cabedal_color, product_id, quantity_per_unit')
      .in('sheet_id', refIds);
    for (const m of (componentColorMappings || []) as any[]) {
      if (!m.product_id) continue;
      const key = `${m.sheet_id}::${normalizeColorKey(m.cabedal_color)}`;
      const arr = componentColorMap.get(key) || [];
      arr.push({ productId: m.product_id, quantityPerUnit: Number(m.quantity_per_unit) || 0 });
      componentColorMap.set(key, arr);
    }
  }

  // Padrões GLOBAIS por cor (component_color_defaults) — regra por GRUPO, não
  // por ficha: (group_id::corNormalizada) → product_id; linha is_default vira a
  // chave catch-all (group_id::*). Regra exata vence o default. Espelha o
  // lookup SQL do by_grade (mig 20260928121000) e o motor canônico
  // (orderConsumption.ts).
  const componentColorDefaultMap = new Map<string, string>();
  {
    const { data: componentColorDefaults } = await (supabase as any)
      .from('component_color_defaults')
      .select('group_id, cabedal_color, product_id, is_default')
      .eq('active', true);
    for (const d of (componentColorDefaults || []) as any[]) {
      if (!d.group_id || !d.product_id) continue;
      const key = d.is_default ? `${d.group_id}::*` : `${d.group_id}::${normalizeColorKey(d.cabedal_color)}`;
      componentColorDefaultMap.set(key, d.product_id);
    }
  }

  // Cor do FORRO mapeada por cor do cabedal — usada pela linha de Fachete
  // (paridade com o motor canônico; as demais linhas seguem com a cor do pedido).
  const liningColorMap = new Map<string, string>();
  const liningDefaultMap = new Map<string, string>();
  {
    const { data: liningColorMappings } = await (supabase as any)
      .from('technical_sheet_lining_colors')
      .select('sheet_id, cabedal_color, lining_color')
      .in('sheet_id', refIds);
    for (const m of (liningColorMappings || []) as any[]) {
      liningColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.cabedal_color)}`, m.lining_color);
      if (m.cabedal_color === '__DEFAULT__') liningDefaultMap.set(m.sheet_id, m.lining_color);
    }
  }

  // FORRO DO CABEDAL por número (dm²/par) do SOLADO — fonte do consumo do forro
  // (2026-07-01), espelha orderConsumption/custeio. A ficha só escolhe grupo/cor.
  const liningSpecBySole = new Map<string, Record<string, number>>();
  // FORRAÇÃO DA PALMILHA por número (dm²/par) do SOLADO
  // (insole_lining_consumption_dm2) — mesma fonte do motor canônico
  // (orderConsumption.ts) e do SQL by_grade. Faltava na Lista de Separação:
  // o campo era buscado na ficha mas nunca emitido (auditoria 2026-07-19, BOM-1).
  const insoleLiningSpecBySole = new Map<string, Record<string, number>>();
  // PALMILHA PLACA por número (dm²/par) do SOLADO (insole_consumption_dm2) —
  // BOM-4: a Lista de Separação ignorava e usava só escalar/yield da ficha,
  // divergindo do modal/débito quando o solado dirige o consumo.
  const insoleSpecBySole = new Map<string, Record<string, number>>();
  // FACHETE por número (dm²/par) do SOLADO (fachete_lining_consumption_dm2) —
  // BOM-5: componente inteiro faltava na Lista de Separação.
  const facheteSpecBySole = new Map<string, Record<string, number>>();
  // Mapas JSONB canônicos do TIPO de solado. Eles vencem os campos `*_dm2`
  // legados, que continuam como fallback por compatibilidade de cadastro.
  const liningConsumptionPerSizeBySole = new Map<string, Record<string, number>>();
  const insoleConsumptionPerSizeBySole = new Map<string, Record<string, number>>();
  const insoleLiningConsumptionPerSizeBySole = new Map<string, Record<string, number>>();
  const facheteConsumptionPerSizeBySole = new Map<string, Record<string, number>>();
  {
    const { data: liningSpecs } = await (supabase as any)
      .from('sole_technical_specs')
      .select('sole_id, size, lining_consumption_dm2, insole_lining_consumption_dm2, insole_consumption_dm2, fachete_lining_consumption_dm2, lining_consumption_per_size, insole_lining_consumption_per_size, insole_consumption_per_size, fachete_lining_consumption_per_size');
    for (const r of (liningSpecs || []) as any[]) {
      const v = Number(r.lining_consumption_dm2) || 0;
      if (v > 0 && r.size != null) {
        const m = liningSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = v;
        liningSpecBySole.set(r.sole_id, m);
      }
      const lv = Number(r.insole_lining_consumption_dm2) || 0;
      if (lv > 0 && r.size != null) {
        const m = insoleLiningSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = lv;
        insoleLiningSpecBySole.set(r.sole_id, m);
      }
      const iv = Number(r.insole_consumption_dm2) || 0;
      if (iv > 0 && r.size != null) {
        const m = insoleSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = iv;
        insoleSpecBySole.set(r.sole_id, m);
      }
      const fv = Number(r.fachete_lining_consumption_dm2) || 0;
      if (fv > 0 && r.size != null) {
        const m = facheteSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = fv;
        facheteSpecBySole.set(r.sole_id, m);
      }
      const liningCanonical = mergePerSizeConsumption(
        liningConsumptionPerSizeBySole.get(r.sole_id), r.lining_consumption_per_size,
      );
      if (Object.keys(liningCanonical).length > 0) liningConsumptionPerSizeBySole.set(r.sole_id, liningCanonical);
      const insoleCanonical = mergePerSizeConsumption(
        insoleConsumptionPerSizeBySole.get(r.sole_id), r.insole_consumption_per_size,
      );
      if (Object.keys(insoleCanonical).length > 0) insoleConsumptionPerSizeBySole.set(r.sole_id, insoleCanonical);
      const insoleLiningCanonical = mergePerSizeConsumption(
        insoleLiningConsumptionPerSizeBySole.get(r.sole_id), r.insole_lining_consumption_per_size,
      );
      if (Object.keys(insoleLiningCanonical).length > 0) insoleLiningConsumptionPerSizeBySole.set(r.sole_id, insoleLiningCanonical);
      const facheteCanonical = mergePerSizeConsumption(
        facheteConsumptionPerSizeBySole.get(r.sole_id), r.fachete_lining_consumption_per_size,
      );
      if (Object.keys(facheteCanonical).length > 0) facheteConsumptionPerSizeBySole.set(r.sole_id, facheteCanonical);
    }
  }

  // ITENS-PADRÃO do solado por numeração (F2-01) — mesma fonte do motor
  // canônico/SQL ("Item padrão (solado)"). Candidatos = produtos que a cascata
  // de solado destas fichas pode resolver.
  const soleStandardItemsBySole = new Map<string, Array<{ standardItemId: string; size: number; consumption: number; unit: string | null }>>();
  {
    const candidateIds = new Set<string>();
    for (const pid of soleColorMap.values()) candidateIds.add(pid);
    for (const pid of sheetPrimarySoleMap.values()) candidateIds.add(pid);
    const candidateGroupIds = new Set<string>([
      ...sheetSoleGroupMap.values(),
      ...soleColorGroupMap.values(),
    ]);
    for (const p of (allProducts || []) as any[]) {
      if (p.group_id && candidateGroupIds.has(p.group_id)) candidateIds.add(p.id);
    }
    for (const v of variantsById.values()) {
      if (v?.sole_material_product_id) candidateIds.add(v.sole_material_product_id);
    }
    if (candidateIds.size > 0) {
      const { data: stdItems } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .select('sole_product_id, standard_item_id, size, consumption, unit')
        .in('sole_product_id', [...candidateIds])
        .gt('consumption', 0);
      for (const r of (stdItems || []) as any[]) {
        const cons = Number(r.consumption) || 0;
        if (cons <= 0 || r.size == null || !r.standard_item_id) continue;
        const arr = soleStandardItemsBySole.get(r.sole_product_id) || [];
        arr.push({ standardItemId: r.standard_item_id, size: Number(r.size), consumption: cons, unit: r.unit ?? null });
        soleStandardItemsBySole.set(r.sole_product_id, arr);
      }
    }
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

  // Ficha de conversão dm²→física na MESMA ordem do SQL
  // (get_material_conversion_info): cs do PRODUTO resolvido/pinado (com
  // dimensões) primeiro; senão a preferida do grupo (F2-04 — paridade com o
  // motor canônico orderConsumption.ts).
  const getConversionSheetForProduct = (
    productId: string | null | undefined,
    groupName: string,
    opts: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
  ) => {
    if (productId) {
      const own = (componentSheets || []).find((c: any) => c.product_id === productId);
      if (own && (Number((own as any).dimensions_width) > 0 || Number((own as any).dimensions_length) > 0)) return own;
    }
    return getPreferredGroupSheet(groupName, opts);
  };

  // Tamanhos da grade SEM valor no mapa de specs do solado — aviso
  // fallback_average (contrato SQL: tamanho sem spec cai no ESCALAR da ficha —
  // F2-02). Mesmo texto do motor canônico.
  const sizesMissingFromSpec = (grade: Record<string, number> | null | undefined, perSize: Record<string, number>): string[] => {
    if (!grade || typeof grade !== 'object') return [];
    const missing: string[] = [];
    for (const [k, v] of Object.entries(grade)) {
      if (k.startsWith('_') || !((Number(v) || 0) > 0)) continue;
      if (!((Number(perSize[k]) || 0) > 0)) missing.push(k);
    }
    return missing;
  };
  const fallbackAverageWarning = (missing: string[]): string =>
    `Tamanhos usando a média escalar da ficha (sem consumo por numeração): ${missing.join(', ')}`;

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
      // `fichas` NÃO é forçado (era hardcoded 1): null deixa o fallback EXATO
      // (quantity ÷ gradeTotal) dos motores agir — escala-invariante, correto
      // tanto quando orders.grade é a grade REAL (Σ = quantity ⇒ 1×) quanto
      // quando é a grade BASE (Σ = 1 ficha ⇒ quantity/base). Com 1 fixo, OPs
      // com grade base subcontavam tiras/per-size (auditoria 2026-07-01).
      fichas: null,
      strap_colors: saleItem?.strap_colors ?? null,
    };
    const itemQuantity = Number(item.quantity) || 0;
    const orderColor = item.color || '—';

    // Variante de material do item do PV: troca a ORIGEM (grupo/produto) por
    // componente, com a área da ficha — espelha o motor canônico
    // (orderConsumption.ts) e os resolvers SQL (mig 20260907120500).
    const variant = saleItem?.material_variant_id ? variantsById.get(saleItem.material_variant_id) : undefined;
    const groupNameById = (gid: string | null | undefined): string =>
      gid ? (((productGroups || []).find((g: any) => g.id === gid) as any)?.name || '') : '';
    const variantGroupName = (pid: string | null | undefined, gid: string | null | undefined): string => {
      const pin = pid ? (allProducts || []).find((p: any) => p.id === pid) || null : null;
      return pin ? groupNameById((pin as any).group_id) : groupNameById(gid);
    };
    const upperVariantGroup = variant ? variantGroupName(variant.upper_material_product_id, variant.upper_material_group_id) : '';
    const liningVariantGroup = variant ? variantGroupName(variant.lining_material_product_id, variant.lining_material_group_id) : '';
    const insoleVariantGroup = variant ? variantGroupName(variant.insole_material_product_id, variant.insole_material_group_id) : '';
    const variantSolePid: string | null = variant?.sole_material_product_id
      && (allProducts || []).some((p: any) => p.id === variant.sole_material_product_id)
      ? variant.sole_material_product_id
      : null;

    // Cabedal
    const allCabedalAccessories = Array.isArray(sheet?.components_accessories)
      ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
      : [];
    const upperAlts = allCabedalAccessories.filter((e: any) => !e.mandatory);
    const mandatoryCabedalMaterials = allCabedalAccessories.filter((e: any) => e.mandatory === true);
    const upperMatch = upperVariantGroup
      ? { group: upperVariantGroup, consumption: Number(sheet?.upper_consumption) || 0 }
      : resolveOption(sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0, upperAlts, orderColor);
    if (upperMatch) {
      const isPrincipal = !!upperVariantGroup || upperMatch.group === (sheet?.upper_material || '');
      // Pin de SKU (variante > ficha): a cs do produto pinado dirige a conversão
      // dm²→m quando existir — MESMA ordem do SQL/motor canônico (F2-04).
      const upperPinId: string | null =
        (variant?.upper_material_product_id && (allProducts || []).some((p: any) => p.id === variant.upper_material_product_id))
          ? variant.upper_material_product_id
          : (isPrincipal && (sheet as any)?.upper_material_product_id
              && (allProducts || []).some((p: any) => p.id === (sheet as any).upper_material_product_id)
            ? (sheet as any).upper_material_product_id
            : null);
      const upperSheet = getConversionSheetForProduct(upperPinId, upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
      const overridePerSize = isPrincipal
        ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
        : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
      // Tamanho sem valor por numeração cai no ESCALAR FLAT da ficha (contrato
      // SQL — F2-02); o multiplicador por tamanho saiu (era só do TS).
      const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal', groupName: upperMatch.group, materialName: 'Cabedal',
        productUnit: 'metro', color: orderColor, totalQuantity: upperTotal,
      });
    }

    for (const mandMat of mandatoryCabedalMaterials) {
      const mandConsumption = Number(mandMat.consumption) || 0;
      if (!mandMat.material || mandConsumption <= 0) continue;
      // Item fixado (product_id): converte pela cs do produto pinado (F2-04).
      const mandSheet = getConversionSheetForProduct(mandMat.product_id, mandMat.material, { color: orderColor, mode: 'linear', preferYield: true });
      const mandOverride = (mandMat.consumption_per_size && Object.keys(mandMat.consumption_per_size).length > 0) ? mandMat.consumption_per_size : null;
      const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal', groupName: mandMat.material, materialName: 'Material Fixo',
        productUnit: 'metro', color: orderColor, totalQuantity: mandTotal,
      });
    }

    // Forro
    const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
    const liningMatch = liningVariantGroup
      ? { group: liningVariantGroup, consumption: Number(sheet?.lining_consumption) || 0 }
      : resolveOption(sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0, liningAlts, orderColor);
    // Anti-duplicidade FORRAÇÃO (cabedal × palmilha) — mesma condição do motor
    // canônico (orderConsumption.ts) e do SQL (mig 20260911120000): solado
    // dirige o forro de PALMILHA (insole_lining_consumption_dm2 > 0) sem forro
    // de cabedal (lining_consumption_dm2 nulo) ⇒ a "Forração" (cabedal) da
    // ficha É a palmilha digitada no campo errado — não emitir 2× a mesma napa.
    // Faltava na Lista de Separação (auditoria 2026-07-19, BOM-3).
    // Resolução CANÔNICA de solado (BOM-2): pin da variante > cascata P0–P3
    // (coligação de cor → mapping explícito → mapping legado por grupo/maior
    // estoque → primary_sole_id) — a MESMA função do motor canônico
    // (resolveSoleProductIdCanonical), não mais só o mapping explícito.
    const resolvedSolePid: string | null = variantSolePid
      || resolveSoleProductIdCanonical(order.reference_id, orderColor, {
        sheetSoleGroupMap,
        soleConjugationsByGroup,
        soleColorMap,
        soleColorGroupMap,
        sheetPrimarySoleMap,
        allProducts: allProducts || [],
    });
    const soleIdForLiningBom = resolvedSolePid;
    const soleInsoleLiningConsumption = mergePerSizeConsumption(
      insoleLiningSpecBySole.get(soleIdForLiningBom || ''),
      insoleLiningConsumptionPerSizeBySole.get(soleIdForLiningBom || ''),
    );
    const soleLiningConsumption = mergePerSizeConsumption(
      liningSpecBySole.get(soleIdForLiningBom || ''),
      liningConsumptionPerSizeBySole.get(soleIdForLiningBom || ''),
    );
    const suppressCabedalForracao = sheet?.sole_drives_consumption === true
      && Object.values(soleInsoleLiningConsumption).some((v) => Number(v) > 0)
      && !Object.values(soleLiningConsumption).some((v) => Number(v) > 0);
    // Pin de SKU do forro (variante > ficha) — hoisted: dirige a ficha de
    // conversão (F2-04) do Forro E da Forração Palmilha abaixo.
    const isPrincipalLining = !!liningMatch && (!!liningVariantGroup || liningMatch.group === (sheet?.lining_material || ''));
    const liningPinId: string | null =
      (variant?.lining_material_product_id && (allProducts || []).some((p: any) => p.id === variant.lining_material_product_id))
        ? variant.lining_material_product_id
        : (isPrincipalLining && (sheet as any)?.lining_material_product_id
            && (allProducts || []).some((p: any) => p.id === (sheet as any).lining_material_product_id)
          ? (sheet as any).lining_material_product_id
          : null);
    if (liningMatch && !suppressCabedalForracao) {
      const liningSheet = getConversionSheetForProduct(liningPinId, liningMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const soleProductId = soleIdForLiningBom;
      const liningAltRecord = isPrincipalLining ? null : liningAlts.find((a: any) => a.material === liningMatch.group);
      // Alternativa: consumo por número da própria ficha. Principal: do SOLADO.
      const liningOverride = isPrincipalLining
        ? null
        : (liningAltRecord?.consumption_per_size && Object.keys(liningAltRecord.consumption_per_size).length > 0 ? liningAltRecord.consumption_per_size : null);
      // FORRO DO CABEDAL: ficha por número > mapa canônico do tipo de solado >
      // legado `lining_consumption_dm2` > escalar da ficha.
      const liningSolePerSize = isPrincipalLining
        ? mergePerSizeConsumption(
            liningSpecBySole.get(soleProductId || ''),
            liningConsumptionPerSizeBySole.get(soleProductId || ''),
            sheet?.lining_consumption_per_size,
          )
        : {};
      const liningSoleVals = Object.values(liningSolePerSize).filter((v) => Number(v) > 0) as number[];
      const liningWidthMissing = isLinearWidthMissing(liningSheet, 'm');
      let liningTotal: number;
      let liningWarning: string | undefined;
      if (isPrincipalLining && liningSoleVals.length > 0) {
        const liningDm2 = calculateGradeBasedDm2(item, liningMatch.consumption, null, liningSolePerSize, soleProductId);
        liningTotal = liningWidthMissing ? liningDm2 : convertDm2ToLinearMeters(liningDm2, liningSheet);
        const missing = sizesMissingFromSpec(item.grade, liningSolePerSize);
        if (missing.length > 0 && liningMatch.consumption > 0) liningWarning = fallbackAverageWarning(missing);
      } else {
        liningTotal = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', liningOverride, soleProductId).total;
      }
      addConsumptionRow(consumptionMap, {
        componentType: 'Forração', groupName: liningMatch.group, materialName: 'Forração',
        productUnit: 'metro', color: orderColor, totalQuantity: liningTotal,
        warning: liningWarning,
      });
    }

    // Palmilha — PULADA INTEIRA quando é palmilha pronta (solado já vem forrado
    // de fábrica): a grade não cobra placa. Mesma regra do orderConsumption.ts
    // (motor canônico). Antes o BOM contava placa mesmo na palmilha pronta,
    // inflando consumo/compra (MRP)/custo.
    const soleProductIdForInsole = resolvedSolePid;
    const insoleSoleProd = soleProductIdForInsole
      ? (allProducts || []).find((p: any) => p.id === soleProductIdForInsole)
      : null;
    const isPalmilhaPronta = (sheet?.insole_ready_made === true)
      || ((insoleSoleProd as any)?.sole_classification === 'palmilha_pronta');
    if (!isPalmilhaPronta) {
      const insoleGroupName = insoleVariantGroup || sheet?.insole_material || '';
      const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
      // Produto de palmilha RESOLVIDO como no SQL (F2-03): pin da variante >
      // resolve_material_product (cor exata > cor no nome > maior estoque do
      // grupo). É o produto que débito/reserva/custeio baixam — a unidade da
      // linha segue a DELE.
      const insoleVariantPin = variant?.insole_material_product_id
        ? (allProducts || []).find((p: any) => p.id === variant.insole_material_product_id) || null
        : null;
      const resolvedPalmProd = insoleVariantPin
        || resolveMaterialProductCanonical(insoleGroupName, orderColor, allProducts || [], productGroups || []);
      // Ficha de conversão: cs do produto resolvido primeiro (F2-04).
      const insoleSheet = getConversionSheetForProduct(resolvedPalmProd?.id, insoleGroupName, { mode: 'plate', preferYield: true });
      // PLACA por número: ficha por número > mapa canônico do tipo de solado >
      // legado `insole_consumption_dm2` > escalar da ficha. Override legado da
      // variante é consumo explícito e continua vencendo todos esses mapas.
      const hasLegacyInsoleOverride = !!variant && variant.insole_consumption_override != null;
      const insoleScalarConsumption = hasLegacyInsoleOverride
        ? (Number(variant.insole_consumption_override) || 0)
        : (Number(sheet?.insole_consumption) || 0);
      const insoleSolePerSize = hasLegacyInsoleOverride
        ? {}
        : mergePerSizeConsumption(
            insoleSpecBySole.get(soleProductIdForInsole || ''),
            insoleConsumptionPerSizeBySole.get(soleProductIdForInsole || ''),
            sheet?.insole_consumption_per_size,
          );
      const insoleSoleVals = Object.values(insoleSolePerSize).filter((v) => Number(v) > 0) as number[];
      const insoleDm2 = insoleSoleVals.length > 0
        ? calculateGradeBasedDm2(item, insoleScalarConsumption, null, insoleSolePerSize, soleProductIdForInsole)
        : calculateGradeBasedDm2(item, insoleScalarConsumption, insoleSheet, undefined, soleProductIdForInsole);
      const insoleMissing = insoleSoleVals.length > 0 ? sizesMissingFromSpec(item.grade, insoleSolePerSize) : [];
      const insoleWarning = (insoleMissing.length > 0 && insoleScalarConsumption > 0)
        ? fallbackAverageWarning(insoleMissing)
        : undefined;
      const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
      // Aplica waste_pct também no caminho que usa dimensões do grupo, para
      // manter paridade com convertDm2ToPlates() (fallback).
      const insoleWastePct = Number(insoleSheet?.waste_pct) || 0;
      // Área da placa: dimensões do GRUPO prevalecem; fallback = dimensões da
      // própria ficha de componente (mesma conta do convertDm2ToPlates).
      const insolePlateAreaDm2 = groupPlateArea > 0 ? groupPlateArea : calcGroupPlateAreaDm2(insoleSheet);
      const insolePlates = insolePlateAreaDm2 > 0
        ? (insoleDm2 / insolePlateAreaDm2) * (1 + insoleWastePct / 100)
        : convertDm2ToPlates(insoleDm2, insoleSheet);
      // Unidade de ESTOQUE = a do produto resolvido (F2-03); fallback: unidade
      // do produto da ficha de componente escolhida. Quando o produto é
      // estocado/debitado em dm² (ex.: PLACA 1.0 EVA), a linha SAI em dm²;
      // quando é LINEAR (ex.: rolo EVA 3MM em m), converte dm²→m pela largura
      // (espelha o SQL). Sem unidade conhecida, mantém 'placa'.
      const insoleStockUnit = ((resolvedPalmProd?.unit || (insoleSheet as any)?.products?.unit || '') as string).toString().trim();
      const insoleStockIsDm2 = ['dm²', 'dm2'].includes(insoleStockUnit.toLowerCase());
      const insoleStockIsLinear = LINEAR_UNITS.has(insoleStockUnit.toLowerCase());
      if (insoleStockIsDm2) {
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha', groupName: insoleGroupName,
          materialName: resolvedPalmProd?.name || 'Palmilha',
          productUnit: insoleStockUnit, color: resolvedPalmProd?.color || '—',
          // Perda aplicada igual ao caminho de placas (paridade convertDm2ToPlates
          // e com o SQL, que aplica ×(1+waste) incondicionalmente — F2-08).
          totalQuantity: insoleDm2 * (1 + insoleWastePct / 100),
          plateEquivalent: insolePlateAreaDm2 > 0 ? insolePlates : undefined,
          warning: insoleWarning,
        });
      } else if (insoleStockIsLinear) {
        const linSheet = getConversionSheetForProduct(resolvedPalmProd?.id, insoleGroupName, { mode: 'linear', preferYield: true });
        const linWidthMissing = isLinearWidthMissing(linSheet as any, 'm');
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha', groupName: insoleGroupName,
          materialName: resolvedPalmProd?.name || 'Palmilha',
          productUnit: linWidthMissing ? 'dm2' : 'metro',
          color: resolvedPalmProd?.color || '—',
          totalQuantity: linWidthMissing ? insoleDm2 : convertDm2ToLinearMeters(insoleDm2, linSheet as any),
          widthMissing: linWidthMissing,
          warning: insoleWarning,
        });
      } else {
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha', groupName: insoleGroupName, materialName: 'Palmilha',
          productUnit: 'placa', color: '—', totalQuantity: insolePlates,
          warning: insoleWarning,
        });
      }

      // FORRAÇÃO DA PALMILHA — napa do forro RESOLVIDO (pick-one) que cobre a
      // placa: variante > grupo eleito pelo resolveOption (alternativa quando a
      // principal não tem a cor) > lining_material cru. O SQL resolve as duas
      // linhas pelo MESMO v_lining_pid — usar o lining_material cru aqui mandava
      // cortar a napa errada quando o forro era alternativo (F2-09). Área por
      // número segue: ficha por número > mapa canônico do solado > legado
      // `insole_lining_consumption_dm2` > escalar da ficha.
      const insoleLiningCons = Number(sheet?.insole_lining_consumption) || 0;
      const liningGroupForPalm = liningVariantGroup || liningMatch?.group || sheet?.lining_material || '';
      const insoleLiningSolePerSize = mergePerSizeConsumption(
        insoleLiningSpecBySole.get(soleProductIdForInsole || ''),
        insoleLiningConsumptionPerSizeBySole.get(soleProductIdForInsole || ''),
        sheet?.insole_lining_consumption_per_size,
      );
      const insoleLiningSoleVals = Object.values(insoleLiningSolePerSize).filter((v) => Number(v) > 0) as number[];
      if ((insoleLiningCons > 0 || insoleLiningSoleVals.length > 0) && liningGroupForPalm && sheet?.insole_has_lining !== false) {
        // Mesma ficha de conversão do Forro do cabedal (cs do pin primeiro —
        // F2-04): o SQL converte as duas linhas pela mesma
        // get_material_conversion_info(v_lining_pid).
        const forrSheet = getConversionSheetForProduct(liningPinId, liningGroupForPalm, { color: orderColor, mode: 'linear', preferYield: true });
        const forrWidthMissing = isLinearWidthMissing(forrSheet, 'm');
        let forrTotal: number;
        let forrWarning: string | undefined;
        if (insoleLiningSoleVals.length > 0) {
          const forrDm2 = calculateGradeBasedDm2(item, insoleLiningCons, null, insoleLiningSolePerSize, soleProductIdForInsole);
          forrTotal = forrWidthMissing ? forrDm2 : convertDm2ToLinearMeters(forrDm2, forrSheet);
          const missing = sizesMissingFromSpec(item.grade, insoleLiningSolePerSize);
          if (missing.length > 0 && insoleLiningCons > 0) forrWarning = fallbackAverageWarning(missing);
        } else {
          forrTotal = calculateConsumptionWithUnit(item, insoleLiningCons, forrSheet, 'metro', undefined, soleProductIdForInsole).total;
        }
        if (forrTotal > 0 || forrWarning) addConsumptionRow(consumptionMap, {
          componentType: 'Forração', groupName: liningGroupForPalm, materialName: 'Forração Palmilha',
          productUnit: 'metro', color: orderColor, totalQuantity: forrTotal,
          widthMissing: forrWidthMissing,
          warning: forrWarning,
        });
      }
    }

    // Solado — cor REAL do solado resolvido (cascata canônica, espelha
    // resolve_sole_color do débito). Fallback pra cor do pedido → sole_color da
    // ficha → rótulo neutro.
    const soleColor = ((insoleSoleProd as any)?.color || orderColor || sheet?.sole_color || '—').trim() || '—';
    // BOM-7 (paridade com o motor canônico): agrupa pelo grupo do produto-solado
    // RESOLVIDO (qualquer fonte da cascata, não só pin de variante) — a ficha
    // pode nem ter sole_material textual e o solado sumia da Lista. Consumo =
    // override da variante > sole_consumption da ficha > default CANÔNICO de
    // 1 par/par (com `? 1 : 0`, sole_consumption 0/null apagava a linha
    // enquanto o débito baixa 1 par por par).
    const resolvedSoleGroupName = resolvedSolePid
      ? (groupNameById((insoleSoleProd as any)?.group_id) || (insoleSoleProd as any)?.name || '')
      : '';
    const solePerPair = ((variant?.sole_consumption_override != null
      ? Number(variant.sole_consumption_override)
      : Number(sheet?.sole_consumption)) || 1);
    addConsumptionRow(consumptionMap, {
      componentType: 'Solado', groupName: resolvedSoleGroupName || sheet?.sole_material || '', materialName: 'Solado',
      productUnit: 'par', color: soleColor, totalQuantity: solePerPair * itemQuantity,
    });

    // FACHETE — forração EXTRA do salto fachetado (BOM-5). Espelha o motor
    // canônico (orderConsumption.ts): solado is_fachetado com consumo por
    // numeração em sole_technical_specs.fachete_lining_consumption_dm2; o
    // material vem do grupo products.fachete_material_group_id (fallback
    // lining_material da ficha); dm²→metro pela largura da ficha do material.
    // Sem consumo cadastrado, emite linha de AVISO (qtd 0) — antes o forro
    // extra do salto simplesmente não entrava no picking.
    if ((insoleSoleProd as any)?.is_fachetado && resolvedSolePid) {
      const facheteGroupId = (insoleSoleProd as any).fachete_material_group_id;
      const facheteGroupName = facheteGroupId ? (groupNameById(facheteGroupId) || '') : '';
      const facheteMaterialName = facheteGroupName || (sheet?.lining_material || '');
      const fachetePerSize = mergePerSizeConsumption(
        facheteSpecBySole.get(resolvedSolePid),
        facheteConsumptionPerSizeBySole.get(resolvedSolePid),
      );
      const facheteVals = Object.values(fachetePerSize).filter((v) => Number(v) > 0) as number[];
      const facheteLiningColor = liningColorMap.get(`${order.reference_id}::${normalizeColorKey(orderColor)}`)
        || liningDefaultMap.get(order.reference_id) || orderColor;
      if (facheteMaterialName && facheteVals.length > 0) {
        // Produto do fachete resolvido como no SQL (resolve_material_product) e
        // conversão pela cs DELE quando houver (F2-04).
        const facheteProd = resolveMaterialProductCanonical(facheteMaterialName, facheteLiningColor, allProducts || [], productGroups || []);
        const facheteSheet = getConversionSheetForProduct(facheteProd?.id, facheteMaterialName, { color: facheteLiningColor, mode: 'linear', preferYield: true });
        const avgFachete = facheteVals.reduce((a, b) => a + b, 0) / facheteVals.length;
        // sheet null força o uso PURO do override (dm²/par) — senão trataria
        // dm² como metros (~100× errado); depois converte pela largura.
        // Tamanho SEM spec contribui ZERO + aviso (contrato SQL:
        // v_warn_fachete_sizes — F2-02); item sem grade preserva o legado.
        const facheteGradeEntries = Object.entries((item.grade || {}) as Record<string, number>)
          .filter(([k, v]) => !k.startsWith('_') && (Number(v) || 0) > 0);
        const facheteDm2 = facheteGradeEntries.length > 0
          ? calculateGradeBasedDm2(item, 0, null, fachetePerSize, resolvedSolePid)
          : calculateGradeBasedDm2(item, avgFachete, null, fachetePerSize, resolvedSolePid);
        const facheteMissing = facheteGradeEntries.length > 0 ? sizesMissingFromSpec(item.grade, fachetePerSize) : [];
        const facheteWarning = facheteMissing.length > 0
          ? `Tamanhos sem consumo de fachete: ${facheteMissing.join(', ')}`
          : undefined;
        const facheteWidthMissing = isLinearWidthMissing(facheteSheet, 'm');
        const facheteTotal = facheteWidthMissing ? facheteDm2 : convertDm2ToLinearMeters(facheteDm2, facheteSheet);
        addConsumptionRow(consumptionMap, {
          componentType: 'Forração', groupName: facheteMaterialName, materialName: 'Fachete',
          productUnit: facheteWidthMissing ? 'dm2' : 'metro', color: facheteLiningColor,
          totalQuantity: facheteTotal, widthMissing: facheteWidthMissing,
          warning: facheteWarning,
        });
      } else {
        addConsumptionRow(consumptionMap, {
          componentType: 'Forração', groupName: facheteMaterialName || 'Fachete', materialName: 'Fachete',
          productUnit: 'dm2', color: facheteLiningColor, totalQuantity: 0,
          warning: 'Solado fachetado sem consumo de fachete cadastrado — a forração extra do salto NÃO entrou na Lista. Cadastre fachete_lining_consumption_dm2 em Materiais → Solado.',
        });
      }
    }

    // ── ITENS-PADRÃO do solado (sole_standard_items_consumption) — F2-01 ─────
    // Espelha o ramo "Item padrão (solado)" do SQL by_grade e o motor canônico
    // (orderConsumption.ts): consumo POR NUMERAÇÃO na unidade cadastrada,
    // convertido pra unidade de ESTOQUE do produto, com o dedup anti-BOM
    // (produto coberto sai do BOM/direct). Antes a Lista de Separação mandava
    // separar as colas do BOM enquanto o custeio/débito usavam os itens-padrão.
    const stdCoveredProductIds = new Set<string>();
    {
      const stdItemsForSole = resolvedSolePid
        ? (soleStandardItemsBySole.get(resolvedSolePid) || [])
        : [];
      const gradeRaw = (item.grade || {}) as Record<string, number>;
      const baseGrade: Record<string, number> = {};
      for (const [k, v] of Object.entries(gradeRaw)) {
        if (!k.startsWith('_') && (Number(v) || 0) > 0) baseGrade[k] = Number(v) || 0;
      }
      const baseSum = Object.values(baseGrade).reduce((s, v) => s + v, 0);
      if (stdItemsForSole.length > 0 && baseSum > 0 && itemQuantity > 0) {
        // Grade escalada pro total REAL (largest remainder — mesma regra do
        // motor canônico/matriz de solado).
        const scaledStd = scaleGradeWithLargestRemainder(baseGrade, itemQuantity / baseSum, itemQuantity);
        const stdAcc = new Map<string, { required: number; unit: string | null }>();
        for (const [sizeKey, pairs] of Object.entries(scaledStd)) {
          const sizeInt = parseInt(String(sizeKey).split('/')[0], 10);
          if (!Number.isFinite(sizeInt) || !(pairs > 0)) continue;
          for (const std of stdItemsForSole) {
            if (std.size !== sizeInt) continue;
            const a = stdAcc.get(std.standardItemId) || { required: 0, unit: std.unit };
            a.required += std.consumption * pairs;
            stdAcc.set(std.standardItemId, a);
          }
        }
        for (const [pid, a] of stdAcc.entries()) {
          if (!(a.required > 0)) continue;
          const prod = (allProducts || []).find((p: any) => p.id === pid) as any;
          if (!prod) continue;
          const stdGroupName = groupNameById(prod.group_id) || prod.category || prod.name || 'Outros';
          const converted = convertToProductUnit(a.required, a.unit, prod.unit);
          addConsumptionRow(consumptionMap, {
            componentType: classifyBomMaterial(stdGroupName, prod.name || '', prod.category || ''),
            groupName: stdGroupName,
            materialName: prod.name || stdGroupName,
            productUnit: converted != null ? (prod.unit || a.unit || 'un') : (a.unit || prod.unit || 'un'),
            color: prod.color || '—',
            totalQuantity: converted != null ? converted : a.required,
            warning: converted == null
              ? `Unidade do item-padrão (${a.unit || '?'}) incompatível com a unidade do produto (${prod.unit || '?'}) — quantidade NÃO convertida; cadastre a unidade correta`
              : undefined,
          });
          stdCoveredProductIds.add(pid);
        }
      }
    }

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

    // Componentes por cor (opt-in) OU direct_components (fallback) — BOM-6.
    // Espelha o gate do motor canônico/SQL: com component_colors_enabled ligado
    // e mapeamento pra cor do pedido, a lista POR COR substitui
    // direct_components por completo; sem flag (ou cor sem mapeamento), cai em
    // direct_components. Antes a Lista de Separação ignorava os dois caminhos —
    // itens cadastrados direto na ficha (ex.: BINÓCULO 6MM 8/par) ficavam fora
    // do picking.
    const hasOrderColor = !!orderColor && orderColor !== '—';
    const perColorComponents = (hasOrderColor && sheet?.component_colors_enabled)
      ? componentColorMap.get(`${order.reference_id}::${normalizeColorKey(orderColor)}`)
      : undefined;
    const usedPerColorComponents = !!(perColorComponents && perColorComponents.length > 0);
    const directComponents = usedPerColorComponents
      ? perColorComponents.map((r) => ({ product_id: r.productId, quantity: r.quantityPerUnit }))
      : (Array.isArray(sheet?.direct_components) ? sheet.direct_components : []);
    // Cor sem mapeamento com "componentes por cor" LIGADO → fallback pra lista
    // geral, que costuma listar TODAS as variantes de cor do ornamento (o par
    // acaba consumindo uma de cada). Espelha o aviso do motor canônico
    // (orderConsumption.ts) — caso PV-00147/DS22, cor CAPUCCINO não mapeada.
    const unmappedColorWarning = (hasOrderColor
      && !!sheet?.component_colors_enabled
      && !usedPerColorComponents
      && Array.isArray(sheet?.direct_components)
      && sheet.direct_components.length > 0)
      ? `Cor "${orderColor}" sem mapeamento em Componentes por Cor — separação pode incluir variantes de cor que não vão neste par.`
      : undefined;
    const directProductIds = new Set<string>();
    for (const dc of directComponents) {
      const pid = (dc as any)?.product_id;
      const qtyPerPair = Number((dc as any)?.quantity) || 0;
      if (!pid || qtyPerPair <= 0) continue;
      // Produto já coberto pelo item-padrão do solado → dedup (F2-01).
      if (stdCoveredProductIds.has(pid)) continue;
      const prod = (allProducts || []).find((p: any) => p.id === pid);
      if (!prod) continue;
      // Padrão GLOBAL por cor (component_color_defaults, mig 20260928121000):
      // só no fallback de direct_components (lista por-cor da ficha VENCE) e
      // com cor não-vazia, regra do grupo (exata > default) troca o SKU
      // mantendo a quantidade da ficha. Entradas que colapsam no mesmo SKU
      // somam via addConsumptionRow. Regra pra produto inativo não resolve
      // (allProducts só tem ativos) → mantém o original com aviso.
      let effectiveProd = prod as any;
      let ruleWarning: string | undefined;
      if (!usedPerColorComponents && hasOrderColor && (prod as any).group_id) {
        const rulePid = componentColorDefaultMap.get(`${(prod as any).group_id}::${normalizeColorKey(orderColor)}`)
          ?? componentColorDefaultMap.get(`${(prod as any).group_id}::*`);
        if (rulePid) {
          const ruleProd = (allProducts || []).find((p: any) => p.id === rulePid);
          if (ruleProd) {
            effectiveProd = ruleProd as any;
          } else {
            ruleWarning = 'Regra global de cor do grupo aponta produto inativo/apagado — usando o componente original da ficha. Corrija em Fichas Técnicas → Padrões por Cor.';
          }
        }
      }
      // Cobre o pid original E o resolvido (dedup dc↔BOM — espelha o motor
      // canônico e o v_covered do SQL).
      directProductIds.add(pid);
      directProductIds.add(effectiveProd.id);
      const dcGroupName = groupNameById(effectiveProd.group_id)
        || (dc as any)?.product_name || effectiveProd.name || 'Componente';
      addConsumptionRow(consumptionMap, {
        componentType: classifyBomMaterial(dcGroupName, effectiveProd.name || '', ''),
        groupName: dcGroupName,
        materialName: effectiveProd.name || (dc as any)?.product_name || 'Componente',
        productUnit: effectiveProd.unit || (dc as any)?.unit || 'un',
        color: effectiveProd.color || '—',
        totalQuantity: qtyPerPair * itemQuantity,
        warning: ruleWarning || unmappedColorWarning,
      });
    }

    // BOM materials
    const specGroupsWithConsumption = new Map<string, number>();
    if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
    if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
    if ((insoleVariantGroup || sheet?.insole_material) && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(insoleVariantGroup || sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
    if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

    // BOM efetivo (semântica get_effective_bom): compartilhadas (variant NULL)
    // + linhas da variante DESTE item (que sobrepõem a compartilhada de mesmo
    // product_id); linhas de OUTRA variante ficam fora.
    const sheetBomLines = (materials || []).filter((m) => m.sheet_id === order.reference_id);
    const bomVariantId = saleItem?.material_variant_id || null;
    const variantBomLines = bomVariantId
      ? sheetBomLines.filter((m: any) => m.material_variant_id === bomVariantId)
      : [];
    const variantBomProductIds = new Set(variantBomLines.map((m: any) => m.product_id));
    const itemMaterials = [
      ...sheetBomLines.filter((m: any) => !m.material_variant_id && !variantBomProductIds.has(m.product_id)),
      ...variantBomLines,
    ];

    // Embalagem: a ficha pode listar VÁRIAS caixas no BOM (colmeia + individual)
    // como ALTERNATIVAS. Quando o pedido define um packaging_mode, mostra só a
    // caixa do modo escolhido — senão a Lista de Separação somava/exibia os dois
    // modos no grupo "Embalagem". Pré-varre os tipos de caixa presentes nesta
    // ficha pra o filtro só agir quando há alternativa real (espelha o modal —
    // orderConsumption.ts / shouldShowCaixaForMode).
    const itemPackagingMode = order.sale_order_id
      ? (packagingModeBySaleOrder.get(order.sale_order_id) ?? null)
      : null;
    const presentCaixaTypes = new Set<CollectiveType>();
    if (itemPackagingMode) {
      for (const m of itemMaterials) {
        const p = m.products as any;
        if (!p) continue;
        const gName = (m.product_groups as any)?.name || p.category || p.name || '';
        if (classifyBomMaterial(gName, p.name || '', p.category || '') !== 'Embalagem') continue;
        const t = caixaCollectiveTypeFromName(p.name);
        if (t) presentCaixaTypes.add(t);
      }
    }

    for (const material of itemMaterials) {
      const product = material.products as any;
      const group = material.product_groups as any;
      if (!product) continue;

      // Skip se já entrou via componentes diretos/por cor (BOM-6) — direct tem
      // prioridade; BOM é fallback pra materiais não declarados direto (mesma
      // regra do motor canônico).
      if (directProductIds.has(material.product_id)) continue;
      // Skip se o produto veio do ITEM-PADRÃO do solado (F2-01) — mesmo dedup
      // do SQL (v_covered_product_ids): o BOM homônimo NÃO soma por cima.
      if (stdCoveredProductIds.has(material.product_id)) continue;

      const groupName = group?.name || product.category || product.name || 'Outros';
      const groupKey = groupName.toLowerCase();
      const specHasGroup = specGroupsWithConsumption.has(groupKey);
      const bomType = classifyBomMaterial(groupName, product.name || '', product.category || '');

      // Embalagem com modo definido: pula a caixa que NÃO é a do packaging_mode
      // do pedido (só quando há alternativas reais na ficha — ver pré-varredura).
      if (bomType === 'Embalagem'
        && !shouldShowCaixaForMode(product.name, itemPackagingMode, presentCaixaTypes)) continue;

      if (specHasGroup) {
        const isUpperGroup = upperMatch?.group?.toLowerCase() === groupKey;
        const isLiningGroup = liningMatch?.group?.toLowerCase() === groupKey;
        const isInsoleGroup = (insoleVariantGroup || sheet?.insole_material || '').toLowerCase() === groupKey;
        const isSoleGroup = sheet?.sole_material?.toLowerCase() === groupKey;
        const shouldSkip = (isUpperGroup && bomType === 'Cabedal') ||
                           (isLiningGroup && bomType === 'Forração') ||
                           (isInsoleGroup && (bomType === 'Palmilha' || product.category?.toLowerCase().includes('palmilha'))) ||
                           (isSoleGroup && bomType === 'Solado');
        if (shouldSkip) continue;
      }

      let productUnit = product.unit || 'un';
      const unitLc = (productUnit || '').toString().toLowerCase().trim();
      // Set canônico (materialConsumption) — a lista inline omitia 'm linear'
      // e o item nessa unidade não convertia dm²→m no caminho BOM (UNIT-1).
      const isLinearUnit = LINEAR_UNITS.has(unitLc);
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
        componentType: bomType,
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
 * Resolução do solado = CASCATA CANÔNICA (F2-06, mesma do débito/motor
 * canônico): pin da variante do item do PV (resolve_sole_for_variant) → P0
 * coligação de cor → P1 mapping explícito (technical_sheet_sole_colors) → P2
 * mapping legado por grupo (maior estoque) → P3 primary_sole_id. Fallback pro
 * texto livre da ficha (sole_material/sole_color) SÓ quando a cascata devolve
 * null. Antes só o P1 + texto eram considerados: pedidos resolvidos por
 * coligação/primary imprimiam grupo/cor '—' enquanto o débito baixava a cor
 * conjugada (PV-00145/146 → SOLADO 01 CARAMELO).
 */
export async function calculateSoleBreakdownByGrade(orderIds: string[]): Promise<SoleBreakdownResult> {
  if (orderIds.length === 0) return { rows: [], allSizes: [], grandTotal: 0 };

  const { data: ordersData, error: ordersError } = await supabase
    .from('orders')
    .select('id, reference_id, color, quantity, grade, sale_order_item_id')
    .in('id', orderIds);

  if (ordersError) throw ordersError;
  if (!ordersData || ordersData.length === 0) return { rows: [], allSizes: [], grandTotal: 0 };

  const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];
  const saleOrderItemIds = [...new Set(ordersData.map(o => (o as any).sale_order_item_id).filter(Boolean))] as string[];

  const [
    { data: sheets },
    { data: soleMappings },
    { data: allProducts },
    { data: productGroups },
    { data: saleOrderItems },
  ] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, sole_material, sole_color, sole_group_id, primary_sole_id')
      .in('id', refIds),
    (supabase as any)
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id, sole_group_id')
      .in('sheet_id', refIds),
    // `quantity` entra pra cascata (P0/P2 escolhem por maior estoque).
    supabase.from('products').select('id, name, color, group_id, quantity').eq('active', true),
    supabase.from('product_groups').select('id, name'),
    saleOrderItemIds.length > 0
      ? supabase.from('sale_order_items').select('id, material_variant_id').in('id', saleOrderItemIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const sheetMap = new Map<string, any>((sheets || []).map((s: any) => [s.id, s]));
  const groupNameById = new Map<string, string>((productGroups || []).map((g: any) => [g.id, g.name]));
  const productById = new Map<string, any>(((allProducts || []) as any[]).map((p: any) => [p.id, p]));

  // Mapas da cascata canônica — idênticos aos do motor canônico
  // (fetchConsumptionContext / calculateBomForOrders).
  const soleColorMap = new Map<string, string>();
  const soleColorGroupMap = new Map<string, string>();
  for (const m of (soleMappings || []) as any[]) {
    if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.product_color)}`, m.sole_product_id);
    else if (m.sole_group_id) soleColorGroupMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_group_id);
  }
  const sheetSoleGroupMap = new Map<string, string>();
  const sheetPrimarySoleMap = new Map<string, string>();
  for (const s of (sheets || []) as any[]) {
    if (s.id && s.sole_group_id) sheetSoleGroupMap.set(s.id, s.sole_group_id);
    if (s.id && s.primary_sole_id) sheetPrimarySoleMap.set(s.id, s.primary_sole_id);
  }
  const soleConjugationsByGroup = new Map<
    string,
    Array<{ cabedal_color: string; palmilha_color: string; is_default: boolean }>
  >();
  {
    const soleGroupIds = Array.from(new Set(sheetSoleGroupMap.values()));
    if (soleGroupIds.length > 0) {
      const { data: conjugations } = await (supabase as any)
        .from('sole_color_conjugations')
        .select('sole_group_id, cabedal_color, palmilha_color, is_default, active')
        .in('sole_group_id', soleGroupIds)
        .eq('active', true);
      for (const c of (conjugations || []) as any[]) {
        const arr = soleConjugationsByGroup.get(c.sole_group_id) || [];
        arr.push({ cabedal_color: c.cabedal_color, palmilha_color: c.palmilha_color, is_default: !!c.is_default });
        soleConjugationsByGroup.set(c.sole_group_id, arr);
      }
    }
  }
  // Pin de solado da variante do item do PV — o débito o honra
  // (resolve_sole_for_variant, mig 20260911140000).
  const variantSoleByItem = new Map<string, string>();
  {
    const variantIds = [...new Set((saleOrderItems || []).map((si: any) => si.material_variant_id).filter(Boolean))];
    const variantSoleById = new Map<string, string>();
    if (variantIds.length > 0) {
      const { data: variantRows } = await (supabase as any)
        .from('reference_material_variants')
        .select('id, sole_material_product_id')
        .in('id', variantIds);
      for (const v of (variantRows || []) as any[]) {
        if (v.sole_material_product_id) variantSoleById.set(v.id, v.sole_material_product_id);
      }
    }
    for (const si of (saleOrderItems || []) as any[]) {
      const pid = si.material_variant_id ? variantSoleById.get(si.material_variant_id) : undefined;
      if (pid) variantSoleByItem.set(si.id, pid);
    }
  }

  const breakdown = new Map<string, SoleBreakdownRow>();
  const sizeSet = new Set<string>();

  for (const order of ordersData) {
    const sheet = sheetMap.get(order.reference_id);
    if (!sheet) continue;
    const variantPid = (order as any).sale_order_item_id
      ? variantSoleByItem.get((order as any).sale_order_item_id)
      : undefined;
    const resolvedPid = (variantPid && productById.has(variantPid) ? variantPid : null)
      || resolveSoleProductIdCanonical(order.reference_id, order.color || '', {
        sheetSoleGroupMap,
        soleConjugationsByGroup,
        soleColorMap,
        soleColorGroupMap,
        sheetPrimarySoleMap,
        allProducts: allProducts || [],
      });
    const resolvedProd = resolvedPid ? productById.get(resolvedPid) : null;
    // Grupo do produto RESOLVIDO (mesmo rótulo das linhas mapeadas de antes);
    // fallback texto da ficha só quando a cascata devolve null.
    const soleGroup = resolvedProd
      ? (((resolvedProd.group_id && groupNameById.get(resolvedProd.group_id)) || resolvedProd.name || '—').trim() || '—')
      : (((sheet.sole_material || '').toString().trim() || '—').trim() || '—');
    const soleColor = resolvedProd
      ? (((resolvedProd.color || '').toString().trim() || '—').trim() || '—')
      : (((sheet.sole_color || '').toString().trim() || '—').trim() || '—');

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
      // `fichas` de propósito FORA do select: não entra mais no cálculo (grade
      // real da OP + fallback exato — ver comentário no loop abaixo).
      ? supabase.from('sale_order_items').select('id, strap_colors').in('id', saleOrderItemIds)
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

  // Receitas artesanais (tela "Receitas → Produtos artesanais") — FONTE da verdade
  // de "tira artesanal": o grupo de RESULTADO (`artisanal_product_name`) de uma
  // receita ativa é uma tira cortada do rolo, independentemente do nome. A largura
  // de corte cadastrada na própria receita (`cut_width_mm`, mm) tem prioridade
  // sobre a largura do grupo/produto. Query DEFENSIVA em `cut_width_mm`: se a coluna
  // ainda não foi migrada, refaz sem ela (não quebra o painel).
  const recipeOutputNorms = new Set<string>();
  const recipeWidth = new Map<string, number>();
  // norm do resultado (artisanal_product_name) → material-base do rolo (base_product_name).
  // Usado pelo otimizador (planRollsFromStrapRows) pra agrupar tiras por base+cor.
  const recipeBaseByNorm = new Map<string, string>();
  {
    let rows: any[] | null = null;
    const withWidth = await supabase
      .from('artisanal_recipes')
      .select('artisanal_product_name, cut_width_mm, base_product_name' as any)
      .eq('active', true);
    if (!withWidth.error) {
      rows = withWidth.data as any[];
    } else {
      const fallback = await supabase
        .from('artisanal_recipes')
        .select('artisanal_product_name, base_product_name')
        .eq('active', true);
      if (!fallback.error) rows = fallback.data as any[];
    }
    for (const r of rows || []) {
      const norm = normalizeText(r.artisanal_product_name);
      if (!norm) continue;
      recipeOutputNorms.add(norm);
      const w = Number(r.cut_width_mm) || 0;
      if (w > (recipeWidth.get(norm) || 0)) recipeWidth.set(norm, w);
      const base = (r.base_product_name || '').toString().trim();
      if (base && !recipeBaseByNorm.has(norm)) recipeBaseByNorm.set(norm, base);
    }
  }
  const widthForNorm = (norm: string): number =>
    (recipeWidth.get(norm) || ownWidth.get(norm) || prodWidth.get(norm) || 0);

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

  // Entradas brutas (uma por tira/OP detectada artesanal). A AGREGAÇÃO por
  // (group_id+cor) e a SOMA dos metros antes do corte ficam no helper canônico
  // (aggregateArtisanalStrapCut) — mesma lógica nos 3 painéis do PV. Agrupar por
  // group_id (não pelo nome) colapsa variantes "TIRA 1".."TIRA N" da mesma família.
  const strapInputs: ArtisanalStrapAggInput[] = [];

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
        recipeFlag: recipeOutputNorms.has(norm),
        groupFlag: groupArtisanalFlag.get(norm),
        name: `${groupName} ${strap.label || ''}`,
      });
      if (!artisanal) continue;

      // NÃO passar `fichas` do sale_order_item: `orders.grade` aqui é a grade
      // REAL da OP (Σ = quantity), enquanto `fichas` do item se refere à grade
      // BASE do PV. Como fichas > 0 tem prioridade no motor, o total virava
      // Σ(pares_da_grade_REAL × cm/par) × fichas — supercontagem de 30–92×
      // (ex.: OP-2026-00729, 60×; auditoria 2026-07-01). O fallback do motor
      // (quantity ÷ gradeTotal) é escala-invariante: correto tanto pra grade
      // base quanto pra real.
      const cm = calculateStrapConsumptionCm(strap, {
        grade,
        quantity: itemQuantity,
      });
      const metros = cm / 100;
      if (metros <= 0) continue;

      const color = (strap.color || order.color || '—').toString().trim() || '—';
      strapInputs.push({
        groupKey: ((strap as any).group_id || '').toString().trim() || norm,
        groupName: groupNameByNorm.get(norm) || groupName,
        color,
        metros,
        largura_mm: widthForNorm(norm),
        baseName: recipeBaseByNorm.get(norm),
      });
    }
  }

  return aggregateArtisanalStrapCut(strapInputs);
}
