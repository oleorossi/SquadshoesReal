/**
 * LISTA DE COMPRA do consumo — napa por família → cor, com destinos
 * Cabedal / Forração.
 *
 * Decisão do dono (11/10/2026, revoga a de 27/09/2026): a napa convertida de
 * tiras artesanais NÃO entra mais na lista nem no total da família. Antes o
 * Total da cor somava cabedal + forração + tira enquanto a tabela do §01 só
 * mostrava as colunas Cabedal e Forração — o total não fechava. A napa das
 * tiras fica só no Setor de Tiras (§03 do PDF / `ArtisanalStrapRollCutBlock`
 * na tela), e a tira com rendimento pendente também saiu daqui: o §03 já a
 * mostra como "cadastro incompleto".
 *
 * Toda linha que não é napa cortada direto do rolo — tira inclusive — vai em
 * `otherRows`.
 */
import { BASE_MATERIAL_COMPONENTS, BASE_LINEAR_UNITS, normalizeBaseFamilyName } from '@/lib/baseMaterialTotal';
import type { ConsumptionRow } from '@/lib/consumptionRows';

/** Aplicação da napa na ficha. */
export type BaseApplicationKind = 'cabedal' | 'forracao';

export type BuyListColor = {
  color: string;
  /** cabedal + forração (fecha com as duas colunas). */
  qty: number;
  /** Cabedal + Fachete. */
  cabedal: number;
  /** Forração + Forração Palmilha. */
  forracao: number;
};

export type BuyListFamily = {
  /** Nome da napa (família), ex.: "NAPA SOFT". */
  napa: string;
  colors: BuyListColor[];
  total: number;
};

export type BuyList = {
  families: BuyListFamily[];
  /** Soma de todas as famílias, em metros. */
  grandTotal: number;
  /** Linhas que não são material base (solado, químicos, embalagem, tiras…). */
  otherRows: ConsumptionRow[];
};

type ColorAgg = {
  qty: number;
  cabedal: number;
  forracao: number;
};

const emptyAgg = (): ColorAgg => ({ qty: 0, cabedal: 0, forracao: 0 });

/** A linha é napa cortada DIRETO do rolo? (tira nunca é — `Tiras` não é componente base) */
export const isDirectNapaRow = (row: ConsumptionRow): boolean =>
  BASE_MATERIAL_COMPONENTS.has(row.componentType)
  && BASE_LINEAR_UNITS.has((row.productUnit || '').toLowerCase())
  && !row.widthMissing
  && !row.warning
  && row.totalQuantity > 0;

/** A linha entra na lista de compra de napa? Só napa direta (11/10/2026). */
export const isBuyListRow = (row: ConsumptionRow): boolean => isDirectNapaRow(row);

/**
 * Família de material base da linha (napa direta), sem a cor do SKU. Tira
 * artesanal devolve null: a napa dela não pertence ao total da família — mora
 * no Setor de Tiras.
 */
export function baseMaterialName(row: ConsumptionRow): string | null {
  if (!isDirectNapaRow(row)) return null;
  return normalizeBaseFamilyName(row.groupName, row.color) || null;
}

/** Metro de napa que esta linha contribui (0 se não é napa direta). */
export function rowBaseQty(row: ConsumptionRow): number {
  return isDirectNapaRow(row) ? Number(row.totalQuantity) || 0 : 0;
}

export function baseApplicationKind(row: ConsumptionRow): BaseApplicationKind | null {
  if (!isDirectNapaRow(row)) return null;
  if (row.componentType === 'Forração' || row.componentType === 'Forração Palmilha') return 'forracao';
  return 'cabedal';
}

export function rowBelongsToBaseFamily(row: ConsumptionRow, family: string): boolean {
  const name = baseMaterialName(row);
  return !!name && name === family;
}

export function buildBuyList(rows: ConsumptionRow[]): BuyList {
  const napaBuy = new Map<string, Map<string, ColorAgg>>();
  const otherRows: ConsumptionRow[] = [];

  for (const row of rows) {
    const kind = baseApplicationKind(row);
    if (!kind) {
      otherRows.push(row);
      continue;
    }
    const napa = normalizeBaseFamilyName(row.groupName, row.color);
    if (!napaBuy.has(napa)) napaBuy.set(napa, new Map());
    const cm = napaBuy.get(napa)!;
    // Mantém precisão integral durante a agregação. Duas casas pertencem apenas
    // à renderização; arredondar cada contribuição perde metragens pequenas.
    const cur = cm.get(row.color) || emptyAgg();
    cur.qty += row.totalQuantity;
    cur[kind] += row.totalQuantity;
    cm.set(row.color, cur);
  }

  const families: BuyListFamily[] = Array.from(napaBuy.entries())
    .map(([napa, cm]) => {
      const colors = Array.from(cm.entries())
        .map(([color, agg]) => ({
          color,
          qty: agg.qty,
          cabedal: agg.cabedal,
          forracao: agg.forracao,
        }))
        .sort((a, b) => b.qty - a.qty);
      return { napa, colors, total: colors.reduce((s, c) => s + c.qty, 0) };
    })
    .sort((a, b) => b.total - a.total);

  return {
    families,
    grandTotal: families.reduce((s, f) => s + f.total, 0),
    otherRows,
  };
}
