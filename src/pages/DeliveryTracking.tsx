import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Pulse as Activity } from '@phosphor-icons/react';
import { format } from 'date-fns';

const STATUS: Record<string, string> = {
  aguardando_coleta: 'bg-blue-100 text-blue-700',
  coletado: 'bg-indigo-100 text-indigo-700',
  em_transito: 'bg-amber-100 text-amber-700',
  saiu_para_entrega: 'bg-purple-100 text-purple-700',
  entregue: 'bg-emerald-100 text-emerald-700',
  devolvido: 'bg-amber-100 text-amber-700',
  extraviado: 'bg-destructive/10 text-destructive',
  recusa: 'bg-destructive/10 text-destructive',
};

export default function DeliveryTracking() {
  return (
    <DataListPage
      sectionLabel="LOGÍSTICA · RASTREAMENTO"
      title="Rastreamento de Entregas"
      subtitle="Eventos por entrega + tracking integrado"
      icon={Activity}
      table="delivery_tracking"
      orderBy="last_update_at"
      emptyText="Nenhuma entrega em rastreamento"
      enableBulkDelete
      entityLabel="entrega"
      displayLabel={(r: any) => `• ${r.tracking_code || '—'} (${r.recipient_name || 'sem destinatário'})`}
      columns={[
        { key: 'tracking_code', label: 'Código', render: r => <span className="font-mono text-xs">{r.tracking_code || '—'}</span> },
        { key: 'recipient_name', label: 'Destinatário' },
        { key: 'expected_delivery_date', label: 'Previsto', render: r => r.expected_delivery_date ? format(new Date(r.expected_delivery_date), 'dd/MM/yy') : '—' },
        { key: 'actual_delivery_date', label: 'Entregue', render: r => r.actual_delivery_date ? format(new Date(r.actual_delivery_date), 'dd/MM/yy') : '—' },
        { key: 'last_update_at', label: 'Última Atualização', render: r => <span className="text-xs">{format(new Date(r.last_update_at), 'dd/MM HH:mm')}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-xs capitalize`}>{r.status.replace(/_/g, ' ')}</Badge> },
      ]}
    />
  );
}
