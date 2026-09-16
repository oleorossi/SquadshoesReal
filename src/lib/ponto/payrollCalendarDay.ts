/**
 * Classificação visual da célula do calendário de tempo da folha.
 *
 * Regra v3 (falta-como-horas): falta injustificada NÃO vira rótulo "falta" —
 * entra em raw_delay e segue a mesma pista de atraso (compensa HE do período).
 * A célula mostra o saldo de HORAS (débito líquido, compensado ou HE paga).
 */

export const fmtDeltaMin = (mins: number): string => {
  const m = Math.abs(Math.round(Number(mins) || 0));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
};

export type PayrollCalendarDayKind =
  | 'presence'
  | 'pending'
  | 'excused'
  | 'he'
  | 'delay'
  | 'compensated'
  | 'tolerance'
  | 'credit'
  | 'debit'
  | 'worked'
  | 'empty';

export interface PayrollCalendarDayInput {
  status?: string | null;
  worked_minutes?: number | null;
  raw_credit_minutes?: number | null;
  raw_delay_minutes?: number | null;
  compensated_credit_minutes?: number | null;
  compensated_delay_minutes?: number | null;
  payable_overtime_minutes?: number | null;
  payable_delay_minutes?: number | null;
  discarded_tolerance_minutes?: number | null;
}

export interface PayrollCalendarDayTone {
  kind: PayrollCalendarDayKind;
  label: string;
}

export function classifyPayrollCalendarDay(
  d: PayrollCalendarDayInput,
  paymentType?: string | null,
): PayrollCalendarDayTone {
  const worked = Number(d.worked_minutes) || 0;
  if (paymentType && paymentType !== 'mensalista') {
    return worked > 0
      ? { kind: 'presence', label: 'presença' }
      : { kind: 'empty', label: '—' };
  }
  if (d.status === 'pending') return { kind: 'pending', label: 'pendente' };
  if (d.status === 'excused') return { kind: 'excused', label: 'justificada' };
  // Falta injustificada cai aqui via payable_delay / compensated_delay (motor v3).
  if ((d.payable_overtime_minutes || 0) > 0) {
    return { kind: 'he', label: `HE +${fmtDeltaMin(d.payable_overtime_minutes || 0)}` };
  }
  if ((d.payable_delay_minutes || 0) > 0) {
    return { kind: 'delay', label: `−${fmtDeltaMin(d.payable_delay_minutes || 0)}` };
  }
  if ((d.compensated_credit_minutes || 0) > 0 || (d.compensated_delay_minutes || 0) > 0) {
    return { kind: 'compensated', label: 'compensado' };
  }
  if ((d.discarded_tolerance_minutes || 0) > 0) {
    return { kind: 'tolerance', label: 'tolerância' };
  }
  if ((d.raw_credit_minutes || 0) > 0) {
    return { kind: 'credit', label: `crédito +${fmtDeltaMin(d.raw_credit_minutes || 0)}` };
  }
  if ((d.raw_delay_minutes || 0) > 0) {
    return { kind: 'debit', label: `−${fmtDeltaMin(d.raw_delay_minutes || 0)}` };
  }
  if (worked > 0) return { kind: 'worked', label: fmtDeltaMin(worked) };
  return { kind: 'empty', label: '—' };
}
