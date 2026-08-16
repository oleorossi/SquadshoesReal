import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SalesOperationsRail from '@/components/sale-orders/SalesOperationsRail';

describe('SalesOperationsRail', () => {
  it('apresenta a carga visível como um único instrumento operacional', () => {
    render(
      <SalesOperationsRail
        scopeLabel="Pedidos ativos"
        orderCount={6}
        pairs={8240}
        drafts={1}
        approved={0}
        inProduction={5}
        deadlineRisk={3}
        total="R$ 166.993,60"
      />,
    );

    expect(screen.getByLabelText('Carga operacional: Pedidos ativos')).toHaveTextContent('6pedidos');
    expect(screen.getByLabelText('Carga operacional: Pedidos ativos')).toHaveTextContent('8.240pares');
    expect(screen.getByText('Prazo crítico').closest('div')).toHaveTextContent('3');
    expect(screen.getByText('Valor visível').closest('div')).toHaveTextContent('R$ 166.993,60');
  });

  it('omite valores financeiros quando não foram fornecidos', () => {
    render(
      <SalesOperationsRail
        scopeLabel="Pedidos ativos"
        orderCount={2}
        pairs={288}
        drafts={0}
        approved={1}
        inProduction={1}
        deadlineRisk={0}
      />,
    );

    expect(screen.queryByText('Valor visível')).not.toBeInTheDocument();
  });
});
