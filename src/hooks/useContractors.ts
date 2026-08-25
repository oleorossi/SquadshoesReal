import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { isOsCancelled, isOsDone, isValidOsTransition, normalizeOsStatus } from '@/lib/osStatusMachine';
import { stripSearchNorm } from '@/lib/searchUtils';
import { receiveServiceOrderFully } from '@/lib/serviceOrderStock';
import { isStrapServiceOrder } from '@/lib/strapServiceOrderIdentity';
import { isMissingPostgrestRelation } from '@/lib/postgrestErrors';
import { narrowPostgrestClient } from '@/lib/narrowPostgrestClient';

type ContractorInsert = Database['public']['Tables']['contractors']['Insert'];
type ContractorUpdate = Database['public']['Tables']['contractors']['Update'];
type ServiceOrderInsert = Database['public']['Tables']['service_orders']['Insert'];
type ServiceOrderUpdate = Database['public']['Tables']['service_orders']['Update'];

interface StrapServiceOrderIdRow {
  id: string | null;
}

interface StrapServiceOrderOperationalIdRow {
  service_order_id: string | null;
}

const schemaGapSupabase = narrowPostgrestClient(supabase);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

export interface Contractor {
  id: string;
  name: string;
  trade_name: string;
  cnpj_cpf: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  service_type: string;
  notes: string;
  active: boolean;
  payment_days: number;
  created_at: string;
  updated_at: string;
}

export interface MaterialSent {
  material: string;
  color: string;
  meters: number;
  completed?: boolean;
}

export interface ServiceOrderMaterialRequirementItem {
  product_id?: string | null;
  product_name?: string | null;
  material: string;
  color?: string | null;
  quantity: number;
  required?: number;
  unit: string;
  component?: string | null;
  source?: string | null;
  warning?: string | null;
  warnings?: string[] | null;
}

/** Snapshot principal persistido pelo servidor. Arrays antigos são normalizados
 * para este envelope na leitura; aliases de item ficam a cargo da impressão. */
export interface ServiceOrderMaterialRequirements {
  version: number;
  calculated_at?: string | null;
  basis?: string | Record<string, unknown> | null;
  order_quantity?: number | null;
  service_quantity?: number | null;
  generated_for_quantity?: number | null;
  scale?: number | null;
  components?: string[] | null;
  warnings?: string[] | null;
  items: ServiceOrderMaterialRequirementItem[];
}

const normalizeServiceOrderMaterialRequirements = (value: unknown): ServiceOrderMaterialRequirements => {
  if (Array.isArray(value)) return { version: 1, items: value as ServiceOrderMaterialRequirementItem[] };
  if (!value || typeof value !== 'object') return { version: 1, items: [] };
  const snapshot = value as Partial<ServiceOrderMaterialRequirements>;
  return {
    ...snapshot,
    version: Number(snapshot.version) || 1,
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
  };
};

