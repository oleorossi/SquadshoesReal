// RelatorioFaltas — relatório de FALTAS por funcionário no período. Espelha o
// visual do RelatorioAtrasos (calendário do mês com os dias destacados), mas em
// vez de atrasos mostra APENAS os dias em que o funcionário FALTOU (dia útil
// esperado, coberto por importação, SEM batida e SEM ausência justificada).
//
// Fonte da verdade: o MESMO motor da folha (computePeriodFolha → falta_dates), então
// a falta aqui bate EXATAMENTE com a coluna FALTAS da Folha do Mês e com o desconto
// aplicado no líquido (falta_desconto = nº faltas × salário/30).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useSwapSets, useWorkSchedules } from '@/hooks/useTimesheet';
import { computePeriodFolha, SALARY_DAY_DIVISOR, expectedDayMinutes } from '@/lib/salaryPayroll';
import { fetchTimeRecordsInRange } from '@/lib/ponto/fetchTimeRecords';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CircleNotch as Loader2, UserMinus, CalendarX, Users, CheckCircle, CalendarBlank, CaretRight } from '@phosphor-icons/react';

const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDia = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const dowShort = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(iso + 'T12:00:00').getUTCDay()];
const hhmm = (t: string) => String(t || '').slice(0, 5);
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

interface FaltaRow {
  id: string;
  name: string;
  /** Datas (YYYY-MM-DD) em que o funcionário faltou (dia útil coberto sem batida). */
  days: string[];
  /** Batidas por data (do relógio) — alimenta o calendário (dias trabalhados). */
  punchesByDate: Map<string, string[]>;
  schedule: any;
  /** Salário mensal — pra calcular o R$ descontado (= nº faltas × salário/30). */
  salary: number;
}

