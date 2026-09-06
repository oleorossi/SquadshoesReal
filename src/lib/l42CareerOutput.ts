/** PNG 203 dpi da carreira 2 × 50 × 30 mm para o Gerenciador L42DT Full. */
import {
  ART_WIDTH_MM,
  COUCHE_COLUMNS,
  COUCHE_LABEL_WIDTH_MM,
  COUCHE_OFFSET_X_MM,
  COUCHE_OFFSET_Y_MM,
  COUCHE_BARCODE_TOP_Y_MM,
  LAYOUT,
  MIN_FONT_PT,
  MODULE_MM,
  assertBarcodeFits,
  resolveCoucheRollGeometry,
  type BabyNalinPdfOptions,
  type BabyNalinRow,
  type CoucheRollGeometry,
} from './babyNalinLabels';
import { code128Bars } from './code128';

export const L42_NATIVE_DPI = 203;

export function l42MmToDots(mm: number, dpi = L42_NATIVE_DPI): number {
  return Math.round((mm * dpi) / 25.4);
}

export function l42PageDots(
  geometry: CoucheRollGeometry = resolveCoucheRollGeometry(),
): { widthDots: number; heightDots: number } {
  return {
    widthDots: l42MmToDots(geometry.pageWidthMm),
    heightDots: l42MmToDots(geometry.pageHeightMm),
  };
}

export function l42ImageFilename(origem: string, pageIndex = 0): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `L42PRO_${base || 'pedido'}_carreira_${String(pageIndex + 1).padStart(3, '0')}.png`;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function mmToCanvasPx(mm: number, pageMm: number, pagePx: number): number {
  return (mm / pageMm) * pagePx;
}

export async function rasterizeCoucheCareerPng(
  rowsOnCareer: BabyNalinRow[],
  options: Pick<BabyNalinPdfOptions, 'logo' | 'coucheProfile'> = {},
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  if (rowsOnCareer.length === 0) return null;

  const geometry = resolveCoucheRollGeometry(options.coucheProfile);
  const { widthDots, heightDots } = l42PageDots(geometry);
  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = heightDots;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  const xPx = (mm: number) => mmToCanvasPx(mm, geometry.pageWidthMm, widthDots);
  const yPx = (mm: number) => mmToCanvasPx(mm, geometry.pageHeightMm, heightDots);

  for (let index = 0; index < Math.min(COUCHE_COLUMNS, rowsOnCareer.length); index += 1) {
    const row = rowsOnCareer[index];
    const ox = geometry.leftMarginMm + index * (COUCHE_LABEL_WIDTH_MM + geometry.columnGapMm) + COUCHE_OFFSET_X_MM;
    const oy = geometry.topMarginMm + COUCHE_OFFSET_Y_MM;

    if (options.logo && options.logo.width > 0 && options.logo.height > 0) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('logo'));
          el.src = options.logo!.dataUrl;
        });
        const escala = Math.min(LAYOUT.logo.box / options.logo.width, LAYOUT.logo.box / options.logo.height);
        ctx.drawImage(
          img,
          xPx(ox + LAYOUT.logo.x),
          yPx(oy + LAYOUT.logo.y),
          xPx(options.logo.width * escala) - xPx(0),
          yPx(options.logo.height * escala) - yPx(0),
        );
      } catch {
        /* logo opcional */
      }
    }

    const larguraTextoMm = ART_WIDTH_MM - LAYOUT.rightMarginMm - LAYOUT.textX;
    const linhas = [`TAM ${row.tamanho}`, row.cor, `Ref: ${row.referencia}`];
    linhas.forEach((linha, i) => {
      let pt = LAYOUT.textPt;
      ctx.font = `${pt}pt Helvetica, Arial, sans-serif`;
      while (pt > MIN_FONT_PT && ctx.measureText(linha).width > xPx(larguraTextoMm) - xPx(0)) {
        pt -= 1;
        ctx.font = `${pt}pt Helvetica, Arial, sans-serif`;
      }
      let texto = linha;
      if (ctx.measureText(texto).width > xPx(larguraTextoMm) - xPx(0)) {
        while (texto.length > 1 && ctx.measureText(`${texto}…`).width > xPx(larguraTextoMm) - xPx(0)) {
          texto = texto.slice(0, -1);
        }
        texto = `${texto.trimEnd()}…`;
        ctx.font = `${MIN_FONT_PT}pt Helvetica, Arial, sans-serif`;
      }
      ctx.fillText(texto, xPx(ox + LAYOUT.textX), yPx(oy + LAYOUT.textLinesY[i]));
    });

    ctx.font = `${LAYOUT.productCode.pt}pt Helvetica, Arial, sans-serif`;
    ctx.fillText(row.codProduto, xPx(ox + LAYOUT.productCode.x), yPx(oy + LAYOUT.productCode.y));

    const fit = assertBarcodeFits(row.codigoBarra);
    const x0 = ox + (ART_WIDTH_MM - fit.widthMm) / 2;
    const y0 = oy + COUCHE_BARCODE_TOP_Y_MM;
    for (const barra of code128Bars(row.codigoBarra)) {
      ctx.fillRect(
        xPx(x0 + barra.start * MODULE_MM),
        yPx(y0),
        Math.max(1, xPx(barra.width * MODULE_MM) - xPx(0)),
        Math.max(1, yPx(LAYOUT.barcode.heightMm) - yPx(0)),
      );
    }
  }

  return canvas.toDataURL('image/png');
}
