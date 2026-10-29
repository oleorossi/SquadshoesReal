import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import {
  PrintContinuityProvider,
  SectorJoinCutLine,
  leadingPackSucceeded,
  computePackedContentPxInflated,
} from '../printContinuity';
import { ReversePrintContext } from '../printOrder';
import { PaginatedSheet } from '../PaginatedSheet';
import { PAGE_CAPACITY_PX, PRINT_INFLATE, BLOCK_GAP_PX } from '../pageGeometry';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: vi.fn((node: React.ReactNode, mount: Element) =>
      actual.createPortal(node, mount),
    ),
  };
});

describe('leadingPackSucceeded', () => {
  it('aceita quando o 1º bloco cabe na sobra (leading usado de verdade)', () => {
    const heights = [200, 200];
    const leading = PAGE_CAPACITY_PX * 0.5;
    const content = computePackedContentPxInflated([0], heights, 1, BLOCK_GAP_PX, PRINT_INFLATE);
    expect(content + leading).toBeLessThanOrEqual(PAGE_CAPACITY_PX + 0.5);
    expect(leadingPackSucceeded([0], heights, 1, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE, leading)).toBe(true);
  });

  it('recusa quando o conteúdo da 1ª página + leading estoura a capacidade (leading abandonado)', () => {
    const heights = [PAGE_CAPACITY_PX * 0.9];
    const leading = PAGE_CAPACITY_PX * 0.4;
    expect(
      leadingPackSucceeded([0], heights, 1, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE, leading),
    ).toBe(false);
  });

  it('recusa com leading 0, flow ou página vazia', () => {
    expect(leadingPackSucceeded([0], [100], 1, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE, 0)).toBe(false);
    expect(leadingPackSucceeded([0], [100], 1, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE, 200, true)).toBe(false);
    expect(leadingPackSucceeded([], [100], 1, PAGE_CAPACITY_PX, BLOCK_GAP_PX, PRINT_INFLATE, 200)).toBe(false);
  });
});

describe('PaginatedSheet — reverse × portal de continuidade', () => {
  beforeEach(() => {
    vi.mocked(createPortal).mockClear();
    // PaginatedSheet mede via getBoundingClientRect — stub estável.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rigid = this.getAttribute?.('data-rigid-width');
      const h = Number(this.getAttribute?.('data-test-h') || 120);
      const w = rigid ? Number(rigid) : 700;
      return {
        x: 0, y: 0, top: 0, left: 0, bottom: h, right: w,
        width: w, height: h, toJSON() { return {}; },
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Block({ h = 120 }: { h?: number }) {
    return (
      <div data-test-h={h} style={{ height: h }}>
        bloco
      </div>
    );
  }

  it('com ReversePrintContext=true NÃO chama createPortal (portal desligado)', async () => {
    const { container } = render(
      <ReversePrintContext.Provider value={true}>
        <PrintContinuityProvider>
          <PaginatedSheet
            sectorLabel="Corte Forração"
            blocks={[<Block key="a" h={400} />, <Block key="b" h={100} />]}
          />
          <PaginatedSheet
            sectorLabel="Aviamento"
            blocks={[<Block key="c" h={200} />]}
          />
        </PrintContinuityProvider>
      </ReversePrintContext.Provider>,
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(vi.mocked(createPortal)).not.toHaveBeenCalled();
    // Maço seguinte sob reverse carrega forcePageBreak na linha de corte.
    const cuts = container.querySelectorAll('.sector-join-cut');
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    const forced = Array.from(cuts).some(el => (el as HTMLElement).style.breakBefore === 'page');
    expect(forced).toBe(true);
    expect(container.querySelector('.pagi-sheet--reversed')).toBeTruthy();
  });

  it('com reverse OFF e sobra suficiente, SectorJoinCutLine in-flow NÃO força break-before', () => {
    const { container } = render(<SectorJoinCutLine />);
    const el = container.querySelector('.sector-join-cut') as HTMLElement;
    expect(el.style.breakBefore).toBe('');
    expect(el.textContent).toMatch(/CORTAR AQUI/);
  });
});
