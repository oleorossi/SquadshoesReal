import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Repeat, TrendUp as TrendingUp, TrendDown as TrendingDown } from '@phosphor-icons/react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useEmployees } from '@/hooks/useEmployees';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${m}/${y.slice(2)}`;
}
function eachMonth(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    out.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export default function TurnoverReport() {
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const [from, setFrom] = useState(monthKey(defaultStart));
  const [to, setTo] = useState(monthKey(today));

  const { data: employees = [], isLoading } = useEmployees();

  const months = useMemo(() => {
    const f = new Date(from + '-01T00:00:00');
    const t = new Date(to + '-01T00:00:00');
    return eachMonth(f, t);
  }, [from, to]);

  const series = useMemo(() => {
    return months.map(mk => {
      const [y, m] = mk.split('-').map(Number);
      const lastDay = new Date(y, m, 0);
      const firstDay = new Date(y, m - 1, 1);

      let activeStart = 0;
      let activeEnd = 0;
      let admitted = 0;
      let dismissed = 0;
      for (const e of employees) {
        if (!e.admission_date) continue;
        const adm = new Date(e.admission_date + 'T00:00:00');
        const updated = e.updated_at ? new Date(e.updated_at) : null;

        // Ativo no INÍCIO do mês: admitido antes do mês E (ainda ativo OU updated_at após mês)
        if (adm < firstDay) {
          const stillActiveAtStart = e.active || (updated && updated > firstDay);
          if (stillActiveAtStart) activeStart++;
        }
        // Ativo no FIM do mês
        if (adm <= lastDay) {
          const stillActiveAtEnd = e.active || (updated && updated > lastDay);
          if (stillActiveAtEnd) activeEnd++;
        }
        if (adm >= firstDay && adm <= lastDay) admitted++;
        if (!e.active && updated && updated >= firstDay && updated <= lastDay) dismissed++;
      }

      const avgActive = (activeStart + activeEnd) / 2;
      // Turnover% (simple) = ((adm + dem) / 2) / mediaQuadro × 100
      const turnoverPct = avgActive > 0 ? ((admitted + dismissed) / 2 / avgActive) * 100 : 0;
      // Loss-only turnover (involuntary)
      const lossPct = avgActive > 0 ? (dismissed / avgActive) * 100 : 0;

      return {
        month: mk,
        label: monthLabel(mk),
        activeEnd,
        admitted,
        dismissed,
        net: admitted - dismissed,
        turnoverPct: Number(turnoverPct.toFixed(2)),
        lossPct: Number(lossPct.toFixed(2)),
      };
    });
  }, [months, employees]);

  const totals = useMemo(() => {
    const admitted = series.reduce((s, p) => s + p.admitted, 0);
    const dismissed = series.reduce((s, p) => s + p.dismissed, 0);
    const last = series[series.length - 1];
    const first = series[0];
    const net = (last?.activeEnd ?? 0) - (first?.activeEnd ?? 0);
    const avgActive = series.reduce((s, p) => s + p.activeEnd, 0) / Math.max(1, series.length);
    const meanTurnover = avgActive > 0 ? ((admitted + dismissed) / 2 / avgActive / series.length) * 100 * series.length : 0;

    // Tempo médio de casa (snapshot atual de ativos)
    const now = new Date();
    const tenuresMonths = employees
      .filter(e => e.active && e.admission_date)
      .map(e => {
        const adm = new Date(e.admission_date + 'T00:00:00');
        return (now.getTime() - adm.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      });
    const avgTenure = tenuresMonths.length > 0 ? tenuresMonths.reduce((s, t) => s + t, 0) / tenuresMonths.length : 0;

    return { admitted, dismissed, net, meanTurnover, avgTenure, periodMonths: series.length };
  }, [series, employees]);

  // Por departamento (snapshot)
  const byDept = useMemo(() => {
    const map = new Map<string, { dept: string; active: number; tenureMonths: number; lastChange?: Date | null }>();
    const now = new Date();
    for (const e of employees) {
      const dept = e.department || 'Sem setor';
      const cur = map.get(dept) || { dept, active: 0, tenureMonths: 0 };
      if (e.active && e.admission_date) {
        cur.active++;
        const adm = new Date(e.admission_date + 'T00:00:00');
        cur.tenureMonths += (now.getTime() - adm.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      }
      map.set(dept, cur);
    }
    return Array.from(map.values())
      .filter(d => d.active > 0)
      .map(d => ({ ...d, avgTenure: d.active > 0 ? d.tenureMonths / d.active : 0 }))
      .sort((a, b) => b.active - a.active);
  }, [employees]);

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
            <Repeat className="h-5 w-5 text-primary" />
            Turnover
          </h1>
          <p className="text-sm text-muted-foreground">
            Rotatividade de pessoal mês a mês. Turnover = ((admissões + dispensas) / 2) ÷ quadro médio.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="month" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">→</span>
          <Input type="month" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Admissões no período</p>
          <p className="text-2xl font-bold text-emerald-600">+{totals.admitted}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Dispensas no período</p>
          <p className="text-2xl font-bold text-rose-600">-{totals.dismissed}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo</p>
          <p className={`text-2xl font-bold flex items-center gap-1 ${totals.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {totals.net >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {totals.net >= 0 ? '+' : ''}{totals.net}
          </p>
        </CardContent></Card>
        <Card className="border-primary/40"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Tempo médio de casa</p>
          <p className="text-2xl font-bold font-mono text-primary">
            {totals.avgTenure < 12 ? `${totals.avgTenure.toFixed(1)}m` : `${(totals.avgTenure / 12).toFixed(1)}a`}
          </p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Turnover mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: '#', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: '%', angle: 90, position: 'insideRight', fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="admitted" name="Admitidos" fill="#10b981" />
                <Bar yAxisId="left" dataKey="dismissed" name="Dispensados" fill="#ef4444" />
                <Line yAxisId="right" type="monotone" dataKey="turnoverPct" name="Turnover %" stroke="hsl(var(--primary))" strokeWidth={2.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhe mês a mês</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Quadro fim</TableHead>
                  <TableHead className="text-right">Adm.</TableHead>
                  <TableHead className="text-right">Dem.</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Turnover %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map(p => (
                  <TableRow key={p.month}>
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{p.activeEnd}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{p.admitted > 0 ? '+' + p.admitted : '0'}</TableCell>
                    <TableCell className="text-right font-mono text-rose-600">{p.dismissed > 0 ? '-' + p.dismissed : '0'}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${p.net > 0 ? 'text-emerald-600' : p.net < 0 ? 'text-rose-600' : ''}`}>
                      {p.net > 0 ? '+' : ''}{p.net}
                    </TableCell>
                    <TableCell className="text-right font-mono">{p.turnoverPct.toFixed(2)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Tempo de casa por setor</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setor</TableHead>
                  <TableHead className="text-right">Ativos</TableHead>
                  <TableHead className="text-right">Tempo médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byDept.map(d => (
                  <TableRow key={d.dept}>
                    <TableCell><Badge variant="secondary">{d.dept}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{d.active}</TableCell>
                    <TableCell className="text-right font-mono">
                      {d.avgTenure < 12 ? `${d.avgTenure.toFixed(1)} meses` : `${(d.avgTenure / 12).toFixed(1)} anos`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
