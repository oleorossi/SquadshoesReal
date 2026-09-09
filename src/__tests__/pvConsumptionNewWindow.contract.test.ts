import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const saleOrders = read('src/pages/SaleOrders.tsx');
const panel = read('src/components/sale-orders/SummaryConsumptionPanel.tsx');
const pvConsumption = read('src/lib/pvConsumption.ts');

describe('Consumo de materiais — mesma aba + filtro por item', () => {
  it('abre a tela cheia na mesma aba em vez de nova janela ou diálogo de prévia', () => {
    expect(saleOrders).toContain('openPvConsumption');
    expect(saleOrders).toContain('navigate(pvConsumptionPath(unique))');
    expect(saleOrders).not.toContain("window.open(pvConsumptionPath(unique)");
    expect(saleOrders).not.toContain('sale-orders/OrderConsumptionDialog');
    expect(saleOrders).not.toContain('setConsumoDialog');
    expect(saleOrders).not.toContain('consumoDialog');
  });

  it('reescopa o report canônico por sale_order_item_id sem nova RPC', () => {
    expect(pvConsumption).toContain('materializePvConsumptionScope');
    // Escopo por 1..N itens: Set com sale_order_item_id(s).
    expect(pvConsumption).toMatch(/new Set\(ids\)/);
    expect(pvConsumption).toMatch(
      /materializeCanonicalConsumptionReport\(\s*report\s*,\s*scopeKeys/,
    );
    expect(panel).toContain("searchParams.get('item')");
    expect(panel).toContain('materializePvConsumptionScope');
    expect(panel).toContain('itemOptions');
    expect(panel).toContain('selectedItemIds');
  });
});
