/**
 * Planejador de corte intermediário no bloco “Napa para tiras”.
 *
 * Só planejamento de bancada: metros do rolo → altura a cortar (bandas inteiras),
 * simulação “e se cortar nesta altura?”, multi-rolo e conferência pelo rendimento
 * cadastrado. NÃO altera consumo oficial (tira ÷ confirmed_yield).
 *
 * Geometria do inverso reaproveita `computeStrapMaterialNeeded` SEM rendimento
 * confirmado — a altura é empacotamento físico de bandas; o yield só aparece na
 * linha de conferência.
 */
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
} from '@/lib/strapRollCut';
import { computeStrapMaterialNeeded } from '@/lib/strapYield';

export { ROLO_COMPRIMENTO_M, ROLO_LARGURA_MM };

export interface StrapCutPlanInput {
  /** Metros de tira necessários (linha do PV). */
  strapNeededM: number;
  /** Comprimento do rolo (m). */
  rollLengthM: number;
  /** Largura da banda de corte da receita (mm). */
  bandMm: number;
  /** Largura útil do material / rolo (mm). */
  usableWidthMm: number;
}

export interface StrapCutPlanResult {
  valid: boolean;
  error?: string;
  /** Bandas inteiras a cortar (= ceil(tira ÷ rolo)). */
  bandsNeeded: number;
  /** Altura total se coubesse num único rolo (bandas × banda mm). */
  heightMm: number;
  /** Bandas físicas que cabem na largura útil. */
  bandsPerRoll: number;
  /** Rolos físicos a abrir. */
  rolls: number;
  /**
   * Altura no último rolo (mm). 0 quando o último é “cheio”
   * (múltiplo exato de bandasPorRolo) — a UI trata como rolo completo.
   */
  heightOnLastRollMm: number;
  /** true quando precisa de mais de um rolo. */
  multiRoll: boolean;
  /** Metros de tira que as bandas inteiras de fato produzem (≥ necessidade). */
  strapProducedM: number;
  /** Sobra de tira por arredondamento de banda. */
  strapSurplusM: number;
}

export interface StrapCutSimulateInput {
  /** Altura (faixa intermediária) a simular, em mm. */
  heightMm: number;
  rollLengthM: number;
  bandMm: number;
  usableWidthMm: number;
  /** Necessidade da linha — para dizer se cobre. */
  strapNeededM: number;
}

export interface StrapCutSimulateResult {
  valid: boolean;
  error?: string;
  bandsInHeight: number;
  /** Metros de tira de UM rolo cortado nessa altura. */
  strapPerRollM: number;
  /** Rolos necessários para cobrir a necessidade (0 se inválido / sem tira). */
  rollsToCover: number;
  /** true se 1 rolo nessa altura já cobre a necessidade. */
  coversInOneRoll: boolean;
  /** true se a altura passa da largura útil. */
  exceedsUsableWidth: boolean;
}

function failPlan(error: string): StrapCutPlanResult {
  return {
    valid: false,
    error,
    bandsNeeded: 0,
    heightMm: 0,
    bandsPerRoll: 0,
    rolls: 0,
    heightOnLastRollMm: 0,
    multiRoll: false,
    strapProducedM: 0,
    strapSurplusM: 0,
  };
}

function failSim(error: string): StrapCutSimulateResult {
  return {
    valid: false,
    error,
    bandsInHeight: 0,
    strapPerRollM: 0,
    rollsToCover: 0,
    coversInOneRoll: false,
    exceedsUsableWidth: false,
  };
}

/**
 * Inverso: dado o comprimento do rolo, qual altura (faixa) cortar para cobrir
 * a metragem de tira — só bandas inteiras; multi-rolo quando passa da largura útil.
 */
