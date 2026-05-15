import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CircleNotch as Loader2, Wallet, PiggyBank, GitBranch as Split, Check,
  Warning as AlertTriangle, CaretLeft, CaretRight,
  CaretDown as ChevronDown, CaretRight as ChevronRight,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function formatMinutes(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m.toString().padStart(2, '0')}`;
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// Retorna a segunda-feira ISO da semana de uma data (formato YYYY-MM-DD)
function getMondayISO(d: Date): string {
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(monday.getDate() - day + 1);
  return monday.toISOString().split('T')[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatDateBR(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatWeekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  return `${formatDateBR(weekStart)} – ${formatDateBR(end)}`;
}

interface DayBreakdown {
  date: string;
  dow: number;
  expected_min: number;
  worked_min: number;
  late_min: number;
  early_leave_min: number;
  diff_min: number;
  first_punch: string | null;
  last_punch: string | null;
  punches: string[];
}

interface WeeklyBreakdown {
  employee_id: string;
  employee_name: string;
  department: string | null;
  week_start: string;
  week_end: string;
  weekly_target_min: number;
  week_worked_min: number;
  week_expected_min: number;
  week_late_min: number;
  week_early_leave_min: number;
  week_overtime_min: number;
  week_deficit_min: number;
  week_net_diff_min: number;
  tolerance_min: number;
  minimum_overtime_min: number;
  days: DayBreakdown[];
  error?: string;
}

interface ResolutionRow {
  employee_id: string;
  name: string;
  department: string | null;
  hourly_rate: number;
  multiplier: number;
  breakdown: WeeklyBreakdown | null;
  resolution?: {
    decision: 'bank' | 'pay' | 'split';
    bank_minutes: number;
    pay_minutes: number;
    pay_amount: number;
    resolved_at: string;
    notes: string | null;
  };
}

export function WeeklyOvertimeResolutionPanel() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<string>(() => getMondayISO(new Date()));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekLabel = useMemo(() => formatWeekLabel(weekStart), [weekStart]);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees_for_weekly_overtime'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('employees')
        .select('id, name, department, salary, hourly_rate, overtime_multiplier, active')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const employeeIds = useMemo(() => (employees as any[]).map(e => e.id), [employees]);

  const { data: breakdowns = [], isLoading } = useQuery<WeeklyBreakdown[]>({
    queryKey: ['weekly_he_breakdown', weekStart, employeeIds],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        employeeIds.map(async (id: string) => {
          const { data, error } = await (supabase as any).rpc('calculate_weekly_he_breakdown', {
            p_employee_id: id,
            p_week_start: weekStart,
          });
          if (error) return { employee_id: id, error: error.message } as any;
          return data as WeeklyBreakdown;
        }),
      );
      return results;
    },
  });

  const { data: resolutions = [] } = useQuery({
    queryKey: ['overtime_resolutions_weekly', weekStart],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('overtime_resolutions')
        .select('*')
        .eq('month', weekStart)
        .eq('period_type', 'weekly');
      if (error) throw error;
      return data || [];
    },
  });

  const rows: ResolutionRow[] = useMemo(() => {
    return (employees as any[]).map(e => {
      const bd = (breakdowns as WeeklyBreakdown[]).find(b => b.employee_id === e.id) || null;
      const hourly_rate = Number(e.hourly_rate ?? (e.salary ? Number(e.salary) / 220 : 0));
      const multiplier = Number(e.overtime_multiplier ?? 1.20);
      const res = (resolutions as any[]).find(r => r.employee_id === e.id);
      return {
        employee_id: e.id,
        name: e.name,
        department: e.department,
        hourly_rate,
        multiplier,
        breakdown: bd,
        resolution: res ? {
          decision: res.decision,
          bank_minutes: res.bank_minutes,
          pay_minutes: res.pay_minutes,
          pay_amount: Number(res.pay_amount),
          resolved_at: res.resolved_at,
          notes: res.notes,
        } : undefined,
      };
    });
  }, [employees, breakdowns, resolutions]);

  const rowsWithHE = useMemo(
    () => rows.filter(r => (r.breakdown?.week_overtime_min ?? 0) > 0 || r.resolution),
    [rows],
  );

  const totalOvertime = useMemo(
    () => rowsWithHE.reduce((s, r) => s + (r.breakdown?.week_overtime_min ?? 0), 0),
    [rowsWithHE],
  );
  const totalEstimated = useMemo(
    () => rowsWithHE.reduce(
      (s, r) => s + ((r.breakdown?.week_overtime_min ?? 0) / 60) * r.hourly_rate * r.multiplier,
      0,
    ),
    [rowsWithHE],
  );
  const totalPending = useMemo(
    () => rowsWithHE.filter(r => (r.breakdown?.week_overtime_min ?? 0) > 0 && !r.resolution).length,
    [rowsWithHE],
  );

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <CaretLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={weekStart}
          onChange={e => {
            const d = new Date(e.target.value + 'T12:00:00');
            setWeekStart(getMondayISO(d));
          }}
          className="h-9 w-44"
        />
        <Badge variant="outline" className="h-7">
          Semana {weekLabel}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <CaretRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 ml-2"
          onClick={() => setWeekStart(getMondayISO(new Date()))}
        >
          Semana atual
        </Button>

        <div className="flex items-center gap-2 ml-auto text-xs">
          <span className="text-muted-foreground">Total HE líquida:</span>
          <strong className="font-mono">{formatMinutes(totalOvertime)}</strong>
          <span className="text-muted-foreground ml-3">Estimado:</span>
          <strong className="font-mono text-primary">{formatBRL(totalEstimated)}</strong>
          {totalPending > 0 && (
            <Badge variant="outline" className="ml-3 bg-amber-50 text-amber-700 border-amber-300">
              <AlertTriangle className="h-3 w-3 mr-1" /> {totalPending} pendente{totalPending !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        HE líquida = horas trabalhadas − horas previstas na semana, já descontando atrasos
        e saídas antecipadas. Tolerância CLT e mínimo de HE aplicados conforme escala.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rowsWithHE.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum funcionário com horas extras nesta semana.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rowsWithHE.map(row => (
            <EmployeeWeeklyRow
              key={row.employee_id}
              row={row}
              weekStart={weekStart}
              expanded={expanded.has(row.employee_id)}
              onToggle={() => toggleExpanded(row.employee_id)}
              onResolved={() => {
                qc.invalidateQueries({ queryKey: ['overtime_resolutions_weekly', weekStart] });
                qc.invalidateQueries({ queryKey: ['weekly_he_breakdown'] });
                qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
                qc.invalidateQueries({ queryKey: ['bank_hours_balance_list'] });
                qc.invalidateQueries({ queryKey: ['financial_entries'] });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeWeeklyRow({
  row,
  weekStart,
  expanded,
  onToggle,
  onResolved,
}: {
  row: ResolutionRow;
  weekStart: string;
  expanded: boolean;
  onToggle: () => void;
  onResolved: () => void;
}) {
  const bd = row.breakdown;
  const overtime_min = bd?.week_overtime_min ?? 0;
  const estimated_pay = (overtime_min / 60) * row.hourly_rate * row.multiplier;

  const [decision, setDecision] = useState<'bank' | 'pay' | 'split'>(row.resolution?.decision ?? 'pay');
  const [bankMin, setBankMin] = useState<number>(row.resolution?.bank_minutes ?? 0);
  const [payMin, setPayMin] = useState<number>(row.resolution?.pay_minutes ?? overtime_min);
  const [notes, setNotes] = useState<string>(row.resolution?.notes ?? '');

  const resolved = !!row.resolution;
  const payAmountPreview = (payMin / 60) * row.hourly_rate * row.multiplier;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const finalBank = decision === 'bank' ? overtime_min : decision === 'split' ? bankMin : 0;
      const finalPay = decision === 'pay' ? overtime_min : decision === 'split' ? payMin : 0;
      const { error } = await (supabase as any).rpc('resolve_weekly_overtime', {
        p_employee_id: row.employee_id,
        p_week_start: weekStart,
        p_decision: decision,
        p_bank_minutes: finalBank,
        p_pay_minutes: finalPay,
        p_total_minutes: overtime_min,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`HE de ${row.name} resolvida.`);
      onResolved();
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });

  return (
    <Card className={cn('border-l-4', resolved ? 'border-l-emerald-500' : 'border-l-amber-500')}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            aria-label="Expandir detalhes"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <div className="flex-1 min-w-[220px]">
            <p className="font-bold text-sm">
              {row.name}
              {row.department && (
                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1.5">
                  {row.department}
                </Badge>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              HE líquida: <strong className="font-mono">{formatMinutes(overtime_min)}</strong>
              {bd && bd.week_late_min > 0 && (
                <> · Atraso: <span className="font-mono text-amber-600">−{formatMinutes(bd.week_late_min)}</span></>
              )}
              {bd && bd.week_early_leave_min > 0 && (
                <> · Saída antecipada: <span className="font-mono text-amber-600">−{formatMinutes(bd.week_early_leave_min)}</span></>
              )}
              {' · '}Hora: R$ {row.hourly_rate.toFixed(2)}
              {' · '}×{row.multiplier.toFixed(2)}
              {' · '}Estimado: <strong className="font-mono text-primary">{formatBRL(estimated_pay)}</strong>
            </p>
          </div>

          {resolved ? (
            <div className="flex items-center gap-2 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                <Check className="h-3 w-3 mr-1" />
                {row.resolution!.decision === 'bank' && 'Acumulado'}
                {row.resolution!.decision === 'pay' && 'Pago'}
                {row.resolution!.decision === 'split' && 'Dividido'}
              </Badge>
              <span className="text-muted-foreground">
                Banco {formatMinutes(row.resolution!.bank_minutes)} · Pago {formatBRL(row.resolution!.pay_amount)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={decision} onValueChange={(v: any) => setDecision(v)}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pay"><Wallet className="h-3 w-3 inline mr-1" /> Pagar</SelectItem>
                  <SelectItem value="bank"><PiggyBank className="h-3 w-3 inline mr-1" /> Acumular</SelectItem>
                  <SelectItem value="split"><Split className="h-3 w-3 inline mr-1" /> Dividir</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={resolveMutation.isPending || overtime_min === 0}
                onClick={() => resolveMutation.mutate()}
              >
                {resolveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
              </Button>
            </div>
          )}
        </div>

        {!resolved && decision === 'split' && (
          <div className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
            <span className="text-muted-foreground">Acumular (min):</span>
            <Input
              type="number"
              className="h-7 w-20 text-xs"
              min={0}
              max={overtime_min}
              value={bankMin}
              onChange={e => {
                const v = Math.max(0, Math.min(overtime_min, Number(e.target.value || 0)));
                setBankMin(v);
                setPayMin(overtime_min - v);
              }}
            />
            <span className="text-muted-foreground">+ Pagar (min):</span>
            <Input type="number" className="h-7 w-20 text-xs" value={payMin} readOnly />
            <span className="text-muted-foreground">= {overtime_min} min</span>
            <span className="ml-auto text-primary font-mono font-bold">
              {formatBRL(payAmountPreview)}
            </span>
          </div>
        )}

        {!resolved && (
          <Input
            placeholder="Observações (opcional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-7 text-xs"
          />
        )}

        {expanded && bd && bd.days && bd.days.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="text-[11px] text-muted-foreground mb-2 font-semibold uppercase tracking-wider">
              Detalhe diário
            </p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead className="text-xs py-1.5">Data</TableHead>
                  <TableHead className="text-xs py-1.5">Dia</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Entrada</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Saída</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Previsto</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Trabalhado</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Atraso</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Saída +cedo</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bd.days.map((d, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono py-1.5">{formatDateBR(d.date)}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{DAYS_PT[d.dow % 7]}</TableCell>
                    <TableCell className="font-mono text-right py-1.5">{d.first_punch || '—'}</TableCell>
                    <TableCell className="font-mono text-right py-1.5">{d.last_punch || '—'}</TableCell>
                    <TableCell className="font-mono text-right py-1.5 text-muted-foreground">
                      {d.expected_min > 0 ? formatMinutes(d.expected_min) : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-right py-1.5">
                      {formatMinutes(d.worked_min)}
                    </TableCell>
                    <TableCell className="font-mono text-right py-1.5">
                      {d.late_min > 0 ? <span className="text-amber-600">+{formatMinutes(d.late_min)}</span> : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-right py-1.5">
                      {d.early_leave_min > 0 ? <span className="text-amber-600">+{formatMinutes(d.early_leave_min)}</span> : '—'}
                    </TableCell>
                    <TableCell className={cn(
                      'font-mono text-right py-1.5 font-semibold',
                      d.diff_min > 0 && 'text-emerald-600',
                      d.diff_min < 0 && 'text-primary',
                    )}>
                      {d.diff_min === 0 ? '—' : formatMinutes(d.diff_min)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/20 font-semibold text-xs">
                  <TableCell colSpan={4} className="py-1.5 text-muted-foreground">
                    TOTAL DA SEMANA
                  </TableCell>
                  <TableCell className="font-mono text-right py-1.5">
                    {formatMinutes(bd.week_expected_min)}
                  </TableCell>
                  <TableCell className="font-mono text-right py-1.5">
                    {formatMinutes(bd.week_worked_min)}
                  </TableCell>
                  <TableCell className="font-mono text-right py-1.5 text-amber-600">
                    {bd.week_late_min > 0 ? `+${formatMinutes(bd.week_late_min)}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-right py-1.5 text-amber-600">
                    {bd.week_early_leave_min > 0 ? `+${formatMinutes(bd.week_early_leave_min)}` : '—'}
                  </TableCell>
                  <TableCell className={cn(
                    'font-mono text-right py-1.5 font-bold',
                    bd.week_net_diff_min > 0 && 'text-emerald-600',
                    bd.week_net_diff_min < 0 && 'text-primary',
                  )}>
                    {formatMinutes(bd.week_net_diff_min)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