export interface ServiceOrder {
  id: string;
  contractor_id: string;
  order_number: string;
  description: string;
  service_date: string;
  service_time: string;
  quantity: number;
  unit_price: number;
  total_value: number;
  status: string;
  notes: string;
  material_name: string;
  material_meters: number;
  material_color: string;
  materials_sent: MaterialSent[];
  receipt_number: string;
  receipt_generated_at: string | null;
  signed_photo_url: string | null;
  sale_order_id: string | null;
  service_order_domain?: 'generic' | 'strap' | null;
  // Array com todos os PVs vinculados (preenchido pelo upsert_open_service_order
  // quando uma OS é agregada de múltiplos PVs). Primary sale_order_id pode
  // ficar null em agregações — usar o primeiro do array como fallback.
  linked_sale_order_ids?: string[] | null;
  // Identidade legada/canônica usada somente para excluir Tiras deste dataset.
  artisanal_recipe_id?: string | null;
  /** Identidade operacional canônica detectada nas linhas da OS. */
  is_canonical_strap?: boolean;
  artisanal_output_name?: string | null;
  artisanal_output_color?: string | null;
  artisanal_output_meters?: number;
  artisanal_for_order_meters?: number;
  artisanal_for_stock_meters?: number;
  artisanal_base_color?: string | null;
  artisanal_stock_entry_done?: boolean;
  // Fluxo de gargalos → OS terceirizada (migration 20260513210000):
  // pending_quote = OS criada do /gargalos, aguardando contratada responder.
  // quoted = prazo confirmado, OP desbloqueia pra Montagem.
  target_sector?: string | null;
  bottleneck_week?: string | null;
  order_id?: string | null;
  related_order_id?: string | null;
  quoted_at?: string | null;
  quoted_deadline?: string | null;
  // Data real de entrega (ação rápida "Marcar como Entregue") — coluna criada
  // pela migration 20260722180000_service-orders-delivered-at.
  delivered_at?: string | null;
  // Terceirização integrada (gerada automaticamente a partir de um PV): vínculo
  // com o pedido de venda de origem. Diferente do legacy sale_order_id, não passa
  // por nenhum gating de produção — é só rastreabilidade/financeiro.
  source_sale_order_id?: string | null;
  source_sale_order_item_id?: string | null;
  source_terceirizacao_id?: string | null;
  source_item_key?: string | null;
  /** Snapshots de capacidade/prazo usados quando a OS foi gerada. */
  provider_capacity_pairs_per_day?: number | null;
  return_before_sector?: string | null;
  planning_anchor_sector?: string | null;
  execution_days?: number | null;
  queue_days?: number | null;
  planning_source?: string | null;
  planning_warning?: string | null;
  /** Materiais calculados; não confundir com `materials_sent` (remessa física). */
  material_requirements?: ServiceOrderMaterialRequirements | null;
  /** Presença distingue o contêiner consolidado por linhas de uma OS física
   * avulsa com rastreamento no cabeçalho. */
  service_order_items?: Array<{ id: string }> | null;
  /**
   * Itens do PV que esta OS cobre (migration 20261103120000). Delas derivam as
   * ORDENS DE PRODUÇÃO da OS, resolvidas na leitura via `orders.sale_order_item_id`
   * — ver `src/lib/serviceOrderOps.ts`.
   *
   * `null`/ausente = OS sem registro (anterior à migration ou criada fora do
   * atalho "Gerar OS" do PV) → os consumidores caem em todas as OPs do pedido.
   * Array vazio é diferente: é uma seleção vazia gravada de propósito.
   */
  selected_sale_order_item_ids?: string[] | null;
  payment_due_date?: string | null;
  is_avulsa?: boolean | null;
  canonical_strap_recipe_id?: string | null;
  /** OS dividida entre prestadores — paga por RECEBIMENTO, não pelo fluxo normal. */
  dispatch_tracked?: boolean | null;
  /** Soft-archive da triagem de OS órfãs (P0.3, 2026-07). Preenchida = fora das listas default. */
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  contractors?: Contractor;
}

export function useContractors() {
  return useQuery({
    queryKey: ['contractors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Contractor[];
    },
  });
}

