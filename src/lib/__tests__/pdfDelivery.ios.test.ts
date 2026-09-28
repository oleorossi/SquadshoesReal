import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../iosDevice', () => ({
  isIosBrowser: vi.fn(() => true),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'tok' } },
        error: null,
      }),
    },
  },
}));

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

import { isIosBrowser } from '../iosDevice';
import { printHtmlAsPdf, openPrintTab } from '../printPdf';
import { getPdfDeliveryState, closePdfDelivery } from '../pdfDeliveryStore';

describe('printHtmlAsPdf no iOS', () => {
  beforeEach(() => {
    closePdfDelivery();
    vi.mocked(isIosBrowser).mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const accept = String(init?.headers && (init.headers as Record<string, string>).Accept || '');
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ job: 'job-ios-1', status: 'pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/render-pdf') && accept.includes('application/json')) {
        return new Response(JSON.stringify({ status: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // download PDF bytes
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }));
  });

  it('openPrintTab não abre aba', () => {
    const open = vi.spyOn(window, 'open');
    expect(openPrintTab()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('usa overlay client-side em vez de form submit', async () => {
    const submit = vi.fn();
    HTMLFormElement.prototype.submit = submit as unknown as () => void;

    const ok = await printHtmlAsPdf('<html><body>oi</body></html>', {
      filename: 'etiquetas-PV-1',
      title: 'Etiquetas',
    });

    expect(ok).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
    const st = getPdfDeliveryState();
    expect(st.open).toBe(true);
    expect(st.phase).toBe('ready');
    expect(st.title).toBe('Etiquetas');
    expect(st.bytes?.byteLength).toBe(4);
    expect(st.safariUrl).toContain('job-ios-1');
  });
});
