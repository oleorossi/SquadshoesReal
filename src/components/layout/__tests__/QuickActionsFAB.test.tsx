import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { QuickActionsFAB } from '../AppLayout';

vi.mock('@/hooks/useAccessControl', () => ({
  useAccessControl: () => ({ canAccessRoute: () => true }),
}));

/**
 * Regressão de produção (27/11/2026): ao clicar em Abrir Ateliê, a tela
 * quebrava com Minified React error #300 porque QuickActionsFAB retornava
 * cedo em /terceirizados e /atelie ANTES de chamar useAccessControl.
 * O componente permanece montado no AppLayout, então a troca de rota
 * reduzia o número de hooks entre renders.
 */
function renderFrom(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QuickActionsFAB />
      <Routes>
        <Route path="/producao" element={<Link to="/terceirizados?tab=corte">Abrir Ateliê</Link>} />
        <Route path="/terceirizados" element={<div>Ateliê corte</div>} />
        <Route path="/atelie" element={<div>Ateliê legado</div>} />
        <Route path="/sales" element={<div>Vendas</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('QuickActionsFAB — ordem de hooks ao abrir o Ateliê', () => {
  it('não dispara React #300 ao navegar de outra rota para /terceirizados?tab=corte', async () => {
    const user = userEvent.setup();
    renderFrom('/producao');
    expect(screen.getByLabelText(/Ações rápidas/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Abrir Ateliê' }));

    expect(screen.getByText('Ateliê corte')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ações rápidas/i)).not.toBeInTheDocument();
  });

  it('também permanece estável ao abrir a rota legada /atelie', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/producao']}>
        <QuickActionsFAB />
        <Routes>
          <Route path="/producao" element={<Link to="/atelie">Abrir legado</Link>} />
          <Route path="/atelie" element={<div>Ateliê legado</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: 'Abrir legado' }));
    expect(screen.getByText('Ateliê legado')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ações rápidas/i)).not.toBeInTheDocument();
  });

  it('continua oculto quando a primeira pintura já é o Ateliê', () => {
    renderFrom('/terceirizados?tab=corte');
    expect(screen.getByText('Ateliê corte')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ações rápidas/i)).not.toBeInTheDocument();
  });
});
