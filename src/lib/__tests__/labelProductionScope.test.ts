import { describe, expect, it } from 'vitest';
import {
  productionOrdersMissingFromLabels,
  saleOrderEligibleForLabels,
} from '@/lib/labelProductionScope';

describe('etiquetagem — PV em produção', () => {
  it('mostra o PV-00255 mesmo quando a fila paginada não devolveu a OP', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-255',
      scheduled: false,
      saleOrderStatus: 'Em Produção',
    })).toBe(true);
  });

  it('mantém o portão para pedido que ainda não entrou em produção nem na fila', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-rascunho',
      scheduled: false,
      saleOrderStatus: 'Aprovado',
    })).toBe(false);
    expect(saleOrderEligibleForLabels({
      saleOrderId: 'pv-fila',
      scheduled: true,
      saleOrderStatus: 'Aprovado',
    })).toBe(true);
  });

  it('não inventa etiqueta para OP sem pedido', () => {
    expect(saleOrderEligibleForLabels({
      saleOrderId: null,
      scheduled: true,
      saleOrderStatus: 'Em Produção',
    })).toBe(false);
  });

  it('alerta PV em produção sem nenhuma OP na lista', () => {
    expect(productionOrdersMissingFromLabels([
      { id: 'pv-255', order_number: 'PV-00255', status: 'Em Produção' },
      { id: 'pv-1', order_number: 'PV-00001', status: 'Em Produção' },
      { id: 'pv-2', order_number: 'PV-00002', status: 'Aprovado' },
    ], new Set(['pv-1']))).toEqual(['PV-00255']);
  });
});
