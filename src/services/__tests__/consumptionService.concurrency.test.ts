/**
 * Testes de concorrência para `calculateConsumptionMultiSku`.
 *
 * Cenário: várias chamadas multi-SKU disparadas SIMULTANEAMENTE (Promise.all),
 * com latências variáveis e respostas fora de ordem da RPC. O objetivo é
 * provar que:
 *
 *   • a ordem de resolução das promises NÃO afeta o agregado final;
 *   • `available` consolidado é sempre o MENOR observado (snapshot defensivo);
 *   • `stock_ok` é recalculado pós-agregação e NÃO é "vazado" entre chamadas;
 *   • execuções concorrentes do mesmo input produzem resultados idênticos
 *     (idempotência sob concorrência);
 *   • a ordem das chamadas à RPC corresponde exatamente à ordem dos itens.
 *
 * Como o JS é single-threaded, "race condition" aqui significa: a ordem em
 * que os `await` resolvem pode variar. Simulamos isso atrasando cada mock
 * com `setTimeout` de duração diferente.
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

/** Resolve `value` após `ms` milissegundos. */
function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('calculateConsumptionMultiSku — concorrência', () => {
  it('respostas fora de ordem (latências invertidas) produzem o MESMO agregado', async () => {
    // 3 SKUs do MESMO material, latências decrescentes — a 3ª chamada
    // resolve primeiro, a 1ª por último. O agregado deve continuar correto.
    rpcMock
      .mockImplementationOnce(() => delayed({ data: [line({ required: 10, available: 1000 })], error: null }, 30))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 20, available: 1000 })], error: null }, 20))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 30, available: 1000 })], error: null }, 5));

    const items: MultiSkuItem[] = [
      { referenceId: 'r1', quantity: 1 },
      { referenceId: 'r2', quantity: 2 },
      { referenceId: 'r3', quantity: 3 },
    ];
    const result = await calculateConsumptionMultiSku(items);

    expect(result.aggregatedLines).toHaveLength(1);
    expect(result.aggregatedLines[0].required).toBe(60); // 10+20+30
    expect(result.aggregatedLines[0].available).toBe(1000);
  });

  it('available agregado é o MÍNIMO mesmo com snapshots divergentes em corrida', async () => {
    // Simula que cada SKU enxergou um snapshot ligeiramente diferente
    // do estoque (chamadas em momentos diferentes). O agregado deve
    // preservar o MENOR.
    rpcMock
      .mockImplementationOnce(() => delayed({ data: [line({ required: 50, available: 900 })], error: null }, 40))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 50, available: 600 })], error: null }, 5))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 50, available: 750 })], error: null }, 25));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'a', quantity: 5 },
      { referenceId: 'b', quantity: 5 },
      { referenceId: 'c', quantity: 5 },
    ]);

    expect(result.aggregatedLines[0].available).toBe(600);
  });

  it('stock_ok é recalculado pós-agregação e não vaza de chamadas individuais', async () => {
    // Cada SKU isolado tem stock_ok=true (50 ≤ 200). A SOMA (250) excede.
    rpcMock
      .mockImplementationOnce(() => delayed({ data: [line({ required: 50, available: 200, stock_ok: true })], error: null }, 15))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 100, available: 200, stock_ok: true })], error: null }, 8))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 100, available: 200, stock_ok: true })], error: null }, 22));

    const result = await calculateConsumptionMultiSku([
      { referenceId: 'a', quantity: 5 },
      { referenceId: 'b', quantity: 10 },
      { referenceId: 'c', quantity: 10 },
    ]);

    expect(result.aggregatedLines[0].required).toBe(250);
    expect(result.aggregatedLines[0].stock_ok).toBe(false);
    expect(result.allStockOk).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it('múltiplas chamadas concorrentes de calculateConsumptionMultiSku são independentes', async () => {
    // Dispara 3 cálculos completos em paralelo. Cada um deve produzir o
    // próprio resultado sem que os buckets se misturem.
    rpcMock.mockImplementation((_fn: string, params: { p_reference_id: string }) => {
      // Cada referência produz um material diferente.
      const map: Record<string, ConsumptionLine[]> = {
        'X': [line({ product_id: 'mat-X', required: 100 })],
        'Y': [line({ product_id: 'mat-Y', required: 200 })],
        'Z': [line({ product_id: 'mat-Z', required: 300 })],
      };
      const data = map[params.p_reference_id] ?? [];
      const ms = Math.floor(Math.random() * 30);
      return delayed({ data, error: null }, ms);
    });

    const [resX, resY, resZ] = await Promise.all([
      calculateConsumptionMultiSku([{ referenceId: 'X', quantity: 1 }, { referenceId: 'X', quantity: 1 }]),
      calculateConsumptionMultiSku([{ referenceId: 'Y', quantity: 1 }, { referenceId: 'Y', quantity: 1 }]),
      calculateConsumptionMultiSku([{ referenceId: 'Z', quantity: 1 }, { referenceId: 'Z', quantity: 1 }]),
    ]);

    expect(resX.aggregatedLines).toHaveLength(1);
    expect(resX.aggregatedLines[0].product_id).toBe('mat-X');
    expect(resX.aggregatedLines[0].required).toBe(200);

    expect(resY.aggregatedLines[0].product_id).toBe('mat-Y');
    expect(resY.aggregatedLines[0].required).toBe(400);

    expect(resZ.aggregatedLines[0].product_id).toBe('mat-Z');
    expect(resZ.aggregatedLines[0].required).toBe(600);
  });

  it('idempotência: mesma entrada executada N vezes em paralelo produz N resultados idênticos', async () => {
    const items: MultiSkuItem[] = [
      { referenceId: 'r1', quantity: 10, color: 'Caramelo', size: 37 },
      { referenceId: 'r2', quantity: 5, color: 'Caramelo', size: 38 },
    ];
    rpcMock.mockImplementation(() =>
      delayed({ data: [line({ required: 50 })], error: null }, Math.floor(Math.random() * 20)),
    );

    const runs = await Promise.all(
      Array.from({ length: 5 }, () => calculateConsumptionMultiSku(items)),
    );

    const totals = runs.map((r) => r.totalRequired);
    expect(new Set(totals).size).toBe(1); // todos idênticos
    expect(totals[0]).toBe(100); // 50 + 50
  });

  it('ordem das chamadas à RPC == ordem dos items recebidos (não embaralha)', async () => {
    rpcMock.mockImplementation(() =>
      delayed({ data: [line({ required: 1 })], error: null }, Math.floor(Math.random() * 30)),
    );

    const items: MultiSkuItem[] = [
      { referenceId: 'first', quantity: 1 },
      { referenceId: 'middle', quantity: 2 },
      { referenceId: 'last', quantity: 3 },
    ];
    await calculateConsumptionMultiSku(items);

    // Mesmo com latências aleatórias, as chamadas SAEM na ordem dos items.
    expect(rpcMock.mock.calls[0][1].p_reference_id).toBe('first');
    expect(rpcMock.mock.calls[1][1].p_reference_id).toBe('middle');
    expect(rpcMock.mock.calls[2][1].p_reference_id).toBe('last');
  });

  it('falha de uma promise interrompe o batch (não retorna agregado parcial)', async () => {
    // Comportamento esperado: Promise.all rejeita no primeiro erro.
    // Isso evita o "agregado parcial silencioso" — o caller decide o retry.
    rpcMock
      .mockImplementationOnce(() => delayed({ data: [line({ required: 10 })], error: null }, 10))
      .mockImplementationOnce(() => delayed({ data: null, error: { message: 'timeout simulado' } }, 5))
      .mockImplementationOnce(() => delayed({ data: [line({ required: 30 })], error: null }, 15));

    await expect(
      calculateConsumptionMultiSku([
        { referenceId: 'a', quantity: 1 },
        { referenceId: 'b', quantity: 2 },
        { referenceId: 'c', quantity: 3 },
      ]),
    ).rejects.toThrow(/timeout simulado/);
  });

  it('agregação determinística: 50 SKUs simultâneos com latências caóticas → required somado é exato', async () => {
    // Stress-test: 50 SKUs do mesmo material, latências aleatórias entre 0–25ms.
    const N = 50;
    rpcMock.mockImplementation(() =>
      delayed(
        { data: [line({ product_id: 'shared', required: 7, available: 100000 })], error: null },
        Math.floor(Math.random() * 25),
      ),
    );

    const items = Array.from({ length: N }, (_, i): MultiSkuItem => ({
      referenceId: `ref-${i}`,
      quantity: 1,
    }));
    const result = await calculateConsumptionMultiSku(items);

    expect(rpcMock).toHaveBeenCalledTimes(N);
    expect(result.aggregatedLines).toHaveLength(1);
    expect(result.aggregatedLines[0].required).toBe(N * 7); // 350
    expect(result.aggregatedLines[0].available).toBe(100000);
    expect(result.aggregatedLines[0].stock_ok).toBe(true);
  });
});
