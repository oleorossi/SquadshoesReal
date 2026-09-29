import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CaretLeft, CaretRight, DownloadSimple, FilePdf, Warning, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { buildThermalLabelsPdf, computeZplLayout } from '@/lib/printLabels';
import {
  openOrDownloadThermalLabelPdf,
  pdfFileNameForThermalLabels,
} from '@/lib/thermalLabelPdfDelivery';
import { monoToRgba, type MonoBitmap } from '@/lib/zplImage';
import { toast } from 'sonner';

export interface ZplPreviewLabel {
  refCode: string;
  refName: string;
  mainMaterial: string;
  color: string;
  size: string;
  barcode: string;
  imageName?: string;
}

/** Campos que o gerador de PDF precisa (foto por URL, não o mono do ZPL). */
export interface ThermalPdfSourceLabel {
  refCode: string;
  refName: string;
  mainMaterial: string;
  color: string;
  size: string;
  barcode: string;
  shoeCategory?: string;
  strapsLabel?: string;
  imageUrl?: string;
  imageIsFallback?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ZplPreviewLabel[];
  graphics: { name: string; mono: MonoBitmap }[];
  dimensions: { width: number; height: number };
  zpl: string;
  fileName: string;
  /** Fotos que não carregaram — a etiqueta sai sem imagem e isso precisa aparecer. */
  missingPhotos: string[];
  /**
   * Mesmas etiquetas com URL de foto — habilita "Abrir PDF" para o Windows
   * conseguir abrir o arquivo (ZPL puro não abre em leitor comum).
   */
  pdfSourceLabels?: ThermalPdfSourceLabel[];
}

/** Zoom de tela: 1 dot da impressora = ZOOM pixels, sem suavização. */
const ZOOM = 3;

/**
 * Prévia FIEL da etiqueta ZPL.
 *
 * A foto é desenhada a partir do MESMO `MonoBitmap` que o comando ~DG carrega
 * na impressora — os pontos na tela são os pontos que a agulha queima, sem
 * segunda conversão no meio.
 *
 * Depois de compor tudo, o canvas inteiro é limiarizado em 1 bit. Isso não
 * altera a foto (limiarizar algo que já é 1 bit é idempotente); serve pro TEXTO
 * aparecer sem antialiasing, como a térmica de fato imprime. Sem esse passo a
 * prévia mostraria bordas cinzas que o papel nunca terá.
 *
 * ⚠ O que a prévia NÃO reproduz exatamente: o desenho das LETRAS. O ZPL usa a
 * fonte interna A0 da impressora, que o navegador não tem. Posição, tamanho em
 * dots e ausência de cinza são fiéis; o traçado do glifo é o da fonte local.
 * A FOTO — que é o que se quer conferir aqui — é exata.
 */
