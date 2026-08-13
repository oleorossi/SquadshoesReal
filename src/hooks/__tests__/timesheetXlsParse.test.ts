import { describe, expect, it } from 'vitest';
import { parseTimesheetRows } from '../useTimesheet';

// Estrutura fiel ao export RegistroPresença.xls do KP1028. A fixture usa só
// dados sintéticos: o arquivo real de ponto não deve entrar no repositório.
describe('parseTimesheetRows — KP1028 RegistroPresença.xls', () => {
  it('lê período cruzando mês, ID do relógio e batidas multilinha', () => {
    const result = parseTimesheetRows([
      ['Tabela de registro de presença de funcionários'],
      ['Data de presença:16/07/2026~07/08/2026'],
      ['IDUsuário:', '2', 'Nome:', 'talia', 'Dep.:', 'DEP1'],
      ['', '', '', '', '', '', '16', '17', '18', '1', '2', '7'],
      ['', '', '', '', '', '', '08:09\n12:35\n13:20\n22:21', '', '08:00\n12:00\n13:00', '07:59\n12:00\n13:00\n18:00', '', ''],
      ['IDUsuário:', '3', 'Nome:', 'sem batidas', 'Dep.:', 'DEP1'],
      ['', '', '', '', '', '', '16', '17', '18'],
      ['', '', '', '', '', '', '', '', ''],
    ]);

    expect(result.startDate).toBe('2026-07-16');
    expect(result.endDate).toBe('2026-08-07');
    expect(result.employees).toHaveLength(2);
    expect(result.employees[0]).toMatchObject({ externalId: '2', name: 'talia', department: 'DEP1' });
    expect(result.employees[0].records).toEqual([
      { day: 1, punches: ['07:59', '12:00', '13:00', '18:00'] },
      { day: 16, punches: ['08:09', '12:35', '13:20', '22:21'] },
      { day: 18, punches: ['08:00', '12:00', '13:00'] },
    ]);
    expect(result.employees[1]).toMatchObject({ externalId: '3', name: 'sem batidas', records: [] });
  });
});
