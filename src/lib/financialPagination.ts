/**
 * Consulta por id imutável, com contagem exata em cada página. Não é snapshot
 * transacional: alterações simultâneas de valores ainda exigem nova consulta.
 * Falha se detectar mudança de quantidade/identidade, em vez de somar um recorte.
 */
export async function fetchFinancialRows<T extends { id: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
): Promise<T[]> {
  const maxRows = 100_000;
  const rows: T[] = [];
  const ids = new Set<string>();
  let expectedCount: number | undefined;
  while (true) {
    const { data, error, count } = await page(rows.length, rows.length + 999);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count === null || count < 0) {
      throw new Error('Não foi possível confirmar a consulta completa. Tente novamente.');
    }
    if (count >= maxRows) {
      throw new Error('A consulta excede o limite de segurança. O total não foi calculado parcialmente.');
    }
    if (expectedCount !== undefined && count !== expectedCount) {
      throw new Error('Os registros mudaram durante a consulta. Atualize para obter o total completo.');
    }
    expectedCount = count;
    const batch = data ?? [];
    for (const row of batch) {
      if (!row.id || ids.has(row.id)) {
        throw new Error('A consulta retornou registros inconsistentes. Atualize para obter o total completo.');
      }
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > count || (!batch.length && rows.length < count)) {
      throw new Error('A consulta ficou incompleta. O total não foi calculado parcialmente.');
    }
    if (rows.length === count) return rows;
    // O servidor pode limitar a resposta abaixo de 1000. Avançar somente o
    // tamanho recebido, até count, sem interpretar uma página curta como fim.
  }
}
