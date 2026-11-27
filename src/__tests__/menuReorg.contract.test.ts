import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUBS, ROLE_MENU_PRESENTATION, navigationCatalog } from '@/data/navigation';
import { canonicalizeFavorites } from '@/hooks/useMenuFavorites';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('reorganização dos menus (aprovada 27/11)', () => {
  it('ordena as Áreas no fluxo da fábrica e renomeia o hub PCP para Engenharia', () => {
    expect(HUBS.map((hub) => hub.label)).toEqual([
      'Comercial', 'Produção', 'Engenharia', 'Estoque', 'Compras',
      'Expedição', 'Faturamento', 'Financeiro', 'Pessoas',
    ]);
    expect(HUBS.find((hub) => hub.path === '/engenharia')?.label).toBe('Engenharia');
  });

  it('coloca o Motor como primeiro item de Produção e o chão de fábrica logo abaixo', () => {
    const producao = HUBS.find((hub) => hub.path === '/producao');
    expect(producao?.children.map((child) => child.path)).toEqual([
      '/motor',
      '/producao/kanban',
      '/producao/apontamento',
      '/terceirizados',
      '/producao/corte-lookahead',
      '/imprimir-fichas',
      '/producao/calculadora-grade',
      '/producao/analises',
      '/producao/estouro',
    ]);
    expect(navigationCatalog.find((item) => item.path === '/producao/kanban')?.label).toBe('Central de Produção');
  });

  it('deixa Engenharia só com cadastro técnico, sem sequência, planejamentos ou grade', () => {
    const engenharia = HUBS.find((hub) => hub.path === '/engenharia');
    expect(engenharia?.children.map((child) => child.path)).toEqual([
      '/fichas-tecnicas',
      '/engenharia/fichas-rascunho',
      '/engenharia/materiais-base',
      '/escalonamento',
      '/solados',
      '/silks',
      '/tiras-artesanais',
    ]);
  });

  it('move o planejamento de compras para Compras e corrige rótulos vagos', () => {
    const compras = HUBS.find((hub) => hub.path === '/compras');
    expect(compras?.children[0]?.path).toBe('/purchase-planning');
    expect(navigationCatalog.find((item) => item.path === '/purchase-planning')?.label).toBe('Planejamento de compras');
    expect(navigationCatalog.find((item) => item.path === '/purchase-orders/per-pv')?.label).toBe('OCs por pedido');
    expect(navigationCatalog.find((item) => item.path === '/ajuste-estoque')?.label).toBe('Ajuste de estoque');
    expect(navigationCatalog.find((item) => item.path === '/etiquetagem-cliente')?.label).toBe('Etiquetas do cliente');
  });

  it('remove o item órfão OS prestadores do catálogo', () => {
    expect(navigationCatalog.some((item) => item.path === '/terceirizados?tab=gestao')).toBe(false);
    expect(read('src/data/navigation.ts')).not.toContain('OS prestadores');
  });

  it('faz o perfil produção cair no Motor', () => {
    expect(ROLE_MENU_PRESENTATION.producao.home).toBe('/motor');
  });

  it('redireciona as rotas antigas do motor sem mexer nas que são outra coisa', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('LegacyRouteRedirect to="/motor?tab=sequencia"');
    expect(app).toContain('LegacyRouteRedirect to="/motor?tab=capacidade"');
    expect(app).toContain('function PlanejamentoToMotorRedirect');
    expect(app).toContain("incoming.set('tab', 'plano')");
    expect(app).toContain('LegacyRouteRedirect to="/producao/apontamento"');
    expect(app).toContain('path: "/producao/kanban/gestao"');
  });

  it('absorve a fila diária em Plano e agenda e não liga o motor automático', () => {
    const page = read('src/pages/MotorProducao.tsx');
    expect(page).toContain('<ProducaoPlanejamento embedded />');
    expect(page).toContain('Fila do dia');
    expect(page).not.toMatch(/auto_motor_enabled\s*:\s*true/);
  });

  it('reescreve favoritos antigos do motor sem apagá-los', () => {
    expect(canonicalizeFavorites([
      { name: 'Sequência', path: '/producao/sequencia' },
      { name: 'Setores', path: '/producao/setores' },
      { name: 'Planejamento', path: '/producao/planejamento' },
      { name: 'Pedidos', path: '/sales' },
    ])).toEqual([
      { name: 'Sequência', path: '/motor?tab=sequencia' },
      { name: 'Capacidade e equipe', path: '/motor?tab=capacidade' },
      { name: 'Plano e agenda', path: '/motor?tab=plano' },
      { name: 'Pedidos', path: '/sales' },
    ]);
  });
});
