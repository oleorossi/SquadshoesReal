import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const REQ_STATUS: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700',
  em_analise: 'bg-amber-100 text-amber-700',
  atendida: 'bg-emerald-100 text-emerald-700',
  rejeitada: 'bg-destructive/10 text-destructive',
  cancelada: 'bg-muted text-muted-foreground',
};

export default function LGPD() {
  const [tab, setTab] = useState('requests');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Lock className="h-7 w-7 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">LGPD</h1>
          <p className="text-sm text-muted-foreground">Consentimentos, retenção, acesso, retificação, exclusão e portabilidade</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Solicitações</TabsTrigger>
          <TabsTrigger value="consents">Consentimentos</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-3">
          <DataListPage
            title=""
            table="lgpd_requests"
            orderBy="opened_at"
            emptyText="Nenhuma solicitação LGPD registrada"
            newButtonLabel="Nova Solicitação"
            newButtonOnClick={() => toast.info('Cadastre titular + tipo (acesso/retificação/exclusão/portabilidade)')}
            columns={[
              { key: 'request_number', label: 'Nº', render: r => <span className="font-mono font-bold text-xs">{r.request_number}</span> },
              { key: 'request_type', label: 'Tipo', render: r => <Badge variant="outline" className="capitalize text-[10px]">{r.request_type}</Badge> },
              { key: 'subject_type', label: 'Titular', render: r => <span className="text-xs capitalize">{r.subject_type}</span> },
              { key: 'subject_name', label: 'Nome' },
              { key: 'opened_at', label: 'Aberta', render: r => <span className="text-xs">{format(new Date(r.opened_at), 'dd/MM/yy')}</span> },
              { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${REQ_STATUS[r.status]} text-[10px] capitalize`}>{r.status.replace('_',' ')}</Badge> },
            ]}
          />
        </TabsContent>
        <TabsContent value="consents" className="mt-3">
          <DataListPage
            title=""
            table="lgpd_consents"
            orderBy="granted_at"
            emptyText="Nenhum consentimento registrado"
            columns={[
              { key: 'consent_type', label: 'Tipo', render: r => <Badge variant="outline" className="capitalize text-[10px]">{r.consent_type}</Badge> },
              { key: 'consent_purpose', label: 'Finalidade' },
              { key: 'granted', label: 'Status', render: r => <Badge variant={r.granted ? 'default' : 'destructive'}>{r.granted ? 'Ativo' : 'Revogado'}</Badge> },
              { key: 'granted_at', label: 'Concedido em', render: r => <span className="text-xs">{format(new Date(r.granted_at), 'dd/MM/yy')}</span> },
              { key: 'revoked_at', label: 'Revogado em', render: r => r.revoked_at ? <span className="text-xs">{format(new Date(r.revoked_at), 'dd/MM/yy')}</span> : '—' },
              { key: 'source', label: 'Origem' },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
