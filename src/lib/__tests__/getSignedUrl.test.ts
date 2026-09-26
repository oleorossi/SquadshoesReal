import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl,
      }),
    },
  },
}));

describe('getSignedUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    createSignedUrl.mockReset();
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/obj' },
      error: null,
    });
  });

  it('remove ?t= do path antes de assinar', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
    const { getSignedUrl } = await import('@/lib/getSignedUrl');
    const url =
      'https://proj.supabase.co/storage/v1/object/public/client-logos/cli/label-logo-objetiva.png?t=123';
    const signed = await getSignedUrl(url);
    expect(signed).toBe('https://signed.example/obj');
    expect(createSignedUrl).toHaveBeenCalledWith('cli/label-logo-objetiva.png', 3600);
  });
});