export function planStrapCutHeight(input: StrapCutPlanInput): StrapCutPlanResult {
  const needed = computeStrapMaterialNeeded({
    larguraMaterialMm: input.usableWidthMm,
    larguraTiraMm: input.bandMm,
    comprimentoRoloM: input.rollLengthM,
    tiraDesejadaM: input.strapNeededM,
    // Sem rendimento confirmado: altura = geometria pura de bandas.
  });

  if (!needed.valid) {
    return failPlan(needed.error || 'Não foi possível calcular o plano de corte.');
  }

  const bandsNeeded = needed.tirasInteiras;
  const bandsPerRoll = needed.bandasCompletas;
  const rolls = needed.rolosRealInteiros;
  const remainderBands = bandsPerRoll > 0 ? bandsNeeded % bandsPerRoll : 0;

  return {
    valid: true,
    bandsNeeded,
    heightMm: needed.larguraRealMm,
    bandsPerRoll,
    rolls,
    heightOnLastRollMm: remainderBands * (Number(input.bandMm) || 0),
    multiRoll: needed.passaLargura || rolls > 1,
    strapProducedM: needed.tiraLiquidaRealM,
    strapSurplusM: needed.sobraTiraM,
  };
}

/**
 * Simulação: “e se eu cortar nesta altura?” → metros de tira por rolo e se cobre.
 */
export function simulateStrapFromHeight(input: StrapCutSimulateInput): StrapCutSimulateResult {
  const H = Number(input.heightMm);
  const Cr = Number(input.rollLengthM);
  const Lt = Number(input.bandMm);
  const Lm = Number(input.usableWidthMm);
  const T = Number(input.strapNeededM);

  if (!Number.isFinite(H) || !(H > 0)) return failSim('Informe a altura de corte.');
  if (!Number.isFinite(Cr) || !(Cr > 0)) return failSim('Informe o comprimento do rolo.');
  if (!Number.isFinite(Lt) || !(Lt > 0)) return failSim('Informe a largura da banda de corte.');
  if (!Number.isFinite(Lm) || !(Lm > 0)) return failSim('Informe a largura útil do material.');
  if (Lt > Lm) return failSim('A largura da banda de corte é maior que a largura do material.');

  const bandsInHeight = Math.floor(H / Lt);
  if (bandsInHeight < 1) {
    return failSim('A altura informada não comporta uma banda completa.');
  }

  const exceedsUsableWidth = H > Lm;
  const strapPerRollM = bandsInHeight * Cr;
  const rollsToCover = strapPerRollM > 0 && Number.isFinite(T) && T > 0
    ? Math.ceil(T / strapPerRollM)
    : 0;
  const coversInOneRoll = Number.isFinite(T) && T > 0
    ? strapPerRollM >= T
    : false;

  return {
    valid: true,
    bandsInHeight,
    strapPerRollM,
    rollsToCover,
    coversInOneRoll,
    exceedsUsableWidth,
  };
}

/**
 * Conferência só-leitura: metros de napa pelo rendimento cadastrado
 * (espelha a coluna Napa oficial). `null` quando não há yield.
 */
export function napaFromConfirmedYield(
  strapNeededM: number,
  confirmedYieldMPerM: number | null | undefined,
): number | null {
  const T = Number(strapNeededM);
  const Y = Number(confirmedYieldMPerM);
  if (!Number.isFinite(T) || !(T > 0)) return null;
  if (!Number.isFinite(Y) || !(Y > 0)) return null;
  return T / Y;
}

/** Texto do breakdown multi-rolo para a UI do planejador. */
export function strapCutRollBreakdownLabel(plan: StrapCutPlanResult): string | null {
  if (!plan.valid || plan.rolls < 1) return null;
  if (!plan.multiRoll && plan.rolls === 1) return null;

  const n = plan.rolls;
  if (plan.heightOnLastRollMm <= 0) {
    return `${n} rolo${n === 1 ? '' : 's'} completo${n === 1 ? '' : 's'} (${plan.bandsPerRoll} bandas cada)`;
  }

  const full = n - 1;
  if (full <= 0) {
    return `1 rolo · ${plan.heightOnLastRollMm.toLocaleString('pt-BR')} mm`;
  }
  const fullLabel = `${full} rolo${full === 1 ? '' : 's'} completo${full === 1 ? '' : 's'}`;
  return `${fullLabel} + ${plan.heightOnLastRollMm.toLocaleString('pt-BR')} mm no próximo`;
}
