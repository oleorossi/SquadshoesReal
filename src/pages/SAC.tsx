import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, MessageSquare, AlertTriangle, Camera } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  aberto: 'bg-blue-100 text-blue-700 border-blue-300',
  em_analise: 'bg-amber-100 text-amber-700 border-amber-300',
  aprovado: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  rejeitado: 'bg-destructive/10 text-destructive border-destructive/30',
  aguarda_coleta: 'bg-purple-100 text-purple-700 border-purple-300',
  recebido: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  resolvido: 'bg-slate-100 text-slate-700 border-slate-300',
  cancelado: 'bg-muted text-muted-foreground border-border',
};

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
      toast.success('Status atualizado');
    },
  });

  const counts = {
    abertos: tickets.filter((t: any) => ['aberto', 'em_analise'].includes(t.status)).length,
    aguardando: tickets.filter((t: any) => ['aprovado', 'aguarda_coleta', 'recebido'].includes(t.status)).length,
    resolvidos: tickets.filter((t: any) => t.status === 'resolvido').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SAC · Troca · Garantia</h1>
          <p className="text-sm text-muted-foreground">Workflow de atendimento pós-venda</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> Novo Atendimento
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3"><p className="text-[10px] font-bold text-muted-foreground uppercase">Abertos</p><p className="text-2xl font-bold text-amber-600">{counts.abertos}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-bold text-muted-foreground uppercase">Aguardando</p><p className="text-2xl font-bold text-blue-600">{counts.aguardando}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-bold text-muted-foreground uppercase">Resolvidos</p><p className="text-2xl font-bold text-emerald-600">{counts.resolvidos}</p></CardContent></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['todos', 'aberto', 'em_analise', 'aprovado', 'aguarda_coleta', 'recebido', 'resolvido'].map(s => (
          <Button
            key={s}
            variant={filterStatus === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStatus(s)}
            className="capitalize h-7 text-xs"
          >
            {s.replace('_', ' ')}
          </Button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : tickets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhum atendimento {filterStatus !== 'todos' ? `com status "${filterStatus}"` : ''}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t: any) => (
            <Card key={t.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold">{t.ticket_number}</span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[t.status]}`}>
                        {t.status.replace('_', ' ')}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">{t.ticket_type}</Badge>
                      {t.defect_category && (
                        <Badge variant="outline" className="text-[10px] capitalize">{t.defect_category}</Badge>
                      )}
                    </div>
                    <p className="text-sm font-semibold">{t.clients?.razao_social || '—'}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {t.technical_sheets?.name && (
                        <span>{t.technical_sheets.code} · {t.technical_sheets.name}</span>
                      )}
                      {t.color && <span>· {t.color}</span>}
                      {t.size && <span>· tam {t.size}</span>}
                      <span>· {format(new Date(t.opened_at), 'dd/MM HH:mm', { locale: ptBR })}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {t.status === 'aberto' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => updateStatus.mutate({ id: t.id, newStatus: 'em_analise' })}>
                        Analisar
                      </Button>
                    )}
                    {t.status === 'em_analise' && (
                      <>
                        <Button size="sm" variant="default" className="h-7 text-xs"
                          onClick={() => updateStatus.mutate({ id: t.id, newStatus: 'aprovado' })}>
                          Aprovar
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => updateStatus.mutate({ id: t.id, newStatus: 'rejeitado' })}>
                          Rejeitar
                        </Button>
                      </>
                    )}
                    {['aprovado', 'aguarda_coleta', 'recebido'].includes(t.status) && (
                      <Button size="sm" variant="default" className="h-7 text-xs"
                        onClick={() => updateStatus.mutate({ id: t.id, newStatus: 'resolvido' })}>
                        Resolver
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewSACDialog open={showNew} onOpenChange={setShowNew} />
    </div>
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
