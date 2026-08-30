import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  rankServiceOrderCandidates,
  type QueuePullFilter,
} from '@/lib/serviceOrderStageQueue';

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
  /** Configuração da ficha usada pelo servidor para calcular esta prévia. */
  default_terceirizacao_id?: string | null;
  /** Capacidade do prestador padrão; informativa — o servidor recalcula ao gerar. */
  capacity_pairs_per_day?: number | null;
  /** Setor interno que depende do retorno deste serviço. */
  return_before_sector?: string | null;
  /** Etapa efetivamente encontrada no cronograma quando a rota pula a anterior. */
  planning_anchor_sector?: string | null;
  /** Componentes canônicos do motor que devem acompanhar a terceirização. */
  material_components?: string[] | null;
  execution_days?: number | null;
  queue_days?: number | null;
  /** Nome atual do RPC; `total_lead_days` fica aceito durante o rollout. */
  lead_days?: number | null;
  total_lead_days?: number | null;
  recommended_send_date?: string | null;
  required_return_date?: string | null;
  planning_source?: string | null;
  planning_warning?: string | null;
  /** Configuração completa da ficha usada para autorizar a geração planejada. */
  planning_config_ready?: boolean;
  planning_config_issue?: string | null;
  already_has_os: boolean;
  existing_os_status: string | null;
  /** Filtro que puxou esta linha na fila (prazo / estoque). */
  queue_pull?: QueuePullFilter;
}

function decorateOutsourceableLines(rows: OutsourceableLine[]): OutsourceableLine[] {
  return rankServiceOrderCandidates(rows.map((line) => ({
    id: `${line.order_id}::${line.sector}`,
    sector: line.sector,
    billingDate: line.required_return_date || line.recommended_send_date,
    source: line,
  }))).map((item) => ({
    ...item.source,
    queue_pull: item.pull,
  }));
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
      return decorateOutsourceableLines((data || []) as OutsourceableLine[]);
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
  /** Fail-closed: callers precisam declarar se usam o plano da ficha ou a
   * contingência manual legada. O assistente normal sempre envia `true`. */
  require_planning_config: boolean;
}

export interface GenerateOsResultLine {
  order_id: string;
  sector: string;
  action: 'created' | 'reactivated' | 'exists' | 'op_not_in_pv' | 'invalid_line';
  os_id?: string;
  reason?: string;
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
      qc.invalidateQueries({ queryKey: ['pv_service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['service_order_generation_gaps'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['pv_outsourceable_lines'] });
    },
  });
}

export interface ServiceOrderGenerationGap {
  order_id: string;
  op_number: string;
  sale_order_id: string;
  pv_number: string;
  sector: string;
  contractor_id: string;
  contractor_name: string;
  reason: string;
}

/** Intenção gravada no PV cuja OP existe, mas a OS não nasceu. */
export function useServiceOrderGenerationGaps() {
  return useQuery({
    queryKey: ['service_order_generation_gaps'],
    queryFn: async () => {
      // RPC adicionada pela migration do ciclo de OS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('list_service_order_generation_gaps');
      if (error) throw error;
      return (data || []) as ServiceOrderGenerationGap[];
    },
    staleTime: 30_000,
  });
}

/** Reprocessa uma lacuna pelo mesmo escritor canônico OP × setor. */
export function useRetryServiceOrderGenerationGap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (gap: ServiceOrderGenerationGap) => {
      // RPC adicionada pela migration do ciclo de OS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('send_item_sector_os', {
        p_order_id: gap.order_id,
        p_sector: gap.sector,
        p_contractor_id: gap.contractor_id,
      });
      if (error) throw error;
      return data as { action: string; os_id?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_order_generation_gaps'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['pv_service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['pv_outsourceable_lines'] });
      toast.success('OS pendente gerada pelo fluxo canônico.');
    },
    onError: (error: unknown) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Não foi possível gerar a OS pendente.';
      toast.error(message);
    },
  });
}
