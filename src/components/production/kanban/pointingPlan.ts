import type { OrderStage, PointingWarning, useApontarProducao } from '@/hooks/useOrderStages';
import { norm, KanbanCardData, orderStagesByRoute } from './kanbanDerive';

/**
 * Sentido do movimento pela ROTA DA PRÓPRIA OP (`order_stages.stage_order`),
 * com a config global só como desempate quando o destino não é etapa da OP.
 * Ver o aviso em `orderStagesByRoute` — usar `flow_order` aqui fazia o Kanban
 * fechar Aviamento sozinho ao mover pra Costura.
 */
function isBackwardMove(
  stages: OrderStage[], column: string, target: string, flowOrder: Map<string, number>,
): boolean {
  const ordOf = new Map(stages.map(s => [norm(s.stage_name), s.stage_order]));
  const cur = ordOf.get(column);
  const tgt = ordOf.get(target);
  if (cur !== undefined && tgt !== undefined) return tgt < cur;
  return (flowOrder.get(target) ?? 0) < (flowOrder.get(column) ?? 0);
}

/**
 * REGRA ÚNICA de "mover card → apontar produção" (R5.4/R5.5), compartilhada
 * pelo diálogo de um card só (drag/clique) e pelo movimento em LOTE. Extraída
 * pra que as duas portas não divirjam: pulo de setor, estorno e finalização
 * são calculados aqui, e a gravação passa por `applyPointing`.
 */
export interface PointingPlan {
  /** Estágio onde o apontamento acontece: frente = setor atual do card;
   *  trás = último setor com progresso (é dele que se estorna). */
  pointedStage: OrderStage | null;
  /** Destino está ANTES do setor atual no fluxo → estorno (qty negativa). */
  isBackward: boolean;
  /** Setores intermediários pulados (concluídos com 0 pares, com registro). */
  skipped: string[];
  /** Saldo do estágio apontado (total − já processado). */
  remaining: number;
  /** Movimento é possível? Falso quando a OP não passa pelo setor destino
   *  (ficha sem aquele setor / já concluído) ou não há o que estornar. */
  available: boolean;
  /** Motivo legível quando `available` é falso — mostrado no lote. */
  unavailableReason?: string;
}

/** Destinos oferecidos no select de mover de UM card (modo detalhe). */
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

/**
 * Monta o plano de apontamento pra mover `card` até `target`.
 * `target === null` → apontar no próprio setor atual (sem mover).
 */
export function buildPointingPlan(
  card: KanbanCardData,
  target: string | null,
  flowOrder: Map<string, number>,
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
  const remaining = pointedStage ? pointedStage.quantity_total - pointedStage.quantity_processed : 0;

  // Mover pra frente exige que o destino seja um setor AINDA PENDENTE da OP —
  // ficha sem aquele setor (ou já concluído) não tem pra onde ir.
  if (target !== null && target !== column) {
    const targetIdx = seq.indexOf(target);
    if (targetIdx < 0) {
      return {
        pointedStage, isBackward: false, skipped: [], remaining,
        available: false,
        unavailableReason: `Esta OP não passa por ${target} (ou o setor já está concluído).`,
      };
    }
    // Pular = ir além do PRÓXIMO setor pendente do fluxo da OP
    const skipped = targetIdx > colIdx + 1 ? seq.slice(colIdx + 1, targetIdx) : [];
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

/**
 * Pular setor exige fechar a ORIGEM. Regra load-bearing (auditoria 2026-08-06).
 *
 * Apontar 180 de 288 e mandar o card pra um setor lá na frente fechava os
 * intermediários com 0 pares e deixava a OP em DOIS lugares ao mesmo tempo: a
 * origem seguia `em_andamento` com 108 pares de saldo (invisível no quadro,
 * porque o card já tinha ido embora) e o destino recebia ficha do lote inteiro.
 * Aconteceu de verdade em OP-2026-01191 (108 pares) e OP-2026-01195 (24).
 *
 * Pior efeito colateral: setor fechado com 0 vira "entregou tudo" para as duas
 * travas de quantidade do servidor, que passam a não disparar pelo resto da rota
 * — foi assim que a OP-2026-01221 apontou 36 pares na Montagem sem nenhum aviso,
 * com a Colagem zerada.
 *
 * Pular com o lote CHEIO continua permitido: é uma decisão legítima de fluxo
 * (terceirizou, ou o setor não se aplica àquele lote). O que não pode é pular
 * deixando saldo pendurado atrás.
 */
export function skipBlockedByPartial(plan: PointingPlan, qty: number): boolean {
  if (plan.isBackward || plan.skipped.length === 0 || !plan.pointedStage) return false;
  return qty < plan.remaining;
}

export type ApplyResult =
  | { status: 'ok'; quantity: number }
  | { status: 'needs_confirmation'; warnings: PointingWarning[] }
  | { status: 'blocked'; reason: string }
  | { status: 'noop' };

/**
 * Grava o apontamento pela RPC canônica (`apontar_producao_setor`), incluindo
 * a conclusão dos setores pulados. AUTORIA: a RPC grava `created_by` do
 * usuário logado — o Kanban não pede "operário" (decisão do dono 2026-07-26:
 * quem responde pelo lançamento é quem está logado no sistema).
 *
 * Lança em erro (o toast já sai pela mutation). Devolve `needs_confirmation`
 * quando o servidor exige OK explícito (R6.3) — SEM ter gravado nada.
 */
export async function applyPointing(params: {
  card: KanbanCardData;
  plan: PointingPlan;
  target: string | null;
  qty: number;
  apontar: ReturnType<typeof useApontarProducao>;
  confirmedWarnings?: string[];
  /** Prefixo da nota do ledger (ex.: 'Via Kanban' / 'Via Kanban (lote)'). */
  origin?: string;
}): Promise<ApplyResult> {
  const { card, plan, target, qty, apontar, confirmedWarnings, origin = 'Via Kanban' } = params;
  const { pointedStage, isBackward, skipped } = plan;
  if (!pointedStage) return { status: 'noop' };

  const quantity = isBackward ? -Math.abs(qty) : qty;
  if (quantity === 0) return { status: 'noop' };

  // Guarda de último recurso — os diálogos já barram antes de chegar aqui, mas
  // esta é a porta única de gravação e ela não pode depender da tela.
  if (skipBlockedByPartial(plan, qty)) {
    return {
      status: 'blocked',
      reason: `Pra pular ${skipped.join(', ')} é preciso fechar ${norm(pointedStage.stage_name)} `
        + `(${plan.remaining} pares). Com ${qty}, sobrariam ${plan.remaining - qty} pares sem passar por lá.`,
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
    // Finaliza o setor quando o total fecha — a RPC resolve/inicia o próximo
    finalize: willComplete,
    confirmedWarnings,
  });
  if (res?.needs_confirmation) {
    return { status: 'needs_confirmation', warnings: res.warnings || [] };
  }

  // Pulo confirmado (R5.5): conclui os setores intermediários com 0 pares
  // (pulados de propósito — o motor os trata como entrega total).
  //
  // Só chega aqui com a ORIGEM FECHADA — `skipBlockedByPartial` acima barra o
  // pulo parcial, que era o que deixava saldo órfão atrás do card.
  for (const skippedSector of skipped) {
    await apontar.mutateAsync({
      orderId: card.q.order_id,
      stageName: skippedSector,
      quantity: 0,
      note: `Setor pulado ${origin.toLowerCase()} (confirmado)`,
      finalize: true,
      confirmedWarnings: ['limite_setor_anterior', 'material_nao_reservado'],
    });
  }
  return { status: 'ok', quantity };
}
