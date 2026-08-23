/**
 * Deslocamento oficial do CODE128 na etiqueta Baby / cliente.
 *
 * Medida física: 6,8 mm à esquerda × 9,8 mm à direita.
 * +1,5 mm para a direita centraliza. Vale em L42PRO e gráfica.
 */

export const BARCODE_CENTER_SHIFT_MM = 1.5;

export function barcodeOriginXMm(
  artOriginXMm: number,
  artWidthMm: number,
  barcodeWidthMm: number,
  shiftMm = BARCODE_CENTER_SHIFT_MM,
): number {
  return artOriginXMm + (artWidthMm - barcodeWidthMm) / 2 + shiftMm;
}

export function barcodeQuietZonesMm(
  artWidthMm: number,
  barcodeWidthMm: number,
  shiftMm = BARCODE_CENTER_SHIFT_MM,
): { leftMm: number; rightMm: number } {
  const centered = (artWidthMm - barcodeWidthMm) / 2;
  return {
    leftMm: centered + shiftMm,
    rightMm: centered - shiftMm,
  };
}
