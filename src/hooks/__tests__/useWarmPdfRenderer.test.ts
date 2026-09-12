import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWarmPdfRenderer } from '@/hooks/useWarmPdfRenderer';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-quente' } },
        error: null,
      }),
    },
  },
}));

describe('useWarmPdfRenderer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('GET /api/render-pdf com o token da sessão — mesmo path do POST', async () => {
    renderHook(() => useWarmPdfRenderer());
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/render-pdf', expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-quente' },
      }));
    });
  });
});
