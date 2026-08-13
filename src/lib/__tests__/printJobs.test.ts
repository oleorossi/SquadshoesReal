import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { isPhysicallyConfirmed, PRINT_JOB_STATUS_LABELS } from '../printJobs';

describe('status de impressão', () => {
  it('só confirmação humana significa impressão física', () => {
    expect(isPhysicallyConfirmed('confirmed')).toBe(true);
    expect(isPhysicallyConfirmed('generated')).toBe(false);
    expect(isPhysicallyConfirmed('completed')).toBe(false);
  });

  it('expõe o status legado como não confirmado', () => {
    expect(PRINT_JOB_STATUS_LABELS.completed).toMatch(/não confirmado/i);
  });
});
