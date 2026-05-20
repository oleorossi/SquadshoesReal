import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CircleNotch as Loader2, Download, Info } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEmployees, useEmployeeAdvances } from '@/hooks/useEmployees';
import { useBenefitsConfig, usePayrollRuns, useBankHoursMovements } from '@/hooks/useRH';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Relatório de "custo total" por funcionário no mês.
 *
 * Custo = salário base + HE pagas (50%/100%/noturno) + adic. noturno.
 *
 * Removido em 18/05/2026 (pedido user "férias provisões CLT nada disso será
 * calculado, apenas o salário"): cálculo de encargos (FGTS 8% + INSS 26.8%)
 * e estimativa de benefícios (VR/VA/VT). Benefícios reais do run ainda
 * aparecem em coluna separada quando existem no payroll_run gravado, mas
 * NÃO são estimados quando o run não foi calculado.
 *
 * Exporta CSV com discriminação por linha.
 */
export default function CustoTotalReport() {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);

  const { data: employees = [], isLoading: loadingEmp } = useEmployees();
  const { data: runs = [], isLoading: loadingRuns } = usePayrollRuns(period);
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

        // Se já tem run calculado, usa os valores reais (salário + HE pagas).
        // Encargos (FGTS/INSS) e benefícios deixaram de ser somados após
        // pedido user em 18/05/2026 — só salário e HE compõem o custo.
        if (run) {
          const proventos = Number(run.total_proventos) || 0;
          const beneficios = (Number(run.vr_value) || 0) + (Number(run.va_value) || 0) + (Number(run.vt_total_value) || 0) - (Number(run.vt_employee_discount) || 0);
          // custoTotal = proventos (salário + HE + adicionais). Não soma benefícios nem encargos.
          const custoTotal = proventos;
          return {
            id: e.id,
            name: e.name,
            department: e.department || '—',
            baseSalary,
            heValue: (Number(run.overtime_50_value) || 0) + (Number(run.overtime_100_value) || 0) + (Number(run.night_bonus_value) || 0),
            beneficios: Math.max(0, beneficios),
            advancesInPeriod,
            proventos,
            custoTotal,
            bhCreditoMin: bh.credit,
            bhDebitoMin: Math.abs(bh.debit),
            hasRun: true,
          };
        }
        // Sem run calculado: somente salário base. Estimativas removidas.
        return {
          id: e.id,
          name: e.name,
          department: e.department || '—',
          baseSalary,
          heValue: 0,
          beneficios: 0,
          advancesInPeriod,
          proventos: baseSalary,
          custoTotal: baseSalary,
          bhCreditoMin: bh.credit,
          bhDebitoMin: Math.abs(bh.debit),
          hasRun: false,
        };
      })
      .sort((a, b) => b.custoTotal - a.custoTotal);
  }, [employees, runMap, advancesByEmpInPeriod, bhMinByEmp]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      base: acc.base + r.baseSalary,
      he: acc.he + r.heValue,
      benef: acc.benef + r.beneficios,
      total: acc.total + r.custoTotal,
    }), { base: 0, he: 0, benef: 0, total: 0 });
  }, [rows]);

  const calculadosCount = rows.filter(r => r.hasRun).length;

  const exportCsv = () => {
    const headers = ['Funcionário', 'Setor', 'Base Salarial', 'HE no mês', 'Benefícios', 'Custo Total', 'Cálculo'];
    const lines = rows.map(r => [
      r.name,
      r.department,
      r.baseSalary.toFixed(2).replace('.', ','),
      r.heValue.toFixed(2).replace('.', ','),
      r.beneficios.toFixed(2).replace('.', ','),
      r.custoTotal.toFixed(2).replace('.', ','),
      r.hasRun ? 'Folha calculada' : 'Salário base',
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
              <p className="section-label mb-2">Custo Total · Mensal</p>
              <h1 className="text-display-lg leading-none">
                Custo por
                <span className="text-primary"> Funcionário</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">
                Quanto cada funcionário custou de fato no mês — salário base + horas extras pagas.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40 h-9" />
              <Button size="sm" className="h-9 gap-1.5" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
          </div>
          <div className="rule-line-double mt-5" />
        </div>

        {calculadosCount < rows.length && (
          <div className="border-l-2 border-primary pl-4 py-2 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="section-label mb-1 text-primary">Atenção · Folha Parcial</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Apenas <span className="font-mono font-bold text-foreground">{calculadosCount}</span> de <span className="font-mono text-foreground">{rows.length}</span> funcionários têm folha calculada para {period}.
                Os demais aparecem com o <em>salário base</em> apenas.
                Calcule a folha em <strong className="text-foreground">Folha &gt; Folha do Mês</strong> para incluir horas extras.
              </p>
            </div>
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
            <KpiCell label="Folha base" value={fmt(totals.base)} />
            <KpiCell label="Horas extras" value={fmt(totals.he)} bordered />
            <KpiCell label="Benefícios" value={fmt(totals.benef)} bordered hint="VR/VA/VT pagos pelo empregador no período. Aparece quando a folha foi calculada." />
            <KpiCell label="Custo total mês" value={fmt(totals.total)} bordered accent />
          </div>
        </section>

        {/* ─────────── 02 / DETALHE ─────────── */}
        <section>
          <div className="flex items-baseline gap-3 mb-5">
            <span className="font-display text-2xl leading-none">02</span>
            <span className="section-label text-foreground">Custo por Funcionário</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="section-label text-foreground">Funcionário</TableHead>
                <TableHead className="section-label text-foreground">Setor</TableHead>
                <TableHead className="section-label text-foreground text-right">Base</TableHead>
                <TableHead className="section-label text-foreground text-right">HE</TableHead>
                <TableHead className="section-label text-foreground text-right">Benefícios</TableHead>
                <TableHead className="section-label text-foreground text-right">Custo Total</TableHead>
                <TableHead className="section-label text-foreground text-center">BH</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">Nenhum funcionário ativo.</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id} className={`border-b border-border/60 ${r.hasRun ? '' : 'opacity-60'}`}>
                  <TableCell className="font-medium">{r.name}{!r.hasRun && <span className="ml-2 text-xs uppercase tracking-wider text-muted-foreground">só base</span>}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.department}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmt(r.baseSalary)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-amber-600">{r.heValue > 0 ? fmt(r.heValue) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-emerald-600">{r.beneficios > 0 ? fmt(r.beneficios) : '—'}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmt(r.custoTotal)}</TableCell>
                  <TableCell className="text-center text-xs font-mono">
                    {r.bhCreditoMin > 0 && <span className="text-emerald-600">+{Math.round(r.bhCreditoMin / 60 * 10) / 10}h</span>}
                    {r.bhCreditoMin > 0 && r.bhDebitoMin > 0 && ' / '}
                    {r.bhDebitoMin > 0 && <span className="text-rose-600">-{Math.round(r.bhDebitoMin / 60 * 10) / 10}h</span>}
                    {r.bhCreditoMin === 0 && r.bhDebitoMin === 0 && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </TooltipProvider>
  );
}

function KpiCell({ label, value, bordered, accent, hint }: {
  label: string;
  value: string;
  bordered?: boolean;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className={`px-4 py-5 ${bordered ? 'border-l border-border' : ''}`}>
      <div className="flex items-center gap-1 mb-2">
        <p className="section-label">{label}</p>
        {hint && (
          <Tooltip>
            <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className={`font-mono font-bold leading-none tracking-tight text-2xl ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
