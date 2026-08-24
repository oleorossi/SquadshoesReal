import type { KanbanCardData } from './kanbanDerive';
import { buildPointingPlan, type PointingPlan } from './pointingPlan';

export interface BulkMoveStep {
  card: KanbanCardData;
  plan: PointingPlan;
}

export interface BulkMoveBlocked {
  orderNumber: string;
  reason: string;
}

/**
 * Mantém somente um card por OP, preservando a ordem visual do quadro.
 *
 * Uma OP pode ter cards simultâneos em setores paralelos. Processar dois cards
 * dela no mesmo lote congelaria dois planos antes do primeiro apontamento e o
 * segundo passo nasceria obsoleto. A seleção e o diálogo compartilham esta
 * função para manter a invariante "uma OP por distribuição".
 */
export function uniqueCardsByOrder(cards: KanbanCardData[]): KanbanCardData[] {
  const byOrder = new Map<string, KanbanCardData>();
  for (const card of cards) {
    if (!byOrder.has(card.q.order_id)) byOrder.set(card.q.order_id, card);
  }
  return [...byOrder.values()];
}

/**
 * Alterna um card e substitui qualquer irmão paralelo já marcado da mesma OP.
 * A interface continua selecionando o trabalho no setor correto sem permitir
 * que a mesma OP entre duas vezes no lote.
 */
export function toggleUniqueOrderCard(
  selectedKeys: Set<string>,
  cards: KanbanCardData[],
  card: KanbanCardData,
): Set<string> {
  const next = new Set(selectedKeys);
  if (next.has(card.key)) {
    next.delete(card.key);
    return next;
  }

  for (const candidate of cards) {
    if (candidate.q.order_id === card.q.order_id) next.delete(candidate.key);
  }
  next.add(card.key);
  return next;
}

/**
 * Soma resultados de busca à seleção sem trocar o card paralelo que o operador
 * escolheu manualmente. O rótulo "+ N da busca" é aditivo; substituir toda a
 * seleção faria OPs fora do filtro desaparecerem sem aviso.
 */
export function addUniqueOrderCards(
  selectedKeys: Set<string>,
  cards: KanbanCardData[],
  additions: KanbanCardData[],
): Set<string> {
  const cardByKey = new Map(cards.map(card => [card.key, card]));
  const selectedOrders = new Set(
    [...selectedKeys]
      .map(key => cardByKey.get(key)?.q.order_id)
      .filter((orderId): orderId is string => !!orderId),
  );
  const next = new Set(selectedKeys);

  for (const card of additions) {
    if (selectedOrders.has(card.q.order_id)) continue;
    next.add(card.key);
    selectedOrders.add(card.q.order_id);
  }
  return next;
}

/** Remove seleções que deixaram de existir depois de uma atualização realtime. */
export function pruneSelectedCardKeys(
  selectedKeys: Set<string>,
  cards: KanbanCardData[],
): Set<string> {
  const live = new Set(cards.map(card => card.key));
  const next = new Set([...selectedKeys].filter(key => live.has(key)));
  return next.size === selectedKeys.size ? selectedKeys : next;
}

/**
 * Plano único da distribuição em lote, usado tanto na prévia dos destinos
 * quanto no diálogo. Assim o seletor nunca promete uma OP que o lote recusará.
 */
export function buildBulkMoveBatch(
  cards: KanbanCardData[],
  target: string,
  flowOrder: Map<string, number>,
  levelOf?: Map<string, number>,
): { steps: BulkMoveStep[]; blocked: BulkMoveBlocked[]; duplicateCards: number } {
  const unique = uniqueCardsByOrder(cards);
  const steps: BulkMoveStep[] = [];
  const blocked: BulkMoveBlocked[] = [];

  for (const card of unique) {
    if (card.column === target) {
      blocked.push({
        orderNumber: card.q.order_number,
        reason: `Já está em ${target}.`,
      });
      continue;
    }

    const plan = buildPointingPlan(card, target, flowOrder, levelOf);
    if (plan.available && plan.pointedStage && plan.skipped.length === 0) {
      steps.push({ card, plan });
    } else {
      blocked.push({
        orderNumber: card.q.order_number,
        reason: plan.skipped.length > 0
          ? `Pular ${plan.skipped.join(', ')} exige movimentação individual.`
          : plan.unavailableReason || 'Movimento indisponível.',
      });
    }
  }

  return {
    steps,
    blocked,
    duplicateCards: cards.length - unique.length,
  };
}
