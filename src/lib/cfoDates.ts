import { format, isValid, parseISO } from 'date-fns';

/** Mesmo calendário ISO de quatro dígitos usado no motor e no banco CFO. */
export function isCfoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9999-12-31') return false;
  const date = parseISO(value);
  return isValid(date) && format(date, 'yyyy-MM-dd') === value;
}
