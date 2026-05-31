/**
 * Validação de SCHEMA do JSONB retornado por `calculate_order_consumption`.
 *
 * O front-end mapeia o resultado para `ConsumptionLine[]`. Se a RPC mudar de
 * forma (rename de campo, mudança de tipo, perda de chave), os erros aparecem
 * só em runtime no Kanban/Pedido. Estes testes congelam o contrato esperado
 * em cada edge-case de `size`, validando shape, chaves obrigatórias, tipos
 * primitivos e domínio de valores (`debit_mode`, `source`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { calculateConsumption, type ConsumptionLine } from '../consumptionService';
import { ConsumptionSchemaError } from '../consumptionService';

const REQUIRED_KEYS: Array<keyof ConsumptionLine> = [
  'component',
  'product_id',
  'product_name',
  'consumption_per_unit',
  'required',
  'available',
  'stock_ok',
  'debit_mode',
  'source',
];

const VALID_DEBIT_MODES = ['hard', 'soft'] as const;
const VALID_SOURCES = [
  'sheet_per_size',
  'sole_spec',
  'sheet_materials',
  'primary_sole',
] as const;

function assertLineSchema(item: unknown, ctx: string) {
  expect(item, `${ctx}: item deve ser um objeto`).toBeTypeOf('object');
  const obj = item as Record<string, unknown>;

  for (const k of REQUIRED_KEYS) {
    expect(obj, `${ctx}: chave "${k}" obrigatória`).toHaveProperty(k);
  }

  expect(typeof obj.component, `${ctx}: component deve ser string`).toBe('string');
  expect(typeof obj.product_id, `${ctx}: product_id deve ser string`).toBe('string');
  expect(typeof obj.product_name, `${ctx}: product_name deve ser string`).toBe('string');
  expect(typeof obj.consumption_per_unit, `${ctx}: consumption_per_unit numérico`).toBe('number');
  expect(typeof obj.required, `${ctx}: required numérico`).toBe('number');
  expect(typeof obj.available, `${ctx}: available numérico`).toBe('number');
  expect(typeof obj.stock_ok, `${ctx}: stock_ok boolean`).toBe('boolean');

  expect(VALID_DEBIT_MODES).toContain(obj.debit_mode as string);
  expect(VALID_SOURCES).toContain(obj.source as string);

  expect(obj.consumption_per_unit as number).toBeGreaterThanOrEqual(0);
  expect(obj.required as number).toBeGreaterThanOrEqual(0);
  expect(obj.available as number).toBeGreaterThanOrEqual(0);

  if ('color' in obj && obj.color !== undefined && obj.color !== null) {
    expect(typeof obj.color).toBe('string');
  }
}

function lineFixture(over: Partial<ConsumptionLine> = {}): ConsumptionLine {
  return {
    component: 'Cabedal',
    product_id: '00000000-0000-0000-0000-000000000001',
    product_name: 'TEST_NAPA',
    color: 'Caramelo',
    consumption_per_unit: 9.29,
    required: 92.9,
    available: 5000,
    stock_ok: true,
    debit_mode: 'soft',
    source: 'sheet_per_size',
    ...over,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('consumptionService — schema do JSONB por edge-case de size', () => {
  it('size = 37 (per-size definido) → shape válido + source=sheet_per_size', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        lineFixture({ component: 'Cabedal', source: 'sheet_per_size' }),
        lineFixture({ component: 'Forração', product_id: 'p-2', product_name: 'TEST_FORRO', consumption_per_unit: 5.7, required: 57, source: 'sheet_per_size' }),
        lineFixture({ component: 'Palmilha', product_id: 'p-3', product_name: 'TEST_PALMILHA', consumption_per_unit: 4.16, required: 41.6, source: 'sheet_per_size' }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 });

    expect(Array.isArray(summary.lines)).toBe(true);
    expect(summary.lines.length).toBe(3);
    summary.lines.forEach((l, i) => assertLineSchema(l, `size=37[${i}]`));
    summary.lines.forEach((l) => expect(l.source).toBe('sheet_per_size'));
  });

  it('size = 38 (sem per-size, com sole_spec) → shape válido + source=sole_spec p/ forro/palmilha', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        lineFixture({ component: 'Cabedal', source: 'sheet_materials', consumption_per_unit: 9.0, required: 90 }),
        lineFixture({ component: 'Forração', source: 'sole_spec', consumption_per_unit: 6.1, required: 61 }),
        lineFixture({ component: 'Palmilha', source: 'sole_spec', consumption_per_unit: 4.5, required: 45 }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 38 });
    summary.lines.forEach((l, i) => assertLineSchema(l, `size=38[${i}]`));
    expect(summary.soldDriven).toBe(true);
  });

  it('size = 99 (inexistente) → shape válido + fallback escalar (source=sheet_materials)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        lineFixture({ component: 'Cabedal', source: 'sheet_materials', consumption_per_unit: 9.0, required: 90 }),
        lineFixture({ component: 'Forração', source: 'sheet_materials', consumption_per_unit: 5.5, required: 55 }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 99 });
    summary.lines.forEach((l, i) => assertLineSchema(l, `size=99[${i}]`));
    summary.lines.forEach((l) => expect(l.source).toBe('sheet_materials'));
  });

  it('size = null (usa reference_size) → shape válido', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [lineFixture({ component: 'Cabedal', source: 'sheet_per_size' })],
      error: null,
    });
    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: null });
    assertLineSchema(summary.lines[0], 'size=null');
  });

  it('array vazio é shape válido (ficha sem materiais não quebra o consumidor)', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const summary = await calculateConsumption({ referenceId: 'empty', quantity: 10, size: 37 });
    expect(Array.isArray(summary.lines)).toBe(true);
    expect(summary.lines).toHaveLength(0);
    expect(summary.totalRequired).toBe(0);
    expect(summary.allStockOk).toBe(true);
    expect(summary.missing).toHaveLength(0);
  });

  it('item com debit_mode="hard" é aceito (solado)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [lineFixture({ component: 'Solado', source: 'primary_sole', debit_mode: 'hard', consumption_per_unit: 1, required: 10 })],
      error: null,
    });
    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 });
    assertLineSchema(summary.lines[0], 'solado');
    expect(summary.lines[0].debit_mode).toBe('hard');
  });

  it('rejeita itens com debit_mode inválido (regressão de schema)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ ...lineFixture(), debit_mode: 'maybe' }],
      error: null,
    });
    const promise = calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 });
    await expect(promise).rejects.toThrowError(ConsumptionSchemaError);
    await expect(promise).rejects.toThrow(/debit_mode/);
  });

  it('rejeita itens com source desconhecido (regressão de schema)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ ...lineFixture(), source: 'magic' }],
      error: null,
    });
    await expect(
      calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 }),
    ).rejects.toThrow(/source/);
  });

  it('rejeita item sem chave obrigatória (regressão de schema)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ component: 'Cabedal', product_id: 'x' }],
      error: null,
    });
    await expect(
      calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 }),
    ).rejects.toThrowError(ConsumptionSchemaError);
  });

  it('valores numéricos negativos são rejeitados (proteção contra bug no SQL)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [lineFixture({ required: -10 })],
      error: null,
    });
    await expect(
      calculateConsumption({ referenceId: 'sheet-1', quantity: 10, size: 37 }),
    ).rejects.toThrow(/required.*negativo/);
  });
});
