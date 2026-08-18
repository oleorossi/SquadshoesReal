import {
  normalizeStrapIdentity,
  strapIdentityBasis,
  type StrapIdentityBasis,
  type StrapIdentityLike,
} from '@/lib/strapIdentity';

/** Identidade imutável de uma linha de tira da ficha técnica. */
export interface TechnicalStrapLineLike extends StrapIdentityLike {
  id?: string | null;
  technical_strap_line_id?: string | null;
  strap_type_id?: string | null;
  measure_id?: string | null;
}

export interface TechnicalStrapMeasureLike {
  id: string;
  strap_type_id: string;
  active?: boolean | null;
}

export interface TechnicalStrapTypeLike {
  id: string;
  active?: boolean | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function newTechnicalStrapLineId(): string {
  return crypto.randomUUID();
}

/**
 * IDs ordinais legados (`"1"`, `"2"`...) não podem identificar uma contribuição
 * depois que a ficha é reordenada. Esta função preserva UUIDs existentes e atribui um
 * UUID novo apenas a linhas legadas/novas. O `id` visual acompanha o mesmo UUID para que
 * todos os componentes antigos também ganhem uma chave React estável.
 */
export function ensureTechnicalStrapLineIds<T extends object & TechnicalStrapLineLike>(
  lines: T[] | null | undefined,
  forceNew = false,
): Array<T & {
  id: string;
  technical_strap_line_id: string;
  identity_basis: StrapIdentityBasis;
  identity_group_id: string | null;
}> {
  return (lines || []).map((line) => {
    const existing = !forceNew
      ? (isUuid(line.technical_strap_line_id)
        ? line.technical_strap_line_id
        : isUuid(line.id)
          ? line.id
          : null)
      : null;
    const technicalStrapLineId = existing || newTechnicalStrapLineId();
    return normalizeStrapIdentity({
      ...line,
      id: technicalStrapLineId,
      technical_strap_line_id: technicalStrapLineId,
    });
  });
}

export function technicalStrapLineId(line: TechnicalStrapLineLike | null | undefined): string | null {
  if (!line) return null;
  if (isUuid(line.technical_strap_line_id)) return line.technical_strap_line_id;
  return isUuid(line.id) ? line.id : null;
}

/**
 * A medida é a identidade técnica persistida na ficha. O grupo antigo não
 * participa da resolução canônica e pode permanecer apenas como rótulo de
 * migração/diagnóstico.
 */
export function applyCanonicalTechnicalStrapMeasure<T extends TechnicalStrapLineLike>(
  line: T,
  measure: TechnicalStrapMeasureLike,
): T & { strap_type_id: string; measure_id: string } {
  return {
    ...line,
    strap_type_id: measure.strap_type_id,
    measure_id: measure.id,
  };
}

export function applyTechnicalStrapIdentity<T extends TechnicalStrapLineLike>(
  line: T,
  identityBasis: StrapIdentityBasis,
  identityGroupId?: string | null,
): T & { identity_basis: StrapIdentityBasis; identity_group_id: string | null } {
  return {
    ...line,
    identity_basis: identityBasis,
    identity_group_id: identityBasis === 'finished_product_group' ? identityGroupId || null : null,
  };
}

export function hasCanonicalTechnicalStrapIdentity(
  line: TechnicalStrapLineLike,
  measures: TechnicalStrapMeasureLike[],
  types: TechnicalStrapTypeLike[],
): boolean {
  if (!isUuid(line.technical_strap_line_id) || !isUuid(line.measure_id) || !isUuid(line.strap_type_id)) {
    return false;
  }
  const measure = measures.find((entry) => entry.id === line.measure_id && entry.active !== false);
  if (!measure || measure.strap_type_id !== line.strap_type_id) return false;
  const type = types.find((entry) => entry.id === line.strap_type_id && entry.active !== false);
  if (!type) return false;
  return strapIdentityBasis(line) !== 'finished_product_group' || isUuid(line.identity_group_id);
}
