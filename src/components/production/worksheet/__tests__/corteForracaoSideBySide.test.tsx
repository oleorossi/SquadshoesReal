import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { SilkMontageWorkSheet, type SoleSilkGroup } from '../../SilkMontageWorkSheet';

/**
 * Corte Forração (2026-09-23, dono): SEM foto do produto; referências da cor
 * em destaque. A grade e o consumo seguem no papel — só o arranjo
 * foto-ao-lado-da-grade saiu.
 */

beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
});

const GRADE_PV167 = { '34': 144, '35': 288, '36': 288, '37': 432, '38': 288, '39': 144, '40': 144 };
const BASE_PV167 = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

function forracaoGroup(grid: Record<string, number>, refCount: number): SoleSilkGroup {
  const refImages = Array.from({ length: refCount }, (_, i) => ({
    sheetId: `sheet-${i}`,
    refCode: `NL0${i + 1}`,
    refName: `NL0${i + 1}`,
    variantImageUrl: `https://example.invalid/nl0${i + 1}.png`,
    alternateVariants: [],
    technicalSheetImageUrl: null,
    fichas: 144,
  }));
  const totalPairs = Object.values(grid).reduce((s, v) => s + v, 0);
  return {
    soleName: '01',
    totalPairs,
    sizeBand: 'adulto',
    clientNames: ['LNG 10 CONFECCOES LTDA'],
    colorGroups: [{
      color: 'OFF WHITE',
      colorHex: '#F1EDE2',
      liningMaterial: 'NAPA SOFT',
      combinedGrid: grid,
      baseGrid: grid === GRADE_PV167 ? BASE_PV167 : undefined,
      baseGradeSum: grid === GRADE_PV167 ? 12 : undefined,
      fichas: 144,
      totalPairs,
      opNumbers: ['OP-2026-03830', 'OP-2026-03829', 'OP-2026-03828'],
      pvNumbers: ['PV-00167'],
      refs: refImages.map(r => ({ code: r.refCode, name: r.refName })),
      refImages,
      requiresLiningCut: true,
    }],
  } as SoleSilkGroup;
}

const productImgs = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('img')).filter((i) => /nl0\d+\.png/.test(i.getAttribute('src') || ''));

describe('Corte Forração — sem foto, refs em destaque', () => {
  it('PV-00167: NÃO renderiza miniatura do produto', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    expect(productImgs(container)).toHaveLength(0);
    expect(container.querySelector('[data-rigid-width] img, [data-rigid-width] svg')).toBeNull();
  });

  it('mostra a referência em chip vermelho', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    const chip = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === 'NL01');
    expect(chip).toBeTruthy();
    expect((chip as HTMLElement).style.backgroundColor.replace(/\s/g, '')).toMatch(/rgb\(192,\s*0,\s*0\)|#C00000/i);
  });

  it('várias refs: chip N REFS + códigos, sem fotos', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 3)]} />,
    );
    expect(productImgs(container)).toHaveLength(0);
    expect(container.textContent).toContain('3 REFS');
    expect(container.textContent).toContain('NL01');
    expect(container.textContent).toContain('NL02');
    expect(container.textContent).toContain('NL03');
  });

  it('a ficha renderiza a grade e o consumo do PV-00167 sem perder conteúdo', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('OFF WHITE');
    expect(txt).toContain('NAPA SOFT');
    expect(txt).toContain('1728');
    expect(txt).toContain('432'); // total do nº 37
    expect(txt).toContain('Controle de Fichas');
  });

  it('o Controle de Fichas declara a largura rígida que trava o crescimento', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    const declared = Array.from(container.querySelectorAll<HTMLElement>('[data-rigid-width]'))
      .map(el => Number(el.dataset.rigidWidth));
    expect(Math.max(...declared)).toBeGreaterThan(650);
    expect(Math.max(...declared)).toBeLessThan(733);
  });
});
