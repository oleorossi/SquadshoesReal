import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const REQ_STATUS: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700',
  em_analise: 'bg-amber-100 text-amber-700',
  atendida: 'bg-emerald-100 text-emerald-700',
  rejeitada: 'bg-destructive/10 text-destructive',
  cancelada: 'bg-muted text-muted-foreground',
};

const emptyForm = {
  request_type: 'acesso',
  subject_type: 'cliente',
  subject_name: '',
  subject_document: '',
  subject_email: '',
  description: '',
};

export default function LGPD() {
  const [tab, setTab] = useState('requests');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      if (!form.subject_name) throw new Error('Nome do titular é obrigatório');
      const { error } = await (supabase as any).from('lgpd_requests').insert({
        request_type: form.request_type,
        subject_type: form.subject_type,
        subject_name: form.subject_name,
        subject_document: form.subject_document || null,
        subject_email: form.subject_email || null,
        description: form.description || null,
        status: 'aberta',
        opened_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-list-page'] });
      setOpen(false);
      setForm(emptyForm);
      toast.success('Solicitação LGPD registrada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="SISTEMA · LGPD"
        title="LGPD"
        description="Consentimentos, retenção, acesso, retificação, exclusão e portabilidade"
      />

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
            newButtonOnClick={() => { setForm(emptyForm); setOpen(true); }}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nova Solicitação LGPD</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.request_type} onValueChange={v => setForm({ ...form, request_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acesso">Acesso aos dados</SelectItem>
                    <SelectItem value="retificacao">Retificação</SelectItem>
                    <SelectItem value="exclusao">Exclusão</SelectItem>
                    <SelectItem value="portabilidade">Portabilidade</SelectItem>
                    <SelectItem value="revogacao_consentimento">Revogação de consentimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Titular</Label>
                <Select value={form.subject_type} onValueChange={v => setForm({ ...form, subject_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cliente">Cliente</SelectItem>
                    <SelectItem value="funcionario">Funcionário</SelectItem>
                    <SelectItem value="fornecedor">Fornecedor</SelectItem>
                    <SelectItem value="visitante">Visitante</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Nome do titular *</Label>
              <Input value={form.subject_name} onChange={e => setForm({ ...form, subject_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">CPF/CNPJ</Label>
                <Input value={form.subject_document} onChange={e => setForm({ ...form, subject_document: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <Input type="email" value={form.subject_email} onChange={e => setForm({ ...form, subject_email: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Descrição da solicitação</Label>
              <Textarea rows={3} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.subject_name}>
              {create.isPending ? 'Salvando...' : 'Registrar solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
