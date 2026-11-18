/**
 * Quinzena de faturamento: dia 1–15 ou 16–fim do mês da semana de faturamento.
 * Lote de Ateliê parado não fura uma quinzena anterior.
 * Dentro da quinzena: corte já confirmado com pendência, depois demanda Ateliê,
 * depois o resto. Semana, prazo e criação só desempatam dentro do mesmo tier.
 */

/** 0 corte confirmado com pendência, 1 demanda Ateliê, 2 resto. */
export type AtelierCoverTier = 0 | 1 | 2;

export interface AllocationClaim {
  id: string;
  fortnightStart: string;
  atelierStuck: boolean;
  /** Explícito. Sem isso, atelierStuck vira 1 e o resto vira 2. */
  coverTier?: AtelierCoverTier;
  /** Menor = atende primeiro, depois da quinzena e do tier. Semana, prazo, criação. */
  priorityScore: number;
}

export function coverTierOf(claim: AllocationClaim): AtelierCoverTier {
  if (claim.coverTier === 0 || claim.coverTier === 1 || claim.coverTier === 2) {
    return claim.coverTier;
  }
  return claim.atelierStuck ? 1 : 2;
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
  const tier = coverTierOf(a) - coverTierOf(b);
  if (tier !== 0) return tier;
  if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Pode tirar empenho para cobrir corte ou demanda do Ateliê. Não fura quinzena. */
export function canStealReservation(donor: AllocationClaim, recipient: AllocationClaim): boolean {
  if (donor.id === recipient.id || coverTierOf(recipient) >= 2) return false;
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
