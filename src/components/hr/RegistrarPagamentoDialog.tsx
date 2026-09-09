import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Paperclip, ArrowCounterClockwise, Printer, FileArrowDown, X, CircleNotch,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn, formatCurrency } from '@/lib/utils';
import { formatDateBR } from '@/lib/dateOnly';
import type { PayrollRun } from '@/hooks/useRH';
import {
  usePayrollPayments, useRegisterPayrollPayment, useReversePayrollPayment,
  getReceiptSignedUrl, PAYMENT_METHODS, paymentMethodLabel, formatPayrollPeriod,
  createPayrollPaymentIdempotencyKey,
  type PaymentMethod,
} from '@/hooks/usePayrollPayments';
import { printPayrollReceipt } from '@/lib/printPayrollReceipt';

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: PayrollRun | null;
  employeeName: string;
  employeeCpf?: string | null;
  employeeRole?: string | null;
}

export function RegistrarPagamentoDialog({ open, onOpenChange, run, employeeName, employeeCpf, employeeRole }: Props) {
  const { data: payments = [] } = usePayrollPayments(open ? run?.id ?? null : null);
  const register = useRegisterPayrollPayment();
  const reversePayment = useReversePayrollPayment();
  const fileRef = useRef<HTMLInputElement>(null);
  const touched = useRef(false);
  const idempotencyKey = useRef(createPayrollPaymentIdempotencyKey());

  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reverseTarget, setReverseTarget] = useState<{ id: string; amount: number } | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  const liquido = run?.total_liquido ?? 0;
  const activePayments = payments.filter(payment => !payment.reversed_at);
  const paidTotal = round2(activePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const saldo = round2(liquido - paidTotal);
  const quitado = saldo <= 0.005;
  const amountExceedsBalance = amount > Math.max(saldo, 0) + 0.005;
  const today = todayISO();
  const futurePaymentDate = Boolean(paidOn && paidOn > today);

  // Reset ao abrir; recalcula o valor sugerido (saldo) enquanto o usuário não mexe.
  useEffect(() => {
    if (!open) return;
    touched.current = false;
    idempotencyKey.current = createPayrollPaymentIdempotencyKey();
    setMethod('pix'); setPaidOn(todayISO()); setReference(''); setNotes(''); setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, run?.id]);
  useEffect(() => {
    if (open && !touched.current) setAmount(saldo > 0 ? saldo : 0);
  }, [open, saldo]);

  if (!run) return null;

  const rascunho = run.status === 'rascunho';
  const paymentRegistrationAllowed = run.status === 'aprovado' || run.status === 'pago';
  const canSubmit = paymentRegistrationAllowed && amount > 0 && !amountExceedsBalance
    && Boolean(paidOn) && !futurePaymentDate && !register.isPending;

  const submit = () => {
    if (amountExceedsBalance) {
      toast.error(`O pagamento não pode superar o saldo de ${formatCurrency(Math.max(saldo, 0))}.`);
      return;
    }
    if (!paidOn || futurePaymentDate) {
      toast.error('A data do pagamento deve ser hoje ou uma data anterior.');
      return;
    }
    if (!canSubmit) return;
    register.mutate(
      {
        payrollRunId: run.id,
        employeeId: run.employee_id,
        amount,
        method,
        paidOn,
        reference,
        notes,
        file,
        idempotencyKey: idempotencyKey.current,
      },
      {
        onSuccess: () => {
          touched.current = false;
          idempotencyKey.current = createPayrollPaymentIdempotencyKey();
          setFile(null); setReference(''); setNotes('');
          if (fileRef.current) fileRef.current.value = '';
        },
      },
    );
  };

  const openReceipt = async (path: string) => {
    try { window.open(await getReceiptSignedUrl(path), '_blank'); }
    catch { toast.error('Falha ao abrir o recibo.'); }
  };

  // Pares gravados na folha ⇒ regime por par: o recibo assinado descreve
  // PRODUÇÃO (dias produtivos + pares), não "salário". Ler da folha, e não da
  // Ficha de Montadores, é o que garante que o recibo emitido meses depois
  // mostre o que foi efetivamente pago.
  const paresMedio = Number(run.pares_medio) || 0;
  const paresDificil = Number(run.pares_dificil) || 0;
  const producaoDoRecibo = paresMedio + paresDificil > 0
    ? { diasProdutivos: run.business_days_worked || 0, paresMedio, paresDificil }
    : null;

  const printFor = (p: typeof payments[number]) =>
    printPayrollReceipt({
      employeeName, cpf: employeeCpf, role: employeeRole,
      period: run.period, amount: p.amount, paidOn: p.paid_on,
      method: p.method, reference: p.reference, liquido: run.total_liquido,
      producao: producaoDoRecibo,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {employeeName} · folha de {formatPayrollPeriod(run.period)}
          </DialogDescription>
        </DialogHeader>

        {/* Resumo líquido / pago / saldo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Líquido</div>
            <div className="font-mono tabular-nums font-semibold text-sm">{formatCurrency(liquido)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pago</div>
            <div className="font-mono tabular-nums font-semibold text-sm">{formatCurrency(paidTotal)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Saldo</div>
            <div className={cn('font-mono tabular-nums font-bold text-sm', quitado ? 'text-emerald-600' : 'text-amber-600')}>
              {quitado ? 'Quitado' : formatCurrency(saldo)}
            </div>
          </div>
        </div>

        {/* Pagamentos já registrados */}
        {payments.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Pagamentos ({activePayments.length} ativo{activePayments.length === 1 ? '' : 's'}
              {payments.length !== activePayments.length ? ` · ${payments.length} registros` : ''})
            </div>
            {payments.map(p => {
              const isReversed = Boolean(p.reversed_at);
              return (
                <div key={p.id} className={cn('flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-sm', isReversed && 'bg-muted/30')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-mono tabular-nums font-semibold', isReversed && 'text-muted-foreground line-through')}>{formatCurrency(p.amount)}</span>
                      <span className="text-xs text-muted-foreground">{paymentMethodLabel(p.method)}</span>
                      <span className="text-xs text-muted-foreground">· {formatDateBR(p.paid_on)}</span>
                      {isReversed && <Badge variant="destructive-soft">Estornado</Badge>}
                    </div>
                    {(p.reference || p.notes) && (
                      <div className="truncate text-[11px] text-muted-foreground">{[p.reference, p.notes].filter(Boolean).join(' · ')}</div>
                    )}
                    {isReversed && p.reversal_reason && (
                      <div className="truncate text-[11px] text-destructive" title={p.reversal_reason}>
                        Motivo do estorno: {p.reversal_reason}
                      </div>
                    )}
                  </div>
                  {p.receipt_path
                    ? <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Abrir recibo anexado" onClick={() => openReceipt(p.receipt_path)}><FileArrowDown className="h-4 w-4 text-emerald-600" /></Button>
                    : <span className="text-xs text-muted-foreground px-1" title="Sem recibo anexado">sem recibo</span>}
                  {!isReversed && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Imprimir recibo pra assinar" onClick={() => printFor(p)}><Printer className="h-4 w-4" /></Button>
                  )}
                  {!isReversed && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Estornar pagamento" aria-label="Estornar pagamento"
                      disabled={reversePayment.isPending}
                      onClick={() => {
                        setReversalReason('');
                        setReverseTarget({ id: p.id, amount: Number(p.amount) || 0 });
                      }}>
                      <ArrowCounterClockwise className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Formulário de novo pagamento */}
        {rascunho ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Aprove a folha antes de registrar o pagamento.
          </div>
        ) : !paymentRegistrationAllowed ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Folha {run.status === 'cancelado' ? 'cancelada' : `em status ${run.status}`}. Este documento está encerrado e não aceita novos pagamentos.
          </div>
        ) : quitado ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            Folha quitada. Você ainda pode abrir ou imprimir os recibos acima.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Registre aqui somente pagamentos do saldo líquido desta folha. Adiantamentos são lançados em Adiantamentos / Vales.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pay-amount">Valor</Label>
                <CurrencyInput id="pay-amount" value={amount} onChange={(v) => { touched.current = true; setAmount(v); }} />
                {amountExceedsBalance && (
                  <p role="alert" className="text-xs text-destructive">
                    O valor não pode superar o saldo de {formatCurrency(Math.max(saldo, 0))}.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-date">Data</Label>
                <Input id="pay-date" type="date" max={today} value={paidOn} onChange={e => setPaidOn(e.target.value)} />
                {futurePaymentDate && (
                  <p role="alert" className="text-xs text-destructive">
                    Pagamentos futuros não podem quitar a folha hoje.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Forma de pagamento</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-ref">Comprovante / Txid <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input id="pay-ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="Ex.: E1234..." />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-notes">Observação <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Textarea id="pay-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: primeira parcela do saldo líquido, complemento..." />
            </div>

            <div className="space-y-1">
              <Label>Recibo assinado <span className="text-muted-foreground font-normal">(foto ou PDF)</span></Label>
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="flex-1 justify-start gap-2 h-10 font-normal" onClick={() => fileRef.current?.click()}>
                  <Paperclip className="h-4 w-4 shrink-0" />
                  <span className="truncate">{file ? file.name : 'Anexar recibo assinado'}</span>
                </Button>
                {file && (
                  <Button type="button" variant="ghost" size="sm" className="h-10 w-10 p-0" title="Remover arquivo"
                    onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Depois de registrar, pagamento e recibo ficam imutáveis. Para corrigir ou anexar um arquivo omitido, estorne e registre um novo pagamento.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {paymentRegistrationAllowed && !quitado && (
            <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
              {register.isPending && <CircleNotch className="h-4 w-4 animate-spin" />}
              Registrar {formatCurrency(amount)}
            </Button>
          )}
        </DialogFooter>

        <AlertDialog
          open={!!reverseTarget}
          onOpenChange={o => {
            if (!o && !reversePayment.isPending) {
              setReverseTarget(null);
              setReversalReason('');
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Estornar pagamento?</AlertDialogTitle>
              <AlertDialogDescription>
                {reverseTarget ? `Pagamento de ${formatCurrency(reverseTarget.amount)}. ` : ''}
                O registro e o recibo anexado serão preservados no histórico. O valor deixará de compor o total pago e o saldo da folha será recalculado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="payment-reversal-reason">Motivo do estorno *</Label>
              <Textarea
                id="payment-reversal-reason"
                value={reversalReason}
                onChange={event => setReversalReason(event.target.value)}
                placeholder="Explique por que este pagamento deve ser estornado"
                rows={3}
                autoFocus
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={reversePayment.isPending}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!reversalReason.trim() || reversePayment.isPending}
                onClick={event => {
                  event.preventDefault();
                  if (!reverseTarget || !reversalReason.trim()) return;
                  reversePayment.mutate(
                    { id: reverseTarget.id, reason: reversalReason },
                    {
                      onSuccess: () => {
                        setReverseTarget(null);
                        setReversalReason('');
                      },
                    },
                  );
                }}
              >
                {reversePayment.isPending && <CircleNotch className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar estorno
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
