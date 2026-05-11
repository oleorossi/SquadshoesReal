import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  rascunho: 'bg-muted text-muted-foreground',
  autorizado: 'bg-emerald-100 text-emerald-700',
  encerrado: 'bg-indigo-100 text-indigo-700',
  cancelado: 'bg-amber-100 text-amber-700',
};

export default function MDFe() {
  return (
    <DataListPage
      title="MDF-e · Manifesto Eletrônico"
      subtitle="Documento fiscal pra transporte rodoviário com várias NF-es"
      icon={FileText}
      table="mdfe_emissions"
      orderBy="emission_date"
      emptyText="Nenhum MDF-e emitido"
      newButtonLabel="Novo MDF-e"
      newButtonOnClick={() => toast.info('Editor de MDF-e — agrupe CT-es e NF-es por viagem/veículo')}
      columns={[
        { key: 'mdfe_number', label: 'Nº', render: r => <span className="font-mono font-bold text-xs">{r.mdfe_number}</span> },
        { key: 'emission_date', label: 'Emissão', render: r => <span className="text-xs">{format(new Date(r.emission_date), 'dd/MM/yy')}</span> },
        { key: 'modal', label: 'Modal', render: r => <Badge variant="outline" className="capitalize text-[10px]">{r.modal}</Badge> },
        { key: 'route', label: 'Rota', render: r => <span className="text-xs">{r.origin_uf} → {r.destination_uf}</span> },
        { key: 'vehicle_plate', label: 'Placa', render: r => <span className="font-mono text-xs">{r.vehicle_plate || '—'}</span> },
        { key: 'driver_name', label: 'Motorista' },
        { key: 'total_pairs', label: 'Pares', align: 'right' },
        { key: 'total_value', label: 'Valor', align: 'right', render: r => <span className="font-mono text-xs">R$ {Number(r.total_value || 0).toFixed(2)}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
      ]}
    />
  );
}
