import { supabase } from '@/integrations/supabase/client';
import type { StrapIdentityBasis } from '@/lib/strapIdentity';
import type { StrapColorMode } from '@/lib/technicalStrapLines';
import {
  loadMobileCatalogEntry,
  saveMobileCatalogEntry,
} from '@/lib/mobile/offlineQueue';

export const MOBILE_STRAP_OFFLINE_MANIFEST_VERSION = 1 as const;
export const MOBILE_STRAP_OFFLINE_CACHE_SCHEMA_VERSION = 1 as const;
export const MOBILE_STRAP_OFFLINE_CACHE_KEY = 'mobile-strap-offline-manifest:v1';

export interface MobileStrapManifestColor {
  id: string;
  name: string;
}

/**
 * Snapshot técnico não financeiro necessário para montar e revisar um item
 * sem rede. `allowed_colors` e `base_group_id` já vêm resolvidos pelo servidor
 * para a combinação exata referência + variante.
 */
export interface MobileStrapManifestLine {
  technical_strap_line_id: string | null;
  position: number;
  label?: string | null;
  identity_basis: StrapIdentityBasis;
  identity_group_id: string | null;
  strap_type_id: string | null;
  measure_id: string | null;
  color_mode: StrapColorMode;
  internal_production_enabled?: boolean | null;
  group_id?: string | null;
  group_name?: string | null;
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
  base_group_id: string | null;
  allowed_colors: MobileStrapManifestColor[];
}

export interface MobileStrapManifestReference {
  reference_id: string;
  material_variant_id: string | null;
  lines: MobileStrapManifestLine[];
}

export interface MobileStrapOfflineManifest {
  version: typeof MOBILE_STRAP_OFFLINE_MANIFEST_VERSION;
  generated_at: string;
  manifest_hash: string;
  references: MobileStrapManifestReference[];
}

interface CachedMobileStrapOfflineManifest {
  cache_schema_version: typeof MOBILE_STRAP_OFFLINE_CACHE_SCHEMA_VERSION;
  manifest: MobileStrapOfflineManifest;
}

type UntypedRpcResult = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}>;

const rpc = (name: string, args: Record<string, unknown>): UntypedRpcResult => (
  supabase as unknown as {
    rpc: (rpcName: string, rpcArgs: Record<string, unknown>) => UntypedRpcResult;
  }
).rpc(name, args);