export function useServiceOrders() {
  return useQuery({
    queryKey: ['service_orders'],
    queryFn: async () => {
      // Paginação em blocos: o PostgREST corta em ~1000 linhas sem range e o
      // volume de OS cresce ~300/mês — sem isso as OS antigas sumiam em silêncio
      // da lista/planejamento (auditoria 2026-07-02).
      const PAGE = 1000;
      const all: ServiceOrder[] = [];
      for (let from = 0; ; from += PAGE) {
        // ⚠ PERF (2026-07-26): o embed era `contractors(*)` — a linha COMPLETA do
        // prestador (endereço, documentos, dados bancários, campos de busca…)
        // repetida uma vez por OS. Com ~380 OS pra 6 prestadores, o mesmo registro
        // vinha centenas de vezes e sozinho dominava os 748 kB da resposta. Um grep
        // no repo inteiro mostra que só identificação e prazo financeiro são
        // lidos do embed.
        const { data, error } = await schemaGapSupabase
          .from<ServiceOrder>('service_orders')
          .select('*, contractors(id, name, trade_name, payment_days), service_order_items(id)')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      const canonicalIds = new Set<string>();
      const loadCanonicalIds = async (source: 'domain-view' | 'operational-fallback') => {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = source === 'domain-view'
            ? await schemaGapSupabase
              .from<StrapServiceOrderIdRow>('v_strap_service_orders')
              .select('id')
              .order('id', { ascending: true })
              .range(from, from + PAGE - 1)
            : await schemaGapSupabase
              .from<StrapServiceOrderOperationalIdRow>('v_strap_service_order_items_operational')
              .select('service_order_id')
              .order('service_order_id', { ascending: true })
              .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          data.forEach((row) => {
            const id = 'id' in row ? row.id : row.service_order_id;
            if (id) canonicalIds.add(id);
          });
          if (data.length < PAGE) break;
        }
      };
      try {
        await loadCanonicalIds('domain-view');
      } catch (error: unknown) {
        if (!isMissingPostgrestRelation(error, 'v_strap_service_orders')) throw error;
        // Compatibilidade de rollout: essa view operacional já existia antes
        // da fronteira positiva v_strap_service_orders criada pela migration 099.
        await loadCanonicalIds('operational-fallback');
      }
      return all
        .map(o => ({
          ...o,
          materials_sent: Array.isArray(o.materials_sent) ? o.materials_sent : [],
          material_requirements: normalizeServiceOrderMaterialRequirements(o.material_requirements),
          ...(canonicalIds.has(o.id) ? { is_canonical_strap: true } : {}),
        }))
        // Tiras possui operação, estoque, custódia e financeiro próprios. A
        // relação interna continua em service_orders, mas nunca reaparece no
        // dataset do menu genérico Terceirizados.
        .filter(o => !isStrapServiceOrder(o));
    },
    // Sem staleTime próprio herdava os 60s globais e, com refetchOnMount ligado,
    // re-baixava a lista paginada inteira a cada volta pra tela. As mutations de OS
    // já invalidam ['service_orders'], então a correção por tempo é redundante.
    staleTime: 5 * 60 * 1000,
  });
}

/** Visão geral por OS (view v_service_order_overview): pagamento (AP) + saldo de
 *  recebimento parcial. Devolve um Map keyed por service_order_id pra merge O(1)
 *  na lista de OS sem mexer no query principal (useServiceOrders). */
export interface ServiceOrderOverview {
  service_order_id: string;
  accounts_payable_id: string | null;
  payment_status: string | null; // 'pending' | 'paid' | null (sem AP)
  payable_amount: number | null;
  /** Saldo ainda devido, já descontando pagamentos parciais. */
  payable_open_amount?: number | null;
  payment_due_date: string | null;
  payment_date: string | null;
  has_payable: boolean;
  is_paid: boolean;
  qty_sent: number | null;
  qty_returned_good: number | null;
  qty_returned_defect: number | null;
  qty_loss: number | null;
  qty_in_field: number | null;
  /** Despacho bruto real; em OS legada inclui o envio inicial implícito. */
  qty_dispatched?: number | null;
  /** Saldo que ainda pode ser remetido (inclui crédito de retrabalho). */
  qty_to_dispatch?: number | null;
  /** Defeito que ainda pode voltar ao prestador (não sucateado). */
  qty_defect_pending_rework?: number | null;
  /** Perda + sucata: o que a OS não entrega sem reposição de material. */
  qty_short?: number | null;
  /** Quantidade de títulos financeiros ativos ligados à OS/retornos. */
  payable_count?: number | null;
  /** Anomalia operacional calculada pelo read model novo. */
  workflow_issue?: 'missing_rate' | 'missing_payable' | string | null;
  last_return_at: string | null;
}

