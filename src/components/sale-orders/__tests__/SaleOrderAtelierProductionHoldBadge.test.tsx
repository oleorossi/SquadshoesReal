import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaleOrderAtelierProductionHoldBadge } from '@/components/sale-orders/SaleOrderAtelierProductionHoldBadge';
import type { AtelierProductionHoldLine } from '@/lib/atelierProductionHold';

const hold: AtelierProductionHoldLine = {
  saleOrderId: 'pv',
  itemId: 'item-1',
  referenceCode: 'I701',
  color: 'PRETO',
  pendingJobs: 'dddddddd-dddd-dddd-dddd-dddddddddddd · costura · sent_to_contractor',
  reason: 'Ateliê — costura só libera após recebido e conferido (status: sent_to_contractor)',
};

describe('selo de cabedal no Ateliê', () => {
  it('avisa que Em Produção fica bloqueada e a aprovação continua', () => {
    render(<SaleOrderAtelierProductionHoldBadge status="Aprovado" holds={[hold]} />);
    expect(screen.getByRole('button', { name: /Em Produção fica bloqueada até o retorno/i }))
      .toHaveTextContent('Ateliê (1)');
    expect(screen.getByRole('button', { name: /Aprovação continua liberada/i })).toBeInTheDocument();
  });

  it('não aparece em pedido que já está em produção nem sem pendência', () => {
    const { rerender } = render(
      <SaleOrderAtelierProductionHoldBadge status="Em Produção" holds={[hold]} />,
    );
    expect(screen.queryByRole('button', { name: /Ateliê/i })).toBeNull();
    rerender(<SaleOrderAtelierProductionHoldBadge status="Aprovado" holds={[]} />);
    expect(screen.queryByRole('button', { name: /Ateliê/i })).toBeNull();
  });
});
