 import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Loader2, User, Truck, ClipboardList, Info, Percent, ChevronsUpDown, Check, History, AlertTriangle, CheckCircle2, Calculator, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SaleOrderFormData, SaleOrderItemFormData, PACKAGING_MODE_LABELS, type PackagingMode } from '@/hooks/useSaleOrders';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import SaleOrderItemForm from './SaleOrderItemForm';
import { OrderStatusStepper } from '@/components/ui/order-status-stepper';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { useFactoringConfigs } from '@/components/finance/FactoringTab';
import { useAllActiveReferenceMaterialVariants } from '@/hooks/useReferenceMaterialVariants';
import {
  calculateFactoringDiscount,
  parsePaymentConditionInstallments,
} from '@/lib/factoringCalc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
 import { cn } from '@/lib/utils';
 import { toast } from 'sonner';
 import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
 } from "@/components/ui/alert-dialog";


interface Client {
  id: string;
  razao_social: string;
  cnpj?: string | null;
  contato?: string | null;
  active: boolean;
  client_number?: string | null;
  credit_limit?: number | null;
}

interface Representative {
  id: string;
  name: string;
  email: string;
  phone: string;
  commission_pct: number;
  active: boolean;
}

interface Props {
  form: SaleOrderFormData;
  setForm: (fn: (f: SaleOrderFormData) => SaleOrderFormData) => void;
  items: SaleOrderItemFormData[];
  setItems: (fn: (prev: SaleOrderItemFormData[]) => SaleOrderItemFormData[]) => void;
  clients: Client[];
  representatives: Representative[];
  references: any[];
  isAdmin: boolean;
  selectedClientId: string;
  onClientSelect: (clientId: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
  packagingProductId?: string;
  onPackagingProductChange?: (id: string) => void;
  packagingQuantity?: number;
  onPackagingQuantityChange?: (qty: number) => void;
  onSaveStateAndNavigate?: () => void;
}

const emptyItem: SaleOrderItemFormData = {
  reference_id: '', color: '', grade: {}, unit_price: 0, quantity: 0, fichas: 1,
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function SearchableClientSelect({ clients, value, onSelect }: {
  clients: { id: string; razao_social: string; cnpj?: string | null; client_number?: string | null }[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = clients.find(c => c.id === value);
  const label = selected
    ? `${selected.client_number ? `#${selected.client_number} — ` : ''}${selected.razao_social}`
    : 'Buscar cliente...';

  // Fetch recent customers from latest sale orders
  const { data: recentClientNames = [] } = useQuery({
    queryKey: ['recent_sale_order_clients'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_orders')
        .select('client_name')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!data) return [];
      const unique = [...new Set(data.map(d => d.client_name).filter(Boolean))];
      return unique.slice(0, 5);
    },
    staleTime: 60_000,
  });

  const recentClients = useMemo(() => {
    return recentClientNames
      .map(name => clients.find(c => c.razao_social === name))
      .filter(Boolean) as typeof clients;
  }, [recentClientNames, clients]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-9 w-full justify-between font-normal text-left">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por nome, CNPJ ou código..." />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            {recentClients.length > 0 && (
              <CommandGroup heading="Recentes">
                {recentClients.map(c => {
                  const display = `${c.client_number ? `#${c.client_number} — ` : ''}${c.razao_social}`;
                  return (
                    <CommandItem
                      key={`recent-${c.id}`}
                      value={`${display} ${c.cnpj || ''}`}
                      onSelect={() => { onSelect(c.id); setOpen(false); }}
                    >
                      <History className="mr-2 h-3 w-3 text-muted-foreground" />
                      <Check className={cn('mr-2 h-3.5 w-3.5', value === c.id ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{display}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading={recentClients.length > 0 ? 'Todos os Clientes' : undefined}>
              {clients.map(c => {
                const display = `${c.client_number ? `#${c.client_number} — ` : ''}${c.razao_social} ${c.cnpj ? `(${c.cnpj})` : ''}`;
                return (
                  <CommandItem
                    key={c.id}
                    value={display}
                    onSelect={() => { onSelect(c.id); setOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-3.5 w-3.5', value === c.id ? 'opacity-100' : 'opacity-0')} />
                    {display}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FactoringField({ form, setForm, totalValue }: {
  form: SaleOrderFormData;
  setForm: (fn: (f: SaleOrderFormData) => SaleOrderFormData) => void;
  totalValue: number;
}) {
  const { data: configs = [] } = useFactoringConfigs();
  const activeConfigs = configs.filter(c => c.active);
  const selectedConfig = activeConfigs.find(c => c.id === form.factoring_config_id);

  const simulation = (() => {
    if (!selectedConfig || totalValue <= 0) return null;
    const days = parsePaymentConditionInstallments(form.payment_condition);
    if (days.length === 0) return null;
    const result = calculateFactoringDiscount({
      total: totalValue,
      monthlyInterestRate: selectedConfig.monthly_interest_rate,
      paymentCondition: form.payment_condition,
      deliveryMonth: form.delivery_month,
      deliveryWeek: form.delivery_week,
      fallbackReceivingDays: selectedConfig.receiving_days,
    });
    return {
      days,
      avgDays: result.totalInterestDays,
      months: result.periods,
      discountPct: result.discountPct,
      discount: result.discount,
      net: result.pv,
    };
  })();

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-3 rounded-lg border border-border/50 bg-muted/10 space-y-3">
      <div className="flex items-center gap-3">
        <Checkbox
          id="is_factoring"
          checked={form.is_factoring}
          onCheckedChange={(checked) => setForm(f => ({
            ...f,
            is_factoring: !!checked,
            factoring_config_id: checked ? (activeConfigs[0]?.id || '') : '',
          }))}
        />
        <Label htmlFor="is_factoring" className="text-xs font-bold cursor-pointer flex items-center gap-1.5">
          <Percent className="h-3.5 w-3.5 text-primary" />
          Pedido via Factoring
        </Label>
      </div>

      {form.is_factoring && (
        <div className="space-y-3">
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Factoring</Label>
            <Select value={form.factoring_config_id} onValueChange={v => setForm(f => ({ ...f, factoring_config_id: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a factoring..." /></SelectTrigger>
              <SelectContent>
                {activeConfigs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.monthly_interest_rate}% a.m.)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Simulação de desconto */}
          {simulation ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase text-amber-700 tracking-wide">Simulação de Desconto</p>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Parcelas:</span>
                  <span className="font-medium">
                    {simulation.days.join(' / ')} dias
                    {' → '}média {simulation.avgDays.toFixed(0)}d ({simulation.months.toFixed(1)} meses)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa:</span>
                  <span className="font-medium">
                    {selectedConfig!.monthly_interest_rate}% a.m. × {simulation.months.toFixed(1)} = {simulation.discountPct.toFixed(2)}%
                  </span>
                </div>
                <div className="border-t border-amber-500/20 pt-1 mt-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor bruto:</span>
                    <span className="font-mono">{fmt(totalValue)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span>Desconto factoring:</span>
                    <span className="font-mono font-bold">-{fmt(simulation.discount)}</span>
                  </div>
                  <div className="flex justify-between text-green-700 font-bold">
                    <span>Líquido a receber:</span>
                    <span className="font-mono">{fmt(simulation.net)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedConfig && totalValue > 0 && (
            <p className="text-[11px] text-muted-foreground italic">
              Informe a condição de pagamento (ex: 30/60/90 DIAS) para simular o desconto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SaleOrderFormPanel({
  form, setForm, items, setItems, clients, representatives, references,
   isAdmin, selectedClientId, onClientSelect, onSubmit, onCancel, isPending, submitLabel,
   packagingProductId, onPackagingProductChange, packagingQuantity: _packagingQuantity, onPackagingQuantityChange,
   onSaveStateAndNavigate,
 }: Props) {
   const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
   const [duplicateList, setDuplicateList] = useState<string[]>([]);
   const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
   const formRef = useRef<HTMLFormElement>(null);
  const selectedRep = representatives.find(r => r.id === form.representative);
  const selectedClient = clients.find(c => c.id === selectedClientId);

  // Credit exposure: sum of open AR for selected client
  const { data: creditExposure } = useQuery({
    queryKey: ['client_credit_exposure', selectedClientId],
    enabled: !!(selectedClientId && selectedClient?.credit_limit && selectedClient.credit_limit > 0),
    queryFn: async () => {
      const { data } = await (supabase.from('accounts_receivable') as any)
        .select('amount, amount_received, status')
        .eq('client_id', selectedClientId)
        .not('status', 'in', '("received","cancelled")');
      return (data || []).reduce((s, r) => s + (r.amount - (r.amount_received || 0)), 0);
    },
    staleTime: 30_000,
  });

  // Fetch box_types (central packaging registry)
  const { data: boxTypes = [] } = useQuery({
    queryKey: ['box_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('*')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: allVariantsByRef = new Map() } = useAllActiveReferenceMaterialVariants();

  // Fetch packaging configs from technical sheets for selected references
  const selectedSheetIds = useMemo(() => {
    return [...new Set(items.map(i => i.reference_id).filter(Boolean))];
  }, [items]);

  const { data: sheetPackagingConfigs = [] } = useQuery({
    queryKey: ['packaging_configs_for_refs', selectedSheetIds],
    enabled: selectedSheetIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_configs')
        .select('*, products:product_id(id, name, color, quantity)')
        .in('sheet_id', selectedSheetIds);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const _selectedPackaging = boxTypes.find(p => p.id === packagingProductId);

  const lastItemRef = useRef<HTMLDivElement>(null);
  const addItem = () => {
    setItems(prev => {
      const last = prev[prev.length - 1];
      return [...prev, { ...emptyItem, grade: last ? { ...last.grade } : {}, fichas: last?.fichas || 1 }];
    });
    setTimeout(() => {
      lastItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
   const updateItem = useCallback((idx: number, field: string, value: any) => {
     setItems(prev => {
       const next = prev.map((item, i) => i === idx ? { ...item, [field]: value } : item);
       
       // Real-time duplicate warning
       if (field === 'reference_id' || field === 'color') {
         const item = next[idx];
         if (item.reference_id && item.color) {
           const isDup = next.some((it, i) => i !== idx && it.reference_id === item.reference_id && it.color === item.color);
           if (isDup) {
             const ref = references.find(r => r.id === item.reference_id);
             toast.info(`Item duplicado: ${ref?.code || 'Ref'} (${item.color})`, {
               description: "Já existe este item no pedido. Deseja manter separado?",
               duration: 3000
             });
           }
         }
       }
       return next;
     });
     }, [references, setItems]);

  const totalPairs = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalValue = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const [shippingRate, setShippingRate] = useState(1.5); // Default rate per pair
  const estimatedShippingCost = totalPairs * shippingRate;

  // Group items by reference_id + color, keeping original indices
  const sortedIndices = useMemo(() => {
    const indices = items.map((_, i) => i);
    const groupKey = (item: SaleOrderItemFormData) => `${item.reference_id}||${item.color || ''}`;
    const groupOrder = new Map<string, number>();
    items.forEach((item, i) => {
      const key = groupKey(item);
      if (item.reference_id && !groupOrder.has(key)) {
        groupOrder.set(key, i);
      }
    });
    // Secondary: first appearance of the reference_id (to keep same refs together)
    const refOrder = new Map<string, number>();
    items.forEach((item, i) => {
      if (item.reference_id && !refOrder.has(item.reference_id)) {
        refOrder.set(item.reference_id, i);
      }
    });
    indices.sort((a, b) => {
      const itemA = items[a], itemB = items[b];
      const refA = itemA.reference_id, refB = itemB.reference_id;
      // First: group by reference_id
      const rOrderA = refA ? (refOrder.get(refA) ?? a) : a;
      const rOrderB = refB ? (refOrder.get(refB) ?? b) : b;
      if (rOrderA !== rOrderB) return rOrderA - rOrderB;
      // Second: within same reference, group by color
      const keyA = groupKey(itemA), keyB = groupKey(itemB);
      const gOrderA = groupOrder.get(keyA) ?? a;
      const gOrderB = groupOrder.get(keyB) ?? b;
      if (gOrderA !== gOrderB) return gOrderA - gOrderB;
      return a - b;
    });
    return indices;
  }, [items]);

  // Auto-calculate packaging quantity based on pairs_per_package
  const calcPackagingQty = (productId: string, pairs: number) => {
    const pkg = boxTypes.find(p => p.id === productId);
    const ppp = (pkg as any)?.pairs_per_box || 1;
    return Math.ceil(pairs / ppp);
  };

  useEffect(() => {
    if (packagingProductId && onPackagingQuantityChange) {
      onPackagingQuantityChange(calcPackagingQty(packagingProductId, totalPairs));
    }
    // boxTypes is in deps because calcPackagingQty reads pairs_per_box from it.
    // Without this dep, when boxTypes loads asynchronously after first render,
    // pairs_per_box defaults to 1 and the wrong qty is set.
  }, [totalPairs, packagingProductId, boxTypes]);

   const handlePreSubmit = (e: React.FormEvent) => {
     e.preventDefault();

     // If user already confirmed duplicates, skip the duplicate check and submit directly.
     if (confirmedDuplicate) {
       setConfirmedDuplicate(false);
       onSubmit(e);
       return;
     }

     const seen = new Set<string>();
     const dups: string[] = [];

     items.forEach(item => {
       if (!item.reference_id) return;
       const key = `${item.reference_id}-${item.color || ''}`;
       if (seen.has(key)) {
         const ref = references.find(r => r.id === item.reference_id);
         const label = `${ref?.code || 'Ref'} (${item.color || 'Sem cor'})`;
         if (!dups.includes(label)) dups.push(label);
       }
       seen.add(key);
     });

     if (dups.length > 0) {
       setDuplicateList(dups);
       setShowDuplicateDialog(true);
     } else {
       onSubmit(e);
     }
   };
 
   return (
     <>
     <form ref={formRef} onSubmit={handlePreSubmit} className="space-y-5">
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-3">
          <OrderStatusStepper currentStatus={form.status} />
        </CardContent>
      </Card>
      {/* Header section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">

          {/* Card 1: Cliente & Representante */}
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Cliente & Representante
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Representante</Label>
                  <Select value={form.representative} onValueChange={v => setForm(f => ({ ...f, representative: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {representatives.filter(r => r.active).map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.name} ({r.commission_pct}%)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Cliente (Cadastro)</Label>
                  <SearchableClientSelect
                    clients={clients.filter(c => c.active)}
                    value={selectedClientId}
                    onSelect={onClientSelect}
                  />
                  {selectedClient?.credit_limit && selectedClient.credit_limit > 0 && creditExposure !== undefined && (
                    <div className={`mt-1.5 flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                      creditExposure >= selectedClient.credit_limit
                        ? 'bg-destructive/10 text-destructive'
                        : creditExposure >= selectedClient.credit_limit * 0.8
                          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    }`}>
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>
                        Crédito: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(creditExposure)} em aberto
                        {' '}/ limite {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedClient.credit_limit)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Razão Social / Nome Fantasia *</Label>
                  <Input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} required className="h-9" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">CNPJ / CPF</Label>
                  <Input value={form.client_cnpj} onChange={e => setForm(f => ({ ...f, client_cnpj: e.target.value }))} className="h-9 font-mono" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Condições Comerciais */}
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Banknote className="h-4 w-4 text-primary" />
                Condições Comerciais
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Condição de Pagamento</Label>
                  <Input value={form.payment_condition} onChange={e => setForm(f => ({ ...f, payment_condition: e.target.value }))} className="h-9" placeholder="Ex: 30/60/90 DIAS" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Prazo de Entrega</Label>
                  <Input
                    type="date"
                    value={form.delivery_deadline}
                    onChange={e => setForm(f => ({ ...f, delivery_deadline: e.target.value }))}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Mês de Faturamento <span className="text-destructive">*</span></Label>
                  <Select value={form.delivery_month} onValueChange={v => setForm(f => ({ ...f, delivery_month: v, delivery_week: '' }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o mês..." /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const months: { value: string; label: string }[] = [];
                        const now = new Date();
                        for (let i = 0; i < 6; i++) {
                          const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                          const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                          const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                          months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
                        }
                        return months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>);
                      })()}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Semana de Faturamento <span className="text-destructive">*</span></Label>
                  <Select value={form.delivery_week} onValueChange={v => setForm(f => ({ ...f, delivery_week: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a semana..." /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        if (!form.delivery_month) return [<SelectItem key="none" value="none" disabled>Selecione o mês primeiro</SelectItem>];
                        const [year, month] = form.delivery_month.split('-').map(Number);
                        const weeks: { value: string; label: string }[] = [];
                        const firstDay = new Date(year, month - 1, 1);
                        const lastDay = new Date(year, month, 0);
                        let weekStart = new Date(firstDay);
                        const dayOfWeek = weekStart.getDay();
                        if (dayOfWeek !== 1) {
                          weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
                        }
                        let weekNum = 1;
                        while (weekStart <= lastDay) {
                          // Clamp display range to the selected month so users don't see
                          // dates from the previous/following month inside the week label.
                          const displayStart = weekStart < firstDay ? new Date(firstDay) : new Date(weekStart);
                          const weekEnd = new Date(weekStart);
                          weekEnd.setDate(weekEnd.getDate() + 4);
                          const displayEnd = weekEnd > lastDay ? new Date(lastDay) : weekEnd;
                          const label = `Semana ${weekNum} (${displayStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${displayEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
                          weeks.push({ value: `S${weekNum}`, label });
                          weekStart.setDate(weekStart.getDate() + 7);
                          weekNum++;
                        }
                        return weeks.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>);
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <FactoringField form={form} setForm={setForm} totalValue={totalValue} />
            </CardContent>
          </Card>

          {/* Card 3: Logística e Documentação */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Logística & Documentação
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Nº Pedido Cliente</Label>
                  <Input value={form.client_order_number} onChange={e => setForm(f => ({ ...f, client_order_number: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">NF-e</Label>
                  <Input value={form.nfe} onChange={e => setForm(f => ({ ...f, nfe: e.target.value }))} className="h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Remessa</Label>
                  <Input value={form.remessa} onChange={e => setForm(f => ({ ...f, remessa: e.target.value }))} className="h-9 font-mono" />
                </div>
              </div>

              {/* Shipping Calculator */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                    <Calculator className="h-3.5 w-3.5 text-primary" />
                    Calculadora de Frete (Estimativa)
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">
                    {totalPairs} pares
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Taxa por Par (R$)</Label>
                    <Input
                      type="number"
                      value={shippingRate}
                      onChange={e => {
                        const parsed = Number(e.target.value);
                        setShippingRate(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
                      }}
                      className="h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Custo Estimado</Label>
                    <div className="h-8 mt-1 flex items-center px-3 rounded-md border border-border bg-muted/30 font-mono font-bold text-foreground text-sm">
                      {formatCurrency(estimatedShippingCost)}
                    </div>
                  </div>
                </div>
              </div>

              {onPackagingProductChange && (
                <div className="mt-4 p-3 rounded-lg bg-muted/20 border border-border/50 space-y-4">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Modo de Embalagem</Label>
                  <RadioGroup
                    value={form.packaging_mode}
                    onValueChange={(v) => setForm(f => ({ ...f, packaging_mode: v as PackagingMode }))}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                  >
                    {(Object.entries(PACKAGING_MODE_LABELS) as [PackagingMode, string][]).map(([value, label]) => (
                      <Label
                        key={value}
                        htmlFor={`pkg-${value}`}
                        className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                          form.packaging_mode === value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/30'
                        }`}
                      >
                        <RadioGroupItem value={value} id={`pkg-${value}`} />
                        <span className="text-xs font-medium">{label}</span>
                      </Label>
                    ))}
                  </RadioGroup>

                  {/* Show packaging configs from technical sheets */}
                  {sheetPackagingConfigs.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-[10px] text-muted-foreground uppercase font-bold">📦 Embalagens das Fichas Técnicas</Label>
                      {(() => {
                        const mode = form.packaging_mode;
                        // Filter configs based on packaging mode
                        const relevantConfigs = sheetPackagingConfigs.filter(cfg => {
                          if (mode === 'colmeia') return cfg.packaging_type === 'colmeia';
                          if (mode === 'individual_amarrado') return cfg.packaging_type === 'individual';
                          if (mode === 'individual_master') return cfg.packaging_type === 'individual' || cfg.packaging_type === 'master';
                          return true;
                        });

                        if (relevantConfigs.length === 0) {
                          return (
                            <p className="text-[11px] text-amber-500">
                              ⚠ Nenhuma embalagem do tipo selecionado configurada nas fichas técnicas.
                            </p>
                          );
                        }

                        // Group by reference
                        const bySheet = new Map<string, typeof relevantConfigs>();
                        relevantConfigs.forEach(cfg => {
                          const list = bySheet.get(cfg.sheet_id) || [];
                          list.push(cfg);
                          bySheet.set(cfg.sheet_id, list);
                        });

                        const refNames = references.reduce((acc, r) => {
                          acc[r.id] = r.code ? `${r.code} — ${r.name}` : r.name;
                          return acc;
                        }, {} as Record<string, string>);

                        // Calculate boxes needed per reference
                        const itemsByRef = new Map<string, number>();
                        items.forEach(item => {
                          if (item.reference_id && item.quantity > 0) {
                            itemsByRef.set(item.reference_id, (itemsByRef.get(item.reference_id) || 0) + item.quantity);
                          }
                        });

                        return (
                          <div className="space-y-1.5">
                            {Array.from(bySheet.entries()).map(([sheetId, cfgs]) => (
                              <div key={sheetId} className="p-2 rounded bg-background border border-border/40 space-y-1">
                                <p className="text-[10px] font-bold text-foreground truncate">{refNames[sheetId] || sheetId}</p>
                                {cfgs.map(cfg => {
                                  const pairsForRef = itemsByRef.get(sheetId) || 0;
                                  const boxesNeeded = cfg.pairs_per_box > 0 ? Math.ceil(pairsForRef / cfg.pairs_per_box) : 0;
                                  const typeLabel = cfg.packaging_type === 'individual' ? 'Individual' : cfg.packaging_type === 'master' ? 'Master' : 'Colméia';
                                  const linkedProduct = (cfg as any).products;
                                  return (
                                    <div key={cfg.id} className="flex items-center justify-between text-[11px] text-muted-foreground">
                                      <span>
                                        <Badge variant="outline" className="text-[9px] mr-1">{typeLabel}</Badge>
                                        {cfg.nome || typeLabel} — {Number(cfg.comprimento_cm)}×{Number(cfg.largura_cm)}×{Number(cfg.altura_cm)} cm
                                        {Number(cfg.peso_kg) > 0 ? ` | ${Number(cfg.peso_kg)}g` : ''}
                                        {cfg.pairs_per_box > 1 ? ` | ${cfg.pairs_per_box} pares/cx` : ''}
                                      </span>
                                      <span className="font-mono font-medium text-foreground ml-2 whitespace-nowrap">
                                        {boxesNeeded > 0 ? `${boxesNeeded} cx` : '—'}
                                        {linkedProduct && (
                                          <span className="text-[9px] text-muted-foreground ml-1">(est: {linkedProduct.quantity})</span>
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {sheetPackagingConfigs.length === 0 && selectedSheetIds.length > 0 && (
                    <p className="text-[11px] text-amber-500">
                      ⚠ Nenhuma embalagem configurada nas fichas técnicas das referências selecionadas.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                Observações & Contato
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Contato no Cliente</Label>
                <Input value={form.client_contact} onChange={e => setForm(f => ({ ...f, client_contact: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Observações do Pedido</Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="min-h-[140px] text-sm resize-none"
                  placeholder="Instruções de faturamento, entrega ou descontos..."
                />
              </div>
              {selectedRep && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p className="text-[10px] font-bold text-primary uppercase mb-1">Dados do Representante</p>
                  <p className="text-xs font-medium truncate">{selectedRep.name}</p>
                  {selectedRep.phone && <p className="text-[11px] text-muted-foreground">📞 {selectedRep.phone}</p>}
                  {selectedRep.email && <p className="text-[11px] text-muted-foreground truncate">✉️ {selectedRep.email}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Items section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <Label className="text-lg font-bold">Itens do Pedido</Label>
          </div>
          <Badge variant="outline" className="font-mono">{items.length} Referência(s)</Badge>
        </div>
        {sortedIndices.map((idx, sortPos) => {
          const item = items[idx];
          const prevItem = sortPos > 0 ? items[sortedIndices[sortPos - 1]] : null;
          const isSameRef = prevItem?.reference_id === item.reference_id && !!item.reference_id;
          const isSameRefAndColor = isSameRef && prevItem?.color === item.color;
          return (
            <div key={`${idx}-${item.reference_id}`}
              className={isSameRefAndColor && item.color ? 'ml-6 border-l-2 border-primary/30 pl-2' : isSameRef ? 'ml-3 border-l-2 border-muted-foreground/15 pl-2' : ''}>
              <SaleOrderItemForm
                item={item}
                index={idx}
                references={references}
                canRemove={items.length > 1}
                isAdmin={isAdmin}
                onUpdate={updateItem}
                onRemove={removeItem}
                onCopyGradeFromPrevious={(i) => {
                  if (i > 0) {
                    const prev = items[i - 1];
                    updateItem(i, 'grade', { ...prev.grade });
                    updateItem(i, 'fichas', prev.fichas || 1);
                  }
                }}
                onSaveStateAndNavigate={onSaveStateAndNavigate}
              />
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5 w-full">
          <Plus className="h-3.5 w-3.5" /> Novo Item
        </Button>
      </div>

      {/* Totals footer */}
      <div className="rounded-xl border bg-card/50 backdrop-blur-sm shadow-lg p-5 flex flex-col md:flex-row items-center justify-between gap-6 border-primary/20 bg-gradient-to-r from-background to-primary/5">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-semibold text-foreground">{items.filter(i => i.reference_id).length}</span> referência(s) no total
          </div>
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Resumo Financeiro e de Volume</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-8 md:gap-12">
          <div className="flex flex-col items-center md:items-end">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">Total de Pares</span>
            <span className="font-mono font-bold text-2xl tracking-tight">{totalPairs}</span>
          </div>
          <div className="flex flex-col items-center md:items-end">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">Valor Total do Pedido</span>
            <span className="font-mono font-bold text-3xl text-primary tracking-tighter">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>

      {/* Validation Summary */}
      {(() => {
        const issues: { type: 'error' | 'warning'; msg: string }[] = [];
        if (!form.client_name) issues.push({ type: 'error', msg: 'Nome do cliente é obrigatório' });
        const validItems = items.filter(i => i.reference_id);
        if (validItems.length === 0) issues.push({ type: 'error', msg: 'Adicione pelo menos um item ao pedido' });
        validItems.forEach((item, i) => {
          if (!item.color?.trim()) issues.push({ type: 'error', msg: `Item ${i + 1}: cor não selecionada` });
          if (item.quantity <= 0) issues.push({ type: 'warning', msg: `Item ${i + 1}: quantidade zerada` });
          if (item.unit_price <= 0) issues.push({ type: 'warning', msg: `Item ${i + 1}: preço unitário zerado` });
          const refVariants = item.reference_id ? allVariantsByRef.get(item.reference_id) : undefined;
          if (refVariants && refVariants.length > 0 && !item.material_variant_id) {
            issues.push({ type: 'error', msg: `Item ${i + 1}: selecione o grupo de material — ${refVariants.map(v => v.material_name).join(' / ')}` });
          }
        });
        if (!form.payment_condition) issues.push({ type: 'warning', msg: 'Condição de pagamento não informada' });
        if (!form.delivery_deadline) issues.push({ type: 'warning', msg: 'Prazo de entrega não informado' });

        const errors = issues.filter(i => i.type === 'error');
        const warnings = issues.filter(i => i.type === 'warning');

        if (issues.length === 0) {
          return (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-success/5 border border-success/20">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <p className="text-xs text-success font-medium">Pedido pronto para envio — todos os campos validados</p>
            </div>
          );
        }

        return (
          <div className="p-3 rounded-lg border border-border space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase">Revisão do Pedido</p>
            {errors.map((issue, i) => (
              <div key={`e-${i}`} className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {issue.msg}
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={`w-${i}`} className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {issue.msg}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 pb-8">
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="lg" disabled={!form.client_name || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {submitLabel}
        </Button>
      </div>
     </form>
 
     <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
       <AlertDialogContent>
         <AlertDialogHeader>
           <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
             <AlertTriangle className="h-5 w-5" />
             Itens Duplicados Detectados
           </AlertDialogTitle>
           <AlertDialogDescription>
             Os seguintes itens aparecem mais de uma vez no pedido:
             <ul className="mt-2 list-disc list-inside font-medium text-foreground">
               {duplicateList.map((item, i) => (
                 <li key={i}>{item}</li>
               ))}
             </ul>
             <p className="mt-3">Deseja prosseguir com o salvamento mesmo assim ou prefere revisar?</p>
           </AlertDialogDescription>
         </AlertDialogHeader>
         <AlertDialogFooter>
           <AlertDialogCancel>Revisar Itens</AlertDialogCancel>
           <AlertDialogAction onClick={() => {
             setShowDuplicateDialog(false);
             // Re-trigger native form submit so HTML5 required-field validation still runs.
             // confirmedDuplicate flag tells handlePreSubmit to skip the duplicate check on this pass.
             setConfirmedDuplicate(true);
             // requestSubmit() respects required attributes; setTimeout lets the dialog unmount first.
             setTimeout(() => formRef.current?.requestSubmit(), 0);
           }}>
             Prosseguir mesmo assim
           </AlertDialogAction>
         </AlertDialogFooter>
       </AlertDialogContent>
     </AlertDialog>
     </>
  );
}
