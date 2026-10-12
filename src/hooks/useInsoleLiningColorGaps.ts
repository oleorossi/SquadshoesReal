/**
 * Cor vendida sem SKU no grupo da FORRAÇÃO, nas fichas em que o forro é da
 * PALMILHA.
 *
 * Fonte: `list_insole_lining_color_gaps()` (mig `20270101039500`). O recorte é
 * estreito de propósito: só ficha com `sole_drives_consumption` cujo SOLADO tem
 * forro de palmilha e NÃO tem forro de cabedal — a mesma condição de
 * `suppressCabedalForracao` (`orderConsumption.ts`). Nessas fichas o
 * `lining_material` não é forração de cabedal: é o material do forro da
 * palmilha, e sem mapa em `technical_sheet_palmilha_colors` ele herda a cor do
 * item. Cor sem SKU ali = débito pulado (ruptura).
 *
 * ⚠ Cabedal e forração em grupos DIFERENTES é legítimo e corriqueiro — não é o
 * que se alarma aqui. O que dói é cor vendida sem SKU no grupo que o débito vai
 * procurar. Ver o grill de 12/10/2026 no CLAUDE.md.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface InsoleLiningColorGapRow {
  sheet_id: string;
  reference_code: string | null;
  reference_name: string | null;
  lining_material: string | null;
  lining_group_id: string | null;
  sold_color: string | null;
  items: number;
  sale_orders: string[];
  has_palmilha_color_map: boolean;
  fix_hint: string | null;
}

export const insoleLiningColorGapsKey = ['list_insole_lining_color_gaps'] as const;

export function useInsoleLiningColorGaps(enabled = true) {
  return useQuery({
    queryKey: insoleLiningColorGapsKey,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<InsoleLiningColorGapRow[]> => {
      const { data, error } = await supabase.rpc('list_insole_lining_color_gaps' as never);
      // Falha NUNCA vira "nenhuma lacuna": alarme quebrado não pode parecer
      // cadastro em ordem (mesma regra dos outros painéis de diagnóstico).
      if (error) throw error;
      return ((data ?? []) as unknown as InsoleLiningColorGapRow[]).map((row) => ({
        ...row,
        items: Number(row.items) || 0,
        sale_orders: Array.isArray(row.sale_orders) ? row.sale_orders : [],
      }));
    },
  });
}
