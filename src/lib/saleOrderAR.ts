/**
 * Cronograma de parcelas (accounts_receivable) gerado a partir de um PV.
 *
 * Antes: 1 PV gerava 1 row em accounts_receivable, com due_date = delivery_deadline,
 * ignorando payment_condition (o "30/60/90 DIAS" só entrava no cálculo do desconto
 * factoring). Agora: payment_condition parseada vira N parcelas, cada uma com sua
 * data própria.
 *
 * Regras (espelham syncFinancialRecords em useSaleOrders.ts):
 *  - sem factoring: due_date_i = delivery_deadline + days[i]
 *  - com factoring: due_date_i = max(hoje, delivery_deadline) + receiving_days + days[i]
 *    (receiving_days é o tempo até a factoring liquidar; os days[i] vêm depois,
 *    representando o prazo do cliente após a NF)
 *  - payment_condition vazia → 1 parcela em days=0 (mantém comportamento legacy)
 *  - amount é dividido igualmente; resto de centavos cai na última parcela pra
 *    sum(amounts) == total exato.
 */

import { parsePaymentConditionInstallments } from './factoringCalc';

export interface InstallmentSchedule {
  installment_number: number;
  total_installments: number;
  days_offset: number;       // dias da base usados
  due_date: string;          // ISO yyyy-mm-dd
  amount: number;            // já em reais, arredondado a 2 casas
}

export interface ComputeScheduleInput {
  total: number;
  paymentCondition: string | null | undefined;
  deliveryDeadline: string | null | undefined;   // ISO ou null → usa hoje
  isFactoring: boolean;
  factoringReceivingDays: number | null | undefined;
  /**
   * 1ª data de vencimento escolhida na emissão da NF-e (ISO yyyy-mm-dd) —
   * faturamento antecipado. Quando preenchida, ANCORA a parcela 1 nesta data e
   * as demais seguem os MESMOS intervalos da payment_condition (gaps entre
   * parcelas), IGNORANDO a base por entrega/factoring. Ex.: 60/75/90 + override
   * 15/08 → 15/08, 30/08, 14/09 (gaps +0/+15/+15). NULL = base padrão.
   */
  firstDueDateOverride?: string | null;
  /** Pra ser testável: data de "hoje". Default Date.now(). */
  now?: Date;
}

function isoFromDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function parseISODate(iso: string): Date {
  // yyyy-mm-dd → Date local meia-noite, evita drift de timezone
  return new Date(iso + 'T00:00:00');
}

export function computeARSchedule(input: ComputeScheduleInput): InstallmentSchedule[] {
  const total = Number(input.total) || 0;
  // Clona antes de mutar — setHours direto no input.now corrompia o Date do
  // chamador (efeito colateral silencioso). Auditoria 2026-06-14, Área 5 (🟡).
  const now = new Date(input.now ?? new Date());
  now.setHours(0, 0, 0, 0);
  const todayISO = isoFromDate(now);

  const deadline = input.deliveryDeadline
    ? parseISODate(input.deliveryDeadline)
    : parseISODate(todayISO);

  // Base date pra cada parcela. Factoring "empurra" pra max(hoje, deadline) e soma
  // receiving_days antes de aplicar os offsets do payment_condition.
  let baseDate: Date;
  if (input.isFactoring && input.factoringReceivingDays && input.factoringReceivingDays > 0) {
    baseDate = deadline > now ? new Date(deadline) : new Date(now);
    baseDate.setDate(baseDate.getDate() + input.factoringReceivingDays);
  } else {
    baseDate = new Date(deadline);
  }

  const daysArr = parsePaymentConditionInstallments(input.paymentCondition);
  const offsets = daysArr.length > 0 ? daysArr : [0];
  const N = offsets.length;

  // Override de faturamento antecipado: ancora a 1ª parcela na data escolhida e
  // as demais seguem os GAPS da condição (days[i] - days[0]), ignorando a base
  // por entrega/factoring. Mantém alinhado com as duplicatas da NF (emit-nfe).
  const overrideAnchor = input.firstDueDateOverride
    ? parseISODate(input.firstDueDateOverride)
    : null;
  const firstOffset = offsets[0];

  // Split de valor: floor a centavos pra todas menos a última, resto na última.
  // Garante sum exato == total mesmo com total não divisível por N.
  const cents = Math.round(total * 100);
  const perCents = Math.floor(cents / N);
  const remainder = cents - perCents * N;

  return offsets.map((days, idx) => {
    let due: Date;
    if (overrideAnchor) {
      due = new Date(overrideAnchor);
      due.setDate(due.getDate() + (days - firstOffset));
    } else {
      due = new Date(baseDate);
      due.setDate(due.getDate() + days);
    }
    const amountCents = idx === N - 1 ? perCents + remainder : perCents;
    return {
      installment_number: idx + 1,
      total_installments: N,
      days_offset: days,
      due_date: isoFromDate(due),
      amount: amountCents / 100,
    };
  });
}
