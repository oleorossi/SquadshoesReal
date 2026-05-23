/**
 * adaptiveFontSize — fontes adaptáveis baseadas no comprimento do texto,
 * pra evitar corte de conteúdo em labels/cells/badges com largura fixa.
 *
 * **Diretriz do sistema (definida 22/05/2026)**: todo elemento de UI
 * que tenha largura fixa OU min-width E renderiza texto dinâmico
 * (número de fichas, quantidade, código longo, nome de cliente, etc.)
 * DEVE usar fonte adaptável pra que o texto sempre caiba sem cortar.
 *
 * NÃO usar quando:
 * - O container é flexível (não tem min/max width)
 * - O texto é estático (literal fixo)
 * - O conteúdo pode quebrar em múltiplas linhas naturalmente
 *
 * Lugares de alto impacto pra aplicar:
 * - Labels de tabelas com largura constrita (worksheets, relatórios)
 * - Badges de status com valores numéricos (OPs, pares, dias)
 * - KPI cards com números que podem crescer (R$ 1.234.567,89)
 * - Buttons com texto que varia
 * - Cells de grid de operador (números grandes Anton)
 *
 * Algoritmo: contagem aproximada de chars × largura média (mono ou prop) →
 * compara com largura disponível → reduz fontSize em steps. Não é exato
 * (não mede getBBox), mas é barato e funciona em SSR.
 */

/**
 * Calcula font-size adaptado ao comprimento do texto e largura disponível.
 *
 * @param text - Texto a renderizar (pode ter \n ou <br/> — pega linha mais longa)
 * @param opts.maxWidthPx - Largura disponível em px (largura do container menos padding)
 * @param opts.baseFontPx - Tamanho base ideal quando há espaço sobrando (default 10)
 * @param opts.minFontPx - Limite inferior pra não virar ilegível (default 7)
 * @param opts.charWidthRatio - Largura média de char em relação à font-size.
 *                              Mono+tracking: ~0.65 · Prop sans: ~0.5 · Anton: ~0.45
 * @returns font-size em px que faz o texto caber (ou minFontPx se nem isso couber)
 */
export function adaptiveFontSize(
  text: string,
  opts: {
    maxWidthPx: number;
    baseFontPx?: number;
    minFontPx?: number;
    charWidthRatio?: number;
  },
): number {
  const baseFontPx = opts.baseFontPx ?? 10;
  const minFontPx = opts.minFontPx ?? 7;
  const charWidthRatio = opts.charWidthRatio ?? 0.55;

  // Pega a linha mais longa (pode ter <br> ou \n)
  const lines = String(text || '').split(/<br\s*\/?>|\n/);
  const longestLine = lines.reduce((m, l) => Math.max(m, l.length), 0);

  if (longestLine === 0) return baseFontPx;

  // Largura necessária com a font base
  const neededPx = longestLine * baseFontPx * charWidthRatio;
  if (neededPx <= opts.maxWidthPx) return baseFontPx;

  // Calcula font menor pra caber
  const scaled = (opts.maxWidthPx / longestLine) / charWidthRatio;
  return Math.max(minFontPx, Math.floor(scaled * 2) / 2); // arredonda pra 0.5px
}

/**
 * Variante pra labels mono compactas em tabelas A4 (worksheets).
 * Otimizado pra "× {N} fichas" e similares — usa charWidth de mono+tracking.
 */
export function adaptiveLabelFontSize(
  fichas: number | undefined,
  mixedGrades?: boolean,
): number {
  const n = fichas || 0;
  const extraChars = mixedGrades ? 2 : 0;
  const totalChars = 7 + extraChars + String(n).length;

  if (totalChars >= 13) return 8;
  if (totalChars >= 11) return 8.5;
  return 10;
}

/**
 * Variante pra valores numéricos grandes (KPI, preço, total) que devem
 * ocupar o máximo possível sem cortar. Usado em Anton/display.
 */
export function adaptiveNumberFontSize(
  value: number | string,
  opts: {
    maxWidthPx: number;
    baseFontPx?: number;
    minFontPx?: number;
  },
): number {
  return adaptiveFontSize(String(value), {
    maxWidthPx: opts.maxWidthPx,
    baseFontPx: opts.baseFontPx ?? 36,
    minFontPx: opts.minFontPx ?? 14,
    charWidthRatio: 0.45, // Anton/display = mais condensed
  });
}
