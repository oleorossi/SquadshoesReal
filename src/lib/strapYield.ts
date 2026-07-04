/**
 * Calculadora de Tiras — RENDIMENTO de corte artesanal (tira reta, 1D).
 *
 * Responde: "quantos metros de tira eu tiro de cada metro linear do material?".
 * É a direção FORWARD (rendimento a partir do rolo). O motor do PV
 * (`strapRollCut.ts`) roda a direção INVERSA (dada a demanda em metros, quanto
 * cortar da largura do rolo). São a MESMA matemática 1D: `largura ÷ largura`
 * menos perda. Esta lib é totalmente parametrizada (o usuário preenche tudo),
 * mas os DEFAULTS vêm das constantes canônicas de `strapRollCut.ts` — então,
 * com dados idênticos ao rolo real (1370 mm × 40 m, 15% de perda), o rendimento
 * bate EXATAMENTE com o corte que o PV mostra. A parity está travada em
 * `strapYield.test.ts` (não regredir).
 *
 * Diferente do motor de consumo por GRADE (peças com formato: cabedal, forração,
 * palmilha), que precisa de área/encaixe. Tira reta não: rende `piso(Lm/Lt)`
 * tiras na largura, cada uma com o comprimento inteiro do rolo.
 */

import { ROLO_LARGURA_MM, ROLO_COMPRIMENTO_M, PERDA_PCT } from '@/lib/strapRollCut';

/**
 * Defaults do formulário = rolo canônico de tira artesanal. Referenciam as
 * constantes de `strapRollCut.ts` de propósito: se o rolo padrão mudar lá, o
 * default da calculadora acompanha (e a parity continua válida). Todos editáveis.
 */
export const STRAP_YIELD_DEFAULTS = {
  /** Largura útil do material (mm). Default = largura do rolo canônico (1370 mm). */
  larguraMaterialMm: ROLO_LARGURA_MM,
  /** Comprimento do rolo (m). Default = comprimento do rolo canônico (40 m). */
  comprimentoRoloM: ROLO_COMPRIMENTO_M,
  /** Perda de processo (%). Default = perda canônica do rolo (15%). */
  perdaPct: PERDA_PCT * 100,
  /** Kerf (mm). Corte a estilete é desprezível → 0. */
  kerfMm: 0,
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
  /** `K` — espessura de corte / kerf (mm). Opcional, default 0. */
  kerfMm?: number;
  /** `Cml` — custo por metro linear do material (R$/m). Opcional (camada de custo). */
  custoMetroLinear?: number | null;
  /** Tira usada por par, em mm no total (nº de tiras × comprimento). Opcional. */
  mmTiraPar?: number | null;
}

export interface StrapYieldResult {
  /** `false` quando a entrada é inválida — `error` explica; os números ficam 0. */
  valid: boolean;
  /** Mensagem de validação (pt-BR) quando `valid` é `false`. */
  error?: string;
  /** `N` — nº de tiras inteiras que cabem na largura. */
  N: number;
  /** Sobra da borda (retalho) em mm — a largura que não fecha uma tira inteira. */
  sobraLarguraMm: number;
  /** Aproveitamento geométrico da largura (%). */
  aprovGeoPct: number;
  /** Fator de processo (`1 − P/100`), exposto pra auditoria. */
  fatorProcesso: number;
  /** `MTpm_bruto` — metros de tira por metro linear, sem perda de processo (= N). */
  mtPorMetroBruto: number;
  /** `MTpm_liq` — metros de tira por metro linear, líquido de perda. NÚMERO-HERÓI. */
  mtPorMetroLiq: number;
  /** Total de tira no rolo inteiro, bruto (m). */
  mtTotalBruto: number;
  /** Total de tira no rolo inteiro, líquido de perda (m). */
  mtTotalLiq: number;
  /** Perda geométrica (%) — sobra da borda; `100 − aprov_geo`. */
  perdaGeoPct: number;
  /** Perda de processo (%) — o `P` informado. */
  perdaProcessoPct: number;
  /** Perda total efetiva (%) — geométrica + processo sobre o material bruto. */
  perdaTotalPct: number;
  /** Custo por metro de tira (R$/m), quando `custoMetroLinear` foi informado. */
  custoMetroTira?: number | null;
  /** Custo de tira por par (R$/par), quando `mmTiraPar` também foi informado. */
  custoTiraPar?: number | null;
}

