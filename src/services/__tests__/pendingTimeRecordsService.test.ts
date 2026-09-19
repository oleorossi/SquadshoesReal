import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('@/lib/ponto/interpretDayPunches', () => ({
  threePunchesStayPending: () => true,
  shouldSuggestFinalExit: (punches: string[]) => punches.length === 3 || punches.length === 1,
}));

import {
  bulkApplyDefaultExit,
  groupPendingByDate,
  type PendingTimeRecord,
} from '../pendingTimeRecordsService';

function makePending(partial: Partial<PendingTimeRecord> & Pick<PendingTimeRecord, 'time_record_id' | 'record_date' | 'issue_type'>): PendingTimeRecord {
  return {
    employee_name: partial.employee_name ?? 'Funcionário',
    employee_external_id: partial.employee_external_id ?? '1',
    employee_id: partial.employee_id ?? 'emp-1',
    department: partial.department ?? 'Solagem',
    dow: partial.dow ?? 2,
    punches: partial.punches ?? ['08:00'],
    punch_count: partial.punch_count ?? (partial.punches?.length ?? 1),
    has_manual_override: partial.has_manual_override ?? false,
    employee_match_ambiguous: partial.employee_match_ambiguous ?? false,
    ...partial,
  };
}

describe('groupPendingByDate', () => {
  it('agrupa por data e conta por issue_type', () => {
    const records = [
      makePending({ time_record_id: 'a', record_date: '2025-10-21', issue_type: 'somente_uma_batida', employee_name: 'Antonio' }),
      makePending({ time_record_id: 'b', record_date: '2025-10-21', issue_type: 'falta_saida_apos_almoco', punches: ['08:00', '12:00', '13:00'], employee_name: 'Daiane' }),
      makePending({ time_record_id: 'c', record_date: '2025-10-20', issue_type: 'batida_extra', punches: ['08:00', '12:00', '13:00', '18:00', '18:05'] }),
    ];

    const { byDate, summaries } = groupPendingByDate(records);

    expect(byDate.get('2025-10-21')).toHaveLength(2);
    expect(byDate.get('2025-10-20')).toHaveLength(1);
    expect(summaries).toEqual([
      {
        date: '2025-10-20',
        count: 1,
        byIssue: { batida_extra: 1 },
      },
      {
        date: '2025-10-21',
        count: 2,
        byIssue: { somente_uma_batida: 1, falta_saida_apos_almoco: 1 },
      },
    ]);
  });

  it('devolve mapa e resumos vazios sem registros', () => {
    const { byDate, summaries } = groupPendingByDate([]);
    expect(byDate.size).toBe(0);
    expect(summaries).toEqual([]);
  });
});

describe('bulkApplyDefaultExit recordDate filter', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockResolvedValue({ data: { success: true, new_punch_count: 2, punches_after: ['08:00', '18:00'] }, error: null });
  });

  function mockPendingRows(rows: Array<Record<string, unknown>>) {
    fromMock.mockReturnValue({
      select: () => ({
        order: () => Promise.resolve({ data: rows, error: null }),
      }),
    });
  }

  it('só processa pendências da data informada', async () => {
    mockPendingRows([
      {
        time_record_id: 'keep',
        employee_name: 'Antonio',
        employee_external_id: '1',
        employee_id: 'emp-1',
        department: 'Solagem',
        record_date: '2025-10-21',
        dow: 2,
        punches: ['08:00'],
        punch_count: 1,
        issue_type: 'somente_uma_batida',
        has_manual_override: false,
        employee_match_ambiguous: false,
      },
      {
        time_record_id: 'skip-other-day',
        employee_name: 'Daiane',
        employee_external_id: '2',
        employee_id: 'emp-2',
        department: 'Acabamento',
        record_date: '2025-10-20',
        dow: 1,
        punches: ['08:12'],
        punch_count: 1,
        issue_type: 'somente_uma_batida',
        has_manual_override: false,
        employee_match_ambiguous: false,
      },
    ]);

    const result = await bulkApplyDefaultExit({ recordDate: '2025-10-21' });

    expect(result.processed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].time_record_id).toBe('keep');
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('apply_manual_punch_completion', expect.objectContaining({
      p_time_record_id: 'keep',
    }));
  });
});
