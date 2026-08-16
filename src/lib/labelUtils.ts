import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════
// MATERIAL impresso nas etiquetas — cascata CANÔNICA (spec variacao-material-pv)
//
// Fonte ÚNICA pra etiqueta térmica, rótulo caixa externa e etiqueta individual:
//   1. Snapshot comercial congelado no item do PV → material_name usado na
//      confirmação, sem depender do cadastro vivo da variante.
//   1a. Fallback legado sem snapshot: material_variant_id → material_name da
//      reference_material_variants (ex.: "NAPA SOFT").
//   1b. Item SEM variante gravada, mas a referência TEM variantes ativas →
//      infere a variante pela COR do item: se exatamente UMA variante tem
//      grupo de material (cabedal/forro/palmilha) que cobre a cor
//      (group_covers_color — mesma resolução do motor de consumo/débito),
//      imprime o material_name dela. Ambíguo (cor em 2+ variantes) ou sem
//      match → segue a cascata normal. Ver bug DS21/PORCELANA abaixo.
//   2. Grupo de cabedal da ficha (technical_sheets.upper_material).
//   3. Cabedal de tiras (has_straps, sem grupo de cabedal) → grupo de FORRAÇÃO
//      resolvido pick-one pra cor do item: lining_material se cobre a cor,
//      senão a 1ª alternativa de lining_accessories que cobre (mesma resolução
//      do motor de consumo/débito — group_covers_color).
//   4. Nada disso → '' (a linha MATERIAL é omitida, nunca "—").
//
// ⚠ Por que o passo 1b existe (bug PV-00146 / OP-2026-01158, 20/07/2026):
// a etiqueta do DS21 PORCELANA saiu "NAPA PALHA". O item do PV nasceu com
// `material_variant_id` NULL (o seletor "Material *" do PV só avisa em âmbar,
// não bloqueia; e as variantes só foram cadastradas em 11/07, então TODO PV
// anterior tem NULL — 220 de 295 itens). Sem variante, a cascata caía no
// `upper_material` da ficha = "NAPA PALHA", que na DS21 é campo residual
// (`upper_consumption = 1`), enquanto o corpo real do calçado é o
// `lining_material` NAPA SOFT (5,83 dm²/par). A reserva da OP já apontava
// NAPA SOFT PORCELANA — só a etiqueta divergia. Inferir pela cor realinha a
// etiqueta com o que a fábrica de fato corta.
// ═══════════════════════════════════════════════════════════════════════════

export type MaterialLabelInput = {
  referenceId: string;
  /** Variação de material do item do PV (quando o order/item tem). */
  materialVariantId?: string | null;
  /** Snapshot congelado no sale_order_item. Quando presente, vence o cadastro
   * vivo da variante, inclusive se ela foi renomeada ou inativada depois. */
  materialVariantCommercialSnapshot?: unknown;
  /** Cor do item — decide o pick-one da forração em fichas de tiras. */
  color?: string | null;
};

export type MaterialVariantCommercialSnapshot = {
  material_variant_id?: string | null;
  material_name?: string | null;
  sku?: string | null;
  gtin?: string | null;
  ncm?: string | null;
  description?: string | null;
  color?: string | null;
  unit_price?: number | null;
};

export function materialNameFromCommercialSnapshot(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '';
  return String((snapshot as MaterialVariantCommercialSnapshot).material_name || '').trim();
}

