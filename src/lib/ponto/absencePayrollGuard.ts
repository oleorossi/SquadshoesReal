import { supabase } from '@/integrations/supabase/client';

interface PayrollPeriodRange {
  from: string;
  to: string;
}

interface ClosedPayrollRef {
  period: string;
  status: string;
}

export function payrollPeriodRange(period: string): PayrollPeriodRange | null {
  const value = String(period || '').trim();
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (month < 1 || month > 12) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${value}-01`, to: `${value}-${String(lastDay).padStart(2, '0')}` };
  }

  const interval = value.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!interval || interval[1] > interval[2]) return null;
  return { from: interval[1], to: interval[2] };
}

export function dateRangesOverlap(left: PayrollPeriodRange, right: PayrollPeriodRange): boolean {
  return left.from <= right.to && right.from <= left.to;
}

/**
 * Impede que uma justificativa altere retroativamente uma folha aprovada ou paga.
 * O intervalo inteiro é conferido: uma ausência que começa fora da folha, mas
 * termina dentro dela, também precisa ser bloqueada.
 */
export async function assertNoClosedPayrollInRange(
  employeeId: string,
  startDate: string,
  endDate: string,
  action: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('period, status')
    .eq('employee_id', employeeId)
    .in('status', ['aprovado', 'pago']);

  if (error) throw new Error(`Falha ao verificar a folha de pagamento: ${error.message}`);

  const requested = { from: startDate.slice(0, 10), to: endDate.slice(0, 10) };
  const conflict = ((data || []) as ClosedPayrollRef[]).find((run) => {
    const closedRange = payrollPeriodRange(run.period);
    return closedRange ? dateRangesOverlap(requested, closedRange) : false;
  });

  if (!conflict) return;
  const status = conflict.status === 'pago' ? 'paga' : 'aprovada';
  throw new Error(`Folha do período ${conflict.period} já ${status} — desfaça o fechamento antes de ${action}.`);
}
