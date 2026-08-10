import { describe, expect, it } from 'vitest';
import { splitHtmlIntoBatches, PAGES_PER_BATCH } from '../printPdf';

/**
 * O fatiamento é a única lógica pura do caminho de impressão em PDF, e errar
 * aqui é caro de um jeito silencioso: etiqueta faltando no meio do maço, que só
 * aparece na conferência do romaneio. Por isso os testes contam PÁGINAS, não
 * caracteres.
 */
/** Etiqueta usa `<section class="page">`; ficha usa `<div class="pagi-page">`
 *  (PaginatedSheet.tsx:373). O fatiador precisa entender as DUAS. */
const paginas = (n: number, cls: 'page' | 'pagi-page' = 'page') =>
  Array.from({ length: n }, (_, i) => (cls === 'page'
    ? `<section class="page"><b>${i + 1}</b></section>`
    : `<div class="pagi-page"><b>${i + 1}</b></div>`)).join('');

const doc = (corpo: string, head = '<style>.page{}</style>') =>
  `<!doctype html><html><head>${head}</head><body class="doc">${corpo}</body></html>`;

const contaPaginas = (html: string) => (html.match(/class="(page|pagi-page)"/g) || []).length;

describe('splitHtmlIntoBatches', () => {
  it('documento pequeno vai inteiro, sem fatiar', () => {
    const html = doc(paginas(5));
    expect(splitHtmlIntoBatches(html, 40)).toEqual([html]);
  });

  it('não perde nem duplica nenhuma página ao fatiar', () => {
    const total = 97;
    const lotes = splitHtmlIntoBatches(doc(paginas(total)), 40);
    expect(lotes).toHaveLength(3);
    expect(lotes.reduce((s, l) => s + contaPaginas(l), 0)).toBe(total);
  });

  it('mantém a ORDEM das páginas — maço fora de ordem é retrabalho no chão', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(9)), 4);
    const numeros = lotes.flatMap(l => [...l.matchAll(/<b>(\d+)<\/b>/g)].map(m => Number(m[1])));
    expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('todo lote leva o <head> — sem os estilos a etiqueta sai sem moldura', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(50), '<style>.marca{color:#C00000}</style>'), 40);
    expect(lotes).toHaveLength(2);
    for (const lote of lotes) expect(lote).toContain('.marca{color:#C00000}');
  });

  it('preserva os atributos do <body> (classe usada pelo CSS de print)', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(50)), 40);
    for (const lote of lotes) expect(lote).toContain('<body class="doc">');
  });

  it('entende a página das FICHAS (.pagi-page), não só a da etiqueta', () => {
    const lotes = splitHtmlIntoBatches(doc(paginas(50, 'pagi-page')), 20);
    expect(lotes).toHaveLength(3);
    expect(lotes.reduce((s, l) => s + contaPaginas(l), 0)).toBe(50);
  });

  it('HTML sem <head>/<body> reconhecível não é fatiado às cegas', () => {
    const solto = '<section class="page">só isso</section>';
    expect(splitHtmlIntoBatches(solto, 1)).toEqual([solto]);
  });

  // O lote existe por TAMANHO de requisição (~4,5MB), não por tempo: a Vercel dá
  // 300s por função até no Hobby. Ficha densa é o caso que aperta.
  it('o lote padrão é pequeno o bastante pra caber no limite de envio', () => {
    expect(PAGES_PER_BATCH).toBeLessThanOrEqual(40);
  });
});
