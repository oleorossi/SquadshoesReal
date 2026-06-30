import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ChatText as MessageSquare, ClockCounterClockwise as History, CaretDown as ChevronDown, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

const STATUS_COLORS: Record<string, string> = {
  // Trio semântico via tokens (dark-mode safe, consistente com rejeitado→destructive)
  em_analise: 'bg-warning/10 text-warning border-warning/30',
  aprovado: 'bg-success/10 text-success border-success/30',
  rejeitado: 'bg-destructive/10 text-destructive border-destructive/30',
  // Hues categóricos: padrão alpha endossado (bg-*-500/10 text-*-600), não os tints sólidos -100/-700 que quebram dark mode
  aberto: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  aguarda_coleta: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  recebido: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  resolvido: 'bg-muted text-foreground border-border',
  cancelado: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABELS: Record<string, string> = {
  todos: 'Todos',
  aberto: 'Aberto',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  aguarda_coleta: 'Aguarda Coleta',
  recebido: 'Recebido',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
};

const statusLabel = (s: string) => STATUS_LABELS[s] ?? s.replace(/_/g, ' ');

export default function SAC() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('todos');
  const [showNew, setShowNew] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['sac_tickets', filterStatus],
    queryFn: async () => {
      let q = (supabase as any)
        .from('sac_tickets')
        .select('*, clients(razao_social), technical_sheets(name, code)')
        .order('opened_at', { ascending: false });
      if (filterStatus !== 'todos') q = q.eq('status', filterStatus);
      const { data } = await q;
      return data || [];
    },
  });

  // KPIs precisam refletir o universo completo, não o subset filtrado.
  const { data: countsRaw = [] } = useQuery({
    queryKey: ['sac_tickets_counts'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sac_tickets')
        .select('status');
      return data || [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const { error } = await (supabase as any)
        .from('sac_tickets')
        .update({
          status: newStatus,
          ...(newStatus === 'resolvido' ? { resolved_at: new Date().toISOString() } : {}),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sac_tickets'] });
      qc.invalidateQueries({ queryKey: ['sac_tickets_counts'] });
      toast.success('Status atualizado');
    },
  });

  const counts = {
    abertos: countsRaw.filter((t: any) => ['aberto', 'em_analise'].includes(t.status)).length,
    aguardando: countsRaw.filter((t: any) => ['aprovado', 'aguarda_coleta', 'recebido'].includes(t.status)).length,
    resolvidos: countsRaw.filter((t: any) => t.status === 'resolvido').length,
  };

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · SAC"
        title="SAC · Troca · Garantia"
        description="Workflow de atendimento pós-venda"
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Novo Atendimento
          </Button>
        }
      />

      <StatGrid>
        <StatCard label="Abertos" value={counts.abertos} hint="aguardando análise" tone="warning" />
        <StatCard label="Aguardando" value={counts.aguardando} hint="em andamento" tone="primary" />
        <StatCard label="Resolvidos" value={counts.resolvidos} hint="concluídos" tone="success" />
      </StatGrid>

      <div className="flex gap-2 flex-wrap">
        {['todos', 'aberto', 'em_analise', 'aprovado', 'aguarda_coleta', 'recebido', 'resolvido'].map(s => (
          <Button
            key={s}
            variant={filterStatus === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStatus(s)}
            className="h-7 text-xs"
          >
            {statusLabel(s)}
          </Button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : tickets.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={MessageSquare}
            title="Nenhum atendimento"
            description={filterStatus !== 'todos' ? `Nenhum atendimento com status "${statusLabel(filterStatus)}".` : 'Nenhum atendimento pós-venda registrado.'}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {tickets.map((t: any) => (
            <TicketCard key={t.id} t={t} onStatusChange={(newStatus) => updateStatus.mutate({ id: t.id, newStatus })} />
          ))}
        </div>
      )}

      <NewSACDialog open={showNew} onOpenChange={setShowNew} />
    </div>
  );
}

function TicketCard({ t, onStatusChange }: { t: any; onStatusChange: (newStatus: string) => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: history = [] } = useQuery({
    queryKey: ['sac_history', t.id],
    enabled: historyOpen,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sac_ticket_history')
        .select('*, profiles:changed_by(full_name)')
        .eq('ticket_id', t.id)
        .order('changed_at', { ascending: false });
      return data || [];
    },
  });

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold">{t.ticket_number}</span>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status]}`}>
                {statusLabel(t.status)}
              </Badge>
              <Badge variant="outline" className="text-xs capitalize">{t.ticket_type}</Badge>
              {t.defect_category && (
                <Badge variant="outline" className="text-xs capitalize">{t.defect_category}</Badge>
              )}
            </div>
            <p className="text-sm font-semibold">{t.clients?.razao_social || '—'}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {t.technical_sheets?.name && (
                <span>{t.technical_sheets.code} · {t.technical_sheets.name}</span>
              )}
              {t.color && <span>· {t.color}</span>}
              {t.size && <span>· tam {t.size}</span>}
              <span>· {format(new Date(t.opened_at), 'dd/MM HH:mm', { locale: ptBR })}</span>
              <button
                onClick={() => setHistoryOpen(o => !o)}
                className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
              >
                {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <History className="h-3 w-3" /> Histórico
              </button>
            </div>

            {historyOpen && (
              <div className="mt-2 ml-2 pl-3 border-l-2 border-muted space-y-1.5">
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Sem alterações registradas além da criação.</p>
                ) : (
                  history.map((h: any) => (
                    <div key={h.id} className="text-xs">
                      <p className="flex items-center gap-1 flex-wrap">
                        <span className="text-muted-foreground">
                          {format(new Date(h.changed_at), 'dd/MM HH:mm', { locale: ptBR })}
                        </span>
                        {h.from_status && (
                          <Badge variant="outline" className="text-xs py-0 px-1">
                            {statusLabel(h.from_status)}
                          </Badge>
                        )}
                        <span className="text-muted-foreground">→</span>
                        <Badge variant="outline" className={`text-xs py-0 px-1 ${STATUS_COLORS[h.to_status]}`}>
                          {statusLabel(h.to_status)}
                        </Badge>
                        {h.profiles?.full_name && (
                          <span className="text-muted-foreground">· por {h.profiles.full_name}</span>
                        )}
                      </p>
                      {h.note && (
                        <p className="text-muted-foreground ml-3 mt-0.5">{h.note}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {t.status === 'aberto' && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => onStatusChange('em_analise')}>
                Analisar
              </Button>
            )}
            {t.status === 'em_analise' && (
              <>
                <Button size="sm" variant="default" className="h-7 text-xs"
                  onClick={() => onStatusChange('aprovado')}>
                  Aprovar
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => onStatusChange('rejeitado')}>
                  Rejeitar
                </Button>
              </>
            )}
            {['aprovado', 'aguarda_coleta', 'recebido'].includes(t.status) && (
              <Button size="sm" variant="default" className="h-7 text-xs"
                onClick={() => onStatusChange('resolvido')}>
                Resolver
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NewSACDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    client_id: '',
    ticket_type: 'reclamacao',
    description: '',
    defect_category: '',
    pairs_affected: 1,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_for_sac'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('clients').select('id, razao_social').eq('active', true).limit(500);
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('sac_tickets').insert({
        client_id: form.client_id || null,
        ticket_type: form.ticket_type,
        description: form.description,
        defect_category: form.defect_category || null,
        pairs_affected: form.pairs_affected,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sac_tickets'] });
      onOpenChange(false);
      toast.success('Atendimento criado');
      setForm({ client_id: '', ticket_type: 'reclamacao', description: '', defect_category: '', pairs_affected: 1 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Novo Atendimento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase">Cliente</label>
            <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}
              className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="">Selecione...</option>
              {clients.map((c: any) => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase">Tipo</label>
            <select value={form.ticket_type} onChange={e => setForm({ ...form, ticket_type: e.target.value })}
              className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="reclamacao">Reclamação</option>
              <option value="troca">Troca</option>
              <option value="garantia">Garantia</option>
              <option value="sugestao">Sugestão</option>
              <option value="duvida">Dúvida</option>
              <option value="elogio">Elogio</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase">Categoria do defeito (opcional)</label>
            <select value={form.defect_category} onChange={e => setForm({ ...form, defect_category: e.target.value })}
              className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="">N/A</option>
              <option value="costura">Costura</option>
              <option value="solagem">Solagem</option>
              <option value="colagem">Colagem</option>
              <option value="material">Material</option>
              <option value="cor">Cor</option>
              <option value="numeracao">Numeração</option>
              <option value="embalagem">Embalagem</option>
              <option value="transporte">Transporte</option>
              <option value="uso">Uso indevido</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase">Pares afetados</label>
            <Input type="number" min="1" value={form.pairs_affected}
              onChange={e => setForm({ ...form, pairs_affected: Math.max(1, +e.target.value) })} />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase">Descrição *</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full mt-1 min-h-[80px] px-3 py-2 rounded-md border border-input bg-background text-sm"
              placeholder="Descreva o problema..." />
          </div>
          <Button className="w-full" onClick={() => create.mutate()} disabled={!form.description || create.isPending}>
            {create.isPending ? 'Criando...' : 'Criar Atendimento'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
