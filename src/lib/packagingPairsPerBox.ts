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

/**
 * Caixa é uma unidade física indivisível. O BOM guarda fração por par
 * (ex.: 0,083 caixa/par), mas demanda, separação e compra precisam arredondar
 * CADA item/OP para cima antes de consolidar — a mesma regra de
 * `plan_packaging_for_order` e `compute_sale_order_box_breakdown` no banco.
 *
 * Fitilho e outros insumos lineares classificados em Embalagem continuam em
 * metros e NÃO passam por este arredondamento.
 */
export function wholePackagingDemand(quantity: number, unit: string | null | undefined): number {
  const normalizedUnit = (unit || '').toLowerCase().trim();
  if (!['un', 'par', 'placa'].includes(normalizedUnit)) return quantity;
  if (!(quantity > 0)) return 0;
  return Math.ceil(quantity - Number.EPSILON);
}

/**
 * Detecta o TIPO de caixa coletiva pelo NOME do produto de embalagem.
 * Ex.: "CAIXA COLMEIA 11" → 'colmeia', "CAIXA INDIVIDUAL 11" → 'individual'.
 * `null` quando o nome não denota um tipo conhecido (não é caixa tipada).
 *
 * Usado pelo consumo de materiais: uma ficha pode listar VÁRIAS caixas no BOM
 * (colmeia + individual) como ALTERNATIVAS; o pedido escolhe uma via
 * `packaging_mode`. Sem isso o motor somava as duas no grupo "EMBALAGEM".
 */
export function caixaCollectiveTypeFromName(name: string | null | undefined): CollectiveType | null {
  const n = (name || '').toLowerCase();
  if (!n) return null;
  // colmeia/master/fitilho ANTES de individual (nomes como "individual master").
  if (n.includes('colmeia') || n.includes('colméia')) return 'colmeia';
  if (n.includes('master')) return 'master';
  if (n.includes('fitilho')) return 'fitilho';
  if (n.includes('individual')) return 'individual';
  return null;
}

/**
 * Decide se uma caixa de embalagem do BOM deve ser EXIBIDA no consumo, dado o
 * `packaging_mode` do pedido e os tipos de caixa presentes na MESMA ficha.
 *
 * Só filtra quando há **alternativas reais** (≥ 2 tipos distintos na ficha) E a
 * caixa do modo escolhido existe entre elas — aí mantém só a do modo e descarta
 * as outras. Em qualquer outro caso (sem modo, caixa única, modo sem caixa
 * cadastrada, ou caixa sem tipo reconhecível) NÃO filtra — degrada com elegância
 * pra não esconder embalagem por engano.
 */
export function shouldShowCaixaForMode(
  caixaName: string | null | undefined,
  packagingMode: string | null | undefined,
  presentTypes: Set<CollectiveType>,
): boolean {
  if (!packagingMode) return true;
  const target = collectiveTypeForMode(packagingMode);
  if (presentTypes.size < 2 || !presentTypes.has(target)) return true;
  const t = caixaCollectiveTypeFromName(caixaName);
  if (!t) return true; // caixa sem tipo reconhecível: mantém
  return t === target;
}
