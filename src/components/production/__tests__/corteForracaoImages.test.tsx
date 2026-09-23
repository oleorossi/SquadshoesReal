import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { collectCompactThumbs, compactThumbPx, SilkMontageWorkSheet, type SilkColorGroup, type SoleSilkGroup } from '../SilkMontageWorkSheet';
import { CartaoLote, cartaoThumbMm } from '../CartaoLote';

// PaginatedSheet observa cada bloco com ResizeObserver — inexistente no jsdom.
beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/**
 * Faixa de fotos do Corte Forração (2026-07-22): 1 miniatura por REFERÊNCIA da
 * cor. Cobre o pedido do dono "mais de uma referência da mesma cor → todas as
 * imagens", mais os invariantes: dedup por foto, placeholder descartado e
 * fallback pros campos escalares quando refImages não foi coletado.
 */

const IMG_A = 'https://cdn.example.com/ref-a.jpg';
const IMG_B = 'https://cdn.example.com/ref-b.jpg';
const IMG_C = 'https://cdn.example.com/ref-c.jpg';

const baseCg = (over: Partial<SilkColorGroup>): SilkColorGroup => ({
  color: 'OFF WHITE',
  combinedGrid: { '35': 12, '36': 12 },
  totalPairs: 24,
  opNumbers: ['1'],
  refs: [],
  ...over,
});

describe('collectCompactThumbs', () => {
  it('retorna 1 miniatura por referência distinta, na ordem', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'SUELI', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'THASSIA', variantImageUrl: IMG_B },
        { sheetId: 'c', refName: 'MALU', variantImageUrl: IMG_C },
      ],
    });
    const thumbs = collectCompactThumbs(cg);
    expect(thumbs.map(t => t.resolvedUrl)).toEqual([IMG_A, IMG_B, IMG_C]);
    expect(thumbs.map(t => t.refName)).toEqual(['SUELI', 'THASSIA', 'MALU']);
  });

  it('deduplica referências que caem na MESMA foto', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'SUELI', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'CLONE', variantImageUrl: IMG_A },
      ],
    });
    expect(collectCompactThumbs(cg)).toHaveLength(1);
  });

  // Regressão 31/07/2026: a foto duplicada some, mas o NOME da segunda ref não
  // pode sumir junto — senão o card cobre 2 modelos sem dizer.
  it('preserva o nome das DUAS refs quando a foto é a mesma', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'SUELI',  pairs: 36, fichas: 3, variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'CLONE',  pairs: 60, fichas: 5, variantImageUrl: IMG_A },
      ],
    });
    const thumbs = collectCompactThumbs(cg);
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0].refNames).toEqual(['SUELI', 'CLONE']);
    // pares e fichas somam na miniatura sobrevivente
    expect(thumbs[0].pairs).toBe(96);
    expect(thumbs[0].fichas).toBe(8);
  });

  it('cai no refCode quando a ref não tem nome', () => {
    const cg = baseCg({
      refImages: [{ sheetId: 'a', refCode: 'NL04', variantImageUrl: IMG_A }],
    });
    expect(collectCompactThumbs(cg)[0].refNames).toEqual(['NL04']);
  });

  it('descarta refs sem foto (resolvem placeholder)', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'SEM FOTO', variantImageUrl: null, alternateVariants: [], technicalSheetImageUrl: null },
      ],
    });
    expect(collectCompactThumbs(cg)).toHaveLength(0);
  });

  it('cai nos campos escalares quando refImages está ausente', () => {
    const cg = baseCg({ variantImageUrl: IMG_A });
    const thumbs = collectCompactThumbs(cg);
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0].resolvedUrl).toBe(IMG_A);
  });
});

/**
 * Opção A (decisão do dono 31/07/2026): a miniatura encolhe conforme o nº de
 * modelos, pra 3 fotos caberem lado a lado sem engordar o card — a folha
 * continua levando 12. O piso de 52px é o limite de conferência visual.
 */
describe('compactThumbPx', () => {
  it('mantém 92px com uma referência só', () => {
    expect(compactThumbPx(0)).toBe(92);
    expect(compactThumbPx(1)).toBe(92);
  });

  it('encolhe para 68px com duas e 52px de três em diante', () => {
    expect(compactThumbPx(2)).toBe(68);
    expect(compactThumbPx(3)).toBe(52);
    expect(compactThumbPx(7)).toBe(52);
  });

  it('nunca desce abaixo do piso de 52px', () => {
    for (let n = 1; n <= 24; n++) expect(compactThumbPx(n)).toBeGreaterThanOrEqual(52);
  });

  it('é monotônica — mais modelos nunca aumenta a foto', () => {
    for (let n = 1; n < 24; n++) {
      expect(compactThumbPx(n + 1)).toBeLessThanOrEqual(compactThumbPx(n));
    }
  });
});

