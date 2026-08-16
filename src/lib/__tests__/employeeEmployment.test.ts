import { describe, expect, it } from 'vitest';
import {
  employeeIsEmployedOnDate,
  employeeOverlapsEmploymentRange,
  normalizeEmployeeEmploymentState,
} from '../employeeEmployment';

const active = {
  active: true,
  admission_date: '2026-01-10',
  termination_date: null,
};

describe('ciclo do vínculo do funcionário', () => {
  it('inativa o cadastro sempre que uma demissão é informada', () => {
    expect(normalizeEmployeeEmploymentState({ active: true, termination_date: '2026-08-16' }))
      .toEqual({ active: false, termination_date: '2026-08-16' });
  });

  it('mantém o desligado em relatório histórico que cruza seu vínculo', () => {
    const terminated = { ...active, active: false, termination_date: '2026-08-16' };
    expect(employeeOverlapsEmploymentRange(terminated, '2026-08-01', '2026-08-31')).toBe(true);
    expect(employeeOverlapsEmploymentRange(terminated, '2026-08-17', '2026-08-31')).toBe(false);
  });

  it('considera a demissão como último dia trabalhado', () => {
    const terminated = { ...active, active: false, termination_date: '2026-08-16' };
    expect(employeeIsEmployedOnDate(terminated, '2026-08-16')).toBe(true);
    expect(employeeIsEmployedOnDate(terminated, '2026-08-17')).toBe(false);
  });

  it('não inclui inativo sem vigência conhecida em relatórios', () => {
    expect(employeeOverlapsEmploymentRange({ ...active, active: false }, '2026-08-01', '2026-08-31')).toBe(false);
  });
});
