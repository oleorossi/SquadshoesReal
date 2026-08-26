import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const saleOrders = readFileSync(resolve(ROOT, 'src/pages/SaleOrders.tsx'), 'utf8');

describe('acesso à etiqueta individual em Pedidos de Venda', () => {
  it('mantém um atalho no cabeçalho mesmo sem PV selecionado', () => {
    const header = saleOrders.slice(
      saleOrders.indexOf('<EditorialPageHeader'),
      saleOrders.indexOf('{/* Main tabs:'),
    );

    expect(header).toContain("onClick={() => navigate('/label-system')}");
    expect(header).toContain('Etiqueta Individual');
  });

  it('mantém a etiqueta individual como ação direta da seleção, fora do menu Mais', () => {
    const bulkBar = saleOrders.slice(
      saleOrders.indexOf('<BulkActionsBar'),
      saleOrders.indexOf('{/* Preview + Emit NF-e'),
    );
    const primaryActions = bulkBar.slice(0, bulkBar.indexOf('secondaryActions={['));
    const secondaryActions = bulkBar.slice(bulkBar.indexOf('secondaryActions={['));

    expect(primaryActions).toContain("label: 'Etiqueta Individual'");
    expect(primaryActions).toContain('onClick: handleBulkLabels');
    expect(secondaryActions).not.toContain("label: 'Etiqueta Individual'");
    expect(saleOrders).toContain("params.append('sale_order', id)");
    expect(saleOrders).toContain('navigate(`/label-system?${params.toString()}`)');
  });

  it('mantém o atalho explícito no detalhe do pedido', () => {
    expect(saleOrders).toContain('navigate(`/label-system?sale_order=${selectedOrder.id}`)');
    expect(saleOrders).toContain('Etiqueta Individual');
  });
});
