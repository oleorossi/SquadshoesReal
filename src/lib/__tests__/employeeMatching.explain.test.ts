import { describe, expect, it } from 'vitest';
import type { Employee } from '@/hooks/useEmployees';
import {
  explainEmployeeMatchFailure,
  findEmployeeMatch,
  pessoasEditHref,
  pessoasNewHref,
} from '@/lib/employeeMatching';

function employee(partial: Partial<Employee> & Pick<Employee, 'id' | 'name'>): Employee {
  return {
    id: partial.id,
    name: partial.name,
    cpf: '',
    external_id: '',
    role: '',
    department: '',
    salary: 0,
    phone: '',
    whatsapp: '',
    pix_key: '',
    pix_type: '',
    notes: '',
    active: true,
    admission_date: '2026-01-01',
    termination_date: null,
    payment_type: 'mensalista',
    daily_rate: 0,
    valor_par_medio: 0,
    valor_par_dificil: 0,
    hourly_rate: null,
    overtime_hourly_rate: null,
    overtime_multiplier: 1,
    overtime_50_pct: 0,
    overtime_100_pct: 0,
    night_bonus_pct: 0,
    he_normal_rate: null,
    he_sunday_holiday_rate: null,
    work_schedule_id: null,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('explainEmployeeMatchFailure', () => {
  it('retorna null quando o vínculo existe', () => {
    const karoline = employee({
      id: 'k1',
      name: 'KAROLINE',
      external_id: '35',
      admission_date: '2026-10-05',
    });
    expect(findEmployeeMatch([karoline], 'karolaynne', '35', {
      recordDate: '2026-10-05',
      allowNameFallback: false,
    })).toBe(karoline);
    expect(explainEmployeeMatchFailure([karoline], 'karolaynne', '35', {
      recordDate: '2026-10-05',
      allowNameFallback: false,
    })).toBeNull();
  });

  it('detecta ID sem ficha', () => {
    const failure = explainEmployeeMatchFailure([], 'maria', '10', {
      recordDate: '2026-10-23',
      allowNameFallback: false,
    });
    expect(failure?.code).toBe('no_employee');
    expect(failure?.message).toContain('ID do relógio 10');
  });

  it('detecta ficha fora da vigência (caso Caroline)', () => {
    const karoline = employee({
      id: 'k1',
      name: 'KAROLINE',
      external_id: '35',
      admission_date: '2026-10-29',
    });
    const failure = explainEmployeeMatchFailure([karoline], 'karolaynne', '35', {
      recordDate: '2026-10-05',
      allowNameFallback: false,
    });
    expect(failure?.code).toBe('outside_employment');
    expect(failure?.employeeId).toBe('k1');
    expect(failure?.message).toContain('KAROLINE');
    expect(failure?.message).toContain('29/10/2026');
  });

  it('detecta ambiguidade de matrícula', () => {
    const a = employee({ id: 'a', name: 'A', external_id: '35', admission_date: '2026-01-01' });
    const b = employee({ id: 'b', name: 'B', external_id: '35', admission_date: '2026-01-01' });
    const failure = explainEmployeeMatchFailure([a, b], 'x', '35', {
      recordDate: '2026-10-05',
      allowNameFallback: false,
    });
    expect(failure?.code).toBe('ambiguous');
    expect(failure?.candidates).toHaveLength(2);
  });

  it('monta deep-links de Pessoas', () => {
    expect(pessoasEditHref('abc')).toBe('/rh?tab=funcionarios&edit=abc');
    expect(pessoasNewHref({ externalId: '10', name: 'maria' })).toBe(
      '/rh?tab=funcionarios&new=1&external_id=10&name=maria',
    );
  });
});
