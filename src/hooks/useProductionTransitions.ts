import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Superfície de invalidação pós-produção.
 *
 * - `pointing`: apontamento / realtime de order_stages — OPs, etapas, ledger,
 *   telas de setor e quadro vivo. NÃO toca PV, ondas, capacidade, auditoria.
 * - `kanban`: motor dinâmico (Planejamento / Estouro / fila) — o apontamento
 *   dispara recompute no servidor; aqui só refetch das views.
 * - `full`: lista central completa (mudança estrutural: ficha, delete de etapa,
 *   etc.) — "mover em uma tela reflete em todas".
 */
export type ProductionCacheSurface = 'pointing' | 'kanban' | 'full';

/** Orders + etapas + telas de setor / quadro que o operador vê após apontar. */
export const ORDER_STAGES_CACHE_KEYS: readonly (readonly string[])[] = [
  ['orders'],
  ['order_stages'],
  ['production_pointings'],
  ['notifications'],
  // PCP Hub — Ordens (Orders.tsx)
  ['sale_orders_for_ops'],
  // PCP Hub — Dashboard / KPIs leves (pares do dia)
  ['producao-kpis'],
  // Quadro de Produção — modo Cartões (ProductionLive.tsx)
  ['live_pairs_rate'],
  // Quadro de Produção — modo Lote agregado (view v_sector_workload_active)
  ['v_sector_workload_active'],
  // Gargalo diário / semanal (Chão de Fábrica)
  ['sector-daily-load'],
  ['sector-period-load'],
  // Telas de setor com queries próprias
  ['sale_orders_for_corte'],
  ['sale_orders_for_picking'],
  ['sale_orders_for_manifest'],
  // Gate de material (badge no card do Kanban)
  ['orders-material-gate'],
  ['order-material-gate'],
];

/** Views do motor dinâmico (Planejamento / Kanban gestão / Estouro). */
export const KANBAN_ENGINE_CACHE_KEYS: readonly (readonly string[])[] = [
  ['sector_settings'],
  ['production_schedule_grid'],
  ['production_schedule_ops'],
  ['production_queue_detail'],
  ['production_overloads'],
  ['production_engine_runs'],
];

/**
 * Keys extras só no `full` — PV, ondas, capacidade e relatórios pesados.
 * Apontamento NÃO deve invalidá-las (blast radius / auditoria P1.2).
 */
export const PRODUCTION_FULL_EXTRA_CACHE_KEYS: readonly (readonly string[])[] = [
  // Capacidade (CapacityPlanning.tsx)
  ['cap_stages_v4'],
  ['cap_orders_v4'],
  // Auditoria de fluxo e análise pós-OP
  ['order-flow-audit'],
  ['post-op-analysis-v2'],
  // Ondas de produção
  ['waves'],
  ['wave-detail'],
  ['finishing-packages'],
  // Pedidos de venda (refletem progresso da OP — só em mudança estrutural)
  ['sale_orders'],
];

export function productionCacheKeysForSurface(
  surface: ProductionCacheSurface = 'full',
): readonly (readonly string[])[] {
  if (surface === 'pointing') return ORDER_STAGES_CACHE_KEYS;
  if (surface === 'kanban') return KANBAN_ENGINE_CACHE_KEYS;
  return [
    ...ORDER_STAGES_CACHE_KEYS,
    ...KANBAN_ENGINE_CACHE_KEYS,
    ...PRODUCTION_FULL_EXTRA_CACHE_KEYS,
  ];
}

function invalidateKeyList(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: readonly (readonly string[])[],
) {
  keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [...k] }));
}

/** Só orders / order_stages / setor / quadro vivo. */
export function invalidateOrderStagesCaches(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateKeyList(queryClient, ORDER_STAGES_CACHE_KEYS);
}

/** Só views do motor dinâmico de produção. */
export function invalidateKanbanEngineCaches(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateKeyList(queryClient, KANBAN_ENGINE_CACHE_KEYS);
}

/**
 * Invalida caches de produção por superfície.
 *
 * Default `full` preserva o contrato antigo (lista central completa).
 * Apontamento / realtime devem passar `{ surface: 'pointing' }` e, quando
 * o motor pode ter recomputado, também `invalidateKanbanEngineCaches`.
 *
 * ⚠ Toda query nova que leia order_stages/orders de produção deve registrar
 * sua key raiz em ORDER_STAGES_CACHE_KEYS (ou KANBAN / FULL_EXTRA) — keys
 * privadas com invalidação ad-hoc local foi exatamente o que deixou
 * Gargalos/Capacidade/Lote stale por até 5min (auditoria 2026-07-01).
 */
export function invalidateProductionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  options?: ProductionCacheSurface | { surface?: ProductionCacheSurface },
) {
  const surface: ProductionCacheSurface =
    typeof options === 'string' ? options : (options?.surface ?? 'full');
  invalidateKeyList(queryClient, productionCacheKeysForSurface(surface));
}

/**
 * Apontamento + realtime: etapas/setor/quadro E motor (recompute no servidor).
 * Explicitamente NÃO inclui sale_orders / waves / capacidade / auditoria.
 */
