import { useEffect, useState, useSyncExternalStore } from 'react';
import { CircleNotch as Loader2, ShareNetwork, DownloadSimple, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  downloadPdfFile,
  openPdfInSafari,
  sharePdfFile,
} from '@/lib/pdfDelivery';
import {
  cancelPdfDelivery,
  clearPdfShareFailed,
  closePdfDelivery,
  getPdfDeliveryState,
  markPdfShareFailed,
  pdfDeliveryStageText,
  subscribePdfDelivery,
} from '@/lib/pdfDeliveryStore';
import { toast } from 'sonner';

function usePdfDeliveryState() {
  return useSyncExternalStore(subscribePdfDelivery, getPdfDeliveryState, getPdfDeliveryState);
}

/**
 * Host global do overlay iOS de PDF. Montar uma vez em App.
 * Fora do iOS o store quase nunca abre — o host fica inerte.
 */
export default function PdfDeliveryHost() {
  const state = usePdfDeliveryState();
  const [safariConfirm, setSafariConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.open) setSafariConfirm(false);
  }, [state.open]);

  if (!state.open) return null;

  const onShare = async () => {
    if (!state.bytes || busy) return;
    setBusy(true);
    try {
      await sharePdfFile(state.bytes, state.filename, state.title);
      clearPdfShareFailed();
      toast.success('PDF enviado para a folha de compartilhar.');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') {
        // Usuário fechou a folha — não é falha.
        return;
      }
      markPdfShareFailed();
      toast.error(err instanceof Error ? err.message : 'Não foi possível compartilhar o PDF.');
    } finally {
      setBusy(false);
    }
  };

  const onRetryDownload = () => {
    if (!state.bytes) return;
    try {
      downloadPdfFile(state.bytes, state.filename);
      toast('Se o arquivo não aparecer em Downloads, use Compartilhar → Salvar em Arquivos.', {
        duration: 8_000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao tentar baixar.');
      setSafariConfirm(true);
    }
  };

  const onSafari = async () => {
    if (!state.safariUrl) {
      toast.error('Link do PDF indisponível. Gere o arquivo de novo.');
      setSafariConfirm(false);
      return;
    }
    setSafariConfirm(false);
    try {
      await openPdfInSafari(state.safariUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível abrir no Safari.');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-modal flex items-end justify-center bg-black/80 p-4 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-delivery-title"
        onClick={(e) => {
          if (e.target === e.currentTarget && state.phase !== 'generating') {
            closePdfDelivery();
          }
        }}
      >
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Squad Shoes
              </p>
              <h2 id="pdf-delivery-title" className="font-display text-2xl uppercase leading-none tracking-wide text-foreground">
                {state.title}
              </h2>
            </div>
            {state.phase !== 'generating' && (
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="Fechar"
                onClick={() => closePdfDelivery()}
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {state.phase === 'generating' && (
            <div className="space-y-4 py-2 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden />
              <p className="text-sm text-foreground">{pdfDeliveryStageText(state.stage)}</p>
              <p className="text-xs text-muted-foreground">Não feche o app enquanto gera.</p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => cancelPdfDelivery()}
              >
                Cancelar
              </Button>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{state.error || 'Não foi possível gerar o PDF.'}</p>
              <Button type="button" className="w-full" onClick={() => closePdfDelivery()}>
                Concluído
              </Button>
            </div>
          )}

          {state.phase === 'ready' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                O arquivo está pronto. Compartilhe ou salve pela folha do iPhone.
              </p>
              <Button
                type="button"
                className="w-full gap-2"
                data-dialog-primary="true"
                disabled={busy || !state.bytes}
                onClick={() => void onShare()}
              >
                <ShareNetwork className="h-4 w-4" />
                Compartilhar ou salvar
              </Button>
              {state.shareFailed && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    disabled={!state.bytes}
                    onClick={onRetryDownload}
                  >
                    <DownloadSimple className="h-4 w-4" />
                    Tentar baixar de novo
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setSafariConfirm(true)}
                  >
                    Abrir no Safari…
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => closePdfDelivery()}
              >
                Concluído
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={safariConfirm} onOpenChange={setSafariConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir no Safari?</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos abrir o PDF fora do app, no Safari, onde o compartilhar nativo
              costuma funcionar. Você sai do app por um momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onSafari()}>
              Abrir no Safari
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
