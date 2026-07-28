import { describe, it, expect } from 'vitest';
import { namesMatch, findEmployeeMatch } from '../employeeMatching';

// M30 (auditoria 2026-07-28): namesMatch aceitava substring crua — nome curto
// cadastrado casava DENTRO de nome maior ("Ana" ⊂ "mari-ana silva") e misturava
// ponto de funcionários distintos. Containment agora exige fronteira de token e
// ≥2 tokens dos dois lados; nome de 1 token só casa por igualdade exata.
describe('namesMatch — endurecido (fronteira de token)', () => {
  it('NÃO casa nome curto dentro de nome maior (caso M30)', () => {
    expect(namesMatch('Ana', 'Mariana Silva')).toBe(false);   // 'ana' ⊂ 'mari-ana'
    expect(namesMatch('Mariana Silva', 'Ana')).toBe(false);   // simétrico
    expect(namesMatch('Ana', 'Marianasilva')).toBe(false);    // compacto também
  });

  it('nome de 1 token só casa por igualdade exata (ambíguo por natureza)', () => {
    expect(namesMatch('Ana', 'Ana')).toBe(true);
    expect(namesMatch('Ana', 'ANA')).toBe(true);
    expect(namesMatch('Ana', 'Ana Silva')).toBe(false);       // capturaria Ana Souza também
  });

  it('containment por fronteira de token continua casando prefixo legítimo (≥2 tokens)', () => {
    expect(namesMatch('Maria Aparecida', 'Maria Aparecida da Silva')).toBe(true);
    expect(namesMatch('Maria Aparecida da Silva', 'Maria Aparecida')).toBe(true);
  });

  it('normalização: acento/caixa/espaçamento não atrapalham', () => {
    expect(namesMatch('José da Silva', 'Jose da Silva')).toBe(true);
    expect(namesMatch('  maria   josé ', 'Maria José')).toBe(true);
  });

  it('primeiro + último token iguais continuam casando (nome do meio abreviado)', () => {
    expect(namesMatch('João Pedro Souza', 'João Souza')).toBe(true);
  });

  it('nome truncado do relógio casa pelo fallback de ≥2 tokens significativos', () => {
    expect(namesMatch('Valdilene Aparecida D', 'Valdilene Aparecida dos Santos')).toBe(true);
  });

  it('sobrenome comum sozinho NÃO casa pessoas diferentes (regra 2026-06-14 preservada)', () => {
    expect(namesMatch('João Santos', 'Maria Santos')).toBe(false);
    expect(namesMatch('Ana Silva', 'Ana Souza')).toBe(false);
  });
});

describe('findEmployeeMatch — external_id continua prevalecendo', () => {
  const employees = [
    { id: '1', name: 'Ana', external_id: '7', active: true },
    { id: '2', name: 'Mariana Silva', external_id: '9', active: true },
  ] as any[];

  it('matrícula casa direto, mesmo com nome curto', () => {
    expect(findEmployeeMatch(employees, 'Ana', '7')?.id).toBe('1');
  });

  it('fallback por nome não deixa "Ana" capturar "Mariana Silva"', () => {
    expect(findEmployeeMatch(employees, 'Mariana Silva', null)?.id).toBe('2');
    expect(findEmployeeMatch(employees, 'Ana', null)?.id).toBe('1'); // igualdade exata
  });
});
