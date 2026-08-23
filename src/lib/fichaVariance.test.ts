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
    // 12/10 = +20% → acima de 15% ↔ crítico, além de sem_baixa e sem_ficha
    expect(napa?.status).toBe('critico');
    expect(solado?.diagnosis).toBe('ficha_sem_baixa');
    expect(cola?.diagnosis).toBe('baixa_sem_ficha');
    expect(varianceSummary(lines).critico).toBe(3);
  });

  it('compra overage + furo do mínimo, não o que a ficha não baixou', () => {
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 13, stock: 2, minStock: 5 })).toBe(6);
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 4, stock: 20, minStock: 5 })).toBe(0);
    expect(qtyToBuyFromVariance({ theoretical: 10, actual: 4, stock: 1, minStock: 5 })).toBe(4);
  });
});
