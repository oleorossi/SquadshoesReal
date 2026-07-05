// RelatorioAtrasos — relatório de ATRASOS por funcionário no período. Mostra em
// quais dias cada funcionário atrasou (ou saiu cedo) e quanto tempo, e ao clicar
// num funcionário abre um CALENDÁRIO com os dias de atraso + os HORÁRIOS batidos
// (exatamente do registro do relógio de ponto) e o R$ descontado por dia.
//
// Fonte da verdade: o MESMO motor da folha (computePeriodFolha → late_days), então
// o atraso aqui bate EXATAMENTE com a coluna ATRASOS da Folha do Mês e com o
// desconto aplicado no líquido (atraso_desconto = atraso_min/60 × salário/220).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useWorkdaySwaps, buildSwapSets, useWorkSchedules } from '@/hooks/useTimesheet';
import { computePeriodFolha, SALARY_HOUR_DIVISOR, expectedDayMinutes } from '@/lib/salaryPayroll';
import { fetchTimeRecordsInRange } from '@/lib/ponto/fetchTimeRecords';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CircleNotch as Loader2, Clock, Timer, Users, CheckCircle, CalendarBlank, CaretRight, FilePdf } from '@phosphor-icons/react';
import { printEmployeeAtraso, printAtrasoSummary } from '@/lib/atrasoReportPrint';

