/**
 * Corte do rolo para TIRAS ARTESANAIS.
 *
 * Tiras artesanais são cortadas de um rolo padrão (40 m × 1370 mm). A partir da
 * largura de corte cadastrada da tira (em mm), calculamos quantas tiras saem da
 * largura do rolo, o rendimento útil (já descontando 15% de perda) e, dado o
 * total de metros lineares de tira necessários no PV, quantos centímetros do
 * comprimento do rolo precisam ser cortados.
 *
 * Esta é a FONTE ÚNICA da matemática usada nos dois painéis de consumo do PV
 * (Resumo de Consumo e Lista de Separação). Toda mudança de fórmula mora aqui.
 *
 * Fórmula (espelha o que o Leonardo aprovou no mockup):
 *   tiras_por_rolo   = floor(largura_corte_mm ÷ 21)
 *   metros_uteis     = tiras_por_rolo × 40 × 0,85        // 15% de perda
 *   cm_rolo_a_cortar = (metros_necessarios × 4000) ÷ metros_uteis
 *
 * 4000 = comprimento do rolo em cm (40 m × 100). Ou seja, cm_a_cortar é a fração
 * do rolo necessária (metros_necessarios / metros_uteis) aplicada ao comprimento
 * total do rolo.
 */

export const ROLO_LARGURA_MM = 1370;
export const ROLO_COMPRIMENTO_M = 40;
/** Cada tira de saída ocupa ~21 mm da largura do corte (deriva de floor(W/21)). */
export const TIRA_DIVISOR_MM = 21;
/**
 * Kerf (espessura da lâmina por corte) — DESCARTADO por decisão do Leonardo
 * (2026-06-14): a fórmula usa floor(W/21) direto, SEM ajuste de lâmina.
 * Mantido em 0 só por referência.
 */
export const KERF_MM = 0;
/** Perda do rolo (aparas/sobras). 15%. */
export const PERDA_PCT = 0.15;

export interface StrapRollCutInput {
  /** Largura de corte cadastrada da tira artesanal, em mm. */
  largura_mm: number | null | undefined;
  /** Total de metros LINEARES de tira necessários (PV inteiro, não por par). */
  metros_necessarios: number;
}

export interface StrapRollCutResult {
  largura_mm: number;
  /** Quantas tiras de ~21 mm saem da largura de corte. */
  tiras_por_rolo: number;
  /** Metros lineares de tira aproveitáveis em 1 rolo cheio (já com 15% perda). */
  metros_uteis_rolo: number;
  /** Centímetros do COMPRIMENTO do rolo a cortar para atender o consumo. */
  cm_a_cortar: number;
  /** true quando a largura é válida e deu pra calcular o rendimento. */
  valid: boolean;
  /** true quando a tira não tem largura cadastrada (≤ 0 / ausente). */
  widthMissing: boolean;
  /** Aviso âmbar para a UI quando algo impede o cálculo. */
  warning?: string;
}

/**
 * Normaliza uma largura cadastrada (que pode estar em mm/cm/m) para milímetros.
 * Default da unidade é mm — é o padrão de cadastro de tiras no sistema.
 */
export function normalizeWidthToMm(
  value: number | null | undefined,
  unit?: string | null,
): number {
  const w = Number(value) || 0;
  if (w <= 0) return 0;
  const u = (unit || 'mm').toString().toLowerCase().trim();
  if (u === 'cm') return w * 10;
  if (u === 'm') return w * 1000;
  return w; // mm
}

/**
 * Calcula o corte do rolo para uma tira artesanal.
 *
 * Degrada com elegância: largura ausente/inválida → `valid:false` + `warning`,
 * para a UI mostrar a linha em vermelho com o aviso (em vez de quebrar).
 */
