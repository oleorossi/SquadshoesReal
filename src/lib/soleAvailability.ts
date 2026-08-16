import { supabase } from '@/integrations/supabase/client';
import { PALMILHA_DEFAULT_KEY } from '@/hooks/usePalmilhaColorMappings';
import { normalizeColorKey } from '@/lib/materialConsumption';
import { calculateGradeCoverage, rateGradeToTotal } from '@/lib/gradeDistribution';

export interface SoleShortage {
  sole_product_id: string;
  sole_name: string;
  sole_color: string | null;
  sole_sku: string | null;
  required: number;
  /** Pares da grade demandada cobertos pelo estoque atual. */
  available: number;
  /** Pares da grade demandada já cobertos por OCs abertas. */
  incoming: number;
  shortage: number;
  unit_price: number;
  supplier_id: string | null;
  supplier_name: string;
  lead_time_days: number;
  moq: number;
  /** Quantity that should be ordered (max of shortage and MOQ). */
  suggested_purchase_qty: number;
  /** References on the order that consume this sole. */
  reference_labels: string[];
  /** Falta líquida por numeração, já descontando estoque e OCs em trânsito. */
  size_breakdown: Record<string, number>;
  /** Distinct sale-order numbers that consume this sole. */
  order_numbers: string[];
}

export interface InsoleShortage {
  insole_product_id: string;
  insole_name: string;
  insole_color: string | null;
  insole_sku: string | null;
  required: number;
  available: number;
  incoming: number;
  shortage: number;
  unit_price: number;
  supplier_id: string | null;
  supplier_name: string;
  lead_time_days: number;
  moq: number;
  suggested_purchase_qty: number;
  size_breakdown: Record<string, number>;
  order_numbers: string[];
  /** Which cabedal colors map to this insole color. */
  cabedal_colors: string[];
}

export interface SoleAvailabilityResult {
  shortages: SoleShortage[];
  insoleShortages: InsoleShortage[];
  /**
   * Minimum billing date considering: today + lead_time_solado + assembly + finishing + buffer.
   * Returns null if no shortages.
   */
  minBillingDateISO: string | null;
  totalLeadTimeDays: number;
  /** Days from assembly + finishing used in the billing-date math. */
  postSoleProductionDays: number;
}

interface ItemInput {
  reference_id: string;
  /** Variante do item do PV; pode pinar um solado diferente do padrão da ficha. */
  material_variant_id?: string | null;
  color: string | null;
  totalPairs: number;
  referenceLabel: string;
  /** Pairs per size (e.g. {"36": 6, "37": 12}). Optional but enables per-size totals. */
  grade?: Record<string, number> | null;
  /** Sale-order number that requested this item (e.g. "PV-2026-001"). */
  orderNumber?: string | null;
}

interface TechnicalSheetAvailabilityRow {
  primary_sole_id: string | null;
  sole_group_id: string | null;
  insole_material: string | null;
  insole_has_lining: boolean | null;
  lead_time_montagem_dias: number | null;
  lead_time_acabamento_dias: number | null;
  lead_time_buffer_material_dias: number | null;
}

interface SoleProductAvailabilityRow {
  id: string;
  name: string;
  sku: string | null;
  color: string | null;
  group_id: string | null;
  quantity: number | null;
  reserved_stock: number | null;
  stock_grade: Record<string, unknown> | null;
  unit_price: number | null;
  supplier_id: string | null;
  supplier_lead_time_days: number | null;
  lead_time_days: number | null;
  sole_moq: number | null;
}

interface SupplierAvailabilityRow {
  id: string;
  name: string;
  lead_time_days: number | null;
}

interface PurchaseOrderItemAvailabilityRow {
  product_id: string | null;
  quantity: number;
  received_quantity: number | null;
  grade: Record<string, number> | null;
}

/**
 * Resolve the actual sole product variant for each line item, consult current
 * stock and return shortages plus a minimum billing date.
 * Also computes insole (palmilha) requirements per color when `insole_has_lining = false`.
 */
