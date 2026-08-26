import { describe, expect, it } from 'vitest';
import {
  OPEN_EMPLOYEE_ADVANCE_STATUSES,
  canManageOpenEmployeeAdvance,
  employeeAdvanceStatusLabel,
  isOpenEmployeeAdvance,
  isPayrollOwnedEmployeeAdvance,
  matchesEmployeeAdvanceStatusFilter,
  createEmployeeAdvanceIdempotencyKey,
} from './employeeAdvances';

describe('contrato de status dos adiantamentos', () => {
  it('gera uma chave UUID estável para tornar o cadastro repetível sem duplicar valor', () => {
    expect(createEmployeeAdvanceIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('trata pending e paid como valores em aberto ainda a descontar', () => {
    expect(OPEN_EMPLOYEE_ADVANCE_STATUSES).toEqual(['pending', 'paid']);
    expect(isOpenEmployeeAdvance('pending')).toBe(true);
    expect(isOpenEmployeeAdvance('paid')).toBe(true);
    expect(isOpenEmployeeAdvance('deducted')).toBe(false);
    expect(isOpenEmployeeAdvance('baixado_externo')).toBe(false);
    expect(isOpenEmployeeAdvance('cancelado')).toBe(false);
  });

  it('nunca apresenta paid como quitado', () => {
    expect(employeeAdvanceStatusLabel('paid')).toBe('Entregue · a descontar');
    expect(employeeAdvanceStatusLabel('paid').toLowerCase()).not.toContain('quitado');
  });

  it('o filtro em aberto inclui os dois estados e exclui as duas baixas', () => {
    expect(matchesEmployeeAdvanceStatusFilter('pending', 'open')).toBe(true);
    expect(matchesEmployeeAdvanceStatusFilter('paid', 'open')).toBe(true);
    expect(matchesEmployeeAdvanceStatusFilter('deducted', 'open')).toBe(false);
    expect(matchesEmployeeAdvanceStatusFilter('baixado_externo', 'open')).toBe(false);
    expect(matchesEmployeeAdvanceStatusFilter('cancelado', 'open')).toBe(false);
  });

  it('deducted ou qualquer item vinculado à folha é server-owned', () => {
    expect(isPayrollOwnedEmployeeAdvance({ status: 'deducted', payroll_run_id: null })).toBe(true);
    expect(isPayrollOwnedEmployeeAdvance({ status: 'pending', payroll_run_id: 'run-1' })).toBe(true);
    expect(canManageOpenEmployeeAdvance({ status: 'deducted', payroll_run_id: 'run-1' })).toBe(false);
    expect(canManageOpenEmployeeAdvance({ status: 'paid', payroll_run_id: null })).toBe(true);
  });

  it('baixa externa é terminal na UI e distinta do desconto em folha', () => {
    expect(employeeAdvanceStatusLabel('baixado_externo')).toBe('Baixado fora da folha');
    expect(employeeAdvanceStatusLabel('cancelado')).toBe('Cancelado');
    expect(employeeAdvanceStatusLabel('deducted')).toBe('Descontado em folha');
    expect(canManageOpenEmployeeAdvance({ status: 'baixado_externo', payroll_run_id: null })).toBe(false);
    expect(canManageOpenEmployeeAdvance({ status: 'cancelado', payroll_run_id: null })).toBe(false);
  });
});
