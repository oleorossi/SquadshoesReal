import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DesignSystemPage from '@/pages/DesignSystem';

// Mock do componente pesado do Design System para focar na estrutura de navegação/renderização
vi.mock('@/design-system/App', () => ({
  default: () => (
    <div data-testid="design-system-root">
      <nav data-testid="ds-sidebar">Sidebar Mock</nav>
      <header data-testid="ds-topbar">Topbar Mock</header>
      <main>Conteúdo Mock</main>
    </div>
  )
}));

describe('Design System - Navegação e Renderização', () => {
  it('renderiza o container do Design System com Suspense', async () => {
    render(
      <MemoryRouter>
        <DesignSystemPage />
      </MemoryRouter>
    );
    
    // Como é lazy loaded, o primeiro render pode mostrar o fallback ou o componente mockado
    // dependendo da velocidade do mock, mas o objetivo é garantir que não quebra.
    const root = await screen.findByTestId('design-system-root');
    expect(root).toBeInTheDocument();
    expect(screen.getByTestId('ds-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('ds-topbar')).toBeInTheDocument();
  });

  // Teste de "Design System está em systemItems" removido — o item foi
  // intencionalmente retirado do sidebar de sistema; a página `/design-system`
  // não é mais rota pública. O componente continua sendo testado acima
  // (render isolado via MemoryRouter).
});
