import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Pulse as Activity } from '@phosphor-icons/react';
import { format } from 'date-fns';

// Cores semânticas dark-mode-safe (tint /10 + texto -600 + borda /20).
const STATUS: Record<string, string> = {
  aguardando_coleta: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  coletado: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  em_transito: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  saiu_para_entrega: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  entregue: 'bg-green-500/10 text-green-600 border-green-500/20',
  devolvido: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  extraviado: 'bg-destructive/10 text-destructive border-destructive/30',
  recusa: 'bg-destructive/10 text-destructive border-destructive/30',
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
