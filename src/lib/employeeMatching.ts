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
 * 1. employee_id persistido pelo servidor
 * 2. external_id match (clock ID) — coligação explícita feita pelo gestor
 * 3. nome inequívoco e vigente (fallback exclusivo de lançamento legado/manual)
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
  opts: {
    linkedOnly?: boolean;
    recordDate?: string;
    allowNameFallback?: boolean;
    employeeId?: string | null;
  } = {},
): Employee | undefined {
  const isEligible = (employee: Employee) => {
    if (opts.recordDate) {
      if (employee.admission_date && opts.recordDate < employee.admission_date) return false;
      if (employee.termination_date && opts.recordDate > employee.termination_date) return false;
    }
    return !opts.linkedOnly || employee.active;
  };

  // 1. A FK persistida pelo servidor é a identidade mais forte. Se ela veio na
  // linha, nunca tente "consertá-la" silenciosamente por matrícula ou nome.
  if (opts.employeeId) {
    const match = employees.find(employee => employee.id === opts.employeeId);
    return match && isEligible(match) ? match : undefined;
  }

  // 2. ID do relógio é a única identidade válida para ponto/folha. O equipamento
  // recicla crachás, portanto a data do registro também participa da resolução.
  // Nunca caia para nome quando o arquivo trouxe um ID: um nome curto do relógio
  // não é uma chave financeira segura.
  if (externalId) {
    const matches = employees.filter(e => {
      if (!e.external_id) return false;
      const ids = e.external_id.split(',').map(id => id.trim());
      if (!ids.includes(externalId.trim())) return false;
      return isEligible(e);
    });
    // Duas fichas vigentes para o mesmo ID é uma inconsistência: não escolha uma
    // arbitrariamente e não deixe que ela componha relatório ou folha.
    return matches.length === 1 ? matches[0] : undefined;
  }

  // 3. Nome só é aceitável em lançamento manual sem identificação do relógio.
  // Mesmo nesse legado, a associação precisa ser inequívoca e vigente na data:
  // escolher o primeiro nome "parecido" pode pagar/descontar a pessoa errada.
  if (opts.allowNameFallback === false) return undefined;
  const matches = employees.filter(employee =>
    isEligible(employee) && namesMatch(employeeName, employee.name),
  );
  return matches.length === 1 ? matches[0] : undefined;
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
