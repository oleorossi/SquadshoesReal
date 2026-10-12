import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMaterialSectorGaps, materialSectorGapsKey } from '@/hooks/useMaterialSectorGaps';

// ⚠ alias `@/` obrigatório (CLAUDE.md): `vi.mock` relativo é ignorado em
// silêncio quando o vitest roda sob o Bun.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));

function render(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderHook(() => useMaterialSectorGaps(enabled), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('useMaterialSectorGaps', () => {
  it('chama a RPC do alarme e normaliza número e array', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        product_id: 'p1', product_name: 'COLA  ADESIVO HOTMELT', color: null, unit: 'kg',
        quantity_short: '6.30', reservations: '1',
        recorded_components: 'item padrão (solado)',
        sale_orders: ['PV-00195'], fix_hint: 'SKU sem grupo: …',
      }],
      error: null,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('list_material_sector_gaps');
    expect(result.current.data?.[0].quantity_short).toBe(6.3);
    expect(result.current.data?.[0].reservations).toBe(1);
    expect(result.current.data?.[0].sale_orders).toEqual(['PV-00195']);
  });

  it('FALHA não vira "nenhum buraco" — alarme quebrado não pode parecer cadastro em ordem', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { result } = render();
    await waitFor(() => expect(result.current.isError).toBe(true));
    // o painel ramifica por isError ANTES de empty; `data` fica indefinido
    expect(result.current.data).toBeUndefined();
  });

  it('sale_orders não-array vira [] (não estoura a renderização da célula)', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ product_id: 'p1', product_name: 'X', color: null, unit: null,
               quantity_short: 1, reservations: 1, recorded_components: null,
               sale_orders: null, fix_hint: null }],
      error: null,
    });
    const { result } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].sale_orders).toEqual([]);
  });

  it('respeita enabled=false (Diagnósticos pode adiar a carga)', async () => {
    const { result } = render(false);
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('a query key é estável — o painel e um invalidate futuro falam a mesma chave', () => {
    expect(materialSectorGapsKey).toEqual(['list_material_sector_gaps']);
  });
});
