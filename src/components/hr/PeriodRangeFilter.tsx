import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DateRange {
  from: string;
  to: string;
}

interface PeriodRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Mantém o seletor dentro do histórico já importado quando aplicável. */
  min?: string;
  max?: string;
  className?: string;
  /** Rótulo exibido para orientar o uso fora da Folha. */
  label?: string;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthBounds(month: string): DateRange {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return { from: '', to: '' };
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function monthFromDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : isoDate(new Date()).slice(0, 7);
}

function daysInRange(from: string, to: string): number | null {
  if (!from || !to || from > to) return null;
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Seletor único de período para Ponto, Espelho e Folha. Os atalhos alteram
 * datas reais — não há estado paralelo por aba — e o mês é navegável sem ter
 * de abrir os dois campos de data repetidamente.
 */
export function PeriodRangeFilter({ value, onChange, min, max, className, label = 'Período' }: PeriodRangeFilterProps) {
  const month = monthFromDate(value.from);
  const totalDays = daysInRange(value.from, value.to);
  const today = isoDate(new Date());

  const setMonth = (nextMonth: string) => onChange(monthBounds(nextMonth));
  const shiftMonth = (amount: number) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const next = new Date(year, monthNumber - 1 + amount, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };
  const setPreset = (preset: 'today' | 'week' | 'firstHalf' | 'secondHalf' | 'month') => {
    if (preset === 'today') return onChange({ from: today, to: today });
    if (preset === 'week') {
      const now = new Date(`${today}T12:00:00`);
      const mondayOffset = (now.getDay() + 6) % 7;
      const from = new Date(now); from.setDate(now.getDate() - mondayOffset);
      const to = new Date(from); to.setDate(from.getDate() + 6);
      return onChange({ from: isoDate(from), to: isoDate(to) });
    }
    const bounds = monthBounds(month);
    if (preset === 'firstHalf') return onChange({ from: bounds.from, to: `${month}-15` });
    if (preset === 'secondHalf') return onChange({ from: `${month}-16`, to: bounds.to });
    onChange(bounds);
  };

  const quickButton = (preset: Parameters<typeof setPreset>[0], text: string, active: boolean) => (
    <Button key={preset} type="button" size="sm" variant={active ? 'secondary' : 'ghost'} className="h-8 px-2 text-xs" onClick={() => setPreset(preset)}>
      {text}
    </Button>
  );

  return (
    <section className={cn('rounded-lg border border-border/70 bg-card p-3', className)} aria-label={`${label}: filtros de data`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarBlank className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-xs font-semibold text-foreground">{label}</span>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}><CaretLeft className="h-4 w-4" /></Button>
          <Input type="month" value={month} onChange={event => event.target.value && setMonth(event.target.value)} className="h-8 w-[128px] bg-background text-xs" aria-label="Mês de referência" />
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Próximo mês" onClick={() => shiftMonth(1)}><CaretRight className="h-4 w-4" /></Button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-l-0 border-border/70 xl:border-l xl:pl-3">
          {quickButton('today', 'Hoje', value.from === today && value.to === today)}
          {quickButton('week', 'Semana', false)}
          {quickButton('firstHalf', '1ª quinz.', value.from === `${month}-01` && value.to === `${month}-15`)}
          {quickButton('secondHalf', '2ª quinz.', value.from === `${month}-16` && value.to === monthBounds(month).to)}
          {quickButton('month', 'Mês', value.from === monthBounds(month).from && value.to === monthBounds(month).to)}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 xl:justify-end">
          <Input type="date" value={value.from} min={min} max={value.to || max} onChange={event => onChange({ from: event.target.value, to: value.to })} className="h-8 w-[142px] bg-background text-xs" aria-label="Data inicial" />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" value={value.to} min={value.from || min} max={max} onChange={event => onChange({ from: value.from, to: event.target.value })} className="h-8 w-[142px] bg-background text-xs" aria-label="Data final" />
          {totalDays !== null && <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{totalDays} {totalDays === 1 ? 'dia' : 'dias'}</span>}
        </div>
      </div>
    </section>
  );
}
