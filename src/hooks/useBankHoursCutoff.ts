import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Retorna a data de corte do banco de horas (registros anteriores são ignorados
 * pelo cálculo). Hoje retorna 2026-04-15 (fixado em get_bank_hours_cutoff SQL).
 *
 * Cacheia por 1h — é uma constante na prática, raramente muda.
 */
export function useBankHoursCutoff() {
  return useQuery({
    queryKey: ['get_bank_hours_cutoff'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_bank_hours_cutoff');
      if (error) throw error;
      return data as string; // ISO date "YYYY-MM-DD"
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

export function formatCutoffBR(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}