const stringOrNull = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const finiteNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeAllowedColors(value: unknown): MobileStrapManifestColor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const color = asObject(raw);
    const id = stringOrNull(color?.id);
    const name = stringOrNull(color?.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

function normalizeConsumptionPerSize(value: unknown): Record<string, number> | null {
  const object = asObject(value);
  if (!object) return null;
  return Object.fromEntries(Object.entries(object).flatMap(([size, raw]) => {
    const quantity = finiteNumberOrNull(raw);
    return quantity == null ? [] : [[size, quantity]];
  }));
}

function normalizeManifestLine(raw: unknown, index: number): MobileStrapManifestLine | null {
  const line = asObject(raw);
  if (!line) return null;
  const identityBasis: StrapIdentityBasis = line.identity_basis === 'finished_product_group'
    ? 'finished_product_group'
    : 'reference_base';
  return {
    technical_strap_line_id: stringOrNull(line.technical_strap_line_id),
    position: Math.max(1, Number(line.position) || index + 1),
    label: stringOrNull(line.label),
    identity_basis: identityBasis,
    identity_group_id: identityBasis === 'finished_product_group'
      ? stringOrNull(line.identity_group_id)
      : null,
    strap_type_id: stringOrNull(line.strap_type_id),
    measure_id: stringOrNull(line.measure_id),
    color_mode: identityBasis === 'finished_product_group' || line.color_mode === 'select_on_order'
      ? 'select_on_order'
      : 'follow_main',
    internal_production_enabled: typeof line.internal_production_enabled === 'boolean'
      ? line.internal_production_enabled
      : null,
    group_id: stringOrNull(line.group_id),
    group_name: stringOrNull(line.group_name),
    consumption: finiteNumberOrNull(line.consumption),
    consumption_per_size: normalizeConsumptionPerSize(line.consumption_per_size),
    base_group_id: stringOrNull(line.base_group_id),
    allowed_colors: normalizeAllowedColors(line.allowed_colors),
  };
}

export function normalizeMobileStrapOfflineManifest(
  value: unknown,
): MobileStrapOfflineManifest | null {
  const manifest = asObject(value);
  if (manifest?.version !== MOBILE_STRAP_OFFLINE_MANIFEST_VERSION
      || !Array.isArray(manifest.references)) return null;
  const generatedAt = stringOrNull(manifest.generated_at);
  const manifestHash = stringOrNull(manifest.manifest_hash);
  if (!generatedAt || !manifestHash) return null;

  const references = manifest.references.flatMap((raw) => {
    const reference = asObject(raw);
    const referenceId = stringOrNull(reference?.reference_id);
    if (!referenceId || !Array.isArray(reference?.lines)) return [];
    const lines = reference.lines
      .map(normalizeManifestLine)
      .filter((line): line is MobileStrapManifestLine => !!line)
      .sort((left, right) => left.position - right.position);
    return [{
      reference_id: referenceId,
      material_variant_id: stringOrNull(reference.material_variant_id),
      lines,
    }];
  });

  return {
    version: MOBILE_STRAP_OFFLINE_MANIFEST_VERSION,
    generated_at: generatedAt,
    manifest_hash: manifestHash,
    references,
  };
}

export async function saveMobileStrapOfflineManifest(
  ownerId: string,
  manifest: MobileStrapOfflineManifest,
): Promise<void> {
  const normalized = normalizeMobileStrapOfflineManifest(manifest);
  if (!normalized) throw new Error('Manifesto offline de tiras inválido.');
  const payload: CachedMobileStrapOfflineManifest = {
    cache_schema_version: MOBILE_STRAP_OFFLINE_CACHE_SCHEMA_VERSION,
    manifest: normalized,
  };
  await saveMobileCatalogEntry(ownerId, MOBILE_STRAP_OFFLINE_CACHE_KEY, payload);
}

export async function loadMobileStrapOfflineManifest(
  ownerId: string,
): Promise<MobileStrapOfflineManifest | null> {
  const cached = await loadMobileCatalogEntry<unknown>(ownerId, MOBILE_STRAP_OFFLINE_CACHE_KEY);
  const payload = asObject(cached);
  if (payload?.cache_schema_version !== MOBILE_STRAP_OFFLINE_CACHE_SCHEMA_VERSION) return null;
  return normalizeMobileStrapOfflineManifest(payload.manifest);
}

export async function fetchMobileStrapOfflineManifest(
  referenceIds?: string[] | null,
): Promise<MobileStrapOfflineManifest> {
  const ids = referenceIds?.length
    ? [...new Set(referenceIds)].slice(0, 200)
    : null;
  const { data, error } = await rpc('get_mobile_strap_offline_manifest', {
    p_reference_ids: ids,
  });
  if (error) throw new Error(error.message || 'Falha ao carregar o manifesto offline de tiras.');
  const manifest = normalizeMobileStrapOfflineManifest(data);
  if (!manifest) throw new Error('O servidor devolveu um manifesto offline de tiras incompatível.');
  return manifest;
}

export function findMobileStrapManifestReference(
  manifest: MobileStrapOfflineManifest | null | undefined,
  referenceId: string | null | undefined,
  materialVariantId?: string | null,
): MobileStrapManifestReference | null {
  if (!manifest || !referenceId) return null;
  const variantId = materialVariantId || null;
  return manifest.references.find((entry) => (
    entry.reference_id === referenceId
    && entry.material_variant_id === variantId
  )) || null;
}

export function mobileTechnicalStrapLinesFromManifest(
  entry: MobileStrapManifestReference | null | undefined,
): Array<Record<string, unknown>> {
  return (entry?.lines || []).map((line) => ({
    id: line.technical_strap_line_id,
    technical_strap_line_id: line.technical_strap_line_id,
    label: line.label,
    identity_basis: line.identity_basis,
    identity_group_id: line.identity_group_id,
    strap_type_id: line.strap_type_id,
    measure_id: line.measure_id,
    color_mode: line.color_mode,
    internal_production_enabled: line.internal_production_enabled,
    group_id: line.group_id,
    group_name: line.group_name,
    consumption: line.consumption,
    consumption_per_size: line.consumption_per_size,
  }));
}
