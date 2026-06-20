import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Terceirizações cadastradas na ficha técnica de uma referência (technical_sheets).
 * Cada entrada = prestador (contractor) + descrição do serviço + valor POR PAR.
 *
 * Selecionáveis (opcionais) item-a-item na criação do pedido de venda. Ao salvar
 * o PV, o RPC sync_sale_order_service_orders gera/atualiza as Ordens de Serviço.
 *
 * `(supabase as any)`: a tabela reference_terceirizacoes ainda não está no
 * types.ts gerado (regenerar depois) — segue o mesmo padrão de contractor_service_rates.
 */
export interface ReferenceTerceirizacao {
  id: string;
  reference_id: string;
  contractor_id: string;
  description: string;
  value_per_pair: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  contractors?: { id: string; name: string; trade_name: string | null } | null;
}

export interface ReferenceTerceirizacaoInput {
  reference_id: string;
  contractor_id: string;
  description: string;
  value_per_pair: number;
  active?: boolean;
}

const SELECT = '*, contractors(id, name, trade_name)';

export function useReferenceTerceirizacoes(referenceId: string | null) {
  return useQuery({
    queryKey: ['reference_terceirizacoes', referenceId],
    enabled: !!referenceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select(SELECT)
        .eq('reference_id', referenceId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ReferenceTerceirizacao[];
    },
  });
}

/** Só as ativas — usada na seção de terceirização do item do PV. */
export function useActiveReferenceTerceirizacoes(referenceId: string | null) {
  return useQuery({
    queryKey: ['reference_terceirizacoes_active', referenceId],
    enabled: !!referenceId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select(SELECT)
        .eq('reference_id', referenceId!)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ReferenceTerceirizacao[];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes'] });
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes_active'] });
}

export function useCreateReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReferenceTerceirizacaoInput) => {
      if (!input.reference_id) throw new Error('Referência obrigatória.');
      if (!input.contractor_id) throw new Error('Selecione a contratada/prestador.');
      if (!input.description.trim()) throw new Error('Informe a descrição do serviço.');
      if (!Number.isFinite(input.value_per_pair) || input.value_per_pair <= 0) {
        throw new Error('Valor por par deve ser maior que zero.');
      }
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .insert({
          reference_id: input.reference_id,
          contractor_id: input.contractor_id,
          description: input.description.trim(),
          value_per_pair: input.value_per_pair,
          active: input.active ?? true,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização adicionada à ficha.'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ReferenceTerceirizacaoInput> & { id: string; active?: boolean }) => {
      if (updates.description !== undefined && !updates.description.trim()) {
        throw new Error('Informe a descrição do serviço.');
      }
      if (updates.value_per_pair !== undefined &&
          (!Number.isFinite(updates.value_per_pair) || updates.value_per_pair <= 0)) {
        throw new Error('Valor por par deve ser maior que zero.');
      }
      const payload: Record<string, unknown> = { ...updates };
      if (typeof payload.description === 'string') payload.description = payload.description.trim();
      const { error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização atualizada.'); },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Ordens de Serviço geradas pela terceirização integrada de um PV.
 * Usada no card "Terceirizações geradas" do detalhe do pedido.
 */
export interface PvServiceOrder {
  id: string;
  order_number: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_value: number | null;
  status: string | null;
  payment_due_date: string | null;
  contractor_id: string | null;
  source_terceirizacao_id: string | null;
  contractors?: { id: string; name: string; trade_name: string | null } | null;
}

export function usePvServiceOrders(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['pv_service_orders', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('id, order_number, description, quantity, unit_price, total_value, status, payment_due_date, contractor_id, source_terceirizacao_id, contractors(id, name, trade_name)')
        .eq('source_sale_order_id', saleOrderId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as PvServiceOrder[];
    },
  });
}

export function useDeleteReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização removida.'); },
    onError: (e: any) => toast.error(e.message),
  });
}
