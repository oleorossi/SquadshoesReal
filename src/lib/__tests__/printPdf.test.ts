import { describe, expect, it } from 'vitest';
import { splitHtmlIntoBatches, MAX_BATCH_BYTES } from '../printPdf';

/**
 * O fatiamento é a única lógica pura do caminho de impressão em PDF, e errar
 * aqui é caro de um jeito silencioso: etiqueta faltando no meio do maço, que só
 * aparece na conferência do romaneio. Por isso os testes contam PÁGINAS.
 *
 * O corte é por BYTES (limite de ~4,5MB do corpo da requisição), não por
 * contagem de páginas — medido em 10/08/2026: renderizar 40 páginas custa o
 * mesmo que renderizar 2, então fatiar por página só multiplicava a partida do
 * Chromium sem ganho nenhum.
 */

/** Etiqueta usa `<section class="page">`; ficha usa `<div class="pagi-page">`
 *  (PaginatedSheet.tsx:373). O fatiador precisa entender as DUAS. */
const paginas = (n: number, cls: 'page' | 'pagi-page' = 'page', recheio = '') =>
  Array.from({ length: n }, (_, i) => (cls === 'page'
    ? `<section class="page"><b>${i + 1}</b>${recheio}</section>`
    : `<div class="pagi-page"><b>${i + 1}</b>${recheio}</div>`)).join('');

const doc = (corpo: string, head = '<style>.page{}</style>') =>
  `<!doctype html><html><head>${head}</head><body class="doc">${corpo}</body></html>`;

const contaPaginas = (html: string) => (html.match(/class="(page|pagi-page)"/g) || []).length;
const ordem = (lotes: string[]) =>
  lotes.flatMap(l => [...l.matchAll(/<b>(\d+)<\/b>/g)].map(m => Number(m[1])));

describe('splitHtmlIntoBatches', () => {
  it('documento que cabe no teto vai em UMA requisição só', () => {
    // É o caso normal das etiquetas: 120 rótulos dão ~350KB. Antes isto virava
    // 3 chamadas por causa do corte fixo de 40 páginas, pagando 3× a partida.
    const html = doc(paginas(120));
    expect(html.length).toBeLessThan(MAX_BATCH_BYTES);
    expect(splitHtmlIntoBatches(html)).toEqual([html]);
  });

  it('fatia quando passa do teto, sem perder nem duplicar página', () => {
    const total = 60;
    const recheio = 'x'.repeat(500);
    const lotes = splitHtmlIntoBatches(doc(paginas(total, 'page', recheio)), 4000);
    expect(lotes.length).toBeGreaterThan(1);
    expect(lotes.reduce((s, l) => s + contaPaginas(l), 0)).toBe(total);
  });

  it('mantém a ORDEM das páginas — maço fora de ordem é retrabalho no chão', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(9, 'page', 'y'.repeat(300))), 1200);
    expect(ordem(lotes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('nenhum lote passa do teto (fora o caso da folha gigante sozinha)', () => {
    const teto = 3000;
    const lotes = splitHtmlIntoBatches(doc(paginas(40, 'page', 'z'.repeat(200))), teto);
    for (const lote of lotes) {
      if (contaPaginas(lote) > 1) expect(lote.length).toBeLessThanOrEqual(teto);
    }
  });

  it('folha maior que o teto sai inteira, nunca picada ao meio', () => {
    // Cortar no meio produziria etiqueta truncada — pior que uma requisição grande.
    const lotes = splitHtmlIntoBatches(doc(paginas(3, 'page', 'w'.repeat(5000))), 1000);
    expect(lotes.reduce((s, l) => s + contaPaginas(l), 0)).toBe(3);
    expect(ordem(lotes)).toEqual([1, 2, 3]);
  });

  it('todo lote leva o <head> — sem os estilos a etiqueta sai sem moldura', () => {
    const lotes = splitHtmlIntoBatches(
      doc(paginas(30, 'page', 'k'.repeat(400)), '<style>.marca{color:#C00000}</style>'),
      3000,
    );
    expect(lotes.length).toBeGreaterThan(1);
    for (const lote of lotes) expect(lote).toContain('.marca{color:#C00000}');
  });

  it('preserva os atributos do <body> (classe usada pelo CSS de print)', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(30, 'page', 'k'.repeat(400))), 3000);
    for (const lote of lotes) expect(lote).toContain('<body class="doc">');
  });

  it('entende a página das FICHAS (.pagi-page), não só a da etiqueta', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(30, 'pagi-page', 'q'.repeat(400))), 3000);
    expect(lotes.length).toBeGreaterThan(1);
    expect(lotes.reduce((s, l) => s + contaPaginas(l), 0)).toBe(30);
  });

  it('HTML sem <head>/<body> reconhecível não é fatiado às cegas', () => {
    const solto = '<section class="page">' + 'a'.repeat(5000) + '</section>';
    expect(splitHtmlIntoBatches(solto, 100)).toEqual([solto]);
  });

  it('o teto padrão tem folga sobre o limite de ~4,5MB da requisição', () => {
    expect(MAX_BATCH_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});
