/**
 * Textos de apresentação da linha de TIRA no Consumo de Materiais — FONTE
 * ÚNICA da tela (`MaterialConsumptionView`) e do PDF
 * (`materialConsumptionReport`), para as duas superfícies dizerem o mesmo
 * (spec `tiras-redesenho.md`, D8/D9/D10/D15).
 *
 * Regras:
 *  - quantidade da linha = metros de TIRA (total + por numeração) + pares;
 *  - napa (só Prestador) = metros pelo prestador ÷ rendimento, em texto
 *    separado — nunca soma com os metros de tira. É a napa a ENVIAR ao
 *    prestador (a fábrica não corta tira — Revisão 2, R1);
 *  - napa bloqueada (sem receita/rendimento) = “—” + motivo (D9);
 *  - estoque de tira pronta é consumido primeiro: “X m do estoque · Y m pelo
 *    prestador / a comprar” (D15).
 */
import { normalizeBaseFamilyName } from '@/lib/baseMaterialTotal';
import { formatQty } from '@/lib/consumptionFormat';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import { sizeSortKey } from '@/lib/soleMatrixHtml';

/**
 * Napa de tira costuma ser fração de metro (6 m de tira ÷ 70 = 0,0857 m):
 * duas casas arredondariam para 0,09 e a conferência manual não fecharia.
 */
export const formatNapaMeters = (meters: number): string =>
  (Number(meters) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

type StrapRow = Pick<ConsumptionRow, 'componentType' | 'strap' | 'artisanal' | 'color' | 'totalQuantity'>;

/** Pares da linha ("12 pares"), ou null quando o escopo não trouxe. */
export function strapPairsText(row: StrapRow): string | null {
  const pairs = row.strap?.pairs;
  if (pairs == null || !(pairs > 0)) return null;
  return `${formatQty(pairs, 'par')} ${pairs === 1 ? 'par' : 'pares'}`;
}

/** Metros de tira por numeração, ordenados ("34: 0,50 m · 35: 0,50 m"). */
export function strapSizeMetersEntries(row: StrapRow): Array<{ size: string; meters: number; pairs: number | null }> {
  const bySize = row.strap?.metersBySize;
  if (!bySize) return [];
  return Object.keys(bySize)
    .sort((a, b) => sizeSortKey(a) - sizeSortKey(b))
    .map((size) => ({
      size,
      meters: Number(bySize[size]) || 0,
      pairs: row.strap?.pairsBySize?.[size] ?? null,
    }));
}

export function strapSizeMetersText(row: StrapRow): string | null {
  const entries = strapSizeMetersEntries(row);
  if (entries.length === 0) return null;
  return entries.map((entry) => `${entry.size}: ${formatQty(entry.meters, 'm')} m`).join(' · ');
}

/** "X m do estoque · Y m pelo prestador|a comprar" — só quando há tira pronta em estoque (D15). */
export function strapStockSplitText(row: StrapRow): string | null {
  const strap = row.strap;
  if (!strap || !(strap.fromStockM > 0)) return null;
  const verb = strap.origin === 'comprar' ? 'a comprar' : 'pelo prestador';
  return `${formatQty(strap.fromStockM, 'm')} m do estoque · ${formatQty(strap.toMakeM, 'm')} m ${verb}`;
}

export type StrapNapaDisplay =
  | { kind: 'napa'; text: string; napaM: number }
  | { kind: 'blocked'; text: string; reason: string }
  | { kind: 'covered'; text: string };

/**
 * Napa a enviar ao prestador (tira de origem Prestador). Null para Comprar
 * pronto/origem pendente (sem napa).
 * Bloqueada (D9): napa “—” com o motivo — nunca um número.
 */
export function strapNapaDisplay(row: StrapRow): StrapNapaDisplay | null {
  const artisanal = row.artisanal;
  const isFazer = row.strap ? row.strap.origin === 'fazer' : !!artisanal;
  if (!isFazer || !artisanal) return null;
  const base = normalizeBaseFamilyName(artisanal.baseName, row.color) || artisanal.baseName;
  if (artisanal.pending) {
    const reason = (artisanal.blockedReason || row.strap?.napaBlockedReason || 'rendimento a cadastrar').trim();
    return { kind: 'blocked', text: `napa ${base}: — · ${reason}`, reason };
  }
  const napaM = Number(artisanal.baseQty) || 0;
  if (!(napaM > 0)) {
    return { kind: 'covered', text: 'coberta pelo estoque de tira pronta — sem napa a enviar ao prestador' };
  }
  const yieldM = Number(artisanal.yieldPerMeter) || 0;
  const yieldText = yieldM > 0
    ? ` (1 m napa → ${yieldM.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m tira)`
    : '';
  return { kind: 'napa', text: `enviar ao prestador ≈ ${formatNapaMeters(napaM)} m ${base}${yieldText}`, napaM };
}