export const materialLabelKey = (i: MaterialLabelInput) =>
  JSON.stringify([
    i.referenceId,
    i.materialVariantId || '',
    (i.color || '').trim().toUpperCase(),
    materialNameFromCommercialSnapshot(i.materialVariantCommercialSnapshot),
  ]);

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

  // 1) Snapshot comercial do item — vence tudo e torna etiqueta histórica
  // independente do cadastro vivo da variante.
  const pendingLiveVariant: MaterialLabelInput[] = [];
  for (const [key, c] of combos) {
    const snapshotName = materialNameFromCommercialSnapshot(c.materialVariantCommercialSnapshot);
    if (snapshotName) out.set(key, snapshotName);
    else pendingLiveVariant.push(c);
  }
  if (pendingLiveVariant.length === 0) return out;

  // 1a) Fallback legado: item sem snapshot tenta a variação viva do PV.
  const variantIds = [...new Set(
    pendingLiveVariant.map(c => c.materialVariantId).filter(Boolean) as string[],
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
  for (const c of pendingLiveVariant) {
    const key = materialLabelKey(c);
    const vn = c.materialVariantId ? variantName.get(c.materialVariantId) : undefined;
    if (vn) out.set(key, vn);
    else pending.push(c);
  }
  if (pending.length === 0) return out;

  // 1b+2+3) Variantes ativas da referência (inferência pela cor) e a ficha
  // (cabedal, ou forração pick-one quando o cabedal é de tiras).
  const refIds = [...new Set(pending.map(c => c.referenceId))];
  const [{ data: sheets }, { data: variants }] = await Promise.all([
    supabase
      .from('technical_sheets')
      .select('id, upper_material, lining_material, lining_accessories, has_straps')
      .in('id', refIds),
    supabase
      .from('reference_material_variants')
      .select('id, reference_id, material_name, main_material_group_id, upper_material_group_id, lining_material_group_id, insole_material_group_id')
      .in('reference_id', refIds)
      .eq('active', true),
  ]);
  const sheetById = new Map((sheets || []).map(s => [s.id, s]));

  // Grupos das variantes → nome (group_covers_color trabalha por NOME).
  // main_material_group_id entra junto: variante criada pelo diálogo novo
  // costuma ter SÓ ele preenchido, e sem isso ela era descartada abaixo
  // (groupNames vazio) — a etiqueta caía no material da FICHA, imprimindo a napa
  // que a variante justamente substituiu.
  const variantGroupIds = [...new Set(
    (variants || []).flatMap(v => [
      v.main_material_group_id, v.upper_material_group_id, v.lining_material_group_id, v.insole_material_group_id,
    ]).filter(Boolean) as string[],
  )];
  const groupNameById = new Map<string, string>();
  if (variantGroupIds.length > 0) {
    const { data: groups } = await supabase
      .from('product_groups')
      .select('id, name')
      .in('id', variantGroupIds);
    for (const g of groups || []) groupNameById.set(g.id, (g.name || '').trim());
  }
  type VariantCandidate = { materialName: string; groupNames: string[] };
  const variantsByRef = new Map<string, VariantCandidate[]>();
  for (const v of variants || []) {
    const groupNames = [
      v.main_material_group_id, v.upper_material_group_id, v.lining_material_group_id, v.insole_material_group_id,
    ].map(id => (id ? groupNameById.get(id) : '')).filter(Boolean) as string[];
    if (groupNames.length === 0) continue;
    const list = variantsByRef.get(v.reference_id) || [];
    list.push({ materialName: (v.material_name || '').trim(), groupNames });
    variantsByRef.set(v.reference_id, list);
  }

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
    const color = (c.color || '').trim();
    // 1b) cobertura dos grupos das variantes (inferência pela cor).
    if (color) {
      for (const v of variantsByRef.get(c.referenceId) || []) {
        for (const g of v.groupNames) coverageKeys.add(`${g}|${color}`);
      }
    }
    if (!sheet) continue;
    const upper = (sheet.upper_material || '').trim();
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
    const itemColor = (c.color || '').trim();

    // 1b) Variante inferida pela COR — só quando UMA única variante da
    // referência tem grupo que cobre a cor. Ambíguo (ex.: OFF WHITE existe em
    // NAPA SOFT e NAPA SUDANI) cai na cascata antiga, sem chutar.
    if (itemColor) {
      const hits = (variantsByRef.get(c.referenceId) || []).filter(v =>
        v.groupNames.some(g => covers.get(`${g}|${itemColor}`)),
      );
      if (hits.length === 1 && hits[0].materialName) {
        out.set(key, hits[0].materialName);
        continue;
      }
    }

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
