 import { useMemo, useEffect, useRef, useState, useCallback, Fragment } from 'react';
import { Plus, CircleNotch as Loader2, User, Truck, ClipboardText as ClipboardList, Info, Percent, CaretUpDown as ChevronsUpDown, CaretDown, Check, ClockCounterClockwise as History, Warning as AlertTriangle, CheckCircle as CheckCircle2, Calculator, Money as Banknote, Receipt, Package, Phone, EnvelopeSimple, CopySimple as Copy, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SaleOrderFormData, SaleOrderItemFormData, PACKAGING_MODE_LABELS, PACKAGING_MODE_CANONICAL, type PackagingMode, ORDER_TYPES } from '@/hooks/useSaleOrders';
import { volumesForPairs, pairsPerVolumeForMode, isPairAsVolumeMode, collectiveTypeForMode } from '@/lib/packagingPairsPerBox';
import { singleSizeMisfits } from '@/lib/boxPacking';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useContractors } from '@/hooks/useContractors';
import { DISPLAY_SECTORS, SECTOR_LABELS, type SectorKey } from '@/lib/sectors';
import { useClientCommercialDefaults } from '@/hooks/useEconomicGroup360';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import SaleOrderItemForm from './SaleOrderItemForm';
import { OrderStatusStepper } from '@/components/ui/order-status-stepper';
import { useQuery } from '@tanstack/react-query';
import { fetchClientPriceList, type PriceLookup } from '@/lib/mobile/clientContext';
import { fetchClientCreditExposure } from '@/lib/clientCreditExposure';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useFactoringConfigs } from '@/components/finance/FactoringTab';
import { useCompanies } from '@/hooks/useNfe';
import { useAllActiveReferenceMaterialVariants } from '@/hooks/useReferenceMaterialVariants';
import {
  calculateFactoringDiscount,
  parsePaymentConditionInstallments,
} from '@/lib/factoringCalc';
import { computeARSchedule } from '@/lib/saleOrderAR';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  /** Disparado no primeiro INPUT REAL do usuário (evento de DOM, não setState).
   *  É o que separa edição de hidratação programática — ver a nota no <form>. */
  onUserEdit?: () => void;
  isPending: boolean;
  submitLabel: string;
  packagingProductId?: string;
  onPackagingProductChange?: (id: string) => void;
  packagingQuantity?: number;
  onPackagingQuantityChange?: (qty: number) => void;
  onSaveStateAndNavigate?: () => void;
  /** "Copiar p/ novo PV" na barra de lote: recebe os índices selecionados e o
   *  pai (SaleOrderForm em modo edição) semeia /sales/new com esses itens +
   *  dados do cliente deste pedido. Ausente = botão não aparece (criação). */
  onCopyToNewOrder?: (indices: number[]) => void;
  /** "Excluir selecionados" na barra de lote: recebe os índices selecionados e o
   *  pai tira os itens da lista e oferece Desfazer. Ausente = botão não aparece.
   *  A guarda de "nunca excluir o último item" fica AQUI no painel, que é quem
   *  conhece a seleção. */
  onDeleteSelectedItems?: (indices: number[]) => void;
  /** Data mínima viável calculada (ISO yyyy-mm-dd). Quando delivery_deadline < esta data,
   *  exibe alerta vermelho persistente ao lado do campo. */
  minBillingISO?: string | null;
  /** True enquanto recalcula a data mínima (mostra spinner em vez de alerta). */
  computingMinBilling?: boolean;
  /** Reporta itens com cor não cadastrada — pra o pai BLOQUEAR o salvamento. */
  onColorIssueChange?: (index: number, info: { color: string; materials: string[] } | null) => void;
}

const emptyItem: SaleOrderItemFormData = {
  reference_id: '', color: '', grade: {}, unit_price: 0, quantity: 0, fichas: 1,
};

/**
 * Reindexa a seleção do bulk-edit depois que o item `removedIdx` sai da lista.
 * A seleção é guardada por ÍNDICE, e remover um item desloca todos os que vêm
 * depois — sem isto, a ação em lote (preço, fichas, grade, cópia pra novo PV)
 * cai em silêncio no item que PASSOU a ocupar aquele índice.
 */
export function remapSelectionAfterRemoval(selection: Set<number>, removedIdx: number): Set<number> {
  const next = new Set<number>();
  selection.forEach(i => {
    if (i === removedIdx) return;         // o próprio removido sai da seleção
    next.add(i > removedIdx ? i - 1 : i); // quem vinha depois desce uma posição
  });
  return next;
}

/** Item retirado da lista + de onde ele saiu, pro Desfazer devolver no lugar. */
export interface RemovedItemSnapshot {
  item: SaleOrderItemFormData;
  index: number;
}

/**
 * Tira de uma vez todos os itens dos índices dados. Devolve a lista restante e o
 * que saiu, com a posição original de cada um — é esse retrato que o "Desfazer"
 * usa. Índice repetido ou fora da lista é ignorado.
 */
export function removeItemsAtIndices(
  items: SaleOrderItemFormData[],
  indices: number[],
): { remaining: SaleOrderItemFormData[]; removed: RemovedItemSnapshot[] } {
  const alvo = new Set(indices);
  const remaining: SaleOrderItemFormData[] = [];
  const removed: RemovedItemSnapshot[] = [];
  items.forEach((item, i) => {
    if (alvo.has(i)) removed.push({ item, index: i });
    else remaining.push(item);
  });
  return { remaining, removed };
}

