/**
 * LISTA DE COMPRA do consumo — napa por família → cor, com destinos
 * Cabedal / Forração / Tira. Decisão do dono (27/09/2026): napa convertida
 * de tiras artesanais ENTRA no total da família (revoga exclusão de 24/09).
 *
 * Continua listando `pendingStraps` (tira sem rendimento) e `otherRows`.
 */
import { BASE_MATERIAL_COMPONENTS, BASE_LINEAR_UNITS, normalizeBaseFamilyName } from '@/lib/baseMaterialTotal';
import { normTxt, type ConsumptionRow } from '@/lib/consumptionRows';

/** Aplicação da napa na ficha. */
export type BaseApplicationKind = 'cabedal' | 'forracao' | 'tira';

export type BuyListColor = {
  color: string;
  qty: number;
  cabedal: number;
  forracao: number;
  /** Napa convertida de tiras artesanais nesta cor. */
  tira: number;
  /** Tiras desta napa+cor que ficaram FORA do total por falta de rendimento. */
  pending: number;
};

export type BuyListFamily = {
  /** Nome da napa (família), ex.: "NAPA SOFT". */
  napa: string;
  colors: BuyListColor[];
  total: number;
};

/** Tira cuja napa-base é conhecida mas não tem rendimento cadastrado. */
export type PendingStrap = {
  tira: string;
  color: string;
  napa: string;
  /** Metros de TIRA (não de napa — a conversão é justamente o que falta). */
  tiraM: number;
};

export type BuyList = {
  families: BuyListFamily[];
  /** Soma de todas as famílias, em metros. */
  grandTotal: number;
  pendingStraps: PendingStrap[];
  /** Linhas que não são material base (solado, químicos, embalagem, tira pronta…). */
  otherRows: ConsumptionRow[];
};

type ColorAgg = {
  qty: number;
  cabedal: number;
  forracao: number;
  tira: number;
};

const emptyAgg = (): ColorAgg => ({ qty: 0, cabedal: 0, forracao: 0, tira: 0 });

/** A linha é napa cortada DIRETO do rolo (não tira convertida)? */
export const isDirectNapaRow = (row: ConsumptionRow): boolean =>
  BASE_MATERIAL_COMPONENTS.has(row.componentType)
  && BASE_LINEAR_UNITS.has((row.productUnit || '').toLowerCase())
  && !row.widthMissing
  && !row.warning
  && row.totalQuantity > 0;

/** A linha entra na lista de compra de napa (direto ou tira convertida)? */
export const isBuyListRow = (row: ConsumptionRow): boolean => {
  if (row.artisanal?.pending) return false;
  if (row.artisanal && Number(row.artisanal.baseQty) > 0) return true;
  return isDirectNapaRow(row);
};

/**
 * Família de material base da linha. Tira artesanal cai na napa da receita
 * (`artisanal.baseName`), nunca no nome do grupo da tira. Se o baseName ainda
 * carregar a cor do SKU, normaliza pra casar com o grupo do cabedal.
 */
export function baseMaterialName(row: ConsumptionRow): string | null {
  if (row.artisanal?.pending) {
    const raw = (row.artisanal.baseName || '').trim();
    return raw ? normalizeBaseFamilyName(raw, row.color) : null;
  }
  if (row.artisanal && Number(row.artisanal.baseQty) > 0) {
    return normalizeBaseFamilyName(row.artisanal.baseName, row.color);
  }
  if (isDirectNapaRow(row)) {
    return normalizeBaseFamilyName(row.groupName, row.color) || null;
  }
  return null;
}

/** Metro de napa que esta linha contribui (0 se não é material base). */
export function rowBaseQty(row: ConsumptionRow): number {
  if (row.artisanal?.pending) return 0;
  if (row.artisanal && Number(row.artisanal.baseQty) > 0) return Number(row.artisanal.baseQty) || 0;
  if (isDirectNapaRow(row)) return Number(row.totalQuantity) || 0;
  return 0;
}

export function baseApplicationKind(row: ConsumptionRow): BaseApplicationKind | null {
  if (row.artisanal?.pending) return null;
  if (row.artisanal && Number(row.artisanal.baseQty) > 0) return 'tira';
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
  const pendingStraps: PendingStrap[] = [];
  const pendCountByKey = new Map<string, number>();
  const otherRows: ConsumptionRow[] = [];

  const addNapa = (napa: string, color: string, qty: number, kind: BaseApplicationKind) => {
    if (!(qty > 0)) return;
    if (!napaBuy.has(napa)) napaBuy.set(napa, new Map());
    const cm = napaBuy.get(napa)!;
    // Mantém precisão integral durante a agregação. Duas casas pertencem apenas
    // à renderização; arredondar cada contribuição perde metragens pequenas.
    const cur = cm.get(color) || emptyAgg();
    cur.qty += qty;
    cur[kind] += qty;
    cm.set(color, cur);
  };

  for (const row of rows) {
    // Tira com napa-base conhecida e SEM rendimento: não converte às cegas —
    // sai em bloco próprio, pedindo o cadastro que falta.
    if (row.artisanal?.pending) {
      const napa = normalizeBaseFamilyName(row.artisanal.baseName, row.color);
      pendingStraps.push({ tira: row.groupName, color: row.color, napa, tiraM: row.totalQuantity });
      const k = `${normTxt(napa)}||${normTxt(row.color)}`;
      pendCountByKey.set(k, (pendCountByKey.get(k) || 0) + 1);
      continue;
    }
    // Tira convertida: entra na família da napa-base, destino "tira".
    if (row.artisanal && row.artisanal.baseQty > 0) {
      const napa = normalizeBaseFamilyName(row.artisanal.baseName, row.color);
      addNapa(napa, row.color, row.artisanal.baseQty, 'tira');
      continue;
    }
    if (isDirectNapaRow(row)) {
      const napa = normalizeBaseFamilyName(row.groupName, row.color);
      addNapa(napa, row.color, row.totalQuantity, baseApplicationKind(row) || 'cabedal');
      continue;
    }
    otherRows.push(row);
  }

  const families: BuyListFamily[] = Array.from(napaBuy.entries())
    .map(([napa, cm]) => {
      const colors = Array.from(cm.entries())
        .map(([color, agg]) => ({
          color,
          qty: agg.qty,
          cabedal: agg.cabedal,
          forracao: agg.forracao,
          tira: agg.tira,
          pending: pendCountByKey.get(`${normTxt(napa)}||${normTxt(color)}`) || 0,
        }))
        .sort((a, b) => b.qty - a.qty);
      return { napa, colors, total: colors.reduce((s, c) => s + c.qty, 0) };
    })
    .sort((a, b) => b.total - a.total);

  return {
    families,
    grandTotal: families.reduce((s, f) => s + f.total, 0),
    pendingStraps,
    otherRows,
  };
}
