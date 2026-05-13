type ReferenceLike = {
  id: string;
  code?: string | null;
  name?: string | null;
  updated_at?: string | null;
};

const normalize = (value?: string | null) => value?.trim().toLowerCase() || '';

/**
 * Chave de deduplicação de fichas técnicas no PV.
 *
 * BUG ANTIGO: usávamos só `code` como chave. Mas se 2 fichas DIFERENTES (ex:
 * DS19 e SP117) tivessem o mesmo `code` por engano (digitação errada/teste),
 * a dedup mantinha só a mais recente e a outra SUMIA do dropdown do PV —
 * mesmo estando cadastrada e ativa.
 *
 * FIX: chave combina `code + name` quando ambos existem. Assim, mesma ref
 * com versionamento (mesmo code+name, várias updated_at) ainda deduplica
 * pra mais recente, mas produtos diferentes (code igual MAS name diferente)
 * aparecem ambos no dropdown.
 */
const getReferenceKey = <T extends ReferenceLike>(reference: T) => {
  const codeKey = normalize(reference.code);
  const nameKey = normalize(reference.name);

  // Quando AMBOS existem, combina ambos — code sozinho não é mais suficiente
  // pra identificar a referência (pode haver colisão acidental).
  if (codeKey && nameKey) return `code+name:${codeKey}|${nameKey}`;
  if (codeKey) return `code:${codeKey}`;
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
