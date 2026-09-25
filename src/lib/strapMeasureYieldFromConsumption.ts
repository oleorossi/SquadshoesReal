import type {
  ArtisanalStrapCatalog,
  ArtisanalStrapMeasure,
  ArtisanalStrapRecipe,
  StrapBaseGroupCandidate,
} from '@/hooks/useArtisanalStraps';

const norm = (value: string | null | undefined): string =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Localiza a medida do Hub a partir do id ou do rótulo da preview de consumo
 * ("5 mm", "TIRA OVERLOCK 5 mm", "CHATA 8MM"…).
 */
export function resolveStrapMeasureForYield(
  catalog: ArtisanalStrapCatalog | null | undefined,
  opts: { measureId?: string | null; measureName?: string | null },
): ArtisanalStrapMeasure | null {
  const measures = catalog?.measures || [];
  const types = catalog?.types || [];
  const byId = opts.measureId
    ? measures.find((measure) => measure.id === opts.measureId && measure.active !== false)
    : null;
  if (byId) return byId;

  const wanted = norm(opts.measureName);
  if (!wanted) return null;

  const scored = measures
    .filter((measure) => measure.active !== false)
    .map((measure) => {
      const type = types.find((entry) => entry.id === measure.strap_type_id);
      const display = norm(measure.display_name);
      const typeName = norm(type?.name);
      const combined = typeName ? `${typeName} ${display}` : display;
      let score = 0;
      if (display && display === wanted) score = 3;
      else if (combined && combined === wanted) score = 2;
      else if (combined && (combined.includes(wanted) || wanted.includes(combined))) score = 1;
      else if (display && (wanted.includes(display) || display.includes(wanted))) score = 1;
      return { measure, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.measure || null;
}

/** Receita ainda viva (não supersedida/arquivada) da medida × napa. */
export function isLiveStrapRecipe(recipe: ArtisanalStrapRecipe): boolean {
  const status = (recipe.status || '').toString();
  return status !== 'superseded' && status !== 'archived';
}

/**
 * Napas elegíveis que ainda NÃO têm receita viva para a medida — o writer
 * plural (`new_material_only`) recusa lote com base já cadastrada.
 */
export function strapBasesMissingRecipeForMeasure(
  catalog: ArtisanalStrapCatalog | null | undefined,
  candidates: StrapBaseGroupCandidate[],
  measureId: string,
): StrapBaseGroupCandidate[] {
  const taken = new Set(
    (catalog?.recipes || [])
      .filter((recipe) => recipe.measure_id === measureId && isLiveStrapRecipe(recipe))
      .map((recipe) => recipe.base_group_id),
  );
  return candidates.filter((candidate) => !taken.has(candidate.id));
}

/** Defaults de banda/rendimento a partir de receitas irmãs da mesma medida. */
export function siblingStrapRecipeDefaults(
  catalog: ArtisanalStrapCatalog | null | undefined,
  measureId: string,
): { cutBandWidthMm: number; confirmedYieldMPerM: number } {
  const siblings = (catalog?.recipes || [])
    .filter((recipe) => recipe.measure_id === measureId && isLiveStrapRecipe(recipe))
    .filter((recipe) => Number(recipe.confirmed_yield_m_per_m) > 0);

  if (siblings.length === 0) {
    return { cutBandWidthMm: 0, confirmedYieldMPerM: 0 };
  }

  const cutBands = siblings
    .map((recipe) => Number(recipe.cut_band_width_mm) || 0)
    .filter((value) => value > 0);
  const yields = siblings
    .map((recipe) => Number(recipe.confirmed_yield_m_per_m) || 0)
    .filter((value) => value > 0);

  // Moda simples: valor mais frequente (empate → o primeiro visto).
  const mode = (values: number[]): number => {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    let best = values[0];
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  return {
    cutBandWidthMm: cutBands.length > 0 ? mode(cutBands) : 0,
    confirmedYieldMPerM: yields.length > 0 ? mode(yields) : 0,
  };
}

export function theoreticalStrapYieldMPerM(
  usableWidthMm: number,
  cutBandWidthMm: number,
): number {
  if (!(usableWidthMm > 0) || !(cutBandWidthMm > 0)) return 0;
  return Math.floor(usableWidthMm / cutBandWidthMm);
}
