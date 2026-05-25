import { useEffect, useState } from 'react';
import { ArrowsClockwise, Trash, WarningCircle } from '@phosphor-icons/react';
import { listPendingOrders, removeFromQueue, type QueuedOrder } from '@/lib/mobile/offlineQueue';
import { triggerSync } from '@/lib/mobile/syncEngine';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { toast } from 'sonner';

export default function MobilePending() {
  const online = useOnlineStatus();
  const [items, setItems] = useState<QueuedOrder[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = async () => setItems(await listPendingOrders());
  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 3000);
    return () => clearInterval(i);
  }, []);

  const handleSyncNow = async () => {
    if (!online) {
      toast.error('Sem conexão — conecte à rede primeiro');
      return;
    }
    setSyncing(true);
    const r = await triggerSync();
    setSyncing(false);
    if (r) {
      toast.success(`${r.succeeded} enviado(s) · ${r.skipped} duplicado(s) · ${r.failed} falha(s)`);
    }
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esse pedido da fila? A informação local será perdida.')) return;
    await removeFromQueue(id);
    await refresh();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Pendentes ({items.length})</h2>
        <button
          onClick={handleSyncNow}
          disabled={!online || syncing || items.length === 0}
          className="flex items-center gap-1.5 text-sm font-bold text-primary disabled:text-muted-foreground"
        >
          <ArrowsClockwise className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          Sincronizar
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">Nenhum pedido pendente.</p>
          <p className="text-xs mt-1">Pedidos criados offline aparecem aqui.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(q => (
            <li key={q.client_request_id} className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
              <div className="flex items-start justify-between">
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
                        Tentativa {q.attempts}: {q.lastError.slice(0, 100)}
                      </span>
                    </div>
                  )}
                </div>
                <button onClick={() => handleDelete(q.client_request_id)} className="text-destructive p-1">
                  <Trash className="h-5 w-5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
