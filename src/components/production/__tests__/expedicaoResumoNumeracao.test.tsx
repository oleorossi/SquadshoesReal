import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExpedicaoWorkSheet, type ExpedicaoCustomerGroup } from '../ExpedicaoWorkSheet';

// PaginatedSheet mede blocos com offsetHeight, que no jsdom é sempre 0 — o
// dublê renderiza os blocos direto pra podermos afirmar sobre o CONTEÚDO.
vi.mock('../worksheet/PaginatedSheet', () => ({
  PaginatedSheet: ({ blocks }: { blocks: { node: React.ReactNode }[] }) => (
    <div>{blocks.map((b, i) => <div key={i}>{b.node}</div>)}</div>
  ),
}));

/**
 * Resumo "caixas por numeração" da ficha de Expedição (11/08/2026).
 *
 * Substitui a planilha que o dono mantinha à mão. A conta é
 * `caixas = pares_da_numeração / capacidade`, e `orders.grid` já vem
 * MULTIPLICADO (Σ = total de pares da OP) — convenção OPOSTA à de
 * `sale_order_items.grade`. Confundir as duas divide a carga por fichas de novo
 * e imprime metade das caixas.
 */
const grupo = (over: Partial<ExpedicaoCustomerGroup> = {}): ExpedicaoCustomerGroup => ({
  client_id: 'c1',
  client_name: 'LNG 10 CONFECCOES LTDA',
  sale_order_number: 'PV-00160',
  box_grouping: 'numeracao_unica',
  orders: [
    {
      id: 'op1',
      op_number: 'OP-2026-01290',
      reference_code: 'DS21',
      color: 'PALHA/PORCELANA',
      total_pairs: 288,
      pairs_per_box: 12,
      // 24 fichas × (34:1 35:2 36:2 37:3 38:2 39:1 40:1) — já multiplicado
      grid: { '34': 24, '35': 48, '36': 48, '37': 72, '38': 48, '39': 24, '40': 24 },
    },
  ],
  ...over,
});

const renderFicha = (g: ExpedicaoCustomerGroup) => render(<ExpedicaoWorkSheet group={g} />);

describe('ficha de Expedição — resumo de caixas por numeração', () => {
  it('mostra o resumo quando o pedido é numeração única', () => {
    renderFicha(grupo());
    expect(screen.getByText(/Caixas por Numeração/i)).toBeTruthy();
  });

  it('NÃO mostra no pedido tradicional — ali a caixa leva a curva inteira', () => {
    renderFicha(grupo({ box_grouping: 'grade' }));
    expect(screen.queryByText(/Caixas por Numeração/i)).toBeNull();
  });

  it('converte pares em CAIXAS pela capacidade (288 pares ÷ 12 = 24 caixas)', () => {
    renderFicha(grupo());
    const cabecalho = screen.getByText(/Caixas por Numeração/i).closest('div')!.parentElement!;
    // Total de caixas do grupo, em destaque no cabeçalho do bloco.
    expect(within(cabecalho).getByText('24')).toBeTruthy();
    expect(within(cabecalho).getByText('288')).toBeTruthy();
  });

  it('a linha do nº 37 traz 6 caixas para 72 pares — o caso da planilha do dono', () => {
    const { container } = renderFicha(grupo());
    const linhas = Array.from(container.querySelectorAll('tr'));
    const linhaCaixas = linhas.find(tr => tr.textContent?.startsWith('CAIXAS'))!;
    const linhaPares = linhas.find(tr => tr.textContent?.startsWith('PARES'))!;
    const caixas = Array.from(linhaCaixas.querySelectorAll('td')).slice(1, 8).map(td => td.textContent);
    const pares = Array.from(linhaPares.querySelectorAll('td')).slice(1, 8).map(td => td.textContent);
    expect(caixas).toEqual(['2', '4', '4', '6', '4', '2', '2']);
    expect(pares).toEqual(['24', '48', '48', '72', '48', '24', '24']);
  });

  it('sem capacidade cadastrada não inventa caixa', () => {
    const g = grupo();
    g.orders[0].pairs_per_box = null;
    const { container } = renderFicha(g);
    const linhaCaixas = Array.from(container.querySelectorAll('tr'))
      .find(tr => tr.textContent?.startsWith('CAIXAS'))!;
    const caixas = Array.from(linhaCaixas.querySelectorAll('td')).slice(1, 8).map(td => td.textContent);
    expect(caixas.every(c => c === '0')).toBe(true);
  });
});
