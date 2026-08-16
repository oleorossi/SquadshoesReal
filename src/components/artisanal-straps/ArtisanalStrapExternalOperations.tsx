import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  CurrencyCircleDollar,
  DownloadSimple,
  HandPalm,
  Package,
  Pause,
  PencilSimple,
  Play,
  Plus,
  ShoppingBag,
  XCircle,
  Warning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Panel } from '@/components/ui/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapExternalOperationsData,
  type StrapOperationEntityType,
  type StrapContractorLossClaimOperational,
  type StrapContractorPaymentCycleOperational,
  type StrapReworkMaterialRequestOperational,
  type StrapPurchaseOrderItemOperational,
  type PreparedStrapPurchaseOrderApproval,
  type StrapServiceOrderItemOperational,
  fetchFrozenStrapPurchaseOrderPdf,
  useAdjustArtisanalStrapPurchaseOrder,
  useAdjustArtisanalStrapContractorCustody,
  useApproveArtisanalStrapPurchaseOrder,
  useCancelArtisanalStrapOperation,
  useCreateArtisanalStrapContractorLossClaim,
  useCloseArtisanalStrapContractorPaymentCycle,
  useDecideArtisanalStrapContractorLossClaim,
  useMarkArtisanalStrapContractorPaymentCyclePaid,
  usePrepareArtisanalStrapPurchaseOrderApproval,
  useRegisterArtisanalStrapPurchaseReceipt,
  useRequestArtisanalStrapReworkMaterial,
  useDecideArtisanalStrapReworkMaterialRequest,
  useRegisterArtisanalStrapProductionReceipt,
  useResumeArtisanalStrapOperation,
  useReturnArtisanalStrapMaterialFromContractor,
  useSendArtisanalStrapMaterialToContractor,
  useSuspendArtisanalStrapOperation,
} from '@/hooks/useArtisanalStraps';
import { useSuppliers } from '@/hooks/useSuppliers';
import {
  downloadBinaryFile,
  downloadStrapPurchaseOrderFilesZip,
  hashStrapPurchaseOrderPdf,
  renderStrapPurchaseOrderPdf,
  type StrapPurchaseOrderPdfData,
} from '@/lib/strapPurchaseOrderZip';
import {
  printArtisanalStrapServiceOrder,
  type PrintableStrapServiceOrder,
} from '@/lib/printArtisanalStrapServiceOrder';
import {
  expectedStrapReceiptAllocationM,
  suggestStrapReceiptAllocations,
  validateStrapReceiptAllocations,
} from '@/lib/strapReceiptAllocations';
import { StrapStatusBadge } from './StrapStatusBadge';

