import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaleOrderMobileCard } from '../SaleOrderMobileCard';
import { INFANTIL_ORDER_NUMBER_CLASS } from '../saleOrderListConstants';

const baseProps = {
  order: {
    id: 'pv-infantil',
    order_number: 'PV-00195',
    client_name: 'DAKOTOON CD',
    status: 'Aprovado',
    delivery_deadline: null,
    total: 24822,
  },
  pairs: 1268,
  minBilling: null,
  selected: false,
  canSeeFinancialValues: true,
  canEditPv: true,
  onToggleSelect: () => {},
  onOpenDetails: () => {},
  onPrefetchConsumption: () => {},
  onOpenConsumption: () => {},
  onEdit: () => {},
};

describe('chip rosa-claro no número do PV infantil', () => {
  it('pinta o número no card mobile', () => {
    render(<SaleOrderMobileCard {...baseProps} isInfantil />);
    expect(screen.getByText('PV-00195').className).toContain(INFANTIL_ORDER_NUMBER_CLASS);
  });

  it('deixa o número adulto sem o fundo rosa', () => {
    render(<SaleOrderMobileCard {...baseProps} isInfantil={false} />);
    expect(screen.getByText('PV-00195').className).not.toContain(INFANTIL_ORDER_NUMBER_CLASS);
  });

  it('a lista desktop e o card mobile compartilham a constante', () => {
    const page = readFileSync(resolve(__dirname, '../../../pages/SaleOrders.tsx'), 'utf8');
    expect(page).toContain('isInfantil && INFANTIL_ORDER_NUMBER_CLASS');
    expect(page).toContain('isInfantil={!!segmentsBySaleOrder[order.id]?.has(\'Infantil\')}');
    // Trava o chip rosa sem literal da classe no .tsx (gate de design tokens).
    expect(INFANTIL_ORDER_NUMBER_CLASS).toMatch(/bg-pink-10\d/);
    expect(INFANTIL_ORDER_NUMBER_CLASS).toMatch(/dark:bg-pink-900\/30/);
  });
});
