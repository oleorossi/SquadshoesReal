import { describe, it, expect } from 'vitest';
import { splitSearchTerms, searchMatchesAllTerms, searchMatchesAny, normalizeForSearch, searchNormOrFilter } from '../searchUtils';

describe('splitSearchTerms', () => {
  it('divide por "/" com trim', () => {
    expect(splitSearchTerms('stx / alcineu')).toEqual(['stx', 'alcineu']);
    expect(splitSearchTerms('stx/alcineu')).toEqual(['stx', 'alcineu']);
  });
  it('divide por ESPAÇO (mesma semântica do searchNormOrFilter)', () => {
    expect(splitSearchTerms('napa tamara')).toEqual(['napa', 'tamara']);
    expect(splitSearchTerms('stx alcineu')).toEqual(['stx', 'alcineu']);
    expect(splitSearchTerms('SP 10')).toEqual(['SP', '10']);
  });
  it('divide por VÍRGULA (hábito ensinado por WaveBuilder/Imprimir Fichas)', () => {
    expect(splitSearchTerms('OP-00123,OP-00124')).toEqual(['OP-00123', 'OP-00124']);
    expect(splitSearchTerms('stx,alcineu')).toEqual(['stx', 'alcineu']);
    expect(splitSearchTerms('stx, alcineu')).toEqual(['stx', 'alcineu']);
  });
  it('termo único sem separador', () => {
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

  it('ESPAÇO também refina: termos casam campos DIFERENTES em qualquer ordem', () => {
    expect(searchMatchesAllTerms('stx alcineu', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('alcineu stx', ...campos)).toBe(true);
    // cross-campo: "napa" num campo, "tâmara" em outro
    expect(searchMatchesAllTerms('napa tamara', 'NAPA SOFT', 'TÂMARA')).toBe(true);
    expect(searchMatchesAllTerms('napa tamara', 'NAPA SOFT TÂMARA CARAMELO')).toBe(true);
  });

  it('falha se UM dos termos não casa', () => {
    expect(searchMatchesAllTerms('stx / fulano', ...campos)).toBe(false);
    expect(searchMatchesAllTerms('stx fulano', ...campos)).toBe(false);
    expect(searchMatchesAllTerms('outraref / alcineu', ...campos)).toBe(false);
  });

  it('ignora acento/case em cada termo', () => {
    expect(searchMatchesAllTerms('stx / ALCINÉU', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('tamara', 'NAPA SOFT TÂMARA')).toBe(true);
  });

  it('"sp10" e "SP 10" casam registro gravado como "SP 10" ou "SP10"', () => {
    expect(searchMatchesAllTerms('sp10', 'SP 10')).toBe(true);
    expect(searchMatchesAllTerms('SP 10', 'SP10')).toBe(true);
    expect(searchMatchesAllTerms('SP 10', 'SP 10')).toBe(true);
  });

  it('query vazia ou só separadores → true (não filtra)', () => {
    expect(searchMatchesAllTerms('', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('   ', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('//', ...campos)).toBe(true);
    expect(searchMatchesAllTerms(' / ', ...campos)).toBe(true);
  });

  it('termo que normaliza pra vazio é ignorado, demais aplicam', () => {
    expect(searchMatchesAllTerms('stx / -', ...campos)).toBe(true);
    expect(searchMatchesAllTerms('fulano / -', ...campos)).toBe(false);
  });

  it('paridade com searchMatchesAny quando há 1 termo só', () => {
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
    // vírgula é SEPARADOR de termos (2026-07-12); os demais especiais são
    // removidos pela normalização — nenhum token carrega ,%()\ pro .or()
    expect(searchNormOrFilter('a,b(c)%\\d')).toBe('and(search_norm.ilike.%a%,search_norm.ilike.%bcd%)');
    expect(searchNormOrFilter('b(c)%\\d')).toBe('search_norm.ilike.%bcd%');
  });
  it('vírgula separa termos AND (paridade com splitSearchTerms)', () => {
    expect(searchNormOrFilter('op1,op2')).toBe('and(search_norm.ilike.%op1%,search_norm.ilike.%op2%)');
  });
});
