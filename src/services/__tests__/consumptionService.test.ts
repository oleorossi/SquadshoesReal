import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do cliente Supabase ANTES do import do serviço.
const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  calculateConsumption,
  validateConsumption,
  groupByComponent,
  type ConsumptionLine,
} from '../consumptionService';

/** Helper: monta uma linha com defaults sãos para os testes. */
function line(over: Partial<ConsumptionLine>): ConsumptionLine {
  return {
    component: 'Cabedal',
    product_id: 'p-1',
    product_name: 'Material X',
    color: 'Caramelo',
    consumption_per_unit: 5.7,
    required: 57,
    available: 1000,
    stock_ok: true,
    debit_mode: 'soft',
    source: 'sheet_per_size',
    ...over,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('consumptionService — nova hierarquia de fontes', () => {
  it('preserva o source "sheet_per_size" retornado pela RPC quando ficha tem per-size (fonte primária)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        line({ component: 'Cabedal',  source: 'sheet_per_size', consumption_per_unit: 9.29, required: 92.9 }),
        line({ component: 'Forração',    source: 'sheet_per_size', consumption_per_unit: 5.7,  required: 57 }),
        line({ component: 'Palmilha', source: 'sheet_per_size', consumption_per_unit: 4.16, required: 41.6 }),
        line({ component: 'Solado',   source: 'primary_sole',   consumption_per_unit: 1,    required: 10, debit_mode: 'hard' }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-1', quantity: 10, color: 'Preto', size: 37 });

    expect(summary.lines.filter(l => l.source === 'sheet_per_size')).toHaveLength(3);
    expect(summary.soldDriven).toBe(false); // sheet_per_size não conta como sole-driven
    expect(summary.totalRequired).toBeCloseTo(92.9 + 57 + 41.6 + 10, 2);
  });

  it('marca soldDriven=true quando alguma linha vem do sole_spec (fallback intermediário)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        line({ component: 'Forração',    source: 'sole_spec',    consumption_per_unit: 5.7, required: 57 }),
        line({ component: 'Palmilha', source: 'sole_spec',    consumption_per_unit: 4.16, required: 41.6 }),
        line({ component: 'Solado',   source: 'primary_sole', consumption_per_unit: 1,    required: 10, debit_mode: 'hard' }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-2', quantity: 10, color: 'Preto', size: 37 });
    expect(summary.soldDriven).toBe(true);
  });

  it('aceita escalar como fallback final (sem per-size e sem sole_spec)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        line({ component: 'Cabedal',  source: 'sheet_materials', consumption_per_unit: 9.29, required: 92.9 }),
        line({ component: 'Forração',    source: 'sheet_materials', consumption_per_unit: 5.7,  required: 57 }),
        line({ component: 'Palmilha', source: 'sheet_materials', consumption_per_unit: 4.16, required: 41.6 }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'sheet-3', quantity: 10, color: 'Preto' });
    expect(summary.soldDriven).toBe(false);
    expect(summary.lines.every(l => l.source === 'sheet_materials')).toBe(true);
  });

  it('repassa parâmetros corretamente para a RPC (referenceId, quantity, color, size)', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await calculateConsumption({ referenceId: 'ref-42', quantity: 25, color: 'Vermelho', size: 38 });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpcMock.mock.calls[0];
    expect(fnName).toBe('calculate_order_consumption');
    expect(params).toMatchObject({
      p_reference_id: 'ref-42',
      p_order_quantity: 25,
      p_color: 'Vermelho',
      p_size: 38,
    });
  });

  it('passa string vazia para color e null para size quando não informados', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await calculateConsumption({ referenceId: 'ref-1', quantity: 5 });
    const [, params] = rpcMock.mock.calls[0];
    expect(params.p_color).toBe('');
    expect(params.p_size).toBeNull();
  });

  it('lança erro descritivo quando a RPC falha', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } });
    await expect(
      calculateConsumption({ referenceId: 'x', quantity: 1 }),
    ).rejects.toThrow(/function does not exist/);
  });

  it('detecta faltas de estoque corretamente (allStockOk=false e missing populado)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        line({ component: 'Cabedal', required: 100, available: 50, stock_ok: false }),
        line({ component: 'Forração',   required: 30,  available: 100, stock_ok: true }),
      ],
      error: null,
    });
    const summary = await calculateConsumption({ referenceId: 'r', quantity: 10 });
    expect(summary.allStockOk).toBe(false);
    expect(summary.missing).toHaveLength(1);
    expect(summary.missing[0].component).toBe('Cabedal');
  });

  it('groupByComponent agrupa linhas por componente preservando ordem', async () => {
    const lines = [
      line({ component: 'Cabedal' }),
      line({ component: 'Forração' }),
      line({ component: 'Cabedal', product_id: 'p-2' }),
    ];
    const grouped = groupByComponent(lines);
    expect(Object.keys(grouped).sort()).toEqual(['Cabedal', 'Forração']);
    expect(grouped['Cabedal']).toHaveLength(2);
    expect(grouped['Forração']).toHaveLength(1);
  });

  it('validateConsumption lista erros por linha faltante', async () => {
    const summary = {
      lines: [],
      missing: [
        line({ component: 'Cabedal', product_name: 'Napa', required: 92.9, available: 50, stock_ok: false }),
      ],
      totalRequired: 92.9,
      allStockOk: false,
      soldDriven: false,
    };
    const v = validateConsumption(summary);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/Cabedal/);
    expect(v.errors[0]).toMatch(/Napa/);
    expect(v.errors[0]).toMatch(/92\.90/);
  });
});

describe('consumptionService — cenário ST15 (regressão da nova hierarquia)', () => {
  it('ST15 com per-size uniforme retorna o mesmo consumo do escalar (sem regressão)', async () => {
    // ST15: lining 5.7, insole 4.16, upper 9.29 — repetidos por todos os tamanhos.
    rpcMock.mockResolvedValueOnce({
      data: [
        line({ component: 'Cabedal',  source: 'sheet_per_size', consumption_per_unit: 9.29, required: 92.9 }),
        line({ component: 'Forração',    source: 'sheet_per_size', consumption_per_unit: 5.7,  required: 57 }),
        line({ component: 'Palmilha', source: 'sheet_per_size', consumption_per_unit: 4.16, required: 41.6 }),
        line({ component: 'Solado',   source: 'primary_sole',   consumption_per_unit: 1,    required: 10, debit_mode: 'hard' }),
      ],
      error: null,
    });

    const summary = await calculateConsumption({ referenceId: 'st15', quantity: 10, color: 'Preto', size: 37 });
    const cabedal = summary.lines.find(l => l.component === 'Cabedal')!;
    const forro = summary.lines.find(l => l.component === 'Forração')!;
    const palmilha = summary.lines.find(l => l.component === 'Palmilha')!;

    expect(cabedal.required).toBe(92.9);
    expect(forro.required).toBe(57);
    expect(palmilha.required).toBe(41.6);
    expect(cabedal.source).toBe('sheet_per_size');
  });
});