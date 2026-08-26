import { describe, expect, it } from 'vitest';
import { parseTimeClockFile } from './timeClockParser';

function csvFile(contents: string): File {
  const bytes = new TextEncoder().encode(contents);
  return {
    name: 'ponto.csv',
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

describe('parseTimeClockFile', () => {
  it('conta entradas descartadas e não fabrica datas ou horários inválidos', async () => {
    const parsed = await parseTimeClockFile(csvFile([
      'matricula,nome,data,hora,modo',
      '10,Ana,2026-08-26,08:05,S',
      '10,Ana,2026-02-31,12:00,F',
      '10,Ana,2026-08-26,24:00,E',
      ',Sem matrícula,2026-08-26,13:00,A',
    ].join('\n')));

    expect(parsed.punches).toHaveLength(1);
    expect(parsed.punches[0]).toMatchObject({
      employee_external_id: '10',
      date: '2026-08-26',
      time: '08:05:00',
    });
    expect(parsed.totalRows).toBe(4);
    expect(parsed.skippedRows).toBe(3);
    expect(parsed.dateRange).toEqual({ from: '2026-08-26', to: '2026-08-26' });
  });

  it('exige hora real em vez de converter linha incompleta em meia-noite', async () => {
    const parsed = await parseTimeClockFile(csvFile([
      'matricula,nome,data,hora,modo',
      '10,Ana,2026-08-26,,S',
    ].join('\n')));

    expect(parsed.punches).toEqual([]);
    expect(parsed.totalRows).toBe(1);
    expect(parsed.skippedRows).toBe(1);
    expect(parsed.dateRange).toBeNull();
  });
});
