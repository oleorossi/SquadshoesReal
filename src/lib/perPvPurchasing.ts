/**
 * Canal "Compras por Pedido" — lógica PURA de agrupamento de materiais em OCs.
 *
 * Separado do MRP/ondas: aqui geramos OCs a partir de UM PV (ou de um conjunto
 * selecionado), uma OC por fornecedor + uma OC agrupada "Sem Fornecedor".
 *
 * A DEMANDA em si (consumo × pares, conversão dm²→física, desconto de
 * estoque/reserva) é calculada no banco pela RPC `compute_materials_per_pv`
 * (wrapper de `calculate_order_consumption` — o motor canônico de consumo, o
 * mesmo do modal "Consumo de Materiais", do MRP e das ondas). Este módulo só
 * recebe a lista de necessidades já calculada e a empacota em OCs — por isso é
 * 100% testável sem banco.
 */

import { roundUpToPurchaseMultiple } from '@/lib/purchaseMultiple';

/** Uma necessidade de material vinda da RPC compute_materials_per_pv. */
export interface PvMaterialNeed {
  material_id: string;
  product_name: string;
  unit: string;
  color?: string | null;
  /** Necessidade BRUTA do(s) PV(s): consumo × pares (já convertido dm²→física). */
  needed_qty: number;
  /** Estoque líquido disponível (quantity − reserved_stock). Informativo. */
  stock_qty?: number | null;
  /** Falta líquida = max(0, needed − stock). Informativo. */
  shortage?: number | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  /** Custo padrão do produto (estimativa de preço da OC). */
  last_unit_price: number;
  is_artisanal?: boolean;
  /** Múltiplo de compra (embalagem): qtd arredonda pra cima. Enriquecido pela UI. */
  purchase_multiple?: number | null;
}

export interface DraftPurchaseOrderItem {
  material_id: string;
  product_name: string;
  unit: string;
  color: string | null;
  /** Quantidade a comprar (default = needed_qty bruto; editável na UI). */
  quantity: number;
  needed_qty: number;
  stock_qty: number;
  unit_price: number;
  purchase_multiple?: number | null;
}

export interface DraftPurchaseOrder {
  supplier_id: string | null;
  /** NO_SUPPLIER_LABEL quando supplier_id é null. */
  supplier_name: string;
  items: DraftPurchaseOrderItem[];
  total: number;
}

export const NO_SUPPLIER_LABEL = 'Sem Fornecedor';

export interface BuildOptions {
  /**
   * Quando true, a quantidade da OC = falta líquida (max(0, needed − stock)) e
   * itens totalmente cobertos por estoque são descartados. Quando false
   * (default), usa a necessidade BRUTA — comprar tudo que o pedido consome,
   * sem netar contra estoque (evita o double-count de reserved_stock do
   * próprio PV e é o comportamento esperado pra "comprar pra ESTE pedido").
   */
  netOfStock?: boolean;
}

/** Arredonda pra 3 casas, evitando lixo de ponto flutuante. */
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function colorKey(c: string | null | undefined): string {
  return (c ?? '').trim().toLowerCase();
}

/**
 * Empacota necessidades de material em OCs, uma por fornecedor + uma agrupada
 * "Sem Fornecedor".
 *
 * - Linhas com mesmo (material_id + cor) são MESCLADAS somando as quantidades
 *   (cobre o caso de 2 PVs com o mesmo material — a RPC já soma no banco, mas
 *   mesclamos de novo defensivamente).
 * - Agrupa por supplier_id; supplier_id null cai num único balde
 *   NO_SUPPLIER_LABEL.
 * - Ordena: fornecedores nomeados em ordem alfabética, "Sem Fornecedor" por
 *   último (a UI exibe o aviso dele no topo separadamente).
 */
