/**
 * Vínculo (coligação) entre time_records e employees do sistema.
 *
 * Antes: relatórios faziam matching apenas por employee_name (case-insensitive),
 * usando o map global useEmployees() (que inclui ATIVOS + INATIVOS). Resultado:
 * funcionário demitido sem coligação explícita aparecia em qualquer relatório
 * porque o nome ainda batia. Ex: "Ana Carolina" desligada, batidas do relógio
 * continuam vindo com o ID 47 antigo; o nome textual ainda existe no employees
 * (active=false) e o relatório listava ela toda importação.
 *
 * Agora: matching priorizado em duas camadas:
 *   1. PRIMÁRIO — time_record.employee_external_id casa com employees.external_id
 *      (coligação explícita feita pelo gestor em /rh/funcionarios).
 *   2. FALLBACK — match por nome, mas SOMENTE em employees ATIVOS. Funcionário
 *      inativo sem coligação explícita NÃO é encontrado, e o caller deve pular
 *      o registro.
 *
 * Caller decide o que fazer com unlinked — relatórios pulam, telas de edição
 * (ManualEntryTab) continuam mostrando pra permitir coligar.
 */

export interface MinimalEmployee {
  id: string;
  name: string;
  external_id: string | null;
  active: boolean;
}

export interface MinimalTimeRecord {
  employee_name: string;
  employee_external_id?: string | null;
}

/** Pré-computa lookups O(1) — chamar 1x e reusar dentro do useMemo. */
export function buildEmployeeLookup<E extends MinimalEmployee>(employees: E[]): {
  byExternalId: Map<string, E>;
  byActiveName: Map<string, E>;
} {
  const byExternalId = new Map<string, E>();
  const byActiveName = new Map<string, E>();
  for (const e of employees) {
    if (e.external_id && e.external_id.trim()) {
      byExternalId.set(e.external_id.trim(), e);
    }
    if (e.active) {
      byActiveName.set(e.name.toLowerCase().trim(), e);
    }
  }
  return { byExternalId, byActiveName };
}

/** Retorna employee se vinculado; null se não-coligado (relatório deve pular). */
export function lookupLinkedEmployee<E extends MinimalEmployee, R extends MinimalTimeRecord>(
  record: R,
  lookup: ReturnType<typeof buildEmployeeLookup<E>>,
): E | null {
  // 1. external_id explícito tem precedência (coligação forte)
  const extId = record.employee_external_id?.trim();
  if (extId) {
    const byExt = lookup.byExternalId.get(extId);
    if (byExt) return byExt;
  }
  // 2. Nome — só ativos (evita demitido vazar em relatório)
  return lookup.byActiveName.get(record.employee_name.toLowerCase().trim()) || null;
}
