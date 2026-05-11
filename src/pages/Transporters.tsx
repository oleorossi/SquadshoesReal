import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Truck } from 'lucide-react';
import { toast } from 'sonner';

export default function Transporters() {
  return (
    <DataListPage
      title="Transportadoras"
      subtitle="Cadastro de transportadoras + tabelas de frete por UF"
      icon={Truck}
      table="transporters"
      orderBy="name"
      ascending
      emptyText="Nenhuma transportadora cadastrada"
      newButtonLabel="Nova Transportadora"
      newButtonOnClick={() => toast.info('Editor de transportadora em breve')}
      columns={[
        { key: 'name', label: 'Nome', render: r => <span className="font-semibold">{r.name}</span> },
        { key: 'cnpj', label: 'CNPJ', render: r => <span className="font-mono text-xs">{r.cnpj || '—'}</span> },
        { key: 'address', label: 'Endereço', render: r => <span className="text-xs">{r.address_city || '—'}/{r.address_state || '—'}</span> },
        { key: 'has_api_integration', label: 'API', render: r => r.has_api_integration ? <Badge>integrada</Badge> : <Badge variant="outline">manual</Badge> },
        { key: 'active', label: 'Status', render: r => <Badge variant={r.active ? 'default' : 'secondary'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
      ]}
    />
  );
}
