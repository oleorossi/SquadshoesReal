import { describe, expect, it } from 'vitest';
import { importLogOverlapsPeriod } from './importArchive';

describe('importLogOverlapsPeriod', () => {
  const log = {
    start_date: '2026-08-01',
    end_date: '2026-08-15',
    created_at: '2026-08-16T12:00:00Z',
  };

  it('sem recorte → aceita tudo', () => {
    expect(importLogOverlapsPeriod(log)).toBe(true);
    expect(importLogOverlapsPeriod(log, '', '')).toBe(true);
  });

  it('intersecta o período coberto', () => {
    expect(importLogOverlapsPeriod(log, '2026-08-10', '2026-08-20')).toBe(true);
    expect(importLogOverlapsPeriod(log, '2026-07-01', '2026-08-01')).toBe(true);
    expect(importLogOverlapsPeriod(log, '2026-08-15', '2026-08-31')).toBe(true);
  });

  it('fora do período coberto → rejeita', () => {
    expect(importLogOverlapsPeriod(log, '2026-09-01', '2026-09-30')).toBe(false);
    expect(importLogOverlapsPeriod(log, '2026-07-01', '2026-07-31')).toBe(false);
  });

  it('sem start/end usa a data de recebimento', () => {
    const legacy = { start_date: null, end_date: null, created_at: '2026-05-10T08:00:00Z' };
    expect(importLogOverlapsPeriod(legacy, '2026-05-01', '2026-05-31')).toBe(true);
    expect(importLogOverlapsPeriod(legacy, '2026-06-01', '2026-06-30')).toBe(false);
  });
});
