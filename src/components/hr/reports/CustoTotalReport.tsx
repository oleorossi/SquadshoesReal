import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, DollarSign, Download, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEmployees, useEmployeeAdvances } from '@/hooks/useEmployees';
import { useBenefitsConfig, usePayrollRuns, useBankHoursMovements } from '@/hooks/useRH';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Relatório de "custo total" por funcionário no mês.
 *
 * Custo real = base salarial + HE pagas (50%/100%/noturno) + adic. noturno
 *           + benefícios pagos pelo empregador (VR/VA proporcional)
 *           + DSR (descanso semanal remunerado relativo às HE)
 *           + encargos estimados (FGTS 8% + INSS patronal estimado 26.8%)
 *
 * Exporta CSV com discriminação por linha.
 */
export default function CustoTotalReport() {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);
  const [includeEncargos, setIncludeEncargos] = useState(true);

  const { data: employees = [], isLoading: loadingEmp } = useEmployees();
  const { data: runs = [], isLoading: loadingRuns } = usePayrollRuns(period);
  const { data: config } = useBenefitsConfig();
  const { data: advances = [] } = useEmployeeAdvances(null);
  const { data: bhMovements = [] } = useBankHoursMovements();

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const runMap = useMemo(() => new Map(runs.map(r => [r.employee_id, r])), [runs]);

  // Adiantamentos no período (caso o run ainda não tenha sido calculado)
  const advancesByEmpInPeriod = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of advances) {
      if (a.advance_date.startsWith(period)) {
        map.set(a.employee_id, (map.get(a.employee_id) || 0) + (Number(a.amount) || 0));
      }
    }
    return map;
  }, [advances, period]);

  // BH a pagar (saldo positivo > 0 traz pressão de custo futuro)
  // Aqui usamos somente as movimentações do PERÍODO (impacto no mês)
  const bhMinByEmp = useMemo(() => {
    const map = new Map<string, { credit: number; debit: number }>();
    for (const m of bhMovements) {
      if (!m.movement_date.startsWith(period)) continue;
      const cur = map.get(m.employee_id) || { credit: 0, debit: 0 };
      if (m.minutes > 0) cur.credit += m.minutes;
      else cur.debit += m.minutes;
      map.set(m.employee_id, cur);
    }
    return map;
  }, [bhMovements, period]);

  const rows = useMemo(() => {
    return employees
      .filter(e => e.active)
      .map(e => {
        const run = runMap.get(e.id);
        const baseSalary = Number(e.salary) || 0;
        const advancesInPeriod = advancesByEmpInPeriod.get(e.id) || 0;
        const bh = bhMinByEmp.get(e.id) || { credit: 0, debit: 0 };

        // Se já tem run calculado, usa os valores reais
        if (run) {
          const proventos = Number(run.total_proventos) || 0;
          const beneficios = (Number(run.vr_value) || 0) + (Number(run.va_value) || 0) + (Number(run.vt_total_value) || 0) - (Number(run.vt_employee_discount) || 0);
          const encargos = includeEncargos ? proventos * 0.348 : 0; // 8% FGTS + 26.8% INSS+SAT+sistema-S patronal estimado
          const custoTotal = proventos + Math.max(0, beneficios) + encargos;
          return {
            id: e.id,
            name: e.name,
            department: e.department || '—',
            baseSalary,
            heValue: (Number(run.overtime_50_value) || 0) + (Number(run.overtime_100_value) || 0) + (Number(run.night_bonus_value) || 0),
            beneficios: Math.max(0, beneficios),
            advancesInPeriod,
            proventos,
            encargos,
            custoTotal,
            bhCreditoMin: bh.credit,
            bhDebitoMin: Math.abs(bh.debit),
            hasRun: true,
          };
        }
        // Sem run calculado: estima usando salário base + benefícios da config
        const beneficiosEstimados =
          (config?.vr_daily_value || 0) * 22  // ~22 dias úteis
          + (config?.va_monthly_value || 0)
          + (config?.vt_daily_value || 0) * 22 * (1 - (config?.vt_employee_discount_pct || 6) / 100);
        const encargos = includeEncargos ? baseSalary * 0.348 : 0;
        const custoTotal = baseSalary + Math.max(0, beneficiosEstimados) + encargos;
        return {
          id: e.id,
          name: e.name,
          department: e.department || '—',
          baseSalary,
          heValue: 0,
          beneficios: Math.max(0, beneficiosEstimados),
          advancesInPeriod,
          proventos: baseSalary,
          encargos,
          custoTotal,
          bhCreditoMin: bh.credit,
          bhDebitoMin: Math.abs(bh.debit),
          hasRun: false,
        };
      })
      .sort((a, b) => b.custoTotal - a.custoTotal);
  }, [employees, runMap, advancesByEmpInPeriod, bhMinByEmp, config, includeEncargos]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      base: acc.base + r.baseSalary,
      he: acc.he + r.heValue,
      benef: acc.benef + r.beneficios,
      encargos: acc.encargos + r.encargos,
      total: acc.total + r.custoTotal,
    }), { base: 0, he: 0, benef: 0, encargos: 0, total: 0 });
  }, [rows]);

  const calculadosCount = rows.filter(r => r.hasRun).length;

  const exportCsv = () => {
    const headers = ['Funcionário', 'Setor', 'Base Salarial', 'HE no mês', 'Benefícios', 'Encargos est.', 'Custo Total', 'Cálculo'];
    const lines = rows.map(r => [
      r.name,
      r.department,
      r.baseSalary.toFixed(2).replace('.', ','),
      r.heValue.toFixed(2).replace('.', ','),
      r.beneficios.toFixed(2).replace('.', ','),
      r.encargos.toFixed(2).replace('.', ','),
      r.custoTotal.toFixed(2).replace('.', ','),
      r.hasRun ? 'Folha calculada' : 'Estimativa',
    ]);
    const csv = [headers, ...lines].map(row => row.map(c => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custo-total-rh-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loadingEmp || loadingRuns) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-5 page-enter">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="display text-xl tracking-tight flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Custo Total por Funcionário
            </h1>
            <p className="text-sm text-muted-foreground">
              Quanto cada funcionário custou de fato no mês (salário + HE + benefícios + encargos).
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40" />
            <Button variant="outline" size="sm" onClick={() => setIncludeEncargos(v => !v)}>
              {includeEncargos ? '✓' : '✗'} Encargos
            </Button>
            <Button size="sm" onClick={exportCsv} className="gap-1.5"><Download className="h-3.5 w-3.5" /> CSV</Button>
          </div>
        </div>

        {calculadosCount < rows.length && (
          <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Apenas <strong>{calculadosCount}</strong> de {rows.length} funcionários têm folha calculada para {period}.
                Os demais aparecem como <em>estimativa</em> (apenas salário base + benefícios da config + encargos).
                Calcule a folha em <strong>Folha &gt; Folha do Mês</strong> para valores precisos.
              </p>
            </CardContent>
          </Card>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Folha base</p>
            <p className="text-lg font-bold font-mono">{fmt(totals.base)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Horas extras</p>
            <p className="text-lg font-bold font-mono text-amber-600">{fmt(totals.he)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Benefícios</p>
            <p className="text-lg font-bold font-mono text-emerald-600">{fmt(totals.benef)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground uppercase">Encargos est.</p>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-xs">FGTS 8% + INSS patronal + SAT + Sistema-S ≈ 34.8% sobre proventos. Estimativa.</TooltipContent>
              </Tooltip>
            </div>
            <p className="text-lg font-bold font-mono text-rose-600">{fmt(totals.encargos)}</p>
          </CardContent></Card>
          <Card className="border-primary/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">Custo total mês</p>
              <p className="display text-xl tabular-nums text-primary">{fmt(totals.total)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Custo por funcionário</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">HE</TableHead>
                  <TableHead className="text-right">Benefícios</TableHead>
                  <TableHead className="text-right">Encargos</TableHead>
                  <TableHead className="text-right font-bold">Custo Total</TableHead>
                  <TableHead className="text-center">BH</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum funcionário ativo.</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id} className={r.hasRun ? '' : 'opacity-70'}>
                    <TableCell className="font-medium">{r.name}{!r.hasRun && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">est.</span>}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.department}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(r.baseSalary)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-600">{r.heValue > 0 ? fmt(r.heValue) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-600">{fmt(r.beneficios)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-rose-600">{fmt(r.encargos)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmt(r.custoTotal)}</TableCell>
                    <TableCell className="text-center text-[10px] font-mono">
                      {r.bhCreditoMin > 0 && <span className="text-emerald-600">+{Math.round(r.bhCreditoMin / 60 * 10) / 10}h</span>}
                      {r.bhCreditoMin > 0 && r.bhDebitoMin > 0 && ' / '}
                      {r.bhDebitoMin > 0 && <span className="text-rose-600">-{Math.round(r.bhDebitoMin / 60 * 10) / 10}h</span>}
                      {r.bhCreditoMin === 0 && r.bhDebitoMin === 0 && <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
