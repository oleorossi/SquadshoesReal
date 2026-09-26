import { addWeeks, endOfWeek, format, parseISO, startOfWeek } from 'date-fns';

export interface DeliveryWeekOption {
  value: string;
  label: string;
  start: Date;
  end: Date;
}

/** Opções de semana (seg–dom) alinhadas ao hub de OPs. */
export function getDeliveryWeekOptions(today: Date = new Date()): DeliveryWeekOption[] {
  const options: DeliveryWeekOption[] = [];
  for (let i = -2; i <= 6; i++) {
    const weekStart = startOfWeek(addWeeks(today, i), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(addWeeks(today, i), { weekStartsOn: 1 });
    const label =
      i === 0
        ? 'Esta semana'
        : i === 1
          ? 'Próxima semana'
          : i === -1
            ? 'Semana passada'
            : `${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')}`;
    options.push({
      value: `${format(weekStart, 'yyyy-MM-dd')}|${format(weekEnd, 'yyyy-MM-dd')}`,
      label,
      start: weekStart,
      end: weekEnd,
    });
  }
  return options;
}

/**
 * `weekFilter` no formato `yyyy-MM-dd|yyyy-MM-dd` ou `'all'`.
 * Data ISO (ou yyyy-MM-dd) precisa cair no intervalo inclusivo.
 */
export function matchesDeliveryWeek(
  dateStr: string | null | undefined,
  weekFilter: string,
): boolean {
  if (!weekFilter || weekFilter === 'all') return true;
  if (!dateStr) return false;
  const [startStr, endStr] = weekFilter.split('|');
  if (!startStr || !endStr) return true;
  try {
    const d = parseISO(dateStr.slice(0, 10));
    const start = parseISO(startStr);
    const end = parseISO(endStr);
    return d >= start && d <= end;
  } catch {
    return false;
  }
}