describe('SilkMontageWorkSheet · Corte Forração sem foto + refs em destaque', () => {
  const group = (cg: SilkColorGroup): SoleSilkGroup => ({
    soleName: 'SOLADO 01',
    colorGroups: [cg],
    totalPairs: cg.totalPairs,
    groupKind: 'sole',
  });

  const productImgs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('img'))
      .filter(i => /ref-[abc]\.jpg/.test(i.getAttribute('src') || ''));

  it('NÃO renderiza foto do produto (mesmo com refImages)', () => {
    const cg = baseCg({
      refs: [
        { code: 'SUELI', name: 'SUELI' },
        { code: 'THASSIA', name: 'THASSIA' },
        { code: 'MALU', name: 'MALU' },
      ],
      refImages: [
        { sheetId: 'a', refName: 'SUELI', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'THASSIA', variantImageUrl: IMG_B },
        { sheetId: 'c', refName: 'MALU', variantImageUrl: IMG_C },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    expect(productImgs(container)).toHaveLength(0);
    expect(container.textContent).toContain('SUELI');
    expect(container.textContent).toContain('THASSIA');
    expect(container.textContent).toContain('MALU');
    expect(container.textContent).toContain('3 REFS');
  });

  it('chips de referência usam vermelho #C00000 (destaque sem foto)', () => {
    const cg = baseCg({
      refs: [{ code: 'LA01', name: 'LA01' }, { code: 'SP201', name: 'SP201' }],
      refImages: [
        { sheetId: 'a', refName: 'LA01', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'SP201', variantImageUrl: IMG_B },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    const chips = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.textContent === 'LA01' || s.textContent === 'SP201',
    );
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) {
      const st = (chip as HTMLElement).style;
      expect(st.backgroundColor.replace(/\s/g, '')).toMatch(/rgb\(192,\s*0,\s*0\)|#C00000/i);
      expect(st.color.replace(/\s/g, '')).toMatch(/rgb\(255,\s*255,\s*255\)|#fff/i);
      expect(st.fontSize).toBe('18px');
    }
  });

  it('ref única também sai em destaque (não chip preto miúdo)', () => {
    const cg = baseCg({
      refs: [{ code: '0593', name: '0593' }],
      refImages: [{ sheetId: 'a', refName: '0593', variantImageUrl: IMG_A }],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    expect(productImgs(container)).toHaveLength(0);
    const chip = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '0593');
    expect(chip).toBeTruthy();
    expect((chip as HTMLElement).style.backgroundColor.replace(/\s/g, '')).toMatch(/rgb\(192,\s*0,\s*0\)|#C00000/i);
  });

  it('Corte Cabedal: 1 foto + tally por referência quando a cor agrega 2 modelos', () => {
    const cg = baseCg({
      totalPairs: 360,
      fichas: 24,
      baseGradeSum: 15,
      refs: [{ code: 'LA01', name: 'LA01' }, { code: 'SP201', name: 'SP201' }],
      refImages: [
        { sheetId: 'la01', refName: 'LA01', pairs: 180, fichas: 12, variantImageUrl: IMG_A },
        { sheetId: 'sp201', refName: 'SP201', pairs: 180, fichas: 12, variantImageUrl: IMG_B },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Cabedal" groups={[group(cg)]} sectorLabel="Corte Cabedal" />,
    );
    const imgs = Array.from(container.querySelectorAll('img'))
      .filter(i => /ref-[ab]\.jpg/.test(i.getAttribute('src') || ''));
    expect(imgs).toHaveLength(2);
    expect(container.textContent).toContain('LA01');
    expect(container.textContent).toContain('SP201');
    // Dois controles de fichas — um por referência (não 1 bloco de 24).
    expect(container.textContent).toMatch(/Controle de Fichas · LA01/);
    expect(container.textContent).toMatch(/Controle de Fichas · SP201/);
  });

  it('NÃO mostra foto do produto no Silk (setor sem showCompactImages)', () => {
    const cg = baseCg({
      refImages: [{ sheetId: 'a', refName: 'SUELI', variantImageUrl: IMG_A }],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Silk" groups={[group(cg)]} sectorLabel="Silk" />,
    );
    const imgs = Array.from(container.querySelectorAll('img'))
      .filter(i => /ref-a\.jpg/.test(i.getAttribute('src') || ''));
    expect(imgs).toHaveLength(0);
  });
});

/**
 * CARTÃO DE LOTE — o artefato que a fábrica realmente imprime no Corte Forração.
 *
 * Regressão de 31/07/2026: o cartão do PV-00147 ("OFF WHITE · NAPA SUDANI",
 * 1.008 pares) junta DS20 + DS22 + S-039 e saía com UMA foto. A causa não estava
 * no motor nem na ficha — ambos corretos e já cobertos acima — mas no fato de o
 * CartaoLote aceitar só `imageUrl` escalar, derivado do spread da PRIMEIRA ref
 * fundida. Duas correções minhas anteriores erraram o alvo por isso; estes
 * testes existem pra que ninguém volte a olhar só pro lado da ficha.
 */
describe('CartaoLote · fotos por referência', () => {
  const baseProps = {
    sectorName: 'Corte Forração',
    title: 'OFF WHITE · NAPA SUDANI',
    sizes: ['34', '35'],
    grade: { '34': 12, '35': 12 },
    totalPairs: 24,
  };

  const imgsOf = (container: HTMLElement, re: RegExp) =>
    Array.from(container.querySelectorAll('img')).filter(i => re.test(i.getAttribute('src') || ''));

  it('renderiza uma foto por referência quando o cartão junta 3 modelos', () => {
    const { container } = render(
      <CartaoLote
        {...baseProps}
        images={[
          { url: IMG_A, refLabel: 'DS20', fichas: 24 },
          { url: IMG_B, refLabel: 'DS22', fichas: 24 },
          { url: IMG_C, refLabel: 'S-039', fichas: 36 },
        ]}
      />,
    );
    expect(imgsOf(container, /ref-[abc]\.jpg/)).toHaveLength(3);
    // o cortador precisa saber de quem é cada foto E quanto cortar de cada uma
    expect(container.textContent).toContain('DS20');
    expect(container.textContent).toContain('DS22');
    expect(container.textContent).toContain('S-039');
    expect(container.textContent).toContain('36');
  });

  it('mantém o imageUrl escalar quando não há fotos por referência', () => {
    const { container } = render(<CartaoLote {...baseProps} imageUrl={IMG_A} />);
    expect(imgsOf(container, /ref-a\.jpg/)).toHaveLength(1);
  });

  it('ignora images vazio e cai no imageUrl (retrocompat dos outros setores)', () => {
    const { container } = render(<CartaoLote {...baseProps} imageUrl={IMG_A} images={[]} />);
    expect(imgsOf(container, /ref-a\.jpg/)).toHaveLength(1);
  });

  it('não rotula quando há um modelo só — o total do cartão já é dele', () => {
    const { container } = render(
      <CartaoLote {...baseProps} images={[{ url: IMG_A, refLabel: 'DS20', fichas: 24 }]} />,
    );
    expect(imgsOf(container, /ref-a\.jpg/)).toHaveLength(1);
    expect(container.textContent).not.toContain('DS20');
  });

  it('duas refs na MESMA foto: uma miniatura, os dois códigos (via collectCompactThumbs)', () => {
    const thumbs = collectCompactThumbs(baseCg({
      refImages: [
        { sheetId: 'a', refName: 'DS20', fichas: 24, variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'DS22', fichas: 24, variantImageUrl: IMG_A },
      ],
    }));
    const { container } = render(
      <CartaoLote
        {...baseProps}
        images={thumbs.map(t => ({ url: t.resolvedUrl, refLabel: t.refNames.join(' · '), fichas: t.fichas, refCount: t.refNames.length }))}
      />,
    );
    expect(imgsOf(container, /ref-a\.jpg/)).toHaveLength(1);
    expect(container.textContent).toContain('DS20 · DS22');
    expect(container.textContent).toContain('48'); // fichas somadas
  });
});

describe('cartaoThumbMm', () => {
  it('9mm com um modelo, encolhendo até o piso de 7mm', () => {
    expect(cartaoThumbMm(1)).toBe(9);
    expect(cartaoThumbMm(2)).toBe(8);
    expect(cartaoThumbMm(3)).toBe(7);
  });

  it('nunca fura o piso nem cresce com mais modelos', () => {
    for (let n = 1; n <= 24; n++) expect(cartaoThumbMm(n)).toBeGreaterThanOrEqual(7);
    for (let n = 1; n < 24; n++) expect(cartaoThumbMm(n + 1)).toBeLessThanOrEqual(cartaoThumbMm(n));
  });
});
