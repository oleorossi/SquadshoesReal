import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════
// MATERIAL impresso nas etiquetas — cascata CANÔNICA (dono, 24/09/2026)
//
// Fonte ÚNICA pra etiqueta térmica, rótulo caixa externa e etiqueta individual:
//   → FORRAÇÃO da ficha (`lining_material` + `lining_accessories`), pick-one
//     pela cor do item (group_covers_color — mesma resolução do consumo/débito).
//
// Variante comercial, snapshot do PV e cabedal (`upper_material`) NÃO entram
// nesta linha. Decisão do dono: "o material é o da forração, não do cabedal".
// Sem forração cadastrada → '' (linha omitida; na prática a ficha sempre tem).
// ═══════════════════════════════════════════════════════════════════════════

export type MaterialLabelInput = {
  referenceId: string;
  /** Mantido na assinatura por compatibilidade dos callers; ignorado na resolução. */
  materialVariantId?: string | null;
  /** Mantido na assinatura por compatibilidade; ignorado na resolução. */
  materialVariantCommercialSnapshot?: unknown;
  /** Cor do item — decide o pick-one da forração. */
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
    (i.color || '').trim().toUpperCase(),
  ]);

const liningCandidates = (sheet: {
  lining_material?: string | null;
  lining_accessories?: unknown;
}): string[] => {
  const principal = (sheet?.lining_material || '').trim();
  const alts: string[] = Array.isArray(sheet?.lining_accessories)
    ? (sheet.lining_accessories as any[])
        .map(a => ((typeof a === 'string' ? a : a?.material) || '').trim())
        .filter(Boolean)
    : [];
  return [principal, ...alts].filter(Boolean);
};

/** Resolve N combos em poucas queries (1× fichas + coberturas de cor). */
export async function resolveMaterialLabels(
  inputs: MaterialLabelInput[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const combos = new Map<string, MaterialLabelInput>();
  for (const i of inputs) {
    if (i?.referenceId) combos.set(materialLabelKey(i), i);
  }
  if (combos.size === 0) return out;

  const refIds = [...new Set([...combos.values()].map(c => c.referenceId))];
  const { data: sheets } = await supabase
    .from('technical_sheets')
    .select('id, lining_material, lining_accessories')
    .in('id', refIds);
  const sheetById = new Map((sheets || []).map(s => [s.id, s]));

  const coverageKeys = new Set<string>();
  for (const c of combos.values()) {
    const sheet = sheetById.get(c.referenceId);
    const color = (c.color || '').trim();
    if (!sheet || !color) continue;
    for (const g of liningCandidates(sheet)) coverageKeys.add(`${g}|${color}`);
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

  for (const [key, c] of combos) {
    const sheet = sheetById.get(c.referenceId);
    if (!sheet) {
      out.set(key, '');
      continue;
    }
    const candidates = liningCandidates(sheet);
    if (candidates.length === 0) {
      out.set(key, '');
      // #region agent log
      fetch('http://127.0.0.1:7492/ingest/95b24859-9dac-4898-80f4-140cf86ddf60',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fe546d'},body:JSON.stringify({sessionId:'fe546d',runId:'post-fix',hypothesisId:'H3',location:'labelUtils.ts:emptyLining',message:'MATERIAL empty — no lining on sheet',data:{ref:c.referenceId,color:c.color},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      continue;
    }
    const color = (c.color || '').trim();
    const winner = !color
      ? candidates[0]
      : (candidates.find(g => covers.get(`${g}|${color}`)) || candidates[0]);
    out.set(key, winner);
    // #region agent log
    fetch('http://127.0.0.1:7492/ingest/95b24859-9dac-4898-80f4-140cf86ddf60',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fe546d'},body:JSON.stringify({sessionId:'fe546d',runId:'post-fix',hypothesisId:'H3',location:'labelUtils.ts:lining',message:'MATERIAL won by lining (forração)',data:{ref:c.referenceId,color,winner,candidates},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