export function useServiceOrderOverview() {
  return useQuery({
    queryKey: ['service_order_overview'],
    queryFn: async () => {
      // A view cresce junto com as OS. Um select sem range para silenciosamente
      // em ~1.000 linhas no PostgREST e fazia lista e saldos cobrirem universos
      // diferentes.
      const PAGE = 1000;
      const loadView = async (source: 'operational' | 'legacy') => {
        const rows: ServiceOrderOverview[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = source === 'operational'
            ? await schemaGapSupabase
              .from<ServiceOrderOverview>('v_service_order_operational')
              .select('*')
              .order('service_order_id', { ascending: true })
              .range(from, from + PAGE - 1)
            : await schemaGapSupabase
              .from<ServiceOrderOverview>('v_service_order_overview')
              .select('*')
              .order('service_order_id', { ascending: true })
              .range(from, from + PAGE - 1);
          if (error) throw error;
          const page = data ?? [];
          rows.push(...page);
          if (page.length < PAGE) break;
        }
        return rows;
      };

      let rows: ServiceOrderOverview[];
      try {
        rows = await loadView('operational');
      } catch (error: unknown) {
        // Durante os poucos segundos entre o deploy do frontend e a migration,
        // preserva a leitura antiga. Outros erros continuam visíveis.
        const details = error && typeof error === 'object'
          ? error as { code?: string; message?: string }
          : {};
        const missingView = ['42P01', 'PGRST205'].includes(details.code || '')
          || /v_service_order_operational.*(does not exist|schema cache)/i.test(details.message || '');
        if (!missingView) throw error;
        rows = await loadView('legacy');
      }
      const map = new Map<string, ServiceOrderOverview>();
      for (const row of rows) {
        map.set(row.service_order_id, row);
      }
      return map;
    },
  });
}

/** Ativar/inativar prestador muda a prontidão da ficha, a prévia do wizard e
 * os diagnósticos, não apenas a lista de prestadores. */
function invalidateContractorPlanningCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['contractors'] });
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes'] });
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes_active'] });
  qc.invalidateQueries({ queryKey: ['pv_outsourceable_lines'] });
  qc.invalidateQueries({ queryKey: ['service_order_generation_gaps'] });
}

