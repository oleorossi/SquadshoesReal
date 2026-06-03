import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Clock, CurrencyDollar as DollarSign, CaretRight, CaretDown,
  Warning as AlertTriangle, Users as Users2,
} from '@phosphor-icons/react';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useTimesheetCoverage } from '@/hooks/useTimesheet';
import {
  splitDayMinutes, calculateHourlyPayroll, MONTHLY_HOURS_DIVISOR,
  type HourlyDayInput, type HourlyPayrollResult,
} from '@/lib/hourlyPayroll';
import { usePersistedState } from '@/hooks/usePersistedState';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Período inválido (ex.: "2026-00") → [] (não gera datas tortas). */
function getMonthDays(period: string): { date: string; dow: number }[] {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return [];
  const last = new Date(y, m, 0).getDate();
  const out: { date: string; dow: number }[] = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m - 1, d);
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dow: dt.getDay() });
  }
  return out;
}

const fmtH = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBR = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—');
const cleanPunch = (p: string) => String(p).replace(/\*$/, '');

interface EmpRow {
  id: string;
  name: string;
  role?: string;
  days: { date: string; dow: number; isHoliday: boolean; punches: string[]; normal: number; premium: number }[];
  result: HourlyPayrollResult;
}

/**
 * Relatórios de RH — modelo ÚNICO de folha por hora (decisão 2026-06-02).
 *
 * Só DUAS coisas, porque é só o que o RH precisa:
 *   1. RELÓGIO DE PONTO — horas trabalhadas por funcionário (resumo + detalhe/dia).
 *   2. PAGAMENTO POR HORAS — quanto pagar a cada um pelas horas (valor-hora × horas).
 *
 * ⚠ ATENÇÃO (auditoria A1, 2026-06-03): estes números são por HORA TRABALHADA
 * (`hourlyPayroll`) e NÃO são a folha oficial. Desde 2026-06-03 a FOLHA paga por
 * SALÁRIO CHEIO − DESCONTOS (faltas/atrasos) em `src/lib/salaryPayroll.ts` (aba
 * Folha). Portanto o "pagamento por horas" aqui DIVERGE do líquido da folha — o
 * valor oficial é a aba Folha. Pendência: migrar estes relatórios pro motor da
 * folha (calculateSalaryPayroll) ou remover a coluna de pagamento.
 */
