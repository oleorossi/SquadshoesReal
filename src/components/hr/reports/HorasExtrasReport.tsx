import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, AlarmClock, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useEmployees } from '@/hooks/useEmployees';
import { usePayrollRuns } from '@/hooks/useRH';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

export default function HorasExtrasReport() {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);

  const { data: employees = [] } = useEmployees();
  const { data: runs = [], isLoading } = usePayrollRuns(period);

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    return runs
      .map(r => {
        const emp = empMap.get(r.employee_id);
        return {
          id: r.employee_id,
          name: emp?.name || '—',
          department: emp?.department || '—',
          baseSalary: Number(r.base_salary) || 0,
          hourlyRate: Number(r.hourly_rate) || 0,
          ot50Min: Number(r.overtime_50_minutes) || 0,
          ot100Min: Number(r.overtime_100_minutes) || 0,
          nightMin: Number(r.night_minutes) || 0,
          ot50Value: Number(r.overtime_50_value) || 0,
          ot100Value: Number(r.overtime_100_value) || 0,
          nightValue: Number(r.night_bonus_value) || 0,
          dsr: Number(r.dsr_value) || 0,
          totalMin: (Number(r.overtime_50_minutes) || 0) + (Number(r.overtime_100_minutes) || 0),
          totalValue: (Number(r.overtime_50_value) || 0) + (Number(r.overtime_100_value) || 0) + (Number(r.night_bonus_value) || 0) + (Number(r.dsr_value) || 0),
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [runs, empMap]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      ot50Min: acc.ot50Min + r.ot50Min,
      ot100Min: acc.ot100Min + r.ot100Min,
      nightMin: acc.nightMin + r.nightMin,
      totalValue: acc.totalValue + r.totalValue,
      countWithOT: acc.countWithOT + (r.totalMin > 0 ? 1 : 0),
    }), { ot50Min: 0, ot100Min: 0, nightMin: 0, totalValue: 0, countWithOT: 0 });
  }, [rows]);

  // Por departamento
  const byDept = useMemo(() => {
    const map = new Map<string, { dept: string; minutes: number; value: number; count: number }>();
    for (const r of rows) {
      if (r.totalMin === 0) continue;
      const cur = map.get(r.department) || { dept: r.department, minutes: 0, value: 0, count: 0 };
      cur.minutes += r.totalMin;
      cur.value += r.totalValue;
      cur.count++;
      map.set(r.department, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [rows]);

  // Top 10
  const top10 = useMemo(() => rows.filter(r => r.totalMin > 0).slice(0, 10), [rows]);

  const exportCsv = () => {
    const headers = ['Funcionário', 'Setor', 'HE 50% min', 'HE 50% R$', 'HE 100% min', 'HE 100% R$', 'Adic. Noturno min', 'Adic. Noturno R$', 'DSR R$', 'Total R$'];
    const lines = rows.map(r => [
      r.name,
      r.department,
      r.ot50Min,
      r.ot50Value.toFixed(2).replace('.', ','),
      r.ot100Min,
      r.ot100Value.toFixed(2).replace('.', ','),
      r.nightMin,
      r.nightValue.toFixed(2).replace('.', ','),
      r.dsr.toFixed(2).replace('.', ','),
      r.totalValue.toFixed(2).replace('.', ','),
    ]);
    const csv = [headers, ...lines].map(row => row.map(c => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horas-extras-${period}.csv`;
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
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            <AlarmClock className="h-5 w-5 text-primary" />
            Relatório de Horas Extras
          </h1>
          <p className="text-sm text-muted-foreground">
            HE 50%, HE 100% (domingos/feriados) e adicional noturno do período. Dados vêm da folha calculada.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40" />
          <Button size="sm" onClick={exportCsv} className="gap-1.5"><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlarmClock className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Nenhuma folha calculada para {period}.</p>
            <p className="text-xs mt-1">Calcule a folha em <strong>Folha &gt; Folha do Mês</strong> primeiro.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">HE 50%</p>
              <p className="display text-xl tabular-nums">{fmtMin(totals.ot50Min)}</p>
              <p className="text-[10px] text-muted-foreground">{Math.round(totals.ot50Min / 60)}h</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">HE 100%</p>
              <p className="display text-xl tabular-nums text-amber-600">{fmtMin(totals.ot100Min)}</p>
              <p className="text-[10px] text-muted-foreground">Domingos/feriados</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">Adic. Noturno</p>
              <p className="display text-xl tabular-nums text-indigo-600">{fmtMin(totals.nightMin)}</p>
              <p className="text-[10px] text-muted-foreground">22h–5h</p>
            </CardContent></Card>
            <Card className="border-primary/40"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">Custo total HE</p>
              <p className="display text-xl tabular-nums text-primary">{fmt(totals.totalValue)}</p>
              <p className="text-[10px] text-muted-foreground">{totals.countWithOT} funcionário{totals.countWithOT !== 1 ? 's' : ''} com HE</p>
            </CardContent></Card>
          </div>

          {/* Top 10 */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Top 10 — Funcionários com mais HE</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 12, left: 60, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="ot50Value" name="HE 50%" stackId="a" fill="hsl(var(--primary))" />
                      <Bar dataKey="ot100Value" name="HE 100%" stackId="a" fill="hsl(var(--warning))" />
                      <Bar dataKey="nightValue" name="Noturno" stackId="a" fill="hsl(var(--stage-sew-fg))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Por setor</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Setor</TableHead>
                      <TableHead className="text-right">Funcionários c/ HE</TableHead>
                      <TableHead className="text-right">Total horas</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byDept.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhum dado.</TableCell></TableRow>
                    ) : byDept.map(d => (
                      <TableRow key={d.dept}>
                        <TableCell>{d.dept}</TableCell>
                        <TableCell className="text-right font-mono">{d.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMin(d.minutes)}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{fmt(d.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Detalhe por funcionário */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Detalhe por funcionário</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead className="text-right">HE 50%</TableHead>
                    <TableHead className="text-right">HE 100%</TableHead>
                    <TableHead className="text-right">Noturno</TableHead>
                    <TableHead className="text-right">DSR</TableHead>
                    <TableHead className="text-right font-bold">Total R$</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className={r.totalMin === 0 ? 'opacity-50' : ''}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.department}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.ot50Min > 0 ? `${fmtMin(r.ot50Min)} · ${fmt(r.ot50Value)}` : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.ot100Min > 0 ? `${fmtMin(r.ot100Min)} · ${fmt(r.ot100Value)}` : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.nightMin > 0 ? `${fmtMin(r.nightMin)} · ${fmt(r.nightValue)}` : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.dsr > 0 ? fmt(r.dsr) : '—'}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{r.totalValue > 0 ? fmt(r.totalValue) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
