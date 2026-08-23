/**
 * Etiqueta de caixa do cliente.
 *
 * A arte e o CODE128 seguem o padrão fixo do cliente. A geometria do liner do
 * couchê (vão e margens) é um perfil separado, pois muda conforme a faca da
 * gráfica e não pode ser deduzida por fotografia.
 * Milhares de pares são etiquetados por pedido — erro aqui custa caro.
 *
 * Entrada: o arquivo de exportação do pedido de compra do ERP do cliente
 * (`Exp_Etiquetas_PedCompra_*.csv`, `;` em UTF-16/UTF-8/CP1252, ou XLSX).
 * Saídas:
 *   - produção L42PRO: duas etiquetas 50 × 30 mm por carreira, repetidas pela quantidade;
 *   - gráfica: duas artes 50 × 30 mm lado a lado, uma por SKU (vão extra só se a faca pedir).
 */
import { code128Bars, encodeCode128 } from './code128';

/* ─────────────────────── medidas oficiais (mm) ─────────────────────── */

/** Arte da etiqueta — o desenho em si. */
export const ART_WIDTH_MM = 46.0;
export const ART_HEIGHT_MM = 38.0;

/** Mídia física: o rolo comprado é 50 × 40; a arte fica centralizada nela. */
export const MEDIA_WIDTH_MM = 50.0;
export const MEDIA_HEIGHT_MM = 40.0;
export const OFFSET_X_MM = (MEDIA_WIDTH_MM - ART_WIDTH_MM) / 2; // 2,0
export const OFFSET_Y_MM = (MEDIA_HEIGHT_MM - ART_HEIGHT_MM) / 2; // 1,0

/** Imposição da gráfica: duas etiquetas couchê de 50 × 30 mm por carreira. */
export const COUCHE_LABEL_WIDTH_MM = 50.0;
export const COUCHE_LABEL_HEIGHT_MM = 30.0;
export const COUCHE_COLUMNS = 2;

/**
 * Medidas variáveis da faca/liner. O perfil padrão casa com o papel
 * "2x50x30mm" / "100x30" do driver Elgin L42PRO. A tela deixa o vão e as
 * margens explícitos caso a faca da gráfica peça outra medida.
 */
export interface CoucheRollProfile {
  columnGapMm: number;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
}

export const DEFAULT_COUCHE_ROLL_PROFILE: Readonly<CoucheRollProfile> = Object.freeze({
  // Vão 0 → página 100 × 30 mm. 103 × 30 (vão 3) não existe no driver e o macOS cai em A4.
  columnGapMm: 0,
  leftMarginMm: 0,
  rightMarginMm: 0,
  topMarginMm: 0,
  bottomMarginMm: 0,
});
