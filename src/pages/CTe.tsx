import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Truck, Plus, CheckCircle, Trash as Trash2, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';

type CteStatus = 'rascunho' | 'autorizado' | 'rejeitado' | 'cancelado';

const STATUS_COLOR: Record<string, string> = {
  rascunho: 'bg-muted text-muted-foreground border-border',
  autorizado: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  rejeitado: 'bg-destructive/10 text-destructive border-destructive/30',
  cancelado: 'bg-amber-100 text-amber-700 border-amber-300',
};

const CTE_TYPES = [
  { value: 'normal',         label: 'Normal' },
  { value: 'complementar',   label: 'Complementar' },
  { value: 'anulacao',       label: 'Anulação' },
  { value: 'substituicao',   label: 'Substituição' },
];

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

type CteForm = {
  cte_number: string;
  cte_type: string;
  emission_date: string;
  origin_uf: string;
  destination_uf: string;
  origin_city: string;
  destination_city: string;
  transporter_name: string;
  transporter_cnpj: string;
  freight_value: number;
  freight_modality: string;
  related_nfe_chaves: string;
};

const emptyForm: CteForm = {
  cte_number: '',
  cte_type: 'normal',
  emission_date: format(new Date(), 'yyyy-MM-dd'),
  origin_uf: 'RJ',
  destination_uf: 'SP',
  origin_city: '',
  destination_city: '',
  transporter_name: '',
  transporter_cnpj: '',
  freight_value: 0,
  freight_modality: 'cif',
  related_nfe_chaves: '',
};

