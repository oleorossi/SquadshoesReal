import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import { invalidateProductionCaches } from '@/hooks/useProductionTransitions';
import { shouldLoadOrderStages } from '@/lib/productionLoading';

// Default fallback stages when no BOM operations exist.
//
// Grafia CANÔNICA desde 2026-07-01 (migration 20260902120000): 'Aviamento',
// não mais 'Mesa'. O banco foi normalizado (0 rows 'Mesa'), resync_op_atomic
// também grava 'Aviamento', e a RPC apontar_producao_setor aceita o alias
// legado Mesa ⇄ Aviamento pra rows antigas que escaparem.
// ⚠ Costura virou DOIS setores paralelos em 2026-10-01 (migration
// 20261001120000): Costura Palmilha e Costura Cabedal. A ordem espelha
// `canonical_stage_order()` no banco — Aviamento saiu de 4 pra 5 e tudo
// depois dele deslocou uma casa. Não reordenar sem mudar a função SQL junto.
export const PRODUCTION_STAGES = [
  { name: 'Corte Fibra', order: 1 },
  { name: 'Corte Forração', order: 2 },
  { name: 'Costura Palmilha', order: 3 },
  { name: 'Costura Cabedal', order: 4 },
  { name: 'Aviamento', order: 5 },
  { name: 'Silk', order: 6 },
  { name: 'Colagem', order: 7 },
  { name: 'Montagem', order: 8 },
  { name: 'Solagem', order: 9 },
  { name: 'Acabamento', order: 10 },
  { name: 'Expedição', order: 11 },
] as const;

export type OrderStage = {
  id: string;
  order_id: string;
  stage_name: string;
  stage_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  quantity_processed: number;
  quantity_total: number;
  observations: string;
  defects: string;
  created_at: string;
  updated_at: string;
  // WIP cost tracking fields
  standard_time_minutes: number;
  cost_per_hour: number;
  actual_time_minutes: number;
  cost_per_pair: number;
};

type OrderStageCommand = 'create' | 'update' | 'delete';

interface StageCommandSnapshot {
  id: string;
  order_id: string;
  updated_at: string;
  status: string;
}

interface StageCommandRpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface StageCommandResponse extends Record<string, unknown> {
  ok?: boolean;
  error?: { message?: string };
}

interface ProductionPointingInput {
  orderId: string;
  stageName: string;
  quantity: number;
  operatorEmployeeId?: string | null;
  note?: string | null;
  finalize?: boolean;
  confirmedWarnings?: string[];
  /** Persistidos no próprio objeto de variables para retries do React Query e
   * para a segunda passagem após confirmação de warnings. */
  clientRequestId?: string;
  expectedStageUpdatedAt?: string;
}

async function readPointingStageSnapshot(
  orderId: string,
  stageName: string,
): Promise<StageCommandSnapshot> {
  const names = stageName === 'Aviamento'
    ? ['Aviamento', 'Mesa']
    : stageName === 'Mesa'
      ? ['Mesa', 'Aviamento']
      : [stageName];
  const { data, error } = await supabase
    .from('order_stages')
    .select('id, order_id, updated_at, status')
    .eq('order_id', orderId)
    .in('stage_name', names)
    .order('stage_order', { ascending: true })
    .limit(1)
    .single();
  if (error) throw error;
  return data as StageCommandSnapshot;
}