function meters(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m`
    : '—';
}

function normalizedStatus(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function isTerminalStrapOperationStatus(value: unknown) {
  return ['cancelado', 'cancelada', 'cancelled', 'entregue', 'fulfilled', 'completed', 'concluido', 'finalizado']
    .includes(normalizedStatus(value));
}

function isSuspendedStrapOperationStatus(value: unknown) {
  return ['suspensa', 'suspenso', 'suspended'].includes(normalizedStatus(value));
}

function currency(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—';
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function fileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ordem-de-compra';
}

export interface ReceiptContributionTarget {
  contributionId: string;
  originType: 'sale_order' | 'stock_floor';
  label: string;
  remainingM: number;
  priority?: number | null;
}

export interface ReceiptTarget {
  kind: 'factory' | 'contractor';
  id: string;
  title: string;
  remainingM?: number;
  contributions: ReceiptContributionTarget[];
}

export function StrapReceiptDialog({ target, onClose }: { target: ReceiptTarget | null; onClose: () => void }) {
  const receipt = useRegisterArtisanalStrapProductionReceipt();
  const [delivered, setDelivered] = useState(0);
  const [approved, setApproved] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [baseConsumed, setBaseConsumed] = useState(0);
  const [baseReturned, setBaseReturned] = useState(0);
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [customAllocations, setCustomAllocations] = useState<Record<string, number>>({});
  const [allocationsEdited, setAllocationsEdited] = useState(false);
  const [allocationsConfirmed, setAllocationsConfirmed] = useState(false);

  const contributionInputs = useMemo(() => (target?.contributions || []).map((contribution) => ({
    contributionId: contribution.contributionId,
    originType: contribution.originType,
    remainingM: contribution.remainingM,
    priority: contribution.priority,
  })), [target?.contributions]);
  const suggestedAllocations = useMemo(
    () => suggestStrapReceiptAllocations(approved, contributionInputs),
    [approved, contributionInputs],
  );
  const suggestedByContribution = useMemo(() => new Map(
    suggestedAllocations.map((allocation) => [allocation.contribution_id, allocation.approved_m]),
  ), [suggestedAllocations]);
  const explicitAllocations = allocationsEdited
    ? contributionInputs.map((contribution) => ({
      contribution_id: contribution.contributionId,
      approved_m: Number(customAllocations[contribution.contributionId] || 0),
    })).filter((allocation) => allocation.approved_m > 0)
    : suggestedAllocations;
  const allocationError = validateStrapReceiptAllocations(approved, contributionInputs, explicitAllocations);
  const allocatedM = explicitAllocations.reduce((sum, allocation) => sum + allocation.approved_m, 0);
  const freeFinishedM = Math.max(0, approved - expectedStrapReceiptAllocationM(approved, contributionInputs));

  useEffect(() => {
    setCustomAllocations({});
    setAllocationsEdited(false);
    setAllocationsConfirmed(false);
  }, [target?.id]);

  const close = () => {
    setDelivered(0); setApproved(0); setRejected(0); setBaseConsumed(0); setBaseReturned(0);
    setDocumentNumber(''); setNotes(''); setIdempotencyKey(crypto.randomUUID());
    setCustomAllocations({}); setAllocationsEdited(false); setAllocationsConfirmed(false);
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar recebimento parcial</DialogTitle>
          <DialogDescription>{target?.title}. Aprovado + rejeitado deve fechar o total entregue.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Entregue *</Label><NumberInput value={delivered} onChange={setDelivered} unit="m" /></div>
          <div className="space-y-1"><Label>Aprovado *</Label><NumberInput value={approved} onChange={(value) => { setApproved(value); setAllocationsConfirmed(false); }} unit="m" /></div>
          <div className="space-y-1"><Label>Rejeitado *</Label><NumberInput value={rejected} onChange={setRejected} unit="m" /></div>
          <div className="space-y-1"><Label>Napa consumida *</Label><NumberInput value={baseConsumed} onChange={setBaseConsumed} unit="m" /></div>
          {target?.kind === 'contractor' && (
            <div className="space-y-1"><Label>Napa devolvida</Label><NumberInput value={baseReturned} onChange={setBaseReturned} unit="m" /></div>
          )}
          <div className="space-y-1"><Label>Documento</Label><Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        </div>
        <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="strap-receipt-allocation-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="strap-receipt-allocation-title" className="text-sm font-semibold">Alocação da tira aprovada</h3>
              <p className="text-xs text-muted-foreground">Sugestão: PVs por prioridade e, por último, reposição do estoque mínimo.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={allocationsEdited ? 'outline' : 'secondary'}>{allocationsEdited ? 'Revisada pelo operador' : 'Sugestão normativa'}</Badge>
              {allocationsEdited && <Button type="button" size="sm" variant="ghost" onClick={() => { setAllocationsEdited(false); setCustomAllocations({}); setAllocationsConfirmed(false); }}>Restaurar sugestão</Button>}
            </div>
          </div>
          {(target?.contributions || []).length === 0 ? (
            <p className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">Sem contribuição aberta nesta linha. Toda tira aprovada entrará como estoque livre.</p>
          ) : (
            <div className="space-y-2">
              {(target?.contributions || []).map((contribution) => {
                const currentValue = allocationsEdited
                  ? Number(customAllocations[contribution.contributionId] || 0)
                  : Number(suggestedByContribution.get(contribution.contributionId) || 0);
                return (
                  <div key={contribution.contributionId} className="grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[minmax(0,1fr)_130px] sm:items-center">
                    <div>
                      <p className="text-xs font-semibold">{contribution.originType === 'stock_floor' ? 'Reposição de estoque mínimo' : contribution.label || 'Pedido de venda'}</p>
                      <p className="text-[10px] text-muted-foreground">Saldo aberto: {meters(contribution.remainingM)}</p>
                    </div>
                    <NumberInput
                      value={currentValue}
                      onChange={(value) => {
                        setCustomAllocations((current) => {
                          const base = allocationsEdited
                            ? current
                            : Object.fromEntries((target?.contributions || []).map((item) => [
                              item.contributionId,
                              Number(suggestedByContribution.get(item.contributionId) || 0),
                            ]));
                          return { ...base, [contribution.contributionId]: value };
                        });
                        setAllocationsEdited(true);
                        setAllocationsConfirmed(false);
                      }}
                      unit="m"
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>Alocado: <strong>{meters(allocatedM)}</strong></span>
            <span>Estoque livre: <strong>{meters(freeFinishedM)}</strong></span>
          </div>
          {allocationError && <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Revise a alocação</AlertTitle><AlertDescription>{allocationError}</AlertDescription></Alert>}
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={allocationsConfirmed} onCheckedChange={(value) => setAllocationsConfirmed(value === true)} />
            <span>Revisei a sugestão e confirmo a distribuição acima antes de registrar o fato físico.</span>
          </label>
        </section>
        {delivered > 0 && Math.abs(delivered - approved - rejected) > 0.0001 && (
          <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Fechamento inválido</AlertTitle><AlertDescription>Aprovado + rejeitado deve totalizar {meters(delivered)}.</AlertDescription></Alert>
        )}
        {target?.remainingM != null && approved > target.remainingM + 0.0001 && (
          <Alert><Package className="h-4 w-4" /><AlertTitle>Produção acima do saldo planejado</AlertTitle><AlertDescription>{meters(approved - target.remainingM)} não será atribuído a PV nem ao piso e entrará como estoque livre, com origem preservada.</AlertDescription></Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!target || delivered <= 0 || approved < 0 || rejected < 0 || Math.abs(delivered - approved - rejected) > 0.0001 || Boolean(allocationError) || !allocationsConfirmed || receipt.isPending}
            onClick={async () => {
              if (!target) return;
              await receipt.mutateAsync({
                batchItemId: target.kind === 'factory' ? target.id : null,
                serviceOrderItemId: target.kind === 'contractor' ? target.id : null,
                deliveredM: delivered,
                approvedM: approved,
                rejectedM: rejected,
                baseConsumedM: baseConsumed,
                baseReturnedM: baseReturned,
                documentNumber,
                notes,
                idempotencyKey,
                allocations: explicitAllocations,
              });
              close();
            }}
          >Registrar parcial</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SuspendTarget {
  entityType: StrapOperationEntityType;
  entityId: string;
  title: string;
}

export function StrapSuspendDialog({ target, onClose }: { target: SuspendTarget | null; onClose: () => void }) {
  const suspend = useSuspendArtisanalStrapOperation();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) { setReason(''); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Suspender operação inteira</DialogTitle><DialogDescription>{target?.title}. O motivo fica na trilha administrativa.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button
            variant="destructive"
            disabled={!target || !reason.trim() || suspend.isPending}
            onClick={async () => {
              if (!target) return;
              await suspend.mutateAsync({ ...target, reason: reason.trim() });
              setReason(''); onClose();
            }}
          >Suspender</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StrapCancelBatchDialog({
  target,
  onClose,
}: {
  target: { entityType: 'batch'; entityId: string; title: string } | null;
  onClose: () => void;
}) {
  const cancel = useCancelArtisanalStrapOperation();
  const [reason, setReason] = useState('');
  const close = () => { setReason(''); onClose(); };
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Cancelar lote</DialogTitle><DialogDescription>{target?.title}. Só é permitido antes de existir fato físico; as contribuições voltam ao netting.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={close}>Voltar</Button><Button variant="destructive" disabled={!target || !reason.trim() || cancel.isPending} onClick={async () => { if (!target) return; await cancel.mutateAsync({ ...target, reason: reason.trim() }); close(); }}>Cancelar lote</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ContractorAction = 'send' | 'return' | 'adjust' | 'loss' | 'rework';

function ContractorActionDialog({
  target,
  action,
  custodyBalance,
  onClose,
}: {
  target: StrapServiceOrderItemOperational | null;
  action: ContractorAction | null;
  custodyBalance: number;
  onClose: () => void;
}) {
  const send = useSendArtisanalStrapMaterialToContractor();
  const receive = useReturnArtisanalStrapMaterialFromContractor();
  const adjust = useAdjustArtisanalStrapContractorCustody();
  const loss = useCreateArtisanalStrapContractorLossClaim();
  const requestRework = useRequestArtisanalStrapReworkMaterial();
  const [quantity, setQuantity] = useState(0);
  const [documentNumber, setDocumentNumber] = useState('');
  const [reason, setReason] = useState('');
  const [responsible, setResponsible] = useState<'contractor' | 'company' | 'shared' | 'under_review'>('under_review');
  const [evidence, setEvidence] = useState('');
  const [productionReceiptId, setProductionReceiptId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const lossReceiptCandidates = useMemo(
    () => (target?.loss_receipt_candidates || [])
      .filter((candidate) => Number(candidate.available_unclaimed_base_m) > 0),
    [target?.loss_receipt_candidates],
  );
  const selectedLossReceipt = lossReceiptCandidates.find((candidate) =>
    candidate.production_receipt_id === productionReceiptId);
  useEffect(() => {
    if (action !== 'loss') return;
    setProductionReceiptId((current) => {
      if (lossReceiptCandidates.some((candidate) => candidate.production_receipt_id === current)) return current;
      return lossReceiptCandidates.length === 1 ? lossReceiptCandidates[0].production_receipt_id : '';
    });
  }, [action, target?.service_order_item_id, lossReceiptCandidates]);
  const close = () => {
    setQuantity(0); setDocumentNumber(''); setReason(''); setEvidence(''); setResponsible('under_review'); setProductionReceiptId('');
    setIdempotencyKey(crypto.randomUUID()); onClose();
  };
  const title = action === 'send' ? 'Remeter napa ao terceirizado'
    : action === 'return' ? 'Receber devolução de napa'
      : action === 'adjust' ? 'Ajustar custódia'
        : action === 'loss' ? 'Registrar perda'
          : 'Solicitar napa adicional para retrabalho';
  const pending = send.isPending || receive.isPending || adjust.isPending || loss.isPending || requestRework.isPending;
  return (
    <Dialog open={!!target && !!action} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{target?.service_order_number} · {target?.contractor_name}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Saldo atual em poder do terceirizado: <strong className="text-foreground">{meters(custodyBalance)}</strong></p>
          <div className="space-y-1"><Label>{action === 'adjust' ? 'Ajuste (+ entrada / − saída) *' : 'Quantidade *'}</Label><NumberInput value={quantity} onChange={setQuantity} unit="m" /></div>
          {(action === 'send' || action === 'return') && <div className="space-y-1"><Label>Documento</Label><Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></div>}
          {(action === 'adjust' || action === 'loss' || action === 'rework') && <div className="space-y-1"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>}
          {action === 'loss' && (
            <>
              <div className="space-y-1">
                <Label>Recebimento com rejeição *</Label>
                <Select value={productionReceiptId} onValueChange={setProductionReceiptId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o recebimento exato" /></SelectTrigger>
                  <SelectContent>{lossReceiptCandidates.map((candidate) => (
                    <SelectItem key={candidate.production_receipt_id} value={candidate.production_receipt_id}>
                      {candidate.document_number || candidate.production_receipt_id.slice(0, 8)} · {dateLabel(candidate.occurred_at)} · disponível {meters(candidate.available_unclaimed_base_m)}
                    </SelectItem>
                  ))}</SelectContent>
                </Select>
                {lossReceiptCandidates.length === 0 && <p className="text-xs text-destructive">Não há recebimento rejeitado com napa ainda disponível para vincular.</p>}
              </div>
              <div className="space-y-1"><Label>Responsabilidade proposta *</Label><Select value={responsible} onValueChange={(value) => setResponsible(value as typeof responsible)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="under_review">Em análise</SelectItem><SelectItem value="contractor">Terceirizado</SelectItem><SelectItem value="company">Fábrica</SelectItem><SelectItem value="shared">Compartilhada</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Evidência / documento</Label><Input value={evidence} onChange={(event) => setEvidence(event.target.value)} /></div>
            </>
          )}
        </div>
        {((action === 'return' || action === 'loss') && quantity > custodyBalance + 0.0001
          || action === 'loss' && selectedLossReceipt && quantity > Number(selectedLossReceipt.available_unclaimed_base_m) + 0.0001
          || action === 'adjust' && custodyBalance + quantity < -0.0001) && (
          <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Custódia insuficiente</AlertTitle><AlertDescription>Esta operação deixaria o saldo em poder do terceirizado negativo e será bloqueada.</AlertDescription></Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!target || (action === 'adjust' ? quantity === 0 : quantity <= 0) || ((action === 'adjust' || action === 'loss' || action === 'rework') && !reason.trim()) || (action === 'loss' && (!productionReceiptId || !selectedLossReceipt || quantity > Number(selectedLossReceipt.available_unclaimed_base_m) + 0.0001)) || ((action === 'return' || action === 'loss') && quantity > custodyBalance + 0.0001) || (action === 'adjust' && custodyBalance + quantity < -0.0001) || pending}
            onClick={async () => {
              if (!target || !action) return;
              const base = { serviceOrderItemId: target.service_order_item_id, idempotencyKey };
              if (action === 'send') await send.mutateAsync({ ...base, quantityM: quantity, documentNumber });
              if (action === 'return') await receive.mutateAsync({ ...base, quantityM: quantity, documentNumber });
              if (action === 'adjust') await adjust.mutateAsync({ ...base, quantityDeltaM: quantity, reason: reason.trim() });
              if (action === 'loss') await loss.mutateAsync({ ...base, lostQuantityM: quantity, responsibleParty: responsible, reason: reason.trim(), evidence: { document: evidence || null }, productionReceiptId });
              if (action === 'rework') await requestRework.mutateAsync({ ...base, requestedM: quantity, reason: reason.trim() });
              close();
            }}
          >Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface InstallmentDraft {
  dueDate: string;
  amount: number;
}

function dateAfterDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  date.setDate(date.getDate() + Math.max(0, Math.trunc(days)));
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function installmentsFromSnapshot(
  terms: StrapPurchaseOrderItemOperational['payment_terms_snapshot'],
  issueDate: string,
  total: number,
): InstallmentDraft[] {
  const valid = (terms || []).filter((term) =>
    Number.isFinite(Number(term.days)) && Number(term.days) >= 0
    && Number.isFinite(Number(term.percentage)) && Number(term.percentage) > 0);
  if (valid.length === 0 || !(total > 0)) return [];
  let allocated = 0;
  return valid.map((term, index) => {
    const amount = index === valid.length - 1
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(total * Number(term.percentage) / 100 * 100) / 100;
    allocated += amount;
    return { dueDate: dateAfterDays(issueDate, Number(term.days)), amount };
  });
}

function StrapPurchaseReceiptDialog({
  target,
  onClose,
}: {
  target: StrapPurchaseOrderItemOperational | null;
  onClose: () => void;
}) {
  const receipt = useRegisterArtisanalStrapPurchaseReceipt();
  const [delivered, setDelivered] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [actualUnitPrice, setActualUnitPrice] = useState(0);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceKey, setInvoiceKey] = useState('');
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(todayInputValue());
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionDisposition, setRejectionDisposition] = useState<'return' | 'replace' | 'scrap' | 'credit_note' | 'pending'>('pending');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([]);
  const [installmentsAdjusted, setInstallmentsAdjusted] = useState(false);
  const [installmentAdjustmentReason, setInstallmentAdjustmentReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!target) return;
    const remaining = Math.max(0, Number(target.ordered_purchase_quantity) - Number(target.received_purchase_quantity));
    const price = Number(target.unit_price) || 0;
    const issueDate = todayInputValue();
    setDelivered(remaining);
    setAccepted(remaining);
    setRejected(0);
    setActualUnitPrice(price);
    setInvoiceIssueDate(issueDate);
    setInstallments(installmentsFromSnapshot(target.payment_terms_snapshot, issueDate, remaining * price));
    setInstallmentsAdjusted(false);
    setInstallmentAdjustmentReason('');
    setIdempotencyKey(crypto.randomUUID());
  }, [target]);

  useEffect(() => {
    if (accepted > 0) return;
    setInstallments([]);
    setInstallmentsAdjusted(false);
    setInstallmentAdjustmentReason('');
  }, [accepted]);

  const reset = () => {
    setDelivered(0); setAccepted(0); setRejected(0); setActualUnitPrice(0);
    setInvoiceNumber(''); setInvoiceKey(''); setInvoiceIssueDate(todayInputValue());
    setRejectionReason(''); setRejectionDisposition('pending'); setInstallments([]);
    setInstallmentsAdjusted(false); setInstallmentAdjustmentReason('');
    setIdempotencyKey(crypto.randomUUID()); onClose();
  };
  const invoiceTotal = accepted * actualUnitPrice;
  const installmentsTotal = installments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const quantitiesClose = Math.abs(delivered - accepted - rejected) <= 0.0001;
  const installmentsClose = invoiceTotal <= 0.01
    ? installments.length === 0
    : installments.length > 0 && Math.abs(invoiceTotal - installmentsTotal) <= 0.01;
  const rejectionComplete = rejected <= 0 || Boolean(rejectionReason.trim() && rejectionDisposition);

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) reset(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dar entrada parcial na ordem de compra</DialogTitle>
          <DialogDescription>
            {target?.order_number || 'OC'} · {target?.product_name}. A entrada aceita atualiza estoque e cria as parcelas financeiras confirmadas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label>Entregue *</Label><NumberInput value={delivered} onChange={setDelivered} unit={target?.unit || 'un'} /></div>
          <div className="space-y-1"><Label>Aceito *</Label><NumberInput value={accepted} onChange={setAccepted} unit={target?.unit || 'un'} /></div>
          <div className="space-y-1"><Label>Rejeitado *</Label><NumberInput value={rejected} onChange={setRejected} unit={target?.unit || 'un'} /></div>
          <div className="space-y-1"><Label>Preço real na unidade de compra *</Label><NumberInput value={actualUnitPrice} onChange={setActualUnitPrice} unit="R$" /></div>
          <div className="space-y-1"><Label>Número da NF *</Label><Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></div>
          <div className="space-y-1"><Label>Data de emissão *</Label><Input type="date" value={invoiceIssueDate} onChange={(event) => setInvoiceIssueDate(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-3"><Label>Chave da NF</Label><Input value={invoiceKey} onChange={(event) => setInvoiceKey(event.target.value)} /></div>
        </div>
        {!quantitiesClose && <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Quantidades não fecham</AlertTitle><AlertDescription>Entregue deve ser igual a aceito + rejeitado.</AlertDescription></Alert>}
        {rejected > 0 && (
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Destino da rejeição *</Label><Select value={rejectionDisposition} onValueChange={(value) => setRejectionDisposition(value as typeof rejectionDisposition)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendente</SelectItem><SelectItem value="return">Devolver</SelectItem><SelectItem value="replace">Substituir</SelectItem><SelectItem value="scrap">Descartar</SelectItem><SelectItem value="credit_note">Nota de crédito</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label>Motivo da rejeição *</Label><Textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /></div>
          </div>
        )}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-semibold">Parcelas desta entrada</p><p className="text-xs text-muted-foreground">Condição da OC: {target?.payment_condition_snapshot || 'não informada'}{installmentsAdjusted ? ' · ajustada manualmente' : ' · aplicada do snapshot'}</p></div>
            <Button variant="outline" size="sm" disabled={invoiceTotal <= 0} onClick={() => { setInstallments((current) => [...current, { dueDate: invoiceIssueDate, amount: 0 }]); setInstallmentsAdjusted(true); }}>Adicionar parcela</Button>
          </div>
          {invoiceTotal <= 0 && (
            <Alert><Package className="h-4 w-4" /><AlertTitle>Entrada integralmente rejeitada</AlertTitle><AlertDescription>Nenhuma parcela ou conta a pagar será criada; a quantidade rejeitada continua registrada para devolução, substituição ou crédito.</AlertDescription></Alert>
          )}
          {(!target?.payment_terms_snapshot || target.payment_terms_snapshot.length === 0) && <Alert><Warning className="h-4 w-4" /><AlertTitle>Condição sem estrutura de vencimentos</AlertTitle><AlertDescription>Informe as parcelas manualmente antes de confirmar a entrada.</AlertDescription></Alert>}
          {installments.map((entry, index) => (
            <div key={`${index}-${entry.dueDate}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input aria-label={`Vencimento da parcela ${index + 1}`} type="date" value={entry.dueDate} onChange={(event) => { setInstallments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value } : item)); setInstallmentsAdjusted(true); }} />
              <NumberInput value={entry.amount} onChange={(value) => { setInstallments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: value } : item)); setInstallmentsAdjusted(true); }} unit="R$" />
              <Button variant="ghost" size="sm" aria-label={`Remover parcela ${index + 1}`} onClick={() => { setInstallments((current) => current.filter((_, itemIndex) => itemIndex !== index)); setInstallmentsAdjusted(true); }}><XCircle className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>Total aceito: <strong>{currency(invoiceTotal)}</strong></span>
            <span className={installmentsClose ? 'text-muted-foreground' : 'text-destructive'}>Parcelas: <strong>{currency(installmentsTotal)}</strong></span>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" disabled={!target?.payment_terms_snapshot?.length || invoiceTotal <= 0} onClick={() => { setInstallments(installmentsFromSnapshot(target?.payment_terms_snapshot || null, invoiceIssueDate, invoiceTotal)); setInstallmentsAdjusted(false); }}>Reaplicar condição da OC</Button>
              <Button variant="ghost" size="sm" disabled={invoiceTotal <= 0} onClick={() => { setInstallments([{ dueDate: invoiceIssueDate, amount: invoiceTotal }]); setInstallmentsAdjusted(true); }}>Uma parcela pelo total</Button>
            </div>
          </div>
        </div>
        {installmentsAdjusted && (
          <div className="space-y-1">
            <Label>Motivo do ajuste das parcelas *</Label>
            <Textarea
              value={installmentAdjustmentReason}
              onChange={(event) => setInstallmentAdjustmentReason(event.target.value)}
              placeholder="Explique por que os vencimentos ou valores diferem da condição do fornecedor."
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={reset}>Cancelar</Button>
          <Button
            disabled={!target || delivered <= 0 || accepted < 0 || rejected < 0 || actualUnitPrice <= 0 || !invoiceNumber.trim() || !invoiceIssueDate || !quantitiesClose || !installmentsClose || !rejectionComplete || (installmentsAdjusted && !installmentAdjustmentReason.trim()) || receipt.isPending}
            onClick={async () => {
              if (!target) return;
              await receipt.mutateAsync({
                purchaseOrderItemId: target.purchase_order_item_id,
                deliveredQuantity: delivered,
                acceptedQuantity: accepted,
                rejectedQuantity: rejected,
                actualUnitPricePurchase: actualUnitPrice,
                invoiceNumber: invoiceNumber.trim(),
                invoiceIssueDate,
                invoiceKey: invoiceKey.trim(),
                installments: installments.map((entry) => ({ due_date: entry.dueDate, amount: entry.amount })),
                rejectionReason: rejected > 0 ? rejectionReason.trim() : undefined,
                rejectionDisposition: rejected > 0 ? rejectionDisposition : undefined,
                idempotencyKey,
                installmentAdjustmentReason: installmentsAdjusted ? installmentAdjustmentReason.trim() : undefined,
              });
              reset();
            }}
          ><ShoppingBag className="mr-1 h-4 w-4" /> Confirmar entrada</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Exportado para a superfície filtrável de OCs; não contém estado de React.
// eslint-disable-next-line react-refresh/only-export-components
export function purchaseOrderCanonicalStatus(row: StrapPurchaseOrderItemOperational) {
  if (row.provisional) return 'OC Provisória — Sem fornecedor';
  const raw = `${row.purchase_order_status || ''} ${row.approval_status || ''}`.toLowerCase();
  if (raw.includes('suspend')) return 'Suspensa';
  if (raw.includes('aprov')) return 'Aprovada';
  return 'Aguardando aprovação';
}

function orderPdfData(
  rows: StrapPurchaseOrderItemOperational[],
  approval?: { approverName: string; approvedAt: string },
): StrapPurchaseOrderPdfData {
  const sortedRows = [...rows].sort((a, b) => a.purchase_order_item_id.localeCompare(b.purchase_order_item_id));
  const first = sortedRows[0];
  return {
    id: first.purchase_order_id,
    orderNumber: first.order_number || `OC-${first.purchase_order_id.slice(0, 8)}`,
    supplierName: first.supplier_name || 'Sem fornecedor',
    supplierContactName: first.supplier_contact_name,
    supplierPhone: first.supplier_phone,
    supplierEmail: first.supplier_email,
    supplierAddress: [first.supplier_address, first.supplier_city, first.supplier_state, first.supplier_zip_code]
      .filter(Boolean).join(' · ') || null,
    deliveryAddress: [
      first.delivery_company_name,
      [first.delivery_address, first.delivery_address_number].filter(Boolean).join(', '),
      first.delivery_address_complement,
      first.delivery_neighborhood,
      first.delivery_city,
      first.delivery_state,
      first.delivery_zip_code,
    ].filter(Boolean).join(' · ') || null,
    status: approval ? 'Aprovada' : purchaseOrderCanonicalStatus(first),
    criticality: first.criticality,
    createdAt: first.purchase_order_created_at || first.purchase_by_date || '2000-01-01',
    purchaseByDate: first.purchase_by_date,
    promisedDate: first.promised_date,
    paymentCondition: first.payment_condition_snapshot,
    billingYear: first.billing_year,
    billingMonth: first.billing_month,
    billingFortnight: first.billing_fortnight,
    provisional: first.provisional,
    notes: first.purchase_order_notes,
    approvedByName: approval?.approverName || first.approved_by_name_snapshot,
    approvedAt: approval?.approvedAt || first.approved_at,
    items: sortedRows.map((row) => ({
      productName: row.product_name,
      sku: row.product_sku,
      quantity: Number(row.ordered_purchase_quantity) || 0,
      unit: row.purchase_unit_snapshot || row.unit || 'm',
      unitPrice: row.unit_price == null ? null : Number(row.unit_price),
      neededAt: row.needed_at,
      contributions: (row.contributions || []).map((entry) => ({
        label: entry.label,
        originType: entry.origin_type,
        quantityStockUnit: Number(entry.required_stock_quantity) || 0,
        stockUnit: row.stock_unit_snapshot || 'm',
      })),
    })),
  };
}

function purchaseOrderApprovalBlocker(rows: StrapPurchaseOrderItemOperational[]): string | null {
  const first = rows[0];
  if (!first) return 'OC sem itens.';
  if (first.has_frozen_pdf) return 'OC já aprovada e congelada.';
  if (first.provisional) return 'Cadastre o fornecedor antes de aprovar a OC provisória.';
  if (isPurchaseOrderSuspended(first)) return 'Retome a OC antes de aprovar.';
  if (rows.some((row) => row.unit_price == null)) return 'Aprovação exige os valores comerciais completos.';
  if (first.commercial_revision == null || !first.commercial_digest) {
    return 'Revisão comercial ainda não foi publicada; atualize a fila.';
  }
  return null;
}

async function uploadPreparedPurchaseOrderPdf(
  rows: StrapPurchaseOrderItemOperational[],
  prepared: PreparedStrapPurchaseOrderApproval,
) {
  const first = rows[0];
  const approvedData = orderPdfData(rows, {
    approverName: prepared.approver_name,
    approvedAt: prepared.approved_at,
  });
  const bytes = await renderStrapPurchaseOrderPdf(approvedData);
  const sha256 = await hashStrapPurchaseOrderPdf(bytes);
  const storagePath = `${first.purchase_order_id}/${sha256}.pdf`;
  const { error } = await supabase.storage
    .from('strap-purchase-orders')
    .upload(storagePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false,
      metadata: { sha256 },
    });
  if (error) {
    // Retry idempotente: nunca sobrescreve o snapshot. O objeto existente só
    // é reutilizado quando os bytes locais produzem o mesmo SHA-256 do path.
    const { data: existing, error: downloadError } = await supabase.storage
      .from('strap-purchase-orders')
      .download(storagePath);
    if (downloadError || !existing) throw error;
    const existingHash = await hashStrapPurchaseOrderPdf(new Uint8Array(await existing.arrayBuffer()));
    if (existingHash !== sha256) {
      throw new Error('Já existe um PDF diferente no path canônico; aprovação interrompida.');
    }
  }
  return { storagePath, sha256 };
}

function serviceOrderPdfData(
  rows: StrapServiceOrderItemOperational[],
  catalog: ArtisanalStrapCatalog,
): PrintableStrapServiceOrder {
  const sortedRows = [...rows].sort((a, b) => a.service_order_item_id.localeCompare(b.service_order_item_id));
  const first = sortedRows[0];
  return {
    id: first.service_order_id,
    number: first.service_order_number,
    contractor: first.contractor_name,
    status: first.service_order_status,
    sentAt: sortedRows.map((row) => row.sent_at).filter(Boolean).sort()[0] || null,
    deadline: sortedRows.map((row) => row.needed_at).filter(Boolean).sort()[0] || null,
    lines: sortedRows.map((row) => {
      const variant = catalog.variants.find((entry) => entry.id === row.strap_variant_id);
      const measure = catalog.measures.find((entry) => entry.id === variant?.measure_id);
      const type = catalog.types.find((entry) => entry.id === measure?.strap_type_id);
      const color = catalog.colors.find((entry) => entry.id === variant?.color_id);
      const yieldSnapshot = Number(row.confirmed_yield_snapshot) || 0;
      return {
        identity: [type?.name, measure?.display_name, color?.name, row.finished_product_name]
          .filter(Boolean)
          .join(' · ') || row.strap_variant_id,
        baseProduct: row.base_product_name || row.base_product_id,
        plannedFinishedM: Number(row.planned_m) || 0,
        plannedBaseM: Number(row.planned_base_m) || (yieldSnapshot > 0 ? Number(row.planned_m) / yieldSnapshot : 0),
        confirmedYield: yieldSnapshot,
        contributions: (row.contributions || []).map((entry) => ({
          label: entry.label,
          originType: entry.origin_type,
          plannedM: Number(entry.planned_m) || 0,
        })),
      };
    }),
  };
}

function isPurchaseOrderSuspended(row: StrapPurchaseOrderItemOperational) {
  return `${row.purchase_order_status || ''} ${row.approval_status || ''}`.toLowerCase().includes('suspend');
}

interface PurchaseItemAdjustmentDraft {
  quantity: number;
  unitPrice: number;
  neededAt: string;
}

function PurchaseOrderAdjustmentDialog({
  rows,
  canSeeFinancial,
  onClose,
}: {
  rows: StrapPurchaseOrderItemOperational[] | null;
  canSeeFinancial: boolean;
  onClose: () => void;
}) {
  const adjust = useAdjustArtisanalStrapPurchaseOrder();
  const { data: suppliers = [] } = useSuppliers(Boolean(rows));
  const first = rows?.[0] || null;
  const [supplierId, setSupplierId] = useState('__none__');
  const [purchaseByDate, setPurchaseByDate] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [drafts, setDrafts] = useState<Record<string, PurchaseItemAdjustmentDraft>>({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!rows?.length) return;
    setSupplierId(first?.supplier_id || '__none__');
    setPurchaseByDate(first?.purchase_by_date?.slice(0, 10) || '');
    setPromisedDate(first?.promised_date?.slice(0, 10) || '');
    setDrafts(Object.fromEntries(rows.map((row) => [row.purchase_order_item_id, {
      quantity: Number(row.ordered_purchase_quantity) || 0,
      unitPrice: Number(row.unit_price) || 0,
      neededAt: row.needed_at?.slice(0, 10) || '',
    }])));
    setReason('');
  }, [rows, first?.supplier_id, first?.purchase_by_date, first?.promised_date]);

  const changes = useMemo(() => {
    if (!rows?.length || !first) return null;
    const payload: {
      supplier_id?: string | null;
      purchase_by_date?: string | null;
      promised_date?: string | null;
      items?: Array<{ purchase_order_item_id: string; quantity?: number; unit_price?: number; needed_at?: string | null }>;
    } = {};
    const selectedSupplier = supplierId === '__none__' ? null : supplierId;
    if (selectedSupplier !== first.supplier_id) payload.supplier_id = selectedSupplier;
    if (purchaseByDate !== (first.purchase_by_date?.slice(0, 10) || '')) payload.purchase_by_date = purchaseByDate || null;
    if (promisedDate !== (first.promised_date?.slice(0, 10) || '')) payload.promised_date = promisedDate || null;
    const itemChanges = rows.flatMap((row) => {
      const draft = drafts[row.purchase_order_item_id];
      if (!draft) return [];
      const item: { purchase_order_item_id: string; quantity?: number; unit_price?: number; needed_at?: string | null } = {
        purchase_order_item_id: row.purchase_order_item_id,
      };
      if (Math.abs(draft.quantity - Number(row.ordered_purchase_quantity)) > 0.000001) item.quantity = draft.quantity;
      if (canSeeFinancial && Math.abs(draft.unitPrice - Number(row.unit_price || 0)) > 0.000001) item.unit_price = draft.unitPrice;
      if (draft.neededAt !== (row.needed_at?.slice(0, 10) || '')) item.needed_at = draft.neededAt || null;
      return Object.keys(item).length > 1 ? [item] : [];
    });
    if (itemChanges.length > 0) payload.items = itemChanges;
    return payload;
  }, [canSeeFinancial, drafts, first, promisedDate, purchaseByDate, rows, supplierId]);
  const hasChanges = Boolean(changes && Object.keys(changes).length > 0);
  const valuesValid = (rows || []).every((row) => {
    const draft = drafts[row.purchase_order_item_id];
    return !!draft && draft.quantity > 0 && !!draft.neededAt && (!canSeeFinancial || draft.unitPrice > 0);
  });
  const close = () => { if (!adjust.isPending) onClose(); };

  return (
    <Dialog open={Boolean(rows?.length)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ajustar OC antes da aprovação</DialogTitle>
          <DialogDescription>{first?.order_number || first?.purchase_order_id}. O sistema preserva o calculado, eleva a quantidade final para falta, MOQ e múltiplo, e registra motivo, autor e data.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-3">
            <Label>Fornecedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem fornecedor · OC Provisória</SelectItem>
                {suppliers.filter((supplier) => supplier.active || supplier.id === first?.supplier_id).map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Comprar até</Label><Input type="date" value={purchaseByDate} onChange={(event) => setPurchaseByDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>Chegada prometida</Label><Input type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} /></div>
        </div>
        <div className="space-y-2">
          {(rows || []).map((row) => {
            const draft = drafts[row.purchase_order_item_id];
            if (!draft) return null;
            const purchaseUnit = row.purchase_unit_snapshot || row.unit || 'un';
            return (
              <article key={row.purchase_order_item_id} className="rounded-md border border-border p-3">
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  <div><p className="text-sm font-semibold">{row.product_name}</p><p className="text-xs text-muted-foreground">Calculado pelo motor: {Number(row.calculated_purchase_quantity || 0).toLocaleString('pt-BR')} {purchaseUnit}</p></div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5 text-xs"><strong>Final atual:</strong> {Number(row.ordered_purchase_quantity).toLocaleString('pt-BR')} {purchaseUnit}<br /><span className="text-muted-foreground">Falta líquida: {Number(row.required_stock_quantity || 0).toLocaleString('pt-BR')} {row.stock_unit_snapshot || 'm'}</span></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label>Quantidade solicitada</Label><NumberInput value={draft.quantity} onChange={(value) => setDrafts((current) => ({ ...current, [row.purchase_order_item_id]: { ...draft, quantity: value } }))} unit={purchaseUnit} /><p className="text-[10px] text-muted-foreground">MOQ {Number(row.min_order_quantity_snapshot || 0).toLocaleString('pt-BR')} · múltiplo {Number(row.purchase_multiple_snapshot || 0).toLocaleString('pt-BR')}</p></div>
                  {canSeeFinancial && <div className="space-y-1"><Label>Preço unitário</Label><NumberInput value={draft.unitPrice} onChange={(value) => setDrafts((current) => ({ ...current, [row.purchase_order_item_id]: { ...draft, unitPrice: value } }))} unit={`R$/${purchaseUnit}`} /></div>}
                  <div className="space-y-1"><Label>Necessário em</Label><Input type="date" value={draft.neededAt} onChange={(event) => setDrafts((current) => ({ ...current, [row.purchase_order_item_id]: { ...draft, neededAt: event.target.value } }))} /></div>
                </div>
              </article>
            );
          })}
        </div>
        {first?.strap_manual_adjustment_reason && <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">Último ajuste: {first.strap_manual_adjustment_reason} · {dateLabel(first.strap_manual_adjusted_at)}</p>}
        <div className="space-y-1.5"><Label>Motivo do ajuste *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!first || first.commercial_revision == null || !hasChanges || !valuesValid || !reason.trim() || adjust.isPending}
            onClick={async () => {
              if (!first || !changes || first.commercial_revision == null) return;
              await adjust.mutateAsync({
                purchaseOrderId: first.purchase_order_id,
                expectedCommercialRevision: Number(first.commercial_revision),
                changes,
                reason: reason.trim(),
              });
              onClose();
            }}
          >Salvar ajuste auditado</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PurchaseOrderBulkResult {
  succeeded: string[];
  failed: Array<{ label: string; error: string }>;
}

function PurchaseOrderBulkSummary({ result }: { result: PurchaseOrderBulkResult }) {
  return (
    <Alert variant={result.failed.length > 0 ? 'destructive' : 'default'}>
      {result.failed.length > 0 ? <Warning className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
      <AlertTitle>{result.succeeded.length} sucesso(s) · {result.failed.length} falha(s)</AlertTitle>
      <AlertDescription className="space-y-2">
        {result.succeeded.length > 0 && <p>Concluídas: {result.succeeded.join(', ')}</p>}
        {result.failed.map((entry) => <p key={entry.label}><strong>{entry.label}:</strong> {entry.error}</p>)}
      </AlertDescription>
    </Alert>
  );
}

function PurchaseOrdersBulkSuspendDialog({
  targets,
  onClose,
}: {
  targets: Array<{ id: string; label: string }> | null;
  onClose: () => void;
}) {
  const suspend = useSuspendArtisanalStrapOperation();
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<PurchaseOrderBulkResult | null>(null);
  const close = () => { setReason(''); setResult(null); onClose(); };
  return (
    <Dialog open={Boolean(targets?.length)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suspender {targets?.length || 0} OC(s) inteira(s)</DialogTitle>
          <DialogDescription>Todos os itens e contribuições das OCs selecionadas ficam suspensos com o mesmo motivo administrativo.</DialogDescription>
        </DialogHeader>
        {result && <PurchaseOrderBulkSummary result={result} />}
        <div className="space-y-2 text-xs text-muted-foreground">{targets?.map((target) => <p key={target.id}>{target.label}</p>)}</div>
        <div className="space-y-1.5"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Voltar</Button>
          {!result && <Button
            variant="destructive"
            disabled={!targets?.length || !reason.trim() || suspend.isPending || working}
            onClick={async () => {
              if (!targets?.length) return;
              setWorking(true);
              const next: PurchaseOrderBulkResult = { succeeded: [], failed: [] };
              for (const target of targets) {
                try {
                  await suspend.mutateAsync({ entityType: 'purchase_order', entityId: target.id, reason: reason.trim() });
                  next.succeeded.push(target.label);
                } catch (error) {
                  next.failed.push({
                    label: target.label,
                    error: error instanceof Error ? error.message : 'Falha não identificada.',
                  });
                }
              }
              setResult(next);
              setWorking(false);
            }}
          >Suspender OCs</Button>}
          {result && <Button onClick={close}>Fechar resumo</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArtisanalStrapPurchaseOrdersPanel({
  rows,
  canManage,
  canSeeFinancial,
  title = 'Ordens de compra especializadas',
  subtitle = 'Uma OC por fornecedor e quinzena; o PDF aprovado é congelado e nunca regenerado.',
}: {
  rows: StrapPurchaseOrderItemOperational[];
  canManage: boolean;
  canSeeFinancial: boolean;
  title?: string;
  subtitle?: string;
}) {
  const prepareApproval = usePrepareArtisanalStrapPurchaseOrderApproval();
  const approve = useApproveArtisanalStrapPurchaseOrder();
  const resume = useResumeArtisanalStrapOperation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState<StrapPurchaseOrderItemOperational | null>(null);
  const [adjustmentTarget, setAdjustmentTarget] = useState<StrapPurchaseOrderItemOperational[] | null>(null);
  const [suspendTargets, setSuspendTargets] = useState<Array<{ id: string; label: string }> | null>(null);
  const [bulkApprovalResult, setBulkApprovalResult] = useState<PurchaseOrderBulkResult | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, StrapPurchaseOrderItemOperational[]>();
    rows.forEach((row) => map.set(row.purchase_order_id, [...(map.get(row.purchase_order_id) || []), row]));
    return [...map.values()];
  }, [rows]);
  const selectedHeaders = groups.map((group) => group[0]).filter((row) => selected.has(row.purchase_order_id));
  const selectedSuspended = selectedHeaders.filter(isPurchaseOrderSuspended);
  const selectedSuspendable = selectedHeaders.filter((row) => !isPurchaseOrderSuspended(row) && !row.has_frozen_pdf);

  const approveGroup = async (group: StrapPurchaseOrderItemOperational[]) => {
    const first = group[0];
    const blocker = purchaseOrderApprovalBlocker(group);
    if (blocker) throw new Error(blocker);
    const prepared = await prepareApproval.mutateAsync({
      purchaseOrderId: first.purchase_order_id,
      expectedCommercialRevision: Number(first.commercial_revision),
      expectedCommercialDigest: String(first.commercial_digest),
    });
    const document = await uploadPreparedPurchaseOrderPdf(group, prepared);
    await approve.mutateAsync({
      purchaseOrderId: first.purchase_order_id,
      storagePath: document.storagePath,
      sha256: document.sha256,
      expectedCommercialRevision: prepared.commercial_revision,
      expectedCommercialDigest: prepared.commercial_digest,
      approvalToken: prepared.approval_token,
      correlationId: prepared.correlation_id,
    });
  };

  const approveMany = async () => {
    const chosen = groups.filter((group) => selected.has(group[0].purchase_order_id));
    if (chosen.length === 0) return toast.error('Selecione ao menos uma OC.');
    setWorking(true);
    setBulkApprovalResult(null);
    const result: PurchaseOrderBulkResult = { succeeded: [], failed: [] };
    const successfulIds = new Set<string>();
    for (const group of chosen) {
      const first = group[0];
      const label = first.order_number || first.purchase_order_id;
      try {
        // Cada iteração tem preflight, PDF, upload imutável e aprovação próprios.
        // Uma falha nunca impede a tentativa das OCs seguintes.
        await approveGroup(group);
        result.succeeded.push(label);
        successfulIds.add(first.purchase_order_id);
      } catch (error) {
        result.failed.push({
          label,
          error: error instanceof Error ? error.message : 'Falha não identificada.',
        });
      }
    }
    setBulkApprovalResult(result);
    if (result.succeeded.length > 0) {
      setSelected((current) => {
        const next = new Set(current);
        successfulIds.forEach((purchaseOrderId) => next.delete(purchaseOrderId));
        return next;
      });
    }
    setWorking(false);
  };

  const downloadMany = async () => {
    const chosen = groups.filter((group) => selected.has(group[0].purchase_order_id));
    if (chosen.length === 0) return toast.error('Selecione ao menos uma OC.');
    setWorking(true);
    try {
      const files: Array<{ name: string; data: Uint8Array }> = [];
      for (const group of chosen) {
        const data = orderPdfData(group);
        const bytes = group[0].has_frozen_pdf
          ? (await fetchFrozenStrapPurchaseOrderPdf(group[0].purchase_order_id)).bytes
          : await renderStrapPurchaseOrderPdf(data);
        files.push({ name: `${fileName(data.orderNumber)}-${fileName(data.supplierName)}.pdf`, data: bytes });
      }
      downloadStrapPurchaseOrderFilesZip(files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível preparar o ZIP.');
    } finally { setWorking(false); }
  };

  if (groups.length === 0) return null;
  return (
    <Panel
      eyebrow="COMPRA PRONTA"
      title={title}
      subtitle={subtitle}
      actions={<div className="flex flex-wrap gap-2">
        {canManage && <Button size="sm" disabled={working || selected.size === 0} onClick={approveMany}><CheckCircle className="mr-1 h-4 w-4" /> Aprovar em lote ({selected.size})</Button>}
        {canManage && <Button variant="outline" size="sm" disabled={selectedSuspendable.length === 0} onClick={() => setSuspendTargets(selectedSuspendable.map((row) => ({ id: row.purchase_order_id, label: row.order_number || row.purchase_order_id })))}><Pause className="mr-1 h-4 w-4" /> Suspender ({selectedSuspendable.length})</Button>}
        {canManage && <Button variant="outline" size="sm" disabled={selectedSuspended.length === 0 || resume.isPending} onClick={async () => { for (const row of selectedSuspended) await resume.mutateAsync({ entityType: 'purchase_order', entityId: row.purchase_order_id }); }}><Play className="mr-1 h-4 w-4" /> Retomar ({selectedSuspended.length})</Button>}
        <Button variant="outline" size="sm" onClick={downloadMany} disabled={working || selected.size === 0} className="gap-2"><DownloadSimple className="h-4 w-4" /> Baixar ZIP ({selected.size})</Button>
      </div>}
    >
      <div className="space-y-2">
        {bulkApprovalResult && <PurchaseOrderBulkSummary result={bulkApprovalResult} />}
        {groups.map((group) => {
          const first = group[0];
          const data = orderPdfData(group);
          const checked = selected.has(first.purchase_order_id);
          const approvalBlocker = purchaseOrderApprovalBlocker(group);
          return (
            <article key={first.purchase_order_id} className="rounded-lg border border-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Checkbox checked={checked} onCheckedChange={(value) => setSelected((current) => { const next = new Set(current); if (value === true) next.add(first.purchase_order_id); else next.delete(first.purchase_order_id); return next; })} aria-label={`Selecionar ${data.orderNumber}`} />
                  <div>
                    <p className="font-semibold">{data.orderNumber} · {first.supplier_name}</p>
                    <p className="text-xs text-muted-foreground">{first.billing_month || '—'}/{first.billing_year || '—'} · {first.billing_fortnight || '—'}ª quinzena · {first.payment_condition_snapshot || 'sem condição'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Comprar até {dateLabel(first.purchase_by_date)} · chegada {dateLabel(first.promised_date)}
                      {first.latest_job_status ? ` · job ${first.latest_job_status}` : ''}
                    </p>
                    {first.latest_job_error && <p className="mt-1 text-xs text-destructive">Falha do job: {first.latest_job_error}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {first.criticality && <StrapStatusBadge status={first.criticality} />}
                  <StrapStatusBadge status={purchaseOrderCanonicalStatus(first)} />
                  <Button
                    variant="outline" size="sm" className="gap-1"
                    onClick={async () => {
                      try {
                        const bytes = first.has_frozen_pdf ? (await fetchFrozenStrapPurchaseOrderPdf(first.purchase_order_id)).bytes : await renderStrapPurchaseOrderPdf(data);
                        downloadBinaryFile(bytes, `${fileName(data.orderNumber)}.pdf`, 'application/pdf');
                      } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao baixar PDF.'); }
                    }}
                  ><DownloadSimple className="h-4 w-4" /> PDF</Button>
                  {canManage && !first.has_frozen_pdf && !isPurchaseOrderSuspended(first) && (
                    <Button size="sm" variant="outline" onClick={() => setAdjustmentTarget(group)}><PencilSimple className="mr-1 h-4 w-4" /> Ajustar</Button>
                  )}
                  {canManage && !first.has_frozen_pdf && (isPurchaseOrderSuspended(first)
                    ? <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate({ entityType: 'purchase_order', entityId: first.purchase_order_id })}><Play className="mr-1 h-4 w-4" /> Retomar OC</Button>
                    : <Button size="sm" variant="outline" onClick={() => setSuspendTargets([{ id: first.purchase_order_id, label: data.orderNumber }])}><Pause className="mr-1 h-4 w-4" /> Suspender OC</Button>)}
                  {canManage && !first.has_frozen_pdf && (
                    <Button
                      size="sm" className="gap-1"
                      disabled={working || prepareApproval.isPending || approve.isPending || Boolean(approvalBlocker)}
                      title={approvalBlocker || undefined}
                      onClick={async () => {
                        try {
                          await approveGroup(group);
                        } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível aprovar a OC.'); }
                      }}
                    ><CheckCircle className="h-4 w-4" /> Aprovar e congelar</Button>
                  )}
                </div>
              </div>
              {first.suspension_reason && <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground">Suspensa: {first.suspension_reason}</p>}
              {first.strap_manual_adjustment_reason && <p className="mt-2 text-xs text-muted-foreground">Ajuste manual: {first.strap_manual_adjustment_reason} · {dateLabel(first.strap_manual_adjusted_at)}</p>}
              {(first.blockers || []).length > 0 && (
                <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                  Bloqueios: {(first.blockers || []).join(' · ')}
                </p>
              )}
              <div className="mt-3 space-y-2 border-t border-border pt-2">
                {group.map((row) => (
                  <div key={row.purchase_order_item_id} className="rounded-md bg-muted/30 p-2 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong>{row.product_name}</strong>
                        <p className="text-muted-foreground">
                          Sugerido {Number(row.required_stock_quantity || 0).toLocaleString('pt-BR')} {row.stock_unit_snapshot || 'm'} · final {Number(row.ordered_purchase_quantity).toLocaleString('pt-BR')} {row.purchase_unit_snapshot || row.unit}
                        </p>
                        <p className="text-muted-foreground">Recebido {Number(row.received_purchase_quantity || 0).toLocaleString('pt-BR')} de {Number(row.ordered_purchase_quantity).toLocaleString('pt-BR')} {row.purchase_unit_snapshot || row.unit}</p>
                      </div>
                      {canManage && canSeeFinancial && first.has_frozen_pdf && Number(row.received_purchase_quantity || 0) < Number(row.ordered_purchase_quantity) && (
                        <Button size="sm" variant="outline" onClick={() => setReceiptTarget(row)}><ShoppingBag className="mr-1 h-4 w-4" /> Dar entrada</Button>
                      )}
                    </div>
                    {(row.contributions || []).map((entry) => <div key={entry.id} className="mt-1 flex justify-between gap-3 text-muted-foreground"><span>{entry.origin_type === 'stock_floor' ? 'Reposição de estoque mínimo' : entry.label}</span><span>{Number(entry.required_stock_quantity).toLocaleString('pt-BR')} {row.stock_unit_snapshot || 'm'}</span></div>)}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <StrapPurchaseReceiptDialog target={receiptTarget} onClose={() => setReceiptTarget(null)} />
      <PurchaseOrderAdjustmentDialog rows={adjustmentTarget} canSeeFinancial={canSeeFinancial} onClose={() => setAdjustmentTarget(null)} />
      <PurchaseOrdersBulkSuspendDialog targets={suspendTargets} onClose={() => setSuspendTargets(null)} />
    </Panel>
  );
}

function ContractorLossDecisionDialog({
  target,
  decision,
  onClose,
}: {
  target: StrapContractorLossClaimOperational | null;
  decision: 'approved' | 'rejected' | null;
  onClose: () => void;
}) {
  const decide = useDecideArtisanalStrapContractorLossClaim();
  const [reason, setReason] = useState('');
  useEffect(() => { if (target) setReason(''); }, [target, decision]);
  const close = () => { if (!decide.isPending) onClose(); };
  return (
    <Dialog open={!!target && !!decision} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{decision === 'approved' ? 'Aprovar perda em custódia' : 'Rejeitar perda em custódia'}</DialogTitle>
          <DialogDescription>{target?.service_order_number} · {target?.contractor_name} · {meters(target?.lost_quantity)}. A decisão e o motivo ficam na trilha administrativa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5"><Label>Motivo da decisão *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Voltar</Button>
          <Button
            variant={decision === 'rejected' ? 'destructive' : 'default'}
            disabled={!target || !decision || !reason.trim() || decide.isPending}
            onClick={async () => {
              if (!target || !decision) return;
              await decide.mutateAsync({ claimId: target.claim_id, decision, reason: reason.trim() });
              onClose();
            }}
          >Confirmar decisão</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractorClaimsPanel({
  rows,
  canManage,
}: {
  rows: StrapContractorLossClaimOperational[];
  canManage: boolean;
}) {
  const [decisionTarget, setDecisionTarget] = useState<StrapContractorLossClaimOperational | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  if (rows.length === 0) return null;
  return (
    <Panel
      eyebrow="PERDAS EM CUSTÓDIA"
      title="Decisões administrativas"
      subtitle="A aprovação baixa a custódia e o estoque; a responsabilidade do terceirizado entra no ciclo financeiro."
    >
      <div className="space-y-2">
        {rows.map((claim) => (
          <article key={claim.claim_id} className="rounded-md border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{claim.service_order_number} · {claim.contractor_name}</p>
                <p className="text-xs text-muted-foreground">{claim.base_product_name} · {meters(claim.lost_quantity)} · {claim.reason}</p>
                {claim.claim_amount != null && <p className="mt-1 text-xs text-muted-foreground">Valor estimado: {currency(claim.claim_amount)}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StrapStatusBadge status={claim.status} />
                {canManage && claim.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setDecisionTarget(claim); setDecision('rejected'); }}><XCircle className="mr-1 h-4 w-4" /> Rejeitar</Button>
                    <Button size="sm" onClick={() => { setDecisionTarget(claim); setDecision('approved'); }}><CheckCircle className="mr-1 h-4 w-4" /> Aprovar</Button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <ContractorLossDecisionDialog target={decisionTarget} decision={decision} onClose={() => { setDecisionTarget(null); setDecision(null); }} />
    </Panel>
  );
}

function ReworkDecisionDialog({
  target,
  decision,
  onClose,
}: {
  target: StrapReworkMaterialRequestOperational | null;
  decision: 'approved' | 'rejected' | null;
  onClose: () => void;
}) {
  const decide = useDecideArtisanalStrapReworkMaterialRequest();
  const [approvedM, setApprovedM] = useState(0);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!target) return;
    setApprovedM(Number(target.requested_m) || 0);
    setReason('');
  }, [target]);
  const close = () => { if (!decide.isPending) onClose(); };
  return (
    <Dialog open={!!target && !!decision} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{decision === 'approved' ? 'Autorizar napa adicional' : 'Rejeitar solicitação'}</DialogTitle><DialogDescription>{target?.contractor_name} · solicitado {meters(target?.requested_m)}. A remessa continuará bloqueada acima do planejado até esta autorização.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {decision === 'approved' && <div className="space-y-1"><Label>Metragem autorizada *</Label><NumberInput value={approvedM} onChange={setApprovedM} unit="m" /></div>}
          <div className="space-y-1"><Label>Motivo da decisão *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={close}>Cancelar</Button><Button variant={decision === 'rejected' ? 'destructive' : 'default'} disabled={!target || !decision || !reason.trim() || (decision === 'approved' && (approvedM <= 0 || approvedM > Number(target.requested_m))) || decide.isPending} onClick={async () => { if (!target || !decision) return; await decide.mutateAsync({ requestId: target.request_id, decision, approvedM: decision === 'approved' ? approvedM : null, reason: reason.trim() }); onClose(); }}>{decision === 'approved' ? 'Autorizar e reservar' : 'Rejeitar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReworkRequestsPanel({
  rows,
  canManage,
}: {
  rows: StrapReworkMaterialRequestOperational[];
  canManage: boolean;
}) {
  const [target, setTarget] = useState<StrapReworkMaterialRequestOperational | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  if (rows.length === 0) return null;
  return (
    <Panel
      eyebrow="RETRABALHO"
      title="Napa adicional aguardando autorização"
      subtitle="Rejeição não libera material automaticamente; somente a metragem aprovada amplia o limite de remessa."
    >
      <div className="space-y-2">
        {rows.map((request) => (
          <article key={request.request_id} className="rounded-md border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-sm font-semibold">{request.contractor_name} · {request.base_product_name}</p><p className="text-xs text-muted-foreground">Solicitado {meters(request.requested_m)} · autorizado {meters(request.approved_m)} · remetido {meters(request.sent_m)}</p><p className="mt-1 text-xs text-muted-foreground">{request.reason}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <StrapStatusBadge status={request.status} />
                {canManage && request.status === 'pending' && <><Button size="sm" variant="outline" onClick={() => { setTarget(request); setDecision('rejected'); }}>Rejeitar</Button><Button size="sm" onClick={() => { setTarget(request); setDecision('approved'); }}>Autorizar</Button></>}
              </div>
            </div>
          </article>
        ))}
      </div>
      <ReworkDecisionDialog target={target} decision={decision} onClose={() => { setTarget(null); setDecision(null); }} />
    </Panel>
  );
}

function MarkCyclePaidDialog({
  target,
  onClose,
}: {
  target: StrapContractorPaymentCycleOperational | null;
  onClose: () => void;
}) {
  const markPaid = useMarkArtisanalStrapContractorPaymentCyclePaid();
  const [paymentDate, setPaymentDate] = useState(todayInputValue());
  const [paymentMethod, setPaymentMethod] = useState('');
  const close = () => { setPaymentDate(todayInputValue()); setPaymentMethod(''); onClose(); };
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Confirmar pagamento do ciclo</DialogTitle><DialogDescription>{target?.contractor_name} · líquido {currency(target?.net_amount)}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Data do pagamento *</Label><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>Meio de pagamento</Label><Input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="PIX, transferência…" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={close}>Cancelar</Button><Button disabled={!target || !paymentDate || markPaid.isPending} onClick={async () => { if (!target) return; await markPaid.mutateAsync({ cycleId: target.cycle_id, paymentDate, paymentMethod: paymentMethod.trim() }); close(); }}><CurrencyCircleDollar className="mr-1 h-4 w-4" /> Confirmar pago</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractorPaymentCyclesPanel({
  rows,
  canManage,
  canSeeFinancial,
}: {
  rows: StrapContractorPaymentCycleOperational[];
  canManage: boolean;
  canSeeFinancial: boolean;
}) {
  const closeCycle = useCloseArtisanalStrapContractorPaymentCycle();
  const [paidTarget, setPaidTarget] = useState<StrapContractorPaymentCycleOperational | null>(null);
  if (rows.length === 0) return null;
  return (
    <Panel
      eyebrow="TERCEIRIZAÇÃO · FINANCEIRO"
      title="Ciclos de pagamento"
      subtitle="Competência semanal ou quinzenal, descontos por perdas aprovadas e vencimento no calendário bancário."
    >
      {!canSeeFinancial && <Alert><HandPalm className="h-4 w-4" /><AlertTitle>Valores protegidos</AlertTitle><AlertDescription>Datas e volumes continuam visíveis; totais e ações financeiras exigem acesso do Administrador financeiro.</AlertDescription></Alert>}
      <div className="mt-3 space-y-2">
        {rows.map((cycle) => (
          <article key={cycle.cycle_id} className="rounded-md border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{cycle.contractor_name}</p>
                <p className="text-xs text-muted-foreground">Competência {dateLabel(cycle.cycle_start)}–{dateLabel(cycle.cycle_end)} · vencimento {dateLabel(cycle.payment_date)} · {Number(cycle.accepted_m || 0).toLocaleString('pt-BR')} m</p>
                {canSeeFinancial && <p className="mt-1 text-xs">Bruto {currency(cycle.gross_amount)} · descontos {currency(cycle.discount_amount)} · <strong>líquido {currency(cycle.net_amount)}</strong></p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StrapStatusBadge status={cycle.status} />
                {canManage && canSeeFinancial && cycle.status === 'open' && <Button size="sm" disabled={closeCycle.isPending} onClick={() => closeCycle.mutate({ cycleId: cycle.cycle_id, idempotencyKey: `strap-cycle-close:${cycle.cycle_id}` })}>Fechar ciclo</Button>}
                {canManage && canSeeFinancial && cycle.status === 'closed' && <Button size="sm" variant="outline" onClick={() => setPaidTarget(cycle)}>Marcar pago</Button>}
              </div>
            </div>
          </article>
        ))}
      </div>
      <MarkCyclePaidDialog target={paidTarget} onClose={() => setPaidTarget(null)} />
    </Panel>
  );
}

export function ArtisanalStrapExternalOperations({
  data,
  catalog,
  isLoading,
  isError,
  onRetry,
}: {
  data?: ArtisanalStrapExternalOperationsData;
  catalog: ArtisanalStrapCatalog;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const resume = useResumeArtisanalStrapOperation();
  const [receiptTarget, setReceiptTarget] = useState<ReceiptTarget | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<SuspendTarget | null>(null);
  const [contractorTarget, setContractorTarget] = useState<StrapServiceOrderItemOperational | null>(null);
  const [contractorAction, setContractorAction] = useState<ContractorAction | null>(null);
  const canExecute = catalog.capabilities.execute_strap_batch;
  const canAdmin = catalog.capabilities.administer_strap_operations;
  const serviceOrderGroups = useMemo(() => {
    const groups = new Map<string, StrapServiceOrderItemOperational[]>();
    (data?.serviceItems || []).forEach((item) => {
      groups.set(item.service_order_id, [...(groups.get(item.service_order_id) || []), item]);
    });
    return [...groups.values()];
  }, [data?.serviceItems]);

  if (isError) return <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Operações externas indisponíveis</AlertTitle><AlertDescription><Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button></AlertDescription></Alert>;
  if (isLoading) return <Panel><p className="text-sm text-muted-foreground">Carregando OCs e OSs especializadas…</p></Panel>;
  return (
    <div className="space-y-4">
      {serviceOrderGroups.length > 0 && (
        <Panel eyebrow="TERCEIRIZAÇÃO" title="Ordens de serviço e custódia" subtitle="Remessa, retorno, perda e recebimento parcial usam RPCs idempotentes.">
          <div className="space-y-2">
            {serviceOrderGroups.map((group) => {
              const first = group[0];
              return (
                <article key={first.service_order_id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div><p className="font-semibold">{first.service_order_number} · {first.contractor_name}</p><p className="text-xs text-muted-foreground">{group.length} linha(s) · prazo {dateLabel(group.map((item) => item.needed_at).filter(Boolean).sort()[0])}</p></div>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => printArtisanalStrapServiceOrder(serviceOrderPdfData(group, catalog))}><DownloadSimple className="h-4 w-4" /> PDF da OS</Button>
                  </div>
                  <div className="mt-3 space-y-2 border-t border-border pt-2">
                    {group.map((item) => {
                      const custodyBalance = Number((data?.custodyBalances || []).find((balance) => balance.service_order_item_id === item.service_order_item_id)?.balance_in_custody || 0);
                      const terminal = [item.line_status, item.service_order_status, item.batch_item_status, item.batch_status]
                        .some(isTerminalStrapOperationStatus);
                      const suspended = [item.line_status, item.service_order_status, item.batch_item_status, item.batch_status]
                        .some(isSuspendedStrapOperationStatus);
                      const remainingFinishedM = Math.max(0, Number(item.planned_m) - Number(item.delivered_m || 0));
                      const hasCustody = custodyBalance > 0.0001;
                      const hasContractorRemittance = Boolean(item.sent_at);
                      const hasPhysicalCommitment = hasCustody || Boolean(
                        item.sent_at || item.batch_item_started_at || item.batch_started_at,
                      );
                      const canReceive = canExecute && !terminal && remainingFinishedM > 0.0001
                        && hasContractorRemittance
                        && (!suspended || hasPhysicalCommitment);
                      const canSend = canExecute && !terminal && !suspended && remainingFinishedM > 0.0001;
                      const canReturn = canExecute && hasCustody;
                      const canRequestRework = canExecute && !terminal && !suspended && remainingFinishedM > 0.0001;
                      const canAdjustCustody = canAdmin && ((!terminal && !suspended) || hasCustody);
                      const canRegisterLoss = canAdmin && hasCustody
                        && (item.loss_receipt_candidates || []).some((candidate) => Number(candidate.available_unclaimed_base_m) > 0);
                      return (
                        <div key={item.service_order_item_id} className="rounded-md bg-muted/30 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div><p className="text-sm font-medium">{item.finished_product_name || item.strap_variant_id}</p><p className="text-xs text-muted-foreground">{meters(item.delivered_m)} / {meters(item.planned_m)} · napa {meters(item.planned_base_m)} · custódia {meters(custodyBalance)}</p></div>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="outline">{item.line_status}</Badge>
                              {canReceive && <Button size="sm" variant="outline" onClick={() => setReceiptTarget({
                                kind: 'contractor',
                                id: item.service_order_item_id,
                                title: `${item.service_order_number} · ${item.contractor_name}`,
                                remainingM: Math.max(0, Number(item.planned_m) - Number(item.delivered_m || 0)),
                                contributions: (item.contributions || [])
                                  .filter((contribution) => ['planned', 'in_progress', 'partial', 'suspended'].includes(String(contribution.status || '').toLowerCase()))
                                  .filter((contribution) => Number(contribution.remaining_m) > 0)
                                  .map((contribution) => ({
                                    contributionId: contribution.contribution_id,
                                    originType: contribution.origin_type,
                                    label: contribution.label,
                                    remainingM: Number(contribution.remaining_m),
                                    priority: contribution.priority,
                                  })),
                              })}><Package className="mr-1 h-4 w-4" /> Receber parcial</Button>}
                              {canSend && <Button size="sm" variant="outline" onClick={() => { setContractorTarget(item); setContractorAction('send'); }}><ArrowUp className="mr-1 h-4 w-4" /> Remeter</Button>}
                              {canReturn && <Button size="sm" variant="outline" onClick={() => { setContractorTarget(item); setContractorAction('return'); }}><ArrowDown className="mr-1 h-4 w-4" /> Devolver</Button>}
                              {canRequestRework && <Button size="sm" variant="outline" onClick={() => { setContractorTarget(item); setContractorAction('rework'); }}><Plus className="mr-1 h-4 w-4" /> Solicitar retrabalho</Button>}
                              {canAdjustCustody && <Button size="sm" variant="outline" onClick={() => { setContractorTarget(item); setContractorAction('adjust'); }}><HandPalm className="mr-1 h-4 w-4" /> Ajustar</Button>}
                              {canRegisterLoss && <Button size="sm" variant="outline" onClick={() => { setContractorTarget(item); setContractorAction('loss'); }}><Warning className="mr-1 h-4 w-4" /> Perda</Button>}
                              {canAdmin && !terminal && (suspended
                                ? <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate({ entityType: 'service_order_item', entityId: item.service_order_item_id })}><Play className="mr-1 h-4 w-4" /> Retomar</Button>
                                : <Button size="sm" variant="outline" onClick={() => setSuspendTarget({ entityType: 'service_order_item', entityId: item.service_order_item_id, title: item.service_order_number })}><Pause className="mr-1 h-4 w-4" /> Suspender</Button>)}
                            </div>
                          </div>
                          {terminal && !hasCustody && (
                            <p className="mt-2 text-xs text-muted-foreground">Linha encerrada: não há fato físico de custódia pendente.</p>
                          )}
                          {canExecute && !terminal && remainingFinishedM > 0.0001 && !hasContractorRemittance && (
                            <p className="mt-2 text-xs text-muted-foreground">Recebimento liberado somente após registrar a remessa da napa. Use Remeter; sem data de envio a entrada seria recusada.</p>
                          )}
                          {suspended && hasCustody && (
                            <p className="mt-2 text-xs text-muted-foreground">Suspensa: somente recebimento já comprometido e saneamento da custódia permanecem disponíveis.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>
      )}
      <ArtisanalStrapPurchaseOrdersPanel
        rows={data?.purchaseItems || []}
        canManage={canAdmin}
        canSeeFinancial={Boolean(catalog.capabilities.can_see_financial_values)}
      />
      <ContractorClaimsPanel rows={data?.lossClaims || []} canManage={canAdmin} />
      <ReworkRequestsPanel rows={data?.reworkRequests || []} canManage={canAdmin} />
      <ContractorPaymentCyclesPanel
        rows={data?.paymentCycles || []}
        canManage={canAdmin}
        canSeeFinancial={Boolean(catalog.capabilities.can_see_financial_values)}
      />
      <StrapReceiptDialog target={receiptTarget} onClose={() => setReceiptTarget(null)} />
      <StrapSuspendDialog target={suspendTarget} onClose={() => setSuspendTarget(null)} />
      <ContractorActionDialog
        target={contractorTarget}
        action={contractorAction}
        custodyBalance={Number((data?.custodyBalances || []).find((balance) => balance.service_order_item_id === contractorTarget?.service_order_item_id)?.balance_in_custody || 0)}
        onClose={() => { setContractorTarget(null); setContractorAction(null); }}
      />
    </div>
  );
}
