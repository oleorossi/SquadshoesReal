import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelTemplatesTab } from '../LabelTemplatesTab';

const mocks = vi.hoisted(() => ({
  buildPdf: vi.fn(),
  savePdf: vi.fn(),
  createPrintJob: vi.fn(),
  setPrintJobStatus: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/standardTextLabels', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/standardTextLabels')>();
  return { ...actual, buildStandardTextLabelsPdf: mocks.buildPdf };
});

vi.mock('@/lib/printJobs', () => ({
  createPrintJob: mocks.createPrintJob,
  setPrintJobStatus: mocks.setPrintJobStatus,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LabelTemplatesTab />
    </QueryClientProvider>,
  );
}

function fillDraft(copies = '3') {
  fireEvent.change(screen.getByLabelText(/^Referência/), { target: { value: 'SP130' } });
  fireEvent.change(screen.getByLabelText(/^Cor/), { target: { value: 'Off White' } });
  fireEvent.change(screen.getByLabelText(/^Material/), { target: { value: 'Napa Soft' } });
  fireEvent.change(screen.getByLabelText(/^Quantidade de etiquetas/), { target: { value: copies } });
}

describe('LabelTemplatesTab · gerador padronizado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildPdf.mockResolvedValue({ save: mocks.savePdf });
    mocks.createPrintJob.mockResolvedValue('job-1');
    mocks.setPrintJobStatus.mockResolvedValue(undefined);
    mocks.eq.mockResolvedValue({
      data: [
        { id: '11111111-1111-4111-8111-111111111111', system_key: 'external_box_l42pro', layout_config: { builder_key: 'external_box', locked: true } },
        { id: '22222222-2222-4222-8222-222222222222', system_key: 'individual_package_l42pro', layout_config: { builder_key: 'individual_package', locked: true } },
      ],
      error: null,
    });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });
  });

  it('expõe somente os dois usos fixos e nenhuma gestão livre de modelos', () => {
    renderTab();

    expect(screen.getByRole('radio', { name: /Caixa externa/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Embalagem individual/i })).toBeInTheDocument();
    expect(screen.getAllByText('50 × 30 mm').length).toBeGreaterThan(0);
    expect(screen.getByText('106 × 30 mm')).toBeInTheDocument();

    expect(screen.queryByText('Novo modelo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Largura/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Altura/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/DPI/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Duplicar modelo')).not.toBeInTheDocument();
  });

  it('adiciona uma amostra, alterna apenas a finalidade e registra o PDF gerado', async () => {
    renderTab();
    fillDraft('3');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à tiragem' }));

    expect(screen.getByText('SP130')).toBeInTheDocument();
    expect(screen.getByText('OFF WHITE · NAPA SOFT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar PDF L42PRO (3)' })).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: /Caixa externa/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF L42PRO (3)' }));

    await waitFor(() => {
      expect(mocks.buildPdf).toHaveBeenCalledWith([
        expect.objectContaining({ reference: 'SP130', color: 'OFF WHITE', material: 'NAPA SOFT', copies: 3 }),
      ], 'external_box');
    });
    expect(mocks.createPrintJob).toHaveBeenCalledWith({
      batchName: 'Amostras · Caixa externa',
      totalLabels: 3,
      templateId: '11111111-1111-4111-8111-111111111111',
    });
    expect(mocks.createPrintJob.mock.invocationCallOrder[0]).toBeLessThan(mocks.buildPdf.mock.invocationCallOrder[0]);
    expect(mocks.savePdf).toHaveBeenCalledWith(expect.stringMatching(/^etiquetas-caixa-externa-\d{8}\.pdf$/));
    expect(mocks.setPrintJobStatus).toHaveBeenCalledWith('job-1', 'generated');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('3 etiquetas geradas no padrão L42PRO.');
  });

  it('não adiciona tiragem sem os três campos obrigatórios', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à tiragem' }));

    expect(mocks.toastError).toHaveBeenCalledWith('Informe a referência.');
    expect(screen.getByLabelText(/^Referência/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Informe a referência.');
    expect(screen.getByRole('button', { name: 'Gerar PDF L42PRO (0)' })).toBeDisabled();
  });

  it('marca o job como falho quando o PDF não pode ser construído', async () => {
    mocks.buildPdf.mockRejectedValueOnce(new Error('Falha vetorial'));
    renderTab();
    fillDraft('1');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à tiragem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF L42PRO (1)' }));

    await waitFor(() => {
      expect(mocks.setPrintJobStatus).toHaveBeenCalledWith('job-1', 'failed');
    });
    expect(mocks.toastError).toHaveBeenCalledWith('Falha vetorial');
  });
});
