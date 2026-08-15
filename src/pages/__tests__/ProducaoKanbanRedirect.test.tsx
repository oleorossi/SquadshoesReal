import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ProducaoKanban from '@/pages/ProducaoKanban';

describe('rota antiga do Kanban', () => {
  it('substitui a área desativada pelo Modo Gestão', () => {
    render(
      <MemoryRouter initialEntries={['/producao/kanban']}>
        <Routes>
          <Route path="/producao/kanban" element={<ProducaoKanban />} />
          <Route path="/producao/kanban/gestao" element={<div>Modo Gestão ativo</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Modo Gestão ativo')).toBeInTheDocument();
  });
});
