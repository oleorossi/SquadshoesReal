/**
 * Separar um pedido do lote compartilhado. O corte debita a napa do lote
 * inteiro; o botão só aparece enquanto o lote está aberto e há outro job.
 */

export function atelierLiveJobs<T extends { pipeline_status?: string | null }>(
  jobs: readonly T[] | null | undefined,
): T[] {
  return (jobs ?? []).filter((job) => job.pipeline_status !== 'cancelled');
}

export function atelierJobCanSplit(
  job: { pipeline_status?: string | null },
  lot: { status?: string | null; jobs?: readonly { pipeline_status?: string | null }[] | null },
): boolean {
  if (job.pipeline_status !== 'awaiting_cut') return false;
  if (lot.status !== 'open') return false;
  return atelierLiveJobs(lot.jobs).length > 1;
}

export function atelierSplitConfirmMessage(
  job: { order_number?: string | null; sale_order_id?: string | null },
  lot: {
    lot_number?: string | null;
    jobs?: readonly {
      pipeline_status?: string | null;
      sale_order_id?: string | null;
      order_number?: string | null;
      sector?: string | null;
    }[] | null;
  },
): string {
  const number = (job.order_number ?? '').trim() || 'este pedido';
  const lotName = (lot.lot_number ?? '').trim() || 'lote atual';
  const siblings = atelierLiveJobs(lot.jobs).filter((row) => {
    if (job.sale_order_id && row.sale_order_id) return row.sale_order_id === job.sale_order_id;
    return (row.order_number ?? '').trim() === number;
  });
  const extra = siblings.length > 1
    ? ` Saem juntos os ${siblings.length} jobs deste pedido nesta cor.`
    : '';
  return `Separar ${number} num lote próprio? Ele sai de ${lotName}.${extra} O corte do lote antigo não debita a napa destes pares.`;
}

/**
 * Divisão de um job do Ateliê entre prestadores.
 * A grade é pares inteiros por numeração. A soma por tamanho fecha a grade
 * de origem, e o total de cada parte fecha o alvo pedido.
 */

export type SizeGrade = Record<string, number>;

export type AtelierPriceSource = 'referencia' | 'setor';

const SIZE_KEY = /^[0-9]+(\/[0-9]+)?$/;

export function gradeSizeKeys(grade: SizeGrade | null | undefined): string[] {
  if (!grade) return [];
  return Object.keys(grade)
    .filter((key) => SIZE_KEY.test(key) || key === 'pares')
    .filter((key) => Math.trunc(Number(grade[key]) || 0) > 0)
    .sort((a, b) => {
      if (a === 'pares') return 1;
      if (b === 'pares') return -1;
      return parseInt(a, 10) - parseInt(b, 10);
    });
}

export function gradeTotal(grade: SizeGrade | null | undefined): number {
  return gradeSizeKeys(grade).reduce((sum, key) => sum + Math.trunc(Number(grade?.[key]) || 0), 0);
}

/** Maior resto: o total sai exato e nenhum tamanho fica negativo. */
export function apportionIntegers(weights: readonly number[], target: number): number[] {
  const clean = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const total = Math.trunc(target);
  if (clean.length === 0 || total <= 0) return clean.map(() => 0);
  const weightSum = clean.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return clean.map(() => 0);
  const exact = clean.map((weight) => (total * weight) / weightSum);
  const floors = exact.map((value) => Math.floor(value));
  const left = total - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let step = 0; step < left; step += 1) floors[order[step].index] += 1;
  return floors;
}

/**
 * Grade do job: a grade da ficha (1 ficha) vezes as fichas.
 * Se a soma não bater com os pares do job, o maior resto fecha o total.
 * Sem numeração, um único balde `pares`.
 */
export function jobGradeFromItem(
  itemGrade: SizeGrade | null | undefined,
  fichas: number | null | undefined,
  jobPairs: number,
): SizeGrade {
  const sheets = Math.max(1, Math.trunc(Number(fichas) || 1));
  const target = Math.max(0, Math.trunc(Number(jobPairs) || 0));
  const raw: SizeGrade = {};
  for (const key of gradeSizeKeys(itemGrade).filter((size) => size !== 'pares')) {
    const qty = Math.trunc(Number(itemGrade?.[key]) || 0) * sheets;
    if (qty > 0) raw[key] = qty;
  }
  const total = gradeTotal(raw);
  if (total <= 0) return target > 0 ? { pares: target } : {};
  if (total === target || target <= 0) return raw;
  const keys = gradeSizeKeys(raw);
  const shares = apportionIntegers(keys.map((key) => raw[key]), target);
  const out: SizeGrade = {};
  keys.forEach((key, index) => {
    if (shares[index] > 0) out[key] = shares[index];
  });
  return out;
}

export function subtractGrades(base: SizeGrade, taken: readonly SizeGrade[]): SizeGrade {
  const out: SizeGrade = {};
  for (const key of gradeSizeKeys(base)) out[key] = Math.trunc(base[key]);
  for (const part of taken) {
    for (const key of gradeSizeKeys(part)) {
      out[key] = (out[key] || 0) - Math.trunc(part[key]);
    }
  }
  for (const key of Object.keys(out)) {
    if ((out[key] || 0) <= 0) delete out[key];
  }
  return out;
}

