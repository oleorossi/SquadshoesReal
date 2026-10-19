/**
 * COMPONENTES da ficha: cadastro por GRUPO; SKU resolve na cor do pedido.
 * Decisão do dono (grill Ateliê kit): sempre grupo, não pin de cor.
 */

export interface DirectComponentLine {
  group_id?: string | null;
  group_name?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  consumption_sector?: string | null;
}

/** Linha nova: só grupo + qtd + setor. */
export function emptyDirectComponentLine(): DirectComponentLine {
  return {
    group_id: null,
    group_name: null,
    product_id: null,
    product_name: null,
    quantity: 1,
    unit: 'un',
    unit_price: 0,
    consumption_sector: 'Aviamento',
  };
}

/** Normaliza linha legada (só product_id) preservando o pin até o usuário regravar. */
export function withGroupFromProduct(
  line: DirectComponentLine,
  product: { id: string; group_id?: string | null; groupName?: string | null; name?: string | null } | null,
): DirectComponentLine {
  if (!product) return line;
  return {
    ...line,
    group_id: line.group_id || product.group_id || null,
    group_name: line.group_name || product.groupName || null,
    product_id: line.product_id || product.id,
    product_name: line.product_name || product.name || null,
  };
}

/** É cadastro por grupo (sem pin de SKU / cor)? */
export function isGroupOnlyDirectComponent(line: DirectComponentLine | null | undefined): boolean {
  if (!line) return false;
  return !!line.group_id && !line.product_id;
}

/** Ids de grupo das linhas (group_id explícito ou derivado). */
export function directComponentGroupIds(
  lines: readonly DirectComponentLine[] | null | undefined,
  productGroupById?: Map<string, string>,
): string[] {
  if (!lines?.length) return [];
  const out = new Set<string>();
  for (const line of lines) {
    if (line.group_id) {
      out.add(line.group_id);
      continue;
    }
    if (line.product_id && productGroupById?.has(line.product_id)) {
      out.add(productGroupById.get(line.product_id)!);
    }
  }
  return [...out];
}
