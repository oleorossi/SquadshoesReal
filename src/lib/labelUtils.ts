import { supabase } from "@/integrations/supabase/client";

// Nome do material/família exibido na etiqueta (abaixo da cor).
// Fonte: technical_sheets.upper_material (cabedal) — campo de texto livre que
// guarda a família/grupo (ex.: "NAPA SOFT", "NAPA SANTORINE", "NEW VELVET").
// Fallback: lining_material (forro) quando o cabedal não foi preenchido.
//
// ⚠ Antes lia de `reference_materials`, que está 100% vazia no banco — por isso
// o material NUNCA aparecia em nenhuma etiqueta. Repontado pra fonte viva.
export async function fetchMainMaterial(referenceId: string): Promise<string> {
  const { data } = await supabase
    .from('technical_sheets')
    .select('upper_material, lining_material')
    .eq('id', referenceId)
    .maybeSingle();
  const upper = (data?.upper_material || '').trim();
  if (upper) return upper;
  return (data?.lining_material || '').trim();
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
