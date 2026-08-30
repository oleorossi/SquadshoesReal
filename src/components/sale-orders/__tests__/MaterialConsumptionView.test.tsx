import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';

vi.mock('@/lib/printPdf', () => ({
  openPrintTab: vi.fn(() => null),
  printHtmlAsPdf: vi.fn(async () => true),
}));

/**
 * Smoke da tela de Consumo reformulada (buy-first, 05/08/2026).
 *
 * O typecheck não pega nada disto: se a coluna "Falta" mostrar o consumo em vez
 * da subtração, se o filtro trouxer só parte das linhas de um item, ou se a
 * grade do solado abrir sem o estoque, o app compila igual. Estes testes travam
 * o comportamento que a reformulação prometeu.
 */
const row = (o: Partial<ConsumptionRow>): ConsumptionRow => ({
  componentType: 'Palmilha',
  groupName: 'PALMILHA',
  materialName: 'EVA 3MM',
  color: 'PRETO',
  productUnit: 'm',
  totalQuantity: 5.08,
  available: 0,
  ...o,
} as ConsumptionRow);

/** Linhas do print do PV-00151 + um solado com falta concentrada em 2 números. */
const ROWS: ConsumptionRow[] = [
  row({}),
  row({ materialName: 'PALMILHA: OURO LIGHT', color: 'OURO LIGHT', totalQuantity: 10.16 }),
  row({ componentType: 'Forração Palmilha', groupName: 'NAPA SOFT', materialName: 'Forração Palmilha', color: 'OFF WHITE', totalQuantity: 1, available: 0 }),
  row({ componentType: 'Forração Palmilha', groupName: 'NAPA SOFT', materialName: 'Forração Palmilha', color: 'PRETO', totalQuantity: 1, available: 5.01 }),
  row({
    componentType: 'Solado', groupName: 'SOLADO 01', materialName: 'Solado', color: 'PRETO',
    productUnit: 'par', totalQuantity: 198, soleProductId: 'p-solado-01',
    sizeBreakdown: { '35': 90, '36': 108 },
    soleSizeStock: { '35': 12, '36': 0 },
  }),
];

const renderView = (props: Partial<Parameters<typeof MaterialConsumptionView>[0]> = {}) =>
  render(
    <MemoryRouter>
      <MaterialConsumptionView
        rows={ROWS}
        artisanalStrapRows={[]}
        title="Consumo de Materiais — PV-00151"
        {...props}
      />
    </MemoryRouter>,
  );

