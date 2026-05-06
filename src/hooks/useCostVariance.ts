import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useCostVarianceReports(orderId?: string) {
  return useQuery({
    queryKey: ['cost_variance_reports', orderId],
    queryFn: async () => {
      let query = supabase
        .from('cost_variance_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (orderId) query = query.eq('order_id', orderId);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateCostVarianceReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (report: {
      order_id: string;
      sale_order_id?: string;
      period?: string;
      standard_material_cost: number;
      actual_material_cost: number;
      standard_labor_cost: number;
      actual_labor_cost: number;
      standard_overhead: number;
      actual_overhead: number;
      quantity_produced: number;
      notes?: string;
    }) => {
      const numericFields = [
        report.standard_material_cost, report.actual_material_cost,
        report.standard_labor_cost, report.actual_labor_cost,
        report.standard_overhead, report.actual_overhead,
        report.quantity_produced,
      ];
      if (numericFields.some(v => !Number.isFinite(v) || v < 0) || report.quantity_produced <= 0) {
        throw new Error('Todos os valores de custo devem ser positivos e finitos, e a quantidade produzida deve ser maior que zero.');
      }
      const materialVariance = report.actual_material_cost - report.standard_material_cost;
      const laborVariance = report.actual_labor_cost - report.standard_labor_cost;
      const overheadVariance = report.actual_overhead - report.standard_overhead;
      const totalStandard = report.standard_material_cost + report.standard_labor_cost + report.standard_overhead;
      const totalActual = report.actual_material_cost + report.actual_labor_cost + report.actual_overhead;
      const totalVariance = totalActual - totalStandard;
      const variancePct = totalStandard > 0 ? (totalVariance / totalStandard) * 100 : 0;

      const { error } = await supabase.from('cost_variance_reports').insert({
        ...report,
        material_variance: materialVariance,
        labor_variance: laborVariance,
        overhead_variance: overheadVariance,
        total_standard_cost: totalStandard,
        total_actual_cost: totalActual,
        total_variance: totalVariance,
        variance_pct: Math.round(variancePct * 100) / 100,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost_variance_reports'] });
      toast.success('Relatório de variação criado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
