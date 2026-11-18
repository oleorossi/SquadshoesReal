import { describe, expect, it } from 'vitest';
import { atelierPeriodCsv, normalizePeriodRow } from '@/lib/atelierPeriodReport';

describe('relatório do período', () => {
  it('normaliza nulos e monta o CSV com ponto e vírgula', () => {
    const row = normalizePeriodRow({
      side: 'contractor',
      contractor_id: 'c1',
      contractor_name: 'Casa "A"',
      sent_pairs: '10',
      received_pairs: 4,
      pending_pairs: null,
      late_jobs: 1,
      avg_lead_first_days: '2.5',
      avg_lead_full_days: null,
      cost: '80.5',
      done_pairs: 0,
    });
    const csv = atelierPeriodCsv([row, { ...row, side: 'internal', contractor_name: null }]);
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).toContain('"Casa ""A"""');
    expect(csv).toContain('interno;Interno');
    expect(csv).toContain('defeito pendente');
    expect(csv).toContain('defeito retrabalhado');
    expect(csv).toContain('perda');
    expect(row.pending_pairs).toBe(0);
    expect(row.avg_lead_full_days).toBeNull();
  });
});
