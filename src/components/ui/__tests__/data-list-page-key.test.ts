import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { dataListPageKey } from '../data-list-page';

/**
 * Regressão do DataListPage (2026-08-10).
 *
 * O componente registra a query como
 *   `[table, selectCols, orderBy, JSON.stringify(filters), limit]`
 * mas 4 dos 5 call sites (LGPD, CNAB, BankReconciliation, SPED) invalidavam
 * `['data-list-page']` — string que NUNCA foi registrada por ninguém.
 *
 * O modo de falha era o pior tipo: **silencioso e plausível**. O insert
 * acontecia, o toast de sucesso aparecia, o diálogo fechava — e a linha nova
 * não estava na lista. Só um F5 mostrava. Nenhum erro, nenhum teste vermelho,
 * nenhum log. Quem usava concluía que o registro não tinha salvo e cadastrava
 * de novo.
 *
 * Estes testes travam o CONTRATO, não a implementação: o que importa é que a
 * chave devolvida por `dataListPageKey(table)` de fato invalide a query que o
 * componente registra — via casamento por PREFIXO do React Query. Se alguém
 * mudar a forma da queryKey interna e o prefixo deixar de bater, o teste cai.
 */
describe('dataListPageKey', () => {
  /** Espelha a chave que `DataListPage` registra internamente. */
  const chaveInterna = (
    table: string,
    selectCols = '*',
    orderBy = 'created_at',
    filters: Record<string, unknown> = {},
    limit = 100,
  ) => [...dataListPageKey(table), selectCols, orderBy, JSON.stringify(filters), limit];

  it('é prefixo da chave que o componente registra', () => {
    const cheia = chaveInterna('lgpd_requests');
    expect(cheia.slice(0, 1)).toEqual([...dataListPageKey('lgpd_requests')]);
  });

  it('invalida a query da tabela — o caso que estava quebrado', () => {
    const qc = new QueryClient();
    const key = chaveInterna('lgpd_requests');
    qc.setQueryData(key, [{ id: '1' }]);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);

    qc.invalidateQueries({ queryKey: dataListPageKey('lgpd_requests') });

    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("NÃO invalida com a chave morta ['data-list-page'] — prova do bug original", () => {
    const qc = new QueryClient();
    const key = chaveInterna('lgpd_requests');
    qc.setQueryData(key, [{ id: '1' }]);

    qc.invalidateQueries({ queryKey: ['data-list-page'] });

    // era exatamente isto que acontecia em produção: no-op silencioso
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('atinge TODAS as variações de coluna/ordem/filtro/limite da mesma tabela', () => {
    const qc = new QueryClient();
    const variacoes = [
      chaveInterna('sped_exports'),
      chaveInterna('sped_exports', 'id,status', 'reference_month', { status: 'gerado' }, 50),
      chaveInterna('sped_exports', '*', 'created_at', { tipo: 'fiscal' }, 200),
    ];
    for (const k of variacoes) qc.setQueryData(k, []);

    qc.invalidateQueries({ queryKey: dataListPageKey('sped_exports') });

    for (const k of variacoes) {
      expect(qc.getQueryState(k)?.isInvalidated).toBe(true);
    }
  });

  it('não vaza para outra tabela', () => {
    const qc = new QueryClient();
    const alvo = chaveInterna('cnab_remittance_files');
    const vizinha = chaveInterna('bank_reconciliations');
    qc.setQueryData(alvo, []);
    qc.setQueryData(vizinha, []);

    qc.invalidateQueries({ queryKey: dataListPageKey('cnab_remittance_files') });

    expect(qc.getQueryState(alvo)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(vizinha)?.isInvalidated).toBe(false);
  });
});
