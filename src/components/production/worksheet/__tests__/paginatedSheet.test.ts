import { describe, it, expect } from 'vitest';
import { packBlocks, PAGE_CAPACITY_PX, BLOCK_GAP_PX } from '../PaginatedSheet';

// Capacidade/gap redondos pra facilitar a leitura dos casos.
const CAP = 1000;
const GAP = 10;

describe('packBlocks — paginação explícita das fichas', () => {
  it('agrupa blocos que cabem na mesma página', () => {
    const pages = packBlocks([300, 300, 300], CAP, GAP);
    // 300 + 10 + 300 + 10 + 300 = 920 ≤ 1000 → 1 página só
    expect(pages).toHaveLength(1);
    expect(pages[0].blockIdxs).toEqual([0, 1, 2]);
    expect(pages[0].flow).toBe(false);
    expect(pages[0].startPage).toBe(1);
  });

  it('card inteiro ou nada: bloco que não cabe abre a página seguinte', () => {
    const pages = packBlocks([600, 500], CAP, GAP);
    // 600 + 10 + 500 = 1110 > 1000 → o 2º bloco vai INTEIRO pra página 2
    expect(pages).toHaveLength(2);
    expect(pages[0].blockIdxs).toEqual([0]);
    expect(pages[1].blockIdxs).toEqual([1]);
    expect(pages[1].startPage).toBe(2);
  });

  it('não reordena blocos (ordem é semântica: header → cards → footer)', () => {
    const pages = packBlocks([900, 50, 900, 50], CAP, GAP);
    // O bloco 3 (50px) caberia na página 1, mas vem DEPOIS do bloco 2 — não
    // pode ser puxado pra trás.
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1], [2, 3]]);
  });

  it('bloco maior que a página inteira vira página flow com spanned = ceil', () => {
    const pages = packBlocks([100, 2500, 100], CAP, GAP);
    expect(pages).toHaveLength(3);
    expect(pages[0].blockIdxs).toEqual([0]);
    expect(pages[1]).toMatchObject({ blockIdxs: [1], flow: true, spanned: 3 }); // ceil(2500/1000)
    expect(pages[2].blockIdxs).toEqual([2]);
    // Numeração física: pg1 = bloco 0; pgs 2-4 = bloco flow; pg5 = bloco 2.
    expect(pages[0].startPage).toBe(1);
    expect(pages[1].startPage).toBe(2);
    expect(pages[2].startPage).toBe(5);
    const total = pages.reduce((s, p) => s + p.spanned, 0);
    expect(total).toBe(5);
  });

  it('bloco exatamente na capacidade NÃO vira flow', () => {
    const pages = packBlocks([CAP], CAP, GAP);
    expect(pages).toHaveLength(1);
    expect(pages[0].flow).toBe(false);
    expect(pages[0].spanned).toBe(1);
  });

  it('lista vazia produz 1 página vazia (nunca zero páginas)', () => {
    const pages = packBlocks([], CAP, GAP);
    expect(pages).toHaveLength(1);
    expect(pages[0].blockIdxs).toEqual([]);
    expect(pages[0].startPage).toBe(1);
  });

  it('gap só conta ENTRE blocos da mesma página', () => {
    // 2 blocos de 495: 495 + 10 + 495 = 1000 = capacidade exata → cabem juntos
    const pages = packBlocks([495, 495], CAP, GAP);
    expect(pages).toHaveLength(1);
  });

  it('constantes reais: capacidade A4 com margens internas é plausível', () => {
    // 296mm − 6 − 8 − 8 (faixa) = 274mm ≈ 1035px @96dpi
    expect(PAGE_CAPACITY_PX).toBeGreaterThan(1000);
    expect(PAGE_CAPACITY_PX).toBeLessThan(1100);
    expect(BLOCK_GAP_PX).toBeGreaterThan(0);
  });
});
