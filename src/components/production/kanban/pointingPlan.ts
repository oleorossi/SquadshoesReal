import type { OrderStage, PointingWarning, useApontarProducao } from '@/hooks/useOrderStages';
import { norm, KanbanCardData, orderStagesByRoute } from './kanbanDerive';
import { inboundAvailability } from '@/lib/production/stageFlow';

function isBackwardMove(
  stages: OrderStage[], column: string, target: string, flowOrder: Map<string, number>,
): boolean {
  const ordOf = new Map(stages.map(s => [norm(s.stage_name), s.stage_order]));
  const cur = ordOf.get(column);
  const tgt = ordOf.get(target);
  if (cur !== undefined && tgt !== undefined) return tgt < cur;
  return (flowOrder.get(target) ?? 0) < (flowOrder.get(column) ?? 0);
}

export interface PointingPlan {
  pointedStage: OrderStage | null;
  isBackward: boolean;
  skipped: string[];
  /** Quantidade que pode ser apontada agora, limitada pelo recebido a montante. */
  remaining: number;
  /** Saldo total do estágio; pular só é seguro quando este valor fecha. */
  stageRemaining: number;
  available: boolean;
  unavailableReason?: string;
}

type StageLevel = (stageName: string, stageOrder?: number) => number;

interface BackwardMove {
  /** Coluna visual para onde o card pode voltar sem prometer um estorno diferente. */
  target: string | null;
  /** Etapa que recebe o lançamento negativo no ledger. */
  pointedStage: OrderStage | null;
}

/**
 * Resolve UMA volta segura e mantém separados o destino visual e a etapa
 * estornada.
 *
 * Há dois estados legítimos do card:
 *  - setor atual já tem produção parcial: estorna o próprio setor e volta ao
 *    nível anterior;
 *  - setor atual ainda está zerado: estorna a última etapa anterior que
 *    realmente produziu pares.
 *
 * `status='concluido'` não basta: setor pulado fica concluído com 0 e não pode
 * virar origem de estorno. Níveis estritamente menores também impedem que um
 * irmão paralelo seja apresentado como "volta".
 */
function resolveBackwardMove(
  card: KanbanCardData,
  ordered: OrderStage[],
  nivel: StageLevel,
): BackwardMove {
  const columnStage = ordered.find(stage => norm(stage.stage_name) === card.column) ?? null;
  if (!columnStage) return { target: null, pointedStage: null };

  const columnIdx = ordered.indexOf(columnStage);
  const columnLevel = nivel(card.column, columnStage.stage_order);
  const previousLowerStages = ordered
    .slice(0, columnIdx)
    // A fatia já garante "anterior na rota". Aqui só tiramos irmãos do mesmo
    // nível; comparar < seria errado quando flow_order global diverge do
    // stage_order da ficha (Costura antes de Aviamento em 229 OPs reais).
    .filter(stage => nivel(norm(stage.stage_name), stage.stage_order) !== columnLevel);

  if (columnStage.quantity_processed > 0) {
    const previousLevel = previousLowerStages.at(-1) ?? null;
    return {
      target: previousLevel ? norm(previousLevel.stage_name) : null,
      pointedStage: previousLevel ? columnStage : null,
    };
  }

  const previousProduced = [...previousLowerStages]
    .reverse()
    .find(stage => stage.quantity_processed > 0) ?? null;
  return {
    target: previousProduced ? norm(previousProduced.stage_name) : null,
    pointedStage: previousProduced,
  };
}

export function moveOptions(
  card: KanbanCardData,
  flowOrder: Map<string, number>,
  levelOf?: Map<string, number>,
) {
  const { column } = card;
  const ordered = orderStagesByRoute(card.stages, flowOrder);
  const columnStage = ordered.find(stage => norm(stage.stage_name) === column) ?? null;
  const nivel = (stageName: string, stageOrder?: number) => (
    levelOf?.get(stageName)
    ?? flowOrder.get(stageName)
    ?? (stageOrder === undefined ? 1_000_000 : 1_000_000 + stageOrder)
  );
  const columnLevel = nivel(column, columnStage?.stage_order);
  const hasOpenParallelSibling = ordered.some(stage => (
    stage.status !== 'concluido'
    && norm(stage.stage_name) !== column
    && nivel(norm(stage.stage_name), stage.stage_order) === columnLevel
  ));
  const fwdOptions = (hasOpenParallelSibling ? [] : ordered)
    .filter(stage => stage.status !== 'concluido')
    .filter(stage => {
      const name = norm(stage.stage_name);
      return name !== column
        && !isBackwardMove(ordered, column, name, flowOrder)
        && nivel(name, stage.stage_order) !== columnLevel;
    })
    .map(stage => norm(stage.stage_name));

  // Só oferece a volta que o plano realmente consegue executar. O resolver
  // distingue setor atual parcial de próxima coluna zerada e ignora pulos 0/0.
  const backOption = resolveBackwardMove(card, ordered, nivel).target;
  return { fwdOptions, backOption };
}

