/**
 * DAG de dependências entre setores de produção — fonte única no frontend.
 *
 * ⚠ DEVE espelhar o DAG do servidor (fn_guard_manual_stage_transition,
 * tg_stamp_order_stage_wip_timestamps e advance_order_to_sector). Topologia
 * canônica (decisão do dono 2026-06-29 — Costura é prep paralela de verdade):
 *
 *   Prep PARALELO (sem pré-requisito): Corte Palmilha, Corte Forração,
 *     Aviamento (alias Mesa), Costura
 *   Silk       ⟵ todo o prep (1º setor da cadeia sequencial)
 *   Colagem    ⟵ Silk
 *   Montagem   ⟵ Colagem ; Solagem ⟵ Montagem ; Acabamento ⟵ Solagem ;
 *   Expedição  ⟵ Acabamento
 *
 * Usado pelo kanban (ProductionKanban) pra decidir quais etapas concluir ao
 * arrastar uma OP — só os PREDECESSORES REAIS do destino, nunca ramos paralelos
 * irmãos (antes usava posição linear da coluna e concluía Costura/cortes
 * indevidamente).
 */

// Predecessores DIRETOS por nome de display. Aviamento/Mesa são aliases.
const DIRECT_PREDECESSORS: Record<string, string[]> = {
  'Corte Palmilha': [],
  'Corte Forração': [],
  'Aviamento': [],
  'Mesa': [],
  'Costura': [],
  'Silk': ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Mesa', 'Costura'],
  'Colagem': ['Silk'],
  'Montagem': ['Colagem'],
  'Solagem': ['Montagem'],
  'Acabamento': ['Solagem'],
  'Expedição': ['Acabamento'],
};

/**
 * Fecho transitivo dos predecessores de um setor no DAG real (todos os setores
 * que precisam estar concluídos antes do alvo poder iniciar). Não inclui o
 * próprio alvo. Retorna um Set de nomes de display.
 */
export function transitivePredecessors(stage: string): Set<string> {
  const result = new Set<string>();
  const visit = (s: string) => {
    for (const parent of DIRECT_PREDECESSORS[s] ?? []) {
      if (!result.has(parent)) {
        result.add(parent);
        visit(parent);
      }
    }
  };
  visit(stage);
  return result;
}

/** true se `candidate` é predecessor (transitivo) de `target` no DAG. */
export function isPredecessorOf(candidate: string, target: string): boolean {
  return transitivePredecessors(target).has(candidate);
}
