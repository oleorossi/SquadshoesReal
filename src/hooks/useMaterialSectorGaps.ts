/**
 * Buracos de cadastro de SETOR DE CONSUMO no material em falta.
 *
 * Fonte: `list_material_sector_gaps()` (mig `20270101038600`) — material com
 * falta viva cujo setor NÃO resolve por nenhuma camada de cadastro. Cada linha
 * aqui é um material que, pelo fail-safe de
 * `list_order_sector_material_shortages`, pergunta "vai iniciar com material
 * parcial?" em **TODO** setor, inclusive os que não encostam nele.
 *
 * Não inventa setor: a correção é cadastro (`sheet_materials.sector`,
 * `bom_part_sector_map` pelo grupo, ou `material_consumption_sector_map` pelo
 * SKU). Ver a seção de falta por setor no CLAUDE.md.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MaterialSectorGapRow {
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  quantity_short: number;
  reservations: number;
  /** Rótulo(s) de componente gravados na reserva — é o que não resolveu. */
  recorded_components: string | null;
  sale_orders: string[];
  fix_hint: string | null;
}

export const materialSectorGapsKey = ['list_material_sector_gaps'] as const;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function useMaterialSectorGaps(enabled = true) {
  return useQuery({
    queryKey: materialSectorGapsKey,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<MaterialSectorGapRow[]> => {
      const { data, error } = await supabase.rpc('list_material_sector_gaps' as never);
      // Falha NUNCA vira "nenhum buraco": o painel precisa distinguir erro de
      // lista vazia, senão um alarme quebrado parece cadastro em ordem.
      if (error) throw error;
      return ((data ?? []) as unknown as MaterialSectorGapRow[]).map((row) => ({
        ...row,
        quantity_short: toNumber(row.quantity_short),
        reservations: toNumber(row.reservations),
        sale_orders: Array.isArray(row.sale_orders) ? row.sale_orders : [],
      }));
    },
  });
}
