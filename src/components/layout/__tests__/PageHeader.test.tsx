import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PageHeader from '../PageHeader';

/**
 * Guarda do breadcrumb (achado F8 da auditoria de IA, 29/07/2026).
 *
 * O mapa antigo era manual e tinha `parentGroups['producao'] = { label:
 * 'Produção', to: '/pcp' }` ao lado de `routeLabels['producao'] = 'Produção'`.
 * O algoritmo empurrava o pai e depois TODOS os segmentos, então `/producao/kanban`
 * saía como **"Produção › Produção › Kanban"** — e o primeiro "Produção" levava
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
    expect(trilha).toEqual(['Produção', 'Kanban']);
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
});
