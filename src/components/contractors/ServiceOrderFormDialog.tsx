import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Buildings, Calendar, CaretDown, CheckCircle,
  CurrencyDollar, Handshake, Needle, PaperPlaneTilt, Path, Warning,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useContractors } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import { SERVICE_ORDER_SECTORS, serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';
import { opNumberByPvItem, opNumbersForServiceOrder, type OpRef } from '@/lib/serviceOrderOps';
import {
  CONTRACTOR_SERVICE_FOCUS_META,
  contractorServicePriority,
  getContractorServiceFocus,
} from '@/lib/contractorServiceFocus';
import { formatCurrency, cn } from '@/lib/utils';

/**
 * Assistente canônico para criar uma OS avulsa.
 *
 * A OS avulsa é independente de PV/OP, mas segue a mesma disciplina do fluxo
 * por pedido: rota de serviço → prestador e valores → conferência. Costura de
 * cabedal e Aviamento aparecem primeiro; os demais serviços ficam disponíveis
 * sem competir com o lançamento diário mais frequente.
 *
 * ⚠ A OS não debita estoque. O consumo de material tem UM dono: o ledger da OP.
 * A OS avulsa nasce com rastreamento de remessa e só entra "na rua" quando a
 * saída for registrada no fluxo operacional.
 */

export interface ServiceOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContractorId?: string;
  initialSector?: string;
  onCreated?: (serviceOrderId: string) => void;
  saleOrderId?: string;
  saleOrderLabel?: string;
  pvItems?: { id: string; label: string; pairs: number }[];
}

const STEPS = ['Serviço', 'Prestador e valores', 'Conferência'] as const;
const todayISO = () => new Date().toISOString().slice(0, 10);

const SORTED_SECTORS = [...SERVICE_ORDER_SECTORS].sort((left, right) => (
  contractorServicePriority(left.value, left.label) - contractorServicePriority(right.value, right.label)
  || left.label.localeCompare(right.label, 'pt-BR')
));

const PRIMARY_SECTORS = SORTED_SECTORS.filter((item) => {
  const focus = getContractorServiceFocus(item.value, item.label);
  return focus === 'costura_cabedal' || focus === 'aviamento';
});

const OTHER_SECTORS = SORTED_SECTORS.filter((item) => !PRIMARY_SECTORS.includes(item));