export function buildPerPvPurchaseOrders(
  needs: PvMaterialNeed[],
  opts: BuildOptions = {},
): DraftPurchaseOrder[] {
  const netOfStock = opts.netOfStock ?? false;

  // 1) Mescla por (material_id + cor).
  const merged = new Map<string, DraftPurchaseOrderItem & { supplier_id: string | null; supplier_name: string | null }>();
  for (const n of needs) {
    if (!n || !n.material_id) continue;
    const key = `${n.material_id}::${colorKey(n.color)}`;
    const needed = Number(n.needed_qty) || 0;
    const stock = Number(n.stock_qty) || 0;
    const price = Number(n.last_unit_price) || 0;
    const existing = merged.get(key);
    if (existing) {
      existing.needed_qty = round3(existing.needed_qty + needed);
      existing.stock_qty = round3(existing.stock_qty + stock);
      // mantém o maior preço conhecido (mais conservador pra estimativa)
      existing.unit_price = Math.max(existing.unit_price, price);
    } else {
      merged.set(key, {
        material_id: n.material_id,
        product_name: n.product_name,
        unit: n.unit || 'un',
        color: (n.color ?? null) || null,
        quantity: 0, // definido abaixo
        needed_qty: round3(needed),
        stock_qty: round3(stock),
        unit_price: price,
        purchase_multiple: n.purchase_multiple ?? null,
        supplier_id: n.supplier_id ?? null,
        supplier_name: n.supplier_name ?? null,
      });
    }
  }

  // 2) Define quantidade a comprar e descarta zeros.
  const items: (DraftPurchaseOrderItem & { supplier_id: string | null; supplier_name: string | null })[] = [];
  for (const it of merged.values()) {
    const qtyRaw = netOfStock
      ? Math.max(0, round3(it.needed_qty - it.stock_qty))
      : it.needed_qty;
    // Múltiplo de compra (embalagem): arredonda pra cima (ex.: 187 → 200 c/ 50).
    const qty = roundUpToPurchaseMultiple(qtyRaw, it.purchase_multiple);
    if (qty <= 0) continue;
    items.push({ ...it, quantity: qty });
  }

  // 3) Agrupa por fornecedor.
  const groups = new Map<string, DraftPurchaseOrder>();
  for (const it of items) {
    const gid = it.supplier_id ?? '__none__';
    let g = groups.get(gid);
    if (!g) {
      g = {
        supplier_id: it.supplier_id,
        supplier_name: it.supplier_id ? (it.supplier_name || 'Fornecedor') : NO_SUPPLIER_LABEL,
        items: [],
        total: 0,
      };
      groups.set(gid, g);
    }
    g.items.push({
      material_id: it.material_id,
      product_name: it.product_name,
      unit: it.unit,
      color: it.color,
      quantity: it.quantity,
      needed_qty: it.needed_qty,
      stock_qty: it.stock_qty,
      unit_price: it.unit_price,
    });
  }

  // 4) Totais + ordenação interna + ordenação de baldes.
  const result = Array.from(groups.values());
  for (const g of result) {
    g.items.sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR'));
    g.total = round3(g.items.reduce((s, i) => s + i.quantity * i.unit_price, 0));
  }
  result.sort((a, b) => {
    if (a.supplier_id === null) return 1; // "Sem Fornecedor" por último
    if (b.supplier_id === null) return -1;
    return a.supplier_name.localeCompare(b.supplier_name, 'pt-BR');
  });
  return result;
}

export interface PerPvDraftSummary {
  supplierCount: number;    // OCs com fornecedor
  hasNoSupplier: boolean;   // existe balde "Sem Fornecedor"?
  orderCount: number;       // total de OCs que serão criadas
  itemCount: number;        // total de itens (linhas)
  noSupplierItemCount: number;
  total: number;            // valor estimado somado
}

export function summarizePerPvDrafts(drafts: DraftPurchaseOrder[]): PerPvDraftSummary {
  const noSupplier = drafts.find((d) => d.supplier_id === null);
  return {
    supplierCount: drafts.filter((d) => d.supplier_id !== null).length,
    hasNoSupplier: !!noSupplier,
    orderCount: drafts.length,
    itemCount: drafts.reduce((s, d) => s + d.items.length, 0),
    noSupplierItemCount: noSupplier ? noSupplier.items.length : 0,
    total: round3(drafts.reduce((s, d) => s + d.total, 0)),
  };
}

/**
 * Predicado canônico do canal — uma OC pertence ao "Compras por Pedido"?
 * Defensivo: trata source_type ausente/null como NÃO per_pv (OCs legadas e do
 * MRP continuam visíveis no menu tradicional).
 */
export function isPerPvPurchaseOrder(po: { source_type?: string | null } | null | undefined): boolean {
  return !!po && po.source_type === 'per_pv';
}
