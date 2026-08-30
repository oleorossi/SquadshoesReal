import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaleOrderReadinessCorrectionDialog, {
  type SaleOrderReadinessCorrectionTarget,
} from './SaleOrderReadinessCorrectionDialog';

const referenceId = 'dee92bd6-643d-4651-818e-f2a75cfabf13';
const groupId = '449bbeea-a38a-4526-afe2-2793a305ee2f';
const productId = 'caa8afb2-edd9-49b3-ae08-cc43c74f20a3';

const mocks = vi.hoisted(() => ({
  createOverride: vi.fn(),
  addProduct: vi.fn(),
  addComponentSheet: vi.fn(),
  onRetry: vi.fn(),
  tableData: {
    sale_order_items: [
      { id: 'item-1', reference_id: 'dee92bd6-643d-4651-818e-f2a75cfabf13', color: 'NEW WHISKY', quantity: 1728, unit_price: 0 },
      { id: 'item-2', reference_id: 'dee92bd6-643d-4651-818e-f2a75cfabf13', color: 'OFF WHITE', quantity: 1728, unit_price: 19.9 },
      { id: 'item-3', reference_id: 'dee92bd6-643d-4651-818e-f2a75cfabf13', color: 'ROSADO', quantity: 1728, unit_price: 19.9 },
    ],
    technical_sheets: [{ id: 'dee92bd6-643d-4651-818e-f2a75cfabf13', code: 'NL02', name: 'NL01' }],
    products: [{ id: 'caa8afb2-edd9-49b3-ae08-cc43c74f20a3', name: 'PLACA 1.0 EVA 3.0', group_id: '449bbeea-a38a-4526-afe2-2793a305ee2f', unit: 'dm²' }],
    product_groups: [{ id: '449bbeea-a38a-4526-afe2-2793a305ee2f', name: 'PALMILHA', is_color_agnostic: true, auto_component_sheet: false }],
  } as Record<string, unknown[]>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: mocks.tableData[table] || [],
          error: null,
        }).then(resolve),
      };
      return builder;
    },
  },
}));

vi.mock('@/hooks/useSaleOrderCommand', () => ({
  useCreateSaleOrderReadinessOverride: () => ({ mutateAsync: mocks.createOverride, isPending: false }),
}));

vi.mock('@/hooks/useProducts', () => ({
  ProductSchema: { parse: (value: unknown) => value },
  useAddProduct: () => ({ mutateAsync: mocks.addProduct, isPending: false }),
}));

vi.mock('@/hooks/useComponentSheets', () => ({
  useAddComponentSheet: () => ({ mutateAsync: mocks.addComponentSheet, isPending: false }),
}));

vi.mock('@/components/inventory/ProductFormDialog', () => ({
  ProductFormDialog: () => null,
}));

const blockers = ['item-1', 'item-2', 'item-3'].flatMap((itemId, index) => {
  const color = ['NEW WHISKY', 'OFF WHITE', 'ROSADO'][index];
  return [...(index === 0 ? [{
    code: 'item_price_missing' as const,
    message: 'Item sem preço de venda positivo.',
    item_id: itemId,
    reference_id: referenceId,
    overrideable: false,
    details: { unit_price: 0, effective_price: 0 },
  }] : []), {
    code: 'material_color_not_registered',
    message: 'Cor do componente não está cadastrada no grupo.',
    item_id: itemId,
    reference_id: referenceId,
    overrideable: true,
    details: {
      component: 'Palmilha',
      product_id: productId,
      product_name: 'PLACA 1.0 EVA 3.0',
      color,
    },
  }];
});

const target: SaleOrderReadinessCorrectionTarget = {
  id: 'pv-1',
  orderNumber: 'PV-00167',
  status: 'Aprovado',
  preflight: {
    ready: false,
    blockers,
    warnings: [],
    order_version: 9,
    material_plan_revision_id: null,
    sale_order_id: 'pv-1',
    command: 'confirm',
  },
};

