import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, CaretDown, CheckCircle, CurrencyDollar, Handshake, ListChecks,
  Needle, Package, PaperPlaneTilt, Path, Scissors, Storefront, Warning,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import {
  CONTRACTOR_SERVICE_FOCUS_META,
  contractorServicePriority,
  getContractorServiceFocus,
} from '@/lib/contractorServiceFocus';
import { useContractors } from '@/hooks/useContractors';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import {
  usePvOutsourceableLines, useGenerateOpServiceOrders, fetchContractorRate,
  type OutsourceableLine,
} from '@/hooks/useGenerateOpServiceOrders';

/**
 * Assistente Pedido → Serviços/OPs → Conferência.
 *
 * A rota principal da fábrica é Costura de cabedal + Aviamento. Os demais
 * serviços continuam disponíveis, mas ficam numa área secundária para não
 * transformar o lançamento diário em uma varredura de setores irrelevantes.
 * Cada OS nasce atrelada à OP correta, uma por (OP × setor).
 */

export interface GenerateServiceOrdersWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PV pré-selecionado (ex.: abrir a partir da tela do pedido). */
  initialSaleOrderId?: string;
  onGenerated?: () => void;
}

interface ServiceGroup {
  sector: string;
  label: string;
  lines: OutsourceableLine[];
  primary: boolean;
}

interface ChosenLine {
  line: OutsourceableLine;
  contractorId: string;
  rate: number;
  qty: number;
  ready: boolean;
}

const keyOf = (line: { order_id: string; sector: string }) => `${line.order_id}::${line.sector}`;
const STEPS = ['Pedido', 'Serviços e OPs', 'Conferência'] as const;

