/**
 * Testes de "integração lógica" para `calculateConsumptionMultiSku`.
 *
 * Simulam um pedido de venda com VÁRIAS referências/cores/tamanhos e validam
 * que a agregação por material (product_id + color) está correta:
 *   • soma de `required` entre SKUs;
 *   • menor `available` preservado;
 *   • `consumption_per_unit` = média ponderada por `required`;
 *   • `stock_ok` recalculado pós-agregação;
 *   • `missing` populado quando a soma ultrapassa o estoque;
 *   • `soldDriven` = true se qualquer SKU veio de sole_spec;
 *   • número correto de chamadas à RPC (uma por item).
 *
 * O cliente Supabase é mockado para retornos determinísticos por chamada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  calculateConsumptionMultiSku,
  type ConsumptionLine,
  type MultiSkuItem,
} from '../consumptionService';

function line(over: Partial<ConsumptionLine>): ConsumptionLine {
  return {
    component: 'Cabedal',
    product_id: 'napa-caramelo',
    product_name: 'Napa Caramelo',
    color: 'Caramelo',
    consumption_per_unit: 9.29,
    required: 92.9,
    available: 1000,
    stock_ok: true,
    debit_mode: 'soft',
    source: 'sheet_per_size',
    ...over,
  };
}

function rpcResult(lines: ConsumptionLine[]) {
  return { data: lines, error: null };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('calculateConsumptionMultiSku — agregação por material', () => {
  it('soma required de SKUs que compartilham o mesmo (product_id, color)', async () => {
    // SKU A: 10 pares × 9.29 dm² de Napa Caramelo = 92.9
    // SKU B: 20 pares × 9.29 dm² de Napa Caramelo = 185.8
    // Total esperado agregado = 278.7
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ required: 92.9 })]))
      .mockResolvedValueOnce(rpcResult([line({ required: 185.8 })]));

    const items: MultiSkuItem[] = [
      { referenceId: 'r1', quantity: 10, color: 'Caramelo', size: 37 },
      { referenceId: 'r1', quantity: 20, color: 'Caramelo', size: 38 },
    ];

    const result = await calculateConsumptionMultiSku(items);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(result.aggregatedLines).toHaveLength(1);
    expect(result.aggregatedLines[0].required).toBeCloseTo(278.7, 2);
    expect(result.totalRequired).toBeCloseTo(278.7, 2);
  });

  it('mantém SKUs separados quando product_id é igual mas color difere', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([
        line({ product_id: 'napa', color: 'Caramelo', required: 92.9 }),
      ]))
      .mockResolvedValueOnce(rpcResult([
        line({ product_id: 'napa', color: 'Preto', required: 50 }),
      ]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r', quantity: 10, color: 'Caramelo', size: 37 },
      { referenceId: 'r', quantity: 5, color: 'Preto', size: 37 },
    ]);

    expect(result.aggregatedLines).toHaveLength(2);
    const cores = result.aggregatedLines.map((l) => l.color).sort();
    expect(cores).toEqual(['Caramelo', 'Preto']);
  });

  it('agrega múltiplos componentes (cabedal + forro + palmilha) entre SKUs', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([
        line({ component: 'Cabedal', product_id: 'napa', required: 90 }),
        line({ component: 'Forração', product_id: 'forro', required: 55 }),
        line({ component: 'Palmilha', product_id: 'palm', required: 40 }),
      ]))
      .mockResolvedValueOnce(rpcResult([
        line({ component: 'Cabedal', product_id: 'napa', required: 45 }),
        line({ component: 'Forração', product_id: 'forro', required: 27.5 }),
        line({ component: 'Palmilha', product_id: 'palm', required: 20 }),
      ]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10, color: 'Caramelo', size: 37 },
      { referenceId: 'r2', quantity: 5, color: 'Caramelo', size: 37 },
    ]);

    expect(result.aggregatedLines).toHaveLength(3);
    const byPid = Object.fromEntries(result.aggregatedLines.map((l) => [l.product_id, l]));
    expect(byPid['napa'].required).toBeCloseTo(135, 2);
    expect(byPid['forro'].required).toBeCloseTo(82.5, 2);
    expect(byPid['palm'].required).toBeCloseTo(60, 2);
    expect(result.totalRequired).toBeCloseTo(135 + 82.5 + 60, 2);
  });

  it('preserva o MENOR available observado entre chamadas (snapshot defensivo)', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ available: 1000, required: 50 })]))
      .mockResolvedValueOnce(rpcResult([line({ available: 800, required: 50 })]))
      .mockResolvedValueOnce(rpcResult([line({ available: 900, required: 50 })]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10 },
      { referenceId: 'r2', quantity: 10 },
      { referenceId: 'r3', quantity: 10 },
    ]);

    expect(result.aggregatedLines[0].available).toBe(800);
  });

  it('consumption_per_unit agregado é a média ponderada por required', async () => {
    // SKU A: per_unit=9, required=90 (10 pares)
    // SKU B: per_unit=10, required=200 (20 pares)
    // ponderada = (9*90 + 10*200) / (90+200) = (810+2000)/290 = 9.6896...
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ consumption_per_unit: 9, required: 90 })]))
      .mockResolvedValueOnce(rpcResult([line({ consumption_per_unit: 10, required: 200 })]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10, size: 37 },
      { referenceId: 'r1', quantity: 20, size: 38 },
    ]);

    expect(result.aggregatedLines[0].consumption_per_unit).toBeCloseTo(9.6897, 3);
  });

  it('recalcula stock_ok pós-agregação (estoque suficiente individualmente, insuficiente somado)', async () => {
    // Cada SKU sozinho cabe (required 60 < available 100), mas a SOMA (180) excede.
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ required: 60, available: 100, stock_ok: true })]))
      .mockResolvedValueOnce(rpcResult([line({ required: 60, available: 100, stock_ok: true })]))
      .mockResolvedValueOnce(rpcResult([line({ required: 60, available: 100, stock_ok: true })]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10 },
      { referenceId: 'r2', quantity: 10 },
      { referenceId: 'r3', quantity: 10 },
    ]);

    expect(result.aggregatedLines[0].required).toBe(180);
    expect(result.aggregatedLines[0].stock_ok).toBe(false);
    expect(result.allStockOk).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it('allStockOk=true quando o agregado cabe no estoque', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ required: 50, available: 1000 })]))
      .mockResolvedValueOnce(rpcResult([line({ required: 50, available: 1000 })]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 5 },
      { referenceId: 'r2', quantity: 5 },
    ]);

    expect(result.allStockOk).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('soldDriven=true se QUALQUER SKU veio de sole_spec', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ source: 'sheet_per_size' })]))
      .mockResolvedValueOnce(rpcResult([line({ source: 'sole_spec' })]));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10 },
      { referenceId: 'r2', quantity: 10 },
    ]);

    expect(result.soldDriven).toBe(true);
  });

  it('repassa exatamente os parâmetros de cada item para a RPC (cor/tamanho corretos por SKU)', async () => {
    rpcMock.mockResolvedValue(rpcResult([line({ required: 1 })]));

    await calculateConsumptionMultiSku([
      { referenceId: 'r1', quantity: 10, color: 'Preto', size: 37 },
      { referenceId: 'r2', quantity: 5, color: 'Caramelo', size: 39 },
    ]);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({
      p_reference_id: 'r1', p_order_quantity: 10, p_color: 'Preto', p_size: 37,
    });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({
      p_reference_id: 'r2', p_order_quantity: 5, p_color: 'Caramelo', p_size: 39,
    });
  });

  it('perItem preserva o resultado original de cada SKU (não-destrutivo)', async () => {
    rpcMock
      .mockResolvedValueOnce(rpcResult([line({ component: 'Cabedal', required: 90 })]))
      .mockResolvedValueOnce(rpcResult([
        line({ component: 'Cabedal', required: 45 }),
        line({ component: 'Forração', product_id: 'forro', required: 27 }),
      ]));

    const items: MultiSkuItem[] = [
      { referenceId: 'r1', quantity: 10, itemKey: 'sku-A' },
      { referenceId: 'r1', quantity: 5, itemKey: 'sku-B' },
    ];
    const result = await calculateConsumptionMultiSku(items);

    expect(result.perItem).toHaveLength(2);
    expect(result.perItem[0].item.itemKey).toBe('sku-A');
    expect(result.perItem[0].summary.lines).toHaveLength(1);
    expect(result.perItem[1].summary.lines).toHaveLength(2);
  });

  it('lista vazia → resultado neutro (não chama a RPC)', async () => {
    const result = await calculateConsumptionMultiSku([]);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.aggregatedLines).toHaveLength(0);
    expect(result.totalRequired).toBe(0);
    expect(result.allStockOk).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.soldDriven).toBe(false);
  });

  it('1 SKU com 1 linha → agregação é idempotente (mesmo required)', async () => {
    rpcMock.mockResolvedValueOnce(rpcResult([line({ required: 92.9 })]));
    const result = await calculateConsumptionMultiSku([
      { referenceId: 'r', quantity: 10, color: 'Caramelo', size: 37 },
    ]);
    expect(result.aggregatedLines).toHaveLength(1);
    expect(result.aggregatedLines[0].required).toBe(92.9);
    expect(result.totalRequired).toBe(92.9);
  });
});