describe('SaleOrderReadinessCorrectionDialog', () => {
  beforeEach(() => {
    mocks.createOverride.mockReset();
    mocks.addProduct.mockReset();
    mocks.addComponentSheet.mockReset();
    mocks.onRetry.mockReset().mockResolvedValue(undefined);
    mocks.tableData.sale_order_items = [
      { id: 'item-1', reference_id: referenceId, color: 'NEW WHISKY', quantity: 1728, unit_price: 0 },
      { id: 'item-2', reference_id: referenceId, color: 'OFF WHITE', quantity: 1728, unit_price: 19.9 },
      { id: 'item-3', reference_id: referenceId, color: 'ROSADO', quantity: 1728, unit_price: 19.9 },
    ];
  });

  it('não transforma preço ausente no item em alteração global da ficha', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SaleOrderReadinessCorrectionDialog
          target={target}
          isAdmin
          statusChangePending={false}
          onClose={vi.fn()}
          onEditOrder={vi.fn()}
          onRetry={mocks.onRetry}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('PV-00167')).toBeInTheDocument();
    expect(await screen.findAllByText('NL02 · NL01')).toHaveLength(3);
    expect(screen.getByText('NEW WHISKY')).toBeInTheDocument();
    expect(screen.getByText('OFF WHITE')).toBeInTheDocument();
    expect(screen.getByText('ROSADO')).toBeInTheDocument();
    expect(screen.getAllByText('1.728 pares')).toHaveLength(3);
    expect(screen.getByText(/3 avisos apontam um grupo agnóstico a cor/)).toBeInTheDocument();
    expect(screen.getByText('1 pendência exige edição completa')).toBeInTheDocument();
    expect(screen.getByText(/As pendências sem editor rápido devem ser corrigidas/)).toBeInTheDocument();
    expect(screen.queryByText('Liberar como exceção administrativa')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preço-base comercial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument();
    expect(mocks.onRetry).not.toHaveBeenCalled();
  });

  it('não oferece uma tentativa circular quando o preço do próprio item está zerado', async () => {
    mocks.tableData.sale_order_items = [{
      id: 'item-1',
      reference_id: referenceId,
      color: 'NEW WHISKY',
      quantity: 1728,
      unit_price: 0,
    }];
    const zeroPriceTarget: SaleOrderReadinessCorrectionTarget = {
      ...target,
      preflight: {
        ...target.preflight,
        blockers: [{
          code: 'item_price_missing',
          message: 'Item sem preço de venda positivo.',
          item_id: 'item-1',
          reference_id: referenceId,
          overrideable: false,
          details: { unit_price: 0, effective_price: 0 },
        }],
      },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <SaleOrderReadinessCorrectionDialog
          target={zeroPriceTarget}
          isAdmin
          statusChangePending={false}
          onClose={vi.fn()}
          onEditOrder={vi.fn()}
          onRetry={mocks.onRetry}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Preço do item ausente')).toBeInTheDocument();
    expect(screen.getByText('O preço deste item no PV está zerado ou inválido.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir pedido completo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Preço-base comercial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument();
  });

  it('mostra bloqueio geral como pendência do PV e exige edição completa', async () => {
    const generalTarget: SaleOrderReadinessCorrectionTarget = {
      ...target,
      preflight: {
        ...target.preflight,
        blockers: [{
          code: 'client_missing',
          message: 'Cliente obrigatório não informado.',
          item_id: null,
          reference_id: null,
          overrideable: false,
          details: { field: 'client_id' },
        }],
      },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <SaleOrderReadinessCorrectionDialog
          target={generalTarget}
          isAdmin
          statusChangePending={false}
          onClose={vi.fn()}
          onEditOrder={vi.fn()}
          onRetry={mocks.onRetry}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Pendências gerais do PV')).toBeInTheDocument();
    expect(screen.getByText('Cliente obrigatório não informado.')).toBeInTheDocument();
    expect(screen.queryByText('Sem código')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument();
  });
});
