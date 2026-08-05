/**
 * Empacotamento de pares em caixas — REGRA CANÔNICA (decisão do dono, 05/08/2026).
 *
 * Uma ficha produz N pares distribuídos numa GRADE de numerações. A caixa (colmeia)
 * comporta uma capacidade fixa, cadastrada via a tela do SOLADO. Quando a ficha tem
 * mais pares do que cabe, o excedente NÃO viaja solto: ele é retirado da ficha e
 * consolidado, no pedido inteiro, em caixas de UMA numeração só.
 *
 * ── A REGRA ──────────────────────────────────────────────────────────────────
 *   sobra_por_ficha = Σgrade − capacidade
 *   a sobra sai das numerações do MENOR para o MAIOR
 *   a sobra é consolidada por (item do PV, numeração) e quebrada em caixas de
 *   `capacidade` pares
 *
 * ⚠ "do menor pro maior" descreve quem vai para a SOBRA, não quem fica na colmeia.
 * Inverter isso produz um resultado plausível e errado — foi o engano que a
 * conferência com o dono desfez.
 *
 * ── POR QUE ESTA REGRA E NÃO OUTRA ───────────────────────────────────────────
 * Três regras diferentes produzem "3 pares de sobra" na curva do PV-00151
 * (`28:2 29:2 30:2 31:2 32:3 33:2 34:2` = 15, capacidade 12) e divergem em
 * qualquer outra. O desempate veio do resultado que o dono descreveu para o
 * pedido fechado — "2 caixas completas do 28 e 1 do 29":
 *
 *   por ficha:  sobra = 28:2 · 29:1        colmeia = 29:1 30:2 31:2 32:3 33:2 34:2 (12)
 *   × 12 fichas: 28 → 24 pares = 2 caixas cheias
 *                29 → 12 pares = 1 caixa cheia
 *
 * A caixa de numeração única NÃO nasce na ficha (a ficha sobra 2 numerações) —
 * nasce na CONSOLIDAÇÃO do pedido. Um cálculo por ficha isolada nunca chega lá.
 *
 * ── INVARIANTES ──────────────────────────────────────────────────────────────
 * 1. Nenhum par fica fora de caixa. Σ pares das caixas == fichas × Σgrade.
 * 2. Caixa parcial é caixa: conta como 1 volume, com células vazias.
 * 3. Nenhuma caixa mistura referência ou cor — o empacotamento é por ITEM do PV,
 *    e item já é (referência × cor). Não consolidar sobra entre itens.
 * 4. Nenhuma caixa passa da capacidade.
 */

/** Uma numeração e quantos pares dela. */
export interface GradeEntry {
  size: string;
  qty: number;
}

export type PackedBoxKind =
  /** Colmeia com a grade da ficha (menos a sobra retirada). */
  | 'grade'
  /** Caixa de uma numeração só, formada pela consolidação da sobra. */
  | 'single';

export interface PackedBox {
  kind: PackedBoxKind;
  /** Só em `single`: a numeração única que vai na caixa. */
  size?: string;
  /** Conteúdo da caixa. Em `single` tem exatamente 1 entrada. */
  contents: GradeEntry[];
  /** Total de pares — sempre == Σ contents.qty, e sempre ≤ capacidade. */
  pairs: number;
  /** `true` quando a caixa não fechou a capacidade (viaja com espaço sobrando). */
  partial: boolean;
}

/** Peso médio de um par quando a ficha técnica da referência não tem o valor. */
export const DEFAULT_PAIR_WEIGHT_KG = 0.238;

/** Mapa de grade como vem do banco (`sale_order_items.grade`, jsonb) ou já em lista. */
export type GradeInput =
  | Record<string, number | string | null>
  | GradeEntry[]
  | null
  | undefined;

/**
 * Ordem das numerações: NUMÉRICA, não lexical.
 * Sem isso "10" viria antes de "9" e a sobra sairia da numeração errada — o tipo
 * de bug que não estoura, só entrega a caixa errada no cliente.
 */
function compareSizes(a: string, b: string): number {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  const aIsNum = Number.isFinite(na);
  const bIsNum = Number.isFinite(nb);
  if (aIsNum && bIsNum && na !== nb) return na - nb;
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  return a.localeCompare(b, 'pt-BR');
}

/** Grade em lista ordenada por numeração, sem as numerações zeradas. */
export function normalizeGrade(grade: GradeInput): GradeEntry[] {
  if (!grade) return [];
  const entries: GradeEntry[] = Array.isArray(grade)
    ? grade.map((g) => ({ size: String(g.size), qty: Number(g.qty) || 0 }))
    : Object.entries(grade).map(([size, qty]) => ({ size: String(size), qty: Number(qty) || 0 }));
  return entries
    .filter((g) => g.qty > 0)
    .sort((a, b) => compareSizes(a.size, b.size));
}

/** Total de pares de uma grade. */
export function gradeTotal(grade: GradeInput): number {
  return normalizeGrade(grade).reduce((sum, g) => sum + g.qty, 0);
}

