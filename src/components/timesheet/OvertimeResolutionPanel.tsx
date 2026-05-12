import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
<<<<<<< Updated upstream
import { CircleNotch as Loader2, Wallet, PiggyBank, GitBranch as Split, Check, Warning as AlertTriangle } from '@phosphor-icons/react';
=======
import { CircleNotch as Loader2, Wallet, PiggyBank, PathBranch as Split, Check, Warning as AlertTriangle } from '@phosphor-icons/react';
>>>>>>> Stashed changes
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

interface EmpRow {
  id: string;
  name: string;
  salary: number | null;
  hourly_rate: number | null;
  overtime_multiplier: number;
  overtime_minutes: number;
  hourly_rate_resolved: number;
  estimated_pay: number;
  resolution?: {
    decision: 'bank' | 'pay' | 'split';
    bank_minutes: number;
    pay_minutes: number;
    pay_amount: number;
    resolved_at: string;
  };
}

/**
 * Painel mensal de resolução de horas extras. Mostra um card por funcionário
 * com HE acumulada no mês e permite decidir entre banco / pagar / dividir.
 */
export function OvertimeResolutionPanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState<string>(() => getCurrentMonth());

  const monthDate = useMemo(() => new Date(month + 'T00:00:00'), [month]);
  const monthLabel = monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const lastDayISO = useMemo(() => {
    const d = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    return d.toISOString().split('T')[0];
  }, [monthDate]);

  // Funcionários ativos
  const { data: employees = [] } = useQuery({
    queryKey: ['employees_for_overtime'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('employees')
        .select('id, name, salary, hourly_rate, overtime_multiplier, active')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Saldo de HE do mês via RPC calculate_employee_bank_balance
  const employeeIds = useMemo(() => (employees as any[]).map(e => e.id), [employees]);
  const { data: overtimeData = [], isLoading } = useQuery({
    queryKey: ['overtime_by_employee', month, employeeIds],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        employeeIds.map(async (id: string) => {
          const { data, error } = await (supabase as any).rpc('calculate_employee_bank_balance', {
            p_employee_id: id,
            p_period_start: month,
            p_period_end: lastDayISO,
          });
          if (error) return { employee_id: id, overtime_minutes: 0 };
          // RPC retorna balance_min, days_worked, etc. Procuramos o overtime do período.
          const row = Array.isArray(data) ? data[0] : data;
          return {
            employee_id: id,
            overtime_minutes: Math.max(0, Number(row?.timesheet_min ?? row?.balance_min ?? 0)),
          };
        }),
      );
      return results;
    },
  });

  // Resoluções já feitas pro mês
  const { data: resolutions = [] } = useQuery({
    queryKey: ['overtime_resolutions', month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('overtime_resolutions')
        .select('*')
        .eq('month', month);
      if (error) throw error;
      return data || [];
    },
  });

  const rows: EmpRow[] = useMemo(() => {
    return (employees as any[]).map(e => {
      const ot = (overtimeData as any[]).find(o => o.employee_id === e.id);
      const overtime_minutes = ot?.overtime_minutes ?? 0;
      const hourly_rate_resolved = Number(e.hourly_rate ?? (e.salary ? Number(e.salary) / 220 : 0));
      const mult = Number(e.overtime_multiplier ?? 1.20);
      const estimated_pay = (overtime_minutes / 60) * hourly_rate_resolved * mult;
      const res = (resolutions as any[]).find(r => r.employee_id === e.id);
      return {
        id: e.id,
        name: e.name,
        salary: e.salary,
        hourly_rate: e.hourly_rate,
        overtime_multiplier: mult,
        overtime_minutes,
        hourly_rate_resolved,
        estimated_pay,
        resolution: res ? {
          decision: res.decision,
          bank_minutes: res.bank_minutes,
          pay_minutes: res.pay_minutes,
          pay_amount: Number(res.pay_amount),
          resolved_at: res.resolved_at,
        } : undefined,
      };
    });
  }, [employees, overtimeData, resolutions]);

  const totalOvertime = useMemo(() => rows.reduce((s, r) => s + r.overtime_minutes, 0), [rows]);
  const totalEstimated = useMemo(() => rows.reduce((s, r) => s + r.estimated_pay, 0), [rows]);
  const totalPending = useMemo(() => rows.filter(r => r.overtime_minutes > 0 && !r.resolution).length, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="month"
          value={month.slice(0, 7)}
          onChange={e => setMonth(e.target.value + '-01')}
          className="h-9 w-44"
        />
        <Badge variant="outline" className="h-7">
          {monthLabel}
        </Badge>
        <div className="flex items-center gap-2 ml-auto text-xs">
          <span className="text-muted-foreground">Total HE:</span>
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

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.filter(r => r.overtime_minutes > 0 || r.resolution).map(row => (
            <EmployeeResolutionRow
              key={row.id}
              row={row}
              month={month}
              onResolved={() => {
                qc.invalidateQueries({ queryKey: ['overtime_resolutions', month] });
                qc.invalidateQueries({ queryKey: ['overtime_by_employee'] });
                qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
              }}
            />
          ))}
          {rows.filter(r => r.overtime_minutes > 0 || r.resolution).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nenhum funcionário com HE acumulada neste mês.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EmployeeResolutionRow({
  row,
  month,
  onResolved,
}: {
  row: EmpRow;
  month: string;
  onResolved: () => void;
}) {
  const [decision, setDecision] = useState<'bank' | 'pay' | 'split'>(row.resolution?.decision ?? 'bank');
  const [bankMin, setBankMin] = useState<number>(row.resolution?.bank_minutes ?? row.overtime_minutes);
  const [payMin, setPayMin] = useState<number>(row.resolution?.pay_minutes ?? 0);
  const [notes, setNotes] = useState<string>('');

  const resolved = !!row.resolution;
  const payAmountPreview = (payMin / 60) * row.hourly_rate_resolved * row.overtime_multiplier;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const finalBank = decision === 'bank' ? row.overtime_minutes : decision === 'split' ? bankMin : 0;
      const finalPay = decision === 'pay' ? row.overtime_minutes : decision === 'split' ? payMin : 0;
      const { error } = await (supabase as any).rpc('resolve_monthly_overtime', {
        p_employee_id: row.id,
        p_month: month,
        p_decision: decision,
        p_bank_minutes: finalBank,
        p_pay_minutes: finalPay,
        p_total_minutes: row.overtime_minutes,
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
          <div className="flex-1 min-w-[200px]">
            <p className="font-bold text-sm">{row.name}</p>
            <p className="text-[11px] text-muted-foreground">
              HE: <strong className="font-mono">{formatMinutes(row.overtime_minutes)}</strong>
              {' · '}Hora: R$ {row.hourly_rate_resolved.toFixed(2)}
              {' · '}×{row.overtime_multiplier.toFixed(2)}
              {' · '}Estimado: <strong className="font-mono text-primary">{formatBRL(row.estimated_pay)}</strong>
            </p>
          </div>

          {resolved ? (
            <div className="flex items-center gap-2 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                <Check className="h-3 w-3 mr-1" />
                {row.resolution!.decision === 'bank' && 'Banco'}
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
                  <SelectItem value="bank"><PiggyBank className="h-3 w-3 inline mr-1" /> Banco de horas</SelectItem>
                  <SelectItem value="pay"><Wallet className="h-3 w-3 inline mr-1" /> Pagar na folha</SelectItem>
                  <SelectItem value="split"><Split className="h-3 w-3 inline mr-1" /> Dividir</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={resolveMutation.isPending}
                onClick={() => resolveMutation.mutate()}
              >
                {resolveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
              </Button>
            </div>
          )}
        </div>

        {!resolved && decision === 'split' && (
          <div className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
            <span className="text-muted-foreground">Banco (min):</span>
            <Input
              type="number"
              className="h-7 w-20 text-xs"
              min={0}
              max={row.overtime_minutes}
              value={bankMin}
              onChange={e => {
                const v = Math.max(0, Math.min(row.overtime_minutes, Number(e.target.value || 0)));
                setBankMin(v);
                setPayMin(row.overtime_minutes - v);
              }}
            />
            <span className="text-muted-foreground">+ Pagar (min):</span>
            <Input
              type="number"
              className="h-7 w-20 text-xs"
              value={payMin}
              readOnly
            />
            <span className="text-muted-foreground">= {row.overtime_minutes} min</span>
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
      </CardContent>
    </Card>
  );
}
