import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { AtelierOpenRate } from '@/lib/atelierAdmin';
import { describePostgrestError } from '@/lib/postgrestErrors';
import type { AtelierOrderJobHit } from '@/lib/atelierOrderSupplement';
import { printAtelierShipment } from '@/lib/printAtelierShipment';
import type {
  AtelierExecutionMode,
  AtelierPipelineStatus,
  AtelierSector,
} from '@/lib/atelier';

export const atelierKeys = {
  all: ['atelier'] as const,
  catalog: (sector?: string | null) =>
    [...atelierKeys.all, 'catalog', sector ?? 'all'] as const,
  settings: () => [...atelierKeys.all, 'settings'] as const,
  prepDebits: (saleOrderIds: string[]) =>
    [...atelierKeys.all, 'prep-debits', [...saleOrderIds].sort().join(',')] as const,
  sheetsLite: () => [...atelierKeys.all, 'sheets-lite'] as const,
  reference: (referenceId: string) => [...atelierKeys.all, 'reference', referenceId] as const,
  lots: () => [...atelierKeys.all, 'lots'] as const,
  orderJobs: (orderNumber: string) =>
    [...atelierKeys.all, 'order-jobs', orderNumber] as const,
  kitCandidates: (referenceId: string, sector: string) =>
    [...atelierKeys.all, 'kit-candidates', referenceId, sector] as const,
  contractorSectors: () => [...atelierKeys.all, 'contractor-sectors'] as const,
};

export interface AtelierReferenceSectorRow {
  id: string;
  reference_id: string;
  sector: AtelierSector;
  active: boolean;
  value_per_pair: number | null;
  material_components: string[] | null;
  kit_product_ids: string[] | null;
  kit_group_ids: string[] | null;
  default_execution_mode?: AtelierExecutionMode | null;
  default_contractor_id?: string | null;
  updated_at: string | null;
}

/** Cadastro do Ateliê de UMA referência (ativas e inativas) — aba da ficha. */
export function useAtelierReferenceConfig(referenceId: string | null | undefined) {
  return useQuery({
    queryKey: atelierKeys.reference(referenceId ?? ''),
    enabled: !!referenceId,
    queryFn: async () => {
      // select('*'): valor por par e kit só existem após a migration da Fase 1
      // (Ateliê v2). Sem elas, a aba segue lendo/gravando o setor normalmente.
      const { data, error } = await supabase
        .from('atelier_complex_references' as never)
        .select('*')
        .eq('reference_id', referenceId as string);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Partial<AtelierReferenceSectorRow>[];
      let hasKitColumns = rows.length > 0 && 'value_per_pair' in rows[0];
      if (rows.length === 0) {
        const probe = await supabase
          .from('atelier_complex_references' as never)
          .select('value_per_pair')
          .limit(1);
        hasKitColumns = !probe.error;
      }
      return {
        rows: rows.map((r) => ({
          ...r,
          value_per_pair: r.value_per_pair ?? null,
          material_components: r.material_components ?? null,
          kit_product_ids: (r as { kit_product_ids?: string[] | null }).kit_product_ids ?? null,
          kit_group_ids: (r as { kit_group_ids?: string[] | null }).kit_group_ids ?? null,
          default_execution_mode: (r as { default_execution_mode?: AtelierExecutionMode | null }).default_execution_mode ?? null,
          default_contractor_id: (r as { default_contractor_id?: string | null }).default_contractor_id ?? null,
        })) as AtelierReferenceSectorRow[],
        hasKitColumns,
      };
    },
  });
}

