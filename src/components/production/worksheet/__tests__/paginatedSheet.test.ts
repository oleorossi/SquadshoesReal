import { describe, it, expect } from 'vitest';
import {
  packBlocks, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE,
  chooseAutoFitScale, growCeilingFor, rigidWidthOnPage, PAGE_CONTENT_WIDTH_PX,
} from '../PaginatedSheet';
import { A4_CONTENT_WIDTH_PX } from '../adaptiveFont';

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

  it('PRINT_INFLATE: empacota prevendo a altura de IMPRESSÃO (~98% cheia → 2 ao inflar)', () => {
    // A impressão rende ~3-4% mais alto que a tela; sem prever isso, a página
    // CHEIA derrama o pé numa folha em branco (ACABAMENTO 1/2, PDF 2026-06-19).
    const h = PAGE_CAPACITY_PX * 0.49; // 2 blocos = 98% da capacidade medida
    // medido em tela: 98% ≤ 100% → 1 página
    expect(packBlocks([h, h], PAGE_CAPACITY_PX, 0)).toHaveLength(1);
    // prevendo impressão (× PRINT_INFLATE ≈ 104%) → 2 páginas: não derrama.
    expect(packBlocks([h, h].map(x => x * PRINT_INFLATE), PAGE_CAPACITY_PX, 0)).toHaveLength(2);
    expect(PRINT_INFLATE).toBeGreaterThan(1);
    expect(PRINT_INFLATE).toBeLessThan(1.12); // sanidade: folga, não exagero
  });

  it('constantes reais: capacidade A4 com margens internas é plausível', () => {
    // 288mm − 6 − 8 − 8 (faixa) = 266mm ≈ 1005px @96dpi (288 dá ~9mm de folga
    // contra os 296.9mm que o Chrome usa pra A4 — mata o derrame em página cheia).
    expect(PAGE_CAPACITY_PX).toBeGreaterThan(950);
    expect(PAGE_CAPACITY_PX).toBeLessThan(1100);
    expect(BLOCK_GAP_PX).toBeGreaterThan(0);
  });
});

/**
 * Lado que CRESCE do auto-fit (2026-08-29).
 *
 * A regra da casa manda usar "a MAIOR fonte que couber na moldura", e até aqui
 * o auto-fit só sabia encolher: ficha que fechava no meio da folha saía com
 * fonte de folha cheia e o resto em branco. O que estes testes travam não é o
 * crescimento em si — é o que ele NÃO pode fazer.
 */
describe('chooseAutoFitScale — encolher e crescer', () => {
  const opts = (extra: Record<string, unknown> = {}) => ({
    capacity: CAP, gap: GAP, ...extra,
  });

  it('cresce até encher quando sobra folha', () => {
    // 1 bloco de 400 numa página de 1000: com a previsão de impressão e a folga
    // de crescimento ainda sobra muito espaço → cresce até o teto duro.
    const { scale, pages } = chooseAutoFitScale([400], opts());
    expect(scale).toBeGreaterThan(1);
    expect(pages).toHaveLength(1);
  });

  it('NÃO cresce quando a folha já está cheia', () => {
    // Regressão: crescer um bloco ALÉM da capacidade o transforma em página
    // `flow` com spanned 2 — mesmos índices, mesma "composição", o dobro de
    // folhas. A assinatura tem que enxergar isso.
    const { scale, pages } = chooseAutoFitScale([CAP / PRINT_INFLATE - 1], opts());
    expect(scale).toBe(1);
    expect(pages.reduce((a, p) => a + p.spanned, 0)).toBe(1);
  });

  it('crescer NUNCA muda quem está em qual folha', () => {
    // Sem essa trava, crescer empurra o 2º bloco pra folha seguinte e "compra"
    // corpo de letra deixando MAIS branco pra trás (medido no PV-00167).
    const heights = [300, 300, 120];
    const antes = chooseAutoFitScale(heights, opts({ maxScale: 1 })).pages.map(p => p.blockIdxs);
    const depois = chooseAutoFitScale(heights, opts()).pages.map(p => p.blockIdxs);
    expect(depois).toEqual(antes);
  });

  it('crescer NUNCA acrescenta folha', () => {
    for (const hs of [[400], [300, 300], [200, 200, 200], [450, 300, 90], [700, 120]]) {
      const base = chooseAutoFitScale(hs, opts({ maxScale: 1 }));
      const grown = chooseAutoFitScale(hs, opts());
      const total = (r: { pages: Array<{ spanned: number }> }) =>
        r.pages.reduce((a, p) => a + p.spanned, 0);
      expect(total(grown)).toBe(total(base));
      expect(grown.scale).toBeGreaterThanOrEqual(1);
    }
  });

  it('a largura rígida trava o crescimento (Controle de Fichas não reflui)', () => {
    // Uma linha que exige 707px de 733 disponíveis só tolera ~×1,03.
    const teto = growCeilingFor([707]);
    const { scale } = chooseAutoFitScale([400], opts({ maxScale: teto }));
    expect(scale).toBeLessThanOrEqual(teto + 1e-9);
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(1.06);
  });

  it('bloco maior que a folha (flow) não cresce — só ganharia folha', () => {
    const { scale } = chooseAutoFitScale([CAP * 2], opts());
    expect(scale).toBe(1);
  });

  it('encolher continua tendo precedência e só age se elimina uma folha', () => {
    // 2 blocos que somam pouco mais que a página: encolher tira a 2ª folha.
    const h = (CAP / PRINT_INFLATE) * 0.53;
    const { scale, pages } = chooseAutoFitScale([h, h], opts());
    expect(scale).toBeLessThan(1);
    expect(pages).toHaveLength(1);
  });

  it('o piso do conteúdo impede o encolhimento quando a grade já está no mínimo', () => {
    // Mesmo caso do teste anterior, mas com a grade já no piso tipográfico
    // (minScale 1): a folha extra é gasta em vez de espremer o número da grade
    // — decisão do dono 31/07/2026, legibilidade vence densidade.
    const h = (CAP / PRINT_INFLATE) * 0.53;
    const { scale, pages } = chooseAutoFitScale([h, h], opts({ minScale: 1 }));
    expect(pages).toHaveLength(2);
    expect(scale).toBeGreaterThanOrEqual(1);
  });
});

