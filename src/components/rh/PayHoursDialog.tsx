import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CurrencyDollar, Clock, Info, Wallet } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { usePayBankHours } from '@/hooks/useRH';

interface PayHoursDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  balanceMinutes: number;     // saldo atual em minutos (limite de pagamento)
}

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function PayHoursDialog({
  open, onOpenChange, employeeId, employeeName, balanceMinutes,
}: PayHoursDialogProps) {
  const balanceHours = Math.floor(balanceMinutes / 60 * 100) / 100;
  const [hours, setHours] = useState<number>(0);
  const [hourlyRate, setHourlyRate] = useState<number>(0);
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string>('');

  const payMut = usePayBankHours();

  // Busca valor da hora padrão do funcionário (overtime_hourly_rate, ou salary/220 como fallback)
  const { data: employee } = useQuery({
    queryKey: ['employee_hourly_rate', employeeId],
    enabled: open && !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, salary, overtime_hourly_rate')
        .eq('id', employeeId)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; salary: number | null; overtime_hourly_rate: number | null };
    },
    staleTime: 60_000,
  });

  // Bancos pra escolher de onde sai o dinheiro
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank_accounts_active'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bank_accounts')
        .select('id, name, bank_name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string; bank_name: string | null }>;
    },
    staleTime: 60_000,
  });

  // Sugere valor/hora ao abrir / quando employee carrega
  useEffect(() => {
    if (!open || !employee) return;
    const suggested = Number(employee.overtime_hourly_rate) > 0
      ? Number(employee.overtime_hourly_rate)
      : Number(employee.salary) > 0
        ? +(Number(employee.salary) / 220).toFixed(2)
        : 0;
    setHourlyRate(suggested);
    setHours(0);
    setNotes('');
    setBankAccountId('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
  }, [open, employee]);

  const total = useMemo(() => +(hours * hourlyRate).toFixed(2), [hours, hourlyRate]);
  const exceedsBalance = hours > balanceHours + 0.001;
  const usesSalaryFallback = employee && !employee.overtime_hourly_rate && employee.salary;

  const handleSubmit = async () => {
    if (!hours || hours <= 0) return;
    if (exceedsBalance) return;
    try {
      await payMut.mutateAsync({
        employee_id: employeeId,
        hours,
        hourly_rate: hourlyRate,
        payment_date: paymentDate,
        notes: notes || undefined,
        bank_account_id: bankAccountId || undefined,
      });
      onOpenChange(false);
    } catch {
      // toast já é exibido pelo hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CurrencyDollar className="h-5 w-5 text-primary" />
            Pagar horas extras
          </DialogTitle>
          <DialogDescription>
            {employeeName} · saldo disponível{' '}
            <strong className="text-foreground">{balanceHours.toFixed(2).replace('.', ',')} h</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Horas a pagar */}
          <div>
            <Label htmlFor="hours">Horas a pagar</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                id="hours"
                type="number"
                step="0.25"
                min={0}
                max={balanceHours}
                value={hours || ''}
                onChange={e => setHours(Number(e.target.value))}
                placeholder="0"
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHours(balanceHours)}
                disabled={balanceHours <= 0}
                className="shrink-0"
              >
                Tudo ({balanceHours.toFixed(2).replace('.', ',')}h)
              </Button>
            </div>
            {exceedsBalance && (
              <p className="text-xs text-destructive mt-1">
                Excede o saldo disponível.
              </p>
            )}
          </div>

          {/* Valor da hora */}
          <div>
            <Label htmlFor="hourly_rate">Valor por hora (R$)</Label>
            <Input
              id="hourly_rate"
              type="number"
              step="0.01"
              min={0}
              value={hourlyRate || ''}
              onChange={e => setHourlyRate(Number(e.target.value))}
              placeholder="0,00"
              className="mt-1"
            />
            {usesSalaryFallback && (
              <p className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                Funcionário sem "Valor da hora extra" cadastrado — sugerido salário ÷ 220h.
                Cadastre na ficha do funcionário pra evitar ajustar aqui toda vez.
              </p>
            )}
          </div>

          {/* Total destacado */}
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total a pagar</div>
            <div className="display text-3xl font-bold text-primary mt-1 tabular-nums">
              {total > 0 ? fmtBRL(total) : '—'}
            </div>
            {hours > 0 && hourlyRate > 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {hours.toString().replace('.', ',')} h × {fmtBRL(hourlyRate)}
              </div>
            )}
          </div>

          {/* Data e banco em grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="payment_date">Data do pagamento</Label>
              <Input
                id="payment_date"
                type="date"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="bank">
                <Wallet className="inline h-3 w-3 mr-1" />
                Banco (opcional)
              </Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger id="bank" className="mt-1">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}{b.bank_name ? ` · ${b.bank_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Observação */}
          <div>
            <Label htmlFor="notes">Observação (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex: ref. plantão 25/04, etc."
              className="mt-1 text-sm"
            />
          </div>

          {/* Avisos sobre o que vai acontecer */}
          <div className="rounded-md bg-muted/40 p-3 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-start gap-1.5">
              <Clock className="h-3 w-3 mt-0.5 text-primary" />
              <span><strong className="text-foreground">{hours || 0} h</strong> serão debitadas do banco de horas.</span>
            </div>
            <div className="flex items-start gap-1.5">
              <CurrencyDollar className="h-3 w-3 mt-0.5 text-primary" />
              <span>Despesa de <strong className="text-foreground">{total > 0 ? fmtBRL(total) : '—'}</strong> criada no Financeiro (status: pendente até conciliar).</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={!hours || hours <= 0 || !hourlyRate || hourlyRate <= 0 || exceedsBalance || payMut.isPending}
          >
            {payMut.isPending ? 'Registrando...' : 'Registrar pagamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PayHoursDialog;
