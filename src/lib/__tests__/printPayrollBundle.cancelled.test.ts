import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPayrollHtml,
  filterFinancialPayrollEmployees,
  isFinancialPayrollRun,
  type BundleEmployee,
} from '../printPayrollBundle';

const employee = (name: string, status: string, totalLiquido: number): BundleEmployee => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  department: 'Produção',
  run: {
    status,
    base_salary: totalLiquido,
    total_proventos: totalLiquido,
    overtime_amount: 0,
    total_liquido: totalLiquido,
    period: '2026-08',
  },
  days: [],
});

describe('artefatos de folha cancelada', () => {
  it('reconhece status cancelado sem depender de caixa ou espaços', () => {
    expect(isFinancialPayrollRun({ status: 'cancelado' })).toBe(false);
    expect(isFinancialPayrollRun({ status: ' CANCELADO ' })).toBe(false);
    expect(isFinancialPayrollRun({ status: 'pago' })).toBe(true);
    expect(isFinancialPayrollRun({})).toBe(true);
  });

  it('remove folha cancelada dos documentos e totais mesmo se o chamador enviar o histórico completo', () => {
    const ativa = employee('Folha Ativa', 'pago', 1234);
    const cancelada = employee('Folha Cancelada', 'cancelado', 99999);

    expect(filterFinancialPayrollEmployees([ativa, cancelada])).toEqual([ativa]);

    const html = buildPayrollHtml({
      periodTitle: 'ago/2026',
      docs: { folha: true, setor: true, calendario: true, holerite: true },
      employees: [ativa, cancelada],
      autoPrint: false,
    });

    expect(html).toContain('Folha Ativa');
    expect(html).not.toContain('Folha Cancelada');
    expect(html).toContain('TOTAL (1)');
    expect(html).not.toContain('99.999');
  });

  it('não gera artefato financeiro quando só há folhas canceladas, mas preserva o espelho bruto', () => {
    const cancelada = employee('Histórico Cancelado', 'cancelado', 5000);
    expect(buildPayrollHtml({
      periodTitle: 'ago/2026',
      docs: { folha: true, setor: true, calendario: true, holerite: true },
      employees: [cancelada],
      autoPrint: false,
    })).toBe('');

    const htmlEspelho = buildPayrollHtml({
      periodTitle: 'ago/2026',
      docs: { folha: true, holerite: true, calendario: false, espelho: true },
      employees: [cancelada],
      espelhoEmployees: [{ ...cancelada, rawDays: [{ date: '2026-08-01', punches: ['08:00', '17:00'] }] }],
      autoPrint: false,
    });
    expect(htmlEspelho).toContain('Espelho relógio de ponto');
    expect(htmlEspelho).toContain('Histórico Cancelado');
    expect(htmlEspelho).not.toContain('<h2>Folha');
    expect(htmlEspelho).not.toContain('<h2>Holerite');
  });

  it('faz Excel, bundle e PDF gerencial consumirem somente folhas financeiras', () => {
    const payrollSource = readFileSync('src/pages/Payroll.tsx', 'utf8');
    expect(payrollSource).toContain('const financialRuns = useMemo(() => runs.filter(isFinancialPayrollRun), [runs]);');
    expect(payrollSource).toContain('new Map(financialRuns.map(run => [run.employee_id, run]))');
    expect(payrollSource).toContain('useMemo<BundleEmployee[]>(() => financialRuns.map');
    expect(payrollSource).toContain('const src = financialRuns.map');
  });
});
