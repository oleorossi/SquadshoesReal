import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import StrapCalculator from '@/pages/StrapCalculator';

describe('Calculadora de Tiras', () => {
  it('simula uma nova medida pelo rendimento teórico sem oferecer perda percentual', async () => {
    const user = userEvent.setup();
    render(<StrapCalculator embedded />);

    expect(screen.getByText('Base desta simulação')).toBeInTheDocument();
    expect(screen.queryByText(/receita aprovada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rendimento confirmado da receita/i)).not.toBeInTheDocument();

    const larguraBanda = screen.getByLabelText('Largura da banda de corte');
    await user.clear(larguraBanda);
    await user.type(larguraBanda, '18');
    expect(screen.queryByRole('radio', { name: /perda/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/perda/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calcular' }));

    expect(screen.getByText('Rendimento teórico · por metro linear')).toBeInTheDocument();
    expect(screen.getByText(/resultado usa somente a capacidade geométrica/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum valor desta aba é salvo/i)).toBeInTheDocument();
  });

  it('exige rendimento quando a base real é escolhida', async () => {
    const user = userEvent.setup();
    render(<StrapCalculator embedded />);

    const larguraBanda = screen.getByLabelText('Largura da banda de corte');
    await user.clear(larguraBanda);
    await user.type(larguraBanda, '20');
    await user.click(screen.getByRole('radio', { name: 'Rendimento real' }));
    await user.click(screen.getByRole('button', { name: 'Calcular' }));

    expect(screen.getByText('Informe o rendimento real medido.')).toBeInTheDocument();
  });
});
