import { describe, it, expect } from 'vitest';
import { buildHolidaySet } from '../holidays';

// M28 (auditoria 2026-07-28): helper único de feriados — expande `recurring`
// por MM-DD nos anos do período e filtra `optional` (mesma semântica da Folha).
describe('buildHolidaySet', () => {
  const holidays = [
    { holiday_date: '2025-12-25', recurring: true },                  // Natal (quick-add)
    { holiday_date: '2026-04-21', recurring: false },                 // data exata
    { holiday_date: '2026-06-12', recurring: true, optional: true },  // facultativo
  ];

  it('expande recorrente pro ano do período consultado', () => {
    const s = buildHolidaySet(holidays, '2026-12-01', '2026-12-31');
    expect(s.has('2026-12-25')).toBe(true);   // ano seguinte ao cadastro
    expect(s.has('2025-12-25')).toBe(true);   // ano original preservado
  });

  it('período cruzando anos expande pros dois anos', () => {
    const s = buildHolidaySet(holidays, '2026-12-16', '2027-01-15');
    expect(s.has('2026-12-25')).toBe(true);
    expect(s.has('2027-12-25')).toBe(true);
  });

  it('não-recorrente vale só na data exata', () => {
    const s = buildHolidaySet(holidays, '2027-04-01', '2027-04-30');
    expect(s.has('2027-04-21')).toBe(false);
    expect(buildHolidaySet(holidays, '2026-04-01', '2026-04-30').has('2026-04-21')).toBe(true);
  });

  it('feriado facultativo (optional) fica de fora — igual à Folha', () => {
    const s = buildHolidaySet(holidays, '2026-06-01', '2026-06-30');
    expect(s.has('2026-06-12')).toBe(false);
  });

  it('lista vazia / range inválido não explode', () => {
    expect(buildHolidaySet([], '2026-01-01', '2026-01-31').size).toBe(0);
    const s = buildHolidaySet(holidays, '', '');
    expect(s.has('2025-12-25')).toBe(true);   // sem range, cai na data crua
  });
});
