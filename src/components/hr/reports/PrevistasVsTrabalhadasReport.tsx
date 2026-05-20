import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Target, Download, TrendUp as TrendingUp, TrendDown as TrendingDown } from '@phosphor-icons/react';
import { Progress } from '@/components/ui/progress';
import { useEmployees } from '@/hooks/useEmployees';
import { useTimeRecords, useWorkSchedules, calculateDaySummary, useHolidays } from '@/hooks/useTimesheet';
import { buildEmployeeLookup, lookupLinkedEmployee } from '@/lib/timeRecordLink';

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

  const empLookup = useMemo(() => buildEmployeeLookup(employees), [employees]);

  const scheduleMap = useMemo(() => new Map(schedules.map(s => [s.id, s])), [schedules]);
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays]);

  const defaultSchedule = useMemo(() =>
    schedules.find(s => s.is_default) || schedules[0],
    [schedules]
  );

  // Agrupa por funcionário, somando previsto vs trabalhado.
  // Records sem vínculo com employee ATIVO (ou sem external_id coligado) são
  // pulados — funcionários demitidos cujo ID/nome ainda vem do relógio não
  // aparecem mais. Contador `skippedUnlinked` é exposto pra mostrar aviso.
  const { rows, skippedUnlinked, skippedNames } = useMemo(() => {
    const map = new Map<string, {
      name: string;
      empId: string;
      department: string;
      scheduleName: string;
      expected: number;
      worked: number;
      diasComBatida: number;
      diasSemBatida: number;
    }>();
    let skipped = 0;
    const skippedSet = new Set<string>();

    for (const rec of records) {
      const emp = lookupLinkedEmployee(rec, empLookup);
      if (!emp) {
        skipped++;
        skippedSet.add(rec.employee_name);
        continue;
      }
      const schedule = (emp.work_schedule_id && scheduleMap.get(emp.work_schedule_id)) || defaultSchedule;
      if (!schedule) continue;

      const recDate = new Date(rec.record_date + 'T00:00:00');
      const dow = recDate.getDay();
      const isHoliday = holidaySet.has(rec.record_date);
      const summary = calculateDaySummary(rec.punches as string[], dow, schedule, isHoliday);

      const cur = map.get(emp.id) || {
        name: emp.name,
        empId: emp.id,
        department: emp.department || '—',
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
      map.set(emp.id, cur);
    }

    const result = Array.from(map.values())
      .map(r => ({
        ...r,
        diff: r.worked - r.expected,
        pct: r.expected > 0 ? (r.worked / r.expected) * 100 : 0,
      }))
      .sort((a, b) => b.expected - a.expected);

    return { rows: result, skippedUnlinked: skipped, skippedNames: Array.from(skippedSet) };
  }, [records, empLookup, scheduleMap, defaultSchedule, holidaySet]);

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
    <div className="editorial-stagger space-y-8 page-enter">
      {/* ─────────── MASTHEAD ─────────── */}
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label text-foreground">RH · Relatório</span>
          <span className="section-label font-mono">{from} → {to}</span>
        </div>
        <div className="rule-line mb-4" />
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <p className="section-label mb-2">Aderência · Escala vs Ponto</p>
            <h1 className="text-display-lg leading-none">
              Previstas
              <span className="text-primary"> × </span>
              Trabalhadas
            </h1>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">
              Compara as horas previstas pela escala com o trabalhado real (a partir das batidas de ponto).
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40 h-9" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40 h-9" />
            <Button size="sm" className="h-9 gap-1.5" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> CSV</Button>
          </div>
        </div>
        <div className="rule-line-double mt-5" />
      </div>

      {/* Aviso: registros ignorados por falta de coligação no /rh/funcionarios. */}
      {skippedUnlinked > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-500">
            {skippedUnlinked} registro{skippedUnlinked !== 1 ? 's' : ''} ignorado{skippedUnlinked !== 1 ? 's' : ''} — funcionário não coligado
          </p>
          <p className="text-muted-foreground mt-1">
            Batidas do relógio cujo ID/nome não vincula a um funcionário ativo do sistema não entram no relatório.
            {skippedNames.length > 0 && (
              <>
                {' '}Nomes pulados: <span className="font-mono">{skippedNames.slice(0, 5).join(', ')}{skippedNames.length > 5 ? `, …+${skippedNames.length - 5}` : ''}</span>.
              </>
            )}
            {' '}Pra incluí-los, cadastre em <span className="font-mono">/rh/funcionarios</span> e preencha o "ID no Relógio".
          </p>
        </div>
      )}

      {/* ─────────── 01 / INDICADORES ─────────── */}
      <section>
        <div className="flex items-baseline gap-3 mb-5">
          <span className="font-display text-2xl leading-none">01</span>
          <span className="section-label text-foreground">Indicadores do Período</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-y border-border">
          <div className="px-4 py-5">
            <p className="section-label mb-2">Funcionários</p>
            <p className="font-mono font-bold leading-none tracking-tight text-2xl text-foreground">{totals.empCount}</p>
          </div>
          <div className="px-4 py-5 border-l border-border">
            <p className="section-label mb-2">Total previsto</p>
            <p className="font-mono font-bold leading-none tracking-tight text-2xl text-foreground">{fmtMin(totals.expected)}</p>
          </div>
          <div className="px-4 py-5 border-l border-border">
            <p className="section-label mb-2">Total trabalhado</p>
            <p className="font-mono font-bold leading-none tracking-tight text-2xl text-emerald-600">{fmtMin(totals.worked)}</p>
          </div>
          <div className="px-4 py-5 border-l border-border">
            <p className="section-label mb-2">Cumprimento</p>
            <p className={`font-mono font-bold leading-none tracking-tight text-2xl flex items-center gap-2 ${cumprimento >= 100 ? 'text-emerald-600' : cumprimento < 90 ? 'text-rose-600' : 'text-amber-600'}`}>
              {cumprimento >= 100 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {cumprimento.toFixed(1)}%
            </p>
            <Progress value={Math.min(150, cumprimento)} className="h-1 mt-2" />
          </div>
        </div>
      </section>

      {/* ─────────── 02 / COMPARATIVO ─────────── */}
      {rows.length === 0 ? (
        <div className="py-16 text-center border-y border-border">
          <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="section-label mb-1">Sem dados</p>
          <p className="text-sm text-muted-foreground">Nenhum registro de ponto no período.</p>
        </div>
      ) : (
        <section>
          <div className="flex items-baseline gap-3 mb-5">
            <span className="font-display text-2xl leading-none">02</span>
            <span className="section-label text-foreground">Comparativo por Funcionário</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="section-label text-foreground">Funcionário</TableHead>
                <TableHead className="section-label text-foreground">Setor</TableHead>
                <TableHead className="section-label text-foreground">Escala</TableHead>
                <TableHead className="section-label text-foreground text-right">Previsto</TableHead>
                <TableHead className="section-label text-foreground text-right">Trabalhado</TableHead>
                <TableHead className="section-label text-foreground text-right">Diferença</TableHead>
                <TableHead className="section-label text-foreground text-right">% cumpr.</TableHead>
                <TableHead className="section-label text-foreground text-center">Dias</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const variant = r.diff < -120 ? 'rose' : r.diff > 120 ? 'emerald' : 'muted';
                return (
                  <TableRow key={r.name} className="border-b border-border/60">
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
                      <div className="text-xs flex flex-col items-center gap-0.5">
                        <Badge variant="outline" className="h-4 px-1 text-xs">{r.diasComBatida} c/</Badge>
                        {r.diasSemBatida > 0 && (
                          <Badge variant="outline" className="h-4 px-1 text-xs border-rose-300 text-rose-700">{r.diasSemBatida} s/</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
