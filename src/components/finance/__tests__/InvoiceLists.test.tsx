import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvoicesEntradaTab from '@/components/finance/InvoicesEntradaTab';
import InvoicesSaidaTab from '@/components/finance/InvoicesSaidaTab';

const mocks = vi.hoisted(() => ({
  invoices: vi.fn(), items: vi.fn(), nfes: vi.fn(), retry: vi.fn(), check: vi.fn(),
}));
vi.mock('@/hooks/useSuppliers', () => ({
  useInvoices: mocks.invoices, useInvoiceItems: mocks.items,
  useSuppliers: () => ({ data: [] }), useDeleteInvoice: () => ({ mutate: vi.fn() }), useAddSupplier: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useFinance', () => ({ useCreateAccountPayable: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useNfe', () => ({ useNfeEmitidas: mocks.nfes, useCheckNfeStatus: () => ({ mutateAsync: mocks.check }) }));
vi.mock('@/components/suppliers/XmlImportDialog', () => ({ default: () => null }));
vi.mock('@/components/suppliers/AddToStockDialog', () => ({ default: () => null }));
vi.mock('@/components/nfe/NfeViewerDialog', () => ({ NfeViewerDialog: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoices.mockReturnValue({ data: [], isPending: false, isError: false, refetch: mocks.retry });
  mocks.items.mockReturnValue({ data: [], isPending: false, isError: false, refetch: mocks.retry });
  mocks.nfes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mocks.retry });
});

describe('Listas da central NF — estado de consulta explícito', () => {
  it('não chama falha de entrada de lista vazia nem permite agir no cache antigo', () => {
    mocks.invoices.mockReturnValue({ data: [{ id: 'old', invoice_number: 'CACHE', total_value: 1 }], isError: true, refetch: mocks.retry });
    render(<InvoicesEntradaTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível');
    expect(screen.queryByText('CACHE')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma nota fiscal/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar notas de entrada' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it('mostra carregamento na entrada antes do estado vazio', () => {
    mocks.invoices.mockReturnValue({ data: [], isPending: true });
    render(<InvoicesEntradaTab />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    expect(screen.queryByText(/Nenhuma nota fiscal/)).not.toBeInTheDocument();
  });

  it.each(['pending', 'error'])('não trata itens em %s como estoque conferido', state => {
    mocks.invoices.mockReturnValue({ data: [{ id: 'inv', invoice_number: 'TESTE', total_value: 1, status: 'imported' }] });
    mocks.items.mockReturnValue({ data: [{ added_to_stock: true }], isPending: state === 'pending', isError: state === 'error', refetch: mocks.retry });
    render(<InvoicesEntradaTab />);
    fireEvent.click(screen.getByText('TESTE'));
    expect(screen.queryByText(/Todos os itens lançados/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lançar no Estoque/ })).not.toBeInTheDocument();
    expect(screen.getByRole(state === 'error' ? 'alert' : 'status')).toBeInTheDocument();
  });

  it('não chama falha da saída de ausência de notas', () => {
    mocks.nfes.mockReturnValue({ data: [], isError: true, refetch: mocks.retry });
    render(<InvoicesSaidaTab />);
    expect(screen.getByRole('alert')).toHaveTextContent('notas de saída');
    expect(screen.queryByText('Nenhuma NF-e emitida')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar notas de saída' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it('distingue erro fiscal de processamento e não inventa status desconhecido', () => {
    mocks.nfes.mockReturnValue({ data: [{ id: 'a', status: 'erro', valor_total: 1 }, { id: 'b', status: 'rascunho', valor_total: 1 }] });
    render(<InvoicesSaidaTab />);
    expect(screen.getByText('Erro')).toBeInTheDocument();
    expect(screen.getByText('rascunho')).toBeInTheDocument();
    expect(screen.queryByText('Processando')).not.toBeInTheDocument();
  });

  it('libera nova consulta de status após rejeição, sem promise não tratada', async () => {
    mocks.nfes.mockReturnValue({ data: [{ id: 'a', numero: 'TESTE', status: 'processando', valor_total: 1 }] });
    mocks.check.mockRejectedValue(new Error('falha simulada'));
    render(<InvoicesSaidaTab />);
    const button = screen.getByRole('button', { name: 'Consultar situação da NF-e TESTE' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(mocks.check).toHaveBeenCalledWith('a');
  });
});
