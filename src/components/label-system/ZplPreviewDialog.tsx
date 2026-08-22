import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CaretLeft, CaretRight, DownloadSimple, Warning } from '@phosphor-icons/react';
import { computeZplLayout } from '@/lib/printLabels';
import { monoToRgba, type MonoBitmap } from '@/lib/zplImage';

export interface ZplPreviewLabel {
  refCode: string;
  refName: string;
  mainMaterial: string;
  color: string;
  size: string;
  barcode: string;
  imageName?: string;
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
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => { if (open) setIndex(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const label = labels[index];
    if (!canvas || !label) return;

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
  }, [open, index, labels, graphics, dimensions]);

  const download = () => {
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

  const label = labels[index];
  const sizeKb = Math.round(new Blob([zpl]).size / 1024);

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

        <div className="flex items-center justify-center bg-muted/30 border border-border rounded-md p-4 overflow-x-auto">
          <canvas ref={canvasRef} className="border border-border shadow-sm" />
        </div>

        <div className="flex items-center justify-between gap-3">
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
          <Button onClick={download} className="gap-2 h-9">
            <DownloadSimple className="h-4 w-4" />
            Baixar {fileName}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground border-t border-border/60 pt-2">
          Envie o arquivo pela <strong>Gerenciador de Impressora Elgin</strong> (ou qualquer
          utilitário que mande ZPL bruto). O navegador não consegue falar direto com a
          etiquetadora.
        </p>
      </DialogContent>
    </Dialog>
  );
}
