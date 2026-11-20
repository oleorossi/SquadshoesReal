/**
 * Painel das OS ativas e redistribuição entre prestadores.
 * A soma dos destinos fecha o que sai da origem. Par não enviado muda
 * direto. Par já enviado só muda depois da devolução sem produção,
 * que não gera conta a pagar.
 */
import { addFactoryBusinessDays, contractorWeekOverCapacity } from '@/lib/cabedalPlanningMotor';
import { gradeSizeKeys, gradeTotal, type SizeGrade } from '@/lib/atelierSplit';

export interface OsMove {
  contractorId: string | null;
  internal: boolean;
  grade: SizeGrade;
}

export interface RedistributionPlan {
  ok: boolean;
  error: string | null;
  take: SizeGrade;
  unsentPairs: number;
  streetPairs: number;
  requiresUnproducedReturn: boolean;
  payable: number;
}

export interface ReportMovementEffect {
  physicalSign: -1 | 0 | 1;
  payableSign: 0 | 1;
  countsAsProduced: boolean;
  kind: 'envio' | 'retorno' | 'estorno' | 'retrabalho' | 'descarte' | 'devolucao_sem_producao';
}

const SIZE_KEY = /^[0-9]+(\/[0-9]+)?$/;

export function cleanGrade(grade: SizeGrade | null | undefined): SizeGrade {
  const out: SizeGrade = {};
  for (const key of Object.keys(grade ?? {})) {
    if (key !== 'pares' && !SIZE_KEY.test(key)) continue;
    const qty = Number(grade?.[key]);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    out[key] = qty;
  }
  return out;
}

export function gradesEqual(a: SizeGrade, b: SizeGrade): boolean {
  const left = cleanGrade(a);
  const right = cleanGrade(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] || 0) !== (right[key] || 0)) return false;
  }
  return true;
}

export function addGrades(parts: readonly SizeGrade[]): SizeGrade {
  const out: SizeGrade = {};
  for (const part of parts) {
    for (const key of gradeSizeKeys(cleanGrade(part))) {
      out[key] = (out[key] || 0) + Math.trunc(part[key]);
    }
  }
  return out;
}

/** Tira pares das numerações maiores. O que fica continua inteiro. */
export function shrinkGrade(grade: SizeGrade, pairs: number): SizeGrade {
  const out = { ...cleanGrade(grade) };
  let left = Math.max(0, Math.trunc(Number(pairs) || 0));
  const keys = gradeSizeKeys(out).sort((a, b) => {
    if (a === 'pares') return 1;
    if (b === 'pares') return -1;
    return parseInt(b, 10) - parseInt(a, 10);
  });
  for (const key of keys) {
    if (left <= 0) break;
    const have = out[key] || 0;
    const take = Math.min(left, have);
    out[key] = have - take;
    left -= take;
    if (out[key] <= 0) delete out[key];
  }
  return out;
}

export function formatGrade(grade: SizeGrade | null | undefined): string {
  const keys = gradeSizeKeys(cleanGrade(grade));
  if (keys.length === 0) return '—';
  return keys.map((key) => `${key === 'pares' ? 'pares' : key}: ${grade?.[key]}`).join(' · ');
}

export function movableGrade(planned: SizeGrade, movablePairs: number): SizeGrade {
  const clean = cleanGrade(planned);
  const extra = gradeTotal(clean) - Math.max(0, Math.trunc(movablePairs) || 0);
  if (extra <= 0) return clean;
  return shrinkGrade(clean, extra);
}

/**
 * Separa o que ainda não foi enviado do que está na rua.
 * O que está na rua exige devolução sem produção antes de ir a outro prestador.
 */
