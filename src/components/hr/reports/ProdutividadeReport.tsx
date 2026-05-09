import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, Download, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useEmployees } from '@/hooks/useEmployees';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

// Mapeamento setor de produção (stage_name) → departamento (employees.department).
// Quando o departamento dos funcionários casa com este label, a produção é
// atribuída ao setor. Match é case-insensitive e tolera variantes.
const SECTOR_TO_DEPT_HINT: Record<string, string[]> = {
  'Corte Palmilha': ['corte palmilha', 'palmilha', 'corte'],
  'Corte Forração': ['corte forração', 'forração', 'forracao'],
  'Costura': ['costura'],
  'Mesa': ['aviamento', 'mesa'],
  'Silk': ['silk', 'silkscreen', 'serigrafia'],
  'Colagem': ['colagem'],
  'Montagem': ['montagem'],
  'Solagem': ['solagem'],
  'Acabamento': ['acabamento'],
  'Expedição': ['expedição', 'expedicao'],
};

function matchDept(deptValue: string, hints: string[]): boolean {
  const d = (deptValue || '').toLowerCase().trim();
  return hints.some(h => d === h || d.includes(h));
}

// Hook combinado
function useProdutividadeData(from: string, to: string) {
  return useQuery({
    queryKey: ['rh_produtividade', from, to],
    queryFn: async () => {
      const fromDt = `${from}T00:00:00`;
      const toDt = `${to}T23:59:59`;
      const [stagesRes, ordersRes] = await Promise.all([
        (supabase as any)
          .from('order_stages')
          .select('id, order_id, stage_name, status, started_at, completed_at, quantity_processed, quantity_total, actual_time_minutes')
          .gte('completed_at', fromDt)
          .lte('completed_at', toDt)
          .eq('status', 'completed'),
        (supabase as any)
          .from('orders')
          .select('id, quantity, total_pairs')
          .gte('updated_at', fromDt)
          .lte('updated_at', toDt),
      ]);
      if (stagesRes.error) throw stagesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const stages = (stagesRes.data || []) as any[];
      const orderMap = new Map(((ordersRes.data || []) as any[]).map(o => [o.id, o]));

      // Soma pares por setor
      const bySector = new Map<string, { pairs: number; minutes: number; cycles: number }>();
      for (const s of stages) {
        const order = orderMap.get(s.order_id);
        const pairs = Number(s.quantity_processed) || Number(s.quantity_total) || Number(order?.quantity) || Number(order?.total_pairs) || 0;
        const cur = bySector.get(s.stage_name) || { pairs: 0, minutes: 0, cycles: 0 };
        cur.pairs += pairs;
        cur.minutes += Number(s.actual_time_minutes) || 0;
        cur.cycles++;
        bySector.set(s.stage_name, cur);
      }

      return { bySector: Array.from(bySector.entries()).map(([sector, v]) => ({ sector, ...v })) };
    },
    staleTime: 60_000,
  });
}

