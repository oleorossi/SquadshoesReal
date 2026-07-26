// Registrar pagamento POR PRODUÇÃO a partir da Ficha de Montadores.
//
// Fonte única com a Folha: o pagamento vai em payroll_payments amarrado a uma
// payroll_run do período filtrado (period = rangeToPeriod). Este wrapper só
// GARANTE a run (cria/atualiza rascunho com o produzido e aprova — o trigger
// tg_payroll_payment_guard bloqueia pagamento em run rascunho) e então delega
// o form inteiro ao RegistrarPagamentoDialog do RH (valor sugerido, método,
// recibo, exclusão — tudo de lá; status pago derivado pelo tg_sync_payroll_paid).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CircleNotch as Loader2, Warning } from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RegistrarPagamentoDialog } from '@/components/hr/RegistrarPagamentoDialog';
import { formatPayrollPeriod } from '@/hooks/usePayrollPayments';
import { useUpdatePayrollStatus, useUpsertPayrollRun, type PayrollRun } from '@/hooks/useRH';
import { rangeToPeriod, payrollPeriodLabel } from '@/lib/payrollPeriod';
import { EPS } from '@/lib/montadorPagamentos';

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: { id: string; name: string; cpf?: string | null; role?: string | null };
  range: { from: string; to: string };
  produzido: number;
  paresMedio: number;
  paresDificil: number;
}

export function RegistrarPagamentoProducaoDialog({
  open, onOpenChange, employee, range, produzido, paresMedio, paresDificil,
}: Props) {
  const qc = useQueryClient();
  const upsertRun = useUpsertPayrollRun();
  const updateStatus = useUpdatePayrollStatus();
  const [preparing, setPreparing] = useState(false);
  const [ackDivergencia, setAckDivergencia] = useState(false);

  const period = rangeToPeriod(range.from, range.to);

  const { data: run, isLoading, refetch } = useQuery({
    queryKey: ['payroll_run_producao', employee.id, period],
    enabled: open && !!period,
    queryFn: async (): Promise<PayrollRun | null> => {
      const { data, error } = await (supabase as any)
        .from('payroll_runs')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('period', period)
        .maybeSingle();
      if (error) throw error;
      return (data as PayrollRun) ?? null;
    },
  });

  useEffect(() => {
    if (!open) setAckDivergencia(false);
  }, [open]);

  const invalidatePainel = () => {
    qc.invalidateQueries({ queryKey: ['montador_pagamentos'] });
    qc.invalidateQueries({ queryKey: ['payroll_run_producao'] });
  };
  const close = (o: boolean) => {
    if (!o) invalidatePainel();
    onOpenChange(o);
  };

  if (!open) return null;

  const pares = paresMedio + paresDificil;
  const rascunhoOuInexistente = !run || run.status === 'rascunho';
  const divergente = !!run && !rascunhoOuInexistente
    && Math.abs((Number(run.total_liquido) || 0) - produzido) > EPS;

  // Garante a run: cria/atualiza o rascunho com o produzido atual e aprova
  // (pagamento só entra em run aprovada — guard no banco).
  const prepararERegistrar = async () => {
    setPreparing(true);
    try {
      await upsertRun.mutateAsync({
        employee_id: employee.id,
        period,
        base_salary: 0, hourly_rate: 0, worked_minutes: 0, normal_minutes: 0, premium_minutes: 0,
        normal_value: 0, premium_value: 0, expected_minutes: 0, business_days: 0,
        business_days_worked: 0, absent_days: 0, absence_discount: 0, overtime_50_minutes: 0,
        deductions_amount: 0, overtime_amount: 0, advances_total: 0,
        total_proventos: produzido, total_descontos: 0,
        total_liquido: produzido, net_salary: produzido,
        notes: `Por par: ${pares} pares (${paresMedio} méd + ${paresDificil} dif) — Ficha de Montadores`,
        status: 'rascunho',
      } as any);
      const { data: fresh } = await refetch();
      if (!fresh) throw new Error('Folha não encontrada após criar — recarregue a página.');
      if (fresh.status === 'rascunho') {
        await updateStatus.mutateAsync({ id: fresh.id, status: 'aprovado' });
        await refetch();
      }
      invalidatePainel();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao preparar a folha do período.');
    } finally {
      setPreparing(false);
    }
  };

  // Fase pronta: run aprovada/paga e sem divergência pendente de ciência.
  if (run && !rascunhoOuInexistente && (!divergente || ackDivergencia)) {
    return (
      <RegistrarPagamentoDialog
        open={open}
        onOpenChange={close}
        run={run}
        employeeName={employee.name}
        employeeCpf={employee.cpf}
        employeeRole={employee.role}
      />
    );
  }

  // Fase de preparação: sem run, run rascunho, ou divergência a confirmar.
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar produção</DialogTitle>
          <DialogDescription>
            {employee.name} · {payrollPeriodLabel(range.from, range.to)}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando folha do período…
          </div>
        ) : divergente ? (
          <>
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <Warning className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A folha {formatPayrollPeriod(run!.period)} já foi {run!.status === 'pago' ? 'paga' : 'aprovada'} com{' '}
                <strong>{fmtBRL(Number(run!.total_liquido) || 0)}</strong>, mas a produção atual do período soma{' '}
                <strong>{fmtBRL(produzido)}</strong> (lançamentos alterados depois da aprovação). Os valores da
                folha ficam travados — o pagamento usa o valor da folha.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancelar</Button>
              <Button type="button" onClick={() => setAckDivergencia(true)}>Continuar assim mesmo</Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-amber-600">Pares méd</div>
                <div className="font-mono text-sm font-semibold tabular-nums">{paresMedio.toLocaleString('pt-BR')}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-red-600">Pares dif</div>
                <div className="font-mono text-sm font-semibold tabular-nums">{paresDificil.toLocaleString('pt-BR')}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Produzido</div>
                <div className="font-mono text-sm font-bold tabular-nums">{fmtBRL(produzido)}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {run
                ? 'A folha deste período está em rascunho — ela será atualizada com o produzido acima e aprovada pra receber o pagamento.'
                : 'Será criada a folha deste período com o produzido acima (por par, snapshot do apontamento) e aprovada pra receber o pagamento.'}
              {' '}Vales/adiantamentos não são descontados aqui — pra consolidar tudo, use a Folha (RH).
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancelar</Button>
              <Button type="button" disabled={preparing || produzido <= 0} onClick={prepararERegistrar} className="gap-2">
                {preparing && <Loader2 className="h-4 w-4 animate-spin" />}
                {run ? 'Aprovar folha e registrar' : 'Criar folha e registrar'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
