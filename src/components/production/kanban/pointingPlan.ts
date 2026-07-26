import type { OrderStage, PointingWarning, useApontarProducao } from '@/hooks/useOrderStages';
import { norm, KanbanCardData } from './kanbanDerive';

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
  const { stages, column, front } = card;
  const seq = stages.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const fwdOptions = colIdx >= 0 ? seq.slice(colIdx + 1) : [];
  const prevSectors = stages
    .map(s => norm(s.stage_name))
    .filter(n => (flowOrder.get(n) ?? 0) < (flowOrder.get(column) ?? 0));
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
  const { stages, column, front } = card;
  const seq = stages.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const isBackward = target !== null && (flowOrder.get(target) ?? 0) < (flowOrder.get(column) ?? 0);

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

export type ApplyResult =
  | { status: 'ok'; quantity: number }
  | { status: 'needs_confirmation'; warnings: PointingWarning[] }
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
  // (pulados de propósito — o motor os trata como entrega total)
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
