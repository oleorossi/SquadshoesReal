import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UnifiedInvoicesTab from '@/components/finance/UnifiedInvoicesTab';

const mocks = vi.hoisted(() => ({ useInvoiceSummary: vi.fn(), retryIncoming: vi.fn(), retryOutgoing: vi.fn() }));
vi.mock('@/hooks/useInvoiceSummary', () => ({ useInvoiceSummary: mocks.useInvoiceSummary }));
vi.mock('@/components/finance/InvoicesEntradaTab', () => ({ default: () => <div>Lista de entradas</div> }));
vi.mock('@/components/finance/InvoicesSaidaTab', () => ({ default: () => <div>Lista de saídas</div> }));

function query(data: unknown, error = false, pending = false, refetch = vi.fn()) {
  return { data, isError: error, isPending: pending, refetch };
}

describe('Central de notas — dados reais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useInvoiceSummary.mockReturnValue({
      incoming: query({ total: 5159.16, count: 4 }),
      outgoing: query({ total: 134, count: 2, processing: 1, failed: 2, unknownEnvironment: 1 }),
    });
  });

  it('mostra totais consultados, origem, lacuna do legado e não estima tributos', () => {
    render(<UnifiedInvoicesTab />);
    const summary = screen.getByLabelText('Resumo real de notas fiscais');
    expect(summary).toHaveTextContent('5.159,16');
    expect(summary).toHaveTextContent('134,00');
    expect(summary).toHaveTextContent('1 em processamento · 2 com erro ou rejeição');
    expect(summary).toHaveTextContent('1 nota(s) legada(s) sem ambiente informado');
    expect(summary).not.toHaveTextContent('45.230');
    expect(summary).not.toHaveTextContent('128.450');
    expect(summary).not.toHaveTextContent('15.414');
    expect(summary).not.toHaveTextContent('12%');
    expect(screen.getByText(/Valores documentais, não pagamentos/)).toBeInTheDocument();
  });

  it('não exibe zero nem cache anterior como resultado de uma consulta com erro', () => {
    mocks.useInvoiceSummary.mockReturnValue({
      incoming: query({ total: 999, count: 1 }, true, false, mocks.retryIncoming),
      outgoing: query(undefined, true, false, mocks.retryOutgoing),
    });
    render(<UnifiedInvoicesTab />);
    const summary = screen.getByLabelText('Resumo real de notas fiscais');
    expect(within(summary).getAllByText('Indisponível')).toHaveLength(3);
    expect(summary).not.toHaveTextContent('999');
    expect(summary).not.toHaveTextContent('R$');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar entradas novamente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar saídas novamente' }));
    expect(mocks.retryIncoming).toHaveBeenCalledOnce();
    expect(mocks.retryOutgoing).toHaveBeenCalledOnce();
  });

  it('distingue carregamento de ausência de dados e permite escolher o mês', () => {
    mocks.useInvoiceSummary.mockReturnValue({ incoming: query(undefined, false, true), outgoing: query(undefined, false, true) });
    render(<UnifiedInvoicesTab />);
    expect(screen.getAllByText('Carregando…')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Mês de emissão dos indicadores'), { target: { value: '2026-07' } });
    expect(mocks.useInvoiceSummary).toHaveBeenLastCalledWith('2026-07');
  });
});
