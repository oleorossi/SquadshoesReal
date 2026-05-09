import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Target, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useEmployees } from '@/hooks/useEmployees';
import { useTimeRecords, useWorkSchedules, calculateDaySummary, useHolidays } from '@/hooks/useTimesheet';

const fmtMin = (m: number) => {
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

export default function PrevistasVsTrabalhadasReport() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);

  const { data: employees = [] } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { data: records = [], isLoading } = useTimeRecords(undefined, from, to);

  const empByName = useMemo(() => {
    const m = new Map<string, typeof employees[number]>();
    for (const e of employees) m.set(e.name.toLowerCase().trim(), e);
    return m;
  }, [employees]);

  const scheduleMap = useMemo(() => new Map(schedules.map(s => [s.id, s])), [schedules]);
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays]);

  const defaultSchedule = useMemo(() =>
    schedules.find(s => s.is_default) || schedules[0],
    [schedules]
  );

  // Agrupa por funcionário, somando previsto vs trabalhado
  const rows = useMemo(() => {
    const map = new Map<string, {
      name: string;
      empId: string | null;
      department: string;
      scheduleName: string;
      expected: number;
      worked: number;
      diasComBatida: number;
      diasSemBatida: number;
    }>();

    for (const rec of records) {
      const empName = rec.employee_name;
      const emp = empByName.get(empName.toLowerCase().trim());
      const schedule = (emp?.work_schedule_id && scheduleMap.get(emp.work_schedule_id)) || defaultSchedule;
      if (!schedule) continue;

      const recDate = new Date(rec.record_date + 'T00:00:00');
      const dow = recDate.getDay();
      const isHoliday = holidaySet.has(rec.record_date);
      const summary = calculateDaySummary(rec.punches as string[], dow, schedule, isHoliday);

      const cur = map.get(empName) || {
        name: empName,
        empId: emp?.id || null,
        department: emp?.department || '—',
        scheduleName: schedule.name,
        expected: 0,
        worked: 0,
        diasComBatida: 0,
        diasSemBatida: 0,
      };
      cur.expected += summary.expectedMinutes;
      cur.worked += summary.workedMinutes;
      if ((rec.punches as string[]).length > 0) cur.diasComBatida++;
      else if (summary.expectedMinutes > 0) cur.diasSemBatida++;
      map.set(empName, cur);
    }

    return Array.from(map.values())
      .map(r => ({
        ...r,
        diff: r.worked - r.expected,
        pct: r.expected > 0 ? (r.worked / r.expected) * 100 : 0,
      }))
      .sort((a, b) => b.expected - a.expected);
  }, [records, empByName, scheduleMap, defaultSchedule, holidaySet]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      expected: acc.expected + r.expected,
      worked: acc.worked + r.worked,
      empCount: acc.empCount + 1,
      negativos: acc.negativos + (r.diff < -60 ? 1 : 0),
      positivos: acc.positivos + (r.diff > 60 ? 1 : 0),
    }), { expected: 0, worked: 0, empCount: 0, negativos: 0, positivos: 0 });
  }, [rows]);

  const cumprimento = totals.expected > 0 ? (totals.worked / totals.expected) * 100 : 0;

  const exportCsv = () => {
    const headers = ['Funcionário', 'Setor', 'Escala', 'Horas Previstas', 'Horas Trabalhadas', 'Diferença', '% cumprimento', 'Dias c/ batida', 'Dias s/ batida'];
    const lines = rows.map(r => [
      r.name,
      r.department,
      r.scheduleName,
      fmtMin(r.expected),
      fmtMin(r.worked),
      fmtMin(r.diff),
      r.pct.toFixed(1).replace('.', ',') + '%',
      r.diasComBatida,
      r.diasSemBatida,
    ]);
    const csv = [headers, ...lines].map(row => row.map(c => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `previstas-vs-trabalhadas-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Horas Previstas × Trabalhadas
          </h1>
          <p className="text-sm text-muted-foreground">
            Compara as horas previstas pela escala com o trabalhado real (a partir das batidas de ponto).
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          <Button size="sm" onClick={exportCsv} className="gap-1.5"><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários no período</p>
          <p className="display text-2xl tabular-nums">{totals.empCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total previsto</p>
          <p className="display text-2xl tabular-nums">{fmtMin(totals.expected)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total trabalhado</p>
          <p className="text-2xl font-bold font-mono text-emerald-600">{fmtMin(totals.worked)}</p>
        </CardContent></Card>
        <Card className="border-primary/40"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Cumprimento global</p>
          <p className={`text-2xl font-bold flex items-center gap-1 ${cumprimento >= 100 ? 'text-emerald-600' : cumprimento < 90 ? 'text-rose-600' : 'text-amber-600'}`}>
            {cumprimento >= 100 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {cumprimento.toFixed(1)}%
          </p>
          <Progress value={Math.min(150, cumprimento)} className="h-1.5 mt-1" />
        </CardContent></Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum registro de ponto no período.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Comparativo por funcionário</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Escala</TableHead>
                  <TableHead className="text-right">Previsto</TableHead>
                  <TableHead className="text-right">Trabalhado</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead className="text-right">% cumpr.</TableHead>
                  <TableHead className="text-center">Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const variant = r.diff < -120 ? 'rose' : r.diff > 120 ? 'emerald' : 'muted';
                  return (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.department}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.scheduleName}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMin(r.expected)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMin(r.worked)}</TableCell>
                      <TableCell className={`text-right font-mono font-bold text-xs ${variant === 'rose' ? 'text-rose-600' : variant === 'emerald' ? 'text-emerald-600' : ''}`}>
                        {r.diff > 0 ? '+' : ''}{fmtMin(r.diff)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${r.pct >= 100 ? 'text-emerald-600' : r.pct < 90 ? 'text-rose-600' : 'text-amber-600'}`}>
                        {r.pct.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-[10px] flex flex-col items-center gap-0.5">
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">{r.diasComBatida} c/</Badge>
                          {r.diasSemBatida > 0 && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] border-rose-300 text-rose-700">{r.diasSemBatida} s/</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
