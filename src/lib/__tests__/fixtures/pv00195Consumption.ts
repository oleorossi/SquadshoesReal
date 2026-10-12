/**
 * PV-00195 — reconstrução do consumo usada na decisão do dono de 11/10/2026
 * ("a napa da tira fica apenas no setor de tiras"; "não preciso dos metros por
 * numeração, só o total por cor e tipo de tira").
 *
 * Os números que o dono conferiu no PDF estão travados aqui:
 *  - Necessidade de napa: 78,09 m (com napa de tira) → 55,57 m (sem);
 *    GLOW METALIC CHAMPAGNE 32,74 → 14,06 · COBRE 16,70 → 14,06 ·
 *    NAPA SOFT OFF WHITE 15,26 → 14,06. As demais napas somam 13,39 m e não
 *    mudam (a cor ROSADO abaixo é só o portador desse saldo).
 *  - Bloco Tiras do §02 — 6 linhas por tipo × cor:
 *    OVERLOCK 5 mm CHAMPAGNE 856,80 (I704 TIRA 1–4: 218,40 + 218,40 + 218,40 + 201,60) ·
 *    STRASS CRISTAL C/ FUNDO BRANCO 319,20 · STRASS ROSADO C/ FUNDO ROSADO 210,00 ·
 *    ELÁSTICO FORRADO 7 mm CHAMPAGNE 193,20 · OVERLOCK 5 mm COBRE 184,80 ·
 *    CHATA 8 mm OFF WHITE 84,00.
 *
 * Napa das tiras (só §03): 856,80÷70 + 193,20÷30 = 18,68 (CHAMPAGNE) ·
 * 184,80÷70 = 2,64 (COBRE) · 84,00÷70 = 1,20 (OFF WHITE) → 22,52 m.
 */
import type { ConsumptionRow } from '@/lib/consumptionRows';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

const GRADE: Record<string, number> = { 34: 2, 35: 4, 36: 6, 37: 6, 38: 4, 39: 2 };
const GRADE_SUM = Object.values(GRADE).reduce((total, value) => total + value, 0);

/** Metros por numeração proporcionais à grade — o PDF antigo imprimia isto. */
const metersBySize = (meters: number): Record<string, number> => Object.fromEntries(
  Object.entries(GRADE).map(([size, pairs]) => [size, (meters * pairs) / GRADE_SUM]),
);

const napa = (
  componentType: string,
  groupName: string,
  color: string,
  totalQuantity: number,
  productId: string,
): ConsumptionRow => ({
  componentType,
  groupName,
  materialName: componentType,
  color,
  productUnit: 'm',
  totalQuantity,
  available: 0,
  productIds: [productId],
} as ConsumptionRow);

const prestador = (
  groupName: string,
  color: string,
  label: string,
  meters: number,
  baseName: string,
  yieldPerMeter: number,
  finishedProductId: string,
): ConsumptionRow => ({
  componentType: 'Tiras',
  groupName,
  materialName: `Prestador · ${label}`,
  color,
  productUnit: 'm',
  totalQuantity: meters,
  available: 0,
  productIds: [finishedProductId],
  strapSourceMode: 'internal',
  artisanal: { baseName, baseQty: meters / yieldPerMeter, yieldPerMeter },
  strap: {
    origin: 'fazer',
    pairs: 120,
    pairsBySize: { ...GRADE },
    metersBySize: metersBySize(meters),
    fromStockM: 0,
    toMakeM: meters,
    napaM: meters / yieldPerMeter,
    napaBlockedReason: null,
    lineLabels: [label],
    yieldMPerM: yieldPerMeter,
  },
} as ConsumptionRow);

const comprarPronto = (
  groupName: string,
  color: string,
  label: string,
  meters: number,
  finishedProductId: string,
  available: number,
): ConsumptionRow => ({
  componentType: 'Tiras',
  groupName,
  materialName: `Comprar pronto · ${label}`,
  color,
  productUnit: 'm',
  totalQuantity: meters,
  available,
  unitPrice: 2.5,
  productIds: [finishedProductId],
  strapSourceMode: 'buy_ready',
  strap: {
    origin: 'comprar',
    pairs: 120,
    pairsBySize: { ...GRADE },
    metersBySize: metersBySize(meters),
    fromStockM: 0,
    toMakeM: meters,
    napaM: null,
    napaBlockedReason: null,
    lineLabels: [label],
    yieldMPerM: null,
  },
} as ConsumptionRow);

const OVERLOCK_CHAMPAGNE = 'TIRA OVERLOCK 5 mm · GLOW METALIC · CHAMPAGNE';

