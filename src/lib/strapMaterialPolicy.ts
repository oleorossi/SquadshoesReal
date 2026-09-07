import { strapIdentityBasis, type StrapIdentityLike } from '@/lib/strapIdentity';

export type StrapMaterialMode = 'follow_reference' | 'fixed_group' | 'select_on_order';
export const MAX_STRAP_MATERIAL_GROUPS = 25;

/** Política técnica; o grupo efetivo é congelado separadamente no item do PV. */
export interface StrapMaterialPolicyLike extends StrapIdentityLike {
  material_mode?: StrapMaterialMode | string | null;
  material_group_id?: string | null;
  allowed_material_group_ids?: readonly string[] | null;
  base_group_id?: string | null;
  base_group_name?: string | null;
}

export type AppliedStrapMaterialPolicy<T> = Omit<T,
  'material_mode' | 'material_group_id' | 'allowed_material_group_ids' | 'base_group_id' | 'base_group_name'
> & {
  material_mode: StrapMaterialMode;
  material_group_id: string | null;
  allowed_material_group_ids: string[];
  base_group_id: null;
  base_group_name: null;
};

// Mesma forma textual aceita pelo Postgres, inclusive UUID v7. Não inferir por nome.
const MATERIAL_GROUP_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const isGroupId = (value: unknown): value is string =>
  typeof value === 'string' && MATERIAL_GROUP_UUID.test(value);
const canonicalGroupId = (value: string | null | undefined) => isGroupId(value) ? value.toLowerCase() : value;

/** Somente ausência/null significam legado. Valor explícito desconhecido bloqueia. */
export function strapMaterialMode(line: StrapMaterialPolicyLike | null | undefined): StrapMaterialMode | null {
  const mode = line?.material_mode;
  if (mode == null) return 'follow_reference';
  return mode === 'follow_reference' || mode === 'fixed_group' || mode === 'select_on_order'
    ? mode
    : null;
}

/** Hidrata defaults sem apagar corrupção nem reinterpretar snapshot histórico. */
export function normalizeStrapMaterialPolicy<T extends StrapMaterialPolicyLike>(line: T): T & {
  material_mode: string;
  material_group_id: string | null;
  allowed_material_group_ids: readonly string[];
} {
  return {
    ...line,
    material_mode: line.material_mode == null ? 'follow_reference' : String(line.material_mode),
    material_group_id: canonicalGroupId(line.material_group_id) ?? null,
    allowed_material_group_ids: Array.isArray(line.allowed_material_group_ids)
      ? line.allowed_material_group_ids.map(canonicalGroupId)
      : line.allowed_material_group_ids ?? [],
  };
}

/** Mudança explícita de engenharia invalida o grupo efetivo, nunca o consumo. */
export function applyStrapMaterialPolicy<T extends StrapMaterialPolicyLike>(
  line: T,
  mode: StrapMaterialMode,
  groupId?: string | null,
  allowedGroupIds?: readonly string[] | null,
): AppliedStrapMaterialPolicy<T> {
  const effectiveMode = strapIdentityBasis(line) === 'finished_product_group' ? 'follow_reference' : mode;
  return {
    ...line,
    material_mode: effectiveMode,
    material_group_id: effectiveMode === 'fixed_group' ? canonicalGroupId(groupId) ?? null : null,
    allowed_material_group_ids: effectiveMode === 'select_on_order' ? (allowedGroupIds || []).map(canonicalGroupId) : [],
    base_group_id: null,
    base_group_name: null,
  };
}

/** Catálogo opcional: sua ausência não equivale a nenhum grupo elegível. */
export function validateStrapMaterialPolicy(
  line: StrapMaterialPolicyLike,
  eligibleGroupIds?: ReadonlySet<string>,
): string[] {
  const mode = strapMaterialMode(line);
  if (!mode) return ['Política de material desconhecida. Escolha uma opção válida.'];
  const allowed = line.allowed_material_group_ids;
  if (allowed != null && !Array.isArray(allowed)) return ['A lista de materiais permitidos é inválida.'];
  const hasFixed = line.material_group_id != null;
  const hasAllowed = (allowed?.length || 0) > 0;
  if (strapIdentityBasis(line) === 'finished_product_group') {
    return mode !== 'follow_reference' || hasFixed || hasAllowed
      ? ['Tira comprada pronta usa somente o grupo do produto acabado.']
      : [];
  }
  if (mode === 'follow_reference') {
    return hasFixed || hasAllowed ? ['Seguir a referência não permite material fixo ou lista própria.'] : [];
  }
  if (mode === 'fixed_group') {
    if (!isGroupId(line.material_group_id)) return ['Selecione o material fixo desta posição.'];
    if (hasAllowed) return ['Material fixo não permite uma lista de escolha no pedido.'];
    if (eligibleGroupIds && !eligibleGroupIds.has(line.material_group_id.toLowerCase())) {
      return ['O material fixo não está elegível como matéria-prima de tira.'];
    }
    return [];
  }
  if (hasFixed) return ['Escolha no pedido não permite um material fixo simultâneo.'];
  if (!hasAllowed) return ['Selecione pelo menos um material permitido no pedido.'];
  if (allowed.length > MAX_STRAP_MATERIAL_GROUPS) return [`Selecione no máximo ${MAX_STRAP_MATERIAL_GROUPS} materiais por posição.`];
  if (allowed.some(id => !isGroupId(id))) return ['Todos os materiais permitidos precisam de um grupo válido.'];
  if (new Set(allowed.map(id => id.toLowerCase())).size !== allowed.length) {
    return ['O mesmo material não pode aparecer duas vezes nesta posição.'];
  }
  if (eligibleGroupIds && allowed.some(id => !eligibleGroupIds.has(id.toLowerCase()))) {
    return ['Há material permitido que não está elegível como matéria-prima de tira.'];
  }
  return [];
}

/** Resolução pura por UUID; grupo composto permanece uma identidade indivisível. */
export function resolveStrapMaterialBaseGroupId(
  line: StrapMaterialPolicyLike,
  context: {
    referenceBaseGroupId?: string | null;
    selectedBaseGroupId?: string | null;
    eligibleGroupIds?: ReadonlySet<string>;
  } = {},
): string | null {
  if (validateStrapMaterialPolicy(line, context.eligibleGroupIds).length > 0) return null;
  if (strapIdentityBasis(line) === 'finished_product_group') {
    return isGroupId(line.identity_group_id) ? line.identity_group_id.toLowerCase() : null;
  }
  const mode = strapMaterialMode(line);
  const groupId = mode === 'fixed_group'
    ? line.material_group_id
    : mode === 'select_on_order'
      ? context.selectedBaseGroupId ?? line.base_group_id
      : context.referenceBaseGroupId ?? line.base_group_id;
  if (!isGroupId(groupId)) return null;
  const canonicalId = groupId.toLowerCase();
  if (mode === 'select_on_order' && !line.allowed_material_group_ids?.some(id => id.toLowerCase() === canonicalId)) return null;
  if (context.eligibleGroupIds && !context.eligibleGroupIds.has(canonicalId)) return null;
  return canonicalId;
}
