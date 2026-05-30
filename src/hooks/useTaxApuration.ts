import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Apuração mensal de impostos (ESTIMATIVA) — paridade Tutor32 (fiscal #3).
 * Estima débitos via NF-e autorizada → itens do PV → NCM → perfil tributário.
 * Valores reais vêm do XML; isto é estimativa baseada nos perfis (fiscal #2).
 */

export interface ApuracaoByNcm {
  ncm: string; has_profile: boolean; base: number;
  icms: number; ipi: number; pis: number; cofins: number;
}
export interface TaxApuration {
  period_start: string;
  period_end: string;
  notes_count: number;
  faturamento_bruto: number;
  faturamento_cancelado: number;
  apuracao: {
    base_apuravel: number;
    base_sem_perfil: number;
    icms: number; ipi: number; pis: number; cofins: number;
    by_ncm: ApuracaoByNcm[];
  };
}

export function useEstimateTaxApuration() {
  return useMutation({
    mutationFn: async ({ start, end, companyId }: { start: string; end: string; companyId?: string | null }): Promise<TaxApuration> => {
      const { data, error } = await supabase.rpc('estimate_tax_apuration' as any, {
        p_period_start: start, p_period_end: end, p_company_id: companyId ?? null,
      });
      if (error) throw error;
      return data as unknown as TaxApuration;
    },
    onError: (err: Error) => toast.error(`Erro ao apurar: ${err.message}`),
  });
}
