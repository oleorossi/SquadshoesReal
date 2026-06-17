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
/** Largura do rolo em CENTÍMETROS (1370 mm = 137 cm). Base do breakdown multi-rolo. */
export const ROLO_LARGURA_CM = ROLO_LARGURA_MM / 10;
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
  /** Rolos INTEIROS (137 cm cada) que a largura cortada preenche. `floor(cm_a_cortar / 137)`. */
  n_rolos_completos: number;
  /** cm cortados no último rolo (parcial). `cm_a_cortar − n_rolos_completos × 137`.
   *  É 0 quando `cm_a_cortar` é múltiplo exato de 137 (⇒ "N rolos completos" sem sobra). */
  cm_no_ultimo_rolo: number;
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
    n_rolos_completos: 0,
    cm_no_ultimo_rolo: 0,
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
  // Breakdown multi-rolo: quantos rolos INTEIROS (137 cm) + quanto sobra no último.
  // Ex.: 182 cm → 1 rolo completo + 45 cm; 274 cm → 2 rolos completos (sobra 0).
  const n_rolos_completos = Math.floor(cm_a_cortar / ROLO_LARGURA_CM);
  // Arredonda a sobra a 0,1 cm pra matar poeira de ponto-flutuante em múltiplos exatos
  // (ex.: 411 − 3×137 = 0, mas a subtração crua pode dar 1e-13).
  const cm_no_ultimo_rolo = Math.max(0, Math.round((cm_a_cortar - n_rolos_completos * ROLO_LARGURA_CM) * 10) / 10);

  return {
    largura_mm: largura,
    metros_uteis_por_banda,
    n_bandas,
    cm_a_cortar,
    rolos,
    n_rolos_completos,
    cm_no_ultimo_rolo,
    valid: true,
    widthMissing: false,
  };
}

/**
 * Texto do breakdown multi-rolo para UI/impressão:
 *   "1 rolo completo + 45 cm do próximo"  (sobra > 0)
 *   "3 rolos completos"                    (múltiplo exato, sem sobra)
 * Retorna `null` quando o corte cabe em MENOS de 1 rolo (< 137 cm) — aí a UI mostra
 * só o cm total, sem breakdown. FONTE ÚNICA do texto nos 4 render-sites (bloco em
 * tela + 3 PDFs), pra não divergir a redação.
 */
export function rollBreakdownLabel(
  cut: Pick<StrapRollCutResult, 'valid' | 'n_rolos_completos' | 'cm_no_ultimo_rolo'>,
): string | null {
  if (!cut.valid || cut.n_rolos_completos < 1) return null;
  const n = cut.n_rolos_completos;
  const rolos = `${n} rolo${n === 1 ? '' : 's'} completo${n === 1 ? '' : 's'}`;
  const sobra = Math.round(cut.cm_no_ultimo_rolo);
  return sobra > 0 ? `${rolos} + ${sobra} cm do próximo` : rolos;
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

// ─── Agregação por (receita/grupo + cor): soma metros ANTES de calcular ──────

/**
 * Entrada bruta de UMA tira detectada como artesanal, antes de agregar. Pode haver
 * várias por (grupo, cor) — ex.: "TIRA 1".."TIRA 5" da mesma família com consumos
 * diferentes (40 cm/par × 4 + 120 cm/par × 1).
 */
export interface ArtisanalStrapAggInput {
  /**
   * Chave ESTÁVEL de agregação. Prioridade do chamador: `group_id` da tira →
   * (fallback) nome do grupo normalizado. É o que COLAPSA variantes "TIRA N" que
   * compartilham a mesma família mesmo com `label` diferente. Vazio ⇒ usa o nome.
   */
  groupKey?: string | null;
  /** Nome de exibição (nome canônico do grupo/receita, ex.: "TIRA OVERLOCK 5MM"). */
  groupName: string;
  /** Cor da tira. */
  color: string;
  /** Metros LINEARES desta tira no PV inteiro (não por par). */
  metros: number;
  /** Largura de corte em mm (0 = não cadastrada). */
  largura_mm: number;
  /** Material-base do rolo (`base_product_name` da receita), quando houver. */
  baseName?: string;
}

const normKey = (s: string | null | undefined): string =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/**
 * Agrega tiras artesanais por **(grupo + cor)** SOMANDO os metros antes de chamar
 * `computeStrapRollCut` UMA única vez por grupo. Isto é matematicamente melhor que
 * calcular cada tira separada e somar os `cm_a_cortar`, porque
 * `Σ ceil(mᵢ/34) ≥ ceil(Σ mᵢ /34)` — a soma dos arredondamentos para cima nunca é
 * menor que o arredondamento da soma. (Ex.: 4×312 m + 936 m → 5×ceil = 136 cm,
 * agregado 2184 m → ceil único = 130 cm.)
 *
 * A chave de agrupamento é `groupKey` (o chamador passa o `group_id` da tira; cai
 * pro nome normalizado quando ausente) + cor normalizada. A largura usada é a maior
 * largura > 0 entre as tiras do grupo (todas deveriam ter a mesma — vem da receita/
 * família). Pura e determinística (ordena por nome → cor).
 */
export function aggregateArtisanalStrapCut(inputs: ArtisanalStrapAggInput[]): ArtisanalStrapCutRow[] {
  const agg = new Map<string, {
    key: string; groupName: string; color: string; metros: number; largura_mm: number; baseName?: string;
  }>();

  for (const inp of inputs) {
    const metros = Number(inp.metros) || 0;
    if (metros <= 0) continue;
    const color = (inp.color || '—').toString().trim() || '—';
    const groupKey = (inp.groupKey || '').toString().trim() || normKey(inp.groupName);
    // Cor no key é normalizada (acento/caixa-insensível) pra "Café" e "CAFÉ" não
    // virarem rolos separados; a cor de EXIBIÇÃO preserva a 1ª grafia vista.
    const key = `${groupKey}||${normKey(color)}`;
    const largura = Number(inp.largura_mm) || 0;

    const existing = agg.get(key);
    if (existing) {
      existing.metros += metros;
      if (largura > existing.largura_mm) existing.largura_mm = largura;
      if (!existing.baseName && inp.baseName) existing.baseName = inp.baseName;
      if ((!existing.groupName || !existing.groupName.trim()) && inp.groupName) existing.groupName = inp.groupName;
    } else {
      agg.set(key, { key, groupName: inp.groupName, color, metros, largura_mm: largura, baseName: inp.baseName });
    }
  }

  const rows: ArtisanalStrapCutRow[] = Array.from(agg.values()).map((v) => ({
    key: v.key,
    groupName: v.groupName,
    color: v.color,
    largura_mm: v.largura_mm,
    metros_necessarios: v.metros,
    cut: computeStrapRollCut({ largura_mm: v.largura_mm, metros_necessarios: v.metros }),
    baseName: v.baseName,
  }));
  rows.sort((a, b) => a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
  return rows;
}
