import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeasureLaborCostControl } from '../MeasureLaborCostControl';

const saveMeasureHubFields = vi.hoisted(() => vi.fn());

vi.mock('@/lib/saveArtisanalStrapMeasureHubFields', () => ({
  saveArtisanalStrapMeasureHubFields: (...args: unknown[]) => saveMeasureHubFields(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderControl(
  props?: Partial<React.ComponentProps<typeof MeasureLaborCostControl>>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MeasureLaborCostControl
        measureId="measure-1"
        measureLabel="Tira Chata · 11 mm"
        currentLaborCostPerM={0}
        canEdit
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('MeasureLaborCostControl', () => {
  beforeEach(() => {
    saveMeasureHubFields.mockReset();
    saveMeasureHubFields.mockResolvedValue('measure-1');
  });

  it('abre o formulário e grava a MO da medida no Hub', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: /definir mão de obra desta medida/i }));
    const input = screen.getByLabelText(/mão de obra da medida/i);
    await user.clear(input);
    await user.type(input, '1,25');
    await user.click(screen.getByRole('button', { name: /salvar mão de obra/i }));

    await waitFor(() => {
      expect(saveMeasureHubFields).toHaveBeenCalledWith(
        'measure-1',
        { precoArtesanalPerM: 1.25 },
        expect.stringContaining('Tira Chata · 11 mm'),
      );
    });
  });

  it('mostra o valor atual no botão quando já há MO cadastrada', () => {
    renderControl({ currentLaborCostPerM: 0.8 });
    expect(
      screen.getByRole('button', { name: /editar mão de obra/i }),
    ).toHaveTextContent(/0,80/);
  });

  it('somente leitura quando não pode editar', () => {
    renderControl({ canEdit: false, currentLaborCostPerM: 1.5 });
    expect(screen.getByText(/mão de obra/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
