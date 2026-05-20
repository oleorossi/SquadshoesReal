 import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Plus, CircleNotch as Loader2, User, Truck, ClipboardText as ClipboardList, Info, Percent, CaretUpDown as ChevronsUpDown, Check, ClockCounterClockwise as History, Warning as AlertTriangle, CheckCircle as CheckCircle2, Calculator, Money as Banknote } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SaleOrderFormData, SaleOrderItemFormData, PACKAGING_MODE_LABELS, PACKAGING_MODE_CANONICAL, type PackagingMode } from '@/hooks/useSaleOrders';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useClientCommercialDefaults } from '@/hooks/useEconomicGroup360';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import SaleOrderItemForm from './SaleOrderItemForm';
import { OrderStatusStepper } from '@/components/ui/order-status-stepper';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useFactoringConfigs } from '@/components/finance/FactoringTab';
import { useAllActiveReferenceMaterialVariants } from '@/hooks/useReferenceMaterialVariants';
import {
  calculateFactoringDiscount,
  parsePaymentConditionInstallments,
} from '@/lib/factoringCalc';
import { computeARSchedule } from '@/lib/saleOrderAR';
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
  /** Data mínima viável calculada (ISO yyyy-mm-dd). Quando delivery_deadline < esta data,
   *  exibe alerta vermelho persistente ao lado do campo. */
  minBillingISO?: string | null;
  /** True enquanto recalcula a data mínima (mostra spinner em vez de alerta). */
  computingMinBilling?: boolean;
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
  // Detalhes da simulação ficam colapsados por padrão — o card era um wall-of-text.
  // Resumo (taxa%, valor descontado, líquido) sempre visível; detalhamento sob demanda.
  const [showSimDetails, setShowSimDetails] = useState(false);
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
      // Audit B2 (round 28): expõe a fonte do cálculo. 'delivery+payment' = exato
      // (data entrega real + condição). 'fallback' = aproximado (faltou data).
      // 'none' = sem desconto. UI usa pra avisar quando desconto pode divergir.
      source: result.source,
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
            <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">
              Factoring <span className="text-destructive">*</span>
            </Label>
            {/* Audit visual: factoring marcado mas sem config selecionada gerava
                erro silencioso no save. Agora destaca em vermelho e o handler
                no submit bloqueia. */}
            <Select value={form.factoring_config_id} onValueChange={v => setForm(f => ({ ...f, factoring_config_id: v }))}>
              <SelectTrigger className={`h-9 ${!form.factoring_config_id ? 'border-destructive focus:ring-destructive' : ''}`}>
                <SelectValue placeholder="Selecione a factoring..." />
              </SelectTrigger>
              <SelectContent>
                {activeConfigs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.monthly_interest_rate}% a.m.)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!form.factoring_config_id && (
              <p className="text-xs text-destructive mt-1">Selecione qual factoring está antecipando este pedido.</p>
            )}
          </div>

          {form.is_factoring && !form.payment_condition && (
            /* Audit visual: hint pra completar condição pagamento — sem ela o
               cálculo cai no fallback de receiving_days, subestimando o desconto. */
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 flex items-start gap-2">
              <span className="text-amber-600 mt-0.5">⚠</span>
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <span className="font-semibold">Informe a condição de pagamento</span> (ex: 30/60/90 DIAS)
                no campo correspondente — sem ela o desconto factoring é calculado por estimativa
                e pode divergir do valor real.
              </div>
            </div>
          )}

          {/* Simulação de desconto — resumo compacto, expansível pra detalhes */}
          {simulation ? (
            <div className={`rounded-md border p-2.5 ${
              simulation.source === 'fallback'
                ? 'border-orange-500/40 bg-orange-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
            }`}>
              {/* Resumo sempre visível — 1 linha */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase text-amber-700 dark:text-amber-300 tracking-wide">
                    Desconto factoring
                  </span>
                  {simulation.source === 'delivery+payment' ? (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                      title="Cálculo exato">
                      EXATO
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/40"
                      title="Cálculo aproximado — faltam dados">
                      ESTIMADO
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-destructive font-bold">
                    -{fmt(simulation.discount)} ({simulation.discountPct.toFixed(2)}%)
                  </span>
                  <span className="text-green-700 font-bold">
                    Líquido {fmt(simulation.net)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSimDetails(s => !s)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    {showSimDetails ? 'Ocultar' : 'Detalhar'}
                  </button>
                </div>
              </div>
              {/* Detalhes — só quando expandido */}
              {showSimDetails && (
                <div className="mt-2 pt-2 border-t border-amber-500/20 text-xs space-y-1">
                  {simulation.source === 'fallback' && (
                    <p className="text-xs text-orange-700 dark:text-orange-300">
                      ⚠ Preencha <span className="font-semibold">mês + semana de faturamento</span> e
                      <span className="font-semibold"> condição de pagamento</span> pra simulação ficar exata.
                    </p>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Parcelas:</span>
                    <span className="font-medium">
                      {simulation.days.join(' / ')} dias → média {simulation.avgDays.toFixed(0)}d ({simulation.months.toFixed(1)} meses)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taxa:</span>
                    <span className="font-medium">
                      {selectedConfig!.monthly_interest_rate}% a.m. × {simulation.months.toFixed(1)} meses
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor bruto:</span>
                    <span className="font-mono">{fmt(totalValue)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : selectedConfig && totalValue > 0 && (
            <p className="text-xs text-muted-foreground italic">
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
   minBillingISO, computingMinBilling,
 }: Props) {
   const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
   const [duplicateList, setDuplicateList] = useState<string[]>([]);
   const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
   // Marca true quando o user tentou submeter pela primeira vez. A partir
   // daí, campos obrigatórios vazios mostram border-destructive até serem
   // preenchidos. Antes disso, render limpo (sem ruído visual de erro).
   const [submitAttempted, setSubmitAttempted] = useState(false);
   const formRef = useRef<HTMLFormElement>(null);
  const { canSeeFinancialValues } = useAccessControl();
  const selectedRep = representatives.find(r => r.id === form.representative);
  const selectedClient = clients.find(c => c.id === selectedClientId);
  const { data: factoringConfigs = [] } = useFactoringConfigs();
  const selectedFactoringConfig = factoringConfigs.find(c => c.id === form.factoring_config_id);

  // Defaults comerciais do cliente OU do grupo econômico (precedência cliente > grupo).
  // Pré-popula campos vazios quando o cliente é selecionado pela primeira vez.
  const { data: commercialDefaults } = useClientCommercialDefaults(selectedClientId);
  const defaultsApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedClientId || !commercialDefaults) return;
    if (defaultsApplied.current === selectedClientId) return;
    defaultsApplied.current = selectedClientId;
    setForm(f => ({
      ...f,
      // Só preenche se o campo estiver vazio — preserva o que o user já mexeu
      payment_condition: f.payment_condition || commercialDefaults.payment_condition || '',
      factoring_config_id: f.factoring_config_id || commercialDefaults.factoring_config_id || '',
    }));
  }, [selectedClientId, commercialDefaults, setForm]);

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

  // Auto-pull caixa do SOLADO: quando uma ficha técnica é selecionada nos itens,
  // busca sole_group_id da ficha → pega box_type_id do product_groups daquele
  // solado → sugere como packagingProductId quando ainda não há um setado.
  // Conforme requisito: "ao selecionar o solado deve puxar as medidas da caixa
  // correta automaticamente".
  const { data: soleBoxes = [] } = useQuery({
    queryKey: ['sole_boxes_for_refs', selectedSheetIds],
    enabled: selectedSheetIds.length > 0,
    queryFn: async () => {
      const { data: sheets } = await supabase
        .from('technical_sheets')
        .select('id, sole_group_id')
        .in('id', selectedSheetIds);
      const soleGroupIds = [...new Set((sheets || []).map(s => (s as any).sole_group_id).filter(Boolean))];
      if (soleGroupIds.length === 0) return [];
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, name')
        .in('id', soleGroupIds);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  // Auto-suggest de embalagem desabilitado: a lógica antiga setava
  // sale_orders.packaging_product_id com um box_type_id (FK em box_types),
  // mas a coluna tem FK em products(id) — quebrava o save com
  // "violates foreign key constraint sale_orders_packaging_product_id_fkey".
  // box_types e products são tabelas independentes; precisaria do produto
  // correspondente em products (category='Embalagem') pra setar corretamente.
  // Sistema já deriva embalagem do solado em outros lugares (PackagingTab/
  // packaging_configs), então não há perda funcional em deixar isso vazio.

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

   // ── Bulk-edit de itens (pedido user 20/05/2026) ─────────────────────────
   // Seleção múltipla de itens do PV pra aplicar mudanças em lote: copiar
   // grade do 1º item selecionado nos demais, aplicar preço unitário, ou
   // aplicar número de fichas. Reduz cliques quando o PV tem 5+ refs com
   // mesma grade/preço.
   const [selectedItemIndices, setSelectedItemIndices] = useState<Set<number>>(new Set());
   const [bulkPriceInput, setBulkPriceInput] = useState<string>('');
   const [bulkFichasInput, setBulkFichasInput] = useState<string>('');
   const [bulkGradeInput, setBulkGradeInput] = useState<Record<string, string>>({});
   const toggleItemSelection = useCallback((idx: number) => {
     setSelectedItemIndices(prev => {
       const next = new Set(prev);
       if (next.has(idx)) next.delete(idx); else next.add(idx);
       return next;
     });
   }, []);
   const clearItemSelection = useCallback(() => setSelectedItemIndices(new Set()), []);
   const selectAllItems = useCallback(() => {
     setSelectedItemIndices(new Set(items.map((_, i) => i)));
   }, [items]);
   const applyGradeFromFirstSelected = useCallback(() => {
     const sorted = Array.from(selectedItemIndices).sort((a, b) => a - b);
     if (sorted.length < 2) {
       toast.error('Selecione pelo menos 2 itens — o 1º é a fonte da grade, os demais recebem.');
       return;
     }
     const [firstIdx, ...others] = sorted;
     const sourceGrade = items[firstIdx]?.grade;
     const sourceFichas = items[firstIdx]?.fichas;
     if (!sourceGrade) {
       toast.error('Item de origem não tem grade definida.');
       return;
     }
     setItems(prev => prev.map((item, i) => {
       if (!others.includes(i)) return item;
       return {
         ...item,
         grade: { ...sourceGrade },
         fichas: sourceFichas || item.fichas || 1,
       };
     }));
     toast.success(`Grade copiada do item #${firstIdx + 1} pra ${others.length} ${others.length === 1 ? 'item' : 'itens'}`);
   }, [selectedItemIndices, items, setItems]);
   const applyUnitPriceToSelected = useCallback(() => {
     const price = Number(bulkPriceInput.replace(',', '.'));
     if (!Number.isFinite(price) || price < 0) {
       toast.error('Digite um preço válido (ex: 89,90).');
       return;
     }
     const ids = Array.from(selectedItemIndices);
     if (ids.length === 0) return;
     setItems(prev => prev.map((item, i) => ids.includes(i) ? { ...item, unit_price: price } : item));
     toast.success(`Preço R$ ${price.toFixed(2)} aplicado em ${ids.length} ${ids.length === 1 ? 'item' : 'itens'}`);
     setBulkPriceInput('');
   }, [bulkPriceInput, selectedItemIndices, setItems]);
   const applyFichasToSelected = useCallback(() => {
     const n = parseInt(bulkFichasInput, 10);
     if (!Number.isFinite(n) || n < 1) {
       toast.error('Digite um número de fichas válido (mínimo 1).');
       return;
     }
     const ids = Array.from(selectedItemIndices);
     if (ids.length === 0) return;
     setItems(prev => prev.map((item, i) => ids.includes(i) ? { ...item, fichas: n } : item));
     toast.success(`${n} ${n === 1 ? 'ficha' : 'fichas'} aplicado em ${ids.length} ${ids.length === 1 ? 'item' : 'itens'}`);
     setBulkFichasInput('');
   }, [bulkFichasInput, selectedItemIndices, setItems]);

   // União dos tamanhos das grades dos itens selecionados. Fallback 33-41
   // quando nenhum item selecionado tem grade ainda (caso comum: PV novo).
   const bulkGradeSizes = useMemo<string[]>(() => {
     const set = new Set<string>();
     selectedItemIndices.forEach(idx => {
       const g = items[idx]?.grade || {};
       Object.keys(g).forEach(s => set.add(s));
     });
     if (set.size === 0) {
       // fallback: range adulto padrão
       return ['33','34','35','36','37','38','39','40','41'];
     }
     // Sort 20/05/2026: extrai o PRIMEIRO número da key — necessário pra
     // tamanhos conjugados tipo "33/34" e "39/40" (Number("33/34")=NaN sem
     // o split, então caíam no fim da lista quebrando a ordem visual).
     return Array.from(set).sort((a, b) => {
       const na = parseInt(String(a).split('/')[0], 10);
       const nb = parseInt(String(b).split('/')[0], 10);
       return (isFinite(na) ? na : 0) - (isFinite(nb) ? nb : 0);
     });
   }, [selectedItemIndices, items]);

   const applyGradeTableToSelected = useCallback(() => {
     const ids = Array.from(selectedItemIndices);
     if (ids.length === 0) return;
     // Filtra zeros e converte string→number
     const cleanGrade: Record<string, number> = {};
     for (const [size, val] of Object.entries(bulkGradeInput)) {
       const n = parseInt(val, 10);
       if (Number.isFinite(n) && n > 0) cleanGrade[size] = n;
     }
     if (Object.keys(cleanGrade).length === 0) {
       toast.error('Preencha pelo menos um tamanho antes de aplicar.');
       return;
     }
     const totalPairs = Object.values(cleanGrade).reduce((s, v) => s + v, 0);
     setItems(prev => prev.map((item, i) => ids.includes(i) ? { ...item, grade: { ...cleanGrade } } : item));
     toast.success(`Grade aplicada em ${ids.length} ${ids.length === 1 ? 'item' : 'itens'} (${totalPairs} pares por ficha)`);
     setBulkGradeInput({});
   }, [bulkGradeInput, selectedItemIndices, setItems]);

  const totalPairs = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalValue = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  // Hidrata do form.shipping_rate_per_pair (persistido no DB).
  // Padrão 0 quando criando um PV novo — só gera entry financeira se user setar > 0.
  const initialRate = Number(form.shipping_rate_per_pair) || 0;
  const [shippingRate, setShippingRate] = useState(initialRate);
  const [shippingRateText, setShippingRateText] = useState(
    initialRate > 0 ? initialRate.toFixed(2).replace('.', ',') : '0'
  );
  const estimatedShippingCost = totalPairs * shippingRate;

  // Sync de volta pro form quando user digita — assim o save (handleSubmit do
  // SaleOrderForm) já manda shipping_rate_per_pair no payload. Trigger no DB
  // cria a financial_entry automaticamente.
  useEffect(() => {
    if ((Number(form.shipping_rate_per_pair) || 0) !== shippingRate) {
      setForm(f => ({ ...f, shipping_rate_per_pair: shippingRate }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingRate]);

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
     setSubmitAttempted(true);

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
 
   const isNewOrder = form.status === 'Rascunho' || !form.status;

   return (
     <>
     <form ref={formRef} onSubmit={handlePreSubmit} className="space-y-5 pb-40 sm:pb-24">
      {/* Stepper só faz sentido em PV existente — em "Novo Pedido" o status é sempre
          Rascunho e o widget completo confunde mais do que informa. */}
      {!isNewOrder && (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-3">
            <OrderStatusStepper currentStatus={form.status} />
          </CardContent>
        </Card>
      )}
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
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Representante</Label>
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
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Cliente (Cadastro)</Label>
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
                  {commercialDefaults?.block_new_orders && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs rounded px-2 py-1 bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>
                        <strong>Bloqueado:</strong> {commercialDefaults.block_reason || 'Cliente ou grupo econômico bloqueado pra novos pedidos'}
                      </span>
                    </div>
                  )}
                  {commercialDefaults && commercialDefaults.inherited_from === 'grupo econômico' && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs rounded px-2 py-1 bg-primary/5 text-primary border border-primary/20">
                      <Info className="h-3 w-3 shrink-0" />
                      <span>Condições herdadas do grupo econômico (pgto, factoring, desconto)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Razão Social + CNPJ ficam OCULTOS quando o cliente foi
                  selecionado do cadastro — handleClientSelect já preencheu
                  esses campos automaticamente, mostrar os inputs editáveis
                  só duplicava a informação e confundia o operador (pedido
                  do user em 18/05/2026: "1 cliente cadastra e ele joga pra
                  cliente nome fantasia não faz sentido nenhum").
                  Os campos só aparecem em modo "pedido avulso" (sem cliente
                  do cadastro selecionado) pra digitar manualmente. */}
              {selectedClientId ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-center gap-3">
                  <Info className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{form.client_name || '—'}</p>
                    {form.client_cnpj && (
                      <p className="text-xs font-mono text-muted-foreground">{form.client_cnpj}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClientSelect('');
                      setForm(f => ({ ...f, client_id: null as any, client_name: '', client_cnpj: '' }));
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                  >
                    Trocar cliente
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">
                      Razão Social / Nome Fantasia *
                      <span className="ml-2 text-xs text-muted-foreground/70 normal-case font-normal">(pedido avulso — sem cadastro)</span>
                    </Label>
                    <Input
                      value={form.client_name}
                      onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                      required
                      className={`h-9 ${submitAttempted && !form.client_name ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">CNPJ / CPF</Label>
                    {(() => {
                      const digits = (form.client_cnpj || '').replace(/\D/g, '');
                      const isInvalidLength = digits.length > 0 && digits.length !== 11 && digits.length !== 14;
                      return (
                        <>
                          <Input
                            value={form.client_cnpj}
                            onChange={e => setForm(f => ({ ...f, client_cnpj: e.target.value }))}
                            className={`h-9 font-mono ${isInvalidLength ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                            placeholder="00.000.000/0001-00 ou 000.000.000-00"
                          />
                          {isInvalidLength && (
                            <p className="text-xs text-destructive mt-0.5">
                              CNPJ deve ter 14 dígitos · CPF deve ter 11 dígitos. Tem {digits.length}.
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Condições Comerciais — oculto pra produção/almoxarifado */}
          {canSeeFinancialValues && (
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Banknote className="h-4 w-4 text-primary" />
                Condições Comerciais
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Condição de pagamento numa linha só. Prazo de Entrega (date input)
                  foi removido: a data é derivada automaticamente de Mês + Semana
                  via monthWeekToISODate. O comercial só raciocina por
                  semana de faturamento — data exata é detalhe técnico. */}
              <div>
                <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Condição de Pagamento</Label>
                <Input value={form.payment_condition} onChange={e => setForm(f => ({ ...f, payment_condition: e.target.value }))} className="h-9" placeholder="Ex: 30/60/90 DIAS" />
                {(() => {
                  // Preview do cronograma de parcelas que SERÁ gravado em
                  // accounts_receivable ao faturar. Usa exatamente a mesma função
                  // (computeARSchedule) usada por syncFinancialRecords — então o
                  // que aparece aqui é o que o A/R terá. Mostra também o desconto
                  // factoring quando aplicável (calculado em cima do total e
                  // distribuído proporcionalmente entre as parcelas).
                  if (!form.delivery_deadline || totalValue <= 0) {
                    return (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {totalValue <= 0
                          ? 'Adicione itens com valor pra ver o cronograma de vencimento.'
                          : 'Defina mês + semana de faturamento abaixo pra ver o cronograma de vencimento.'}
                      </div>
                    );
                  }
                  const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                  const fmtMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                  let arTotal = totalValue;
                  let factoringDiscount = 0;
                  if (form.is_factoring && selectedFactoringConfig && form.payment_condition) {
                    const { pv } = calculateFactoringDiscount({
                      total: totalValue,
                      monthlyInterestRate: selectedFactoringConfig.monthly_interest_rate,
                      paymentCondition: form.payment_condition,
                      deliveryMonth: form.delivery_month,
                      deliveryWeek: form.delivery_week,
                      fallbackReceivingDays: selectedFactoringConfig.receiving_days,
                    });
                    arTotal = pv;
                    factoringDiscount = totalValue - pv;
                  }
                  const schedule = computeARSchedule({
                    total: arTotal,
                    paymentCondition: form.payment_condition,
                    deliveryDeadline: form.delivery_deadline,
                    isFactoring: !!form.is_factoring,
                    factoringReceivingDays: selectedFactoringConfig?.receiving_days ?? null,
                  });
                  const baseLabel = form.is_factoring && selectedFactoringConfig
                    ? `faturamento + ${selectedFactoringConfig.receiving_days}d factoring`
                    : `data de faturamento`;
                  return (
                    <div className="mt-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-muted-foreground">
                          {schedule.length === 1 ? '1 parcela' : `${schedule.length} parcelas`} — base: {baseLabel}
                        </span>
                        {factoringDiscount > 0 && (
                          <span className="text-xs text-amber-600 dark:text-amber-500">desconto factoring −{fmtMoney(factoringDiscount)}</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {schedule.map((inst) => (
                          <div key={inst.installment_number} className="flex items-baseline justify-between gap-3">
                            <span className="text-muted-foreground">
                              {inst.installment_number}/{inst.total_installments}
                              {inst.days_offset > 0 && <span className="text-muted-foreground/70"> · +{inst.days_offset}d</span>}
                            </span>
                            <span className="font-mono text-foreground">
                              <span className="font-medium">{fmt(inst.due_date)}</span>
                              <span className="text-muted-foreground/70"> · {fmtMoney(inst.amount)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Mês de Faturamento <span className="text-destructive">*</span></Label>
                  <Select value={form.delivery_month} onValueChange={v => setForm(f => ({ ...f, delivery_month: v, delivery_week: '' }))}>
                    <SelectTrigger className={`h-9 ${submitAttempted && !form.delivery_month ? 'border-destructive focus:ring-destructive' : ''}`}><SelectValue placeholder="Selecione o mês..." /></SelectTrigger>
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
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Semana de Faturamento <span className="text-destructive">*</span></Label>
                  <Select value={form.delivery_week} onValueChange={v => setForm(f => ({ ...f, delivery_week: v }))}>
                    <SelectTrigger className={`h-9 ${submitAttempted && !form.delivery_week ? 'border-destructive focus:ring-destructive' : ''}`}><SelectValue placeholder="Selecione a semana..." /></SelectTrigger>
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

              {/* Pedido informal — não emite NF-e. Quando marcado, o PV pula
                  Faturado e vai direto a "Finalizado s/ NF" na expedição. Sem
                  AR, sem lançamento financeiro. */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                <Checkbox
                  id="nfe_required_off"
                  checked={form.nfe_required === false}
                  onCheckedChange={(checked) => setForm(f => ({ ...f, nfe_required: !checked }))}
                  className="mt-0.5"
                />
                <div className="flex-1 -mt-0.5">
                  <Label htmlFor="nfe_required_off" className="text-xs font-bold cursor-pointer flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Pedido informal (sem NF-e)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    Marque pra pedidos que <strong>não precisam de NF-e</strong> (venda no atacado direta, amostra, brinde).
                    Material e produção debitam normal, mas: <strong>não emite nota</strong>, <strong>não gera conta a receber</strong> e termina
                    em "Finalizado s/ NF" ao ser expedido.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Card 3: Logística e Documentação */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Logística & Documentação
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Nº Pedido Cliente</Label>
                  <Input value={form.client_order_number} onChange={e => setForm(f => ({ ...f, client_order_number: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">
                    Marca (NF-e)
                    <span className="ml-1 text-xs font-normal normal-case text-muted-foreground">xMarca no XML</span>
                  </Label>
                  <Input
                    value={form.brand || 'Squad Shoes'}
                    onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                    className="h-9"
                    placeholder="Squad Shoes"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">NF-e</Label>
                  <Input value={form.nfe} onChange={e => setForm(f => ({ ...f, nfe: e.target.value }))} className="h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Remessa</Label>
                  <Input value={form.remessa} onChange={e => setForm(f => ({ ...f, remessa: e.target.value }))} className="h-9 font-mono" />
                </div>
              </div>

              {/* Shipping Calculator — aceita decimal (0.33, 1,50) via parse manual */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                    <Calculator className="h-3.5 w-3.5 text-primary" />
                    Calculadora de Frete (Estimativa)
                  </Label>
                  <Badge variant="secondary" className="text-xs">
                    {totalPairs} pares
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Taxa por Par (R$)</Label>
                    {/* type="text" + inputMode="decimal" aceita "," ou "." e
                        teclado mobile vem com decimal. type="number" estrangulava
                        valores como 0,33 no locale pt-BR. */}
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={shippingRateText}
                      onChange={e => {
                        const raw = e.target.value;
                        setShippingRateText(raw);
                        // Normaliza vírgula → ponto e parse
                        const parsed = Number(raw.replace(',', '.'));
                        setShippingRate(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
                      }}
                      onBlur={() => {
                        // Snap visual pra notação consistente (sempre ponto, 2 casas)
                        if (Number.isFinite(shippingRate) && shippingRate > 0) {
                          setShippingRateText(shippingRate.toFixed(2));
                        } else if (!shippingRateText) {
                          setShippingRateText('0');
                        }
                      }}
                      placeholder="0,33"
                      className="h-9 mt-1 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Pares × Taxa</Label>
                    <div className="h-9 mt-1 flex items-center px-3 rounded-md border border-border bg-muted/30 font-mono text-xs text-muted-foreground">
                      {totalPairs} × {formatCurrency(shippingRate)}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs uppercase font-bold text-muted-foreground">Custo Estimado</Label>
                    <div className="h-9 mt-1 flex items-center px-3 rounded-md border border-primary/40 bg-primary/5 font-mono font-bold text-foreground text-sm">
                      {formatCurrency(estimatedShippingCost)}
                    </div>
                  </div>
                </div>

                {/* Frete próprio: opt-in que joga este PV no planejamento de
                    rota em /entregas com cálculo de combustível e desgaste. */}
                <div className="flex items-start gap-3 pt-3 border-t border-border/60">
                  <Switch
                    id="own-delivery-switch"
                    checked={!!form.own_delivery}
                    onCheckedChange={(v) => setForm(f => ({ ...f, own_delivery: v }))}
                  />
                  <div className="flex-1 -mt-0.5">
                    <Label htmlFor="own-delivery-switch" className="text-xs font-bold cursor-pointer flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-primary" />
                      Frete próprio (entregar com nossa frota)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {form.own_delivery
                        ? 'Este pedido entrará no planejamento de rota em Entregas, com projeção de combustível e desgaste do veículo.'
                        : 'Quando ativo, o pedido aparece em Entregas para montar rota, escolher veículo/motorista e ver custo estimado por viagem.'}
                    </p>
                  </div>
                </div>
              </div>

              {onPackagingProductChange && (
                <div className="mt-4 p-3 rounded-lg bg-muted/20 border border-border/50 space-y-4">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Modo de Embalagem</Label>
                  <RadioGroup
                    value={form.packaging_mode}
                    onValueChange={(v) => setForm(f => ({ ...f, packaging_mode: v as PackagingMode }))}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                  >
                    {/* Mostra os 3 modos canônicos. Se o PV foi salvo com modo legado
                        ('individual_amarrado'), inclui ele na lista pra não quebrar a edição. */}
                    {(() => {
                      const visibleModes: PackagingMode[] = [...PACKAGING_MODE_CANONICAL];
                      if (
                        form.packaging_mode &&
                        !visibleModes.includes(form.packaging_mode as PackagingMode)
                      ) {
                        visibleModes.push(form.packaging_mode as PackagingMode);
                      }
                      return visibleModes.map((value) => (
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
                          <span className="text-xs font-medium">{PACKAGING_MODE_LABELS[value]}</span>
                        </Label>
                      ));
                    })()}
                  </RadioGroup>

                  {/* Show packaging configs from technical sheets */}
                  {sheetPackagingConfigs.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground uppercase font-bold">📦 Embalagens das Fichas Técnicas</Label>
                      {(() => {
                        const mode = form.packaging_mode;
                        // Filter configs based on packaging mode
                        const relevantConfigs = sheetPackagingConfigs.filter(cfg => {
                          if (mode === 'colmeia') return cfg.packaging_type === 'colmeia';
                          if (mode === 'individual_amarrado') return cfg.packaging_type === 'individual';
                          if (mode === 'individual_master') return cfg.packaging_type === 'individual' || cfg.packaging_type === 'master';
                          if (mode === 'individual_fitilho') return cfg.packaging_type === 'individual' || cfg.packaging_type === 'fitilho';
                          return true;
                        });

                        if (relevantConfigs.length === 0) {
                          return (
                            <p className="text-xs text-amber-500">
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
                                <p className="text-xs font-bold text-foreground truncate">{refNames[sheetId] || sheetId}</p>
                                {cfgs.map(cfg => {
                                  const pairsForRef = itemsByRef.get(sheetId) || 0;
                                  const boxesNeeded = cfg.pairs_per_box > 0 ? Math.ceil(pairsForRef / cfg.pairs_per_box) : 0;
                                  const typeLabel = cfg.packaging_type === 'individual' ? 'Individual' : cfg.packaging_type === 'master' ? 'Master' : 'Colméia';
                                  const linkedProduct = (cfg as any).products;
                                  return (
                                    <div key={cfg.id} className="flex items-center justify-between text-xs text-muted-foreground">
                                      <span>
                                        <Badge variant="outline" className="text-xs mr-1">{typeLabel}</Badge>
                                        {cfg.nome || typeLabel} — {Number(cfg.comprimento_cm)}×{Number(cfg.largura_cm)}×{Number(cfg.altura_cm)} cm
                                        {Number(cfg.peso_kg) > 0 ? ` | ${Number(cfg.peso_kg)}g` : ''}
                                        {cfg.pairs_per_box > 1 ? ` | ${cfg.pairs_per_box} pares/cx` : ''}
                                      </span>
                                      <span className="font-mono font-medium text-foreground ml-2 whitespace-nowrap">
                                        {boxesNeeded > 0 ? `${boxesNeeded} cx` : '—'}
                                        {linkedProduct && (
                                          <span className="text-xs text-muted-foreground ml-1">(est: {linkedProduct.quantity})</span>
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
                    <p className="text-xs text-amber-500">
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
                <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Contato no Cliente</Label>
                <Input value={form.client_contact} onChange={e => setForm(f => ({ ...f, client_contact: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Observações do Pedido</Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="min-h-[100px] text-sm resize-none"
                  placeholder="Notas internas — NÃO aparecem na NF."
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">
                  Informações Complementares (NF-e)
                  <span className="ml-2 text-xs font-normal normal-case text-amber-700">aparece no rodapé da NF</span>
                </Label>
                <Textarea
                  value={form.informacoes_complementares_nf || ''}
                  onChange={e => setForm(f => ({ ...f, informacoes_complementares_nf: e.target.value }))}
                  className="min-h-[80px] text-sm resize-none"
                  placeholder="Ex: 'Frete por conta do destinatário · Conferir embalagem antes de receber'. A OC do cliente é adicionada automaticamente."
                />
              </div>
              {selectedRep && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p className="text-xs font-bold text-primary uppercase mb-1">Dados do Representante</p>
                  <p className="text-xs font-medium truncate">{selectedRep.name}</p>
                  {selectedRep.phone && <p className="text-xs text-muted-foreground">📞 {selectedRep.phone}</p>}
                  {selectedRep.email && <p className="text-xs text-muted-foreground truncate">✉️ {selectedRep.email}</p>}
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
          <div className="flex items-center gap-2">
            {/* Checkbox master pra selecionar/desmarcar todos os itens (20/05/2026).
                Antes só aparecia DENTRO da barra de bulk-edit que só surgia com
                1+ item selecionado — catch-22 ruim de UX. Agora sempre visível. */}
            {items.length > 1 && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={selectedItemIndices.size === items.length && items.length > 0}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedItemIndices.size > 0 && selectedItemIndices.size < items.length;
                  }}
                  onChange={(e) => {
                    if (e.target.checked) selectAllItems();
                    else clearItemSelection();
                  }}
                  className="h-4 w-4 rounded border-input cursor-pointer"
                  aria-label="Selecionar todos os itens"
                />
                {selectedItemIndices.size === items.length && items.length > 0
                  ? 'Desmarcar todos'
                  : `Selecionar todos${selectedItemIndices.size > 0 ? ` (${selectedItemIndices.size}/${items.length})` : ''}`}
              </label>
            )}
            <Badge variant="outline" className="font-mono">{items.length} Referência(s)</Badge>
          </div>
        </div>
        {sortedIndices.map((idx, sortPos) => {
          const item = items[idx];
          const prevItem = sortPos > 0 ? items[sortedIndices[sortPos - 1]] : null;
          const isSameRef = prevItem?.reference_id === item.reference_id && !!item.reference_id;
          const isSameRefAndColor = isSameRef && prevItem?.color === item.color;
          return (
            <div key={`${idx}-${item.reference_id}`}
              className={
                isSameRefAndColor && item.color
                  ? 'ml-6 border-l-4 border-destructive/50 pl-3 bg-destructive/5 rounded-r-md relative'
                  : isSameRef
                    ? 'ml-3 border-l-2 border-primary/30 pl-2 bg-primary/5 rounded-r-md'
                    : ''
              }>
              {isSameRefAndColor && item.color && (
                <div className="absolute -top-2 left-3 px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold uppercase tracking-wider shadow-sm z-10">
                  Duplicado · mesma ref+cor
                </div>
              )}
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
                isSelected={selectedItemIndices.has(idx)}
                onToggleSelect={toggleItemSelection}
              />
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5 w-full">
          <Plus className="h-3.5 w-3.5" /> Novo Item
        </Button>
      </div>

      {/* ── Barra de edição em lote ──
          Aparece quando há 1+ itens selecionados via checkbox no header de cada
          item. 3 ações: copiar grade do 1º selecionado nos demais, aplicar
          preço unitário, aplicar fichas. Não-flutuante (renderiza inline antes
          dos totais) pra não cobrir o rodapé sticky de Cancelar/Salvar. */}
      {selectedItemIndices.size > 0 && (
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 px-4 py-3 mb-3 space-y-3">
          {/* Linha 1: contador + ações de preço/fichas + clear */}
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-2 pr-3 border-r border-primary/30">
            <span className="font-display text-2xl leading-none tabular-nums text-primary">
              {selectedItemIndices.size}
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              {selectedItemIndices.size === 1 ? 'item selecionado' : 'itens selecionados'}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyGradeFromFirstSelected}
            disabled={selectedItemIndices.size < 2}
            className="h-8 text-xs gap-1"
            title={selectedItemIndices.size < 2 ? 'Selecione 2+ itens (1º = fonte, demais recebem)' : 'Copia grade do menor índice selecionado pros demais'}
          >
            Copiar do 1º
          </Button>
          <div className="flex items-center gap-1 border-l border-primary/30 pl-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Preço R$</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={bulkPriceInput}
              onChange={(e) => setBulkPriceInput(e.target.value)}
              placeholder="89,90"
              className="h-8 w-24 text-xs"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUnitPriceToSelected(); } }}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={applyUnitPriceToSelected}
              disabled={!bulkPriceInput.trim()}
              className="h-8 text-xs"
            >
              Aplicar
            </Button>
          </div>
          <div className="flex items-center gap-1 border-l border-primary/30 pl-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fichas</Label>
            <Input
              type="number"
              min="1"
              value={bulkFichasInput}
              onChange={(e) => setBulkFichasInput(e.target.value)}
              placeholder="1"
              className="h-8 w-20 text-xs"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyFichasToSelected(); } }}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={applyFichasToSelected}
              disabled={!bulkFichasInput.trim()}
              className="h-8 text-xs"
            >
              Aplicar
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={selectAllItems}
              className="h-8 text-xs"
              disabled={selectedItemIndices.size === items.length}
            >
              Selecionar todos
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearItemSelection}
              className="h-8 text-xs"
            >
              Limpar
            </Button>
          </div>
          </div>

          {/* Linha 2: tabela de grade editável (aparece sempre que há 1+ selecionado).
              Tamanhos = união dos tamanhos das grades dos itens selecionados,
              ou fallback 33-41 quando nenhum item tem grade ainda. Aplicar
              sobrescreve a grade dos itens selecionados (decisão user 20/05/2026). */}
          <div className="border-t border-primary/30 pt-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Grade · digite e aplique em todos os selecionados
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                {bulkGradeSizes.map(size => (
                  <div key={size} className="flex flex-col items-center">
                    <span className="text-xs font-mono font-bold text-muted-foreground">{size}</span>
                    <Input
                      type="number"
                      min="0"
                      value={bulkGradeInput[size] || ''}
                      onChange={(e) => setBulkGradeInput(prev => ({ ...prev, [size]: e.target.value }))}
                      placeholder="0"
                      className="h-8 w-14 text-xs text-center"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyGradeTableToSelected(); } }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Total / ficha
              </span>
              <div className="h-8 px-3 flex items-center font-mono font-bold text-sm bg-background border rounded">
                {Object.values(bulkGradeInput).reduce((s, v) => s + (parseInt(v, 10) || 0), 0)}
              </div>
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={applyGradeTableToSelected}
              disabled={Object.values(bulkGradeInput).every(v => !v || parseInt(v, 10) === 0)}
              className="h-8 text-xs gap-1"
            >
              Aplicar grade
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setBulkGradeInput({})}
              className="h-8 text-xs"
              disabled={Object.keys(bulkGradeInput).length === 0}
            >
              Zerar tabela
            </Button>
          </div>
        </div>
      )}

      {/* Action bar fixa no rodapé: totais + validações + Cancelar/Salvar.
          Substitui o trio "footer-de-totais + bloco-de-revisão + botões" antigo
          que ocupava 3 alturas de tela e fazia o usuário scrollar pra confirmar.
          Sticky bottom = sempre visível enquanto edita itens. */}
      {(() => {
        // Só popula issues após o 1º submit. Antes disso, footer fica "limpo"
        // pra não poluir o form vazio com "Adicione um item" / "Sem condição".
        const issues: { type: 'error' | 'warning'; msg: string; field?: string }[] = [];
        if (submitAttempted) {
          if (!form.client_name) issues.push({ type: 'error', msg: 'Cliente obrigatório', field: 'client_name' });
          const validItems = items.filter(i => i.reference_id);
          if (validItems.length === 0) issues.push({ type: 'error', msg: 'Adicione um item', field: 'items' });
          validItems.forEach((item, i) => {
            if (!item.color?.trim()) issues.push({ type: 'error', msg: `Item ${i + 1}: cor faltando` });
            if (item.quantity <= 0) issues.push({ type: 'warning', msg: `Item ${i + 1}: qtd zerada` });
            // Preço zero é ERROR (não warning) — bloqueia submit. Reportado
            // em 20/05/2026: PV-00122 saiu com CF 07 PRETO em R$ 0,00 e
            // 'sumiu' R$ 442,80 do total geral. Regra dura no front + trigger
            // no DB (tg_block_zero_unit_price) cobrem o fluxo.
            if (item.unit_price <= 0) issues.push({ type: 'error', msg: `Item ${i + 1}: preço unitário não pode ser zero` });
            const refVariants = item.reference_id ? allVariantsByRef.get(item.reference_id) : undefined;
            if (refVariants && refVariants.length > 0 && !item.material_variant_id) {
              issues.push({ type: 'error', msg: `Item ${i + 1}: selecione grupo de material` });
            }
          });
          if (!form.payment_condition) issues.push({ type: 'warning', msg: 'Sem condição de pagamento' });
          if (!form.delivery_deadline) issues.push({ type: 'warning', msg: 'Sem prazo de entrega' });
        }

        const errors = issues.filter(i => i.type === 'error');
        const warnings = issues.filter(i => i.type === 'warning');

        const validItemsCount = items.filter(i => i.reference_id).length;
        const factoringInvalid = form.is_factoring && !form.factoring_config_id;
        const submitDisabled = !form.client_name || validItemsCount === 0 || factoringInvalid || isPending;
        const disabledReason = !form.client_name
          ? 'Selecione um cliente antes de salvar'
          : validItemsCount === 0
            ? 'Adicione pelo menos um item com referência ao pedido'
            : factoringInvalid
              ? 'Selecione qual factoring está antecipando o pedido'
              : undefined;

        return (
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur-md shadow-[0_-4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
            <div className="max-w-[var(--main-max,1600px)] mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
              {/* Resumo de totais — grid em mobile pra evitar squeeze, inline em sm+ */}
              <div className="grid grid-cols-3 sm:flex sm:items-center sm:gap-6 sm:flex-1 sm:min-w-0">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Itens</span>
                  <span className="font-mono font-bold text-base sm:text-lg tracking-tight leading-none">{validItemsCount}</span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-border" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pares</span>
                  <span className="font-mono font-bold text-base sm:text-lg tracking-tight leading-none">{totalPairs}</span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-border" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Valor Total</span>
                  <span className="font-mono font-bold text-base sm:text-xl text-primary tracking-tight leading-none">
                    {formatCurrency(totalValue + estimatedShippingCost)}
                  </span>
                  {estimatedShippingCost > 0 && (
                    <span className="text-xs text-muted-foreground font-mono mt-0.5">
                      mercadoria {formatCurrency(totalValue)} + frete {formatCurrency(estimatedShippingCost)}
                    </span>
                  )}
                </div>
              </div>

              {/* Indicador de validação — meio */}
              <div className="flex items-center gap-2 justify-end sm:justify-start">
                {issues.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Pronto
                  </span>
                ) : (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'h-8 gap-1.5 text-xs font-semibold',
                          errors.length > 0
                            ? 'text-destructive hover:bg-destructive/10'
                            : 'text-amber-600 hover:bg-amber-500/10'
                        )}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {errors.length > 0
                          ? `${errors.length} erro(s)`
                          : `${warnings.length} aviso(s)`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 max-h-80 overflow-y-auto">
                      <div className="space-y-1">
                        {errors.length > 0 && (
                          <>
                            <p className="text-xs font-bold text-destructive uppercase tracking-wider mb-1.5">Erros bloqueantes</p>
                            {errors.map((issue, i) => (
                              <div key={`e-${i}`} className="flex items-start gap-2 text-xs text-destructive/90 py-0.5">
                                <span className="mt-0.5">•</span>
                                <span>{issue.msg}</span>
                              </div>
                            ))}
                          </>
                        )}
                        {warnings.length > 0 && (
                          <>
                            {errors.length > 0 && <div className="h-px bg-border my-2" />}
                            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">Avisos</p>
                            {warnings.map((issue, i) => (
                              <div key={`w-${i}`} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 py-0.5">
                                <span className="mt-0.5">•</span>
                                <span>{issue.msg}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Botões — direita; em mobile, full-width pra toque confortável */}
              <div className="flex items-center gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={submitDisabled}
                  title={disabledReason}
                  className="flex-[2] sm:flex-none sm:min-w-[160px]"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {submitLabel}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
     </form>
 
     <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
       <AlertDialogContent>
         <AlertDialogHeader>
           <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
             <AlertTriangle className="h-5 w-5" />
             Itens Duplicados Detectados
           </AlertDialogTitle>
           <AlertDialogDescription>
             Os seguintes itens aparecem mais de uma vez no pedido (mesma referência + mesma cor):
             <ul className="mt-2 list-disc list-inside font-medium text-foreground">
               {duplicateList.map((item, i) => (
                 <li key={i}>{item}</li>
               ))}
             </ul>
             <p className="mt-3 font-medium">
               Recomendado: mesclar — somamos as quantidades e a grade num único item por (ref + cor).
               Isso evita criar várias OPs pequenas pra uma mesma combinação na produção.
             </p>
             <p className="mt-2 text-xs text-muted-foreground">
               Use "Manter separado" só se as caixas precisam mesmo ir pra destinos/lotes
               diferentes que justifiquem OPs distintas.
             </p>
           </AlertDialogDescription>
         </AlertDialogHeader>
         <AlertDialogFooter className="flex-col sm:flex-row gap-2">
           <AlertDialogCancel>Revisar itens</AlertDialogCancel>
           <Button
             variant="outline"
             onClick={() => {
               setShowDuplicateDialog(false);
               setConfirmedDuplicate(true);
               setTimeout(() => formRef.current?.requestSubmit(), 0);
             }}
           >
             Manter separado
           </Button>
           <AlertDialogAction onClick={() => {
             // Mescla: soma quantities + mescla grades por (ref + cor)
             const mergedMap = new Map<string, SaleOrderItemFormData>();
             items.forEach(item => {
               const key = `${item.reference_id}-${item.color || ''}`;
               if (!item.reference_id) {
                 mergedMap.set(`__nokey__${mergedMap.size}`, item);
                 return;
               }
               const existing = mergedMap.get(key);
               if (!existing) {
                 mergedMap.set(key, { ...item, grade: { ...(item.grade || {}) } });
                 return;
               }
               // Soma quantities
               existing.quantity = (Number(existing.quantity) || 0) + (Number(item.quantity) || 0);
               // Mescla grade JSONB somando por tamanho
               const eg = (existing.grade || {}) as Record<string, number>;
               const ig = (item.grade || {}) as Record<string, number>;
               for (const [size, qty] of Object.entries(ig)) {
                 eg[size] = (Number(eg[size]) || 0) + (Number(qty) || 0);
               }
               existing.grade = eg;
               // Preserva observação concatenando (pra manter rastreabilidade do split original)
               if (item.observation && !existing.observation?.includes(item.observation)) {
                 existing.observation = [existing.observation, item.observation].filter(Boolean).join(' / ');
               }
             });
             const merged = Array.from(mergedMap.values());
             setItems(merged);
             setShowDuplicateDialog(false);
             setConfirmedDuplicate(true);
             toast.success(`${items.length - merged.length} item(s) mesclado(s). Total agora: ${merged.length} item(s) únicos.`);
             setTimeout(() => formRef.current?.requestSubmit(), 0);
           }}>
             Mesclar duplicatas (recomendado)
           </AlertDialogAction>
         </AlertDialogFooter>
       </AlertDialogContent>
     </AlertDialog>
     </>
  );
}
