/**
 * Contrato: onde o adiantamento (vale) entra no dinheiro.
 *
 * Decisão auditada 2026-10-17 (plano adiantamentos HE vs folha):
 *   • Fechamento da folha salarial → DESCONTA no líquido
 *   • Relatório de hora extra / saldo de horas → NÃO desconta
 *     (nota de gestão: vale só no fechamento)
 *
 * Não é bug se o relatório de HE mostrar valor bruto de HE; mudar isso
 * seria mudança de regra de produto, não correção.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computePeriodFolha } from '@/lib/salaryPayroll';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const PAYROLL_PAGE = read('src/pages/Payroll.tsx');
const SALARY_ENGINE = read('src/lib/salaryPayroll.ts');
const HE_REPORT_PAGE = read('src/pages/TimeBalanceReports.tsx');
const HE_PRINT = read('src/lib/printTimeBalanceReports.ts');
const HOLERITE = read('src/lib/printPayrollBundle.ts');

const SCHED = {
  entry_time: '08:00:00', exit_time: '18:00:00', lunch_start: '12:00:00', lunch_end: '13:00:00',
  works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true,
  works_thursday: true, works_friday: true, works_saturday: false,
};

describe('adiantamentos: folha DESCONTA · relatório HE NÃO', () => {
  it('folha: carrega vales abertos e passa advancesTotal ao motor', () => {
    expect(PAYROLL_PAGE).toContain('advancesByEmp');
    expect(PAYROLL_PAGE).toContain('advancesTotal: advancesByEmp.get(emp.id) || 0');
    expect(PAYROLL_PAGE).toContain('O líquido a pagar JÁ desconta esse valor');
  });

  it('folha: motor inclui advances em total_descontos e no net_value', () => {
    expect(SALARY_ENGINE).toContain('total_descontos: number; // faltas + atrasos + adiantamentos');
    expect(SALARY_ENGINE).toContain('const totalDescontos = round2(faltaDesconto + atrasoDesconto + adv)');
    expect(SALARY_ENGINE).toContain('net_value: round2(totalProventos - totalDescontos)');
  });

  it('folha: holerite lista Adiantamentos do período como desconto', () => {
    expect(HOLERITE).toContain('Adiantamentos do período');
  });

  it('motor vivo: líquido = bruto − adiantamento (remoto, sem ponto)', () => {
    const r = computePeriodFolha({
      salary: 3000,
      from: '2026-05-04',
      to: '2026-05-08',
      schedule: SCHED,
      holidaysSet: new Set(),
      punchesByDate: new Map(),
      payRegime: 'remoto',
      advancesTotal: 500,
    });
    expect(r.advances_total).toBe(500);
    expect(r.gross_value).toBeCloseTo(3000, 2);
    expect(r.net_value).toBeCloseTo(2500, 2);
  });

  it('relatório HE: monta o período com advancesList vazio (vale fora do escopo)', () => {
    expect(HE_REPORT_PAGE).toContain('advancesList: []');
  });

  it('relatório HE: nota de gestão manda adiantamento pro fechamento da folha', () => {
    expect(HE_PRINT).toContain('adiantamentos e demais descontos aparecem no fechamento da folha');
    expect(HE_PRINT).toContain('não são convertidos em horas nesta tabela');
  });
});
