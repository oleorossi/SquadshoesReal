import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  listPendingOrders: vi.fn(),
  getLegacyQuarantineSummary: vi.fn(),
  clearLegacyQuarantine: vi.fn(),
  removeFromQueue: vi.fn(),
  repairPermanentQueuedOrder: vi.fn(),
  triggerSync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/hooks/useAccessControl', () => ({
  useCan: () => ({ canCreate: true, canDelete: true, loading: false }),
}));
vi.mock('@/lib/mobile/networkStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/lib/mobile/syncEngine', () => ({ triggerSync: mocks.triggerSync }));
vi.mock('@/lib/mobile/offlineQueue', () => ({
  listPendingOrders: mocks.listPendingOrders,
  getLegacyQuarantineSummary: mocks.getLegacyQuarantineSummary,
  clearLegacyQuarantine: mocks.clearLegacyQuarantine,
  removeFromQueue: mocks.removeFromQueue,
  repairPermanentQueuedOrder: mocks.repairPermanentQueuedOrder,
  mobileCurrentDraftKey: (ownerId: string) => `mobile-current-draft-id:${ownerId}`,
  canRepairPermanentQueuedOrder: (queued: {
    ownerId?: string;
    payload?: { ownerId?: string };
    failureKind?: string;
  }, ownerId: string) =>
    queued.ownerId === ownerId
    && queued.payload?.ownerId === ownerId
    && queued.failureKind === 'permanent',
}));
vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}));

import MobilePending from '../MobilePending';

function queued(id: string, failureKind: 'permanent' | 'transient') {
  return {
    storage_key: `owner-1:${id}`,
    ownerId: 'owner-1',
    client_request_id: id,
    payload: {
      ownerId: 'owner-1',
      order: { client_name: failureKind === 'permanent' ? 'Cliente Permanente' : 'Cliente Transitório' },
      items: [],
    },
    createdAt: Date.now(),
    attempts: 1,
    lastError: failureKind === 'permanent' ? 'Cliente bloqueado' : 'Falha de rede',
    lastAttemptAt: Date.now(),
    failureKind,
  };
}

describe('UX de isolamento e correção da fila mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listPendingOrders.mockResolvedValue([
      queued('request-permanent', 'permanent'),
      queued('request-transient', 'transient'),
    ]);
    mocks.getLegacyQuarantineSummary.mockResolvedValue({
      total: 2,
      pendingOrders: 1,
      drafts: 1,
      catalogEntries: 0,
    });
    mocks.repairPermanentQueuedOrder.mockResolvedValue({ clientRequestId: 'request-new' });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'request-new') });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('mostra somente contagens ownerless e oferece Corrigir apenas para falha permanente', async () => {
    render(<MobilePending />);

    expect(await screen.findByText('2 dado(s) legado(s) em quarentena')).toBeInTheDocument();
    expect(screen.getByText(/O conteúdo permanece oculto e nunca será sincronizado/)).toBeInTheDocument();
    expect(screen.queryByText(/SEGREDO DE OUTRO DONO/)).not.toBeInTheDocument();

    const permanentCard = screen.getByText('Cliente Permanente').closest('li')!;
    const transientCard = screen.getByText('Cliente Transitório').closest('li')!;
    expect(within(permanentCard).getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
    expect(within(transientCard).queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument();

    fireEvent.click(within(permanentCard).getByRole('button', { name: 'Corrigir' }));
    await waitFor(() => expect(mocks.repairPermanentQueuedOrder)
      .toHaveBeenCalledWith('owner-1', 'request-permanent', 'request-new'));
    expect(localStorage.getItem('mobile-current-draft-id:owner-1')).toBe('request-new');
    expect(mocks.navigate).toHaveBeenCalledWith('/m/new');
  });

  it('permite apagar a quarentena sem renderizar qualquer payload legado', async () => {
    render(<MobilePending />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar dados em quarentena' }));

    await waitFor(() => expect(mocks.clearLegacyQuarantine).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Dados legados isolados foram apagados deste dispositivo.',
    );
  });
});
