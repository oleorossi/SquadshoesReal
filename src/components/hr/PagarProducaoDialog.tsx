// Pagar a produção de UMA pessoa numa janela, direto da Ficha de Montadores.
//
// Pessoa a pessoa de propósito (decisão do dono, 07/08/2026): é assim que o
// dinheiro sai — cada montador recebe e assina o seu —, e um R$/par errado
// atinge uma linha, não o setor inteiro.
//
// Dois passos, e o segundo depende do primeiro: só depois que a folha existe e
// foi aprovada é que se sabe QUANTO pagar. A tela soma a produção em aberto,
// mas quem decide o valor é o banco — a reivindicação pode pegar menos dias (se
// outra folha já era dona de algum) e os adiantamentos da janela são
// descontados no mesmo movimento. Por isso o valor sugerido no passo 2 vem do
// líquido relido, nunca do total exibido no passo 1.
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Paperclip, X, CircleNotch, Warning, CheckCircle } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import { formatDateBR } from '@/lib/dateOnly';
import {
  useRegisterPayrollPayment, PAYMENT_METHODS, type PaymentMethod,
} from '@/hooks/usePayrollPayments';
import { useAbrirFolhaProducao, type FolhaProducaoAberta } from '@/hooks/useFichaProducaoPagamento';

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  employeeName: string;
  /** Janela do filtro da Ficha (na cadência semanal, segunda → domingo). */
  from: string;
  to: string;
  /** O que a tela calculou como em aberto — referência, não o valor pago. */
  valorAberto: number;
  /** Chamado após registrar o pagamento, para a Ficha recarregar. */
  onPago?: () => void;
}

export function PagarProducaoDialog({
  open, onOpenChange, employeeId, employeeName, from, to, valorAberto, onPago,
}: Props) {
  const abrirFolha = useAbrirFolhaProducao();
  const register = useRegisterPayrollPayment();
  const fileRef = useRef<HTMLInputElement>(null);
  const touched = useRef(false);

  const [folha, setFolha] = useState<FolhaProducaoAberta | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    touched.current = false;
    setFolha(null); setAmount(0); setMethod('pix'); setPaidOn(todayISO());
    setReference(''); setNotes(''); setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, employeeId, from, to]);

  // Enquanto o usuário não mexer no valor, ele acompanha o líquido da folha.
  useEffect(() => {
    if (folha && !touched.current) setAmount(folha.liquido > 0 ? folha.liquido : 0);
  }, [folha]);

  const janela = `${formatDateBR(from)} a ${formatDateBR(to)}`;

  async function handleAbrir() {
    const r = await abrirFolha.mutateAsync({ employeeId, from, to });
    setFolha(r);
  }

  async function handlePagar() {
    if (!folha) return;
    await register.mutateAsync({
      payrollRunId: folha.runId,
      employeeId,
      amount,
      method,
      paidOn,
      reference,
      notes,
      file,
    });
    onPago?.();
    onOpenChange(false);
  }

  const podePagar = !!folha && amount > 0 && !register.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pagar produção — {employeeName}</DialogTitle>
          <DialogDescription>{janela}</DialogDescription>
        </DialogHeader>

        {!folha ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Produção em aberto na janela</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{formatCurrency(valorAberto)}</div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Abrir a folha reserva estes dias para este pagamento — nenhuma outra folha
                consegue pegá-los depois. O valor final sai daqui: se algum dia já
                pertencer a outra folha, ou se houver adiantamento nesta janela, o líquido
                muda e você confere antes de pagar.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleAbrir} disabled={abrirFolha.isPending || valorAberto <= 0} className="gap-1.5">
                {abrirFolha.isPending && <CircleNotch className="h-4 w-4 animate-spin" />}
                Abrir folha da semana
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Produção reivindicada</span>
                <span className="tabular-nums font-semibold text-foreground">{formatCurrency(folha.bruto)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Adiantamentos descontados</span>
                <span className="tabular-nums font-semibold text-foreground">− {formatCurrency(folha.descontos)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-semibold text-foreground">Líquido a pagar</span>
                <span className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(folha.liquido)}</span>
              </div>
              {Math.abs(folha.bruto - valorAberto) > 0.005 && (
                <p className="mt-3 flex gap-1.5 text-xs text-amber-600">
                  <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  A folha reivindicou {formatCurrency(folha.bruto)}, e a tela mostrava{' '}
                  {formatCurrency(valorAberto)}. Vale o que a folha reivindicou.
                </p>
              )}
              {!!folha.notes && (
                <p className="mt-2 flex gap-1.5 text-xs text-amber-600">
                  <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="whitespace-pre-wrap">{folha.notes}</span>
                </p>
              )}
              {folha.liquido <= 0 && (
                <p className="mt-2 flex gap-1.5 text-xs text-amber-600">
                  <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Líquido zero ou negativo — não há o que pagar nesta janela. A folha fica
                  aprovada e o saldo devedor segue para a próxima.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pp-valor">Valor pago</Label>
                <CurrencyInput
                  id="pp-valor"
                  value={amount}
                  onChange={(v) => { touched.current = true; setAmount(v); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-data">Data do pagamento</Label>
                <Input id="pp-data" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-metodo">Forma</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger id="pp-metodo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-ref">Referência</Label>
                <Input id="pp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Opcional" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pp-obs">Observação</Label>
              <Textarea id="pp-obs" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pp-recibo">Recibo assinado (opcional)</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef} id="pp-recibo" type="file" className="hidden"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
                  <Paperclip className="h-4 w-4" /> Anexar
                </Button>
                {file && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {file.name}
                    <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                      aria-label="Remover recibo">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button onClick={handlePagar} disabled={!podePagar} className="gap-1.5">
                {register.isPending ? <CircleNotch className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Registrar pagamento
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
