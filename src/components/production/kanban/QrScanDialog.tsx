import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QrCode, Warning as AlertTriangle } from '@phosphor-icons/react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Payload cru do QR (ex.: "PV-00141,PV-00142" da ficha de operador). */
  onDetect: (raw: string) => void;
}

/**
 * Leitor de QR pela câmera do dispositivo — BarcodeDetector nativo do browser
 * (Chrome/Edge/Android; sem dependência nova). As fichas de operador imprimem
 * o(s) PV(s) no QR do WorksheetHeader — bipar joga direto na busca da Central.
 * Sem suporte da API (Firefox/iOS antigo) ou sem câmera: orienta usar o leitor
 * físico USB, que digita o conteúdo na busca como teclado.
 */
export function QrScanDialog({ open, onClose, onDetect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<'nosupport' | 'camera' | null>(null);
  // Trava pós-leitura: o intervalo pode detectar o mesmo frame 2× antes do
  // diálogo desmontar — sem a trava, onDetect dispararia duplicado.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    firedRef.current = false;
    setError(null);
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      // BarcodeDetector ainda não está no lib.dom do TS — acesso dinâmico.
      const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (!Detector) { setError('nosupport'); return; }
      try {
        const detector = new Detector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = setInterval(async () => {
          if (firedRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue;
            if (raw) {
              firedRef.current = true;
              onDetect(raw);
            }
          } catch { /* frame ainda não pronto — tenta no próximo tick */ }
        }, 350);
      } catch {
        setError('camera');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-5 w-5" /> Bipar QR da ficha
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              {error === 'nosupport'
                ? 'Este navegador não tem leitor de QR embutido (use Chrome/Edge no computador ou Android).'
                : 'Não foi possível acessar a câmera — verifique a permissão do navegador.'}
              <p className="mt-1 text-muted-foreground">
                Alternativa: leitor físico (USB/Bluetooth) bipando com o cursor na busca — o conteúdo do QR entra como digitação.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-border bg-black">
              <video ref={videoRef} className="w-full aspect-square object-cover" muted playsInline />
            </div>
            <p className="text-xs text-muted-foreground">
              Aponte pro QR no canto da ficha de operador — a OP aparece destacada no quadro na hora.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
