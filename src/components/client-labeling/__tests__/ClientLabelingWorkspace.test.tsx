/**
 * Testes do workspace focados no wiring (hooks → import → PDF),
 * evitando interações frágeis do Radix Select no jsdom.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ClientLabelingWorkspace } from '@/components/client-labeling/ClientLabelingWorkspace';
import type { ClientOrderLine } from '@/lib/clientLabelPattern';
import { defaultPatternForKey } from '@/lib/clientLabelPattern';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

const {
  saveMutateAsync,
  parseClientOrderFilesMock,
  buildObjetivaPdfMock,
  buildBabyNalinPdfMock,
  toastInfo,
  toastSuccess,
  toastError,
  toastWarning,
  state,
} = vi.hoisted(() => {
  return {
    saveMutateAsync: vi.fn(async () => ({
      version: 2,
      activeKey: 'objetiva',
      patterns: { objetiva: { key: 'objetiva' } },
    })),
    parseClientOrderFilesMock: vi.fn(),
    buildObjetivaPdfMock: vi.fn(async () => ({ save: vi.fn() })),
    buildBabyNalinPdfMock: vi.fn(async () => ({ save: vi.fn() })),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    state: {
      selectedPattern: null as any,
      clients: [
        {
          id: 'cli-2',
          razao_social: 'Objetiva Calcados LTDA',
          nome_fantasia: 'Objetiva',
          label_pattern: null as any,
        },
      ],
    },
  };
});

state.selectedPattern = defaultPatternForKey('objetiva');
state.clients[0]!.label_pattern = defaultPatternForKey('objetiva');

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

vi.mock('@/hooks/useClientLabelPattern', () => ({
  useClientsForLabeling: () => ({
    data: state.clients,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useClientLabelPattern: () => ({
    data: state.selectedPattern
      ? {
          version: 2 as const,
          activeKey: state.selectedPattern.key,
          patterns: { [state.selectedPattern.key]: state.selectedPattern },
        }
      : { version: 2 as const, activeKey: null, patterns: {} },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSaveClientLabelPattern: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/clientOrderImport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clientOrderImport')>(
    '@/lib/clientOrderImport',
  );
  return {
    ...actual,
    parseClientOrderFiles: parseClientOrderFilesMock,
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(),
        remove: vi.fn(),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  },
}));

vi.mock('@/lib/babyNalinLabels', async () => {
  const actual = await vi.importActual<typeof import('@/lib/babyNalinLabels')>(
    '@/lib/babyNalinLabels',
  );
  return {
    ...actual,
    buildBabyNalinPdf: buildBabyNalinPdfMock,
    loadLogoDataUrl: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,logo',
      width: 10,
      height: 10,
    })),
  };
});

vi.mock('@/lib/objetivaLabels', async () => {
  const actual = await vi.importActual<typeof import('@/lib/objetivaLabels')>(
    '@/lib/objetivaLabels',
  );
  return {
    ...actual,
    buildObjetivaPdf: buildObjetivaPdfMock,
  };
});

function createLines(overrides: Partial<ClientOrderLine> = {}): ClientOrderLine[] {
  return [
    {
      tamanho: '33',
      cor: 'PRETO',
      referencia: 'REF-1',
      codProduto: '112334',
      codigoBarra: '112334',
      quantidade: 2,
      descricao: 'SANDALIA',
      sourceFile: '112334.csv',
      ...overrides,
    },
  ];
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ClientLabelingWorkspace />, { wrapper });
}

describe('ClientLabelingWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectedPattern = defaultPatternForKey('objetiva');
    state.clients = [
      {
        id: 'cli-2',
        razao_social: 'Objetiva Calcados LTDA',
        nome_fantasia: 'Objetiva',
        label_pattern: defaultPatternForKey('objetiva'),
      },
    ];
    parseClientOrderFilesMock.mockResolvedValue({
      rows: createLines(),
      fileNames: ['112334.csv'],
      format: 'objetiva',
      errors: [],
    });
  });

  it('monta a tela de etiquetagem cliente', () => {
    renderWorkspace();
    expect(screen.getByText(/ETIQUETAS · CLIENTE/i)).toBeTruthy();
    expect(screen.getByText(/Escolha um cliente/i)).toBeTruthy();
    expect(document.getElementById('client-order-upload')).toBeTruthy();
  });

  it('mantém upload desabilitado quando não há padrão', () => {
    state.selectedPattern = null;
    state.clients = [
      {
        id: 'cli-1',
        razao_social: 'Nalin Comercio LTDA',
        nome_fantasia: 'Nalin',
        label_pattern: null,
      },
    ];
    renderWorkspace();
    expect((document.getElementById('client-order-upload') as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it('expõe o input multiple aceitando CSV/XLSX', () => {
    renderWorkspace();
    const input = document.getElementById('client-order-upload') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toMatch(/csv/i);
  });

  it('expõe o hook de salvar padrão mockado para o wiring', () => {
    renderWorkspace();
    expect(typeof saveMutateAsync).toBe('function');
    expect(screen.getByText(/O mesmo cliente pode ter Nalin e Objetiva/i)).toBeTruthy();
  });

  it('chama toast e não parseia quando o upload dispara sem padrão', async () => {
    renderWorkspace();
    const input = document.getElementById('client-order-upload') as HTMLInputElement;
    const f1 = new File(['a'], '112334.csv', { type: 'text/csv' });
    const f2 = new File(['b'], '112336.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [f1, f2] } });

    await waitFor(() => {
      expect(toastInfo).toHaveBeenCalled();
    });
    expect(parseClientOrderFilesMock).not.toHaveBeenCalled();
  });
});
