/**
 * adaptiveFont — dimensionamento adaptativo de TABELAS de print (fichas de
 * operador + Relatório Gerencial) pela QUANTIDADE de informação.
 *
 * Problema (2026-06-12, reportado pelo dono): fontes fixas cortavam linhas
 * das tabelas (clipping/overflow) quando a grade tinha muitas numerações
 * (grade mista infantil+adulto = 16+ colunas) ou quando o conteúdo era longo
 * (valores monetários do Relatório Gerencial). O CSS de print força
 * `table-layout: fixed` + `overflow: hidden` nas células — texto que não
 * cabe é CORTADO, não vaza.
 *
 * Regra: quanto mais colunas (e/ou conteúdo mais longo), menor a fonte e o
 * padding — o objetivo é NUNCA cortar texto nem estourar a largura A4
 * (194mm úteis ≈ 733px). Os buckets foram calibrados pros tamanhos que as
 * fichas já usavam (header 11-12px / célula mono 12px / Anton 17-22px), então
 * grades comuns (≤12 numerações) imprimem praticamente iguais ao layout
 * anterior; só os casos densos encolhem.
 *
 * Relacionado (NÃO substitui): `src/lib/adaptiveFontSize.ts` adapta UM texto
 * a UMA largura fixa (labels/badges/KPIs). Este aqui dimensiona a tabela
 * inteira pelo nº de colunas.
 */

export interface AdaptiveTableFont {
  /** Cabeçalho de numeração / colunas (Fira Code, bold). */
  headerPx: number;
  /** Células numéricas/mono regulares ("Por Ficha", itens, valores). */
  cellPx: number;
  /** Células de destaque em Anton (linha Total das grades). */
  displayPx: number;
  /** Células de texto corrido (referência, cor, solado). */
  textPx: number;
  /** Padding horizontal sugerido por célula (px). */
  padX: number;
  /** Padding vertical sugerido por célula (px). */
  padY: number;
}

const BUCKETS: ReadonlyArray<AdaptiveTableFont> = [
  // ≤ 8 colunas — folga total, tamanhos atuais das fichas.
  { headerPx: 12, cellPx: 12, displayPx: 20, textPx: 10, padX: 6, padY: 4 },
  // 9–12 colunas — grade adulta cheia; ainda confortável.
  { headerPx: 11, cellPx: 11, displayPx: 18, textPx: 10, padX: 4, padY: 3 },
  // 13–16 colunas — grade mista; compacta sem perder leitura de fábrica.
  { headerPx: 10, cellPx: 10, displayPx: 15, textPx: 9, padX: 3, padY: 3 },
  // 17–20 colunas — denso (Expedição com grade completa).
  { headerPx: 9, cellPx: 9, displayPx: 13, textPx: 8, padX: 2, padY: 2 },
  // > 20 colunas — limite de legibilidade; abaixo disso não descemos.
  { headerPx: 8, cellPx: 8, displayPx: 12, textPx: 7.5, padX: 2, padY: 2 },
];

/**
 * Retorna fontes/padding pra uma tabela de print.
 *
 * @param columns Nº TOTAL de colunas da tabela (incl. label/total/checkbox).
 * @param longestContent Comprimento (chars) do maior conteúdo de célula —
 *   opcional. Conteúdo longo (chave conjugada "33/34", moeda "R$ 123.456,78")
 *   rebaixa o bucket: > 3 chars desce 1 nível; > 10 chars desce 2.
 * @param bumpLevels Rebaixamento extra de bucket (densidade). Usado pelos
 *   layouts COMPACTOS (7º passe, 2026-06-12) pra 2 cores caberem numa A4.
 */
export function adaptiveTableFont(columns: number, longestContent = 0, bumpLevels = 0): AdaptiveTableFont {
  let bucket =
    columns <= 8 ? 0 :
    columns <= 12 ? 1 :
    columns <= 16 ? 2 :
    columns <= 20 ? 3 : 4;
  if (longestContent > 10) bucket += 2;
  else if (longestContent > 3) bucket += 1;
  bucket += bumpLevels;
  return BUCKETS[Math.min(bucket, BUCKETS.length - 1)];
}

/**
 * Conveniência pras GRADES de numeração das fichas: recebe as chaves de
 * numeração ativas e devolve o spec + a maior chave (pra largura de coluna).
 * Conta +2 colunas fixas (rótulo "Nº/Por Ficha/Total" + coluna Total).
 *
 * @param dense TRUE rebaixa 1 bucket (layout compacto — Corte Forração /
 *   Costura Palmilha / Silk, 7º passe). Não afeta os demais layouts.
 */
export function gradeTableFont(sizeKeys: ReadonlyArray<string>, dense = false): AdaptiveTableFont & { longestKey: number } {
  const longestKey = sizeKeys.reduce((m, s) => Math.max(m, String(s).length), 0);
  return { ...adaptiveTableFont(sizeKeys.length + 2, longestKey, dense ? 1 : 0), longestKey };
}

