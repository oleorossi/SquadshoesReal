import type { Employee } from '@/hooks/useEmployees';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type EmployeeEmployment = Pick<Employee, 'active' | 'admission_date' | 'termination_date'>;

/**
 * Define se o vínculo existiu em algum dia do intervalo informado.
 *
 * `active` representa o estado atual. Para períodos históricos, a vigência é
 * definida pelas datas de admissão e demissão; assim, desligar alguém não apaga
 * os documentos do período em que a pessoa ainda trabalhava.
 */
export function employeeOverlapsEmploymentRange(
  employee: EmployeeEmployment,
  from: string,
  to: string,
): boolean {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return false;
  if (employee.admission_date && employee.admission_date > to) return false;
  if (employee.termination_date && employee.termination_date < from) return false;
  return employee.active || !!employee.termination_date;
}

/** A data de demissão é inclusiva: corresponde ao último dia trabalhado. */
export function employeeIsEmployedOnDate(employee: EmployeeEmployment, date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  if (employee.admission_date && employee.admission_date > date) return false;
  if (employee.termination_date) return employee.termination_date >= date;
  return employee.active;
}

/**
 * Contrato de persistência do cadastro: preencher a demissão sempre transforma
 * o vínculo atual em inativo. A função aceita payload parcial para ser usada
 * tanto no formulário quanto nos hooks de insert/update.
 */
export function normalizeEmployeeEmploymentState<
  T extends { active?: boolean; termination_date?: string | null },
>(data: T): T {
  if (!data.termination_date) return data;
  return { ...data, active: false };
}
