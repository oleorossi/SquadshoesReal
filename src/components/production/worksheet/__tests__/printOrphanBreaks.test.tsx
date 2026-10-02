import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SectorJoinCutLine } from '../printContinuity';
import { SolagemWorkSheet } from '@/components/production/SolagemWorkSheet';
import type { ReportOrder, ReportSaleOrder } from '@/components/production/ManagementReport';

vi.mock('../PaginatedSheet', () => ({
  PaginatedSheet: ({
    blocks,
  }: {
    blocks: Array<React.ReactNode | { node: React.ReactNode; keepWithPrev?: boolean; keepWithNext?: boolean }>;
  }) => (
    <div data-testid="pagi">
      {blocks.map((b, i) => {
        const wrapped =
          typeof b === 'object' && b !== null && !React.isValidElement(b) && 'node' in (b as object);
        const node = (wrapped ? (b as { node: React.ReactNode }).node : b) as React.ReactNode;
        const keepPrev = wrapped ? !!(b as { keepWithPrev?: boolean }).keepWithPrev : false;
        const keepNext = wrapped ? !!(b as { keepWithNext?: boolean }).keepWithNext : false;
        return (
          <div
            key={i}
            data-block={i}
            data-keep-prev={keepPrev ? '1' : '0'}
            data-keep-next={keepNext ? '1' : '0'}
          >
            {node}
          </div>
        );
      })}
    </div>
  ),
}));

import { ManagementReport } from '@/components/production/ManagementReport';

describe('órfãos de quebra de página (print)', () => {
  it('SectorJoinCutLine forcePageBreak abre folha nova antes da linha de corte', () => {
    const { container } = render(<SectorJoinCutLine forcePageBreak />);
    const el = container.querySelector('.sector-join-cut') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.breakBefore).toBe('page');
    expect(el.className).toMatch(/keep-with-next/);
  });

  it('SectorJoinCutLine sem forcePageBreak NÃO força break-before (emenda in-flow)', () => {
    const { container } = render(<SectorJoinCutLine />);
    const el = container.querySelector('.sector-join-cut') as HTMLElement;
    expect(el.style.breakBefore).toBe('');
  });

  it('Solagem: strip de sandálias cola na grade (keep-with-next / keep-with-previous)', () => {
    const { container } = render(
      <SolagemWorkSheet
        allSizes={['34', '35', '36']}
        grandTotal={12}
        bands={[{
          soleColor: 'CARAMELO',
          grade: { '34': 2, '35': 4, '36': 6 },
          totalPairs: 12,
          baseGrade: { '34': 2, '35': 4, '36': 6 },
          baseGradeSum: 12,
          fichas: 1,
          refs: [
            { key: 'a', code: 'G01', name: 'G01', color: 'CARAMELO', image_url: null },
            { key: 'b', code: 'G02', name: 'G02', color: 'CARAMELO', image_url: null },
          ],
        }]}
      />,
    );
    const strip = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent?.includes('Sandálias') && d.className.includes('keep-with-next'),
    );
    expect(strip).toBeTruthy();
    expect(container.querySelector('table.keep-with-previous')).toBeTruthy();
  });

  it('ManagementReport: identidade+checklist é UM bloco atômico (não fatia SOLAGEM/ACABAMENTO)', () => {
    const saleOrder: ReportSaleOrder = {
      id: 'pv1',
      order_number: 'PV-00225',
      client_name: 'TESTE',
    };
    const orders: ReportOrder[] = [{
      id: '1',
      total_pairs: 12,
      reference_name: 'G01',
      color: 'PRATA',
      grade: { '34': 2, '35': 4, '36': 6 },
      production_sectors: [
        'Corte Palmilha', 'Corte Forração', 'Aviamento', 'Silk',
        'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
      ],
      requires_upper_cut: false,
      requires_upper_sewing: false,
      requires_lining_cut: true,
    }];
    const { container } = render(
      <ManagementReport saleOrders={[saleOrder]} orders={orders} />,
    );
    const blocks = Array.from(container.querySelectorAll('[data-block]'));
    expect(blocks.length).toBe(2); // header + 1 ref (card+checklist)
    const refBlock = blocks[1];
    expect(refBlock.getAttribute('data-keep-prev')).toBe('0');
    expect(refBlock.getAttribute('data-keep-next')).toBe('0');
    const atomic = refBlock.querySelector('[data-pack-boost="1.12"]') as HTMLElement;
    expect(atomic).toBeTruthy();
    expect(atomic.className).toMatch(/keep-together/);
    const text = atomic.textContent || '';
    expect(text).toMatch(/G01/i);
    expect(text).toMatch(/SOLAGEM/i);
    expect(text).toMatch(/ACABAMENTO/i);
    expect(text).toMatch(/EXPEDIÇÃO/i);
    // Linhas do checklist coladas entre si (cinto se o bloco fluir).
    const rows = Array.from(atomic.querySelectorAll('.keep-with-next, .keep-with-previous'))
      .filter((el) => /SOLAGEM|ACABAMENTO|EXPEDIÇÃO/i.test(el.textContent || ''));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
