import { describe, expect, it } from 'vitest';
import { remapSelectionAfterRemoval } from '../SaleOrderFormPanel';

/**
 * A seleção da barra de lote do PV é guardada por ÍNDICE. Remover um item
 * desloca todos os que vêm depois, então a seleção precisa acompanhar — senão a
 * ação em lote cai no item que passou a ocupar aquele índice, em silêncio.
 *
 * O caso caro é a cópia pra novo PV: levaria a referência errada pro pedido novo
 * sem nenhum aviso na tela.
 */
describe('remapSelectionAfterRemoval', () => {
  const remap = (sel: number[], removed: number) =>
    [...remapSelectionAfterRemoval(new Set(sel), removed)].sort((a, b) => a - b);

  it('desloca quem vinha DEPOIS do removido', () => {
    // itens [A,B,C,D], marcados B(1) e D(3); apaga C(2) -> [A,B,D], D vira 2
    expect(remap([1, 3], 2)).toEqual([1, 2]);
  });

  it('mantém intactos os índices ANTES do removido', () => {
    expect(remap([0, 1], 3)).toEqual([0, 1]);
  });

  it('tira da seleção o próprio item removido', () => {
    expect(remap([0, 2, 4], 2)).toEqual([0, 3]);
  });

  it('remover o primeiro desce todo mundo uma casa', () => {
    expect(remap([1, 2, 3], 0)).toEqual([0, 1, 2]);
  });

  it('seleção vazia continua vazia', () => {
    expect(remap([], 1)).toEqual([]);
  });

  it('remover o único selecionado esvazia a seleção', () => {
    expect(remap([2], 2)).toEqual([]);
  });

  it('não inventa índice: o resultado nunca aponta além do array encurtado', () => {
    const itens = 5;               // índices 0..4
    const sel = new Set([0, 1, 2, 3, 4]);
    const depois = remapSelectionAfterRemoval(sel, 2);
    expect(depois.size).toBe(itens - 1);
    depois.forEach(i => expect(i).toBeLessThan(itens - 1));
  });
});
