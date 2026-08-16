/**
 * Compatibilidade read-only para relatórios legados de consumo.
 *
 * Produção, reserva e compra usam o resolvedor canônico por IDs no banco. Este
 * helper jamais herda nem escala rendimento: sem receita exata da própria base,
 * devolve `null` e mantém a linha bloqueada para saneamento.
 */
export type StrapBaseRecipe = {
  baseName: string;
  yieldPerMeter: number;
  baseGroupId?: string | null;
};

export type StrapYieldResolution = {
  yieldPerMeter: number;
};

const norm = (value: string | null | undefined): string =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export function resolveStrapYield(opts: {
  baseName?: string;
  baseGroupId?: string | null;
  recipes: StrapBaseRecipe[];
  /** Ignorado deliberadamente: largura não autoriza derivar outra receita. */
  rollWidthMm?: (baseName: string) => number;
}): StrapYieldResolution | null {
  const targetId = (opts.baseGroupId || '').trim();
  const targetName = norm(opts.baseName);
  if (!targetId && !targetName) return null;

  const exact = (opts.recipes || []).find((recipe) => {
    const validYield = Number(recipe.yieldPerMeter) > 0;
    if (!validYield) return false;
    if (targetId) return recipe.baseGroupId === targetId;
    return norm(recipe.baseName) === targetName;
  });

  return exact ? { yieldPerMeter: Number(exact.yieldPerMeter) } : null;
}
