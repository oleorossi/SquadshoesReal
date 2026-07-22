/**
 * Editor de horário INDIVIDUAL do funcionário.
 *
 * Após a migration 2026-05-21, cada employee tem seu próprio work_schedule
 * (cópia do default). Esta UI permite ao RH editar horários individuais
 * sem precisar mexer em outra tela.
 *
 * Decisão da gestão: fábrica não segue padrão CLT teórico — cada funcionário
 * pode ter horário próprio. O cálculo de saldo (RPC
 * calculate_employee_bank_balance) usa diretamente esses valores via
 * get_employee_expected_minutes.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, FloppyDisk as Save } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  /** UUID do funcionário (employees.id). */
  employeeId: string;
  /** Compacto = sem header, pra dialogs onde já tem título. Default false. */
  compact?: boolean;
}

interface ScheduleRow {
  id: string;
  name: string;
  entry_time: string;
  lunch_start: string;
  lunch_end: string;
  exit_time: string;
  saturday_entry: string | null;
  saturday_exit: string | null;
  tolerance_minutes: number;
  works_monday: boolean;
  works_tuesday: boolean;
  works_wednesday: boolean;
  works_thursday: boolean;
  works_friday: boolean;
  works_saturday: boolean;
  works_sunday: boolean;
}

const DAYS = [
  { key: 'works_monday',    label: 'Seg' },
  { key: 'works_tuesday',   label: 'Ter' },
  { key: 'works_wednesday', label: 'Qua' },
  { key: 'works_thursday',  label: 'Qui' },
  { key: 'works_friday',    label: 'Sex' },
  { key: 'works_saturday',  label: 'Sáb' },
  { key: 'works_sunday',    label: 'Dom' },
] as const;

function timeStr(v: string | null): string {
  if (!v) return '';
  return v.slice(0, 5); // "HH:MM:SS" → "HH:MM"
}

function calcWeekly(s: ScheduleRow): number {
  let total = 0;
  const t = (a: string | null, b: string | null) => {
    if (!a || !b) return 0;
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return (bh * 60 + bm) - (ah * 60 + am);
  };
  // Dia útil = (lunch_start - entry) + (exit - lunch_end)
  const utilMin = t(s.entry_time, s.lunch_start) + t(s.lunch_end, s.exit_time);
  if (s.works_monday)    total += utilMin;
  if (s.works_tuesday)   total += utilMin;
  if (s.works_wednesday) total += utilMin;
  if (s.works_thursday)  total += utilMin;
  if (s.works_friday)    total += utilMin;
  if (s.works_saturday && s.saturday_entry && s.saturday_exit) {
    total += t(s.saturday_entry, s.saturday_exit);
  }
  if (s.works_sunday) total += utilMin;
  return total;
}

export function EmployeeScheduleEditor({ employeeId, compact = false }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ScheduleRow | null>(null);

  const { data: schedule, isLoading } = useQuery({
    queryKey: ['employee-schedule', employeeId],
    queryFn: async (): Promise<ScheduleRow | null> => {
      const { data: emp, error: empErr } = await (supabase as any)
        .from('employees')
        .select('work_schedule_id')
        .eq('id', employeeId)
        .maybeSingle();
      if (empErr) throw empErr;
      if (!emp?.work_schedule_id) return null;

      const { data, error } = await (supabase as any)
        .from('work_schedules')
        .select('*')
        .eq('id', emp.work_schedule_id)
        .maybeSingle();
      if (error) throw error;
      return data as ScheduleRow;
    },
  });

  useEffect(() => {
    if (schedule) {
      setForm({
        ...schedule,
        entry_time: timeStr(schedule.entry_time),
        lunch_start: timeStr(schedule.lunch_start),
        lunch_end: timeStr(schedule.lunch_end),
        exit_time: timeStr(schedule.exit_time),
        saturday_entry: timeStr(schedule.saturday_entry),
        saturday_exit: timeStr(schedule.saturday_exit),
      });
    }
  }, [schedule]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await (supabase as any)
        .from('work_schedules')
        .update({
          entry_time: form.entry_time + ':00',
          lunch_start: form.lunch_start + ':00',
          lunch_end: form.lunch_end + ':00',
          exit_time: form.exit_time + ':00',
          saturday_entry: form.saturday_entry ? form.saturday_entry + ':00' : null,
          saturday_exit: form.saturday_exit ? form.saturday_exit + ':00' : null,
          tolerance_minutes: form.tolerance_minutes,
          works_monday: form.works_monday,
          works_tuesday: form.works_tuesday,
          works_wednesday: form.works_wednesday,
          works_thursday: form.works_thursday,
          works_friday: form.works_friday,
          works_saturday: form.works_saturday,
          works_sunday: form.works_sunday,
        })
        .eq('id', form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Horário atualizado');
      qc.invalidateQueries({ queryKey: ['employee-schedule', employeeId] });
      qc.invalidateQueries({ queryKey: ['employee-pending-summary'] });
    },
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!form) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Funcionário sem escala vinculada. Salve o funcionário primeiro pra que o sistema crie a escala padrão.
        </CardContent>
      </Card>
    );
  }

  const weeklyMin = calcWeekly(form);
  const weeklyH = Math.floor(weeklyMin / 60);
  const weeklyM = weeklyMin % 60;

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Horário de Trabalho
          </h3>
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            Carga semanal: {String(weeklyH).padStart(2, '0')}h{String(weeklyM).padStart(2, '0')}min
          </span>
        </div>
      )}

      {/* Dia útil */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Entrada</Label>
              <Input type="time" value={form.entry_time}
                onChange={e => setForm(f => f && { ...f, entry_time: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Saída almoço</Label>
              <Input type="time" value={form.lunch_start}
                onChange={e => setForm(f => f && { ...f, lunch_start: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Volta almoço</Label>
              <Input type="time" value={form.lunch_end}
                onChange={e => setForm(f => f && { ...f, lunch_end: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Saída</Label>
              <Input type="time" value={form.exit_time}
                onChange={e => setForm(f => f && { ...f, exit_time: e.target.value })} />
            </div>
          </div>

          {/* Sábado */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
            <div>
              <Label className="text-xs">Sábado — entrada</Label>
              <Input type="time" value={form.saturday_entry ?? ''}
                onChange={e => setForm(f => f && { ...f, saturday_entry: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Sábado — saída</Label>
              <Input type="time" value={form.saturday_exit ?? ''}
                onChange={e => setForm(f => f && { ...f, saturday_exit: e.target.value || null })} />
            </div>
          </div>

          {/* Dias da semana ativos */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Dias da semana que trabalha
            </Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {DAYS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Switch
                    checked={(form as any)[key]}
                    onCheckedChange={(v) => setForm(f => f && { ...f, [key]: v } as any)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tolerância */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
            <div>
              <Label className="text-xs">Tolerância (min)</Label>
              <NumberInput min={0} decimals={0} value={form.tolerance_minutes}
                onChange={n => setForm(f => f && { ...f, tolerance_minutes: n })} />
              <p className="text-[11px] text-muted-foreground mt-1">
                Variação ≤ esta zera no cálculo do saldo. Padrão CLT: 10min.
              </p>
            </div>
            <div className="flex items-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {save.isPending ? 'Salvando…' : 'Salvar horário'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {compact && (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          Carga semanal: {String(weeklyH).padStart(2, '0')}h{String(weeklyM).padStart(2, '0')}min
        </p>
      )}
    </div>
  );
}
