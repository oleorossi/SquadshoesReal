import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ──────────────────────────────────────────────────────────────
// Produto que será habilitado como "Item Padrão de Solado" no meio do teste.
const NEW_STANDARD_PRODUCT = {
  id: 'prod-cola-pvc',
  name: 'COLA PVC PREMIUM',
  category: 'Cola',
  color: 'Transparente',
  sku: 'CPP-001',
  is_standard_sole_item: true,
};

// Catálogo inicial de produtos (sem o novo item ainda).
let mockProductsState: any[] = [];

// Mocks dos hooks usados pelo painel.
// IMPORTANTE: retornar SEMPRE a mesma referência de array/objeto entre renders,
// senão o `useEffect([itemsConfigured])` do painel dispara setDrafts a cada
// render → re-render infinito → vitest hang. (Esse era o teste que pendurava
// o CI por ~5min até timeout.)
const EMPTY_ROWS: any[] = [];
const FIXED_SIZES = [34, 35, 36, 37, 38, 39, 40];
const STABLE_HOOK_REFS = {
  rows: { data: EMPTY_ROWS, isLoading: false },
  sizes: { data: FIXED_SIZES, isLoading: false },
  upsert: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
};

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ data: mockProductsState, isLoading: false }),
}));

vi.mock('@/hooks/useSoleStandardItems', () => ({
  useSoleStandardItems: () => STABLE_HOOK_REFS.rows,
  useSoleSizeGrade: () => STABLE_HOOK_REFS.sizes,
  useUpsertSoleStandardItem: () => STABLE_HOOK_REFS.upsert,
  useRemoveSoleStandardItem: () => STABLE_HOOK_REFS.remove,
}));

// scrollIntoView não existe no jsdom — stub global.
beforeEach(() => {
  mockProductsState = [];
  (window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
});

import { SoleStandardItemsPanel } from '../SoleStandardItemsPanel';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SoleStandardItemsPanel soleProductId="sole-1" />
    </QueryClientProvider>
  );
}

describe('SoleStandardItemsPanel — Item Padrão de Solado feedback', () => {
  it('exibe destaque visual imediato quando um item é habilitado como Item Padrão de Solado, sem reload', async () => {
    const { rerender } = renderPanel();

    // Estado inicial: o banner de destaque NÃO deve estar presente.
    expect(screen.queryByTestId('sole-standard-highlight-banner')).toBeNull();

    // Simula o ProductFormDialog: o produto recém-salvo entra no catálogo
    // (via invalidação do React Query) e o evento global é disparado.
    mockProductsState = [NEW_STANDARD_PRODUCT];

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <SoleStandardItemsPanel soleProductId="sole-1" />
      </QueryClientProvider>
    );

    // Dispara o evento global emitido pelo ProductFormDialog após salvar.
    act(() => {
      window.dispatchEvent(
        new CustomEvent('sole-standard-item-enabled', {
          detail: {
            productId: NEW_STANDARD_PRODUCT.id,
            name: NEW_STANDARD_PRODUCT.name,
            category: NEW_STANDARD_PRODUCT.category,
            at: Date.now(),
          },
        })
      );
    });

    // Banner de destaque deve aparecer imediatamente (sem reload da página).
    await waitFor(() => {
      const banner = screen.getByTestId('sole-standard-highlight-banner');
      expect(banner).toBeInTheDocument();
      expect(banner.getAttribute('data-highlighted-id')).toBe(NEW_STANDARD_PRODUCT.id);
      expect(banner.textContent).toContain('COLA PVC PREMIUM');
    });

    // O componente deve ter rolado a entry destacada para a viewport.
    // scrollIntoView é chamado dentro de requestAnimationFrame — esperar
    // o rAF descarregar antes de assertar.
    await waitFor(() => {
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it('localiza a entry pelo nome quando productId não está disponível', async () => {
    mockProductsState = [NEW_STANDARD_PRODUCT];
    renderPanel();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('sole-standard-item-enabled', {
          detail: { productId: null, name: 'COLA PVC PREMIUM', at: Date.now() },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('sole-standard-highlight-banner')).toBeInTheDocument();
    });
  });
});