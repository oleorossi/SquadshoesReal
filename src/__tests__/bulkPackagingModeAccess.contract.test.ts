import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const saleOrders = readFileSync(resolve(ROOT, 'src/pages/SaleOrders.tsx'), 'utf8');
const saleOrderForm = readFileSync(resolve(ROOT, 'src/pages/SaleOrderForm.tsx'), 'utf8');
const mobileNew = readFileSync(resolve(ROOT, 'src/pages/mobile/MobileNewOrder.tsx'), 'utf8');
const bulkLib = readFileSync(resolve(ROOT, 'src/lib/bulkPackagingMode.ts'), 'utf8');

describe('embalagem em lote na lista de Pedidos', () => {
  it('expõe Embalagem como ação primária da seleção (não só em Mais)', () => {
    const bulkBar = saleOrders.slice(
      saleOrders.indexOf('<BulkActionsBar'),
      saleOrders.indexOf('{/* Preview + Emit NF-e'),
    );
    const primaryActions = bulkBar.slice(0, bulkBar.indexOf('secondaryActions={['));
    const secondaryActions = bulkBar.slice(bulkBar.indexOf('secondaryActions={['));

    expect(primaryActions).toContain("label: 'Embalagem'");
    expect(primaryActions).toContain('setBulkPackagingOpen(true)');
    expect(secondaryActions).not.toContain("label: 'Embalagem'");
  });

  it('não esconde Embalagem atrás de canEditPv (acesso = Pedidos)', () => {
    const bulkBar = saleOrders.slice(
      saleOrders.indexOf('<BulkActionsBar'),
      saleOrders.indexOf('{/* Preview + Emit NF-e'),
    );
    const primaryActions = bulkBar.slice(0, bulkBar.indexOf('secondaryActions={['));
    const embalagemBlock = primaryActions.slice(
      primaryActions.indexOf("label: 'Embalagem'"),
      primaryActions.indexOf("label: 'Etiqueta Individual'"),
    );
    expect(embalagemBlock).not.toContain('canEditPv');
  });

  it('dialog avisa cancelamento de OP avançada e usa o helper canônico', () => {
    expect(saleOrders).toContain('Alterar embalagem em lote');
    expect(saleOrders).toContain('applyBulkPackagingModeChange');
    expect(saleOrders).toContain('PACKAGING_MODE_CANONICAL');
    expect(bulkLib).toContain("rpc('set_sale_order_packaging_mode'");
    expect(bulkLib).toContain('stripForbiddenUpdateHeaderFields');
    expect(bulkLib).toContain('UPDATE_HEADER_FORBIDDEN_KEYS');
    expect(bulkLib).toContain("'factoring_config_id'");
    expect(bulkLib).toContain("'delivery_month'");
    expect(bulkLib).toContain('BULK_PACKAGING_ADVANCED_OP_STATUSES');
  });

  it('PV novo nasce Individual + Fitilho (desktop e mobile)', () => {
    expect(saleOrderForm).toContain("packaging_mode: 'individual_fitilho'");
    expect(saleOrderForm).toContain("order.packaging_mode || 'individual_fitilho'");
    expect(mobileNew).toContain("packaging_mode: 'individual_fitilho'");
    expect(saleOrderForm).not.toMatch(/packaging_mode:\s*'colmeia'/);
  });
});
