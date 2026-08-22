import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLabelingWorkspace } from '../ClientLabelingWorkspace';
import { clientSkuKey, type BabyNalinRow } from '@/lib/babyNalinLabels';

const mocks = vi.hoisted(() => ({
  parseClientOrderFile: vi.fn(),
  loadLogoDataUrl: vi.fn(),
  buildBabyNalinPdf: vi.fn(),
  save: vi.fn(),
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
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const ROWS: BabyNalinRow[] = [
  { tamanho: '34', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303222', quantidade: 144 },
  { tamanho: '35', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303239', quantidade: 288 },
  { tamanho: '36', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303246', quantidade: 432 },
];

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
    expect(screen.getByText(`${skuCount}/${skuCount}`)).toBeInTheDocument();
  });
  return view;
}

describe('ClientLabelingWorkspace · seleção por SKU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLogoDataUrl.mockResolvedValue(null);
    mocks.buildBabyNalinPdf.mockResolvedValue({ save: mocks.save });
  });

  it('seleciona todos ao importar e gera somente sobre os SKUs marcados', async () => {
    await importar();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' }));
    expect(screen.getByText('2/3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (2 SKUs)' }));

    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[0], ROWS[2]],
        expect.objectContaining({ mode: 'graphic', repeatByQuantity: false }),
      );
    });
    expect(mocks.save).toHaveBeenCalledWith('Artes_SKU_pedido_cliente.pdf');
  });

  it('trata linhas repetidas como o mesmo SKU e alterna todas juntas', async () => {
    const duplicadas = [ROWS[0], { ...ROWS[0], cor: ' preto ', quantidade: 12 }, ROWS[1]];
    await importar(duplicadas);

    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar SKU NL02,.*tamanho 34/i });
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);

    expect(checkboxes[0]).toHaveAttribute('data-state', 'unchecked');
    expect(checkboxes[1]).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('não deixa um código inválido fora da seleção bloquear a geração', async () => {
    const codigoLongo = { ...ROWS[1], codigoBarra: '1234567890'.repeat(6) };
    await importar([ROWS[0], codigoLongo]);

    const gerar = screen.getByRole('button', { name: 'Gerar gráfica (2 SKUs)' });
    expect(gerar).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' }));
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

    const busca = screen.getByPlaceholderText('Buscar no arquivo por referência, cor, tamanho ou código…');
    fireEvent.change(busca, { target: { value: '35' } });

    expect(screen.queryByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 34' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' }));
    fireEvent.change(busca, { target: { value: '' } });

    expect(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 34' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' })).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 36' })).toHaveAttribute('data-state', 'checked');

    fireEvent.click(screen.getByRole('button', { name: 'Gerar gráfica (2 SKUs)' }));
    await waitFor(() => {
      expect(mocks.buildBabyNalinPdf).toHaveBeenCalledWith(
        [ROWS[0], ROWS[2]],
        expect.objectContaining({ mode: 'graphic' }),
      );
    });
  });

  it('permite selecionar separadamente SKUs diferentes com o mesmo código de barras', async () => {
    await importar([ROWS[0], { ...ROWS[1], codigoBarra: ROWS[0].codigoBarra }]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' }));

    expect(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 34' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('checkbox', { name: 'Selecionar SKU NL02, PRETO, tamanho 35' })).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('desabilita as duas gerações quando nenhum SKU está selecionado', async () => {
    await importar();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Desmarcar todos os SKUs exibidos' }));

    expect(screen.getByRole('button', { name: 'Gerar produção (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gerar gráfica (0 SKUs)' })).toBeDisabled();
    expect(mocks.buildBabyNalinPdf).not.toHaveBeenCalled();
  });
});
