/**
 * Custo de MÃO DE OBRA por par, detalhado por SETOR e baseado em TEMPO.
 *
 * Fonte da verdade da fórmula exibida na aba "MOD por Setor" do Markup
 * (src/components/financial/SectorPricingCalculator.tsx) e salva em
 * `reference_sector_pricing`.
 *
 * Princípio: o custo de MO de um par num setor é o tempo gasto naquele setor
 * (minutos/par) multiplicado pelo custo-hora do setor:
 *
 *   custo/par do setor = (tempo_min / 60) × custo_hora
 *   MOD/par da referência = Σ (custo/par de cada setor pelo qual ela passa)
 *
 * O custo-hora default vem de `sector_labor_rates` (salário ÷ 220, sem encargos
 * — mesma base da folha; ver hourlyFromSalary). Cada referência pode
 * sobrescrever o custo-hora por setor.
 *
 * O tempo/par pode ser digitado direto OU derivado da CAPACIDADE do setor:
 * uma capacidade de N pares/dia (jornada de H horas) ⇒ tempo/par = H×60 / N.
 * As capacidades por setor moram em `technical_sheets.*_capacity_per_day`
 * (por ficha), quando cadastradas.
 *
 * Todas as funções clampam entradas negativas/inválidas a 0 — nunca produzem
 * custo negativo nem NaN (entrada vazia/—).
 */

/** Jornada-padrão da fábrica (horas/dia) usada na conversão capacidade→tempo. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** Coage qualquer entrada a um número finito ≥ 0 (vazio/NaN/negativo → 0). */
function nonNeg(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Tempo por par (minutos) derivado da capacidade de um setor.
 * capacidade de N pares/dia, jornada de H horas ⇒ (H × 60) / N minutos por par.
 * Capacidade 0/inválida ⇒ 0 (não dá pra derivar).
 */
export function minutesPerPairFromCapacity(
  capacityPerDay: number,
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
): number {
  const cap = nonNeg(capacityPerDay);
  const hours = nonNeg(hoursPerDay);
  if (cap === 0 || hours === 0) return 0;
  return (hours * 60) / cap;
}

/**
 * Custo de MO de um par num setor: (tempo_min / 60) × custo_hora.
 * Tempo ou custo 0 ⇒ custo 0. Negativos são clampados.
 */
export function sectorCostPerPair(timePerPairMin: number, costPerHour: number): number {
  return (nonNeg(timePerPairMin) / 60) * nonNeg(costPerHour);
}

/** Linha de cálculo de MOD por setor. */
export interface SectorPricingRow {
  sectorKey: string;
  timePerPairMin: number;
  costPerHour: number;
}

/** Custo de MOD por par de uma única linha (setor). */
export function rowCost(row: SectorPricingRow): number {
  return sectorCostPerPair(row.timePerPairMin, row.costPerHour);
}

/**
 * Custo total de MOD por par = soma dos custos por setor.
 * Linhas sem setor/tempo/custo contribuem 0 (não quebram a soma).
 */
export function totalModPerPair(rows: SectorPricingRow[]): number {
  return (rows ?? []).reduce((acc, r) => acc + rowCost(r), 0);
}

/** Quantos setores têm contribuição real (> 0) — pro resumo "(Y setores)". */
export function countActiveSectors(rows: SectorPricingRow[]): number {
  return (rows ?? []).filter((r) => rowCost(r) > 0).length;
}
