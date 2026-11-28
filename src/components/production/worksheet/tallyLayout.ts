import { PAGE_CONTENT_WIDTH_PX } from './pageGeometry';

/**
 * Geometria da linha do Controle de Fichas.
 *
 * A escolha de colunas usava só (caixa + gap), ignorando divisórias de dezena
 * e o acumulado "← N". Com 30 caixas de 20px isso já passava da largura útil
 * quando o tally vive DENTRO de uma faixa com borda e padding (Frente/Traseiro
 * do Cabedal: caixinhas 30 e 60 vazavam a borda direita, PV-00239).
 *
 * `fitTallyBoxLayout` encolhe a caixa (auto-fit) até a linha cheia caber, sem
 * cair o número de colunas enquanto der — assim 80 fichas continuam em 3
 * linhas, só um pouco menores.
 */

export type TallySize = 'sm' | 'md' | 'lg';

/** Folga padrão (card / borda) sobre a coluna A4, usada fora das faixas. */
export const TALLY_DEFAULT_INSET_PX = 12;

/**
 * Chrome extra da faixa Frente/Traseiro + card `p-1` + bordas, em px @96dpi.
 * p-1 4×2 + borda do card 1,5×2 + borda da faixa 2×2 + padding 6×2 + folga 8.
 */
export const CABEDAL_TALLY_INSET_PX = 44;

/** Piso das caixinhas no auto-fit (ainda marcáveis à caneta). */
export const TALLY_MIN_BOX_PX: Record<TallySize, number> = {
  sm: 14,
  md: 18,
  lg: 24,
};

export function tallyDesiredBoxPx(size: TallySize): number {
  return size === 'lg' ? 35 : size === 'sm' ? 20 : 25;
}

export function tallyGapPx(size: TallySize): number {
  return size === 'sm' ? 2 : 4;
}

export function tallyAvailableWidthPx(insetPx: number = TALLY_DEFAULT_INSET_PX): number {
  return Math.floor(PAGE_CONTENT_WIDTH_PX - insetPx);
}

export function tallyColsFor(boxPx: number, gapPx: number, availableWidthPx: number): number {
  const rawCols = Math.max(1, Math.floor((availableWidthPx + gapPx) / (boxPx + gapPx)));
  return rawCols >= 10 ? Math.floor(rawCols / 10) * 10 : rawCols;
}

/** Largura real ocupada por uma linha (caixas + dezenas + acumulado "← N"). */
export function tallyRowOccupiedPx(
  boxesInRow: number,
  boxPx: number,
  gapPx: number,
  accumLabel: string,
  size: TallySize,
): number {
  if (boxesInRow <= 0) return 0;
  const decadeCount = Math.max(1, Math.ceil(boxesInRow / 10));
  const accumFontPx = size === 'sm' ? 8 : 9;
  const accumTextPx = (accumLabel.length + 2) * 0.62 * accumFontPx;
  return (
    boxesInRow * boxPx
    + (boxesInRow - decadeCount) * gapPx
    + (decadeCount - 1) * (gapPx * 3 + 2)
    + gapPx * 3
    + accumTextPx
    + 4
  );
}

export interface TallyBoxLayout {
  boxPx: number;
  cols: number;
  occupiedPx: number;
  availableWidthPx: number;
}

export function fitTallyBoxLayout(opts: {
  size: TallySize;
  count: number;
  lastNumber: number;
  availableWidthPx: number;
}): TallyBoxLayout {
  const { size, count, lastNumber, availableWidthPx } = opts;
  const desired = tallyDesiredBoxPx(size);
  const gapPx = tallyGapPx(size);
  const minBox = TALLY_MIN_BOX_PX[size];
  const accum = `← ${lastNumber}`;

  let boxPx = desired;
  let cols = tallyColsFor(boxPx, gapPx, availableWidthPx);
  const occupied = (bp: number, c: number) =>
    tallyRowOccupiedPx(Math.min(count, c), bp, gapPx, accum, size);
  // +2px absorve borda/subpixel; sem isso 80 fichas ainda vazavam ~1px.
  const overflows = (bp: number, c: number) => occupied(bp, c) + 2 > availableWidthPx;

  while (boxPx > minBox && overflows(boxPx, cols)) {
    boxPx -= 1;
    cols = tallyColsFor(boxPx, gapPx, availableWidthPx);
  }
  while (cols > 10 && overflows(boxPx, cols)) {
    cols -= 10;
  }

  return {
    boxPx,
    cols: Math.max(1, cols),
    occupiedPx: occupied(boxPx, cols),
    availableWidthPx,
  };
}

