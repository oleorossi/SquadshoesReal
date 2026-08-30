import { A4_CONTENT_WIDTH_PX, gradeMinWidthPx, type AdaptiveTableFont } from './adaptiveFont';

/**
 * sideBySide — a regra do "não gaste ALTURA deixando a LARGURA parada".
 *
 * Nasceu no Corte Forração (PR #173): a faixa de miniaturas gastava ~86px de
 * altura usando ~13% da largura, e logo abaixo a grade — de altura parecida —
 * usava a largura inteira. Postas lado a lado, a foto deixou de custar altura:
 * o maço de uma OP complexa caiu de 9 folhas para 5, e a largura realmente
 * usada subiu de 79% para 94% (medido nos componentes reais, 29/08/2026).
 *
 * O padrão é sempre o mesmo, e é por isso que a regra mora aqui em vez de ser
 * recopiada em cada ficha:
 *
 *   1. um bloco ESTREITO (miniaturas, strip de sandálias) que gasta altura;
 *   2. um bloco LARGO logo abaixo (a grade) com altura parecida;
 *   3. só junta os dois se a grade continuar acima da largura MÍNIMA dela.
 *
 * O passo 3 é a parte que não se pode pular. A grade vive sob
 * `table-layout: fixed`: número que não cabe na coluna é cortado em SILÊNCIO —
 * o operador lê "18" onde estava "180" e nada no papel denuncia (CLAUDE.md →
 * "Largura mínima antes de estreitar qualquer coisa: a GRADE manda"). Numa
 * grade densa (18 numerações, totais de 4 dígitos) a conta reprova sozinha e a
 * ficha volta a empilhar, como se vê no caso `Corte Forração · densa`.
 *
 * O `rigidWidthPx` que sai daqui vai no `data-rigid-width` da linha: é assim
 * que o auto-fit do `PaginatedSheet` sabe que não pode crescer a ponto de
 * espremer a grade que este arranjo estreitou (ver growCeilingFor).
 *
 * ⚠ A GUARDA É NECESSÁRIA, NÃO SUFICIENTE. Ela responde "a grade aguenta?" —
 * não responde "vale a pena?". O paginador raciocina em CARDS INTEIROS: altura
 * economizada só vira papel quando abre espaço para um bloco inteiro subir de
 * folha. Abaixo disso ela vira branco no fim da folha, e pode piorar o
 * resultado. Dois casos medidos, ambos com a guarda APROVANDO:
 *
 *   · Corte Forração, OP complexa — 9 folhas → 5. Os ~86px por card abriram
 *     espaço para outra cor subir. PAGOU.
 *   · Solagem/Colagem, mesma OP — 3 folhas → 3, largura usada 77% → 72%,
 *     altura ociosa 465px → 484px. Os ~99px por banda não compravam bloco
 *     nenhum, e estreitar a grade piorou o aproveitamento da largura.
 *     NÃO PAGOU — a mudança foi medida e descartada em 30/08/2026.
 *
 * Antes de aplicar este padrão num setor novo: MEÇA o maço inteiro (folhas,
 * não px). Se o número de folhas não cair, não aplique.
 */

/**
 * Respiro entre o bloco estreito e a grade.
 *
 * ⚠ Reserva DELIBERADAMENTE 8px para um `gap-2` que dentro da `.print-area`
 * vale 6px (`PrintWorkSheetsPage.tsx` comprime o spacing no print). Errar 2px
 * para MAIS é seguro — sobra folga; errar para menos apertaria a grade abaixo
 * do mínimo, que é justamente o que este módulo existe para impedir.
 */
export const SIDE_BY_SIDE_GAP_PX = 8;

export interface SideBySideFit {
  /** O bloco estreito pode sentar ao lado da grade? */
  fits: boolean;
  /** Largura que a linha exige, para `data-rigid-width`. 0 quando não junta. */
  rigidWidthPx: number;
  /** Quanto sobra de largura depois de acomodar os dois (px). Negativo = não cabe. */
  slackPx: number;
}

/**
 * Decide se um bloco estreito cabe ao lado da grade, e com quanta folga.
 *
 * Pura e exportada de propósito: é a regra que decide o layout, e decisão de
 * layout que só existe dentro do JSX não tem como ser travada por teste.
 *
 * @param asideWidthPx     Largura do bloco estreito (miniaturas + seus respiros).
 * @param sizeKeys         Numerações ativas da grade (uma coluna cada).
 * @param font             Bucket do `gradeTableFont` que a grade vai usar.
 * @param maxCellDigits    Dígitos do maior número da grade (default 4, folgado).
 * @param availableWidthPx Largura útil onde os dois vão morar. Default: a
 *   coluna inteira da A4. Passe a largura INTERNA quando a linha viver dentro
 *   de um card com padding/borda — senão a conta mede a régua errada.
 */
export function fitBesideGrade({
  asideWidthPx,
  sizeKeys,
  font,
  maxCellDigits = 4,
  availableWidthPx = A4_CONTENT_WIDTH_PX,
}: {
  asideWidthPx: number;
  sizeKeys: ReadonlyArray<string>;
  font: AdaptiveTableFont;
  maxCellDigits?: number;
  availableWidthPx?: number;
}): SideBySideFit {
  if (asideWidthPx <= 0) return { fits: false, rigidWidthPx: 0, slackPx: 0 };
  const gradeMin = gradeMinWidthPx(sizeKeys, font, maxCellDigits);
  const needed = asideWidthPx + SIDE_BY_SIDE_GAP_PX + gradeMin;
  return {
    fits: needed <= availableWidthPx,
    rigidWidthPx: needed,
    slackPx: Math.round(availableWidthPx - needed),
  };
}

/**
 * Largura total de uma fila de miniaturas de lado `sizePx`, contando os
 * respiros ENTRE elas e o respiro que separa a fila da grade.
 */
export function thumbRowWidthPx(count: number, sizePx: number): number {
  if (count <= 0) return 0;
  return count * sizePx + (count - 1) * SIDE_BY_SIDE_GAP_PX;
}
