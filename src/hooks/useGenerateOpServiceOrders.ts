import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Geração de OS de terceirização por Pedido → Serviço → OP.
 *
 * Fluxo: escolhe o PV, escolhe os serviços (setores) que vão pra rua e, em cada
 * serviço, marca as OPs enviadas. Gera UMA OS por (OP × setor) atrelada à OP
 * (`service_orders.order_id`), reusando o schema existente — a OS aparece no
 * quadro "Na Rua" e segue o fluxo de envio/retorno/pagamento normal.
 *
 * Backend: migration 20260703120000 (`get_pv_outsourceable_lines` +
 * `generate_op_service_orders`).
 */

export interface OutsourceableLine {
  order_id: string;
  op_number: string;
  reference_id: string;
  ref_code: string | null;
  ref_name: string | null;
  color: string | null;
  quantity: number;
  sector: string;
  sector_label: string;
  sector_status: string | null;
  default_contractor_id: string | null;
  default_contractor_name: string | null;
  default_rate: number | null;
  already_has_os: boolean;
  existing_os_status: string | null;
}

/** Linhas terceirizáveis de um PV, uma por (OP × setor). */
export function usePvOutsourceableLines(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['pv_outsourceable_lines', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_pv_outsourceable_lines', {
        p_sale_order_id: saleOrderId,
      });
      if (error) throw error;
      return (data || []) as OutsourceableLine[];
    },
    staleTime: 30_000,
  });
}

export interface GenerateOsLine {
  order_id: string;
  sector: string;
  contractor_id: string;
  unit_price: number;
  quantity: number;
  quoted_deadline?: string | null;
}

export interface GenerateOsResultLine {
  order_id: string;
  sector: string;
  action: 'created' | 'reactivated' | 'exists' | 'op_not_in_pv' | 'invalid_line';
  os_id?: string;
}

const ERROR_LABELS: Record<string, string> = {
  sale_order_not_found: 'Pedido não encontrado.',
  sale_order_cancelled: 'Pedido cancelado — não dá pra gerar OS.',
};

export function useGenerateOpServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderId, lines }: { saleOrderId: string; lines: GenerateOsLine[] }) => {
      const { data, error } = await (supabase as any).rpc('generate_op_service_orders', {
        p_sale_order_id: saleOrderId,
        p_lines: lines,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(ERROR_LABELS[data.error] || data.error);
      return (data?.lines || []) as GenerateOsResultLine[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['pv_outsourceable_lines'] });
    },
  });
}

/** Tarifa vigente (contratada × setor) — pré-preenche o R$/par ao trocar de contratada. */
export async function fetchContractorRate(contractorId: string, sector: string): Promise<number | null> {
  const { data, error } = await (supabase as any).rpc('get_contractor_rate', {
    p_contractor_id: contractorId,
    p_sector: sector,
    p_date: new Date().toISOString().slice(0, 10),
  });
  if (error || data == null) return null;
  return Number(data);
}
