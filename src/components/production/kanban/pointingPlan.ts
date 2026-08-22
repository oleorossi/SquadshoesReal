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
  remaining: number;
  available: boolean;
  unavailableReason?: string;
}

export function moveOptions(card: KanbanCardData, flowOrder: Map<string, number>) {
  const { column, front } = card;
  const ordered = orderStagesByRoute(card.stages, flowOrder);
  const seq = ordered.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const fwdOptions = colIdx >= 0 ? seq.slice(colIdx + 1) : [];
  const prevSectors = ordered
    .map(s => norm(s.stage_name))
    .filter(n => n !== column && isBackwardMove(ordered, column, n, flowOrder));
  const backOption = front && prevSectors.length ? prevSectors[prevSectors.length - 1] : null;
  return { fwdOptions, backOption };
}

export function buildPointingPlan(
  card: KanbanCardData,
  target: string | null,
  flowOrder: Map<string, number>,
  levelOf?: Map<string, number>,
): PointingPlan {
  const { column, front } = card;
  const ordered = orderStagesByRoute(card.stages, flowOrder);
  const seq = ordered.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const isBackward = target !== null && isBackwardMove(ordered, column, target, flowOrder);

  if (isBackward) {
    const pointedStage = front;
    return {
      pointedStage,
      isBackward: true,
      skipped: [],
      remaining: pointedStage ? pointedStage.quantity_processed : 0,
      available: !!pointedStage,
      unavailableReason: pointedStage ? undefined : 'Nenhum setor desta OP tem apontamento pra estornar.',
    };
  }

  const pointedStage = card.columnStage ?? null;
  let remaining = pointedStage ? pointedStage.quantity_total - pointedStage.quantity_processed : 0;
  if (pointedStage) {
    const inbound = inboundAvailability(pointedStage.stage_name, ordered);
    if (inbound != null) {
      remaining = Math.min(remaining, Math.max(0, inbound - pointedStage.quantity_processed));
    }
  }

  if (target !== null && target !== column) {
    const targetIdx = seq.indexOf(target);
    if (targetIdx < 0) {
      return {
        pointedStage, isBackward: false, skipped: [], remaining,
        available: false,
        unavailableReason: `Esta OP não passa por ${target} (ou o setor já está concluído).`,
      };
    }
    const nivel = (setor: string) => levelOf?.get(setor) ?? flowOrder.get(setor) ?? 0;
    const nivelCol = nivel(column);
    const nivelAlvo = nivel(target);
    const skipped = targetIdx > colIdx + 1
      ? seq.slice(colIdx + 1, targetIdx).filter(s => {
          const n = nivel(s);
          return n !== nivelCol && n !== nivelAlvo;
        })
      : [];
    return {
      pointedStage, isBackward: false, skipped, remaining,
      available: !!pointedStage,
      unavailableReason: pointedStage ? undefined : 'Nenhum setor pendente pra apontar nesta OP.',
    };
  }

  return {
    pointedStage, isBackward: false, skipped: [], remaining,
    available: !!pointedStage,
    unavailableReason: pointedStage ? undefined : 'Nenhum setor pendente pra apontar nesta OP.',
  };
}

export function skipBlockedByPartial(plan: PointingPlan, qty: number): boolean {
  if (plan.isBackward || plan.skipped.length === 0 || !plan.pointedStage) return false;
  return qty < plan.remaining;
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
  if (!pointedStage) return { status: 'noop' };

  const quantity = isBackward ? -Math.abs(qty) : qty;
  if (quantity === 0) return { status: 'noop' };

  if (skipBlockedByPartial(plan, qty)) {
    return {
      status: 'blocked',
      reason: `Pra pular ${skipped.join(', ')} é preciso fechar ${norm(pointedStage.stage_name)} `
        + `(${plan.remaining} pares). Com ${qty}, sobrariam ${plan.remaining - qty} pares sem passar por lá.`,
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
