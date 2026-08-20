import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import StrapCalculator from '@/pages/StrapCalculator';

describe('Calculadora de Tiras', () => {
  it('simula uma nova medida com perda sem carregar ou salvar receita', async () => {
    const user = userEvent.setup();
    render(<StrapCalculator embedded />);

    expect(screen.getByText('Base desta simulação')).toBeInTheDocument();
    expect(screen.queryByText(/receita aprovada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rendimento confirmado da receita/i)).not.toBeInTheDocument();

    const larguraBanda = screen.getByLabelText('Largura da banda de corte');
    await user.clear(larguraBanda);
    await user.type(larguraBanda, '18');
    await user.click(screen.getByRole('radio', { name: 'Perda estimada' }));

    const perda = screen.getByLabelText('Perda estimada');
    await user.clear(perda);
    await user.type(perda, '10');
    await user.click(screen.getByRole('button', { name: 'Calcular' }));

    expect(screen.getByText('Rendimento usado na simulação')).toBeInTheDocument();
    expect(screen.getByText('68,4')).toBeInTheDocument();
    expect(screen.getByText(/nenhum valor desta aba é salvo/i)).toBeInTheDocument();
    expect(screen.getByText(/não é reaplicada/i)).toBeInTheDocument();
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