/**
 * Divide UMA ficha entre o que fica na colmeia e o que vai para a sobra.
 * A sobra sai das numerações do menor para o maior, e pode partir uma numeração
 * ao meio (é o caso do PV-00151: leva os 2 do nº 28 e só 1 dos 2 do nº 29).
 */
export function splitFicha(
  grade: GradeInput,
  capacity: number,
): { colmeia: GradeEntry[]; sobra: GradeEntry[] } {
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error(`Capacidade da caixa inválida (${capacity}) — cadastre a caixa no solado.`);
  }
  const sorted = normalizeGrade(grade);
  const total = sorted.reduce((sum, g) => sum + g.qty, 0);
  let remaining = Math.max(0, total - capacity);

  const colmeia: GradeEntry[] = [];
  const sobra: GradeEntry[] = [];
  for (const g of sorted) {
    const toSobra = Math.min(remaining, g.qty);
    remaining -= toSobra;
    if (toSobra > 0) sobra.push({ size: g.size, qty: toSobra });
    const stays = g.qty - toSobra;
    if (stays > 0) colmeia.push({ size: g.size, qty: stays });
  }
  return { colmeia, sobra };
}

/**
 * A regra só vale quando a grade É uma ficha.
 *
 * Ficha é 12/15/18 pares (constante do projeto, `worksheet/fichaSize.ts`) e a
 * sobra é o excedente PEQUENO sobre a caixa. PVs antigos gravaram `fichas = 1`
 * com a grade somando o pedido inteiro — PV-2026-00013 tem 120 pares numa
 * "ficha". Ali a sobra seria maior que uma caixa inteira e a regra fabricaria
 * caixas quase vazias: o PV-2026-00097 (24 pares, caixa de 12) viraria
 * 1 colmeia + 3 caixas de 4 pares, em vez de 2 caixas cheias.
 *
 * Quando não vale, `packSaleOrderItem` devolve `[]` e o chamador cai no cálculo
 * legado (CEIL(pares / capacidade)) — o mesmo contrato do lado SQL, onde a
 * função devolve 0 linhas e o `COALESCE(NULLIF(count,0), CEIL(...))` assume.
 */
export function packingApplies(grade: GradeInput, capacity: number): boolean {
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  const total = gradeTotal(grade);
  return total > 0 && total < capacity * 2;
}

export interface PackItemInput {
  /** Grade de UMA ficha (é assim que `sale_order_items.grade` guarda). */
  grade: GradeInput;
  /** Quantas fichas o item tem. */
  fichas: number;
  /** Pares por caixa, cadastrado no solado. */
  capacity: number;
}

/**
 * Plano de caixas de UM item do PV (uma referência, uma cor).
 *
 * ⚠ Chamar por item. Consolidar sobra entre itens misturaria cor/referência na
 * mesma caixa, que é justamente o que a regra proíbe.
 */
export function packSaleOrderItem({ grade, fichas, capacity }: PackItemInput): PackedBox[] {
  const sorted = normalizeGrade(grade);
  if (!sorted.length || !Number.isFinite(fichas) || fichas <= 0) return [];
  if (!packingApplies(sorted, capacity)) return [];

  const { colmeia, sobra } = splitFicha(sorted, capacity);
  const boxes: PackedBox[] = [];

  // Uma colmeia por ficha — conteúdo idêntico, porque a grade da ficha é a mesma.
  const colmeiaPairs = colmeia.reduce((sum, g) => sum + g.qty, 0);
  if (colmeiaPairs > 0) {
    for (let i = 0; i < fichas; i++) {
      boxes.push({
        kind: 'grade',
        contents: colmeia.map((g) => ({ ...g })),
        pairs: colmeiaPairs,
        partial: colmeiaPairs < capacity,
      });
    }
  }

  // Sobra: consolida no item inteiro e quebra em caixas de uma numeração só.
  for (const g of sobra) {
    let left = g.qty * fichas;
    while (left > 0) {
      const take = Math.min(left, capacity);
      boxes.push({
        kind: 'single',
        size: g.size,
        contents: [{ size: g.size, qty: take }],
        pairs: take,
        partial: take < capacity,
      });
      left -= take;
    }
  }

  return boxes;
}

/**
 * Peso de uma caixa em kg.
 * O peso do par vem SEMPRE da ficha técnica da referência
 * (`technical_sheets.weight_per_pair_kg`), independente da categoria do item;
 * `DEFAULT_PAIR_WEIGHT_KG` só entra quando a ficha não tem o valor.
 */
export function boxWeightKg(
  box: PackedBox,
  opts: { pairWeightKg?: number | null; boxTareKg?: number | null } = {},
): number {
  const pairKg =
    opts.pairWeightKg && opts.pairWeightKg > 0 ? opts.pairWeightKg : DEFAULT_PAIR_WEIGHT_KG;
  const tareKg = opts.boxTareKg && opts.boxTareKg > 0 ? opts.boxTareKg : 0;
  return box.pairs * pairKg + tareKg;
}
