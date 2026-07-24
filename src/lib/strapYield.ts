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

/* ─────────────────────────── Cálculo inverso ─────────────────────────────────
 * "Quanto preciso": dada a METRAGEM DE TIRA PRONTA desejada, quanto da LARGURA do
 * rolo é preciso cortar — e, de contexto, quanto material linear e quantos rolos.
 * Mesma geometria do direto (largura do material, largura da tira, perda), só que
 * resolvida ao contrário.
 *
 * O corte físico fixa o COMPRIMENTO do rolo e fatia uma FAIXA da largura: cada tira
 * de `Lt` mm, cortada no comprimento cheio `Cr`, rende `Cr` m de tira (menos perda).
 * A conta sai em DOIS PASSOS (é assim que a UI exibe, pedido do Leonardo 2026-07-24):
 *
 *   1) largura BRUTA   (mm) = tira_desejada × Lt ÷ Cr          ← sem perda
 *   2) largura A CORTAR(mm) = largura_bruta ÷ (1 − perda%)     ← a perda AUMENTA
 *
 * Ex.: 80 m de tira 18 mm, rolo 40 m → bruto 36 mm → com 15% de perda, corta 42,4 mm.
 * A soma de TODAS as tiras da faixa é `tiraBrutaTotalM` = T ÷ (1−perda%) (= tiras × Cr),
 * dos quais `tiraDesejadaM` sobra aproveitável.
 *
 * Ex.: preciso de 1000 m de tira 18 mm, material 1370 mm, perda 15%, rolo 40 m →
 * 1000 × 18 ÷ (40 × 0,85) = 529,4 mm de largura (≈ 29,4 tiras). Isso equivale a
 * 15,458 m de material linear (largura cheia) = 0,39 rolo. A perda já entra na
 * conta (divide pela taxa líquida), então mais perda = mais largura — como esperado.
 *
 * Invariante: `larguraCortarMm = rolosNecessarios × Lm` (a faixa é a fração do rolo).
 * Quando `larguraCortarMm > Lm`, um único comprimento de rolo não basta — é preciso
 * mais de um rolo (`passaLargura = true`; a UI alerta e usa `rolosInteiros`).
 */

export interface StrapMaterialNeededInput extends StrapYieldInput {
  /** `T` — metros de tira pronta que se precisa produzir. */
  tiraDesejadaM: number;
}

export interface StrapMaterialNeededResult {
  /** `false` quando a entrada é inválida — `error` explica; os números ficam 0. */
  valid: boolean;
  /** Mensagem de validação (pt-BR) quando `valid` é `false`. */
  error?: string;
  /** `Lm/Lt` — metragem de tira por metro linear, SEM perda (bruto). */
  metragemPorMetroBruto: number;
  /** `(Lm/Lt)×(1−P/100)` — taxa líquida usada na conta (m de tira / m linear). */
  metragemPorMetroLiq: number;
  /** Perda aplicada (%), ecoada pra exibição. */
  perdaPct: number;
  /** Metragem de tira pronta desejada (m), ecoada. */
  tiraDesejadaM: number;
  /** `T × Lt ÷ Cr` — largura BRUTA (mm): a faixa que bastaria se não houvesse
   *  perda. É o 1º passo da conta; a perda depois AUMENTA esse valor. */
  larguraCortarBrutaMm: number;
  /** `T × Lt ÷ (Cr × (1−P/100))` — faixa da LARGURA do rolo a cortar (mm), no
   *  comprimento cheio, JÁ com a perda. NÚMERO-HERÓI do modo inverso. */
  larguraCortarMm: number;
  /** `larguraCortarMm − larguraCortarBrutaMm` — quanto a perda acrescenta (mm). */
  larguraExtraPerdaMm: number;
  /** `T ÷ (1−P/100)` = `tirasNecessarias × Cr` — soma de TODAS as tiras cortadas
   *  da faixa, em metros brutos (antes de descontar a perda). */
  tiraBrutaTotalM: number;
  /** `larguraCortarMm ÷ Lt` — nº de tiras (fracionário) que a faixa rende. */
  tirasNecessarias: number;
  /** `larguraCortarMm ÷ Lm × 100` — % da largura do rolo ocupada pela faixa
   *  (= `rolosNecessarios × 100`). Pode passar de 100 quando exige mais de 1 rolo. */
  larguraPctDoRolo: number;
  /** `true` quando a faixa passa da largura do rolo (precisa de mais de 1 rolo). */
  passaLargura: boolean;
  /** `T ÷ taxa líquida` — metros lineares de material necessários (largura cheia). */
  materialNecessarioM: number;
  /** `material ÷ comprimento do rolo` = `larguraCortarMm ÷ Lm` — rolos (fracionário). */
  rolosNecessarios: number;
  /** `ceil(rolosNecessarios)` — rolos inteiros a abrir. */
  rolosInteiros: number;
  /** `Cml × material` — custo total do material necessário. `null` sem custo informado. */
  custoMaterialNecessario: number | null;
  /** `Cml ÷ taxa líquida` — custo de material por metro de tira (R$/m). `null` sem custo. */
  custoPorMetroTira: number | null;
}

