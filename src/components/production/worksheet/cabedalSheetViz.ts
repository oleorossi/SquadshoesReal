/**
 * Visual refinado das fichas A4 de Corte Cabedal, Costura Cabedal e Aviamento
 * (pedido 2026-11-27, t145u): hierarquia tipográfica, linhas mais leves,
 * seções padronizadas e tabelas mais limpas — sem mudar conteúdo, selos F/T
 * ou o encaixe em 1 folha.
 *
 * Escopado nesses três setores. As outras fichas do SilkMontageWorkSheet
 * (Forração, Silk, Montagem…) permanecem no visual anterior.
 */

export const CABEDAL_VIZ_SECTORS = ['Corte Cabedal', 'Costura Cabedal', 'Aviamento'] as const;
export type CabedalVizSector = (typeof CABEDAL_VIZ_SECTORS)[number];

export function isCabedalVizSector(sector: string): sector is CabedalVizSector {
  return (CABEDAL_VIZ_SECTORS as readonly string[]).includes(sector);
}

/** Classe no PaginatedSheet — CSS + hook de teste. */
export const CABEDAL_VIZ_CLASS = 'ficha-viz-cabedal';

/**
 * Tokens P&B-safe (laser). Cinzas abaixo de ~#666 somem ou viram ruído;
 * fundos claros levam print-color-adjust: exact.
 */
export const CABEDAL_VIZ = {
  ink: '#000',
  muted: '#3a3a3a',
  rule: '1px solid #000',
  /** Separadores internos da tabela — visíveis, mais leves que o 1,5px do card. */
  hair: '1px solid #6e6e6e',
  card: '1px solid #000',
  photo: '1px solid #000',
  zebra: '#f2f0ec',
  head: '#efeee9',
  labelPx: 8,
  labelTracking: '0.10em',
} as const;

export const cabedalVizPrintColor = {
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact',
} as const;
