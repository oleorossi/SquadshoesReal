import { supabase } from '@/integrations/supabase/client';
import { PALMILHA_DEFAULT_KEY } from '@/hooks/usePalmilhaColorMappings';

export interface SoleShortage {
  sole_product_id: string;
  sole_name: string;
  sole_color: string | null;
  sole_sku: string | null;
  required: number;
  available: number;
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
  /** Total required pairs broken down by size (e.g. {"36": 12, "37": 24}). */
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
  color: string | null;
  totalPairs: number;
  referenceLabel: string;
  /** Pairs per size (e.g. {"36": 6, "37": 12}). Optional but enables per-size totals. */
  grade?: Record<string, number> | null;
  /** Sale-order number that requested this item (e.g. "PV-2026-001"). */
  orderNumber?: string | null;
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

  const [{ data: sheets }, { data: soleMappings }, { data: palmilhaMappings }] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, primary_sole_id, insole_material, insole_has_lining, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias')
      .in('id', sheetIds),
    supabase
      .from('technical_sheet_sole_colors')
      .select('sheet_id, product_color, sole_product_id')
      .in('sheet_id', sheetIds),
    (supabase as any)
      .from('technical_sheet_palmilha_colors')
      .select('sheet_id, cabedal_color, palmilha_color')
      .in('sheet_id', sheetIds),
  ]);

  const sheetMap = new Map((sheets || []).map((s: any) => [s.id, s]));

  // sole color mapping: "sheetId::cabedelColor" → sole_product_id
  const soleColorMap = new Map<string, string>();
  for (const m of soleMappings || []) {
    const key = `${(m as any).sheet_id}::${((m as any).product_color || '').toLowerCase().trim()}`;
    soleColorMap.set(key, (m as any).sole_product_id);
  }

  // palmilha mapping: sheetId → Map<cabedal_color_lower, palmilha_color>
  const palmilhaMap = new Map<string, Map<string, string>>();
  for (const m of palmilhaMappings || []) {
    if (!palmilhaMap.has(m.sheet_id)) palmilhaMap.set(m.sheet_id, new Map());
    palmilhaMap.get(m.sheet_id)!.set((m.cabedal_color || '').toLowerCase().trim(), m.palmilha_color);
  }

  // Group required pairs per sole_product_id
  const requiredSoles = new Map<
    string,
    { qty: number; references: Set<string>; sizeBreakdown: Record<string, number>; orderNumbers: Set<string> }
  >();

  // Group required pairs per insole: "insoleGroupName::palmilhaColor" → {...}
  const requiredInsoles = new Map<
    string,
    { qty: number; groupName: string; palmilhaColor: string; sizeBreakdown: Record<string, number>; orderNumbers: Set<string>; cabelColors: Set<string> }
  >();

  for (const item of validItems) {
    const sheet = sheetMap.get(item.reference_id) as any;
    if (!sheet) continue;

    // ── Sole ──
    const soleKey = `${item.reference_id}::${(item.color || '').toLowerCase().trim()}`;
    const soleId = soleColorMap.get(soleKey) || sheet.primary_sole_id;
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

    const insoleKey = `${insoleGroupName}::${palmilhaColor.toLowerCase().trim()}`;
    const existingInsole = requiredInsoles.get(insoleKey) || {
      qty: 0, groupName: insoleGroupName, palmilhaColor, sizeBreakdown: {} as Record<string, number>,
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
  const { data: soleProducts } = soleIds.length > 0
    ? await supabase.from('products').select('id, name, sku, color, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days, sole_moq').in('id', soleIds)
    : { data: [] as any[] };

  // ── Fetch insole products by group name + color ──
  const insoleGroupNames = [...new Set([...requiredInsoles.values()].map(r => r.groupName))];
  let insoleProducts: any[] = [];
  if (insoleGroupNames.length > 0) {
    const { data: ig } = await supabase.from('product_groups').select('id, name').in('name', insoleGroupNames);
    if (ig && ig.length > 0) {
      const igIds = ig.map((g: any) => g.id);
      const { data: ip } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days')
        .in('group_id', igIds)
        .eq('active', true);
      const groupNameById = new Map(ig.map((g: any) => [g.id, g.name]));
      insoleProducts = (ip || []).map((p: any) => ({ ...p, groupName: groupNameById.get(p.group_id) }));
    }
  }

  const allSupplierIds = [
    ...new Set([
      ...(soleProducts || []).map((p: any) => p.supplier_id),
      ...insoleProducts.map((p: any) => p.supplier_id),
    ].filter(Boolean)),
  ];
  const { data: suppliers } = allSupplierIds.length > 0
    ? await supabase.from('suppliers').select('id, name, lead_time_days').in('id', allSupplierIds)
    : { data: [] as any[] };
  const supplierMap = new Map((suppliers || []).map((s: any) => [s.id, s]));

  // ── Sole shortages ──
  const shortages: SoleShortage[] = [];
  let maxLeadTime = 0;
  let postSoleDays = 0;

  for (const product of soleProducts || []) {
    const need = requiredSoles.get((product as any).id);
    if (!need) continue;
    const onHand = Math.max(0, Number((product as any).quantity || 0) - Number((product as any).reserved_stock || 0));
    if (onHand >= need.qty) continue;

    const supplier = (product as any).supplier_id ? supplierMap.get((product as any).supplier_id) : null;
    const leadTime = Number((supplier as any)?.lead_time_days || (product as any).supplier_lead_time_days || (product as any).lead_time_days || 10);
    const moq = Number((product as any).sole_moq || 0);
    const shortageQty = need.qty - onHand;
    shortages.push({
      sole_product_id: (product as any).id,
      sole_name: (product as any).name,
      sole_color: (product as any).color,
      sole_sku: (product as any).sku,
      required: need.qty,
      available: onHand,
      shortage: shortageQty,
      unit_price: Number((product as any).unit_price || 0),
      supplier_id: (product as any).supplier_id || null,
      supplier_name: (supplier as any)?.name || 'Fornecedor não definido',
      lead_time_days: leadTime,
      moq,
      suggested_purchase_qty: Math.max(shortageQty, moq),
      reference_labels: [...need.references],
      size_breakdown: need.sizeBreakdown,
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
    const product = insoleProducts.find(p => p.groupName === need.groupName && (p.color || '').toLowerCase().trim() === colorLower)
      || insoleProducts.find(p => p.groupName === need.groupName);
    if (!product) continue;

    const onHand = Math.max(0, Number(product.quantity || 0) - Number(product.reserved_stock || 0));
    if (onHand >= need.qty) continue;

    const supplier = product.supplier_id ? supplierMap.get(product.supplier_id) : null;
    const leadTime = Number((supplier as any)?.lead_time_days || product.supplier_lead_time_days || product.lead_time_days || 10);
    const moq = 0;
    const shortageQty = need.qty - onHand;
    insoleShortages.push({
      insole_product_id: product.id,
      insole_name: product.name,
      insole_color: need.palmilhaColor || null,
      insole_sku: product.sku || null,
      required: need.qty,
      available: onHand,
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