export default function CTe() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [authorizing, setAuthorizing] = useState<any | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['cte_emissions_list'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cte_emissions')
        .select('*')
        .order('emission_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('cte_emissions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cte_emissions_list'] }); toast.success('Rascunho excluído.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDelete = (id: string) => {
    if (!confirm('Apagar este rascunho de CT-e?')) return;
    del.mutate(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Truck className="h-7 w-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CT-e · Conhecimento de Transporte</h1>
            <p className="text-sm text-muted-foreground">
              Documento fiscal de frete contratado. Esta UI grava o rascunho;
              a autorização junto à SEFAZ é registrada manualmente após transmissão.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Novo CT-e
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Truck className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhum CT-e emitido</p>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>Criar primeiro rascunho</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold">{r.cte_number}</span>
                    <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLOR[r.status]}`}>
                      {r.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.cte_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.emission_date), 'dd/MM/yy')} · {r.origin_uf} → {r.destination_uf}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">{r.transporter_name || '—'}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Frete: R$ {Number(r.freight_value || 0).toFixed(2)} · {r.freight_modality?.toUpperCase()}
                    {r.protocol && ` · Protocolo: ${r.protocol}`}
                    {r.related_nfe_chaves?.length ? ` · ${r.related_nfe_chaves.length} NF-e(s) vinculada(s)` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.status === 'rascunho' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Editar</Button>
                      <Button size="sm" variant="default" className="gap-1" onClick={() => setAuthorizing(r)}>
                        <CheckCircle className="h-3.5 w-3.5" /> Autorizar
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CteEditorDialog
        open={creating || !!editing}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <AuthorizeDialog
        cte={authorizing}
        onClose={() => setAuthorizing(null)}
      />
    </div>
  );
}

function CteEditorDialog({
  open, editing, onClose,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const [form, setForm] = useState<CteForm>(() => {
    if (editing) {
      return {
        cte_number: editing.cte_number ?? '',
        cte_type: editing.cte_type ?? 'normal',
        emission_date: editing.emission_date ?? format(new Date(), 'yyyy-MM-dd'),
        origin_uf: editing.origin_uf ?? 'RJ',
        destination_uf: editing.destination_uf ?? 'SP',
        origin_city: editing.origin_city ?? '',
        destination_city: editing.destination_city ?? '',
        transporter_name: editing.transporter_name ?? '',
        transporter_cnpj: editing.transporter_cnpj ?? '',
        freight_value: Number(editing.freight_value ?? 0),
        freight_modality: editing.freight_modality ?? 'cif',
        related_nfe_chaves: (editing.related_nfe_chaves ?? []).join('\n'),
      };
    }
    return emptyForm;
  });

  const save = useMutation({
    mutationFn: async () => {
      const chaves = form.related_nfe_chaves
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const payload = {
        cte_number: form.cte_number.trim(),
        cte_type: form.cte_type,
        emission_date: form.emission_date,
        origin_uf: form.origin_uf,
        destination_uf: form.destination_uf,
        origin_city: form.origin_city.trim(),
        destination_city: form.destination_city.trim(),
        transporter_name: form.transporter_name.trim(),
        transporter_cnpj: form.transporter_cnpj.trim(),
        freight_value: form.freight_value,
        freight_modality: form.freight_modality,
        related_nfe_chaves: chaves,
      };
      if (isEdit) {
        const { error } = await (supabase as any).from('cte_emissions').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('cte_emissions').insert({ ...payload, status: 'rascunho' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cte_emissions_list'] });
      toast.success(isEdit ? 'CT-e atualizado.' : 'Rascunho criado.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = form.cte_number.trim().length > 0 && form.origin_uf && form.destination_uf;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> {isEdit ? `Editar CT-e ${editing?.cte_number}` : 'Novo CT-e (rascunho)'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-1">
            <Label>Nº do CT-e</Label>
            <Input value={form.cte_number} onChange={e => setForm({ ...form, cte_number: e.target.value })} placeholder="123456" />
          </div>
          <div className="col-span-1">
            <Label>Tipo</Label>
            <Select value={form.cte_type} onValueChange={v => setForm({ ...form, cte_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CTE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data emissão</Label>
            <Input type="date" value={form.emission_date} onChange={e => setForm({ ...form, emission_date: e.target.value })} />
          </div>
          <div>
            <Label>Modalidade do frete</Label>
            <Select value={form.freight_modality} onValueChange={v => setForm({ ...form, freight_modality: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cif">CIF (remetente paga)</SelectItem>
                <SelectItem value="fob">FOB (destinatário paga)</SelectItem>
                <SelectItem value="terceiros">Terceiros</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>UF origem</Label>
            <Select value={form.origin_uf} onValueChange={v => setForm({ ...form, origin_uf: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>UF destino</Label>
            <Select value={form.destination_uf} onValueChange={v => setForm({ ...form, destination_uf: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label>Cidade origem</Label>
            <Input value={form.origin_city} onChange={e => setForm({ ...form, origin_city: e.target.value })} placeholder="Belford Roxo" />
          </div>
          <div>
            <Label>Cidade destino</Label>
            <Input value={form.destination_city} onChange={e => setForm({ ...form, destination_city: e.target.value })} placeholder="São Paulo" />
          </div>

          <div>
            <Label>Transportadora</Label>
            <Input value={form.transporter_name} onChange={e => setForm({ ...form, transporter_name: e.target.value })} />
          </div>
          <div>
            <Label>CNPJ transportadora</Label>
            <Input value={form.transporter_cnpj} onChange={e => setForm({ ...form, transporter_cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
          </div>

          <div>
            <Label>Valor do frete (R$)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.freight_value}
              onChange={e => setForm({ ...form, freight_value: Number(e.target.value) })}
            />
          </div>
          <div />

          <div className="col-span-2">
            <Label>Chaves de NF-e vinculadas (uma por linha ou separadas por vírgula)</Label>
            <Textarea
              value={form.related_nfe_chaves}
              onChange={e => setForm({ ...form, related_nfe_chaves: e.target.value })}
              rows={3}
              className="font-mono text-xs"
              placeholder="3326..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!canSubmit || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? 'Salvar' : 'Criar rascunho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthorizeDialog({
  cte, onClose,
}: {
  cte: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [protocol, setProtocol] = useState('');
  const [chave, setChave] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      if (!cte) return;
      const { error } = await (supabase as any)
        .from('cte_emissions')
        .update({
          status: 'autorizado',
          protocol: protocol.trim(),
          cte_chave: chave.trim() || cte.cte_chave,
        })
        .eq('id', cte.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cte_emissions_list'] });
      toast.success('CT-e marcado como autorizado.');
      setProtocol(''); setChave('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!cte} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600">
            <CheckCircle className="h-4 w-4" /> Marcar CT-e como autorizado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            Cole o protocolo retornado pela SEFAZ. Use quando o CT-e foi
            transmitido em outro sistema e precisa ser registrado aqui.
          </p>
          <div>
            <Label>Protocolo SEFAZ</Label>
            <Input value={protocol} onChange={e => setProtocol(e.target.value)} className="font-mono" />
          </div>
          <div>
            <Label>Chave de acesso <span className="text-muted-foreground">(opcional)</span></Label>
            <Input value={chave} onChange={e => setChave(e.target.value)} className="font-mono" placeholder="44 dígitos" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button onClick={() => mut.mutate()} disabled={!protocol.trim() || mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
