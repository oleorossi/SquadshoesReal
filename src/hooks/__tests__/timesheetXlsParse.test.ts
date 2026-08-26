import { describe, expect, it } from 'vitest';
import {
  isValidTimesheetIsoDate,
  isValidTimesheetPunch,
  parseTimesheetRows,
  resolveTimesheetRecordDate,
} from '../useTimesheet';

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
      { day: 16, dateStr: '2026-07-16', punches: ['08:09', '12:35', '13:20', '22:21'] },
      { day: 18, dateStr: '2026-07-18', punches: ['08:00', '12:00', '13:00'] },
      { day: 1, dateStr: '2026-08-01', punches: ['07:59', '12:00', '13:00', '18:00'] },
    ]);
    expect(result.employees[1]).toMatchObject({ externalId: '3', name: 'sem batidas', records: [] });
  });

  it('atribui os dias corretamente ao cruzar julho e agosto', () => {
    expect(resolveTimesheetRecordDate(16, '2026-07-16', '2026-08-07')).toBe('2026-07-16');
    expect(resolveTimesheetRecordDate(31, '2026-07-16', '2026-08-07')).toBe('2026-07-31');
    expect(resolveTimesheetRecordDate(1, '2026-07-16', '2026-08-07')).toBe('2026-08-01');
    expect(resolveTimesheetRecordDate(7, '2026-07-16', '2026-08-07')).toBe('2026-08-07');
  });

  it('não funde o mesmo número de dia quando o período cruza meses', () => {
    const result = parseTimesheetRows([
      ['Data de presença:21/10/2026~21/11/2026'],
      ['IDUsuário:', '15', 'Nome:', 'ana', 'Dep.:', 'CORTE'],
      ['', '', '', '', '', '', '21', '22', '21'],
      ['', '', '', '', '', '', '08:00 12:00', '08:01 12:01', '08:02 12:02'],
    ]);

    expect(result.employees[0].records).toEqual([
      { day: 21, dateStr: '2026-10-21', punches: ['08:00', '12:00'] },
      { day: 22, dateStr: '2026-10-22', punches: ['08:01', '12:01'] },
      { day: 21, dateStr: '2026-11-21', punches: ['08:02', '12:02'] },
    ]);
  });

  it('normaliza hora de um dígito e descarta horários fora do relógio', () => {
    const result = parseTimesheetRows([
      ['Data de presença:01/10/2026~03/10/2026'],
      ['IDUsuário:', '15', 'Nome:', 'ana', 'Dep.:', 'CORTE'],
      ['', '', '', '', '', '', '1', '2', '3'],
      ['', '', '', '', '', '', '8:05 12:00', '24:00 12:61', '09:00:99'],
    ]);

    expect(result.employees[0].records).toEqual([
      { day: 1, dateStr: '2026-10-01', punches: ['08:05', '12:00'] },
    ]);
  });

  it('rejeita datas de calendário impossíveis e dias fora do período', () => {
    expect(isValidTimesheetIsoDate('2026-02-29')).toBe(false);
    expect(isValidTimesheetIsoDate('2028-02-29')).toBe(true);
    expect(() => resolveTimesheetRecordDate(31, '2026-02-01', '2026-02-28')).toThrow(/fora do período/);
    expect(() => parseTimesheetRows([
      ['Data de presença:31/02/2026~02/03/2026'],
    ])).toThrow(/Período inválido/);
  });

  it('aceita somente HH:MM canônico dentro do intervalo do dia', () => {
    expect(isValidTimesheetPunch('00:00')).toBe(true);
    expect(isValidTimesheetPunch('23:59')).toBe(true);
    expect(isValidTimesheetPunch('8:00')).toBe(false);
    expect(isValidTimesheetPunch('24:00')).toBe(false);
    expect(isValidTimesheetPunch('12:60')).toBe(false);
  });
});
