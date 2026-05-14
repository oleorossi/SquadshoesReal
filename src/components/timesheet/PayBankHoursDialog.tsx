import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { usePayBankHours } from '@/hooks/useRH';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    employee_id: string;
    employee_name: string;
    /** Saldo total atual em minutos (movements + derivado de batidas) */
    balance_min: number;
    /** Valor-hora do funcionário (hourly_rate ou salary/220). Opcional — exibição. */
    hourly_rate?: number | null;
    /** Multiplicador de HE (default 1.2). Opcional — exibição. */
    overtime_multiplier?: number | null;
  } | null;
}

function fmtH(min: number) {
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `${min < 0 ? '-' : ''}${h}h${m > 0 ? ` ${m}min` : ''}`;
}

export function PayBankHoursDialog({ open, onOpenChange, employee }: Props) {
  const pay = usePayBankHours();
  const [hoursStr, setHoursStr] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) { setHoursStr(''); setNotes(''); }
  }, [open, employee?.employee_id]);

  if (!employee) return null;

  const balanceMin = Math.max(0, employee.balance_min);
  const balanceH = balanceMin / 60;
  // Aceita "10" ou "10,5" ou "10.5"
  const payHours = Number((hoursStr || '').replace(',', '.'));
  const payMinutes = Number.isFinite(payHours) ? Math.round(payHours * 60) : 0;
  const hourlyRate = Number(employee.hourly_rate) || 0;
  const multiplier = Number(employee.overtime_multiplier) || 1.2;
  // Estimativa client-side — o valor oficial é recalculado no RPC
  const estValue = payMinutes > 0 ? (payMinutes / 60) * hourlyRate * multiplier : 0;
  const remainingMin = balanceMin - payMinutes;

  const overBalance = payMinutes > balanceMin;
  const invalid = payMinutes <= 0 || overBalance;

  const handleConfirm = async () => {
    if (invalid) return;
    await pay.mutateAsync({
      employeeId: employee.employee_id,
      payMinutes,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Realizar pagamento de banco de horas
          </DialogTitle>
          <DialogDescription>
            Saca horas do saldo acumulado de <strong>{employee.employee_name}</strong>.
            O valor vira despesa no financeiro e dá baixa no banco de horas.
            O restante permanece no banco.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo atual no banco:</span>
              <span className="font-mono font-semibold tabular-nums">{fmtH(balanceMin)}</span>
            </div>
            {hourlyRate > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor-hora × multiplicador:</span>
                <span className="font-mono tabular-nums">
                  {hourlyRate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} × {multiplier}
                </span>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Horas a pagar</Label>
            <Input
              value={hoursStr}
              onChange={e => setHoursStr(e.target.value)}
              placeholder={`Máx ${balanceH.toFixed(1)}h`}
              inputMode="decimal"
              className="mt-1 h-9 font-mono"
            />
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {[balanceH * 0.25, balanceH * 0.5, balanceH].map((preset, i) => (
                <Button
                  key={i}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setHoursStr(preset.toFixed(preset % 1 === 0 ? 0 : 1))}
                >
                  {i === 2 ? 'Tudo' : `${preset.toFixed(1)}h`}
                </Button>
              ))}
            </div>
            {overBalance && (
              <p className="text-[11px] text-red-600 mt-1">
                Excede o saldo disponível ({fmtH(balanceMin)}).
              </p>
            )}
          </div>

          {payMinutes > 0 && !overBalance && (
            <div className="rounded-md bg-primary/5 px-3 py-2 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor estimado a pagar:</span>
                <span className="font-mono font-semibold">
                  {estValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-1 mt-1">
                <span>Permanece no banco após o pagamento:</span>
                <span className="font-mono">{fmtH(remainingMin)}</span>
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Observações (opcional)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="mt-1 text-sm"
              placeholder="Ex.: adiantamento solicitado pelo funcionário..."
            />
          </div>

          <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
            <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ao confirmar:
            </p>
            <ul className="list-disc list-inside text-emerald-800 dark:text-emerald-300 space-y-0.5">
              <li>Débito de {payMinutes > 0 ? fmtH(payMinutes) : '—'} no banco de horas</li>
              <li>Lançamento de despesa criado no financeiro</li>
              <li>Saldo restante mantido automaticamente no banco</li>
            </ul>
            <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 mt-1">
              O valor exato é recalculado no servidor com o valor-hora atual do funcionário.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={invalid || pay.isPending}>
            {pay.isPending ? 'Processando...' : 'Confirmar pagamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
