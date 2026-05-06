import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Search, Loader2, Check } from 'lucide-react';
import { useSuppliers, type Supplier } from '@/hooks/useSuppliers';
import type { GroupSupplier } from '@/hooks/useGroupSuppliers';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: GroupSupplier | null;
  onSubmit: (data: Partial<GroupSupplier>) => void;
};

const emptyForm = {
  supplier_name: '',
  supplier_cnpj: '',
  supplier_contact: '',
  supplier_phone: '',
  supplier_email: '',
  supplier_address: '',
  payment_terms: '',
  lead_time_days: 0,
  notes: '',
  min_free_shipping: 0,
  standard_shipping_cost: 0,
};

export default function SupplierFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: suppliers = [], isLoading: loadingSuppliers } = useSuppliers();

  useEffect(() => {
    if (editing) {
      setForm({
        supplier_name: editing.supplier_name || '',
        supplier_cnpj: editing.supplier_cnpj || '',
        supplier_contact: editing.supplier_contact || '',
        supplier_phone: editing.supplier_phone || '',
        supplier_email: editing.supplier_email || '',
        supplier_address: editing.supplier_address || '',
        payment_terms: editing.payment_terms || '',
        lead_time_days: editing.lead_time_days || 0,
        notes: editing.notes || '',
        min_free_shipping: (editing as any).min_free_shipping || 0,
        standard_shipping_cost: (editing as any).standard_shipping_cost || 0,
      });
    } else {
      setForm(emptyForm);
    }
  }, [editing, open]);

  const handleSelectSupplier = (supplier: Supplier) => {
    setForm({
      supplier_name: supplier.name || supplier.trade_name || '',
      supplier_cnpj: supplier.cnpj || '',
      supplier_contact: supplier.contact_name || '',
      supplier_phone: supplier.phone || '',
      supplier_email: supplier.email || '',
      supplier_address: [supplier.address, supplier.city, supplier.state].filter(Boolean).join(', '),
      payment_terms: supplier.payment_terms || '',
      lead_time_days: supplier.lead_time_days || 0,
      notes: supplier.notes || '',
      min_free_shipping: 0,
      standard_shipping_cost: 0,
    });
    setSearchOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
    onOpenChange(false);
  };

  const set = (key: string, val: string | number) => setForm(f => ({ ...f, [key]: val }));

  const activeSuppliers = suppliers.filter(s => s.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Fornecedor' : 'Novo Fornecedor'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Razão Social / Nome</Label>
              <div className="flex gap-2 mt-1">
                <Input 
                  value={form.supplier_name} 
                  onChange={e => set('supplier_name', e.target.value)} 
                  required 
                  placeholder="Nome do fornecedor"
                  className="flex-1"
                />
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="icon"
                      className="shrink-0"
                      title="Buscar fornecedor cadastrado"
                    >
                      {loadingSuppliers ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Buscar por nome ou CNPJ..." />
                      <CommandList>
                        <CommandEmpty>Nenhum fornecedor encontrado</CommandEmpty>
                        <CommandGroup heading="Fornecedores cadastrados">
                          {activeSuppliers.map(supplier => (
                            <CommandItem
                              key={supplier.id}
                              value={`${supplier.name} ${supplier.cnpj}`}
                              onSelect={() => handleSelectSupplier(supplier)}
                              className="flex flex-col items-start gap-0.5"
                            >
                              <div className="flex items-center gap-2 w-full">
                                <Check className={cn(
                                  "h-4 w-4 shrink-0",
                                  form.supplier_cnpj === supplier.cnpj ? "opacity-100" : "opacity-0"
                                )} />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{supplier.name}</p>
                                  {supplier.cnpj && (
                                    <p className="text-xs text-muted-foreground">{supplier.cnpj}</p>
                                  )}
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Clique na lupa para buscar um fornecedor já cadastrado
              </p>
            </div>
            <div>
              <Label>CNPJ</Label>
              <Input value={form.supplier_cnpj} onChange={e => set('supplier_cnpj', e.target.value)} className="mt-1" placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <Label>Contato</Label>
              <Input value={form.supplier_contact} onChange={e => set('supplier_contact', e.target.value)} className="mt-1" placeholder="Nome do contato" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.supplier_phone} onChange={e => set('supplier_phone', e.target.value)} className="mt-1" placeholder="(00) 00000-0000" />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={form.supplier_email} onChange={e => set('supplier_email', e.target.value)} className="mt-1" placeholder="email@fornecedor.com" />
            </div>
            <div className="sm:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.supplier_address} onChange={e => set('supplier_address', e.target.value)} className="mt-1" placeholder="Endereço completo" />
            </div>
            <div>
              <Label>Condição de Pagamento</Label>
              <Input value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} className="mt-1" placeholder="Ex: 30/60/90 dias" />
            </div>
            <div>
              <Label>Prazo de Entrega (dias)</Label>
              <Input type="number" min={0} value={form.lead_time_days} onChange={e => set('lead_time_days', Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
            <Label className="text-sm font-semibold">Condições de Frete & Logística</Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Mínimo para Frete Grátis (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.min_free_shipping || ''}
                  onChange={e => set('min_free_shipping', Number(e.target.value))}
                  className="mt-1"
                  placeholder="Ex: 1500.00"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Custo Padrão do Frete (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.standard_shipping_cost || ''}
                  onChange={e => set('standard_shipping_cost', Number(e.target.value))}
                  className="mt-1"
                  placeholder="Ex: 80.00"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1" rows={2} placeholder="Notas sobre o fornecedor" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">{editing ? 'Salvar' : 'Adicionar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