const EMPTY_NEEDED: Omit<StrapMaterialNeededResult, 'valid' | 'error'> = {
  metragemPorMetroBruto: 0,
  metragemPorMetroLiq: 0,
  perdaPct: 0,
  tiraDesejadaM: 0,
  larguraCortarBrutaMm: 0,
  larguraCortarMm: 0,
  larguraExtraPerdaMm: 0,
  tiraBrutaTotalM: 0,
  tirasNecessarias: 0,
  larguraPctDoRolo: 0,
  passaLargura: false,
  materialNecessarioM: 0,
  rolosNecessarios: 0,
  rolosInteiros: 0,
  custoMaterialNecessario: null,
  custoPorMetroTira: null,
};

function failNeeded(error: string): StrapMaterialNeededResult {
  return { valid: false, error, ...EMPTY_NEEDED };
}

/**
 * Calcula quanto da LARGURA do rolo cortar (número-herói) — mais material linear e
 * rolos de contexto — pra produzir `tiraDesejadaM` metros de tira pronta, dadas as
 * mesmas larguras/perda. Inverso de `computeStrapYield`. Degrada com elegância:
 * entrada inválida → `valid:false` + `error` (não lança). O comprimento do rolo é
 * OBRIGATÓRIO aqui, pois é ele que fixa em que comprimento a faixa é cortada.
 */
