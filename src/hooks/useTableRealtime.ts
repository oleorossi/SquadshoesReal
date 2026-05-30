import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type PgEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeSubscription {
  /** Nome da tabela (sem schema). */
  table: string;
  /** Eventos a escutar — default '*' (INSERT+UPDATE+DELETE). */
  event?: PgEvent;
  /** Filtro PostgREST opcional (ex.: 'order_id=eq.<uuid>'). */
  filter?: string;
  /** queryKey(s) a invalidar quando o evento dispara. */
  invalidate: QueryKey | QueryKey[];
}

/**
 * Subscriptions a tabelas Postgres via Supabase Realtime — invalida React Query
 * automaticamente quando eventos chegarem. Substitui polling em telas de
 * gestão por reação em segundos.
 *
 * Uso:
 *   useTableRealtime([
 *     { table: 'orders', invalidate: ['orders'] },
 *     { table: 'notifications', event: 'INSERT', invalidate: [['notifications_aggregated']] },
 *   ], { channelName: 'pcp-dashboard' });
 *
 * Não desliga sozinho se uma subscription falhar — Supabase Realtime reconecta
 * automaticamente. Limpeza no unmount.
 */
export function useTableRealtime(
  subscriptions: RealtimeSubscription[],
  opts?: { channelName?: string; enabled?: boolean }
) {
  const qc = useQueryClient();
  const enabled = opts?.enabled ?? true;
  const channelName = opts?.channelName ?? `realtime-${subscriptions.map(s => s.table).join('-')}`;

  // Hash estável das subscriptions pra reagir a mudanças sem re-suscrever a cada render
  const subsKey = JSON.stringify(
    subscriptions.map(s => ({ t: s.table, e: s.event || '*', f: s.filter || null }))
  );

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) return;

    let channel: any = (supabase as any).channel(channelName);

    for (const sub of subscriptions) {
      const cfg: any = {
        event: sub.event || '*',
        schema: 'public',
        table: sub.table,
      };
      if (sub.filter) cfg.filter = sub.filter;

      channel = channel.on('postgres_changes', cfg, () => {
        const keys = Array.isArray(sub.invalidate[0])
          ? (sub.invalidate as QueryKey[])
          : [sub.invalidate as QueryKey];
        for (const key of keys) {
          qc.invalidateQueries({ queryKey: key });
        }
      });
    }

    channel.subscribe();

    return () => {
      (supabase as any).removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelName, subsKey, qc]);
}
