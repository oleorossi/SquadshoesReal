import { describe, expect, it } from 'vitest';
import {
  classifyVariance,
  mergeTheoreticalAndActual,
  qtyToBuyFromVariance,
  variancePct,
  varianceSummary,
} from './fichaVariance';

describe('fichaVariance', () => {
  it('classifica 4% como no ponto e 8% como alerta', () => {
    expect(classifyVariance(100, 104).status).toBe('no_ponto');
    expect(classifyVariance(100, 108).status).toBe('alerta');
    expect(classifyVariance(100, 120).status).toBe('critico');
    expect(classifyVariance(100, 120).diagnosis).toBe('perda_ou_saida_avulsa');
    expect(classifyVariance(100, 80).diagnosis).toBe('explosao_maior');
  });

  it('marca baixa sem ficha e ficha sem baixa', () => {
    expect(classifyVariance(0, 10)).toEqual({
      status: 'sem_ficha',
      diagnosis: 'baixa_sem_ficha',
    });
    expect(classifyVariance(12, 0)).toEqual({
      status: 'sem_baixa',
      diagnosis: 'ficha_sem_baixa',
    });
  });

  it('pct é nulo quando não há teórico', () => {
    expect(variancePct(0, 5)).toBeNull();
    expect(variancePct(50, 55)).toBeCloseTo(0.1);
  });

  it('casa teórico e real pelo productId e sobra avulsa vira sem_ficha', () => {
    const lines = mergeTheoreticalAndActual({
      theoretical: [
        { productId: 'a', name: 'Napa', qty: 10, unit: 'm', unitCost: 8 },
        { productId: 'b', name: 'Solado', qty: 20 },
      ],
      actual: [
        { productId: 'a', qty: 12 },
        { productId: 'c', name: 'Cola avulsa', qty: 1 },
      ],
    });
    const napa = lines.find((l) => l.productId === 'a');
    const solado = lines.find((l) => l.productId === 'b');
    const cola = lines.find((l) => l.productId === 'c');
    expect(napa?.delta).toBe(2);
    expect(napa?.extraCost).toBe(16);
    expect(napa?.status).toBe('critico');
    expect(solado?.diagnosis).toBe('ficha_sem_baixa');
    expect(cola?.diagnosis).toBe('baixa_sem_ficha');
    expect(varianceSummary(lines).critico).toBe(3);
  });

  it('compra só o furo da ficha, sem dobrar overage nem recompor piso', () => {
    // 10 da OP − 2 em estoque
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 13, stock: 2 })).toBe(8);
    // estoque cobre a OP
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 4, stock: 20 })).toBe(0);
    // estoque exatamente igual à necessidade: nada a comprar (sem piso)
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 4, stock: 10 })).toBe(0);
    // sem linha de ficha: não há demanda, não há compra (estoque mínimo removido)
    expect(qtyToBuyFromVariance({ theoretical: 0, actual: 8, stock: 1 })).toBe(0);
  });
});
