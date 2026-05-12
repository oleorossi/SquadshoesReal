import { useMemo, useState } from 'react';
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
import { FileText, Plus, CheckCircle, Trash2, Loader2, Lock, RotateCcw, Package } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSaleOrdersWeightBatch } from '@/hooks/useSaleOrderWeight';
import { IncompleteWeightWarning } from '@/components/weight/IncompleteWeightWarning';

type MdfeStatus = 'rascunho' | 'autorizado' | 'encerrado' | 'cancelado';

const STATUS_COLOR: Record<string, string> = {
  rascunho: 'bg-muted text-muted-foreground border-border',
  autorizado: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  encerrado: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  cancelado: 'bg-amber-100 text-amber-700 border-amber-300',
};

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

type MdfeForm = {
  mdfe_number: string;
  emission_date: string;
  modal: string;
  origin_uf: string;
  destination_uf: string;
  vehicle_plate: string;
  vehicle_renavam: string;
  driver_name: string;
  driver_cpf: string;
  total_pairs: number;
  total_value: number;
  total_weight_kg: number;
  notes: string;
  related_nfe_chaves: string;
};

const emptyForm: MdfeForm = {
  mdfe_number: '',
  emission_date: format(new Date(), 'yyyy-MM-dd'),
  modal: 'rodoviario',
  origin_uf: 'RJ',
  destination_uf: 'SP',
  vehicle_plate: '',
  vehicle_renavam: '',
  driver_name: '',
  driver_cpf: '',
  total_pairs: 0,
  total_value: 0,
  total_weight_kg: 0,
  notes: '',
  related_nfe_chaves: '',
};

export default function MDFe() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [authorizing, setAuthorizing] = useState<any | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['mdfe_emissions_list'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('mdfe_emissions')
        .select('*')
        .order('emission_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('mdfe_emissions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mdfe_emissions_list'] }); toast.success('Rascunho excluído.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('mdfe_emissions')
        .update({ status: 'encerrado', closed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mdfe_emissions_list'] }); toast.success('MDF-e encerrado.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileText className="h-7 w-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MDF-e · Manifesto Eletrônico</h1>
            <p className="text-sm text-muted-foreground">
              Documento fiscal pra transporte rodoviário com múltiplas NF-es / CT-es por viagem.
              Esta UI grava o rascunho e registra protocolo após emissão externa.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Novo MDF-e
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhum MDF-e emitido</p>
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
                    <span className="font-mono text-xs font-bold">{r.mdfe_number}</span>
                    <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLOR[r.status]}`}>
                      {r.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.modal}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.emission_date), 'dd/MM/yy')} · {r.origin_uf} → {r.destination_uf}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">
                    {r.driver_name || '—'}
                    {r.vehicle_plate && ` · 🚛 ${r.vehicle_plate}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.total_pairs} pares · R$ {Number(r.total_value || 0).toFixed(2)} · {Number(r.total_weight_kg || 0)} kg
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
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                        if (!confirm('Apagar este rascunho de MDF-e?')) return;
                        del.mutate(r.id);
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {r.status === 'autorizado' && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => {
                      if (!confirm('Encerrar este MDF-e? Ação não-reversível depois.')) return;
                      close.mutate(r.id);
                    }}>
                      <Lock className="h-3.5 w-3.5" /> Encerrar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MdfeEditorDialog
        open={creating || !!editing}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <AuthorizeDialog
        mdfe={authorizing}
        onClose={() => setAuthorizing(null)}
      />
    </div>
  );
}

