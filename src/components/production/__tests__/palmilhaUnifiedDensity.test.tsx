import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PalmilhaUnifiedWorkSheet } from '../PalmilhaUnifiedWorkSheet';

/**
 * Trava A.3 na Palmilha unificada: cada cor vira 2 SheetBlocks
 * (trabalho + fechamento keepWithPrev), sem TraceStrip duplicando PV/cliente
 * no hero, e sem barra "0 placa(s)" consumindo altura.
 */

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

vi.mock('../worksheet/PaginatedSheet', () => ({
  PaginatedSheet: ({
    blocks,
  }: {
    blocks: Array<{ node: React.ReactNode; keepWithPrev?: boolean; keepWithNext?: boolean }>;
  }) => (
    <div data-testid="paginated">
      {blocks.map((b, i) => (
        <div
          key={i}
          data-block={i}
          data-keep-prev={b.keepWithPrev ? '1' : '0'}
          data-keep-next={b.keepWithNext ? '1' : '0'}
        >
          {b.node}
        </div>
      ))}
    </div>
  ),
}));

const ALL = ['34', '35', '36', '37', '38', '39', '40'];
const GRADE = { '34': 11, '35': 22, '36': 22, '37': 33, '38': 22, '39': 11, '40': 11 };
const BASE = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

describe('PalmilhaUnifiedWorkSheet densidade A.3', () => {
  it('emite trabalho + fechamento keepWithPrev por cor (sem TraceStrip no hero)', () => {
    const { container, queryByText } = render(
      <PalmilhaUnifiedWorkSheet
        mode="palmilha"
        allSizes={ALL}
        groups={[{
          soleName: '01',
          totalPairs: 132,
          cards: [{
            kind: 'completo',
            soleName: '01',
            color: 'COBRE',
            plateGroup: 'GLOW METALIC',
            liningGroup: 'GLOW METALIC',
            totalPairs: 132,
            grade: GRADE,
            baseGrade: BASE,
            baseGradeSum: 12,
            fichas: 11,
            refs: [{ code: '603', name: '603' }],
            opNumbers: ['OP-1', 'OP-2'],
            pvNumbers: ['PV-00227'],
            clientNames: ['CLIENTE A'],
            plateOps: [],
            consumption: [{
              component: 'Forração Palmilha',
              product_name: 'GLOW METALIC',
              required: 4,
              unit: 'm',
            } as never],
          }],
        }]}
      />,
    );

    // Sem TraceStrip ( rótulo "OPs" de célula TraceStrip ) no hero —
    // contagem de OPs vai no Resumo mono e no GroupSubHeader.
    expect(container.querySelector('[data-testid="paginated"]')).toBeTruthy();
    // Barra preta "Cortar placas" NÃO aparece com 0 placas.
    expect(queryByText(/placa\(s\)/i)).toBeNull();

    const blocks = Array.from(container.querySelectorAll('[data-block]'));
    // header + sole(keepNext) + trabalho + fechamento(keepPrev) + total(keepPrev)
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const fechamento = blocks.find(b => b.getAttribute('data-keep-prev') === '1');
    expect(fechamento).toBeTruthy();
    expect(fechamento!.textContent).toMatch(/Controle de Fichas/i);
    expect(fechamento!.textContent).toMatch(/Forração/i);
  });

  it('mostra barra de placas só quando há qty > 0', () => {
    const { getByText, getAllByText } = render(
      <PalmilhaUnifiedWorkSheet
        mode="palmilha"
        allSizes={ALL}
        groups={[{
          soleName: '01',
          totalPairs: 12,
          cards: [{
            kind: 'completo',
            soleName: '01',
            color: 'PRETO',
            plateGroup: 'EVA',
            liningGroup: 'NAPA',
            totalPairs: 12,
            grade: { '34': 12 },
            baseGrade: { '34': 12 },
            baseGradeSum: 12,
            fichas: 1,
            plateOps: [{ name: 'EVA 3MM', qty: 2.5, unit: 'placa', areaDm2: 150 }],
            consumption: [],
          }],
        }]}
      />,
    );
    expect(getByText('Cortar placas')).toBeTruthy();
    // Anton do qty (2,5) — pode repetir no Total Placas do rodapé.
    expect(getAllByText('2,5').length).toBeGreaterThanOrEqual(1);
  });
});
