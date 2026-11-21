import { describe, expect, it } from 'vitest';
import { saleOrderEligibleForLabels } from '@/lib/labelProductionScope';
import {
  productionOrderVisibleOperationally,
  queueRowVisibleOperationally,
} from '@/lib/operationalScope';

describe('telas operacionais não mostram PV terminal', () => {
  it('PV faturado com OP cancelada fica fora, mesmo na onda legada', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-146',
      scheduled: true,
      saleOrderStatus: 'Faturado',
    })).toBe(false);
    expect(productionOrderVisibleOperationally({
      orderStatus: 'Cancelada',
      saleOrderStatus: 'Faturado',
    })).toBe(false);
  });

  it('PV faturado com OP apagada fica fora', () => {
    expect(productionOrderVisibleOperationally({
      orderStatus: 'Em Produção',
      deletedAt: '2026-10-17T00:00:00Z',
      saleOrderStatus: 'Faturado',
    })).toBe(false);
    expect(productionOrderVisibleOperationally({
      orderStatus: 'Em Produção',
      deletedAt: '2026-07-30T00:00:00Z',
      saleOrderStatus: 'Em Produção',
    })).toBe(false);
  });

  it('onda legada não devolve Concluído, Finalizado s/ NF, Cancelado nem Expedido', () => {
    for (const status of ['Concluído', 'Concluido', 'Finalizado s/ NF', 'Cancelado', 'Expedido', 'Entregue', 'Finalizado']) {
      expect(saleOrderEligibleForLabels({
        saleOrderId: 'pv-onda',
        scheduled: true,
        saleOrderStatus: status,
      })).toBe(false);
    }
  });

  it('Em Produção com OP viva continua na etiquetagem e na Gestão', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-255',
      scheduled: false,
      saleOrderStatus: 'Em Produção',
    })).toBe(true);
    expect(productionOrderVisibleOperationally({
      orderStatus: 'Em Produção',
      deletedAt: null,
      saleOrderStatus: 'Em Produção',
    })).toBe(true);
    expect(queueRowVisibleOperationally({
      orderStatus: 'Em Produção',
      saleOrderStatus: 'Em Produção',
    })).toBe(true);
  });

  it('Aprovado que está na fila continua; OP cancelada na fila não', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-aprovado',
      scheduled: true,
      saleOrderStatus: 'Aprovado',
    })).toBe(true);
    expect(queueRowVisibleOperationally({
      orderStatus: 'Cancelada',
      saleOrderStatus: 'Aprovado',
    })).toBe(false);
  });
});
