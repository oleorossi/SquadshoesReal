import { describe, expect, it } from 'vitest';
import { capTimesheetCoverageEnd, formatSaoPauloDate } from '../useTimesheet';

describe('cobertura temporal do arquivo de ponto', () => {
  it('não transforma os dias futuros do cabeçalho mensal em faltas', () => {
    expect(capTimesheetCoverageEnd(
      '2026-08-31',
      '2026-08-31',
      '2026-08-26T13:30:00.000Z',
      new Date('2026-08-26T15:00:00.000Z'),
    )).toBe('2026-08-26');
  });

  it('preserva o fim real de um arquivo histórico', () => {
    expect(capTimesheetCoverageEnd(
      '2026-07-31',
      '2026-08-31',
      '2026-08-26T13:30:00.000Z',
      new Date('2026-08-26T15:00:00.000Z'),
    )).toBe('2026-07-31');
  });

  it('usa a data civil de São Paulo perto da virada UTC', () => {
    expect(formatSaoPauloDate(new Date('2026-08-27T01:30:00.000Z'))).toBe('2026-08-26');
  });

  it('falha fechado quando o instante de arquivamento é inválido', () => {
    expect(capTimesheetCoverageEnd('2026-08-31', '2026-08-31', '')).toBeNull();
  });
});
