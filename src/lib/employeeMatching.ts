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

  return lp.some((token) => token.length >= 5 && rp.includes(token));
}

/**
 * Find the best employee match from a list, using:
 * 1. external_id match (clock ID)
 * 2. Fuzzy name match
 */
export function findEmployeeMatch(
  employees: Employee[],
  employeeName: string,
  externalId?: string | null,
): Employee | undefined {
  // 1. Try match by external_id first (most reliable)
  // Supports comma-separated IDs for employees with multiple clock registrations
  if (externalId) {
    const match = employees.find(e => {
      if (!e.external_id) return false;
      const ids = e.external_id.split(',').map(id => id.trim());
      return ids.includes(externalId.trim());
    });
    if (match) return match;
  }

  // 2. Try match by normalized name
  return employees.find((e) => namesMatch(employeeName, e.name));
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