describe('MaterialConsumptionView — tela buy-first', () => {
  it('lidera com o material base a comprar e a contagem de faltas', () => {
    renderView();
    // NAPA SOFT: 1,00 (OFF WHITE) + 1,00 (PRETO) = 2,00 m de napa. Palmilha/EVA
    // e solado não são material base e ficam fora do herói.
    const hero = screen.getByText('Necessidade de material base').closest('div')!;
    expect(hero).toHaveTextContent('2,00');
    expect(hero).toHaveTextContent('NAPA SOFT');
    // 4 itens em falta: EVA, OURO LIGHT, NAPA SOFT OFF WHITE e o solado.
    const faltaCard = screen.getByRole('button', { name: 'Ver itens em falta' });
    expect(within(faltaCard).getByText('4')).toBeInTheDocument();
  });

  it('mostra QUANTO falta, não só o selo — inclusive no solado por numeração', () => {
    renderView();
    // Antes existia só "falta" sem número; a coluna Falta é a novidade.
    expect(screen.getByRole('columnheader', { name: 'Falta' })).toBeInTheDocument();
    // (90−12) + (108−0) = 186 pares, ignorando sobra de outros números.
    const soles = screen.getByRole('region', { name: 'Solados por numeração' });
    expect(within(soles).getByText(/186 par/)).toBeInTheDocument();
    expect(within(soles).getByText(/Falta em 2 números/i)).toBeInTheDocument();
  });

  it('mantém a grade do solado aberta no topo com necessidade, estoque e falta por número', () => {
    renderView();
    const soles = screen.getByRole('region', { name: 'Solados por numeração' });
    expect(within(soles).getByText(/Mapa de solados/i)).toBeInTheDocument();
    const grade = within(soles).getByText('Numeração').closest('table')!;
    // O estoque por número era invisível antes (só no `title` da célula).
    expect(within(grade).getByText('Necessidade')).toBeInTheDocument();
    expect(within(grade).getByText('Estoque útil')).toBeInTheDocument();
    expect(within(grade).getByText('Falta')).toBeInTheDocument();
    // 90 necessários, 12 em estoque, 78 faltando no 35.
    expect(within(grade).getByText('78')).toBeInTheDocument();
  });

  it('destaca solado não resolvido como cadastro incompleto, nunca como grade coberta', () => {
    renderView({
      rows: [row({
        componentType: 'Solado',
        groupName: 'Solado Ricardo Tratorado',
        materialName: 'Solado',
        productUnit: 'par',
        totalQuantity: 80,
        sizeBreakdown: { '34': 20, '35': 20, '36': 20, '37': 20 },
        soleProductId: null,
        warning: 'Solado não resolve produto ativo no estoque — não será reservado nem debitado.',
      })],
    });

    const soles = screen.getByRole('region', { name: 'Solados por numeração' });
    expect(within(soles).getByText('Cadastro incompleto')).toBeInTheDocument();
    expect(within(soles).getByText(/não será reservado nem debitado/i)).toBeInTheDocument();
    expect(within(soles).queryByText('Grade coberta')).not.toBeInTheDocument();
    expect(within(soles).queryByText(/Comprar 80/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver itens em falta' })).toHaveTextContent('0');
  });

  it('o filtro "Em falta" esconde o que está coberto', async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText('OURO LIGHT')).toBeInTheDocument();
    expect(screen.getAllByText('PRETO').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^Em falta/i }));
    // NAPA SOFT PRETO tem 5,01 em estoque pra 1,00 de consumo → sai da lista.
    expect(screen.getByText(/mostrando 4 de 5/)).toBeInTheDocument();
    expect(screen.getByText('OURO LIGHT')).toBeInTheDocument();
  });

  it('a busca filtra por material, aplicação ou cor', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByLabelText(/Buscar material/i), 'ouro');
    expect(screen.getByText(/mostrando 1 de 5/)).toBeInTheDocument();
  });

  it('a busca também encontra o componente (Cabedal, Solado…)', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByLabelText(/Buscar material/i), 'solado');
    expect(screen.getByText(/mostrando 1 de 5/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Solados por numeração' })).getByText('SOLADO 01')).toBeInTheDocument();
    expect(screen.queryByText('OURO LIGHT')).not.toBeInTheDocument();
  });

  it('os totais da barra acompanham o filtro — Napa esconde par e palmilha', async () => {
    const user = userEvent.setup();
    renderView();
    // Sem filtro a barra soma tudo, inclusive o solado em pares.
    expect(screen.getByText('5 itens')).toBeInTheDocument();
    expect(screen.getAllByText('198').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^Napa/i }));
    expect(screen.getByRole('button', { name: /mostrando 2 de 5 · de napa/i })).toBeInTheDocument();
    expect(screen.getByText('2 itens de 5')).toBeInTheDocument();
    // O recorte vale para a tabela/totais. O mapa prioritário de solados não
    // pode desaparecer por causa de um filtro de materiais gerais.
    expect(screen.getByRole('region', { name: 'Solados por numeração' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Materiais gerais' });
    expect(within(table).queryByText('OURO LIGHT')).not.toBeInTheDocument();
    expect(within(table).queryByText('SOLADO 01')).not.toBeInTheDocument();
    expect(within(table).getByText('OFF WHITE')).toBeInTheDocument();
  });

  it('Napa combina com Em falta — não desliga o recorte de status', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /^Em falta/i }));
    await user.click(screen.getByRole('button', { name: /^Napa/i }));
    // Das 2 napas, só OFF WHITE está em falta (PRETO tem 5,01 p/ 1,00).
    expect(screen.getByRole('button', { name: /mostrando 1 de 5 · em falta · de napa/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Em falta/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Napa/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('estoque compartilhado não pinta de verde uma linha de item em falta', async () => {
    const user = userEvent.setup();
    const shared: ConsumptionRow[] = [
      row({
        componentType: 'Forração', groupName: 'NAPA SOFT', materialName: 'Forração',
        color: 'PRETO', totalQuantity: 2, available: 5, productUnit: 'm',
      }),
      row({
        componentType: 'Forração Palmilha', groupName: 'NAPA SOFT', materialName: 'Forração Palmilha',
        color: 'PRETO', totalQuantity: 4, available: 5, productUnit: 'm',
      }),
    ];
    renderView({ rows: shared });
    // Linha a linha as duas cabem em 5; juntas pedem 6 → 1 item em falta.
    await user.click(screen.getByRole('button', { name: /^Em falta/i }));
    expect(screen.getByText(/mostrando 2 de 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Forração Palmilha').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('em estoque')).not.toBeInTheDocument();
  });

  it('“Gerar OC” só aparece quando o escopo sabe gerar', async () => {
    const onGerarOC = vi.fn();
    const { unmount } = renderView();
    expect(screen.queryByRole('button', { name: /Gerar OC/i })).not.toBeInTheDocument();
    unmount();

    renderView({ onGerarOC });
    await userEvent.setup().click(screen.getByRole('button', { name: /Gerar OC/i }));
    expect(onGerarOC).toHaveBeenCalledOnce();
  });

  it('gera um PDF real no servidor em vez de usar a impressão solta do navegador', async () => {
    renderView();
    await userEvent.setup().click(screen.getByRole('button', { name: /Gerar PDF/i }));
    expect(openPrintTab).toHaveBeenCalledOnce();
    expect(printHtmlAsPdf).toHaveBeenCalledWith(
      expect.stringContaining('Consumo de Materiais — PV-00151'),
      expect.objectContaining({ filename: 'consumo-de-materiais-pv-00151' }),
    );
  });

  it('cadastro incompleto vira UM cartão recolhido, não três banners de prosa', () => {
    renderView({
      rows: [...ROWS, row({ groupName: 'TIRA STRASS 6MM', totalQuantity: 508, widthMissing: true })],
    });
    expect(screen.getByText('Cadastro incompleto')).toBeInTheDocument();
    // O texto explicativo existe, mas RECOLHIDO — não ocupa a dobra.
    expect(screen.queryByText(/Sem largura cadastrada/)).not.toBeInTheDocument();
    expect(screen.getByText(/Por que ficam fora do total/)).toBeInTheDocument();
  });

  it('mostra a quantidade prevista da tira sem tratá-la como falta', () => {
    renderView({
      rows: [row({
        componentType: 'Tiras',
        groupName: 'TIRA CHATA 8MM',
        materialName: 'Tira 1',
        color: 'CAPUCCINO',
        totalQuantity: 0,
        previewQuantity: 17.25,
        warning: 'Quantidade ainda não liberada para estoque.',
      })],
    });

    expect(screen.getByText('≈ 17,25')).toBeInTheDocument();
    expect(screen.getByText('prévia calculada pela ficha')).toBeInTheDocument();
    expect(screen.queryByText(/faltam 17,25/i)).not.toBeInTheDocument();
  });

  it('tira artesanal conferida não entra como falta de 1.402 m — o motor compra napa', () => {
    renderView({
      rows: [
        row({
          componentType: 'Forração Palmilha',
          groupName: 'NAPA SOFT',
          materialName: 'Forração Palmilha',
          color: 'NEW WHISKY',
          totalQuantity: 20.21,
          available: 0,
          productIds: ['napa-new-whisky'],
        }),
        row({
          componentType: 'Tiras',
          groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
          materialName: 'Produção interna',
          color: 'NEW WHISKY',
          totalQuantity: 1402.8,
          available: 0,
          productIds: ['tira-overlock-new-whisky'],
          baseProductId: 'napa-new-whisky',
          artisanal: { baseName: 'NAPA SOFT', baseQty: 20.04, yieldPerMeter: 70 },
        }),
      ],
    });

    expect(screen.getByText('prod. interna')).toBeInTheDocument();
    expect(screen.getByText('1.402,80')).toBeInTheDocument();
    const faltaCard = screen.getByRole('button', { name: 'Ver itens em falta' });
    expect(within(faltaCard).getByText('1')).toBeInTheDocument();
    expect(screen.getAllByText(/40,25/).length).toBeGreaterThan(0);
  });

  it('no diálogo não repete o título do chrome no herói', () => {
    renderView({ embedded: true });
    expect(screen.queryByRole('heading', { name: /Consumo de Materiais — PV-00151/i })).not.toBeInTheDocument();
    expect(screen.getByText('Necessidade de material base')).toBeInTheDocument();
  });
});
