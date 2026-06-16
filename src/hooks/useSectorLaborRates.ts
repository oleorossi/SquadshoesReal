import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SALARY_HOUR_DIVISOR } from '@/lib/salaryPayroll';

/**
 * Base da calculadora manual de custo de MO (aba "Mão de Obra" em
 * /pricing-calculator): o SALÁRIO MENSAL por setor produtivo. O custo-hora é
 * DERIVADO do salário (= salário ÷ 220, sem encargos — mesma base que a folha
 * usa pro valor-hora, SALARY_HOUR_DIVISOR). Chave = SectorKey canônico de
 * src/lib/sectors.ts. Ver migrations 20260613130000 + 20260614120000.
 */

const QUERY_KEY = ['sector-labor-rates'] as const;

export interface SectorRate {
  /** Salário mensal do setor (R$/mês) — o que o usuário cadastra. */
  monthly_salary: number;
  /** Custo-hora derivado = salário ÷ 220 (sem encargos). */
  hourly_rate: number;
}

/** Custo-hora a partir do salário do setor, sem encargos (salário ÷ 220). */
export function hourlyFromSalary(monthlySalary: number): number {
  return SALARY_HOUR_DIVISOR > 0 ? (Number(monthlySalary) || 0) / SALARY_HOUR_DIVISOR : 0;
}

/** Mapa sector_key → { salário mensal, custo-hora derivado }. */
export function useSectorLaborRates() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sector_labor_rates')
        .select('sector_key, monthly_salary, hourly_rate');
      if (error) throw error;
      const map: Record<string, SectorRate> = {};
      for (const r of data ?? []) {
        const salary = Number((r as any).monthly_salary) || 0;
        // Deriva sempre do salário; cai pro hourly_rate persistido só se o salário
        // ainda não foi migrado (linhas antigas).
        const hourly = salary > 0 ? hourlyFromSalary(salary) : Number(r.hourly_rate) || 0;
        map[r.sector_key] = { monthly_salary: salary, hourly_rate: hourly };
      }
      return map;
    },
    staleTime: 60_000,
  });
}

/** Upsert do SALÁRIO de um setor. Persiste o custo-hora derivado junto (compat). */
export function useUpsertSectorLaborRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectorKey, monthlySalary }: { sectorKey: string; monthlySalary: number }) => {
      const { error } = await supabase
        .from('sector_labor_rates')
        .upsert(
          {
            sector_key: sectorKey,
            monthly_salary: monthlySalary,
            hourly_rate: hourlyFromSalary(monthlySalary),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'sector_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
