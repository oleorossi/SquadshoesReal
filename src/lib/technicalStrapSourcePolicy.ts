import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapIdentity,
  type TechnicalStrapLineLike,
  type TechnicalStrapMeasureLike,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis, type StrapIdentityBasis } from '@/lib/strapIdentity';
import { normalizeForSearch } from '@/lib/searchUtils';

export interface TechnicalStrapSourceCatalog {
  types: readonly { id: string; name?: string | null; active?: boolean | null }[];
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
  products: readonly {
    id: string;
    name?: string | null;
    group_id?: string | null;
    active?: boolean | null;
    unit?: string | null;
  }[];
  groups: readonly { id: string; name: string }[];
}

export interface TechnicalStrapSourcePolicy {
  loaded: boolean;
  allowsReferenceBase: boolean;
  finishedGroups: Array<{ id: string; name: string }>;
}

function widthLeafToken(widthMm: number): string {
  return `${Math.round(widthMm)}mm`;
}

/**
 * SKU acabado sem variante Hub (ELÁSTICO ESPECIAL G, Strass pós-45600):
 * o grupo-folha do estoque já carrega os metros. Casa família do tipo +
 * bitola da medida com SKUs lineares ativos cujo nome ainda cita a família.
 */
function buyReadyGroupsFromInventory(
  catalog: TechnicalStrapSourceCatalog,
  type: { id: string; name?: string | null },
  measure: TechnicalStrapMeasureLike,
): Array<{ id: string; name: string }> {
  if (measure.origem_padrao !== 'sempre_sku_acabado') return [];
  const typeName = (type.name || '').trim();
  if (!typeName) return [];
  const typeNorm = normalizeForSearch(typeName);
  const width = Number(measure.finished_width_mm);
  const widthNorm = width > 0 ? widthLeafToken(width) : '';

  const groupIds = new Set<string>();
  for (const product of catalog.products) {
    if (product.active === false || product.unit !== 'm' || !product.group_id) continue;
    if (!normalizeForSearch(product.name).includes(typeNorm)) continue;
    groupIds.add(product.group_id);
  }
  if (groupIds.size === 0) return [];

  const candidates = catalog.groups.filter((group) => groupIds.has(group.id));
  // Com bitola explícita, só a folha daquela largura (ex.: "25MM" ou
  // "ELÁSTICO ESPECIAL G 25MM"). Sem bitola, qualquer folha da família —
  // nunca o container homônimo da família.
  // Folhas do piloto ELÁSTICO ESPECIAL G se chamam só "25MM". Não usar
  // endsWith: "TIRA STRASS 6MM" também termina em "6mm" e reativaria Strass
  // inválido via inventário.
  const picked = widthNorm
    ? candidates.filter((group) => normalizeForSearch(group.name) === widthNorm)
    : candidates.filter((group) => normalizeForSearch(group.name) !== typeNorm);

  return picked
    .map((group) => {
      const nameNorm = normalizeForSearch(group.name);
      const looksLikeBareWidth = /^\d+mm$/.test(nameNorm);
      return {
        id: group.id,
        name: looksLikeBareWidth ? `${typeName} · ${group.name}` : group.name,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

/** A medida, seus cadastros produtivos e os UUIDs definem as origens possíveis. */
export function technicalStrapSourcePolicy(
  catalog: TechnicalStrapSourceCatalog | null | undefined,
  measureId: string | null | undefined,
  now: number = Date.now(),
): TechnicalStrapSourcePolicy {
  const unavailable = { loaded: !!catalog, allowsReferenceBase: false, finishedGroups: [] as Array<{ id: string; name: string }> };
  if (!catalog) return unavailable;
  if (!measureId) return { loaded: false, allowsReferenceBase: false, finishedGroups: [] };
  const measure = catalog.measures.find(entry => entry.id === measureId && entry.active !== false);
  const type = catalog.types.find(entry => entry.id === measure?.strap_type_id && entry.active !== false);
  if (!measure || !type) return unavailable;
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
  const fromVariants = catalog.groups.filter(group => finishedGroupIds.has(group.id))
    .map(group => ({ id: group.id, name: group.name }));
  // Inventário só preenche quando a medida buy-ready ainda NÃO tem linha de
  // variante Hub (ELÁSTICO ESPECIAL G). Se a variante existe e está inválida,
  // a origem some — não inventar grupo por nome (Strass / testes de exclusão).
  const hasFinishedVariantRows = catalog.variants.some((variant) => (
    variant.measure_id === measure.id
    && variant.identity_basis === 'finished_product_group'
  ));
  const fromInventory = fromVariants.length > 0 || hasFinishedVariantRows
    ? []
    : buyReadyGroupsFromInventory(catalog, type, measure);
  const finishedById = new Map<string, { id: string; name: string }>();
  for (const group of [...fromVariants, ...fromInventory]) {
    if (!finishedById.has(group.id)) finishedById.set(group.id, group);
  }
  return {
    loaded: true,
    allowsReferenceBase,
    finishedGroups: Array.from(finishedById.values())
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
  };
}

export function isTechnicalStrapSourceAllowed(
  line: TechnicalStrapLineLike,
  policy: TechnicalStrapSourcePolicy,
): boolean {
  // Buy-ready já pinado no grupo de estoque (R4): válido mesmo sem medida Hub.
  if (strapIdentityBasis(line) === 'finished_product_group' && line.identity_group_id) {
    if (!policy.loaded) return true;
    if (policy.finishedGroups.length === 0) return true;
    return policy.finishedGroups.some(group => group.id === line.identity_group_id);
  }
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
