import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CircleNotch as Loader2, Eye, CheckCircle, WarningCircle as AlertCircle, CalendarBlank } from '@phosphor-icons/react';
import { usePreviewNfe, useEmitNfe, type NfePreviewResponse } from '@/hooks/useNfe';
import { NfePreviewPanel } from './NfePreviewPanel';

/** "15/08/2026" → "2026-08-15" (pro <input type=date>). Vazio se não casar. */
const ddmmyyyyToISO = (s?: string | null): string => {
  const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/**
 * Dialog standalone de pré-visualização de NF-e. Abre, chama dry_run no
 * emit-nfe automaticamente, renderiza o NfePreviewPanel e oferece botão
 * "Confirmar e emitir" pra disparar a emissão real sem precisar fechar.
 *
 * Faturamento antecipado: um seletor de "1ª data de vencimento" deixa o
 * operador ancorar a 1ª parcela numa data escolhida — as demais parcelas
 * seguem os MESMOS intervalos da condição de pagamento (ex.: 60/75/90). A
 * data escolhida vale tanto pras duplicatas da NF quanto pras contas a
 * receber. Sem mexer, o vencimento calculado padrão é mantido.
 *
 * Usado como atalho no resumo do PV (SaleOrders.tsx). O wizard de 2 passos
 * em NfePage.tsx tem o seu próprio fluxo (busca de PV + preview) e não
 * usa esse dialog — partilham apenas o NfePreviewPanel.
 */
export function NfePreviewDialog({
  saleOrderId,
  companyId,
  orderNumber,
  open,
  onClose,
}: {
  saleOrderId: string | null;
  companyId?: string;
  orderNumber?: string;
  open: boolean;
  onClose: () => void;
}) {
  const preview = usePreviewNfe();
  const emit = useEmitNfe();
  const [previewData, setPreviewData] = useState<NfePreviewResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 1ª data de vencimento escolhida (ISO). null = usa o vencimento calculado padrão.
  const [firstDueOverride, setFirstDueOverride] = useState<string | null>(null);

  // Reseta o override ao trocar de PV / fechar (não vaza entre pedidos).
  useEffect(() => {
    setFirstDueOverride(null);
  }, [open, saleOrderId]);

  // Dispara dry_run ao abrir e a cada mudança do override. Reset ao fechar.
  useEffect(() => {
    if (!open || !saleOrderId) {
      setPreviewData(null);
      setErrorMsg(null);
      return;
    }
    let cancelled = false;
    setErrorMsg(null);
    preview.mutateAsync({ saleOrderId, companyId, firstDueDate: firstDueOverride })
      .then((data) => { if (!cancelled) setPreviewData(data); })
      .catch((err: Error) => { if (!cancelled) setErrorMsg(err.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleOrderId, companyId, firstDueOverride]);

  const parcelas = previewData?.preview?.pagamento ?? [];
  // Valor do seletor: o override escolhido, senão a 1ª data calculada no preview.
  const firstDueValue = firstDueOverride ?? ddmmyyyyToISO(parcelas[0]?.vencimento);
  const multiParcela = parcelas.length > 1;
  const reloading = preview.isPending && !!previewData;

  const handleConfirm = async () => {
    if (submitting || !saleOrderId) return;
    setSubmitting(true);
    try {
      await emit.mutateAsync({ saleOrderId, companyId, firstDueDate: firstDueOverride });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Conferir NF-e{orderNumber ? ` — ${orderNumber}` : ''}
          </DialogTitle>
        </DialogHeader>

        {preview.isPending && !previewData && (
          <div className="flex justify-center items-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Gerando preview da NF-e...
          </div>
        )}

        {errorMsg && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 space-y-1">
            <p className="flex items-start gap-2 text-red-700 text-sm font-medium">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              Não foi possível gerar o preview
            </p>
            <p className="text-xs text-red-600 whitespace-pre-wrap pl-6">{errorMsg}</p>
          </div>
        )}

        {previewData && (
          <>
            {/* Faturamento antecipado: escolha da 1ª data de vencimento */}
            {parcelas.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <label htmlFor="nfe-first-due" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <CalendarBlank className="h-3.5 w-3.5" /> 1ª data de vencimento
                  </label>
                  <Input
                    id="nfe-first-due"
                    type="date"
                    value={firstDueValue}
                    onChange={(e) => setFirstDueOverride(e.target.value || null)}
                    className="h-9 w-48"
                  />
                  <p className="text-[11px] text-muted-foreground max-w-md">
                    {multiParcela
                      ? 'As demais parcelas seguem os intervalos da condição de pagamento. Vale para a NF e para as contas a receber.'
                      : 'Vencimento da parcela única. Vale para a NF e para as contas a receber.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {reloading && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> recalculando…</>}
                  {firstDueOverride && !reloading && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFirstDueOverride(null)}>
                      Usar data padrão
                    </Button>
                  )}
                </div>
              </div>
            )}

            <NfePreviewPanel preview={previewData.preview} />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={emit.isPending || submitting}>Fechar</Button>
          <Button
            onClick={handleConfirm}
            disabled={!previewData || emit.isPending || submitting || reloading}
          >
            {emit.isPending || submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Confirmar e emitir NF-e
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
