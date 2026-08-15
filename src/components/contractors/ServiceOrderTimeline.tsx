import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  CheckCircle, CircleNotch as Loader2, CurrencyDollar, FileText, Truck,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';

interface TimelineEvent {
  id: string;
  event_type: 'created' | 'dispatched' | 'conferred' | 'financial_created' | 'financial_paid' | 'cancelled' | 'status_changed' | string;
  contractor_name: string | null;
  quantity: number | null;
  amount: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const EVENT_LABEL: Record<string, string> = {
  created: 'OS emitida',
  dispatched: 'Remessa enviada',
  conferred: 'Retorno conferido',
  financial_created: 'Enviada ao financeiro',
  financial_paid: 'Pagamento realizado',
  cancelled: 'OS cancelada',
  status_changed: 'Status alterado',
};

const iconFor = (type: string) => {
  if (type === 'dispatched') return Truck;
  if (type === 'conferred') return CheckCircle;
  if (type.startsWith('financial_')) return CurrencyDollar;
  return FileText;
};

export function ServiceOrderTimeline({ serviceOrderId }: { serviceOrderId: string }) {
  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ['service_order_timeline', serviceOrderId],
    enabled: !!serviceOrderId,
    queryFn: async () => {
      // View criada por migration; entra no types.ts só na próxima regeneração.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('v_service_order_timeline')
        .select('*')
        .eq('service_order_id', serviceOrderId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TimelineEvent[];
    },
  });

  if (isLoading) return <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (isError) return <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar a trilha desta OS.</p>;
  if (events.length === 0) return <EmptyState icon={FileText} title="Sem eventos registrados" description="As próximas ações desta OS aparecerão aqui." />;

  return (
    <ol className="space-y-0" aria-label="Histórico operacional da ordem de serviço">
      {events.map((event, index) => {
        const Icon = iconFor(event.event_type);
        const metadata = event.metadata || {};
        const from = typeof metadata.from === 'string' ? metadata.from : null;
        const to = typeof metadata.to === 'string' ? metadata.to : null;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {index < events.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px bg-border" />}
            <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-card text-primary">
              <Icon className="h-4 w-4" weight={event.event_type === 'conferred' || event.event_type === 'financial_paid' ? 'fill' : 'regular'} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold">{EVENT_LABEL[event.event_type] || event.event_type}</p>
                <time className="font-mono text-[11px] text-muted-foreground">{format(new Date(event.created_at), 'dd/MM/yyyy HH:mm')}</time>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {event.contractor_name || ''}
                {event.quantity != null ? `${event.contractor_name ? ' · ' : ''}${Number(event.quantity).toLocaleString('pt-BR')} pares` : ''}
                {event.amount != null ? ` · ${formatCurrency(Number(event.amount))}` : ''}
                {from && to ? ` · ${from} → ${to}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
