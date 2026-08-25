/**
 * Disponibilidade / falta sobre as linhas de consumo já anotadas
 * (`annotateConsumptionAvailability`). PURO e testável.
 *
 * Extraído de `MaterialConsumptionView` em 2026-08-05, quando a tela virou
 * buy-first: além do selo "falta" que já existia, passou a mostrar **quanto**
 * falta — e esse número alimenta a tabela, o trilho de decisão e a contagem do
 * topo. Com as funções privadas no componente, cada superfície reimplementaria
 * a subtração com um arredondamento diferente.
 *
 * Duas regras load-bearing moram aqui:
 *
 *  1. **Item = balde de estoque**, NÃO linha. Quando o motor resolveu produtos
 *     exatos, o balde é o conjunto de `productIds` + unidade; só linhas sem ID
 *     caem no legado `grupo + cor + unidade`. O mesmo material pode aparecer
 *     uma vez por APLICAÇÃO e essas aplicações dividem o mesmo estoque: o
 *     consumo se soma e o estoque é avaliado UMA vez sobre o total
 *     (`available` é representante, nunca soma). Contar linha a linha inflava
 *     "N em falta"; colapsar produtos distintos do mesmo grupo inventava falta.
 *  2. **Solado é avaliado POR NUMERAÇÃO**, igual à matriz — não pelo total de
 *     pares. 540 pares com estoque 540 pode ter 4 números em falta e 4
 *     sobrando; o total esconderia isso.
 */
import { buildColAvailability } from '@/lib/soleMatrixHtml';
import type { ConsumptionRow } from '@/lib/consumptionRows';

/** Disponível efetivo da linha (solado soma o `stock_grade`; demais usam `available`). */
export const rowAvailable = (r: ConsumptionRow): number =>
  r.componentType === 'Solado'
    ? Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0)
    : (r.available ?? 0);

/**
 * O consumo da linha é comparável com estoque?
 *
 * `widthMissing` = dm² tratado como metro (consumo ~100× inflado) e
 * `warning` sem quantidade = consumo não calculado. Nos dois casos a comparação
 * com estoque é inválida — a linha fica NEUTRA, nunca vermelha.
 */
export const rowKnown = (r: ConsumptionRow): boolean =>
  !r.widthMissing && !(r.warning && !(r.totalQuantity > 0));

/** Falta do solado por numeração: soma do que cada número não cobre. */
const soleShortfall = (r: ConsumptionRow): number => {
  const breakdown = r.sizeBreakdown || {};
  const sizes = Object.keys(breakdown);
  if (sizes.length === 0) return Math.max(0, r.totalQuantity - rowAvailable(r));
  const avail = buildColAvailability(r.soleSizeStock, sizes, breakdown);
  return sizes.reduce(
    (s, size) => s + Math.max(0, (Number(breakdown[size]) || 0) - (Number(avail[size]) || 0)),
    0,
  );
};

/** Quantos números do solado não são cobertos pelo `stock_grade` distribuído. */
export const soleShortSizes = (r: ConsumptionRow): string[] => {
  const breakdown = r.sizeBreakdown || {};
  const sizes = Object.keys(breakdown);
  if (sizes.length === 0) return [];
  const avail = buildColAvailability(r.soleSizeStock, sizes, breakdown);
  return sizes.filter((s) => (Number(breakdown[s]) || 0) > (Number(avail[s]) || 0));
};

export const soleRowShort = (r: ConsumptionRow): boolean => {
  const sizes = Object.keys(r.sizeBreakdown || {});
  if (sizes.length === 0) return rowAvailable(r) < r.totalQuantity;
  return soleShortSizes(r).length > 0;
};

export const rowIsShort = (r: ConsumptionRow): boolean => {
  if (!rowKnown(r)) return false;
  if (r.componentType === 'Solado') return soleRowShort(r);
  return rowAvailable(r) < r.totalQuantity;
};