const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDia = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const dowShort = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(iso + 'T12:00:00').getUTCDay()];
const hhmm = (t: string) => String(t || '').slice(0, 5);
/** minutos → "1h05" / "45min" / "2h". */
const fmtMin = (mins: number) => {
  const m = Math.round(mins);
  const h = Math.floor(m / 60), mm = m % 60;
  if (h === 0) return `${mm}min`;
  return mm === 0 ? `${h}h` : `${h}h${pad(mm)}`;
};
const fmtBRL = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Mode = 'q1' | 'q2' | 'mes' | 'custom';
function periodRange(mode: Mode, cFrom: string, cTo: string) {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  switch (mode) {
    case 'q1': return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-15` };
    case 'q2': return { from: `${y}-${pad(m + 1)}-16`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
    case 'mes': return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
    case 'custom': return { from: cFrom, to: cTo };
  }
}

interface AtrasoRow {
  id: string;
  name: string;
  days: { date: string; minutes: number }[];
  totalMin: number;
  /** Batidas por data (exatamente do relógio) — alimenta o calendário. */
  punchesByDate: Map<string, string[]>;
  schedule: any;
  /** Salário mensal — pra calcular o R$ descontado (= min/60 × salário/220). */
  salary: number;
}

// ─── Calendário de atrasos de UM funcionário ─────────────────────────────────
function monthsBetween(from: string, to: string): { y: number; m: number }[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) { out.push({ y, m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const MES_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function AtrasoCalendarDialog({ row, from, to, onClose }: { row: AtrasoRow | null; from: string; to: string; onClose: () => void }) {
  if (!row) return null;
  const valorHora = (Number(row.salary) || 0) / SALARY_HOUR_DIVISOR;
  const lateMap = new Map(row.days.map((d) => [d.date, d.minutes]));
  const totalRS = (row.totalMin / 60) * valorHora;
  const expMin = expectedDayMinutes(row.schedule);
  const expWindow = row.schedule
    ? `${hhmm(row.schedule.entry_time)}–${hhmm(row.schedule.exit_time)}${row.schedule.lunch_start ? ` · almoço ${hhmm(row.schedule.lunch_start)}–${hhmm(row.schedule.lunch_end)}` : ''}`
    : '—';
  const months = monthsBetween(from, to);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <CalendarBlank className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0 leading-tight">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Atrasos · {fmtDia(from)}–{fmtDia(to)}</span>
                <span className="text-xl font-extrabold tracking-tight">{row.name}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total atrasado</span>
              <span className="text-2xl font-extrabold tabular-nums text-amber-600 dark:text-amber-400 leading-none">{fmtMin(row.totalMin)}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{row.days.length} dia{row.days.length === 1 ? '' : 's'} · desconto {fmtBRL(totalRS)}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start justify-between gap-3 -mt-1">
          <p className="text-xs text-muted-foreground">
            Jornada esperada: <strong className="text-foreground">{expWindow}</strong> ({fmtMin(expMin)}/dia). Horários puxados direto do relógio de ponto.
          </p>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={() => printEmployeeAtraso(row, from, to)}>
            <FilePdf className="h-4 w-4" /> PDF
          </Button>
        </div>

        {/* Calendário(s) do período */}
        <div className="space-y-4">
          {months.map(({ y, m }) => {
            const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
            const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
            return (
              <div key={`${y}-${m}`}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{MES_LABEL[m - 1]} {y}</p>
                <div className="grid grid-cols-7 gap-1">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w, i) => (
                    <div key={i} className="text-center text-[10px] font-bold uppercase text-muted-foreground py-0.5">{w}</div>
                  ))}
                  {cells.map((day, idx) => {
                    if (day == null) return <div key={`b-${idx}`} />;
                    const date = `${y}-${pad(m)}-${pad(day)}`;
                    const inPeriod = date >= from && date <= to;
                    const punches = row.punchesByDate.get(date) || [];
                    const lateMin = lateMap.get(date);
                    return (
                      <div
                        key={date}
                        className={[
                          'rounded-md border p-1 min-h-[3.25rem] flex flex-col',
                          !inPeriod ? 'opacity-30 border-border/40' : '',
                          lateMin != null ? 'border-amber-500/40 bg-amber-500/10'
                            : punches.length > 0 ? 'border-border bg-card'
                            : 'border-border/40 bg-muted/20',
                        ].join(' ')}
                      >
                        <span className={`text-[10px] font-bold tabular-nums leading-none ${lateMin != null ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{day}</span>
                        {lateMin != null ? (
                          <span className="mt-auto">
                            <span className="block text-[11px] font-bold tabular-nums text-amber-600 dark:text-amber-400 leading-tight">{fmtMin(lateMin)}</span>
                            {punches[0] && <span className="block text-[9px] font-mono text-amber-700/80 dark:text-amber-400/80 leading-none">↦ {hhmm(punches[0])}</span>}
                          </span>
                        ) : punches[0] ? (
                          <span className="mt-auto text-[9px] font-mono text-muted-foreground leading-none">{hhmm(punches[0])}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detalhe dia-a-dia: batidas completas + déficit + R$ */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Dias com atraso · batidas do relógio</span>
            <span>Déficit · desconto</span>
          </div>
          <div className="divide-y divide-border">
            {row.days.map((d) => {
              const punches = row.punchesByDate.get(d.date) || [];
              const rs = (d.minutes / 60) * valorHora;
              return (
                <div key={d.date} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {fmtDia(d.date)} <span className="text-xs font-normal text-muted-foreground">{dowShort(d.date)}</span>
                    </p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
                      {punches.length > 0 ? punches.map(hhmm).join('  ·  ') : 'sem batidas'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400 leading-none">{fmtMin(d.minutes)}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground mt-0.5">{fmtBRL(rs)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RelatorioAtrasos() {
  const { data: employees = [] } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidaysList = [] } = useHolidays();
  const defaultSchedule = useMemo(() => (schedules as any[]).find(s => s.is_default) || (schedules as any[])[0] || null, [schedules]);
  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[]).filter(h => h.optional !== true).map(h => h.holiday_date)),
    [holidaysList],
  );
  const { data: workdaySwaps = [] } = useWorkdaySwaps();
  const { swapWorkedSet, swapOffSet } = useMemo(() => buildSwapSets(workdaySwaps), [workdaySwaps]);

  const [mode, setMode] = useState<Mode>('mes');
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [selected, setSelected] = useState<AtrasoRow | null>(null);
  const { from, to } = useMemo(() => periodRange(mode, cFrom, cTo), [mode, cFrom, cTo]);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ['relatorio-atrasos', from, to, (employees as any[]).length, (schedules as any[]).length, holidaysSet.size, swapWorkedSet.size, swapOffSet.size],
    enabled: !!from && !!to && from <= to && (employees as any[]).length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<AtrasoRow[]> => {
      // Batidas do período via fonte ÚNICA paginada (mesma da folha e do
      // comparativo/calendário) — motores do RH sincronizados.
      const recs = await fetchTimeRecordsInRange(from, to);

      // Mapas de batida por matrícula/nome (mesma lógica da folha).
      const byExternalId = new Map<string, Map<string, string[]>>();
      const byExtIdName = new Map<string, Map<string, string[]>>();
      const byName = new Map<string, Map<string, string[]>>();
      const extIdNames = new Map<string, Set<string>>();
      for (const r of recs) {
        const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
        const nameKey = (r.employee_name || '').toLowerCase().trim();
        if (r.employee_external_id) {
          const k = String(r.employee_external_id);
          if (!byExternalId.has(k)) byExternalId.set(k, new Map());
          byExternalId.get(k)!.set(r.record_date, punches);
          if (!extIdNames.has(k)) extIdNames.set(k, new Set());
          if (nameKey) extIdNames.get(k)!.add(nameKey);
          const kn = `${k}|${nameKey}`;
          if (!byExtIdName.has(kn)) byExtIdName.set(kn, new Map());
          byExtIdName.get(kn)!.set(r.record_date, punches);
        }
        if (nameKey) {
          if (!byName.has(nameKey)) byName.set(nameKey, new Map());
          byName.get(nameKey)!.set(r.record_date, punches);
        }
      }

      const out: AtrasoRow[] = [];
      for (const emp of (employees as any[]).filter(e => e.active)) {
        const extKey = emp.external_id ? String(emp.external_id) : '';
        const nameKey = (emp.name || '').toLowerCase().trim();
        const extShared = !!extKey && (extIdNames.get(extKey)?.size || 0) > 1;
        const empPunches = (extKey ? byExtIdName.get(`${extKey}|${nameKey}`) : null)
          || (!extShared && extKey ? byExternalId.get(extKey) : null)
          || byName.get(nameKey)
          || new Map<string, string[]>();
        const sch = (emp.work_schedule_id && (schedules as any[]).find(s => s.id === emp.work_schedule_id)) || defaultSchedule;
        const res = computePeriodFolha({
          salary: Number(emp.salary) || 0, from, to, schedule: sch, holidaysSet, swapWorkedSet, swapOffSet,
          punchesByDate: empPunches,
          payRegime: (String(emp.payment_type || 'mensalista').toLowerCase() as 'mensalista' | 'remoto' | 'diarista'),
          dailyRate: Number(emp.daily_rate) || 0,
        });
        const late = (res.late_days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        if (late.length > 0) {
          out.push({
            id: emp.id, name: emp.name, days: late, totalMin: late.reduce((s, d) => s + d.minutes, 0),
            punchesByDate: empPunches, schedule: sch, salary: Number(emp.salary) || 0,
          });
        }
      }
      return out.sort((a, b) => b.totalMin - a.totalMin);
    },
  });

  const totals = useMemo(() => ({
    funcionarios: rows.length,
    dias: rows.reduce((s, r) => s + r.days.length, 0),
    minutos: rows.reduce((s, r) => s + r.totalMin, 0),
  }), [rows]);

  const periodBtn = (m: Mode, label: string) => (
    <Button type="button" variant={mode === m ? 'default' : 'outline'} size="sm" className="h-9" onClick={() => setMode(m)}>{label}</Button>
  );

  return (
    <div className="space-y-4">
      {/* período */}
      <div className="flex flex-wrap items-end gap-2">
        {periodBtn('q1', '1ª quinz.')}
        {periodBtn('q2', '2ª quinz.')}
        {periodBtn('mes', 'Mês')}
        <div className="flex items-center gap-1.5">
          <Input type="date" value={mode === 'custom' ? cFrom : from} onChange={(e) => { setMode('custom'); setCFrom(e.target.value); }} className="h-9 w-40" />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" value={mode === 'custom' ? cTo : to} onChange={(e) => { setMode('custom'); setCTo(e.target.value); }} className="h-9 w-40" />
        </div>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Funcionários com atraso', value: String(totals.funcionarios), icon: Users },
          { label: 'Dias com atraso', value: String(totals.dias), icon: Timer },
          { label: 'Tempo total atrasado', value: fmtMin(totals.minutos), icon: Clock, accent: true },
        ].map((k) => (
          <div key={k.label} className={`rounded-lg border p-3 ${k.accent ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card'}`}>
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </p>
            <p className={`mt-1 tabular-nums font-bold leading-none ${k.accent ? 'text-2xl text-amber-600 dark:text-amber-400' : 'text-xl text-foreground'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <Panel
        eyebrow={`ATRASOS · ${fmtDia(from)}–${fmtDia(to)}`}
        title="Resumo por funcionário"
        subtitle="Clique num funcionário para ver o calendário e os horários do relógio"
        actions={rows.length > 0 ? (
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => printAtrasoSummary(rows, from, to)}>
            <FilePdf className="h-4 w-4" /> PDF do relatório
          </Button>
        ) : undefined}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle} title="Nenhum atraso no período" description="Todos os funcionários cumpriram a jornada esperada nos dias com ponto registrado." />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setSelected(r)}
                className="w-full flex flex-col gap-2 py-3 text-left sm:flex-row sm:items-start sm:justify-between hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors group"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    {r.name}
                    <CaretRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                  {/* dias atrasados, bem simplificado: dd/mm (dow) · tempo */}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.days.map((d) => (
                      <span key={d.date} className="inline-flex items-baseline gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs">
                        <span className="font-mono tabular-nums text-foreground">{fmtDia(d.date)}</span>
                        <span className="text-muted-foreground">{dowShort(d.date)}</span>
                        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtMin(d.minutes)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400 leading-none">{fmtMin(r.totalMin)}</p>
                  <p className="text-[11px] text-muted-foreground">{r.days.length} dia{r.days.length === 1 ? '' : 's'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <AtrasoCalendarDialog row={selected} from={from} to={to} onClose={() => setSelected(null)} />
    </div>
  );
}