export const PV00195_ROWS: ConsumptionRow[] = [
  napa('Cabedal', 'GLOW METALIC', 'CHAMPAGNE', 14.06, 'glow-champagne'),
  napa('Cabedal', 'GLOW METALIC', 'COBRE', 14.06, 'glow-cobre'),
  napa('Forração', 'NAPA SOFT', 'OFF WHITE', 14.06, 'soft-off-white'),
  napa('Forração', 'NAPA SOFT', 'ROSADO', 13.39, 'soft-rosado'),
  // I704: quatro linhas da ficha (TIRA 1–4), mesma tira e mesma cor.
  prestador(OVERLOCK_CHAMPAGNE, 'CHAMPAGNE', 'TIRA 1', 218.4, 'GLOW METALIC', 70, 'overlock-champagne'),
  prestador(OVERLOCK_CHAMPAGNE, 'CHAMPAGNE', 'TIRA 2', 218.4, 'GLOW METALIC', 70, 'overlock-champagne'),
  prestador(OVERLOCK_CHAMPAGNE, 'CHAMPAGNE', 'TIRA 3', 218.4, 'GLOW METALIC', 70, 'overlock-champagne'),
  prestador(OVERLOCK_CHAMPAGNE, 'CHAMPAGNE', 'TIRA 4', 201.6, 'GLOW METALIC', 70, 'overlock-champagne'),
  prestador('ELÁSTICO FORRADO 7 mm · GLOW METALIC · CHAMPAGNE', 'CHAMPAGNE', 'TRASEIRA', 193.2, 'GLOW METALIC', 30, 'elastico-champagne'),
  prestador('TIRA OVERLOCK 5 mm · GLOW METALIC · COBRE', 'COBRE', 'TIRA 1', 184.8, 'GLOW METALIC', 70, 'overlock-cobre'),
  prestador('TIRA CHATA 8 mm · NAPA SOFT · OFF WHITE', 'OFF WHITE', 'TIRA 1', 84, 'NAPA SOFT', 70, 'chata-off-white'),
  // Strass: comprado pronto — duas linhas da ficha no mesmo SKU (estoque 100 m).
  comprarPronto('TIRA STRASS 6MM · CRISTAL C/ FUNDO BRANCO', 'CRISTAL C/ FUNDO BRANCO', 'TIRA 1', 159.6, 'strass-cristal', 100),
  comprarPronto('TIRA STRASS 6MM · CRISTAL C/ FUNDO BRANCO', 'CRISTAL C/ FUNDO BRANCO', 'TIRA 2', 159.6, 'strass-cristal', 100),
  comprarPronto('TIRA STRASS 6MM · ROSADO C/ FUNDO ROSADO', 'ROSADO C/ FUNDO ROSADO', 'TIRA 1', 210, 'strass-rosado', 0),
];

const cutRow = (
  key: string,
  groupName: string,
  color: string,
  baseName: string,
  meters: number,
  yieldPerMeter: number,
): ArtisanalStrapCutRow => ({
  key,
  groupName,
  color,
  baseName,
  largura_mm: 5,
  metros_necessarios: meters,
  cut: {
    largura_mm: 5, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
    rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false,
  },
  canonical: {
    recipeId: `recipe-${key}`,
    baseRequiredM: meters / yieldPerMeter,
    confirmedYieldMPerM: yieldPerMeter,
    usableBaseWidthMm: 1370,
    theoreticalYieldMPerM: yieldPerMeter,
    transformationCostPerM: null,
    blockingReasons: [],
    napaBlocked: false,
  },
});

/** §03 Setor de Tiras — onde a napa das tiras continua aparecendo. */
export const PV00195_STRAP_CUT_ROWS: ArtisanalStrapCutRow[] = [
  cutRow('overlock-champagne', OVERLOCK_CHAMPAGNE, 'CHAMPAGNE', 'GLOW METALIC', 856.8, 70),
  cutRow('elastico-champagne', 'ELÁSTICO FORRADO 7 mm · GLOW METALIC · CHAMPAGNE', 'CHAMPAGNE', 'GLOW METALIC', 193.2, 30),
  cutRow('overlock-cobre', 'TIRA OVERLOCK 5 mm · GLOW METALIC · COBRE', 'COBRE', 'GLOW METALIC', 184.8, 70),
  cutRow('chata-off-white', 'TIRA CHATA 8 mm · NAPA SOFT · OFF WHITE', 'OFF WHITE', 'NAPA SOFT', 84, 70),
];