export function useSaveAtelierReferenceSector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      referenceId: string;
      sector: AtelierSector;
      active: boolean;
      valuePerPair?: number | null;
      materialComponents?: string[] | null;
      kitProductIds?: string[] | null;
      kitGroupIds?: string[] | null;
    }) => {
      const payload: Record<string, unknown> = {
        reference_id: input.referenceId,
        sector: input.sector,
        active: input.active,
      };
      if (input.valuePerPair !== undefined) payload.value_per_pair = input.valuePerPair;
      if (input.materialComponents !== undefined) payload.material_components = input.materialComponents;
      if (input.kitProductIds !== undefined) payload.kit_product_ids = input.kitProductIds;
      if (input.kitGroupIds !== undefined) payload.kit_group_ids = input.kitGroupIds;
      // Costura on ⇒ Corte on (espelha o gatilho SQL).
      if (input.sector === 'costura_cabedal' && input.active) {
        const cortePayload = {
          reference_id: input.referenceId,
          sector: 'corte_cabedal',
          active: true,
        };
        const { error: corteErr } = await supabase
          .from('atelier_complex_references' as never)
          .upsert(cortePayload as never, { onConflict: 'reference_id,sector' });
        if (corteErr) throw corteErr;
      }
      const { error } = await supabase
        .from('atelier_complex_references' as never)
        .upsert(payload as never, { onConflict: 'reference_id,sector' });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      if (
        input.valuePerPair === undefined
        && input.materialComponents === undefined
        && input.kitProductIds === undefined
        && input.kitGroupIds === undefined
      ) {
        toast.success(input.active ? 'Referência enviada ao Ateliê' : 'Referência tirada do Ateliê');
      }
    },
    // A recusa do cadastro vem do gatilho no banco com o motivo em português.
    onError: (e: Error) => toast.error(e.message || 'Não foi possível salvar o Ateliê'),
  });
}

export interface AtelierKitCandidate {
  group_id: string;
  group_name: string;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  component: string;
  quantity_per_unit: number | null;
  sector: string | null;
}

/** Componentes reais da ficha elegíveis pro kit do setor. */
export function useAtelierSheetKitCandidates(
  referenceId: string | null | undefined,
  sector: AtelierSector | null | undefined,
) {
  return useQuery({
    queryKey: atelierKeys.kitCandidates(referenceId ?? '', sector ?? ''),
    enabled: !!referenceId && !!sector,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'atelier_sheet_kit_candidates' as never,
        { p_reference_id: referenceId, p_sector: sector } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as AtelierKitCandidate[];
    },
    staleTime: 30_000,
  });
}

export interface AtelierSentKitLine {
  product_id?: string;
  product_name?: string;
  unit?: string | null;
  component?: string | null;
  quantity?: number;
  required_qty?: number;
  pending_qty?: number;
}

export interface AtelierLotJob {
  id: string;
  sector: AtelierSector;
  pipeline_status: AtelierPipelineStatus;
  pairs: number;
  sale_order_item_id: string | null;
  /** Pedido da demanda. A fila casa o ?pedido= com este número. */
  sale_order_id?: string | null;
  order_number: string;
  contractor_id: string | null;
  contractor_name: string | null;
  atelier_service_number: string | null;
  target_end: string | null;
  execution_mode: AtelierExecutionMode | null;
  /** OS da remessa. Impressão lê este id. */
  service_order_id?: string | null;
  /** Pares já conferidos (soma dos lançamentos não estornados). */
  received_pairs?: number | null;
  /** Congelado no envio — qtds debitadas no corte para a OS. */
  sent_kit_lines?: AtelierSentKitLine[] | null;
}

export type AtelierKitGate = 'awaiting_components' | 'ready_to_send' | null;

export interface AtelierLotRow {
  id: string;
  lot_number: string;
  status: 'open' | 'cut' | 'cancelled';
  /** Após corte: aguardando componentes ou pronto para envio. */
  kit_gate?: AtelierKitGate;
  /** Kit debitado e pronto para o clique de envio. Não envia sozinho. */
  dispatch_signal?: string | null;
  /** atelier_lot_kit_is_closed. O botão Enviar só aparece quando é true. */
  kit_closed?: boolean | null;
  /** Lote criado para um pedido só. O agrupamento automático não o reabsorve. */
  manual_split?: boolean | null;
  reference_id: string;
  reference_code: string | null;
  reference_name: string | null;
  color: string | null;
  cut_at: string | null;
  pairs: number;
  /** Data recuada pela agenda do Ateliê — quando o lote tem que VOLTAR do prestador. */
  min_ready_date: string | null;
  /**
   * Prazo de entrega mais próximo entre os PVs do lote (mig `20270101039000`).
   *
   * É o MÍNIMO, não "o prazo do pedido": o lote é `referência × cor` e atravessa
   * vários PVs. Não confundir com `min_ready_date`, que é outra data e governa o
   * envio ao prestador, não a urgência comercial.
   */
  min_delivery_deadline: string | null;
  grade: Record<string, number>;
  kit_product_ids?: string[];
  orders: {
    sale_order_id: string;
    order_number: string;
    client_name: string | null;
    billing_week: string | null;
    delivery_deadline: string | null;
    /** Pares DESTE pedido no lote — `pairs` do lote é a soma de todos os PVs. */
    pairs: number;
    atelier_execution_mode?: AtelierExecutionMode | null;
  }[];
  jobs: AtelierLotJob[];
  debits: {
    product_id: string;
    product_name: string;
    unit: string | null;
    component: string | null;
    required_qty: number;
    quantity: number;
    pending_qty: number;
  }[];
}