/** Largura rígida declarada ao PaginatedSheet (0,92 libera um pouco de grow). */
export function tallyRigidWidthPx(occupiedPx: number, opts?: { tight?: boolean }): number {
  // tight: já auto-ajustado à largura da faixa — sem o 0,92 que liberava
  // grow do PaginatedSheet e fazia as caixas 30/60 vazarem de novo.
  return Math.ceil(occupiedPx * (opts?.tight ? 1 : 0.92));
}

/** Respiro entre as faixas Frente e Traseiro quando sentam lado a lado. */
export const CABEDAL_TALLY_SIDE_GAP_PX = 8;

/**
 * Largura útil de CADA faixa quando Frente e Traseiro dividem a coluna.
 *
 * O inset cheio (44) soma chrome do card + da faixa. Lado a lado o card é
 * compartilhado; cada faixa perde o gap e o próprio chrome/folga.
 */
export function cabedalTallySideAvailablePx(): number {
  const page = Math.floor(PAGE_CONTENT_WIDTH_PX);
  const cardChrome = 11; // p-1 4×2 + borda do card 1,5×2
  const bandChrome = 16; // borda ~2×2 + padding 6×2
  const folga = 4;
  return Math.floor((page - cardChrome - CABEDAL_TALLY_SIDE_GAP_PX) / 2) - bandChrome - folga;
}

export interface CabedalTallyPairLayout {
  /** As duas faixas cabem lado a lado sem ficar mais altas que empilhadas. */
  sideBySide: boolean;
  availableWidthPx: number;
  layout: TallyBoxLayout;
  stackedRows: number;
  sideRows: number;
}

/**
 * Frente e Traseiro lado a lado só quando a altura não aumenta.
 *
 * Com 80 fichas a linha cheia pede 30 colunas — metade da largura só cabe
 * 10, e 8 linhas lado a lado perdem para 3+3 empilhadas. Com 10–20 fichas
 * (1 linha empilhada vira 1–2 lado a lado) a troca paga.
 */
export function fitCabedalTalliesSideBySide(opts: {
  count: number;
  size?: TallySize;
  lastNumber?: number;
}): CabedalTallyPairLayout {
  const size = opts.size ?? 'sm';
  const lastNumber = opts.lastNumber ?? opts.count;
  const stackedAvail = tallyAvailableWidthPx(CABEDAL_TALLY_INSET_PX);
  const sideAvail = cabedalTallySideAvailablePx();
  const stacked = fitTallyBoxLayout({
    size, count: opts.count, lastNumber, availableWidthPx: stackedAvail,
  });
  const side = fitTallyBoxLayout({
    size, count: opts.count, lastNumber, availableWidthPx: sideAvail,
  });
  const stackedRows = Math.ceil(opts.count / Math.max(1, stacked.cols));
  const sideRows = Math.ceil(opts.count / Math.max(1, side.cols));
  const fitsWidth = side.occupiedPx + 2 <= sideAvail && side.boxPx >= TALLY_MIN_BOX_PX[size];
  // Altura empilhada = 2 faixas × stackedRows; lado a lado = sideRows.
  const sideBySide = opts.count > 0 && fitsWidth && sideRows <= 2 * stackedRows;
  return {
    sideBySide,
    availableWidthPx: sideBySide ? sideAvail : stackedAvail,
    layout: sideBySide ? side : stacked,
    stackedRows,
    sideRows,
  };
}
