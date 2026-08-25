interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Reconhece somente a ausência de uma relation durante a pequena janela entre
 * deploy do frontend e migration. Permissões, rede e qualquer outro erro
 * continuam visíveis em vez de serem mascarados por um fallback.
 */
export function isMissingPostgrestRelation(error: unknown, relation: string): boolean {
  const details = error && typeof error === 'object'
    ? error as PostgrestErrorLike
    : {};
  const code = details.code || '';
  const diagnostic = [details.message, details.details, details.hint].filter(Boolean).join(' ');
  const mentionsRelation = diagnostic
    .toLocaleLowerCase('pt-BR')
    .includes(relation.toLocaleLowerCase('pt-BR'));
  return mentionsRelation && (
    ['42P01', 'PGRST205'].includes(code)
    || /(does not exist|schema cache|not find|não existe)/i.test(diagnostic)
  );
}