const EMPTY: Omit<StrapYieldResult, 'valid' | 'error'> = {
  N: 0,
  sobraLarguraMm: 0,
  aprovGeoPct: 0,
  fatorProcesso: 1,
  mtPorMetroBruto: 0,
  mtPorMetroLiq: 0,
  mtTotalBruto: 0,
  mtTotalLiq: 0,
  perdaGeoPct: 0,
  perdaProcessoPct: 0,
  perdaTotalPct: 0,
  custoMetroTira: null,
  custoTiraPar: null,
};

function fail(error: string): StrapYieldResult {
  return { valid: false, error, ...EMPTY };
}

/**
 * Calcula o rendimento de tira. Degrada com elegância: entrada inválida →
 * `valid:false` + `error` (não lança), pra ser seguro no cálculo reativo ao
 * digitar. Cálculo interno em precisão total; a UI arredonda na exibição.
 */
export function computeStrapYield(input: StrapYieldInput): StrapYieldResult {
  const Lm = Number(input.larguraMaterialMm) || 0;
  const Lt = Number(input.larguraTiraMm) || 0;
  const P = Number(input.perdaPct) || 0;
  const Cr = Number(input.comprimentoRoloM) || 0;
  const K = Number(input.kerfMm) || 0;

  // Validação (espelha §9 do PRD).
  if (!(Lm > 0)) return fail('Informe a largura útil do material.');
  if (!(Lt > 0)) return fail('Informe a largura da tira.');
  if (!(Cr > 0)) return fail('Informe o comprimento do rolo.');
  if (K < 0) return fail('Kerf não pode ser negativo.');
  if (Lt >= Lm) return fail('A largura da tira é maior que a largura do material.');
  if (P < 0 || P >= 100) return fail('A perda deve estar entre 0 e 100%.');

  // Núcleo 1D. Kerf entra dos dois lados da divisão (consome material entre e
  // após as tiras); com K=0 vira o piso(Lm/Lt) clássico.
  const N = Math.floor((Lm + K) / (Lt + K));
  if (N < 1) return fail('A largura da tira é maior que a largura do material.');

  const sobraLarguraMm = Lm - N * Lt - Math.max(N - 1, 0) * K;
  const aprovGeo = (N * Lt) / Lm; // fração 0–1
  const fatorProcesso = 1 - P / 100;

  const mtPorMetroBruto = N;
  const mtPorMetroLiq = N * fatorProcesso;
  const mtTotalBruto = N * Cr;
  const mtTotalLiq = N * Cr * fatorProcesso;
  const perdaTotal = 1 - aprovGeo * fatorProcesso; // fração 0–1

  const result: StrapYieldResult = {
    valid: true,
    N,
    sobraLarguraMm,
    aprovGeoPct: aprovGeo * 100,
    fatorProcesso,
    mtPorMetroBruto,
    mtPorMetroLiq,
    mtTotalBruto,
    mtTotalLiq,
    perdaGeoPct: (1 - aprovGeo) * 100,
    perdaProcessoPct: P,
    perdaTotalPct: perdaTotal * 100,
    custoMetroTira: null,
    custoTiraPar: null,
  };

  // Camada de custo (pré-costing). Usa o rendimento LÍQUIDO: paga-se o metro
  // inteiro do material, mas só o que vira tira útil conta.
  const Cml = input.custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0 && mtPorMetroLiq > 0) {
    const custoMetroTira = Number(Cml) / mtPorMetroLiq;
    result.custoMetroTira = custoMetroTira;
    const mmPar = input.mmTiraPar;
    if (mmPar != null && Number.isFinite(Number(mmPar)) && Number(mmPar) >= 0) {
      result.custoTiraPar = (Number(mmPar) / 1000) * custoMetroTira;
    }
  }

  return result;
}