/**
 * PISOS TIPOGRÁFICOS por papel de célula (CLAUDE.md → "Tamanho de fonte em
 * print"). Em px, que é a unidade real dos componentes de print.
 */
export const FONT_FLOORS = {
  /** Rótulo mono UPPERCASE (cabeçalho de numeração). */
  headerPx: 6.5,
  /** Célula de dados / mono. */
  cellPx: 8,
  /** Número de grade em Anton. */
  displayPx: 12,
  /** Texto corrido (referência, material). */
  textPx: 7.5,
} as const;

/**
 * Menor escala que o auto-fit do `PaginatedSheet` pode aplicar sobre este
 * bucket SEM levar nenhum elemento abaixo do seu piso.
 *
 * Existe porque o auto-fit e a tabela de pisos não se conheciam: o
 * `AUTO_FIT_FLOOR = 0.80` aplicava zoom por cima de fontes que já estavam NO
 * piso. No bucket 4 (grade densa) isso levava célula de 8px → 6,4px e número
 * de grade de 12px → 9,6px — abaixo do mínimo legível no chão de fábrica.
 *
 * O dono decidiu em 31/07/2026: **legibilidade vence densidade**. O auto-fit
 * passa a parar antes de furar o piso, gastando uma folha a mais.
 *
 * Como cada elemento tem piso próprio, a escala mínima é o MAIOR dos
 * `piso ÷ valor` — basta um elemento chegar no piso pra travar o conjunto:
 *   bucket 0 e 1 → 0,75 (o 0.80 global segue mandando)
 *   bucket 2     → 0,833
 *   bucket 3     → 0,938
 *   bucket 4     → 1,000 (já está todo no piso: NÃO pode encolher)
 */
export function floorSafeScale(font: AdaptiveTableFont): number {
  return Math.max(
    FONT_FLOORS.headerPx / font.headerPx,
    FONT_FLOORS.cellPx / font.cellPx,
    FONT_FLOORS.displayPx / font.displayPx,
    FONT_FLOORS.textPx / font.textPx,
  );
}

/** Largura útil da coluna de conteúdo de uma página A4 do `PaginatedSheet`:
 *  210mm menos os 2×8mm de padding lateral = 194mm. Em px @96dpi. */
export const A4_CONTENT_WIDTH_PX = Math.floor(194 * (96 / 25.4));

/** Colunas de largura FIXA da tabela de grade (o `width` do `th` manda sob
 *  `table-layout: fixed`): o rótulo ("Total × N fichas") e a coluna "Total". */
const GRADE_LABEL_COL_PX = 96;
const GRADE_TOTAL_COL_PX = 56;
/** Razão largura/altura de glifo. Anton é condensado (mesma razão usada pelo
 *  `adaptiveFontSize` nas chamadas em Anton); Fira Code é monoespaçada. */
const ANTON_WIDTH_RATIO = 0.45;
const MONO_WIDTH_RATIO = 0.62;
/** Respiro horizontal por célula (padding de 1px de cada lado + folga). */
const GRADE_CELL_GUTTER_PX = 4;

/**
 * Largura MÍNIMA, em px, que a tabela de grade precisa para não CORTAR
 * conteúdo.
 *
 * Existe porque a grade vive sob `table-layout: fixed` + `overflow: hidden`:
 * número que não cabe na coluna é **cortado em silêncio** — o operador lê "18"
 * onde estava "180" e nada vaza para denunciar (CLAUDE.md → "Largura mínima
 * antes de estreitar qualquer coisa: a GRADE manda"). Toda vez que um layout
 * for tirar largura da grade, ele tem que passar por aqui antes.
 *
 * O maior conteúdo de uma coluna de numeração é o número da linha TOTAL, em
 * Anton `displayPx`; o cabeçalho (chave da numeração, Fira Code `headerPx`)
 * concorre quando a chave é longa (ex.: conjugada "33/34").
 *
 * @param sizeKeys      Numerações ativas (uma coluna cada).
 * @param font          Bucket do `adaptiveTableFont`/`gradeTableFont` em uso.
 * @param maxCellDigits Dígitos do maior número da grade. Default 4 (folgado).
 */
export function gradeMinWidthPx(
  sizeKeys: ReadonlyArray<string>,
  font: AdaptiveTableFont,
  maxCellDigits = 4,
): number {
  const headerChars = sizeKeys.reduce((m, s) => Math.max(m, String(s).length), 1);
  const perColumn = Math.max(
    headerChars * MONO_WIDTH_RATIO * font.headerPx,
    maxCellDigits * ANTON_WIDTH_RATIO * font.displayPx,
  ) + GRADE_CELL_GUTTER_PX;
  return Math.ceil(GRADE_LABEL_COL_PX + GRADE_TOTAL_COL_PX + sizeKeys.length * perColumn);
}
