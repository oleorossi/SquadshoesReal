import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { productGroupingKey } from '@/lib/productNameNormalization';

/**
 * Resolve TODAS as variantes de cor do MESMO modelo de solado (mesma chave
 * de agrupamento por nome normalizado). Usado para que o consumo base
 * cadastrado em qualquer variante seja espelhado em todas as outras —
 * a variação de cor é industrialmente irrelevante para o consumo de
 * itens compartilhados (cola, palmilha, forro, linha, EVA…).
 */
async function resolveSoleSiblingIds(soleProductId: string): Promise<string[]> {
  const { data: anchor } = await supabase
    .from('products')
    .select('id, name, category')
    .eq('id', soleProductId)
    .maybeSingle();
  if (!anchor) return [soleProductId];

  const cat = (anchor.category || '').toLowerCase();
  if (!cat.includes('solado') && cat !== 'sola') return [soleProductId];

  const groupKey = productGroupingKey(anchor.name || '');
  const { data: candidates } = await supabase
    .from('products')
    .select('id, name, category')
    .in('category', ['Solado', 'Sola', 'solado', 'sola']);

  const siblings = (candidates || [])
    .filter((p: any) => {
      const c = (p.category || '').toLowerCase();
      if (!c.includes('solado') && c !== 'sola') return false;
      return productGroupingKey(p.name || '') === groupKey;
    })
    .map((p: any) => p.id);

  // Garante que o próprio id está na lista (caso o grupo só tenha 1 variante).
  return siblings.length > 0 ? siblings : [soleProductId];
}

export type SoleStandardItemRow = {
  id: string;
  sole_product_id: string;
  standard_item_id: string;
  size: number;
  consumption: number;
  unit: string;
};

/** Fetches all standard item consumptions for a given sole product. */
export function useSoleStandardItems(soleProductId: string | null | undefined) {
  return useQuery({
    queryKey: ['sole_standard_items', soleProductId],
    enabled: !!soleProductId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .select('*')
        .eq('sole_product_id', soleProductId);
      if (error) throw error;
      return (data || []) as SoleStandardItemRow[];
    },
  });
}

/** Returns the size grade (sorted) registered for a given sole. */
export function useSoleSizeGrade(soleProductId: string | null | undefined) {
  return useQuery({
    queryKey: ['sole_size_grade', soleProductId],
    enabled: !!soleProductId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sole_technical_specs')
        .select('size')
        .eq('sole_id', soleProductId)
        .order('size');
      if (error) throw error;
      const sizes = Array.from(new Set((data || []).map((r: any) => Number(r.size)))).sort((a, b) => a - b);
      return sizes;
    },
  });
}

/** Bulk upsert (replace) consumption entries for one (sole, standard_item) across sizes. */
export function useUpsertSoleStandardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sole_product_id: string;
      standard_item_id: string;
      unit: string;
      values: Record<number, number>; // size -> consumption
    }) => {
      // Replica para TODAS as variantes de cor do mesmo modelo de solado.
      // Cor é indiferente para o consumo industrial — esta replicação
      // garante que cadastrar em uma variante propaga para todas.
      const siblingIds = await resolveSoleSiblingIds(params.sole_product_id);
      const rows = siblingIds.flatMap((sid) =>
        Object.entries(params.values).map(([size, consumption]) => ({
          sole_product_id: sid,
          standard_item_id: params.standard_item_id,
          size: Number(size),
          consumption: Number(consumption) || 0,
          unit: params.unit,
        })),
      );
      if (rows.length === 0) return { siblingIds: [] as string[] };
      const { error } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .upsert(rows, { onConflict: 'sole_product_id,standard_item_id,size' });
      if (error) throw error;
      return { siblingIds };
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_standard_items', vars.sole_product_id] });
      // Invalida também as queries das demais variantes para refletir o espelhamento.
      (data?.siblingIds || []).forEach((sid) => {
        if (sid !== vars.sole_product_id) {
          qc.invalidateQueries({ queryKey: ['sole_standard_items', sid] });
        }
      });
      const propagated = Math.max(0, (data?.siblingIds.length ?? 1) - 1);
      toast.success(
        propagated > 0
          ? `Consumo padrão salvo e propagado para ${propagated} variante${propagated === 1 ? '' : 's'} de cor!`
          : 'Consumo padrão salvo!',
      );
    },
    onError: (err: Error) => toast.error(`Erro ao salvar: ${err.message}`),
  });
}

/** Removes all consumption rows for a (sole, standard_item) pair. */
export function useRemoveSoleStandardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { sole_product_id: string; standard_item_id: string }) => {
      // Remove de TODAS as variantes de cor do mesmo modelo (mantém consistência).
      const siblingIds = await resolveSoleSiblingIds(params.sole_product_id);
      const { error } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .delete()
        .in('sole_product_id', siblingIds)
        .eq('standard_item_id', params.standard_item_id);
      if (error) throw error;
      return { siblingIds };
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_standard_items', vars.sole_product_id] });
      (data?.siblingIds || []).forEach((sid) => {
        if (sid !== vars.sole_product_id) {
          qc.invalidateQueries({ queryKey: ['sole_standard_items', sid] });
        }
      });
      toast.success('Item padrão removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
