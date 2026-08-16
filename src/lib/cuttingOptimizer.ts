/**
 * Otimizador de corte do rolo — empacotamento MULTI-TIRA (First-Fit-Decreasing).
 *
 * Contexto: o Leonardo dedica UM rolo de NAPA (1370 mm × 40 m) por cor/base. Da mesma
 * base/cor ele corta VÁRIAS tiras diferentes (ex.: Tira chata 8 mm + Tira Overlock 5 mm
 * + Tira chata 25 mm, todas CARAMELO). Cada tira tem sua `cut_width_mm` (largura da banda
 * cortada na dimensão dos 1370 mm). Cada banda rende o comprimento inteiro do rolo
 * (40 m) e vira 1 tira pronta. Não existe perda percentual adicional.
 *
 * Este módulo NÃO altera `computeStrapRollCut` (corte de UMA tira, usado nos painéis do
 * PV). Ele REUSA as mesmas constantes (rolo e metros por banda) e empacota
 * várias tiras no mesmo rolo, devolvendo um plano de corte pronto pro UI.
 *
 * Algoritmo (First-Fit-Decreasing — clássico de bin-packing 1D):
 *   1. Pra cada receita: n_bandas = ceil(m_necessarios ÷ 40); largura total = n × cut_width.
 *   2. Expande em "blocos" unitários (1 banda de `cut_width` cada) — espelha o corte real.
 *   3. Ordena os blocos DECRESCENTE por largura.
 *   4. Cada bloco entra no PRIMEIRO rolo (aberto na ordem) com espaço suficiente; senão
 *      abre um rolo novo.
 *   5. Sobra por rolo = largura do rolo − soma das larguras nele.
 *
 * FFD é simples, determinístico e ~11/9·OPT no pior caso — mais que suficiente pro
 * número de tiras de um pedido. Determinístico = mesmo input ⇒ mesmo plano (sem random).
 *
 * TODO(v2): reusar `planRollCutting` no painel do PV agrupando tiras por base/cor, pra
 * mostrar quantos rolos de cada cor o pedido inteiro consome. Por ora o escopo é só a
 * tela Receitas → Produtos Artesanais.
 */

import {
  ROLO_LARGURA_MM,
  ROLO_COMPRIMENTO_M,
  normalizeWidthToMm,
  type ArtisanalStrapCutRow,
} from './strapRollCut';

export { ROLO_LARGURA_MM, ROLO_COMPRIMENTO_M };

/** Metros lineares por banda cortada (= comprimento integral do rolo). */
export const METROS_UTEIS_POR_BANDA = ROLO_COMPRIMENTO_M;

/**
 * Sobra mínima (mm) pra considerar o pedaço reaproveitável. Abaixo disso a sobra é
 * tratada como desperdício (apara fina sem uso). Configurável via `planRollCutting`.
 */
export const MIN_REUSABLE_LEFTOVER_MM = 50;

/** Quantas bandas atendem `m` metros lineares. 0 se m ≤ 0. */
export function bandsForMeters(m: number): number {
  const meters = Math.max(0, Number(m) || 0);
  return meters > 0 ? Math.ceil(meters / METROS_UTEIS_POR_BANDA) : 0;
}

// ─── Núcleo: First-Fit-Decreasing (bin-packing 1D) ──────────────────────────

/** Um bloco de corte = 1 banda de `cut_width_mm` de uma receita. */
export interface CutBlock {
  recipe_id: string;
  recipe_name?: string;
  cut_width_mm: number;
}

export interface OptimizedRoll {
  /** Blocos posicionados neste rolo, na ordem de inserção (descendente por largura). */
  blocks: CutBlock[];
  /** Soma das larguras dos blocos (mm). */
  used_mm: number;
  /** Espaço livre restante na largura do rolo (mm). */
  leftover_mm: number;
}

export interface OptimizeResult {
  rolls: OptimizedRoll[];
  /** Soma das sobras de todos os rolos (mm). */
  total_leftover_mm: number;
  /** Blocos cuja largura excede a do rolo — não cabem em rolo nenhum (warning). */
  unplaceable: CutBlock[];
}

