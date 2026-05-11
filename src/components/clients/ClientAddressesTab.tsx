import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MapPin, Plus, Loader2, Star, Edit2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

type AddressForm = {
  address_type: string;
  is_primary: boolean;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  ie: string;
  is_active: boolean;
  notes: string;
};

const emptyAddr: AddressForm = {
  address_type: 'entrega',
  is_primary: false,
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zip_code: '',
  ie: '',
  is_active: true,
  notes: '',
};

export default function ClientAddressesTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyAddr);
  const [showForm, setShowForm] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['client_addresses', clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('client_addresses')
        .select('*')
        .eq('client_id', clientId)
        .order('is_primary', { ascending: false })
        .order('address_type');
      if (error) throw error;
      return data || [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, client_id: clientId, updated_at: new Date().toISOString() };
      if (editing) {
        const { error } = await (supabase as any).from('client_addresses').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('client_addresses').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_addresses', clientId] });
      setShowForm(false); setEditing(null); setForm(emptyAddr);
      toast.success(editing ? 'Endereço atualizado.' : 'Endereço adicionado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('client_addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_addresses', clientId] });
      toast.success('Endereço removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (addr: any) => {
    setEditing(addr);
    setForm({
      address_type: addr.address_type ?? 'entrega',
      is_primary: addr.is_primary ?? false,
      street: addr.street ?? '',
      number: addr.number ?? '',
      complement: addr.complement ?? '',
      neighborhood: addr.neighborhood ?? '',
      city: addr.city ?? '',
      state: addr.state ?? '',
      zip_code: addr.zip_code ?? '',
      ie: addr.ie ?? '',
      is_active: addr.is_active ?? true,
      notes: addr.notes ?? '',
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-3">
      {showForm ? (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{editing ? 'Editar endereço' : 'Novo endereço'}</p>
              <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); setForm(emptyAddr); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Tipo</Label>
                <Select value={form.address_type} onValueChange={v => setForm({ ...form, address_type: v })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrega">Entrega</SelectItem>
                    <SelectItem value="cobranca">Cobrança</SelectItem>
                    <SelectItem value="fiscal">Fiscal</SelectItem>
                    <SelectItem value="filial">Filial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>CEP *</Label>
                <Input className="h-8" value={form.zip_code} onChange={e => setForm({ ...form, zip_code: e.target.value })} />
              </div>
              <div>
                <Label>UF *</Label>
                <Input className="h-8 uppercase" maxLength={2} value={form.state} onChange={e => setForm({ ...form, state: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label>Rua *</Label>
                <Input className="h-8" value={form.street} onChange={e => setForm({ ...form, street: e.target.value })} />
              </div>
              <div>
                <Label>Número</Label>
                <Input className="h-8" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Complemento</Label>
                <Input className="h-8" value={form.complement} onChange={e => setForm({ ...form, complement: e.target.value })} />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input className="h-8" value={form.neighborhood} onChange={e => setForm({ ...form, neighborhood: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Cidade *</Label>
                <Input className="h-8" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>IE</Label>
                <Input className="h-8" value={form.ie} onChange={e => setForm({ ...form, ie: e.target.value })} />
              </div>
              <div className="col-span-3">
                <Label>Observações</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={form.is_primary} onCheckedChange={v => setForm({ ...form, is_primary: v })} />
                Primário pra este tipo
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
                Ativo
              </label>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !form.street || !form.city || !form.state || !form.zip_code}
              >
                {save.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => { setForm(emptyAddr); setShowForm(true); }} className="w-full gap-1.5">
          <Plus className="h-4 w-4" /> Adicionar endereço
        </Button>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nenhum endereço adicional cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {items.map((a: any) => (
            <Card key={a.id} className={!a.is_active ? 'opacity-60' : ''}>
              <CardContent className="p-3 flex items-start gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] capitalize">{a.address_type}</Badge>
                    {a.is_primary && <Badge variant="default" className="text-[10px] gap-1"><Star className="h-2.5 w-2.5" /> primário</Badge>}
                    {!a.is_active && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
                  </div>
                  <p className="text-sm mt-1">
                    {[a.street, a.number].filter(Boolean).join(', ')}
                    {a.complement && ` — ${a.complement}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[a.neighborhood, a.city, a.state, a.zip_code].filter(Boolean).join(' · ')}
                    {a.ie && ` · IE ${a.ie}`}
                  </p>
                  {a.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{a.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(a)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                    if (!confirm('Apagar este endereço?')) return;
                    del.mutate(a.id);
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
