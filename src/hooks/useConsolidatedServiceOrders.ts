// Hooks da OS consolidada por prestador (modelo contêiner + linhas).
// Lê service_orders (cabeçalho) + service_order_items (linhas, com PV/OP embutidos)
// e expõe as ações: enviar (por OS) e entregar (por linha).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeOsStatus, OS_STATUS, type OsStatus } from '@/lib/osStatusMachine';
import { isStrapServiceOrder, type StrapServiceOrderIdentity } from '@/lib/strapServiceOrderIdentity';
import { narrowPostgrestClient } from '@/lib/narrowPostgrestClient';

const KEY = ['consolidated_service_orders'] as const;
const RELATED_QUERY_KEYS = [
  ['service_orders'],
  ['service_order_overview'],
  ['pv_service_orders'],
  ['v_contractor_metrics'],
  ['v_contractor_history_orders'],
  ['v_contractor_os_financials'],
] as const;

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

interface ConsolidatedQueryLine {
  id: string;
  material_name: string | null;
  description: string | null;
  color: string | null;
  target_sector: string | null;
  sale_order_id: string | null;
  order_id: string | null;
  quantity: number | null;
  unit: string | null;
  meters: number | null;
  unit_price: number | null;
  total_value: number | null;
  line_status: string | null;
  delivered_at: string | null;
  strap_variant_id: string | null;
  strap_recipe_id: string | null;
  strap_batch_item_id: string | null;
  sale_order_strap_demand_id: string | null;
  strap_stock_floor_contribution_id: string | null;
  sale_orders: { order_number: string | null } | null;
  orders: { order_number: string | null } | null;
}

interface ConsolidatedQueryRow extends StrapServiceOrderIdentity {
  id: string;
  order_number: string | null;
  contractor_id: string;
  status: string | null;
  total_value: number | null;
  created_at: string;
  contractors: { name: string | null; trade_name: string | null } | null;
  service_order_items: ConsolidatedQueryLine[];
}

interface ServiceOrderItemMutationRow {
  id: string;
}

const SENT_RAW = new Set(['enviada', 'enviado', 'em andamento', 'em processamento', 'processando']);
const schemaGapSupabase = narrowPostgrestClient(supabase);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

function isAddServiceOrderLineResult(
  value: unknown,
): value is { service_order_id: string; line_id: string } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.service_order_id === 'string' && typeof result.line_id === 'string';
}

export function useConsolidatedServiceOrders() {
  return useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<ConsolidatedOs[]> => {
      const { data, error } = await schemaGapSupabase
        .from<ConsolidatedQueryRow>('service_orders')
        .select(`
          id, order_number, contractor_id, status, total_value, created_at,
          artisanal_recipe_id, canonical_strap_recipe_id, artisanal_output_name,
          artisanal_output_color, artisanal_output_meters, artisanal_for_order_meters,
          artisanal_for_stock_meters, artisanal_base_color, artisanal_stock_entry_done,
          contractors(name, trade_name),
          service_order_items(
            id, material_name, description, color, target_sector, sale_order_id, order_id,
            quantity, unit, meters, unit_price, total_value, line_status, delivered_at,
            strap_variant_id, strap_recipe_id, strap_batch_item_id,
            sale_order_strap_demand_id, strap_stock_floor_contribution_id,
            sale_orders(order_number), orders(order_number)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      // Só os contêineres do NOVO modelo (que têm linhas). OS flat legadas ficam
      // na aba "Ordens de Serviço" antiga.
      const rows = (data || []).filter((o) => {
        if (!Array.isArray(o.service_order_items) || o.service_order_items.length === 0) return false;
        const hasCanonicalStrapLine = o.service_order_items.some((line) => (
          line.strap_variant_id || line.strap_recipe_id || line.strap_batch_item_id
          || line.sale_order_strap_demand_id || line.strap_stock_floor_contribution_id
        ));
        return !isStrapServiceOrder({ ...o, is_canonical_strap: hasCanonicalStrapLine });
      });

      return rows.map((o): ConsolidatedOs => {
        const lines: ConsolidatedOsLine[] = o.service_order_items.map(li => ({
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
      const { data: current, error: readError } = await supabase
        .from('service_orders')
        .select('status')
        .eq('id', osId)
        .single();
      if (readError) throw readError;
      if (normalizeOsStatus(current?.status) !== OS_STATUS.PENDENTE) {
        throw new Error('Somente uma OS pendente pode ser enviada. Uma OS final exige um novo cabeçalho.');
      }
      const { data, error } = await schemaGapSupabase
        .from<ConsolidatedQueryRow>('service_orders')
        .update({ status: 'Enviada', dispatch_tracked: true, updated_at: new Date().toISOString() })
        .eq('id', osId)
        .eq('status', current.status)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('A OS mudou enquanto era enviada. Recarregue e tente novamente.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      RELATED_QUERY_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success('Material enviado — OS travada. Novas demandas abrem uma OS nova.');
    },
    onError: (error: unknown) => toast.error(`Erro ao enviar: ${errorMessage(error)}`),
  });
}

/** Entregar uma linha (entrega parcial). O trigger de rollup conclui a OS quando
 *  todas as linhas entregam. (Contas a pagar por linha = Fase 4, ainda manual.) */
export function useDeliverServiceOrderLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (line: { id: string; quantity: number }) => {
      const { data, error } = await schemaGapSupabase
        .from<ServiceOrderItemMutationRow>('service_order_items')
        .update({ line_status: 'Entregue', delivered_at: new Date().toISOString(), delivered_qty: line.quantity, updated_at: new Date().toISOString() })
        .eq('id', line.id)
        .eq('line_status', 'Pendente')
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('A linha mudou enquanto era entregue. Recarregue e tente novamente.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      RELATED_QUERY_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success('Linha entregue.');
    },
    onError: (error: unknown) => toast.error(`Erro ao entregar: ${errorMessage(error)}`),
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
  const { data, error } = await schemaGapSupabase.rpc<unknown>('add_service_order_line', {
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
  if (!isAddServiceOrderLineResult(data)) {
    throw new Error('O servidor retornou um vínculo de OS inválido.');
  }
  return data;
}
