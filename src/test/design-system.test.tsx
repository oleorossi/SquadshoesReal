import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DesignSystemPage from '@/pages/DesignSystem';
import { systemItems } from '@/data/navigation';

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

  it('verifica se o item "Design System" está presente no menu de sistema com o link correto', () => {
    const dsItem = systemItems.find(item => item.label === 'Design System');
    expect(dsItem).toBeDefined();
    expect(dsItem?.to).toBe('/design-system');
  });
});