export default function ProdutividadeReport() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);

  const { data: employees = [] } = useEmployees();
  const { data, isLoading } = useProdutividadeData(from, to);

  // Calcula custo total da folha por departamento (apenas salário base — proxy)
  const deptCostMap = useMemo(() => {
    const map = new Map<string, { salary: number; count: number }>();
    for (const e of employees.filter(x => x.active)) {
      const d = e.department || 'Sem setor';
      const cur = map.get(d) || { salary: 0, count: 0 };
      cur.salary += Number(e.salary) || 0;
      cur.count++;
      map.set(d, cur);
    }
    return map;
  }, [employees]);

  // Combina pares por setor com custo de departamento
  const rows = useMemo(() => {
    if (!data) return [];
    const out: { sector: string; pairs: number; minutes: number; cycles: number; deptName: string; deptSalary: number; deptCount: number; pairsPerEmp: number; costPerPair: number }[] = [];
    for (const s of data.bySector) {
      const hints = SECTOR_TO_DEPT_HINT[s.sector] || [s.sector.toLowerCase()];
      let deptName = '—';
      let deptSalary = 0;
      let deptCount = 0;
      for (const [d, info] of deptCostMap.entries()) {
        if (matchDept(d, hints)) {
          deptName = d;
          deptSalary = info.salary;
          deptCount = info.count;
          break;
        }
      }
      out.push({
        ...s,
        deptName,
        deptSalary,
        deptCount,
        pairsPerEmp: deptCount > 0 ? s.pairs / deptCount : 0,
        costPerPair: s.pairs > 0 ? deptSalary / s.pairs : 0,
      });
    }
    return out.sort((a, b) => b.pairs - a.pairs);
  }, [data, deptCostMap]);

  const totals = useMemo(() => {
    const pairs = rows.reduce((s, r) => s + r.pairs, 0);
    const minutes = rows.reduce((s, r) => s + r.minutes, 0);
    const totalSalary = rows.reduce((s, r) => s + r.deptSalary, 0);
    const totalEmps = rows.reduce((s, r) => s + r.deptCount, 0);
    return {
      pairs,
      minutes,
      totalSalary,
      totalEmps,
      costPerPair: pairs > 0 ? totalSalary / pairs : 0,
    };
  }, [rows]);

  const exportCsv = () => {
    const headers = ['Setor', 'Departamento', 'Pares processados', 'Funcionários', 'Pares/funcionário', 'Folha base', 'Custo/par (proxy)'];
    const lines = rows.map(r => [
      r.sector,
      r.deptName,
      r.pairs,
      r.deptCount,
      r.pairsPerEmp.toFixed(1).replace('.', ','),
      r.deptSalary.toFixed(2).replace('.', ','),
      r.costPerPair.toFixed(2).replace('.', ','),
    ]);
    const csv = [headers, ...lines].map(row => row.map(c => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtividade-${from}-a-${to}.csv`;
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
            <Activity className="h-5 w-5 text-primary" />
            Produtividade por Setor
          </h1>
          <p className="text-sm text-muted-foreground">
            Pares finalizados por setor no período × custo da equipe alocada.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          <Button size="sm" onClick={exportCsv} className="gap-1.5"><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Pares finalizados vêm de <strong>order_stages</strong> com status <em>completed</em>. O custo/par usa o salário base
            do departamento que casa com o nome do setor — proxy razoável quando o departamento dos funcionários é cadastrado
            com o mesmo nome do setor (ex.: <em>Costura</em>, <em>Aviamento</em>, <em>Acabamento</em>).
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Pares finalizados</p>
          <p className="display text-2xl tabular-nums">{totals.pairs.toLocaleString('pt-BR')}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários alocados</p>
          <p className="display text-2xl tabular-nums">{totals.totalEmps}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Folha base alocada</p>
          <p className="display text-xl tabular-nums">{fmt(totals.totalSalary)}</p>
        </CardContent></Card>
        <Card className="border-primary/40"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Custo médio/par</p>
          <p className="display text-xl tabular-nums text-primary">{totals.pairs > 0 ? fmt(totals.costPerPair) : '—'}</p>
          <p className="text-[10px] text-muted-foreground">Proxy via folha base</p>
        </CardContent></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Pares finalizados por setor</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 4, right: 12, left: -10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="sector" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="pairs" name="Pares" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Custo/par estimado por setor</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows.filter(r => r.pairs > 0)} margin={{ top: 4, right: 12, left: -10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="sector" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="costPerPair" name="R$/par" fill="hsl(var(--warning))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Detalhe por setor</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Setor</TableHead>
                <TableHead>Depto. casado</TableHead>
                <TableHead className="text-right">Pares finalizados</TableHead>
                <TableHead className="text-right">Funcionários</TableHead>
                <TableHead className="text-right">Pares/func.</TableHead>
                <TableHead className="text-right">Folha base</TableHead>
                <TableHead className="text-right">R$/par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma etapa finalizada no período.</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.sector}>
                  <TableCell className="font-medium">{r.sector}</TableCell>
                  <TableCell>
                    {r.deptName === '—' ? (
                      <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">sem casamento</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">{r.deptName}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">{r.pairs.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-right font-mono">{r.deptCount}</TableCell>
                  <TableCell className="text-right font-mono">{r.pairsPerEmp > 0 ? r.pairsPerEmp.toFixed(1) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.deptSalary > 0 ? fmt(r.deptSalary) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-amber-600">{r.costPerPair > 0 ? fmt(r.costPerPair) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
