import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import type { ConsumptionRow } from '@/lib/consumptionRows';

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
    productUnit: 'par', totalQuantity: 198,
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
    const hero = screen.getByText('Material base a comprar').closest('div')!;
    expect(hero).toHaveTextContent('2,00');
    expect(hero).toHaveTextContent('NAPA SOFT');
    // 4 itens em falta: EVA, OURO LIGHT, NAPA SOFT OFF WHITE e o solado.
    const faltaCard = screen.getByText('Itens em falta').closest('div')!;
    expect(within(faltaCard).getByText('4')).toBeInTheDocument();
  });

  it('mostra QUANTO falta, não só o selo — inclusive no solado por numeração', () => {
    renderView();
    // Antes existia só "falta" sem número; a coluna Falta é a novidade.
    expect(screen.getByRole('columnheader', { name: 'Falta' })).toBeInTheDocument();
    // (90−12) + (108−0) = 186 pares, ignorando sobra de outros números.
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getByText(/em 2 nº/)).toBeInTheDocument();
  });

  it('abre a grade do solado com necessidade, estoque e falta por número', async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.queryByText('Numeração')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Abrir grade por numeração/i }));
    const grade = screen.getByText('Numeração').closest('table')!;
    // O estoque por número era invisível antes (só no `title` da célula).
    expect(within(grade).getByText('Necessidade')).toBeInTheDocument();
    expect(within(grade).getByText('Em estoque')).toBeInTheDocument();
    expect(within(grade).getByText('Falta')).toBeInTheDocument();
    // 90 necessários, 12 em estoque, 78 faltando no 35.
    expect(within(grade).getByText('78')).toBeInTheDocument();
  });

  it('o filtro "Em falta" esconde o que está coberto', async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText('OURO LIGHT')).toBeInTheDocument();
    expect(screen.getAllByText('PRETO').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Em falta/i }));
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

  it('“Gerar OC” só aparece quando o escopo sabe gerar', async () => {
    const onGerarOC = vi.fn();
    const { unmount } = renderView();
    expect(screen.queryByRole('button', { name: /Gerar OC/i })).not.toBeInTheDocument();
    unmount();

    renderView({ onGerarOC });
    await userEvent.setup().click(screen.getByRole('button', { name: /Gerar OC/i }));
    expect(onGerarOC).toHaveBeenCalledOnce();
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
});
