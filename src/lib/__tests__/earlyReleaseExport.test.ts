import { describe, it, expect } from 'vitest';
import {
  buildAviamentoSummaryRows,
  buildAntecipacaoMaterialRows,
} from '@/lib/earlyReleaseExport';
import type { EarlyReleaseOp, EarlyReleaseRow } from '@/lib/earlyReleaseBoard';

const row = (over: Partial<EarlyReleaseRow>): EarlyReleaseRow => ({
  key: 'ref-1::PRETO',
  reference_id: 'ref-1',
  reference_name: 'SP130',
  photo_url: null,
  color: 'LIMONCELLO',
  pairs: 84,
  opCount: 2,
  pvCount: 1,
  opNumbers: ['OP-2026-03824', 'OP-2026-03817'],
  pvNumbers: ['PV-001621'],
  clientOrderNumbers: ['4521'],
  lanes: [
    { key: 'aviamento', label: 'Aviamento', start: '2026-09-17', end: '2026-09-18', pairs: 84 },
    { key: 'cabedal', label: 'Costura Cabedal', start: '2026-08-31', end: '2026-09-01', pairs: 84 },
    { key: 'cortes', label: 'Cortes (produção)', start: '2026-09-18', end: '2026-09-21', pairs: 84 },
  ],
  daysAhead: 13,
  source: 'agenda',
  ...over,
});

const op = (over: Partial<EarlyReleaseOp>): EarlyReleaseOp => ({
  order_id: 'op-1',
  order_number: 'OP-1',
  reference_id: 'ref-1',
  reference_name: 'SP130',
  photo_url: null,
  color: 'LIMONCELLO',
  quantity: 42,
  planned_delivery: '2026-09-30',
  sale_order_id: 'so-1',
  sale_order_number: 'PV-001621',
  client_order_number: '4521',
  ...over,
});

describe('buildAviamentoSummaryRows', () => {
  it('é texto por referência + cor com PV e pedido do cliente', () => {
    const [summary] = buildAviamentoSummaryRows([row({})]);
    expect(summary.reference_name).toBe('SP130');
    expect(summary.color).toBe('LIMONCELLO');
    expect(summary.pairs).toBe(84);
    expect(summary.pvNumbers).toBe('PV-001621');
    expect(summary.clientOrderNumbers).toBe('4521');
    expect(summary.opNumbers).toContain('OP-2026-03824');
    expect(summary.aviamento).toMatch(/17\/09/);
    expect(summary.daysAhead).toBe(13);
  });
});

describe('buildAntecipacaoMaterialRows', () => {
  it('agrupa 1º ref+cor, 2º tipo de material, 3º o mesmo pedido', () => {
    const ops = [
      op({ order_id: 'a', order_number: 'OP-A', sale_order_id: 'so-1', sale_order_number: 'PV-1', client_order_number: 'C-1' }),
      op({ order_id: 'b', order_number: 'OP-B', sale_order_id: 'so-2', sale_order_number: 'PV-2', client_order_number: 'C-2' }),
      op({
        order_id: 'c', order_number: 'OP-C', color: 'OFF WHITE',
        sale_order_id: 'so-1', sale_order_number: 'PV-1', client_order_number: 'C-1',
      }),
    ];
    const rows = buildAntecipacaoMaterialRows(ops, [
      { order_id: 'a', componentType: 'BOM', groupName: 'FIVELA', materialName: 'Fivela 12mm', materialColor: 'OURO', quantity: 10, unit: 'un' },
      { order_id: 'b', componentType: 'Componente Direto', groupName: 'ILHOS', materialName: 'Ilhós', materialColor: 'OURO', quantity: 4, unit: 'un' },
      { order_id: 'a', componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Napa', materialColor: 'LIMONCELLO', quantity: 2.5, unit: 'm' },
      { order_id: 'c', componentType: 'BOM', groupName: 'FIVELA', materialName: 'Fivela 12mm', materialColor: 'OURO', quantity: 8, unit: 'un' },
      { order_id: 'a', componentType: 'Solado', groupName: 'TR', materialName: 'Solado', materialColor: 'PRETO', quantity: 42, unit: 'par' },
    ]);
    expect(rows.map((r) => r.color)).toEqual(['LIMONCELLO', 'LIMONCELLO', 'LIMONCELLO', 'OFF WHITE']);
    expect(rows.map((r) => r.componentType)).toEqual(['Cabedal', 'BOM', 'Componente Direto', 'BOM']);
    expect(rows[1].sale_order_number).toBe('PV-1');
    expect(rows[2].sale_order_number).toBe('PV-2');
    expect(rows.some((r) => r.materialName === 'Solado')).toBe(false);
    expect(rows[1].client_order_number).toBe('C-1');
  });
});
