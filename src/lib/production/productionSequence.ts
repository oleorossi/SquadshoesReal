/**
 * Motor de sequência de produção — regras puras.
 * Spec: specs/sequencia-producao.md
 *
 * Hierarquia entre elegíveis:
 *   1) fechar PV (completion % ↓)
 *   2) urgência billing / due_date (mais cedo primeiro)
 *   3) mesma cor
 *   4) referência
 *   5) created_at / id
 *
 * Porta (elegibilidade) é responsabilidade do caller + helpers abaixo;
 * data planejada NÃO remove elegibilidade — só pode penalizar urgência.
 */

import type { AtelierPipelineStatus } from '@/lib/atelier';

function daysUntilDeadline(deadline: string | null | undefined, today = new Date()): number | null {
  if (!deadline) return null;
  const d = new Date(`${deadline}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(today);
  start.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - start.getTime()) / 86400000);
}

export interface ProductionSequenceRankInput {
  id: string;
  /** % do PV já com OP (0–100). Maior = mais perto de fechar/faturar. */
  completionPct: number;
  /** due_date / delivery alinhado a billing week; null = fim da fila de urgência. */
  dueDate: string | null | undefined;
  color: string | null | undefined;
  reference: string | null | undefined;
  createdAt: string;
  /** Desempate estável. */
  tiebreakId?: string;
  /**
   * Dias até a data planejada de início. Negativo = já na data/atrasado.
   * Se > 0 (ainda cedo), aplica penalidade leve na urgência (Q20c-B).
   */
  daysUntilPlannedStart?: number | null;
}

/** Normaliza cor/ref para agrupamento (mesma cor consecutiva). */
export function normalizeSequenceKey(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

/**
 * Urgência 0..1 — billing/due mais cedo = maior.
 * Penalidade se ainda falta dias para o planned start (não zera elegibilidade).
 */
export function sequenceUrgency(input: {
  dueDate: string | null | undefined;
  daysUntilPlannedStart?: number | null;
  today?: Date;
}): number {
  const days = daysUntilDeadline(input.dueDate, input.today);
  if (days == null) return 0;
  let urgency = 1 / (Math.max(0, days) + 1);
  const planned = input.daysUntilPlannedStart;
  if (planned != null && planned > 0) {
    // Ainda cedo: reduz urgência sem tirar da disputa.
    urgency *= 1 / (1 + planned);
  }
  return urgency;
}

/**
 * Compare oficial: completion ↓, urgency ↓, cor ↑, ref ↑, created_at ↑, id ↑.
 * Retorna < 0 se `a` vem antes de `b`.
 */
export function compareProductionSequence(
  a: ProductionSequenceRankInput,
  b: ProductionSequenceRankInput,
  today = new Date(),
): number {
  if (b.completionPct !== a.completionPct) return b.completionPct - a.completionPct;

  const ua = sequenceUrgency({
    dueDate: a.dueDate,
    daysUntilPlannedStart: a.daysUntilPlannedStart,
    today,
  });
  const ub = sequenceUrgency({
    dueDate: b.dueDate,
    daysUntilPlannedStart: b.daysUntilPlannedStart,
    today,
  });
  if (ub !== ua) return ub - ua;

  const colorCmp = normalizeSequenceKey(a.color).localeCompare(normalizeSequenceKey(b.color));
  if (colorCmp !== 0) return colorCmp;

  const refCmp = normalizeSequenceKey(a.reference).localeCompare(normalizeSequenceKey(b.reference));
  if (refCmp !== 0) return refCmp;

  const createdCmp = String(a.createdAt).localeCompare(String(b.createdAt));
  if (createdCmp !== 0) return createdCmp;

  return String(a.tiebreakId || a.id).localeCompare(String(b.tiebreakId || b.id));
}

export function sortProductionSequence<T extends ProductionSequenceRankInput>(
  rows: T[],
  today = new Date(),
): T[] {
  return [...rows].sort((a, b) => compareProductionSequence(a, b, today));
}

/** Cabedal complexo: só disputa fábrica após retorno. */
export function isAtelierFactoryReady(input: {
  isComplexReference: boolean;
  /** Status do job do item (se houver). */
  pipelineStatus: AtelierPipelineStatus | string | null | undefined;
}): { ready: boolean; blockReason: string | null } {
  if (!input.isComplexReference) {
    return { ready: true, blockReason: null };
  }
  const status = String(input.pipelineStatus || '');
  if (status === 'received_at_factory') {
    return { ready: true, blockReason: null };
  }
  if (status === 'sent_to_contractor') {
    return { ready: false, blockReason: 'Ateliê · aguardando retorno do cabedal' };
  }
  if (status === 'awaiting_debit' || status === 'debited') {
    return { ready: false, blockReason: 'Ateliê · prep de cabedal pendente' };
  }
  if (!status) {
    return { ready: false, blockReason: 'Ateliê · sem job de prep' };
  }
  if (status === 'cancelled') {
    return { ready: false, blockReason: 'Ateliê · job cancelado' };
  }
  return { ready: false, blockReason: `Ateliê · status ${status}` };
}

/**
 * Score de caixa alinhado ao Lookahead (valor restante × urgência de prazo).
 * Usado em chips/UI; a ordem oficial entre elegíveis usa compareProductionSequence.
 */
export function sequenceCashScore(input: {
  remainingBillableValue: number;
  dueDate: string | null | undefined;
  daysUntilPlannedStart?: number | null;
  today?: Date;
}): number {
  const urgency = sequenceUrgency({
    dueDate: input.dueDate,
    daysUntilPlannedStart: input.daysUntilPlannedStart,
    today: input.today,
  });
  return Math.max(0, Number(input.remainingBillableValue) || 0) * urgency;
}