/**
 * Empacota uma lista de blocos em rolos via First-Fit-Decreasing.
 *
 * - Blocos com largura ≤ 0 são ignorados (nada a cortar).
 * - Blocos com largura > `roll_width_mm` vão pra `unplaceable` (não cabem nem num rolo
 *   vazio) — o caller deve avisar o usuário.
 *
 * Função PURA e determinística: nada de random/Date; mesma entrada ⇒ mesmo plano.
 */
export function optimizeRollCutting(
  blocks: CutBlock[],
  roll_width_mm: number = ROLO_LARGURA_MM,
): OptimizeResult {
  const rollWidth = Number(roll_width_mm) || ROLO_LARGURA_MM;
  const placeable: CutBlock[] = [];
  const unplaceable: CutBlock[] = [];

  for (const b of blocks) {
    const w = Number(b?.cut_width_mm) || 0;
    if (w <= 0) continue; // nada a cortar
    if (w > rollWidth) unplaceable.push(b);
    else placeable.push(b);
  }

  // Decreasing: maiores primeiro (o "D" do FFD). Estável por construção do laço.
  const sorted = [...placeable].sort(
    (a, b) => (Number(b.cut_width_mm) || 0) - (Number(a.cut_width_mm) || 0),
  );

  const rolls: OptimizedRoll[] = [];
  for (const block of sorted) {
    const w = Number(block.cut_width_mm) || 0;
    // First-Fit: primeiro rolo (em ordem de abertura) com espaço suficiente.
    let placed = false;
    for (const roll of rolls) {
      if (roll.leftover_mm >= w) {
        roll.blocks.push(block);
        roll.used_mm += w;
        roll.leftover_mm -= w;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rolls.push({ blocks: [block], used_mm: w, leftover_mm: rollWidth - w });
    }
  }

  const total_leftover_mm = rolls.reduce((s, r) => s + r.leftover_mm, 0);
  return { rolls, total_leftover_mm, unplaceable };
}

// ─── Wrapper de alto nível: demanda por receita → plano pronto pro UI ────────

export interface RollCutDemand {
  recipe_id: string;
  recipe_name: string;
  /** Largura de corte da tira (mm). Pode estar ausente/0 → vira warning. */
  cut_width_mm: number | null | undefined;
  /** Unidade da largura (default mm). Aceita cm/m via `normalizeWidthToMm`. */
  cut_width_unit?: string | null;
  /** Metros lineares de tira necessários desta receita. */
  m_needed: number;
}

/** Um trecho colorido da barra do rolo: 1 receita (ou a sobra, com `recipe_id` null). */
export interface PlanSegment {
  /** id da receita; `null` representa a sobra do rolo. */
  recipe_id: string | null;
  recipe_name: string;
  cut_width_mm: number;
  /** Quantas bandas desta receita neste rolo (0 pra sobra). */
  count: number;
  /** Largura ocupada pelo trecho (mm). */
  width_mm: number;
}

export interface PlanRoll {
  /** Número do rolo (1-based). */
  index: number;
  /** Trechos por receita + a sobra (se > 0) no fim. */
  segments: PlanSegment[];
  used_mm: number;
  leftover_mm: number;
  /** Sobra em % da largura do rolo. */
  leftover_pct: number;
}

export interface RecipeBreakdownRow {
  recipe_id: string;
  recipe_name: string;
  m_needed: number;
  n_bandas: number;
  cut_width_mm: number;
  /** Largura total ocupada por esta receita (n_bandas × cut_width). */
  total_width_mm: number;
}

export interface PlanWarning {
  recipe_id: string;
  recipe_name: string;
  cut_width_mm: number;
  message: string;
}

export interface CuttingPlan {
  rolls: PlanRoll[];
  total_rolls: number;
  total_used_mm: number;
  total_leftover_mm: number;
  /** Sobra do último rolo (mm) — o pedaço de rolo que sobra "aberto". */
  last_roll_leftover_mm: number;
  /** Sobra do último rolo em % da largura do rolo. */
  last_roll_leftover_pct: number;
  /** Sobra reaproveitável: trechos ≥ `min_reusable_mm` (mm). */
  reusable_leftover_mm: number;
  /** Desperdício: sobras > 0 porém < `min_reusable_mm` (aparas finas, mm). */
  waste_leftover_mm: number;
  /** Largura do rolo usada no cálculo (mm). */
  roll_width_mm: number;
  /** Detalhamento por receita (pra tabela). */
  breakdown: RecipeBreakdownRow[];
  /** Avisos (largura ausente, tira maior que o rolo). */
  warnings: PlanWarning[];
}

export interface PlanRollCuttingOptions {
  roll_width_mm?: number;
  /** Sobra mínima (mm) pra contar como reaproveitável. Default 50 mm. */
  min_reusable_mm?: number;
}

/**
 * Calcula o plano de corte de um rolo (uma cor/base) a partir da demanda por receita.
 *
 * Devolve uma estrutura pronta pro UI: rolos com trechos coloridos por receita + sobra,
 * total de rolos, sobras (reaproveitável vs desperdício), detalhamento por receita e
 * avisos. PURA — sem efeitos colaterais.
 */
export function planRollCutting(
  demands: RollCutDemand[],
  opts: PlanRollCuttingOptions = {},
): CuttingPlan {
  const roll_width_mm = Number(opts.roll_width_mm) || ROLO_LARGURA_MM;
  const min_reusable_mm =
    opts.min_reusable_mm == null ? MIN_REUSABLE_LEFTOVER_MM : Number(opts.min_reusable_mm) || 0;

  const breakdown: RecipeBreakdownRow[] = [];
  const warnings: PlanWarning[] = [];
  const blocks: CutBlock[] = [];

  for (const d of demands) {
    const w = normalizeWidthToMm(d.cut_width_mm, d.cut_width_unit);
    const m = Math.max(0, Number(d.m_needed) || 0);
    const n = bandsForMeters(m);

    breakdown.push({
      recipe_id: d.recipe_id,
      recipe_name: d.recipe_name,
      m_needed: m,
      n_bandas: n,
      cut_width_mm: w,
      total_width_mm: n * w,
    });

    if (n === 0) continue; // sem demanda → ignora silenciosamente

    if (w <= 0) {
      warnings.push({
        recipe_id: d.recipe_id,
        recipe_name: d.recipe_name,
        cut_width_mm: 0,
        message: 'Largura de corte não cadastrada na receita — não dá pra empacotar.',
      });
      continue;
    }
    if (w > roll_width_mm) {
      warnings.push({
        recipe_id: d.recipe_id,
        recipe_name: d.recipe_name,
        cut_width_mm: w,
        message: `Largura ${w} mm maior que a do rolo (${roll_width_mm} mm) — não cabe.`,
      });
      continue;
    }

    for (let i = 0; i < n; i++) {
      blocks.push({ recipe_id: d.recipe_id, recipe_name: d.recipe_name, cut_width_mm: w });
    }
  }

  const opt = optimizeRollCutting(blocks, roll_width_mm);

  // Agrupa blocos de cada rolo por receita (1 trecho colorido por receita) + sobra.
  const rolls: PlanRoll[] = opt.rolls.map((roll, idx) => {
    const order: string[] = [];
    const byRecipe = new Map<string, PlanSegment>();
    for (const b of roll.blocks) {
      const id = b.recipe_id;
      let seg = byRecipe.get(id);
      if (!seg) {
        seg = {
          recipe_id: id,
          recipe_name: b.recipe_name || id,
          cut_width_mm: Number(b.cut_width_mm) || 0,
          count: 0,
          width_mm: 0,
        };
        byRecipe.set(id, seg);
        order.push(id);
      }
      seg.count += 1;
      seg.width_mm += Number(b.cut_width_mm) || 0;
    }
    const segments: PlanSegment[] = order.map((id) => byRecipe.get(id)!);
    if (roll.leftover_mm > 0) {
      segments.push({
        recipe_id: null,
        recipe_name: 'Sobra',
        cut_width_mm: 0,
        count: 0,
        width_mm: roll.leftover_mm,
      });
    }
    return {
      index: idx + 1,
      segments,
      used_mm: roll.used_mm,
      leftover_mm: roll.leftover_mm,
      leftover_pct: roll_width_mm > 0 ? (roll.leftover_mm / roll_width_mm) * 100 : 0,
    };
  });

  const total_used_mm = rolls.reduce((s, r) => s + r.used_mm, 0);
  const total_leftover_mm = rolls.reduce((s, r) => s + r.leftover_mm, 0);
  const last = rolls[rolls.length - 1];
  const last_roll_leftover_mm = last ? last.leftover_mm : 0;

  // Reaproveitável vs desperdício: avalia a sobra de CADA rolo contra o mínimo.
  let reusable_leftover_mm = 0;
  let waste_leftover_mm = 0;
  for (const r of rolls) {
    if (r.leftover_mm <= 0) continue;
    if (r.leftover_mm >= min_reusable_mm) reusable_leftover_mm += r.leftover_mm;
    else waste_leftover_mm += r.leftover_mm;
  }

  // Tiras maiores que o rolo que escaparam do filtro (defensivo — wrapper já avisou).
  for (const b of opt.unplaceable) {
    if (!warnings.some((w) => w.recipe_id === b.recipe_id)) {
      warnings.push({
        recipe_id: b.recipe_id,
        recipe_name: b.recipe_name || b.recipe_id,
        cut_width_mm: Number(b.cut_width_mm) || 0,
        message: `Largura maior que a do rolo (${roll_width_mm} mm) — não cabe.`,
      });
    }
  }

  return {
    rolls,
    total_rolls: rolls.length,
    total_used_mm,
    total_leftover_mm,
    last_roll_leftover_mm,
    last_roll_leftover_pct: roll_width_mm > 0 ? (last_roll_leftover_mm / roll_width_mm) * 100 : 0,
    reusable_leftover_mm,
    waste_leftover_mm,
    roll_width_mm,
    breakdown,
    warnings,
  };
}

// ─── Ponte PV: linhas de tira artesanal → planos de rolo por base+cor ────────

/** Plano de corte de UMA base+cor: as tiras agrupadas + o empacotamento FFD. */
export interface ArtisanalStrapRollPlan {
  /** Material-base do rolo (ex.: "NAPA SOFT") — ou o grupo da tira no fallback. */
  baseName: string;
  /** Cor do rolo/tira. */
  color: string;
  /** Tiras (grupo+cor) que saem desta base+cor. */
  rows: ArtisanalStrapCutRow[];
  /** Empacotamento FFD desta base+cor (quantos rolos, disposição, sobra). */
  plan: CuttingPlan;
}

/**
 * Agrupa linhas de tira artesanal (`ArtisanalStrapCutRow[]`, vindas dos painéis do
 * PV) por **base + cor** e roda o FFD por grupo — reusa `planRollCutting`.
 *
 * Cada tira vira UMA demanda (largura própria × metros), e várias tiras da mesma
 * base+cor co-empacotam no(s) rolo(s) daquela base. Tiras sem base de receita
 * (`baseName` ausente — detectadas só pelo heurístico) caem no fallback: a própria
 * `groupName` vira a base, então formam um plano de 1 tira (= comportamento legado,
 * sem co-empacotar). Pura e determinística (ordena por base→cor).
 *
 * A cor do rolo == cor da tira (a tira é cortada daquela cor de base), então agrupar
 * por (baseName, color) é correto — não mistura rolos de cores diferentes.
 */
export function planRollsFromStrapRows(
  rows: ArtisanalStrapCutRow[],
  opts: PlanRollCuttingOptions = {},
): ArtisanalStrapRollPlan[] {
  const groups = new Map<
    string,
    { baseName: string; color: string; rows: ArtisanalStrapCutRow[] }
  >();

  for (const row of rows) {
    const baseName = (row.baseName && row.baseName.trim()) || row.groupName || '—';
    const color = (row.color || '—').trim() || '—';
    const key = `${baseName.toLowerCase()}||${color.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { baseName, color, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(row);
  }

  const plans: ArtisanalStrapRollPlan[] = [];
  for (const g of groups.values()) {
    const demands: RollCutDemand[] = g.rows.map((r) => ({
      recipe_id: r.key,
      recipe_name: r.groupName,
      cut_width_mm: r.largura_mm,
      m_needed: r.metros_necessarios,
    }));
    plans.push({
      baseName: g.baseName,
      color: g.color,
      rows: g.rows,
      plan: planRollCutting(demands, opts),
    });
  }

  plans.sort(
    (a, b) =>
      a.baseName.localeCompare(b.baseName, 'pt-BR') ||
      a.color.localeCompare(b.color, 'pt-BR'),
  );
  return plans;
}
