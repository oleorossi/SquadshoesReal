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
 * Tira artesanal com receita conferida: o motor reserva/baixa NAPA, nunca os
 * metros de tira. Tratar 1.402 m de overlock como "falta" faz o PDF e o
 * trilho mentirem. Essa napa (~20 m) é a enviada ao prestador e, desde
 * 11/10/2026, aparece só no Setor de Tiras — fora de todo total/falta de napa.
 *
 * ⚠ Isto decide só a MÉTRICA DE COMPRA. A linha da tira continua visível na
 * tabela e no PDF com seus metros de tira (D8, spec tiras-redesenho) — nunca
 * use este predicado para esconder a linha.
 */
export const isConvertedInternalStrap = (r: ConsumptionRow): boolean =>
  !!r.artisanal
  && !r.artisanal.pending
  && Number(r.artisanal.baseQty) > 0;

/**
 * Tira de STRASS (acabada / buy_ready). Na TELA vai em aba própria — não
 * mistura com overlock/chata de produção interna (pedido do dono). No PDF,
 * desde 11/10/2026, entra no bloco único "Tiras" do §02 (total por tipo × cor,
 * coluna Origem = Comprar pronto).
 */
export const isStrassStrapRow = (
  r: Pick<ConsumptionRow, 'componentType' | 'groupName' | 'materialName'>,
): boolean =>
  r.componentType === 'Tiras'
  && /strass/i.test(`${r.groupName || ''} ${r.materialName || ''}`);

/**
 * Tira artesanal sem rendimento/cadastro: os metros de tira NÃO entram na
 * métrica de compra nem no strip "Necessidade total" — senão 1.044 m de tira
 * pendente somam com 129 m de napa e o PDF mente (PV-00193).
 */
export const isPendingInternalStrap = (r: ConsumptionRow): boolean =>
  !!r.artisanal?.pending;

/** Tira de origem Prestador (`internal`; chave interna `fazer`), convertida, bloqueada ou coberta pelo estoque. */
export const isFazerStrapRow = (r: ConsumptionRow): boolean =>
  r.componentType === 'Tiras' && (!!r.artisanal || r.strap?.origin === 'fazer');

/** Unidade sintética dos totais: metro de TIRA nunca soma com metro de napa (D8). */
export const STRAP_METER_TOTAL_UNIT = 'm de tira';

/**
 * Tira interna (convertida OU pendente). Nenhuma das duas entra na métrica de
 * compra nem no strip de metros (`toPurchaseDecisionRows` / `unitTotals`); a
 * pendente vira alerta (`pendingStrapMeters`) e a napa da convertida fica só
 * no Setor de Tiras (11/10/2026).
 */
export const isInternalStrapRow = (r: ConsumptionRow): boolean =>
  isConvertedInternalStrap(r) || isPendingInternalStrap(r);

/**
 * Linhas na métrica de COMPRA da tela/PDF de consumo: a tira interna
 * (Prestador — convertida ou pendente) sai. Não se compra tira de Prestador e,
 * desde a decisão do dono de 11/10/2026, a napa dela também não entra no
 * balde da napa: ela mora só no Setor de Tiras (§03 / bloco da tela). Antes
 * esta função somava a napa da tira no balde da família/cor — e a "falta" de
 * napa contradizia o total de napa do §01, que já não a inclui.
 *
 * Solado, palmilha, químicos e tira comprada-pronta ficam iguais.
 * ⚠ A geração de OC NÃO passa por aqui (usa `compute_materials_per_pv`) e
 * ainda compra a napa das tiras até a virada "tira = material de estoque".
 */
export function toPurchaseDecisionRows(rows: ConsumptionRow[]): ConsumptionRow[] {
  const rest: ConsumptionRow[] = [];
  for (const row of rows) {
    // D9 + 11/10/2026: tira Fazer nunca entra na compra daqui — nem como
    // metros de tira (não se compra), nem como napa (Setor de Tiras).
    if (isInternalStrapRow(row)) continue;
    rest.push({ ...row, productIds: row.productIds ? [...row.productIds] : row.productIds });
  }
  return rest;
}

/**
 * Totais por unidade ("Necessidade total"): metro de tira nunca soma com metro
 * de napa (D8), e a napa convertida da tira também não entra — desde
 * 11/10/2026 ela fica só no Setor de Tiras. Antes o `m` do strip somava a
 * napa da tira e não batia com o total de napa do §01.
 *
 * Tira `pending` também fica de fora: somar os metros brutos de tira infla o
 * strip (1.173 m vs 129 m no PV-00193).
 */
