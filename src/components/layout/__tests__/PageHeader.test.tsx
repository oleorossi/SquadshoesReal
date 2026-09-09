import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PageHeader, { resolveMobileNavMeta } from '../PageHeader';

/**
 * Guarda do breadcrumb (achado F8 da auditoria de IA, 29/07/2026).
 *
 * O mapa antigo era manual e tinha `parentGroups['producao'] = { label:
 * 'Produção', to: '/pcp' }` ao lado de `routeLabels['producao'] = 'Produção'`.
 * O algoritmo empurrava o pai e depois TODOS os segmentos, então `/producao/kanban`
 * saía como **"Produção › Produção › Modo Gestão"** — e o primeiro "Produção" levava
 * ao `/pcp`, que já era um tradutor morto.
 *
 * Agora os rótulos e grupos vêm de `navigation.ts`. Estes testes travam as três
 * propriedades que importam: não repetir, não linkar pra redirect, e nomear o
 * destino pelo rótulo do menu — não pelo slug da URL.
 */
function crumbs(path: string) {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <PageHeader />
    </MemoryRouter>,
  );
  return Array.from(container.querySelectorAll('li'))
    .map((li) => li.textContent?.trim())
    .filter((t): t is string => !!t);
}

describe('PageHeader — breadcrumb derivado da navegação', () => {
  it('não repete o grupo quando o primeiro segmento já é o próprio grupo', () => {
    const trilha = crumbs('/producao/kanban');
    expect(trilha).toEqual(['Produção', 'Modo Gestão']);
    // A regressão original: 'Produção' duas vezes seguidas.
    expect(trilha.filter((c) => c === 'Produção')).toHaveLength(1);
  });

  it('nomeia o destino pelo rótulo do menu, não pelo slug da URL', () => {
    // O slug é "fichas-tecnicas"; o menu chama de "Fichas Técnicas".
    expect(crumbs('/fichas-tecnicas')).toContain('Fichas Técnicas');
  });

  it('não emite crumb nenhum no Painel', () => {
    expect(crumbs('/dashboard')).toHaveLength(0);
  });

  it('nenhum crumb aponta para /pcp — o hub virou só tradutor de bookmark', () => {
    for (const path of ['/producao/kanban', '/producao/apontamento', '/producao/analises', '/orders']) {
      const { container } = render(
        <MemoryRouter initialEntries={[path]}>
          <PageHeader />
        </MemoryRouter>,
      );
      const alvos = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(alvos).not.toContain('/pcp');
    }
  });

  it('a visão de Análises entra como último crumb e o hub vira link', () => {
    const trilha = crumbs('/producao/analises?view=gargalos');
    expect(trilha.at(-1)).toBe('Gargalos');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href')))
      .toContain('/producao/analises');
  });

  it('UUID no fim vira "Detalhe", não o hash cru', () => {
    const trilha = crumbs('/estoque/3f2a41bc-8e0d-4a1b-9c2d-1234567890ab');
    expect(trilha.at(-1)).toBe('Detalhe');
    expect(trilha.join(' ')).not.toMatch(/3f2a/i);
  });

  it('UUID no meio some quando o próximo segmento já rotula a ação', () => {
    const trilha = crumbs('/orders/3f2a41bc-8e0d-4a1b-9c2d-1234567890ab/edit');
    expect(trilha.at(-1)).toBe('Editar');
    expect(trilha.join(' ')).not.toMatch(/3f2a|Detalhe/i);
  });
});

describe('resolveMobileNavMeta', () => {
  it('no painel devolve Painel / Início', () => {
    expect(resolveMobileNavMeta('/dashboard')).toEqual({ label: 'Painel', group: 'Início' });
    expect(resolveMobileNavMeta('/')).toEqual({ label: 'Painel', group: 'Início' });
  });

  it('usa o rótulo e o grupo do catálogo', () => {
    expect(resolveMobileNavMeta('/sales')).toEqual({ label: 'Pedidos de Venda', group: 'Comercial' });
    expect(resolveMobileNavMeta('/producao/planejamento')).toEqual({
      label: 'Planejamento',
      group: 'Produção',
    });
  });

  it('em Análises usa o rótulo da visão na query', () => {
    expect(resolveMobileNavMeta('/producao/analises', '?view=oee')).toEqual({
      label: 'Paradas & OEE',
      group: 'Produção',
    });
  });
});
