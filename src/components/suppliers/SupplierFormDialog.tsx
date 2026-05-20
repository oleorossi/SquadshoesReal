import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Supplier } from '@/hooks/useSuppliers';

const STATES = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Supplier | null;
  onSubmit: (data: Partial<Supplier>) => void;
};

const empty = {
  name: '', trade_name: '', cnpj: '', ie: '', contact_name: '', phone: '', email: '',
  address: '', city: '', state: '', zip_code: '', payment_terms: '', lead_time_days: 10,
  notes: '', active: true, is_own_manufacturing: false,
};

export default function SupplierFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name || '', trade_name: editing.trade_name || '', cnpj: editing.cnpj || '',
        ie: editing.ie || '', contact_name: editing.contact_name || '', phone: editing.phone || '',
        email: editing.email || '', address: editing.address || '', city: editing.city || '',
        state: editing.state || '', zip_code: editing.zip_code || '', payment_terms: editing.payment_terms || '',
        lead_time_days: editing.lead_time_days || 0, notes: editing.notes || '', active: editing.active ?? true,
        is_own_manufacturing: editing.is_own_manufacturing ?? false,
      });
    } else setForm(empty);
  }, [editing, open]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(form); onOpenChange(false); };
  const set = (k: string, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Fornecedor' : 'Novo Fornecedor'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Identificação</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label>Razão Social *</Label>
                <Input value={form.name} onChange={e => set('name', e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label>Nome Fantasia</Label>
                <Input value={form.trade_name} onChange={e => set('trade_name', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input value={form.cnpj} onChange={e => set('cnpj', e.target.value)} className="mt-1" placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label>Inscrição Estadual</Label>
                <Input value={form.ie} onChange={e => set('ie', e.target.value)} className="mt-1" />
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch checked={form.active} onCheckedChange={v => set('active', v)} />
                <Label>Fornecedor Ativo</Label>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch checked={form.is_own_manufacturing} onCheckedChange={v => {
                  set('is_own_manufacturing', v);
                  if (v) set('payment_terms', '');
                }} />
                <Label>Fabricação Própria</Label>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Contato</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>Contato</Label><Input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className="mt-1" /></div>
              <div><Label>Telefone</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} className="mt-1" placeholder="(00) 00000-0000" /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="mt-1" /></div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Endereço</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><Label>Endereço</Label><Input value={form.address} onChange={e => set('address', e.target.value)} className="mt-1" /></div>
              <div><Label>Cidade</Label><Input value={form.city} onChange={e => set('city', e.target.value)} className="mt-1" /></div>
              <div>
                <Label>UF</Label>
                <Select value={form.state} onValueChange={v => set('state', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>{STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>CEP</Label><Input value={form.zip_code} onChange={e => set('zip_code', e.target.value)} className="mt-1" placeholder="00000-000" /></div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Condições Comerciais</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!form.is_own_manufacturing && (
                <div><Label>Condição de Pagamento</Label><Input value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} className="mt-1" placeholder="Ex: 30/60/90 DDL" /></div>
              )}
              <div>
                <Label>Prazo de Entrega (dias)</Label>
                <Input type="number" min={0} value={form.lead_time_days} onChange={e => set('lead_time_days', Number(e.target.value))} className="mt-1" placeholder="10" />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Quando preenchido (&gt; 0), todos os materiais deste fornecedor usam este prazo automaticamente — sem precisar configurar item por item.
                </p>
              </div>
            </div>
          </div>

          <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1" rows={2} /></div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">{editing ? 'Salvar' : 'Cadastrar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