export function buildPointingPlan(
  card: KanbanCardData,
  target: string | null,
  flowOrder: Map<string, number>,
  levelOf?: Map<string, number>,
): PointingPlan {
  const { column } = card;
  const ordered = orderStagesByRoute(card.stages, flowOrder);
  const seq = ordered.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const pointedStage = card.columnStage ?? null;
  const stageRemaining = pointedStage ? pointedStage.quantity_total - pointedStage.quantity_processed : 0;
  let remaining = stageRemaining;
  if (pointedStage) {
    const inbound = inboundAvailability(pointedStage.stage_name, ordered);
    if (inbound != null) {
      remaining = Math.min(remaining, Math.max(0, inbound - pointedStage.quantity_processed));
    }
  }

  // Antes de decidir frente/estorno, o alvo precisa existir NA ROTA DA OP.
  // Um setor global anterior mas ausente da ficha caía no branch de estorno e
  // alterava `front`, embora a OP nunca passasse por ele.
  const targetStage = target === null
    ? null
    : ordered.find(stage => norm(stage.stage_name) === target) ?? null;
  if (target !== null && target !== column && !targetStage) {
    return {
      pointedStage, isBackward: false, skipped: [], remaining, stageRemaining,
      available: false,
      unavailableReason: `Esta OP não passa por ${target} (ou o setor já está concluído).`,
    };
  }

  const columnStage = ordered.find(stage => norm(stage.stage_name) === column) ?? null;
  const nivel = (stageName: string, stageOrder?: number) => (
    levelOf?.get(stageName)
    ?? flowOrder.get(stageName)
    ?? (stageOrder === undefined ? 1_000_000 : 1_000_000 + stageOrder)
  );
  if (targetStage && target !== column && columnStage
      && nivel(target, targetStage.stage_order) === nivel(column, columnStage.stage_order)) {
    return {
      pointedStage, isBackward: false, skipped: [], remaining, stageRemaining,
      available: false,
      unavailableReason: `${target} é um setor paralelo a ${column}; aponte cada card separadamente.`,
    };
  }

  const isBackward = target !== null && isBackwardMove(ordered, column, target, flowOrder);

  if (isBackward) {
    const backward = resolveBackwardMove(card, ordered, nivel);
    const backwardStage = backward.pointedStage;
    // O destino visual precisa ser exatamente o resolvido para este estado do
    // card. Assim uma volta distante não estorna uma etapa diferente da que a
    // tela promete, mas a última etapa parcial ainda consegue voltar um nível.
    if (backwardStage && target !== backward.target) {
      return {
        pointedStage: backwardStage,
        isBackward: true,
        skipped: [],
        remaining: backwardStage.quantity_processed,
        stageRemaining: backwardStage.quantity_processed,
        available: false,
        unavailableReason: backward.target
          ? `Para estornar ${norm(backwardStage.stage_name)}, volte para ${backward.target}; não é seguro voltar direto para ${target}.`
          : `Não há um setor anterior seguro para estornar ${norm(backwardStage.stage_name)}.`,
      };
    }
    return {
      pointedStage: backwardStage,
      isBackward: true,
      skipped: [],
      remaining: backwardStage ? backwardStage.quantity_processed : 0,
      stageRemaining: backwardStage ? backwardStage.quantity_processed : 0,
      available: !!backwardStage && backwardStage.quantity_processed > 0 && target === backward.target,
      unavailableReason: backwardStage && target === backward.target
        ? undefined
        : 'Nenhum setor desta OP tem apontamento pra estornar.',
    };
  }

  if (target !== null && target !== column) {
    const targetIdx = seq.indexOf(target);
    if (targetIdx < 0) {
      return {
        pointedStage, isBackward: false, skipped: [], remaining, stageRemaining,
        available: false,
        unavailableReason: `Esta OP não passa por ${target} (ou o setor já está concluído).`,
      };
    }
    const nivelCol = nivel(column, columnStage?.stage_order);
    const nivelAlvo = nivel(target, targetStage?.stage_order);
    const openParallelSiblings = ordered
      .filter(stage => stage.status !== 'concluido')
      .filter(stage => norm(stage.stage_name) !== column)
      .filter(stage => nivel(norm(stage.stage_name), stage.stage_order) === nivelCol)
      .map(stage => norm(stage.stage_name));
    if (openParallelSiblings.length > 0) {
      return {
        pointedStage, isBackward: false, skipped: [], remaining, stageRemaining,
        available: false,
        unavailableReason: `Conclua primeiro ${openParallelSiblings.join(', ')} — a OP ainda permanece neste nível paralelo.`,
      };
    }
    const skipped = targetIdx > colIdx + 1
      ? seq.slice(colIdx + 1, targetIdx).filter(s => {
          const stage = ordered.find(item => norm(item.stage_name) === s);
          const n = nivel(s, stage?.stage_order);
          return n !== nivelCol && n !== nivelAlvo;
        })
      : [];
    return {
      pointedStage, isBackward: false, skipped, remaining, stageRemaining,
      available: !!pointedStage,
      unavailableReason: pointedStage ? undefined : 'Nenhum setor pendente pra apontar nesta OP.',
    };
  }

  return {
    pointedStage, isBackward: false, skipped: [], remaining, stageRemaining,
    available: !!pointedStage,
    unavailableReason: pointedStage ? undefined : 'Nenhum setor pendente pra apontar nesta OP.',
  };
}

