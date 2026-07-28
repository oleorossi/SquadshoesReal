import { describe, it, expect } from 'vitest';
import { getDeliveryWeekEndDate } from './factoringCalc';

const iso = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

describe('getDeliveryWeekEndDate', () => {
  it('mês começando em segunda: sexta da semana N', () => {
    // Junho/2026 começa numa segunda-feira
    expect(iso(getDeliveryWeekEndDate('2026-06', 'S1'))).toBe('2026-06-05');
    expect(iso(getDeliveryWeekEndDate('2026-06', 'S2'))).toBe('2026-06-12');
  });

  it('S1 de mês começando em sábado é clampada pro mês selecionado (M14)', () => {
    // Agosto/2026 começa num sábado — sem clamp a "sexta da S1" seria
    // 2026-07-31 (mês ANTERIOR). Com o clamp, alinha ao dia 1 + 4, igual ao
    // resolve_op_due_date do SQL (segunda clampada + 4).
    expect(iso(getDeliveryWeekEndDate('2026-08', 'S1'))).toBe('2026-08-05');
    // S2 segue a regra normal (primeira segunda de agosto + 4)
    expect(iso(getDeliveryWeekEndDate('2026-08', 'S2'))).toBe('2026-08-07');
  });

  it('entrada inválida retorna null', () => {
    expect(getDeliveryWeekEndDate(null, 'S1')).toBeNull();
    expect(getDeliveryWeekEndDate('2026-08', null)).toBeNull();
    expect(getDeliveryWeekEndDate('2026-08', 'Sx')).toBeNull();
  });
});
