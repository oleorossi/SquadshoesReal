import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapIdentity,
  type TechnicalStrapLineLike,
  type TechnicalStrapMeasureLike,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis, type StrapIdentityBasis } from '@/lib/strapIdentity';

export interface TechnicalStrapSourceCatalog {
  types: readonly { id: string; active?: boolean | null }[];
  measures: readonly TechnicalStrapMeasureLike[];
  variants: readonly {
    measure_id: string;
    base_group_id: string;
    identity_basis?: StrapIdentityBasis | null;
    internal_production_enabled?: boolean | null;
    finished_product_id?: string | null;
    status: string;
  }[];
  recipes: readonly { measure_id: string; status: string; valid_from?: string | null; valid_to?: string | null }[];
  products: readonly { id: string; group_id?: string | null; active?: boolean | null; unit?: string | null }[];
  groups: readonly { id: string; name: string }[];
}

export interface TechnicalStrapSourcePolicy {
  loaded: boolean;
  allowsReferenceBase: boolean;
  finishedGroups: Array<{ id: string; name: string }>;
}

/** A medida, seus cadastros produtivos e os UUIDs definem as origens possíveis. */
export function technicalStrapSourcePolicy(
  catalog: TechnicalStrapSourceCatalog | null | undefined,
  measureId: string | null | undefined,
  now: number = Date.now(),
): TechnicalStrapSourcePolicy {
  const unavailable = { loaded: !!catalog, allowsReferenceBase: false, finishedGroups: [] };
  if (!catalog) return unavailable;
  const measure = catalog.measures.find(entry => entry.id === measureId && entry.active !== false);
  if (!measure || !catalog.types.some(type => type.id === measure.strap_type_id && type.active !== false)) return unavailable;
  const activeVariants = catalog.variants.filter(variant => variant.measure_id === measure.id && variant.status === 'active');
  const allowsReferenceBase = activeVariants.some(variant => (
    strapIdentityBasis(variant) === 'reference_base' && variant.internal_production_enabled === true
  )) || catalog.recipes.some(recipe => recipe.measure_id === measure.id && recipe.status === 'approved'
    && recipe.valid_from != null && Date.parse(recipe.valid_from) <= now
    && (recipe.valid_to == null || Date.parse(recipe.valid_to) > now));
  const finishedGroupIds = new Set(activeVariants
    .filter(variant => variant.identity_basis === 'finished_product_group'
      && catalog.products.some(product => product.id === variant.finished_product_id
        && product.group_id === variant.base_group_id && product.active !== false && product.unit === 'm'))
    .map(variant => variant.base_group_id));
  return {
    loaded: true,
    allowsReferenceBase,
    finishedGroups: catalog.groups.filter(group => finishedGroupIds.has(group.id))
      .map(group => ({ id: group.id, name: group.name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
  };
}

export function isTechnicalStrapSourceAllowed(
  line: TechnicalStrapLineLike,
  policy: TechnicalStrapSourcePolicy,
): boolean {
  if (!policy.loaded) return false;
  return strapIdentityBasis(line) === 'reference_base'
    ? policy.allowsReferenceBase
    : policy.finishedGroups.some(group => group.id === line.identity_group_id);
}

/** Só a troca explícita de medida normaliza a origem; abrir ficha não a reescreve. */
export function applyTechnicalStrapMeasureWithSource<T extends TechnicalStrapLineLike>(
  line: T,
  measure: TechnicalStrapMeasureLike,
  catalog: TechnicalStrapSourceCatalog,
): T {
  const measured = applyCanonicalTechnicalStrapMeasure(line, measure);
  const policy = technicalStrapSourcePolicy(catalog, measure.id);
  const basis = strapIdentityBasis(line);
  const nextBasis = basis === 'reference_base' && policy.allowsReferenceBase
    ? 'reference_base'
    : basis === 'finished_product_group' && policy.finishedGroups.length > 0
      ? 'finished_product_group'
      : policy.allowsReferenceBase
        ? 'reference_base'
        : policy.finishedGroups.length > 0
          ? 'finished_product_group'
          : null;
  if (!nextBasis) return measured;
  const selectedGroup = policy.finishedGroups.find(group => group.id === line.identity_group_id);
  const groupId = nextBasis === 'finished_product_group'
    ? selectedGroup?.id || (policy.finishedGroups.length === 1 ? policy.finishedGroups[0].id : null)
    : null;
  return {
    ...applyTechnicalStrapIdentity(measured, nextBasis, groupId),
    internal_production_enabled: nextBasis === 'reference_base',
  };
}
