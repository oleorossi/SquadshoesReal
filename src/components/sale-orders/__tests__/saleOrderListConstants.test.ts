import { describe, expect, it } from 'vitest';
import { TERMINAL_BILLED_STATUSES } from '@/components/sale-orders/saleOrderListConstants';
import {
  CLOSED_SALE_ORDER_STATUSES,
  SALE_ORDER_STATUS,
} from '@/lib/saleOrderStateMachine';

describe('TERMINAL_BILLED_STATUSES', () => {
  it('manda Concluído e Expedido pra aba Faturados / Sem NF (não Ativos)', () => {
    expect(TERMINAL_BILLED_STATUSES).toContain(SALE_ORDER_STATUS.CONCLUIDO);
    expect(TERMINAL_BILLED_STATUSES).toContain(SALE_ORDER_STATUS.EXPEDIDO);
    expect(TERMINAL_BILLED_STATUSES).toContain(SALE_ORDER_STATUS.FATURADO);
    expect(TERMINAL_BILLED_STATUSES).toContain(SALE_ORDER_STATUS.FINALIZADO_SEM_NF);
  });

  it('deixa Cancelado fora — tem aba própria', () => {
    expect(TERMINAL_BILLED_STATUSES).not.toContain(SALE_ORDER_STATUS.CANCELADO);
  });

  it('espelha CLOSED_SALE_ORDER_STATUSES sem Cancelado (anti-drift)', () => {
    expect([...TERMINAL_BILLED_STATUSES].sort()).toEqual(
      CLOSED_SALE_ORDER_STATUSES
        .filter((s) => s !== SALE_ORDER_STATUS.CANCELADO)
        .slice()
        .sort(),
    );
  });
});
