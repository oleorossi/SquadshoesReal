/**
 * Snapshot de componente direto vs catálogo vivo.
 *
 * `technical_sheets.direct_components[].product_name` (e `unit` / grupo) só eram
 * escritos no `onChange` do `DirectComponentSelect` e NUNCA refrescados depois —
 * nem pelo save da ficha, que normalizava apenas `consumption_sector`
 * (`normalizeDirectComponentSectors`). Os handlers de quantidade e de setor fazem
 * `{ ...arr[idx], quantity: v }`, então re-persistem o snapshot velho.
 *
 * Resultado: renomear o produto no estoque deixava a ficha mentindo. Em 17/09/2026
 * o SKU 8440419756 passou de `Binóculo 10mm Strass` para `Pedra Amassada KR`
 * (`material_audit_log`) e as fichas salvas antes disso seguiram exibindo o nome
 * antigo — enquanto consumo, reserva, débito e custeio já liam `products.name` ao
 * vivo. A ficha dizia uma coisa e o estoque debitava outra, sem nenhum aviso.
 *
 * Unidade tinha o mesmo buraco: linha nova nascia com `unit: 'un'` e só ganhava
 * `products.unit` ao pinarem o SKU; fichas antigas / grupo trocado sem re-pin
 * ficavam com `(un)` na UI enquanto o estoque era `m`/`cm`.
 *
 * ⚠ O snapshot NÃO é lixo: para componente cujo produto saiu do estoque ele é o
 * único registro do que a ficha pedia, e é o que o ramo órfão dos motores emite
 * (`orderConsumption.ts` → `dc.product_name`). Por isso nada aqui o apaga —
 * o rótulo só é reescrito quando existe produto vivo com nome.
 *
 * ⚠ Reescrever nome é sempre `products.name` EXATO. `classifyBomMaterial` classifica
 * o componente por substring do nome quando o produto não tem grupo nem categoria;
 * rótulo inventado reclassificaria a linha na ficha de operador.
 *
 * ⚠ `unit_price` NÃO é catálogo da ficha — pode ser snapshot comercial; não mexer.
 */

export interface DirectComponentLabelLike {
  product_id?: string | null;
  product_name?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  consumption_sector?: string | null;
  /** As entradas do JSONB carregam quantidade e demais campos — preservados. */
  [key: string]: unknown;
}

export interface LiveProductLabelLike {
  id: string;
  name?: string | null;
  unit?: string | null;
  group_id?: string | null;
  groupName?: string | null;
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
 * Unidade a EXIBIR em "Qtd por par (…)".
 * Produto vivo vence o snapshot; sem SKU / sem unidade honesta → null (rótulo sem parênteses).
 */
export function directComponentDisplayUnit(
  component: DirectComponentLabelLike | null | undefined,
  liveProduct: LiveProductLabelLike | null | undefined,
): string | null {
  const live = (liveProduct?.unit || '').toString().trim();
  if (live) return live;
  const snap = (component?.unit || '').toString().trim();
  return snap || null;
}

function sameText(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

/**
 * Realinha snapshot de catálogo (`product_name`, `unit`, `group_id`, `group_name`)
 * ao produto vivo. Preserva quantidade, preço, setor e demais campos.
 * Entrada que não muda sai com a MESMA referência, pra não sujar o form sem necessidade.
 */
export function refreshDirectComponentLabels<T extends DirectComponentLabelLike>(
  components: T[] | null | undefined,
  products: LiveProductLabelLike[] | null | undefined,
): T[] {
  const list = components || [];
  if (list.length === 0) return [];
  const liveById = new Map<string, LiveProductLabelLike>();
  (products || []).forEach((product) => {
    if (product?.id) liveById.set(product.id, product);
  });
  if (liveById.size === 0) return list;

  let changed = false;
  const out = list.map((component) => {
    const productId = (component?.product_id || '').trim();
    if (!productId) return component;
    const live = liveById.get(productId);
    if (!live) return component;

    const liveName = (live.name || '').trim();
    const liveUnit = (live.unit || '').toString().trim();
    const liveGroupId = (live.group_id || '').trim() || null;
    const liveGroupName = (live.groupName || '').trim() || null;

    const nextName = liveName || (component.product_name || '');
    const nextUnit = liveUnit || component.unit || null;
    const nextGroupId = liveGroupId || component.group_id || null;
    const nextGroupName = liveGroupName || component.group_name || null;

    const nameSame = !liveName || sameText(nextName, component.product_name);
    const unitSame = !liveUnit || sameText(nextUnit, component.unit);
    const groupIdSame = !liveGroupId || sameText(nextGroupId, component.group_id);
    const groupNameSame = !liveGroupName || sameText(nextGroupName, component.group_name);
    if (nameSame && unitSame && groupIdSame && groupNameSame) return component;

    changed = true;
    return {
      ...component,
      product_name: liveName ? nextName : component.product_name,
      unit: liveUnit ? nextUnit : component.unit,
      group_id: liveGroupId ? nextGroupId : component.group_id,
      group_name: liveGroupName ? nextGroupName : component.group_name,
    };
  });
  return changed ? out : list;
}
