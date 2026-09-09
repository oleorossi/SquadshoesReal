/**
 * Calculadora de Tiras — RENDIMENTO de corte (metragem de tira por metro linear).
 *
 * Regra geométrica: somente bandas físicas completas contam.
 *   bandas_completas = floor(Lm / Lt)
 *   rendimento_m_por_m = bandas_completas
 * Ex.: 1370 mm ÷ 20 mm = 68 bandas completas, com sobra lateral de 10 mm.
 * O resultado geométrico é apenas o teto. Quando a receita informa rendimento confirmado,
 * ele governa metragem, necessidade e custo, sem percentual de perda adicional.
 */
import { ROLO_LARGURA_MM, ROLO_COMPRIMENTO_M } from '@/lib/strapRollCut';

/** Defaults do formulário = rolo canônico de tira artesanal. Todos editáveis. */
export const STRAP_YIELD_DEFAULTS = {
  /** Largura útil do material (mm). Default = largura do rolo canônico (1370 mm). */
  larguraMaterialMm: ROLO_LARGURA_MM,
  /** Comprimento do rolo (m). Default = comprimento do rolo canônico (40 m). */
  comprimentoRoloM: ROLO_COMPRIMENTO_M,
} as const;

export interface StrapYieldInput {
  /** `Lm` — largura útil do material (mm). */
  larguraMaterialMm: number;
  /** `Lt` — largura da BANDA cortada no material (mm), não a medida final da tira. */
  larguraTiraMm: number;
  /** `Cr` — comprimento do rolo (m). */
  comprimentoRoloM: number;
  /** `Cml` — custo por metro linear do material comprado (R$/m). Opcional. */
  custoMetroLinear?: number | null;
  /**
   * Rendimento real aprovado da receita (m de tira pronta por m de napa).
   * Quando informado, governa necessidade e custo; a geometria fica apenas como teto.
   */
  rendimentoConfirmadoMPerM?: number | null;
}

export interface StrapYieldResult {
  /** `false` quando a entrada é inválida — `error` explica; os números ficam 0. */
  valid: boolean;
  /** Mensagem de validação (pt-BR) quando `valid` é `false`. */
  error?: string;
  /** `floor(Lm/Lt)` — bandas físicas completas por metro linear. */
  metragemPorMetroBruto: number;
  /** Rendimento confirmado quando fornecido; sem receita, sugestão geométrica teórica. */
  metragemPorMetroLiq: number;
  /** Número de bandas físicas completas na largura útil. */
  bandasCompletas: number;
  /** rendimento operacional × comprimento do rolo — total de tira no rolo (m). */
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
  bandasCompletas: 0,
  totalRoloLiq: 0,
  totalRoloBruto: 0,
  custoMaterialRolo: null,
  custoPorMetroTira: null,
};

function fail(error: string): StrapYieldResult {
  return { valid: false, error, ...EMPTY };
}

function resolveOperationalYield(
  confirmedValue: number | null | undefined,
  theoreticalYield: number,
): { value: number; error?: string } {
  if (confirmedValue == null) return { value: theoreticalYield };
  const confirmedYield = Number(confirmedValue);
  if (!Number.isFinite(confirmedYield) || !(confirmedYield > 0)) {
    return { value: 0, error: 'O rendimento confirmado deve ser maior que zero.' };
  }
  if (confirmedYield > theoreticalYield) {
    return {
      value: 0,
      error: 'O rendimento confirmado não pode superar a capacidade geométrica da receita.',
    };
  }
  return { value: confirmedYield };
}

/**
 * Calcula o rendimento (metragem) de tira. Degrada com elegância: entrada inválida →
 * `valid:false` + `error` (não lança). Cálculo interno em precisão total; a UI arredonda.
 */
