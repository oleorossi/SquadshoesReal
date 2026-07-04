/**
 * Fonte ÚNICA de normalização de unidade de produto.
 *
 * Consolida os normalizadores que viviam divergentes em dois editores:
 *  - `ProductFormDialog.normalizeUnit` (canônico: 'metros' → 'm')
 *  - `ProductDetail.normalizeProductionUnit` (BUG: devolvia 'metros', fora do
 *    enum canônico UNITS — ver CLAUDE.md "Unidades de medida — lista CANÔNICA").
 *
 * Regra: a unidade de PRODUÇÃO/ESTOQUE de um produto é sempre uma unidade-base
 * canônica de `UNITS`. Grafias legadas ('metro', 'metros', 'mtl', 'm2', 'gr'…)
 * são normalizadas aqui e em NENHUM outro lugar. Nunca reintroduzir 'metros'.
 */
import { UNITS, UNIT_LABELS } from '@/types/inventory';

export { UNITS, UNIT_LABELS };

/** Unidades de compra oferecidas no dropdown (pode diferir da unidade-base). */
export const PURCHASE_UNITS = ['m', 'm²', 'dm²', 'placa', 'kg', 'un', 'rolo', 'cx'] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

/** Unidades de produção/estoque oferecidas no dropdown — TODAS canônicas de UNITS.
 *  Cobre o conjunto canônico completo pra NÃO coeragir unidades válidas (kg, cx,
 *  cm, L…) a 'un' no save (antes a lista era curta e engolia 'kg'). Substitui a
 *  lista divergente do ProductDetail que tinha 'metros' e 'gr'. */
export const PRODUCTION_UNITS = ['un', 'par', 'pc', 'cx', 'rolo', 'placa', 'm', 'cm', 'mm', 'dm²', 'm²', 'kg', 'g', 'L', 'ml'] as const;
export type ProductionUnit = (typeof PRODUCTION_UNITS)[number];

/**
 * Normaliza qualquer grafia de unidade para o canônico de `UNITS`.
 * 'metro'/'metros'/'mtl'/'mt'/'mts'/'m linear' → 'm' (NUNCA 'metros').
 */
export const normalizeUnit = (value?: string | null): string => {
  if (!value) return 'un';
  const v = value.trim().toLowerCase();
  // 'mtl' = sigla SEFAZ pra metro linear na NF-e; variantes PT também viram 'm'.
  if (v === 'metro' || v === 'metros' || v === 'm linear' || v === 'mtl' || v === 'mt' || v === 'mts') return 'm';
  if (v === 'm2') return 'm²';
  if (v === 'dm2') return 'dm²';
  if (v === 'cm2') return 'cm²';
  if (v === 'unidade' || v === 'unid' || v === 'und') return 'un';
  if (v === 'grama' || v === 'gramas' || v === 'gr') return 'g';
  if (v === 'litro' || v === 'litros' || v === 'lt') return 'L';
  if (v === 'chapa') return 'placa';
  return (UNITS as readonly string[]).includes(v) ? v : value.trim();
};

/** Normaliza a unidade de COMPRA para uma das `PURCHASE_UNITS` (fallback 'un'). */
export const normalizePurchaseUnit = (value?: string | null): PurchaseUnit => {
  const n = normalizeUnit(value);
  return (PURCHASE_UNITS as readonly string[]).includes(n) ? (n as PurchaseUnit) : 'un';
};

/**
 * Normaliza a unidade de PRODUÇÃO/ESTOQUE para uma das `PRODUCTION_UNITS`
 * (todas canônicas; fallback 'un'). Diferente do normalizador antigo do
 * ProductDetail, JAMAIS devolve 'metros' — 'metro'/'metros' viram 'm'.
 */
export const normalizeProductionUnit = (value?: string | null): ProductionUnit => {
  const n = normalizeUnit(value);
  return (PRODUCTION_UNITS as readonly string[]).includes(n) ? (n as ProductionUnit) : 'un';
};
