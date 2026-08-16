/**
 * LISTA DE COMPRA do consumo de materiais — material base (napa) por
 * **família → cor**, mais as tiras que não converteram por falta de cadastro.
 *
 * Extraído de `MaterialConsumptionView.handlePrintPdf` em 2026-08-05. Este
 * agrupamento existia desde sempre, mas só dentro do gerador de PDF, montando
 * string de HTML: a TELA agrupava por componente e o PAPEL por família de napa,
 * então as duas discordavam de qual era a pergunta principal. Agora as duas
 * chamam `buildBuyList` — mudar a regra de compra muda as duas juntas.
 *
 * Duas origens entram na MESMA família, porque na prática é uma napa só:
 *  - napa cortada DIRETO (cabedal, forração, fachete, forração de palmilha em
 *    unidade linear) → o próprio `totalQuantity`;
 *  - TIRA artesanal → o equivalente em napa (`artisanal.baseQty`), NUNCA os
 *    metros de tira (169,20 m de tira = 2,82 m de napa).
 *
 * Fica de fora o que não se soma em metros com napa (solado em par, cola em kg,
 * caixa em un) — sai em `otherRows`.
 */
import { BASE_MATERIAL_COMPONENTS, BASE_LINEAR_UNITS } from '@/lib/baseMaterialTotal';
import { normTxt, type ConsumptionRow } from '@/lib/consumptionRows';

export type BuyListColor = {
  color: string;
  qty: number;
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

/** A linha é napa cortada DIRETO do rolo (não tira convertida)? */
export const isDirectNapaRow = (row: ConsumptionRow): boolean =>
  BASE_MATERIAL_COMPONENTS.has(row.componentType)
  && BASE_LINEAR_UNITS.has((row.productUnit || '').toLowerCase())
  && !row.widthMissing
  && !row.warning
  && row.totalQuantity > 0;

/** A linha entra na lista de compra de material base? (napa direta OU tira convertida) */
export const isBuyListRow = (row: ConsumptionRow): boolean => {
  if (row.artisanal?.pending) return false;
  if (row.artisanal && row.artisanal.baseQty > 0) return true;
  return isDirectNapaRow(row);
};

export function buildBuyList(rows: ConsumptionRow[]): BuyList {
  const napaBuy = new Map<string, Map<string, number>>();
  const pendingStraps: PendingStrap[] = [];
  const pendCountByKey = new Map<string, number>();
  const otherRows: ConsumptionRow[] = [];

  const addNapa = (napa: string, color: string, qty: number) => {
    if (!napaBuy.has(napa)) napaBuy.set(napa, new Map());
    const cm = napaBuy.get(napa)!;
    // Mantém precisão integral durante a agregação. Duas casas pertencem apenas
    // à renderização; arredondar cada contribuição perde metragens pequenas.
    cm.set(color, (cm.get(color) || 0) + qty);
  };

  for (const row of rows) {
    // Tira com napa-base conhecida e SEM rendimento: não converte às cegas —
    // sai em bloco próprio, pedindo o cadastro que falta.
    if (row.artisanal?.pending) {
      const napa = row.artisanal.baseName || 'Material base';
      pendingStraps.push({ tira: row.groupName, color: row.color, napa, tiraM: row.totalQuantity });
      const k = `${normTxt(napa)}||${normTxt(row.color)}`;
      pendCountByKey.set(k, (pendCountByKey.get(k) || 0) + 1);
      continue;
    }
    if (row.artisanal && row.artisanal.baseQty > 0) {
      addNapa(row.artisanal.baseName || 'Material base', row.color, row.artisanal.baseQty);
      continue;
    }
    if (isDirectNapaRow(row)) {
      addNapa(row.groupName, row.color, row.totalQuantity);
      continue;
    }
    otherRows.push(row);
  }

  const families: BuyListFamily[] = Array.from(napaBuy.entries())
    .map(([napa, cm]) => {
      const colors = Array.from(cm.entries())
        .map(([color, qty]) => ({
          color,
          qty,
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