export function useCreateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractor: Partial<Contractor>) => {
      const payload = stripSearchNorm(contractor) as unknown as ContractorInsert;
      const { data, error } = await supabase.from('contractors').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidateContractorPlanningCaches(qc); toast.success('Terceirizado cadastrado!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

export function useUpdateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Contractor> & { id: string }) => {
      const payload = stripSearchNorm(updates) as ContractorUpdate;
      const { error } = await supabase.from('contractors').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidateContractorPlanningCaches(qc); toast.success('Terceirizado atualizado!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

export function useDeleteContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: refuse delete if linked service_orders exist.
      // The FK is ON DELETE CASCADE which would silently wipe all OSes,
      // bypassing the artisanal-stock-entry protection in useDeleteServiceOrder.
      const { count, error: countErr } = await supabase
        .from('service_orders')
        .select('id', { count: 'exact', head: true })
        .eq('contractor_id', id);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        throw new Error(
          `Não é possível excluir: há ${count} ${count === 1 ? 'OS vinculada' : 'OSs vinculadas'}. Inative o prestador em vez de excluir.`,
        );
      }
      const { error } = await supabase.from('contractors').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidateContractorPlanningCaches(qc); toast.success('Terceirizado removido!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

export function useCreateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: Partial<ServiceOrder>) => {
      if (order.unit_price !== undefined && (!Number.isFinite(Number(order.unit_price)) || Number(order.unit_price) < 0)) throw new Error('Preço unitário deve ser um número não-negativo.');
      if (order.quantity !== undefined && (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0)) throw new Error('Quantidade deve ser um número positivo.');
      const payload = stripSearchNorm(order) as unknown as ServiceOrderInsert;
      const { data, error } = await supabase.from('service_orders').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['pv_service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço criada!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

/** Tarifa vigente (R$/par) de uma contratada para um setor — pré-preenche o preço
 *  da OS manual. Lê a linha de `contractor_service_rates` sem `valid_to` (a atual).
 *  queryKey começa em 'contractor_rate' → ContractorRatesDialog invalida ao cadastrar. */
export function useContractorSectorRate(contractorId: string | null | undefined, sector: string | null | undefined) {
  return useQuery({
    queryKey: ['contractor_rate', contractorId ?? null, sector ?? null],
    enabled: !!contractorId && !!sector,
    staleTime: 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('contractor_service_rates')
        .select('price_per_pair')
        .eq('contractor_id', contractorId)
        .eq('sector', sector)
        .is('valid_to', null)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.price_per_pair) : null;
    },
  });
}

/**
 * Fronteira runtime do formulário de OS. O objeto exibido na tela também carrega
 * embeds e campos derivados; enviá-lo inteiro faz o PostgREST tratar esses nomes
 * como colunas e rejeitar o PATCH. Campos de planejamento, identidade e snapshots
 * permanecem exclusivamente sob controle dos writers do banco.
 */
export function sanitizeServiceOrderUpdate(
  updates: Partial<ServiceOrder>,
): ServiceOrderUpdate {
  const safe: ServiceOrderUpdate = {};
  if (updates.contractor_id !== undefined) safe.contractor_id = updates.contractor_id;
  if (updates.description !== undefined) safe.description = updates.description;
  if (updates.service_date !== undefined) safe.service_date = updates.service_date;
  if (updates.service_time !== undefined) safe.service_time = updates.service_time;
  if (updates.quantity !== undefined) safe.quantity = updates.quantity;
  if (updates.unit_price !== undefined) safe.unit_price = updates.unit_price;
  if (updates.total_value !== undefined) safe.total_value = updates.total_value;
  if (updates.status !== undefined) safe.status = updates.status;
  if (updates.notes !== undefined) safe.notes = updates.notes;
  if (updates.material_name !== undefined) safe.material_name = updates.material_name;
  if (updates.material_meters !== undefined) safe.material_meters = updates.material_meters;
  if (updates.material_color !== undefined) safe.material_color = updates.material_color;
  if (updates.materials_sent !== undefined) {
    safe.materials_sent = updates.materials_sent.map((material) => ({
      material: material.material,
      color: material.color,
      meters: material.meters,
      ...(material.completed !== undefined ? { completed: material.completed } : {}),
    }));
  }
  if (updates.sale_order_id !== undefined) safe.sale_order_id = updates.sale_order_id;
  if (updates.selected_sale_order_item_ids !== undefined) {
    safe.selected_sale_order_item_ids = updates.selected_sale_order_item_ids;
  }
  if (updates.target_sector !== undefined) safe.target_sector = updates.target_sector;
  if (updates.signed_photo_url !== undefined) safe.signed_photo_url = updates.signed_photo_url;
  return safe;
}

export function useUpdateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ServiceOrder> & { id: string }) => {
      const safe = sanitizeServiceOrderUpdate(updates);
      if (safe.status === '') throw new Error('Status inválido.');
      // Estados terminais preservam o histórico físico. Reativação de uma OS
      // cancelada, quando legítima, passa exclusivamente pelo writer integrado
      // que valida a origem e decide entre reusar ou emitir uma nova linha.
      if (safe.status) {
        const { data: current, error: currErr } = await supabase
          .from('service_orders').select('status, unit_price, total_value').eq('id', id).single();
        if (currErr) throw new Error(`Falha ao carregar OS: ${currErr.message}`);
        const terminal = isOsDone(current?.status) || isOsCancelled(current?.status);
        const statusChanged = normalizeOsStatus(safe.status) !== normalizeOsStatus(current?.status);
        if (statusChanged && !isValidOsTransition(current?.status, safe.status)) {
          throw new Error('Transição de status inválida. O fluxo da OS não pode voltar para uma etapa anterior.');
        }
        if (terminal && statusChanged) {
          throw new Error('O status final da OS é imutável. Emita uma nova OS para refazer o serviço.');
        }
        if (isOsDone(current?.status)) {
          // Editar valor de OS finalizada dessincroniza a conta a pagar (o trigger
          // só sincroniza AP 'pending'; se já foi paga, o valor pago diverge).
          const priceChanged =
            (safe.unit_price !== undefined && Math.abs(Number(safe.unit_price) - Number(current?.unit_price ?? 0)) > 0.005) ||
            (safe.total_value !== undefined && Math.abs(Number(safe.total_value) - Number(current?.total_value ?? 0)) > 0.005);
          if (priceChanged) throw new Error('OS já finalizada — emita uma nova OS para alterar valores (editar agora dessincronizaria a conta a pagar).');
        }
      }
      // Atomic claim when transitioning to Concluído: prevent double AP/stock debit
      // if two browser tabs save simultaneously from a stale 'Pendente' cache.
      let q = supabase.from('service_orders').update(safe).eq('id', id);
      if (safe.status === 'Concluído') {
        q = q.not('status', 'in', '("Concluído","Cancelado")');
      }
      const { data: rows, error } = await q.select('id');
      if (error) throw error;
      if (safe.status === 'Concluído' && (!rows || rows.length === 0)) {
        throw new Error('OS já concluída ou cancelada — recarregue a página.');
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['pv_service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço atualizada!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

export function useDeleteServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: os, error: fetchErr } = await supabase
        .from('service_orders')
        .select('artisanal_stock_entry_done, status, materials_sent')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (os?.artisanal_stock_entry_done) {
        throw new Error(
          'Não é possível excluir uma OS com saída já lançada. ' +
          'O estoque debitado não seria restaurado. Cancele a OS manualmente se necessário.'
        );
      }
      // #10: Bloqueia exclusão quando há histórico de envio/retorno (pares na rua):
      // o FK ON DELETE CASCADE apagaria o ledger de dispatches/returns em silêncio,
      // perdendo a rastreabilidade dos pares em campo. Oriente a cancelar.
      const [dispRes, retRes] = await Promise.all([
        supabase.from('service_order_dispatches').select('id', { count: 'exact', head: true }).eq('service_order_id', id),
        supabase.from('service_order_returns').select('id', { count: 'exact', head: true }).eq('service_order_id', id),
      ]);
      if (dispRes.error) throw new Error(`Falha ao verificar envios da OS: ${dispRes.error.message}`);
      if (retRes.error) throw new Error(`Falha ao verificar retornos da OS: ${retRes.error.message}`);
      if ((dispRes.count || 0) > 0 || (retRes.count || 0) > 0) {
        throw new Error(
          'Não é possível excluir: esta OS tem envios/retornos registrados (pares na rua). ' +
          'Cancele a OS em vez de excluir para preservar o histórico.'
        );
      }
      // #8: Bloqueia exclusão quando há materiais debitados e a OS não foi cancelada
      // (a exclusão não restitui o estoque). Cancele primeiro — o cancelamento estorna
      // os materiais — e então exclua.
      const materialsSent = Array.isArray(os?.materials_sent) ? os.materials_sent : [];
      const hasDebitedMaterials = materialsSent.some((material) => {
        if (!material || typeof material !== 'object' || Array.isArray(material)) return false;
        return Number(material.meters) > 0;
      });
      if (hasDebitedMaterials && os?.status !== 'Cancelado') {
        throw new Error(
          'Não é possível excluir: esta OS tem materiais debitados do estoque. ' +
          'Cancele a OS primeiro (o cancelamento estorna os materiais) e depois exclua.'
        );
      }
      // Block deletion if there's an active AP linked to this service order.
      // Deleting would orphan the financial record.
      // CRITICAL: capture the error. A silent SELECT failure (RLS / network) yielded
      // existingAP===null, bypassing the guard and leaving an orphan AP after the OS delete.
      const { data: existingAP, error: apErr } = await supabase
        .from('accounts_payable')
        .select('id')
        .eq('reference_type', 'service_order')
        .eq('reference_id', id)
        .neq('status', 'cancelled')
        .limit(1);
      if (apErr) throw new Error(`Falha ao verificar conta a pagar vinculada: ${apErr.message}`);
      if (existingAP && existingAP.length > 0) {
        throw new Error(
          'Não é possível excluir: existe uma conta a pagar vinculada a esta OS. ' +
          'Cancele a conta a pagar antes de excluir a OS.'
        );
      }
      const { error } = await supabase.from('service_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['pv_service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço removida!'); },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
}

/**
 * Compatibilidade com OS legadas: recebimento TOTAL em lote insere um retorno
 * com o saldo implícito de cada OS selecionada. OS novas usam despacho rastreado
 * e passam obrigatoriamente pela conferência individual:
 * tg_apply_service_order_return → status 'Concluído' → tg_create_ap_for_service_order
 * → conta a pagar pelos pares bons (com guarda FÁBRICA payment_days≥999 e
 * anti-duplicata). Perda/defeito usa o ServiceOrderReturnDialog individual —
 * o lote assume retorno 100% bom (caso comum da triagem).
 * OS divididas (dispatch_tracked) são puladas: exigem retorno por prestador.
 */
export function useBulkReceiveServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orders: Array<Pick<ServiceOrder, 'id' | 'order_number' | 'quantity' | 'dispatch_tracked'>>) => {
      let ok = 0;
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const o of orders) {
        try {
          if (o.dispatch_tracked) { skipped.push(o.order_number); continue; }
          // Mesmo caminho único dos recebimentos individuais (registra retorno,
          // triggers fecham a OS e pagam por pares bons).
          const { skipped: noBalance } = await receiveServiceOrderFully(o.id, {
            fallbackQuantity: Number(o.quantity ?? 0),
          });
          if (noBalance) { skipped.push(o.order_number); continue; }
          ok++;
        } catch (error: unknown) {
          console.error('Receber em lote falhou na OS', o.order_number, error);
          failed.push(o.order_number);
        }
      }
      return { ok, skipped, failed };
    },
    onSuccess: ({ ok, skipped, failed }) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['pv_service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_history_orders'] });
      const parts = [`${ok} OS recebida(s) — conta a pagar gerada pelos pares bons.`];
      if (skipped.length > 0) parts.push(`${skipped.length} pulada(s) (dividida ou sem saldo): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);
      if (failed.length > 0) parts.push(`falhou em: ${failed.join(', ')}`);
      (failed.length > 0 ? toast.warning : toast.success)(parts.join(' '));
    },
    onError: (error: unknown) => toast.error(`Falha no recebimento em lote: ${errorMessage(error)}`),
  });
}

/**
 * P0.3 (2026-07): arquiva OS da triagem (soft-archive via archived_at — NÃO é um
 * status: grafia desconhecida normalizaria pra Pendente em osStatusMachine).
 * Some das listagens default; histórico preservado; reversível via SQL.
 */
export function useArchiveServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('service_orders')
        .update({ archived_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n: number) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['pv_service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      toast.success(`${n} OS arquivada(s) — use "Mostrar arquivadas" pra revê-las.`);
    },
    onError: (error: unknown) => toast.error(`Falha ao arquivar: ${errorMessage(error)}`),
  });
}
