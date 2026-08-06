import { describe, it, expect } from 'vitest';
import {
  Box, CONTENT_AREA, LABEL_H, MAX_PER_PAGE, MIN_PER_PAGE,
  layoutBoxes, paginateItems,
} from '@/lib/catalogSheet';

/**
 * Lâmina do catálogo — a geometria é a única parte da feature que dá pra travar
 * sem IA e sem canvas (jsdom não tem 2D context, então `buildCatalogSheets` não
 * roda aqui). O que estes testes protegem é o modo de falha SILENCIOSO: caixa
 * que escapa da área útil ou que se sobrepõe não estoura exceção nenhuma — sai
 * um PNG com foto cortada ou colada por cima da outra, e só o olho pega.
 */

const w = (b: Box) => b.x1 - b.x0;
const h = (b: Box) => b.y1 - b.y0;
/** Sobreposição de área entre duas caixas (0 = encostadas ou separadas). */
const overlaps = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) > 0;

const TODAS = Array.from({ length: MAX_PER_PAGE }, (_, i) => i + 1);

describe('paginateItems', () => {
  it('divide em páginas do tamanho pedido, última parcial', () => {
    expect(paginateItems([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('1 por página gera uma página por foto', () => {
    expect(paginateItems([1, 2, 3], 1)).toHaveLength(3);
  });

  it('trava perPage na faixa 1..6', () => {
    expect(paginateItems([1, 2, 3, 4, 5, 6, 7, 8], 99)[0]).toHaveLength(MAX_PER_PAGE);
    expect(paginateItems([1, 2, 3], -5)[0]).toHaveLength(MIN_PER_PAGE);
  });

  it('perPage 0/NaN cai no default 3 em vez de laçar pra sempre', () => {
    // `Math.floor(0) || 3` — o guard existe porque perPage vem de um parseInt
    // de <Select>; um 0 aqui faria o for(i += 0) nunca terminar.
    expect(paginateItems([1, 2, 3, 4], 0)).toEqual([[1, 2, 3], [4]]);
    expect(paginateItems([1, 2, 3, 4], NaN)).toEqual([[1, 2, 3], [4]]);
  });

  it('lista vazia não gera página', () => {
    expect(paginateItems([], 3)).toEqual([]);
  });
});

describe('layoutBoxes', () => {
  it.each(TODAS)('devolve exatamente %i caixa(s)', (n) => {
    expect(layoutBoxes(n, CONTENT_AREA)).toHaveLength(n);
  });

  it.each(TODAS)('nenhuma caixa escapa da área útil com n=%i', (n) => {
    for (const box of layoutBoxes(n, CONTENT_AREA)) {
      expect(box.x0).toBeGreaterThanOrEqual(CONTENT_AREA.x0);
      expect(box.y0).toBeGreaterThanOrEqual(CONTENT_AREA.y0);
      expect(box.x1).toBeLessThanOrEqual(CONTENT_AREA.x1);
      expect(box.y1).toBeLessThanOrEqual(CONTENT_AREA.y1);
    }
  });

  it.each(TODAS)('nenhuma caixa se sobrepõe a outra com n=%i', (n) => {
    const boxes = layoutBoxes(n, CONTENT_AREA);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
      }
    }
  });

  it.each(TODAS)('toda caixa cabe a foto E o rótulo com n=%i', (n) => {
    // Sem esta folga, `slotH` vira negativo em drawItem e a foto é desenhada
    // com 1×1 px — some da lâmina sem erro nenhum.
    for (const box of layoutBoxes(n, CONTENT_AREA)) {
      expect(w(box)).toBeGreaterThan(0);
      expect(h(box)).toBeGreaterThan(LABEL_H);
    }
  });

  it('n=3 mantém o layout da referência: 1 alta à esquerda + 2 empilhadas à direita', () => {
    const [esquerda, cima, baixo] = layoutBoxes(3, CONTENT_AREA);
    expect(esquerda.x1).toBeLessThanOrEqual(cima.x0);      // colunas separadas
    expect(cima.x0).toBe(baixo.x0);                        // as 2 da direita alinhadas
    expect(cima.x1).toBe(baixo.x1);
    expect(cima.y1).toBeLessThan(baixo.y0);                // empilhadas, com respiro
    expect(h(esquerda)).toBeGreaterThan(h(cima));          // a da esquerda é a grande
  });

  it('a última linha incompleta fica centrada, não encostada à esquerda', () => {
    // n=5 → 3 na primeira linha, 2 na segunda. Sem o offset a linha de baixo
    // ficaria colada na margem esquerda e a lâmina sairia torta.
    const boxes = layoutBoxes(5, CONTENT_AREA);
    const primeiraLinha = boxes.slice(0, 3);
    const segundaLinha = boxes.slice(3);
    const folgaEsquerda = segundaLinha[0].x0 - CONTENT_AREA.x0;
    const folgaDireita = CONTENT_AREA.x1 - segundaLinha[segundaLinha.length - 1].x1;
    expect(folgaEsquerda).toBeGreaterThan(0);
    expect(Math.abs(folgaEsquerda - folgaDireita)).toBeLessThanOrEqual(1); // arredondamento
    expect(primeiraLinha[0].y0).toBeLessThan(segundaLinha[0].y0);
  });

  it('n=1 ocupa a área inteira', () => {
    const [unica] = layoutBoxes(1, CONTENT_AREA);
    expect(w(unica)).toBe(CONTENT_AREA.x1 - CONTENT_AREA.x0);
    expect(h(unica)).toBe(CONTENT_AREA.y1 - CONTENT_AREA.y0);
  });
});
