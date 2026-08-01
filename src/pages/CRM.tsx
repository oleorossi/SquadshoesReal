import { useState } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Phone, Envelope as Mail, ChatText as MessageSquare, Calendar, Cake, WarningCircle as AlertCircle, Repeat, Bell, CheckCircle } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/hooks/useAccessControl';

const CHANNEL_ICONS: Record<string, any> = {
  ligacao: Phone, email: Mail, whatsapp: MessageSquare, sms: MessageSquare,
  visita: Calendar, reuniao: Calendar, feira: Calendar, outro: Calendar,
};

export default function CRM() {
  const qc = useQueryClient();
  // Gate de permissões do CRM (criar interação) — esconde a ação de usuários
  // explicitamente restritos; admins/sem-grant continuam vendo tudo.
  const perm = useCan('/crm');
  const [newOpen, setNewOpen] = useState(false);
  const [contactMode, setContactMode] = useState<'client' | 'external'>('client');
  const [newInt, setNewInt] = useState({
    client_id: '',
    external_contact_name: '',
    interaction_type: 'ligacao',
    subject: '',
    notes: '',
    outcome: '',
    scheduled_for: '',
  });

  const { data: clientsList = [] } = useQuery({
    queryKey: ['crm_clients_select'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('clients').select('id, razao_social').eq('active', true).order('razao_social').limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const createInteraction = useMutation({
    mutationFn: async () => {
      const hasClient = contactMode === 'client' && !!newInt.client_id;
      const hasExternal = contactMode === 'external' && !!newInt.external_contact_name.trim();
      if (!hasClient && !hasExternal) {
        throw new Error('Selecione um cliente OU informe o nome do contato externo');
      }
      if (!newInt.subject) throw new Error('Assunto é obrigatório');
      // Quando há data agendada, NÃO marca completed_at — é um agendamento
      // futuro. Quando não há, é uma interação que já aconteceu (completed_at=now).
      const hasSchedule = !!newInt.scheduled_for;
      const { error } = await (supabase as any).from('crm_interactions').insert({
        client_id: hasClient ? newInt.client_id : null,
        external_contact_name: hasExternal ? newInt.external_contact_name.trim() : null,
        interaction_type: newInt.interaction_type,
        subject: newInt.subject,
        notes: newInt.notes || null,
        outcome: newInt.outcome || null,
        scheduled_for: hasSchedule ? new Date(newInt.scheduled_for).toISOString() : null,
        completed_at: hasSchedule ? null : new Date().toISOString(),
      });
      if (error) throw error;
      return { hasSchedule };
    },
    onSuccess: ({ hasSchedule }) => {
      qc.invalidateQueries({ queryKey: ['crm_interactions'] });
      qc.invalidateQueries({ queryKey: ['crm_scheduled'] });
      qc.invalidateQueries({ queryKey: ['notifications_aggregated'] });
      setNewOpen(false);
      setNewInt({ client_id: '', external_contact_name: '', interaction_type: 'ligacao', subject: '', notes: '', outcome: '', scheduled_for: '' });
      setContactMode('client');
      toast.success(hasSchedule ? 'Contato agendado — você será avisado' : 'Interação registrada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Marcar agendamento como concluído (limpa scheduled_for, seta completed_at=now)
  const completeInteraction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('crm_interactions')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm_interactions'] });
      qc.invalidateQueries({ queryKey: ['crm_scheduled'] });
      qc.invalidateQueries({ queryKey: ['notifications_aggregated'] });
      toast.success('Contato marcado como concluído');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: interactions = [] } = useQuery({
    queryKey: ['crm_interactions'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('crm_interactions')
        .select('*, clients(razao_social)')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // Contatos agendados (scheduled_for futuro/hoje, ainda não completos)
  const { data: scheduled = [] } = useQuery({
    queryKey: ['crm_scheduled'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('crm_interactions')
        .select('*, clients(razao_social)')
        .is('completed_at', null)
        .not('scheduled_for', 'is', null)
        .order('scheduled_for', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5 * 60 * 1000, // refresca a cada 5min (sino também)
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const overdueCount = scheduled.filter((s: any) => new Date(s.scheduled_for) < today).length;
  // A aba mora na URL (contrato do lote L6a). O default DEPENDE dos dados — a
  // tela abria em "Agendados" só quando havia agendamento — então ele é passado
  // dinamicamente; "default" aqui significa a aba que a ausência de parâmetro
  // representa, e ela pode mudar quando a consulta responde.
  const { value: abaAtiva, setValue: setAbaAtiva } = useUrlTabState({
    values: ['scheduled', 'interactions', 'inactive', 'birthdays', 'repurchase', 'nps'] as const,
    defaultValue: scheduled.length > 0 ? 'scheduled' : 'interactions',
  });

  const todayCount = scheduled.filter((s: any) => {
    const d = new Date(s.scheduled_for);
    return d >= today && d < tomorrow;
  }).length;

  const { data: inactive = [] } = useQuery({
    queryKey: ['crm_inactive'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_crm_inactive_clients').select('*').limit(30);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: birthdays = [] } = useQuery({
    queryKey: ['crm_birthdays'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_crm_birthdays_month').select('*');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: repurchase = [] } = useQuery({
    queryKey: ['crm_repurchase'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_crm_expected_repurchase')
        .select('*')
        .order('days_until_expected', { ascending: true })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: nps = [] } = useQuery({
    queryKey: ['crm_nps'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('crm_nps_responses').select('*, clients(razao_social)')
        .order('responded_at', { ascending: false }).limit(30);
      if (error) throw error;
      return data || [];
    },
  });

  const npsScore = nps.length > 0
    ? Math.round(
        (((nps.filter((n: any) => n.category === 'promotor').length / nps.length) * 100) -
         ((nps.filter((n: any) => n.category === 'detrator').length / nps.length) * 100))
      )
    : 0;

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · CRM"
        title="CRM"
        description="Histórico, campanhas, recompra prevista, NPS"
        actions={
          perm.canCreate ? (
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Nova Interação
          </Button>
          ) : undefined
        }
      />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Interação</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">Contato *</Label>
                <div className="flex gap-1 border rounded-sm p-0.5">
                  <button
                    type="button"
                    onClick={() => setContactMode('client')}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors ${
                      contactMode === 'client' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setContactMode('external')}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors ${
                      contactMode === 'external' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Externo
                  </button>
                </div>
              </div>
              {contactMode === 'client' ? (
                <Select value={newInt.client_id} onValueChange={v => setNewInt({ ...newInt, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientsList.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.razao_social}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={newInt.external_contact_name}
                  onChange={e => setNewInt({ ...newInt, external_contact_name: e.target.value })}
                  placeholder="Nome ou empresa do prospect"
                  autoFocus
                />
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {contactMode === 'client'
                  ? 'Cliente da base — fica vinculado pra histórico e métricas.'
                  : 'Contato fora da base (lead, prospect) — só fica no CRM, sem virar cliente.'}
              </p>
            </div>
            <div>
              <Label className="text-xs">Canal</Label>
              <Select value={newInt.interaction_type} onValueChange={v => setNewInt({ ...newInt, interaction_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ligacao">Ligação</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="visita">Visita</SelectItem>
                  <SelectItem value="reuniao">Reunião</SelectItem>
                  <SelectItem value="feira">Feira</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Assunto *</Label>
              <Input value={newInt.subject} onChange={e => setNewInt({ ...newInt, subject: e.target.value })}
                placeholder="Ex.: Apresentação do novo modelo I50" />
            </div>
            <div>
              <Label className="text-xs">Resultado</Label>
              <Select value={newInt.outcome || '__none__'} onValueChange={v => setNewInt({ ...newInt, outcome: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  <SelectItem value="positivo">Positivo</SelectItem>
                  <SelectItem value="negativo">Negativo</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                  <SelectItem value="agendado">Agendado retorno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Anotações</Label>
              <Textarea rows={3} value={newInt.notes} onChange={e => setNewInt({ ...newInt, notes: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5">
                <Bell className="h-3 w-3" />
                Agendar próximo contato (opcional)
              </Label>
              <Input
                type="datetime-local"
                value={newInt.scheduled_for}
                onChange={e => setNewInt({ ...newInt, scheduled_for: e.target.value })}
                min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Quando preenchido, vira agendamento (não é registrado como histórico)
                — você recebe alerta no sino 3 dias antes e atrasos.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={() => createInteraction.mutate()} disabled={createInteraction.isPending || !newInt.subject || (contactMode === 'client' ? !newInt.client_id : !newInt.external_contact_name.trim())}>
              {createInteraction.isPending
                ? 'Salvando...'
                : newInt.scheduled_for ? 'Agendar Contato' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatGrid>
        <StatCard
          label="Retornos hoje"
          value={todayCount}
          hint={overdueCount > 0 ? `${overdueCount} atrasado(s)` : 'agendados pra hoje'}
          tone={overdueCount > 0 ? 'destructive' : todayCount > 0 ? 'warning' : 'default'}
          icon={Bell}
        />
        <StatCard
          label="Interações 30d"
          value={interactions.length}
          hint="registradas"
        />
        <StatCard
          label="Inativos >90d"
          value={inactive.length}
          hint="sem pedido"
          tone="warning"
        />
        <StatCard
          label="NPS Score"
          value={npsScore}
          hint="últimas respostas"
          tone={npsScore >= 70 ? 'success' : npsScore >= 30 ? 'warning' : 'destructive'}
        />
      </StatGrid>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          <TabsTrigger value="scheduled" className="gap-1.5">
            <Bell className="h-3 w-3" />
            Agendados
            {scheduled.length > 0 && (
              <Badge variant={overdueCount > 0 ? 'destructive' : 'outline'} className="h-4 px-1 text-xs">
                {scheduled.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="interactions">Interações</TabsTrigger>
          <TabsTrigger value="inactive">Inativos</TabsTrigger>
          <TabsTrigger value="birthdays">Aniversariantes</TabsTrigger>
          <TabsTrigger value="repurchase">Recompra Prevista</TabsTrigger>
          <TabsTrigger value="nps">NPS</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled">
          <Panel flush>
            {scheduled.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="Nenhum contato agendado"
                description='Use "Nova Interação" e preencha "Agendar próximo contato" pra criar lembretes.'
              />
            ) : (
              <div className="divide-y">
                {scheduled.map((s: any) => {
                  const when = new Date(s.scheduled_for);
                  const isOverdue = when < today;
                  const isToday = when >= today && when < tomorrow;
                  const Icon = CHANNEL_ICONS[s.interaction_type] || Calendar;
                  return (
                    <div key={s.id} className="p-3 flex items-start gap-3 text-sm">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${
                        isOverdue ? 'text-destructive' : isToday ? 'text-warning' : 'text-primary'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{s.subject}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {s.clients?.razao_social || s.external_contact_name || '—'} · {format(when, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </p>
                        {s.notes && <p className="text-xs mt-1 text-muted-foreground">{s.notes}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge variant={isOverdue ? 'destructive' : isToday ? 'warning' : 'outline'} className="text-xs">
                          {isOverdue ? 'Atrasado' : isToday ? 'Hoje' : format(when, 'dd/MM')}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs gap-1"
                          onClick={() => completeInteraction.mutate(s.id)}
                          disabled={completeInteraction.isPending}
                        >
                          <CheckCircle className="h-3 w-3" />
                          Concluir
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="interactions">
          <Panel flush>
            {interactions.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="Sem interações registradas"
                description="Registre a primeira interação com um cliente."
              />
            ) : (
                <div className="divide-y">
                  {interactions.map((i: any) => {
                    const Icon = CHANNEL_ICONS[i.interaction_type] || Calendar;
                    return (
                      <div key={i.id} className="p-3 flex items-start gap-3 text-sm">
                        <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{i.subject}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {i.clients?.razao_social || i.external_contact_name || '—'} · {format(new Date(i.completed_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </p>
                          {i.notes && <p className="text-xs mt-1 text-muted-foreground">{i.notes}</p>}
                        </div>
                        {i.outcome && <Badge variant="outline" className="text-xs capitalize">{i.outcome}</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
          </Panel>
        </TabsContent>

        <TabsContent value="inactive">
          <Panel flush>
            {inactive.length === 0 ? (
              <EmptyState
                icon={AlertCircle}
                title="Nenhum cliente inativo >90 dias"
                description="Toda a carteira teve pedidos recentes."
              />
            ) : (
                <div className="divide-y">
                  {inactive.map((c: any) => (
                    <div key={c.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{c.razao_social}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.total_orders} {c.total_orders === 1 ? 'pedido' : 'pedidos'} · último em {c.last_order_date ? format(new Date(c.last_order_date), 'dd/MM/yyyy') : '—'}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {c.days_inactive ? `${c.days_inactive}d inativo` : 'Nunca pediu'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
          </Panel>
        </TabsContent>

        <TabsContent value="birthdays">
          <Panel flush>
            {birthdays.length === 0 ? (
              <EmptyState
                icon={Cake}
                title="Sem aniversariantes este mês"
              />
            ) : (
                <div className="divide-y">
                  {birthdays.map((b: any) => (
                    <div key={b.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <Cake className="h-4 w-4 text-pink-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{b.razao_social}</p>
                        {b.nome_fantasia && <p className="text-xs text-muted-foreground truncate">{b.nome_fantasia}</p>}
                      </div>
                      <Badge>Dia {b.day_of_month}</Badge>
                    </div>
                  ))}
                </div>
              )}
          </Panel>
        </TabsContent>

        <TabsContent value="repurchase">
          <Panel flush>
            {repurchase.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title="Sem dados de recompra"
                description="É necessário ≥ 2 pedidos por cliente para projetar o ciclo."
              />
            ) : (
                <div className="divide-y">
                  {repurchase.map((r: any) => (
                    <div key={r.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <Repeat className={`h-4 w-4 shrink-0 ${
                        r.days_until_expected <= 0 ? 'text-destructive' :
                        r.days_until_expected <= 14 ? 'text-warning' : 'text-success'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{r.razao_social}</p>
                        <p className="text-xs text-muted-foreground">
                          Ciclo médio {r.avg_cycle_days}d · esperado em {format(new Date(r.expected_repurchase_date), 'dd/MM/yyyy')}
                        </p>
                      </div>
                      <Badge variant={r.days_until_expected <= 0 ? 'destructive' : 'outline'}>
                        {r.days_until_expected <= 0 ? `${-r.days_until_expected}d atraso` : `em ${r.days_until_expected}d`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
          </Panel>
        </TabsContent>

        <TabsContent value="nps">
          <Panel flush>
            {nps.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="Nenhuma resposta NPS coletada ainda"
              />
            ) : (
                <div className="divide-y">
                  {nps.map((n: any) => (
                    <div key={n.id} className="p-3 flex items-center gap-3 text-sm">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        n.category === 'promotor' ? 'bg-success/10 text-success' :
                        n.category === 'neutro' ? 'bg-warning/10 text-warning' :
                        'bg-destructive/10 text-destructive'
                      }`}>{n.score}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{n.clients?.razao_social || '—'}</p>
                        {n.feedback && <p className="text-xs text-muted-foreground italic">"{n.feedback}"</p>}
                      </div>
                      <Badge variant="outline" className="capitalize">{n.category}</Badge>
                    </div>
                  ))}
                </div>
              )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
