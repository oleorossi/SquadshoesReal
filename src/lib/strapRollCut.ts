/**
 * Corte do rolo para TIRAS ARTESANAIS.
 *
 * Tiras artesanais são cortadas de um rolo padrão (40 m × 1370 mm). A `cut_width_mm`
 * cadastrada da tira é a LARGURA da banda cortada ao longo da dimensão de 1370 mm do
 * rolo — cada banda vira UMA tira pronta e tem o comprimento inteiro do rolo (40 m,
 * → 34 m úteis após 15% de perda). O nome da tira (ex. "Tira chata 8mm") é a medida
 * FINAL da peça, não a banda.
 *
 * O valor de saída (`cm_a_cortar`) é quanto da LARGURA do rolo (dos 1370 mm) precisa
 * ser cortado para atender o consumo do PV — NÃO o comprimento percorrido. Confirmado
 * pelo Leonardo em 2026-06-14 (PV-00140).
 *
 * Fórmula:
 *   metros_uteis_por_banda = 40 × (1 − 0,15) = 34 m       // cada banda rende 34 m úteis
 *   n_bandas               = ceil(metros_necessarios ÷ 34)
 *   cm_a_cortar            = (n_bandas × cut_width_mm) ÷ 10
 *
 * Conferência (cut=20mm, PV-00140):
 *   2448 m   → ⌈2448/34⌉ = 72 bandas × 20mm = 1440mm = 144,0 cm
 *   2148 m   → 64 × 20mm = 1280mm = 128,0 cm
 *   1509,6 m → 45 × 20mm =  900mm =  90,0 cm
 *   384 m    → 12 × 20mm =  240mm =  24,0 cm
 *
 * Esta é a FONTE ÚNICA da matemática usada nos painéis de consumo do PV (Resumo de
 * Consumo, Lista de Separação e modal Consumo de Materiais). Toda mudança mora aqui.
 */

export const ROLO_LARGURA_MM = 1370;
export const ROLO_COMPRIMENTO_M = 40;
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
  /** Metros lineares úteis por banda cortada (= 40 m × 0,85 = 34 m). Constante. */
  metros_uteis_por_banda: number;
  /** Quantas bandas (= tiras prontas) de `cut_width_mm` precisam ser cortadas. */
  n_bandas: number;
  /** Centímetros da LARGURA do rolo a cortar (`n_bandas × cut_width_mm ÷ 10`). */
  cm_a_cortar: number;
  /** Equivalência em rolos (largura cortada ÷ 1370 mm). > 1 ⇒ multi-rolos. */
  rolos: number;
  /** true quando a largura é válida e deu pra calcular o corte. */
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
  // Cada banda cortada tem o comprimento inteiro do rolo (40 m) → 34 m úteis após perda.
  const metros_uteis_por_banda = ROLO_COMPRIMENTO_M * (1 - PERDA_PCT);

  const base: StrapRollCutResult = {
    largura_mm: largura,
    metros_uteis_por_banda,
    n_bandas: 0,
    cm_a_cortar: 0,
    rolos: 0,
    valid: false,
    widthMissing: false,
  };

  if (largura <= 0) {
    return { ...base, widthMissing: true, warning: 'Largura não cadastrada — não foi possível calcular corte' };
  }
  if (largura > ROLO_LARGURA_MM) {
    return { ...base, warning: `Largura maior que a largura do rolo (${ROLO_LARGURA_MM} mm)` };
  }

  // Quantas bandas de `largura` mm cortar ao longo da LARGURA do rolo — cada banda é
  // 1 tira pronta e rende 34 m úteis. Uma banda parcial conta inteira (ceil).
  const n_bandas = metros > 0 ? Math.ceil(metros / metros_uteis_por_banda) : 0;
  const mm_largura_a_cortar = n_bandas * largura;
  const cm_a_cortar = mm_largura_a_cortar / 10;
  // Largura cortada vs largura do rolo: > 1 ⇒ precisa de mais de um rolo (nota informativa).
  const rolos = mm_largura_a_cortar / ROLO_LARGURA_MM;

  return {
    largura_mm: largura,
    metros_uteis_por_banda,
    n_bandas,
    cm_a_cortar,
    rolos,
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
  /**
   * Grupo da tira é o RESULTADO (`artisanal_product_name`) de uma receita ativa
   * em "Receitas → Produtos artesanais" (`artisanal_recipes`). Fonte AUTORITATIVA:
   * se o Leonardo cadastrou a transformação artesanal, a tira é artesanal — não
   * importa o nome. Vence a flag de grupo e o heurístico.
   */
  recipeFlag?: boolean | null;
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
 *   2. grupo é resultado de uma receita artesanal cadastrada (`recipeFlag`) — a
 *      FONTE da verdade do Leonardo (tela "Receitas → Produtos artesanais").
 *   3. flag de cadastro no grupo (`product_groups.is_artisanal_strap`).
 *   4. heurístico: nome casa /tira/ E não casa com itens comprados prontos
 *      (strass, elástico, trança, etc.). Casa também explicitamente "tira artesanal".
 *
 * ⚠ O heurístico, sozinho, é frágil: ele NÃO pega tiras cujo grupo não tenha
 * "tira" no nome e ainda EXCLUI "trançado" (que é uma transformação artesanal
 * legítima — colide com a regex de comprados-prontos). Por isso o `recipeFlag`,
 * vindo do cadastro de receitas, é o caminho correto e prevalece.
 */
export function isArtisanalStrap({ strapFlag, recipeFlag, groupFlag, name }: ArtisanalDetectionInput): boolean {
  if (strapFlag === true) return true;
  if (strapFlag === false) return false;
  if (recipeFlag === true) return true;
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
  /**
   * Material-base do rolo (ex.: "NAPA SOFT") — `base_product_name` da receita
   * artesanal cujo resultado é esta tira. Usado pelo otimizador para AGRUPAR
   * várias tiras da mesma base+cor num rolo (`planRollsFromStrapRows`). Ausente
   * quando a tira não casa com nenhuma receita (heurístico) — aí cada tira é seu
   * próprio grupo.
   */
  baseName?: string;
}
