import { describe, expect, it } from 'vitest';
import { decorateOutsourceableLines, type OutsourceableLine } from '@/hooks/useGenerateOpServiceOrders';
import type { ConsumptionRow } from '@/lib/consumptionRows';

function line(partial: Partial<OutsourceableLine> & Pick<OutsourceableLine, 'order_id' | 'sector'>): OutsourceableLine {
  return {
    op_number: 'OP-1',
    reference_id: 'ref',
    ref_code: '5001',
    ref_name: 'Sandalia',
    color: 'PRETO',
    quantity: 12,
    sector_label: partial.sector === 'mesa' ? 'Aviamento' : 'Costura de cabedal',
    sector_status: 'Pendente',
    default_contractor_id: null,
    default_contractor_name: null,
    default_rate: null,
    already_has_os: false,
    existing_os_status: null,
    required_return_date: '2026-09-10',
    recommended_send_date: '2026-09-01',
    ...partial,
  };
}

function row(partial: Partial<ConsumptionRow> & Pick<ConsumptionRow, 'componentType' | 'groupName'>): ConsumptionRow {
  return {
    materialName: partial.groupName,
    color: 'PRETO',
    productUnit: 'un',
    totalQuantity: 10,
    available: 10,
    productIds: [`p-${partial.groupName}`],
    ...partial,
  } as ConsumptionRow;
}

describe('decorateOutsourceableLines', () => {
  it('sem consumo anotado cai no fallback só-prazo', () => {
    const decorated = decorateOutsourceableLines([
      line({ order_id: 'late', sector: 'mesa', required_return_date: '2026-11-01' }),
      line({ order_id: 'soon', sector: 'costura', required_return_date: '2026-09-01' }),
    ]);
    expect(decorated.map((item) => item.order_id)).toEqual(['soon', 'late']);
    expect(decorated.every((item) => item.queue_pull === 'prazo')).toBe(true);
  });

  it('kit coberto na etapa pinta ambos; falta no kit pinta prazo_falta', () => {
    const kitRowsByOrder = new Map<string, ConsumptionRow[]>([
      ['ready-op', [
        row({ componentType: 'BOM', groupName: 'FIVELA', totalQuantity: 8, available: 20 }),
        row({ componentType: 'Solado', groupName: 'TR', totalQuantity: 100, available: 0 }),
      ]],
      ['short-op', [
        row({ componentType: 'Cabedal', groupName: 'NAPA', totalQuantity: 12, available: 1 }),
        row({ componentType: 'Forração', groupName: 'FORRO', totalQuantity: 20, available: 0 }),
      ]],
    ]);

    const decorated = decorateOutsourceableLines([
      line({ order_id: 'short-op', sector: 'costura', required_return_date: '2026-09-02' }),
      line({ order_id: 'ready-op', sector: 'mesa', required_return_date: '2026-09-02' }),
    ], kitRowsByOrder);

    expect(decorated.map((item) => item.order_id)).toEqual(['ready-op', 'short-op']);
    expect(decorated[0].queue_pull).toBe('ambos');
    expect(decorated[1].queue_pull).toBe('prazo_falta');
  });

  it('falta de forração não pinta prazo_falta na Costura quando o cabedal cobre', () => {
    const kitRowsByOrder = new Map<string, ConsumptionRow[]>([
      ['op', [
        row({ componentType: 'Cabedal', groupName: 'NAPA', totalQuantity: 12, available: 12 }),
        row({ componentType: 'Forração', groupName: 'FORRO', totalQuantity: 20, available: 0 }),
      ]],
    ]);

    const decorated = decorateOutsourceableLines([
      line({ order_id: 'op', sector: 'costura', required_return_date: '2026-09-02' }),
    ], kitRowsByOrder);

    expect(decorated[0].queue_pull).toBe('ambos');
  });
});
