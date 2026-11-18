/**
 * Quinzena de faturamento: dia 1–15 ou 16–fim do mês da semana de faturamento.
 * Lote de Ateliê parado não fura uma quinzena anterior.
 * Dentro da quinzena, o lote parado vem antes da ordem atual (semana, prazo, criação).
 */

export interface AllocationClaim {
  id: string;
  fortnightStart: string;
  atelierStuck: boolean;
  /** Menor = atende primeiro, depois do desempate do Ateliê. Semana, prazo, criação. */
  priorityScore: number;
}

export function billingFortnightStart(day: string | null | undefined): string | null {
  if (!day) return null;
  const [year, month, date] = day.slice(0, 10).split('-').map(Number);
  if (!year || !month || !date) return null;
  const startDay = date <= 15 ? 1 : 16;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
}

export function compareAllocation(a: AllocationClaim, b: AllocationClaim): number {
  if (a.fortnightStart !== b.fortnightStart) {
    return a.fortnightStart < b.fortnightStart ? -1 : 1;
  }
  if (a.atelierStuck !== b.atelierStuck) return a.atelierStuck ? -1 : 1;
  if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Pode tirar empenho de um PV com prazo pior para cobrir lote parado. Não fura quinzena. */
export function canStealReservation(donor: AllocationClaim, recipient: AllocationClaim): boolean {
  if (!recipient.atelierStuck || donor.id === recipient.id) return false;
  if (donor.fortnightStart < recipient.fortnightStart) return false;
  return compareAllocation(recipient, donor) < 0;
}

/**
 * Kit fechou: não há napa pendente do corte e o portão do kit está pronto.
 * Fonte única. O envio automático não existe: isso só destrava o clique.
 */
export function atelierKitIsClosed(input: {
  napaPendingQty: number;
  kitGate: string | null | undefined;
}): boolean {
  return input.napaPendingQty <= 0.0000001 && input.kitGate === 'ready_to_send';
}

/**
 * Quitar a falta do corte gera movimento da quantidade que cabe no físico.
 * Sem saldo, a coluna pending_qty não zera.
 */
export function cutPendingFill(pending: number, physical: number): {
  movementQty: number;
  pendingAfter: number;
} {
  const open = Math.max(0, pending);
  const onHand = Math.max(0, physical);
  const movementQty = Math.min(open, onHand);
  if (movementQty <= 0) return { movementQty: 0, pendingAfter: open };
  return { movementQty, pendingAfter: open - movementQty };
}
