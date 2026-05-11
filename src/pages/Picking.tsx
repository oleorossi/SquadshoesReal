import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700',
  em_separacao: 'bg-amber-100 text-amber-700',
  conferida: 'bg-indigo-100 text-indigo-700',
  divergencia: 'bg-destructive/10 text-destructive',
  concluida: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-muted text-muted-foreground',
};

export default function Picking() {
  return (
    <DataListPage
      title="Picking · Separação"
      subtitle="Separação por pedido/onda com bipagem EAN e coletor"
      icon={ClipboardCheck}
      table="picking_sessions"
      orderBy="created_at"
      emptyText="Nenhuma sessão de picking ativa"
      newButtonLabel="Nova Sessão"
      newButtonOnClick={() => toast.info('Selecione PVs ou onda pra iniciar separação')}
      columns={[
        { key: 'session_number', label: 'Nº', render: r => <span className="font-mono font-bold text-xs">{r.session_number}</span> },
        { key: 'picking_type', label: 'Tipo', render: r => <Badge variant="outline" className="text-[10px] capitalize">{r.picking_type.replace('_',' ')}</Badge> },
        { key: 'total_pairs', label: 'Pares', align: 'right' },
        { key: 'total_volumes', label: 'Volumes', align: 'right' },
        { key: 'started_at', label: 'Iniciada', render: r => r.started_at ? <span className="text-xs">{format(new Date(r.started_at), 'dd/MM HH:mm')}</span> : '—' },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status.replace('_',' ')}</Badge> },
      ]}
    />
  );
}
