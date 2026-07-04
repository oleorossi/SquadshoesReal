/**
 * Espelho puro da RPC `debit_packaging_for_order`
 * (migration atual: 20260704120000_fix-packaging-debit-idempotency-and-fallback-defaults).
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
  status: "debited_box_types" | "skipped";
  reason?: string;
  box_type_id?: string;
  box_name?: string;
  boxes_needed?: number;
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
 * de débito + lança erro se algum estoque é insuficiente (igual à RPC).
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

    if (!box || stock < needed) {
      throw new Error(
        `Estoque insuficiente para embalagem "${box?.nome ?? "?"}": disponível ${stock}, necessário ${needed}`
      );
    }

    result.push({
      packaging_type: t,
      status: "debited_box_types",
      box_type_id: boxId,
      box_name: box.nome,
      boxes_needed: needed,
    });
  }

  return result;
}