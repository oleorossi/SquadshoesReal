interface QueryErrorLike {
  status?: number;
  message?: string;
}

/**
 * `undefined` mantém o comportamento legado de consultar todos os estágios.
 * Uma lista vazia explícita significa que a consulta dona dos IDs ainda não
 * terminou (ou não retornou OPs), portanto não há trabalho útil a disparar.
 */
export function shouldLoadOrderStages(orderIds?: string[]): boolean {
  return orderIds === undefined || orderIds.length > 0;
}

/**
 * A fila é a consulta que libera todo o Modo Gestão. Timeout de statement é
 * determinístico e repetir a mesma consulta só prolonga os esqueletos por mais
 * 8 segundos; falhas transitórias ainda recebem uma tentativa adicional.
 */
export function shouldRetryProductionQueue(failureCount: number, error: unknown): boolean {
  const queryError = error as QueryErrorLike | null;
  const message = queryError?.message || '';

  if (queryError?.status === 401 || queryError?.status === 403 || message.includes('JWT')) {
    return false;
  }

  if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return false;
  }

  return failureCount < 1;
}
