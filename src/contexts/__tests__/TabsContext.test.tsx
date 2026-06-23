/**
 * Testes da lógica de navegação da barra de abas (TabsContext): reordenar e os
 * três modos de fechar (outras / à direita / todas). São fáceis de errar por
 * off-by-one, então travamos o contrato aqui.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TabsProvider, useTabs } from '../TabsContext';
import { TabBar } from '@/components/layout/TabBar';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/dashboard']}>
    <TabsProvider>{children}</TabsProvider>
  </MemoryRouter>
);

const paths = (tabs: { path: string }[]) => tabs.map(t => t.path);
const idOf = (tabs: { id: string; path: string }[], path: string) => tabs.find(t => t.path === path)!.id;

function setup() {
  const h = renderHook(() => useTabs(), { wrapper });
  // /dashboard entra sozinha (efeito de auto-criar); abrimos mais três.
  act(() => h.result.current.openTab('/sales'));
  act(() => h.result.current.openTab('/clients'));
  act(() => h.result.current.openTab('/estoque'));
  return h;
}

describe('TabsContext — navegação da barra de abas', () => {
  beforeEach(() => localStorage.clear());

  it('abre abas em ordem e ativa a última', () => {
    const { result } = setup();
    expect(paths(result.current.tabs)).toEqual(['/dashboard', '/sales', '/clients', '/estoque']);
    expect(result.current.activeId).toBe(idOf(result.current.tabs, '/estoque'));
  });

  it('reorderTabs move a aba pra depois do alvo', () => {
    const { result } = setup();
    const dash = idOf(result.current.tabs, '/dashboard');
    const clients = idOf(result.current.tabs, '/clients');
    act(() => result.current.reorderTabs(dash, clients, 'after'));
    expect(paths(result.current.tabs)).toEqual(['/sales', '/clients', '/dashboard', '/estoque']);
  });

  it('reorderTabs move a aba pra antes do alvo', () => {
    const { result } = setup();
    const estoque = idOf(result.current.tabs, '/estoque');
    const sales = idOf(result.current.tabs, '/sales');
    act(() => result.current.reorderTabs(estoque, sales, 'before'));
    expect(paths(result.current.tabs)).toEqual(['/dashboard', '/estoque', '/sales', '/clients']);
  });

  it('closeOthers mantém só a indicada e a torna ativa', () => {
    const { result } = setup();
    const clients = idOf(result.current.tabs, '/clients');
    act(() => result.current.closeOthers(clients));
    expect(paths(result.current.tabs)).toEqual(['/clients']);
    expect(result.current.activeId).toBe(clients);
  });

  it('closeToRight remove as abas à direita; ativa cai na indicada se foi fechada', () => {
    const { result } = setup();
    const clients = idOf(result.current.tabs, '/clients'); // índice 2; /estoque está à direita e é a ativa
    act(() => result.current.closeToRight(clients));
    expect(paths(result.current.tabs)).toEqual(['/dashboard', '/sales', '/clients']);
    expect(result.current.activeId).toBe(clients);
  });

  it('closeAll esvazia e recria a aba do Painel', () => {
    const { result } = setup();
    act(() => result.current.closeAll());
    // navigate('/dashboard') dispara o efeito de auto-criar → sobra só o Painel
    expect(paths(result.current.tabs)).toEqual(['/dashboard']);
  });

  it('TabBar monta sem erro: abas, botão fechar e "+" presentes', () => {
    localStorage.setItem('in-app-tabs-v1', JSON.stringify({
      tabs: [
        { id: 't1', path: '/sales', title: 'Pedidos de Venda' },
        { id: 't2', path: '/estoque', title: 'Estoque' },
      ],
      activeId: 't1',
    }));
    render(
      <MemoryRouter initialEntries={['/sales']}>
        <TabsProvider><TabBar /></TabsProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // título rehidratado a partir da navegação canônica → aria-label do X
    expect(screen.queryByLabelText('Fechar Pedidos de Venda')).not.toBeNull();
    expect(screen.queryByLabelText(/Abrir página/)).not.toBeNull();
  });
});
