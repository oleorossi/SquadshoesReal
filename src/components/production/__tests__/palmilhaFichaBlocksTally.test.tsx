import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PalmilhaUnifiedWorkSheet } from '../PalmilhaUnifiedWorkSheet';
import type { PalmilhaPrintMode } from '@/lib/palmilhaUnifiedCard';
import type { PalmilhaCardKind } from '@/lib/palmilhaUnifiedCard';

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

function boxNumbers(el: Element): number[] {
  return Array.from(el.querySelectorAll('[data-tally-box]')).map(
    box => Number((box as HTMLElement).textContent),
  );
}

function renderSheet(fichas: number, opts?: { mixed?: boolean; mode?: PalmilhaPrintMode }) {
  const mode: PalmilhaPrintMode = opts?.mode ?? 'palmilha';
  const kind: PalmilhaCardKind = mode === 'so_forracao'
    ? 'so_forracao'
    : mode === 'so_fibra'
      ? 'so_fibra'
      : 'completo';
  return render(
    <PalmilhaUnifiedWorkSheet
      mode={mode}
      allSizes={ALL}
      groups={[{
        soleName: 'SOLADO 01',
        totalPairs: fichas * 12,
        cards: [{
          kind,
          soleName: 'SOLADO 01',
          color: 'OFF WHITE',
          plateGroup: 'PLACA 1.0 EVA 3.0',
          liningGroup: 'NAPA SOFT',
          totalPairs: fichas * 12,
          grade: gradeTimes(fichas),
          baseGrade: BASE,
          baseGradeSum: 12,
          fichas,
          mixedGrades: opts?.mixed,
          refs: [{ code: 'SP143', name: 'SP143' }],
          opNumbers: ['OP-2026-06203'],
          pvNumbers: ['PV-00255'],
          clientNames: ['LNG 10 CONFECCOES LTDA'],
          plateOps: kind === 'so_forracao' ? [] : [{ name: 'PLACA 1.0 EVA 3.0', qty: 33.3, unit: 'placa', areaDm2: 150 }],
          consumption: [],
        }],
      }]}
    />,
  );
}

describe('Controle de Fichas por bloco (Forração + Fibra)', () => {
  it('100 fichas viram 5 blocos, cada um com Forração e Fibra 1–20…81–100 — sem repetir o total da OP', () => {
    const { container } = renderSheet(100);
    expect(container.querySelectorAll('[data-ficha-block]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(200);
    expect(
      Array.from(container.querySelectorAll('[data-ficha-block]'))
        .map(el => Number(el.getAttribute('data-ficha-block-start'))),
    ).toEqual([1, 21, 41, 61, 81]);
    expect(container.textContent).toMatch(/100 fichas · 5 blocos · 1200 pares · forração \+ fibra/);
    expect(container.querySelectorAll('[data-palmilha-layer-band="forracao"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-palmilha-layer-band="fibra"]')).toHaveLength(5);

    const block2 = container.querySelector('[data-ficha-block="2"]')!;
    expect(boxNumbers(block2.querySelector('[data-palmilha-layer-band="forracao"]')!)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 21),
    );
    expect(boxNumbers(block2.querySelector('[data-palmilha-layer-band="fibra"]')!)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 21),
    );
    expect(container.querySelector('[data-ficha-block="5"]')?.textContent).toMatch(/← 100/);
  });

  it('75 fichas fecham 20+20+20+completar 15, com numeração contínua até 75 nas duas camadas', () => {
    const { container } = renderSheet(75);
    expect(
      Array.from(container.querySelectorAll('[data-ficha-block]'))
        .map(el => Number(el.getAttribute('data-ficha-block-start'))),
    ).toEqual([1, 21, 41, 61]);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(150);
    const last = container.querySelector('[data-ficha-block="4"]')!;
    expect(last.textContent).toMatch(/Bloco 4 · completar/);
    expect(boxNumbers(last.querySelector('[data-palmilha-layer-band="forracao"]')!)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 61),
    );
    expect(boxNumbers(last.querySelector('[data-palmilha-layer-band="fibra"]')!)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 61),
    );
  });

  it('modo Só Forração mostra só a grade de Forração (100 caixinhas, 1–20…81–100)', () => {
    const { container } = renderSheet(100, { mode: 'so_forracao' });
    expect(container.querySelectorAll('[data-palmilha-layer-band="forracao"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-palmilha-layer-band="fibra"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(100);
    expect(boxNumbers(container.querySelector('[data-ficha-block="2"]')!)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 21),
    );
  });

  it('o cabeçalho e o selo da Fibra usam azul-escuro com print-color-adjust exact', () => {
    const { container } = renderSheet(20, { mode: 'so_fibra' });
    const badge = container.querySelector('[data-palmilha-layer-badge="fibra"]') as HTMLElement;
    const header = container.querySelector('[data-palmilha-layer-band="fibra"] > div') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(header).toBeTruthy();
    expect(badge.style.background).toBe('rgb(30, 58, 138)');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');
    expect(header.style.background).toBe('rgb(30, 58, 138)');
    expect(header.style.color).toBe('rgb(255, 255, 255)');
    expect(header.style.printColorAdjust).toBe('exact');
    expect(badge.style.printColorAdjust).toBe('exact');
  });

  it('modo Só Fibra mostra só a grade de Fibra', () => {
    const { container } = renderSheet(100, { mode: 'so_fibra' });
    expect(container.querySelectorAll('[data-palmilha-layer-band="fibra"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-palmilha-layer-band="forracao"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tally-box]')).toHaveLength(100);
  });

  it('grade mista não inventa blocos e mantém duas grades independentes com o total', () => {
    const { container } = renderSheet(50, { mixed: true });
    expect(container.querySelector('[data-ficha-blocks]')).toBeNull();
    expect(container.querySelectorAll('[data-palmilha-layer-band="forracao"] [data-tally-box]')).toHaveLength(50);
    expect(container.querySelectorAll('[data-palmilha-layer-band="fibra"] [data-tally-box]')).toHaveLength(50);
  });
});
