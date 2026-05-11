import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileCheck2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  em_montagem: 'bg-blue-100 text-blue-700',
  liberado: 'bg-amber-100 text-amber-700',
  em_transito: 'bg-indigo-100 text-indigo-700',
  entregue: 'bg-emerald-100 text-emerald-700',
  cancelado: 'bg-muted text-muted-foreground',
};

export default function Manifests() {
  return (
    <DataListPage
      title="Romaneios de Carga"
      subtitle="Volumes, peso, destinos por viagem"
      icon={FileCheck2}
      table="shipping_manifests"
      orderBy="emission_date"
      emptyText="Nenhum romaneio emitido"
      newButtonLabel="Novo Romaneio"
      newButtonOnClick={() => toast.info('Selecione volumes/PVs pra montar romaneio')}
      columns={[
        { key: 'manifest_number', label: 'Nº', render: r => <span className="font-mono font-bold text-xs">{r.manifest_number}</span> },
        { key: 'emission_date', label: 'Data', render: r => format(new Date(r.emission_date), 'dd/MM/yy') },
        { key: 'vehicle_plate', label: 'Placa', render: r => <span className="font-mono text-xs">{r.vehicle_plate || '—'}</span> },
        { key: 'transporter_name', label: 'Transportadora' },
        { key: 'total_volumes', label: 'Volumes', align: 'right' },
        { key: 'total_pairs', label: 'Pares', align: 'right' },
        { key: 'total_weight_kg', label: 'Peso (kg)', align: 'right', render: r => <span className="font-mono text-xs">{Number(r.total_weight_kg).toFixed(1)}</span> },
        { key: 'destinations_count', label: 'Destinos', align: 'right' },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status.replace('_',' ')}</Badge> },
      ]}
    />
  );
}
