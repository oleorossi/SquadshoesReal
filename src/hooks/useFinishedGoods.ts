import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useFinishedGoodsReceipts(orderId?: string) {
  return useQuery({
    queryKey: ['finished_goods_receipts', orderId],
    queryFn: async () => {
      let query = supabase
        .from('finished_goods_receipts')
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

export function useCreateFinishedGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      saleOrderId,
      quantityGood,
      quantityScrap,
      quantityRework,
      totalCost,
      inspectedBy,
      inspectionStatus,
      lotNumber,
      notes,
    }: {
      orderId: string;
      saleOrderId?: string;
      quantityGood: number;
      quantityScrap?: number;
      quantityRework?: number;
      totalCost: number;
      inspectedBy?: string;
      inspectionStatus?: string;
      lotNumber?: string;
      notes?: string;
    }) => {
      if (!Number.isFinite(quantityGood) || quantityGood <= 0) throw new Error('Quantidade aprovada deve ser positiva.');
      if (!Number.isFinite(totalCost) || totalCost < 0) throw new Error('Custo total inválido.');
      const costPerUnit = totalCost / quantityGood;

      const { data: fgr, error } = await supabase
        .from('finished_goods_receipts')
        .insert({
          order_id: orderId,
          sale_order_id: saleOrderId || null,
          quantity_good: quantityGood,
          quantity_scrap: quantityScrap || 0,
          quantity_rework: quantityRework || 0,
          total_cost: totalCost,
          cost_per_unit: costPerUnit,
          inspection_status: inspectionStatus || 'approved',
          inspected_by: inspectedBy || '',
          inspected_at: new Date().toISOString(),
          received_by: inspectedBy || '',
          received_at: new Date().toISOString(),
          lot_number: lotNumber || '',
          notes: notes || '',
        } as any)
        .select()
        .single();
      if (error) throw error;

      // WIP → PA ledger entry. If this fails, compensate by deleting the FGR
      // so PA stock and WIP balance stay in sync (unbalanced books otherwise).
      const { error: ledErr } = await supabase.from('wip_ledger').insert({
        order_id: orderId,
        sale_order_id: saleOrderId || null,
        entry_type: 'fg_out',
        description: `Recebimento PA ${(fgr as any).receipt_number} - ${quantityGood} pares aprovados`,
        debit_account: 'Estoque Produto Acabado',
        credit_account: 'WIP - Produção em Curso',
        amount: totalCost,
        quantity: quantityGood,
      } as any);
      if (ledErr) {
        await supabase.from('finished_goods_receipts').delete().eq('id', (fgr as any).id);
        throw new Error(`Falha ao registrar WIP ledger: ${ledErr.message}. Recebimento revertido.`);
      }

      return fgr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finished_goods_receipts'] });
      qc.invalidateQueries({ queryKey: ['wip_ledger'] });
      toast.success('Produto acabado recebido e WIP transferido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