export function ServiceOrderFormDialog({
  open, onOpenChange, initialContractorId, initialSector, onCreated,
  saleOrderId, saleOrderLabel, pvItems,
}: ServiceOrderFormDialogProps) {
  const queryClient = useQueryClient();
  const { data: contractors = [] } = useContractors();

  const [step, setStep] = useState(0);
  const [contractorId, setContractorId] = useState('');
  const [sector, setSector] = useState('costura');
  const [description, setDescription] = useState('');
  const [serviceDate, setServiceDate] = useState(todayISO());
  const [quotedDeadline, setQuotedDeadline] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const [notes, setNotes] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showOtherServices, setShowOtherServices] = useState(false);

  const activeContractors = useMemo(
    () => contractors.filter((contractor) => contractor.active),
    [contractors],
  );
  const activeContractorIds = useMemo(
    () => new Set(activeContractors.map((contractor) => contractor.id)),
    [activeContractors],
  );
  const selectedContractor = activeContractors.find((contractor) => contractor.id === contractorId);
  const paymentDays = Number(selectedContractor?.payment_days ?? 30) || 30;
  const selectedSectorLabel = serviceOrderSectorLabel(sector);

  const contractorOptions: SearchableOption[] = useMemo(() => activeContractors.map((contractor) => ({
    value: contractor.id,
    label: contractor.trade_name || contractor.name,
    description: contractor.service_type || undefined,
    keywords: `${contractor.name} ${contractor.trade_name || ''} ${contractor.service_type || ''}`,
  })), [activeContractors]);

  const { data: tableRate, isFetching: loadingRate } = useQuery({
    queryKey: ['contractor_rate', contractorId, sector, serviceDate],
    enabled: open && !!contractorId && !!sector,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_contractor_rate', {
        p_contractor_id: contractorId,
        p_sector: sector,
        p_date: serviceDate || todayISO(),
      });
      if (error) throw error;
      return data != null ? Number(data) : null;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open && tableRate != null && tableRate > 0) setUnitPrice(tableRate);
  }, [tableRate, open]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setContractorId(initialContractorId || '');
    setSector(initialSector || 'costura');
    setServiceDate(todayISO());
    setQuotedDeadline('');
    setUnitPrice(0);
    setNotes('');
    setDescription('');
    setShowOtherServices(false);
    if (pvItems?.length) {
      setSelectedItemIds(new Set(pvItems.map((item) => item.id)));
      setQuantity(pvItems.reduce((sum, item) => sum + (Number(item.pairs) || 0), 0));
    } else {
      setSelectedItemIds(new Set());
      setQuantity(0);
    }
  }, [open, initialContractorId, initialSector, pvItems]);

  useEffect(() => {
    if (!open || !contractorId || activeContractorIds.size === 0) return;
    if (!activeContractorIds.has(contractorId)) setContractorId('');
  }, [activeContractorIds, contractorId, open]);

  const toggleItem = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedItemIds(next);
    setQuantity((pvItems || [])
      .filter((item) => next.has(item.id))
      .reduce((sum, item) => sum + (Number(item.pairs) || 0), 0));
  };

  const selectedPvItems = useMemo(
    () => (pvItems || []).filter((item) => selectedItemIds.has(item.id)),
    [pvItems, selectedItemIds],
  );

  const { data: pvOps = [] } = useQuery({
    queryKey: ['pv_ops_for_os', saleOrderId],
    enabled: open && !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, sale_order_item_id, sale_order_id, status')
        .eq('sale_order_id', saleOrderId as string);
      if (error) throw error;
      return (data || []) as OpRef[];
    },
    staleTime: 60_000,
  });
  const opByItem = useMemo(() => opNumberByPvItem(pvOps), [pvOps]);
  const selectedOpNumbers = useMemo(
    () => opNumbersForServiceOrder(pvOps, selectedPvItems.map((item) => item.id), saleOrderId),
    [pvOps, selectedPvItems, saleOrderId],
  );

  const totalValue = quantity * unitPrice;
  const deadlineInvalid = !!quotedDeadline && !!serviceDate && quotedDeadline < serviceDate;
  const canAdvanceService = !!sector && (!pvItems?.length || selectedPvItems.length > 0);
  const canReview = !!selectedContractor
    && !!serviceDate
    && quantity > 0
    && unitPrice > 0
    && !deadlineInvalid;
  const canSubmit = canAdvanceService && canReview;
  const rateOverridden = tableRate != null
    && tableRate > 0
    && Math.abs(unitPrice - tableRate) > 0.004;

  const paymentForecast = useMemo(() => {
    if (!quotedDeadline) return null;
    const date = new Date(`${quotedDeadline}T00:00:00`);
    date.setDate(date.getDate() + paymentDays);
    return date.toLocaleDateString('pt-BR');
  }, [paymentDays, quotedDeadline]);

  const selectSector = (value: string) => {
    setSector(value);
    setUnitPrice(0);
  };

  const selectContractor = (value: string) => {
    setContractorId(value);
    setUnitPrice(0);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!canSubmit || !selectedContractor) {
        throw new Error('Revise serviço, prestador, quantidade, valor e datas antes de criar a OS.');
      }

      const orderNumber = await generateServiceOrderNumber();
      const payload = {
        contractor_id: selectedContractor.id,
        order_number: orderNumber,
        description: description.trim(),
        service_date: serviceDate,
        quoted_deadline: quotedDeadline || null,
        target_sector: sector,
        sector,
        quantity,
        unit_price: unitPrice,
        total_value: totalValue,
        status: 'Pendente',
        notes: notes.trim() || null,
        quoted_at: quotedDeadline ? new Date().toISOString() : null,
        sale_order_id: saleOrderId || null,
        source_sale_order_id: saleOrderId || null,
        selected_sale_order_item_ids: saleOrderId
          ? selectedPvItems.map((item) => item.id)
          : null,
        is_avulsa: !saleOrderId,
        dispatch_tracked: true,
      };

      const { data: inserted, error } = await supabase
        .from('service_orders')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return inserted.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['service_orders'] });
      queryClient.invalidateQueries({ queryKey: ['service_order_overview'] });
      queryClient.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      toast.success(saleOrderId ? 'Ordem de serviço criada.' : 'OS avulsa criada e pronta para expedição.');
      onCreated?.(id);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Falha ao criar OS.');
    },
  });

  const renderSectorCard = (item: { value: string; label: string }, primary: boolean) => {
    const focus = getContractorServiceFocus(item.value, item.label);
    const selected = sector === item.value;
    const RouteIcon = focus === 'costura_cabedal' ? Needle
      : focus === 'aviamento' ? Path
      : Handshake;
    const description = focus === 'costura_cabedal' || focus === 'aviamento'
      ? CONTRACTOR_SERVICE_FOCUS_META[focus].description
      : 'Serviço eventual fora da rota principal da fábrica.';

    return (
      <button
        key={item.value}
        type="button"
        aria-pressed={selected}
        onClick={() => selectSector(item.value)}
        className={cn(
          'group flex min-h-[92px] w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
          selected
            ? 'border-primary bg-primary/5 shadow-sm'
            : primary
              ? 'border-primary/20 bg-card hover:border-primary/45 hover:bg-primary/5'
              : 'border-border bg-card hover:bg-muted/35',
        )}
      >
        <span className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted/40 text-muted-foreground',
        )}>
          <RouteIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">{item.label}</span>
            {selected && <CheckCircle className="h-4 w-4 shrink-0 text-primary" weight="fill" />}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{description}</span>
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border bg-muted/25 px-5 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/25 bg-card font-mono text-[10px] uppercase tracking-wider text-primary">
              Expedição externa
            </Badge>
            {!saleOrderId && <Badge variant="secondary" className="font-mono text-[10px] uppercase">Sem PV / OP</Badge>}
          </div>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl uppercase tracking-tight">
            <Buildings className="h-5 w-5 text-primary" />
            {saleOrderLabel ? `Gerar OS · ${saleOrderLabel}` : 'Criar OS avulsa'}
          </DialogTitle>
          <DialogDescription className="max-w-3xl text-sm">
            {saleOrderId
              ? 'Escolha o serviço, confirme o prestador e revise o envio antes de criar a OS vinculada.'
              : 'Para um serviço independente de pedido: escolha a rota, informe a cobrança e confira antes de enviar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/25 p-1.5">
            {STEPS.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'active' : 'future';
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => index < step && setStep(index)}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                    state === 'active' && 'bg-card shadow-sm',
                    index < step ? 'cursor-pointer hover:bg-card/70' : 'cursor-default',
                  )}
                >
                  <span className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    state === 'active' ? 'bg-primary text-primary-foreground'
                      : state === 'done' ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {state === 'done' ? <CheckCircle className="h-4 w-4" weight="fill" /> : index + 1}
                  </span>
                  <span className={cn(
                    'truncate text-xs',
                    state === 'active' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-[390px] px-5 py-4">
          {step === 0 && (
            <div className="space-y-4">
              <section className="space-y-2.5" aria-labelledby="standalone-primary-route">
                <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p id="standalone-primary-route" className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                      <PaperPlaneTilt className="h-3.5 w-3.5" /> Rota principal
                    </p>
                    <p className="mt-1 text-sm font-semibold">Costura de cabedal e Aviamento primeiro</p>
                    <p className="text-[11px] text-muted-foreground">Selecione o serviço que sairá da fábrica.</p>
                  </div>
                  <Badge variant="outline" className="w-fit border-primary/25 bg-card font-mono text-[10px] text-primary">
                    2 serviços frequentes
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PRIMARY_SECTORS.map((item) => renderSectorCard(item, true))}
                </div>
              </section>

              {OTHER_SECTORS.length > 0 && (
                <section className="space-y-2.5 border-t border-border pt-4" aria-labelledby="standalone-other-services">
                  <button
                    id="standalone-other-services"
                    type="button"
                    onClick={() => setShowOtherServices((value) => !value)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-3 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2.5">
                      <Handshake className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-semibold">Outros serviços</p>
                        <p className="text-[11px] text-muted-foreground">{OTHER_SECTORS.length} opções eventuais · abrir somente quando necessário</p>
                      </div>
                    </div>
                    <CaretDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showOtherServices && 'rotate-180')} />
                  </button>
                  {showOtherServices && (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {OTHER_SECTORS.map((item) => renderSectorCard(item, false))}
                    </div>
                  )}
                </section>
              )}

              {pvItems && pvItems.length > 0 && (
                <section className="space-y-2 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Escopo do pedido · {saleOrderLabel || 'PV'}
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">{selectedPvItems.length}/{pvItems.length} itens</span>
                  </div>
                  <div className="space-y-1.5">
                    {pvItems.map((item) => {
                      const selected = selectedItemIds.has(item.id);
                      const opNumber = opByItem.get(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => toggleItem(item.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                            selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20 hover:bg-muted/40',
                          )}
                        >
                          <span className={cn(
                            'grid h-4 w-4 place-items-center rounded border text-[10px] leading-none text-white',
                            selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                          )}>{selected ? '✓' : ''}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{opNumber || 'sem OP'}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.pairs.toLocaleString('pt-BR')} pares</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-4">
                <section className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">01 · Prestador ativo</p>
                      <p className="mt-1 text-sm font-semibold">Quem executará {selectedSectorLabel}</p>
                    </div>
                    <Badge variant="secondary" className="font-mono text-[10px]">{activeContractors.length} ativos</Badge>
                  </div>
                  <Label className="text-xs">Prestador *</Label>
                  <SearchableSelect
                    value={contractorId}
                    onChange={selectContractor}
                    options={contractorOptions}
                    placeholder="Selecionar prestador ativo..."
                    searchPlaceholder="Buscar por nome ou serviço..."
                    emptyText="Nenhum prestador ativo encontrado."
                    heading="Prestadores ativos"
                    icon={<Buildings className="h-4 w-4" />}
                    className="mt-1 h-10"
                  />
                  {activeContractors.length === 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <Warning className="h-3.5 w-3.5" /> Ative ou cadastre um prestador antes de criar a OS.
                    </p>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">02 · Escopo e agenda</p>
                  <div className="mt-3">
                    <Label className="text-xs">Descrição (opcional)</Label>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Ex.: costura do lote piloto, aplicação de enfeites, retrabalho específico..."
                      rows={2}
                      className="mt-1 text-sm"
                    />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="flex items-center gap-1 text-xs"><Calendar className="h-3 w-3" /> Data do envio *</Label>
                      <Input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} className="mt-1 h-9" />
                    </div>
                    <div>
                      <Label className="flex items-center gap-1 text-xs"><Calendar className="h-3 w-3" /> Prazo prometido</Label>
                      <Input
                        type="date"
                        value={quotedDeadline}
                        min={serviceDate || todayISO()}
                        onChange={(event) => setQuotedDeadline(event.target.value)}
                        className="mt-1 h-9"
                      />
                      {deadlineInvalid && <p className="mt-1 text-[11px] text-destructive">O prazo não pode ser anterior ao envio.</p>}
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label className="text-xs">Observações internas (opcional)</Label>
                    <Textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Lote, instruções de conferência ou combinação com o prestador."
                      rows={2}
                      className="mt-1 text-sm"
                    />
                  </div>
                </section>
              </div>

              <aside className="h-fit rounded-lg border border-border bg-muted/25 p-4 lg:sticky lg:top-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">03 · Cobrança</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <Label className="text-xs">Quantidade (pares) *</Label>
                    <NumberInput value={quantity} onChange={setQuantity} step="1" min={0} className="mt-1 h-9" />
                  </div>
                  <div>
                    <Label className="flex items-center gap-1 text-xs"><CurrencyDollar className="h-3 w-3" /> Valor por par *</Label>
                    <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="mt-1 h-9" />
                    {loadingRate && <p className="mt-1 text-[11px] text-muted-foreground">Buscando tarifa vigente...</p>}
                    {rateOverridden && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        Fora da tabela: vigente {formatCurrency(tableRate || 0)}
                      </p>
                    )}
                    {contractorId && !loadingRate && (tableRate == null || tableRate <= 0) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Sem tarifa cadastrada para este serviço.</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total calculado</p>
                  <p className="mt-1 font-display text-3xl leading-none text-foreground">{formatCurrency(totalValue)}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {quantity.toLocaleString('pt-BR')} pares × {formatCurrency(unitPrice)}
                  </p>
                </div>
              </aside>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/25 p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Serviço e prestador</p>
                  <p className="mt-1 text-sm font-semibold">{selectedSectorLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">{selectedContractor?.trade_name || selectedContractor?.name || '—'}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/25 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Quantidade</p>
                  <p className="mt-1 font-display text-3xl leading-none">{quantity.toLocaleString('pt-BR')}</p>
                  <p className="text-[11px] text-muted-foreground">pares</p>
                </div>
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-primary">Total da OS</p>
                  <p className="mt-1 font-display text-2xl leading-none">{formatCurrency(totalValue)}</p>
                  <p className="text-[11px] text-muted-foreground">{formatCurrency(unitPrice)} / par</p>
                </div>
              </div>

              <section className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Comprovante de conferência</p>
                    <p className="mt-1 text-sm font-semibold">Revise o que será gravado</p>
                  </div>
                  <Badge className="gap-1.5 bg-green-600 text-white hover:bg-green-600">
                    <CheckCircle className="h-3.5 w-3.5" weight="fill" /> Pronto
                  </Badge>
                </div>
                <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Origem</p>
                    <p className="mt-1 text-sm">{saleOrderLabel || 'OS avulsa · sem PV/OP'}</p>
                    {selectedOpNumbers.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-primary">{selectedOpNumbers.join(', ')}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Agenda</p>
                    <p className="mt-1 text-sm">Envio {new Date(`${serviceDate}T00:00:00`).toLocaleDateString('pt-BR')}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {quotedDeadline
                        ? `Prazo ${new Date(`${quotedDeadline}T00:00:00`).toLocaleDateString('pt-BR')}`
                        : 'Prazo ainda não combinado'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{description.trim() || 'Sem descrição adicional.'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Financeiro previsto</p>
                    <p className="mt-1 text-sm">{paymentForecast ? `~${paymentForecast}` : 'Após conferência do retorno'}</p>
                    <p className="text-[11px] text-muted-foreground">{paymentDays} dias conforme cadastro do prestador</p>
                  </div>
                  {notes.trim() && (
                    <div className="sm:col-span-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Observações internas</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{notes.trim()}</p>
                    </div>
                  )}
                </div>
              </section>

              <div className="flex gap-2 rounded-lg border border-green-500/25 bg-green-500/10 p-3 text-xs text-green-800 dark:text-green-300">
                <PaperPlaneTilt className="mt-0.5 h-4 w-4 shrink-0" />
                <span>A OS será criada como <strong>Pendente</strong>. Registre a remessa depois para colocá-la “na rua”; nenhum estoque será debitado nesta criação.</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-muted/20 px-5 py-3 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={create.isPending}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Voltar
              </Button>
            )}
            {step === 0 && (
              <Button onClick={() => setStep(1)} disabled={!canAdvanceService}>
                Definir prestador <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
            {step === 1 && (
              <Button onClick={() => setStep(2)} disabled={!canReview}>
                Conferir OS <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
            {step === 2 && (
              <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
                <PaperPlaneTilt className="mr-1.5 h-3.5 w-3.5" />
                {create.isPending ? 'Criando...' : saleOrderId ? 'Criar OS' : 'Criar OS avulsa'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
