import { describe, it, expect } from 'vitest';
import { canonicalizeFavorites } from '../useMenuFavorites';

// Favoritos fixados antes de uma reorganização de menu viram "fantasmas":
// apontam pra uma rota que virou redirect e aparecem como item duplicado na
// sidebar. canonicalizeFavorites reescreve pro destino canônico e deduplica.
describe('canonicalizeFavorites', () => {
  it('reescreve rota legada (/ordens-servico) pro hub canônico /terceirizados', () => {
    const out = canonicalizeFavorites([{ name: 'Ordens de Serviço', path: '/ordens-servico' }]);
    expect(out).toEqual([{ name: 'Ordens de Serviço', path: '/terceirizados' }]);
  });

  it('deduplica: Terceirizados (nome antigo) + Ordens de Serviço (fantasma) viram UM item', () => {
    const out = canonicalizeFavorites([
      { name: 'Terceirizados', path: '/terceirizados' },
      { name: 'Ordens de Compra', path: '/purchase-orders' },
      { name: 'Ordens de Serviço', path: '/ordens-servico' },
    ]);
    expect(out).toEqual([
      { name: 'Ordens de Serviço', path: '/terceirizados' },
      { name: 'Ordens de Compra', path: '/purchase-orders' },
    ]);
  });

  it('mantém favoritos válidos intactos', () => {
    const favs = [
      { name: 'Pedidos de Venda', path: '/sales' },
      { name: 'Estoque', path: '/estoque' },
    ];
    expect(canonicalizeFavorites(favs)).toEqual(favs);
  });

  it('descarta entradas sem path ou name', () => {
    const out = canonicalizeFavorites([
      { name: 'Estoque', path: '/estoque' },
      { name: '', path: '/x' } as any,
      { name: 'Y', path: '' } as any,
      null as any,
    ]);
    expect(out).toEqual([{ name: 'Estoque', path: '/estoque' }]);
  });

  it('é idempotente', () => {
    const favs = [
      { name: 'Terceirizados', path: '/terceirizados' },
      { name: 'Ordens de Serviço', path: '/ordens-servico' },
    ];
    const once = canonicalizeFavorites(favs);
    expect(canonicalizeFavorites(once)).toEqual(once);
    expect(once).toEqual([{ name: 'Ordens de Serviço', path: '/terceirizados' }]);
  });

  it('todos os redirects de terceirização caem em /terceirizados', () => {
    for (const p of ['/contractors', '/terceiros', '/terceiros-na-rua', '/terceiros/relatorios']) {
      const out = canonicalizeFavorites([{ name: 'X', path: p }]);
      expect(out[0].path).toBe('/terceirizados');
    }
  });
});
