import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CircleNotch as Loader2, Alarm as AlarmClock, Download } from '@phosphor-icons/react';
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
    <div className="editorial-stagger space-y-8 page-enter">
      {/* ─────────── MASTHEAD ─────────── */}
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label text-foreground">RH · Relatório</span>
          <span className="section-label">{period}</span>
        </div>
        <div className="rule-line mb-4" />
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <p className="section-label mb-2">Horas Extras · Mensal</p>
            <h1 className="text-display-lg leading-none">
              Horas
              <span className="text-primary"> Extras</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">
              HE 50%, HE 100% (domingos/feriados) e adicional noturno do período. Dados vêm da folha calculada.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40 h-9" />
            <Button size="sm" className="h-9 gap-1.5" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> CSV</Button>
          </div>
        </div>
        <div className="rule-line-double mt-5" />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center border-y border-border">
          <AlarmClock className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="section-label mb-1">Sem dados</p>
          <p className="text-sm text-muted-foreground">Nenhuma folha calculada para {period}.</p>
          <p className="text-xs text-muted-foreground mt-1">Calcule a folha em <strong className="text-foreground">Folha &gt; Folha do Mês</strong> primeiro.</p>
        </div>
      ) : (
        <>
          {/* ─────────── 01 / INDICADORES ─────────── */}
          <section>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="font-display text-2xl leading-none">01</span>
              <span className="section-label text-foreground">Indicadores do Período</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border-y border-border">
              <KpiCell label="HE 50%" value={fmtMin(totals.ot50Min)} sub={`${Math.round(totals.ot50Min / 60)}h`} />
              <KpiCell label="HE 100%" value={fmtMin(totals.ot100Min)} sub="Domingos/feriados" bordered />
              <KpiCell label="Adic. Noturno" value={fmtMin(totals.nightMin)} sub="22h–5h" bordered />
              <KpiCell
                label="Custo total HE"
                value={fmt(totals.totalValue)}
                sub={`${totals.countWithOT} funcionário${totals.countWithOT !== 1 ? 's' : ''} com HE`}
                bordered
                accent
              />
            </div>
          </section>

          {/* ─────────── 02 / DISTRIBUIÇÃO ─────────── */}
          <section>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="font-display text-2xl leading-none">02</span>
              <span className="section-label text-foreground">Distribuição · Top 10 & Setores</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <p className="section-label mb-3">Top 10 · Funcionários com mais HE</p>
                <div className="h-72 border-t border-border pt-3">
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
              </div>

              <div>
                <p className="section-label mb-3">Por Setor</p>
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                      <TableHead className="section-label text-foreground">Setor</TableHead>
                      <TableHead className="section-label text-foreground text-right">Func. c/ HE</TableHead>
                      <TableHead className="section-label text-foreground text-right">Total horas</TableHead>
                      <TableHead className="section-label text-foreground text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byDept.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhum dado.</TableCell></TableRow>
                    ) : byDept.map(d => (
                      <TableRow key={d.dept} className="border-b border-border/60">
                        <TableCell>{d.dept}</TableCell>
                        <TableCell className="text-right font-mono">{d.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMin(d.minutes)}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{fmt(d.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>

          {/* ─────────── 03 / DETALHE ─────────── */}
          <section>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="font-display text-2xl leading-none">03</span>
              <span className="section-label text-foreground">Detalhe por Funcionário</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                  <TableHead className="section-label text-foreground">Funcionário</TableHead>
                  <TableHead className="section-label text-foreground">Setor</TableHead>
                  <TableHead className="section-label text-foreground text-right">HE 50%</TableHead>
                  <TableHead className="section-label text-foreground text-right">HE 100%</TableHead>
                  <TableHead className="section-label text-foreground text-right">Noturno</TableHead>
                  <TableHead className="section-label text-foreground text-right">DSR</TableHead>
                  <TableHead className="section-label text-foreground text-right">Total R$</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id} className={`border-b border-border/60 ${r.totalMin === 0 ? 'opacity-50' : ''}`}>
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
          </section>
        </>
      )}
    </div>
  );
}

function KpiCell({ label, value, sub, bordered, accent }: {
  label: string;
  value: string;
  sub?: string;
  bordered?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`px-4 py-5 ${bordered ? 'border-l border-border' : ''}`}>
      <p className="section-label mb-2">{label}</p>
      <p className={`font-mono font-bold leading-none tracking-tight text-2xl ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
