import { describe, it, expect } from 'vitest';
import { fetchPage, pageWindow, emptyPage, PAGE_SIZE, PAGER_THRESHOLD } from '../pagination';

/** Simula o PostgREST: respeita o range pedido e devolve o count exato. */
function fakeTable(totalRows: number) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: i + 1 }));
  const calls: Array<{ from: number; to: number }> = [];
  const page = (from: number, to: number) => {
    calls.push({ from, to });
    return Promise.resolve({ data: all.slice(from, to + 1), error: null, count: totalRows });
  };
  return { page, calls };
}

describe('fetchPage — limiar do pager', () => {
  it('total abaixo do limiar devolve TUDO e esconde o pager', async () => {
    const { page } = fakeTable(43); // clientes: 43 linhas
    const res = await fetchPage(page);
    expect(res.items).toHaveLength(43);
    expect(res.showPager).toBe(false);
    expect(res.isComplete).toBe(true);
    expect(res.totalPages).toBe(1);
  });

  /**
   * O caso que justifica o limiar (75) ser MAIOR que a página (50).
   * Se a página 1 devolvesse 50 linhas e o pager ficasse escondido, 10 linhas
   * sumiriam sem aviso — o bug de truncamento silencioso que a paginação
   * server-side existe pra matar. Regressão aqui é grave.
   */
  it('total ENTRE a página e o limiar devolve tudo — não esconde linha', async () => {
    const { page } = fakeTable(60);
    const res = await fetchPage(page);
    expect(res.items).toHaveLength(60);
    expect(res.showPager).toBe(false);
    expect(res.items.at(-1)).toEqual({ id: 60 });
  });

  it('total exatamente no limiar ainda mostra tudo sem pager', async () => {
    const { page } = fakeTable(PAGER_THRESHOLD);
    const res = await fetchPage(page);
    expect(res.items).toHaveLength(PAGER_THRESHOLD);
    expect(res.showPager).toBe(false);
  });

  it('uma linha acima do limiar liga o pager e a página vira PAGE_SIZE', async () => {
    const { page } = fakeTable(PAGER_THRESHOLD + 1);
    const res = await fetchPage(page);
    expect(res.showPager).toBe(true);
    expect(res.items).toHaveLength(PAGE_SIZE);
    expect(res.isComplete).toBe(false);
    expect(res.total).toBe(PAGER_THRESHOLD + 1);
  });
});

describe('fetchPage — janelas de leitura', () => {
  it('página 1 lê até o limiar em UMA ida ao banco', async () => {
    const { page, calls } = fakeTable(500);
    await fetchPage(page, { page: 1 });
    expect(calls).toEqual([{ from: 0, to: PAGER_THRESHOLD - 1 }]);
  });

  it('página 2+ lê a janela normal de PAGE_SIZE', async () => {
    const { page, calls } = fakeTable(500);
    const res = await fetchPage(page, { page: 3 });
    expect(calls).toEqual([{ from: 100, to: 149 }]);
    expect(res.items).toHaveLength(PAGE_SIZE);
    expect(res.items[0]).toEqual({ id: 101 });
    expect(res.page).toBe(3);
    expect(res.totalPages).toBe(10);
  });

  it('página fracionária/zero/negativa cai pra 1 em vez de gerar range inválido', async () => {
    const { page, calls } = fakeTable(500);
    await fetchPage(page, { page: 0 });
    await fetchPage(page, { page: -5 });
    expect(calls).toEqual([
      { from: 0, to: PAGER_THRESHOLD - 1 },
      { from: 0, to: PAGER_THRESHOLD - 1 },
    ]);
  });

  it('última página parcial devolve só o resto', async () => {
    const { page } = fakeTable(120);
    const res = await fetchPage(page, { page: 3 });
    expect(res.items).toHaveLength(20);
    expect(res.totalPages).toBe(3);
  });
});

describe('fetchPage — contratos', () => {
  it('estoura quando a query esqueceu { count: exact } em vez de mascarar o total', async () => {
    const semCount = () => Promise.resolve({ data: [{ id: 1 }], error: null, count: null });
    await expect(fetchPage(semCount)).rejects.toThrow(/count/);
  });

  it('propaga erro do PostgREST em vez de devolver lista vazia', async () => {
    const comErro = () =>
      Promise.resolve({ data: null, error: new Error('coluna inexistente'), count: null });
    await expect(fetchPage(comErro)).rejects.toThrow('coluna inexistente');
  });

  it('limiar customizado nunca fica abaixo do tamanho da página', async () => {
    const { page } = fakeTable(40);
    // pagerThreshold(10) < pageSize(50) esconderia linha; o helper eleva pro pageSize.
    const res = await fetchPage(page, { pageSize: 50, pagerThreshold: 10 });
    expect(res.showPager).toBe(false);
    expect(res.items).toHaveLength(40);
  });

  it('tabela vazia não quebra', async () => {
    const { page } = fakeTable(0);
    const res = await fetchPage(page);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(1);
    expect(res.showPager).toBe(false);
  });
});

describe('pageWindow', () => {
  it('sem elipse quando cabe', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('elipse dos dois lados no meio', () => {
    expect(pageWindow(7, 20)).toEqual([1, '…', 6, 7, 8, '…', 20]);
  });

  it('sem elipse degenerada de 1 página pulada', () => {
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('página única', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('emptyPage', () => {
  it('é seguro pra hook desabilitado', () => {
    const res = emptyPage();
    expect(res.items).toEqual([]);
    expect(res.showPager).toBe(false);
    expect(res.isComplete).toBe(true);
  });
});