export default function ZplPreviewDialog({
  open, onOpenChange, labels, graphics, dimensions, zpl, fileName, missingPhotos,
  pdfSourceLabels,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [index, setIndex] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => { if (open) setIndex(0); }, [open]);

  const paintLabel = useCallback(() => {
    const canvas = canvasRef.current;
    const label = labels[index];
    if (!canvas || !label || !open) return;

    const L = computeZplLayout(dimensions, graphics.length > 0);
    const work = document.createElement('canvas');
    work.width = L.W;
    work.height = L.H;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, L.W, L.H);

    // ── FOTO: os mesmos bits do ~DG ────────────────────────────────────────
    const graphic = label.imageName ? graphics.find(g => g.name === label.imageName) : undefined;
    if (graphic) {
      const rgba = monoToRgba(graphic.mono);
      const img = new ImageData(rgba.data, rgba.width, rgba.height);
      ctx.putImageData(img, L.photoX, L.photoY);
    }

    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    const font = (h: number) => `${h}px "Arial Narrow", Arial, sans-serif`;

    if (label.refName || label.refCode) {
      ctx.font = font(L.refFont);
      ctx.fillText(label.refName || label.refCode, L.infoX, L.rowY(0.04));
    }
    if (label.color) {
      ctx.font = font(L.colorFont);
      ctx.fillText(label.color, L.infoX, L.rowY(0.36));
    }
    if (label.mainMaterial) {
      ctx.font = font(L.matFont);
      ctx.fillText(label.mainMaterial, L.infoX, L.rowY(0.62));
    }

    // ── Caixa do número (^GB com espessura 2) ──────────────────────────────
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(L.sizeBoxX + 1, L.padY + 1, L.sizeBoxW - 2, L.sizeBoxH - 2);
    if (label.size) {
      ctx.font = font(L.sizeFont);
      ctx.fillText(label.size, L.sizeBoxX + 4, L.sizeCenterY);
    }

    /** Limiariza tudo em 1 bit e joga no canvas visível, sem suavização. */
    function paint() {
      const data = ctx!.getImageData(0, 0, L.W, L.H);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const v = lum < 128 ? 0 : 255;
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
      }
      ctx!.putImageData(data, 0, 0);

      canvas!.width = L.W * ZOOM;
      canvas!.height = L.H * ZOOM;
      const out = canvas!.getContext('2d');
      if (!out) return;
      out.imageSmoothingEnabled = false;
      out.drawImage(work, 0, 0, canvas!.width, canvas!.height);
    }

    // ── Código de barras ───────────────────────────────────────────────────
    if (label.barcode) {
      const bc = document.createElement('canvas');
      void import('jsbarcode').then(({ default: JsBarcode }) => {
        try {
          JsBarcode(bc, label.barcode, {
            format: 'CODE128', displayValue: true, fontSize: Math.round(L.innerH * 0.16),
            height: L.barcodeH - Math.round(L.innerH * 0.2), margin: 0, width: 1,
          });
          ctx.drawImage(bc, L.barcodeX, L.padY, L.W - L.padX - L.barcodeX, L.barcodeH);
        } catch { /* payload inválido pro CODE128 — a prévia sai sem barras */ }
        paint();
      }).catch(paint);
    } else {
      paint();
    }
  }, [open, index, labels, graphics, dimensions]);

  // O Dialog do Radix monta o conteúdo depois do open=true. Pintar só no
  // useEffect com ref clássica deixava o canvas null na 1ª passada e a prévia
  // ficava branca pra sempre (bug reportado 29/09/2026).
  const setCanvasNode = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (node) {
      requestAnimationFrame(() => paintLabel());
    }
  }, [paintLabel]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => paintLabel());
    return () => cancelAnimationFrame(id);
  }, [open, paintLabel]);

  const downloadZpl = () => {
    const blob = new Blob([zpl], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openPdf = async () => {
    if (!pdfSourceLabels?.length) {
      toast.error('PDF indisponível para este lote — use Etiqueta Individual.');
      return;
    }
    setPdfBusy(true);
    try {
      const blob = await buildThermalLabelsPdf(
        pdfSourceLabels,
        { width: dimensions.width, height: dimensions.height },
      );
      const name = pdfFileNameForThermalLabels();
      const how = await openOrDownloadThermalLabelPdf(blob, name);
      toast.success(
        how === 'opened'
          ? 'PDF aberto — confira, ajuste na impressora e imprima pelo navegador.'
          : `PDF baixado: ${name}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar o PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const label = labels[index];
  const sizeKb = Math.round(new Blob([zpl]).size / 1024);
  const canPdf = (pdfSourceLabels?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Prévia ZPL — {dimensions.width}×{dimensions.height} mm · 203 dpi</DialogTitle>
          <DialogDescription>
            A foto abaixo é desenhada a partir dos mesmos bits que vão para a impressora.
            O traçado das letras é aproximado (o ZPL usa a fonte interna da Elgin);
            posição, tamanho e o preto-e-branco sem cinza são fiéis.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{labels.length.toLocaleString('pt-BR')} etiquetas</Badge>
          <Badge variant="outline">{graphics.length} foto{graphics.length === 1 ? '' : 's'} distinta{graphics.length === 1 ? '' : 's'}</Badge>
          <Badge variant="outline">{sizeKb.toLocaleString('pt-BR')} KB</Badge>
        </div>

        {missingPhotos.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700">
            <Warning className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p className="text-xs">
              <strong>Sem foto:</strong> {missingPhotos.join(', ')}. Essas etiquetas saem só com
              texto e código de barras — a imagem não carregou.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center bg-muted/30 border border-border rounded-md p-4 overflow-x-auto min-h-[120px]">
          <canvas ref={setCanvasNode} className="border border-border shadow-sm bg-card" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" disabled={index === 0}
              onClick={() => setIndex(i => Math.max(0, i - 1))} aria-label="Etiqueta anterior">
              <CaretLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {index + 1} / {labels.length}
            </span>
            <Button variant="outline" size="sm" className="h-8" disabled={index >= labels.length - 1}
              onClick={() => setIndex(i => Math.min(labels.length - 1, i + 1))} aria-label="Próxima etiqueta">
              <CaretRight className="h-4 w-4" />
            </Button>
            {label && (
              <span className="text-xs text-muted-foreground truncate max-w-[260px]">
                {label.refName} · {label.color} · nº {label.size}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void openPdf()}
              className="gap-2 h-9"
              disabled={!canPdf || pdfBusy}
              title="Abre um PDF no navegador — dá pra conferir e mandar pra impressora pelo Windows"
            >
              {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePdf className="h-4 w-4" />}
              Abrir PDF
            </Button>
            <Button onClick={downloadZpl} variant="outline" className="gap-2 h-9"
              title="Arquivo bruto só para o Gerenciador de Impressora Elgin / DirectPrint">
              <DownloadSimple className="h-4 w-4" />
              Baixar {fileName}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground border-t border-border/60 pt-2">
          <strong>Para abrir e ajustar no Windows:</strong> use <strong>Abrir PDF</strong>.
          O arquivo <code className="font-mono">.zpl</code> não abre em leitor comum —
          ele só serve no <strong>Gerenciador de Impressora Elgin</strong> (ou DirectPrint).
        </p>
      </DialogContent>
    </Dialog>
  );
}
