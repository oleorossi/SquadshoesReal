import { describe, it, expect } from 'vitest';
import { splitSearchTerms, searchMatchesAllTerms, searchMatchesAny, normalizeForSearch, searchNormOrFilter } from '../searchUtils';

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

describe('normalizeForSearch (paridade com a função SQL normalize_search)', () => {
  // Os mesmos resultados são produzidos pela migration
  // 20260613120000_accent-insensitive-search no banco (validado via MCP).
  it('lower + sem acento + só alfanumérico', () => {
    expect(normalizeForSearch('NAPA SOFT TÂMARA')).toBe('napasofttamara');
    expect(normalizeForSearch('SP 10')).toBe('sp10');
    expect(normalizeForSearch('Alcineu Calçados')).toBe('alcineucalcados');
    expect(normalizeForSearch('tamara')).toBe('tamara');
  });
  it('"tamara" e "TÂMARA" colapsam no mesmo token', () => {
    expect(normalizeForSearch('tamara')).toBe(normalizeForSearch('TÂMARA'));
  });
});

describe('searchNormOrFilter (filtro .or do PostgREST sobre search_norm)', () => {
  it('1 token → ilike único, sem acento/caixa', () => {
    expect(searchNormOrFilter('TÂMARA')).toBe('search_norm.ilike.%tamara%');
    // "sp10" (token único) casa o registro cujo search_norm é "sp10" — e como a
    // coluna é squashada no banco, casa tanto "SP10" quanto "SP 10" gravados.
    expect(searchNormOrFilter('sp10')).toBe('search_norm.ilike.%sp10%');
  });
  it('multi-palavra → AND entre tokens (espaço e "/")', () => {
    expect(searchNormOrFilter('napa tamara')).toBe('and(search_norm.ilike.%napa%,search_norm.ilike.%tamara%)');
    expect(searchNormOrFilter('napa / tamara')).toBe('and(search_norm.ilike.%napa%,search_norm.ilike.%tamara%)');
    // "SP 10" digitado com espaço → AND de "sp" e "10"; ambos ⊆ "sp10" gravado.
    expect(searchNormOrFilter('SP 10')).toBe('and(search_norm.ilike.%sp%,search_norm.ilike.%10%)');
  });
  it('coluna customizável', () => {
    expect(searchNormOrFilter('tamara', 'col')).toBe('col.ilike.%tamara%');
  });
  it('query vazia ou só pontuação → "" (caller pula)', () => {
    expect(searchNormOrFilter('')).toBe('');
    expect(searchNormOrFilter('   ')).toBe('');
    expect(searchNormOrFilter('//')).toBe('');
  });
  it('tokens nunca contêm caractere especial do PostgREST', () => {
    expect(searchNormOrFilter('a,b(c)%\\d')).toBe('search_norm.ilike.%abcd%');
  });
});
