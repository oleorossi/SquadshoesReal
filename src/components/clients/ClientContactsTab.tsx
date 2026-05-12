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
import { User, Plus, CircleNotch as Loader2, Star, PencilSimple as Edit2, Trash as Trash2, X, Envelope as Mail, Phone, ChatCircle as MessageCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';

type ContactForm = {
  name: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
  receives_nfe: boolean;
  receives_boleto: boolean;
  is_primary: boolean;
  notes: string;
};

const emptyContact: ContactForm = {
  name: '',
  role: 'comprador',
  email: '',
  phone: '',
  whatsapp: '',
  receives_nfe: false,
  receives_boleto: false,
  is_primary: false,
  notes: '',
};

export default function ClientContactsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyContact);
  const [showForm, setShowForm] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['client_contacts', clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('client_contacts')
        .select('*')
        .eq('client_id', clientId)
        .order('is_primary', { ascending: false })
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, client_id: clientId };
      if (editing) {
        const { error } = await (supabase as any).from('client_contacts').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('client_contacts').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_contacts', clientId] });
      setShowForm(false); setEditing(null); setForm(emptyContact);
      toast.success(editing ? 'Contato atualizado.' : 'Contato adicionado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('client_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_contacts', clientId] });
      toast.success('Contato removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      name: c.name ?? '',
      role: c.role ?? 'comprador',
      email: c.email ?? '',
      phone: c.phone ?? '',
      whatsapp: c.whatsapp ?? '',
      receives_nfe: c.receives_nfe ?? false,
      receives_boleto: c.receives_boleto ?? false,
      is_primary: c.is_primary ?? false,
      notes: c.notes ?? '',
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-3">
      {showForm ? (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{editing ? 'Editar contato' : 'Novo contato'}</p>
              <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); setForm(emptyContact); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label>Nome *</Label>
                <Input className="h-8" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Função</Label>
                <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comprador">Comprador</SelectItem>
                    <SelectItem value="financeiro">Financeiro</SelectItem>
                    <SelectItem value="fiscal">Fiscal</SelectItem>
                    <SelectItem value="logistica">Logística</SelectItem>
                    <SelectItem value="diretor">Diretor</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Label>E-mail</Label>
                <Input className="h-8" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input className="h-8" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input className="h-8" value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} />
              </div>
              <div className="col-span-3">
                <Label>Observações</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="flex items-center justify-between rounded border p-2">
                <span>NF-e</span>
                <Switch checked={form.receives_nfe} onCheckedChange={v => setForm({ ...form, receives_nfe: v })} />
              </label>
              <label className="flex items-center justify-between rounded border p-2">
                <span>Boleto</span>
                <Switch checked={form.receives_boleto} onCheckedChange={v => setForm({ ...form, receives_boleto: v })} />
              </label>
              <label className="flex items-center justify-between rounded border p-2">
                <span>Primário</span>
                <Switch checked={form.is_primary} onCheckedChange={v => setForm({ ...form, is_primary: v })} />
              </label>
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
                {save.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => { setForm(emptyContact); setShowForm(true); }} className="w-full gap-1.5">
          <Plus className="h-4 w-4" /> Adicionar contato
        </Button>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nenhum contato cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {items.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="p-3 flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{c.name}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">{c.role}</Badge>
                    {c.is_primary && <Badge variant="default" className="text-[10px] gap-1"><Star className="h-2.5 w-2.5" /> primário</Badge>}
                    {c.receives_nfe && <Badge variant="secondary" className="text-[10px]">NF-e</Badge>}
                    {c.receives_boleto && <Badge variant="secondary" className="text-[10px]">Boleto</Badge>}
                  </div>
                  <div className="text-xs space-y-0.5 mt-1 text-muted-foreground">
                    {c.email && <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</p>}
                    {c.phone && <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</p>}
                    {c.whatsapp && <p className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{c.whatsapp}</p>}
                  </div>
                  {c.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{c.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                    if (!confirm('Apagar este contato?')) return;
                    del.mutate(c.id);
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