/**
 * QUANTO falta da linha, na unidade dela. `0` quando cobre ou quando o cadastro
 * está incompleto (não comparável — a UI mostra "—", não zero).
 */
export const rowShortfall = (r: ConsumptionRow): number => {
  if (!rowKnown(r)) return 0;
  if (r.componentType === 'Solado') return soleShortfall(r);
  return Math.max(0, r.totalQuantity - rowAvailable(r));
};

// ── Item = BALDE de estoque (produto exato; fallback grupo + cor + unidade) ─
export type ItemGroup = {
  key: string;
  componentType: string;
  groupName: string;
  color: string;
  productUnit: string;
  rows: ConsumptionRow[];
  total: number;
  available: number;
  /** Falso quando alguma aplicação tem cadastro incompleto → estoque não comparável. */
  known: boolean;
};

export const itemKey = (r: ConsumptionRow) => {
  const productIds = [...new Set((r.productIds || []).map((id) => id.trim()).filter(Boolean))]
    .sort();
  if (productIds.length > 0) {
    return `products||${productIds.join(',')}||${r.productUnit}`;
  }
  return `fallback||${r.groupName}||${r.color}||${r.productUnit}`;
};

export const aggregateItems = (rows: ConsumptionRow[]): ItemGroup[] => {
  const map = new Map<string, ItemGroup>();
  for (const r of rows) {
    const k = itemKey(r);
    let it = map.get(k);
    if (!it) {
      it = {
        key: k,
        componentType: r.componentType,
        groupName: r.groupName,
        color: r.color,
        productUnit: r.productUnit,
        rows: [],
        total: 0,
        available: rowAvailable(r),
        known: true,
      };
      map.set(k, it);
    }
    it.rows.push(r);
    it.total += Number(r.totalQuantity) || 0;
    if (!rowKnown(r)) it.known = false;
  }
  return Array.from(map.values());
};

export const itemIsShort = (it: ItemGroup): boolean => it.known && it.available < it.total;

export const itemShortfall = (it: ItemGroup): number =>
  it.known ? Math.max(0, it.total - it.available) : 0;

/** Contagem "em falta" ITEM-a-item (não linha-a-linha). Solado por numeração. */
export const countShort = (rows: ConsumptionRow[]): number => {
  const sole = rows.filter((r) => r.componentType === 'Solado' && rowIsShort(r)).length;
  const others = aggregateItems(rows.filter((r) => r.componentType !== 'Solado'))
    .filter(itemIsShort).length;
  return sole + others;
};

/** Linhas com cadastro incompleto — as que a tela marca com ▲ e deixa fora do total. */
export const countPending = (rows: ConsumptionRow[]): number =>
  rows.filter((r) => r.widthMissing || r.warning).length;

/**
 * As maiores faltas, já na unidade de cada uma, maior primeiro. Alimenta o
 * trilho de decisão ("quanto pedir") sem obrigar a ler a tabela inteira.
 * Solado entra por LINHA (avaliado por numeração); o resto por balde.
 */
export type ShortfallEntry = {
  label: string;
  color: string;
  qty: number;
  unit: string;
  /** Solado: quantos números não são cobertos. */
  sizes?: number;
};

export const topShortfalls = (rows: ConsumptionRow[], limit = 5): ShortfallEntry[] => {
  const out: ShortfallEntry[] = [];
  for (const r of rows.filter((x) => x.componentType === 'Solado')) {
    const qty = rowShortfall(r);
    if (qty > 0) {
      out.push({
        label: r.groupName,
        color: r.color,
        qty,
        unit: r.productUnit,
        sizes: soleShortSizes(r).length,
      });
    }
  }
  for (const it of aggregateItems(rows.filter((x) => x.componentType !== 'Solado'))) {
    const qty = itemShortfall(it);
    if (qty > 0) out.push({ label: it.groupName, color: it.color, qty, unit: it.productUnit });
  }
  return out.sort((a, b) => b.qty - a.qty).slice(0, limit);
};
