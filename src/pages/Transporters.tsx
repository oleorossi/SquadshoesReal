import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Truck, Plus, PencilSimple as Edit2, Power, CircleNotch as Loader2, Phone, Envelope as Mail, MapPin } from '@phosphor-icons/react';
import { toast } from 'sonner';

const SERVICE_MODES = ['rodoviario', 'aereo', 'aquaviario', 'ferroviario', 'sedex', 'pac', 'fracionado', 'dedicado'];

type TransporterForm = {
  name: string;
  nome_fantasia: string;
  cnpj: string;
  ie: string;
  ie_isento: boolean;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  codigo_municipio: string;
  address_city: string;
  address_state: string;
  rntrc: string;
  service_modes: string[];
  delivery_areas: string;
  has_api_integration: boolean;
  notes: string;
  active: boolean;
};

const emptyForm: TransporterForm = {
  name: '',
  nome_fantasia: '',
  cnpj: '',
  ie: '',
  ie_isento: false,
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cep: '',
  codigo_municipio: '',
  address_city: '',
  address_state: 'RJ',
  rntrc: '',
  service_modes: ['rodoviario'],
  delivery_areas: '',
  has_api_integration: false,
  notes: '',
  active: true,
};

export default function Transporters() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['transporters'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('transporters')
        .select('*')
        .order('active', { ascending: false })
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await (supabase as any)
        .from('transporters')
        .update({ active: !t.active, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transporters'] }); toast.success('Atualizado.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Truck className="h-7 w-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Transportadoras</h1>
            <p className="text-sm text-muted-foreground">
              Cadastro de empresas de frete (rodoviário, sedex, dedicado) usadas em CT-e e expedição.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova Transportadora
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Truck className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhuma transportadora cadastrada</p>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>Cadastrar primeira</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((r: any) => (
            <Card key={r.id} className={r.active ? '' : 'opacity-60'}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{r.name}</p>
                    {r.cnpj && <p className="text-[11px] font-mono text-muted-foreground">{r.cnpj}</p>}
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${r.active ? 'border-emerald-500/30 text-emerald-700' : ''}`}>
                    {r.active ? 'ativa' : 'inativa'}
                  </Badge>
                </div>
                {(r.address_city || r.address_state) && (
                  <p className="text-xs flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {[r.address_city, r.address_state].filter(Boolean).join(', ')}
                  </p>
                )}
                {(r.service_modes ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(r.service_modes as string[]).map(m => (
                      <Badge key={m} variant="secondary" className="text-[10px] capitalize">{m}</Badge>
                    ))}
                  </div>
                )}
                {r.contact_name && (
                  <div className="text-[11px] space-y-0.5">
                    <p>{r.contact_name}</p>
                    {r.contact_phone && (
                      <p className="text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{r.contact_phone}</p>
                    )}
                    {r.contact_email && (
                      <p className="text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{r.contact_email}</p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(r)}>
                    <Edit2 className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(r)} title={r.active ? 'Desativar' : 'Reativar'}>
                    <Power className={`h-3.5 w-3.5 ${r.active ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TransporterDialog
        open={creating || !!editing}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />
    </div>
  );
}

function TransporterDialog({
  open, editing, onClose,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const [form, setForm] = useState<TransporterForm>(() => {
    if (editing) {
      return {
        name: editing.name ?? '',
        nome_fantasia: editing.nome_fantasia ?? '',
        cnpj: editing.cnpj ?? '',
        ie: editing.ie ?? '',
        ie_isento: editing.ie_isento ?? false,
        contact_name: editing.contact_name ?? '',
        contact_phone: editing.contact_phone ?? '',
        contact_email: editing.contact_email ?? '',
        endereco: editing.endereco ?? '',
        numero: editing.numero ?? '',
        complemento: editing.complemento ?? '',
        bairro: editing.bairro ?? '',
        cep: editing.cep ?? '',
        codigo_municipio: editing.codigo_municipio ?? '',
        address_city: editing.address_city ?? '',
        address_state: editing.address_state ?? 'RJ',
        rntrc: editing.rntrc ?? '',
        service_modes: editing.service_modes ?? [],
        delivery_areas: (editing.delivery_areas ?? []).join(', '),
        has_api_integration: editing.has_api_integration ?? false,
        notes: editing.notes ?? '',
        active: editing.active ?? true,
      };
    }
    return emptyForm;
  });

  const save = useMutation({
    mutationFn: async () => {
      const areas = form.delivery_areas.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      const payload = {
        ...form,
        delivery_areas: areas,
        updated_at: new Date().toISOString(),
      };
      if (isEdit) {
        const { error } = await (supabase as any).from('transporters').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('transporters').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transporters'] });
      toast.success(isEdit ? 'Atualizado.' : 'Cadastrada.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMode = (mode: string) => {
    setForm(prev => ({
      ...prev,
      service_modes: prev.service_modes.includes(mode)
        ? prev.service_modes.filter(m => m !== mode)
        : [...prev.service_modes, mode],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> {isEdit ? `Editar ${editing?.name}` : 'Nova Transportadora'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Razão social / Nome <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>CNPJ</Label>
            <Input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <Label>Nome fantasia</Label>
            <Input value={form.nome_fantasia} onChange={e => setForm({ ...form, nome_fantasia: e.target.value })} />
          </div>
          <div>
            <Label>Inscrição Estadual</Label>
            <Input value={form.ie} onChange={e => setForm({ ...form, ie: e.target.value, ie_isento: false })} disabled={form.ie_isento} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.ie_isento}
                onChange={e => setForm({ ...form, ie_isento: e.target.checked, ie: e.target.checked ? '' : form.ie })} />
              Isento de IE
            </label>
          </div>

          {/* ── Endereço completo (NF-e) ─────────────────────────────────── */}
          <div className="col-span-2 mt-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Endereço (NF-e — grupo X)
          </div>
          <div className="col-span-2">
            <Label>Logradouro</Label>
            <Input value={form.endereco} onChange={e => setForm({ ...form, endereco: e.target.value })} placeholder="Rua / Av / Estrada..." />
          </div>
          <div>
            <Label>Número</Label>
            <Input value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} placeholder="S/N" />
          </div>
          <div>
            <Label>Complemento</Label>
            <Input value={form.complemento} onChange={e => setForm({ ...form, complemento: e.target.value })} />
          </div>
          <div>
            <Label>Bairro</Label>
            <Input value={form.bairro} onChange={e => setForm({ ...form, bairro: e.target.value })} />
          </div>
          <div>
            <Label>CEP</Label>
            <Input value={form.cep} onChange={e => setForm({ ...form, cep: e.target.value.replace(/\D/g,'').slice(0,8) })} placeholder="00000000" />
          </div>
          <div>
            <Label>Cód. Município (IBGE)</Label>
            <Input value={form.codigo_municipio} onChange={e => setForm({ ...form, codigo_municipio: e.target.value.replace(/\D/g,'').slice(0,7) })} placeholder="7 dígitos" className="font-mono" />
          </div>
          <div>
            <Label>RNTRC (ANTT)</Label>
            <Input value={form.rntrc} onChange={e => setForm({ ...form, rntrc: e.target.value })} placeholder="opcional" className="font-mono" />
          </div>

          <div>
            <Label>Contato — nome</Label>
            <Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>E-mail</Label>
            <Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
          </div>

          <div>
            <Label>Cidade</Label>
            <Input value={form.address_city} onChange={e => setForm({ ...form, address_city: e.target.value })} />
          </div>
          <div>
            <Label>UF</Label>
            <Input value={form.address_state} onChange={e => setForm({ ...form, address_state: e.target.value.toUpperCase() })} maxLength={2} className="uppercase" />
          </div>

          <div className="col-span-2">
            <Label>Modais de serviço</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SERVICE_MODES.map(m => {
                const active = form.service_modes.includes(m);
                return (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => toggleMode(m)}
                    className="h-7 text-xs capitalize"
                  >
                    {m}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="col-span-2">
            <Label>Áreas de entrega <span className="text-muted-foreground">(UFs ou cidades, separadas por vírgula)</span></Label>
            <Input value={form.delivery_areas} onChange={e => setForm({ ...form, delivery_areas: e.target.value })} placeholder="RJ, SP, MG" />
          </div>

          <div className="col-span-2 flex items-center justify-between rounded-md border p-2.5">
            <div>
              <p className="text-sm font-medium">Integração API</p>
              <p className="text-[11px] text-muted-foreground">Ativar quando a transportadora oferece API de rastreamento/etiqueta</p>
            </div>
            <Switch checked={form.has_api_integration} onCheckedChange={v => setForm({ ...form, has_api_integration: v })} />
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>

          <div className="col-span-2 flex items-center justify-between rounded-md border p-2.5">
            <div>
              <p className="text-sm font-medium">Ativa</p>
              <p className="text-[11px] text-muted-foreground">Inativas continuam visíveis em registros antigos mas não aparecem na seleção</p>
            </div>
            <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? 'Salvar' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
