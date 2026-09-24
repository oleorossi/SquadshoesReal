/**
 * Escolha de colmeia pela Σgrade (pares por ficha) — espelho TS da função SQL
 * `resolve_colmeia_by_grade` (dono, 24/09/2026).
 *
 * Match EXATO de `pairs_per_box_default` no catálogo ativo de colmeias.
 * Se o pin do solado estiver entre os matches, preferir o pin; senão, primeira
 * ativa por nome. Sem match → pin do solado (capacidade/caixa herdadas).
 */

export type ColmeiaCatalogBox = {
  id: string;
  nome: string;
  pairs_per_box_default?: number | null;
  active?: boolean | null;
  tipo?: string | null;
};

export type ResolveColmeiaByGradeResult = {
  boxTypeId: string | null;
  pairsPerBox: number;
  source: 'grade_catalog' | 'sole_pin' | 'fallback';
  matchedName?: string;
};

const DEFAULT_PAIRS = 12;

export function resolveColmeiaByGrade(params: {
  gradePairsPerSheet: number;
  solePinBoxId?: string | null;
  solePinPairs?: number | null;
  catalog: ColmeiaCatalogBox[];
}): ResolveColmeiaByGradeResult {
  const grade = Math.round(Number(params.gradePairsPerSheet) || 0);
  const solePinId = params.solePinBoxId || null;
  const solePinPairs = Number(params.solePinPairs) || 0;

  const activeColmeias = (params.catalog || []).filter((b) => {
    if (!b?.id) return false;
    if (b.active === false) return false;
    const tipo = (b.tipo || '').toLowerCase();
    // Catálogo já filtrado pelos callers costuma vir só com colmeia; aceita
    // omissão de tipo e rejeita tipos claramente outros.
    if (tipo && tipo !== 'colmeia' && !tipo.includes('colme')) return false;
    return Number(b.pairs_per_box_default) > 0;
  });

  if (grade > 0) {
    const matches = activeColmeias
      .filter((b) => Number(b.pairs_per_box_default) === grade)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    if (matches.length > 0) {
      const preferred = solePinId
        ? matches.find((b) => b.id === solePinId)
        : undefined;
      const winner = preferred || matches[0];
      return {
        boxTypeId: winner.id,
        pairsPerBox: Math.max(1, Number(winner.pairs_per_box_default) || grade),
        source: 'grade_catalog',
        matchedName: winner.nome,
      };
    }
  }

  if (solePinId || solePinPairs > 0) {
    const pinned = solePinId
      ? activeColmeias.find((b) => b.id === solePinId)
      : undefined;
    const pairs = solePinPairs > 0
      ? solePinPairs
      : Number(pinned?.pairs_per_box_default) || DEFAULT_PAIRS;
    return {
      boxTypeId: solePinId,
      pairsPerBox: Math.max(1, pairs),
      source: 'sole_pin',
      matchedName: pinned?.nome,
    };
  }

  return {
    boxTypeId: null,
    pairsPerBox: DEFAULT_PAIRS,
    source: 'fallback',
  };
}
