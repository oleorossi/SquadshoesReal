/**
 * Filtros do arquivo permanente de importações do relógio de ponto.
 * Usado pela tela de download do original (auditoria / processo judicial).
 */

export interface ImportArchivePeriodFields {
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

/**
 * Um log entra no recorte se o período COBERTO pelo arquivo (start/end)
 * intersectar [from, to]. Sem datas de cobertura, cai no dia de recebimento.
 * Sem from/to, aceita tudo.
 */
export function importLogOverlapsPeriod(
  log: ImportArchivePeriodFields,
  from?: string | null,
  to?: string | null,
): boolean {
  if (!from || !to) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return true;
  }
  const received = String(log.created_at || '').slice(0, 10);
  const start = log.start_date || received;
  const end = log.end_date || log.start_date || received;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return start <= to && end >= from;
}
