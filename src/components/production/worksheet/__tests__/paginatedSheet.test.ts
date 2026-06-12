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

  it('keepWithPrev: rodapé que não cabe puxa o bloco anterior pra próxima página', () => {
    // Página 1: [0, 1] (900 + 10 + 50 = 960). Rodapé (2, 80px) não cabe
    // (960 + 10 + 80 > 1000) → puxa o bloco 1 junto: página 2 = [1, 2].
    const pages = packBlocks([900, 50, 80], CAP, GAP, [false, false, true]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0], [1, 2]]);
  });

  it('keepWithPrev: sem o flag, o rodapé abriria página sozinho (regressão)', () => {
    const pages = packBlocks([900, 50, 80], CAP, GAP);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1], [2]]);
  });

  it('keepWithPrev: quando rodapé CABE no restante, nada muda', () => {
    const pages = packBlocks([500, 50, 80], CAP, GAP, [false, false, true]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1, 2]]);
  });

  it('keepWithPrev: anterior era o único da página → página não sai vazia', () => {
    // Bloco 0 (980) sozinho na pág 1; rodapé (1) não cabe e puxa o 0 —
    // ambos vão juntos pra única página (980 + 10 + 5 ≤ 1000 não… 995 ≤ 1000 ok).
    const pages = packBlocks([980, 5], CAP, GAP, [false, true]);
    expect(pages).toHaveLength(1);
    expect(pages[0].blockIdxs).toEqual([0, 1]);
  });

  it('keepWithPrev: anterior + rodapé maiores que a página → rodapé abre sozinho (fallback)', () => {
    const pages = packBlocks([900, 950, 100], CAP, GAP, [false, false, true]);
    // 950 + 10 + 100 > 1000 → não dá pra manter juntos; fallback antigo.
    expect(pages.map(p => p.blockIdxs)).toEqual([[0], [1], [2]]);
  });

  it('keepWithNext: sub-header no fim da página viaja junto com o bloco seguinte', () => {
    // Página 1: [0, 1] (800 + 10 + 60 = 870). Bloco 2 (500) não cabe —
    // como 1 é keepWithNext (sub-header), vai junto: página 2 = [1, 2].
    const pages = packBlocks([800, 60, 500], CAP, GAP, undefined, [false, true, false]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0], [1, 2]]);
  });

  it('keepWithNext: sem o flag, o sub-header ficaria órfão no pé da página (regressão)', () => {
    const pages = packBlocks([800, 60, 500], CAP, GAP);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1], [2]]);
  });

  it('keepWithNext: quando o bloco seguinte CABE no restante, nada muda', () => {
    const pages = packBlocks([300, 60, 500], CAP, GAP, undefined, [false, true, false]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1, 2]]);
  });

  it('keepWithNext: cadeia de sub-headers no fim da página viaja inteira', () => {
    // [0]=700, [1]=60 (kwn), [2]=60 (kwn), [3]=500 → 1+2+3 vão juntos.
    const pages = packBlocks([700, 60, 60, 500], CAP, GAP, undefined, [false, true, true, false]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0], [1, 2, 3]]);
  });

  it('keepWithNext: sub-header + bloco maiores que a página → fallback (órfão aceito)', () => {
    // 60 + 10 + 980 = 1050 > 1000: não dá pra manter juntos.
    const pages = packBlocks([800, 60, 980], CAP, GAP, undefined, [false, true, false]);
    expect(pages.map(p => p.blockIdxs)).toEqual([[0, 1], [2]]);
  });

  it('keepWithNext + keepWithPrev compõem: header não fecha página, rodapé não abre', () => {
    // [0]=800, [1]=60 sub-header (kwn), [2]=400 card, [3]=80 rodapé (kwp).
    // Pg1=[0]; pg2=[1,2,3] (60+10+400+10+80 = 560 ≤ 1000).
    const pages = packBlocks(
      [800, 60, 400, 80], CAP, GAP,
      [false, false, false, true],
      [false, true, false, false],
    );
    expect(pages.map(p => p.blockIdxs)).toEqual([[0], [1, 2, 3]]);
  });

  it('constantes reais: capacidade A4 com margens internas é plausível', () => {
    // 294mm − 6 − 8 − 8 (faixa) = 272mm ≈ 1028px @96dpi
    expect(PAGE_CAPACITY_PX).toBeGreaterThan(1000);
    expect(PAGE_CAPACITY_PX).toBeLessThan(1100);
    expect(BLOCK_GAP_PX).toBeGreaterThan(0);
  });
});
