type ReferenceLike = {
  id: string;
  code?: string | null;
  name?: string | null;
  updated_at?: string | null;
};

const normalize = (value?: string | null) => value?.trim().toLowerCase() || '';

const getReferenceKey = <T extends ReferenceLike>(reference: T) => {
  const codeKey = normalize(reference.code);
  if (codeKey) return `code:${codeKey}`;

  const nameKey = normalize(reference.name);
  if (nameKey) return `name:${nameKey}`;

  return `id:${reference.id}`;
};

const getUpdatedAtTime = (value?: string | null) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export function getCanonicalSaleOrderReferences<T extends ReferenceLike>(references: T[]): T[] {
  const canonicalByKey = new Map<string, T>();

  [...references]
    .sort((a, b) => getUpdatedAtTime(b.updated_at) - getUpdatedAtTime(a.updated_at))
    .forEach((reference) => {
      const key = getReferenceKey(reference);
      if (!canonicalByKey.has(key)) {
        canonicalByKey.set(key, reference);
      }
    });

  return Array.from(canonicalByKey.values());
}

export function getCanonicalReferenceIdMap<T extends ReferenceLike>(references: T[]) {
  const canonicalReferences = getCanonicalSaleOrderReferences(references);
  const canonicalIdByKey = new Map(
    canonicalReferences.map((reference) => [getReferenceKey(reference), reference.id])
  );

  return references.reduce((map, reference) => {
    map.set(reference.id, canonicalIdByKey.get(getReferenceKey(reference)) || reference.id);
    return map;
  }, new Map<string, string>());
}
