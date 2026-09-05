import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useFinancialSettlementHistory, type FinancialSettlementEvent, type FinancialSettlementHistory } from '@/hooks/useFinancialSettlements';
import { assertSettlementDate, settlementAmountCents, type ReverseSettlementEntry, type SettlementKind } from '@/lib/financialSettlement';
import { safeFormatBR, todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/utils';

interface Props {
  target: { id: string; kind: SettlementKind; description: string } | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  pending: boolean;
  onReverse: (entries: ReverseSettlementEntry[]) => Promise<void>;
}

const METHOD_LABELS: Record<string, string> = { pix: 'Pix', transferencia: 'Transferência', boleto: 'Boleto', dinheiro: 'Dinheiro', cheque: 'Cheque', cartao: 'Cartão', outro: 'Outro' };
const SOURCE_LABELS: Record<string, string> = { manual: 'Manual', ofx: 'Extrato OFX', factoring: 'Antecipação', contractor_cycle: 'Ciclo de terceirização', system: 'Sistema' };

function labelFor(labels: Record<string, string>, value: string): string {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : value;
}

function isCompleteHistory(data: FinancialSettlementHistory | undefined): boolean {
  if (!data?.head || !Array.isArray(data.events)) return false;
  try {
    if (data.head.opening_amount !== 0) settlementAmountCents(data.head.opening_amount);
    if (data.head.opening_payment_date != null) assertSettlementDate(data.head.opening_payment_date, '9999-12-31');
    if (data.head.opening_history_warning != null && typeof data.head.opening_history_warning !== 'string') return false;
    const byId = new Map<string, FinancialSettlementEvent>();
    for (const event of data.events) {
      if (!event || typeof event.id !== 'string' || !event.id || byId.has(event.id)
        || !['settlement', 'reversal'].includes(event.event_type)
        || typeof event.source_type !== 'string' || !event.source_type
        || typeof event.method !== 'string' || !event.method
        || (event.reference != null && typeof event.reference !== 'string')
        || (event.notes != null && typeof event.notes !== 'string')) return false;
      settlementAmountCents(event.amount);
      assertSettlementDate(event.effective_on, '9999-12-31');
      if (event.event_type === 'settlement' && event.reverses_event_id != null) return false;
      byId.set(event.id, event);
    }
    const reversed = new Set<string>();
    for (const event of data.events) {
      if (event.event_type !== 'reversal') continue;
      const original = byId.get(event.reverses_event_id!);
      if (!original || original.event_type !== 'settlement' || reversed.has(original.id)
        || event.amount !== original.amount || event.effective_on < original.effective_on) return false;
      reversed.add(original.id);
    }
    return true;
  } catch {
    return false;
  }
}

export default function FinancialSettlementHistoryDialog({ target, onOpenChange, canEdit, pending, onReverse }: Props) {
  const history = useFinancialSettlementHistory(target?.kind, target?.id);
  const [selected, setSelected] = useState<FinancialSettlementEvent | null>(null);
  const [reversedOn, setReversedOn] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [confirmedReversals, setConfirmedReversals] = useState<Set<string>>(() => new Set());
  const selectedTarget = useRef('');
  const currentTarget = useRef('');
  currentTarget.current = `${target?.kind}:${target?.id}`;
  const submitting = useRef(false);
  const [localPending, setLocalPending] = useState(false);
  const busy = pending || localPending;
  useEffect(() => {
    setSelected(null);
    setReversedOn('');
    setReason('');
    setError('');
    setRefreshError('');
    setConfirmedReversals(new Set());
    selectedTarget.current = '';
  }, [target?.id, target?.kind]);
  const complete = isCompleteHistory(history.data);
  const queryFailed = history.isError || !!refreshError;
  const readable = !history.isPending && !queryFailed && complete;
  const events = readable ? history.data!.events : [];
  const reversedIds = new Set([...confirmedReversals, ...events.filter(row => row.event_type === 'reversal').map(row => row.reverses_event_id)]);
  const currentSelected = selected ? events.find(event => event.id === selected.id) : null;
  const selectionValid = !!selected && selectedTarget.current === `${target?.kind}:${target?.id}`
    && currentSelected?.event_type === 'settlement' && currentSelected.source_type === 'manual'
    && currentSelected.amount === selected.amount && currentSelected.effective_on === selected.effective_on
    && !reversedIds.has(selected.id);

  const close = (open: boolean) => { if (!busy && !submitting.current) onOpenChange(open); };

  async function refresh() {
    const requestedTarget = currentTarget.current;
    setRefreshError('');
    try {
      const result = await history.refetch();
      if (currentTarget.current === requestedTarget && result?.isError) setRefreshError('Não foi possível atualizar o histórico. Tente novamente antes de estornar.');
    } catch {
      if (currentTarget.current === requestedTarget) setRefreshError('Não foi possível atualizar o histórico. Tente novamente antes de estornar.');
    }
  }

  async function confirmReversal() {
    if (submitting.current || busy || !canEdit || !selected || history.isFetching || !readable) return;
    setError('');
    try {
      if (!selectionValid) throw new Error('O movimento selecionado mudou ou já foi estornado. Atualize o histórico e confira novamente.');
      assertSettlementDate(reversedOn, todayISO());
      if (reversedOn < selected.effective_on) throw new Error('O estorno não pode anteceder o movimento original.');
      if (!reason.trim()) throw new Error('Informe o motivo do estorno.');
      if (reason.trim().length > 4000) throw new Error('O motivo deve ter no máximo 4.000 caracteres.');
      submitting.current = true;
      setLocalPending(true);
      await onReverse([{ event_id: selected.id, reversed_on: reversedOn, reason: reason.trim() }]);
      // O comando já confirmou. Mesmo antes do refetch, não oferecer outra
      // reversão do mesmo evento com uma nova identificação de operação.
      setConfirmedReversals(previous => new Set([...previous, selected.id]));
      setSelected(null);
      setReason('');
      setReversedOn('');
      // Consulta pausada/offline não pode prender a janela depois que o comando
      // confirmou. O marcador local impede novo estorno enquanto ela atualiza.
      void refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar o estorno.');
    } finally {
      submitting.current = false;
      setLocalPending(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl" hideCloseButton={busy} aria-busy={busy}
        onEscapeKeyDown={event => { if (busy || submitting.current) event.preventDefault(); }}
        onInteractOutside={event => { if (busy || submitting.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Histórico de {target?.kind === 'payable' ? 'pagamentos' : 'recebimentos'}</DialogTitle>
          <DialogDescription>{target?.description}. O estorno cria outro movimento; não apaga o original.</DialogDescription>
        </DialogHeader>
        {history.isPending && <p role="status">Carregando histórico…</p>}
        {(queryFailed || (!history.isPending && !complete)) && <div role="alert" className="space-y-2">
          <p className="text-destructive">{refreshError || (history.isError ? history.error?.message || 'Não foi possível consultar o histórico.' : 'O histórico não foi retornado por completo. Atualize antes de estornar.')}</p>
          <Button type="button" variant="outline" disabled={busy || history.isFetching} onClick={() => { void refresh(); }}>Tentar novamente</Button>
        </div>}
        {readable && <div className="space-y-4">
          {history.isFetching ? <p role="status" className="text-sm text-muted-foreground">Atualizando histórico… Aguarde para estornar.</p> : null}
          {history.data.head.opening_amount > 0 && <div className="rounded-md border border-warning p-3 space-y-1" aria-label="Saldo anterior preservado">
            <p className="font-medium">Saldo liquidado anterior: {formatMoney(history.data.head.opening_amount)}</p>
            <p className="text-sm text-muted-foreground">{history.data.head.opening_history_warning || 'Valor acumulado do sistema anterior, sem discriminação dos movimentos. Não é um pagamento novo e não pode ser estornado por esta tela.'}</p>
            <p className="text-sm">Data antiga informada: {history.data.head.opening_payment_date ? safeFormatBR(history.data.head.opening_payment_date) : 'Não informada'}</p>
          </div>}
          {history.data.events.length === 0 && <p className="text-sm text-muted-foreground">Nenhum movimento individual registrado neste histórico.</p>}
          <ol className="space-y-3" aria-label="Movimentos financeiros registrados">
            {events.map(event => <li key={event.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{event.event_type === 'reversal' ? 'Estorno' : 'Baixa'} · {formatMoney(event.amount)} · {safeFormatBR(event.effective_on)}</span>
                {reversedIds.has(event.id) && <Badge variant="secondary">Estornado</Badge>}
              </div>
              <p className="text-sm">Forma: {labelFor(METHOD_LABELS, event.method)} · Origem: {labelFor(SOURCE_LABELS, event.source_type)}</p>
              {event.event_type === 'reversal' ? <p className="text-xs text-muted-foreground break-all">Estorna o registro: {event.reverses_event_id}</p> : null}
              {event.reference && <p className="text-sm break-words">Referência: {event.reference}</p>}
              {event.notes && <p className="text-sm whitespace-pre-wrap break-words">{event.notes}</p>}
              <p className="text-xs text-muted-foreground break-all">Registro: {event.id}</p>
              {event.event_type === 'settlement' && !reversedIds.has(event.id) && event.source_type === 'manual' && canEdit && <Button type="button" size="sm" variant="outline" disabled={busy || history.isFetching} onClick={() => { selectedTarget.current = `${target?.kind}:${target?.id}`; setSelected(event); setReversedOn(''); setReason(''); setError(''); }}>Estornar este movimento</Button>}
              {event.event_type === 'settlement' && !reversedIds.has(event.id) && event.source_type !== 'manual' && <p className="text-xs text-muted-foreground">Alterações deste movimento devem ser feitas no fluxo de origem.</p>}
            </li>)}
          </ol>
          {selected && <div className="rounded-md border p-4 space-y-3" aria-label="Conferência do estorno">
            <p className="font-medium">Estornar {formatMoney(selected.amount)} de {safeFormatBR(selected.effective_on)}</p>
            <p className="text-sm text-muted-foreground">Isto corrige o registro financeiro; não devolve dinheiro pela conta bancária.</p>
            {!selectionValid ? <p role="alert" className="text-sm text-destructive">O movimento selecionado mudou ou já foi estornado. Cancele esta seleção e confira o histórico atualizado.</p> : null}
            <div className="space-y-1"><Label htmlFor="financial-reversal-date">Data real do estorno</Label><Input id="financial-reversal-date" type="date" min={selected.effective_on} max={todayISO()} value={reversedOn} disabled={busy} onChange={event => setReversedOn(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="financial-reversal-reason">Motivo obrigatório</Label><Textarea id="financial-reversal-reason" maxLength={4000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !canEdit || history.isFetching || !selectionValid} onClick={confirmReversal}>{busy ? 'Registrando estorno…' : 'Confirmar estorno'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(null)}>Cancelar estorno</Button></div>
          </div>}
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
          {readable ? <Button type="button" variant="outline" disabled={busy || history.isFetching} onClick={() => { void refresh(); }}>Atualizar histórico</Button> : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>Fechar histórico</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
