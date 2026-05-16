import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, Eye, CheckCircle, WarningCircle as AlertCircle } from '@phosphor-icons/react';
import { usePreviewNfe, useEmitNfe, type NfePreviewResponse } from '@/hooks/useNfe';
import { NfePreviewPanel } from './NfePreviewPanel';

/**
 * Dialog standalone de pré-visualização de NF-e. Abre, chama dry_run no
 * emit-nfe automaticamente, renderiza o NfePreviewPanel e oferece botão
 * "Confirmar e emitir" pra disparar a emissão real sem precisar fechar.
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

  // Dispara dry_run ao abrir. Reset ao fechar pra não vazar preview entre PVs.
  useEffect(() => {
    if (!open || !saleOrderId) {
      setPreviewData(null);
      setErrorMsg(null);
      return;
    }
    let cancelled = false;
    setErrorMsg(null);
    setPreviewData(null);
    preview.mutateAsync({ saleOrderId, companyId })
      .then((data) => { if (!cancelled) setPreviewData(data); })
      .catch((err: Error) => { if (!cancelled) setErrorMsg(err.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleOrderId, companyId]);

  const handleConfirm = async () => {
    if (submitting || !saleOrderId) return;
    setSubmitting(true);
    try {
      await emit.mutateAsync({ saleOrderId, companyId });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
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

        {previewData && <NfePreviewPanel preview={previewData.preview} />}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={emit.isPending || submitting}>Fechar</Button>
          <Button
            onClick={handleConfirm}
            disabled={!previewData || emit.isPending || submitting}
          >
            {emit.isPending || submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Confirmar e emitir NF-e
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
