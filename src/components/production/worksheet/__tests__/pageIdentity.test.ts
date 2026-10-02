import { describe, expect, it } from 'vitest';
import {
  formatPageIdentityLine,
  normalizePageIdentity,
  pageIdentityEntryKey,
  pageIdentityForOps,
  pageIdentityFromLists,
} from '@/components/production/worksheet/pageIdentity';
import {
  HEADER_BAND_MIN_PX,
  PAGE_CAPACITY_PX,
  pageContentCapacityPx,
} from '@/components/production/worksheet/pageGeometry';

describe('pageIdentity', () => {
  it('normalize deduplica e ordena por PV', () => {
    const id = normalizePageIdentity('Corte Cabedal', [
      { pvNumber: 'PV-00200', opNumber: 'OP-2', clientName: 'B' },
      { pvNumber: 'PV-00198', opNumber: 'OP-1', clientName: 'A', clientOrderNumber: 'PO-9' },
      { pvNumber: 'PV-00198', opNumber: 'OP-1', clientName: 'A', clientOrderNumber: 'PO-9' },
    ]);
    expect(id.sector).toBe('Corte Cabedal');
    expect(id.entries).toHaveLength(2);
    expect(id.entries[0].pvNumber).toBe('PV-00198');
    expect(id.entries[1].pvNumber).toBe('PV-00200');
  });

  it('includeOp:false zera OP (Relatório Gerencial)', () => {
    const id = normalizePageIdentity('Relatório Gerencial', [
      { pvNumber: 'PV-00198', opNumber: 'OP-9', clientName: 'VIA Z', clientOrderNumber: 'X' },
    ], { includeOp: false });
    expect(id.entries[0].opNumber).toBeNull();
    expect(formatPageIdentityLine(id.entries[0])).toBe('X · PV-00198 · VIA Z');
  });

  it('formatPageIdentityLine inclui pedido cliente + PV + OP + razão', () => {
    expect(formatPageIdentityLine({
      clientOrderNumber: 'PO-1',
      pvNumber: 'PV-00198',
      opNumber: 'OP-2026-0001',
      clientName: 'VIA Z',
    })).toBe('PO-1 · PV-00198 · OP-2026-0001 · VIA Z');
  });

  it('pageIdentityForOps resolve meta pelo lookup', () => {
    const byOp = new Map([
      ['OP-1', {
        opNumber: 'OP-1',
        pvNumber: 'PV-00198',
        clientOrderNumber: 'PO-A',
        clientName: 'VIA Z',
      }],
      ['OP-2', {
        opNumber: 'OP-2',
        pvNumber: 'PV-00199',
        clientOrderNumber: null,
        clientName: 'NORTE',
      }],
    ]);
    const id = pageIdentityForOps('Aviamento', ['OP-2', 'OP-1', 'OP-1'], byOp);
    expect(id.entries).toHaveLength(2);
    expect(id.entries[0].pvNumber).toBe('PV-00198');
    expect(id.entries[0].clientOrderNumber).toBe('PO-A');
    expect(id.entries[1].opNumber).toBe('OP-2');
  });

  it('pageIdentityFromLists emite PVs quando não há pairing', () => {
    const id = pageIdentityFromLists({
      sector: 'Solagem',
      pvNumbers: ['PV-00199', 'PV-00198'],
      opNumbers: ['OP-1'],
      clientNames: ['VIA Z'],
      clientOrderByPv: new Map([['PV-00198', 'PO-1']]),
    });
    expect(id.entries.some((e) => e.pvNumber === 'PV-00198' && e.clientOrderNumber === 'PO-1')).toBe(true);
    expect(id.entries.some((e) => e.opNumber === 'OP-1')).toBe(true);
  });

  it('entryKey distingue OP e pedido cliente', () => {
    expect(pageIdentityEntryKey({ pvNumber: 'PV-1', opNumber: 'A' }))
      .not.toBe(pageIdentityEntryKey({ pvNumber: 'PV-1', opNumber: 'B' }));
  });
});

describe('pageContentCapacityPx', () => {
  it('piso = PAGE_CAPACITY_PX quando head = HEADER_BAND_MIN', () => {
    expect(pageContentCapacityPx(HEADER_BAND_MIN_PX)).toBeCloseTo(PAGE_CAPACITY_PX, 5);
  });

  it('head maior reduz capacidade', () => {
    const taller = pageContentCapacityPx(HEADER_BAND_MIN_PX + 40);
    expect(taller).toBeLessThan(PAGE_CAPACITY_PX);
    expect(taller).toBeCloseTo(PAGE_CAPACITY_PX - 40, 5);
  });
});
