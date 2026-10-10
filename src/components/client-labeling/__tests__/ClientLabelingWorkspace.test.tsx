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
  buildObjetivaAdesivaPdfMock,
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
    buildObjetivaAdesivaPdfMock: vi.fn(async () => ({ save: vi.fn() })),
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

const emptyCollection = { version: 2 as const, activeKey: null as null, patterns: {} };
let cachedPatternCollection: {
  version: 2;
  activeKey: string;
  patterns: Record<string, unknown>;
} | null = null;
let cachedPatternRef: unknown = null;

vi.mock('@/hooks/useClientLabelPattern', () => ({
  useClientsForLabeling: () => ({
    data: state.clients,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useClientLabelPattern: () => {
    // Referência estável — objeto novo a cada render + useEffect no workspace = loop infinito.
    if (!state.selectedPattern) {
      cachedPatternCollection = null;
      cachedPatternRef = null;
      return { data: emptyCollection, isLoading: false, isError: false, error: null };
    }
    if (cachedPatternRef !== state.selectedPattern || !cachedPatternCollection) {
      cachedPatternRef = state.selectedPattern;
      cachedPatternCollection = {
        version: 2 as const,
        activeKey: state.selectedPattern.key,
        patterns: { [state.selectedPattern.key]: state.selectedPattern },
      };
    }
    return {
      data: cachedPatternCollection,
      isLoading: false,
      isError: false,
      error: null,
    };
  },
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

vi.mock('@/lib/objetivaAdesivaLabels', async () => {
  const actual = await vi.importActual<typeof import('@/lib/objetivaAdesivaLabels')>(
    '@/lib/objetivaAdesivaLabels',
  );
  return {
    ...actual,
    buildObjetivaAdesivaPdf: buildObjetivaAdesivaPdfMock,
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

function renderWorkspace(initialClientId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ClientLabelingWorkspace initialClientId={initialClientId} />, { wrapper });
}

describe('ClientLabelingWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedPatternCollection = null;
    cachedPatternRef = null;
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
    expect(
      screen.getByText(/Nalin e Objetiva: Tag \(maior\) \+ Adesiva no mesmo CSV/i),
    ).toBeTruthy();
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

  async function importPedidoForObjetiva() {
    renderWorkspace('cli-2');
    const input = document.getElementById('client-order-upload') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));

    const file = new File(['a'], '112334.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(parseClientOrderFilesMock).toHaveBeenCalled());
    await screen.findByText(/Textos deste lote/i);
  }

  it('permite editar textos do lote e manda override no PDF sem gravar padrão', async () => {
    await importPedidoForObjetiva();

    // Há motto do padrão (painel de defaults) e do lote — preferir o do lote.
    const lotMotto = document.getElementById('lot-motto') as HTMLInputElement;
    expect(lotMotto).toBeTruthy();
    fireEvent.change(lotMotto, { target: { value: 'MOTTO DO LOTE' } });

    const descInput = screen.getByLabelText(/Descrição do SKU REF-1/i) as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'DESC EDITADA' } });

    // Código de barras permanece só leitura (texto, sem input).
    expect(screen.queryByLabelText(/Código do SKU REF-1/i)).toBeNull();
    expect(screen.getByText('112334')).toBeTruthy();

    const checkbox = screen.getByRole('checkbox', { name: /Selecionar linha 1/i });
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: /Gerar PDF\+ZPL/i }));

    await waitFor(() => expect(buildObjetivaPdfMock).toHaveBeenCalled());
    const call = buildObjetivaPdfMock.mock.calls.at(0) as unknown as
      | [Array<{ descricao?: string }>, { branding: { motto: string } }]
      | undefined;
    expect(call?.[0]?.[0]?.descricao).toBe('DESC EDITADA');
    expect(call?.[1]?.branding.motto).toBe('MOTTO DO LOTE');
    expect(saveMutateAsync).not.toHaveBeenCalled();
  });

  it('Restaurar textos volta motto e face ao seed do pedido/padrão', async () => {
    await importPedidoForObjetiva();
    const lotMotto = document.getElementById('lot-motto') as HTMLInputElement;
    fireEvent.change(lotMotto, { target: { value: 'X' } });
    const descInput = screen.getByLabelText(/Descrição do SKU REF-1/i) as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'Y' } });

    fireEvent.click(screen.getByRole('button', { name: /Restaurar textos/i }));

    await waitFor(() => {
      expect((document.getElementById('lot-motto') as HTMLInputElement).value).toBe(
        'DEUS É FIEL',
      );
    });
    expect(
      (screen.getByLabelText(/Descrição do SKU REF-1/i) as HTMLInputElement).value,
    ).toBe('SANDALIA');
  });
});