/** Lotes do Ateliê (fila + aba da ficha). Refresh de kit_gate quando o estoque entra. */
export function useAtelierLots() {
  return useQuery({
    queryKey: atelierKeys.lots(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'list_atelier_lots_with_gate_refresh' as never,
      );
      if (error) {
        // Fallback se a migration ainda não aplicou o wrapper.
        const fallback = await supabase.rpc('list_atelier_lots' as never);
        if (fallback.error) throw error;
        return (fallback.data ?? []) as unknown as AtelierLotRow[];
      }
      return ((data ?? []) as unknown as AtelierLotRow[]);
    },
    staleTime: 15_000,
  });
}

/**
 * Jobs do PV da URL, lidos na tabela. A lista agregada às vezes não
 * traz o cartão mesmo com sale_order_id certo. Só leitura.
 */
export function useAtelierOrderJobs(orderNumber: string) {
  const number = orderNumber.trim();
  return useQuery({
    queryKey: atelierKeys.orderJobs(number),
    enabled: number.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<AtelierOrderJobHit[]> => {
      const { data: orders, error: orderError } = await supabase
        .from('sale_orders')
        .select('id, order_number')
        .eq('order_number', number)
        .limit(5);
      if (orderError) throw orderError;
      const rows = orders ?? [];
      const ids = rows.map((order) => order.id).filter(Boolean);
      if (ids.length === 0) return [];
      const { data: jobs, error: jobError } = await supabase
        .from('cabedal_prep_jobs' as never)
        .select('id, sector, pipeline_status, pairs, color, reference_code, execution_mode, contractor_id, sale_order_id, sale_order_item_id, lot_id, target_end, atelier_service_number, received_pairs, service_order_id')
        .in('sale_order_id', ids)
        .neq('pipeline_status', 'cancelled');
      if (jobError) throw jobError;
      const numberById = new Map(rows.map((order) => [order.id, order.order_number]));
      return ((jobs ?? []) as unknown as AtelierOrderJobHit[]).map((job) => ({
        id: job.id,
        sector: job.sector,
        pipeline_status: job.pipeline_status,
        pairs: Number(job.pairs) || 0,
        color: job.color,
        reference_code: job.reference_code,
        execution_mode: job.execution_mode,
        contractor_id: job.contractor_id,
        sale_order_id: job.sale_order_id,
        sale_order_item_id: job.sale_order_item_id,
        lot_id: job.lot_id,
        target_end: job.target_end,
        atelier_service_number: job.atelier_service_number,
        received_pairs: job.received_pairs,
        service_order_id: job.service_order_id,
        order_number: numberById.get(job.sale_order_id) ?? number,
      }));
    },
  });
}

export interface AtelierSettings {
  costura_offset_days: number;
  aviamento_offset_days: number;
  /** Dias de calendário antes do início da semana de faturamento (default 7). */
  ready_before_billing_days: number;
  updated_at?: string | null;
}

export interface AtelierCatalogRow {
  id: string;
  reference_id: string;
  sector: AtelierSector;
  active: boolean;
  notes: string | null;
  default_execution_mode?: AtelierExecutionMode | null;
  default_contractor_id?: string | null;
  prep_business_days?: number | null;
  created_at: string;
  technical_sheets?: {
    id: string;
    code: string | null;
    model: string | null;
    name: string | null;
  } | null;
}

export interface AtelierPrepDebitRow {
  id: string;
  sale_order_id: string;
  sale_order_item_id: string | null;
  product_id: string;
  quantity: number;
  sector: string | null;
  job_id: string | null;
  created_at: string;
  lot_id?: string | null;
  pending_qty?: number | null;
  component?: string | null;
  products?: { id: string; name: string; unit: string | null } | null;
  cabedal_prep_jobs?: {
    id: string;
    pipeline_status: AtelierPipelineStatus;
    sector: string;
    atelier_service_number: string | null;
    reference_code: string | null;
    color: string | null;
  } | null;
}

