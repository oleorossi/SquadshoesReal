import { describe, expect, it } from 'vitest';
import {
  createTimesheetImportBatchId,
  getBatchDateRange,
  resolveTimeControlFilters,
} from './timeControlFilters';

describe('identidade textual do lote de ponto', () => {
  it('preserva o período no mesmo identificador usado pelo histórico e pelas batidas', () => {
    const batchId = createTimesheetImportBatchId(
      '2026-08-01',
      '2026-08-15',
      1787752503454,
    );

    expect(batchId).toBe('2026-08-01_2026-08-15_1787752503454');
    expect(getBatchDateRange(batchId)).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-15',
    });
  });

  it('resolve um lote textual para o intervalo sem filtrar por uma importação isolada', () => {
    expect(resolveTimeControlFilters({
      selectedBatch: '2026-08-01_2026-08-15_1787752503454',
    })).toEqual({
      queryBatch: undefined,
      queryStartDate: '2026-08-01',
      queryEndDate: '2026-08-15',
      dateRange: {
        startDate: '2026-08-01',
        endDate: '2026-08-15',
      },
    });
  });
});
