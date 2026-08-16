import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Users, TrendUp as TrendingUp, TrendDown as TrendingDown } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { useEmployees } from '@/hooks/useEmployees';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { employeeIsEmployedOnDate } from '@/lib/employeeEmployment';

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

export default function HeadcountReport() {
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

  /** Reconstrói cada mês pelas datas reais do vínculo, sem usar updated_at como demissão. */
  const series = useMemo(() => {
    return months.map(mk => {
      const [y, m] = mk.split('-').map(Number);
      const lastDay = new Date(y, m, 0);
      const firstDay = new Date(y, m - 1, 1);
      const firstIso = `${mk}-01`;
      const lastIso = `${mk}-${String(lastDay.getDate()).padStart(2, '0')}`;

      let active = 0;
      let admitted = 0;
      let dismissed = 0;
      for (const e of employees) {
        if (!e.admission_date) continue;
        const adm = new Date(e.admission_date + 'T00:00:00');
        if (adm > lastDay) continue;
        // Admitido neste mês
        if (adm >= firstDay && adm <= lastDay) admitted++;
        if (employeeIsEmployedOnDate(e, lastIso)) active++;
        if (e.termination_date && e.termination_date >= firstIso && e.termination_date <= lastIso) dismissed++;
      }
      return { month: mk, label: monthLabel(mk), active, admitted, dismissed, net: admitted - dismissed };
    });
  }, [months, employees]);

  const last = series[series.length - 1];
  const first = series[0];
  const totalGrowth = last && first ? last.active - first.active : 0;
  const totalAdmitted = series.reduce((s, p) => s + p.admitted, 0);
  const totalDismissed = series.reduce((s, p) => s + p.dismissed, 0);

  // Por departamento (snapshot atual)
  const byDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees.filter(x => x.active)) {
      const d = e.department || 'Sem setor';
      map.set(d, (map.get(d) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
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
      <EditorialPageHeader
        sectionLabel="RH · HEADCOUNT"
        title="Headcount evolutivo"
        description="Evolução do quadro de funcionários por mês — admitidos, dispensados, saldo líquido."
        actions={
          <>
            <Input type="month" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
            <span className="text-muted-foreground">→</span>
            <Input type="month" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          </>
        }
      />

      {/* KPIs */}
      <StatGrid>
        <StatCard label="Funcionários hoje" value={last?.active ?? 0} hint="quadro ativo" />
        <StatCard
          label="Saldo no período"
          value={`${totalGrowth >= 0 ? '+' : ''}${totalGrowth}`}
          hint="admissões − desligamentos"
          tone={totalGrowth >= 0 ? 'success' : 'destructive'}
        />
        <StatCard label="Admissões" value={totalAdmitted} hint="no período" tone="success" />
        <StatCard label="Desligamentos" value={totalDismissed} hint="no período" tone="destructive" />
      </StatGrid>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Linha — evolução do total */}
        <Panel title="Evolução do quadro ativo">
          <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="active" name="Ativos" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        </Panel>

        {/* Barras — admissões vs desligamentos */}
        <Panel title="Movimentações por mês">
          <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="admitted" name="Admitidos" fill="hsl(var(--success))" />
                  <Bar dataKey="dismissed" name="Dispensados" fill="hsl(var(--destructive))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Detalhamento mês a mês" flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground"><TableHead>Mês</TableHead><TableHead className="text-right">Ativos</TableHead><TableHead className="text-right">Admitidos</TableHead><TableHead className="text-right">Dispensados</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow>
            </TableHeader>
            <TableBody>
                {series.map(p => (
                  <TableRow key={p.month}>
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{p.active}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{p.admitted > 0 ? '+' + p.admitted : '0'}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{p.dismissed > 0 ? '-' + p.dismissed : '0'}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${p.net > 0 ? 'text-emerald-600' : p.net < 0 ? 'text-destructive' : ''}`}>
                      {p.net > 0 ? '+' : ''}{p.net}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </Panel>

        <Panel title="Headcount por setor (atual)" flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground"><TableHead>Setor</TableHead><TableHead className="text-right">Funcionários</TableHead><TableHead className="text-right">% do total</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {byDepartment.map(d => {
                const total = byDepartment.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? (d.count / total) * 100 : 0;
                return (
                  <TableRow key={d.name}>
                    <TableCell><Badge variant="secondary">{d.name}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-bold">{d.count}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}
