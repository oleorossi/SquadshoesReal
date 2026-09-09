import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { SilkMontageWorkSheet, type SoleSilkGroup } from '../../SilkMontageWorkSheet';

/**
 * Renderiza a ficha do CORTE FORRAÇÃO com a folha 1 real do maço do PV-00167
 * (solado 01 · OFF WHITE · 1728 pares · grade 34–40 · 144 fichas de 12) e trava
 * o arranjo de 2026-08-29: a miniatura passa a sentar AO LADO da grade.
 *
 * O que este teste cobre e os unitários de `gradeWidth.test.ts` não: que a
 * ficha RENDERIZA nesse arranjo — foto e tabela como irmãs dentro da MESMA
 * linha —, e que numa grade densa ela volta a empilhar sozinha. jsdom não faz
 * layout (toda altura é 0), então o que dá para afirmar aqui é a ESTRUTURA;
 * a largura é assunto dos unitários.
 */

beforeAll(() => {
  // Mesmos stubs do silkMontageDensity: o PaginatedSheet re-mede com
  // ResizeObserver/matchMedia, que o jsdom não implementa.
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

/** Grade mista infantil+adulto (18 numerações) — o caso denso da base. */
const GRADE_DENSA: Record<string, number> = {};
for (let n = 23; n <= 40; n++) GRADE_DENSA[String(n)] = 1152;

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

/** A linha "foto + grade" é a única que declara largura rígida no card. */
const sideBySideRow = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-rigid-width]'))
    .find(el => el.querySelector('table') && el.querySelector('img, svg'));

describe('Corte Forração — foto ao lado da grade', () => {
  it('PV-00167: a miniatura e a grade ficam na MESMA linha', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    const row = sideBySideRow(container);
    expect(row).toBeTruthy();
    // A tabela da grade e a foto são irmãs dentro da linha, não empilhadas.
    expect(row!.querySelectorAll('table').length).toBeGreaterThan(0);
    expect(row!.querySelector('img, svg')).toBeTruthy();
  });

  it('a linha declara a largura que exige, para o auto-fit não espremer a grade', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_PV167, 1)]} />,
    );
    const declared = Number(sideBySideRow(container)!.dataset.rigidWidth);
    expect(declared).toBeGreaterThan(0);
    // 92px de foto + o mínimo da grade, dentro dos 733px úteis da A4.
    expect(declared).toBeGreaterThan(92);
    expect(declared).toBeLessThan(733);
  });

  it('grade densa com várias referências volta a EMPILHAR (a grade manda)', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[forracaoGroup(GRADE_DENSA, 3)]} />,
    );
    expect(sideBySideRow(container)).toBeUndefined();
    // E a ficha continua inteira: grade e fotos seguem no papel, só empilhadas.
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('img, svg').length).toBeGreaterThan(0);
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
    // A linha de 30 caixinhas é a mais exigente do card: ~700px dos 733 úteis.
    expect(Math.max(...declared)).toBeGreaterThan(650);
    expect(Math.max(...declared)).toBeLessThan(733);
  });
});
