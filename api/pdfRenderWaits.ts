/**
 * Decide quais esperas o Chromium de impressão precisa fazer.
 *
 * Espelho de `src/lib/pdfRenderWaits.ts`. Fica nesta pasta porque importar
 * `src/` no handler da Vercel derrubou a função no carregamento do módulo.
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
