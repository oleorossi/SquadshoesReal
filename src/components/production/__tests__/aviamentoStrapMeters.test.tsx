import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SilkMontageWorkSheet, type SoleSilkGroup } from '../SilkMontageWorkSheet';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';

// PaginatedSheet observa cada bloco com ResizeObserver — inexistente no jsdom.
// Mock no-op: os blocos ainda são commitados no DOM (measurement=0 → 1 página).
beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const strapRow = (name: string, meters: number): ConsumptionRow => ({
  component: 'Tiras',
  product_id: `Tiras::${name}::Preto::metro`,
  product_name: name,
  color: 'Preto',
  consumption_per_unit: 0,
  required: meters,
  available: 0,
  stock_ok: false,
  debit_mode: 'soft',
  unit: 'metro',
});

// Ref com 2 tiras (materiais diferentes), grade uniforme de 12 → 4 fichas / 48 pares.
const aviamentoGroup: SoleSilkGroup = {
  soleName: 'SANDALIA CLEO',
  groupKind: 'reference',
  totalPairs: 48,
  colorGroups: [
    {
      color: 'PRETO',
      combinedGrid: { '35': 8, '36': 8, '37': 8, '38': 8, '39': 8, '40': 8 },
      baseGrid: { '35': 2, '36': 2, '37': 2, '38': 2, '39': 2, '40': 2 },
      baseGradeSum: 12,
      fichas: 4,
      mixedGrades: false,
      totalPairs: 48,
      opNumbers: ['00472'],
      pvNumbers: ['PV-00131'],
      consumption: [strapRow('TIRA CHATA 8MM', 43.2), strapRow('TIRA STRASS 15MM', 26.88)],
    },
  ],
};

describe('SilkMontageWorkSheet · Aviamento · Consumo de Tiras (metros)', () => {
  it('renderiza o bloco de metros de tira e o Total Geral quando há tiras', () => {
    render(<SilkMontageWorkSheet groups={[aviamentoGroup]} sector="Aviamento" />);

    // Bloco por card.
    expect(screen.getByText(/Consumo de Tiras/i)).toBeInTheDocument();
    // Uma linha por material de tira.
    expect(screen.getByText('TIRA CHATA 8MM')).toBeInTheDocument();
    expect(screen.getByText('TIRA STRASS 15MM')).toBeInTheDocument();

    // Total por ficha (corrugado): 43,2 ÷ 4 = 10,8  e  26,88 ÷ 4 = 6,72.
    expect(screen.getByText('10,8')).toBeInTheDocument();
    expect(screen.getByText('6,72')).toBeInTheDocument();

    // Total da cor = 43,2 + 26,88 = 70,08 (aparece no subtotal do card E no
    // "Total Tiras" do rodapé → getAllByText).
    expect(screen.getAllByText('70,08').length).toBeGreaterThanOrEqual(2);

    // Total Geral no rodapé: rótulo exclusivo do trailing (o subtotal do card
    // usa "Total tiras · PRETO", então filtramos pelo "todas as fichas").
    expect(screen.getByText(/todas as fichas/i)).toBeInTheDocument();
    expect(screen.getAllByText('48').length).toBeGreaterThanOrEqual(1); // pares do maço
  });

  it('não renderiza bloco de tiras quando a ref não tem tiras habilitadas', () => {
    const noStraps: SoleSilkGroup = {
      ...aviamentoGroup,
      colorGroups: [{ ...aviamentoGroup.colorGroups[0], consumption: [] }],
    };
    render(<SilkMontageWorkSheet groups={[noStraps]} sector="Aviamento" />);
    expect(screen.queryByText(/Consumo de Tiras/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Tiras/i)).not.toBeInTheDocument();
  });

  it('não vaza o bloco de tiras pra outros setores (ex.: Montagem)', () => {
    render(<SilkMontageWorkSheet groups={[aviamentoGroup]} sector="Montagem" />);
    expect(screen.queryByText(/Consumo de Tiras · Metros/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Tiras/i)).not.toBeInTheDocument();
  });
});