export function GenerateServiceOrdersWizard({
  open, onOpenChange, initialSaleOrderId, onGenerated,
}: GenerateServiceOrdersWizardProps) {
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: contractors = [] } = useContractors();
  const generate = useGenerateOpServiceOrders();

  const [step, setStep] = useState(0);
  const [saleOrderId, setSaleOrderId] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});
  const [contractorBySector, setContractorBySector] = useState<Record<string, string>>({});
  const [rateBySector, setRateBySector] = useState<Record<string, number>>({});
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({});
  const [showOtherServices, setShowOtherServices] = useState(false);

  const { data: lines = [], isLoading: loadingLines } = usePvOutsourceableLines(saleOrderId || null);

  useEffect(() => {
    if (!open) return;
    setStep(initialSaleOrderId ? 1 : 0);
    setSaleOrderId(initialSaleOrderId || '');
    setSelectedKeys(new Set());
    setQtyByKey({});
    setContractorBySector({});
    setRateBySector({});
    setOpenSectors({});
    setShowOtherServices(false);
  }, [open, initialSaleOrderId]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setQtyByKey({});
    setContractorBySector({});
    setRateBySector({});
    setOpenSectors({});
    setShowOtherServices(false);
  }, [saleOrderId]);

  const groups = useMemo<ServiceGroup[]>(() => {
    const map = new Map<string, OutsourceableLine[]>();
    for (const line of lines) {
      if (!map.has(line.sector)) map.set(line.sector, []);
      map.get(line.sector)!.push(line);
    }
    return [...map.entries()]
      .map(([sector, serviceLines]) => {
        const label = serviceLines[0].sector_label;
        const focus = getContractorServiceFocus(sector, label);
        return {
          sector,
          label,
          lines: serviceLines,
          primary: focus === 'costura_cabedal' || focus === 'aviamento',
        };
      })
      .sort((a, b) => (
        contractorServicePriority(a.sector, a.label) - contractorServicePriority(b.sector, b.label)
        || a.label.localeCompare(b.label, 'pt-BR')
      ));
  }, [lines]);

  const primaryGroups = useMemo(() => groups.filter((group) => group.primary), [groups]);
  const otherGroups = useMemo(() => groups.filter((group) => !group.primary), [groups]);
  const activeContractorIds = useMemo(
    () => new Set(contractors.filter((contractor) => contractor.active).map((contractor) => contractor.id)),
    [contractors],
  );

  useEffect(() => {
    if (!groups.length) return;
    setContractorBySector((previous) => {
      const next = { ...previous };
      for (const group of groups) {
        if (next[group.sector] && activeContractorIds.has(next[group.sector])) continue;
        delete next[group.sector];
        const withDefault = group.lines.find((line) => (
          line.default_contractor_id && activeContractorIds.has(line.default_contractor_id)
        ));
        if (withDefault?.default_contractor_id) next[group.sector] = withDefault.default_contractor_id;
      }
      return next;
    });
    setRateBySector((previous) => {
      const next = { ...previous };
      for (const group of groups) {
        if (next[group.sector] != null) continue;
        const withRate = group.lines.find((line) => line.default_rate != null && Number(line.default_rate) > 0);
        if (withRate?.default_rate != null) next[group.sector] = Number(withRate.default_rate);
      }
      return next;
    });
    setOpenSectors((previous) => {
      if (Object.keys(previous).length) return previous;
      const route = primaryGroups.length ? primaryGroups : groups.slice(0, 1);
      return Object.fromEntries(route.map((group) => [group.sector, true]));
    });
  }, [activeContractorIds, groups, primaryGroups]);

  const opAgg = useMemo(() => {
    const result = new Map<string, number>();
    for (const line of lines) if (!result.has(line.order_id)) result.set(line.order_id, line.quantity);
    return result;
  }, [lines]);

  const pvOptions: SearchableOption[] = useMemo(() => saleOrders
    .filter((saleOrder) => !['Cancelado', 'cancelado', 'Rascunho'].includes(saleOrder.status))
    .map((saleOrder) => ({
      value: saleOrder.id,
      label: `${saleOrder.order_number || 'PV'}${saleOrder.client_name ? ` · ${saleOrder.client_name}` : ''}`,
      description: [
        saleOrder.status,
        saleOrder.delivery_deadline
          ? `entrega ${new Date(saleOrder.delivery_deadline + 'T00:00:00').toLocaleDateString('pt-BR')}`
          : null,
      ].filter(Boolean).join(' · '),
      keywords: `${saleOrder.order_number} ${saleOrder.client_name || ''} ${saleOrder.client_cnpj || ''}`,
    })), [saleOrders]);

  // Prestador inativo continua no histórico, mas nunca pode receber uma OS nova.
  const contractorOptions: SearchableOption[] = useMemo(() => contractors
    .filter((contractor) => contractor.active)
    .map((contractor) => ({
      value: contractor.id,
      label: contractor.trade_name || contractor.name,
      description: contractor.service_type || undefined,
      keywords: `${contractor.name} ${contractor.trade_name || ''} ${contractor.service_type || ''}`,
    })), [contractors]);

  const isEligible = (line: OutsourceableLine) => !line.already_has_os;
  const qtyOf = (line: OutsourceableLine) => qtyByKey[keyOf(line)] ?? line.quantity;

  const toggleOp = (line: OutsourceableLine) => {
    if (!isEligible(line)) return;
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      const key = keyOf(line);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleServiceAll = (sector: string) => {
    const group = groups.find((candidate) => candidate.sector === sector);
    if (!group) return;
    const eligible = group.lines.filter(isEligible);
    const allOn = eligible.length > 0 && eligible.every((line) => selectedKeys.has(keyOf(line)));
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      for (const line of eligible) {
        if (allOn) next.delete(keyOf(line)); else next.add(keyOf(line));
      }
      return next;
    });
  };

  const onContractorChange = async (sector: string, contractorId: string) => {
    setContractorBySector((previous) => ({ ...previous, [sector]: contractorId }));
    if (!contractorId) return;
    const rate = await fetchContractorRate(contractorId, sector);
    if (rate != null && rate > 0) {
      setRateBySector((previous) => ({ ...previous, [sector]: rate }));
    }
  };

  const chosen = useMemo<ChosenLine[]>(() => {
    const result: ChosenLine[] = [];
    for (const group of groups) {
      const contractorId = contractorBySector[group.sector] || '';
      const rate = rateBySector[group.sector] ?? 0;
      for (const line of group.lines) {
        if (!selectedKeys.has(keyOf(line))) continue;
        const qty = qtyOf(line);
        result.push({ line, contractorId, rate, qty, ready: !!contractorId && rate > 0 && qty > 0 });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedKeys, qtyByKey, contractorBySector, rateBySector]);

  const ready = chosen.filter((item) => item.ready);
  const blockedCount = chosen.length - ready.length;
  const totalPairs = ready.reduce((sum, item) => sum + item.qty, 0);
  const totalValue = ready.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const canReview = ready.length > 0 && blockedCount === 0;

  const reviewGroups = useMemo(() => groups.map((group) => ({
    ...group,
    selected: ready.filter((item) => item.line.sector === group.sector),
  })).filter((group) => group.selected.length > 0), [groups, ready]);

  const contractorName = (contractorId: string) => {
    const contractor = contractors.find((candidate) => candidate.id === contractorId);
    return contractor?.trade_name || contractor?.name || 'Prestador não definido';
  };

  const doGenerate = () => {
    const payload = ready.map((item) => ({
      order_id: item.line.order_id,
      sector: item.line.sector,
      contractor_id: item.contractorId,
      unit_price: item.rate,
      quantity: item.qty,
    }));
    if (!payload.length) return;
    generate.mutate({ saleOrderId, lines: payload }, {
      onSuccess: (result) => {
        const created = result.filter((row) => row.action === 'created' || row.action === 'reactivated').length;
        const exists = result.filter((row) => row.action === 'exists').length;
        const invalid = result.filter((row) => row.action === 'invalid_line' || row.action === 'op_not_in_pv');
        if (created > 0 || exists > 0) {
          toast.success(`${created} ${created === 1 ? 'OS gerada' : 'OS geradas'}${exists ? ` · ${exists} já existiam` : ''}.`);
        }
        if (invalid.length > 0) {
          const firstReason = invalid[0]?.reason || 'OP não pertence mais a este pedido';
          toast.warning(`${invalid.length} ${invalid.length === 1 ? 'linha não foi gerada' : 'linhas não foram geradas'}: ${firstReason}.`);
        }
        onGenerated?.();
        onOpenChange(false);
      },
      onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Falha ao gerar OS.'),
    });
  };

  const keepInternal = () => {
    toast.success('Nenhuma OS gerada — a produção permanece interna.');
    onOpenChange(false);
  };

  const renderServiceGroup = (group: ServiceGroup) => {
    const selectedCount = group.lines.filter((line) => selectedKeys.has(keyOf(line))).length;
    const contractorId = contractorBySector[group.sector] || '';
    const rate = rateBySector[group.sector] ?? 0;
    const isOpen = !!openSectors[group.sector];
    const eligible = group.lines.filter(isEligible);
    const allOn = eligible.length > 0 && eligible.every((line) => selectedKeys.has(keyOf(line)));
    const focus = getContractorServiceFocus(group.sector, group.label);
    const ServiceIcon = focus === 'costura_cabedal' ? Needle : focus === 'aviamento' ? Path : Handshake;

    return (
      <div
        key={group.sector}
        className={cn(
          'overflow-hidden rounded-lg border transition-colors',
          group.primary ? 'border-primary/30 bg-card' : 'border-border bg-card',
          selectedCount > 0 && 'ring-1 ring-primary/20',
        )}
      >
        <button
          type="button"
          onClick={() => setOpenSectors((previous) => ({ ...previous, [group.sector]: !previous[group.sector] }))}
          className={cn(
            'flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors',
            selectedCount > 0 ? 'bg-primary/5' : 'hover:bg-muted/40',
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
              group.primary ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
            )}>
              <ServiceIcon className="h-4 w-4" weight={group.primary ? 'bold' : 'regular'} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-foreground">{group.label}</span>
                {group.primary && (
                  <Badge variant="outline" className="h-5 border-primary/25 bg-primary/5 text-[9px] uppercase tracking-wider text-primary">
                    Serviço principal
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {eligible.length} {eligible.length === 1 ? 'OP disponível' : 'OPs disponíveis'}
                {selectedCount > 0 ? ` · ${selectedCount} selecionada${selectedCount === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          </div>
          <CaretDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="space-y-4 border-t border-border px-3 py-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Prestador responsável</Label>
                <SearchableSelect
                  value={contractorId}
                  onChange={(value) => onContractorChange(group.sector, value)}
                  options={contractorOptions}
                  placeholder="Selecionar prestador ativo..."
                  searchPlaceholder="Buscar prestador..."
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <CurrencyDollar className="h-3 w-3" /> Tarifa por par
                </Label>
                <NumberInput
                  value={rate}
                  onChange={(value) => setRateBySector((previous) => ({ ...previous, [group.sector]: value }))}
                  step="0.01"
                  min={0}
                  className="mt-1 h-9"
                />
              </div>
            </div>

            {contractorOptions.length === 0 ? (
              <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <Warning className="h-3 w-3" /> Cadastre ou reative um prestador antes de gerar a OS.
              </p>
            ) : !contractorId ? (
              <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <Warning className="h-3 w-3" /> Escolha o prestador responsável por este serviço.
              </p>
            ) : rate <= 0 ? (
              <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <Warning className="h-3 w-3" /> Informe a tarifa por par para habilitar a conferência.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Package className="h-3 w-3" /> Ordens de produção
                </span>
                {eligible.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => toggleServiceAll(group.sector)}>
                    {allOn ? 'Limpar seleção' : `Selecionar todas (${eligible.length})`}
                  </Button>
                )}
              </div>
              {group.lines.map((line) => {
                const key = keyOf(line);
                const checked = selectedKeys.has(key);
                const done = (line.sector_status || '').toLowerCase() === 'concluido';
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md border px-2.5 py-2',
                      checked ? 'border-green-500/40 bg-green-500/5'
                        : line.already_has_os ? 'border-border bg-muted/20 opacity-70'
                        : 'border-border/60 hover:bg-muted/30',
                    )}
                  >
                    <Checkbox checked={checked} disabled={line.already_has_os} onCheckedChange={() => toggleOp(line)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-foreground">
                        <span className="font-mono">{line.op_number}</span>
                        <span className="text-muted-foreground"> · {line.ref_code || '—'}{line.color ? ` · ${line.color}` : ''}</span>
                      </div>
                      {line.already_has_os ? (
                        <div className="text-[10px] text-amber-700 dark:text-amber-400">OS já gerada para esta OP e serviço</div>
                      ) : done ? (
                        <div className="text-[10px] text-muted-foreground">Etapa já concluída internamente</div>
                      ) : null}
                    </div>
                    <div className="w-[92px] shrink-0">
                      <NumberInput
                        value={qtyOf(line)}
                        onChange={(value) => setQtyByKey((previous) => ({
                          ...previous,
                          [key]: Math.max(0, Math.min(line.quantity, Math.round(value))),
                        }))}
                        step="1"
                        min={0}
                        disabled={!checked}
                        className="h-8 text-xs"
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">/{line.quantity}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border bg-muted/25 px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 font-display text-2xl uppercase tracking-tight">
            <Storefront className="h-5 w-5 text-primary" />
            Gerar ordem de serviço
          </DialogTitle>
          <DialogDescription className="max-w-3xl text-sm">
            Envie Costura de cabedal e Aviamento com rastreabilidade por OP. Outros serviços permanecem disponíveis quando necessários.
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

        <div className="min-h-[340px] px-5 py-4">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Pedido de venda *</Label>
                <SearchableSelect
                  value={saleOrderId}
                  onChange={setSaleOrderId}
                  options={pvOptions}
                  placeholder="Selecionar pedido..."
                  searchPlaceholder="Buscar por número ou cliente..."
                  heading="Pedidos ativos"
                  className="mt-1"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">O assistente lê as OPs e o roteiro industrial já gerados para o pedido.</p>
              </div>

              {saleOrderId && (
                <div className="rounded-lg border border-border bg-card p-4">
                  {loadingLines ? (
                    <span className="text-xs text-muted-foreground">Carregando OPs e serviços...</span>
                  ) : lines.length === 0 ? (
                    <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <Warning className="h-3.5 w-3.5" /> Este pedido não tem OPs com serviços terceirizáveis.
                    </span>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span><strong className="font-mono text-foreground">{opAgg.size}</strong> OPs</span>
                        <span><strong className="font-mono text-foreground">{[...opAgg.values()].reduce((sum, value) => sum + value, 0).toLocaleString('pt-BR')}</strong> pares</span>
                        <span><strong className="font-mono text-foreground">{groups.length}</strong> serviços possíveis</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(['costura_cabedal', 'aviamento'] as const).map((focus) => {
                          const meta = CONTRACTOR_SERVICE_FOCUS_META[focus];
                          const count = groups.filter((group) => getContractorServiceFocus(group.sector, group.label) === focus)
                            .reduce((sum, group) => sum + group.lines.filter(isEligible).length, 0);
                          const RouteIcon = focus === 'costura_cabedal' ? Needle : Path;
                          return (
                            <div key={focus} className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                              <RouteIcon className="h-5 w-5 shrink-0 text-primary" />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold">{meta.label}</p>
                                <p className="text-[11px] text-muted-foreground">{count} {count === 1 ? 'OP disponível' : 'OPs disponíveis'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {loadingLines ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Carregando serviços e OPs...</div>
              ) : groups.length === 0 ? (
                <EmptyState icon={Handshake} title="Nada a terceirizar" description="Este pedido não tem OPs com serviços terceirizáveis." />
              ) : (
                <>
                  <section className="space-y-2.5" aria-labelledby="primary-outsourcing-route">
                    <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p id="primary-outsourcing-route" className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                          <Scissors className="h-3.5 w-3.5" /> Rota principal
                        </p>
                        <p className="mt-1 text-sm font-semibold">Costura de cabedal e Aviamento primeiro</p>
                        <p className="text-[11px] text-muted-foreground">Selecione as OPs, o prestador ativo e a tarifa por par.</p>
                      </div>
                      <Badge variant="outline" className="w-fit border-primary/25 bg-card font-mono text-[10px] text-primary">
                        {primaryGroups.reduce((sum, group) => sum + group.lines.filter(isEligible).length, 0)} OPs na rota
                      </Badge>
                    </div>
                    {primaryGroups.length > 0 ? primaryGroups.map(renderServiceGroup) : (
                      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
                        Este pedido não possui Costura de cabedal ou Aviamento no roteiro atual.
                      </div>
                    )}
                  </section>

                  {otherGroups.length > 0 && (
                    <section className="space-y-2.5 border-t border-border pt-4" aria-labelledby="other-outsourcing-services">
                      <button
                        id="other-outsourcing-services"
                        type="button"
                        onClick={() => setShowOtherServices((value) => !value)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-3 text-left hover:bg-muted/40"
                      >
                        <div className="flex items-center gap-2.5">
                          <Handshake className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-semibold">Outros serviços</p>
                            <p className="text-[11px] text-muted-foreground">{otherGroups.length} setores eventuais · abrir somente quando necessário</p>
                          </div>
                        </div>
                        <CaretDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showOtherServices && 'rotate-180')} />
                      </button>
                      {showOtherServices && <div className="space-y-2.5">{otherGroups.map(renderServiceGroup)}</div>}
                    </section>
                  )}

                  {blockedCount > 0 && (
                    <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      <Warning className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{blockedCount} {blockedCount === 1 ? 'OP selecionada precisa' : 'OPs selecionadas precisam'} de prestador, tarifa e quantidade válidos antes da conferência.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-muted/25 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ordens de serviço</p>
                  <p className="mt-1 font-display text-3xl leading-none">{ready.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/25 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pares enviados</p>
                  <p className="mt-1 font-display text-3xl leading-none">{totalPairs.toLocaleString('pt-BR')}</p>
                </div>
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-primary">Valor previsto</p>
                  <p className="mt-1 font-display text-2xl leading-none text-primary">{formatCurrency(totalValue)}</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {reviewGroups.map((group) => {
                  const groupPairs = group.selected.reduce((sum, item) => sum + item.qty, 0);
                  const groupValue = group.selected.reduce((sum, item) => sum + item.qty * item.rate, 0);
                  const first = group.selected[0];
                  return (
                    <section key={group.sector} className="overflow-hidden rounded-lg border border-border bg-card">
                      <header className="flex flex-col gap-2 border-b border-border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">{group.label}</p>
                          <p className="text-[11px] text-muted-foreground">{contractorName(first.contractorId)} · {formatCurrency(first.rate)}/par</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-mono text-sm font-semibold">{groupPairs.toLocaleString('pt-BR')} pares</p>
                          <p className="text-[11px] text-muted-foreground">{group.selected.length} {group.selected.length === 1 ? 'OS' : 'OSs'} · {formatCurrency(groupValue)}</p>
                        </div>
                      </header>
                      <div className="divide-y divide-border">
                        {group.selected.map((item) => (
                          <div key={keyOf(item.line)} className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4">
                            <p className="min-w-0 truncate">
                              <span className="font-mono font-semibold">{item.line.op_number}</span>
                              <span className="text-muted-foreground"> · {item.line.ref_code || '—'}{item.line.color ? ` · ${item.line.color}` : ''}</span>
                            </p>
                            <p className="font-mono tabular-nums">{item.qty.toLocaleString('pt-BR')} pares</p>
                            <p className="font-mono font-semibold tabular-nums">{formatCurrency(item.qty * item.rate)}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>

              <div className="flex gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-800 dark:text-green-300">
                <ListChecks className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Conferência concluída: cada linha acima criará uma OS vinculada à OP, ao serviço e ao prestador selecionado.</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-border bg-background/95 px-5 py-3 sm:justify-between">
          <div className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
            {step > 0 && groups.length > 0 && (
              <>
                <span className="font-mono text-foreground">{ready.length}</span> OS · {totalPairs.toLocaleString('pt-BR')} pares · <span className="font-mono text-foreground">{formatCurrency(totalValue)}</span>
              </>
            )}
          </div>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((current) => current - 1)} disabled={generate.isPending}>
              Voltar
            </Button>
          )}
          {step === 0 && (
            <Button onClick={() => setStep(1)} disabled={!saleOrderId || loadingLines || lines.length === 0}>
              Escolher serviços <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
          {step === 1 && chosen.length === 0 && (
            <Button variant="outline" onClick={keepInternal} disabled={loadingLines || generate.isPending}>
              Manter produção interna
            </Button>
          )}
          {step === 1 && chosen.length > 0 && (
            <Button onClick={() => setStep(2)} disabled={!canReview || loadingLines || generate.isPending}>
              <ListChecks className="mr-1 h-3.5 w-3.5" />
              {blockedCount > 0 ? 'Complete a seleção' : `Revisar ${ready.length} ${ready.length === 1 ? 'OS' : 'OSs'}`}
            </Button>
          )}
          {step === 2 && (
            <Button onClick={doGenerate} disabled={!ready.length || generate.isPending}>
              {generate.isPending ? 'Gerando...' : (
                <><PaperPlaneTilt className="mr-1 h-3.5 w-3.5" /> Gerar {ready.length} {ready.length === 1 ? 'OS' : 'OSs'}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