describe('growCeilingFor — teto do crescimento vindo da largura', () => {
  it('sem bloco rígido, não há razão de largura para parar antes', () => {
    expect(growCeilingFor([])).toBeGreaterThan(1);
    expect(growCeilingFor([0, 0])).toBeGreaterThan(1);
  });

  it('manda o bloco MAIS exigente', () => {
    expect(growCeilingFor([300, 707, 120])).toBeCloseTo(growCeilingFor([707]), 6);
  });

  it('bloco que já ocupa a largura inteira não deixa crescer nada', () => {
    expect(growCeilingFor([PAGE_CONTENT_WIDTH_PX])).toBeCloseTo(1, 6);
    expect(growCeilingFor([PAGE_CONTENT_WIDTH_PX * 2])).toBe(1);
  });

  it('a largura de conteúdo bate com a que o adaptiveFont usa para a grade', () => {
    // Duas constantes para a mesma coluna de 194mm; divergirem faria a decisão
    // "cabe ao lado da grade" e o teto do auto-fit medirem réguas diferentes.
    expect(Math.floor(PAGE_CONTENT_WIDTH_PX)).toBe(A4_CONTENT_WIDTH_PX);
  });
});

/**
 * O bloco declara a largura que exige na régua DELE; o teto do crescimento é
 * comparado contra a página. Quando a linha vive dentro de um card com padding
 * (Solagem, Palmilha), o recuo até a borda do bloco tem que entrar na conta.
 */
describe('rigidWidthOnPage — largura declarada na régua da página', () => {
  it('linha solta na coluna da A4: declarada = exigida', () => {
    expect(rigidWidthOnPage(705, 733, 733)).toBe(705);
  });

  it('linha dentro de card com padding e borda: soma o recuo', () => {
    // card: borda 1,5px de cada lado + px-3 (8px de cada lado na print-area)
    expect(rigidWidthOnPage(705, 733, 714)).toBe(724);
  });

  it('o recuo aperta o teto do crescimento — era ele que autorizava demais', () => {
    const solta = growCeilingFor([rigidWidthOnPage(705, 733, 733)]);
    const noCard = growCeilingFor([rigidWidthOnPage(705, 733, 714)]);
    expect(noCard).toBeLessThan(solta);
    expect(noCard).toBeGreaterThan(1);
  });

  it('declaração ausente ou inválida não vira teto', () => {
    expect(rigidWidthOnPage(NaN, 733, 714)).toBe(0);
    expect(rigidWidthOnPage(0, 733, 714)).toBe(0);
    expect(rigidWidthOnPage(-5, 733, 714)).toBe(0);
  });

  it('nó mais LARGO que o bloco não desconta nada (recuo nunca é negativo)', () => {
    expect(rigidWidthOnPage(705, 700, 733)).toBe(705);
  });
});
