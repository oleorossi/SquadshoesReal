import { useEffect, useRef, useState } from 'react';
import {
  AdaptiveDialog,
  AdaptiveDialogContent,
  AdaptiveDialogHeader,
  AdaptiveDialogTitle,
} from '@/components/ui/adaptive-dialog';
import { haptic } from '@/lib/haptic';
import { QrCode, Warning as AlertTriangle } from '@phosphor-icons/react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Payload cru do QR (ex.: "PV-00141,PV-00142" da ficha de operador). */
  onDetect: (raw: string) => void;
}

type JsQRFn = typeof import('@/vendor/jsqr').jsQR;

/**
 * Leitor de QR pela câmera do dispositivo. As fichas de operador imprimem
 * o(s) PV(s) no QR do WorksheetHeader — bipar joga direto na busca da Central.
 *
 * Dois motores, na ordem:
 * 1. BarcodeDetector nativo (Chrome/Edge/Android) — rápido, zero custo de JS.
 * 2. jsQR vendorizado (iOS/WebKit não expõe BarcodeDetector — justamente o
 *    iPhone/iPad da fábrica): decodifica frames reduzidos via canvas. Import
 *    lazy: só baixa o chunk quando o diálogo abre SEM detector nativo.
 * Sem câmera/permissão: orienta usar o leitor físico USB/Bluetooth, que
 * digita o conteúdo na busca como teclado.
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
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    (async () => {
      const Detector = (window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> };
      }).BarcodeDetector;
      let detector: { detect(v: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> } | null = null;
      if (Detector) {
        try { detector = new Detector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      let jsqr: JsQRFn | null = null;
      if (!detector) {
        try {
          jsqr = (await import('@/vendor/jsqr')).jsQR;
        } catch {
          setError('nosupport'); // chunk não carregou (offline?) e sem detector nativo
          return;
        }
      }
      if (cancelled) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
            let raw: string | null = null;
            if (detector) {
              const codes = await detector.detect(videoRef.current);
              raw = codes?.[0]?.rawValue || null;
            } else if (jsqr) {
              const v = videoRef.current;
              if (!v.videoWidth) return; // 1º frame ainda não chegou
              if (!canvas) {
                canvas = document.createElement('canvas');
                ctx = canvas.getContext('2d', { willReadFrequently: true });
              }
              if (!ctx) return;
              // Frame reduzido (~480px): jsQR em resolução cheia trava iPhone antigo
              const w = 480;
              const h = Math.round(v.videoHeight * (w / v.videoWidth)) || 360;
              canvas.width = w; canvas.height = h;
              ctx.drawImage(v, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              raw = jsqr(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data || null;
            }
            if (raw) {
              firedRef.current = true;
              haptic(25);
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
    <AdaptiveDialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <AdaptiveDialogContent className="sm:max-w-lg h-[92dvh] max-h-[92dvh] flex flex-col">
        <AdaptiveDialogHeader>
          <AdaptiveDialogTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-5 w-5" /> Bipar QR da ficha
          </AdaptiveDialogTitle>
        </AdaptiveDialogHeader>
        {error ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              {error === 'nosupport'
                ? 'Não deu pra carregar o leitor de QR — verifique a conexão e tente de novo.'
                : 'Não foi possível acessar a câmera — verifique a permissão do navegador.'}
              <p className="mt-1 text-muted-foreground">
                Alternativa: leitor físico (USB/Bluetooth) bipando com o cursor na busca — o conteúdo do QR entra como digitação.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            </div>
            <p className="text-xs text-muted-foreground">
              Aponte pro QR no canto da ficha de operador — a OP aparece destacada no quadro na hora.
            </p>
          </>
        )}
      </AdaptiveDialogContent>
    </AdaptiveDialog>
  );
}
