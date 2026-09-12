/**
 * Decide quais esperas o Chromium de impressão precisa fazer.
 *
 * A função serverless NÃO importa este arquivo (empacotar `src/` derrubou
 * `/api/render-pdf` no passado). O espelho vivo está em `api/pdfRenderWaits.ts`.
 * O contrato em `pdfRenderWaits.test.ts` trava os dois corpos iguais.
 */

const FONT_HOST = /(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/i;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>)\\]+/gi;
const TRACE_CODE = /id\s*=\s*["'](?:bc-|bx-|qr-ht-)/i;

export interface PdfRenderWaits {
  /** Fotos, CSS do app, CDN — qualquer URL que não seja fonte do Google. */
  waitForNetworkIdle: boolean;
  /** Hangtags/etiquetas marcam barcode e QR por id; sem isso o wait é no-op caro. */
  waitForTraceCodes: boolean;
}

export function inspectPdfHtml(html: string): PdfRenderWaits {
  const urls = html.match(ABSOLUTE_URL) || [];
  return {
    waitForNetworkIdle: urls.some((url) => !FONT_HOST.test(url)),
    waitForTraceCodes: TRACE_CODE.test(html),
  };
}
