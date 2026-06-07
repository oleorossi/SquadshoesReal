/**
 * Regra ÚNICA de "pares por volume/caixa" — fonte de verdade do frontend,
 * espelhando EXATAMENTE a função SQL `compute_sale_order_nfe_volumes` (a que
 * a NF-e usa). Antes cada superfície (form do PV, expedição, débito, sugestão
 * de embalagem) tinha seu próprio default — geralmente 1 par/caixa — e divergia
 * da NF, que já aplica `COALESCE(pairs_per_box_default, 12)` no servidor.
 *
 * Regra (igual à NF):
 *   - modos `individual_fitilho` / `individual_amarrado` → cada PAR = 1 volume.
 *   - modos `colmeia` / `individual_master` (caixa coletiva) → `pairs_per_box`
 *     cadastrado se > 0, senão DEFAULT 12.
 *   - `individual` puro → idem (default 12 quando não há caixa cadastrada,
 *     como o COALESCE da função SQL).
 *
 * O valor cadastrado (product_groups.pairs_per_box_<tipo> ou
 * packaging_configs.pairs_per_box ou box_types.pairs_per_box_default), quando
 * > 0, SEMPRE prevalece sobre o default.
 */

export const DEFAULT_PAIRS_PER_BOX = 12;

export type CollectiveType = 'individual' | 'master' | 'colmeia' | 'fitilho';

/** Modos em que cada par vira 1 volume (sem agrupamento em caixa coletiva). */
export function isPairAsVolumeMode(mode: string | null | undefined): boolean {
  return mode === 'individual_fitilho' || mode === 'individual_amarrado';
}

/** Tipo de caixa coletiva correspondente ao modo do PV (p/ ler pairs_per_box_<tipo>). */
export function collectiveTypeForMode(mode: string | null | undefined): CollectiveType {
  if (mode === 'colmeia') return 'colmeia';
  if (mode === 'individual_master') return 'master';
  if (mode === 'individual_fitilho') return 'fitilho';
  return 'individual';
}

/**
 * Pares por volume para um modo, considerando o valor cadastrado (> 0 prevalece).
 * Fitilho/amarrado retornam 1 (cada par = 1 volume).
 */
export function pairsPerVolumeForMode(mode: string | null | undefined, cadastrado?: number | null): number {
  if (isPairAsVolumeMode(mode)) return 1;
  return cadastrado && cadastrado > 0 ? cadastrado : DEFAULT_PAIRS_PER_BOX;
}

/**
 * Pares por caixa para um TIPO de embalagem (individual/master/colmeia/fitilho),
 * com valor cadastrado prevalecendo. Espelha o COALESCE(...,12) da NF para os
 * tipos coletivos; `individual` mantém default 12 (igual à função SQL).
 */
export function pairsPerBoxForType(type: CollectiveType, cadastrado?: number | null): number {
  return cadastrado && cadastrado > 0 ? cadastrado : DEFAULT_PAIRS_PER_BOX;
}

/**
 * Número de volumes (caixas) para uma quantidade de pares — idêntico à NF:
 * fitilho/amarrado = nº de pares; coletiva = CEIL(pares / pares_por_caixa).
 */
export function volumesForPairs(mode: string | null | undefined, pairs: number, cadastrado?: number | null): number {
  if (pairs <= 0) return 0;
  const ppb = pairsPerVolumeForMode(mode, cadastrado);
  return Math.ceil(pairs / Math.max(ppb, 1));
}
