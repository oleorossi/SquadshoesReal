
export interface ArtisanalCalculation {
  currentStock: number;
  minStock: number;
  forOrderMeters: number;
  forStockMeters: number;
  totalToProduce: number;
  baseMetersSend: number;
  laborCost: number;
  stockOk: boolean;
}

export function calcArtisanalRequirement(
  recipe: ArtisanalRecipe,
  targetMeters: number,
  currentStock: number,
  minStock: number
): ArtisanalCalculation {
  const yield_factor = Number(recipe.yield_per_meter) || 1;
  const labor_cost = Number(recipe.labor_cost_per_meter) || 0;

  const needed = Math.max(0, targetMeters);
  const forStock = Math.max(0, minStock - currentStock);
  const totalToProduce = needed + forStock;
  const baseMetersSend = totalToProduce / yield_factor;
  const laborCostTotal = totalToProduce * labor_cost;

  return {
    currentStock,
    minStock,
    forOrderMeters: needed,
    forStockMeters: forStock,
    totalToProduce,
    baseMetersSend,
    laborCost: laborCostTotal,
    stockOk: currentStock >= minStock,
  };
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ArtisanalRecipe {
  id: string;
  name: string;
  artisanal_product_name: string;
  base_product_name: string;
  yield_per_meter: number;
  labor_cost_per_meter: number;
  base_time_minutes: number;
  /** Largura de corte da tira artesanal em mm (corte do rolo no PV). Nullable. */
  cut_width_mm: number | null;
  default_contractor_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useArtisanalRecipes(opts?: { onlyActive?: boolean }) {
  return useQuery({
    queryKey: ['artisanal_recipes', opts?.onlyActive ?? false],
    queryFn: async () => {
      let q = supabase.from('artisanal_recipes').select('*').order('name');
      if (opts?.onlyActive) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ArtisanalRecipe[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateArtisanalRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipe: Partial<ArtisanalRecipe>) => {
      if (recipe.yield_per_meter !== undefined && (!Number.isFinite(recipe.yield_per_meter) || recipe.yield_per_meter <= 0)) {
        throw new Error('Rendimento por metro deve ser um número positivo.');
      }
      const { data, error } = await supabase
        .from('artisanal_recipes')
        .insert(recipe as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
      toast.success('Receita artesanal cadastrada!');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateArtisanalRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ArtisanalRecipe> & { id: string }) => {
      if (updates.yield_per_meter !== undefined && (!Number.isFinite(updates.yield_per_meter) || updates.yield_per_meter <= 0)) {
        throw new Error('Rendimento por metro deve ser um número positivo.');
      }
      const { error } = await supabase
        .from('artisanal_recipes')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
      toast.success('Receita atualizada!');
      // Trigger DB enfileira OSs artesanais ativas. Drena a fila agora para
      // que o estoque seja imediatamente sincronizado com o novo yield/custo.
      const { data: resyncData, error: resyncErr } = await (supabase as any).rpc('process_resync_queue', { p_limit: 50 });
      if (resyncErr) {
        if (!/does not exist|42883/i.test(resyncErr.message + (resyncErr.code ?? ''))) {
          console.error('[resync_queue] process_resync_queue failed:', resyncErr.message);
        }
      } else {
        const processed = Number(resyncData?.processed || 0);
        if (processed > 0) {
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['products'] });
          qc.invalidateQueries({ queryKey: ['stock_movements'] });
          toast.success(`${processed} OS(s) artesanal(is) resincronizada(s)`);
        }
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteArtisanalRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { count, error: cntErr } = await supabase
        .from('service_orders')
        .select('id', { count: 'exact', head: true })
        .eq('artisanal_recipe_id', id);
      if (cntErr) throw cntErr;
      if ((count ?? 0) > 0) {
        throw new Error(`Receita está vinculada a ${count} OS(s). Inative-a (active=false) em vez de excluir.`);
      }
      const { error } = await supabase.from('artisanal_recipes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
      toast.success('Receita removida!');
    },
    onError: (e: any) => toast.error(e.message),
  });
}