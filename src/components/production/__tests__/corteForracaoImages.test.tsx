import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { collectCompactThumbs, SilkMontageWorkSheet, type SilkColorGroup, type SoleSilkGroup } from '../SilkMontageWorkSheet';

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
