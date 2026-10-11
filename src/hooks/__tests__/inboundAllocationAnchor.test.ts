import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Janela do rateio ancorada no relógio do SERVIDOR (`anchorInboundSince`).
 * PC da fábrica com relógio adiantado fazia a tela de rateio nunca abrir; com
 * relógio atrasado, a janela puxava entradas anteriores de outras pessoas.
 */

const updatedAtRows: { current: Array<{ updated_at: string | null }> } = { current: [] };
const queryError: { current: unknown } = { current: null };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async () => ({ data: updatedAtRows.current, error: queryError.current }),
      }),
    }),
    rpc: async () => ({ data: [], error: null }),
  },
}));

import { anchorInboundSince } from '@/hooks/useInboundAllocations';

const SERVER_END = Date.parse('2026-10-11T15:00:10.000Z');

describe('anchorInboundSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updatedAtRows.current = [{ updated_at: '2026-10-11T15:00:10.000000+00:00' }];
    queryError.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('PC adiantado 10 min: a janela continua cobrindo a operação no relógio do servidor', async () => {
    const skew = 10 * 60 * 1000;
    const clientStart = SERVER_END - 4000 + skew; // operação de 4 s
    vi.setSystemTime(SERVER_END + skew);
    const since = await anchorInboundSince(['p1'], new Date(clientStart).toISOString());
    expect(since).not.toBeNull();
    const sinceMs = Date.parse(since as string);
    // Início da operação no servidor = 15:00:06 — tem que estar dentro da janela…
    expect(sinceMs).toBeLessThanOrEqual(SERVER_END - 4000);
    // …e a janela não pode recuar além da folga.
    expect(sinceMs).toBeGreaterThanOrEqual(SERVER_END - 4000 - 2000);
  });

  it('PC atrasado 10 min: não puxa entradas de minutos antes da operação', async () => {
    const skew = -10 * 60 * 1000;
    const clientStart = SERVER_END - 4000 + skew;
    vi.setSystemTime(SERVER_END + skew);
    const since = await anchorInboundSince(['p1'], new Date(clientStart).toISOString());
    const sinceMs = Date.parse(since as string);
    expect(sinceMs).toBeLessThanOrEqual(SERVER_END - 4000);
    expect(sinceMs).toBeGreaterThanOrEqual(SERVER_END - 4000 - 2000);
  });

  it('nenhum produto gravado perto da operação → null (nada a revisar)', async () => {
    updatedAtRows.current = [{ updated_at: '2026-10-11T12:00:00.000Z' }];
    vi.setSystemTime(SERVER_END);
    const since = await anchorInboundSince(['p1'], new Date(SERVER_END - 1000).toISOString());
    expect(since).toBeNull();
  });

  it('leitura da âncora falhou → cai no relógio local − 5 s (não esconde a tela)', async () => {
    queryError.current = { message: 'boom' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.setSystemTime(SERVER_END);
    const clientStart = SERVER_END - 1000;
    const since = await anchorInboundSince(['p1'], new Date(clientStart).toISOString());
    expect(since).toBe(new Date(clientStart - 5000).toISOString());
    warn.mockRestore();
  });

  it('sem produtos → null', async () => {
    expect(await anchorInboundSince([], new Date().toISOString())).toBeNull();
  });
});
