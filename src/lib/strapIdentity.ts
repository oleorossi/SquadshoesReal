export type StrapIdentityBasis = 'reference_base' | 'finished_product_group';

export interface StrapIdentityLike {
  identity_basis?: StrapIdentityBasis | null;
  identity_group_id?: string | null;
  internal_production_enabled?: boolean | null;
}

/** Cutover nominal da migração 044. IDs exatos; jamais ampliar por nome/cor. */
export const NOMINAL_BUY_READY_STRAP_PRODUCT_IDS = [
  '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
  'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
  '9028a544-5de5-4798-a37b-edc3b51e82f3',
  '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
  'e7056d1b-28a3-462a-b3af-f28d298194b8',
  '6e958e62-fc9d-4bdd-be01-43561adc5b36',
  'd47aaf48-644c-473d-b903-8f289270555b',
] as const;

export const NOMINAL_BUY_READY_STRAP_GROUP_IDS = [
  'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
  '6e43bbda-0f1f-412c-8d4a-ec009114530d',
] as const;

const nominalProductIds = new Set<string>(NOMINAL_BUY_READY_STRAP_PRODUCT_IDS);
const nominalGroupIds = new Set<string>(NOMINAL_BUY_READY_STRAP_GROUP_IDS);

export function isNominalBuyReadyStrapIdentity(
  productId?: string | null,
  groupId?: string | null,
): boolean {
  return (!!productId && nominalProductIds.has(productId))
    || (!!groupId && nominalGroupIds.has(groupId));
}

/** Ausência no JSON legado significa a identidade histórica pela napa da referência. */
export function strapIdentityBasis(value: StrapIdentityLike | null | undefined): StrapIdentityBasis {
  return value?.identity_basis === 'finished_product_group'
    ? 'finished_product_group'
    : 'reference_base';
}

export function isPurchasedReadyStrap(value: StrapIdentityLike | null | undefined): boolean {
  return strapIdentityBasis(value) === 'finished_product_group'
    || value?.internal_production_enabled === false;
}

export function normalizeStrapIdentity<T extends StrapIdentityLike>(value: T): T & {
  identity_basis: StrapIdentityBasis;
  identity_group_id: string | null;
} {
  const identityBasis = strapIdentityBasis(value);
  return {
    ...value,
    identity_basis: identityBasis,
    identity_group_id: identityBasis === 'finished_product_group'
      ? value.identity_group_id || null
      : null,
  };
}
