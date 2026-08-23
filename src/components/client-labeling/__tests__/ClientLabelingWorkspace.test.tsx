import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLabelingWorkspace } from '../ClientLabelingWorkspace';
import { MAX_PDF_LABELS, clientSkuKey, type BabyNalinRow } from '@/lib/babyNalinLabels';

const mocks = vi.hoisted(() => ({
  parseClientOrderFile: vi.fn(),
  loadLogoDataUrl: vi.fn(),
  buildBabyNalinPdf: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
  },
}));

const ROWS: BabyNalinRow[] = [
  { tamanho: '34', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303222', quantidade: 144 },
  { tamanho: '35', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303239', quantidade: 288 },
  { tamanho: '36', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303246', quantidade: 432 },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function skuCheckbox(tamanho: string) {
  return screen.getByRole('checkbox', {
    name: new RegExp(`Selecionar linha \\d+: SKU NL02, PRETO, tamanho ${tamanho},`, 'i'),
  });
}

function selecionar(...tamanhos: string[]) {
  tamanhos.forEach(tamanho => fireEvent.click(skuCheckbox(tamanho)));
}

function confirmarPerfilCouche() {
  fireEvent.click(screen.getByText('Medidas do arquivo de duas colunas para a gráfica'));
  const box = screen.getByRole('checkbox', {
    name: 'Confirmo que estas medidas correspondem ao arquivo solicitado pela gráfica.',
  });
  if (box.getAttribute('data-state') !== 'checked') {
    fireEvent.click(box);
  }
}

async function importar(rows: BabyNalinRow[] = ROWS) {
  mocks.parseClientOrderFile.mockResolvedValueOnce(rows);
  const view = render(<ClientLabelingWorkspace />);
  const input = view.container.querySelector<HTMLInputElement>('#client-order-upload');
  expect(input).not.toBeNull();

  fireEvent.change(input!, {
    target: { files: [new File(['pedido'], 'pedido-cliente.csv', { type: 'text/csv' })] },
  });

  const skuCount = new Set(rows.map(clientSkuKey)).size;
  await waitFor(() => {
    expect(screen.getByText(`0/${skuCount}`)).toBeInTheDocument();
  });
  return view;
}

describe('ClientLabelingWorkspace · seleção por SKU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLogoDataUrl.mockResolvedValue(null);
    mocks.buildBabyNalinPdf.mockResolvedValue({ save: mocks.save });
  });

  it('inicia sem seleção e gera somente o SKU marcado', async () => {
    await importar();

    expect(screen.getByRole('button', { name: 'Gerar gráfica (0 SKUs)' })).toBeDisabled();
    selecionar('36');
    expect(screen.getByText('1/3')).toBeInTheDocument();
    confirmarPerfilCouche();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[2]],
        expect.objectContaining({ mode: 'graphic', repeatByQuantity: false }),
      );
    });
    expect(mocks.save).toHaveBeenCalledWith('Artes_SKU_pedido_cliente.pdf');
  });

  it('gera produção somente com as linhas dos SKUs selecionados', async () => {
    await importar();

    selecionar('34', '36');
    confirmarPerfilCouche();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar L42PRO (576 etiquetas)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[0], ROWS[2]],
        expect.objectContaining({ mode: 'production', repeatByQuantity: true }),
      );
    });
  });

  it('permite reduzir a quantidade individual e gera somente o valor informado', async () => {
    await importar([ROWS[0]]);
    selecionar('34');

    const quantityInput = screen.getByRole('spinbutton', {
      name: 'Quantidade a imprimir do SKU NL02, tamanho 34',
    });
    expect(quantityInput).toHaveValue(144);

    fireEvent.change(quantityInput, { target: { value: '20' } });
    confirmarPerfilCouche();

    expect(screen.getByText('20 etiquetas')).toBeInTheDocument();
    expect(screen.getByText('Páginas 100 × 30').parentElement).toHaveTextContent('20');
    expect(screen.getByRole('button', { name: 'Gerar L42PRO (20 etiquetas)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar L42PRO (20 etiquetas)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [{ ...ROWS[0], quantidade: 20 }],
        expect.objectContaining({ mode: 'production', repeatByQuantity: true }),
      );
    });
  });

  it('limita a quantidade individual entre 1 e o total solicitado', async () => {
    await importar([ROWS[0]]);

    const quantityInput = screen.getByRole('spinbutton', {
      name: 'Quantidade a imprimir do SKU NL02, tamanho 34',
    });
    fireEvent.change(quantityInput, { target: { value: '999' } });
    expect(quantityInput).toHaveValue(144);

    fireEvent.change(quantityInput, { target: { value: '0' } });
    expect(quantityInput).toHaveValue(1);
  });

  it('mantém a quantidade original no arquivo da gráfica', async () => {
    await importar([ROWS[0]]);
    selecionar('34');

    fireEvent.change(screen.getByRole('spinbutton', {
      name: 'Quantidade a imprimir do SKU NL02, tamanho 34',
    }), { target: { value: '20' } });
    confirmarPerfilCouche();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[0]],
        expect.objectContaining({ mode: 'graphic', repeatByQuantity: false }),
      );
    });
  });

  it('trata linhas repetidas como o mesmo SKU e alterna todas juntas', async () => {
    const duplicadas = [ROWS[0], { ...ROWS[0], cor: ' preto ', quantidade: 12 }, ROWS[1]];
    await importar(duplicadas);

    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar linha \d+: SKU NL02,.*tamanho 34,/i });
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);

    expect(checkboxes[0]).toHaveAttribute('data-state', 'checked');
    expect(checkboxes[1]).toHaveAttribute('data-state', 'checked');
    expect(checkboxes[0]).not.toHaveAccessibleName(checkboxes[1].getAttribute('aria-label')!);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('não deixa um código inválido fora da seleção bloquear a geração', async () => {
    const codigoLongo = { ...ROWS[1], codigoBarra: '1234567890'.repeat(6) };
    await importar([ROWS[0], codigoLongo]);

    confirmarPerfilCouche();
    selecionar('34');
    const gerarValido = screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' });
    expect(gerarValido).toBeEnabled();
    fireEvent.click(gerarValido);

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[0]],
        expect.objectContaining({ mode: 'graphic' }),
      );
    });
  });

  it('usa a busca só como filtro visual e preserva a seleção dos outros SKUs', async () => {
    await importar();
    selecionar('34', '36');

    const busca = screen.getByPlaceholderText('Buscar no arquivo por referência, cor, tamanho ou código…');
    fireEvent.change(busca, { target: { value: '35' } });

    expect(screen.queryByRole('checkbox', { name: /Selecionar linha \d+: SKU NL02, PRETO, tamanho 34,/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 fora da busca')).toBeInTheDocument();
    fireEvent.click(skuCheckbox('35'));
    fireEvent.change(busca, { target: { value: '' } });

    expect(skuCheckbox('34')).toHaveAttribute('data-state', 'checked');
    expect(skuCheckbox('35')).toHaveAttribute('data-state', 'checked');
    expect(skuCheckbox('36')).toHaveAttribute('data-state', 'checked');

    confirmarPerfilCouche();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (3 SKUs)' }));
    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        ROWS,
        expect.objectContaining({ mode: 'graphic' }),
      );
    });
  });

  it('permite selecionar separadamente SKUs diferentes com o mesmo código de barras', async () => {
    await importar([ROWS[0], { ...ROWS[1], codigoBarra: ROWS[0].codigoBarra }]);

    selecionar('35');

    expect(skuCheckbox('34')).toHaveAttribute('data-state', 'unchecked');
    expect(skuCheckbox('35')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('desabilita as duas gerações quando nenhum SKU está selecionado', async () => {
    await importar();

    expect(screen.getByRole('button', { name: 'Gerar L42PRO (0 etiquetas)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (0 SKUs)' })).toBeDisabled();
    expect(mocks.buildBabyNalinPdf).not.toHaveBeenCalled();
  });

  it('mantém barcode não ASCII visível como inválido e permite excluí-lo da geração', async () => {
    const invalido = { ...ROWS[1], codigoBarra: 'ABCÉ123' };
    await importar([ROWS[0], invalido]);

    expect(screen.getByText('inválido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (0 SKUs)' })).toBeDisabled();

    confirmarPerfilCouche();
    selecionar('34');
    expect(screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' })).toBeEnabled();
  });

  it('bloqueia divergência de código do produto no mesmo SKU', async () => {
    await importar([ROWS[0], { ...ROWS[0], codProduto: 'OUTRO' }]);

    expect(screen.getByText(/código de barras ou código de produto divergente/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Selecionar linha \d+: SKU NL02, PRETO, tamanho 34,/ })[0]);
    confirmarPerfilCouche();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' })).toBeDisabled();
  });

  it('não deixa conflito de um SKU desmarcado bloquear os demais', async () => {
    const conflito = { ...ROWS[0], codigoBarra: '2260000303291' };
    await importar([ROWS[0], conflito, ROWS[1]]);

    selecionar('35');
    confirmarPerfilCouche();

    const gerar = screen.getByRole('button', { name: 'Gerar gráfica (1 SKU)' });
    expect(gerar).toBeEnabled();
    fireEvent.click(gerar);

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[1]],
        expect.objectContaining({ mode: 'graphic' }),
      );
    });
  });

  it('envia o perfil físico informado para o gerador couchê', async () => {
    await importar();
    selecionar('34', '35', '36');

    fireEvent.click(screen.getByText('Medidas do arquivo de duas colunas para a gráfica'));
    fireEvent.change(screen.getByLabelText('Vão entre colunas (mm)'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Margem esquerda (mm)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirmo que estas medidas correspondem ao arquivo solicitado pela gráfica.',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (3 SKUs)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        ROWS,
        expect.objectContaining({
          mode: 'graphic',
          coucheProfile: expect.objectContaining({ columnGapMm: 2.5, leftMarginMm: 1 }),
        }),
      );
    });
  });

  it('bloqueia ações enquanto troca o arquivo e mantém somente a leitura mais recente', async () => {
    const view = await importar();
    const primeira = deferred<BabyNalinRow[]>();
    const segunda = deferred<BabyNalinRow[]>();
    mocks.parseClientOrderFile
      .mockReturnValueOnce(primeira.promise)
      .mockReturnValueOnce(segunda.promise);
    const input = view.container.querySelector<HTMLInputElement>('#client-order-upload')!;

    fireEvent.change(input, {
      target: { files: [new File(['a'], 'primeiro.csv', { type: 'text/csv' })] },
    });

    expect(screen.getByRole('button', { name: 'Lendo novo arquivo…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Gerar L42PRO/ })).toBeDisabled();

    // Simula dois eventos do seletor entregues quase juntos pelo browser.
    input.disabled = false;
    fireEvent.change(input, {
      target: { files: [new File(['b'], 'segundo.csv', { type: 'text/csv' })] },
    });
    segunda.resolve([ROWS[2]]);

    await waitFor(() => {
      expect(screen.getByText(/1 no arquivo · segundo.csv/)).toBeInTheDocument();
    });

    primeira.resolve([ROWS[0], ROWS[1]]);
    await waitFor(() => {
      expect(screen.queryByText(/primeiro.csv/)).not.toBeInTheDocument();
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('primeiro.csv'));
  });

  it('congela arquivo e configurações durante a geração', async () => {
    await importar();
    selecionar('34', '35', '36');
    const logo = deferred<null>();
    mocks.loadLogoDataUrl.mockReturnValueOnce(logo.promise);

    confirmarPerfilCouche();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar L42PRO (864 etiquetas)' }));

    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trocar arquivo' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', {
      name: 'Quantidade a imprimir do SKU NL02, tamanho 34',
    })).toBeDisabled();

    logo.resolve(null);
    await waitFor(() => expect(mocks.buildBabyNalinPdf).toHaveBeenCalled());
  });

  it('mantém a L42PRO independente e exige confirmação apenas no arquivo da gráfica', async () => {
    await importar();
    selecionar('34', '35', '36');

    expect(screen.getByRole('button', { name: 'Gerar L42PRO (864 etiquetas)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (3 SKUs)' })).toBeEnabled();

    fireEvent.click(screen.getByText('Medidas do arquivo de duas colunas para a gráfica'));
    fireEvent.change(screen.getByLabelText('Vão entre colunas (mm)'), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: 'Gerar L42PRO (864 etiquetas)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (3 SKUs)' })).toBeDisabled();
    expect(screen.getByText(/Medidas da gráfica alteradas/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirmo que estas medidas correspondem ao arquivo solicitado pela gráfica.',
    }));
    expect(screen.getByRole('button', { name: 'Gerar L42PRO (864 etiquetas)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (3 SKUs)' })).toBeEnabled();
  });

  it('calcula grandes quantidades sem expandir e protege o navegador', async () => {
    await importar([{ ...ROWS[0], quantidade: MAX_PDF_LABELS + 1 }]);
    selecionar('34');

    expect(screen.getByText(/Divida o pedido em arquivos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Gerar L42PRO (${MAX_PDF_LABELS + 1} etiquetas)` })).toBeDisabled();
  });

  it('regressão: selecionar apenas o 36 cappuccino gera somente suas 288 etiquetas', async () => {
    const cappuccino36 = {
      ...ROWS[2],
      cor: 'CAPPUCCINO',
      quantidade: 288,
    };
    const outras = Array.from({ length: 20 }, (_, index) => ({
      ...ROWS[index % ROWS.length],
      referencia: `REF${String(index).padStart(2, '0')}`,
      cor: index < 6 ? 'CAPPUCCINO' : 'PRETO',
      tamanho: String(20 + index),
      codigoBarra: `22600003${String(index).padStart(5, '0')}`,
      quantidade: 144,
    }));
    await importar([...outras, cappuccino36]);

    const busca = screen.getByPlaceholderText('Buscar no arquivo por referência, cor, tamanho ou código…');
    fireEvent.change(busca, { target: { value: 'cappuccino 36' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /CAPPUCCINO, tamanho 36,/i }));

    expect(screen.getByText('1/21')).toBeInTheDocument();
    expect(screen.getByText('288 etiquetas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar L42PRO (288 etiquetas)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar L42PRO (288 etiquetas)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [cappuccino36],
        expect.objectContaining({ mode: 'production', repeatByQuantity: true }),
      );
    });
  });
});
