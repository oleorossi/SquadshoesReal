/**
 * Espelho puro da RPC `debit_packaging_for_order`
 * (migration atual: 20261025120000_packaging-debit-partial-instead-of-abort).
 *
 * A RPC real lê `product_groups` (solado da ficha técnica) e debita estoque em
 * `box_types` + `stock_movements`. Esta função reproduz APENAS a lógica de
 * cálculo (quais tipos debitar, quantas caixas e validação de estoque), para
 * que possamos testá-la sem ir ao Postgres.
 *
 * Fora do escopo deste espelho (são efeitos de estado no banco): a idempotência
 * por `order_id` (#5) e os avisos `skipped_no_box_linked`/`no_packaging_configured`
 * no JSON de retorno — cobertos direto na RPC.
 *
 * Mantenha em sincronia com a migration. Se a RPC mudar, atualize aqui.
 */

export type PackagingMode =
  | "individual"
  | "individual_amarrado"
  | "individual_master"
  | "individual_fitilho"
  | "colmeia";

export type PackagingType = "individual" | "master" | "colmeia" | "fitilho";

export interface SoleGroupPackaging {
  box_type_id: string | null;
  box_type_master_id: string | null;
  box_type_colmeia_id: string | null;
  box_type_fitilho_id: string | null;
  pairs_per_box_individual: number | null;
  pairs_per_box_master: number | null;
  pairs_per_box_colmeia: number | null;
  pairs_per_box_fitilho: number | null;
}

export interface BoxTypeRow {
  id: string;
  nome: string;
  quantity: number;
  active?: boolean;
}

export interface DebitEntry {
  packaging_type: PackagingType;
  status: "debited_box_types" | "partial" | "insufficient_stock" | "skipped";
  reason?: string;
  box_type_id?: string;
  box_name?: string;
  boxes_needed?: number;
  /** Quanto efetivamente sairia do estoque: LEAST(necessário, disponível). */
  debited_qty?: number;
  /** O que faltou: necessário − debitado. 0 quando cobriu tudo. */
  shortfall?: number;
}

/** Mapeia o modo trimodal aos tipos de caixa que devem ser debitados. */
export function resolveTypesForMode(mode: PackagingMode): PackagingType[] {
  switch (mode) {
    case "colmeia":
      return ["colmeia"];
    case "individual_master":
      return ["individual", "master"];
    case "individual_fitilho":
    case "individual_amarrado":
      // Amarrado == fitilho: debita individual + fitilho (alinhado à RPC viva).
      return ["individual", "fitilho"];
    case "individual":
    default:
      return ["individual"];
  }
}

function pickBoxId(sole: SoleGroupPackaging, t: PackagingType): string | null {
  switch (t) {
    case "individual": return sole.box_type_id;
    case "master":     return sole.box_type_master_id;
    case "colmeia":    return sole.box_type_colmeia_id;
    case "fitilho":    return sole.box_type_fitilho_id;
  }
}

function pickPairs(sole: SoleGroupPackaging, t: PackagingType): number | null {
  switch (t) {
    case "individual": return sole.pairs_per_box_individual;
    case "master":     return sole.pairs_per_box_master;
    case "colmeia":    return sole.pairs_per_box_colmeia;
    case "fitilho":    return sole.pairs_per_box_fitilho;
  }
}

/**
 * Calcula o número de caixas necessárias.
 * Espelha a RPC: pares/caixa sem valor cai no default canônico 12 (alinhado com a
 * NF `compute_sale_order_nfe_volumes`), não mais 1 — #4. Para uma caixa que
 * comporta 1 par, cadastre `pairs_per_box_*` = 1 explicitamente (valor específico
 * sempre vence). CEIL(qty / GREATEST(COALESCE(NULLIF(pairs,0),12), 1)).
 */
export const DEFAULT_PAIRS_PER_BOX = 12;
export function boxesNeeded(orderQuantity: number, pairsPerBox: number | null): number {
  const pairs = !pairsPerBox || pairsPerBox <= 0 ? DEFAULT_PAIRS_PER_BOX : pairsPerBox;
  return Math.ceil(orderQuantity / Math.max(pairs, 1));
}

/**
 * Simula `debit_packaging_for_order`. Não muta as entradas; retorna o plano
 * de débito.
 *
 * Falta de estoque NÃO lança mais erro (migration `20261025120000`): a RPC passou
 * a debitar `LEAST(necessário, disponível)` e a reportar o buraco, porque o
 * `RAISE EXCEPTION` antigo derrubava o lançamento do Pedido de Venda inteiro —
 * o caller (`useSaleOrders.ts`) liberava as reservas e CANCELAVA a OP. Estourou
 * em produção em 31/07/2026, quando a caixa colmeia (estoque 0) foi vinculada aos
 * grupos de solado e ligou o débito de embalagem pela primeira vez.
 *
 * Status: 'debited_box_types' (cobriu tudo), 'partial' (debitou parte),
 * 'insufficient_stock' (disponível 0 — não gera movimento).
 */
export function planPackagingDebit(args: {
  sole: SoleGroupPackaging | null;
  boxes: Record<string, BoxTypeRow>;
  orderQuantity: number;
  mode: PackagingMode;
}): { status?: "skipped"; reason?: string } | DebitEntry[] {
  const { sole, boxes, orderQuantity, mode } = args;

  if (!sole) return { status: "skipped", reason: "sole_group_not_set" };

  const types = resolveTypesForMode(mode);
  const result: DebitEntry[] = [];

  for (const t of types) {
    const boxId = pickBoxId(sole, t);
    if (!boxId) {
      result.push({ packaging_type: t, status: "skipped", reason: "no_box_for_sole" });
      continue;
    }
    const box = boxes[boxId];
    const pairs = pickPairs(sole, t);
    const needed = boxesNeeded(orderQuantity, pairs);
    const stock = box?.quantity ?? 0;

    const debited = Math.min(needed, Math.max(0, stock));
    const shortfall = Math.max(0, needed - debited);

    result.push({
      packaging_type: t,
      status: shortfall === 0 ? "debited_box_types" : debited > 0 ? "partial" : "insufficient_stock",
      box_type_id: boxId,
      box_name: box?.nome,
      boxes_needed: needed,
      debited_qty: debited,
      shortfall,
    });
  }

  return result;
}