import { describe, it, expect } from 'vitest';
import { reorderKeys, insertKey, orderNav } from '../useNavOrder';

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

describe('insertKey', () => {
  it('insere de FORA antes do alvo (move entre grupos)', () => {
    expect(insertKey(['x', 'y', 'z'], 'novo', 'y', 'before')).toEqual(['x', 'novo', 'y', 'z']);
  });

  it('insere de fora depois do último', () => {
    expect(insertKey(['x', 'y'], 'novo', 'y', 'after')).toEqual(['x', 'y', 'novo']);
  });

  it('reordena quando a chave já está na lista (= reorderKeys)', () => {
    expect(insertKey(['a', 'b', 'c'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c']);
  });

  it('remove duplicata prévia antes de inserir', () => {
    expect(insertKey(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('soltar em si mesmo = no-op', () => {
    expect(insertKey(['a', 'b'], 'a', 'a', 'before')).toEqual(['a', 'b']);
  });

  it('alvo inexistente = lista intacta', () => {
    expect(insertKey(['a', 'b'], 'novo', 'z', 'before')).toEqual(['a', 'b']);
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

  // ── mover item entre grupos (itemGroup override) ──
  it('move item de um grupo pra outro (override de associação)', () => {
    const out = orderNav(sample(), [], {}, { '/a3': 'B' });
    expect(out.find(g => g.label === 'A')!.items.map(i => i.path)).toEqual(['/a1', '/a2']);
    // sem itemOrder no destino, o movido entra na ordem de iteração (A vem antes de B)
    expect(out.find(g => g.label === 'B')!.items.map(i => i.path)).toEqual(['/a3', '/b1', '/b2']);
  });

  it('item movido respeita a ordem salva do grupo destino (drop preciso)', () => {
    // simula soltar /a3 ANTES de /b2 dentro de B
    const out = orderNav(
      sample(),
      [],
      { B: ['/b1', '/a3', '/b2'], A: ['/a1', '/a2'] },
      { '/a3': 'B' }
    );
    expect(out.find(g => g.label === 'A')!.items.map(i => i.path)).toEqual(['/a1', '/a2']);
    expect(out.find(g => g.label === 'B')!.items.map(i => i.path)).toEqual(['/b1', '/a3', '/b2']);
  });

  it('override pra grupo inexistente é ignorado (item fica em casa)', () => {
    const out = orderNav(sample(), [], {}, { '/a3': 'GRUPO_QUE_NAO_EXISTE' });
    expect(out.find(g => g.label === 'A')!.items.map(i => i.path)).toEqual(['/a1', '/a2', '/a3']);
  });
});