export function computeStrapYield(input: StrapYieldInput): StrapYieldResult {
  const Lm = Number(input.larguraMaterialMm);
  const Lt = Number(input.larguraTiraMm);
  const Cr = Number(input.comprimentoRoloM);

  if (!Number.isFinite(Lm) || !(Lm > 0)) return fail('Informe a largura útil do material.');
  if (!Number.isFinite(Lt) || !(Lt > 0)) return fail('Informe a largura da banda de corte.');
  if (!Number.isFinite(Cr) || !(Cr > 0)) return fail('Informe o comprimento do rolo.');
  if (input.custoMetroLinear != null && !Number.isFinite(Number(input.custoMetroLinear))) {
    return fail('Informe um custo por metro linear válido.');
  }
  if (Lt > Lm) return fail('A largura da banda de corte é maior que a largura do material.');
  const bandasCompletas = Math.floor(Lm / Lt);
  if (bandasCompletas < 1) return fail('A largura útil não comporta uma banda completa.');
  const metragemPorMetroBruto = bandasCompletas;
  const operationalYield = resolveOperationalYield(input.rendimentoConfirmadoMPerM, bandasCompletas);
  if (operationalYield.error) return fail(operationalYield.error);
  const metragemPorMetroLiq = operationalYield.value;
  const totalRoloBruto = metragemPorMetroBruto * Cr;
  const totalRoloLiq = metragemPorMetroLiq * Cr;

  const result: StrapYieldResult = {
    valid: true,
    metragemPorMetroBruto,
    metragemPorMetroLiq,
    bandasCompletas,
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
 * Mesma geometria física do direto, resolvida ao contrário.
 *
 * O corte físico fixa o COMPRIMENTO do rolo e fatia uma FAIXA da largura: cada tira
 * de `Lt` mm, cortada no comprimento cheio `Cr`, rende `Cr` m de tira. A faixa exata é
 * `tira_desejada × Lt ÷ Cr`; a execução arredonda o número de bandas para cima.
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
  /** `floor(Lm/Lt)` — bandas físicas completas por metro linear. */
  metragemPorMetroBruto: number;
  /** Taxa operacional confirmada; sem receita, sugestão igual às bandas completas. */
  metragemPorMetroLiq: number;
  bandasCompletas: number;
  /** Metragem de tira pronta desejada (m), ecoada. */
  tiraDesejadaM: number;
  /** `T × Lt ÷ Cr` — faixa exata antes do arredondamento para bandas inteiras. */
  larguraCortarBrutaMm: number;
  /** Igual à faixa exata; não há percentual de perda. */
  larguraCortarMm: number;
  /** Soma exata solicitada antes do arredondamento físico. */
  tiraBrutaTotalM: number;
  /** `larguraCortarMm ÷ Lt` — nº de tiras (fracionário) do cálculo exato. */
  tirasNecessarias: number;

  /* ── Bloco REAL: no chão de fábrica não existe "2,9 tiras" ──────────────────
   * Arredonda PRA CIMA ao nº inteiro de tiras (senão falta metragem) e recalcula
   * tudo em cima disso. É o que a UI mostra como resposta; os campos exatos acima
   * viram o detalhamento do cálculo. */
  /** `ceil(tirasNecessarias)` — bandas inteiras a cortar. RESPOSTA REAL. */
  tirasInteiras: number;
  /** `tirasInteiras × Lt` — largura real a cortar (mm), múltiplo da largura da banda. */
  larguraRealMm: number;
  /** `larguraRealMm ÷ Lm × 100` — % da largura do rolo, na largura real. */
  larguraRealPctDoRolo: number;
  /** `tirasInteiras × Cr` — soma de todas as bandas inteiras, em metros brutos. */
  tiraBrutaRealM: number;
  /** Metros de tira gerados pelas bandas inteiras. */
  tiraLiquidaRealM: number;
  /** `tiraLiquidaRealM − T` — sobra além do pedido (≥ 0) por causa do arredondamento. */
  sobraTiraM: number;
  /** `larguraRealMm ÷ Lm × Cr` — material linear equivalente (largura cheia), real. */
  materialRealM: number;
  /** `larguraRealMm ÷ Lm` — rolos necessários (fracionário) na largura real. */
  rolosRealNecessarios: number;
  /** Rolos físicos a abrir: `ceil(tirasInteiras ÷ floor(Lm ÷ Lt))`. Diferente de
   *  `ceil(rolosRealNecessarios)` quando a sobra lateral de cada rolo não comporta
   *  outra banda. */
  rolosRealInteiros: number;
  /** `larguraCortarMm ÷ Lm × 100` — % da largura do rolo ocupada pela faixa
   *  (= `rolosNecessarios × 100`). Pode passar de 100 quando exige mais de 1 rolo. */
  larguraPctDoRolo: number;
  /** `true` quando a faixa passa da largura do rolo (precisa de mais de 1 rolo). */
  passaLargura: boolean;
  /** `T ÷ taxa líquida` — metros lineares de material necessários (largura cheia). */
  materialNecessarioM: number;
  /** `material ÷ comprimento do rolo` = `larguraCortarMm ÷ Lm` — rolos (fracionário). */
  rolosNecessarios: number;
  /** Alias legado de `rolosRealInteiros`: rolos físicos a abrir depois de arredondar
   *  as bandas e respeitar a capacidade inteira de cada rolo. */
  rolosInteiros: number;
  /** `Cml × material` — custo total do material necessário (exato). `null` sem custo. */
  custoMaterialNecessario: number | null;
  /** `Cml × materialRealM` — custo do material de fato consumido (bandas inteiras). */
  custoMaterialReal: number | null;
  /** `Cml ÷ taxa líquida` — custo de material por metro de tira (R$/m). `null` sem custo. */
  custoPorMetroTira: number | null;
}

const EMPTY_NEEDED: Omit<StrapMaterialNeededResult, 'valid' | 'error'> = {
  metragemPorMetroBruto: 0,
  metragemPorMetroLiq: 0,
  bandasCompletas: 0,
  tiraDesejadaM: 0,
  larguraCortarBrutaMm: 0,
  larguraCortarMm: 0,
  tiraBrutaTotalM: 0,
  tirasNecessarias: 0,
  tirasInteiras: 0,
  larguraRealMm: 0,
  larguraRealPctDoRolo: 0,
  tiraBrutaRealM: 0,
  tiraLiquidaRealM: 0,
  sobraTiraM: 0,
  materialRealM: 0,
  rolosRealNecessarios: 0,
  rolosRealInteiros: 0,
  larguraPctDoRolo: 0,
  passaLargura: false,
  materialNecessarioM: 0,
  rolosNecessarios: 0,
  rolosInteiros: 0,
  custoMaterialNecessario: null,
  custoMaterialReal: null,
  custoPorMetroTira: null,
};

function failNeeded(error: string): StrapMaterialNeededResult {
  return { valid: false, error, ...EMPTY_NEEDED };
}

/**
 * Calcula quanto da LARGURA do rolo cortar (número-herói) — mais material linear e
 * rolos de contexto — pra produzir `tiraDesejadaM` metros de tira pronta, dadas as
 * mesmas larguras. Inverso de `computeStrapYield`. Degrada com elegância:
 * entrada inválida → `valid:false` + `error` (não lança). O comprimento do rolo é
 * OBRIGATÓRIO aqui, pois é ele que fixa em que comprimento a faixa é cortada.
 */
export function computeStrapMaterialNeeded(input: StrapMaterialNeededInput): StrapMaterialNeededResult {
  const Lm = Number(input.larguraMaterialMm);
  const Lt = Number(input.larguraTiraMm);
  const Cr = Number(input.comprimentoRoloM);
  const T = Number(input.tiraDesejadaM);

  if (!Number.isFinite(Lm) || !(Lm > 0)) return failNeeded('Informe a largura útil do material.');
  if (!Number.isFinite(Lt) || !(Lt > 0)) return failNeeded('Informe a largura da banda de corte.');
  if (!Number.isFinite(T) || !(T > 0)) return failNeeded('Informe quantos metros de tira você precisa.');
  if (Lt > Lm) return failNeeded('A largura da banda de corte é maior que a largura do material.');
  if (!Number.isFinite(Cr) || !(Cr > 0)) return failNeeded('Informe o comprimento do rolo (define a largura a cortar).');
  if (input.custoMetroLinear != null && !Number.isFinite(Number(input.custoMetroLinear))) {
    return failNeeded('Informe um custo por metro linear válido.');
  }
  const bandasCompletas = Math.floor(Lm / Lt);
  if (bandasCompletas < 1) return failNeeded('A largura útil não comporta uma banda completa.');
  const metragemPorMetroBruto = bandasCompletas;
  const operationalYield = resolveOperationalYield(input.rendimentoConfirmadoMPerM, bandasCompletas);
  if (operationalYield.error) return failNeeded(operationalYield.error);
  const metragemPorMetroLiq = operationalYield.value;
  const materialNecessarioM = metragemPorMetroLiq > 0 ? T / metragemPorMetroLiq : 0;
  const usesConfirmedYield = input.rendimentoConfirmadoMPerM != null;

  // Faixa exata da largura a cortar no comprimento cheio do rolo.
  const larguraCortarBrutaMm = (T * Lt) / Cr;
  const larguraCortarMm = larguraCortarBrutaMm;
  const tirasNecessarias = larguraCortarMm / Lt;
  const tiraBrutaTotalM = T;
  const larguraPctDoRolo = Lm > 0 ? (larguraCortarMm / Lm) * 100 : 0;

  // ── Realidade: não se corta fração de tira → arredonda PRA CIMA ────────────
  const tirasInteiras = Math.ceil(tirasNecessarias);
  const larguraRealMm = tirasInteiras * Lt;
  const larguraRealPctDoRolo = Lm > 0 ? (larguraRealMm / Lm) * 100 : 0;
  const tiraBrutaRealM = tirasInteiras * Cr;
  const tiraLiquidaRealM = tiraBrutaRealM;
  const sobraTiraM = Math.max(0, tiraLiquidaRealM - T);
  const materialRealM = usesConfirmedYield
    ? materialNecessarioM
    : Lm > 0
      ? (larguraRealMm / Lm) * Cr
      : 0;
  // `rolosRealNecessarios` é equivalência de ÁREA/material (pode ser fracionária).
  // Para saber quantos rolos FÍSICOS abrir, respeita a capacidade inteira de bandas
  // de cada rolo. Somar todas as larguras e dividir por Lm reaproveitaria, de forma
  // impossível, as sobras laterais de rolos diferentes (137 bandas de 20 mm em
  // 1370 mm: equivalem a 2 rolos, mas cabem 68 por rolo e exigem 3 rolos físicos).
  const rolosRealNecessarios = usesConfirmedYield
    ? materialRealM / Cr
    : Lm > 0
      ? larguraRealMm / Lm
      : 0;
  const bandasPorRolo = Math.floor(Lm / Lt);
  const rolosRealInteiros = usesConfirmedYield
    ? Math.ceil(rolosRealNecessarios)
    : bandasPorRolo > 0
      ? Math.ceil(tirasInteiras / bandasPorRolo)
      : 0;

  // Aviso é sobre o que se corta DE FATO (largura real, já arredondada).
  const passaLargura = larguraRealMm > Lm;

  const rolosNecessarios = materialNecessarioM / Cr;
  const rolosInteiros = rolosRealInteiros;

  const result: StrapMaterialNeededResult = {
    valid: true,
    metragemPorMetroBruto,
    metragemPorMetroLiq,
    bandasCompletas,
    tiraDesejadaM: T,
    larguraCortarBrutaMm,
    larguraCortarMm,
    tiraBrutaTotalM,
    tirasNecessarias,
    tirasInteiras,
    larguraRealMm,
    larguraRealPctDoRolo,
    tiraBrutaRealM,
    tiraLiquidaRealM,
    sobraTiraM,
    materialRealM,
    rolosRealNecessarios,
    rolosRealInteiros,
    larguraPctDoRolo,
    passaLargura,
    materialNecessarioM,
    rolosNecessarios,
    rolosInteiros,
    custoMaterialNecessario: null,
    custoMaterialReal: null,
    custoPorMetroTira: null,
  };

  // Custo do material: quanto se gasta no material necessário + custo por metro de tira.
  const Cml = input.custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0) {
    result.custoMaterialNecessario = Number(Cml) * materialNecessarioM;
    result.custoMaterialReal = Number(Cml) * materialRealM;
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
  const rate = Number(metragemPorMetroLiq);
  const Lm = Number(comprimentoM);
  const valid = Number.isFinite(rate) && rate > 0 && Number.isFinite(Lm) && Lm > 0;

  const tiraM = valid ? rate * Lm : 0;

  let custo: number | null = null;
  const Cml = custoMetroLinear;
  if (Cml != null && Number.isFinite(Number(Cml)) && Number(Cml) >= 0) {
    custo = valid ? Number(Cml) * Lm : 0;
  }

  return { tiraM, custo };
}