/**
 * Divide a grade entre alvos de pares. Cada tamanho soma a grade de origem
 * e cada parte soma o seu alvo. Os alvos têm de fechar a grade.
 */
export function splitGrade(grade: SizeGrade, targets: readonly number[]): SizeGrade[] {
  const keys = gradeSizeKeys(grade);
  const clean = targets.map((target) => Math.trunc(Number(target) || 0));
  if (clean.some((target) => target < 0)) {
    throw new Error('O alvo de pares não pode ser negativo');
  }
  if (gradeTotal(grade) !== clean.reduce((sum, target) => sum + target, 0)) {
    throw new Error('A soma dos alvos não fecha a grade');
  }
  const result: SizeGrade[] = clean.map(() => ({}));
  for (const size of keys) {
    const shares = apportionIntegers(clean, Math.trunc(grade[size]));
    shares.forEach((qty, index) => {
      if (qty > 0) result[index][size] = qty;
    });
  }
  let guard = 0;
  while (guard < 10000) {
    guard += 1;
    const totals = result.map((part) => gradeTotal(part));
    const over = totals.findIndex((total, index) => total > clean[index]);
    const under = totals.findIndex((total, index) => total < clean[index]);
    if (over < 0 || under < 0) break;
    const size = gradeSizeKeys(result[over])
      .sort((a, b) => (result[over][b] || 0) - (result[over][a] || 0))[0];
    if (!size) break;
    result[over][size] -= 1;
    if (result[over][size] <= 0) delete result[over][size];
    result[under][size] = (result[under][size] || 0) + 1;
  }
  return result;
}

/**
 * Menor prazo: pares proporcionais à capacidade, para todos terminarem juntos.
 * Sem capacidade em alguma linha, divide igual.
 */
export function suggestPairsByCapacity(total: number, capacities: readonly (number | null | undefined)[]): number[] {
  const pairs = Math.max(0, Math.trunc(Number(total) || 0));
  if (capacities.length === 0 || pairs <= 0) return capacities.map(() => 0);
  const known = capacities.every((capacity) => capacity != null && Number(capacity) > 0);
  const weights = known
    ? capacities.map((capacity) => Number(capacity))
    : capacities.map(() => 1);
  return apportionIntegers(weights, pairs);
}

export function parseWholeGrade(raw: Record<string, string>): SizeGrade | null {
  const out: SizeGrade = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = value.trim();
    if (text === '') continue;
    if (!/^\d+$/.test(text)) return null;
    const qty = Number(text);
    if (qty > 0) out[key] = qty;
  }
  return out;
}

export interface SplitRowCheck {
  mode: 'internal' | 'contractor';
  grade: SizeGrade;
}

/** null quando a divisão cabe no saldo. A mensagem é o que a tela mostra. */
export function splitBalanceError(remaining: SizeGrade, rows: readonly SplitRowCheck[]): string | null {
  if (rows.length === 0) return 'Inclua ao menos um prestador ou a parte interna';
  const used: SizeGrade = {};
  for (const row of rows) {
    for (const key of Object.keys(row.grade)) {
      const qty = Number(row.grade[key]);
      if (!Number.isInteger(qty) || qty < 0) return 'A grade só aceita pares inteiros, sem fração e sem negativo';
      if (qty > 0) used[key] = (used[key] || 0) + qty;
    }
  }
  if (gradeTotal(used) <= 0) return 'Informe ao menos 1 par';
  for (const key of Object.keys(used)) {
    const cap = Math.trunc(Number(remaining[key]) || 0);
    if ((used[key] || 0) > cap) {
      return `O tamanho ${key} passa do saldo: ${used[key]} de ${cap}`;
    }
  }
  return null;
}

export function resolveAtelierPairPrice(input: {
  referencePrice: number | null | undefined;
  sectorPrice: number | null | undefined;
}): { price: number | null; source: AtelierPriceSource | null } {
  const reference = Number(input.referencePrice);
  if (Number.isFinite(reference) && reference > 0) return { price: reference, source: 'referencia' };
  const sector = Number(input.sectorPrice);
  if (Number.isFinite(sector) && sector > 0) return { price: sector, source: 'setor' };
  return { price: null, source: null };
}

export function priceWasEdited(locked: number | null, suggested: number | null): boolean {
  if (locked == null) return false;
  if (suggested == null) return true;
  return Math.round(locked * 100) !== Math.round(suggested * 100);
}

export interface FacaRollup {
  label: string;
  pairs: number;
}

/** Soma a grade nas facas P/M/G. Sem faca, devolve vazio e a tela fica na numeração. */
export function rollupGradeByFaca(
  grade: SizeGrade,
  buckets: readonly { label: string; sizes: readonly string[] }[] | null | undefined,
): FacaRollup[] {
  if (!buckets || buckets.length === 0) return [];
  const totals = new Map<string, number>();
  for (const bucket of buckets) totals.set(bucket.label, 0);
  const owner = new Map<string, string>();
  for (const bucket of buckets) {
    for (const size of bucket.sizes) owner.set(String(size), bucket.label);
  }
  for (const size of gradeSizeKeys(grade)) {
    const label = owner.get(size);
    if (!label) continue;
    totals.set(label, (totals.get(label) || 0) + Math.trunc(grade[size]));
  }
  return buckets
    .map((bucket) => ({ label: bucket.label, pairs: totals.get(bucket.label) || 0 }))
    .filter((row) => row.pairs > 0);
}
