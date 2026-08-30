type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Compara valores serializáveis de formulário sem depender da ordem das chaves.
 * Arrays continuam ordenados porque a ordem faz parte do cadastro (tiras, imagens,
 * componentes etc.).
 */
export function technicalSheetValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => technicalSheetValuesEqual(value, right[index]));
  }

  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(right, key)
    && technicalSheetValuesEqual(left[key], right[key])
  ));
}

/**
 * O PostgREST atualiza uma coluna JSONB inteira, então o patch é profundo para
 * decidir QUAIS colunas de topo mudaram. Quando um objeto/array muda, somente
 * aquela coluna é enviada; colunas iguais não entram no SET do PostgreSQL e não
 * disparam gatilhos `UPDATE OF` desnecessários.
 */
export function buildTechnicalSheetPatch<T extends JsonRecord>(
  persisted: T,
  next: T,
  excludedFields: readonly string[] = [],
): Partial<T> {
  const excluded = new Set(excludedFields);
  const patch: Partial<T> = {};

  for (const key of Object.keys(next) as Array<keyof T>) {
    if (excluded.has(String(key)) || next[key] === undefined) continue;
    if (!technicalSheetValuesEqual(persisted[key], next[key])) {
      patch[key] = next[key];
    }
  }

  return patch;
}

/** Snapshot independente para o diff não ser contaminado por mutação in-place. */
export function cloneTechnicalSheetSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneTechnicalSheetSnapshot(entry)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneTechnicalSheetSnapshot(entry)]),
    ) as T;
  }
  return value;
}

/** Mantém a ordenação da lista (mais recentemente alterada primeiro). */
export function replaceTechnicalSheetCacheRow<T extends { id: string }>(
  cached: T[] | undefined,
  updated: T,
): T[] | undefined {
  if (!cached) return cached;
  return [updated, ...cached.filter((row) => row.id !== updated.id)];
}
