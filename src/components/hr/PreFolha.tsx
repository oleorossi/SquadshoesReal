/**
 * Pré-folha consolidada — visão analítica de tudo que vai pra folha do
 * mês ANTES do fechamento. Usada pra:
 *  - revisar HE, faltas, descontos e benefícios em uma tela só
 *  - exportar pra Excel/CSV pra contador conferir
 *  - decidir quais payroll_runs aprovar/ajustar antes do "Aprovar folha"
 *
 * Fonte: payroll_runs filtrado pelo period selecionado. HE = overtime_amount
 * (modelo atual = HE única 1,5×; as colunas 50/100/noturno/DSR são legado NÃO
 * escrito e por isso saíram do relatório — davam R$0). Ver docs/AUDITORIA_RH_COMPATIBILIDADE.md.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CircleNotch as Loader2, Download, CurrencyDollar as DollarSign, Calculator, Warning as AlertTriangle } from '@phosphor-icons/react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (m: number) => {
  if (!m) return '00:00';
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

interface PayrollRow {
  id: string;
  employee_id: string;
  period: string;
  status: string;
  base_salary: number;
  overtime_50_minutes: number;
  overtime_amount: number;
  absent_days: number;
  absence_discount: number;
  vr_value: number;
  va_value: number;
  vt_total_value: number;
  vt_employee_discount: number;
  health_plan_discount: number;
  inss_value: number;
  irrf_value: number;
  advances_total: number;
  total_proventos: number;
  total_descontos: number;
  total_liquido: number;
  approved_at: string | null;
  paid_at: string | null;
  employees?: { name: string; department: string | null; active: boolean };
}

function nextPeriods(count = 6): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    out.push({ value: period, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

export default function PreFolha() {
  const periods = useMemo(() => nextPeriods(6), []);
  const [period, setPeriod] = useState<string>(periods[0].value);

  const { data: runs = [], isLoading } = useQuery<PayrollRow[]>({
    queryKey: ['payroll_runs_prefolha', period],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('payroll_runs')
        .select('*, employees(name, department, active)')
        .eq('period', period)
        .order('employee_id');
      if (error) throw error;
      return (data ?? []) as PayrollRow[];
    },
  });

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => (a.employees?.name || '').localeCompare(b.employees?.name || ''));
  }, [runs]);

  // Agregações pra header e totalizadores.
  // HE = overtime_amount (valor da HE que a Payroll grava — desde 2026-07-09 é R$/h
  // ABSOLUTO por funcionário, normal/domingo-feriado). As colunas legadas overtime_50_
  // value/overtime_100_*/night_*/dsr_value NÃO são escritas pela Payroll, então somá-las
  // dava HE = R$0 no relatório do contador. Ver AUDITORIA_RH_* / specs/gestao-de-pessoas.md.
  const totals = useMemo(() => {
    return runs.reduce((acc, r) => ({
      heMin: acc.heMin + (r.overtime_50_minutes || 0),
      heValue: acc.heValue + (r.overtime_amount || 0),
      absentDays: acc.absentDays + (r.absent_days || 0),
      absentValue: acc.absentValue + (r.absence_discount || 0),
      proventos: acc.proventos + (r.total_proventos || 0),
      descontos: acc.descontos + (r.total_descontos || 0),
      liquido: acc.liquido + (r.total_liquido || 0),
      pendentes: acc.pendentes + (r.status === 'draft' || !r.approved_at ? 1 : 0),
      aprovadas: acc.aprovadas + (r.approved_at ? 1 : 0),
    }), {
      heMin: 0, heValue: 0,
      absentDays: 0, absentValue: 0,
      proventos: 0, descontos: 0, liquido: 0,
      pendentes: 0, aprovadas: 0,
    });
  }, [runs]);

  const exportCsv = () => {
    const headers = [
      'Funcionário', 'Setor', 'Status',
      'Salário base', 'HE (h)', 'HE (R$)',
      'Faltas (dias)', 'Desc. faltas (R$)',
      'VR (R$)', 'VA (R$)', 'VT (R$)', 'VT desc. func. (R$)',
      'Plano saúde (R$)', 'INSS (R$)', 'IRRF (R$)', 'Adiantamentos (R$)',
      'Proventos', 'Descontos', 'Líquido',
    ];
    const lines = sortedRuns.map(r => [
      r.employees?.name || '—',
      r.employees?.department || '—',
      r.approved_at ? 'Aprovada' : 'Rascunho',
      r.base_salary, fmtMin(r.overtime_50_minutes), r.overtime_amount,
      r.absent_days, r.absence_discount,
      r.vr_value, r.va_value, r.vt_total_value, r.vt_employee_discount,
      r.health_plan_discount, r.inss_value, r.irrf_value, r.advances_total,
      r.total_proventos, r.total_descontos, r.total_liquido,
    ]);
    const csv = [headers, ...lines].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre-folha-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="py-3 px-4 bg-muted/30 border-b flex flex-row items-center gap-3 flex-wrap">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          Pré-folha consolidada
        </CardTitle>
        <div className="flex-1" />
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {periods.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={runs.length === 0} onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="Nenhuma folha calculada"
            description={`Não há payroll_runs pro período ${period}. Gere a folha em /rh/folha → Folha do Mês.`}
            size="sm"
          />
        ) : (
          <>
            {/* Header totalizadores */}
            <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-4 border-b border-border/60 bg-muted/10">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Funcionários</p>
                <p className="font-mono text-lg font-bold">{runs.length}</p>
                {totals.pendentes > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-0.5">
                    <AlertTriangle className="h-3 w-3" /> {totals.pendentes} rascunho{totals.pendentes !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">HE total (1,5×)</p>
                <p className="font-mono text-lg font-bold">{fmt(totals.heValue)}</p>
                <p className="text-xs text-muted-foreground">{fmtMin(totals.heMin)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Faltas</p>
                <p className="font-mono text-lg font-bold text-rose-600">{fmt(totals.absentValue)}</p>
                <p className="text-xs text-muted-foreground">{totals.absentDays} dia{totals.absentDays !== 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Proventos</p>
                <p className="font-mono text-lg font-bold text-emerald-600">{fmt(totals.proventos)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Líquido</p>
                <p className="font-mono text-lg font-bold">{fmt(totals.liquido)}</p>
              </div>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs uppercase tracking-wider">Funcionário</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Setor</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">HE 1,5×</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">Faltas</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">Proventos</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">Descontos</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">Líquido</TableHead>
                    <TableHead className="text-center text-xs uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRuns.map(r => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell className="font-medium">{r.employees?.name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.employees?.department || '—'}</TableCell>
                      <TableCell className="text-right font-mono">
                        <div>{fmtMin(r.overtime_50_minutes)}</div>
                        <div className="text-xs text-muted-foreground">{fmt(r.overtime_amount)}</div>
                      </TableCell>
                      <TableCell className={cn('text-right font-mono', r.absent_days > 0 && 'text-rose-600')}>
                        {r.absent_days > 0 ? (
                          <>
                            <div>{r.absent_days}d</div>
                            <div className="text-xs">{fmt(r.absence_discount)}</div>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600">{fmt(r.total_proventos)}</TableCell>
                      <TableCell className="text-right font-mono text-rose-600">{fmt(r.total_descontos)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{fmt(r.total_liquido)}</TableCell>
                      <TableCell className="text-center">
                        {r.paid_at ? (
                          <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600">Pago</Badge>
                        ) : r.approved_at ? (
                          <Badge variant="outline" className="text-xs border-primary/40 text-primary">Aprovada</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600">Rascunho</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