export function skipBlockedByPartial(plan: PointingPlan, qty: number): boolean {
  if (plan.isBackward || plan.skipped.length === 0 || !plan.pointedStage) return false;
  return qty < plan.stageRemaining;
}

export type ApplyResult =
  | { status: 'ok'; quantity: number }
  | { status: 'needs_confirmation'; warnings: PointingWarning[] }
  | { status: 'blocked'; reason: string }
  | { status: 'noop' };

export async function applyPointing(params: {
  card: KanbanCardData;
  plan: PointingPlan;
  target: string | null;
  qty: number;
  apontar: ReturnType<typeof useApontarProducao>;
  confirmedWarnings?: string[];
  skipAcknowledged?: boolean;
  origin?: string;
}): Promise<ApplyResult> {
  const { card, plan, target, qty, apontar, confirmedWarnings, skipAcknowledged, origin = 'Via Kanban' } = params;
  const { pointedStage, isBackward, skipped } = plan;
  // Defesa central: drag, lote e diálogo touch/teclado chegam todos aqui. A UI
  // pode ficar com um snapshot antigo, então plano indisponível nunca escreve,
  // mesmo se algum botão ou consumidor esquecer de aplicar o bloqueio visual.
  if (!plan.available) {
    return {
      status: 'blocked',
      reason: plan.unavailableReason ?? 'Este movimento não está mais disponível. Atualize o quadro e tente novamente.',
    };
  }
  if (!pointedStage) return { status: 'noop' };

  const quantity = isBackward ? -Math.abs(qty) : qty;
  if (quantity === 0) return { status: 'noop' };

  if (skipBlockedByPartial(plan, qty)) {
    return {
      status: 'blocked',
      reason: `Pra pular ${skipped.join(', ')} é preciso fechar ${norm(pointedStage.stage_name)} `
        + `(${plan.stageRemaining} pares). Com ${qty}, sobrariam ${plan.stageRemaining - qty} pares sem passar por lá.`,
    };
  }

  if (skipped.length > 0 && !skipAcknowledged) {
    return {
      status: 'blocked',
      reason: `Pular ${skipped.join(', ')} fecha ${skipped.length > 1 ? 'esses setores' : 'esse setor'} `
        + 'sem produção apontada. Confirme na tela que é isso mesmo.',
    };
  }

  const willComplete = !isBackward && pointedStage.quantity_processed + quantity >= pointedStage.quantity_total;
  const res = await apontar.mutateAsync({
    orderId: card.q.order_id,
    stageName: pointedStage.stage_name,
    quantity,
    note: isBackward
      ? `Estorno ${origin} (${card.column} → ${target})`
      : (skipped.length ? `${origin}, pulando: ${skipped.join(', ')}` : origin),
    finalize: willComplete,
    confirmedWarnings,
  });
  if (res?.needs_confirmation) {
    return { status: 'needs_confirmation', warnings: res.warnings || [] };
  }

  for (const skippedSector of skipped) {
    const skipRes = await apontar.mutateAsync({
      orderId: card.q.order_id,
      stageName: skippedSector,
      quantity: 0,
      note: `Setor pulado ${origin.toLowerCase()} (confirmado)`,
      finalize: true,
    });
    if (skipRes?.needs_confirmation) {
      return { status: 'needs_confirmation', warnings: skipRes.warnings || [] };
    }
  }
  return { status: 'ok', quantity };
}