/**
 * Devolve os itens às posições de onde saíram (menor índice primeiro, pra cada
 * inserção não empurrar as seguintes).
 *
 * ⚠ A lista pode ter ENCOLHIDO entre a exclusão e o Desfazer — o usuário pode ter
 * apagado outro item nesse meio-tempo, e o toast fica aberto até ele fechar. Por
 * isso o índice é limitado ao tamanho atual em vez de virar buraco: melhor o item
 * voltar no fim da lista do que não voltar.
 */
export function restoreItemsAt(
  items: SaleOrderItemFormData[],
  removed: RemovedItemSnapshot[],
): SaleOrderItemFormData[] {
  const next = [...items];
  [...removed]
    .sort((a, b) => a.index - b.index)
    .forEach(({ item, index }) => next.splice(Math.min(index, next.length), 0, item));
  return next;
}

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
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
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
   isAdmin, selectedClientId, onClientSelect, onSubmit, onCancel, onUserEdit, isPending, submitLabel,
   packagingProductId, onPackagingProductChange, packagingQuantity: _packagingQuantity, onPackagingQuantityChange,
   onSaveStateAndNavigate, onCopyToNewOrder, onDeleteSelectedItems,
   minBillingISO, computingMinBilling, onColorIssueChange,
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
  // Terceirização planejada (Fase A): prestadores ativos pro picker de "mandar setor pra fora".
  const { data: allContractors = [] } = useContractors();
  const activeContractors = useMemo(() => allContractors.filter((c: any) => c.active !== false), [allContractors]);
  const selectedRep = representatives.find(r => r.id === form.representative);
  const selectedClient = clients.find(c => c.id === selectedClientId);
  const { data: factoringConfigs = [] } = useFactoringConfigs();
  const selectedFactoringConfig = factoringConfigs.find(c => c.id === form.factoring_config_id);
  // Empresas emitentes (CNPJs). Só mostramos o seletor quando há mais de uma —
  // com uma só, todo PV é da primária e o campo seria ruído. NULL = primária.
  const { data: companies = [] } = useCompanies();
  const primaryCompany = companies.find(c => c.is_primary);

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
  // Tabela de preço do cliente + teto de desconto — pra auto-aplicar o preço no
  // item e avisar quando o vendedor furar o desconto máximo. Reusa o lookup do
  // mobile (price_list_items via clients.price_list_id). Sem tabela → lookup
  // vazio → cai no sale_price da ficha (comportamento atual inalterado).
  const { data: clientPricing } = useQuery({
    queryKey: ['client_pricing_pv', selectedClientId],
    enabled: !!selectedClientId,
    queryFn: async () => {
      const lookup = await fetchClientPriceList(selectedClientId);
      const { data: c } = await supabase.from('clients').select('max_discount_pct').eq('id', selectedClientId).maybeSingle();
      return { lookup, maxDiscountPct: Number((c as { max_discount_pct?: number } | null)?.max_discount_pct) || 0 };
    },
  });

  const { data: creditExposure } = useQuery({
    queryKey: ['client_credit_exposure', selectedClientId],
    enabled: !!(selectedClientId && selectedClient?.credit_limit && selectedClient.credit_limit > 0),
    // Filtrava por `accounts_receivable.client_id`, que é NULO em 70 dos 72
    // títulos — a exposição vinha sempre R$ 0,00 e o aviso de limite nunca
    // acendia. Ver clientCreditExposure (o vínculo real é via sale_order_id).
    queryFn: () => fetchClientCreditExposure(selectedClientId),
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
  // A seleção do bulk-edit mora aqui em cima (e não junto do resto da barra de
  // lote) porque `removeItem` PRECISA reindexá-la — ver o comentário lá.
  const [selectedItemIndices, setSelectedItemIndices] = useState<Set<number>>(new Set());

  // ⚠ PERF: identidade ESTÁVEL é obrigatória nas funções passadas ao
  // SaleOrderItemForm — ele é `memo()` e uma arrow nova a cada render fura o memo,
  // re-renderizando TODOS os itens do PV a cada tecla digitada numa célula de grade.
  //
  // ⚠ A seleção é por ÍNDICE, e remover um item desloca todo mundo que vem depois:
  // sem reindexar, marcar os itens 1 e 3, apagar o 2 e mandar aplicar faria a ação
  // cair no item que PASSOU a ocupar o índice 3 — outro item, em silêncio. Vale pra
  // todas as ações em lote (preço, fichas, grade) e é grave na cópia pra novo PV,
  // que levaria a referência errada pro pedido novo.
  const removeItem = useCallback(
    (idx: number) => {
      setItems(prev => prev.filter((_, i) => i !== idx));
      setSelectedItemIndices(prev => (prev.size === 0 ? prev : remapSelectionAfterRemoval(prev, idx)));
      // Tirar item é alteração de verdade. O `onUserEdit` normalmente vem de evento
      // de INPUT, e clique em botão não emite input — sem esta chamada dava pra
      // apagar itens, tocar em Voltar e sair SEM aviso nenhum. A regra de "avisar
      // de menos" documentada no <form> vale pra sinal AMBÍGUO (Radix Select não
      // emite evento); clique na lixeira é intenção inequívoca, sem falso-positivo.
      onUserEdit?.();
    },
    [setItems, onUserEdit],
  );

  // `items` mais recente sem entrar na lista de dependências — é o que permite
  // copyGradeFromPrevious (logo abaixo de updateItem) ter identidade estável
  // apesar de precisar ler o item anterior.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

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

  // Estável de propósito (memo do SaleOrderItemForm): lê o item anterior via
  // itemsRef, então não precisa de `items` nas dependências.
  const copyGradeFromPrevious = useCallback((i: number) => {
    if (i <= 0) return;
    const prev = itemsRef.current[i - 1];
    if (!prev) return;
    updateItem(i, 'grade', { ...prev.grade });
    updateItem(i, 'fichas', prev.fichas || 1);
  }, [updateItem]);

   // ── Bulk-edit de itens (pedido user 20/05/2026) ─────────────────────────
   // Seleção múltipla de itens do PV pra aplicar mudanças em lote: copiar
   // grade do 1º item selecionado nos demais, aplicar preço unitário, ou
   // aplicar número de fichas. Reduz cliques quando o PV tem 5+ refs com
   // mesma grade/preço.
   // (o estado `selectedItemIndices` é declarado junto de removeItem, lá em cima)
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

   /**
    * Exclui os itens marcados. Sem diálogo de confirmação (decisão do dono): a
    * rede é o "Desfazer" do toast que o pai dispara.
    *
    * ⚠ A guarda do ÚLTIMO item mora aqui porque é o painel que conhece a seleção.
    * E ela avisa em vez de desabilitar o botão de propósito: no celular não existe
    * hover, então botão apagado sem explicação vira beco sem saída.
    */
   const deleteSelectedItems = useCallback(() => {
     const indices = Array.from(selectedItemIndices).sort((a, b) => a - b);
     if (indices.length === 0) return;
     if (indices.length >= items.length) {
       toast.error('O pedido precisa de pelo menos um item — desmarque um deles para excluir os demais.');
       return;
     }
     onUserEdit?.();
     onDeleteSelectedItems?.(indices);
     // Zera em vez de reindexar: os índices selecionados acabaram de sair da lista.
     setSelectedItemIndices(new Set());
   }, [selectedItemIndices, items.length, onDeleteSelectedItems, onUserEdit]);
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

  /**
   * Capacidade da caixa (pares por colmeia) e itens que NÃO fecham caixa cheia
   * por numeração — alimentam o controle "Caixa fechada por numeração".
   *
   * A capacidade vem do cadastro da ficha, a mesma que a NF usa pra contar
   * volumes; 12 é só o fallback de exibição quando a ficha ainda não tem caixa
   * cadastrada. Nunca fixar 12 na regra: solado com colmeia de 10 ou 16 existe.
   */
  const boxGroupingCapacity = useMemo(() => {
    const collType = collectiveTypeForMode(form.packaging_mode || 'colmeia');
    const caps = (sheetPackagingConfigs as any[])
      .filter(c => c.packaging_type === collType && Number(c.pairs_per_box) > 0)
      .map(c => Number(c.pairs_per_box));
    return caps.length > 0 ? Math.min(...caps) : 0;
  }, [sheetPackagingConfigs, form.packaging_mode]);

  const boxGroupingBlockers = useMemo(() => {
    const capacity = boxGroupingCapacity || 12;
    const problemas: string[] = [];
    for (const item of items) {
      if (!item.reference_id || !item.grade) continue;
      const fichas = Number(item.fichas) || 0;
      if (fichas <= 0) continue;
      const faltas = singleSizeMisfits({ grade: item.grade, fichas, capacity });
      if (faltas.length === 0) continue;
      const ref = references.find((r: any) => r.id === item.reference_id) as any;
      const rotulo = [ref?.code || ref?.name || 'item', item.color].filter(Boolean).join(' ');
      const f = faltas[0];
      problemas.push(`${rotulo}: o nº ${f.size} dá ${f.pairs} pares`);
    }
    return problemas;
  }, [items, boxGroupingCapacity, references]);

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
  const [shippingCalculatorOpen, setShippingCalculatorOpen] = useState(initialRate > 0);
  const [packagingDetailsOpen, setPackagingDetailsOpen] = useState(form.packaging_mode !== 'colmeia');

  const packagingVolumeSummary = useMemo(() => {
    const mode = form.packaging_mode || 'colmeia';
    const byRef = new Map<string, number>();
    items.forEach(item => {
      if (item.reference_id && item.quantity > 0) {
        byRef.set(item.reference_id, (byRef.get(item.reference_id) || 0) + item.quantity);
      }
    });
    const configByRef = new Map<string, number>();
    const collectiveType = collectiveTypeForMode(mode);
    sheetPackagingConfigs.forEach((config: any) => {
      if (config.packaging_type === collectiveType && Number(config.pairs_per_box) > 0) {
        configByRef.set(config.sheet_id, Number(config.pairs_per_box));
      }
    });
    let volumes = 0;
    for (const [referenceId, pairs] of byRef) {
      volumes += volumesForPairs(mode, pairs, configByRef.get(referenceId));
    }
    return {
      pairMode: isPairAsVolumeMode(mode),
      pairsPerVolume: pairsPerVolumeForMode(mode),
      volumes,
    };
  }, [form.packaging_mode, items, sheetPackagingConfigs]);

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

  // Auto-calculate packaging quantity based on pairs_per_package.
  // Default por MODO (12 p/ colmeia/master) quando a caixa não tem capacidade
  // cadastrada — antes caía em 1 par/caixa, divergindo da NF.
  const calcPackagingQty = (productId: string, pairs: number) => {
    const pkg = boxTypes.find(p => p.id === productId);
    const cadastrado = Number((pkg as any)?.pairs_per_box ?? (pkg as any)?.pairs_per_box_default) || 0;
    const ppp = pairsPerVolumeForMode(form.packaging_mode, cadastrado);
    return Math.ceil(pairs / Math.max(ppp, 1));
  };

  useEffect(() => {
    if (packagingProductId && onPackagingQuantityChange) {
      onPackagingQuantityChange(calcPackagingQty(packagingProductId, totalPairs));
    }
    // boxTypes is in deps because calcPackagingQty reads pairs_per_box from it.
    // Without this dep, when boxTypes loads asynchronously after first render,
    // pairs_per_box defaults to 1 and the wrong qty is set.
  }, [totalPairs, packagingProductId, boxTypes]);

   /**
    * Identidade produtiva de um item para fins de duplicata.
    *
    * Antes era só `reference_id + color`, e isso quebrava de duas formas ao
    * mesclar:
    *  • `material_variant_id` fora da chave — dois itens da mesma ref/cor mas de
    *    VARIANTES diferentes eram acusados de duplicados, e o merge herdava a
    *    variante do primeiro (spread de `{...item}`). Os pares do outro passavam
    *    a reservar, consumir e ser custeados no material errado.
    *  • `fichas` fora da chave — `grade` é POR FICHA (`totalPairs = gradeTotal ×
    *    fichas`), então somar grades de linhas com fichas diferentes é
    *    aritmeticamente inválido. O cliente e o trigger
    *    `tg_enforce_sale_order_item_qty` recalculam `quantity = fichas × Σgrade`
    *    com o `fichas` herdado, e a diferença sumia (ou inflava, se o primeiro
    *    item tivesse o `fichas` maior).
    *
    * Com os dois na chave, itens que diferem por variante ou por fichas deixam
    * de ser reportados como duplicados e nunca chegam ao merge. Itens realmente
    * idênticos continuam mesclando como antes.
    */
   const duplicateKey = (item: SaleOrderItemFormData) =>
     `${item.reference_id}-${item.color || ''}-${(item as any).material_variant_id || ''}-${item.fichas ?? 1}`;

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
       const key = duplicateKey(item);
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
     <form
       ref={formRef}
       onSubmit={handlePreSubmit}
       // Enter dentro de um <input> submete o form por padrão (submissão
       // implícita do HTML). Num PV isso disparava o gauntlet inteiro de save —
       // crédito, material, capacidade, data mínima — a partir de uma tecla
       // apertada no meio do preenchimento da grade. Só o Salvar salva.
       // Textarea preserva o Enter (quebra de linha).
       // (auditoria PV 07/08/2026)
       //
       // ⚠ NÃO reintroduzir atalho Ctrl/Cmd+Enter com `requestSubmit()`: chamado
       // sem submitter, ele dispara o evento submit direto no form e NÃO consulta
       // o botão — submete mesmo com o Salvar desabilitado, furando toda a
       // validação que este mesmo diff endureceu. Quem quiser salvar pelo teclado
       // tabula até o botão.
       // Marca "sujo" por EVENTO DE DOM, não por comparar snapshot do form.
       //
       // Snapshot não funciona aqui: os efeitos de hidratação (representante,
       // cliente) alteram `form` DEPOIS do load, então qualquer baseline tirado na
       // montagem nasceria diferente e todo PV seria "sujo". Um aviso que dispara
       // sempre treina o usuário a clicar "sair" sem ler, e aí ele não protege
       // nada. Evento de input só acontece quando alguém digita de verdade.
       //
       // ⚠ Lacuna conhecida: Radix Select (mês, semana, condição de pagamento) não
       // emite `input` nem `change` — mexer só neles não marca sujo. Preferi errar
       // para o lado de avisar de MENOS: falso-negativo perde um aviso, falso-
       // positivo destrói a confiança em todos os outros.
       onInput={onUserEdit}
       onChange={onUserEdit}
       onKeyDown={(e) => {
         if (e.key !== 'Enter') return;
         const el = e.target as HTMLElement;
         if (el?.tagName === 'TEXTAREA') return;
         // Deixa passar quem tem semântica própria de Enter (botão, link, opção
         // de combobox) — bloquear ali quebraria o teclado em vez de proteger.
         if (el?.closest('button, a, [role="option"], [role="combobox"], [contenteditable="true"]')) return;
         e.preventDefault();
       }}
       className="space-y-5 pb-40 sm:pb-24"
     >
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

              {/* Tipo de Pedido — natureza comercial (carteira / programado /
                  MTO / amostra / bonificação / troca / exportação). Paridade
                  Tutor32; persiste em sale_orders.order_type. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Tipo de Pedido</Label>
                  <Select value={form.order_type || 'carteira'} onValueChange={v => setForm(f => ({ ...f, order_type: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ORDER_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* CNPJ emitente: escolhe sob qual empresa o PV é faturado/etiquetado.
                    Só aparece quando há 2+ empresas cadastradas. NULL = primária. */}
                {companies.length > 1 && (
                  <div>
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">CNPJ Emitente (NF-e / etiqueta)</Label>
                    <Select
                      value={form.company_id || '__primary__'}
                      onValueChange={v => setForm(f => ({ ...f, company_id: v === '__primary__' ? null : v }))}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__primary__">
                          {(primaryCompany?.nome_fantasia || primaryCompany?.razao_social || 'Empresa principal')} (padrão)
                        </SelectItem>
                        {companies.filter(c => !c.is_primary).map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Terceirização planejada (Fase A): manda um SETOR deste pedido pra
                  fora (prestador), de propósito, pra evitar gargalo. Ao virar OP, o
                  trigger trg_apply_pv_outsourcing_to_op marca a OP (aparece no hub
                  Terceiros "Na Rua"). Guarda a CHAVE canônica do setor. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Terceirizar setor (evitar gargalo)</Label>
                  <Select
                    value={form.outsource_to_sector || '__none__'}
                    onValueChange={v => setForm(f => ({
                      ...f,
                      outsource_to_sector: v === '__none__' ? null : v,
                      outsource_to_contractor_id: v === '__none__' ? null : f.outsource_to_contractor_id,
                    }))}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Não terceirizar (fábrica)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Não terceirizar (fábrica)</SelectItem>
                      {DISPLAY_SECTORS.map(s => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.outsource_to_sector && (
                  <div>
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Prestador</Label>
                    <Select
                      value={form.outsource_to_contractor_id || ''}
                      onValueChange={v => setForm(f => ({ ...f, outsource_to_contractor_id: v || null }))}
                    >
                      <SelectTrigger className={cn('h-9', !form.outsource_to_contractor_id && 'border-amber-400 focus:ring-amber-400')}>
                        <SelectValue placeholder="Escolha o prestador..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeContractors.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum prestador ativo</div>
                        ) : activeContractors.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.service_type ? ` · ${c.service_type}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {form.outsource_to_sector && form.outsource_to_contractor_id && (
                <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <Truck className="h-3.5 w-3.5 shrink-0" />
                  <span>Este pedido sai pra <strong>{activeContractors.find((c: any) => c.id === form.outsource_to_contractor_id)?.name}</strong> no setor <strong>{SECTOR_LABELS[form.outsource_to_sector as SectorKey] ?? form.outsource_to_sector}</strong> — as OPs nascem já terceirizadas nesse setor.</span>
                </div>
              )}

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
                  onCheckedChange={(checked) => setForm(f => ({ ...f, nfe_required: !checked, nfe_external: false }))}
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

              {/* NF emitida por outra empresa — quando uma terceira empresa
                  do grupo/parceiro emite a nota fiscal, esse sistema não
                  precisa exigir NF-e autorizada pra expedir. Registra o
                  número da NF externa pra rastreabilidade fiscal. */}
              {form.nfe_required !== false && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                  <Checkbox
                    id="nfe_external_on"
                    checked={(form as any).nfe_external === true}
                    onCheckedChange={(checked) => setForm(f => ({ ...f, nfe_external: !!checked }))}
                    className="mt-0.5"
                  />
                  <div className="flex-1 -mt-0.5 space-y-2">
                    <Label htmlFor="nfe_external_on" className="text-xs font-bold cursor-pointer flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                      <Receipt className="h-3.5 w-3.5" />
                      NF emitida por outra empresa
                    </Label>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Marque quando a nota fiscal deste pedido é emitida por <strong>outra empresa do grupo / parceiro</strong>, fora deste sistema.
                      A expedição libera sem exigir NF-e autorizada interna. Status final: <strong>Expedido</strong>.
                    </p>
                    {(form as any).nfe_external === true && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Nº/Chave da NF externa (opcional, recomendado)</Label>
                        <Input
                          value={(form as any).external_nfe_number || ''}
                          onChange={e => setForm(f => ({ ...f, external_nfe_number: e.target.value } as any))}
                          placeholder="Ex.: 12345 ou chave 44-dígitos"
                          className="h-8 mt-1 font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
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

              {/* O campo aceita vírgula ou ponto porque type="number" rejeita
                  valores decimais válidos no teclado pt-BR. */}
              <Collapsible
                open={shippingCalculatorOpen}
                onOpenChange={setShippingCalculatorOpen}
                className="rounded-lg border border-border bg-muted/20"
              >
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <Calculator className="h-3.5 w-3.5 text-primary" />
                      Calculadora de Frete (Estimativa)
                    </span>
                    <span className="ml-auto flex min-w-0 items-center gap-2">
                      {shippingCalculatorOpen ? (
                        <Badge variant="secondary" className="text-xs">{totalPairs} pares</Badge>
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">
                          Frete: {formatCurrency(shippingRate)}/par · {formatCurrency(estimatedShippingCost)}
                        </span>
                      )}
                      <CaretDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', shippingCalculatorOpen && 'rotate-180')} />
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 px-3 pb-3">
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
                </CollapsibleContent>
              </Collapsible>

              {onPackagingProductChange && (
                <Collapsible
                  open={packagingDetailsOpen}
                  onOpenChange={setPackagingDetailsOpen}
                  className="mt-4 rounded-lg border border-border/50 bg-muted/20"
                >
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <Package className="h-3.5 w-3.5 text-primary" />
                        Embalagens das Fichas Técnicas
                      </span>
                      <span className="ml-auto flex min-w-0 items-center gap-2">
                        {!packagingDetailsOpen && (
                          <span className="truncate text-xs text-muted-foreground">
                            {packagingVolumeSummary.pairMode
                              ? '1 par/volume'
                              : `${packagingVolumeSummary.pairsPerVolume} pares/caixa`}
                            {' · '}{packagingVolumeSummary.volumes} {packagingVolumeSummary.volumes === 1 ? 'volume' : 'volumes'}
                          </span>
                        )}
                        <CaretDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', packagingDetailsOpen && 'rotate-180')} />
                      </span>
                    </button>
                </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 px-3 pb-3">
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

                  {/* ── Caixa fechada por numeração (decisão do dono, 11/08/2026) ──
                      No pedido tradicional a caixa leva a curva completa do cliente.
                      Alguns pedidos vão com a caixa cheia de UMA numeração só, o que
                      muda o rótulo de caixa externa.

                      ⚠ Só é permitido quando cada numeração fecha caixa cheia. É essa
                      condição que garante que o número de VOLUMES não muda — e por isso
                      NF-e e débito de embalagem seguem intactos. Sem ela, cada numeração
                      terminaria numa caixa pela metade (medido no PV-00144: 65 volumes
                      virando 68). */}
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                    <div className="min-w-0">
                      <Label htmlFor="box-grouping" className="text-xs font-bold uppercase tracking-wider">
                        Caixa fechada por numeração
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Cada caixa vai com {boxGroupingCapacity || 12} pares da mesma numeração,
                        em vez da grade completa. Muda o rótulo da caixa externa.
                      </p>
                      {boxGroupingBlockers.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1">
                          Não fecha caixa cheia: {boxGroupingBlockers.slice(0, 2).join('; ')}
                          {boxGroupingBlockers.length > 2 ? ` e mais ${boxGroupingBlockers.length - 2}` : ''}.
                        </p>
                      )}
                    </div>
                    <Switch
                      id="box-grouping"
                      checked={form.box_grouping === 'numeracao_unica'}
                      onCheckedChange={(on) => {
                        if (!on) { setForm(f => ({ ...f, box_grouping: 'grade' })); return; }
                        if (boxGroupingBlockers.length > 0) {
                          toast.error(
                            `Este pedido não fecha caixas de ${boxGroupingCapacity || 12} pares por numeração — ` +
                            `${boxGroupingBlockers[0]}. Ajuste a grade ou o número de fichas.`,
                            { duration: 10_000 },
                          );
                          return;
                        }
                        setForm(f => ({ ...f, box_grouping: 'numeracao_unica' }));
                      }}
                    />
                  </div>

                  {/* Resumo de volumes — espelha a NF (compute_sale_order_nfe_volumes):
                      total de pares ÷ pares-por-caixa do modo (12 padrão p/ colmeia/master).
                      Aparece SEMPRE, mesmo sem caixa cadastrada nas fichas — antes a tela
                      só mostrava "nenhuma embalagem", divergindo da NF. */}
                  {(() => {
                    const mode = form.packaging_mode;
                    const byRef = new Map<string, number>();
                    items.forEach(it => {
                      if (it.reference_id && it.quantity > 0) {
                        byRef.set(it.reference_id, (byRef.get(it.reference_id) || 0) + it.quantity);
                      }
                    });
                    const totalP = Array.from(byRef.values()).reduce((s, n) => s + n, 0);
                    if (totalP <= 0) return null;
                    // pares/caixa cadastrado por ficha (config do tipo do modo); senão default 12
                    const collType = collectiveTypeForMode(mode);
                    const cfgByRef = new Map<string, number>();
                    sheetPackagingConfigs.forEach((c: any) => {
                      if (c.packaging_type === collType && Number(c.pairs_per_box) > 0) {
                        cfgByRef.set(c.sheet_id, Number(c.pairs_per_box));
                      }
                    });
                    let volumes = 0;
                    for (const [refId, p] of byRef) volumes += volumesForPairs(mode, p, cfgByRef.get(refId));
                    const pairMode = isPairAsVolumeMode(mode);
                    const ppb = pairsPerVolumeForMode(mode);
                    return (
                      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">
                          {pairMode
                            ? `Cada par = 1 volume · ${totalP} pares`
                            : `${ppb} pares/caixa (padrão) · ${totalP} pares ÷ ${ppb}`}
                        </span>
                        <span className="font-mono font-semibold text-foreground whitespace-nowrap">
                          {volumes} {volumes === 1 ? 'volume' : 'volumes'}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Show packaging configs from technical sheets */}
                  {sheetPackagingConfigs.length > 0 && (
                    <div className="space-y-2">
                      <Label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground uppercase font-bold">
                        <Package className="h-3.5 w-3.5" /> Configurações por referência
                      </Label>
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
                            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-300">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span>Nenhuma embalagem do tipo selecionado configurada nas fichas técnicas.</span>
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
                    <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Nenhuma embalagem configurada nas fichas técnicas das referências selecionadas.</span>
                    </p>
                  )}
                  </CollapsibleContent>
                </Collapsible>
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
                  {selectedRep.phone && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" /> {selectedRep.phone}</p>}
                  {selectedRep.email && <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate"><EnvelopeSimple className="h-3.5 w-3.5 shrink-0" /> {selectedRep.email}</p>}
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
          // Cabeçalho de grupo: aparece no 1º item de cada referência, agrupando
          // visualmente as cores da mesma ref. Pedido user 11/06/2026.
          const isNewRefGroup = !!item.reference_id && !isSameRef;
          const groupRef = isNewRefGroup ? references.find((r) => r.id === item.reference_id) : null;
          const groupLabel = groupRef
            ? (groupRef.code && groupRef.code !== groupRef.name ? `${groupRef.code} · ${groupRef.name}` : (groupRef.code || groupRef.name || 'Referência'))
            : 'Referência';
          const groupColorCount = isNewRefGroup ? items.filter((i) => i.reference_id === item.reference_id).length : 0;
          return (
            <Fragment key={`${idx}-${item.reference_id}`}>
            {isNewRefGroup && (
              <div className="flex items-center gap-3 mt-4 mb-1 first:mt-0">
                <div className="h-px flex-1 bg-border" />
                <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {groupLabel}
                  <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">· {groupColorCount} {groupColorCount === 1 ? 'cor' : 'cores'}</span>
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <div
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
                onColorIssueChange={onColorIssueChange}
                references={references}
                canRemove={items.length > 1}
                isAdmin={isAdmin}
                priceLookup={clientPricing?.lookup}
                maxDiscountPct={clientPricing?.maxDiscountPct ?? 0}
                onUpdate={updateItem}
                onRemove={removeItem}
                onCopyGradeFromPrevious={copyGradeFromPrevious}
                onSaveStateAndNavigate={onSaveStateAndNavigate}
                isSelected={selectedItemIndices.has(idx)}
                onToggleSelect={toggleItemSelection}
              />
            </div>
            </Fragment>
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
          {/* Cópia parcial (só na edição): leva os itens selecionados pra um PV
              novo em Rascunho, aproveitando cliente + condições comerciais deste
              pedido. O pai decide o que viaja no seed — ver SaleOrderForm. */}
          {onCopyToNewOrder && (
            <div className="flex items-center border-l border-primary/30 pl-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCopyToNewOrder(Array.from(selectedItemIndices).sort((a, b) => a - b))}
                className="h-8 text-xs gap-1"
                title="Cria um novo PV em Rascunho com os itens selecionados, usando os dados do cliente deste pedido"
              >
                <Copy className="h-3.5 w-3.5" /> Copiar p/ novo PV
              </Button>
            </div>
          )}
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
            {/* Destrutivo fica ISOLADO no fim, com separador: "Limpar" (só
                desmarca) encostado em "Excluir" (apaga) é o par que mais gera
                clique errado. Sem confirmação por decisão do dono — a rede é o
                Desfazer do toast que o pai dispara. */}
            {onDeleteSelectedItems && (
              <div className="flex items-center border-l border-primary/30 pl-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={deleteSelectedItems}
                  className="h-8 text-xs gap-1 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="Remove do pedido as referências selecionadas"
                >
                  <Trash className="h-3.5 w-3.5" /> Excluir selecionados
                </Button>
              </div>
            )}
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
        // `issues` é calculado SEMPRE (antes só populava após o 1º submit).
        //
        // Aquilo produzia o pior estado possível: no form vazio, `issues` ficava
        // em zero e o rodapé mostrava o selo VERDE "Pronto" ao lado de um Salvar
        // morto — e o motivo, que morava num `title`, era fisicamente inalcançável
        // porque botão desabilitado tem `pointer-events-none` (ui/button.tsx).
        // Quem decide o que APARECE continua sendo `submitAttempted`, logo abaixo,
        // então o form vazio segue limpo. (auditoria PV 07/08/2026)
        const validItems = items.filter(i => i.reference_id);
        const validItemsCount = validItems.length;
        const factoringInvalid = form.is_factoring && !form.factoring_config_id;

        const issues: { type: 'error' | 'warning'; msg: string; field?: string }[] = [];
        if (!form.client_name) issues.push({ type: 'error', msg: 'Selecione um cliente antes de salvar', field: 'client_name' });
        if (validItemsCount === 0) issues.push({ type: 'error', msg: 'Adicione pelo menos um item com referência', field: 'items' });
        // Factoring passa a ser ERRO listado, não só um booleano solto: antes ele
        // desabilitava o Salvar sem nunca aparecer na lista de pendências.
        if (factoringInvalid) issues.push({ type: 'error', msg: 'Selecione qual factoring está antecipando o pedido' });
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
            // ⚠ WARNING, não error — e isto é deliberado.
            //
            // Com `submitDisabled` derivando de errors.length, marcar isto como
            // erro travaria PVs que já existem: medido em 08/08/2026, são 220
            // itens em 38 PVs com material_variant_id null, TODOS em referências
            // com 2+ variantes (o auto-preenchimento de SaleOrderItemForm só age
            // quando a referência tem exatamente uma). O admin abriria o
            // PV-2026-00089 só pra corrigir a observação e o Salvar nasceria
            // morto, sem saída a não ser escolher variante nos 11 itens — dado
            // que muda consumo e custeio de um PV já faturado.
            //
            // Diferente de cor e preço zero, que o handleSubmit JÁ validava
            // (SaleOrderForm.tsx:744/815) e o banco reforça em
            // tg_block_zero_unit_price, grupo de material nunca foi validado em
            // lugar nenhum. Bloquear agora seria regra nova disfarçada de
            // correção de UI.
            issues.push({ type: 'warning', msg: `Item ${i + 1}: sem grupo de material` });
          }
        });
        if (!form.payment_condition) issues.push({ type: 'warning', msg: 'Sem condição de pagamento' });
        if (!form.delivery_deadline) issues.push({ type: 'warning', msg: 'Sem prazo de entrega' });

        const errors = issues.filter(i => i.type === 'error');
        const warnings = issues.filter(i => i.type === 'warning');

        // ⚠ MUDANÇA: o Salvar agora deriva de `errors`. Antes o popover dizia
        // "Erros bloqueantes" e não bloqueava — cor faltando, preço zero e grupo
        // de material passavam do submit e voltavam como erro cru do Postgres.
        const submitDisabled = errors.length > 0 || isPending;
        const disabledReason = errors[0]?.msg;
        // "O usuário já começou" — usado para decidir quando mostrar a lista de
        // pendências. Ver a nota no JSX: `submitAttempted` não serve aqui, porque
        // com o botão desabilitado o submit nunca acontece.
        const formStarted = submitAttempted || !!form.client_name || validItemsCount > 0;

        return (
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur-md shadow-[0_-4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
            <div className="max-w-[var(--main-max,1600px)] mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
              {/* Resumo de totais — grid em mobile pra evitar squeeze, inline em sm+ */}
              <div className="grid grid-cols-3 sm:flex sm:items-center sm:gap-6 sm:flex-1 sm:min-w-0">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Itens</span>
                  <span className="font-mono font-bold text-base sm:text-lg tracking-tight leading-none tabular-nums">{validItemsCount}</span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-border" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pares</span>
                  <span className="font-mono font-bold text-base sm:text-lg tracking-tight leading-none tabular-nums">{totalPairs.toLocaleString('pt-BR')}</span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-border" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Valor Total</span>
                  <span className="font-mono font-bold text-base sm:text-xl text-primary tracking-tight leading-none tabular-nums">
                    {formatCurrency(totalValue + estimatedShippingCost)}
                  </span>
                  {estimatedShippingCost > 0 && (
                    <span className="text-xs text-muted-foreground font-mono mt-0.5 tabular-nums">
                      Mercadoria {formatCurrency(totalValue)} + Frete {formatCurrency(estimatedShippingCost)}
                    </span>
                  )}
                </div>
              </div>

              {/* Indicador de validação — meio */}
              <div className="flex items-center gap-2 justify-end sm:justify-start">
                {/* "Pronto" só quando REALMENTE não há pendência. Antes ele
                    aparecia no form vazio, porque `issues` só populava depois do
                    1º submit. Com pendência e o form ainda intocado, o slot fica
                    VAZIO — form novo continua limpo, mas não afirma o contrário.

                    ⚠ O gatilho é `formStarted`, NÃO `submitAttempted`. Com o
                    Salvar derivando de `errors.length`, havendo erro o botão está
                    desabilitado ⇒ o evento submit nunca dispara ⇒ `submitAttempted`
                    nunca vira true ⇒ o popover com a lista completa de pendências
                    seria inalcançável, e o usuário ficaria só com o 1º erro ao
                    lado do botão, sem como ver os outros. */}
                {issues.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Pronto
                  </span>
                ) : !formStarted ? null : (
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
                {/* Motivo VISÍVEL do bloqueio. O `title` continua para leitor de
                    tela, mas sozinho ele era inútil: `disabled:pointer-events-none`
                    (ui/button.tsx) impede o hover, então a tooltip nunca abria e o
                    usuário ficava com um Salvar morto e nenhuma explicação. */}
                {disabledReason && !isPending && (
                  <span className="hidden sm:inline text-xs text-muted-foreground max-w-[240px] text-right leading-tight">
                    {disabledReason}
                  </span>
                )}
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
              {/* Em telas estreitas o motivo vai abaixo, onde há largura. */}
              {disabledReason && !isPending && (
                <span className="sm:hidden text-xs text-muted-foreground leading-tight">
                  {disabledReason}
                </span>
              )}
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
           <AlertDialogDescription asChild>
             <div className="text-sm text-muted-foreground">
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
             </div>
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
             // Mescla: soma quantities + mescla grades por identidade produtiva
             // (ref + cor + variante de material + fichas — ver duplicateKey).
             // A chave TEM que ser a mesma da detecção, senão o diálogo acusa uma
             // duplicata que o merge não junta (ou junta o que não devia).
             const mergedMap = new Map<string, SaleOrderItemFormData>();
             items.forEach(item => {
               const key = duplicateKey(item);
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
             setItems(() => merged);
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