async function executeOrderStageCommand(input: {
  command: OrderStageCommand;
  orderId: string;
  stageId?: string | null;
  expectedUpdatedAt?: string | null;
  payload?: Record<string, unknown>;
}) {
  const requestId = crypto.randomUUID();
  const callRpc = supabase.rpc as unknown as (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<StageCommandRpcResult>;
  const { data, error } = await callRpc('execute_order_stage_command', {
    p_command: input.command,
    p_order_id: input.orderId,
    p_stage_id: input.stageId ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_client_request_id: requestId,
    p_payload: input.payload ?? {},
  });
  if (error) throw error;
  const response = data as StageCommandResponse | null;
  if (!response?.ok) {
    throw new Error(response?.error?.message || 'Comando de etapa recusado pelo servidor.');
  }
  return response;
}

async function resolveStageCommandSnapshot(
  qc: QueryClient,
  stageId: string,
): Promise<StageCommandSnapshot> {
  // O snapshot do cache é deliberadamente usado como expected version: se o
  // Realtime/refetch ainda não chegou, o CAS do banco recusa em vez de sobrescrever.
  for (const [, cached] of qc.getQueriesData<OrderStage[]>({ queryKey: ['order_stages'] })) {
    const stage = cached?.find(row => row.id === stageId);
    if (stage) return stage;
  }

  // Callers fora das telas de produção podem não ter a query montada. A leitura
  // só obtém o token CAS; toda escrita continua dentro do command.
  const { data, error } = await supabase
    .from('order_stages')
    .select('id, order_id, updated_at, status')
    .eq('id', stageId)
    .single();
  if (error) throw error;
  return data as StageCommandSnapshot;
}

export function useOrderStages(orderId?: string) {
  return useQuery({
    queryKey: ['order_stages', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_stages')
        .select('*')
        .eq('order_id', orderId!)
        .order('stage_order', { ascending: true });
      if (error) throw error;
      return data as OrderStage[];
    },
    enabled: !!orderId,
  });
}

export function useAllOrderStages(orderIds?: string[]) {
  return useQuery({
    // ⚠ CÓPIA antes do sort. `orderIds.sort()` ordena IN PLACE o array do caller —
    // no Kanban ele vem de `useMemo(() => queue.map(q => q.order_id))` e é o MESMO
    // array passado pra `useOrdersMaterialGate`, que chaveia o cache por `ids[0]`.
    // Reordenar aqui trocava o primeiro id do gate e invalidava o cache dele à toa.
    queryKey: ['order_stages', orderIds ? [...orderIds].sort().join(',') : 'all'],
    enabled: shouldLoadOrderStages(orderIds),
    queryFn: async () => {
      // If specific order IDs provided, fetch only those
      if (orderIds && orderIds.length > 0) {
        // Batch in chunks of 50 to avoid query size limits.
        // ⚠ PERF (2026-07-26): os chunks rodam em PARALELO. Antes era um `for` com
        // `await` dentro, então 263 OPs viravam 6 round-trips ESTRITAMENTE SERIAIS —
        // numa rede de fábrica com ~100ms de RTT isso é ~600ms de espera pura antes
        // da tela de OPs pintar. São requisições independentes; não há ordem a
        // preservar (o resultado é reordenado por stage_order dentro de cada chunk e
        // os consumidores agrupam por order_id).
        const CHUNK = 50;
        const chunks: string[][] = [];
        for (let i = 0; i < orderIds.length; i += CHUNK) {
          chunks.push(orderIds.slice(i, i + CHUNK));
        }
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const { data, error } = await supabase
              .from('order_stages')
              .select('id, order_id, stage_name, stage_order, status, started_at, completed_at, completed_by, quantity_processed, quantity_total, observations, defects, created_at, updated_at, standard_time_minutes, cost_per_hour, actual_time_minutes, cost_per_pair')
              .in('order_id', chunk)
              .order('stage_order', { ascending: true });
            if (error) throw error;
            return (data || []) as OrderStage[];
          }),
        );
        return results.flat();
      }

      // Fallback: fetch all with pagination
      const PAGE_SIZE = 1000;
      let allData: OrderStage[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('order_stages')
          .select('id, order_id, stage_name, stage_order, status, started_at, completed_at, completed_by, quantity_processed, quantity_total, observations, defects, created_at, updated_at, standard_time_minutes, cost_per_hour, actual_time_minutes, cost_per_pair')
          .order('stage_order', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allData = allData.concat(data as OrderStage[]);
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      return allData;
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Creates order stages from BOM operations when available,
 * falls back to default PRODUCTION_STAGES otherwise.
 */
export function useCreateOrderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, quantity, referenceId }: { orderId: string; quantity: number; referenceId?: string }) => {
      return executeOrderStageCommand({
        command: 'create',
        orderId,
        payload: {
          expected_quantity: quantity,
          expected_reference_id: referenceId ?? null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order_stages'] });
    },
    onError: (err: Error) => toast.error(`Erro ao criar etapas: ${err.message}`),
  });
}

export function useUpdateOrderStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: string;
      status?: string;
      started_at?: string | null;
      completed_at?: string | null;
      completed_by?: string | null;
      operator_employee_id?: string | null;
      quantity_processed?: number;
      observations?: string;
      defects?: string;
      actual_time_minutes?: number;
    }) => {
      if (
        payload.quantity_processed !== undefined ||
        payload.completed_at !== undefined ||
        payload.completed_by !== undefined ||
        payload.status === 'concluido'
      ) {
        throw new Error('Quantidade e conclusão devem ser registradas pelo apontamento de produção.');
      }

      const snapshot = await resolveStageCommandSnapshot(qc, payload.id);
      const commandPayload: Record<string, unknown> = {};
      if (payload.status !== undefined) commandPayload.status = payload.status;
      // started_at do caller é ignorado: o command usa o relógio do servidor.
      if (payload.operator_employee_id !== undefined) commandPayload.operator_employee_id = payload.operator_employee_id;
      if (payload.observations !== undefined) commandPayload.observations = payload.observations;
      if (payload.defects !== undefined) commandPayload.defects = payload.defects;
      if (payload.actual_time_minutes !== undefined) commandPayload.actual_time_minutes = payload.actual_time_minutes;

      return executeOrderStageCommand({
        command: 'update',
        orderId: snapshot.order_id,
        stageId: payload.id,
        expectedUpdatedAt: snapshot.updated_at,
        payload: commandPayload,
      });
    },
    onSuccess: () => {
      // Invalidação CENTRAL: apontar/atualizar etapa precisa refletir em
      // Setores, Quadro, Dashboard, Gargalos, Capacidade e Ondas — não só
      // na lista de estágios (gap da auditoria 2026-07-01).
      invalidateProductionCaches(qc);
      toast.success('Etapa atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteOrderStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stageId: string) => {
      const snapshot = await resolveStageCommandSnapshot(qc, stageId);
      return executeOrderStageCommand({
        command: 'delete',
        orderId: snapshot.order_id,
        stageId,
        expectedUpdatedAt: snapshot.updated_at,
      });
    },
    onSuccess: () => {
      invalidateProductionCaches(qc);
      toast.success('Etapa excluída!');
    },
    onError: (err: Error) => toast.error(`Erro ao excluir etapa: ${err.message}`),
  });
}