export function useAtelierCatalog(sector?: AtelierSector | null) {
  return useQuery({
    queryKey: atelierKeys.catalog(sector),
    queryFn: async () => {
      let q = supabase
        .from('atelier_complex_references' as never)
        .select(
          'id, reference_id, sector, active, notes, created_at, default_execution_mode, default_contractor_id, prep_business_days, technical_sheets(id, code, model, name)',
        )
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (sector) q = q.eq('sector', sector);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AtelierCatalogRow[];
    },
  });
}

export function useTechnicalSheetsLiteForAtelier() {
  return useQuery({
    queryKey: atelierKeys.sheetsLite(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, code, model, name')
        .order('code')
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useAddAtelierReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { referenceId: string; sector: AtelierSector; notes?: string }) => {
      const { data, error } = await supabase
        .from('atelier_complex_references' as never)
        .upsert(
          {
            reference_id: input.referenceId,
            sector: input.sector,
            active: true,
            notes: input.notes ?? null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'reference_id,sector' },
        )
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Referência adicionada ao Ateliê');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao adicionar'),
  });
}

export function useSetAtelierPrepDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; prepBusinessDays: number | null }) => {
      const { error } = await supabase
        .from('atelier_complex_references' as never)
        .update({
          prep_business_days: input.prepBusinessDays,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Preparo do cabedal atualizado');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao salvar o preparo'),
  });
}

export function useRemoveAtelierReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('atelier_complex_references' as never)
        .update({ active: false, updated_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Referência removida do Ateliê');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao remover'),
  });
}

export interface AtelierLotCutResult {
  lot_number?: string;
  items?: number;
  pending_lines?: number;
  kit_gate?: string;
  skipped?: boolean;
}

/** Confirma o corte do LOTE: debita só Cabedal (napa). COMPONENTES na liberação. */
export async function confirmAtelierLotCut(lotId: string): Promise<AtelierLotCutResult | null> {
  const { data, error } = await supabase.rpc(
    'atelier_confirm_lot_cut' as never,
    { p_lot_id: lotId } as never,
  );
  if (error) throw error;
  return data as AtelierLotCutResult | null;
}

export async function confirmAtelierLotRelease(lotId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_confirm_lot_release' as never,
    { p_lot_id: lotId } as never,
  );
  if (error) throw error;
  return data as { lot_number?: string; lines?: number; kit_gate?: string } | null;
}

export async function markAtelierJobSent(input: { jobId: string; contractorId?: string | null }) {
  const { data, error } = await supabase.rpc(
    'atelier_mark_job_sent' as never,
    {
      p_job_id: input.jobId,
      p_contractor_id: input.contractorId ?? null,
    } as never,
  );
  if (error) throw error;
  return data as {
    atelier_service_number?: string;
    kit_lines?: AtelierSentKitLine[];
    service_order_id?: string;
    order_number?: string;
  } | null;
}

export async function sendAtelierSplit(input: {
  jobId: string;
  parts: Array<{
    mode: 'contractor' | 'internal';
    contractor_id: string | null;
    grade: Record<string, number>;
    unit_price: number | null;
    save_reference_rate: boolean;
  }>;
}) {
  const { data, error } = await supabase.rpc(
    'atelier_send_split' as never,
    { p_job_id: input.jobId, p_parts: input.parts } as never,
  );
  if (error) throw error;
  return data as { service_order_ids?: string[]; remaining_pairs?: number } | null;
}

export async function sendAtelierRemessa(input: {
  lotId: string;
  sector: string;
  contractorId: string | null;
  grade: Record<string, number>;
  unitPrice: number | null;
  internal?: boolean;
}) {
  const { data, error } = await supabase.rpc(
    'atelier_send_remessa' as never,
    {
      p_lot_id: input.lotId,
      p_sector: input.sector,
      p_contractor_id: input.internal ? null : input.contractorId,
      p_grade: input.grade,
      p_unit_price: input.unitPrice,
      p_internal: !!input.internal,
    } as never,
  );
  if (error) throw error;
  return data as {
    service_order_id?: string;
    order_number?: string;
    reused?: boolean;
    part_ids?: string[];
    unit_price?: number;
  } | null;
}

export async function closeAtelierShipments(serviceOrderId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_close_shipments' as never,
    { p_service_order_id: serviceOrderId } as never,
  );
  if (error) throw error;
  return data as { concluded?: boolean } | null;
}

