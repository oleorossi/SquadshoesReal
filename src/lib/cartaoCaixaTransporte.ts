/**
 * Cartão de caixa de transporte — agrupa corrugados cheios em caixas por OP.
 *
 * Spec: specs/cartao-caixa-transporte.md
 * Unidade: corrugado cheio (`countFullCorrugados` / `resolveFicha` 12·15·18).
 * 1 OP por caixa; parcial gera cartão; sem grade.
 */
import { resolveFicha } from '@/components/production/worksheet/fichaSize';
import {
  getCaixaTransporteConfig,
  isCaixaTransporteSector,
  type CaixaTransporteSector,
} from '@/lib/caixaTransporteConfig';
import { countFullCorrugados, chunkPages } from '@/lib/cartaoFisico';

export interface CartaoCaixaOrderInput {
  opNumber: string;
  pvLabel?: string | null;
  referenceLabel?: string | null;
  color?: string | null;
  /** Identidade extra (napa no Forração…). */
  materialLabel?: string | null;
  imageUrl?: string | null;
  totalPairs: number;
  grid: Record<string, number> | null | undefined;
  /** Se false, a OP não entra neste setor. */
  eligible?: boolean;
}

export interface CartaoCaixaCard {
  sectorName: CaixaTransporteSector;
  sectorDisplayLabel: string;
  destinoLabel: string;
  opNumber: string;
  pvLabel?: string;
  /** Destaque vermelho — cor ou material+cor. */
  title: string;
  /** Linha sob o título (ref…). */
  subtitle?: string;
  imageUrl?: string | null;
  /** Corrugados nesta caixa (≤ capacidade). */
  fichasNaCaixa: number;
  /** Capacidade da caixa (do config). */
  capacidade: number;
  /** Pares nesta caixa = fichasNaCaixa × corrugado. */
  totalPairs: number;
  corrugado: number;
  /** k de k/N dentro da OP × setor. */
  index: number;
  /** N = nº de caixas da OP neste setor. */
  of: number;
  /** Ex.: "1/3". */
  lotCode: string;
  /** Ex.: "1 de 3". */
  lotLabel: string;
  /** true quando fichasNaCaixa < capacidade. */
  parcial: boolean;
}

export interface BuildCartaoCaixaCardsArgs {
  sectorName: string;
  /** Rótulo impresso de origem. Default = sectorName. */
  sectorDisplayLabel?: string;
  orders: CartaoCaixaOrderInput[];
}

function identityTitle(order: CartaoCaixaOrderInput): { title: string; subtitle?: string } {
  const color = String(order.color || '').trim();
  const material = String(order.materialLabel || '').trim();
  const ref = String(order.referenceLabel || '').trim();
  if (material && color) return { title: `${color} · ${material}`, subtitle: ref || undefined };
  if (color) return { title: color, subtitle: ref || material || undefined };
  if (material) return { title: material, subtitle: ref || undefined };
  if (ref) return { title: ref };
  return { title: order.opNumber || '—' };
}

/**
 * Monta cartões de caixa para um setor (1 OP por caixa, parcial incluso).
 * Capacidade e destino vêm só de `getCaixaTransporteConfig`.
 */
export function buildCartaoCaixaCards(args: BuildCartaoCaixaCardsArgs): CartaoCaixaCard[] {
  const { sectorName, orders } = args;
  if (!isCaixaTransporteSector(sectorName)) return [];
  const config = getCaixaTransporteConfig(sectorName);
  if (!config) return [];

  const capacity = Number(config.fichasPorCaixa) || 0;
  if (capacity <= 0) return [];

  const sectorDisplayLabel = args.sectorDisplayLabel || sectorName;
  const cards: CartaoCaixaCard[] = [];

  for (const order of orders) {
    if (order.eligible === false) continue;
    const opNumber = String(order.opNumber || '').trim();
    if (!opNumber) continue;
    const total = Number(order.totalPairs) || 0;
    if (total <= 0) continue;

    const resolution = resolveFicha(total, order.grid);
    const full = countFullCorrugados(total, resolution.corrugado);
    if (full <= 0) continue;

    const boxCount = Math.ceil(full / capacity);
    const { title, subtitle } = identityTitle(order);
    const pvLabel = String(order.pvLabel || '').trim() || undefined;

    for (let k = 1; k <= boxCount; k++) {
      const remaining = full - (k - 1) * capacity;
      const fichasNaCaixa = Math.min(capacity, remaining);
      const parcial = fichasNaCaixa < capacity;
      cards.push({
        sectorName,
        sectorDisplayLabel,
        destinoLabel: config.destinoLabel,
        opNumber,
        pvLabel,
        title,
        subtitle,
        imageUrl: order.imageUrl ?? null,
        fichasNaCaixa,
        capacidade: capacity,
        totalPairs: fichasNaCaixa * resolution.corrugado,
        corrugado: resolution.corrugado,
        index: k,
        of: boxCount,
        lotCode: `${k}/${boxCount}`,
        lotLabel: `${k} de ${boxCount}`,
        parcial,
      });
    }
  }

  return cards;
}

/** 2 cartões por A4 paisagem (envelope grande). */
export const CAIXA_TRANSPORTE_PER_PAGE = 2;

/** Fatia cartões em páginas de até 2 (reusa `chunkPages` do cartão físico). */
export function chunkCaixaPages<T>(
  items: readonly T[],
  capacity: number = CAIXA_TRANSPORTE_PER_PAGE,
): T[][] {
  return chunkPages(items, capacity);
}