/**
 * Apontamento canônico de produção por setor
 * (RPC execute_production_pointing_command):
 * registra quantidade no ledger (production_pointings), acumula em
 * quantity_processed, inicia o setor se pendente (guard do DAG valida) e —
 * com finalize=true — conclui o setor e libera o próximo na mesma transação.
 *
 * `quantity` é o INCREMENTO (pares apontados agora), não o acumulado.
 * Negativo = correção/estorno. 0 = só iniciar/finalizar sem apontar.
 */
export interface PointingWarning {
  code: string;
  message: string;
  delivered?: number;
}

export interface ApontarResult {
  success: boolean;
  needs_confirmation?: boolean;
  warnings?: PointingWarning[];
  stage_name?: string;
  quantity_processed?: number;
  quantity_total?: number;
  finalized?: boolean;
}

export function useApontarProducao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: ProductionPointingInput) => {
      // Mutar `variables` aqui é intencional: React Query reutiliza o mesmo
      // objeto num retry e o diálogo reutiliza-o após o preflight de warnings.
      // Sem isso, resposta perdida poderia somar a quantidade novamente.
      p.clientRequestId ??= crypto.randomUUID();
      if (!p.expectedStageUpdatedAt) {
        const snapshot = await readPointingStageSnapshot(p.orderId, p.stageName);
        p.expectedStageUpdatedAt = snapshot.updated_at;
      }

      const callRpc = supabase.rpc as unknown as (
        functionName: string,
        args: Record<string, unknown>,
      ) => PromiseLike<StageCommandRpcResult>;
      const { data, error } = await callRpc('execute_production_pointing_command', {
        p_order_id: p.orderId,
        p_stage_name: p.stageName,
        p_quantity: p.quantity,
        p_operator_employee_id: p.operatorEmployeeId ?? null,
        p_note: p.note ?? null,
        p_finalize: p.finalize ?? false,
        p_confirmed_warnings: p.confirmedWarnings ?? null,
        p_expected_stage_updated_at: p.expectedStageUpdatedAt,
        p_client_request_id: p.clientRequestId,
      });
      if (error) throw error;
      return data as unknown as ApontarResult;
    },
    onSuccess: (data) => {
      // Sem gravação (aguardando confirmação) = nada a invalidar
      if ((data as ApontarResult | null)?.needs_confirmation) return;
      invalidateProductionCaches(qc);
    },
    onError: (err: Error) => toast.error(`Erro no apontamento: ${err.message}`),
  });
}

// Sufixo único por mount: dois componentes montados ao mesmo tempo (ex.: hub +
// tela de setor) não podem disputar o mesmo topic do canal realtime.
let realtimeChannelSeq = 0;

/**
 * Assinatura realtime de order_stages → invalidação CENTRAL debounced.
 * Montar uma vez por tela que exiba produção (o PCPHub já monta pra todas as
 * abas). Qualquer terminal que mover/apontar reflete aqui em ~1s, sem esperar
 * staleTime.
 */
export function useRealtimeOrderStages() {
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Já assinou uma vez? Distingue adesão inicial de REconexão. */
  const assinouRef = useRef(false);
  useEffect(() => {
    const channel = supabase
      .channel(`order-stages-realtime-${++realtimeChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_stages' }, () => {
        // Debounce: bulk finalize dispara N eventos em rajada — coalesce numa
        // única invalidação pra não refetchar ~20 queries N vezes.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => invalidateProductionCaches(qc), 400);
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] order-stages:', err?.message);
        // RE-SINCRONIZAR AO (RE)CONECTAR — não é redundante com a assinatura.
        //
        // Evento perdido é perdido: o Realtime não reentrega o que passou
        // enquanto o canal estava caído. Sem isto, uma queda de rede de 20s no
        // meio do turno deixava o quadro parado para SEMPRE (até alguém trocar
        // de tela), mostrando a fábrica de antes da queda com cara de quadro
        // vivo. Ao reassinar, buscamos o estado inteiro de novo.
        // ⚠ Só na REconexão. O callback também recebe SUBSCRIBED na adesão
        // inicial, e invalidar ali refazia ~25 queries logo depois do
        // carregamento — toda tela de produção buscava tudo duas vezes.
        if (status === 'SUBSCRIBED') {
          if (assinouRef.current) invalidateProductionCaches(qc);
          assinouRef.current = true;
        }
      });
    // Aba volta do sono / máquina reconecta: o canal pode ter morrido em
    // silêncio. O `online` do browser é o gatilho mais confiável que existe
    // sem inventar heartbeat próprio.
    const onOnline = () => invalidateProductionCaches(qc);
    window.addEventListener('online', onOnline);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('online', onOnline);
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