export async function checkSoleAvailability(items: ItemInput[]): Promise<SoleAvailabilityResult> {
  const validItems = items.filter(i => i.reference_id && i.totalPairs > 0);
  if (validItems.length === 0) {
    return { shortages: [], insoleShortages: [], minBillingDateISO: null, totalLeadTimeDays: 0, postSoleProductionDays: 0 };
  }

  const sheetIds = [...new Set(validItems.map(i => i.reference_id))];
  const materialVariantIds = [
    ...new Set(validItems.map(i => i.material_variant_id).filter(Boolean)),
  ] as string[];

  // Mesma precedência do débito e dos motores de consumo: solado pinado na
  // variante do item do PV vence a cascata de cor/ficha.
  const variantSoleById = new Map<string, string>();
  await Promise.all(materialVariantIds.map(async (variantId) => {
    const { data, error } = await supabase.rpc('resolve_sole_for_variant', {
      p_variant_id: variantId,
    });
    if (error) throw error;
    const resolved = Array.isArray(data) ? data[0] : data;
    if (resolved?.product_id) variantSoleById.set(variantId, resolved.product_id);
  }));

  const [sheetsResult, soleMappingsResult, palmilhaMappingsResult] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, primary_sole_id, sole_group_id, insole_material, insole_has_lining, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias')
      .in('id', sheetIds),
    supabase
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id, sole_group_id')
      .in('sheet_id', sheetIds),
    (supabase as any)
      .from('technical_sheet_palmilha_colors')
      .select('sheet_id, cabedal_color, palmilha_color')
      .in('sheet_id', sheetIds),
  ]);
  if (sheetsResult.error) throw sheetsResult.error;
  if (soleMappingsResult.error) throw soleMappingsResult.error;
  if (palmilhaMappingsResult.error) throw palmilhaMappingsResult.error;
  const sheets = sheetsResult.data;
  const soleMappings = soleMappingsResult.data;
  const palmilhaMappings = palmilhaMappingsResult.data;

  // ── Conjugações: pra cada solado, group_id → mapa size→size_key.
  // Necessário pra agregar `size_breakdown` na chave conjugada antes de
  // sugerir compra (senão o relatório mostra "33: 5 / 34: 5" enquanto
  // o estoque é uma chave única "33/34: 10").
  const conjugationByGroupId = new Map<string, Map<number, string>>();

  const sheetMap = new Map((sheets || []).map((s: any) => [s.id, s]));

  // sole color mapping: "sheetId::cabedelColor" → { productId, groupId }
  // (mantém o group_id pro fallback P2 quando o mapping não fixa produto)
  const soleColorMap = new Map<string, { productId: string | null; groupId: string | null }>();
  for (const m of soleMappings || []) {
    const key = `${(m as any).sheet_id}::${normalizeColorKey((m as any).product_color)}`;
    soleColorMap.set(key, {
      productId: (m as any).sole_product_id || null,
      groupId: (m as any).sole_group_id || null,
    });
  }

  // ── Achado B (auditoria 2026-07-01): a resolução do solado aqui espelhava só
  // parte da cascata do motor canônico (`resolve_sole_color`), pulando a
  // PRIORIDADE 0 — regra ativa em `sole_color_conjugations` (cabedal → cor do
  // solado por grupo). Resultado: a checagem/sugestão de compra apontava um
  // PRODUTO diferente do que o débito realmente consome. Cascata espelhada:
  //   P0: sole_group_id da ficha + conjugação ativa (match exato de cor
  //       accent-insensitive, senão a regra default) → produto do grupo na cor
  //       alvo, maior estoque primeiro;
  //   P1: mapping explícito (technical_sheet_sole_colors.sole_product_id);
  //   P2: mapping antigo só com group_id → produto do grupo com maior estoque;
  //   P3: primary_sole_id da ficha.
  const candidateGroupIds = [
    ...new Set([
      ...(sheets || []).map((s: any) => s.sole_group_id).filter(Boolean),
      ...(soleMappings || [])
        .filter((m: any) => !m.sole_product_id && m.sole_group_id)
        .map((m: any) => m.sole_group_id),
    ]),
  ] as string[];

  // Regras de conjugação de COR por grupo: { exatas: corCabedal→corSolado, default }
  const colorConjByGroup = new Map<string, { exact: Map<string, string>; def: string | null }>();
  // Produtos ativos dos grupos candidatos, ordenados por estoque desc (igual ao
  // ORDER BY p.quantity DESC do resolve_sole_color).
  const groupProducts = new Map<string, Array<{ id: string; color: string | null; quantity: number }>>();

  if (candidateGroupIds.length > 0) {
    const [colorConjsResult, groupProductsResult] = await Promise.all([
      (supabase as any)
        .from('sole_color_conjugations')
        .select('sole_group_id, cabedal_color, palmilha_color, is_default')
        .eq('active', true)
        .in('sole_group_id', candidateGroupIds),
      supabase
        .from('products')
        .select('id, color, group_id, quantity')
        .eq('active', true)
        .in('group_id', candidateGroupIds),
    ]);
    if (colorConjsResult.error) throw colorConjsResult.error;
    if (groupProductsResult.error) throw groupProductsResult.error;
    const colorConjs = colorConjsResult.data;
    const gProducts = groupProductsResult.data;
    for (const c of (colorConjs || []) as Array<{ sole_group_id: string; cabedal_color: string | null; palmilha_color: string; is_default: boolean | null }>) {
      let entry = colorConjByGroup.get(c.sole_group_id);
      if (!entry) { entry = { exact: new Map(), def: null }; colorConjByGroup.set(c.sole_group_id, entry); }
      if (c.is_default && entry.def == null) entry.def = c.palmilha_color;
      const cabKey = normalizeColorKey(c.cabedal_color);
      if (cabKey && !entry.exact.has(cabKey)) entry.exact.set(cabKey, c.palmilha_color);
    }
    for (const p of (gProducts || []) as any[]) {
      const arr = groupProducts.get(p.group_id) || [];
      arr.push({ id: p.id, color: p.color, quantity: Number(p.quantity) || 0 });
      groupProducts.set(p.group_id, arr);
    }
    for (const arr of groupProducts.values()) arr.sort((a, b) => b.quantity - a.quantity);
  }

  /** Cascata de resolução do solado (espelha resolve_sole_color do banco). */
  const resolveSoleProductId = (
    sheet: TechnicalSheetAvailabilityRow,
    refId: string,
    cabedalColor: string | null,
    materialVariantId?: string | null,
  ): string | null => {
    if (materialVariantId && variantSoleById.has(materialVariantId)) {
      return variantSoleById.get(materialVariantId)!;
    }
    const colorKey = normalizeColorKey(cabedalColor);

    // P0: conjugação ativa do grupo da ficha (cor exata → default)
    if (sheet?.sole_group_id && colorKey) {
      const conj = colorConjByGroup.get(sheet.sole_group_id);
      const targetColor = conj?.exact.get(colorKey) ?? conj?.def ?? null;
      if (targetColor) {
        const targetKey = normalizeColorKey(targetColor);
        const hit = (groupProducts.get(sheet.sole_group_id) || [])
          .find(p => normalizeColorKey(p.color) === targetKey);
        if (hit) return hit.id;
      }
    }

    // P1: mapping explícito com sole_product_id
    const mapping = soleColorMap.get(`${refId}::${colorKey}`);
    if (mapping?.productId) return mapping.productId;

    // P2: mapping antigo só com group_id → maior estoque do grupo
    if (mapping?.groupId) {
      const first = (groupProducts.get(mapping.groupId) || [])[0];
      if (first) return first.id;
    }

    // P3: primary_sole_id da ficha
    return sheet?.primary_sole_id || null;
  };

  // palmilha mapping: sheetId → Map<cabedal_color_lower, palmilha_color>
  const palmilhaMap = new Map<string, Map<string, string>>();
  for (const m of palmilhaMappings || []) {
    if (!palmilhaMap.has(m.sheet_id)) palmilhaMap.set(m.sheet_id, new Map());
    palmilhaMap.get(m.sheet_id)!.set((m.cabedal_color || '').toLowerCase().trim(), m.palmilha_color);
  }

  // Group required pairs per sole_product_id (PASS 1: collect raw integer sizes)
  const requiredSoles = new Map<
    string,
    { qty: number; references: Set<string>; sizeBreakdown: Record<string, number>; orderNumbers: Set<string> }
  >();

  // Group required pairs per insole: "insoleGroupName::palmilhaColor" → {...}
  const requiredInsoles = new Map<
    string,
    { qty: number; groupName: string; palmilhaColor: string; resolvedProductId: string | null; sizeBreakdown: Record<string, number>; orderNumbers: Set<string>; cabelColors: Set<string> }
  >();

  const insoleVariantResolutionCache = new Map<string, Promise<string | null>>();
  const resolveVariantInsole = (
    variantId: string,
    groupName: string,
    color: string,
    required: number,
  ) => {
    const key = `${variantId}::${groupName}::${normalizeColorKey(color)}::${required}`;
    let pending = insoleVariantResolutionCache.get(key);
    if (!pending) {
      pending = (async () => {
        const { data, error } = await supabase.rpc('resolve_insole_material_for_variant', {
          p_variant_id: variantId,
          p_group_name: groupName,
          p_color: color,
          p_required: required,
        });
        if (error) throw error;
        const resolved = Array.isArray(data) ? data[0] : data;
        return resolved?.product_id || null;
      })();
      insoleVariantResolutionCache.set(key, pending);
    }
    return pending;
  };

  for (const item of validItems) {
    const sheet = sheetMap.get(item.reference_id) as any;
    if (!sheet) continue;

    // ── Sole ── (cascata canônica P0→P3; ver resolveSoleProductId acima)
    const soleId = resolveSoleProductId(
      sheet,
      item.reference_id,
      item.color,
      item.material_variant_id,
    );
    if (soleId) {
      const existing = requiredSoles.get(soleId) || { qty: 0, references: new Set<string>(), sizeBreakdown: {} as Record<string, number>, orderNumbers: new Set<string>() };
      existing.qty += item.totalPairs;
      existing.references.add(item.referenceLabel);
      if (item.orderNumber) existing.orderNumbers.add(item.orderNumber);
      if (item.grade) {
        for (const [size, pairs] of Object.entries(item.grade)) {
          const n = Number(pairs) || 0;
          if (n > 0) existing.sizeBreakdown[size] = (existing.sizeBreakdown[size] || 0) + n;
        }
      }
      requiredSoles.set(soleId, existing);
    }

    // ── Insole (palmilha) ──
    const insoleGroupName = (sheet.insole_material || '').trim();
    if (!insoleGroupName) continue;

    const hasLining = sheet.insole_has_lining !== false; // default true
    let palmilhaColor: string;
    if (hasLining) {
      palmilhaColor = item.color || '';
    } else {
      const sheetPalmilhaMap = palmilhaMap.get(item.reference_id);
      const colorKey = (item.color || '').toLowerCase().trim();
      const mappedColor = sheetPalmilhaMap?.get(colorKey) || sheetPalmilhaMap?.get(PALMILHA_DEFAULT_KEY);
      if (!mappedColor && import.meta.env.DEV) {
        console.warn(`[soleAvailability] Palmilha sem mapeamento de cor: ref=${item.reference_id}, cor cabedal="${item.color}" — usando cor do cabedal como fallback`);
      }
      palmilhaColor = mappedColor || item.color || '';
    }

    const resolvedInsoleProductId = item.material_variant_id
      ? await resolveVariantInsole(
          item.material_variant_id,
          insoleGroupName,
          palmilhaColor,
          item.totalPairs,
        )
      : null;
    const insoleKey = resolvedInsoleProductId
      ? `product::${resolvedInsoleProductId}`
      : `${insoleGroupName}::${palmilhaColor.toLowerCase().trim()}`;
    const existingInsole = requiredInsoles.get(insoleKey) || {
      qty: 0, groupName: insoleGroupName, palmilhaColor, resolvedProductId: resolvedInsoleProductId,
      sizeBreakdown: {} as Record<string, number>,
      orderNumbers: new Set<string>(), cabelColors: new Set<string>(),
    };
    existingInsole.qty += item.totalPairs;
    if (item.orderNumber) existingInsole.orderNumbers.add(item.orderNumber);
    if (item.color) existingInsole.cabelColors.add(item.color);
    if (item.grade) {
      for (const [size, pairs] of Object.entries(item.grade)) {
        const n = Number(pairs) || 0;
        if (n > 0) existingInsole.sizeBreakdown[size] = (existingInsole.sizeBreakdown[size] || 0) + n;
      }
    }
    requiredInsoles.set(insoleKey, existingInsole);
  }

  // ── Fetch sole products + suppliers ──
  const soleIds = [...requiredSoles.keys()];
  let soleProducts: SoleProductAvailabilityRow[] = [];
  if (soleIds.length > 0) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, color, group_id, quantity, reserved_stock, stock_grade, unit_price, supplier_id, supplier_lead_time_days, lead_time_days, sole_moq')
      .in('id', soleIds);
    if (error) throw error;
    soleProducts = (data || []).map(product => ({
      ...product,
      stock_grade: product.stock_grade as Record<string, unknown> | null,
    }));
  }

  // ── Fetch sole conjugations for the groups that appear ──────
  // Para cada solado com group_id, busca as regras de conjugação e remapeia
  // o sizeBreakdown coletado em PASS 1 (chaves "33","34") para chaves
  // conjugadas ("33/34"), espelhando o que `debit_sole_stock_by_grade` faz
  // no banco. Sem isso, o relatório de compras divergiria do estoque real.
  const soleGroupIds = [
    ...new Set(soleProducts.map(product => product.group_id).filter(Boolean)),
  ] as string[];
  if (soleGroupIds.length > 0) {
    const { data: conjs, error } = await supabase
      .from('sole_size_conjugations')
      .select('sole_group_id, size_key, sizes')
      .in('sole_group_id', soleGroupIds);
    if (error) throw error;
    for (const c of (conjs || []) as Array<{ sole_group_id: string; size_key: string; sizes: number[] }>) {
      let m = conjugationByGroupId.get(c.sole_group_id);
      if (!m) { m = new Map(); conjugationByGroupId.set(c.sole_group_id, m); }
      for (const s of c.sizes) m.set(s, c.size_key);
    }
    // Remapear sizeBreakdown nos shortages
    for (const product of soleProducts || []) {
      const groupId = (product as any).group_id;
      if (!groupId) continue;
      const conjMap = conjugationByGroupId.get(groupId);
      if (!conjMap || conjMap.size === 0) continue;
      const need = requiredSoles.get((product as any).id);
      if (!need) continue;
      const remapped: Record<string, number> = {};
      for (const [sizeStr, qty] of Object.entries(need.sizeBreakdown)) {
        const sizeNum = Number(sizeStr);
        const key = (Number.isFinite(sizeNum) && conjMap.get(sizeNum)) || sizeStr;
        remapped[key] = (remapped[key] || 0) + qty;
      }
      need.sizeBreakdown = remapped;
    }
  }

  // ── Fetch insole products by group name + color ──
  const insoleGroupNames = [...new Set([...requiredInsoles.values()].map(r => r.groupName))];
  const resolvedInsoleProductIds = [
    ...new Set([...requiredInsoles.values()].map(r => r.resolvedProductId).filter(Boolean)),
  ] as string[];
  let insoleProducts: any[] = [];
  if (insoleGroupNames.length > 0) {
    const { data: ig, error: groupError } = await supabase.from('product_groups').select('id, name').in('name', insoleGroupNames);
    if (groupError) throw groupError;
    if (ig && ig.length > 0) {
      const igIds = ig.map((g: any) => g.id);
      const { data: ip, error: productsError } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days')
        .in('group_id', igIds)
        .eq('active', true);
      if (productsError) throw productsError;
      const groupNameById = new Map(ig.map((g: any) => [g.id, g.name]));
      insoleProducts = (ip || []).map((p: any) => ({ ...p, groupName: groupNameById.get(p.group_id) }));
    }
  }
  if (resolvedInsoleProductIds.length > 0) {
    const missingIds = resolvedInsoleProductIds.filter(
      id => !insoleProducts.some(product => product.id === id),
    );
    if (missingIds.length > 0) {
      const { data: pinnedProducts, error } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days')
        .in('id', missingIds)
        .eq('active', true);
      if (error) throw error;
      insoleProducts.push(...(pinnedProducts || []));
    }
  }

  const allSupplierIds = [
    ...new Set([
      ...(soleProducts || []).map((p: any) => p.supplier_id),
      ...insoleProducts.map((p: any) => p.supplier_id),
    ].filter(Boolean)),
  ];
  let suppliers: SupplierAvailabilityRow[] = [];
  if (allSupplierIds.length > 0) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, lead_time_days')
      .in('id', allSupplierIds);
    if (error) throw error;
    suppliers = data || [];
  }
  const supplierMap = new Map(suppliers.map(supplier => [supplier.id, supplier]));

  // OCs abertas contam como estoque em trânsito. Para demanda gradeada, só uma
  // OC que também tenha grade pode cobrir uma numeração específica; OC legada
  // sem grade não mascara uma falta do nº 36 com um total genérico.
  const incomingTotalByProduct = new Map<string, number>();
  const incomingGradeByProduct = new Map<string, Record<string, number>>();
  const purchaseTrackedIds = [
    ...new Set([...soleIds, ...insoleProducts.map(product => product.id).filter(Boolean)]),
  ];
  if (purchaseTrackedIds.length > 0) {
    const { data: openItems, error: openItemsError } = await supabase
      .from('purchase_order_items')
      .select('product_id, quantity, received_quantity, grade, purchase_orders!inner(status)')
      .in('product_id', purchaseTrackedIds)
      .in('purchase_orders.status', ['pending', 'approved', 'sent', 'parcial']);
    if (openItemsError) throw openItemsError;

    for (const row of (openItems || []) as unknown as PurchaseOrderItemAvailabilityRow[]) {
      const remaining = Math.max(0, Number(row.quantity) - Number(row.received_quantity || 0));
      if (!row.product_id || remaining <= 0) continue;
      incomingTotalByProduct.set(
        row.product_id,
        (incomingTotalByProduct.get(row.product_id) || 0) + remaining,
      );
      const remainingGrade = rateGradeToTotal(row.grade as Record<string, number> | null, remaining);
      if (!remainingGrade) continue;
      const aggregate = incomingGradeByProduct.get(row.product_id) || {};
      for (const [size, qty] of Object.entries(remainingGrade)) {
        aggregate[size] = (aggregate[size] || 0) + qty;
      }
      incomingGradeByProduct.set(row.product_id, aggregate);
    }
  }

  // ── Sole shortages ──
  const shortages: SoleShortage[] = [];
  let maxLeadTime = 0;
  let postSoleDays = 0;

  for (const product of soleProducts || []) {
    const need = requiredSoles.get(product.id);
    if (!need) continue;
    const hasGradeDemand = Object.values(need.sizeBreakdown).some((qty) => Number(qty) > 0);
    const scalarOnHand = Math.max(0, Number(product.quantity || 0) - Number(product.reserved_stock || 0));
    const scalarIncoming = incomingTotalByProduct.get(product.id) || 0;
    const coverage = hasGradeDemand
      ? calculateGradeCoverage(
          need.sizeBreakdown,
          product.stock_grade,
          incomingGradeByProduct.get(product.id),
        )
      : null;
    const coveredOnHand = coverage?.totalCoveredOnHand ?? Math.min(need.qty, scalarOnHand);
    const coveredIncoming = coverage?.totalCoveredIncoming
      ?? Math.min(Math.max(need.qty - coveredOnHand, 0), scalarIncoming);
    const shortageQty = coverage?.totalShortage
      ?? Math.max(need.qty - coveredOnHand - coveredIncoming, 0);
    if (shortageQty <= 0) continue;

    const supplier = (product as any).supplier_id ? supplierMap.get((product as any).supplier_id) : null;
    const leadTime = Number((supplier as any)?.lead_time_days || (product as any).supplier_lead_time_days || (product as any).lead_time_days || 10);
    const moq = Number((product as any).sole_moq || 0);
    shortages.push({
      sole_product_id: (product as any).id,
      sole_name: (product as any).name,
      sole_color: (product as any).color,
      sole_sku: (product as any).sku,
      required: need.qty,
      available: coveredOnHand,
      incoming: coveredIncoming,
      shortage: shortageQty,
      unit_price: Number((product as any).unit_price || 0),
      supplier_id: (product as any).supplier_id || null,
      supplier_name: (supplier as any)?.name || 'Fornecedor não definido',
      lead_time_days: leadTime,
      moq,
      suggested_purchase_qty: Math.max(shortageQty, moq),
      reference_labels: [...need.references],
      size_breakdown: coverage?.shortageBySize ?? need.sizeBreakdown,
      order_numbers: [...need.orderNumbers],
    });
    if (leadTime > maxLeadTime) maxLeadTime = leadTime;
    for (const item of validItems) {
      const sheet = sheetMap.get(item.reference_id) as any;
      if (!sheet) continue;
      const days = Number(sheet.lead_time_montagem_dias || 0) + Number(sheet.lead_time_acabamento_dias || 0) + Number(sheet.lead_time_buffer_material_dias || 0);
      if (days > postSoleDays) postSoleDays = days;
    }
  }

  // ── Insole shortages ──
  const insoleShortages: InsoleShortage[] = [];

  for (const [, need] of requiredInsoles) {
    if (need.qty <= 0) continue;
    // Find best-matching insole product: prefer exact color match, then any in group
    const colorLower = need.palmilhaColor.toLowerCase().trim();
    const product = need.resolvedProductId
      ? insoleProducts.find(p => p.id === need.resolvedProductId)
      : insoleProducts.find(p => p.groupName === need.groupName && (p.color || '').toLowerCase().trim() === colorLower)
        || insoleProducts.find(p => p.groupName === need.groupName);
    if (!product) continue;

    const onHand = Math.max(0, Number(product.quantity || 0) - Number(product.reserved_stock || 0));
    const coveredOnHand = Math.min(need.qty, onHand);
    const incoming = Math.min(
      Math.max(need.qty - coveredOnHand, 0),
      incomingTotalByProduct.get(product.id) || 0,
    );
    const shortageQty = Math.max(need.qty - coveredOnHand - incoming, 0);
    if (shortageQty <= 0) continue;

    const supplier = product.supplier_id ? supplierMap.get(product.supplier_id) : null;
    const leadTime = Number((supplier as any)?.lead_time_days || product.supplier_lead_time_days || product.lead_time_days || 10);
    const moq = 0;
    insoleShortages.push({
      insole_product_id: product.id,
      insole_name: product.name,
      insole_color: need.palmilhaColor || null,
      insole_sku: product.sku || null,
      required: need.qty,
      available: coveredOnHand,
      incoming,
      shortage: shortageQty,
      unit_price: Number(product.unit_price || 0),
      supplier_id: product.supplier_id || null,
      supplier_name: (supplier as any)?.name || 'Fornecedor não definido',
      lead_time_days: leadTime,
      moq,
      suggested_purchase_qty: Math.max(shortageQty, moq),
      size_breakdown: need.sizeBreakdown,
      order_numbers: [...need.orderNumbers],
      cabedal_colors: [...need.cabelColors],
    });
    if (leadTime > maxLeadTime) maxLeadTime = leadTime;
  }

  if (shortages.length === 0 && insoleShortages.length === 0) {
    return { shortages: [], insoleShortages: [], minBillingDateISO: null, totalLeadTimeDays: 0, postSoleProductionDays: 0 };
  }

  const totalDays = maxLeadTime + postSoleDays;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + totalDays);

  return {
    shortages,
    insoleShortages,
    minBillingDateISO: minDate.toISOString().slice(0, 10),
    totalLeadTimeDays: totalDays,
    postSoleProductionDays: postSoleDays,
  };
}
