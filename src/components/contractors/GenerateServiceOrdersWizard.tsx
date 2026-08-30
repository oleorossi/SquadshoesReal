import { useEffect, useMemo, useState } from 'react';
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
import { OsQueuePullChip } from '@/components/contractors/OsQueuePullChip';

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
  const [contractorByKey, setContractorByKey] = useState<Record<string, string>>({});
  const [rateByKey, setRateByKey] = useState<Record<string, number>>({});
  const [dirtyRateOriginByKey, setDirtyRateOriginByKey] = useState<Record<string, string>>({});
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({});
  const [showOtherServices, setShowOtherServices] = useState(false);

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
    return group.label;
  };

  return null;
}
