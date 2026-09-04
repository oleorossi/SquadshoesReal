import { isUuid } from '@/lib/technicalStrapLines';

export interface OperatorStrapLineLike {
  id?: string | null;
  technical_strap_line_id?: string | null;
  label?: string | null;
  color?: string | null;
  color_id?: string | null;
  strap_type_id?: string | null;
  measure_id?: string | null;
  consumption?: number | string | null;
  consumption_per_size?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const LEGACY_ORDINAL_RE = /^\d+$/;

/**
 * Ordem fabril das tiras na ficha de operador.
 *
 * A posição técnica é a posição da linha no array `strap_colors`: o writer do
 * PV reidrata esse array na mesma ordem da ficha técnica. UUID identifica a
 * contribuição, mas NÃO codifica posição — ordenar UUID lexicalmente embaralha
 * TIRA 1/2/3. Snapshots antigos usavam `id: "1"`, `"2"` etc.; quando TODAS as
 * linhas ainda têm esse formato, preservamos a ordenação numérica histórica.
 */
export function operatorStrapSequence<T extends OperatorStrapLineLike>(
  lines: T[] | null | undefined,
): T[] {
  const sequence = [...(lines || [])];
  if (sequence.length < 2) return sequence;

  // Um UUID em qualquer dos dois campos torna a posição do array
  // autoritativa para o conjunto inteiro. Não misturamos duas réguas.
  const hasCanonicalIdentity = sequence.some((line) =>
    isUuid(line.technical_strap_line_id)
      || isUuid(line.id),
  );
  if (hasCanonicalIdentity) return sequence;

  const legacyOrdinals = sequence.map((line) => {
    const id = String(line.id ?? '').trim();
    return LEGACY_ORDINAL_RE.test(id) ? Number(id) : null;
  });

  if (legacyOrdinals.every((ordinal) => ordinal != null)) {
    return sequence
      .map((line, index) => ({ line, index, ordinal: legacyOrdinals[index]! }))
      .sort((a, b) => a.ordinal - b.ordinal || a.index - b.index)
      .map(({ line }) => line);
  }

  return sequence;
}

/** Cor efetiva impressa: snapshot por linha do PV; legado cai na cor principal. */
export function effectiveOperatorStrapColor(
  line: OperatorStrapLineLike,
  mainColor?: string | null,
): string {
  return String(line.color || '').trim() || String(mainColor || '').trim() || '—';
}

function canonicalStrapText(value: unknown): string {
  return String(value ?? '').trim();
}

function canonicalStrapConsumption(value: unknown): number | string | null {
  if (value == null) return null;
  const text = canonicalStrapText(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : text;
}

function canonicalStrapConsumptionPerSize(
  value: Record<string, unknown> | null | undefined,
): Array<[string, number | string | null]> {
  if (!value || Array.isArray(value)) return [];
  return Object.entries(value)
    .sort(([sizeA], [sizeB]) => sizeA.localeCompare(sizeB, 'pt-BR', { numeric: true }))
    .map(([size, consumption]) => [size, canonicalStrapConsumption(consumption)]);
}

/**
 * Chave semântica do snapshot de tiras usado no agrupamento das fichas ricas.
 *
 * A ordem do array devolvido por `operatorStrapSequence` faz parte da chave:
 * UUID identifica a linha, mas nunca é usado para reordená-la. Além da
 * apresentação, entram identidade e medidas porque duas OPs com a mesma cor
 * podem conservar consumos históricos diferentes e não podem compartilhar a
 * ficha de Aviamento. As chaves de `consumption_per_size` são ordenadas apenas
 * para neutralizar a ordem de inserção do objeto; as linhas continuam na
 * sequência técnica.
 */
export function operatorStrapGroupingSignature(
  lines: OperatorStrapLineLike[] | null | undefined,
  mainColor?: string | null,
): string {
  const sequence = operatorStrapSequence(lines);
  if (sequence.length === 0) return '';

  return JSON.stringify(sequence.map((line) => ({
    lineId: canonicalStrapText(line.technical_strap_line_id || line.id),
    strapTypeId: canonicalStrapText(line.strap_type_id),
    measureId: canonicalStrapText(line.measure_id),
    label: canonicalStrapText(line.label || 'TIRA').toUpperCase(),
    colorId: canonicalStrapText(line.color_id),
    color: effectiveOperatorStrapColor(line, mainColor).toUpperCase(),
    consumption: canonicalStrapConsumption(line.consumption),
    consumptionPerSize: canonicalStrapConsumptionPerSize(line.consumption_per_size),
  })));
}
