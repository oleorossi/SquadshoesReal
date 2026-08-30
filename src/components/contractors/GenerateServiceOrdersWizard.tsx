import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CaretDown, CheckCircle, CurrencyDollar, Handshake,
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
import { OsQueuePullChip } from '@/components/contractors/OsQueuePullChip';
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
  usePvOutsourceableLines, useGenerateOpServiceOrders,
  type OutsourceableLine,
} from '@/hooks/useGenerateOpServiceOrders';

/**
 * Assistente Pedido → Serviços/OPs, com conclusão direta na tela de serviços.
 *
 * A rota principal da fábrica é Costura de cabedal + Aviamento. Os demais
 * serviços continuam disponíveis, mas ficam numa área secundária para não
 * transformar o lançamento diário em uma varredura de setores irrelevantes.
 * Cada demanda mantém o vínculo com a OP e o setor corretos no payload.
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
const domIdOf = (prefix: string, value: string) => `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const STEPS = ['Pedido', 'Serviços e OPs'] as const;

const isCompletedStage = (status: string | null | undefined) => (
  (status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .includes('conclu')
);

const formatPlanningDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const parsed = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('pt-BR');
};

const formatPlanningDays = (value: number | null | undefined) => {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return '—';
  return `${days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${days === 1 ? 'dia' : 'dias'}`;
};

const planningSourceLabel = (source: string | null | undefined) => {
  const normalized = (source || '').trim().toLowerCase();
  if (!normalized) return null;
  const labels: Record<string, string> = {
    production_schedule: 'cronograma da produção',
    production_schedule_next_sector: 'próxima etapa do cronograma',
    manual_override: 'retorno ajustado manualmente',
    order_planned_delivery: 'prazo planejado da OP',
    sale_order_delivery_deadline: 'prazo de entrega do PV',
    fallback_14_days: 'prazo padrão de 14 dias úteis',
  };
  return labels[normalized] || source;
};

export function GenerateServiceOrdersWizard({
  open, onOpenChange, initialSaleOrderId, onGenerated,
}: GenerateServiceOrdersWizardProps) {
  const {
    data: saleOrders = [],
    isLoading: loadingSaleOrders,
    isError: saleOrdersFailed,
    error: saleOrdersError,
    refetch: refetchSaleOrders,
  } = useSaleOrders();
  const {
    data: contractors = [],
    isLoading: loadingContractors,
    isError: contractorsFailed,
    error: contractorsError,
    refetch: refetchContractors,
  } = useContractors();
  const generate = useGenerateOpServiceOrders();

  const [step, setStep] = useState(0);
  const [saleOrderId, setSaleOrderId] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});
  // Prestador e tarifa pertencem à ficha de CADA OP. Um estado por setor faria
  // a primeira referência do grupo sobrescrever silenciosamente as demais.
  const [contractorByKey, setContractorByKey] = useState<Record<string, string>>({});
  const [rateByKey, setRateByKey] = useState<Record<string, number>>({});
  const [dirtyRateOriginByKey, setDirtyRateOriginByKey] = useState<Record<string, string>>({});
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({});
  const [showOtherServices, setShowOtherServices] = useState(false);
  const autoSelectedForPvRef = useRef<string | null>(null);

  const {
    data: lines = [],
    isLoading: loadingLines,
    isError: linesFailed,
    error: linesError,
    refetch: refetchLines,
  } = usePvOutsourceableLines(saleOrderId || null);

  useEffect(() => {
    if (!open) return;
    setStep(initialSaleOrderId ? 1 : 0);
    setSaleOrderId(initialSaleOrderId || '');
    setSelectedKeys(new Set());
    setQtyByKey({});
    setContractorByKey({});
    setRateByKey({});
    setDirtyRateOriginByKey({});
    setOpenSectors({});
    setShowOtherServices(false);
    autoSelectedForPvRef.current = null;
  }, [open, initialSaleOrderId]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setQtyByKey({});
    setContractorByKey({});
    setRateByKey({});
    setDirtyRateOriginByKey({});
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
    setContractorByKey(() => {
      const next: Record<string, string> = {};
      for (const group of groups) {
        for (const line of group.lines) {
          const key = keyOf(line);
          if (line.default_contractor_id && activeContractorIds.has(line.default_contractor_id)) {
            next[key] = line.default_contractor_id;
          }
        }
      }
      return next;
    });
    setRateByKey((previous) => {
      const next: Record<string, number> = {};
      for (const group of groups) {
        for (const line of group.lines) {
          const key = keyOf(line);
          // Um valor digitado pelo usuário é uma exceção intencional. Todo o
          // restante segue a tarifa viva da ficha após invalidação/refetch.
          const currentOrigin = `${line.default_terceirizacao_id || ''}::${line.default_contractor_id || ''}`;
          if (dirtyRateOriginByKey[key] === currentOrigin && previous[key] != null) {
            next[key] = previous[key];
            continue;
          }
          if (line.default_rate != null && Number(line.default_rate) > 0) {
            next[key] = Number(line.default_rate);
          }
        }
      }
      return next;
    });
    setOpenSectors((previous) => {
      if (Object.keys(previous).length) return previous;
      const route = primaryGroups.length ? primaryGroups : groups.slice(0, 1);
      return Object.fromEntries(route.map((group) => [group.sector, true]));
    });
  }, [activeContractorIds, dirtyRateOriginByKey, groups, primaryGroups]);

  const loadingWizardData = loadingLines || loadingContractors || (step === 0 && loadingSaleOrders);
  const wizardDataFailed = linesFailed || contractorsFailed || (step === 0 && saleOrdersFailed);
  const wizardError = linesFailed
    ? linesError
    : contractorsFailed
      ? contractorsError
      : saleOrdersError;
  const wizardErrorMessage = wizardError instanceof Error
    ? wizardError.message
    : 'Não foi possível carregar as OPs, os serviços e os prestadores deste pedido.';
  const retryWizardData = () => void Promise.all([
    refetchLines(),
    refetchContractors(),
    refetchSaleOrders(),
  ]);

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

  const isEligible = (line: OutsourceableLine) => !line.already_has_os
    && !isCompletedStage(line.sector_status)
    && line.planning_config_ready === true
    && !!line.default_terceirizacao_id
    && !!line.default_contractor_id;
  const qtyOf = (line: OutsourceableLine) => qtyByKey[keyOf(line)] ?? line.quantity;

  // A ficha já diz o que sai: Costura de cabedal e Aviamento elegíveis entram
  // marcados. O operador só desmarca o que fica interno. Outros serviços
  // continuam opt-in porque ficam recolhidos.
  useEffect(() => {
    if (!open || step !== 1 || !saleOrderId || !lines.length) return;
    if (autoSelectedForPvRef.current === saleOrderId) return;
    autoSelectedForPvRef.current = saleOrderId;
    const eligibleKeys = lines
      .filter((line) => {
        if (!isEligible(line)) return false;
        const focus = getContractorServiceFocus(line.sector, line.sector_label);
        return focus === 'costura_cabedal' || focus === 'aviamento';
      })
      .map(keyOf);
    if (eligibleKeys.length === 0) return;
    setSelectedKeys(new Set(eligibleKeys));
  }, [open, step, saleOrderId, lines]);

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

  const chosen = useMemo<ChosenLine[]>(() => {
    const result: ChosenLine[] = [];
    for (const group of groups) {
      for (const line of group.lines) {
        const key = keyOf(line);
        if (!selectedKeys.has(key)) continue;
        const contractorId = contractorByKey[key] || '';
        const rate = rateByKey[key] ?? 0;
        const qty = qtyOf(line);
        // A prévia e o writer compartilham o mesmo gate. Campo ausente também
        // bloqueia: a UI nova só sobe depois da migration correspondente.
        const planningReady = line.planning_config_ready === true
          && !!line.default_terceirizacao_id
          && contractorId === line.default_contractor_id;
        result.push({
          line,
          contractorId,
          rate,
          qty,
          ready: isEligible(line)
            && !!contractorId
            && rate > 0
            && qty > 0
            && planningReady,
        });
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedKeys, qtyByKey, contractorByKey, rateByKey]);

  const ready = chosen.filter((item) => item.ready);
  const blockedCount = chosen.length - ready.length;
  const totalPairs = ready.reduce((sum, item) => sum + item.qty, 0);
  const totalValue = ready.reduce((sum, item) => sum + item.qty * item.rate, 0);

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
      require_planning_config: true,
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
        if (created === 0 && exists === 0) {
          // O servidor revalida etapa/configuração sob lock. Se tudo perdeu a
          // elegibilidade entre a prévia e o clique, preserve a seleção para o
          // operador ler o motivo e tentar novamente após o refetch.
          void refetchLines();
          if (invalid.length === 0) toast.error('Nenhuma OS foi gerada. Recarregue os dados e tente novamente.');
          return;
        }
        onGenerated?.();
        onOpenChange(false);
      },
      onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Falha ao gerar OS.'),
    });
  };

  const keepInternal = () => {
    toast.success('Nenhuma OS gerada — produção segue interna.');
    onOpenChange(false);
  };

  const renderServiceGroup = (group: ServiceGroup) => {
    const selectedCount = group.lines.filter((line) => selectedKeys.has(keyOf(line))).length;
    const isOpen = !!openSectors[group.sector];
    const eligible = group.lines.filter(isEligible);
    const allOn = eligible.length > 0 && eligible.every((line) => selectedKeys.has(keyOf(line)));
    const focus = getContractorServiceFocus(group.sector, group.label);
    const ServiceIcon = focus === 'costura_cabedal' ? Needle : focus === 'aviamento' ? Path : Handshake;
    const panelId = domIdOf('service-orders-sector', group.sector);

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
          aria-expanded={isOpen}
          aria-controls={panelId}
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
          <div id={panelId} className="space-y-4 border-t border-border px-3 py-4">
            {!loadingContractors && !contractorsFailed && contractorOptions.length === 0 ? (
              <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <Warning className="h-3 w-3" /> Cadastre ou reative um prestador antes de gerar a OS.
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
                const done = isCompletedStage(line.sector_status);
                const selectedContractorId = contractorByKey[key] || '';
                const selectedRate = rateByKey[key] ?? 0;
                const capacity = Number(line.capacity_pairs_per_day);
                const leadDays = line.total_lead_days ?? line.lead_days;
                const components = Array.isArray(line.material_components)
                  ? line.material_components.filter(Boolean)
                  : [];
                const lineId = domIdOf('service-order-line', key);
                const quantityId = `${lineId}-quantity`;
                const rateId = `${lineId}-rate`;
                return (
                  <div
                    key={key}
                    className={cn(
                      'rounded-md border px-2.5 py-2',
                      checked ? 'border-green-500/40 bg-green-500/5'
                        : line.already_has_os ? 'border-border bg-muted/20 opacity-70'
                        : 'border-border/60 hover:bg-muted/30',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id={`${lineId}-selected`}
                        checked={checked}
                        disabled={!isEligible(line)}
                        aria-labelledby={`${lineId}-label`}
                        onCheckedChange={() => toggleOp(line)}
                      />
                      <div id={`${lineId}-label`} className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 font-mono text-xs text-foreground">{line.op_number}</span>
                          {line.queue_pull ? (
                            <span className="shrink-0">
                              <OsQueuePullChip pull={line.queue_pull} />
                            </span>
                          ) : null}
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            · {line.ref_code || '—'}{line.color ? ` · ${line.color}` : ''}
                          </span>
                        </div>
                        {line.already_has_os ? (
                          <div className="text-[10px] text-amber-700 dark:text-amber-400">OS já gerada para esta OP e serviço</div>
                        ) : done ? (
                          <div className="text-[10px] text-muted-foreground">Etapa já concluída internamente</div>
                        ) : null}
                      </div>
                      <div className="w-[92px] shrink-0">
                        <NumberInput
                          id={quantityId}
                          aria-label={`Quantidade da OP ${line.op_number} para ${group.label}`}
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

                    <div className="ml-7 mt-2 space-y-1.5 border-t border-border/60 pt-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                        <div>
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Prestador desta ficha
                          </Label>
                          <div className="mt-1 flex h-9 items-center rounded-md border border-border bg-muted/25 px-3 text-xs font-medium text-foreground">
                            {selectedContractorId
                              ? contractorName(selectedContractorId)
                              : 'Prestador não configurado'}
                          </div>
                        </div>
                        <div>
                          <Label htmlFor={rateId} className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <CurrencyDollar className="h-3 w-3" /> Tarifa por par
                          </Label>
                          <NumberInput
                            id={rateId}
                            aria-label={`Tarifa por par da OP ${line.op_number} para ${group.label}`}
                            value={selectedRate}
                            onChange={(value) => {
                              const origin = `${line.default_terceirizacao_id || ''}::${line.default_contractor_id || ''}`;
                              setDirtyRateOriginByKey((previous) => ({ ...previous, [key]: origin }));
                              setRateByKey((previous) => ({ ...previous, [key]: value }));
                            }}
                            step="0.01"
                            min={0}
                            disabled={!isEligible(line)}
                            className="mt-1 h-9"
                          />
                        </div>
                      </div>
                      {checked && selectedContractorId && selectedRate <= 0 && (
                        <p className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          <Warning className="h-3 w-3" /> Informe a tarifa por par desta OP.
                        </p>
                      )}
                      {checked && qtyOf(line) !== line.quantity && (
                        <p className="flex items-start gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          <Warning className="mt-0.5 h-3 w-3 shrink-0" />
                          A OS parcial usa a proporção da grade integral da OP para estimar os materiais. Confira o aviso no cálculo impresso quando a parcela tiver outra distribuição de numerações.
                        </p>
                      )}
                      <div className="grid gap-x-4 gap-y-1 text-[10.5px] sm:grid-cols-2 lg:grid-cols-4">
                        <span><strong className="text-foreground">Capacidade:</strong>{' '}
                          {Number.isFinite(capacity) && capacity > 0 ? `${capacity.toLocaleString('pt-BR')} pares/dia` : 'não configurada'}
                        </span>
                        <span><strong className="text-foreground">Execução:</strong> {formatPlanningDays(line.execution_days)}</span>
                        <span><strong className="text-foreground">Fila:</strong> {formatPlanningDays(line.queue_days)}</span>
                        <span><strong className="text-foreground">Antecedência:</strong> {formatPlanningDays(leadDays)}</span>
                        <span><strong className="text-foreground">Enviar em:</strong> {formatPlanningDate(line.recommended_send_date)}</span>
                        <span><strong className="text-foreground">Retornar até:</strong> {formatPlanningDate(line.required_return_date)}</span>
                        {line.return_before_sector && (
                          <span className="sm:col-span-2"><strong className="text-foreground">Antes de:</strong> {line.return_before_sector}</span>
                        )}
                        {components.length > 0 && (
                          <span className="sm:col-span-2 lg:col-span-4"><strong className="text-foreground">Materiais:</strong> {components.join(' · ')}</span>
                        )}
                      </div>
                      {planningSourceLabel(line.planning_source) && (
                        <p className="text-[10px] text-muted-foreground">
                          Prévia por {planningSourceLabel(line.planning_source)}; capacidade e datas são recalculadas pelo servidor ao gerar.
                        </p>
                      )}
                      {line.planning_config_issue && (
                        <p className="flex items-start gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          <Warning className="mt-0.5 h-3 w-3 shrink-0" /> {line.planning_config_issue}
                        </p>
                      )}
                      {line.planning_warning && line.planning_warning !== line.planning_config_issue && (
                        <p className="flex items-start gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          <Warning className="mt-0.5 h-3 w-3 shrink-0" /> {line.planning_warning}
                        </p>
                      )}
                    </div>
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
            Escolha somente o que vai para fora. Cada OP mostra a prévia de capacidade, prazo e materiais; o servidor recalcula tudo ao gerar.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/25 p-1.5">
            {STEPS.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'active' : 'future';
              return (
                <button
                  key={label}
                  type="button"
                  aria-current={state === 'active' ? 'step' : undefined}
                  aria-label={`Etapa ${index + 1}: ${label}`}
                  disabled={state === 'future'}
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
                {saleOrdersFailed && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    <span>Não foi possível carregar os pedidos ativos.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void refetchSaleOrders()}>
                      Tentar novamente
                    </Button>
                  </div>
                )}
              </div>

              {saleOrderId && (
                <div className="rounded-lg border border-border bg-card p-4">
                  {loadingWizardData ? (
                    <span className="text-xs text-muted-foreground">Carregando OPs e serviços...</span>
                  ) : wizardDataFailed ? (
                    <div className="flex flex-col items-start gap-2 text-xs text-destructive">
                      <span className="flex items-start gap-1.5">
                        <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {wizardErrorMessage}
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={retryWizardData}>
                        Tentar novamente
                      </Button>
                    </div>
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
              {loadingWizardData ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Carregando serviços e OPs...</div>
              ) : wizardDataFailed ? (
                <EmptyState
                  icon={Warning}
                  title="Falha ao carregar os dados da terceirização"
                  description={wizardErrorMessage}
                  action={(
                    <Button type="button" variant="outline" size="sm" onClick={retryWizardData}>
                      Tentar novamente
                    </Button>
                  )}
                />
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
                        <p className="text-[11px] text-muted-foreground">OPs da ficha já vêm marcadas. Confira o prestador e a tarifa por par; desmarque o que fica interno.</p>
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
                        aria-expanded={showOtherServices}
                        aria-controls="other-outsourcing-services-panel"
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
                      {showOtherServices && <div id="other-outsourcing-services-panel" className="space-y-2.5">{otherGroups.map(renderServiceGroup)}</div>}
                    </section>
                  )}

                  {blockedCount > 0 && (
                    <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      <Warning className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{blockedCount} {blockedCount === 1 ? 'OP marcada ficará de fora' : 'OPs marcadas ficarão de fora'} por configuração incompleta na ficha, falta de tarifa ou quantidade inválida. Isso não bloqueia as demais.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        </div>

        <DialogFooter className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-background/95 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="mr-auto w-full text-[11px] text-muted-foreground sm:w-auto">
            {step > 0 && (
              <>
                <span className="font-mono text-foreground">{ready.length}</span> OS · {totalPairs.toLocaleString('pt-BR')} pares · <span className="font-mono text-foreground">{formatCurrency(totalValue)}</span>
                {blockedCount > 0 && <span className="font-medium text-amber-700 dark:text-amber-400"> · {blockedCount} de fora</span>}
              </>
            )}
          </div>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((current) => current - 1)} disabled={generate.isPending}>
              Voltar
            </Button>
          )}
          {step === 0 && (
            <Button onClick={() => setStep(1)} disabled={!saleOrderId || loadingWizardData || wizardDataFailed}>
              Escolher serviços <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
          {step === 1 && ready.length === 0 && (
            <Button variant="outline" onClick={keepInternal} disabled={!saleOrderId || loadingWizardData || wizardDataFailed || generate.isPending}>
              Prosseguir
            </Button>
          )}
          {step === 1 && ready.length > 0 && (
            <Button onClick={doGenerate} disabled={!saleOrderId || loadingWizardData || wizardDataFailed || generate.isPending}>
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
