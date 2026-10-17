import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';

/**
 * Custo efetivo da linha do kit de materiais base para o TOTAL ATIVO.
 *
 * Aceita rascunho local com vírgula pt-BR. `Number("3,45")` é NaN e virava 0 —
 * linhas novas digitadas com vírgula sumiam da soma (Rasteirinha, 2026-10).
 */
export function kitItemEffectiveCost(
  item: { cost_per_pair?: number | null; is_active?: boolean | null },
  draft?: { cost?: string; active?: boolean } | null,
): number {
  const active = draft?.active ?? item.is_active !== false;
  if (!active) return 0;
  if (draft?.cost != null) return parseBrlNumberNonNeg(draft.cost);
  return parseBrlNumberNonNeg(item.cost_per_pair);
}
