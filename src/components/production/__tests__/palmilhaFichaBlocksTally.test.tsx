import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PalmilhaUnifiedWorkSheet } from '../PalmilhaUnifiedWorkSheet';

beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  g.matchMedia ??= (query: string) => ({
    matches: false, media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  });
});

vi.mock('@/components/production/worksheet/PaginatedSheet', () => ({
  PaginatedSheet: ({
    blocks,
  }: {
    blocks: Array<{ node: React.ReactNode; keepWithPrev?: boolean }>;
  }) => (
    <div data-testid="paginated">
      {blocks.map((b, i) => (
        <div key={i} data-block={i} data-keep-prev={b.keepWithPrev ? '1' : '0'}>
          {b.node}
        </div>
      ))}
    </div>
  ),
}));

const ALL = ['34', '35', '36', '37', '38', '39', '40'];
/** Curva de 12 pares (1-1-2-3-2-2-1) — a mesma do PV-00255 / SP143. */
const BASE = { '34': 1, '35': 1, '36': 2, '37': 3, '38': 2, '39': 2, '40': 1 };

function gradeTimes(fichas: number): Record<string, number> {
  return Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, v * fichas]));
}

function renderSheet(fichas: number, mixed = false) {
  return render(
    <PalmilhaUnifiedWorkSheet
      mode="so_forracao"
      allSizes={ALL}
      groups={[{
        soleName: 'SOLADO 01',
        totalPairs: fichas * 12,
        cards: [{
          kind: 'so_forracao',
          soleName: 'SOLADO 01',
          color: 'OFF WHITE',
          plateGroup: 'PLACA 1.0 EVA 3.0',
          liningGroup: 'NAPA SOFT',
          totalPairs: fichas * 12,
          grade: gradeTimes(fichas),
          baseGrade: BASE,
          baseGradeSum: 12,
          fichas,
          mixedGrades: mixed,
          refs: [{ code: 'SP143', name: 'SP143' }],
          opNumbers: ['OP-2026-06203'],
          pvNumbers: ['PV-00255'],
          clientNames: ['LNG 10 CONFECCOES LTDA'],
          plateOps: [],
          consumption: [],
        }],
      }]}
    />,
  );
}

describe('Controle de Fichas por bloco (Corte Forração / placa de fibra)', () => {
  it('100 fichas viram 5 blocos de 20 quadradinhos — sem repetir o total da OP', () => {
    const { container } = renderSheet(100);
    expect(container.querySelectorAll('[data-ficha-block]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(100);
    expect(
      Array.from(container.querySelectorAll('[data-ficha-block]'))
        .map(el => Number(el.getAttribute('data-ficha-block-count'))),
    ).toEqual([20, 20, 20, 20, 20]);
    expect(container.textContent).toMatch(/100 fichas · 5 blocos · 1200 pares/);
    expect(container.textContent).toContain('Controle · bloco 1');
    expect(container.textContent).toContain('Controle · bloco 5');
    // Todos os quadrados vivem dentro dos blocos — sem um tally avulso com as 100 fichas.
    expect(container.querySelectorAll('[data-ficha-blocks] [data-tally-box]')).toHaveLength(100);
  });

  it('75 fichas fecham 20+20+20+completar 15, cada bloco com os próprios quadradinhos', () => {
    const { container } = renderSheet(75);
    expect(
      Array.from(container.querySelectorAll('[data-ficha-block]'))
        .map(el => Number(el.getAttribute('data-ficha-block-count'))),
    ).toEqual([20, 20, 20, 15]);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(75);
    expect(container.textContent).toMatch(/Bloco 4 · completar/);
    expect(container.textContent).toMatch(/Controle · completar \(15\)/);
    expect(container.querySelector('[data-ficha-block="4"]')?.textContent).toMatch(/15 fichas · 180 pares/);
  });

  it('grade mista não inventa blocos e mantém o tally único com o total', () => {
    const { container } = renderSheet(50, true);
    expect(container.querySelector('[data-ficha-blocks]')).toBeNull();
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(50);
    expect(container.textContent).toMatch(/Controle de Fichas/);
  });
});
