/**
 * Etiqueta de caixa do cliente.
 *
 * Padrão próprio: 2 × 50 × 30 mm com 6 mm de vão (página 106 × 30). Não misturar
 * com a etiqueta térmica de caixa individual da Squad (100 × 30 mm, um avanço).
 */
import { code128Bars, encodeCode128 } from './code128';
import { barcodeOriginXMm as barcodeOriginXFromShift, barcodeQuietZonesMm as barcodeQuietZonesFromShift } from './babyBarcodeShift';
export { BARCODE_CENTER_SHIFT_MM } from './babyBarcodeShift';
