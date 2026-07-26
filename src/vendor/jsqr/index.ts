/**
 * jsQR 1.4.0 VENDORIZADO (npm `jsqr`, MIT — LICENSE ao lado).
 *
 * Por que não é dependência normal: o `bun add` não completa downloads atrás
 * do egress deste ambiente remoto (ConnectionClosed em tarball/manifest), e
 * editar bun.lock à mão quebraria o install da Vercel. O arquivo é o UMD
 * oficial de dist/, sem modificação.
 *
 * Uso: fallback do leitor de QR quando o BarcodeDetector nativo não existe
 * (iOS/WebKit — iPhone/iPad). SEMPRE importar lazy (`await import(...)`) pra
 * ficar num chunk próprio, fora do bundle de entrada.
 */
// O UMD detecta ambiente via `self` e registra window.jsQR (seguro em ESM).
import './jsQR.js';

interface JsQRResult {
  data: string;
}

type JsQRFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => JsQRResult | null;

export const jsQR: JsQRFn = (window as unknown as { jsQR: JsQRFn }).jsQR;
