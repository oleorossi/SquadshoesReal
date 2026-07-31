import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { collectCompactThumbs, compactThumbPx, SilkMontageWorkSheet, type SilkColorGroup, type SoleSilkGroup } from '../SilkMontageWorkSheet';

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

describe('SilkMontageWorkSheet · faixa de fotos no Corte Forração', () => {
  const group = (cg: SilkColorGroup): SoleSilkGroup => ({
    soleName: 'SOLADO 01',
    colorGroups: [cg],
    totalPairs: cg.totalPairs,
    groupKind: 'sole',
  });

  it('renderiza 1 <img> por referência da cor', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'SUELI', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'THASSIA', variantImageUrl: IMG_B },
        { sheetId: 'c', refName: 'MALU', variantImageUrl: IMG_C },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    const imgs = Array.from(container.querySelectorAll('img'))
      .filter(i => /ref-[abc]\.jpg/.test(i.getAttribute('src') || ''));
    expect(imgs).toHaveLength(3);
    // legenda (nome da ref) aparece quando há >1 foto
    expect(container.textContent).toContain('SUELI');
    expect(container.textContent).toContain('THASSIA');
    expect(container.textContent).toContain('MALU');
  });

  it('encolhe a miniatura para 52px quando o card agrupa 3 modelos', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'NL01', variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'NL02', variantImageUrl: IMG_B },
        { sheetId: 'c', refName: 'NL03', variantImageUrl: IMG_C },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    const imgs = Array.from(container.querySelectorAll('img'))
      .filter(i => /ref-[abc]\.jpg/.test(i.getAttribute('src') || ''));
    expect(imgs).toHaveLength(3);
    for (const img of imgs) expect(img.getAttribute('width')).toBe('52');
  });

  it('mantém 92px quando há um modelo só', () => {
    const cg = baseCg({ refImages: [{ sheetId: 'a', refName: 'NL01', variantImageUrl: IMG_A }] });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    const img = container.querySelector('img[src*="ref-a.jpg"]');
    expect(img?.getAttribute('width')).toBe('92');
  });

  it('mostra os dois códigos quando duas refs dividem a mesma foto', () => {
    const cg = baseCg({
      refImages: [
        { sheetId: 'a', refName: 'NL01', fichas: 3, variantImageUrl: IMG_A },
        { sheetId: 'b', refName: 'NL02', fichas: 5, variantImageUrl: IMG_A },
      ],
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[group(cg)]} sectorLabel="Corte Forração" />,
    );
    // uma foto só...
    expect(
      Array.from(container.querySelectorAll('img')).filter(i => /ref-a\.jpg/.test(i.getAttribute('src') || '')),
    ).toHaveLength(1);
    // ...mas as DUAS referências identificadas, e as fichas somadas
    expect(container.textContent).toContain('NL01 · NL02');
    expect(container.textContent).toContain('8');
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
