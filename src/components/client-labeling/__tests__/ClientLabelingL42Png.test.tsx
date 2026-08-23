import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLabelingWorkspace } from '../ClientLabelingWorkspace';
import { clientSkuKey, type BabyNalinRow } from '@/lib/babyNalinLabels';

const mocks = vi.hoisted(() => ({
  parseClientOrderFile: vi.fn(),
  loadLogoDataUrl: vi.fn(),
  buildBabyNalinPdf: vi.fn(),
  rasterizeCoucheCareerPng: vi.fn(),
  downloadDataUrl: vi.fn(),
  save: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@/lib/babyNalinLabels', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/babyNalinLabels')>();
  return {
    ...actual,
    parseClientOrderFile: mocks.parseClientOrderFile,
    loadLogoDataUrl: mocks.loadLogoDataUrl,
    buildBabyNalinPdf: mocks.buildBabyNalinPdf,
  };
});

vi.mock('@/lib/l42CareerOutput', () => ({
  rasterizeCoucheCareerPng: mocks.rasterizeCoucheCareerPng,
  downloadDataUrl: mocks.downloadDataUrl,
  l42ImageFilename: (origem: string, pageIndex = 0) => {
    const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `L42PRO_${base || 'pedido'}_carreira_${String(pageIndex + 1).padStart(3, '0')}.png`;
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
  },
}));

const ROW: BabyNalinRow = {
  tamanho: '34',
  cor: 'PRETO',
  referencia: 'NL02',
  codProduto: '905301',
  codigoBarra: '2260000303222',
  quantidade: 144,
};

describe('ClientLabelingWorkspace · PNG L42PRO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLogoDataUrl.mockResolvedValue(null);
    mocks.buildBabyNalinPdf.mockResolvedValue({ save: mocks.save });
    mocks.rasterizeCoucheCareerPng.mockResolvedValue('data:image/png;base64,AAA');
  });

  it('baixa o PNG 203 dpi da carreira 2×50×30 ao gerar L42PRO', async () => {
    mocks.parseClientOrderFile.mockResolvedValueOnce([ROW]);
    const view = render(<ClientLabelingWorkspace />);
    const input = view.container.querySelector<HTMLInputElement>('#client-order-upload');
    fireEvent.change(input!, {
      target: { files: [new File(['pedido'], 'pedido-cliente.csv', { type: 'text/csv' })] },
    });
    await waitFor(() => {
      expect(screen.getByText(`0/${1}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('checkbox', {
      name: /Selecionar linha 1: SKU NL02, PRETO, tamanho 34/,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar L42PRO (144 etiquetas)' }));
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('Etiquetas_pedido_cliente.pdf');
    });
    expect(mocks.rasterizeCoucheCareerPng).toHaveBeenCalled();
    expect(mocks.downloadDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,AAA',
      'L42PRO_pedido_cliente_carreira_001.png',
    );
  });
});