export function computeStrapRollCut({ largura_mm, metros_necessarios }: StrapRollCutInput): StrapRollCutResult {
  const largura = Number(largura_mm) || 0;
  const metros = Number(metros_necessarios) || 0;

  const base: StrapRollCutResult = {
    largura_mm: largura,
    tiras_por_rolo: 0,
    metros_uteis_rolo: 0,
    cm_a_cortar: 0,
    valid: false,
    widthMissing: false,
  };

  if (largura <= 0) {
    return { ...base, widthMissing: true, warning: 'Largura não cadastrada — não foi possível calcular corte' };
  }
  if (largura < TIRA_DIVISOR_MM) {
    return { ...base, warning: `Largura abaixo do mínimo de uma tira (${TIRA_DIVISOR_MM} mm)` };
  }
  if (largura > ROLO_LARGURA_MM) {
    return { ...base, warning: `Largura excede a largura do rolo (${ROLO_LARGURA_MM} mm)` };
  }

  // Versão simples (sem kerf): floor da largura de corte pela largura da tira.
  const tiras_por_rolo = Math.floor(largura / TIRA_DIVISOR_MM);
  if (tiras_por_rolo <= 0) {
    return { ...base, warning: `Largura abaixo do mínimo de uma tira (${TIRA_DIVISOR_MM} mm)` };
  }

  const metros_uteis_rolo = tiras_por_rolo * ROLO_COMPRIMENTO_M * (1 - PERDA_PCT);
  const cm_a_cortar = metros > 0 && metros_uteis_rolo > 0
    ? (metros * ROLO_COMPRIMENTO_M * 100) / metros_uteis_rolo
    : 0;

  return {
    largura_mm: largura,
    tiras_por_rolo,
    metros_uteis_rolo,
    cm_a_cortar,
    valid: true,
    widthMissing: false,
  };
}

// ─── Detecção de "tira artesanal" ───────────────────────────────────────────

/** Itens de tira COMPRADOS prontos (não cortados de rolo) — excluídos do bloco. */
const BOUGHT_READY_RE = /strass|el[aá]stic|tran[çc]|cadar[çc]|cord[ãa]o|fivela|ilh[oó]s|veluto|fita\b|gorgur[ãa]o/i;
const TIRA_RE = /tira/i;
const ARTESANAL_RE = /artesanal/i;

export interface ArtisanalDetectionInput {
  /** Flag explícita no objeto da tira (strap_colors JSONB). Prefere esta. */
  strapFlag?: boolean | null;
  /** Flag de cadastro no grupo do produto (product_groups.is_artisanal_strap). */
  groupFlag?: boolean | null;
  /** Nome/rótulo/categoria combinados para o heurístico de fallback. */
  name?: string | null;
}

/**
 * Decide se uma tira é "artesanal cortada do rolo".
 *
 * Prioridade (conservadora):
 *   1. flag explícita por tira (`is_artisanal_strap` no JSONB) — `false` opta por fora.
 *   2. flag de cadastro no grupo (`product_groups.is_artisanal_strap`).
 *   3. heurístico: nome casa /tira/ E não casa com itens comprados prontos
 *      (strass, elástico, trança, etc.). Casa também explicitamente "tira artesanal".
 */
export function isArtisanalStrap({ strapFlag, groupFlag, name }: ArtisanalDetectionInput): boolean {
  if (strapFlag === true) return true;
  if (strapFlag === false) return false;
  if (groupFlag === true) return true;
  const n = (name || '').toString().toLowerCase();
  if (!n) return false;
  if (ARTESANAL_RE.test(n) && TIRA_RE.test(n)) return true;
  if (TIRA_RE.test(n) && !BOUGHT_READY_RE.test(n)) return true;
  return false;
}

// ─── Agregação (shape comum aos dois painéis) ───────────────────────────────

export interface ArtisanalStrapCutRow {
  /** Chave de agregação: grupo + cor normalizados. */
  key: string;
  /** Nome do grupo/material da tira (ex.: "TIRA NAPA"). */
  groupName: string;
  /** Cor da tira. */
  color: string;
  /** Largura de corte em mm (0 = não cadastrada). */
  largura_mm: number;
  /** Total de metros lineares de tira necessários no PV inteiro. */
  metros_necessarios: number;
  /** Resultado do cálculo de corte do rolo. */
  cut: StrapRollCutResult;
}
