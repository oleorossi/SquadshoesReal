import { useRef, useState } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBankAccounts } from '@/hooks/useFinanceAdvanced';
import { assertSettlementDate, parseSettlementAmount, settlementAmountCents, type RegisterSettlementEntry, type SettlementTarget } from '@/lib/financialSettlement';
import { formatMoney } from '@/lib/utils';

interface Props {
  targets: SettlementTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (entries: RegisterSettlementEntry[]) => Promise<void>;
  pending: boolean;
}

const METHODS = [
  { value: 'pix', label: 'Pix' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'outro', label: 'Outro' },
];

function amountCents(raw: string): number | null {
  try {
    return settlementAmountCents(parseSettlementAmount(raw));
  } catch {
    return null;
  }
}

function balanceCents(amount: number): number | null {
  try {
    return settlementAmountCents(amount);
  } catch {
    return null;
  }
}

function targetsKey(targets: SettlementTarget[]): string {
  return JSON.stringify(targets.map(target => [target.kind, target.id, target.openAmount]));
}

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value: string): boolean {
  try {
    assertSettlementDate(value, localToday());
    return true;
  } catch {
    return false;
  }
}

interface FormProps {
  targets: SettlementTarget[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (entries: RegisterSettlementEntry[]) => Promise<void>;
}

function SettlementForm({ targets, busy, onCancel, onConfirm }: FormProps) {
  const bankAccounts = useBankAccounts();
  // A abertura é uma sessão de edição. Refetch/re-render não apaga o que foi
  // digitado; se o conjunto ou saldo mudar, exige reabrir com os dados atuais.
  const [initialTargets] = useState(() => targets.map(target => ({ ...target })));
  const [amounts, setAmounts] = useState(() => initialTargets.map(target => {
    const cents = balanceCents(target.openAmount);
    return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
  }));
  const [settledOn, setSettledOn] = useState('');
  const [method, setMethod] = useState('');
  const [bankAccountId, setBankAccountId] = useState('none');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeAccounts = bankAccounts.isError ? [] : (bankAccounts.data || []).filter(account => account.active === true);
  const hasBankAccount = bankAccountId === 'none' || activeAccounts.some(account => account.id === bankAccountId);
  const parsedAmounts = amounts.map(amountCents);
  const totalCents = parsedAmounts.reduce((sum, cents) => sum + (cents || 0), 0);
  const rowsValid = parsedAmounts.every((cents, index) => cents != null && cents <= (balanceCents(initialTargets[index].openAmount) || 0));
  const totalValid = Number.isSafeInteger(totalCents);
  const dateValid = validDate(settledOn);
  const methodValid = METHODS.some(option => option.value === method);
  const targetsChanged = targetsKey(initialTargets) !== targetsKey(targets);
  const invalidTargets = initialTargets.length === 0 || initialTargets.length > 200
    || new Set(initialTargets.map(target => `${target.kind}:${target.id}`)).size !== initialTargets.length
    || initialTargets.some(target => !target.id || !['payable', 'receivable'].includes(target.kind) || balanceCents(target.openAmount) == null);
  const blocked = busy || bankAccounts.isPending || bankAccounts.isError || targetsChanged || invalidTargets;
  const payableCount = initialTargets.filter(target => target.kind === 'payable').length;
  const receivableCount = initialTargets.length - payableCount;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked) return;
    setAttempted(true);
    setSaveError(null);
    if (!rowsValid || !totalValid || !dateValid || !methodValid || !hasBankAccount) return;
    const entries: RegisterSettlementEntry[] = initialTargets.map((target, index) => ({
      kind: target.kind,
      account_id: target.id,
      amount: parsedAmounts[index]! / 100,
      settled_on: settledOn,
      method,
      bank_account_id: bankAccountId === 'none' ? null : bankAccountId,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    }));
    try {
      await onConfirm(entries);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível registrar. Confira os dados e tente novamente.');
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4" aria-busy={busy} aria-label="Registro de movimentos financeiros">
      <DialogHeader>
        <DialogTitle>Registrar pagamento ou recebimento</DialogTitle>
        <DialogDescription>
          Registre somente um movimento já ocorrido. Esta ação não envia dinheiro nem executa transferências bancárias.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-sm border border-border bg-muted/30 p-3 text-sm" aria-label="Resumo do lote">
        <p>{initialTargets.length} título(s) · {payableCount} pagamento(s) · {receivableCount} recebimento(s)</p>
        <p className="mt-1 font-semibold">Total dos registros: {rowsValid && totalValid ? formatMoney(totalCents / 100) : 'Revise os valores'}</p>
        {initialTargets.length > 1 ? <p className="mt-1 text-muted-foreground">A data, a forma, a conta e as observações abaixo serão usadas em todos os títulos.</p> : null}
      </div>

      {invalidTargets ? <p role="alert" className="text-sm text-destructive">Selecione de 1 a 200 títulos distintos com saldo aberto válido.</p> : null}
      {targetsChanged ? <p role="alert" className="text-sm text-destructive">Os títulos ou saldos mudaram durante a edição. Feche e abra novamente para conferir os valores atuais.</p> : null}

      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">Dados dos movimentos já realizados</legend>
        <div className="max-h-64 space-y-3 overflow-y-auto pr-1" aria-label="Valores por título">
          {initialTargets.slice(0, 200).map((target, index) => {
            const valid = parsedAmounts[index] != null && parsedAmounts[index]! <= (balanceCents(target.openAmount) || 0);
            const inputId = `settlement-amount-${index}`;
            return <div key={`${target.kind}:${target.id}:${index}`} className="grid gap-2 rounded-sm border border-border p-3 sm:grid-cols-[1fr_11rem]">
              <div className="min-w-0">
                <p className="break-words font-medium">{target.description || 'Título sem descrição'}</p>
                <p className="text-sm text-muted-foreground">{target.kind === 'payable' ? 'Pagamento' : 'Recebimento'} · Saldo aberto: {balanceCents(target.openAmount) == null ? 'Inválido' : formatMoney(target.openAmount)}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={inputId}>Valor registrado (R$)<span className="sr-only"> — {target.description || `título ${index + 1}`}</span></Label>
                <Input id={inputId} inputMode="decimal" value={amounts[index]} maxLength={18}
                  aria-invalid={attempted && !valid} aria-describedby={`${inputId}-hint`}
                  onChange={event => setAmounts(previous => previous.map((value, position) => position === index ? event.target.value : value))} />
                <p id={`${inputId}-hint`} className={attempted && !valid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                  {attempted && !valid ? 'Informe centavos exatos, acima de zero e até o saldo aberto.' : 'Ex.: 1250,50, sem separador de milhar.'}
                </p>
              </div>
            </div>;
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="settlement-date">Data real do movimento</Label>
            <Input id="settlement-date" type="date" value={settledOn} max={localToday()}
              aria-invalid={attempted && !dateValid} aria-describedby="settlement-date-hint" onChange={event => setSettledOn(event.target.value)} />
            <p id="settlement-date-hint" className={attempted && !dateValid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {attempted && !dateValid ? 'Informe uma data válida, não futura.' : 'Use a data em que o dinheiro foi pago ou recebido.'}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="settlement-method">Forma do movimento</Label>
            <Select value={method} onValueChange={setMethod} disabled={busy}>
              <SelectTrigger id="settlement-method" aria-invalid={attempted && !methodValid} aria-describedby="settlement-method-hint"><SelectValue placeholder="Selecione a forma" /></SelectTrigger>
              <SelectContent>{METHODS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            <p id="settlement-method-hint" className={attempted && !methodValid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {attempted && !methodValid ? 'Selecione a forma utilizada.' : 'Informe como o movimento foi realizado.'}
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="settlement-bank-account">Conta bancária</Label>
            {bankAccounts.isPending ? <p role="status" className="text-sm text-muted-foreground">Carregando contas bancárias…</p> : null}
            {bankAccounts.isError ? <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Não foi possível consultar as contas bancárias. Nenhum registro será enviado enquanto a consulta estiver indisponível.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => { void bankAccounts.refetch(); }} disabled={busy || bankAccounts.isFetching}>Tentar contas novamente</Button>
            </div> : null}
            {!bankAccounts.isPending && !bankAccounts.isError ? <>
              <Select value={bankAccountId} onValueChange={setBankAccountId} disabled={busy}>
                <SelectTrigger id="settlement-bank-account" aria-invalid={!hasBankAccount} aria-describedby="settlement-bank-hint"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informada</SelectItem>
                  {activeAccounts.map(account => <SelectItem key={account.id} value={account.id}>{account.name}{account.bank_name ? ` · ${account.bank_name}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <p id="settlement-bank-hint" className={!hasBankAccount ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {!hasBankAccount ? 'A conta selecionada não está mais ativa. Escolha outra conta ou Não informada.'
                  : bankAccountId === 'none' ? 'Sem conta vinculada, este registro não atualiza o saldo de nenhuma conta bancária.'
                    : 'A conta será vinculada ao registro. Nenhuma transferência será executada.'}
              </p>
              {activeAccounts.length === 0 ? <p className="text-xs text-muted-foreground">Não há contas bancárias ativas cadastradas.</p> : null}
            </> : null}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="settlement-reference">Referência ou comprovante (opcional)</Label>
            <Input id="settlement-reference" value={reference} maxLength={500} onChange={event => setReference(event.target.value)} placeholder="Identificação do comprovante, sem dados sensíveis" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="settlement-notes">Observações (opcional)</Label>
            <Textarea id="settlement-notes" value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} rows={2} />
          </div>
        </div>
      </fieldset>

      {attempted && !totalValid ? <p role="alert" className="text-sm text-destructive">O total excede o limite seguro. Divida o registro em lotes menores.</p> : null}
      {saveError ? <p role="alert" className="text-sm text-destructive">{saveError} Os dados permanecem preenchidos para conferência.</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={blocked}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Registrando…' : 'Registrar movimento(s)'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function FinancialSettlementDialog({ targets, open, onOpenChange, onConfirm, pending }: Props) {
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const busy = pending || saving;
  const handleOpenChange = (next: boolean) => {
    if (pending || submitting.current) return;
    onOpenChange(next);
  };
  const handleConfirm = async (entries: RegisterSettlementEntry[]) => {
    // A ref fecha a janela entre cliques antes de React atualizar o botão.
    if (pending || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      await onConfirm(entries);
      onOpenChange(false);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogContent hideCloseButton={busy} onEscapeKeyDown={event => { if (pending || submitting.current) event.preventDefault(); }}
      onInteractOutside={event => { if (pending || submitting.current) event.preventDefault(); }}>
      {open ? <SettlementForm targets={targets} busy={busy} onCancel={() => handleOpenChange(false)} onConfirm={handleConfirm} /> : null}
    </DialogContent>
  </Dialog>;
}