export function invalidateAfterPointing(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  invalidateOrderStagesCaches(queryClient);
  invalidateKanbanEngineCaches(queryClient);
}

export function useProductionTransitions() {
  const queryClient = useQueryClient();

  /**
   * Finaliza um setor de UMA OP — porta usada pelas telas de chão de fábrica
   * (`/producao/apontamento`: Corte, Silk, Colagem, Montagem, Solagem,
   * Acabamento, Costura) no botão "Finalizar OPs selecionadas".
   *
   * ⚠ PASSA PELO COMMAND CANÔNICO `execute_production_pointing_command`, não
   * mais direto em `finalize_production_sector`.
   *
   * Motivo (auditoria 2026-07-29, medido em produção): `finalize_production_sector`
   * só faz UPDATE em `order_stages`/`orders` e NUNCA insere em
   * `production_pointings`. Como estas 7 telas eram a porta principal do chão de
   * fábrica, o ledger tinha 46 lançamentos em 6 OPs enquanto 180 OPs já tinham
   * produção apontada — ~3% da realidade. Sem ledger não há quem/quando/quanto,
   * o `tg_pointings_recompute` não dispara e qualquer métrica de throughput,
   * ciclo real ou rastreabilidade nasce errada.
   *
   * A RPC canônica grava o ledger COM autoria e, com `p_finalize`, chama
   * `finalize_production_sector` internamente — mesma finalização de antes, só
   * que registrada.
   *
   * Lança em caso de erro — callers usam Promise.all e exibem um toast agregado.
   */
  const finalizeSectorTask = async (
    orderId: string,
    currentSector: string,
    opts?: { quantityProcessed?: number; operatorEmployeeId?: string | null }
  ) => {
    // Saldo do setor: `p_quantity` da RPC é INCREMENTO, enquanto o
    // `quantityProcessed` desta API sempre foi o ACUMULADO alvo. Converter aqui
    // evita que o caller apontasse o total de novo em cima do que já existia.
    const { data: stage, error: stageErr } = await supabase
      .from('order_stages')
      .select('stage_name, quantity_processed, quantity_total, status, updated_at')
      .eq('order_id', orderId)
      .or(`stage_name.eq.${currentSector}${currentSector === 'Aviamento' ? ',stage_name.eq.Mesa' : ''}`)
      .maybeSingle();
    if (stageErr) {
      console.error(`Erro lendo etapa ${currentSector} da OP ${orderId}:`, stageErr);
      throw stageErr;
    }
    if (!stage) throw new Error(`OP não passa pelo setor ${currentSector}.`);

    const alvo = opts?.quantityProcessed ?? stage.quantity_total ?? 0;
    const incremento = Math.max(0, alvo - (stage.quantity_processed ?? 0));
    const clientRequestId = crypto.randomUUID();

    type PointingCommandResult = {
      data: unknown;
      error: { message?: string } | null;
    };
    const callRpc = supabase.rpc as unknown as (
      functionName: string,
      args: Record<string, unknown>,
    ) => PromiseLike<PointingCommandResult>;

    const call = (confirmed?: string[]) =>
      callRpc('execute_production_pointing_command', {
        p_order_id: orderId,
        p_stage_name: stage.stage_name,
        p_quantity: incremento,
        p_finalize: true,
        p_note: 'Finalizado na tela do setor',
        p_operator_employee_id: opts?.operatorEmployeeId ?? null,
        p_confirmed_warnings: confirmed ?? null,
        p_expected_stage_updated_at: stage.updated_at,
        p_client_request_id: clientRequestId,
      });

    let { data, error } = await call();
    if (error) {
      console.error(`Erro na transição de setor para a OP ${orderId}:`, error);
      throw error;
    }

    // A RPC não grava nada quando levanta aviso sem confirmação. Estas telas
    // NUNCA tiveram gate de aviso (o caminho antigo não avaliava nenhum), então
    // confirmamos pra preservar o comportamento — mas os códigos voltam no
    // retorno pra tela poder mostrar o que foi aceito, em vez de sumir.
    const res = data as { needs_confirmation?: boolean; warnings?: { code: string }[] } | null;
    if (res?.needs_confirmation) {
      const codes = (res.warnings || []).map(w => w.code);
      ({ data, error } = await call(codes));
      if (error) {
        console.error(`Erro confirmando avisos da OP ${orderId}:`, error);
        throw error;
      }
    }

    invalidateAfterPointing(queryClient);

    // Achata pro shape que os callers já checam (`r.success`), preservando o
    // resultado da finalização e expondo os avisos aceitos.
    const out = data as Record<string, unknown> | null;
    return {
      ...(out?.finalize_result as Record<string, unknown> | null ?? {}),
      success: out?.success ?? false,
      stage_name: out?.stage_name,
      quantity_processed: out?.quantity_processed,
      confirmed_warnings: out?.confirmed_warnings ?? null,
    };
  };

  return {
    finalizeSectorTask,
    invalidateProductionCaches: () => invalidateProductionCaches(queryClient),
  };
}
