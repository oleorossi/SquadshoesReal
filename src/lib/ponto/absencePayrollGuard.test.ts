import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

import { assertNoClosedPayrollInRange, dateRangesOverlap, payrollPeriodRange } from './absencePayrollGuard';

describe('absencePayrollGuard', () => {
  beforeEach(() => fromMock.mockReset());
  it('expande folha mensal até o último dia real do mês', () => {
    expect(payrollPeriodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(payrollPeriodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('aceita fechamento por intervalo e rejeita períodos inválidos', () => {
    expect(payrollPeriodRange('2026-08-01_2026-08-15')).toEqual({ from: '2026-08-01', to: '2026-08-15' });
    expect(payrollPeriodRange('2026-13')).toBeNull();
    expect(payrollPeriodRange('2026-08-15_2026-08-01')).toBeNull();
  });

  it('detecta sobreposição mesmo quando a justificativa começa fora da folha', () => {
    expect(dateRangesOverlap(
      { from: '2026-07-28', to: '2026-08-03' },
      { from: '2026-08-01', to: '2026-08-31' },
    )).toBe(true);
    expect(dateRangesOverlap(
      { from: '2026-07-01', to: '2026-07-31' },
      { from: '2026-08-01', to: '2026-08-31' },
    )).toBe(false);
  });

  it('bloqueia justificativa que alcança uma folha aprovada', async () => {
    const inStatuses = vi.fn().mockResolvedValue({
      data: [{ period: '2026-08', status: 'aprovado' }],
      error: null,
    });
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ in: inStatuses }),
      }),
    });

    await expect(assertNoClosedPayrollInRange(
      'employee-1',
      '2026-07-28',
      '2026-08-03',
      'cadastrar a justificativa',
    )).rejects.toThrow('Folha do período 2026-08 já aprovada');
    expect(fromMock).toHaveBeenCalledWith('payroll_runs');
    expect(inStatuses).toHaveBeenCalledWith('status', ['aprovado', 'pago']);
  });
});