export async function sendAtelierShipment(input: { jobIds: string[]; contractorId: string }) {
  const { data, error } = await supabase.rpc(
    'atelier_send_shipment' as never,
    {
      p_job_ids: input.jobIds,
      p_contractor_id: input.contractorId,
    } as never,
  );
  if (error) throw error;
  return data as {
    service_order_id?: string;
    order_number?: string;
    jobs?: number;
  } | null;
}

export async function markAtelierJobRealized(jobId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_mark_job_realized' as never,
    { p_job_id: jobId } as never,
  );
  if (error) throw error;
  return data;
}

export interface AtelierJobReceipt {
  id: string;
  job_id: string;
  pairs: number;
  qty_defect?: number | null;
  qty_loss?: number | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  rework_resolution_id?: string | null;
}

export async function registerAtelierJobReceipt(input: {
  jobId: string;
  pairs: number;
  defect?: number;
  loss?: number;
  note?: string | null;
  partId?: string | null;
  reworkPairs?: number;
}) {
  const { data, error } = await supabase.rpc(
    'register_atelier_job_receipt' as never,
    {
      p_job_id: input.jobId,
      p_pairs: input.pairs,
      p_note: input.note ?? null,
      p_defect: input.defect ?? 0,
      p_loss: input.loss ?? 0,
      p_part_id: input.partId ?? null,
      p_rework_pairs: input.reworkPairs ?? 0,
    } as never,
  );
  if (error) throw error;
  return data as { ok?: boolean; received_pairs?: number; pairs?: number } | null;
}

export async function reverseAtelierJobReceipt(input: { receiptId: string; reason: string }) {
  const { data, error } = await supabase.rpc(
    'reverse_atelier_job_receipt' as never,
    { p_receipt_id: input.receiptId, p_reason: input.reason } as never,
  );
  if (error) throw error;
  return data as { ok?: boolean; received_pairs?: number } | null;
}

export function useAtelierJobReceipts(jobId: string | null) {
  return useQuery({
    queryKey: [...atelierKeys.all, 'receipts', jobId ?? ''] as const,
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('atelier_job_receipts' as never)
        .select('id, job_id, pairs, qty_defect, qty_loss, note, created_at, created_by, reversed_at, reversal_reason, rework_resolution_id')
        .eq('job_id', jobId as never)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AtelierJobReceipt[];
    },
  });
}

export async function markAtelierJobReceived(jobId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_mark_job_received' as never,
    { p_job_id: jobId } as never,
  );
  if (error) throw error;
  return data;
}

export async function markAtelierJobInternalStart(jobId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_mark_job_internal_start' as never,
    { p_job_id: jobId } as never,
  );
  if (error) throw error;
  return data;
}

export async function markAtelierJobInternalDone(jobId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_mark_job_internal_done' as never,
    { p_job_id: jobId } as never,
  );
  if (error) throw error;
  return data;
}

/** Confirma o corte do LOTE: debita só Cabedal (napa). COMPONENTES na liberação. */
export function useConfirmAtelierLotCut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmAtelierLotCut,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      const pend = data?.pending_lines ?? 0;
      const gate = data?.kit_gate;
      if (gate === 'awaiting_components') {
        toast.success(
          `${data?.lot_number ?? 'Lote'} cortado (napa) · aguardando componentes/tiras em estoque`,
        );
      } else if (pend > 0) {
        toast.warning(
          `${data?.lot_number ?? 'Lote'} cortado · ${pend} material(is) com falta de napa`,
        );
      } else {
        toast.success(`${data?.lot_number ?? 'Lote'} cortado · napa debitada · pronto para envio`);
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao confirmar o corte'),
  });
}

/** Debita COMPONENTES/tiras do kit e libera o lote para envio. */
export function useConfirmAtelierLotRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmAtelierLotRelease,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success(`${data?.lot_number ?? 'Lote'} · kit liberado para envio`);
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao liberar o kit'),
  });
}

export interface AtelierKitLine {
  product_id: string;
  product_name: string;
  unit: string | null;
  component: string;
  required: number;
  available: number;
}

/** Prévia do corte (só Cabedal / napa). */
export function useAtelierLotKitPreview(lotId: string | null) {
  return useQuery({
    queryKey: [...atelierKeys.all, 'kit', lotId ?? ''] as const,
    enabled: !!lotId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'atelier_lot_kit_preview' as never,
        { p_lot_id: lotId } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as AtelierKitLine[];
    },
  });
}

