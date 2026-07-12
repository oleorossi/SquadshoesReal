import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════
// MATERIAL impresso nas etiquetas — cascata CANÔNICA (spec variacao-material-pv)
//
// Fonte ÚNICA pra etiqueta térmica, rótulo caixa externa e etiqueta individual:
//   1. Variação do PV (sale_order_items.material_variant_id) → material_name
//      da reference_material_variants (ex.: "NAPA SOFT").
//   2. Grupo de cabedal da ficha (technical_sheets.upper_material).
//   3. Cabedal de tiras (has_straps, sem grupo de cabedal) → grupo de FORRAÇÃO
//      resolvido pick-one pra cor do item: lining_material se cobre a cor,
//      senão a 1ª alternativa de lining_accessories que cobre (mesma resolução
//      do motor de consumo/débito — group_covers_color).
//   4. Nada disso → '' (a linha MATERIAL é omitida, nunca "—").
// ═══════════════════════════════════════════════════════════════════════════

export type MaterialLabelInput = {
  referenceId: string;
  /** Variação de material do item do PV (quando o order/item tem). */
  materialVariantId?: string | null;
  /** Cor do item — decide o pick-one da forração em fichas de tiras. */
  color?: string | null;
};

export const materialLabelKey = (i: MaterialLabelInput) =>
  `${i.referenceId}|${i.materialVariantId || ''}|${(i.color || '').trim().toUpperCase()}`;

/** Resolve N combos em poucas queries (1× variantes + 1× fichas + coberturas
 *  de cor deduplicadas). Retorna Map keyed por materialLabelKey. */
export async function resolveMaterialLabels(
  inputs: MaterialLabelInput[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const combos = new Map<string, MaterialLabelInput>();
  for (const i of inputs) {
    if (i?.referenceId) combos.set(materialLabelKey(i), i);
  }
  if (combos.size === 0) return out;

  // 1) Variação do PV — vence tudo.
  const variantIds = [...new Set(
    [...combos.values()].map(c => c.materialVariantId).filter(Boolean) as string[],
  )];
  const variantName = new Map<string, string>();
  if (variantIds.length > 0) {
    const { data } = await supabase
      .from('reference_material_variants')
      .select('id, material_name')
      .in('id', variantIds);
    for (const v of data || []) variantName.set(v.id, (v.material_name || '').trim());
  }

  const pending: MaterialLabelInput[] = [];
  for (const [key, c] of combos) {
    const vn = c.materialVariantId ? variantName.get(c.materialVariantId) : undefined;
    if (vn) out.set(key, vn);
    else pending.push(c);
  }
  if (pending.length === 0) return out;

  // 2+3) Ficha: cabedal, ou forração pick-one quando o cabedal é de tiras.
  const refIds = [...new Set(pending.map(c => c.referenceId))];
  const { data: sheets } = await supabase
    .from('technical_sheets')
    .select('id, upper_material, lining_material, lining_accessories, has_straps')
    .in('id', refIds);
  const sheetById = new Map((sheets || []).map(s => [s.id, s]));

  // Coberturas de cor necessárias (grupo|cor), deduplicadas → 1 RPC cada.
  const coverageKeys = new Set<string>();
  const liningCandidates = (sheet: any): string[] => {
    const principal = (sheet?.lining_material || '').trim();
    const alts: string[] = Array.isArray(sheet?.lining_accessories)
      ? (sheet.lining_accessories as any[])
          .map(a => ((typeof a === 'string' ? a : a?.material) || '').trim())
          .filter(Boolean)
      : [];
    return [principal, ...alts].filter(Boolean);
  };
  for (const c of pending) {
    const sheet = sheetById.get(c.referenceId);
    if (!sheet) continue;
    const upper = (sheet.upper_material || '').trim();
    const color = (c.color || '').trim();
    if (!upper && sheet.has_straps && color) {
      for (const g of liningCandidates(sheet)) coverageKeys.add(`${g}|${color}`);
    }
  }
  const covers = new Map<string, boolean>();
  await Promise.all([...coverageKeys].map(async key => {
    const [group, color] = key.split('|');
    const { data } = await (supabase as any).rpc('group_covers_color', {
      p_group_name: group,
      p_color: color,
    });
    covers.set(key, data === true);
  }));

  for (const c of pending) {
    const key = materialLabelKey(c);
    const sheet = sheetById.get(c.referenceId);
    if (!sheet) { out.set(key, ''); continue; }
    const upper = (sheet.upper_material || '').trim();
    if (upper) { out.set(key, upper); continue; }
    if (!sheet.has_straps) { out.set(key, ''); continue; }

    const candidates = liningCandidates(sheet);
    if (candidates.length === 0) { out.set(key, ''); continue; }
    const color = (c.color || '').trim();
    if (!color) { out.set(key, candidates[0]); continue; }
    // Pick-one: principal se cobre a cor; senão 1ª alternativa que cobre;
    // senão principal (fallback — espelha resolveOption do motor de consumo).
    const winner = candidates.find(g => covers.get(`${g}|${color}`)) || candidates[0];
    out.set(key, winner);
  }
  return out;
}

/** Versão unitária da cascata (mesma semântica do batch). */
export async function resolveMaterialLabel(input: MaterialLabelInput): Promise<string> {
  const map = await resolveMaterialLabels([input]);
  return map.get(materialLabelKey(input)) || '';
}

export function parseSizes(sizesStr?: string): string[] {
  if (!sizesStr) return [];
  const match = sizesStr.match(/(\d+)\s*-\s*(\d+)/);
  if (match) {
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const sizes: string[] = [];
    for (let i = start; i <= end; i++) sizes.push(String(i));
    return sizes;
  }
  return sizesStr.split(',').map(s => s.trim()).filter(Boolean);
}
