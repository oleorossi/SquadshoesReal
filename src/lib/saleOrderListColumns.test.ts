import { describe, expect, it } from 'vitest';
import {
  SALE_ORDERS_LIST_COLUMNS,
  SALE_ORDERS_LIST_SELECT,
  SALE_ORDERS_SIGNATURE_COLUMN,
} from './saleOrderListColumns';

describe('SALE_ORDERS_LIST_SELECT', () => {
  it('não puxa a assinatura PNG da lista (payload ocioso)', () => {
    expect(SALE_ORDERS_LIST_SELECT).not.toContain(SALE_ORDERS_SIGNATURE_COLUMN);
    expect(SALE_ORDERS_LIST_COLUMNS).not.toContain(SALE_ORDERS_SIGNATURE_COLUMN);
  });

  it('traz a versão otimista e o embed do nº do cliente', () => {
    expect(SALE_ORDERS_LIST_COLUMNS).toContain('order_version');
    expect(SALE_ORDERS_LIST_COLUMNS).toContain('order_number');
    expect(SALE_ORDERS_LIST_COLUMNS).toContain('status');
    expect(SALE_ORDERS_LIST_SELECT).toContain('clients(client_number)');
  });
});