function MdfeEditorDialog({
  open, editing, onClose,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const [form, setForm] = useState<MdfeForm>(() => {
    if (editing) {
      return {
        mdfe_number: editing.mdfe_number ?? '',
        emission_date: editing.emission_date ?? format(new Date(), 'yyyy-MM-dd'),
        modal: editing.modal ?? 'rodoviario',
        origin_uf: editing.origin_uf ?? 'RJ',
        destination_uf: editing.destination_uf ?? 'SP',
        vehicle_plate: editing.vehicle_plate ?? '',
        vehicle_renavam: editing.vehicle_renavam ?? '',
        driver_name: editing.driver_name ?? '',
        driver_cpf: editing.driver_cpf ?? '',
        total_pairs: Number(editing.total_pairs ?? 0),
        total_value: Number(editing.total_value ?? 0),
        total_weight_kg: Number(editing.total_weight_kg ?? 0),
        notes: editing.notes ?? '',
        related_nfe_chaves: (editing.related_nfe_chaves ?? []).join('\n'),
      };
    }
    return emptyForm;
  });

  // Parse chaves NF-e digitadas → resolve cada uma pra sale_order_id em
  // nfe_emitidas, e usa o batch hook pra somar peso/pares de todos os PVs.
  const parsedChaves = useMemo(
    () => form.related_nfe_chaves.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean),
    [form.related_nfe_chaves],
  );
  const { data: nfeRows = [] } = useQuery({
    queryKey: ['mdfe_nfe_chaves_resolution', parsedChaves],
    queryFn: async () => {
      if (parsedChaves.length === 0) return [];
      const { data } = await (supabase as any)
        .from('nfe_emitidas')
        .select('chave_acesso, sale_order_id')
        .in('chave_acesso', parsedChaves);
      return (data || []) as { chave_acesso: string; sale_order_id: string | null }[];
    },
    enabled: parsedChaves.length > 0,
  });
  const linkedSoIds = useMemo(
    () => Array.from(new Set(nfeRows.map(r => r.sale_order_id).filter((id): id is string => !!id))),
    [nfeRows],
  );
  const { data: weightsBatch = [] } = useSaleOrdersWeightBatch(linkedSoIds);
  const aggregated = useMemo(() => {
    const totalPairs = weightsBatch.reduce((s, w) => s + w.totalPairs, 0);
    const totalWeight = weightsBatch.reduce((s, w) => s + w.grossWeightKg, 0);
    const allIncomplete = weightsBatch.flatMap(w => w.incompleteItems);
    // NF-es que existem em nfe_emitidas mas têm sale_order_id NULL
    // (NF-es legadas/avulsas sem PV vinculado). Sem isso, peso some do
    // totalizador silenciosamente — operador pensa que somou, mas faltou.
    const chavesSemPv = nfeRows
      .filter((r) => !r.sale_order_id)
      .map((r) => r.chave_acesso);
    return {
      totalPairs,
      totalWeightKg: Math.round(totalWeight * 1000) / 1000,
      incompleteItems: allIncomplete,
      hasMissingChaves: parsedChaves.length > nfeRows.length,
      missingChaves: parsedChaves.filter(c => !nfeRows.some(r => r.chave_acesso === c)),
      chavesSemPv,
    };
  }, [weightsBatch, parsedChaves, nfeRows]);

  const applyAggregated = () => {
    setForm(f => ({ ...f, total_pairs: aggregated.totalPairs, total_weight_kg: aggregated.totalWeightKg }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const chaves = parsedChaves;
      const payload = {
        mdfe_number: form.mdfe_number.trim(),
        emission_date: form.emission_date,
        modal: form.modal,
        origin_uf: form.origin_uf,
        destination_uf: form.destination_uf,
        vehicle_plate: form.vehicle_plate.trim().toUpperCase(),
        vehicle_renavam: form.vehicle_renavam.trim(),
        driver_name: form.driver_name.trim(),
        driver_cpf: form.driver_cpf.trim(),
        total_pairs: form.total_pairs,
        total_value: form.total_value,
        total_weight_kg: form.total_weight_kg,
        notes: form.notes.trim(),
        related_nfe_chaves: chaves,
      };
      if (isEdit) {
        const { error } = await (supabase as any).from('mdfe_emissions').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('mdfe_emissions').insert({ ...payload, status: 'rascunho' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mdfe_emissions_list'] });
      toast.success(isEdit ? 'MDF-e atualizado.' : 'Rascunho criado.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = form.mdfe_number.trim().length > 0 && form.origin_uf && form.destination_uf;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> {isEdit ? `Editar MDF-e ${editing?.mdfe_number}` : 'Novo MDF-e (rascunho)'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <Label>Nº do MDF-e</Label>
            <Input value={form.mdfe_number} onChange={e => setForm({ ...form, mdfe_number: e.target.value })} placeholder="123456" />
          </div>
          <div>
            <Label>Modal</Label>
            <Select value={form.modal} onValueChange={v => setForm({ ...form, modal: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rodoviario">Rodoviário</SelectItem>
                <SelectItem value="aereo">Aéreo</SelectItem>
                <SelectItem value="aquaviario">Aquaviário</SelectItem>
                <SelectItem value="ferroviario">Ferroviário</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data emissão</Label>
            <Input type="date" value={form.emission_date} onChange={e => setForm({ ...form, emission_date: e.target.value })} />
          </div>
          <div />

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
            <Label>Placa do veículo</Label>
            <Input value={form.vehicle_plate} onChange={e => setForm({ ...form, vehicle_plate: e.target.value })} placeholder="RIO1A23" className="uppercase" />
          </div>
          <div>
            <Label>RENAVAM</Label>
            <Input value={form.vehicle_renavam} onChange={e => setForm({ ...form, vehicle_renavam: e.target.value })} />
          </div>

          <div>
            <Label>Motorista</Label>
            <Input value={form.driver_name} onChange={e => setForm({ ...form, driver_name: e.target.value })} />
          </div>
          <div>
            <Label>CPF motorista</Label>
            <Input value={form.driver_cpf} onChange={e => setForm({ ...form, driver_cpf: e.target.value })} placeholder="000.000.000-00" />
          </div>

          <div>
            <Label>
              Total de pares
              {form.total_pairs === aggregated.totalPairs && aggregated.totalPairs > 0 && (
                <span className="ml-1 text-[9px] text-primary uppercase font-bold">auto</span>
              )}
            </Label>
            <Input type="number" min={0} value={form.total_pairs} onChange={e => setForm({ ...form, total_pairs: +e.target.value })} />
          </div>
          <div>
            <Label>
              Peso (kg)
              {form.total_weight_kg === aggregated.totalWeightKg && aggregated.totalWeightKg > 0 && (
                <span className="ml-1 text-[9px] text-primary uppercase font-bold">auto</span>
              )}
            </Label>
            <Input type="number" step="0.001" min={0} value={form.total_weight_kg} onChange={e => setForm({ ...form, total_weight_kg: +e.target.value })} />
          </div>

          <div>
            <Label>Valor total (R$)</Label>
            <Input type="number" step="0.01" min={0} value={form.total_value} onChange={e => setForm({ ...form, total_value: +e.target.value })} />
          </div>
          <div />

          <div className="col-span-2">
            <Label>Chaves de NF-e vinculadas</Label>
            <Textarea
              value={form.related_nfe_chaves}
              onChange={e => setForm({ ...form, related_nfe_chaves: e.target.value })}
              rows={3}
              className="font-mono text-xs"
              placeholder="Uma chave por linha ou separadas por vírgula"
            />
            {parsedChaves.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 text-xs">
                  <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="flex-1">
                    {linkedSoIds.length} PV(s) resolvido(s) de {parsedChaves.length} chave(s) ·{' '}
                    <strong>{aggregated.totalPairs} pares</strong> ·{' '}
                    <strong>{aggregated.totalWeightKg.toFixed(3)} kg</strong>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={applyAggregated}
                    disabled={
                      linkedSoIds.length === 0 ||
                      (form.total_pairs === aggregated.totalPairs && form.total_weight_kg === aggregated.totalWeightKg)
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                    Aplicar
                  </Button>
                </div>
                {aggregated.hasMissingChaves && (
                  <div className="rounded-md border border-amber-300 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <strong>{aggregated.missingChaves.length}</strong> chave(s) não encontrada(s) em nfe_emitidas — ignoradas no cálculo.
                  </div>
                )}
                {aggregated.chavesSemPv.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <strong>{aggregated.chavesSemPv.length}</strong> NF-e(s) sem PV vinculado — peso não pôde ser somado. Vincule o PV em /nfe ou edite peso manualmente.
                  </div>
                )}
                {aggregated.incompleteItems.length > 0 && (
                  <IncompleteWeightWarning items={aggregated.incompleteItems} scope="nas NF-es vinculadas" />
                )}
              </div>
            )}
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2}
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
  mdfe, onClose,
}: {
  mdfe: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [protocol, setProtocol] = useState('');
  const [chave, setChave] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      if (!mdfe) return;
      const { error } = await (supabase as any)
        .from('mdfe_emissions')
        .update({
          status: 'autorizado',
          protocol: protocol.trim(),
          mdfe_chave: chave.trim() || mdfe.mdfe_chave,
        })
        .eq('id', mdfe.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mdfe_emissions_list'] });
      toast.success('MDF-e marcado como autorizado.');
      setProtocol(''); setChave('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!mdfe} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600">
            <CheckCircle className="h-4 w-4" /> Marcar MDF-e como autorizado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            Após transmissão à SEFAZ, cole o protocolo e a chave de acesso retornados.
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
