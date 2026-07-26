import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rangeToPeriod } from '@/lib/payrollPeriod';
import { runOverlapsRange, type RunResumo } from '@/lib/montadorPagamentos';
import type { PayrollRun } from '@/hooks/useRH';

/**
 * "Já pago" do relatório de pagamento por produção (Ficha de Montadores).
 *
 * Soma os payroll_payments das payroll_runs cujo PERÍODO sobrepõe o intervalo
 * filtrado — a run mensal conta no filtro quinzenal (a UI sinaliza com
 * exactPeriod=false). Fonte única com a Folha: nada de tabela paralela.
 */
export interface PagamentosPeriodo {
  byEmployee: Map<string, { paidTotal: number; runs: RunResumo[] }>;
  /** Run cujo period === rangeToPeriod(from,to) — usada pelo dialog de pagamento. */
  runByEmployeeExact: Map<string, PayrollRun>;
}

export function useMontadorPagamentos(employeeIds: string[], from: string, to: string, enabled = true) {
  const idsKey = [...employeeIds].sort().join(',');
  return useQuery({
    queryKey: ['montador_pagamentos', from, to, idsKey],
    enabled: enabled && employeeIds.length > 0 && !!from && !!to && from <= to,
    staleTime: 15_000,
    queryFn: async (): Promise<PagamentosPeriodo> => {
      // Runs por funcionário são poucas (≤ ~26/ano) — busca todas e filtra o
      // overlap no cliente, evitando SQL novo pro encoding do period.
      const { data: runs, error } = await (supabase as any)
        .from('payroll_runs')
        .select('*')
        .in('employee_id', employeeIds);
      if (error) throw error;

      const exactPeriod = rangeToPeriod(from, to);
      const overlapping = ((runs || []) as PayrollRun[]).filter(
        (r) => runOverlapsRange(r.period, from, to),
      );

      let payments: { payroll_run_id: string; employee_id: string; amount: number }[] = [];
      const runIds = overlapping.map((r) => r.id);
      if (runIds.length) {
        const { data, error: e2 } = await (supabase as any)
          .from('payroll_payments')
          .select('payroll_run_id, employee_id, amount')
          .in('payroll_run_id', runIds);
        if (e2) throw e2;
        payments = data || [];
      }

      const paidByRun = new Map<string, number>();
      for (const p of payments) {
        paidByRun.set(p.payroll_run_id, (paidByRun.get(p.payroll_run_id) || 0) + (Number(p.amount) || 0));
      }

      const byEmployee = new Map<string, { paidTotal: number; runs: RunResumo[] }>();
      const runByEmployeeExact = new Map<string, PayrollRun>();
      for (const r of overlapping) {
        const cur = byEmployee.get(r.employee_id) || { paidTotal: 0, runs: [] };
        cur.paidTotal += paidByRun.get(r.id) || 0;
        cur.runs.push({
          id: r.id,
          period: r.period,
          status: r.status,
          total_liquido: Number((r as any).total_liquido) || 0,
          exactPeriod: r.period === exactPeriod,
        });
        byEmployee.set(r.employee_id, cur);
        if (r.period === exactPeriod) runByEmployeeExact.set(r.employee_id, r);
      }
      return { byEmployee, runByEmployeeExact };
    },
  });
}