export function computeStrapMaterialNeeded(input: StrapMaterialNeededInput): StrapMaterialNeededResult {
  const Lm = Number(input.larguraMaterialMm) || 0;
  const Lt = Number(input.larguraTiraMm) || 0;
  const P = Number(input.perdaPct) || 0;
  const Cr = Number(input.comprimentoRoloM) || 0;
  const T = Number(input.tiraDesejadaM) || 0;

  if (!(Lm > 0)) return failNeeded('Informe a largura útil do material.');
  if (!(Lt > 0)) return failNeeded('Informe a largura da tira.');
  if (!(T > 0)) return failNeeded('Informe quantos metros de tira você precisa.');
  if (Lt >= Lm) return failNeeded('A largura da tira é maior que a largura do material.');
  if (!(Cr > 0)) return failNeeded('Informe o comprimento do rolo (define a largura a cortar).');
  if (P < 0 || P >= 100) return failNeeded('A perda deve estar entre 0 e 100%.');

  const fator = 1 - P / 100;
  const metragemPorMetroBruto = Lm / Lt; // razão de larguras, sem piso
  const metragemPorMetroLiq = metragemPorMetroBruto * fator;
  const materialNecessarioM = metragemPorMetroLiq > 0 ? T / metragemPorMetroLiq : 0;

  // Faixa da largura a cortar (comprimento cheio do rolo). Equivale a rolos × Lm.
  // 1º passo: largura bruta (o que bastaria sem perda). 2º passo: a perda aumenta.
  const larguraCortarBrutaMm = (T * Lt) / Cr;
  const larguraCortarMm = fator > 0 ? larguraCortarBrutaMm / fator : 0;
  const larguraExtraPerdaMm = larguraCortarMm - larguraCortarBrutaMm;
  const tirasNecessarias = larguraCortarMm / Lt;
  // Soma de todas as tiras cortadas da faixa, em metros brutos (= tiras × Cr).
  const tiraBrutaTotalM = fator > 0 ? T / fator : 0;
  const larguraPctDoRolo = Lm > 0 ? (larguraCortarMm / Lm) * 100 : 0;
  const passaLargura = larguraCortarMm > Lm;

  const rolosNecessarios = materialNecessarioM / Cr;
  const rolosInteiros = Math.ceil(rolosNecessarios);

  const result: StrapMaterialNeededResult = {
    valid: true,
    metragemPorMetroBruto,
    metragemPorMetroLiq,
    perdaPct: P,
    tiraDesejadaM: T,
    larguraCortarBrutaMm,
    larguraCortarMm,
    larguraExtraPerdaMm,
    tiraBrutaTotalM,
    tirasNecessarias,
    larguraPctDoRolo,
    passaLargura,
    materialNecessarioM,
    rolosNecessarios,
    rolosInteiros,
    custoMaterialNecessario: null,
    custoPorMetroTira: null,
  };

  // Custo do material: quanto se gasta no material necessário + custo por metro de tira.
  const Cml = input.custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0) {
    result.custoMaterialNecessario = Number(Cml) * materialNecessarioM;
    if (metragemPorMetroLiq > 0) result.custoPorMetroTira = Number(Cml) / metragemPorMetroLiq;
  }

  return result;
}

/* ───────────────────────────── Cortes parciais ──────────────────────────────
 * Rendimento de um TRECHO parcial do rolo (não o rolo inteiro). Reaproveita a taxa
 * líquida (m de tira / m linear) já validada acima e só varia o comprimento — é a
 * régua da tabela "Cortes Parciais" da tela. Comprimento digitado em mm/cm/m.
 */

/** Unidade de comprimento aceita na tabela de cortes parciais. */
export type PartialCutUnit = 'mm' | 'cm' | 'm';

/** Fator de conversão da unidade escolhida → metros (unidade-base do cálculo). */
export const PARTIAL_CUT_UNIT_TO_M: Record<PartialCutUnit, number> = {
  mm: 1 / 1000,
  cm: 1 / 100,
  m: 1,
};

export interface PartialCutResult {
  /** metros de tira que saem do trecho (`taxa × comprimento_em_m`). 0 se inválido. */
  tiraM: number;
  /**
   * custo do trecho (`custoMetroLinear × comprimento_em_m`). `null` quando o custo
   * não foi informado; 0 quando informado mas o comprimento é inválido.
   */
  custo: number | null;
}

/**
 * Rendimento de um corte parcial: dada a taxa líquida `metragemPorMetroLiq` (m de
 * tira por metro linear, vinda de `computeStrapYield`) e um `comprimentoM` (já em
 * METROS), devolve quanta tira sai e — se `custoMetroLinear` for informado — quanto
 * custa aquele trecho. Degrada com elegância: comprimento ≤ 0 ou não-finito → zeros
 * (a UI decide exibir "—"); nunca lança.
 */
export function partialCutYield(
  metragemPorMetroLiq: number,
  comprimentoM: number,
  custoMetroLinear?: number | null,
): PartialCutResult {
  const rate = Number(metragemPorMetroLiq) || 0;
  const Lm = Number(comprimentoM) || 0;
  const valid = rate > 0 && Lm > 0;

  const tiraM = valid ? rate * Lm : 0;

  let custo: number | null = null;
  const Cml = custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0) {
    custo = valid ? Number(Cml) * Lm : 0;
  }

  return { tiraM, custo };
}
