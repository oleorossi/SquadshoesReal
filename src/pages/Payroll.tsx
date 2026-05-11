import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Loader2, DollarSign, Calculator, Settings, FileDown, CheckCircle2, Receipt, AlertTriangle, Wallet } from 'lucide-react';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useBenefitsConfig, useSaveBenefitsConfig,
  usePayrollRuns, useUpsertPayrollRun, useUpdatePayrollStatus,
  useAbsences,
} from '@/hooks/useRH';
import { calculatePayroll, type BenefitsConfig, type PayrollDayInput } from '@/lib/payrollCalc';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

      // Buscar time_records do período em batch único
      const { data: timeRecords, error } = await supabase
        .from('time_records')
        .select('employee_id, employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;

      // Indexa por employee_id ou name (REPs nem sempre têm employee_id mapeado)
      const byEmpId = new Map<string, Map<string, string[]>>();
      const byName  = new Map<string, Map<string, string[]>>();
      for (const r of (timeRecords || []) as any[]) {
        const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
        if (r.employee_id) {
          if (!byEmpId.has(r.employee_id)) byEmpId.set(r.employee_id, new Map());
          byEmpId.get(r.employee_id)!.set(r.record_date, punches);
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

      // Soma adiantamentos do período
      const { data: advances } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date')
        .gte('advance_date', periodRange.from!)
        .lte('advance_date', periodRange.to!);
      const advancesByEmp = new Map<string, number>();
      for (const a of (advances || []) as any[]) {
        advancesByEmp.set(a.employee_id, (advancesByEmp.get(a.employee_id) || 0) + Number(a.amount || 0));
      }

      let calculated = 0;
      for (const emp of employees.filter(e => e.active)) {
        const empPunches = byEmpId.get(emp.id) || byName.get(emp.name.toLowerCase().trim()) || new Map();

        const days: PayrollDayInput[] = monthDays.map(d => {
          const punches = empPunches.get(d.date) || [];
          const isBusinessDay = d.dow !== 0 && d.dow !== 6;
          // Jornada esperada: 8h48min em dia útil (528min) — ou 0 fim de semana
          const expectedMinutes = isBusinessDay && !d.isHoliday ? 528 : 0;
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
        );

        await upsertRun.mutateAsync({
          employee_id: emp.id,
          period,
          ...result,
          advances_total: advancesByEmp.get(emp.id) || 0,
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
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Folha de Pagamento
          </h1>
          <p className="text-sm text-muted-foreground">
            Cálculo mensal: salário base + HE 50/100 + adic. noturno + DSR + benefícios − INSS/IRRF.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-40"
          />
          <BenefitsConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
          <Button variant="outline" onClick={() => setConfigOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />Configurações
          </Button>
          <Button onClick={calculateAll} disabled={calcRunning}>
            {calcRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
            Calcular folha
          </Button>
        </div>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários</p>
          <p className="text-2xl font-bold">{runs.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total proventos</p>
          <p className="text-xl font-bold text-emerald-600">{fmt(totals.proventos)}</p>
        </CardContent></Card>
        <Card className={totals.advances > 0 ? 'border-amber-500/40 bg-amber-500/5' : ''}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase flex items-center gap-1">
              <Wallet className="h-3 w-3" /> Adiantamentos
            </p>
            <p className="text-xl font-bold text-amber-600">{fmt(totals.advances)}</p>
            {totals.advances > 0 && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                {totals.advancesCount} func. com vale
              </p>
            )}
          </CardContent>
        </Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total descontos</p>
          <p className="text-xl font-bold text-destructive">{fmt(totals.descontos)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total líquido</p>
          <p className="text-xl font-bold text-primary">{fmt(totals.liquido)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Folha de {period}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead className="text-right">Salário base</TableHead>
                <TableHead className="text-right">HE</TableHead>
                <TableHead className="text-right">Noturno</TableHead>
                <TableHead className="text-right">DSR</TableHead>
                <TableHead className="text-right text-amber-700">Adiantamentos</TableHead>
                <TableHead className="text-right">Descontos</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                    Nenhuma folha calculada para este período. Clique em "Calcular folha".
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
                    <TableCell className="text-right font-mono">{fmt(r.base_salary)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmt(heValue)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmt(r.night_bonus_value)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmt(r.dsr_value)}</TableCell>
                    <TableCell className={`text-right font-mono ${hasAdvance ? 'text-amber-700 font-semibold' : 'text-muted-foreground'}`}>
                      {hasAdvance ? `− ${fmt(r.advances_total)}` : fmt(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">{fmt(r.total_descontos)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmt(r.total_liquido)}</TableCell>
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
        </CardContent>
      </Card>

      {/* Confirmação de aprovação quando há adiantamento */}
      <AlertDialog open={!!approveRun} onOpenChange={(o) => !o && setApproveRun(null)}>
        <AlertDialogContent>
          {(() => {
            const r = runs.find(x => x.id === approveRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            const adv = r.advances_total || 0;
            const gross = (r.base_salary || 0) + (r.overtime_50_value || 0) + (r.overtime_100_value || 0)
                       + (r.night_bonus_value || 0) + (r.dsr_value || 0);
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
                          <span className="text-muted-foreground">Bruto (base + HE + Adic. + DSR):</span>
                          <span className="font-mono">{fmt(gross)}</span>
                        </div>
                        <div className="flex justify-between text-amber-700">
                          <span>Adiantamento já recebido:</span>
                          <span className="font-mono font-semibold">− {fmt(adv)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-1">
                          <span className="font-semibold">Líquido a pagar:</span>
                          <span className="font-mono font-bold text-primary">{fmt(r.total_liquido)}</span>
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
            const lines = [
              { label: 'Salário base', value: r.base_salary, type: 'p' as const },
              { label: `HE 50% (${(r.overtime_50_minutes / 60).toFixed(2)}h)`, value: r.overtime_50_value, type: 'p' as const },
              { label: `HE 100% (${(r.overtime_100_minutes / 60).toFixed(2)}h)`, value: r.overtime_100_value, type: 'p' as const },
              { label: `Adic. noturno (${(r.night_minutes / 60).toFixed(2)}h)`, value: r.night_bonus_value, type: 'p' as const },
              { label: 'DSR sobre HE/Noturno', value: r.dsr_value, type: 'p' as const },
              { label: 'Vale-refeição', value: r.vr_value, type: 'p' as const },
              { label: 'Vale-alimentação', value: r.va_value, type: 'p' as const },
              { label: 'INSS', value: r.inss_value, type: 'd' as const },
              { label: 'IRRF', value: r.irrf_value, type: 'd' as const },
              { label: 'Vale-transporte (cota func.)', value: r.vt_employee_discount, type: 'd' as const },
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
                        <TableCell className="text-right font-mono">{l.type === 'p' ? fmt(l.value) : ''}</TableCell>
                        <TableCell className={`text-right font-mono ${(l as any).highlight ? 'text-amber-700 font-semibold' : 'text-destructive'}`}>
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
