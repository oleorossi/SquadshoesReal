import { describe, it, expect } from 'vitest';
import {
  getStrapSourcingOverride,
  normalizeStrapColorKey,
  pruneStrapSourcing,
  resolveStrapSourcing,
  setStrapSourcing,
  strapSourcingKey,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';

const GID = '11111111-2222-3333-4444-555555555555';

describe('strapSourcing — chave contratada com resolve_strap_sourcing (SQL)', () => {
  // A chave é `group_id || '|' || upper(btrim(unaccent(color)))`. Errar o formato
  // não dá erro nenhum: o motor não acha a chave e cai no default do produto.
  it('normaliza a cor como upper(btrim(unaccent(...)))', () => {
    expect(normalizeStrapColorKey('  capuccino ')).toBe('CAPUCCINO');
    expect(normalizeStrapColorKey('Rosê')).toBe('ROSE');
    expect(normalizeStrapColorKey('MARROM CAFÉ')).toBe('MARROM CAFE');
    expect(normalizeStrapColorKey(null)).toBe('');
  });

  it('monta a chave no formato "<group_id>|<COR>"', () => {
    expect(strapSourcingKey(GID, 'bege')).toBe(`${GID}|BEGE`);
  });

  it('sem group_id não há chave — o override não teria onde morar', () => {
    expect(strapSourcingKey('', 'BEGE')).toBeNull();
    expect(strapSourcingKey(null, 'BEGE')).toBeNull();
  });
});

describe('strapSourcing — precedência override > cadastro', () => {
  it('sem chave, herda o default do produto', () => {
    expect(resolveStrapSourcing({}, GID, 'BEGE', 'in_house')).toBe('in_house');
    expect(resolveStrapSourcing(null, GID, 'BEGE', 'purchased')).toBe('purchased');
  });

  it('com chave, o PV vence o cadastro', () => {
    const map = setStrapSourcing({}, GID, 'Bege', 'purchased');
    expect(resolveStrapSourcing(map, GID, 'BEGE', 'in_house')).toBe('purchased');
  });

  it('limpar remove a chave (volta a herdar), não grava o valor herdado', () => {
    const map = setStrapSourcing({}, GID, 'BEGE', 'in_house');
    const cleared = setStrapSourcing(map, GID, 'BEGE', null);
    expect(getStrapSourcingOverride(cleared, GID, 'BEGE')).toBeNull();
    expect(Object.keys(cleared)).toHaveLength(0);
  });

  it('valor fora do domínio do SQL é tratado como ausência', () => {
    expect(getStrapSourcingOverride({ [`${GID}|BEGE`]: 'talvez' } as unknown as StrapSourcingMap, GID, 'BEGE')).toBeNull();
  });
});

describe('pruneStrapSourcing', () => {
  it('descarta override de cor que não existe mais nas tiras do item', () => {
    const map = {
      ...setStrapSourcing({}, GID, 'BEGE', 'in_house'),
      ...setStrapSourcing({}, GID, 'PRETO', 'purchased'),
    };
    const pruned = pruneStrapSourcing(map, [{ group_id: GID, color: 'bege' }]);
    expect(Object.keys(pruned)).toEqual([`${GID}|BEGE`]);
  });
});