const normalizedMeter = (unit: string | null | undefined): boolean =>
  ['m', 'metro', 'metros'].includes((unit || '').toLowerCase().trim());

/**
 * Chave de unidade para SUBTOTAIS de tela/PDF: metro de tira vira
 * `m de tira`, para nunca somar com metro de napa na mesma seção (D8).
 */
export const subtotalUnitKey = (
  row: Pick<ConsumptionRow, 'componentType' | 'productUnit'>,
): string => (row.componentType === 'Tiras' && normalizedMeter(row.productUnit)
  ? STRAP_METER_TOTAL_UNIT
  : row.productUnit);

export function unitTotals(rows: ConsumptionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  const add = (unit: string, qty: number) => {
    if (!(qty > 0)) return;
    const key = unit || '';
    map.set(key, (map.get(key) || 0) + qty);
  };
  for (const row of rows) {
    // Tira de Prestador (convertida, pendente ou coberta pelo estoque de tira
    // pronta): nem os metros de tira nem a napa dela entram no strip.
    if (isInternalStrapRow(row) || isFazerStrapRow(row)) continue;
    // Comprar: metro de TIRA pronta — chave própria, nunca soma com napa (D8).
    if (row.componentType === 'Tiras' && normalizedMeter(row.productUnit)) {
      add(STRAP_METER_TOTAL_UNIT, row.totalQuantity);
    } else add(row.productUnit, row.totalQuantity);
  }
  return map;
}

/** Metros de tira com cadastro/rendimento pendente — alerta, não compra. */
export function pendingStrapMeters(rows: ConsumptionRow[]): number {
  return rows.reduce(
    (total, row) => total + (isPendingInternalStrap(row) ? Math.max(0, Number(row.totalQuantity) || 0) : 0),
    0,
  );
}

/**
 * O consumo da linha é comparável com estoque?
 *
 * `widthMissing` = dm² tratado como metro (consumo ~100× inflado), solado
 * sem `soleProductId` = texto sem identidade de estoque e `warning` sem
 * quantidade = consumo não calculado. Nesses casos a comparação é inválida
 * — a linha fica NEUTRA, nunca vermelha.
 */
export const rowKnown = (r: ConsumptionRow): boolean =>
  !r.widthMissing
  && !(r.componentType === 'Solado' && !r.soleProductId)
  && !(r.warning && !(r.totalQuantity > 0));

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
  // Tira Fazer não se compra. Desde 11/10/2026 a napa dela também não entra
  // na falta: ela mora só no Setor de Tiras (§03 / bloco da tela).
  if (isConvertedInternalStrap(r) || isFazerStrapRow(r)) return false;
  if (!rowKnown(r)) return false;
  if (r.componentType === 'Solado') return soleRowShort(r);
  return rowAvailable(r) < r.totalQuantity;
};

/**
 * QUANTO falta da linha, na unidade dela. `0` quando cobre, quando o cadastro
 * está incompleto, ou quando a linha é tira interna (nem os metros de tira nem
 * a napa dela contam: a napa da tira é assunto do Setor de Tiras).
 */
export const rowShortfall = (r: ConsumptionRow): number => {
  if (isConvertedInternalStrap(r) || isFazerStrapRow(r)) return 0;
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
  const boxTypeIds = [...new Set((r.boxTypeIds || []).map((id) => id.trim()).filter(Boolean))]
    .sort();
  if (boxTypeIds.length > 0) {
    return `box_types||${boxTypeIds.join(',')}||${r.productUnit}`;
  }
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

/** Contagem "em falta" ITEM-a-item (não linha-a-linha). Solado por numeração.
 *  Tira interna fica de fora: não se compra tira, e a napa dela não entra na
 *  falta desde 11/10/2026 (mora no Setor de Tiras). */
export const countShort = (rows: ConsumptionRow[]): number => {
  const purchase = toPurchaseDecisionRows(rows);
  const sole = purchase.filter((r) => r.componentType === 'Solado' && rowIsShort(r)).length;
  const others = aggregateItems(purchase.filter((r) => r.componentType !== 'Solado'))
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
  const purchase = toPurchaseDecisionRows(rows);
  const out: ShortfallEntry[] = [];
  for (const r of purchase.filter((x) => x.componentType === 'Solado')) {
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
  for (const it of aggregateItems(purchase.filter((x) => x.componentType !== 'Solado'))) {
    const qty = itemShortfall(it);
    if (qty > 0) out.push({ label: it.groupName, color: it.color, qty, unit: it.productUnit });
  }
  return out.sort((a, b) => b.qty - a.qty).slice(0, limit);
};
