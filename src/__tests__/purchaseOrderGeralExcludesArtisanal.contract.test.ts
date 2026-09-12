import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const page = read('src/pages/PurchaseOrders.tsx');
const hook = read('src/hooks/usePurchaseOrders.ts');
const domain = read('src/lib/perPvPurchasing.ts');

describe('Lista Geral de OC — canal artesanal fica na aba própria', () => {
  it('esconde strap_demand da lista Geral e aponta para Demandas automáticas', () => {
    expect(page).toContain('isArtisanalStrapPurchaseOrder(o)');
    expect(page).toContain('if (isArtisanalStrapPurchaseOrder(o)) return false;');
    expect(page).toContain("value: 'automaticas'");
    expect(page).toContain('badge: strapDemandPendingCount');
    expect(page).toContain('abrir aba →');
    expect(page).toContain('ARTISANAL_PURCHASE_ORDER_GENERIC_CHANNEL_ERROR');
    expect(page).toContain('Demandas automáticas');
    expect(page.indexOf('isArtisanalStrapPurchaseOrder(o)) return false'))
      .toBeLessThan(page.indexOf('geralOrders.filter'));
  });

  it('não manda OC artesanal para execute_purchase_order_command', () => {
    expect(domain).toContain("po.source_type === 'strap_demand'");
    expect(domain).toContain('ARTISANAL_PURCHASE_ORDER_GENERIC_CHANNEL_ERROR');
    expect(hook).toContain('isArtisanalStrapPurchaseOrder(current)');
    expect(hook).toContain('isArtisanalStrapPurchaseOrder(po)');
    expect(hook).toContain('ARTISANAL_PURCHASE_ORDER_GENERIC_CHANNEL_ERROR');
    expect(page).toContain('filter(id => !artisanalIds.has(id))');
  });
});
