import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SilkMontageWorkSheet, type SoleSilkGroup } from '../SilkMontageWorkSheet';
import { AVIAMENTO_HERO_PHOTO_PX, CABEDAL_BESIDE_PHOTO_PX, HEADER_THUMB_PX } from '../worksheet/density';
import { aviamentoGroupKey } from '../worksheet/aviamentoHeroPhoto';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const PHOTO = 'https://cdn.example/produto.jpg';

const aviamentoGroup: SoleSilkGroup = {
  soleName: 'G01',
  groupKind: 'reference',
  totalPairs: 24,
  colorGroups: [
    {
      color: 'DÁLIA',
      combinedGrid: { '35': 4, '36': 4, '37': 4 },
      baseGrid: { '35': 2, '36': 2, '37': 2 },
      baseGradeSum: 12,
      fichas: 2,
      mixedGrades: false,
      totalPairs: 24,
      opNumbers: ['00999'],
      pvNumbers: ['PV-00227'],
      variantImageUrl: PHOTO,
      alternateVariants: [],
      technicalSheetImageUrl: null,
      refImages: [{ sheetId: 'sheet-g01', variantImageUrl: PHOTO }],
    },
  ],
};

describe('SilkMontageWorkSheet · Aviamento · foto grande por referência', () => {
  it('sem key no Set: foto 140px ao lado da grade, sem bloco hero empilhado', () => {
    const { container } = render(
      <SilkMontageWorkSheet
        sector="Aviamento"
        groups={[aviamentoGroup]}
      />,
    );
    expect(container.querySelector('[data-aviamento-hero-photo]')).toBeNull();
    expect(container.querySelector('[data-cabedal-photo-beside]')).toBeTruthy();
    const imgs = container.querySelectorAll('img');
    const beside = Array.from(imgs).find((img) => {
      const box = img.closest('div');
      return box && box.getAttribute('style')?.includes(`width: ${CABEDAL_BESIDE_PHOTO_PX}px`);
    });
    expect(beside).toBeTruthy();
    const thumbs46 = Array.from(container.querySelectorAll('div')).filter((el) =>
      (el.getAttribute('style') || '').includes(`width: ${HEADER_THUMB_PX}px`)
      && (el.getAttribute('style') || '').includes(`height: ${HEADER_THUMB_PX}px`),
    );
    expect(thumbs46.length).toBe(0);
  });

  it('com key no Set: foto 140px ao lado da grade marcada como hero, sem thumb 46px', () => {
    const key = aviamentoGroupKey(aviamentoGroup);
    const { container } = render(
      <SilkMontageWorkSheet
        sector="Aviamento"
        groups={[aviamentoGroup]}
        heroPhotoGroupKeys={new Set([key])}
      />,
    );
    const hero = container.querySelector(`[data-aviamento-hero-photo="${key}"]`);
    expect(hero).toBeTruthy();
    const heroBox = hero?.querySelector('div');
    expect(heroBox?.getAttribute('style') || '').toContain(`width: ${AVIAMENTO_HERO_PHOTO_PX}px`);

    const thumbs46 = Array.from(container.querySelectorAll('div')).filter((el) =>
      (el.getAttribute('style') || '').includes(`width: ${HEADER_THUMB_PX}px`)
      && (el.getAttribute('style') || '').includes(`height: ${HEADER_THUMB_PX}px`),
    );
    expect(thumbs46.length).toBe(0);
  });
});
