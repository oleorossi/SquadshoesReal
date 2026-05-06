import { describe, it, expect } from 'vitest';
import { auditNavigation } from '@/lib/navigationAudit';

/**
 * Sanidade do util runtime: deve retornar zero issues no estado atual
 * do projeto (espelha o teste estático). Se este teste falhar, o
 * NavigationAuditWatcher mostrará um banner em DEV.
 */
describe('auditNavigation (runtime)', () => {
  it('não deve reportar inconsistências no estado atual', () => {
    const issues = auditNavigation();
    expect(
      issues,
      `Issues encontradas:\n${issues.map((i) => JSON.stringify(i)).join('\n')}`,
    ).toEqual([]);
  });
});
