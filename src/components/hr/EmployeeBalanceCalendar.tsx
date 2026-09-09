import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { formatBalanceMinutes, type EmployeeTimeBalanceReport, type TimeBalanceDay, type TimeBalanceReportKind, type TimeBalanceWeek } from '@/lib/ponto/timeBalanceReports';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function shortDate(date: string): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '—';
}

function daySlot(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function balanceOutcome(minutes: number): { label: string; className: string } {
  if (minutes > 0) return { label: 'Horas extras a pagar', className: 'text-success' };
  if (minutes < 0) return { label: 'Débito de horas', className: 'text-destructive' };
  return { label: 'Horas compensadas', className: 'text-foreground' };
}

function dayBalanceLabel(day: TimeBalanceDay): string {
  if (day.status === 'pending') return 'Batida pendente';
  if (day.status === 'excused') return 'Abonado';
  if (day.status === 'neutral') return 'Folga';
  return formatBalanceMinutes(day.balanceMinutes);
}

function dayPunchesLabel(day: TimeBalanceDay): string {
  if (day.punches.length === 0) return 'Sem batidas';
  if (day.punches.length <= 2) return day.punches.join(' · ');
  return `${day.punches[0]} → ${day.punches[day.punches.length - 1]}`;
}

function BalanceDayCell({ day }: { day?: TimeBalanceDay }) {
  if (!day) return <div className="min-h-28 border-l border-t border-border/60 bg-muted/10" aria-hidden="true" />;
  const isPending = day.status === 'pending';
  const isPositive = !isPending && day.balanceMinutes > 0;
  const isNegative = !isPending && day.balanceMinutes < 0;
  return (
    <div
      className={cn(
        'min-h-28 border-l border-t border-border/60 p-2.5 transition-colors',
        isPositive && 'bg-success/5',
        isNegative && 'bg-destructive/5',
        isPending && 'bg-warning/10',
        !isPositive && !isNegative && !isPending && 'bg-muted/20',
      )}
      title={day.punches.join(' · ') || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{shortDate(day.date)}</span>
        {day.isHoliday && <span className="text-[10px] font-semibold text-warning">FER.</span>}
      </div>
      <p className="mt-2 truncate font-mono text-[11px] text-foreground">{dayPunchesLabel(day)}</p>
      <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
        {formatBalanceMinutes(day.workedMinutes, false)} / {formatBalanceMinutes(day.expectedMinutes, false)}
      </p>
      <p className={cn(
        'mt-2 text-xs font-bold tabular-nums',
        isPositive && 'text-success',
        isNegative && 'text-destructive',
        isPending && 'text-warning',
        !isPositive && !isNegative && !isPending && 'text-muted-foreground',
      )}>
        {dayBalanceLabel(day)}
      </p>
    </div>
  );
}

function WeekSummaryCell({ week }: { week: TimeBalanceWeek }) {
  const target = Math.max(1, week.expectedMinutes);
  const fulfilled = Math.min(100, Math.round((week.workedMinutes / target) * 100));
  return (
    <div className="min-h-28 border-t border-border/60 bg-muted/35 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {shortDate(week.startDate)}–{shortDate(week.endDate)}
      </p>
      <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">
        {formatBalanceMinutes(week.workedMinutes, false)} de {formatBalanceMinutes(week.expectedMinutes, false)}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
        <div
          className={cn('h-full rounded-full', week.deficitMinutes > 0 ? 'bg-destructive' : 'bg-success')}
          style={{ width: `${fulfilled}%` }}
        />
      </div>
      <p className={cn(
        'mt-2 font-mono text-sm font-bold tabular-nums',
        week.balanceMinutes > 0 ? 'text-success' : week.balanceMinutes < 0 ? 'text-destructive' : 'text-foreground',
      )}>
        {formatBalanceMinutes(week.balanceMinutes)}
      </p>
      {week.hasPendingPunches && <p className="mt-1 text-[10px] font-semibold text-warning">Há batida incompleta</p>}
    </div>
  );
}

export function EmployeeBalanceCalendar({ report, kind }: { report: EmployeeTimeBalanceReport; kind: TimeBalanceReportKind }) {
  const mainMinutes = kind === 'overtime'
    ? report.totalOvertimeMinutes
    : kind === 'deficit'
      ? -report.totalDeficitMinutes
      : report.finalPayableBalanceMinutes;
  const mainWeeks = kind === 'overtime'
    ? report.overtimeWeeks
    : kind === 'deficit'
      ? report.deficitWeeks
      : report.weeks.length;
  const outcome = balanceOutcome(report.finalPayableBalanceMinutes);
  const badgeClass = kind === 'overtime'
    ? 'border-success/30 bg-success/10 text-success'
    : kind === 'deficit'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : outcome.className === 'text-success'
        ? 'border-success/30 bg-success/10 text-success'
        : outcome.className === 'text-destructive'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/30 text-foreground';
  return (
    <Panel
      eyebrow={kind === 'overtime' ? 'CRÉDITO SEMANAL' : kind === 'deficit' ? 'ABAIXO DA META SEMANAL' : 'ESPELHO SEMANAL'}
      title={report.name}
      subtitle={`${report.department} · ${mainWeeks} ${mainWeeks === 1 ? 'semana' : 'semanas'} no relatório`}
      actions={
        <Badge variant="outline" className={cn('font-mono text-xs tabular-nums', badgeClass)}>
          {formatBalanceMinutes(mainMinutes)}
        </Badge>
      }
      flush
    >
      <div className="overflow-x-auto">
        <div className="min-w-[940px]">
          <div className="grid grid-cols-[160px_repeat(7,minmax(104px,1fr))] border-b border-border bg-muted/20">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fechamento semanal</div>
            {DAY_LABELS.map(label => <div key={label} className="border-l border-border/60 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>)}
          </div>
          {report.weeks.map(week => {
            const slots = Array.from<TimeBalanceDay | undefined>({ length: 7 });
            for (const day of week.days) slots[daySlot(day.dayOfWeek)] = day;
            return (
              <div key={week.key} className="grid grid-cols-[160px_repeat(7,minmax(104px,1fr))]">
                <WeekSummaryCell week={week} />
                {slots.map((day, index) => <BalanceDayCell key={day?.date || `${week.key}-${index}`} day={day} />)}
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid border-t border-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-border px-4 py-3 sm:border-r xl:border-b-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pendências de horas</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-destructive">{formatBalanceMinutes(-report.totalRawDebitMinutes)}</p>
        </div>
        <div className="border-b border-border px-4 py-3 xl:border-b-0 xl:border-r">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Horas extras</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-success">{formatBalanceMinutes(report.totalRawCreditMinutes)}</p>
        </div>
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resultado final</p>
          <p className={cn('mt-1 font-mono text-lg font-bold tabular-nums', outcome.className)}>{formatBalanceMinutes(report.finalPayableBalanceMinutes)}</p>
          <p className={cn('mt-0.5 text-[10px] font-semibold', outcome.className)}>{outcome.label}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Valor de HE a pagar</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{formatBRL(report.overtimeValue)}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{formatBalanceMinutes(report.totalPayableOvertimeMinutes, false)} após compensação</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        <span><strong className="text-foreground">Célula:</strong> batidas · trabalhado/meta · saldo diário</span>
        <span><strong className="text-foreground">Semana:</strong> créditos e débitos se compensam somente dentro dela</span>
        <span><strong className="text-foreground">Resultado final:</strong> mesma compensação do período usada pela folha</span>
        {report.pendingPunchDays > 0 && <span className="font-semibold text-warning">{report.pendingPunchDays} {report.pendingPunchDays === 1 ? 'dia com batida pendente' : 'dias com batida pendente'}</span>}
        {report.overtimeRateMissing && <span className="font-semibold text-warning">Taxa de hora extra não cadastrada</span>}
      </div>
    </Panel>
  );
}
