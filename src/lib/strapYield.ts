/**
 * Calculadora de Tiras — RENDIMENTO de corte (metragem de tira por metro linear).
 *
 * Modelo (definido pelo Leonardo em 2026-07-04): rendimento CONTÍNUO, sem piso —
 *   metragem_por_metro_linear = (Lm / Lt) × (1 − perda%)
 * Ex.: 1370 mm ÷ 20 mm × (1 − 15%) = 68,5 × 0,85 = **58,225 m** de tira por metro
 * linear de material. No rolo inteiro: × comprimento do rolo.
 *
 * ⚠ INTENCIONALMENTE diferente do motor de corte do PV (`strapRollCut.ts`), que conta
 * BANDAS inteiras (piso) para dizer quanto cortar da largura do rolo. Aqui a régua é a
 * razão de larguras (idealizada, sem piso) — é o que o usuário quer para orçar
 * rendimento e custo de material, não o corte físico banda-a-banda. Os DEFAULTS dos
 * campos ainda vêm do rolo canônico (1370 mm × 40 m, 15%) via constantes de strapRollCut.
 */
import { ROLO_LARGURA_MM, ROLO_COMPRIMENTO_M, PERDA_PCT } from '@/lib/strapRollCut';

/** Defaults do formulário = rolo canônico de tira artesanal. Todos editáveis. */
export const STRAP_YIELD_DEFAULTS = {
  /** Largura útil do material (mm). Default = largura do rolo canônico (1370 mm). */
  larguraMaterialMm: ROLO_LARGURA_MM,
  /** Comprimento do rolo (m). Default = comprimento do rolo canônico (40 m). */
  comprimentoRoloM: ROLO_COMPRIMENTO_M,
  /** Perda de processo (%). Default = perda canônica do rolo (15%). */
  perdaPct: PERDA_PCT * 100,
} as const;

export interface StrapYieldInput {
  /** `Lm` — largura útil do material (mm). */
  larguraMaterialMm: number;
  /** `Lt` — largura da tira (mm). */
  larguraTiraMm: number;
  /** `P` — perda de processo (%). */
  perdaPct: number;
  /** `Cr` — comprimento do rolo (m). */
  comprimentoRoloM: number;
  /** `Cml` — custo por metro linear do material comprado (R$/m). Opcional. */
  custoMetroLinear?: number | null;
}

export interface StrapYieldResult {
  /** `false` quando a entrada é inválida — `error` explica; os números ficam 0. */
  valid: boolean;
  /** Mensagem de validação (pt-BR) quando `valid` é `false`. */
  error?: string;
  /** `Lm/Lt` — metragem de tira por metro linear, SEM perda (bruto). */
  metragemPorMetroBruto: number;
  /** `(Lm/Lt)×(1−P/100)` — metragem por metro linear, líquida. NÚMERO-HERÓI. */
  metragemPorMetroLiq: number;
  /** Perda aplicada (%), ecoada pra exibição. */
  perdaPct: number;
  /** metragem líquida × comprimento do rolo — total de tira no rolo (m). */
  totalRoloLiq: number;
  /** metragem bruta × comprimento do rolo — total sem perda (m). */
  totalRoloBruto: number;
  /** `Cml × Cr` — quanto se gasta no material do rolo (quando custo informado). */
  custoMaterialRolo?: number | null;
  /** `Cml ÷ metragem líquida` — custo de material por metro de tira (R$/m). */
  custoPorMetroTira?: number | null;
}

const EMPTY: Omit<StrapYieldResult, 'valid' | 'error'> = {
  metragemPorMetroBruto: 0,
  metragemPorMetroLiq: 0,
  perdaPct: 0,
  totalRoloLiq: 0,
  totalRoloBruto: 0,
  custoMaterialRolo: null,
  custoPorMetroTira: null,
};

function fail(error: string): StrapYieldResult {
  return { valid: false, error, ...EMPTY };
}

/**
 * Calcula o rendimento (metragem) de tira. Degrada com elegância: entrada inválida →
 * `valid:false` + `error` (não lança). Cálculo interno em precisão total; a UI arredonda.
 */
export function computeStrapYield(input: StrapYieldInput): StrapYieldResult {
  const Lm = Number(input.larguraMaterialMm) || 0;
  const Lt = Number(input.larguraTiraMm) || 0;
  const P = Number(input.perdaPct) || 0;
  const Cr = Number(input.comprimentoRoloM) || 0;

  if (!(Lm > 0)) return fail('Informe a largura útil do material.');
  if (!(Lt > 0)) return fail('Informe a largura da tira.');
  if (!(Cr > 0)) return fail('Informe o comprimento do rolo.');
  if (Lt >= Lm) return fail('A largura da tira é maior que a largura do material.');
  if (P < 0 || P >= 100) return fail('A perda deve estar entre 0 e 100%.');

  const fator = 1 - P / 100;
  const metragemPorMetroBruto = Lm / Lt; // razão de larguras, sem piso
  const metragemPorMetroLiq = metragemPorMetroBruto * fator;
  const totalRoloBruto = metragemPorMetroBruto * Cr;
  const totalRoloLiq = metragemPorMetroLiq * Cr;

  const result: StrapYieldResult = {
    valid: true,
    metragemPorMetroBruto,
    metragemPorMetroLiq,
    perdaPct: P,
    totalRoloLiq,
    totalRoloBruto,
    custoMaterialRolo: null,
    custoPorMetroTira: null,
  };

  // Custo do material: quanto se gasta no rolo + custo por metro de tira produzida.
  const Cml = input.custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0) {
    result.custoMaterialRolo = Number(Cml) * Cr;
    if (metragemPorMetroLiq > 0) result.custoPorMetroTira = Number(Cml) / metragemPorMetroLiq;
  }

  return result;
}
