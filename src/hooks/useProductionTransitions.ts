import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Invalida TODAS as caches afetadas por uma transição/apontamento de produção,
 * garantindo sincronia entre PCP Hub, Quadro, Ordens, Setores, Ondas, Gargalos,
 * Capacidade e relatórios — "mover em uma tela reflete em todas".
 *
 * ⚠ Esta é a LISTA CENTRAL. Toda query nova que leia order_stages/orders de
 * produção deve registrar sua key raiz aqui — keys privadas com invalidação
 * ad-hoc local foi exatamente o que deixou Gargalos/Capacidade/Lote stale
 * por até 5min (auditoria 2026-07-01).
 */
export function invalidateProductionCaches(queryClient: ReturnType<typeof useQueryClient>) {
  const keys = [
    ['orders'],
    ['order_stages'],
    ['production_pointings'],
    ['notifications'],
    // PCP Hub — Ordens (Orders.tsx)
    ['sale_orders_for_ops'],
    // PCP Hub — Dashboard / KPIs
    ['producao-kpis'],
    // Quadro de Produção — modo Cartões (ProductionLive.tsx)
    ['live_pairs_rate'],
    // Quadro de Produção — modo Lote agregado (view v_sector_workload_active)
    ['v_sector_workload_active'],
    // Gargalo diário / semanal (Chão de Fábrica)
    ['sector-daily-load'],
    ['sector-period-load'],
    // Capacidade (CapacityPlanning.tsx)
    ['cap_stages_v4'],
    ['cap_orders_v4'],
    // Auditoria de fluxo e análise pós-OP
    ['order-flow-audit'],
    ['post-op-analysis-v2'],
    // Telas de setor com queries próprias
    ['sale_orders_for_corte'],
    ['sale_orders_for_picking'],
    ['sale_orders_for_manifest'],
    // Ondas de produção
    ['waves'],
    ['wave-detail'],
    ['finishing-packages'],
    // Pedidos de venda (refletem progresso da OP)
    ['sale_orders'],
    // Motor dinâmico de produção (Planejamento/Kanban/Estouro — o apontamento
    // dispara recompute no servidor; aqui só refetch das views)
    ['sector_settings'],
    ['production_schedule_grid'],
    ['production_schedule_ops'],
    ['production_queue_detail'],
    ['production_overloads'],
    ['production_engine_runs'],
  ];
  keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
}

export function useProductionTransitions() {
  const queryClient = useQueryClient();

  // Lança em caso de erro — callers usam Promise.allSettled e exibem
  // um único toast agregado. Não emitir toast aqui evita N+1 toasts.
  //
  // Sem quantidade explícita a RPC assume a OP inteira quando ninguém apontou
  // (comportamento canônico do bulk "Finalizar OPs selecionadas").
  const finalizeSectorTask = async (
    orderId: string,
    currentSector: string,
    opts?: { quantityProcessed?: number; operatorEmployeeId?: string | null }
  ) => {
    const { data, error } = await supabase.rpc('finalize_production_sector', {
      p_order_id: orderId,
      p_current_sector: currentSector,
      ...(opts?.quantityProcessed !== undefined ? { p_quantity_processed: opts.quantityProcessed } : {}),
      ...(opts?.operatorEmployeeId ? { p_operator_employee_id: opts.operatorEmployeeId } : {}),
    });

    if (error) {
      console.error(`Erro na transição de setor para a OP ${orderId}:`, error);
      throw error;
    }

    invalidateProductionCaches(queryClient);

    return data;
  };

  return { finalizeSectorTask, invalidateProductionCaches: () => invalidateProductionCaches(queryClient) };
}
