import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PayrollClosingSelector } from './PayrollClosingSelector';

describe('PayrollClosingSelector', () => {
  it('oferece somente fechamento quinzenal ou mensal', () => {
    render(
      <PayrollClosingSelector
        value={{ from: '2026-08-01', to: '2026-08-31' }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Fechar quinzena/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fechar mês/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hoje/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Semana$/i })).toBeNull();
    expect(screen.queryByLabelText('Data inicial')).toBeNull();
    expect(screen.queryByLabelText('Data final')).toBeNull();
  });

  it('abre a primeira quinzena ao trocar o mês completo por quinzena', () => {
    const onChange = vi.fn();
    render(
      <PayrollClosingSelector
        value={{ from: '2026-08-01', to: '2026-08-31' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Fechar quinzena/i }));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-15' });
  });

  it('permite escolher a segunda quinzena sem editar datas livres', () => {
    const onChange = vi.fn();
    render(
      <PayrollClosingSelector
        value={{ from: '2026-08-01', to: '2026-08-15' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /2ª quinzena/i }));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-08-16', to: '2026-08-31' });
  });
});
