import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SALE_ORDERS = readFileSync(resolve(ROOT, 'src/pages/SaleOrders.tsx'), 'utf8');

describe('SaleOrders cancel/bulk UX (fase 2)', () => {
  it('Select/bulk de cancel roteiam compensatório via shouldOfferAdminCompensatoryCancel', () => {
    expect(SALE_ORDERS).toContain('shouldOfferAdminCompensatoryCancel');
    expect(SALE_ORDERS).toContain('AdminCompensatoryCancelDialog');
    expect(SALE_ORDERS).toContain('SaleOrderReadinessCorrectionDialog');
    // Não abrir compensatório só com hasPhysicalFactBlockers (mistura com NF-e).
    expect(SALE_ORDERS).not.toMatch(
      /isAdmin\s*&&\s*isCancelPath\s*&&\s*hasPhysicalFactBlockers/,
    );
  });

  it('bulk status enfileira em paralelo (worker serializa a materialização)', () => {
    expect(SALE_ORDERS).toContain('Promise.allSettled');
    expect(SALE_ORDERS).toContain('toast.loading');
    expect(SALE_ORDERS).toContain('setBulkStatusProgress');
    expect(SALE_ORDERS).toContain('Enfileirando');
    const bulkFn = SALE_ORDERS.slice(
      SALE_ORDERS.indexOf('const handleBulkStatusChange'),
      SALE_ORDERS.indexOf('const handleBulkUpdateDelivery'),
    );
    // Anti-deadlock migrou pro worker: browser pode enfileirar em paralelo.
    expect(bulkFn).toContain('Promise.allSettled');
    expect(bulkFn).not.toContain('Atualizando ${done}/${ids.length}');
  });

  it('fila compensatória em bulk (não sobrescreve o último PV)', () => {
    expect(SALE_ORDERS).toContain('compensatoryCancelTargets');
    expect(SALE_ORDERS).toContain('setCompensatoryCancelTargets');
    expect(SALE_ORDERS).toContain('current.slice(1)');
  });
});
