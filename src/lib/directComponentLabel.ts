/**
 * Rótulo de componente direto: o `product_id` é a verdade, `product_name` é snapshot.
 *
 * `technical_sheets.direct_components[].product_name` só era escrito no `onChange`
 * do `DirectComponentSelect` (`TechnicalSheets.tsx`) e NUNCA refrescado depois —
 * nem pelo save da ficha, que normaliza apenas `consumption_sector`
 * (`normalizeDirectComponentSectors`). Os handlers de quantidade e de setor fazem
 * `{ ...arr[idx], quantity: v }`, então re-persistem o rótulo velho.
 *
 * Resultado: renomear o produto no estoque deixava a ficha mentindo. Em 17/09/2026
 * o SKU 8440419756 passou de `Binóculo 10mm Strass` para `Pedra Amassada KR`
 * (`material_audit_log`) e as fichas salvas antes disso seguiram exibindo o nome
 * antigo — enquanto consumo, reserva, débito e custeio já liam `products.name` ao
 * vivo (`calculate_order_consumption_by_grade` faz `SELECT p.name … WHERE p.id = v_pid`).
 * A ficha dizia uma coisa e o estoque debitava outra, sem nenhum aviso.
 *
 * ⚠ O snapshot NÃO é lixo: para componente cujo produto saiu do estoque ele é o
 * único registro do que a ficha pedia, e é o que o ramo órfão dos motores emite
 * (`orderConsumption.ts` → `dc.product_name`). Por isso nada aqui o apaga —
 * o rótulo só é reescrito quando existe produto vivo com nome.
 *
 * ⚠ Reescrever é sempre `products.name` EXATO. `classifyBomMaterial` classifica o
 * componente por substring do nome (`napa`/`cola`/`caixa`/`tira`…) quando o produto
 * não tem grupo nem categoria; rótulo inventado reclassificaria a linha na ficha
 * de operador.
 */

export interface DirectComponentLabelLike {
  product_id?: string | null;
  product_name?: string | null;
  consumption_sector?: string | null;
  /** As entradas do JSONB carregam quantidade, unidade e preço — preservados intactos. */
  [key: string]: unknown;
}

export interface LiveProductLabelLike {
  id: string;
  name?: string | null;
}

/** Nome a EXIBIR numa linha de componente direto. Produto vivo vence o snapshot. */
export function directComponentDisplayName(
  component: DirectComponentLabelLike | null | undefined,
  liveProduct: LiveProductLabelLike | null | undefined,
  index?: number,
): string {
  const live = (liveProduct?.name || '').trim();
  if (live) return live;
  const snapshot = (component?.product_name || '').trim();
  if (snapshot) return snapshot;
  return typeof index === 'number' ? `Componente ${index + 1}` : 'Componente';
}

/**
 * Realinha os rótulos gravados ao `products.name` vigente, preservando todo o
 * resto da entrada (quantidade, preço, unidade, setor). Entrada que não muda sai
 * com a MESMA referência, pra não sujar o form sem necessidade.
 */
export function refreshDirectComponentLabels<T extends DirectComponentLabelLike>(
  components: T[] | null | undefined,
  products: LiveProductLabelLike[] | null | undefined,
): T[] {
  const list = components || [];
  if (list.length === 0) return [];
  const liveNameById = new Map<string, string>();
  (products || []).forEach((product) => {
    const name = (product?.name || '').trim();
    if (product?.id && name) liveNameById.set(product.id, name);
  });
  if (liveNameById.size === 0) return list;
  return list.map((component) => {
    const productId = (component?.product_id || '').trim();
    if (!productId) return component;
    const liveName = liveNameById.get(productId);
    if (!liveName || liveName === (component.product_name || '')) return component;
    return { ...component, product_name: liveName };
  });
}
