import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Moon, CircleNotch as Loader2, CheckCircle as CheckCircle2, ArrowRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PeriodRangeFilter } from '@/components/hr/PeriodRangeFilter';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from '@/hooks/useEmployees';
import {
  detectOvernightCarries,
  type OvernightCarry,
} from '@/lib/ponto/overnightPunches';
import { groupTimeRecordsBySystemEmployee } from '@/lib/ponto/systemTimesheet';

interface PersistTarget {
  employeeId: string;
  employeeName: string;
  carry: OvernightCarry;
  workRecordId: string | null;
  nextRecordId: string | null;
}

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

const manualClient = supabase as unknown as {
  rpc: (name: 'upsert_manual_time_record', args: {
    p_employee_id: string;
    p_record_date: string;
    p_punches: string[];
    p_reason: string;
    p_time_record_id: string | null;
  }) => Promise<{ error: { message: string } | null }>;
};

/**
 * Central de virada à noite — substitui o caminho Folga/Troca pra descanso após
 * turno que cruza meia-noite. A folha já carrega a madrugada no cálculo; aqui o
 * RH grava a correção no banco pra limpar a fila de pendências.
 */
export default function OvernightCarryPanel() {
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: employees = [] } = useEmployees();

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['time_records', 'overnight', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_records')
        .select('id, employee_id, employee_name, employee_external_id, record_date, punches')
        .gte('record_date', from)
        .lte('record_date', to)
        .order('record_date');
      if (error) throw error;
      return (data || []).map(r => ({
        ...r,
        punches: Array.isArray(r.punches) ? r.punches.map(String) : [],
        department: null as string | null,
        import_batch: '',
        created_at: '',
      }));
    },
    staleTime: 30_000,
  });

  const targets = useMemo(() => {
    const grouped = groupTimeRecordsBySystemEmployee(employees, records as never).byEmployee;
    const out: PersistTarget[] = [];
    for (const [employeeId, empRecords] of grouped) {
      const byDate = new Map<string, string[]>();
      const idByDate = new Map<string, string>();
      for (const rec of empRecords) {
        byDate.set(rec.record_date, Array.isArray(rec.punches) ? rec.punches.map(String) : []);
        idByDate.set(rec.record_date, rec.id);
      }
      const carries = detectOvernightCarries(byDate);
      const emp = employees.find(e => e.id === employeeId);
      for (const carry of carries) {
        out.push({
          employeeId,
          employeeName: emp?.name || empRecords[0]?.employee_name || '—',
          carry,
          workRecordId: idByDate.get(carry.workDate) || null,
          nextRecordId: idByDate.get(carry.nextDate) || null,
        });
      }
    }
    return out.sort((a, b) => a.carry.workDate.localeCompare(b.carry.workDate)
      || a.employeeName.localeCompare(b.employeeName));
  }, [employees, records]);

  const applyOne = async (target: PersistTarget) => {
    const key = `${target.employeeId}:${target.carry.workDate}`;
    setApplyingKey(key);
    try {
      const work = await manualClient.rpc('upsert_manual_time_record', {
        p_employee_id: target.employeeId,
        p_record_date: target.carry.workDate,
        p_punches: target.carry.workPunchesAfter,
        p_reason: 'virada-noite (saída na madrugada seguinte)',
        p_time_record_id: target.workRecordId,
      });
      if (work.error) throw new Error(work.error.message);

      if (target.carry.remainingNextPunches.length > 0 || target.nextRecordId) {
        const next = await manualClient.rpc('upsert_manual_time_record', {
          p_employee_id: target.employeeId,
          p_record_date: target.carry.nextDate,
          p_punches: target.carry.remainingNextPunches,
          p_reason: 'virada-noite (madrugada movida pro dia anterior)',
          p_time_record_id: target.nextRecordId,
        });
        if (next.error) throw new Error(next.error.message);
      }

      toast.success(`Virada aplicada: ${target.employeeName} · ${fmtDateBR(target.carry.workDate)}`);
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['employee-pending-summary'] });
      qc.invalidateQueries({ queryKey: ['pending-time-records'] });
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gravar a virada.');
    } finally {
      setApplyingKey(null);
    }
  };

  const applyAll = async () => {
    for (const target of targets) {
      await applyOne(target);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-1">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold">Virada à noite</h2>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Quando a saída cai depois da meia-noite, o relógio grava no dia seguinte.
              A folha já une essa madrugada no cálculo. Use esta tela só pra
              <span className="font-medium text-foreground"> gravar a correção</span> e
              limpar a pendência — não use Folga nem Troca de Dia pra isso.
            </p>
          </div>
          <PeriodRangeFilter
            value={{ from, to }}
            onChange={({ from: f, to: t }) => { setFrom(f); setTo(t); }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : targets.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={CheckCircle2}
            title="Nenhuma virada pendente neste período"
            description="Não há dias incompletos com saída de madrugada (< 05:00) no dia seguinte."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {targets.length} virada{targets.length === 1 ? '' : 's'} detectada{targets.length === 1 ? '' : 's'}
            </p>
            <Button size="sm" variant="outline" onClick={applyAll} disabled={!!applyingKey}>
              Aplicar todas
            </Button>
          </div>
          {targets.map(target => {
            const key = `${target.employeeId}:${target.carry.workDate}`;
            const busy = applyingKey === key;
            return (
              <div
                key={key}
                className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{target.employeeName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {fmtDateBR(target.carry.workDate)}
                      <ArrowRight className="mx-1 h-3 w-3" />
                      {fmtDateBR(target.carry.nextDate)}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {target.carry.workPunchesBefore.join(' · ') || '—'}
                    <span className="mx-1.5 text-foreground">+</span>
                    <span className="text-amber-700 dark:text-amber-400">
                      {target.carry.carriedPunches.join(' · ')}
                    </span>
                    <span className="mx-1.5">→</span>
                    {target.carry.workPunchesAfter.join(' · ')}
                  </p>
                  {target.carry.remainingNextPunches.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Dia seguinte fica com: {target.carry.remainingNextPunches.join(' · ')}
                    </p>
                  )}
                </div>
                <Button size="sm" className="shrink-0" onClick={() => applyOne(target)} disabled={!!applyingKey}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unir virada'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
