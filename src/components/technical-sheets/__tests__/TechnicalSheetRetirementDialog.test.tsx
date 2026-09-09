import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TechnicalSheetDeleteImpact } from '@/hooks/useTechnicalSheets';
import { TechnicalSheetRetirementDialog } from '../TechnicalSheetRetirementDialog';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  impact: {
    data: null as TechnicalSheetDeleteImpact | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useTechnicalSheets', () => ({
  useTechnicalSheetDeleteImpact: () => mocks.impact,
  useDeleteSheet: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

const impact: TechnicalSheetDeleteImpact = {
  sheet_id: 'sheet-1',
  sheet_name: 'S-039',
  sheet_code: '903928',
  sheet_status: 'Ativo',
  sheet_publication_status: 'publicada',
  updated_at: '2026-08-30T12:00:00.000Z',
  mode: 'retire' as const,
  can_hard_delete: false,
  can_retire: true,
  active_orders: [
    {
      id: 'op-1',
      order_number: 'OP-2026-01300',
      status: 'Em Produção',
      quantity: 432,
      sale_order_id: 'pv-1',
      has_non_reversible_facts: false,
    },
    {
      id: 'op-2',
      order_number: 'OP-2026-01302',
      status: 'Em Produção',
      quantity: 432,
      sale_order_id: 'pv-1',
      has_non_reversible_facts: false,
    },
  ],
  active_order_count: 2,
  blocking_active_order_count: 0,
  terminal_parent_active_order_count: 0,
  blocking_wave_count: 0,
  active_pairs: 864,
  active_sale_item_count: 2,
  active_sale_item_pairs: 864,
  historical_order_count: 6,
  links: {
    orders: 8,
    sale_order_items: 4,
    technical_sheet_snapshots: 4,
    technical_strap_line_identity_map: 5,
    production_wave_items: 2,
    product_references: 0,
    ready_stock: 0,
    ready_stock_movements: 0,
    reference_materials: 0,
    sop_plan_items: 0,
    nfe_devolucao_item_claims: 0,
  },
};

describe('TechnicalSheetRetirementDialog', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset().mockResolvedValue({ ok: true });
    mocks.impact.data = impact;
    mocks.impact.isLoading = false;
    mocks.impact.isError = false;
    mocks.impact.error = null;
    mocks.impact.refetch.mockReset().mockResolvedValue({ data: mocks.impact.data });
  });

  it('mostra o impacto real e preserva explicitamente o histórico', () => {
    render(
      <TechnicalSheetRetirementDialog
        open
        sheet={{ id: 'sheet-1', name: 'S-039', code: '903928' }}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('2 OP(s) ativa(s)', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('864 pares', { exact: false })).toHaveLength(2);
    expect(screen.getByText('6 OP(s) histórica(s)', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('OP-2026-01300')).toBeInTheDocument();
    expect(screen.getByText(/continuará no Pedido de Venda/i)).toBeInTheDocument();
    expect(screen.getByText(/aviso permanente/i)).toBeInTheDocument();
  });

  it('exige motivo e o nome da ficha antes de executar o comando admin', async () => {
    const onOpenChange = vi.fn();
    render(
      <TechnicalSheetRetirementDialog
        open
        sheet={{ id: 'sheet-1', name: 'S-039', code: '903928' }}
        onOpenChange={onOpenChange}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Excluir e retirar da produção' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motivo da exclusão'), {
      target: { value: 'Ficha duplicada cadastrada por engano' },
    });
    fireEvent.change(screen.getByLabelText(/Digite S-039 para confirmar/), {
      target: { value: 'S-039' },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sheet-1',
      expectedUpdatedAt: impact.updated_at,
      reason: 'Ficha duplicada cadastrada por engano',
      clientRequestId: expect.any(String),
    })));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('mantém o erro do servidor visível no diálogo', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error('OP possui estorno parcial; reconciliação obrigatória'));
    render(
      <TechnicalSheetRetirementDialog
        open
        sheet={{ id: 'sheet-1', name: 'S-039', code: '903928' }}
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Motivo da exclusão'), {
      target: { value: 'Ficha duplicada cadastrada por engano' },
    });
    fireEvent.change(screen.getByLabelText(/Digite S-039 para confirmar/), {
      target: { value: 'S-039' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir e retirar da produção' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('reconciliação obrigatória');
    expect(mocks.impact.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('bloqueia a confirmação quando uma OP já tem fato fabril irreversível', () => {
    mocks.impact.data = {
      ...impact,
      can_retire: false,
      blocking_active_order_count: 1,
      active_orders: [
        { ...impact.active_orders[0], has_non_reversible_facts: true },
        impact.active_orders[1],
      ],
    };

    render(
      <TechnicalSheetRetirementDialog
        open
        sheet={{ id: 'sheet-1', name: 'S-039', code: '903928' }}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Exclusão bloqueada');
    expect(screen.getByText(/apontamento irreversível/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir e retirar da produção' })).toBeDisabled();
  });
});
