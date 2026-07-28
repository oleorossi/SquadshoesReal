/**
 * Leitura COMPLETA de uma tabela/view do PostgREST (auditoria 2026-07-28 · T7).
 *
 * O PostgREST corta a resposta em 1.000 linhas por padrão, e um `.limit(5000)`
 * escrito à mão corta em 5.000 — sem erro, sem aviso. A tela então soma/filtra
 * um universo parcial e apresenta como se fosse o total. Foi assim que o painel
 * de pendências de ponto escondeu registro e o de reservas mostrou saldo
 * incompleto.
 *
 * Uso:
 *   const rows = await fetchAllPages(
 *     (from, to) => supabase.from('v_time_pendings').select('*').range(from, to),
 *   );
 *
 * O callback recebe o intervalo e devolve a query JÁ com `.range()`. Para a
 * paginação ser estável, a query PRECISA ter `.order()` por uma coluna
 * determinística — sem ordem definida o Postgres pode repetir/pular linha entre
 * páginas.
 */
export async function fetchAllPages<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  // Freio de mão: sem ele um bug de ordenação vira laço infinito. 100k linhas
  // já é muito além de qualquer tela do sistema.
  const maxRows = opts?.maxRows ?? 100_000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
