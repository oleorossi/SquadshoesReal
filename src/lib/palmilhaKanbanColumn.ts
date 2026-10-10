/**
 * Coluna visual Kanban "Palmilha" agrega Palmilha · Fibra + Palmilha · Forração.
 * Spec: specs/ficha-palmilha-unificada.md (Q6, Q9, Q14, Q17).
 */
import {
  isPalmilhaFibraStage,
  isPalmilhaForracaoStage,
  PALMILHA_COLUMN,
  PALMILHA_FIBRA_STAGE,
  PALMILHA_FORRACAO_STAGE,
} from '@/lib/palmilhaUnifiedCard';

export { PALMILHA_COLUMN, PALMILHA_FIBRA_STAGE, PALMILHA_FORRACAO_STAGE };

export function isPalmilhaInternalStage(name: string | null | undefined): boolean {
  return isPalmilhaFibraStage(name) || isPalmilhaForracaoStage(name);
}

/** Colapsa as duas colunas internas numa visual "Palmilha". */
export function collapsePalmilhaColumns(columns: string[]): string[] {
  const out: string[] = [];
  let inserted = false;
  for (const c of columns) {
    if (isPalmilhaInternalStage(c)) {
      if (!inserted) {
        out.push(PALMILHA_COLUMN);
        inserted = true;
      }
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Cards que pertencem à coluna visual (pode ser 0–2 por OP). */
export function cardsBelongToPalmilhaColumn(column: string): boolean {
  return column === PALMILHA_COLUMN || isPalmilhaInternalStage(column);
}

/** Coluna visual do card (Fibra/Forração → Palmilha). */
export function toPalmilhaVisualColumn(column: string): string {
  return cardsBelongToPalmilhaColumn(column) ? PALMILHA_COLUMN : column;
}

export interface PalmilhaCheckState {
  /** Passo fibra existe nesta OP e não é N/A. */
  showFibra: boolean;
  showForracao: boolean;
  fibraDone: boolean;
  forracaoDone: boolean;
}

/**
 * Derivação dos checks a partir dos stages da OP (Q9/Q14).
 * Lado inexistente no roteiro → não aparece.
 */
export function palmilhaCheckState(stages: Array<{
  stage_name: string;
  status: string;
  quantity_processed?: number;
  quantity_total?: number;
}>): PalmilhaCheckState {
  const fibra = stages.find(s => isPalmilhaFibraStage(s.stage_name));
  const forro = stages.find(s => isPalmilhaForracaoStage(s.stage_name));
  const done = (s?: { status: string; quantity_processed?: number; quantity_total?: number }) => {
    if (!s) return false;
    if (s.status === 'concluido') return true;
    const tot = Number(s.quantity_total) || 0;
    const proc = Number(s.quantity_processed) || 0;
    return tot > 0 && proc >= tot;
  };
  return {
    showFibra: !!fibra,
    showForracao: !!forro,
    fibraDone: done(fibra),
    forracaoDone: done(forro),
  };
}

/** A coluna visual avança quando todos os checks VISÍVEIS estão feitos. */
export function palmilhaColumnComplete(state: PalmilhaCheckState): boolean {
  if (!state.showFibra && !state.showForracao) return true;
  if (state.showFibra && !state.fibraDone) return false;
  if (state.showForracao && !state.forracaoDone) return false;
  return true;
}

function stageStillOpen(s?: {
  status: string;
  quantity_processed?: number;
  quantity_total?: number;
}): boolean {
  if (!s) return true;
  if (s.status === 'concluido') return false;
  const tot = Number(s.quantity_total) || 0;
  const proc = Number(s.quantity_processed) || 0;
  return !(tot > 0 && proc >= tot);
}

/**
 * Destino real de apontamento quando a coluna visual é "Palmilha".
 * Prefere o lado incompleto; Fibra antes de Forração.
 */
export function resolvePalmilhaPointingTarget(
  stages: Array<{
    stage_name: string;
    status: string;
    quantity_processed?: number;
    quantity_total?: number;
  }>,
): string | null {
  const state = palmilhaCheckState(stages);
  if (state.showFibra && !state.fibraDone) {
    const s = stages.find(x => isPalmilhaFibraStage(x.stage_name));
    return s?.stage_name.trim() || PALMILHA_FIBRA_STAGE;
  }
  if (state.showForracao && !state.forracaoDone) {
    const s = stages.find(x => isPalmilhaForracaoStage(x.stage_name));
    return s?.stage_name.trim() || PALMILHA_FORRACAO_STAGE;
  }
  const any = stages.find(x => isPalmilhaInternalStage(x.stage_name));
  return any?.stage_name.trim() || null;
}

type FoldableCard = {
  q: { order_id: string };
  column: string;
  columnStage: {
    status: string;
    quantity_processed?: number;
    quantity_total?: number;
  } | null;
};

/**
 * Um card por OP na coluna visual Palmilha.
 * Mantém o card do passo ainda aberto (Fibra tem prioridade).
 */
export function foldPalmilhaCardsForColumn<T extends FoldableCard>(cards: T[]): T[] {
  const byOrder = new Map<string, T[]>();
  const other: T[] = [];
  for (const c of cards) {
    if (cardsBelongToPalmilhaColumn(c.column) && c.column !== PALMILHA_COLUMN) {
      const arr = byOrder.get(c.q.order_id) || [];
      arr.push(c);
      byOrder.set(c.q.order_id, arr);
    } else {
      other.push(c);
    }
  }
  const folded: T[] = [];
  for (const group of byOrder.values()) {
    folded.push(pickPalmilhaRepresentative(group));
  }
  return [...other, ...folded];
}

function pickPalmilhaRepresentative<T extends FoldableCard>(group: T[]): T {
  const open = group.filter(c => stageStillOpen(c.columnStage ?? undefined));
  const pool = open.length ? open : group;
  return pool.find(c => isPalmilhaFibraStage(c.column)) ?? pool[0];
}

/** flow_order da coluna visual = menor dos dois passos internos. */
export function palmilhaVisualFlowOrder(
  flowOrder: Map<string, number>,
): number {
  const candidates = [
    flowOrder.get('Palmilha · Fibra'),
    flowOrder.get('Palmilha · Forração'),
    flowOrder.get('Corte Fibra'),
    flowOrder.get('Corte Forração'),
    flowOrder.get('Corte Palmilha'),
  ].filter((n): n is number => n !== undefined);
  return candidates.length ? Math.min(...candidates) : 999;
}
