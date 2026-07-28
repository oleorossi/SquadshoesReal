/**
 * Factoring (antecipação de recebíveis) — cálculo único compartilhado.
 *
 * Modelo financeiro: PV = FV / (1 + i)^n
 *  - i = taxa mensal da factoring
 *  - n = (dias entre hoje e a data prevista de pagamento do cliente) / 30
 *
 * A data prevista de pagamento = sexta-feira da semana de entrega + média dos
 * dias da condição de pagamento (ex.: "30/60/90" → 60 dias).
 *
 * Quando faltam dados (sem semana de entrega ou sem condição de pagamento),
 * usa receiving_days da factoring como aproximação.
 */

export function parsePaymentConditionDays(condition: string | null | undefined): number {
  if (!condition) return 0;
  const matches = condition.match(/\d+/g);
  if (!matches) return 0;
  const days = matches.map(Number).filter((d) => d > 0 && d <= 720);
  if (days.length === 0) return 0;
  return days.reduce((sum, d) => sum + d, 0) / days.length;
}

export function parsePaymentConditionInstallments(condition: string | null | undefined): number[] {
  if (!condition) return [];
  const matches = condition.match(/\d+/g);
  if (!matches) return [];
  return matches.map(Number).filter((d) => d > 0 && d <= 720);
}

/** Sexta-feira (último dia útil) da semana de entrega informada. */
export function getDeliveryWeekEndDate(
  deliveryMonth: string | null | undefined,
  deliveryWeek: string | null | undefined,
): Date | null {
  if (!deliveryMonth || !deliveryWeek) return null;
  const weekNum = parseInt(String(deliveryWeek).replace(/\D/g, ''), 10);
  if (!weekNum || isNaN(weekNum)) return null;

  const [year, month] = deliveryMonth.split('-').map(Number);
  if (!year || !month) return null;
  const firstDay = new Date(year, month - 1, 1);

  const weekStart = new Date(firstDay);
  const dayOfWeek = weekStart.getDay();
  if (dayOfWeek !== 1) {
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
  }
  weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
  // Clampa: se a segunda cair no mês anterior (S1 de mês que não começa em
  // segunda), alinha ao dia 1 do mês — mesma semântica de monthWeekToISODate
  // (billingWeek.ts) e de resolve_billing_week_for_order/resolve_op_due_date (SQL).
  if (weekStart.getTime() < firstDay.getTime()) {
    weekStart.setTime(firstDay.getTime());
  }

  const friday = new Date(weekStart);
  friday.setDate(friday.getDate() + 4);
  return friday;
}

export interface FactoringDiscountInput {
  total: number;
  monthlyInterestRate: number;        // em % (ex: 3 = 3%)
  paymentCondition?: string | null;    // ex.: "30/60/90 DIAS"
  deliveryMonth?: string | null;       // "YYYY-MM"
  deliveryWeek?: string | null;        // "S2"
  fallbackReceivingDays?: number;      // dias para receber se faltar info
}

export interface FactoringDiscountResult {
  pv: number;                  // valor líquido a receber
  discount: number;            // desconto absoluto (FV - PV)
  discountPct: number;         // desconto em % do bruto
  periods: number;             // n (em meses)
  totalInterestDays: number;   // dias usados para calcular n
  source: 'delivery+payment' | 'fallback' | 'none';
}

export function calculateFactoringDiscount(input: FactoringDiscountInput): FactoringDiscountResult {
  const total = Number(input.total) || 0;
  const monthlyRate = (Number(input.monthlyInterestRate) || 0) / 100;

  if (total <= 0 || monthlyRate <= 0) {
    return { pv: total, discount: 0, discountPct: 0, periods: 0, totalInterestDays: 0, source: 'none' };
  }

  const paymentDays = parsePaymentConditionDays(input.paymentCondition);
  const weekEndDate = getDeliveryWeekEndDate(input.deliveryMonth, input.deliveryWeek);

  let totalInterestDays = 0;
  let source: FactoringDiscountResult['source'] = 'none';

  if (paymentDays > 0 && weekEndDate) {
    // Caminho ideal: temos data de entrega real + condição de pagamento.
    // n = (entrega - hoje) + paymentDays
    const baseDate = new Date(weekEndDate);
    baseDate.setDate(baseDate.getDate() + paymentDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    totalInterestDays = Math.max(0, Math.round((baseDate.getTime() - today.getTime()) / 86400000));
    source = 'delivery+payment';
  } else if (paymentDays > 0) {
    // Sem data de entrega: aproxima usando fallbackReceivingDays como proxy
    // do tempo de entrega + paymentDays. Antes, esse caminho usava `today`
    // como base, ignorando o tempo até a entrega e SUBESTIMANDO o desconto
    // (empresa orçava receber MAIS do que de fato recebia).
    const fallbackDays = input.fallbackReceivingDays && input.fallbackReceivingDays > 0
      ? input.fallbackReceivingDays
      : 0;
    totalInterestDays = fallbackDays + paymentDays;
    source = 'fallback';
  } else if (input.fallbackReceivingDays && input.fallbackReceivingDays > 0) {
    // Sem condição de pagamento: usa só o fallback bruto.
    totalInterestDays = input.fallbackReceivingDays;
    source = 'fallback';
  }

  const periods = totalInterestDays / 30;
  const pv = total / Math.pow(1 + monthlyRate, periods);
  const discount = total - pv;
  const discountPct = total > 0 ? (discount / total) * 100 : 0;

  return { pv, discount, discountPct, periods, totalInterestDays, source };
}