export default function RelatoriosRH() {
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [tab, setTab] = usePersistedState<string>('rh-relatorios-tab', 'ponto');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: employees = [] } = useEmployees();
  const { data: holidaysList = [] } = useHolidays();

  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[])
      .filter(h => h.optional !== true).map(h => h.holiday_date)),
    [holidaysList],
  );
  const monthDays = useMemo(() => getMonthDays(period), [period]);
  const periodRange = useMemo(
    () => ({ from: monthDays[0]?.date, to: monthDays[monthDays.length - 1]?.date }),
    [monthDays],
  );
  const { data: coverage } = useTimesheetCoverage(periodRange.from, periodRange.to);

  const { data: timeRecords = [], isLoading } = useQuery({
    queryKey: ['rh-report-records', periodRange.from, periodRange.to],
    enabled: !!(periodRange.from && periodRange.to),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_records')
        .select('employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;
      return (data || []) as { employee_external_id: string | null; employee_name: string | null; record_date: string; punches: string[] }[];
    },
  });

  const rows: EmpRow[] = useMemo(() => {
    // Mapas batida → dia, por matrícula e por nome (mesmo casamento da Folha).
    const byExternalId = new Map<string, Map<string, string[]>>();
    const byName = new Map<string, Map<string, string[]>>();
    for (const r of timeRecords) {
      const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
      if (r.employee_external_id) {
        const k = String(r.employee_external_id);
        if (!byExternalId.has(k)) byExternalId.set(k, new Map());
        byExternalId.get(k)!.set(r.record_date, punches);
      }
      const nk = (r.employee_name || '').toLowerCase().trim();
      if (nk) {
        if (!byName.has(nk)) byName.set(nk, new Map());
        byName.get(nk)!.set(r.record_date, punches);
      }
    }
    // Clamp à cobertura: só conta até o último dia com ponto importado.
    const maxCov = coverage?.maxCovered || null;
    const coveredDays = maxCov ? monthDays.filter(d => d.date <= maxCov) : monthDays;

    return employees
      .filter(e => e.active)
      .map(emp => {
        const extKey = (emp as { external_id?: string }).external_id ? String((emp as { external_id?: string }).external_id) : '';
        const empPunches = (extKey && byExternalId.get(extKey))
          || byName.get(emp.name.toLowerCase().trim())
          || new Map<string, string[]>();

        const days = coveredDays.map(d => {
          const punches = empPunches.get(d.date) || [];
          const { normal, premium } = punches.length >= 2
            ? splitDayMinutes(punches, d.dow, holidaysSet.has(d.date))
            : { normal: 0, premium: 0 };
          return { date: d.date, dow: d.dow, isHoliday: holidaysSet.has(d.date), punches, normal, premium };
        });

        const hourlyInput: HourlyDayInput[] = days.map(d => ({
          date: d.date, dayOfWeek: d.dow, isHoliday: d.isHoliday, punches: d.punches,
        }));
        const result = calculateHourlyPayroll(Number(emp.salary) || 0, hourlyInput, 0);

        return { id: emp.id, name: emp.name, role: (emp as { role?: string }).role, days, result };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [employees, timeRecords, monthDays, coverage, holidaysSet]);

  const totals = useMemo(() => ({
    normalMin: rows.reduce((s, r) => s + r.result.normal_minutes, 0),
    premiumMin: rows.reduce((s, r) => s + r.result.premium_minutes, 0),
    pagar: rows.reduce((s, r) => s + r.result.gross_value, 0),
  }), [rows]);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const isPartial = !!(coverage?.maxCovered && periodRange.to && coverage.maxCovered < periodRange.to);

  const Header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Horas trabalhadas e <strong>estimativa</strong> de pagamento por hora (valor-hora = salário ÷ {MONTHLY_HOURS_DIVISOR};
        após 18h / fim de semana / feriado = 1,5×).
      </p>
      <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40 h-9" />
    </div>
  );

  const CoverageBanner = isPartial ? (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Ponto importado só até <strong>{fmtBR(coverage!.maxCovered!)}</strong> neste mês — os dias seguintes ainda
        não entram (importe o resto na aba Ponto). Os números abaixo são <strong>parciais</strong>.
      </span>
    </div>
  ) : null;

  const Empty = (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Users2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhum funcionário ativo com ponto neste período.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {Header}
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <strong>Estimativa por horas trabalhadas</strong> — NÃO é a folha oficial. O pagamento é por{' '}
          <strong>salário cheio − descontos</strong> (faltas/atrasos); o valor a pagar está na aba <strong>Folha</strong>.
        </span>
      </div>
      {CoverageBanner}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'ponto', label: 'Relógio de Ponto', icon: Clock },
          { value: 'pagamento', label: 'Pagamento por Horas', icon: DollarSign },
        ]} />

        {/* ── RELÓGIO DE PONTO: resumo por funcionário + detalhe por dia ── */}
        <TabsContent value="ponto">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : rows.length === 0 ? Empty : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Horas por funcionário — clique para ver dia a dia
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Funcionário</TableHead>
                        <TableHead className="text-right">Dias trab.</TableHead>
                        <TableHead className="text-right">Horas normais</TableHead>
                        <TableHead className="text-right">Horas 1,5×</TableHead>
                        <TableHead className="text-right">Total horas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(r => {
                        const open = expanded.has(r.id);
                        return [
                          <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(r.id)}>
                            <TableCell className="text-muted-foreground">
                              {open ? <CaretDown className="h-4 w-4" /> : <CaretRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="font-medium">
                              {r.name}
                              {r.result.incomplete_days > 0 && (
                                <Badge className="ml-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal gap-1">
                                  <AlertTriangle className="h-3 w-3" />{r.result.incomplete_days} incompleto(s)
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.result.days_worked}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtH(r.result.normal_minutes)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                              {r.result.premium_minutes > 0 ? fmtH(r.result.premium_minutes) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmtH(r.result.worked_minutes)}</TableCell>
                          </TableRow>,
                          open && (
                            <TableRow key={`${r.id}-detail`} className="bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={5} className="py-2">
                                <div className="rounded-md border border-border/60 overflow-hidden">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Data</TableHead>
                                        <TableHead className="text-xs">Dia</TableHead>
                                        <TableHead className="text-xs">Batidas</TableHead>
                                        <TableHead className="text-xs text-right">Normais</TableHead>
                                        <TableHead className="text-xs text-right">1,5×</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {r.days.filter(d => d.punches.length > 0).length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground py-2">Sem batidas no período coberto.</TableCell></TableRow>
                                      ) : r.days.filter(d => d.punches.length > 0).map(d => (
                                        <TableRow key={d.date}>
                                          <TableCell className="text-xs tabular-nums">{fmtBR(d.date)}</TableCell>
                                          <TableCell className="text-xs">
                                            {DAYS_PT[d.dow]}{d.isHoliday && <span className="ml-1 text-amber-600">feriado</span>}
                                          </TableCell>
                                          <TableCell className="text-xs font-mono">{d.punches.map(cleanPunch).join(' · ')}</TableCell>
                                          <TableCell className="text-xs text-right tabular-nums">{fmtH(d.normal)}</TableCell>
                                          <TableCell className="text-xs text-right tabular-nums text-amber-700 dark:text-amber-400">{d.premium > 0 ? fmtH(d.premium) : '—'}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ),
                        ];
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── PAGAMENTO POR HORAS: quanto pagar a cada um pelas horas ── */}
        <TabsContent value="pagamento">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : rows.length === 0 ? Empty : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Quanto pagar pelas horas trabalhadas
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Funcionário</TableHead>
                        <TableHead className="text-right">Horas normais</TableHead>
                        <TableHead className="text-right">Horas 1,5×</TableHead>
                        <TableHead className="text-right">Valor-hora</TableHead>
                        <TableHead className="text-right">Total a pagar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtH(r.result.normal_minutes)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                            {r.result.premium_minutes > 0 ? fmtH(r.result.premium_minutes) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(r.result.hourly_rate)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(r.result.gross_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <tfoot>
                      <TableRow className="border-t-2 font-semibold bg-muted/30">
                        <TableCell>Total ({rows.length})</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtH(totals.normalMin)}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtH(totals.premiumMin)}</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtBRL(totals.pagar)}</TableCell>
                      </TableRow>
                    </tfoot>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
