/**
 * Cartão físico por corrugado — regras da spec `specs/cartao-fisico-corrugado.md`.
 *
 * 1 cartão = 1 corrugado cheio (12/15/18) de 1 OP. Sobra sem cartão.
 * Emissores: Palmilha · Corte Cabedal · Costura Cabedal · Aviamento.
 * Sem Origem no papel; destino opcional (Costura→Aviamento, Aviamento→Colagem).
 * Contador do maço: k/N global após `assignBatchCounters`.
 */
import { resolveFicha } from '@/components/production/worksheet/fichaSize';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

/** Setores que emitem fardo (nome como em `SECTORS` / activeSectors). */
export const CARTAO_FISICO_EMITTERS = [
  'Palmilha',
  'Corte Cabedal',
  'Costura Cabedal',
  'Aviamento',
] as const;

export type CartaoFisicoEmitter = (typeof CARTAO_FISICO_EMITTERS)[number];

/** Destino impresso no fardo (vazio = não imprime bloco Destino). */
export const CARTAO_FISICO_DESTINO: Partial<Record<CartaoFisicoEmitter, string>> = {
  'Costura Cabedal': 'Aviamento',
  Aviamento: 'Colagem',
};

export function destinoForCartaoFisico(sector: string): string {
  return CARTAO_FISICO_DESTINO[sector as CartaoFisicoEmitter] || '';
}

const EMITTER_SET = new Set<string>(CARTAO_FISICO_EMITTERS);

export function isCartaoFisicoEmitter(sector: string): sector is CartaoFisicoEmitter {
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
  /** Razão social do cliente do PV. */
  clientName?: string | null;
  referenceLabel?: string | null;
  /** Identidade extra do setor (napa, solado…). */
  color?: string | null;
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
  /** Destino opcional (Costura→Aviamento, Aviamento→Colagem). */
  destinoLabel?: string;
  opNumber: string;
  pvLabel?: string;
  clientName?: string;
  /** Destaque vermelho — cor ou material+cor. */
  title: string;
  /** Linha sob o título (ref, solado…). */
  subtitle?: string;
  imageUrl?: string | null;
  sizes: string[];
  grade: Record<string, number>;
  totalPairs: number;
  /** k de k/N dentro da OP × setor (antes do batch). */
  index: number;
  /** N = corrugados cheios da OP neste setor. */
  of: number;
  corrugado: number;
  /** Contador do maço impresso — `k/N` global após `assignBatchCounters`. */
  lotCode: string;
  lotLabel: string;
}

export interface BuildCartaoFisicoCardsArgs {
  sectorName: string;
  /** Rótulo interno (não impresso como Origem). Default = sectorName. */
  sectorDisplayLabel?: string;
  /** Override do destino; default = mapa CARTAO_FISICO_DESTINO. */
  destinoLabel?: string;
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

/**
 * Renumera `lotCode`/`lotLabel` pelo índice global do maço (1/N … N/N).
 * Aplica-se depois de concatenar todos os setores / OPs do print.
 */
export function assignBatchCounters<T extends { lotCode: string; lotLabel: string }>(
  cards: T[],
): T[] {
  const n = cards.length;
  if (n === 0) return cards;
  return cards.map((card, i) => ({
    ...card,
    lotCode: `${i + 1}/${n}`,
    lotLabel: `${i + 1} de ${n}`,
  }));
}

/** Monta a lista de cartões físicos de um setor (só corrugados cheios, 1 OP cada). */
export function buildCartaoFisicoCards(args: BuildCartaoFisicoCardsArgs): CartaoFisicoCard[] {
  const { sectorName, orders } = args;
  if (!isCartaoFisicoEmitter(sectorName)) return [];
  const sectorDisplayLabel = args.sectorDisplayLabel || sectorName;
  const destinoLabel = args.destinoLabel !== undefined
    ? args.destinoLabel
    : destinoForCartaoFisico(sectorName);
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
    const clientName = String(order.clientName || '').trim() || undefined;

    for (let k = 1; k <= full; k++) {
      cards.push({
        sectorName,
        sectorDisplayLabel,
        destinoLabel: destinoLabel || undefined,
        opNumber,
        pvLabel,
        clientName,
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
 * Cartões por folha A4 paisagem (3 colunas × 5 linhas).
 * Envelope canônico do modo Fardo — chunk sequencial assume esta capacidade.
 */
export const CARTAO_FISICO_PER_PAGE = 15;

/**
 * Fatia a lista em páginas sequenciais de até `capacity` itens.
 * Página 0 = items[0..C), página 1 = items[C..2C), … — k/N sobe na mesma folha.
 * Caminho vivo do print de cartão físico.
 */
export function chunkPages<T>(
  items: readonly T[],
  capacity: number = CARTAO_FISICO_PER_PAGE,
): T[][] {
  const n = items.length;
  if (n === 0 || capacity <= 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < n; i += capacity) {
    pages.push(items.slice(i, i + capacity) as T[]);
  }
  return pages;
}

/**
 * @deprecated Legado — não usar no print. Preferir `chunkPages`.
 * Reordena a lista sequencial para layout cut-stack por folha.
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

/** @deprecated Legado — ver `layoutCutStackPages`. */
export function layoutCutStack<T>(
  items: readonly T[],
  capacity: number = CARTAO_FISICO_PER_PAGE,
): T[] {
  return layoutCutStackPages(items, capacity).flat();
}
