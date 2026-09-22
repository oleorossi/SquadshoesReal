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

  it('bulk status serializa e mostra progresso N/M', () => {
    expect(SALE_ORDERS).toContain('for (let index = 0; index < ids.length; index += 1)');
    expect(SALE_ORDERS).toContain('toast.loading');
    expect(SALE_ORDERS).toContain('setBulkStatusProgress');
    expect(SALE_ORDERS).toContain('Atualizando ${done}/${ids.length}');
    // Anti-deadlock: não volta a Promise.allSettled no loop de status.
    const bulkFn = SALE_ORDERS.slice(
      SALE_ORDERS.indexOf('const handleBulkStatusChange'),
      SALE_ORDERS.indexOf('const handleBulkUpdateDelivery'),
    );
    expect(bulkFn).not.toContain('Promise.allSettled(ids.map');
  });

  it('fila compensatória em bulk (não sobrescreve o último PV)', () => {
    expect(SALE_ORDERS).toContain('compensatoryCancelTargets');
    expect(SALE_ORDERS).toContain('setCompensatoryCancelTargets');
    expect(SALE_ORDERS).toContain('current.slice(1)');
  });
});
