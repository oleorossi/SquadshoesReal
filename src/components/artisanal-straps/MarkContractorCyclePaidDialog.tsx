import { useEffect, useRef, useState } from 'react';
import { CircleNotch, CurrencyCircleDollar } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useMarkArtisanalStrapContractorPaymentCyclePaid,
  type StrapContractorPaymentCycleOperational,
} from '@/hooks/useArtisanalStraps';
import { todayISO } from '@/lib/date';
import { assertSettlementDate, FINANCIAL_SETTLEMENT_METHODS } from '@/lib/financialSettlement';
import { formatMoney } from '@/lib/utils';

interface Props {
  target: StrapContractorPaymentCycleOperational | null;
  onClose: () => void;
}

const METHOD_LABELS: Record<typeof FINANCIAL_SETTLEMENT_METHODS[number], string> = {
  pix: 'Pix', transferencia: 'Transferência', boleto: 'Boleto', dinheiro: 'Dinheiro',
  cheque: 'Cheque', cartao: 'Cartão', outro: 'Outro',
};

function paymentError(failure: unknown): string {
  const message = failure instanceof Error ? failure.message
    : failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string'
      ? failure.message : '';
  return message || 'Não foi possível confirmar o pagamento. Os dados foram mantidos; confira a conexão e tente novamente.';
}

function CyclePaidForm({ target, onClose }: Props & { target: StrapContractorPaymentCycleOperational }) {
  const markPaid = useMarkArtisanalStrapContractorPaymentCyclePaid();
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [dateError, setDateError] = useState('');
  const [methodError, setMethodError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef(false);
  const mounted = useRef(true);
  const busy = submitting || markPaid.isPending;
  const closedCycle = target.status === 'closed';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function close() {
    if (!submission.current && !markPaid.isPending) onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.current || markPaid.isPending || !closedCycle) return;
    let invalidDate = '';
    try {
      assertSettlementDate(paymentDate, todayISO());
    } catch {
      invalidDate = 'Informe a data real do pagamento, válida e não futura.';
    }
    const invalidMethod = (FINANCIAL_SETTLEMENT_METHODS as readonly string[]).includes(paymentMethod)
      ? '' : 'Selecione o meio de pagamento utilizado.';
    setDateError(invalidDate);
    setMethodError(invalidMethod);
    setError('');
    if (invalidDate || invalidMethod) return;

    submission.current = true;
    setSubmitting(true);
    try {
      const result = await markPaid.mutateAsync({ cycleId: target.cycle_id, paymentDate, paymentMethod });
      if (!mounted.current) return;
      if (result?.cycle_id !== target.cycle_id
        || result?.accounts_payable_id !== target.accounts_payable_id
        || (result?.status !== 'paid' && result?.replayed !== true)) {
        throw new Error('O servidor não confirmou este ciclo como pago. Atualize o ciclo antes de repetir.');
      }
      onClose();
    } catch (failure) {
      if (mounted.current) setError(paymentError(failure));
    } finally {
      submission.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md" hideCloseButton={busy}
        onEscapeKeyDown={event => { if (submission.current || markPaid.isPending) event.preventDefault(); }}
        onInteractOutside={event => { if (submission.current || markPaid.isPending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Confirmar pagamento do ciclo</DialogTitle>
          <DialogDescription>
            {target.contractor_name} · líquido do ciclo {target.net_amount == null ? 'não disponível' : formatMoney(target.net_amount)}
          </DialogDescription>
        </DialogHeader>
        <form aria-label="Confirmação de pagamento do ciclo" onSubmit={submit} noValidate className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Registre um pagamento já realizado. O sistema quita somente o saldo restante da conta a pagar,
            considerando baixas anteriores. Esta ação não transfere dinheiro nem altera o saldo bancário.
          </p>
          {!closedCycle && <p role="alert" className="text-sm text-destructive">Este ciclo não está mais fechado e disponível para pagamento. Atualize a lista.</p>}
          <div className="space-y-1">
            <Label htmlFor="contractor-cycle-paid-date">Data real do pagamento</Label>
            <Input id="contractor-cycle-paid-date" type="date" max={todayISO()} required
              disabled={busy || !closedCycle} value={paymentDate}
              aria-invalid={!!dateError} aria-describedby={dateError ? 'contractor-cycle-date-error' : undefined}
              onChange={event => { setPaymentDate(event.target.value); setDateError(''); }} />
            {dateError && <p id="contractor-cycle-date-error" className="text-sm text-destructive">{dateError}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="contractor-cycle-paid-method">Meio de pagamento</Label>
            <Select value={paymentMethod} disabled={busy || !closedCycle}
              onValueChange={value => { setPaymentMethod(value); setMethodError(''); }}>
              <SelectTrigger id="contractor-cycle-paid-method" aria-invalid={!!methodError}
                aria-describedby={methodError ? 'contractor-cycle-method-error' : undefined}>
                <SelectValue placeholder="Selecione o meio utilizado" />
              </SelectTrigger>
              <SelectContent>
                {FINANCIAL_SETTLEMENT_METHODS.map(method => (
                  <SelectItem key={method} value={method}>{METHOD_LABELS[method]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {methodError && <p id="contractor-cycle-method-error" className="text-sm text-destructive">{methodError}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {busy && <p role="status" className="text-sm text-muted-foreground">Confirmando o pagamento. Aguarde antes de sair.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={busy || !closedCycle}>
              {busy ? <CircleNotch className="mr-1 h-4 w-4 animate-spin" /> : <CurrencyCircleDollar className="mr-1 h-4 w-4" />}
              {busy ? 'Confirmando…' : 'Confirmar pago'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MarkContractorCyclePaidDialog({ target, onClose }: Props) {
  if (!target) return null;
  // Cada abertura/ciclo ganha um rascunho independente, sem data herdada.
  return <CyclePaidForm key={target.cycle_id} target={target} onClose={onClose} />;
}
