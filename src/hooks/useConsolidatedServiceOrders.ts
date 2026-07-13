// Hooks da OS consolidada por prestador (modelo contêiner + linhas).
// Lê service_orders (cabeçalho) + service_order_items (linhas, com PV/OP embutidos)
// e expõe as ações: enviar (por OS) e entregar (por linha). As tabelas/RPCs novos
// (mig 20260913120000) ainda não estão nos types gerados → casts `as any`.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeOsStatus, type OsStatus } from '@/lib/osStatusMachine';

const KEY = ['consolidated_service_orders'] as const;

export interface ConsolidatedOsLine {
  id: string;
  material_name: string;
  description: string;
  color: string | null;
  target_sector: string | null;
  sale_order_id: string | null;
  order_id: string | null;
  pv_number: string | null;
  op_number: string | null;
  quantity: number;
  unit: string;
  meters: number | null;
  unit_price: number;
  total_value: number;
  line_status: 'Pendente' | 'Entregue' | 'Cancelado' | string;
  delivered_at: string | null;
}

export interface ConsolidatedOs {
  id: string;
  order_number: string;
  contractor_id: string;
  contractor_name: string;
  status_raw: string;
  status: OsStatus;
  /** true quando a OS já saiu pro prestador (trava o acúmulo). */
  sent: boolean;
  total_value: number;
  total_meters: number;
  created_at: string;
  pv_numbers: string[];
  op_numbers: string[];
  line_count: number;
  delivered_count: number;
  lines: ConsolidatedOsLine[];
}

const SENT_RAW = new Set(['enviada', 'enviado', 'em andamento', 'em processamento', 'processando']);

export function useConsolidatedServiceOrders() {
  return useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<ConsolidatedOs[]> => {
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select(`
          id, order_number, contractor_id, status, total_value, created_at,
          contractors(name, trade_name),
          service_order_items(
            id, material_name, description, color, target_sector, sale_order_id, order_id,
            quantity, unit, meters, unit_price, total_value, line_status, delivered_at,
            sale_orders(order_number), orders(order_number)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) {
        // Enquanto a migration 20260913120000 (tabela service_order_items) não
        // estiver aplicada, o embed falha. Degrada pro estado vazio em vez de
        // ficar em erro/retry — a aba mostra "Nenhuma OS consolidada ainda".
        const code = String((error as any).code || '');
        const msg = String((error as any).message || '');
        if (code === 'PGRST200' || code === 'PGRST205' || code === '42P01'
          || /service_order_items|could not find|schema cache|does not exist|relationship/i.test(msg)) {
          return [];
        }
        throw error;
      }

      // Só os contêineres do NOVO modelo (que têm linhas). OS flat legadas ficam
      // na aba "Ordens de Serviço" antiga.
      const rows = ((data || []) as any[]).filter(o => Array.isArray(o.service_order_items) && o.service_order_items.length > 0);

      return rows.map((o): ConsolidatedOs => {
        const lines: ConsolidatedOsLine[] = (o.service_order_items as any[]).map(li => ({
          id: li.id,
          material_name: li.material_name ?? '',
          description: li.description ?? '',
          color: li.color ?? null,
          target_sector: li.target_sector ?? null,
          sale_order_id: li.sale_order_id ?? null,
          order_id: li.order_id ?? null,
          pv_number: li.sale_orders?.order_number ?? null,
          op_number: li.orders?.order_number ?? null,
          quantity: Number(li.quantity) || 0,
          unit: li.unit ?? 'par',
          meters: li.meters == null ? null : Number(li.meters),
          unit_price: Number(li.unit_price) || 0,
          total_value: Number(li.total_value) || 0,
          line_status: li.line_status ?? 'Pendente',
          delivered_at: li.delivered_at ?? null,
        }));
        const statusRaw: string = o.status ?? 'Pendente';
        const pvs = Array.from(new Set(lines.map(l => l.pv_number).filter(Boolean))) as string[];
        const ops = Array.from(new Set(lines.map(l => l.op_number).filter(Boolean))) as string[];
        return {
          id: o.id,
          order_number: o.order_number ?? '',
          contractor_id: o.contractor_id,
          contractor_name: o.contractors?.trade_name || o.contractors?.name || '—',
          status_raw: statusRaw,
          status: normalizeOsStatus(statusRaw),
          sent: SENT_RAW.has(statusRaw.trim().toLowerCase()),
          total_value: Number(o.total_value) || 0,
          total_meters: lines.filter(l => l.line_status !== 'Cancelado').reduce((s, l) => s + (l.meters || 0), 0),
          created_at: o.created_at,
          pv_numbers: pvs,
          op_numbers: ops,
          line_count: lines.filter(l => l.line_status !== 'Cancelado').length,
          delivered_count: lines.filter(l => l.line_status === 'Entregue').length,
          lines,
        };
      });
    },
  });
}

/** Enviar material: trava a OS (status → Enviada). Novas demandas abrem OS nova. */
export function useSendServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (osId: string) => {
      const { error } = await (supabase as any)
        .from('service_orders')
        .update({ status: 'Enviada', dispatch_tracked: true, updated_at: new Date().toISOString() })
        .eq('id', osId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success('Material enviado — OS travada. Novas demandas abrem uma OS nova.');
    },
    onError: (e: any) => toast.error(`Erro ao enviar: ${e.message}`),
  });
}

/** Entregar uma linha (entrega parcial). O trigger de rollup conclui a OS quando
 *  todas as linhas entregam. (Contas a pagar por linha = Fase 4, ainda manual.) */
export function useDeliverServiceOrderLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (line: { id: string; quantity: number }) => {
      const { error } = await (supabase as any)
        .from('service_order_items')
        .update({ line_status: 'Entregue', delivered_at: new Date().toISOString(), delivered_qty: line.quantity, updated_at: new Date().toISOString() })
        .eq('id', line.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success('Linha entregue.');
    },
    onError: (e: any) => toast.error(`Erro ao entregar: ${e.message}`),
  });
}

export interface AddServiceOrderLineArgs {
  contractorId: string;
  sourceItemKey: string;
  materialName: string;
  description?: string;
  saleOrderId?: string | null;
  orderId?: string | null;
  targetSector?: string | null;
  color?: string | null;
  quantity?: number;
  unit?: string;
  meters?: number | null;
  unitPrice?: number;
}

/** Insere/atualiza uma LINHA na OS aberta do prestador (find-or-create no SQL).
 *  Idempotente por sourceItemKey. Usado pelos fluxos de geração (tira/OP×setor/avulso). */
export async function addServiceOrderLine(a: AddServiceOrderLineArgs): Promise<{ service_order_id: string; line_id: string }> {
  const { data, error } = await (supabase as any).rpc('add_service_order_line', {
    p_contractor_id: a.contractorId,
    p_source_item_key: a.sourceItemKey,
    p_material_name: a.materialName,
    p_description: a.description ?? '',
    p_sale_order_id: a.saleOrderId ?? null,
    p_order_id: a.orderId ?? null,
    p_target_sector: a.targetSector ?? null,
    p_color: a.color ?? null,
    p_quantity: a.quantity ?? 0,
    p_unit: a.unit ?? 'par',
    p_meters: a.meters ?? null,
    p_unit_price: a.unitPrice ?? 0,
  });
  if (error) throw error;
  return data as { service_order_id: string; line_id: string };
}
