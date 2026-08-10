import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { useEffect } from 'react';

/**
 * Guard do bug crítico da cópia parcial de itens do PV (2026-08-10).
 *
 * `/sales/new` e `/sales/edit/:id` são rotas IRMÃS que renderizam o MESMO
 * componente (`SaleOrderForm`) na MESMA profundidade. O react-router cria o
 * wrapper interno (`RenderedRoute`) SEM chave própria, então React reconcilia no
 * lugar ao trocar de uma rota pra outra: o componente NÃO remonta e nenhum
 * efeito de montagem roda de novo.
 *
 * Consequência real: sair da edição pra "Novo Pedido" mantinha os itens, as
 * datas e o cliente do pedido ANTIGO numa tela que se diz nova — e o seed da
 * cópia parcial (consumido num efeito de montagem) nunca era lido.
 *
 * O remédio é a chave distinta em cada rota, em `App.tsx`. Estes testes travam
 * as duas pontas: o MECANISMO (pra ninguém "simplificar" a chave achando que
 * era decorativa) e a PRESENÇA da chave no App.
 */
describe('remontagem entre /sales/new e /sales/edit/:id', () => {
  let mounts = 0;

  function Probe() {
    useEffect(() => { mounts += 1; }, []);
    return <div>probe</div>;
  }

  const renderRoutes = (keyed: boolean) => {
    const router = createMemoryRouter(
      [
        {
          path: '/sales',
          element: <Outlet />,
          children: [
            { path: 'new', element: keyed ? <Probe key="new" /> : <Probe /> },
            { path: 'edit/:id', element: keyed ? <Probe key="edit" /> : <Probe /> },
          ],
        },
      ],
      { initialEntries: ['/sales/edit/pv-1'] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };

  beforeEach(() => { mounts = 0; });

  it('SEM chave o componente não remonta — é a armadilha que quebrou a cópia', async () => {
    const router = renderRoutes(false);
    expect(mounts).toBe(1);
    await act(async () => { await router.navigate('/sales/new'); });
    // Mesmo tipo, mesma posição: React atualiza no lugar. Nenhum efeito de
    // montagem roda de novo — e todo o estado do pedido editado sobrevive.
    expect(mounts).toBe(1);
  });

  it('COM chaves distintas a troca remonta e os efeitos de montagem voltam a rodar', async () => {
    const router = renderRoutes(true);
    expect(mounts).toBe(1);
    await act(async () => { await router.navigate('/sales/new'); });
    expect(mounts).toBe(2);
  });

  it('App.tsx mantém chaves distintas nas duas rotas do formulário de PV', () => {
    const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    const novo = appSrc.match(/\{\s*path:\s*"new",\s*element:\s*<SaleOrderForm([^>]*)\/>/);
    const edicao = appSrc.match(/\{\s*path:\s*"edit\/:id",\s*element:\s*<SaleOrderForm([^>]*)\/>/);
    expect(novo, 'rota /sales/new não encontrada em App.tsx').not.toBeNull();
    expect(edicao, 'rota /sales/edit/:id não encontrada em App.tsx').not.toBeNull();

    const keyOf = (m: RegExpMatchArray | null) => (m?.[1].match(/key="([^"]+)"/) || [])[1];
    const keyNovo = keyOf(novo);
    const keyEdicao = keyOf(edicao);
    expect(keyNovo, 'a rota /sales/new perdeu a chave').toBeTruthy();
    expect(keyEdicao, 'a rota /sales/edit/:id perdeu a chave').toBeTruthy();
    expect(keyNovo).not.toBe(keyEdicao);
  });
});
