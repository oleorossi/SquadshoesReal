import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useContractors } from '@/hooks/useContractors';
import { uploadSignedReceiptPhoto } from '@/lib/serviceOrderStock';
import { formatCurrency } from '@/lib/utils';
import { CalendarBlank as Calendar, Camera, CircleNotch as Loader2, CurrencyDollar } from '@phosphor-icons/react';

/**
 * Registrar Retorno de OS terceirizada (Fase 1 facção).
 *
 * Modelo do setor: a banca devolve em UM OU MAIS retornos, separando pares
 * BONS / DEFEITUOSOS / PERDA. O banco (service_order_returns + triggers):
 *   - valida Σ retornos ≤ enviado;
 *   - fecha a OS ('Concluído' + delivered_at) quando o saldo zera;
 *   - marca 'Em Andamento' em retorno parcial;
 *   - gera a conta a pagar NA ENTREGA com valor = pares BONS × unit_price.
 * Aqui NÃO se mexe em status nem em accounts_payable — só insere o retorno.
 */

// service_order_returns / v_service_order_balance ainda não estão no types.ts
// (regenerar depois) — tipos locais + (supabase as any).
interface ReturnRow {
  id: string;
  returned_at: string;
  qty_good: number;
  qty_defect: number;
  qty_loss: number;
  defect_notes: string | null;
}

interface BalanceRow {
  qty_sent: number;
  qty_returned_good: number;
  qty_returned_defect: number;
  qty_loss: number;
  qty_in_field: number;
  qty_to_dispatch?: number;
  qty_defect_pending_rework?: number;
  dispatch_tracked?: boolean;
}

export interface ReturnDialogServiceOrder {
  id: string;
  order_number?: string | null;
  quantity?: number | null;
  description?: string | null;
  contractorName?: string | null;
  /** OS dividida entre prestadores → mostra seletor "de quem está voltando". */
  dispatchTracked?: boolean | null;
  contractorId?: string | null;
  unitPrice?: number | null;
  paymentDays?: number | null;
}

interface ContractorBal { contractor_id: string; qty_dispatched: number; qty_in_field: number; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrder: ReturnDialogServiceOrder | null;
  /** Chamado após salvar; completed=true quando o retorno zerou o saldo
   *  (OS fechada pelo banco) — o caller decide efeitos extras (ex.: saída
   *  artesanal). */
  onSaved?: (info: { completed: boolean }) => void;
}

