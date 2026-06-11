import { describe, it, expect } from 'vitest';
import { buildSaleOrderPrintHtml } from '@/lib/printOrder';

/**
 * Guarda o PDF do PV: identidade da empresa, bloco do cliente completo,
 * AGRUPAMENTO POR REFERÊNCIA (cada cor é sub-linha + subtotal da ref) e o
 * resumo com frete/total. A grade BASE (1 ficha) tem que escalar p/ a qtd
 * real (largest-remainder) — igual à tela do PV e à OP.
 */
describe('buildSaleOrderPrintHtml', () => {
  const order = {
    order_number: 'PV-00231', status: 'Aprovado', created_at: '2026-06-11T12:00:00Z',
    client_name: 'Calçados Bela Vista LTDA', client_cnpj: '12345678000199',
    representative: 'João Vendedor', payment_condition: '30/60/90 dias',
    delivery_deadline: '2026-07-15', valor_frete: 480.5, total: 0,
    notes: 'Entregar paletizado.', client_id: 'c1',
  };
  const company = { razao_social: 'Squad Shoes LTDA', nome_fantasia: 'Squad Shoes', cnpj: '44556677000188' };
  const client = {
    razao_social: 'Calçados Bela Vista LTDA', cnpj: '12345678000199',
    inscricao_estadual: '0961234567', endereco: 'Av. Brasil', numero: '450',
    cidade: 'Novo Hamburgo', estado: 'RS', cep: '93310010',
  };
  // DS05 tem 2 cores (Café 12 + Preto 24 = 36) → deve agrupar e mostrar subtotal.
  const items = [
    { reference_id: 'r1', color: 'Preto', unit_price: 89.9, quantity: 24,
      grade: { '34': 1, '35': 2, '36': 3, '37': 3, '38': 2, '39': 1 }, // base soma 12
      technical_sheets: { code: 'DS05', name: 'Derby Slip-On' } },
    { reference_id: 'r1', color: 'Café', unit_price: 89.9, quantity: 12,
      grade: { '34': 1, '35': 2, '36': 3, '37': 3, '38': 2, '39': 1 },
      technical_sheets: { code: 'DS05', name: 'Derby Slip-On' } },
    { reference_id: 'r2', color: 'Branco', unit_price: 64.5, quantity: 36,
      grade: { '33': 2, '34': 3, '35': 4, '36': 4, '37': 3, '38': 2 },
      technical_sheets: { code: 'TR002', name: 'Tênis Runner' } },
  ];

  it('renderiza identidade da empresa e bloco do cliente completo', async () => {
    const html = await buildSaleOrderPrintHtml(order, items, [], { company, client });
    expect(html).toContain('Squad Shoes');
    expect(html).toContain('44.556.677/0001-88');        // CNPJ formatado
    expect(html).toContain('0961234567');                 // inscrição estadual
    expect(html).toContain('93310-010');                  // CEP formatado
    expect(html).toContain('Av. Brasil, 450');            // endereço + número
    expect(html).toContain('PV-00231');
    expect(html).toContain('João Vendedor');
  });

  it('agrupa itens por referência com subtotal por cor', async () => {
    const html = await buildSaleOrderPrintHtml(order, items, [], { company, client });
    // DS05 aparece UMA vez como cabeçalho de bloco (não repetido por cor)
    expect(html.match(/ref-code">DS05/g)?.length).toBe(1);
    expect(html).toContain('Café');
    expect(html).toContain('Preto');
    expect(html).toContain('Subtotal ref.');  // bloco multi-cor mostra subtotal
    // TR002 tem só 1 cor → SEM linha de subtotal própria do bloco
    expect(html.match(/ref-code">TR002/g)?.length).toBe(1);
  });

  it('escala a grade base p/ a qtd real e soma totais com frete', async () => {
    const html = await buildSaleOrderPrintHtml(order, items, [], { company, client });
    // Total de pares = 24 + 12 + 36 = 72
    expect(html).toContain('<b>72</b> pares');
    // Subtotal itens = 24*89.9 + 12*89.9 + 36*64.5 = 3236.40 + 2322.00 = 5558.40
    expect(html).toContain('R$ 5.558,40');
    // Total geral = subtotal + frete (480.50) = 6038.90
    expect(html).toContain('R$ 6.038,90');
  });

  it('não quebra sem company/client (fallback p/ campos do pedido)', async () => {
    const html = await buildSaleOrderPrintHtml(order, items, []);
    expect(html).toContain('Squad Shoes');               // fallback do nome
    expect(html).toContain('Calçados Bela Vista LTDA');  // order.client_name
  });
});
