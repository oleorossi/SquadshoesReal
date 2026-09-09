export type AllocatedPairsByOp = Map<string, number>;

export interface AllocatedConsumptionSlice<Row> {
  rows: readonly Row[];
  fullPairs: number;
  allocatedPairs: number;
}

interface AllocatableConsumptionRow {
  required: number;
  available: number;
  stock_ok: boolean;
}

/** Acumula a quantidade de uma OP representada por um grupo da ficha. */
export function addAllocatedPairs(
  target: AllocatedPairsByOp,
  opNumber: unknown,
  pairs: unknown,
): void {
  const op = String(opNumber ?? '').trim();
  const quantity = Number(pairs);
  if (!op || !Number.isFinite(quantity) || quantity <= 0) return;
  target.set(op, (target.get(op) ?? 0) + quantity);
}

export function cloneAllocatedPairs(
  source: ReadonlyMap<string, number> | undefined,
): AllocatedPairsByOp {
  return new Map(source ?? []);
}

export function mergeAllocatedPairs(
  target: AllocatedPairsByOp,
  source: ReadonlyMap<string, number> | undefined,
): void {
  if (!source) return;
  for (const [op, pairs] of source) addAllocatedPairs(target, op, pairs);
}

/** Discriminador estável para fusões que não podem juntar lotes distintos. */
export function lotPartitionKey(
  lotInfo: { number: number; total: number } | null | undefined,
): string {
  if (!lotInfo || !(lotInfo.total > 1) || !(lotInfo.number > 0)) return 'lot:none';
  return `lot:${lotInfo.number}/${lotInfo.total}`;
}

/**
 * Rateia cada OP de forma independente antes de combinar materiais iguais.
 *
 * Um lote pode reunir frações diferentes de várias OPs. Aplicar uma razão única
 * depois da agregação atribui a quantidade errada aos materiais exclusivos de
 * uma delas. Manter cada OP como uma fatia torna o resultado aditivo e não
 * altera as linhas canônicas da OP completa.
 */
export function aggregateConsumptionByAllocatedPairs<Row extends AllocatableConsumptionRow>(
  slices: readonly AllocatedConsumptionSlice<Row>[],
  keyForRow: (row: Row) => string,
): Row[] {
  const aggregated = new Map<string, Row>();

  for (const slice of slices) {
    const fullPairs = Number(slice.fullPairs);
    const allocatedPairs = Number(slice.allocatedPairs);
    if (!(fullPairs > 0) || !(allocatedPairs > 0)) continue;
    const ratio = allocatedPairs / fullPairs;

    for (const sourceRow of slice.rows) {
      const required = (Number(sourceRow.required) || 0) * ratio;
      const key = keyForRow(sourceRow);
      const existing = aggregated.get(key);
      if (!existing) {
        const row = { ...sourceRow, required };
        row.stock_ok = row.available >= row.required;
        aggregated.set(key, row);
        continue;
      }

      existing.required += required;
      existing.available = Math.max(existing.available, sourceRow.available);
      existing.stock_ok = existing.available >= existing.required;
    }
  }

  return Array.from(aggregated.values());
}
