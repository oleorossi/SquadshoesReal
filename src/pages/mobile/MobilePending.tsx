import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsClockwise, CloudArrowUp, PencilSimple, Trash, WarningCircle } from '@phosphor-icons/react';
import {
  canRepairPermanentQueuedOrder,
  clearLegacyQuarantine,
  getLegacyQuarantineSummary,
  listPendingOrders,
  mobileCurrentDraftKey,
  removeFromQueue,
  repairPermanentQueuedOrder,
  type LegacyQuarantineSummary,
  type QueuedOrder,
} from '@/lib/mobile/offlineQueue';
import { triggerSync } from '@/lib/mobile/syncEngine';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useAccessControl';

export default function MobilePending() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { user } = useAuth();
  const perm = useCan('/sales');
  const [items, setItems] = useState<QueuedOrder[]>([]);
  const [legacyQuarantine, setLegacyQuarantine] = useState<LegacyQuarantineSummary>({
    total: 0,
    pendingOrders: 0,
    drafts: 0,
    catalogEntries: 0,
  });
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const [pending, quarantine] = await Promise.all([
      user?.id ? listPendingOrders(user.id) : Promise.resolve([]),
      getLegacyQuarantineSummary(),
    ]);
    setItems(pending);
    setLegacyQuarantine(quarantine);
  }, [user?.id]);
  useEffect(() => {
    void refresh();
    const i = setInterval(refresh, 3000);
    return () => clearInterval(i);
  }, [refresh]);

  const handleSyncNow = async () => {
    if (!online) {
      toast.error('Sem conexão — conecte à rede primeiro');
      return;
    }
    if (!perm.canCreate || !user?.id) {
      toast.error('Você não tem permissão para criar/sincronizar pedidos.');
      return;
    }
    setSyncing(true);
    try {
      const r = await triggerSync(user.id);
      if (r) {
        toast.success(`${r.succeeded} confirmado(s) · ${r.skipped} repetição(ões) segura(s) · ${r.failed} falha(s) de envio`);
        if (r.createdAsDraft > 0 || r.confirmationUnknown > 0) {
          toast.warning(
            `${r.createdAsDraft} salvo(s) como Rascunho · ${r.confirmationUnknown} confirmação(ões) não verificadas`,
            { description: r.confirmationErrors.slice(0, 2).map((entry) => entry.error).join('\n') },
          );
        }
      }
    } catch (error: unknown) {
      toast.error('Não foi possível ler ou sincronizar a fila local.', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSyncing(false);
      await refresh();
    }
  };

  const handleDelete = async (id: string) => {
    if (!perm.canDelete || !user?.id) {
      toast.error('Você não tem permissão para excluir pedidos pendentes.');
      return;
    }
    if (!confirm('Remover esse pedido da fila? A informação local será perdida.')) return;
    await removeFromQueue(user.id, id);
    await refresh();
  };

  const handleClearLegacyQuarantine = async () => {
    if (!confirm(
      `Apagar ${legacyQuarantine.total} registro(s) legado(s) isolado(s)? Eles não podem ser atribuídos com segurança a um vendedor e não são sincronizados.`,
    )) return;
    await clearLegacyQuarantine();
    toast.success('Dados legados isolados foram apagados deste dispositivo.');
    await refresh();
  };

  const handleRepair = async (queued: QueuedOrder) => {
    if (!user?.id || !perm.canCreate || !canRepairPermanentQueuedOrder(queued, user.id)) {
      toast.error('Este pedido não pode ser aberto para correção.');
      return;
    }
    if (!confirm('Criar um novo rascunho para corrigir este pedido? A tentativa recusada será encerrada.')) return;
    const newClientRequestId = crypto.randomUUID();
    try {
      await repairPermanentQueuedOrder(user.id, queued.client_request_id, newClientRequestId);
      localStorage.setItem(mobileCurrentDraftKey(user.id), newClientRequestId);
      toast.success('Novo rascunho criado. Corrija os campos e envie novamente.');
      navigate('/m/new');
    } catch (error: unknown) {
      toast.error('Não foi possível abrir o pedido para correção.', {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Pendentes ({items.length})</h2>
        <button
          onClick={handleSyncNow}
          disabled={!online || syncing || items.length === 0 || !perm.canCreate}
          className="flex items-center gap-1.5 text-sm font-bold text-primary disabled:text-muted-foreground"
        >
          <ArrowsClockwise className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          Sincronizar
        </button>
      </div>

      {legacyQuarantine.total > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <WarningCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                {legacyQuarantine.total} dado(s) legado(s) em quarentena
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {legacyQuarantine.pendingOrders} pedido(s), {legacyQuarantine.drafts} rascunho(s) e{' '}
                {legacyQuarantine.catalogEntries} item(ns) de catálogo antigos não têm proprietário verificável.
                O conteúdo permanece oculto e nunca será sincronizado.
              </p>
              <button
                type="button"
                onClick={handleClearLegacyQuarantine}
                className="mt-2 text-xs font-bold text-destructive"
              >
                Apagar dados em quarentena
              </button>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={CloudArrowUp}
          title="Nenhum pedido pendente"
          description="Pedidos criados offline aparecem aqui."
        />
      ) : (
        <ul className="space-y-2">
          {items.map(q => (
            <li key={q.client_request_id} className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{q.payload.order.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.payload.items.length} {q.payload.items.length === 1 ? 'item' : 'itens'} ·{' '}
                    {new Date(q.createdAt).toLocaleString('pt-BR')}
                  </p>
                  {q.lastError && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                      <WarningCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {q.failureKind === 'permanent' ? 'Correção necessária' : `Tentativa ${q.attempts}`}: {q.lastError.slice(0, 100)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {perm.canCreate && user?.id && canRepairPermanentQueuedOrder(q, user.id) && (
                    <button
                      type="button"
                      onClick={() => handleRepair(q)}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-bold text-primary"
                    >
                      <PencilSimple className="h-4 w-4" />
                      Corrigir
                    </button>
                  )}
                  {perm.canDelete && (
                    <button
                      type="button"
                      aria-label={`Excluir pedido pendente de ${q.payload.order.client_name}`}
                      onClick={() => handleDelete(q.client_request_id)}
                      className="p-1 text-destructive"
                    >
                      <Trash className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
