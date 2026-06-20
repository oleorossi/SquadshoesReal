/**
 * Custo de MÃO DE OBRA por par, detalhado por SETOR e baseado em PRODUTIVIDADE
 * (pares por hora).
 *
 * Fonte da verdade da fórmula exibida na aba "MOD por Setor" do Markup
 * (src/components/financial/SectorPricingCalculator.tsx) e salva em
 * `reference_sector_pricing`.
 *
 * Princípio: o custo de MO de um par num setor é o custo-hora do setor dividido
 * pela produtividade (quantos pares saem por hora naquele setor):
 *
 *   custo/par do setor = custo_hora / pares_por_hora
 *   MOD/par da referência = Σ (custo/par de cada setor pelo qual ela passa)
 *
 * Pares/hora (em vez de minutos/par) porque a amostragem é maior — o operador
 * conta quantos pares saem numa hora, o que dá mais previsibilidade que cronometrar
 * um par.
 *
 * O custo-hora default vem de `sector_labor_rates` (salário ÷ 220, sem encargos
 * — mesma base da folha; ver hourlyFromSalary). Cada referência pode
 * sobrescrever o custo-hora por setor.
 *
 * Pares/hora pode ser digitado direto OU derivado da CAPACIDADE do setor:
 * uma capacidade de N pares/dia (jornada de H horas) ⇒ pares/hora = N / H.
 * As capacidades por setor moram em `technical_sheets.*_capacity_per_day`
 * (por ficha), quando cadastradas.
 *
 * Todas as funções clampam entradas negativas/inválidas a 0 — nunca produzem
 * custo negativo nem NaN (entrada vazia/—). Produtividade 0 ⇒ custo 0 (setor
 * sem capacidade definida, sinalizado na UI).
 */

/** Jornada-padrão da fábrica (horas/dia) usada na conversão capacidade→pares/hora. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** Coage qualquer entrada a um número finito ≥ 0 (vazio/NaN/negativo → 0). */
function nonNeg(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Pares por hora derivado da capacidade de um setor.
 * Capacidade de N pares/dia, jornada de H horas ⇒ N / H pares por hora.
 * Capacidade 0/inválida ⇒ 0 (não dá pra derivar).
 */
export function pairsPerHourFromCapacity(
  capacityPerDay: number,
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
): number {
  const cap = nonNeg(capacityPerDay);
  const hours = nonNeg(hoursPerDay);
  if (cap === 0 || hours === 0) return 0;
  return cap / hours;
}

/**
 * Custo de MO de um par num setor: custo_hora / pares_por_hora.
 * Produtividade 0 (setor sem capacidade) ⇒ custo 0. Negativos são clampados.
 */
export function sectorCostPerPair(pairsPerHour: number, costPerHour: number): number {
  const pph = nonNeg(pairsPerHour);
  if (pph === 0) return 0;
  return nonNeg(costPerHour) / pph;
}

/**
 * Pares por dia = pares_por_hora × jornada. Projeção pra avaliar rendimento de
 * diarista (quantos pares ele entrega num dia). Produtividade 0 ⇒ 0.
 */
export function pairsPerDay(pairsPerHour: number, hoursPerDay: number = DEFAULT_HOURS_PER_DAY): number {
  return nonNeg(pairsPerHour) * nonNeg(hoursPerDay);
}

/**
 * Diária equivalente = custo_hora × jornada. Quanto custaria um dia de trabalho
 * naquele setor pelo custo-hora vigente — pra comparar com prestador diarista.
 * Depende SÓ do custo-hora (independe da produtividade). Custo-hora 0 ⇒ 0.
 */
export function dailyRate(costPerHour: number, hoursPerDay: number = DEFAULT_HOURS_PER_DAY): number {
  return nonNeg(costPerHour) * nonNeg(hoursPerDay);
}

/** Linha de cálculo de MOD por setor. */
export interface SectorPricingRow {
  sectorKey: string;
  pairsPerHour: number;
  costPerHour: number;
}

/** Custo de MOD por par de uma única linha (setor). */
export function rowCost(row: SectorPricingRow): number {
  return sectorCostPerPair(row.pairsPerHour, row.costPerHour);
}

/**
 * Custo total de MOD por par = soma dos custos por setor.
 * Linhas sem setor/produtividade/custo contribuem 0 (não quebram a soma).
 */
export function totalModPerPair(rows: SectorPricingRow[]): number {
  return (rows ?? []).reduce((acc, r) => acc + rowCost(r), 0);
}

/** Quantos setores têm contribuição real (> 0) — pro resumo "(Y setores)". */
export function countActiveSectors(rows: SectorPricingRow[]): number {
  return (rows ?? []).filter((r) => rowCost(r) > 0).length;
}

/**
 * Diária total/dia = soma das diárias dos setores ATIVOS (com pares_por_hora > 0,
 * i.e. que fazem parte do fluxo desta referência). Setor sem produtividade não
 * entra (não é usado). Pra comparar o custo diário de uma equipe de diaristas.
 */
export function totalDailyRate(rows: SectorPricingRow[], hoursPerDay: number = DEFAULT_HOURS_PER_DAY): number {
  return (rows ?? [])
    .filter((r) => nonNeg(r.pairsPerHour) > 0)
    .reduce((acc, r) => acc + dailyRate(r.costPerHour, hoursPerDay), 0);
}
