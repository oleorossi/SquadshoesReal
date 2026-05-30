import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Comissões escalonadas (faixas) — paridade Tutor32 (módulo 2).
 *
 * Tabela commission_tiers + RPC calculate_tiered_commission JÁ existem no banco.
 * A RPC é PROGRESSIVA/MARGINAL: para cada faixa ativa do (rep, evento), soma
 *   (LEAST(total, max) - min) * pct/100
 * — i.e. faixas tipo "0–10k @5%, 10k–20k @7%". Este hook é a camada de gestão
 * dessas faixas + um espelho client-side do cálculo (preview e dashboard sem N
 * round-trips à RPC).
 *
 * trigger_event:
 *   'pedido'      → acumula sobre pedidos lançados
 *   'faturamento' → acumula sobre o que foi faturado (NF-e) — DEFAULT
 *   'liquidez'    → acumula sobre o que foi efetivamente recebido
 */

export type TriggerEvent = 'pedido' | 'faturamento' | 'liquidez';

export const TRIGGER_EVENTS: { value: TriggerEvent; label: string; hint: string }[] = [
  { value: 'pedido', label: 'Pedido', hint: 'Acumula sobre pedidos lançados' },
  { value: 'faturamento', label: 'Faturamento', hint: 'Acumula sobre o faturado (NF-e)' },
  { value: 'liquidez', label: 'Liquidez (recebido)', hint: 'Acumula sobre o efetivamente recebido' },
];

export const triggerLabel = (e: string) => TRIGGER_EVENTS.find((t) => t.value === e)?.label ?? e;

export interface CommissionTier {
  id: string;
  representative_id: string;
  min_value: number;
  max_value: number | null;
  commission_pct: number;
  trigger_event: string;
  active: boolean;
  notes: string | null;
  created_at: string;
}

export interface CommissionTierFormData {
  representative_id: string;
  min_value: number;
  max_value: number | null;
  commission_pct: number;
  trigger_event: TriggerEvent;
  active: boolean;
  notes?: string;
}

/**
 * Espelho EXATO da RPC calculate_tiered_commission (progressiva/marginal).
 * `tiers` deve conter só faixas do mesmo (rep, evento) que se quer aplicar.
 */
export function calcTieredCommission(periodTotal: number, tiers: CommissionTier[]): number {
  let total = 0;
  for (const t of [...tiers].filter((x) => x.active).sort((a, b) => a.min_value - b.min_value)) {
    if (periodTotal > t.min_value) {
      const taxable = Math.min(periodTotal, t.max_value ?? periodTotal) - t.min_value;
      total += (taxable * t.commission_pct) / 100;
    }
  }
  return total;
}

export function useCommissionTiers(representativeId?: string | null) {
  return useQuery({
    queryKey: ['commission_tiers', representativeId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('commission_tiers').select('*').order('min_value', { ascending: true });
      if (representativeId) q = q.eq('representative_id', representativeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CommissionTier[];
    },
  });
}

function validate(d: CommissionTierFormData) {
  if (!d.representative_id) throw new Error('Representante obrigatório.');
  if (!Number.isFinite(d.min_value) || d.min_value < 0) throw new Error('Início da faixa deve ser ≥ 0.');
  if (d.max_value != null && (!Number.isFinite(d.max_value) || d.max_value <= d.min_value))
    throw new Error('Fim da faixa deve ser maior que o início (ou vazio para "sem teto").');
  if (!Number.isFinite(d.commission_pct) || d.commission_pct < 0 || d.commission_pct > 100)
    throw new Error('Comissão deve estar entre 0 e 100%.');
}

export function useAddCommissionTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CommissionTierFormData) => {
      validate(data);
      const { error } = await supabase.from('commission_tiers').insert({
        representative_id: data.representative_id,
        min_value: data.min_value,
        max_value: data.max_value,
        commission_pct: data.commission_pct,
        trigger_event: data.trigger_event,
        active: data.active,
        notes: data.notes ?? '',
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission_tiers'] }); toast.success('Faixa adicionada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateCommissionTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CommissionTierFormData> }) => {
      if (data.commission_pct !== undefined || data.min_value !== undefined || data.max_value !== undefined) {
        validate({ representative_id: 'x', min_value: data.min_value ?? 0, max_value: data.max_value ?? null, commission_pct: data.commission_pct ?? 0, trigger_event: (data.trigger_event ?? 'faturamento') as TriggerEvent, active: true });
      }
      const { error } = await supabase.from('commission_tiers').update(data as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission_tiers'] }); toast.success('Faixa atualizada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteCommissionTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('commission_tiers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission_tiers'] }); toast.success('Faixa removida!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
