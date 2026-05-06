import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useCogsEntries(saleOrderId?: string) {
  return useQuery({
    queryKey: ['cogs_entries', saleOrderId],
    queryFn: async () => {
      let query = supabase
        .from('cogs_entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (saleOrderId) query = query.eq('sale_order_id', saleOrderId);
      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateCogsEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: {
      sale_order_id?: string;
      nfe_id?: string;
      order_id?: string;
      material_cost: number;
      labor_cost: number;
      overhead_cost: number;
      revenue: number;
      quantity: number;
      invoice_number?: string;
      notes?: string;
    }) => {
      const costs = [entry.material_cost, entry.labor_cost, entry.overhead_cost, entry.revenue, entry.quantity];
      if (costs.some(v => !Number.isFinite(v) || v < 0) || entry.quantity <= 0) {
        throw new Error('Valores inválidos: custos e quantidade devem ser números positivos finitos.');
      }
      const totalCogs = entry.material_cost + entry.labor_cost + entry.overhead_cost;
      const grossMargin = entry.revenue - totalCogs;
      const costPerUnit = totalCogs / entry.quantity;

      const { data: cogs, error } = await supabase.from('cogs_entries').insert({
        ...entry,
        total_cogs: totalCogs,
        gross_margin: grossMargin,
        cost_per_unit: costPerUnit,
      } as any).select('id').single();
      if (error) throw error;

      // Also create financial entry for COGS — compensating delete on failure
      // so we don't leave an orphan cogs_entries row that double-counts CPV.
      const { error: feErr } = await supabase.from('financial_entries').insert({
        type: 'despesa',
        description: `CPV - ${entry.invoice_number || 'Faturamento'}`,
        amount: totalCogs,
        entry_date: new Date().toISOString().split('T')[0],
        reference_type: 'cogs',
        reference_id: entry.sale_order_id || '',
        notes: `Material: R$${entry.material_cost.toFixed(2)} | MOD: R$${entry.labor_cost.toFixed(2)} | GGF: R$${entry.overhead_cost.toFixed(2)}`,
      } as any);
      if (feErr) {
        await supabase.from('cogs_entries').delete().eq('id', (cogs as any).id);
        throw new Error(`COGS revertido — falha ao registrar lançamento financeiro: ${feErr.message}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cogs_entries'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      toast.success('COGS registrado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
