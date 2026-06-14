import type { Employee } from '@/hooks/useEmployees';

/**
 * Normalize a name for fuzzy comparison:
 * lowercase, strip accents, collapse whitespace.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactName(name: string): string {
  return normalizeName(name).replace(/\s+/g, '');
}

export function namesMatch(left: string, right: string): boolean {
  const nl = normalizeName(left);
  const nr = normalizeName(right);
  if (!nl || !nr) return false;

  if (nl === nr || nl.includes(nr) || nr.includes(nl)) return true;

  const cl = compactName(left);
  const cr = compactName(right);
  if (cl === cr || cl.includes(cr) || cr.includes(cl)) return true;

  const lp = nl.split(' ');
  const rp = nr.split(' ');
  if (
    lp.length >= 2 &&
    rp.length >= 2 &&
    lp[0] === rp[0] &&
    lp[lp.length - 1] === rp[rp.length - 1]
  ) {
    return true;
  }

  // Fallback final: exige ≥2 tokens significativos (≥4 chars) em comum.
  // Antes bastava 1 token ≥5 chars → sobrenome comum (SANTOS, SILVA, PEREIRA)
  // casava pessoas DIFERENTES (ex.: "João Santos" × "Maria Santos"), misturando
  // ponto/folha de gente distinta. Auditoria 2026-06-14, Área 7 (🟡).
  const shared = new Set(lp.filter((token) => token.length >= 4 && rp.includes(token)));
  return shared.size >= 2;
}

/**
 * Find the best employee match from a list, using:
 * 1. external_id match (clock ID) — coligação explícita feita pelo gestor
 * 2. Fuzzy name match (fallback)
 *
 * Opts:
 *   - linkedOnly (default false): se true, o fallback por nome SÓ casa com
 *     funcionários ATIVOS. Funcionário demitido sem external_id explícito
 *     fica fora — usado por relatórios pra evitar ex-funcionário aparecer
 *     ("Ana Carolina" caso clássico). Telas de edição (ManualEntryTab)
 *     devem usar false pra continuar mostrando não-coligados.
 */
export function findEmployeeMatch(
  employees: Employee[],
  employeeName: string,
  externalId?: string | null,
  opts: { linkedOnly?: boolean } = {},
): Employee | undefined {
  // 1. external_id (coligação explícita) — vale mesmo em demitido pq vínculo é forte
  // Suporta CSV de IDs pra funcionários com múltiplas matrículas no relógio
  if (externalId) {
    const match = employees.find(e => {
      if (!e.external_id) return false;
      const ids = e.external_id.split(',').map(id => id.trim());
      return ids.includes(externalId.trim());
    });
    if (match) return match;
  }

  // 2. Fuzzy name. Em modo linkedOnly, filtra inativos pra não vazar demitidos.
  const candidates = opts.linkedOnly ? employees.filter(e => e.active) : employees;
  return candidates.find((e) => namesMatch(employeeName, e.name));
}

/**
 * Resolve the display name for a time record employee.
 * If an employee match is found, returns the registered name.
 */
export function resolveEmployeeName(
  employees: Employee[],
  recordName: string,
  externalId?: string | null,
): string {
  const match = findEmployeeMatch(employees, recordName, externalId);
  return match?.name || recordName;
}
