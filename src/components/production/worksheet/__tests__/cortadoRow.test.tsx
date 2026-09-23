import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SilkMontageWorkSheet, type SilkColorGroup, type SoleSilkGroup } from '../../SilkMontageWorkSheet';
import { PalmilhaWorkSheet, type PalmilhaGroup } from '../../PalmilhaWorkSheet';
import { ExpedicaoWorkSheet, type ExpedicaoCustomerGroup } from '../../ExpedicaoWorkSheet';
import { STEP_CHECKBOX_PX } from '../density';

vi.mock('../PaginatedSheet', () => ({
  PaginatedSheet: ({ blocks }: { blocks: { node: React.ReactNode }[] }) => (
    <div data-testid="paginated">{blocks.map((b, i) => <div key={i}>{b.node}</div>)}</div>
  ),
}));

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const checkboxSpans = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span')).filter(
    (el) => (el as HTMLElement).style.width === `${STEP_CHECKBOX_PX}px`,
  );

const cortadoRowCheckboxes = (container: HTMLElement) => {
  const label = Array.from(container.querySelectorAll('td')).find(
    (td) => td.textContent?.trim() === 'CORTADO',
  );
  expect(label).toBeTruthy();
  const row = label!.closest('tr')!;
  return checkboxSpans(row);
};

const baseCg = (over: Partial<SilkColorGroup>): SilkColorGroup => ({
  color: 'PRETO',
  combinedGrid: { '35': 6, '36': 6 },
  totalPairs: 12,
  opNumbers: ['OP-2026-00001'],
  refs: [],
  ...over,
});

const soleGroup = (cg: SilkColorGroup): SoleSilkGroup => ({
  soleName: 'SOLADO 01',
  groupKind: 'sole',
  totalPairs: cg.totalPairs,
  colorGroups: [cg],
});

describe('linha CORTADO nas fichas de corte', () => {
  it('Corte Forração: uma caixinha por numeração + Total', () => {
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[soleGroup(baseCg({}))]} sectorLabel="Corte Forração" />,
    );
    expect(screen.getByText('CORTADO')).toBeTruthy();
    expect(cortadoRowCheckboxes(container)).toHaveLength(3);
  });

  it('Corte Cabedal: colunas P/M/G na linha CORTADO quando há knifeGrid', () => {
    const cg = baseCg({
      combinedGrid: {},
      knifeGrid: { P: 4, M: 4, G: 4 },
      totalPairs: 12,
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Corte Cabedal" groups={[soleGroup(cg)]} sectorLabel="Corte Cabedal" />,
    );
    expect(screen.getByText('CORTADO')).toBeTruthy();
    expect(cortadoRowCheckboxes(container)).toHaveLength(4);
  });

  it('Costura Cabedal: CORTADO com colunas P/M/G quando há knifeGrid (como Corte Cabedal)', () => {
    const cg = baseCg({
      combinedGrid: {},
      knifeGrid: { P: 2, M: 2, G: 2 },
      totalPairs: 6,
    });
    const { container } = render(
      <SilkMontageWorkSheet sector="Costura Cabedal" groups={[soleGroup(cg)]} sectorLabel="Costura Cabedal" />,
    );
    expect(screen.getByText('CORTADO')).toBeTruthy();
    expect(cortadoRowCheckboxes(container)).toHaveLength(4);
  });

  it('Aviamento não renderiza CORTADO', () => {
    const cg = baseCg({
      combinedGrid: { P: 6, M: 6 },
      aviamentoSteps: ['Frente'],
    });
    render(
      <SilkMontageWorkSheet sector="Aviamento" groups={[soleGroup(cg)]} sectorLabel="Aviamento" />,
    );
    expect(screen.queryByText('CORTADO')).toBeNull();
  });

  it('Corte Fibra (PalmilhaWorkSheet): CORTADO sob a grade', () => {
    const group: PalmilhaGroup = {
      soleName: 'SOLADO 01',
      insoleColor: 'PRETO',
      grade: { '35': 6, '36': 6 },
      totalPairs: 12,
      fichas: 1,
      opNumbers: ['OP-1'],
    };
    const { container } = render(
      <PalmilhaWorkSheet groups={[group]} allSizes={['35', '36']} sectorLabel="Corte Fibra" />,
    );
    expect(screen.getByText('CORTADO')).toBeTruthy();
    expect(cortadoRowCheckboxes(container)).toHaveLength(3);
  });

  it('destaca múltiplas referências no card compacto (badge N REFS)', () => {
    const cg = baseCg({
      refs: [
        { code: 'LA01', name: 'LA01' },
        { code: 'SP201', name: 'SP201' },
      ],
    });
    render(
      <SilkMontageWorkSheet sector="Corte Forração" groups={[soleGroup(cg)]} sectorLabel="Corte Forração" />,
    );
    expect(screen.getByText('2 REFS')).toBeTruthy();
  });
});

describe('fichas sem visto / checklist', () => {
  it('Expedição não renderiza Checklist Final nem Visto', () => {
    const group: ExpedicaoCustomerGroup = {
      client_id: 'c1',
      client_name: 'Cliente Teste',
      orders: [{
        id: 'o1',
        total_pairs: 12,
        grid: { '35': 12 },
      }],
    };
    render(<ExpedicaoWorkSheet group={group} />);
    expect(screen.queryByText(/Checklist Final/i)).toBeNull();
    expect(screen.queryByText(/Visto do responsável/i)).toBeNull();
    expect(screen.queryByText(/Executado por/i)).toBeNull();
  });
});
