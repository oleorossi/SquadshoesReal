import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import type { ConsumptionRow } from '@/lib/consumptionRows';

vi.mock('@/lib/printPdf', () => ({
  openPrintTab: vi.fn(() => null),
  printHtmlAsPdf: vi.fn(async () => undefined),
}));

const row = (partial: Partial<ConsumptionRow> & Pick<ConsumptionRow, 'groupName' | 'materialName' | 'totalQuantity'>): ConsumptionRow => ({
  componentType: 'Cabedal',
  productUnit: 'm',
  color: 'PRETO',
  ...partial,
});

describe('MaterialConsumptionView — modo Por PV e modelo (um pedido)', () => {
  it('mostra seções do pedido e dos modelos e troca Consolidado ↔ estendido', async () => {
    const user = userEvent.setup();
    const onPartitionModeChange = vi.fn();
    const rows: ConsumptionRow[] = [
      row({
        groupName: 'NAPA SOFT',
        materialName: 'Cabedal',
        totalQuantity: 10,
        orderNumber: 'PV-00194',
        saleOrderId: 'pv-1',
        referenceCode: 'I90',
        referenceId: 'ref-i90',
        referenceName: 'INFANTIL 90',
      }),
      row({
        groupName: 'NAPA SOFT',
        materialName: 'Cabedal',
        totalQuantity: 4,
        orderNumber: 'PV-00194',
        saleOrderId: 'pv-1',
        referenceCode: 'BT01',
        referenceId: 'ref-bt01',
        referenceName: 'BOTINHA 01',
      }),
    ];

    const { rerender } = render(
      <MaterialConsumptionView
        rows={rows}
        artisanalStrapRows={[]}
        title="Consumo de Materiais — PV-00194"
        canPartition
        partitionMode="none"
        onPartitionModeChange={onPartitionModeChange}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Consolidado' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Por PV e modelo' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Por PV e modelo' }));
    expect(onPartitionModeChange).toHaveBeenCalledWith('order_reference');

    rerender(
      <MaterialConsumptionView
        rows={rows}
        artisanalStrapRows={[]}
        title="Consumo de Materiais — PV-00194"
        canPartition
        partitionMode="order_reference"
        onPartitionModeChange={onPartitionModeChange}
      />,
    );

    expect(screen.getByRole('heading', { name: 'PV-00194' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'I90' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'BT01' })).toBeInTheDocument();
    expect(screen.getByText('INFANTIL 90')).toBeInTheDocument();
    expect(screen.getByText('BOTINHA 01')).toBeInTheDocument();
  });
});
