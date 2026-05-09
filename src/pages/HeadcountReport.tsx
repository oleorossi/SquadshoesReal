import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, TrendingUp, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
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

  /**
   * Para cada mês, conta funcionários:
   *   - Ativos no fim do mês = admission_date <= ultimo_dia_mes E (não há flag dispensado/data fim)
   *   - Como o schema atual só tem `active boolean` + `admission_date`, usamos:
   *     - Admitidos no mês: admission_date entre o 1o e o último dia
   *     - Ativos no mês: admission_date <= último dia E (active=true OU updated_at > último dia)
   */
  const series = useMemo(() => {
    return months.map(mk => {
      const [y, m] = mk.split('-').map(Number);
      const lastDay = new Date(y, m, 0);
      const firstDay = new Date(y, m - 1, 1);

      let active = 0;
      let admitted = 0;
      let dismissed = 0;
      for (const e of employees) {
        if (!e.admission_date) continue;
        const adm = new Date(e.admission_date + 'T00:00:00');
        if (adm > lastDay) continue;
        // Admitido neste mês
        if (adm >= firstDay && adm <= lastDay) admitted++;
        // Considerado ativo neste mês = admitido até o fim E (atualmente ativo OU updated_at > fim do mês)
        const updated = e.updated_at ? new Date(e.updated_at) : null;
        const stillActive = e.active || (updated && updated > lastDay);
        if (stillActive) active++;
        // Dispensado neste mês = não está mais ativo E updated_at cai dentro do mês
        if (!e.active && updated && updated >= firstDay && updated <= lastDay) dismissed++;
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Headcount evolutivo
          </h1>
          <p className="text-sm text-muted-foreground">
            Evolução do quadro de funcionários por mês — admitidos, dispensados, saldo líquido.
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
          <p className="text-xs text-muted-foreground uppercase">Funcionários hoje</p>
          <p className="display text-2xl tabular-nums">{last?.active ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo no período</p>
          <p className={`display text-2xl tabular-nums flex items-center gap-1 ${totalGrowth >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
            {totalGrowth >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {totalGrowth >= 0 ? '+' : ''}{totalGrowth}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Admissões</p>
          <p className="display text-2xl tabular-nums text-emerald-600">{totalAdmitted}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Desligamentos</p>
          <p className="display text-2xl tabular-nums text-destructive">{totalDismissed}</p>
        </CardContent></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Linha — evolução do total */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Evolução do quadro ativo</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Barras — admissões vs desligamentos */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Movimentações por mês</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhamento mês a mês</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Ativos</TableHead><TableHead className="text-right">Admitidos</TableHead><TableHead className="text-right">Dispensados</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Headcount por setor (atual)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Setor</TableHead><TableHead className="text-right">Funcionários</TableHead><TableHead className="text-right">% do total</TableHead></TableRow>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
