import { useMemo, useState } from 'react';
import { useTimesheetCoverage } from '@/hooks/useTimesheet';
import { Panel } from '@/components/ui/panel';
import { Input } from '@/components/ui/input';
import { CalendarCheck, Warning as AlertTriangle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Calendário de cobertura do ponto: mostra quais dias do mês JÁ têm batida
 * importada (verde) × dias úteis ainda NÃO importados (âmbar) × fim de
 * semana / futuro (neutro). Serve pra ver até onde o relógio foi baixado —
 * a folha só calcula até a última data coberta (não subpaga dias não baixados).
 */
export default function CoverageCalendar() {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);

  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${period}-01`;
  const to = `${period}-${String(lastDay).padStart(2, '0')}`;
  const { data: cov, isLoading } = useTimesheetCoverage(from, to);

  const cells = useMemo(() => {
    const firstDow = new Date(y, m - 1, 1).getDay(); // 0=Dom
    const out: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= lastDay; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [y, m, lastDay]);

  const dateStr = (d: number) => `${period}-${String(d).padStart(2, '0')}`;
  const covered = cov?.coveredDates ?? new Set<string>();
  const maxCov = cov?.maxCovered ?? null;

  return (
    <Panel
      title="Cobertura do ponto"
      description="Dias já importados do relógio. A folha só calcula até a última data coberta."
      flush
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Input type="month" value={period} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setPeriod(e.target.value); }} className="w-40 h-9" />
          <div className="text-xs text-muted-foreground flex items-center gap-4">
            {isLoading ? (
              <span className="flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</span>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <CalendarCheck className="h-4 w-4 text-emerald-600" />
                  {covered.size} dia(s) importado(s)
                </span>
                {maxCov ? (
                  <span>Importado até <strong className="text-foreground">{maxCov.split('-').reverse().join('/')}</strong></span>
                ) : (
                  <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Nada importado</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map(w => (
            <div key={w} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-1">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <div key={`e${i}`} />;
            const ds = dateStr(d);
            const dow = new Date(y, m - 1, d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isCovered = covered.has(ds);
            const isFuture = ds > todayISO;
            const missingWorkday = !isCovered && !isWeekend && !isFuture;
            return (
              <div
                key={ds}
                className={cn(
                  'aspect-square rounded-md border flex flex-col items-center justify-center text-sm tabular-nums',
                  isCovered && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-semibold',
                  missingWorkday && 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
                  (!isCovered && (isWeekend || isFuture)) && 'bg-muted/30 border-border/60 text-muted-foreground',
                )}
                title={isCovered ? 'Importado' : missingWorkday ? 'Dia útil não importado' : isFuture ? 'Futuro' : 'Fim de semana'}
              >
                {d}
                {isCovered && <CalendarCheck className="h-3 w-3 mt-0.5" />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500/20 border border-emerald-500/40" /> Importado</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500/40" /> Dia útil não importado</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted/40 border border-border/60" /> Fim de semana / futuro</span>
        </div>
      </div>
    </Panel>
  );
}
