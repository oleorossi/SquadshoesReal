import { describe, it, expect } from 'vitest';
import { splitSearchTerms, searchMatchesAllTerms, searchMatchesAny } from '../searchUtils';

describe('splitSearchTerms', () => {
  it('divide por "/" com trim', () => {
    expect(splitSearchTerms('stx / alcineu')).toEqual(['stx', 'alcineu']);
    expect(splitSearchTerms('stx/alcineu')).toEqual(['stx', 'alcineu']);
  });
  it('termo único sem "/"', () => {
    expect(splitSearchTerms('stx')).toEqual(['stx']);
  });
  it('descarta vazios e query nula', () => {
    expect(splitSearchTerms('  ')).toEqual([]);
    expect(splitSearchTerms(null)).toEqual([]);
    expect(splitSearchTerms('stx //  / alcineu')).toEqual(['stx', 'alcineu']);
    // "/lng" (atalho de grupo) → vira só ['lng'] aqui (quem chama trata o início)
    expect(splitSearchTerms('/lng')).toEqual(['lng']);
  });
});

describe('searchMatchesAllTerms', () => {
  // pedido exemplo: referência STX, cliente Alcineu Calçados
  const campos = ['PV-00123', 'Alcineu Calçados', 'STX', 'Sandália STX'];

  it('termo único casa como antes (= searchMatchesAny)', () => {
    expect(searchMatchesAllTerms('stx', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('alcineu', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('xyz', ...campos)).toBe(false);
  });

  it('"stx / alcineu" exige os DOIS (AND entre termos)', () => {
    expect(searchMatchesAllTerms('stx / alcineu', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('alcineu / stx', ...campos)).toBe(true); // ordem não importa
  });

  it('falha se UM dos termos não casa', () => {
    expect(searchMatchesAllTerms('stx / fulano', ...campos)).toBe(false);
    expect(searchMatchesAllTerms('outraref / alcineu', ...campos)).toBe(false);
  });

  it('ignora acento/espaço/case em cada termo', () => {
    expect(searchMatchesAllTerms('s t x / ALCINÉU', ...campos)).toBe(true);
  });

  it('query vazia → true (não filtra)', () => {
    expect(searchMatchesAllTerms('', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('   ', ...campos)).toBe(true);
  });

  it('paridade com searchMatchesAny quando não há "/"', () => {
    for (const q of ['stx', 'pv00123', 'sandalia', 'zzz']) {
      expect(searchMatchesAllTerms(q, ...campos)).toBe(searchMatchesAny(q, ...campos));
    }
  });
});
