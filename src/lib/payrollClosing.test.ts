import { describe, expect, it } from 'vitest';
import {
  employeeUsesSalaryClosing,
  identifyPayrollClosing,
  payrollClosingRange,
  payrollMonthBounds,
  payrollRangesOverlap,
  storedPayrollPeriodRange,
} from './payrollClosing';

describe('fechamento da folha salarial', () => {
  it('fecha mês completo respeitando fevereiro bissexto', () => {
    expect(payrollMonthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(payrollClosingRange('2028-02', 'mes')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('divide a folha em duas quinzenas sem sobreposição nem dia perdido', () => {
    const primeira = payrollClosingRange('2026-08', 'quinzena', 'primeira');
    const segunda = payrollClosingRange('2026-08', 'quinzena', 'segunda');
    expect(primeira).toEqual({ from: '2026-08-01', to: '2026-08-15' });
    expect(segunda).toEqual({ from: '2026-08-16', to: '2026-08-31' });
  });

  it('reconhece apenas mês ou quinzena civil', () => {
    expect(identifyPayrollClosing({ from: '2026-08-01', to: '2026-08-15' })?.half).toBe('primeira');
    expect(identifyPayrollClosing({ from: '2026-08-16', to: '2026-08-31' })?.half).toBe('segunda');
    expect(identifyPayrollClosing({ from: '2026-08-01', to: '2026-08-31' })?.cadence).toBe('mes');
    expect(identifyPayrollClosing({ from: '2026-08-03', to: '2026-08-20' })).toBeNull();
    expect(identifyPayrollClosing({ from: '2026-08-16', to: '2026-09-15' })).toBeNull();
  });

  it('mantém mensalistas, remotos e diaristas na folha e separa produção', () => {
    expect(employeeUsesSalaryClosing({ payment_type: 'mensalista' })).toBe(true);
    expect(employeeUsesSalaryClosing({ payment_type: 'remoto' })).toBe(true);
    expect(employeeUsesSalaryClosing({ payment_type: 'diarista' })).toBe(true);
    expect(employeeUsesSalaryClosing({ payment_type: 'producao' })).toBe(false);
  });

  it('detecta sobreposição antes de misturar fechamento mensal e quinzenal', () => {
    const month = storedPayrollPeriodRange('2026-08');
    const firstHalf = storedPayrollPeriodRange('2026-08-01_2026-08-15');
    const secondHalf = storedPayrollPeriodRange('2026-08-16_2026-08-31');
    expect(month && firstHalf && payrollRangesOverlap(month, firstHalf)).toBe(true);
    expect(firstHalf && secondHalf && payrollRangesOverlap(firstHalf, secondHalf)).toBe(false);
    expect(storedPayrollPeriodRange('intervalo-invalido')).toBeNull();
  });
});
