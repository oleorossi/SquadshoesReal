import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, CalendarBlank, SlidersHorizontal } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  TIME_BALANCE_MAX_MONTHS,
  isCompleteCivilMonths,
  maxMonthsOk,
  monthBoundsFromPeriod,
  shiftDateRangeByMonths,
} from '@/lib/ponto/timeBalancePeriod';
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
  /**
   * Relatórios de HE/atraso: só mês civil (dia 1 → último).
   * Esconde atalhos de dia/semana/quinzena e trava o intervalo ao mês.
   */
  monthOnly?: boolean;
  /**
   * Espelho de ponto: intervalo customizado (mês→mês ou dia→dia) com teto de
   * meses, setas que deslocam o range inteiro e popover "Personalizar período".
   */
  overviewRange?: boolean;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthBounds(month: string): DateRange {
  return monthBoundsFromPeriod(month);
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

function formatBr(iso: string): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function overviewLabel(from: string, to: string): string {
  if (!from || !to) return 'Período';
  if (isCompleteCivilMonths(from, to) && from.slice(0, 7) === to.slice(0, 7)) {
    const [y, m] = from.slice(0, 7).split('-').map(Number);
    return `${MES_CURTO[(m || 1) - 1]} de ${y}`;
  }
  if (isCompleteCivilMonths(from, to)) {
    const [fy, fm] = from.slice(0, 7).split('-').map(Number);
    const [ty, tm] = to.slice(0, 7).split('-').map(Number);
    return `${MES_CURTO[(fm || 1) - 1]}/${fy} – ${MES_CURTO[(tm || 1) - 1]}/${ty}`;
  }
  return `${formatBr(from)} – ${formatBr(to)}`;
}

function OverviewCustomizePopover({
  value,
  onChange,
  min,
  max,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'month' | 'day'>(
    isCompleteCivilMonths(value.from, value.to) ? 'month' : 'day',
  );
  const [monthFrom, setMonthFrom] = useState(monthFromDate(value.from));
  const [monthTo, setMonthTo] = useState(monthFromDate(value.to));
  const [dayFrom, setDayFrom] = useState(value.from);
  const [dayTo, setDayTo] = useState(value.to);

  const syncFromValue = () => {
    setMonthFrom(monthFromDate(value.from));
    setMonthTo(monthFromDate(value.to));
    setDayFrom(value.from);
    setDayTo(value.to);
    setTab(isCompleteCivilMonths(value.from, value.to) ? 'month' : 'day');
  };

  const draftRange = useMemo(() => {
    if (tab === 'month') {
      const fromBounds = monthBounds(monthFrom);
      const toBounds = monthBounds(monthTo);
      if (!fromBounds.from || !toBounds.to) return null;
      const from = fromBounds.from <= toBounds.from ? fromBounds.from : toBounds.from;
      const to = fromBounds.to >= toBounds.to ? fromBounds.to : toBounds.to;
      return { from, to };
    }
    if (!dayFrom || !dayTo) return null;
    return dayFrom <= dayTo ? { from: dayFrom, to: dayTo } : { from: dayTo, to: dayFrom };
  }, [tab, monthFrom, monthTo, dayFrom, dayTo]);

  const error = useMemo(() => {
    if (!draftRange) return 'Informe o início e o fim do período.';
    if (draftRange.from > draftRange.to) return 'A data inicial deve ser anterior à final.';
    if (!maxMonthsOk(draftRange.from, draftRange.to, TIME_BALANCE_MAX_MONTHS)) {
      return `Período máximo: ${TIME_BALANCE_MAX_MONTHS} meses.`;
    }
    return null;
  }, [draftRange]);

  const apply = () => {
    if (!draftRange || error) return;
    onChange(draftRange);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (next) syncFromValue();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Personalizar período
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-3 p-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Personalizar período</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Até {TIME_BALANCE_MAX_MONTHS} meses. Fechamento de HE continua mês a mês.
          </p>
        </div>
        <Tabs value={tab} onValueChange={v => setTab(v as 'month' | 'day')}>
          <TabsList className="grid h-8 w-full grid-cols-2">
            <TabsTrigger value="month" className="text-xs">Por mês</TabsTrigger>
            <TabsTrigger value="day" className="text-xs">Por dia</TabsTrigger>
          </TabsList>
          <TabsContent value="month" className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="month"
                value={monthFrom}
                min={min?.slice(0, 7)}
                max={monthTo || max?.slice(0, 7)}
                onChange={event => event.target.value && setMonthFrom(event.target.value)}
                className="h-8 bg-background text-xs"
                aria-label="Mês inicial"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="month"
                value={monthTo}
                min={monthFrom || min?.slice(0, 7)}
                max={max?.slice(0, 7)}
                onChange={event => event.target.value && setMonthTo(event.target.value)}
                className="h-8 bg-background text-xs"
                aria-label="Mês final"
              />
            </div>
          </TabsContent>
          <TabsContent value="day" className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dayFrom}
                min={min}
                max={dayTo || max}
                onChange={event => setDayFrom(event.target.value)}
                className="h-8 bg-background text-xs"
                aria-label="Data inicial"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date"
                value={dayTo}
                min={dayFrom || min}
                max={max}
                onChange={event => setDayTo(event.target.value)}
                className="h-8 bg-background text-xs"
                aria-label="Data final"
              />
            </div>
          </TabsContent>
        </Tabs>
        {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!!error} onClick={apply}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Seletor único de período para Ponto, Espelho e Folha. Os atalhos alteram
 * datas reais — não há estado paralelo por aba — e o mês é navegável sem ter
 * de abrir os dois campos de data repetidamente.
 */
export function PeriodRangeFilter({
  value,
  onChange,
  min,
  max,
  className,
  label = 'Período',
  monthOnly = false,
  overviewRange = false,
}: PeriodRangeFilterProps) {
  const month = monthFromDate(value.from);
  const bounds = monthBounds(month);
  const totalDays = daysInRange(value.from, value.to);
  const today = isoDate(new Date());
  const completeMonths = isCompleteCivilMonths(value.from, value.to);

  const setMonth = (nextMonth: string) => onChange(monthBounds(nextMonth));
  const shiftMonth = (amount: number) => {
    if (overviewRange) {
      const next = shiftDateRangeByMonths(value, amount);
      if (maxMonthsOk(next.from, next.to, TIME_BALANCE_MAX_MONTHS)) onChange(next);
      return;
    }
    const [year, monthNumber] = month.split('-').map(Number);
    const next = new Date(year, monthNumber - 1 + amount, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };
  const setPreset = (preset: 'today' | 'week' | 'firstHalf' | 'secondHalf' | 'month') => {
    if (monthOnly || overviewRange || preset === 'month') return onChange(bounds);
    if (preset === 'today') return onChange({ from: today, to: today });
    if (preset === 'week') {
      const now = new Date(`${today}T12:00:00`);
      const mondayOffset = (now.getDay() + 6) % 7;
      const from = new Date(now); from.setDate(now.getDate() - mondayOffset);
      const to = new Date(from); to.setDate(from.getDate() + 6);
      return onChange({ from: isoDate(from), to: isoDate(to) });
    }
    if (preset === 'firstHalf') return onChange({ from: bounds.from, to: `${month}-15` });
    if (preset === 'secondHalf') return onChange({ from: `${month}-16`, to: bounds.to });
    onChange(bounds);
  };

  const quickButton = (preset: Parameters<typeof setPreset>[0], text: string, active: boolean) => (
    <Button key={preset} type="button" size="sm" variant={active ? 'secondary' : 'ghost'} className="h-8 px-2 text-xs" onClick={() => setPreset(preset)}>
      {text}
    </Button>
  );

  const rangeHint = (() => {
    if (totalDays === null) return null;
    const daysLabel = `${totalDays} ${totalDays === 1 ? 'dia' : 'dias'}`;
    if (overviewRange || monthOnly) {
      if (completeMonths) return `${daysLabel} · fechamento mês a mês`;
      return `${daysLabel} · visão parcial · não é fechamento de folha`;
    }
    return daysLabel;
  })();

  return (
    <section className={cn('rounded-lg border border-border/70 bg-card p-3', className)} aria-label={`${label}: filtros de data`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarBlank className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-xs font-semibold text-foreground">{label}</span>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Período anterior" onClick={() => shiftMonth(-1)}>
            <CaretLeft className="h-4 w-4" />
          </Button>
          {overviewRange ? (
            <span className="min-w-[128px] px-1 text-xs font-semibold capitalize tabular-nums text-foreground">
              {overviewLabel(value.from, value.to)}
            </span>
          ) : (
            <Input
              type="month"
              value={month}
              onChange={event => event.target.value && setMonth(event.target.value)}
              className="h-8 w-[128px] bg-background text-xs"
              aria-label="Mês de referência"
            />
          )}
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Próximo período" onClick={() => shiftMonth(1)}>
            <CaretRight className="h-4 w-4" />
          </Button>
        </div>

        {!monthOnly && !overviewRange && (
          <div className="flex flex-wrap items-center gap-1 border-l-0 border-border/70 xl:border-l xl:pl-3">
            {quickButton('today', 'Hoje', value.from === today && value.to === today)}
            {quickButton('week', 'Semana', false)}
            {quickButton('firstHalf', '1ª quinz.', value.from === `${month}-01` && value.to === `${month}-15`)}
            {quickButton('secondHalf', '2ª quinz.', value.from === `${month}-16` && value.to === bounds.to)}
            {quickButton('month', 'Mês', value.from === bounds.from && value.to === bounds.to)}
          </div>
        )}

        {overviewRange ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 xl:justify-end">
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatBr(value.from)} — {formatBr(value.to)}
            </span>
            {rangeHint && (
              <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {rangeHint}
              </span>
            )}
            <OverviewCustomizePopover value={value} onChange={onChange} min={min} max={max} />
          </div>
        ) : monthOnly ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 xl:justify-end">
            <span className="font-mono text-xs tabular-nums text-foreground">
              {bounds.from.split('-').reverse().join('/')} — {bounds.to.split('-').reverse().join('/')}
            </span>
            {rangeHint && (
              <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {rangeHint}
              </span>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 xl:justify-end">
            <Input type="date" value={value.from} min={min} max={value.to || max} onChange={event => onChange({ from: event.target.value, to: value.to })} className="h-8 w-[142px] bg-background text-xs" aria-label="Data inicial" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={value.to} min={value.from || min} max={max} onChange={event => onChange({ from: value.from, to: event.target.value })} className="h-8 w-[142px] bg-background text-xs" aria-label="Data final" />
            {rangeHint && <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{rangeHint}</span>}
          </div>
        )}
      </div>
    </section>
  );
}