function monthsBetween(from: string, to: string): { y: number; m: number }[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) { out.push({ y, m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const MES_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ─── Calendário de faltas de UM funcionário ──────────────────────────────────
function FaltaCalendarDialog({ row, from, to, onClose }: { row: FaltaRow | null; from: string; to: string; onClose: () => void }) {
  if (!row) return null;
  const valorDia = (Number(row.salary) || 0) / SALARY_DAY_DIVISOR;
  const faltaSet = new Set(row.days);
  const totalRS = row.days.length * valorDia;
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
                <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Faltas · {fmtDia(from)}–{fmtDia(to)}</span>
                <span className="text-xl font-extrabold tracking-tight">{row.name}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total de faltas</span>
              <span className="text-2xl font-extrabold tabular-nums text-red-600 dark:text-red-400 leading-none">{row.days.length}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{row.days.length} dia{row.days.length === 1 ? '' : 's'} · desconto {fmtBRL(totalRS)}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="-mt-1">
          <p className="text-xs text-muted-foreground">
            Jornada esperada: <strong className="text-foreground">{expWindow}</strong> ({fmtMin(expMin)}/dia). Falta = dia útil coberto pelo relógio, sem batida e sem ausência justificada.
          </p>
        </div>

        {/* Calendário(s) do período — só os dias de FALTA ficam destacados */}
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
                    const isFalta = faltaSet.has(date);
                    return (
                      <div
                        key={date}
                        className={[
                          'rounded-md border p-1 min-h-[3.25rem] flex flex-col',
                          !inPeriod ? 'opacity-30 border-border/40' : '',
                          isFalta ? 'border-red-500/40 bg-red-500/10'
                            : punches.length > 0 ? 'border-border bg-card'
                            : 'border-border/40 bg-muted/20',
                        ].join(' ')}
                      >
                        <span className={`text-[10px] font-bold tabular-nums leading-none ${isFalta ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}`}>{day}</span>
                        {isFalta ? (
                          <span className="mt-auto">
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400 leading-tight">Falta</span>
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

        {/* Detalhe dia-a-dia das faltas */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Dias de falta</span>
            <span>Desconto</span>
          </div>
          <div className="divide-y divide-border">
            {row.days.map((date) => (
              <div key={date} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums">
                    {fmtDia(date)} <span className="text-xs font-normal text-muted-foreground">{dowShort(date)}</span>
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">sem batidas</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums text-red-600 dark:text-red-400 leading-none">−1 dia</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground mt-0.5">{fmtBRL(valorDia)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RelatorioFaltas() {
  const { data: employees = [] } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidaysList = [] } = useHolidays();
  const defaultSchedule = useMemo(() => (schedules as any[]).find(s => s.is_default) || (schedules as any[])[0] || null, [schedules]);
  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[]).filter(h => h.optional !== true).map(h => h.holiday_date)),
    [holidaysList],
  );
  const { swapWorkedSet, swapOffSet } = useSwapSets();
  // Chave de conteúdo (datas ordenadas), não .size — trocar uma data por outra de
  // mesma contagem precisa invalidar o cache do relatório.
  const swapKey = useMemo(
    () => [...swapWorkedSet].sort().join(',') + '|' + [...swapOffSet].sort().join(','),
    [swapWorkedSet, swapOffSet],
  );

  const [mode, setMode] = useState<Mode>('mes');
  const [cFrom, setCFrom] = useState(todayISO());
  const [cTo, setCTo] = useState(todayISO());
  const [selected, setSelected] = useState<FaltaRow | null>(null);
  const { from, to } = useMemo(() => periodRange(mode, cFrom, cTo), [mode, cFrom, cTo]);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ['relatorio-faltas', from, to, (employees as any[]).length, (schedules as any[]).length, holidaysSet.size, swapKey],
    enabled: !!from && !!to && from <= to && (employees as any[]).length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<FaltaRow[]> => {
      // Batidas do período via fonte ÚNICA paginada (mesma da folha e do calendário).
      const recs = await fetchTimeRecordsInRange(from, to);

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

      const out: FaltaRow[] = [];
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
        const faltas = (res.falta_dates || []).slice().sort((a, b) => a.localeCompare(b));
        if (faltas.length > 0) {
          out.push({
            id: emp.id, name: emp.name, days: faltas,
            punchesByDate: empPunches, schedule: sch, salary: Number(emp.salary) || 0,
          });
        }
      }
      return out.sort((a, b) => b.days.length - a.days.length);
    },
  });

  const totals = useMemo(() => {
    const dias = rows.reduce((s, r) => s + r.days.length, 0);
    const desconto = rows.reduce((s, r) => s + r.days.length * ((Number(r.salary) || 0) / SALARY_DAY_DIVISOR), 0);
    return { funcionarios: rows.length, dias, desconto };
  }, [rows]);

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
          { label: 'Funcionários com falta', value: String(totals.funcionarios), icon: Users },
          { label: 'Total de faltas', value: String(totals.dias), icon: CalendarX, accent: true },
          { label: 'Desconto estimado', value: fmtBRL(totals.desconto), icon: UserMinus },
        ].map((k) => (
          <div key={k.label} className={`rounded-lg border p-3 ${k.accent ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card'}`}>
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </p>
            <p className={`mt-1 tabular-nums font-bold leading-none ${k.accent ? 'text-2xl text-red-600 dark:text-red-400' : 'text-xl text-foreground'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <Panel
        eyebrow={`FALTAS · ${fmtDia(from)}–${fmtDia(to)}`}
        title="Resumo por funcionário"
        subtitle="Clique num funcionário para ver o calendário com os dias de falta"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle} title="Nenhuma falta no período" description="Todos os funcionários bateram ponto nos dias úteis cobertos pelo relógio." />
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
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.days.map((date) => (
                      <span key={date} className="inline-flex items-baseline gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs">
                        <span className="font-mono tabular-nums text-foreground">{fmtDia(date)}</span>
                        <span className="text-muted-foreground">{dowShort(date)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400 leading-none">{r.days.length}</p>
                  <p className="text-[11px] text-muted-foreground">falta{r.days.length === 1 ? '' : 's'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <FaltaCalendarDialog row={selected} from={from} to={to} onClose={() => setSelected(null)} />
    </div>
  );
}
