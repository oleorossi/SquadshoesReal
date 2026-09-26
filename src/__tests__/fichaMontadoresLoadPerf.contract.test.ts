import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrato da carga de Relatórios (perf / regressão M×S).
 *
 * Medido em 26/09/2026: a query no banco (~40 linhas no dataRange da semana)
 * leva ~2 ms. A lentidão percebida vinha de (1) apagar `fichas` no início de
 * cada fetch e (2) ao trocar Montagem↔Solagem, zerar o snapshot + subir
 * loading SEM disparar `carregar` de novo — a carga já traz os dois setores.
 */
const PAGE = readFileSync(resolve(__dirname, '../pages/FichaMontadoresPage.tsx'), 'utf8');

describe('contrato carga Relatórios — sem wipe sem refetch', () => {
  it('carregar não zera fichas no início (stale-while-revalidate)', () => {
    const fn = PAGE.slice(
      PAGE.indexOf('const carregar = useCallback'),
      PAGE.indexOf('useEffect(() => { carregar();'),
    );
    expect(fn).toContain('setLoading(true)');
    expect(fn).toContain('finally');
    expect(fn).toContain('setLoading(false)');
    // Wipe só no ramo de erro — nunca antes do await.
    const beforeAwait = fn.slice(0, fn.indexOf('await db.from'));
    expect(beforeAwait).not.toContain('setFichas([])');
  });

  it('troca de setor não invalida snapshot sem refetch', () => {
    expect(PAGE).not.toContain('const limparContextoCarregado');
    expect(PAGE).not.toContain('iniciarTrocaDeContexto(true)');
    expect(PAGE).toContain('iniciarTrocaDeContexto(); setSetor(s.key)');
    expect(PAGE).toMatch(/function iniciarTrocaDeContexto\(\)/);
  });

  it('carga continua pedindo Montagem e Solagem no mesmo select', () => {
    expect(PAGE).toContain('.in("setor", [SETOR_MONTAGEM, SETOR_SOLAGEM])');
  });
});
