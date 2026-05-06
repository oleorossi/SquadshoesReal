export type GradeMap = Record<string, number> | null | undefined | unknown;

export function getGradeTotal(grade: GradeMap): number {
  if (!grade || typeof grade !== 'object') return 0;
  return Object.values(grade as Record<string, number>).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function getOrderTotalPairs(order: { grade?: unknown; quantity?: number | null }): number {
  const gradeTotal = getGradeTotal(order.grade);
  const qty = Number(order.quantity) || 0;
  // Use the larger value: quantity is the authoritative total,
  // grade may be unitária (not pre-scaled) for some orders
  return Math.max(gradeTotal, qty);
}
