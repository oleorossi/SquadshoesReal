/**
 * Geometria A4 das fichas — módulo FOLHA (sem React / sem ciclo).
 *
 * Separado de PaginatedSheet porque printContinuity precisa destas
 * constantes no top-level (`SECTOR_JOIN_GAP_PX = 7 * MM_TO_PX`). Importar
 * de PaginatedSheet criava ciclo PaginatedSheet ↔ printContinuity e TDZ
 * (`Cannot access 'MM_TO_PX' before initialization`) no chunk de
 * /imprimir-fichas.
 */

export const MM_TO_PX = 96 / 25.4;
/** Altura da caixa de página. O Chrome trata A4 como 841.8pt ≈ 296.9mm —
 *  com 296 a folga real era < 1mm e QUALQUER arredondamento sub-pixel
 *  derramava o pé da página numa folha em branco (PDF de 2026-06-12:
 *  20 páginas lógicas viraram 40 físicas). 294 ainda DERRAMAVA em páginas
 *  CHEIAS (delta tela-vs-impressão > 3mm → folhas 100% brancas, ex.: p3/p6/
 *  p31/p33 do PDF de 2026-06-19); 288 dá ~9mm de folga real e absorve o delta.
 *  Em PRINT a caixa vira height:auto (CSS da PrintWorkSheetsPage) — a
 *  altura fixa existe só pro preview em tela parecer papel. */
export const PAGE_HEIGHT_MM = 288;
export const PAGE_PAD_TOP_MM = 6;
export const PAGE_PAD_X_MM = 8;
export const PAGE_PAD_BOTTOM_MM = 8;
/** Faixa de cabeçalho: 6mm de altura + 2mm de respiro abaixo. */
export const HEADER_BAND_MM = 8;
/** Respiro vertical entre blocos empacotados na mesma página. */
export const BLOCK_GAP_MM = 2;

/** Largura útil da coluna de conteúdo (210mm − 2×8mm de padding lateral).
 *  É contra ela que `growCeilingFor` decide o teto do crescimento. */
export const PAGE_CONTENT_WIDTH_PX = (210 - 2 * PAGE_PAD_X_MM) * MM_TO_PX;

export const PAGE_CAPACITY_PX =
  (PAGE_HEIGHT_MM - PAGE_PAD_TOP_MM - PAGE_PAD_BOTTOM_MM - HEADER_BAND_MM) * MM_TO_PX;
export const BLOCK_GAP_PX = BLOCK_GAP_MM * MM_TO_PX;

/** Inflação print-vs-tela (2026-06-19). A IMPRESSÃO renderiza o conteúdo ~3-4%
 *  mais alto que a medição em TELA (métrica do line-height 8pt + arredondamento
 *  de linhas de tabela, acumulado ao longo da página). Numa página CHEIA (ex.:
 *  ACABAMENTO 1/2 a 99%) esse delta derramava o pé numa folha 100% branca mesmo
 *  com a folga fixa de 288mm. Em vez de cortar mais a caixa (folga fixa, penaliza
 *  toda página), EMPACOTAMOS prevendo a altura de impressão: altura medida ×
 *  PRINT_INFLATE. Assim a folga é PROPORCIONAL ao conteúdo — página cheia ganha
 *  ~16mm de respiro (não derrama), página vazia não muda. 1.06 cobre o delta
 *  observado com margem. Aplicado em packBlocks (base + busca do auto-fit). */
export const PRINT_INFLATE = 1.06;
