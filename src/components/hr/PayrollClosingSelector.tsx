import { CalendarBlank, CaretLeft, CaretRight, CalendarDots, Rows } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  identifyPayrollClosing,
  payrollClosingRange,
  type PayrollClosingCadence,
  type PayrollDateRange,
  type PayrollHalf,
} from '@/lib/payrollClosing';

interface PayrollClosingSelectorProps {
  value: PayrollDateRange;
  onChange: (range: PayrollDateRange) => void;
  className?: string;
}

const formatDate = (iso: string) => iso.split('-').reverse().join('/');

export function PayrollClosingSelector({ value, onChange, className }: PayrollClosingSelectorProps) {
  const identified = identifyPayrollClosing(value);
  const month = identified?.month || value.from.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const cadence: PayrollClosingCadence = identified?.cadence || 'mes';
  const half: PayrollHalf = identified?.half || 'primeira';

  const changeSelection = (
    nextCadence: PayrollClosingCadence,
    nextHalf: PayrollHalf = half,
    nextMonth = month,
  ) => onChange(payrollClosingRange(nextMonth, nextCadence, nextHalf));

  const shiftMonth = (amount: number) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const next = new Date(year, monthNumber - 1 + amount, 1);
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    changeSelection(cadence, half, nextMonth);
  };

  const optionClass = (active: boolean) => cn(
    'group relative min-h-[112px] overflow-hidden rounded-md border p-4 text-left transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border bg-background text-foreground hover:border-foreground/50 hover:bg-muted/40',
  );

  return (
    <section className={cn('rounded-lg border border-border/70 bg-card p-4', className)} aria-label="Tipo de fechamento da folha">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
          <div className="mr-auto flex items-center gap-2">
            <CalendarBlank className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground">Competência da folha</p>
              <p className="text-[11px] text-muted-foreground">Escolha uma quinzena civil ou o mês completo.</p>
            </div>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}>
            <CaretLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={month}
            onChange={(event) => event.target.value && changeSelection(cadence, half, event.target.value)}
            className="h-9 w-[142px] bg-background text-xs"
            aria-label="Mês de referência da folha"
          />
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Próximo mês" onClick={() => shiftMonth(1)}>
            <CaretRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <button type="button" className={optionClass(cadence === 'quinzena')} onClick={() => changeSelection('quinzena')}>
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">Fechamento 15 dias</span>
                <span className="mt-1 block text-lg font-bold">Fechar quinzena</span>
              </span>
              <Rows className="h-6 w-6 opacity-70" />
            </span>
            <span className="mt-4 block text-xs opacity-75">Salário proporcional aos dias da metade selecionada.</span>
          </button>

          <button type="button" className={optionClass(cadence === 'mes')} onClick={() => changeSelection('mes')}>
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">Fechamento completo</span>
                <span className="mt-1 block text-lg font-bold">Fechar mês</span>
              </span>
              <CalendarDots className="h-6 w-6 opacity-70" />
            </span>
            <span className="mt-4 block text-xs opacity-75">Uma única folha com todo o salário e ocorrências do mês.</span>
          </button>
        </div>

        {cadence === 'quinzena' && (
          <div className="grid gap-2 rounded-md border border-border/70 bg-muted/30 p-2 sm:grid-cols-2" aria-label="Quinzena selecionada">
            {([
              ['primeira', '1ª quinzena', payrollClosingRange(month, 'quinzena', 'primeira')],
              ['segunda', '2ª quinzena', payrollClosingRange(month, 'quinzena', 'segunda')],
            ] as const).map(([key, label, range]) => (
              <button
                key={key}
                type="button"
                onClick={() => changeSelection('quinzena', key)}
                className={cn(
                  'rounded-sm border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  half === key ? 'border-foreground bg-background shadow-sm' : 'border-transparent text-muted-foreground hover:bg-background/60',
                )}
              >
                <span className="block text-xs font-bold text-foreground">{label}</span>
                <span className="mt-0.5 block font-mono text-[11px] tabular-nums">
                  {formatDate(range.from)} — {formatDate(range.to)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-sm border-l-2 border-primary bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Período que será calculado</span>
          <strong className="font-mono tabular-nums text-foreground">{formatDate(value.from)} — {formatDate(value.to)}</strong>
        </div>
      </div>
    </section>
  );
}
