/**
 * Pluralização em português — substitui o padrão `palavra(s)` que poluía a UI.
 *
 * Usage:
 *   pluralize(n, 'conta', 'contas')          // → "1 conta"     / "5 contas"
 *   pluralize(n, 'ação', 'ações')            // → "1 ação"      / "3 ações"
 *   pluralizeWord(n, 'registro', 'registros') // só a palavra, sem o número
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function pluralizeWord(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
