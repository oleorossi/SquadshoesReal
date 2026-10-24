/**
 * Tipos de classificação do solado (products.sole_classification).
 *
 * Palmilha Pronta Unicolor Padronizado = kit comprado (solado+palmilha+fibra),
 * sempre CARAMELO, sem coligação cabedal→palmilha, sem forração.
 */

export const SOLE_CLASSIFICATIONS = [
  'tradicional',
  'palmilha_pronta',
  'palmilha_pronta_unicolor_padronizado',
  'conjugado',
] as const;

export type SoleClassification = (typeof SOLE_CLASSIFICATIONS)[number];

export const UNICOLOR_SOLE_CLASSIFICATION =
  'palmilha_pronta_unicolor_padronizado' as const;

export const UNICOLOR_SOLE_LABEL = 'Palmilha Pronta Unicolor Padronizado';

/** Cor forçada pelo tipo unicolor (regra de produto). */
export const UNICOLOR_SOLE_COLOR = 'CARAMELO';

const READY_MADE = new Set<string>([
  'palmilha_pronta',
  UNICOLOR_SOLE_CLASSIFICATION,
]);

export function isSoleClassification(value: unknown): value is SoleClassification {
  return typeof value === 'string' && (SOLE_CLASSIFICATIONS as readonly string[]).includes(value);
}

/** Lê `sole_classification` de um produto/row sem forçar `any`. */
export function soleClassificationOf(product: unknown): unknown {
  if (!product || typeof product !== 'object') return undefined;
  if (!('sole_classification' in product)) return undefined;
  return Reflect.get(product, 'sole_classification');
}

/** Palmilha pronta clássica OU unicolor — pula corte de placa/forro de palmilha. */
export function isPalmilhaProntaClassification(value: unknown): boolean {
  return typeof value === 'string' && READY_MADE.has(value);
}

export function isUnicolorPadronizadoClassification(value: unknown): boolean {
  return value === UNICOLOR_SOLE_CLASSIFICATION;
}

/** Linhas do kit de precificação cobertas pelo kit físico do solado unicolor. */
export function isUnicolorCoveredKitDescription(description: unknown): boolean {
  const key = String(description || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (key === 'solado' || key.startsWith('solado ')) return true;
  if (key === 'placa fibra' || key === 'fibra' || key.startsWith('placa fibra')) return true;
  if (key === 'forracao' || key.startsWith('forracao')) return true;
  return false;
}

export function normalizeSoleColorKey(color: unknown): string {
  return String(color || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

export function isCarameloSoleColor(color: unknown): boolean {
  return normalizeSoleColorKey(color) === 'caramelo';
}
