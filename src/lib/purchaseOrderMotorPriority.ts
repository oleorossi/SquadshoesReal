/**
 * Prioridade do motor nas OCs em rascunho/sugeridas
 * (purchase_order_motor_priority — 20270101054900_motor_compras.sql).
 * Só leitura: a OC de verdade continua pelo clique em "Gerar OC".
 */

export type MotorUrgency = 'atrasada' | 'urgente' | 'normal';

export interface PurchaseOrderMotorPriority {
  purchase_order_id: string;
  motor_rank: number;
  urgency: MotorUrgency;
  material_need_date: string | null;
  purchase_by_date: string | null;
  send_to_contractor_date: string | null;
  lead_days: number | null;
  billing_anchor: string | null;
  is_urgent_pv: boolean;
  purchase_week: string | null;
  week_cumulative_brl: number | null;
  over_weekly_cap: boolean;
  reason: string | null;
}

const URGENCY_WEIGHT: Record<MotorUrgency, number> = { atrasada: 0, urgente: 1, normal: 2 };

/**
 * OCs com prioridade do motor sobem para o topo (atrasada → urgente → normal,
 * depois o rank do motor); as demais mantêm a ordem em que vieram.
 */
export function sortByMotorPriority<T extends { id: string }>(
  orders: T[],
  priority: Map<string, PurchaseOrderMotorPriority> | undefined,
): T[] {
  if (!priority || priority.size === 0) return orders;
  const indexed = orders.map((o, i) => ({ o, i, p: priority.get(o.id) }));
  indexed.sort((a, b) => {
    if (a.p && !b.p) return -1;
    if (!a.p && b.p) return 1;
    if (a.p && b.p) {
      const u = URGENCY_WEIGHT[a.p.urgency] - URGENCY_WEIGHT[b.p.urgency];
      if (u !== 0) return u;
      return a.p.motor_rank - b.p.motor_rank;
    }
    return a.i - b.i;
  });
  return indexed.map((x) => x.o);
}

export function motorUrgencyLabel(p: Pick<PurchaseOrderMotorPriority, 'urgency'>): string | null {
  if (p.urgency === 'atrasada') return 'Atrasada';
  if (p.urgency === 'urgente') return 'Urgente';
  return null;
}
