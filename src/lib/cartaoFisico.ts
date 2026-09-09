/**
 * Cartão físico por corrugado — regras da spec `specs/cartao-fisico-corrugado.md`.
 *
 * 1 cartão = 1 corrugado cheio (12/15/18) de 1 OP. Sobra sem cartão.
 * Emissores allow-list; destino/QR fora da v1.
 */
import { resolveFicha } from '@/components/production/worksheet/fichaSize';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

/** Setores que emitem cartão físico (nome como em `SECTORS` / activeSectors). */
export const CARTAO_FISICO_EMITTERS = [
  'Corte Palmilha',
  'Corte Forração',
  'Corte Cabedal',
  'Costura Cabedal',
  'Aviamento',
  'Montagem',
] as const;

export type CartaoFisicoEmitter = (typeof CARTAO_FISICO_EMITTERS)[number];

const EMITTER_SET = new Set<string>(CARTAO_FISICO_EMITTERS);

export function isCartaoFisicoEmitter(sector: string): boolean {
  return EMITTER_SET.has(sector);
}

/** Quantos cartões cheios cabem: sempre floor(pares / corrugado). */
export function countFullCorrugados(totalPairs: number, corrugado: number): number {
  const total = Number(totalPairs) || 0;
  const box = Number(corrugado) || 0;
  if (total <= 0 || box <= 0) return 0;
  return Math.floor(total / box);
}

export interface CartaoFisicoOrderInput {
  opNumber: string;
  pvLabel?: string | null;
  referenceLabel?: string | null;
  color?: string | null;
  /** Identidade extra do setor (napa, solado…). */
  materialLabel?: string | null;
  imageUrl?: string | null;
  totalPairs: number;
  grid: Record<string, number> | null | undefined;
  /** Se false, a OP não entra neste setor. */
  eligible?: boolean;
}

export interface CartaoFisicoCard {
  sectorName: string;
  sectorDisplayLabel: string;
  opNumber: string;
  pvLabel?: string;
  /** Destaque vermelho — cor ou material+cor. */
  title: string;
  /** Linha sob o título (ref, solado…). */
  subtitle?: string;
  imageUrl?: string | null;
  sizes: string[];
  grade: Record<string, number>;
  totalPairs: number;
  /** k de k/N dentro da OP × setor. */
  index: number;
  /** N = corrugados cheios da OP neste setor. */
  of: number;
  corrugado: number;
  lotCode: string;
  lotLabel: string;
}

export interface BuildCartaoFisicoCardsArgs {
  sectorName: string;
  /** Rótulo impresso (ex.: "Corte de Placa de Fibra"). Default = sectorName. */
  sectorDisplayLabel?: string;
  orders: CartaoFisicoOrderInput[];
}

function cleanGrade(grid: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(grid || {})) {
    const n = Number(v) || 0;
    if (n > 0 && !k.startsWith('_')) out[k] = n;
  }
  return out;
}

function sortSizes(grade: Record<string, number>): string[] {
  return Object.keys(grade)
    .filter((s) => (Number(grade[s]) || 0) > 0)
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
}

function identityTitle(order: CartaoFisicoOrderInput): { title: string; subtitle?: string } {
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
 * Grade de UM corrugado cheio. Preferência: curva-base do resolveFicha.
 * Sem curva confiável: escala a grade da OP para `corrugado` pares.
 */
export function gradeForOneCorrugado(
  totalPairs: number,
  grid: Record<string, number> | null | undefined,
  corrugado: number,
  baseCurve: Record<string, number> | null,
): Record<string, number> {
  if (baseCurve && Object.keys(baseCurve).length > 0) return cleanGrade(baseCurve);
  const cleaned = cleanGrade(grid);
  const sum = Object.values(cleaned).reduce((s, v) => s + v, 0);
  if (sum <= 0 || corrugado <= 0) return {};
  // Grade total da OP → 1 corrugado (não usar scaleGradeToTotal: com Σ≥alvo
  // ele devolve a grade intacta).
  return cleanGrade(scaleGradeWithLargestRemainder(cleaned, corrugado / sum, corrugado));
}

/** Monta a lista de cartões físicos de um setor (só corrugados cheios, 1 OP cada). */
export function buildCartaoFisicoCards(args: BuildCartaoFisicoCardsArgs): CartaoFisicoCard[] {
  const { sectorName, orders } = args;
  if (!isCartaoFisicoEmitter(sectorName)) return [];
  const sectorDisplayLabel = args.sectorDisplayLabel || sectorName;
  const cards: CartaoFisicoCard[] = [];

  for (const order of orders) {
    if (order.eligible === false) continue;
    const opNumber = String(order.opNumber || '').trim();
    if (!opNumber) continue;
    const total = Number(order.totalPairs) || 0;
    if (total <= 0) continue;

    const resolution = resolveFicha(total, order.grid);
    const full = countFullCorrugados(total, resolution.corrugado);
    if (full <= 0) continue;

    const grade = gradeForOneCorrugado(total, order.grid, resolution.corrugado, resolution.baseCurve);
    const sizes = sortSizes(grade);
    const { title, subtitle } = identityTitle(order);
    const pvLabel = String(order.pvLabel || '').trim() || undefined;

    for (let k = 1; k <= full; k++) {
      cards.push({
        sectorName,
        sectorDisplayLabel,
        opNumber,
        pvLabel,
        title,
        subtitle,
        imageUrl: order.imageUrl ?? null,
        sizes,
        grade,
        totalPairs: resolution.corrugado,
        index: k,
        of: full,
        corrugado: resolution.corrugado,
        lotCode: `${k}/${full}`,
        lotLabel: `${k} de ${full}`,
      });
    }
  }

  return cards;
}

/**
 * Cartões por folha A4 paisagem (3 colunas × 4 linhas).
 * Envelope canônico do modo Cartão físico — cut-stack assume esta capacidade.
 */
export const CARTAO_FISICO_PER_PAGE = 12;

/**
 * Reordena a lista sequencial para layout cut-stack por folha.
 *
 * Com C slots/folha e P = ceil(N/C) páginas, o item lógico i (0-based) vai para
 * página `i % P`, slot `floor(i / P)`. Empilhar as folhas e cortar a posição k
 * entrega os cartões em sequência (k, k+1, …) sem reordenar na mão.
 *
 * Devolve as páginas já fatiadas (última pode ter < C cartões). Não inventa
 * placeholder — slot vazio no fim da última página fica implícito no flex.
 */
export function layoutCutStackPages<T>(
  items: readonly T[],
  capacity: number = CARTAO_FISICO_PER_PAGE,
): T[][] {
  const n = items.length;
  if (n === 0 || capacity <= 0) return [];
  if (n <= capacity) return [items.slice() as T[]];

  const pageCount = Math.ceil(n / capacity);
  const pages: T[][] = Array.from({ length: pageCount }, () => []);
  for (let i = 0; i < n; i++) {
    pages[i % pageCount].push(items[i]);
  }
  return pages;
}

/** Stream flat do cut-stack (páginas concatenadas). Preferir `layoutCutStackPages` no print. */
export function layoutCutStack<T>(
  items: readonly T[],
  capacity: number = CARTAO_FISICO_PER_PAGE,
): T[] {
  return layoutCutStackPages(items, capacity).flat();
}