/** Prévia da liberação (COMPONENTES + Tiras). */
export function useAtelierLotReleasePreview(lotId: string | null) {
  return useQuery({
    queryKey: [...atelierKeys.all, 'release-kit', lotId ?? ''] as const,
    enabled: !!lotId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'atelier_lot_release_lines' as never,
        { p_lot_id: lotId } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as AtelierKitLine[];
    },
  });
}

export function useMarkAtelierSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAtelierJobSent,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      const lines = data?.kit_lines ?? [];
      const kitSummary =
        lines.length > 0
          ? ` · ${lines
              .map((l) => `${l.product_name ?? '?'} ${Number(l.quantity) || 0}${l.unit ? ` ${l.unit}` : ''}`)
              .join(', ')}`
          : '';
      const label = data?.order_number
        ? `Remessa ${data.order_number}${kitSummary}`
        : data?.atelier_service_number
          ? `Enviado ${data.atelier_service_number}${kitSummary}`
          : `Enviado ao prestador${kitSummary}`;
      toast.success(label, data?.service_order_id ? {
        action: {
          label: 'Imprimir',
          onClick: () => { void printAtelierShipment(data.service_order_id as string); },
        },
      } : undefined);
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar envio'),
  });
}

export function useSendAtelierShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendAtelierShipment,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      const label = data?.order_number
        ? `Remessa ${data.order_number}`
        : 'Remessa enviada';
      toast.success(label, data?.service_order_id ? {
        action: {
          label: 'Imprimir',
          onClick: () => { void printAtelierShipment(data.service_order_id as string); },
        },
      } : undefined);
    },
    onError: (error: unknown) => toast.error(describePostgrestError(error, 'Falha ao enviar a remessa')),
  });
}

export function useMarkAtelierRealized() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAtelierJobRealized,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Marcado como realizado pelo prestador');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar realizado'),
  });
}

export function useMarkAtelierReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAtelierJobReceived,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Recebido e conferido na fábrica');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar recebimento'),
  });
}

export async function setAtelierJobExecutionMode(input: {
  jobId: string;
  mode: AtelierExecutionMode;
  contractorId?: string | null;
}) {
  const { data, error } = await supabase.rpc(
    'atelier_set_job_execution_mode' as never,
    {
      p_job_id: input.jobId,
      p_mode: input.mode,
      p_contractor_id: input.contractorId ?? null,
    } as never,
  );
  if (error) throw error;
  return data as { execution_mode?: string } | null;
}

export async function splitAtelierJobToOwnLot(jobId: string) {
  const { data, error } = await supabase.rpc(
    'atelier_split_job_to_own_lot' as never,
    { p_job_id: jobId } as never,
  );
  if (error) throw error;
  return data as { ok?: boolean; already_own_lot?: boolean; lot_number?: string } | null;
}

export function useSplitAtelierJobToOwnLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: splitAtelierJobToOwnLot,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      const number = data?.lot_number ? ` ${data.lot_number}` : '';
      toast.success(data?.already_own_lot
        ? `Este pedido já está no lote próprio${number}`
        : `Pedido separado no lote próprio${number}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Não foi possível separar o lote'),
  });
}

export function useSetAtelierJobExecutionMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setAtelierJobExecutionMode,
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success(input.mode === 'internal' ? 'Modo: interno' : 'Modo: prestador');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao definir o modo'),
  });
}

export function useMarkAtelierInternalStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAtelierJobInternalStart,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Em realização na fábrica');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao iniciar realização'),
  });
}

export function useMarkAtelierInternalDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAtelierJobInternalDone,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Concluído — libera a OP deste setor');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao concluir'),
  });
}

export function useAtelierOpenRates() {
  return useQuery({
    queryKey: [...atelierKeys.all, 'open-rates'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_service_rates')
        .select('contractor_id, sector, price_per_pair, valid_from, valid_to')
        .is('valid_to', null);
      if (error) throw error;
      return (data ?? []) as AtelierOpenRate[];
    },
    staleTime: 30_000,
  });
}

export function useAtelierSettings() {
  return useQuery({
    queryKey: atelierKeys.settings(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('atelier_settings' as never)
        .select('costura_offset_days, aviamento_offset_days, ready_before_billing_days, updated_at')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return {
          costura_offset_days: 5,
          aviamento_offset_days: 5,
          ready_before_billing_days: 7,
          updated_at: null,
        } satisfies AtelierSettings;
      }
      const row = data as unknown as Partial<AtelierSettings>;
      return {
        costura_offset_days: row.costura_offset_days ?? 5,
        aviamento_offset_days: row.aviamento_offset_days ?? 5,
        ready_before_billing_days: row.ready_before_billing_days ?? 7,
        updated_at: row.updated_at ?? null,
      } satisfies AtelierSettings;
    },
    staleTime: 30_000,
  });
}

export function useUpdateAtelierSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      costuraOffsetDays?: number | null;
      aviamentoOffsetDays?: number | null;
      readyBeforeBillingDays?: number | null;
    }) => {
      const { data, error } = await supabase.rpc(
        'atelier_update_settings' as never,
        {
          p_costura_offset_days: input.costuraOffsetDays ?? null,
          p_aviamento_offset_days: input.aviamentoOffsetDays ?? null,
          p_ready_before_billing_days: input.readyBeforeBillingDays ?? null,
        } as never,
      );
      if (error) throw error;
      return data as AtelierSettings & { ok?: boolean };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.settings() });
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Agenda do Ateliê atualizada');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao salvar agenda'),
  });
}

export function useReapplyAtelierEligibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('reapply_atelier_eligibility' as never);
      if (error) throw error;
      return data as { cancelled_demands?: number; sale_orders_touched?: number };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      void qc.invalidateQueries({ queryKey: ['cabedal-prep'] });
      toast.success(
        `Ateliê reaplicado · ${data?.cancelled_demands ?? 0} fora · ${data?.sale_orders_touched ?? 0} PVs`,
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao reaplicar'),
  });
}

/** Débitos do Ateliê (corte do lote) — para o bloco Consumo do PV. */
export function useAtelierPrepConsumption(saleOrderIds: string[]) {
  const ids = saleOrderIds.filter(Boolean);
  return useQuery({
    queryKey: atelierKeys.prepDebits(ids),
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cabedal_prep_stock_debits' as never)
        .select(
          `id, sale_order_id, sale_order_item_id, product_id, quantity, sector, job_id, created_at,
           lot_id, pending_qty, component,
           products(id, name, unit),
           cabedal_prep_jobs(id, pipeline_status, sector, atelier_service_number, reference_code, color)`,
        )
        .in('sale_order_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as AtelierPrepDebitRow[];
      // Só o que saiu de fato: corte do lote (Ateliê v2) ou job legado já debitado.
      return rows.filter((r) => {
        if (r.lot_id) return true;
        const st = r.cabedal_prep_jobs?.pipeline_status;
        return (
          st === 'cut' ||
          st === 'sent_to_contractor' ||
          st === 'realized' ||
          st === 'received_at_factory' ||
          st === 'in_progress' ||
          st === 'done'
        );
      });
    },
  });
}

export interface AtelierContractorSectorRecord {
  id: string;
  contractor_id: string;
  sector: AtelierSector;
  capacity_pairs_per_day: number | null;
  active: boolean;
}

export function useAtelierContractorSectors() {
  return useQuery({
    queryKey: atelierKeys.contractorSectors(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('atelier_contractor_sectors' as never)
        .select('id, contractor_id, sector, capacity_pairs_per_day, active');
      if (error) throw error;
      return (data ?? []) as unknown as AtelierContractorSectorRecord[];
    },
    staleTime: 15_000,
  });
}

export function useUpsertAtelierContractorSector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contractorId: string;
      sector: AtelierSector;
      capacity: number | null;
      active: boolean;
    }) => {
      const { error } = await supabase.rpc(
        'atelier_upsert_contractor_sector' as never,
        {
          p_contractor_id: input.contractorId,
          p_sector: input.sector,
          p_capacity: input.capacity,
          p_active: input.active,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.contractorSectors() });
    },
    onError: (e: Error) => toast.error(e.message || 'Não foi possível salvar o prestador'),
  });
}

export function useSetAtelierReferenceDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      referenceId: string;
      sector: AtelierSector;
      mode: AtelierExecutionMode | null;
      contractorId?: string | null;
    }) => {
      const { error } = await supabase.rpc(
        'atelier_set_reference_execution_default' as never,
        {
          p_reference_id: input.referenceId,
          p_sector: input.sector,
          p_mode: input.mode,
          p_contractor_id: input.contractorId ?? null,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Padrão da ficha salvo');
    },
    onError: (e: Error) => toast.error(e.message || 'Não foi possível salvar o padrão'),
  });
}
