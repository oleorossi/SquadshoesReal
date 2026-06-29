 import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
 import { supabase } from '@/integrations/supabase/client';
 import { toast } from 'sonner';

// Query keys (compartilhadas entre os hooks pra invalidar de forma consistente)
const QUERY_KEY = (referenceId?: string) => ['reference_material_variants', referenceId] as const;
const ALL_ACTIVE_KEY = ['reference_material_variants', 'all_active'] as const;
 
 export type ReferenceMaterialVariant = {
   id: string;
   reference_id: string;
   material_name: string;
   sku: string;
   barcode: string;
   ncm: string;
   description_override: string;
   upper_material_product_id: string | null;
   /** Override de consumo (dm²/par) do cabedal. NULL = usa ficha. */
   upper_consumption_override: number | null;
   /** Produto de forro override pra esta variação. NULL = resolve pelo grupo da ficha. */
   lining_material_product_id: string | null;
   /** Override de consumo (dm²/par) do forro. NULL = usa ficha. */
   lining_consumption_override: number | null;
   /** Produto de palmilha override. NULL = resolve pelo grupo da ficha. */
   insole_material_product_id: string | null;
   /** Override de consumo (dm²/par) da palmilha. NULL = usa ficha. */
   insole_consumption_override: number | null;
   /** Solado SKU override. NULL = usa primary_sole_id da ficha. */
   sole_material_product_id: string | null;
   /** Unidades de solado/par (raro != 1). NULL = usa 1. */
   sole_consumption_override: number | null;
   unit_price_override: number | null;
   available_colors: string[] | null;
   active: boolean;
   display_order: number;
   created_at: string;
   updated_at: string;
 };
 
 export function useReferenceMaterialVariants(referenceId?: string) {
   return useQuery({
     queryKey: ['reference_material_variants', referenceId],
     enabled: !!referenceId,
     queryFn: async () => {
       const { data, error } = await supabase
         .from('reference_material_variants')
         .select('*')
         .eq('reference_id', referenceId!)
         .order('display_order', { ascending: true });
       if (error) throw error;
       return data as ReferenceMaterialVariant[];
     },
   });
 }
 
 export function useAddReferenceMaterialVariant() {
   const qc = useQueryClient();
   return useMutation({
     mutationFn: async (data: Partial<ReferenceMaterialVariant>) => {
       const { data: result, error } = await supabase
         .from('reference_material_variants')
         .insert(data as any)
         .select()
         .single();
       if (error) throw error;
       return result as ReferenceMaterialVariant;
     },
     onSuccess: (_d, vars) => {
       qc.invalidateQueries({ queryKey: QUERY_KEY(vars.reference_id) });
       // ALL_ACTIVE_KEY é mais ESPECÍFICA que o prefixo da ficha (['..._variants', refId]),
       // então NÃO casa por prefixo — precisa ser invalidada explicitamente. Sem isto, a
       // variante recém-criada não aparece no dropdown do PV até o staleTime (60s) expirar.
       qc.invalidateQueries({ queryKey: ALL_ACTIVE_KEY });
       toast.success('Variante de material adicionada');
     },
     onError: (err: Error) => toast.error(`Erro: ${err.message}`),
   });
 }
 
 export function useUpdateReferenceMaterialVariant() {
   const qc = useQueryClient();
   return useMutation({
     mutationFn: async ({ id, data }: { id: string; data: Partial<ReferenceMaterialVariant> }) => {
       const { error } = await supabase
         .from('reference_material_variants')
         .update(data as any)
         .eq('id', id);
       if (error) throw error;
     },
     onSuccess: () => {
       qc.invalidateQueries({ queryKey: ['reference_material_variants'] });
       toast.success('Variante de material atualizada');
     },
     onError: (err: Error) => toast.error(`Erro: ${err.message}`),
   });
 }
 
 export function useDeleteReferenceMaterialVariant() {
   const qc = useQueryClient();
   return useMutation({
     mutationFn: async (id: string) => {
       const { error } = await supabase
         .from('reference_material_variants')
         .delete()
         .eq('id', id);
       if (error) throw error;
     },
     onSuccess: () => {
       qc.invalidateQueries({ queryKey: ['reference_material_variants'] });
       toast.success('Variante de material removida');
     },
     onError: (err: Error) => toast.error(`Erro: ${err.message}`),
   });
 }
 
 type DuplicateVariantInput = {
  source_variant_id: string;
  sheet_id: string;
  overrides: Partial<ReferenceMaterialVariant>;
};

export function useDuplicateReferenceMaterialVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ source_variant_id, sheet_id, overrides }: DuplicateVariantInput) => {
      const { data: source, error: fetchErr } = await supabase
        .from('reference_material_variants')
        .select('*')
        .eq('id', source_variant_id)
        .single();
      if (fetchErr) throw fetchErr;
      if (!source) throw new Error('Variante de origem não encontrada');

      const { id, created_at, updated_at, ...sourceData } = source as any;

      const insertPayload = {
        ...sourceData,
        ...overrides,
        reference_id: sheet_id,
      };

      const { data: newVariant, error: insertErr } = await supabase
        .from('reference_material_variants')
        .insert(insertPayload)
        .select()
        .single();
      if (insertErr) throw insertErr;

      const { data: bomCount, error: rpcErr } = await supabase.rpc(
        'duplicate_material_variant_bom' as any,
        {
          p_source_variant_id: source_variant_id,
          p_target_variant_id: newVariant.id,
          p_sheet_id: sheet_id,
        }
      );
      if (rpcErr) {
        await supabase
          .from('reference_material_variants')
          .delete()
          .eq('id', newVariant.id);
        throw rpcErr;
      }

      return {
        variant: newVariant as ReferenceMaterialVariant,
        bom_lines_copied: (bomCount as number) ?? 0,
      };
    },
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY(vars.sheet_id) });
      qc.invalidateQueries({ queryKey: ALL_ACTIVE_KEY });
      const msg = result.bom_lines_copied > 0
        ? `Variante duplicada com ${result.bom_lines_copied} ${result.bom_lines_copied === 1 ? 'item' : 'itens'} de BOM`
        : 'Variante duplicada (sem BOM específico para copiar)';
      toast.success(msg);
    },
    onError: (err: Error) => toast.error(`Erro ao duplicar: ${err.message}`),
  });
}

export function useReorderReferenceMaterialVariants() {
   const qc = useQueryClient();
   return useMutation({
     mutationFn: async (variants: { id: string; display_order: number }[]) => {
       // Batch updates using multiple calls since Supabase doesn't support bulk update with different values easily in a single RPC without custom DB function
       const updates = variants.map(v => 
         supabase.from('reference_material_variants').update({ display_order: v.display_order }).eq('id', v.id)
       );
       const results = await Promise.all(updates);
       const firstError = results.find(r => r.error)?.error;
       if (firstError) throw firstError;
     },
     onSuccess: () => {
       qc.invalidateQueries({ queryKey: ['reference_material_variants'] });
     },
     onError: (err: Error) => toast.error(`Erro ao reordenar: ${err.message}`),
   });
 }

export function useUpsertReferenceMaterialVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ReferenceMaterialVariantInsert & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { data, error } = await (supabase as any)
          .from('reference_material_variants')
          .update(rest)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data as ReferenceMaterialVariant;
      }
      const { data, error } = await (supabase as any)
        .from('reference_material_variants')
        .insert(rest)
        .select()
        .single();
      if (error) throw error;
      return data as ReferenceMaterialVariant;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY(variables.reference_id) });
      qc.invalidateQueries({ queryKey: ALL_ACTIVE_KEY });
    },
    onError: (err: any) => toast.error(`Erro ao salvar variação: ${err.message}`),
  });
}


export function useAllActiveReferenceMaterialVariants() {
  return useQuery({
    queryKey: ALL_ACTIVE_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_material_variants')
        .select('id, reference_id, material_name, sku, available_colors')
        .eq('active', true)
        .order('display_order');
      if (error) throw error;
      const map = new Map<string, VariantSummary[]>();
      for (const v of (data || [])) {
        const arr = map.get(v.reference_id) ?? [];
        arr.push({ id: v.id, material_name: v.material_name, sku: v.sku, available_colors: v.available_colors ?? [] });
        map.set(v.reference_id, arr);
      }
      return map;
    },
    staleTime: 60_000,
  });
}


export type VariantSummary = { id: string; material_name: string; sku: string | null; available_colors: string[] };


/** Campos de override de material/consumo são opcionais no upsert: quando
 *  omitidos, o UPDATE não toca neles (preserva valores existentes) e o INSERT
 *  cai no default do banco (NULL). NÃO enviar null explícito num edit parcial. */
type VariantOverrideKeys =
  | 'upper_consumption_override'
  | 'lining_material_product_id' | 'lining_consumption_override'
  | 'insole_material_product_id' | 'insole_consumption_override'
  | 'sole_material_product_id' | 'sole_consumption_override';

export type ReferenceMaterialVariantInsert =
  Omit<ReferenceMaterialVariant, 'id' | 'created_at' | 'updated_at' | VariantOverrideKeys> &
  Partial<Pick<ReferenceMaterialVariant, VariantOverrideKeys>>;


export type ReferenceMaterialVariantUpdate = Partial<Omit<ReferenceMaterialVariant, 'id' | 'reference_id' | 'created_at' | 'updated_at'>>;
