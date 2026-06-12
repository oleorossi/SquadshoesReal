import { describe, it, expect } from 'vitest';
import { reorderKeys, orderNav } from '../useNavOrder';

const sample = () => [
  { label: 'A', icon: 'iconA', items: [{ path: '/a1' }, { path: '/a2' }, { path: '/a3' }] },
  { label: 'B', icon: 'iconB', items: [{ path: '/b1' }, { path: '/b2' }] },
  { label: 'C', icon: 'iconC', items: [{ path: '/c1' }] },
];

describe('reorderKeys', () => {
  const list = () => ['a', 'b', 'c', 'd'];

  it('move pra cima (before)', () => {
    expect(reorderKeys(list(), 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('move pra baixo (before)', () => {
    expect(reorderKeys(list(), 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('move pro fim (after no último)', () => {
    expect(reorderKeys(list(), 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a']);
  });

  it('after antes do alvo no meio', () => {
    expect(reorderKeys(list(), 'a', 'b', 'after')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('soltar em si mesmo = no-op', () => {
    expect(reorderKeys(list(), 'b', 'b', 'before')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('chave inexistente = lista intacta', () => {
    expect(reorderKeys(list(), 'z', 'b', 'before')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('não muta a lista original', () => {
    const original = list();
    reorderKeys(original, 'a', 'c', 'before');
    expect(original).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('orderNav', () => {
  it('sem ordem salva = ordem original', () => {
    const out = orderNav(sample(), [], {});
    expect(out.map(g => g.label)).toEqual(['A', 'B', 'C']);
    expect(out[0].items.map(i => i.path)).toEqual(['/a1', '/a2', '/a3']);
  });

  it('reordena grupos pela ordem salva', () => {
    const out = orderNav(sample(), ['C', 'A', 'B'], {});
    expect(out.map(g => g.label)).toEqual(['C', 'A', 'B']);
  });

  it('preserva props do grupo (ex.: icon)', () => {
    const out = orderNav(sample(), ['C', 'A', 'B'], {});
    expect(out[0]).toMatchObject({ label: 'C', icon: 'iconC' });
  });

  it('reordena itens dentro do grupo', () => {
    const out = orderNav(sample(), [], { A: ['/a3', '/a1', '/a2'] });
    expect(out.find(g => g.label === 'A')!.items.map(i => i.path)).toEqual(['/a3', '/a1', '/a2']);
    // outros grupos intactos
    expect(out.find(g => g.label === 'B')!.items.map(i => i.path)).toEqual(['/b1', '/b2']);
  });

  it('grupo não listado fica no fim preservando ordem original (estável)', () => {
    const out = orderNav(sample(), ['B'], {});
    expect(out.map(g => g.label)).toEqual(['B', 'A', 'C']);
  });

  it('item novo (fora da ordem salva) aparece no fim do grupo', () => {
    // ordem salva só conhece a2 e a1 — a3 foi adicionado depois no código
    const out = orderNav(sample(), [], { A: ['/a2', '/a1'] });
    expect(out.find(g => g.label === 'A')!.items.map(i => i.path)).toEqual(['/a2', '/a1', '/a3']);
  });

  it('label desconhecido na ordem salva é ignorado sem quebrar', () => {
    const out = orderNav(sample(), ['Z', 'C', 'A', 'B'], {});
    expect(out.map(g => g.label)).toEqual(['C', 'A', 'B']);
  });
});
