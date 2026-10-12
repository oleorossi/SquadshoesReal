import { describe, expect, it } from 'vitest';
import {
  corteLookaheadScore,
  corteRequiredStockQty,
  freeQtyExcludingOtherOrders,
  rankCorteLookaheadRows,
  remainingBillableValue,
  resolveGroupIdByMaterialName,
  sheetHasCorteSector,
} from '@/lib/corteLookahead';

describe('corteLookahead', () => {
  it('sheetHasCorteSector aceita alias Palmilha · Fibra', () => {
    expect(sheetHasCorteSector(['Palmilha · Fibra', 'Expedição'], 'Corte Fibra')).toBe(true);
    expect(sheetHasCorteSector(['Costura Cabedal'], 'Corte Cabedal')).toBe(false);
  });

  it('score favorece PV caro com prazo perto', () => {
    const today = new Date('2026-09-29T12:00:00');
    const urgent = corteLookaheadScore({
      remainingBillableValue: 1000,
      deliveryDeadline: '2026-09-30',
      today,
    });
    const later = corteLookaheadScore({
      remainingBillableValue: 1000,
      deliveryDeadline: '2026-10-20',
      today,
    });
    expect(urgent).toBeGreaterThan(later);
    expect(corteLookaheadScore({ remainingBillableValue: 1000, deliveryDeadline: null, today })).toBe(0);
  });

  it('remainingBillableValue proporcional aos pares sem OP', () => {
    expect(remainingBillableValue({
      saleOrderTotal: 1000,
      pairsWithoutOp: 40,
      pairsTotalOnPv: 100,
    })).toBe(400);
  });

  it('freeQty ignora reserva do próprio PV e desconta outros', () => {
    const free = freeQtyExcludingOtherOrders({
      quantity: 100,
      productId: 'p1',
      ownSaleOrderId: 'so1',
      reservations: [
        { productId: 'p1', saleOrderId: 'so1', quantityReserved: 30, quantityConsumed: 0, status: 'reserved' },
        { productId: 'p1', saleOrderId: 'so2', quantityReserved: 20, quantityConsumed: 5, status: 'reserved' },
      ],
    });
    expect(free).toBe(85);
  });

  it('rank aplica alocação simulada e chips', () => {
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'a',
        createdAt: '2026-01-02',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 50,
        completionPct: 10,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-10-01',
      },
      {
        itemId: 'b',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 80,
        completionPct: 50,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-09-30',
      },
    ], { today: new Date('2026-09-29T12:00:00') });

    // Sequência oficial: maior completion (% PV) primeiro — b antes de a.
    // ⚠ Esta é a ordem de ALOCAÇÃO/LIBERAÇÃO (quem consome o estoque livre e
    // por isso fica liberável), NÃO a ordem que a tela mostra: desde 12/10/2026
    // a Fila de Corte reagrupa por PV (prazo) → referência, e esta ordem só
    // sobrevive DENTRO de uma referência.
    expect(ranked[0].itemId).toBe('b');
    expect(ranked[0].liberable).toBe(true);
    expect(ranked[1].itemId).toBe('a');
    expect(ranked[1].liberable).toBe(false);
    expect(ranked[0].chips.some((c) => c.key === 'estoque' && c.tone === 'ok')).toBe(true);
    expect(ranked[1].chips.some((c) => c.key === 'estoque' && c.tone === 'blocked')).toBe(true);
  });

  it('nomeia o pedido que levou o material quando a linha fica bloqueada', () => {
    // O relatório ordena por PRAZO e a alocação segue a sequência oficial, então
    // o PV de entrega mais próxima pode aparecer bloqueado. Sem nomear quem
    // consumiu, a tela parece contraditória.
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'urgente',
        createdAt: '2026-01-02',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 10,
        completionPct: 10,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-09-30',
        orderNumber: 'PV-00151',
      },
      {
        itemId: 'quase-fechado',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 10,
        completionPct: 90,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-10-20',
        orderNumber: 'PV-00148',
      },
    ], { today: new Date('2026-09-29T12:00:00') });

    const quase = ranked.find((r) => r.itemId === 'quase-fechado')!;
    const urgente = ranked.find((r) => r.itemId === 'urgente')!;
    // Quem fecha o PV levou a napa, ainda que entregue depois.
    expect(quase.liberable).toBe(true);
    expect(quase.blockedByOrderNumbers).toBeUndefined();
    expect(urgente.liberable).toBe(false);
    expect(urgente.blockedByOrderNumbers).toEqual(['PV-00148']);
  });

  it('não culpa o próprio pedido pela falta', () => {
    // Dois itens do MESMO PV competindo pelo mesmo SKU: o 2º fica bloqueado,
    // mas apontar "PV-00151 levou" no cabeçalho do PV-00151 não explica nada.
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'i1',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 10,
        completionPct: 50,
        color: 'AZUL',
        reference: 'I90',
        dueDate: '2026-09-30',
        orderNumber: 'PV-00151',
      },
      {
        itemId: 'i2',
        createdAt: '2026-01-02',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 10,
        completionPct: 50,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-09-30',
        orderNumber: 'PV-00151',
      },
    ], { today: new Date('2026-09-29T12:00:00') });

    const blocked = ranked.find((r) => !r.liberable)!;
    expect(blocked.blockedByOrderNumbers).toBeUndefined();
  });

  it('bloqueio por cadastro incompleto não inventa culpado', () => {
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'sem-material',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: null, productName: null, freeQty: 0, requiredQty: 5 },
        score: 10,
        completionPct: 10,
        color: 'PRETO',
        reference: 'I90',
        dueDate: '2026-09-30',
        orderNumber: 'PV-00151',
      },
    ], { today: new Date('2026-09-29T12:00:00') });

    expect(ranked[0].liberable).toBe(false);
    expect(ranked[0].blockedByOrderNumbers).toBeUndefined();
  });

  it('rank prioriza fechar PV sobre score legado de valor×prazo', () => {
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'quase',
        createdAt: '2026-01-02',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA', freeQty: 100, requiredQty: 1 },
        score: 10,
        completionPct: 90,
        color: 'OFF WHITE',
        reference: 'Z',
        dueDate: '2026-12-01',
      },
      {
        itemId: 'urgente-novo',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA', freeQty: 100, requiredQty: 1 },
        score: 9999,
        completionPct: 5,
        color: 'PRETO',
        reference: 'A',
        dueDate: '2026-09-30',
      },
    ], { today: new Date('2026-09-29T12:00:00') });

    expect(ranked.map((r) => r.itemId)).toEqual(['quase', 'urgente-novo']);
  });

  it('corteRequiredStockQty converte dm² linear pela largura da bobina', () => {
    const got = corteRequiredStockQty({
      consumptionPerPair: 5.7,
      pairs: 12,
      hasProduct: true,
      productUnit: 'm',
      componentSheet: { dimensions_width: 1370, dimensions_unit: 'mm' },
    });
    expect(got.incomplete).toBeNull();
    expect(got.qty).toBeCloseTo(5.7 * 12 / 137, 3);
  });

  it('corteRequiredStockQty marca largura faltando em material linear', () => {
    const got = corteRequiredStockQty({
      consumptionPerPair: 5.7,
      pairs: 12,
      hasProduct: true,
      productUnit: 'm',
      componentSheet: { dimensions_width: 0, dimensions_unit: 'mm' },
    });
    expect(got.incomplete).toBe('largura');
  });

  it('resolveGroupIdByMaterialName ignora caixa e espaço', () => {
    expect(resolveGroupIdByMaterialName(' napa soft ', [
      { id: 'g1', name: 'NAPA SOFT' },
    ])).toBe('g1');
    expect(resolveGroupIdByMaterialName('OUTRA', [
      { id: 'g1', name: 'NAPA SOFT' },
    ])).toBeNull();
  });
});
