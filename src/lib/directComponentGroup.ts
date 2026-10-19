/**
 * COMPONENTES da ficha: SKU (product_id) obrigatório — débito exato.
 * Pin vence sempre; Ateliê/PV não escolhem cor nessa linha.
 * (Reverte Q11-a “só grupo”.)
 */

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

/** Linha nova: espera product_id antes do save. */
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

export function isValidDirectComponentProductId(
  productId: string | null | undefined,
): boolean {
  return !!productId && UUID_RE.test(String(productId).trim());
}

/** Linha presente sem SKU pinado — inválida pro save. */
export function isIncompleteDirectComponent(
  line: DirectComponentLine | null | undefined,
): boolean {
  if (!line) return false;
  return !isValidDirectComponentProductId(line.product_id);
}

/** Mensagem de validação pra save; null = ok. */
export function validateDirectComponentsForSave(
  lines: readonly DirectComponentLine[] | null | undefined,
): string | null {
  if (!lines?.length) return null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isValidDirectComponentProductId(line?.product_id)) continue;
    const label =
      String(line?.group_name || line?.product_name || '').trim() ||
      `Componente ${i + 1}`;
    return `“${label}” precisa do item (SKU) final para débito em estoque. Escolha o grupo e o item antes de salvar.`;
  }
  return null;
}

/** @deprecated Q11-a morto — mantido só pra testes/legado de leitura. */
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

/** Ids de produto pinados (débito / kit Ateliê). */
export function directComponentProductIds(
  lines: readonly DirectComponentLine[] | null | undefined,
): string[] {
  if (!lines?.length) return [];
  const out: string[] = [];
  for (const line of lines) {
    const id = String(line.product_id || '').trim();
    if (UUID_RE.test(id)) out.push(id);
  }
  return out;
}
