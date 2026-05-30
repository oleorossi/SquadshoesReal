import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Patrimônio / Imobilizado — paridade Tutor32 (módulo 3).
 *
 * Lê de v_fixed_assets (depreciação linear calculada) e grava em fixed_assets.
 * Depreciação mensal = (custo - residual) / vida_útil_meses; acumulada limitada
 * à base depreciável; valor contábil = custo - acumulada.
 */

export interface FixedAsset {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  supplier_id: string | null;
  cost_center_id: string | null;
  supplier_name: string | null;
  cost_center_name: string | null;
  acquisition_date: string;
  acquisition_cost: number;
  residual_value: number;
  useful_life_months: number;
  status: 'ativo' | 'baixado';
  disposal_date: string | null;
  disposal_value: number;
  disposal_reason: string;
  notes: string;
  // calculados pela view
  depreciable_base: number;
  months_elapsed: number;
  monthly_depreciation: number;
  accumulated_depreciation: number;
  book_value: number;
  fully_depreciated: boolean;
  disposal_gain_loss: number | null;
}

export interface FixedAssetFormData {
  asset_code: string;
  name: string;
  category: string;
  supplier_id: string | null;
  cost_center_id: string | null;
  acquisition_date: string;
  acquisition_cost: number;
  residual_value: number;
  useful_life_months: number;
  notes?: string;
}

export const ASSET_CATEGORIES = ['Máquinas e Equipamentos', 'Móveis e Utensílios', 'Veículos', 'Informática', 'Imóveis', 'Ferramentas', 'Outros'];

/** Espelho da depreciação linear da view (para preview no formulário). */
export function deriveDepreciation(cost: number, residual: number, lifeMonths: number, acquisitionDate: string, refDate = new Date()) {
  const base = Math.max(cost - residual, 0);
  const monthly = lifeMonths > 0 ? base / lifeMonths : 0;
  const acq = new Date(acquisitionDate);
  let months = 0;
  if (refDate > acq) {
    months = (refDate.getFullYear() - acq.getFullYear()) * 12 + (refDate.getMonth() - acq.getMonth());
    if (refDate.getDate() < acq.getDate()) months -= 1;
    months = Math.max(0, Math.min(months, lifeMonths));
  }
  const accumulated = Math.min(monthly * months, base);
  return { base, monthly, months, accumulated, bookValue: cost - accumulated };
}

export function useFixedAssets() {
  return useQuery({
    queryKey: ['fixed_assets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fixed_assets' as any).select('*').order('acquisition_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FixedAsset[];
    },
  });
}

function validate(d: FixedAssetFormData) {
  if (!d.name.trim()) throw new Error('Informe o nome do bem.');
  if (!d.category) throw new Error('Selecione a categoria.');
  if (!Number.isFinite(d.acquisition_cost) || d.acquisition_cost < 0) throw new Error('Custo de aquisição inválido.');
  if (!Number.isFinite(d.residual_value) || d.residual_value < 0) throw new Error('Valor residual inválido.');
  if (d.residual_value > d.acquisition_cost) throw new Error('Valor residual não pode exceder o custo de aquisição.');
  if (!Number.isInteger(d.useful_life_months) || d.useful_life_months <= 0) throw new Error('Vida útil deve ser um nº de meses positivo.');
}

export function useAddFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: FixedAssetFormData) => {
      validate(data);
      const { error } = await supabase.from('fixed_assets' as any).insert(data as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed_assets'] }); toast.success('Bem cadastrado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FixedAssetFormData }) => {
      validate(data);
      const { error } = await supabase.from('fixed_assets' as any).update(data as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed_assets'] }); toast.success('Bem atualizado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fixed_assets' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed_assets'] }); toast.success('Bem removido!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Baixa de imobilizado (venda/sucata/perda). */
export function useDisposeFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, disposal_date, disposal_value, disposal_reason }: { id: string; disposal_date: string; disposal_value: number; disposal_reason: string }) => {
      if (!disposal_date) throw new Error('Informe a data da baixa.');
      if (!Number.isFinite(disposal_value) || disposal_value < 0) throw new Error('Valor de baixa inválido.');
      const { error } = await supabase.from('fixed_assets' as any)
        .update({ status: 'baixado', disposal_date, disposal_value, disposal_reason } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed_assets'] }); toast.success('Bem baixado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Reverte uma baixa (volta o bem para ativo). */
export function useReactivateFixedAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fixed_assets' as any)
        .update({ status: 'ativo', disposal_date: null, disposal_value: 0, disposal_reason: '' } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fixed_assets'] }); toast.success('Baixa revertida.'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
