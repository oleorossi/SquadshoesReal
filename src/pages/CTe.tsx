import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Truck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  rascunho: 'bg-muted text-muted-foreground',
  autorizado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-destructive/10 text-destructive',
  cancelado: 'bg-amber-100 text-amber-700',
};

export default function CTe() {
  return (
    <DataListPage
      title="CT-e · Conhecimento de Transporte"
      subtitle="Emissão de CT-e para frete contratado (integração Sefaz necessária para autorização)"
      icon={Truck}
      table="cte_emissions"
      orderBy="emission_date"
      emptyText="Nenhum CT-e emitido"
      newButtonLabel="Novo CT-e"
      newButtonOnClick={() => toast.info('Editor de CT-e — vincule NF-es de mercadoria pra calcular ICMS automaticamente')}
      columns={[
        { key: 'cte_number', label: 'Nº', render: r => <span className="font-mono font-bold text-xs">{r.cte_number}</span> },
        { key: 'cte_type', label: 'Tipo', render: r => <Badge variant="outline" className="capitalize text-[10px]">{r.cte_type}</Badge> },
        { key: 'emission_date', label: 'Emissão', render: r => <span className="text-xs">{format(new Date(r.emission_date), 'dd/MM/yy')}</span> },
        { key: 'route', label: 'Rota', render: r => <span className="text-xs">{r.origin_uf} → {r.destination_uf}</span> },
        { key: 'transporter_name', label: 'Transportadora' },
        { key: 'freight_value', label: 'Frete', align: 'right', render: r => <span className="font-mono text-xs">R$ {Number(r.freight_value || 0).toFixed(2)}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
      ]}
    />
  );
}
