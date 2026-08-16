import { normalizeColorKey } from '@/lib/materialConsumption';

export type SoleColorResolutionMode = 'fixed' | 'same_as_upper';

export interface SoleColorRule {
  cabedal_color: string;
  palmilha_color: string | null;
  is_default: boolean;
  resolution_mode?: SoleColorResolutionMode | null;
}

export interface SoleColorProduct {
  id: string;
  group_id?: string | null;
  color?: string | null;
  quantity?: number | null;
  active?: boolean | null;
}

export interface SoleColorDecision {
  targetColor: string | null;
  source: 'black' | 'exact' | 'default' | 'none';
  /** Quando true, a ausência da variante física deve falhar fechada. */
  locked: boolean;
}

/**
 * Regra industrial única de cor do solado.
 *
 * - Cabedal preto sempre exige solado preto, independentemente do cadastro.
 * - Uma regra pintável usa a própria cor do cabedal.
 * - Sem regra para outra cor, a cascata legada da ficha continua disponível.
 */
export function getSoleTargetColor(
  cabedalColor: string | null | undefined,
  rules: SoleColorRule[] | null | undefined,
): SoleColorDecision {
  const colorKey = normalizeColorKey(cabedalColor);
  if (!colorKey) return { targetColor: null, source: 'none', locked: false };

  if (colorKey === 'preto') {
    return { targetColor: 'Preto', source: 'black', locked: true };
  }

  const activeRules = rules || [];
  const exact = activeRules.find(
    rule => !rule.is_default && normalizeColorKey(rule.cabedal_color) === colorKey,
  );
  const selected = exact || activeRules.find(rule => rule.is_default);
  if (!selected) return { targetColor: null, source: 'none', locked: false };

  const mode = selected.resolution_mode || 'fixed';
  const targetColor = mode === 'same_as_upper'
    ? String(cabedalColor || '').trim()
    : String(selected.palmilha_color || '').trim();

  return {
    targetColor: targetColor || null,
    source: exact ? 'exact' : 'default',
    locked: true,
  };
}

export function findSoleProductForColor(
  soleGroupId: string,
  targetColor: string,
  products: SoleColorProduct[],
): string | null {
  const targetKey = normalizeColorKey(targetColor);
  const candidate = products
    .filter(product => product.group_id === soleGroupId
      && product.active !== false
      && normalizeColorKey(product.color) === targetKey)
    .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0)
      || String(a.id).localeCompare(String(b.id)))[0];
  return candidate?.id || null;
}

/**
 * Um pin de variante escolhe o MODELO/grupo do solado, não pode furar a regra
 * de cor. Se preto/regra fixa/pintável se aplicar e a variante física não
 * existir no grupo, retorna null para impedir baixa ou compra da cor errada.
 */
export function resolvePinnedSoleProductIdByColor(
  pinnedProductId: string | null | undefined,
  cabedalColor: string | null | undefined,
  rulesByGroup: Map<string, SoleColorRule[]>,
  products: SoleColorProduct[],
): string | null {
  if (!pinnedProductId) return null;
  const pinned = products.find(product => product.id === pinnedProductId && product.active !== false);
  if (!pinned?.group_id) return pinned?.id || null;

  const decision = getSoleTargetColor(cabedalColor, rulesByGroup.get(pinned.group_id));
  if (!decision.locked) return pinned.id;
  if (!decision.targetColor) return null;
  return findSoleProductForColor(pinned.group_id, decision.targetColor, products);
}
