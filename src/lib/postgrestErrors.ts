interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function postgrestDiagnostic(error: unknown): { code: string; diagnostic: string } {
  const details = error && typeof error === 'object'
    ? error as PostgrestErrorLike
    : {};
  return {
    code: asText(details.code) || '',
    diagnostic: [asText(details.message), asText(details.details), asText(details.hint)]
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * Mensagem legível de erro PostgREST / Error / string.
 * Não usa `String(object)` — isso vira `[object Object]` no toast do Hub.
 */
export function describePostgrestError(error: unknown, fallback = 'Erro desconhecido'): string {
  if (typeof error === 'string' && error.trim()) return error;
  const { diagnostic } = postgrestDiagnostic(error);
  if (diagnostic) return diagnostic;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Reconhece somente a ausência de uma relation durante a pequena janela entre
 * deploy do frontend e migration. Permissões, rede e qualquer outro erro
 * continuam visíveis em vez de serem mascarados por um fallback.
 */
export function isMissingPostgrestRelation(error: unknown, relation: string): boolean {
  const { code, diagnostic } = postgrestDiagnostic(error);
  const mentionsRelation = diagnostic
    .toLocaleLowerCase('pt-BR')
    .includes(relation.toLocaleLowerCase('pt-BR'));
  return mentionsRelation && (
    ['42P01', 'PGRST205'].includes(code)
    || /(does not exist|schema cache|not find|não existe)/i.test(diagnostic)
  );
}

/**
 * Janela fria do PostgREST ao recarregar o catálogo (PGRST002) — típica logo
 * após migration com DROP/CREATE de RPC ou view. Não é falha de rede do cliente.
 */
export function isSchemaCacheTransientError(error: unknown): boolean {
  const { code, diagnostic } = postgrestDiagnostic(error);
  return code === 'PGRST002'
    || /could not query the database for the schema cache/i.test(diagnostic);
}
