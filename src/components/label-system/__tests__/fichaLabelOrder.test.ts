import { describe, it, expect } from 'vitest';
import { buildQuantitySizeSequence } from '../LabelProductionTab';

/** OP com grade de ficha cadastrada (Σ grade = pares por ficha). */
const comFicha = (order_number: string, grade: Record<string, number>, fichas: number, opGrade?: Record<string, number>) => ({
  order_number,
  sale_order_item_grade: grade,
  sale_order_item_fichas: fichas,
  grade: opGrade ?? Object.fromEntries(Object.entries(grade).map(([s, q]) => [s, q * fichas])),
});

describe('buildQuantitySizeSequence — etiqueta na ordem da grade da ficha', () => {
  it('repete a grade completa ficha a ficha, não numeração a numeração', () => {
    // grade de 3 pares (34,35,36) × 4 fichas = 12 etiquetas
    const { sizes } = buildQuantitySizeSequence([comFicha('OP-1', { '34': 1, '35': 1, '36': 1 }, 4)]);
    expect(sizes).toEqual([
      '34', '35', '36',
      '34', '35', '36',
      '34', '35', '36',
      '34', '35', '36',
    ]);
    // o que saía ANTES (e não pode voltar): todos os 34, depois todos os 35…
    expect(sizes).not.toEqual(['34', '34', '34', '34', '35', '35', '35', '35', '36', '36', '36', '36']);
  });

  it('numeração com mais de um par por ficha sai junta, dentro da grade', () => {
    const { sizes } = buildQuantitySizeSequence([comFicha('OP-1', { '34': 1, '35': 2, '36': 1 }, 2)]);
    expect(sizes).toEqual(['34', '35', '35', '36', '34', '35', '35', '36']);
  });

  it('o TOTAL de etiquetas não muda — só a ordem', () => {
    const orders = [
      comFicha('OP-1', { '34': 2, '35': 3, '36': 2 }, 10), // 7 × 10 = 70
      comFicha('OP-2', { '38': 1, '39': 1 }, 6),           //  2 ×  6 = 12
    ];
    const { sizes, fallbackOrders } = buildQuantitySizeSequence(orders);
    expect(sizes).toHaveLength(82);
    expect(fallbackOrders).toEqual([]);
    // primeira ficha da OP-1 completa antes de começar a segunda
    expect(sizes.slice(0, 7)).toEqual(['34', '34', '35', '35', '35', '36', '36']);
    expect(sizes.slice(7, 14)).toEqual(['34', '34', '35', '35', '35', '36', '36']);
  });

  it('pedido SEM grade completa emite de forma tradicional, pela grade da OP', () => {
    const semFicha = { order_number: 'OP-2026-01164', sale_order_item_grade: null, sale_order_item_fichas: null, grade: { '35': 2, '34': 3 } };
    const { sizes, fallbackOrders } = buildQuantitySizeSequence([semFicha]);
    expect(sizes).toEqual(['34', '34', '34', '35', '35']); // numeração a numeração, ordenado
    expect(fallbackOrders).toEqual(['OP-2026-01164']);
  });

  it('grupo misto: cada OP segue o seu caminho, e só a sem grade é reportada', () => {
    const semFicha = { order_number: 'OP-SEM', grade: { '40': 2 } };
    const { sizes, fallbackOrders } = buildQuantitySizeSequence([
      comFicha('OP-COM', { '34': 1, '35': 1 }, 2),
      semFicha,
    ]);
    expect(sizes).toEqual(['34', '35', '34', '35', '40', '40']);
    expect(fallbackOrders).toEqual(['OP-SEM']);
  });

  it('fichas = 0 conta como sem grade (não emite zero etiqueta em silêncio)', () => {
    const { sizes, fallbackOrders } = buildQuantitySizeSequence([
      { order_number: 'OP-X', sale_order_item_grade: { '34': 2 }, sale_order_item_fichas: 0, grade: { '34': 8 } },
    ]);
    expect(sizes).toHaveLength(8);
    expect(fallbackOrders).toEqual(['OP-X']);
  });
});
