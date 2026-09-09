import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OperatorFichasDialog from '../OperatorFichasDialog';

const mocks = vi.hoisted(() => ({
  query: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.query,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {},
}));

describe('OperatorFichasDialog', () => {
  beforeEach(() => {
    mocks.query.data = [];
    mocks.query.isLoading = false;
    mocks.query.isError = false;
    mocks.query.error = null;
  });

  it('mostra estado sem itens produtivos e não oferece fallback para OP cancelada/retirada', () => {
    mocks.query.data = [
      {
        id: 'op-cancelada',
        order_number: 'OP-1',
        reference_id: 'sheet-1',
        color: 'PRETO',
        quantity: 12,
        grade: { '34': 12 },
        status: 'Cancelada',
        sale_order_item_id: 'item-1',
        technical_sheets: { name: 'S-039', code: '903928', production_sectors: ['Montagem'] },
        sale_order_items: { grade: { '34': 1 }, production_excluded_at: null },
        sale_orders: { order_number: 'PV-1', client_name: 'Cliente' },
      },
      {
        id: 'op-retirada',
        order_number: 'OP-2',
        reference_id: 'sheet-1',
        color: 'BRANCO',
        quantity: 12,
        grade: { '34': 12 },
        status: 'Em Produção',
        sale_order_item_id: 'item-2',
        technical_sheets: { name: 'S-039', code: '903928', production_sectors: ['Montagem'] },
        sale_order_items: { grade: { '34': 1 }, production_excluded_at: '2026-08-30T12:00:00Z' },
        sale_orders: { order_number: 'PV-1', client_name: 'Cliente' },
      },
    ];

    render(
      <OperatorFichasDialog
        open
        onOpenChange={vi.fn()}
        saleOrderId="pv-1"
        orderNumber="PV-1"
      />,
    );

    expect(screen.getByText('Este pedido não tem itens ativos na produção')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /imprimir pelo pedido inteiro/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^imprimir\s*$/i })).toBeDisabled();
  });
});
