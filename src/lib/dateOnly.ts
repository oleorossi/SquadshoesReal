/** Parseia data 'YYYY-MM-DD' (date-only do Postgres) no fuso LOCAL.
 *  new Date('YYYY-MM-DD') parseia UTC → em BRT vira 21h do dia anterior. */
export function parseDateOnly(s: string): Date {
  // Timestamps completos (com 'T') já carregam hora — parse direto.
  if (s.includes('T')) return new Date(s);
  return new Date(s + 'T00:00:00');
}

/** Formata data date-only do banco em pt-BR ('' para null/undefined). */
export function formatDateBR(s: string | null | undefined): string {
  if (!s) return '';
  return parseDateOnly(s).toLocaleDateString('pt-BR');
}
