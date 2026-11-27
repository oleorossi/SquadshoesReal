import { describe, expect, it } from 'vitest';
import { searchScreens } from '../screenSearch';

function top(query: string) {
  return searchScreens(query)[0];
}

describe('busca de telas', () => {
  it('acha Fichas por ficha técnica, sem acento, e no plural', () => {
    for (const query of ['ficha técnica', 'FICHA TECNICA', 'fichas', 'ficha', 'fich tec']) {
      const hit = top(query);
      expect(hit?.path, query).toBe('/fichas-tecnicas');
      expect(hit?.label).toBe('Fichas');
      expect(hit?.sector).toBe('Engenharia');
    }
  });

  it('acha Pedidos de compra por ordem de compra', () => {
    const hit = top('ordem de compra');
    expect(hit?.path).toBe('/purchase-orders');
    expect(hit?.label).toBe('Pedidos de compra');
    expect(hit?.sector).toBe('Compras');
  });

  it('acha Faturamento por fiscal e a NF-e por nfe', () => {
    const fiscal = top('fiscal');
    expect(fiscal?.path).toBe('/fiscal');
    expect(fiscal?.label).toBe('Faturamento');
    expect(fiscal?.sector).toBe('Faturamento');

    const nfe = top('nfe');
    expect(nfe?.path).toBe('/nfe');
    expect(nfe?.sector).toBe('Faturamento');
  });

  it('acha o rótulo antigo de Pedidos, Corte, Gestão e PCP', () => {
    expect(top('pedidos de venda')?.path).toBe('/sales');
    expect(top('PV')?.path).toBe('/sales');
    expect(top('fila de corte')?.path).toBe('/producao/corte-lookahead');
    expect(top('modo gestão')?.path).toBe('/producao/kanban');
    expect(top('engenharia')?.path).toBe('/engenharia');
    expect(top('engenharia')?.label).toBe('Engenharia');
    expect(top('PCP')?.path).toBe('/engenharia');
    expect(top('almoxarifado')?.path).toBe('/materiais');
    expect(top('almoxarifado')?.label).toBe('Estoque');
  });

  it('acha Ateliê sem acento', () => {
    const hit = top('atelie');
    expect(hit?.path).toBe('/atelie');
    expect(hit?.label).toBe('Ateliê');
    expect(hit?.sector).toBe('Produção');
  });

  it('tolera um erro em palavra de 4 letras ou mais', () => {
    const hit = top('ficha tecnca');
    expect(hit?.path).toBe('/fichas-tecnicas');
  });

  it('rótulo exato vem antes de sinônimo', () => {
    const hits = searchScreens('nfe');
    expect(hits[0]?.path).toBe('/nfe');
    expect(hits.find((hit) => hit.path === '/fiscal')).toBeTruthy();
    expect(hits[0].rank).toBeGreaterThan(hits.find((hit) => hit.path === '/fiscal')!.rank);
  });
});
