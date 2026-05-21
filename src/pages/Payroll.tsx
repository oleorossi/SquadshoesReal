import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CircleNotch as Loader2, CurrencyDollar as DollarSign, Calculator, Gear as Settings, FileArrowDown as FileDown, CheckCircle as CheckCircle2, Receipt, Warning as AlertTriangle, Wallet, Clock, ArrowRight } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useBenefitsConfig, useSaveBenefitsConfig,
  usePayrollRuns, useUpsertPayrollRun, useUpdatePayrollStatus,
  useAbsences,
} from '@/hooks/useRH';
import { calculatePayroll, type BenefitsConfig, type PayrollDayInput } from '@/lib/payrollCalc';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function getMonthDays(period: string): { date: string; dow: number; isHoliday: boolean }[] {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: { date: string; dow: number; isHoliday: boolean }[] = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m - 1, d);
    out.push({
      date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dow: dt.getDay(),
      isHoliday: false, // pode plugar holidays table depois
    });
  }
  return out;
}

const STATUS_BADGES = {
  rascunho:  { label: 'Rascunho', variant: 'secondary' as const },
  aprovado:  { label: 'Aprovado', variant: 'default' as const },
  pago:      { label: 'Pago',     variant: 'outline' as const },
};

export default function Payroll() {
  const navigate = useNavigate();
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(defaultPeriod);
  const [calcRunning, setCalcRunning] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [detailRun, setDetailRun] = useState<string | null>(null);
  const [approveRun, setApproveRun] = useState<string | null>(null);

  const { data: employees = [] } = useEmployees();
  const { data: config } = useBenefitsConfig();
  const { data: runs = [], isLoading } = usePayrollRuns(period);
  const upsertRun = useUpsertPayrollRun();
  const updateStatus = useUpdatePayrollStatus();

  // Período "from" e "to" para queries dependentes
  const periodRange = useMemo(() => {
    const days = getMonthDays(period);
    return { from: days[0]?.date, to: days[days.length - 1]?.date };
  }, [period]);

  const { data: absences = [] } = useAbsences({ from: periodRange.from, to: periodRange.to });

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const totals = useMemo(() => {
    const proventos = runs.reduce((s, r) => s + (r.total_proventos || 0), 0);
    const descontos = runs.reduce((s, r) => s + (r.total_descontos || 0), 0);
    const liquido = runs.reduce((s, r) => s + (r.total_liquido || 0), 0);
    const advances = runs.reduce((s, r) => s + (r.advances_total || 0), 0);
    const advancesCount = runs.filter(r => (r.advances_total || 0) > 0).length;
    return { proventos, descontos, liquido, advances, advancesCount };
  }, [runs]);

  async function calculateAll() {
    if (!config) {
      toast.error('Configuração de benefícios não encontrada. Cadastre primeiro.');
      return;
    }
    setCalcRunning(true);
    try {
      const monthDays = getMonthDays(period);

      // Buscar time_records do período em batch único.
      // Tabela time_records não tem employee_id (FK pra employees) — só
      // employee_external_id (matricula do REP) e employee_name. Indexamos
      // por ambos pra match em calculateForEmployee.
      const { data: timeRecords, error } = await supabase
        .from('time_records')
        .select('employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;

      const byExternalId = new Map<string, Map<string, string[]>>();
      const byName  = new Map<string, Map<string, string[]>>();
      for (const r of (timeRecords || []) as any[]) {
        const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
        if (r.employee_external_id) {
          const extKey = String(r.employee_external_id);
          if (!byExternalId.has(extKey)) byExternalId.set(extKey, new Map());
          byExternalId.get(extKey)!.set(r.record_date, punches);
        }
        const nameKey = (r.employee_name || '').toLowerCase().trim();
        if (nameKey) {
          if (!byName.has(nameKey)) byName.set(nameKey, new Map());
          byName.get(nameKey)!.set(r.record_date, punches);
        }
      }

      // Indexa ausências por funcionário
      const absencesByEmp = new Map<string, typeof absences>();
      for (const a of absences) {
        if (!absencesByEmp.has(a.employee_id)) absencesByEmp.set(a.employee_id, []);
        absencesByEmp.get(a.employee_id)!.push(a);
      }

      // Soma adiantamentos do período PENDENTES (status='pending', não já
      // descontados em outra folha). Vales descontados em folha aprovada NÃO
      // entram aqui — o trigger DB liga payroll_run_id quando folha vira aprovada.
      const { data: advances } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date, status, payroll_run_id')
        .gte('advance_date', periodRange.from!)
        .lte('advance_date', periodRange.to!)
        .or('payroll_run_id.is.null,status.eq.pending');
      const advancesByEmp = new Map<string, number>();
      for (const a of (advances || []) as any[]) {
        advancesByEmp.set(a.employee_id, (advancesByEmp.get(a.employee_id) || 0) + Number(a.amount || 0));
      }

      // Carrega work_schedules de todos os funcionários ativos pra derivar
      // jornada/tolerância/mínOT POR FUNCIONÁRIO (antes ficava hardcoded
      // 528 min/dia + tolerância 10 — só funcionava se todos tivessem CLT 44h).
      const schedIds = Array.from(new Set(
        employees.map(e => (e as any).work_schedule_id).filter(Boolean) as string[],
      ));
      const { data: schedules } = schedIds.length > 0
        ? await (supabase as any).from('work_schedules')
            .select('id, weekly_hours, tolerance_minutes, minimum_overtime_minutes')
            .in('id', schedIds)
        : { data: [] };
      const scheduleById = new Map<string, any>();
      for (const s of (schedules || [])) scheduleById.set(s.id, s);

      // Soma HE paga (overtime_resolutions com decision IN ('pay','split'))
      // do mês — vai como adicional na folha, NÃO como financial_entry separado.
      const monthFirstDay = `${period}-01`;
      const { data: overtimeRes } = await supabase
        .from('overtime_resolutions')
        .select('employee_id, decision, pay_amount, payroll_run_id')
        .eq('month', monthFirstDay);
      const overtimePaidByEmp = new Map<string, number>();
      for (const r of (overtimeRes || []) as any[]) {
        if (r.decision === 'pay' || r.decision === 'split') {
          overtimePaidByEmp.set(r.employee_id,
            (overtimePaidByEmp.get(r.employee_id) || 0) + Number(r.pay_amount || 0));
        }
      }

      // HE manual (decisão 2026-05-21): minutos de HE 50/100 que o RH
      // EXPLICITAMENTE marcou pra pagar via bank_hours_movements (positive
      // minutes com overtime_pct 50 ou 100). Sem isso, calculatePayroll
      // pula o cálculo automático. Tolera bank_hours_movements vazia
      // (cai no fallback automático legado).
      const { data: paidOtRows } = await (supabase as any)
        .from('bank_hours_movements')
        .select('employee_id, minutes, overtime_pct, movement_type')
        .gte('movement_date', periodRange.from!)
        .lte('movement_date', periodRange.to!)
        .in('movement_type', ['pay', 'pay_overtime']);
      const paidOtByEmp = new Map<string, { ot50: number; ot100: number }>();
      for (const r of (paidOtRows || []) as any[]) {
        const e = paidOtByEmp.get(r.employee_id) ?? { ot50: 0, ot100: 0 };
        const m = Math.abs(Number(r.minutes || 0));
        if (Number(r.overtime_pct) === 100) e.ot100 += m;
        else e.ot50 += m;
        paidOtByEmp.set(r.employee_id, e);
      }

      let calculated = 0;
      for (const emp of employees.filter(e => e.active)) {
        // Match em ordem: external_id (matricula REP) → nome.
        // emp.id é UUID interno, NÃO casa com employee_external_id do REP.
        const extKey = (emp as any).external_id ? String((emp as any).external_id) : '';
        const empPunches = (extKey && byExternalId.get(extKey))
          || byName.get(emp.name.toLowerCase().trim())
          || new Map();

        // Resolve work_schedule do funcionário (fallback: 44h/sem, tol 10, minOT 10)
        const sched = scheduleById.get((emp as any).work_schedule_id) || {};
        const weeklyHours = Number(sched.weekly_hours) || 44;
        const toleranceMin = Number(sched.tolerance_minutes ?? 10);
        const minOTMin = Number(sched.minimum_overtime_minutes ?? 10);
        // Jornada diária = weekly_hours × 60 / 5 (assumindo 5 dias úteis)
        const dailyExpectedMin = Math.round((weeklyHours * 60) / 5);

        const days: PayrollDayInput[] = monthDays.map(d => {
          const punches = empPunches.get(d.date) || [];
          const isBusinessDay = d.dow !== 0 && d.dow !== 6;
          const expectedMinutes = isBusinessDay && !d.isHoliday ? dailyExpectedMin : 0;
          return {
            date: d.date,
            dayOfWeek: d.dow,
            isHoliday: d.isHoliday,
            isBusinessDay,
            punches,
            expectedMinutes,
          };
        });

        const result = calculatePayroll(
          {
            id: emp.id,
            name: emp.name,
            base_salary: Number(emp.salary) || 0,
            receives_vt: (emp as any).receives_vt ?? true,
            receives_vr: (emp as any).receives_vr ?? false,
            receives_va: (emp as any).receives_va ?? false,
            health_plan_value: Number((emp as any).health_plan_value) || 0,
            weekly_hours: weeklyHours,
            tolerance_minutes: toleranceMin,
            minimum_overtime_minutes: minOTMin,
            // Multiplicadores POR FUNCIONÁRIO (regime contrato — cada um pode
            // ter regra própria). Defaults 0 = hora simples.
            overtime_50_pct:  Number((emp as any).overtime_50_pct  ?? 0),
            overtime_100_pct: Number((emp as any).overtime_100_pct ?? 0),
            night_bonus_pct:  Number((emp as any).night_bonus_pct  ?? 0),
          },
          days,
          (absencesByEmp.get(emp.id) || []).map(a => ({
            start_date: a.start_date,
            end_date: a.end_date,
            absence_type: a.absence_type,
            paid: a.paid,
            hours_per_day: a.hours_per_day,
          })),
          advancesByEmp.get(emp.id) || 0,
          config as BenefitsConfig,
          // HE manual: passa só se houver lançamento explícito do RH.
          // Sem lançamento → fallback automático (legado).
          paidOtByEmp.get(emp.id),
        );

        const overtimePaid = overtimePaidByEmp.get(emp.id) || 0;
        // HE paga entra como adicional no proventos (e portanto líquido).
        // Se não houver, fica em 0 e a folha computa só o salário base + extras
        // calculados pelas batidas.
        const proventos = (result as any).total_proventos + overtimePaid;
        const liquido = (result as any).total_liquido + overtimePaid;

        await upsertRun.mutateAsync({
          employee_id: emp.id,
          period,
          ...result,
          total_proventos: proventos,
          total_liquido: liquido,
          advances_total: advancesByEmp.get(emp.id) || 0,
          overtime_paid_value: overtimePaid,
          status: 'rascunho',
        });
        calculated++;
      }
      toast.success(`Folha calculada: ${calculated} funcionário(s).`);
    } catch (err: any) {
      toast.error(`Erro ao calcular folha: ${err.message}`);
    } finally {
      setCalcRunning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 page-enter">
      {/* Header local removido — vive no RHHub. Actions ficam aqui em barra própria. */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Input
          type="month"
          value={period}
          onChange={e => setPeriod(e.target.value)}
          className="w-40 h-9"
        />
        <BenefitsConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
        <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
          <Settings className="h-4 w-4 mr-2" />Configurações
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate('/rh?tab=ponto&subtab=overtime')}>
          <Clock className="h-4 w-4 mr-2" />
          Resolver HE
        </Button>
        <Button size="sm" onClick={calculateAll} disabled={calcRunning}>
          {calcRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
          Calcular folha
        </Button>
      </div>

      <PayrollPendingInputsAlert period={period} />

      {/* Totais */}
      <StatGrid>
        <StatCard label="Funcionários" value={runs.length} hint="na folha do período" />
        <StatCard label="Total proventos" value={fmt(totals.proventos)} tone="success" />
        <StatCard
          label="Adiantamentos"
          value={fmt(totals.advances)}
          hint={totals.advances > 0 ? `${totals.advancesCount} func. com vale` : undefined}
          tone="warning"
          icon={Wallet}
        />
        <StatCard label="Total descontos" value={fmt(totals.descontos)} tone="destructive" />
        <StatCard label="Total líquido" value={fmt(totals.liquido)} tone="primary" />
      </StatGrid>

      <Panel title={`Folha de ${period}`} flush>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Funcionário</TableHead>
              <TableHead className="text-right">Salário base</TableHead>
              <TableHead className="text-right">HE</TableHead>
              <TableHead className="text-right">Noturno</TableHead>
              <TableHead className="text-right">Adiantamentos</TableHead>
              <TableHead className="text-right">Descontos</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="p-0">
                  <EmptyState
                    icon={Calculator}
                    title="Nenhuma folha calculada"
                    description={`Não há folha para ${period}. Clique em "Calcular folha" para gerar.`}
                  />
                </TableCell>
              </TableRow>
            ) : runs.map(r => {
                const emp = employeeMap.get(r.employee_id);
                const heValue = (r.overtime_50_value || 0) + (r.overtime_100_value || 0);
                const sb = STATUS_BADGES[r.status] || STATUS_BADGES.rascunho;
                const hasAdvance = (r.advances_total || 0) > 0;
                return (
                  <TableRow key={r.id} className={hasAdvance ? 'hover:bg-muted/30 bg-amber-500/5' : 'hover:bg-muted/30'}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {emp?.name || '—'}
                        {hasAdvance && (
                          <Wallet className="h-3.5 w-3.5 text-amber-600" aria-label="Possui adiantamento" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmt(r.base_salary)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmt(heValue)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmt(r.night_bonus_value)}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${hasAdvance ? 'text-amber-700 font-semibold' : 'text-muted-foreground'}`}>
                      {hasAdvance ? `− ${fmt(r.advances_total)}` : fmt(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">{fmt(r.total_descontos)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold">{fmt(r.total_liquido)}</TableCell>
                    <TableCell><Badge variant={sb.variant}>{sb.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetailRun(r.id)}>
                          <Receipt className="h-4 w-4" />
                        </Button>
                        {r.status === 'rascunho' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (hasAdvance) {
                                setApproveRun(r.id);
                              } else {
                                updateStatus.mutate({ id: r.id, status: 'aprovado' });
                              }
                            }}
                            title={hasAdvance ? 'Revisar adiantamento antes de aprovar' : 'Aprovar folha'}
                          >
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        {r.status === 'aprovado' && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: r.id, status: 'pago' })}>
                            <DollarSign className="h-4 w-4 text-primary" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </Panel>

      {/* Confirmação de aprovação quando há adiantamento */}
      <AlertDialog open={!!approveRun} onOpenChange={(o) => !o && setApproveRun(null)}>
        <AlertDialogContent>
          {(() => {
            const r = runs.find(x => x.id === approveRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            const adv = r.advances_total || 0;
            const gross = (r.base_salary || 0) + (r.overtime_50_value || 0) + (r.overtime_100_value || 0)
                       + (r.night_bonus_value || 0);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                    Adiantamento já pago — confirmar?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3 pt-2 text-sm">
                      <p>
                        <strong>{emp?.name}</strong> recebeu <strong className="text-amber-700">{fmt(adv)}</strong> de
                        adiantamento neste período. O líquido a pagar JÁ desconta esse valor.
                      </p>
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Bruto (base + HE + Adic.):</span>
                          <span className="font-mono tabular-nums">{fmt(gross)}</span>
                        </div>
                        <div className="flex justify-between text-amber-700">
                          <span>Adiantamento já recebido:</span>
                          <span className="font-mono tabular-nums font-semibold">− {fmt(adv)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-1">
                          <span className="font-semibold">Líquido a pagar:</span>
                          <span className="font-mono tabular-nums font-bold text-primary">{fmt(r.total_liquido)}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Pague apenas o líquido acima. Não pague o valor bruto — o vale já foi entregue.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      updateStatus.mutate({ id: r.id, status: 'aprovado' });
                      setApproveRun(null);
                    }}
                  >
                    Ciente, aprovar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      {/* Detalhe do holerite */}
      <Dialog open={!!detailRun} onOpenChange={(o) => !o && setDetailRun(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Holerite</DialogTitle></DialogHeader>
          {(() => {
            const r = runs.find(x => x.id === detailRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            // Regime contrato: INSS/IRRF/DSR/VT-desconto não se aplicam.
            // Holerite mostra só proventos + descontos reais.
            const lines = [
              { label: 'Salário base', value: r.base_salary, type: 'p' as const },
              { label: `HE dia útil (${(r.overtime_50_minutes / 60).toFixed(2)}h)`, value: r.overtime_50_value, type: 'p' as const },
              { label: `HE dom/feriado (${(r.overtime_100_minutes / 60).toFixed(2)}h)`, value: r.overtime_100_value, type: 'p' as const },
              { label: `Adic. noturno (${(r.night_minutes / 60).toFixed(2)}h)`, value: r.night_bonus_value, type: 'p' as const },
              { label: 'Vale-refeição', value: r.vr_value, type: 'p' as const },
              { label: 'Vale-alimentação', value: r.va_value, type: 'p' as const },
              { label: 'Plano de saúde', value: r.health_plan_discount, type: 'd' as const },
              { label: `Faltas injust. (${r.absent_days} dias)`, value: r.absence_discount, type: 'd' as const },
              { label: 'Adiantamentos do mês', value: r.advances_total, type: 'd' as const, highlight: true },
            ].filter(l => l.value > 0);

            return (
              <div className="space-y-3">
                <div className="text-sm">
                  <p className="font-bold text-base">{emp?.name}</p>
                  <p className="text-muted-foreground">{emp?.role || '—'} • {emp?.department || '—'} • Período {r.period}</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Descrição</TableHead><TableHead className="text-right">Provento</TableHead><TableHead className="text-right">Desconto</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i} className={(l as any).highlight ? 'bg-amber-500/10' : ''}>
                        <TableCell className={(l as any).highlight ? 'font-semibold text-amber-700' : ''}>
                          {(l as any).highlight && <Wallet className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                          {l.label}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{l.type === 'p' ? fmt(l.value) : ''}</TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${(l as any).highlight ? 'text-amber-700 font-semibold' : 'text-destructive'}`}>
                          {l.type === 'd' ? fmt(l.value) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between border-t pt-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total proventos</p>
                    <p className="font-bold text-emerald-600">{fmt(r.total_proventos)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total descontos</p>
                    <p className="font-bold text-destructive">{fmt(r.total_descontos)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Líquido a receber</p>
                    <p className="font-bold text-lg text-primary">{fmt(r.total_liquido)}</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Configuração de benefícios ──────────────────────────────────────
function BenefitsConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: config } = useBenefitsConfig();
  const save = useSaveBenefitsConfig();
  const [form, setForm] = useState<any>(config || {});

  useMemo(() => { if (config) setForm(config); }, [config]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Configurações de Benefícios e Cálculo</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>VT — valor por dia útil</Label>
              <Input type="number" step="0.01" value={form.vt_daily_value || 0} onChange={e => setForm((f: any) => ({ ...f, vt_daily_value: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>VT — desconto máx (%)</Label>
              <Input type="number" step="0.01" value={form.vt_employee_discount_pct || 6} onChange={e => setForm((f: any) => ({ ...f, vt_employee_discount_pct: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>VR — valor por dia útil</Label>
              <Input type="number" step="0.01" value={form.vr_daily_value || 0} onChange={e => setForm((f: any) => ({ ...f, vr_daily_value: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>VA — valor mensal fixo</Label>
              <Input type="number" step="0.01" value={form.va_monthly_value || 0} onChange={e => setForm((f: any) => ({ ...f, va_monthly_value: Number(e.target.value) }))} />
            </div>
            <div className="col-span-2">
              <Label>Plano de saúde — desconto padrão</Label>
              <Input type="number" step="0.01" value={form.health_plan_default || 0} onChange={e => setForm((f: any) => ({ ...f, health_plan_default: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Divisor mensal (horas)</Label>
              <Input type="number" value={form.monthly_hours || 220} onChange={e => setForm((f: any) => ({ ...f, monthly_hours: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Adic. noturno (%)</Label>
              <Input type="number" step="0.01" value={form.night_bonus_pct || 20} onChange={e => setForm((f: any) => ({ ...f, night_bonus_pct: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>HE 50% (CLT mín 50)</Label>
              <Input type="number" step="0.01" value={form.overtime_50_pct || 50} onChange={e => setForm((f: any) => ({ ...f, overtime_50_pct: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>HE 100% (dom/feriado)</Label>
              <Input type="number" step="0.01" value={form.overtime_100_pct || 100} onChange={e => setForm((f: any) => ({ ...f, overtime_100_pct: Number(e.target.value) }))} />
            </div>
          </div>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="w-full">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar configurações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Alerta no topo da página de Folha: mostra vales pendentes e HE não resolvida
 * no período corrente. Operador deve resolver HE no /timesheet antes de
 * calcular a folha pra os valores entrarem corretos.
 */
function PayrollPendingInputsAlert({ period }: { period: string }) {
  const navigate = useNavigate();
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Number(period.split('-')[0]), Number(period.split('-')[1]), 0)
    .toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['payroll_pending_inputs', period],
    queryFn: async () => {
      const [advancesQ, overtimeQ] = await Promise.all([
        (supabase as any)
          .from('employee_advances')
          .select('id, employee_id, amount, status, payroll_run_id')
          .gte('advance_date', periodStart)
          .lte('advance_date', periodEnd),
        (supabase as any)
          .from('overtime_resolutions')
          .select('employee_id')
          .eq('month', periodStart),
      ]);
      const pendingAdvances = (advancesQ.data || []).filter(
        (a: any) => a.payroll_run_id == null && a.status === 'pending'
      );
      const pendingAdvancesTotal = pendingAdvances.reduce(
        (s: number, a: any) => s + Number(a.amount || 0), 0
      );
      // Não fazemos query custosa de batidas pra detectar HE faltante — só
      // sinalizamos se nenhum funcionário ainda foi resolvido (caso comum
      // quando esquece). Usuário pode clicar pra ver detalhe.
      const overtimeResolved = (overtimeQ.data || []).length;
      return {
        pendingAdvancesCount: pendingAdvances.length,
        pendingAdvancesTotal,
        overtimeResolved,
      };
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) return null;
  const { pendingAdvancesCount, pendingAdvancesTotal, overtimeResolved } = data;
  if (pendingAdvancesCount === 0 && overtimeResolved > 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        Atenção antes de calcular a folha
      </div>
      <div className="space-y-1 text-xs text-amber-800/90">
        {pendingAdvancesCount > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span>
              <strong className="font-bold">{pendingAdvancesCount} vale(s)</strong> pendente(s) neste período
              {' '}— total {pendingAdvancesTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.
              Serão descontados automaticamente ao aprovar a folha.
            </span>
          </div>
        )}
        {overtimeResolved === 0 && (
          <div className="flex items-center justify-between gap-2">
            <span>
              <strong className="font-bold">Horas extras ainda não resolvidas</strong> para este mês.
              Decida quem fica no banco e quem recebe HE antes de calcular.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-amber-500/40"
              onClick={() => navigate('/rh?tab=ponto&subtab=overtime')}
            >
              Resolver HE <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