export function planRedistribution(input: {
  movable: SizeGrade;
  unsentPairs: number;
  streetPairs: number;
  take: SizeGrade;
  moves: readonly OsMove[];
}): RedistributionPlan {
  const take = cleanGrade(input.take);
  const unsent = Math.max(0, Math.trunc(Number(input.unsentPairs) || 0));
  const street = Math.max(0, Math.trunc(Number(input.streetPairs) || 0));
  const fail = (error: string): RedistributionPlan => ({
    ok: false,
    error,
    take,
    unsentPairs: 0,
    streetPairs: 0,
    requiresUnproducedReturn: false,
    payable: 0,
  });

  if (gradeTotal(take) <= 0) return fail('Informe ao menos 1 par para sair desta OS');
  for (const [key, qty] of Object.entries(input.take ?? {})) {
    if (key !== 'pares' && !SIZE_KEY.test(key)) return fail('A grade só aceita numeração ou o total de pares');
    if (!Number.isInteger(Number(qty)) || Number(qty) < 0) {
      return fail('A grade só aceita pares inteiros, sem fração e sem negativo');
    }
  }
  const cap = cleanGrade(input.movable);
  for (const key of gradeSizeKeys(take)) {
    if ((take[key] || 0) > (cap[key] || 0)) {
      return fail(`O tamanho ${key === 'pares' ? 'pares' : key} passa do saldo: ${take[key]} de ${cap[key] || 0}`);
    }
  }
  if (gradeTotal(take) > unsent + street) {
    return fail(`Só dá para mover ${unsent + street} pares. O restante já voltou como produção`);
  }

  if (input.moves.length === 0) return fail('Inclua ao menos um destino');
  const destGrades: SizeGrade[] = [];
  for (const move of input.moves) {
    if (!move.internal && !move.contractorId) return fail('Escolha o prestador de destino');
    if (move.internal && move.contractorId) return fail('Produção interna não leva prestador');
    for (const [key, qty] of Object.entries(move.grade ?? {})) {
      if (key !== 'pares' && !SIZE_KEY.test(key)) return fail('A grade só aceita numeração ou o total de pares');
      if (!Number.isInteger(Number(qty)) || Number(qty) < 0) {
        return fail('A grade só aceita pares inteiros, sem fração e sem negativo');
      }
    }
    const grade = cleanGrade(move.grade);
    if (gradeTotal(grade) <= 0) return fail('Cada destino precisa de ao menos 1 par');
    destGrades.push(grade);
  }
  const sum = addGrades(destGrades);
  if (!gradesEqual(sum, take)) {
    return fail('A soma dos destinos não fecha o total que sai da OS');
  }

  const fromUnsent = Math.min(unsent, gradeTotal(take));
  const fromStreet = gradeTotal(take) - fromUnsent;
  if (fromStreet > street) return fail('A rua não tem esses pares para devolver');
  return {
    ok: true,
    error: null,
    take,
    unsentPairs: fromUnsent,
    streetPairs: fromStreet,
    requiresUnproducedReturn: fromStreet > 0,
    payable: 0,
  };
}

export function returnDateForPairs(
  today: string,
  pairs: number,
  capacityPerDay: number | null | undefined,
  fallbackDays = 5,
): string | null {
  const qty = Math.max(0, Math.trunc(Number(pairs) || 0));
  if (qty <= 0) return today;
  const cap = Number(capacityPerDay);
  const days = cap > 0 ? Math.ceil(qty / cap) : Math.max(0, Math.trunc(fallbackDays));
  return addFactoryBusinessDays(today, days);
}

export function capacityAlert(pairs: number, capacityPerDay: number | null | undefined): string | null {
  const cap = Number(capacityPerDay);
  return contractorWeekOverCapacity(Math.max(0, Math.trunc(Number(pairs) || 0)), cap > 0 ? cap : null);
}

/** O relatório lê este efeito. Devolução sem produção volta o kit e não vira conta. */
export function reportMovementEffect(
  source: 'dispatch' | 'return',
  kind: string | null | undefined,
  reversesReturnId: string | null | undefined,
): ReportMovementEffect {
  if (source === 'dispatch') {
    return { physicalSign: 1, payableSign: 0, countsAsProduced: false, kind: 'envio' };
  }
  if (reversesReturnId || kind === 'reversal') {
    return { physicalSign: -1, payableSign: 0, countsAsProduced: false, kind: 'estorno' };
  }
  if (kind === 'scrap') {
    return { physicalSign: 0, payableSign: 0, countsAsProduced: false, kind: 'descarte' };
  }
  if (kind === 'unproduced_return') {
    return { physicalSign: 1, payableSign: 0, countsAsProduced: false, kind: 'devolucao_sem_producao' };
  }
  if (kind === 'rework_return') {
    return { physicalSign: 1, payableSign: 0, countsAsProduced: false, kind: 'retrabalho' };
  }
  return { physicalSign: 1, payableSign: 1, countsAsProduced: true, kind: 'retorno' };
}

export function reportPendingDelta(input: {
  source: 'dispatch' | 'return';
  kind: string | null;
  reversesReturnId: string | null;
  qtyDispatched: number;
  qtyGood: number;
  qtyDefect: number;
  qtyLoss: number;
}): number {
  const effect = reportMovementEffect(input.source, input.kind, input.reversesReturnId);
  if (input.source === 'dispatch') return Math.trunc(Number(input.qtyDispatched) || 0);
  const pairs = Math.trunc(Number(input.qtyGood) || 0)
    + Math.trunc(Number(input.qtyDefect) || 0)
    + Math.trunc(Number(input.qtyLoss) || 0);
  return -effect.physicalSign * pairs;
}
