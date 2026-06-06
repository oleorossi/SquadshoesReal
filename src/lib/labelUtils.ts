import { supabase } from "@/integrations/supabase/client";

export async function fetchMainMaterial(referenceId: string): Promise<string> {
  const { data: materials } = await supabase
    .from('reference_materials')
    .select('*, products(name, category, group_id, product_groups!products_group_id_fkey(name))')
    .eq('reference_id', referenceId);
  const cabedal = materials?.find((m: any) => m.products?.category === 'Cabedal');
  const main = cabedal || materials?.[0];
  const groupName = (main as any)?.products?.product_groups?.name;
  return groupName || (main as any)?.products?.name || '';
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