export default function ServiceOrderReturnDialog({ open, onOpenChange, serviceOrder, onSaved }: Props) {
  const qc = useQueryClient();
  const soId = serviceOrder?.id ?? null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['so_return_dialog', soId],
    enabled: open && !!soId,
    queryFn: async () => {
      const [{ data: bal, error: balErr }, { data: rets, error: retErr }, { data: cbals }] = await Promise.all([
        (supabase as any).from('v_service_order_balance').select('*').eq('service_order_id', soId).maybeSingle(),
        (supabase as any)
          .from('service_order_returns')
          .select('id, returned_at, qty_good, qty_defect, qty_loss, defect_notes')
          .eq('service_order_id', soId)
          .order('returned_at', { ascending: false }),
        (supabase as any).from('v_service_order_contractor_balance').select('contractor_id, qty_dispatched, qty_in_field').eq('service_order_id', soId),
      ]);
      if (balErr) throw balErr;
      if (retErr) throw retErr;
      return { balance: (bal ?? null) as BalanceRow | null, returns: (rets ?? []) as ReturnRow[], contractorBals: (cbals ?? []) as ContractorBal[] };
    },
  });

  const balance = data?.balance ?? null;
  // Detecta OS dividida pelo próprio saldo (vale em qualquer tela que abra o dialog,
  // ex.: "Na Rua"), com o prop como dica enquanto o saldo carrega.
  const dispatchTracked = !!((balance as any)?.dispatch_tracked ?? serviceOrder?.dispatchTracked);
  const { data: contractors = [] } = useContractors();
  const contractorBals = data?.contractorBals ?? [];

  const [qtyGood, setQtyGood] = useState(0);
  const [qtyDefect, setQtyDefect] = useState(0);
  const [qtyLoss, setQtyLoss] = useState(0);
  // Dos pares com defeito, quantos são sucata (não voltam pro prestador). O
  // restante fica como retrabalho pendente e reabre saldo despachável.
  const [qtyScrapped, setQtyScrapped] = useState(0);
  const [defectNotes, setDefectNotes] = useState('');
  const [contractor, setContractor] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Na rua = do PRESTADOR selecionado (OS dividida) OU total (OS normal).
  const selBal = contractorBals.find(b => b.contractor_id === contractor);
  const inField = dispatchTracked
    ? Math.max(0, Number(selBal?.qty_in_field ?? 0))
    : Math.max(0, Number(balance?.qty_in_field ?? serviceOrder?.quantity ?? 0));

  // Reset (só na ABERTURA) — não mexe no prestador depois pra não reverter a escolha.
  useEffect(() => {
    if (open) {
      setQtyDefect(0);
      setQtyLoss(0);
      setQtyScrapped(0);
      setDefectNotes('');
      setContractor(serviceOrder?.contractorId || '');
      setReturnDate(new Date().toISOString().slice(0, 10));
      setReceiptFile(null);
    }

  }, [open, serviceOrder?.contractorId]);
  // Pré-preenche BONS com o saldo na rua (do prestador selecionado) — atualiza ao trocar.
  useEffect(() => {
    if (open) setQtyGood(inField);

  }, [open, inField]);

  // Baixar o nº de defeituosos não pode deixar a sucata maior que eles (o banco
  // tem CHECK pra isso — melhor corrigir na tela que estourar no save).
  useEffect(() => {
    setQtyScrapped(s => Math.min(s, qtyDefect));
  }, [qtyDefect]);

  const totalReturn = qtyGood + qtyDefect + qtyLoss;
  const exceeds = totalReturn > inField;
  const remainingTotal = Math.max(0, Number(balance?.qty_in_field ?? inField) - totalReturn);
  const reworkCreated = Math.max(0, qtyDefect - Math.min(qtyScrapped, qtyDefect));
  const expectedPayable = qtyGood * Math.max(0, Number(serviceOrder?.unitPrice ?? 0));
  // Em remessa dividida, prazo financeiro pertence a quem efetivamente
  // devolveu — pode ser diferente do prestador do cabeçalho da OS.
  const selectedContractor = contractors.find(c => c.id === contractor);
  const paymentDays = Math.max(0, Number(selectedContractor?.payment_days ?? serviceOrder?.paymentDays ?? 30));
  const expectedDueDate = useMemo(() => {
    if (!returnDate || paymentDays >= 999) return null;
    const d = new Date(`${returnDate}T12:00:00`);
    d.setDate(d.getDate() + paymentDays);
    return d.toLocaleDateString('pt-BR');
  }, [returnDate, paymentDays]);

  const fmtDate = useMemo(() => (s: string) => new Date(s).toLocaleDateString('pt-BR'), []);

  const handleSave = async () => {
    if (!soId || saving) return;
    if (dispatchTracked && !contractor) { toast.error('Selecione de qual prestador está voltando.'); return; }
    if (totalReturn <= 0) { toast.error('Informe ao menos 1 par devolvido.'); return; }
    if (exceeds) { toast.error(`Retorno excede o saldo na rua (${inField} pares).`); return; }
    if ((qtyDefect > 0 || qtyLoss > 0) && !defectNotes.trim()) {
      toast.error('Descreva o defeito/perda para preservar a rastreabilidade da conferência.');
      return;
    }
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      let signedPhotoUrl: string | null = null;
      if (receiptFile) {
        const uploaded = await uploadSignedReceiptPhoto(soId, receiptFile);
        signedPhotoUrl = uploaded.url;
        uploadedPath = uploaded.path;
      }
      const { error } = await (supabase as any).from('service_order_returns').insert({
        service_order_id: soId,
        returned_at: new Date(`${returnDate}T12:00:00`).toISOString(),
        qty_good: qtyGood,
        qty_defect: qtyDefect,
        qty_defect_scrapped: Math.min(qtyScrapped, qtyDefect),
        qty_loss: qtyLoss,
        defect_notes: defectNotes.trim() || null,
        contractor_id: dispatchTracked ? (contractor || null) : null,
        signed_photo_url: signedPhotoUrl,
      });
      if (error) throw error;

      // Mantém a coluna legada no cabeçalho para relatórios antigos, enquanto a
      // evidência correta fica presa ao retorno que ela documenta.
      if (signedPhotoUrl) {
        const { error: photoErr } = await (supabase as any)
          .from('service_orders')
          .update({ signed_photo_url: signedPhotoUrl })
          .eq('id', soId);
        if (photoErr) toast.warning('Conferência salva, mas a foto não apareceu no cabeçalho da OS.');
      }

      // Em OS dividida, zerar um prestador não conclui se outro ainda tem saldo.
      // Defeito não-sucateado também mantém a OS aberta para retrabalho.
      const completed = remainingTotal <= 0 && reworkCreated <= 0;
      toast.success(
        completed
          ? `OS ${serviceOrder?.order_number ?? ''} conferida por completo — financeiro gerado pelos pares bons.`
          : reworkCreated > 0
            ? `Conferência registrada — ${reworkCreated} par(es) aguardam retrabalho.`
            : `Conferência parcial registrada — restam ${remainingTotal} pares na rua.`,
      );
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_history_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['service_order_timeline', soId] });
      qc.invalidateQueries({ queryKey: ['so_return_dialog', soId] });
      onSaved?.({ completed });
      if (completed) onOpenChange(false);
      else refetch();
    } catch (e: any) {
      if (uploadedPath) {
        try { await supabase.storage.from('service-orders').remove([uploadedPath]); } catch { /* best effort */ }
      }
      toast.error(`Falha ao registrar retorno: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Conferir retorno — OS {serviceOrder?.order_number ?? ''}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {serviceOrder?.contractorName && (
                <Badge variant="outline">{serviceOrder.contractorName}</Badge>
              )}
              <span className="text-muted-foreground">
                Enviado <strong className="text-foreground">{balance?.qty_sent ?? serviceOrder?.quantity ?? 0}</strong>
                {' · '}Conferido <strong className="text-foreground">{(balance?.qty_returned_good ?? 0) + (balance?.qty_returned_defect ?? 0) + (balance?.qty_loss ?? 0)}</strong>
                {' · '}Na rua <strong className="text-foreground">{inField}</strong>
              </span>
            </div>

            {dispatchTracked && (
              <div>
                <Label className="text-xs">De qual prestador está voltando?</Label>
                <Select value={contractor} onValueChange={setContractor}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o prestador" /></SelectTrigger>
                  <SelectContent>
                    {contractorBals.filter(b => b.qty_dispatched > 0).map(b => {
                      const c = (contractors as any[]).find(x => x.id === b.contractor_id);
                      return <SelectItem key={b.contractor_id} value={b.contractor_id}>{(c?.trade_name || c?.name || 'Prestador')} — {Math.max(0, b.qty_in_field)} na rua</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Pares BONS</Label>
                <NumberInput value={qtyGood} onChange={v => setQtyGood(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Defeituosos</Label>
                <NumberInput value={qtyDefect} onChange={v => setQtyDefect(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Perda</Label>
                <NumberInput value={qtyLoss} onChange={v => setQtyLoss(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Data da conferência</Label>
                <Input type="date" value={returnDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReturnDate(e.target.value)} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1"><Camera className="h-3 w-3" /> Canhoto/foto (opcional)</Label>
                <Input type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="mt-1 h-9 text-xs" />
              </div>
            </div>

            {/* Destino do defeito: sem isso, TODO par defeituoso ficava como
                retrabalho pendente e nunca havia como registrar sucata. */}
            {qtyDefect > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-xs">Destino dos {qtyDefect} defeituosos</Label>
                <div className="mt-1.5 grid grid-cols-2 items-end gap-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Sucata (não volta)</Label>
                    <NumberInput
                      value={qtyScrapped}
                      onChange={v => setQtyScrapped(Math.min(qtyDefect, Math.max(0, Math.trunc(v ?? 0))))}
                      min={0}
                      className="h-9"
                    />
                  </div>
                  <p className="pb-2 text-[11px] text-muted-foreground">
                    {qtyDefect - Math.min(qtyScrapped, qtyDefect) > 0 ? (
                      <>
                        <strong className="text-foreground">{qtyDefect - Math.min(qtyScrapped, qtyDefect)}</strong> voltam
                        pro prestador como retrabalho — reabrem saldo pra nova remessa.
                      </>
                    ) : (
                      <>Todos viram sucata: entram na conta de reposição, não voltam pro prestador.</>
                    )}
                  </p>
                </div>
              </div>
            )}

            {(qtyDefect > 0 || qtyLoss > 0) && (
              <div>
                <Label className="text-xs">Ocorrência do defeito/perda *</Label>
                <Textarea value={defectNotes} onChange={e => setDefectNotes(e.target.value)} rows={2} placeholder="Ex.: costura torta em 4 pares" />
              </div>
            )}

            {totalReturn > 0 && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground"><CurrencyDollar className="h-4 w-4 text-primary" /> Envio ao financeiro</span>
                  <strong className="font-mono text-sm tabular-nums">{paymentDays >= 999 ? 'Não gera AP' : formatCurrency(expectedPayable)}</strong>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {paymentDays >= 999
                    ? 'Prestador interno FÁBRICA: a conferência fecha o fluxo físico sem criar conta a pagar.'
                    : <>{qtyGood} bons × {formatCurrency(Number(serviceOrder?.unitPrice ?? 0))}/par{expectedDueDate ? ` · vence ${expectedDueDate}` : ''}. Defeito e perda não são pagos.</>}
                </p>
              </div>
            )}

            <div className="text-xs">
              {exceeds ? (
                <span className="text-red-600">Retorno ({totalReturn}) excede o saldo na rua ({inField}).</span>
              ) : remainingTotal > 0 ? (
                <span className="text-amber-600">Conferência parcial — ficarão {remainingTotal} pares na rua.</span>
              ) : reworkCreated > 0 ? (
                <span className="text-amber-600">Conferência completa desta remessa, mas {reworkCreated} par(es) reabrem saldo de retrabalho.</span>
              ) : totalReturn > 0 ? (
                <span className="text-green-600">Conferência total — a OS será fechada e o financeiro receberá somente os pares bons.</span>
              ) : null}
            </div>

            {(data?.returns?.length ?? 0) > 0 && (
              <div className="border border-border rounded-md p-2 max-h-32 overflow-auto">
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Conferências anteriores</p>
                {data!.returns.map(r => (
                  <div key={r.id} className="text-xs flex items-center justify-between py-0.5">
                    <span>{fmtDate(r.returned_at)}</span>
                    <span className="font-mono">
                      {r.qty_good} bons{r.qty_defect > 0 ? ` · ${r.qty_defect} def.` : ''}{r.qty_loss > 0 ? ` · ${r.qty_loss} perda` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="h-9" onClick={handleSave} disabled={saving || isLoading || totalReturn <= 0 || exceeds || !returnDate || ((qtyDefect > 0 || qtyLoss > 0) && !defectNotes.trim()) || (dispatchTracked && !contractor)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Concluir conferência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
