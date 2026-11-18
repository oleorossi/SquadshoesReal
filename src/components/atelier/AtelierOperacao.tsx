/**
 * Fila do Ateliê: corte no lote, etapa no job.
 * Quadro (cada job na coluna da etapa) ou por pedido (linha do tempo + ações em lote).
 * Grava só pelas RPCs já existentes.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle,
  CircleNotch as Loader2,
  Factory,
  Scissors,
  Truck,
  Warehouse,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { atelierCanRecordReceipt } from '@/lib/atelierReceipt';
import { atelierCanReassign, atelierContractorCanTake } from '@/lib/atelierAdmin';
import { printAtelierShipment } from '@/lib/printAtelierShipment';
import {
  ATELIER_BOARD_COLUMNS,
  ATELIER_RAIL_LABEL,
  atelierBatchAction,
  atelierBatchButtonLabel,
  atelierJobBlocksProduction,
  atelierJobBoardColumn,
  atelierJobIsLate,
  atelierSingleAction,
  atelierTimeline,
  groupAtelierJobsByOrder,
  jobFailureLabel,
  lotCutConfirmMessage,
  lotHasAtelierOrder,
  matchesAtelierBoardJob,
  runLabeledBatch,
  sharedBatchAction,
  type AtelierBatchAction,
  type AtelierBoardFilters,
  type AtelierBoardRail,
  type BatchFailure,
} from '@/lib/atelierBoard';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  ATELIER_PIPELINE_LABEL,
  ATELIER_SECTOR_LABEL,
  atelierEffectiveMode,
  atelierKitGateLabel,
  type AtelierExecutionMode,
  type AtelierPipelineStatus,
  type AtelierSector,
} from '@/lib/atelier';
import { normalizeFilaText } from '@/lib/atelierFilaFilters';
import { atelierJobCanSplit, atelierSplitConfirmMessage } from '@/lib/atelierSplit';
import { kitShortageLabels, lotHasKitShortage } from '@/lib/atelierKitShortage';
import { deadlineChipLabel, deadlineTone } from '@/lib/reportOrderGrouping';
import { daysUntilDeadline } from '@/lib/production/productionSequence';
import { cn } from '@/lib/utils';
import {
  atelierKeys,
  confirmAtelierLotCut,
  markAtelierJobInternalDone,
  markAtelierJobInternalStart,
  markAtelierJobRealized,
  markAtelierJobReceived,
  useAtelierLotKitPreview,
  useConfirmAtelierLotCut,
  useConfirmAtelierLotRelease,
  useMarkAtelierInternalStart,
  useMarkAtelierRealized,
  useSendAtelierShipment,
  useSplitAtelierJobToOwnLot,
  sendAtelierShipment,
  setAtelierJobExecutionMode,
  useAtelierContractorSectors,
  useSetAtelierJobExecutionMode,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { useContractors, type Contractor } from '@/hooks/useContractors';
import { AtelierReceiptDialog } from '@/components/atelier/AtelierReceiptDialog';
import { AtelierReceiptMeter } from '@/components/atelier/AtelierReceiptMeter';

type Modo = 'quadro' | 'pedido';

interface Props {
  lots: AtelierLotRow[];
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  pedido: string;
  modo: Modo;
  onPedidoChange: (orderNumber: string) => void;
  onModoChange: (modo: Modo) => void;
}

function formatQty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

function formatDay(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function deadlineClass(iso: string | null): string {
  const tone = deadlineTone(daysUntilDeadline(iso));
  if (tone === 'late') return 'border-red-500/30 bg-red-500/10 text-red-600';
  if (tone === 'warn') return 'border-amber-500/30 bg-amber-500/10 text-amber-600';
  return 'border-border bg-muted text-muted-foreground';
}

function GradeStrip({ grade }: { grade: Record<string, number> }) {
  const sizes = Object.keys(grade)
    .filter((k) => Number(grade[k]) > 0)
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  if (sizes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5" aria-label="Grade do lote">
      {sizes.map((size) => (
        <span
          key={size}
          className="inline-flex items-baseline gap-0.5 rounded border border-border/60 px-1 py-px font-mono text-[10px] leading-tight"
        >
          <span className="text-muted-foreground">{size}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatQty(Number(grade[size]))}</span>
        </span>
      ))}
    </div>
  );
}

function KitPreview({ lotId }: { lotId: string }) {
  const { data: kit = [], isLoading, isError } = useAtelierLotKitPreview(lotId);
  if (isLoading) return <p className="text-xs text-muted-foreground">Calculando o kit…</p>;
  if (isError) return <p className="text-xs text-destructive">Não foi possível calcular o kit.</p>;
  if (kit.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem napa no kit. O corte só registra a etapa.</p>;
  }
  return (
    <ul className="space-y-0.5 text-xs">
      {kit.map((k) => {
        const short = Number(k.available) < Number(k.required);
        return (
          <li key={k.product_id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-foreground">
              {k.product_name}
              <span className="ml-1 text-muted-foreground">· {k.component}</span>
            </span>
            <span className={cn('shrink-0 font-mono tabular-nums', short ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              {formatQty(Number(k.required))} {k.unit ?? ''}
              {short ? ` (tem ${formatQty(Number(k.available))})` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FailureList({ failures }: { failures: BatchFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
      <p className="font-medium text-destructive">Estes não avançaram</p>
      <ul className="mt-1 space-y-0.5">
        {failures.map((f, i) => (
          <li key={`${f.label}-${i}`} className="text-foreground">
            <span className="font-medium">{f.label}:</span> {f.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function JobActions({
  job,
  lot,
  contractors,
  onReceipt,
}: {
  job: AtelierLotJob;
  lot: AtelierLotRow;
  contractors: { id: string; name: string }[];
  onReceipt?: () => void;
}) {
  const mode = atelierEffectiveMode(job.execution_mode);
  const setMode = useSetAtelierJobExecutionMode();
  const sendMut = useSendAtelierShipment();
  const realizedMut = useMarkAtelierRealized();
  const startMut = useMarkAtelierInternalStart();
  const splitMut = useSplitAtelierJobToOwnLot();
  const [contractorId, setContractorId] = useState(job.contractor_id ?? '');
  const action = atelierSingleAction(job);
  const canChangeMode = job.pipeline_status === 'awaiting_cut' || job.pipeline_status === 'cut';
  const canSplit = atelierJobCanSplit(job, lot);
  const kitClosed = lot.kit_closed === true;
  const dispatchSignal = kitClosed && lot.dispatch_signal ? lot.dispatch_signal : null;
  const busy = setMode.isPending || sendMut.isPending || realizedMut.isPending || startMut.isPending || splitMut.isPending;

  return (
    <div className="space-y-1.5">
      {dispatchSignal && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{dispatchSignal}</p>
      )}
      {canChangeMode && (
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['internal', 'contractor'] as AtelierExecutionMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => setMode.mutate({
                jobId: job.id,
                mode: m,
                contractorId: m === 'contractor' ? contractorId || null : null,
              })}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium',
                mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {ATELIER_EXECUTION_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {job.pipeline_status === 'awaiting_cut' && (
        <p className="text-[10px] text-muted-foreground">
          Corte do lote {lot.lot_number}. A napa sai uma vez, para todos os jobs desta cor.
          {lot.manual_split ? ' Lote próprio: o agrupamento não junta outro pedido aqui.' : ''}
        </p>
      )}

      {canSplit && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(atelierSplitConfirmMessage(job, lot))) return;
              splitMut.mutate(job.id);
            }}
          >
            <Scissors className="h-3 w-3" />
            Separar em lote próprio
          </Button>
        </div>
      )}

      {action === 'sent' && !kitClosed && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">
          O kit ainda não fechou. O envio espera o corte sem falta e os componentes prontos.
        </p>
      )}

      {action === 'sent' && kitClosed && (
        <div className="space-y-1">
          <div className="flex gap-1">
            <Select value={contractorId || undefined} onValueChange={setContractorId}>
              <SelectTrigger className="h-7 flex-1 text-[11px]" aria-label="Prestador">
                <SelectValue placeholder="Prestador" />
              </SelectTrigger>
              <SelectContent>
                {contractors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={busy || !contractorId || contractors.every((c) => c.id !== contractorId)}
              onClick={() => sendMut.mutate({ jobIds: [job.id], contractorId })}
            >
              <Truck className="h-3 w-3" />
              Enviar
            </Button>
          </div>
          {job.contractor_id && contractors.every((c) => c.id !== job.contractor_id) && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              O prestador gravado não atende este setor.
            </p>
          )}
        </div>
      )}

      {job.service_order_id && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => { void printAtelierShipment(job.service_order_id as string).catch((error: Error) => toast.error(error.message || 'Não foi possível imprimir')); }}
          >
            Imprimir remessa
          </Button>
        </div>
      )}

      {action === 'realized' && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            {job.contractor_name ?? 'Prestador'}
            {job.atelier_service_number ? ` · ${job.atelier_service_number}` : ''}
          </span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => realizedMut.mutate(job.id)}>
            <CheckCircle className="h-3 w-3" />
            Realizado
          </Button>
        </div>
      )}

      {atelierCanRecordReceipt(job) && job.execution_mode !== 'internal' && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={onReceipt}>
            <Warehouse className="h-3 w-3" />
            Conferir recebimento
          </Button>
        </div>
      )}

      {action === 'internal_start' && (
        <div className="flex justify-end">
          <Button size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => startMut.mutate(job.id)}>
            <Factory className="h-3 w-3" />
            Em realização
          </Button>
        </div>
      )}

      {atelierCanRecordReceipt(job) && job.execution_mode === 'internal' && (
        <div className="flex justify-end">
          <Button size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={onReceipt}>
            <CheckCircle className="h-3 w-3" />
            Lançar concluído
          </Button>
        </div>
      )}

      {!atelierJobBlocksProduction(job.execution_mode, job.pipeline_status)
        && (job.pipeline_status === 'received_at_factory' || job.pipeline_status === 'done') && (
        <p className="text-[10px] text-foreground">
          Setor liberado. A OP nasce quando o pedido for para Em Produção.
        </p>
      )}
    </div>
  );
}

/** Já visto neste carregamento da tela. Troca de coluna remonta o cartão e aí entra. */
const placedJobs = new Set<string>();

function useColumnEnter(jobId: string, status: string) {
  const token = `${jobId}\0${status}`;
  const [enter] = useState(() => placedJobs.has(jobId) && !placedJobs.has(token));
  useEffect(() => {
    placedJobs.add(jobId);
    placedJobs.add(token);
  }, [jobId, token]);
  return enter;
}

function JobCard({
  job,
  lot,
  contractors,
  selected,
  onToggle,
  onReceipt,
}: {
  job: AtelierLotJob;
  lot: AtelierLotRow;
  contractors: { id: string; name: string }[];
  selected?: boolean;
  onToggle?: () => void;
  onReceipt?: () => void;
}) {
  const blocks = atelierJobBlocksProduction(job.execution_mode, job.pipeline_status, job.received_pairs);
  const sector = ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector;
  const late = atelierJobIsLate(job.target_end, job.pipeline_status, job.execution_mode);
  const canSelect = !!onToggle && (atelierBatchAction(job) != null || atelierCanReassign(job));
  const enter = useColumnEnter(job.id, job.pipeline_status);

  return (
    <article className={cn(
      enter && 'kb-card-in',
      'space-y-1.5 rounded-md border p-2',
      lotHasKitShortage(lot.debits) ? 'border-red-500/50 bg-red-500/10' : 'border-border/70 bg-card',
    )}>
      <header className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-foreground">
            {sector}
            <span className="ml-1 font-normal text-muted-foreground">{job.order_number}</span>
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {lot.reference_code ?? '—'} · {lot.color ?? 'Sem cor'} · {formatQty(Number(job.pairs))}p
          </p>
        </div>
        {canSelect && (
          <Checkbox
            checked={!!selected}
            onCheckedChange={() => onToggle?.()}
            aria-label={`Selecionar ${sector} ${job.order_number}`}
          />
        )}
      </header>
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        <span className="text-muted-foreground">{lot.lot_number}</span>
        {job.target_end && (
          <span className={cn('rounded border px-1 py-px font-medium', late ? 'border-red-500/30 bg-red-500/10 text-red-600' : 'border-border text-muted-foreground')}>
            voltar {formatDay(job.target_end)}{late ? ' · atrasado' : ''}
          </span>
        )}
      </div>
      <AtelierReceiptMeter
        received={Number(job.received_pairs) || 0}
        pairs={Number(job.pairs) || 0}
        label="recebidos"
      />
      {blocks && (
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
          Trava Em Produção de {job.order_number}
        </p>
      )}
      <JobActions job={job} lot={lot} contractors={contractors} onReceipt={onReceipt} />
    </article>
  );
}

function CutBand({
  lots,
  pedido,
}: {
  lots: AtelierLotRow[];
  pedido: string;
}) {
  const cutMut = useConfirmAtelierLotCut();
  const releaseMut = useConfirmAtelierLotRelease();
  const [openKit, setOpenKit] = useState<string | null>(null);
  if (lots.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-foreground/20 bg-card p-3" aria-label="Corte dos lotes">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-sm text-foreground">Corte do lote</h2>
        <p className="text-[11px] text-muted-foreground">Uma faca por referência e cor. A napa sai do estoque aqui.</p>
      </header>
      <ul className="grid gap-2 lg:grid-cols-2">
        {lots.map((lot) => {
          const numbers = [...new Set(lot.orders.map((o) => o.order_number).filter(Boolean))];
          const others = pedido ? numbers.filter((n) => n !== pedido) : numbers.length > 1 ? numbers : [];
          const shortage = lotHasKitShortage(lot.debits);
          const waitingKit = lot.status === 'cut' && lot.kit_gate === 'awaiting_components';
          return (
            <li
              key={lot.id}
              className={cn(
                'space-y-1.5 rounded-md border p-2',
                shortage ? 'border-red-500/50 bg-red-500/10' : 'border-border/70 bg-background',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-display text-sm text-foreground">
                  {lot.reference_code ?? '—'}
                  <span className="ml-1 font-sans text-[11px] font-normal text-muted-foreground">{lot.color ?? 'Sem cor'}</span>
                </p>
                <span className="font-mono text-[10px] text-muted-foreground">{lot.lot_number}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{formatQty(Number(lot.pairs))}p</span>
                {' · '}
                {numbers.join(', ')}
              </p>
              {others.length > 0 && (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {pedido ? `Este corte também leva ${others.join(', ')}.` : `Este corte junta ${others.join(', ')}.`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className={cn('rounded border px-1 py-px font-medium', deadlineClass(lot.min_delivery_deadline))}>
                  {deadlineChipLabel(daysUntilDeadline(lot.min_delivery_deadline))}
                </span>
                {lot.min_ready_date && (
                  <span className="text-muted-foreground">pronto {formatDay(lot.min_ready_date)}</span>
                )}
                {waitingKit && (
                  <span className="text-amber-700 dark:text-amber-400">{atelierKitGateLabel(lot.kit_gate)}</span>
                )}
              </div>
              <GradeStrip grade={lot.grade} />
              {shortage && (
                <p className="text-[10px] font-medium text-red-700 dark:text-red-400">
                  Falta no kit: {kitShortageLabels(lot.debits).join(', ')}.
                </p>
              )}
              {lot.status === 'open' && (
                <div className="space-y-1.5">
                  {openKit === lot.id ? (
                    <KitPreview lotId={lot.id} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenKit(lot.id)}
                      className="text-[11px] font-medium text-foreground underline underline-offset-2"
                    >
                      Ver kit
                    </button>
                  )}
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={cutMut.isPending}
                    onClick={() => {
                      if (!window.confirm(lotCutConfirmMessage([lot], pedido || undefined))) return;
                      cutMut.mutate(lot.id);
                    }}
                  >
                    {cutMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                    Confirmar corte
                  </Button>
                </div>
              )}
              {waitingKit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={releaseMut.isPending}
                  onClick={() => releaseMut.mutate(lot.id)}
                >
                  {releaseMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Conferir estoque / Liberar kit
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const BATCH_RUN: Record<AtelierBatchAction, (jobId: string) => Promise<unknown>> = {
  realized: markAtelierJobRealized,
  received: markAtelierJobReceived,
  internal_start: markAtelierJobInternalStart,
  internal_done: markAtelierJobInternalDone,
};

export function AtelierOperacao({
  lots,
  isLoading,
  isError,
  onRefresh,
  pedido,
  modo,
  onPedidoChange,
  onModoChange,
}: Props) {
  const qc = useQueryClient();
  const { data: contractors = [] } = useContractors();
  const { data: contractorSectors = [] } = useAtelierContractorSectors();
  const contractorRecords = contractors as Contractor[];
  const optionsFor = (sectorName: string) => contractorRecords
    .filter((c) => atelierContractorCanTake(c, sectorName, contractorSectors))
    .map((c) => ({ id: c.id, name: c.name }));
  const [color, setColor] = useState('');
  const [sector, setSector] = useState<'' | 'costura_cabedal' | 'aviamento'>('');
  const [executionMode, setExecutionMode] = useState<'' | AtelierExecutionMode>('');
  const [lateOnly, setLateOnly] = useState(false);
  const [blocksOnly, setBlocksOnly] = useState(false);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [batching, setBatching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignContractorId, setAssignContractorId] = useState('');
  const [receiptJob, setReceiptJob] = useState<AtelierLotJob | null>(null);

  const filters = useMemo<AtelierBoardFilters>(() => ({
    orderNumber: pedido,
    color,
    sector,
    mode: executionMode,
    lateOnly,
    blocksProductionOnly: blocksOnly,
  }), [pedido, color, sector, executionMode, lateOnly, blocksOnly]);
  const filtersActive = Boolean(pedido || color || sector || executionMode || lateOnly || blocksOnly);

  const orderNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const lot of lots) for (const o of lot.orders) if (o.order_number) set.add(o.order_number);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [lots]);
  const pedidoOptions = useMemo(() => {
    const want = pedido.trim();
    if (want && !orderNumbers.some((n) => n.trim() === want)) return [want, ...orderNumbers];
    return orderNumbers;
  }, [pedido, orderNumbers]);

  const colors = useMemo(() => {
    const set = new Set<string>();
    for (const lot of lots) {
      const c = String(lot.color ?? '').trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [lots]);

  const visibleJobs = useMemo(() => {
    const rows: { lot: AtelierLotRow; job: AtelierLotJob }[] = [];
    for (const lot of lots) {
      for (const job of lot.jobs ?? []) {
        if (job.pipeline_status === 'cancelled') continue;
        if (!matchesAtelierBoardJob(job, lot, filters)) continue;
        rows.push({ lot, job });
      }
    }
    rows.sort((a, b) => {
      const da = a.job.target_end || '9999';
      const db = b.job.target_end || '9999';
      return da.localeCompare(db) || (a.job.order_number ?? '').localeCompare(b.job.order_number ?? '', 'pt-BR');
    });
    return rows;
  }, [lots, filters]);

  const selectedRows = visibleJobs.filter(({ job }) => selected.has(job.id));
  const assignSectors = new Set(selectedRows.map(({ job }) => job.sector));
  const assignSector = selectedRows.length > 0
    && selectedRows.every(({ job }) => atelierCanReassign(job))
    && assignSectors.size === 1
    ? [...assignSectors][0]
    : null;

  const cutLots = useMemo(() => {
    const jobFilterOn = Boolean(sector || executionMode || lateOnly || blocksOnly);
    return lots.filter((lot) => {
      const needsCut = lot.status === 'open' || (lot.status === 'cut' && lot.kit_gate === 'awaiting_components');
      if (!needsCut) return false;
      if (pedido && !lotHasAtelierOrder(lot, pedido)) return false;
      if (color) {
        const needle = normalizeFilaText(color);
        if (needle && !normalizeFilaText(lot.color).includes(needle)) return false;
      }
      if (!jobFilterOn) return true;
      return (lot.jobs ?? []).some((job) => matchesAtelierBoardJob(job, lot, filters));
    });
  }, [lots, pedido, color, sector, executionMode, lateOnly, blocksOnly, filters]);

  const blockingCount = visibleJobs.filter(({ job }) => atelierJobBlocksProduction(job.execution_mode, job.pipeline_status)).length;

  async function runBatch(
    items: { label: string; run: () => Promise<unknown> }[],
    done?: { one: string; many: (n: number) => string },
  ) {
    setBatching(true);
    setFailures([]);
    const result = await runLabeledBatch(items);
    setFailures(result.failed);
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: atelierKeys.all });
    setBatching(false);
    if (result.failed.length === 0) {
      toast.success(done ? (result.ok === 1 ? done.one : done.many(result.ok)) : (result.ok === 1 ? '1 avançou' : `${result.ok} avançaram`));
    } else {
      toast.error(`${result.failed.length} não concluíram. O motivo está na lista.`);
    }
  }

  const byColumn = useMemo(() => {
    const m = new Map<AtelierPipelineStatus, { lot: AtelierLotRow; job: AtelierLotJob }[]>();
    for (const row of visibleJobs) {
      const col = atelierJobBoardColumn(row.job.pipeline_status);
      if (!col) continue;
      m.set(col, [...(m.get(col) ?? []), row]);
    }
    return m;
  }, [visibleJobs]);

  const rails: AtelierBoardRail[] = ['antes', 'prestador', 'interno'];

  const orderGroups = useMemo(() => {
    const scoped = lots.filter((lot) => {
      if (pedido && !lotHasAtelierOrder(lot, pedido)) return false;
      if (color) {
        const needle = normalizeFilaText(color);
        if (needle && !normalizeFilaText(lot.color).includes(needle)) return false;
      }
      return true;
    });
    return groupAtelierJobsByOrder(scoped)
      .filter((g) => !pedido || g.orderNumber.trim() === pedido.trim())
      .map((g) => ({
        ...g,
        visible: g.entries.filter(({ job, lot }) => matchesAtelierBoardJob(job, lot, {
          ...filters,
          orderNumber: g.orderNumber,
        })),
      }));
  }, [lots, pedido, color, filters]);

  if (isError) return <p className="text-sm text-destructive">Não foi possível carregar a fila.</p>;
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <FilterSelect label="Pedido" value={pedido || '__all__'} onChange={(v) => onPedidoChange(v === '__all__' ? '' : v)} allLabel="Todos os PVs">
            {pedidoOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="Cor" value={color || '__all__'} onChange={(v) => setColor(v === '__all__' ? '' : v)} allLabel="Todas as cores">
            {colors.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="Setor" value={sector || '__all__'} onChange={(v) => setSector(v === '__all__' ? '' : v as 'costura_cabedal' | 'aviamento')} allLabel="Costura e aviamento">
            <SelectItem value="costura_cabedal">Costura</SelectItem>
            <SelectItem value="aviamento">Aviamento</SelectItem>
          </FilterSelect>
          <FilterSelect label="Onde faz" value={executionMode || '__all__'} onChange={(v) => setExecutionMode(v === '__all__' ? '' : v as AtelierExecutionMode)} allLabel="Interno e prestador">
            <SelectItem value="contractor">Prestador</SelectItem>
            <SelectItem value="internal">Interno</SelectItem>
          </FilterSelect>
          <Button type="button" variant={lateOnly ? 'default' : 'outline'} size="sm" className="h-8 self-end text-xs" aria-pressed={lateOnly} onClick={() => setLateOnly((v) => !v)}>
            Atrasados
          </Button>
          <Button type="button" variant={blocksOnly ? 'default' : 'outline'} size="sm" className="h-8 self-end text-xs" aria-pressed={blocksOnly} onClick={() => setBlocksOnly((v) => !v)}>
            Trava Em Produção
          </Button>
          {filtersActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 self-end text-xs"
              onClick={() => {
                onPedidoChange('');
                setColor('');
                setSector('');
                setExecutionMode('');
                setLateOnly(false);
                setBlocksOnly(false);
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Modo da fila">
            {([
              ['quadro', 'Quadro'],
              ['pedido', 'Por pedido'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={modo === id}
                onClick={() => onModoChange(id)}
                className={cn(
                  'rounded px-2.5 py-1 text-[11px] font-medium',
                  modo === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRefresh}>Atualizar</Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {visibleJobs.length} job{visibleJobs.length === 1 ? '' : 's'}
        {blockingCount > 0 ? ` · ${blockingCount} travam Em Produção` : ''}
        . O corte é do lote. Cada costura e cada aviamento anda na própria etapa.
        {pedido ? ` Filtro ${pedido}.` : ''}
      </p>

      <FailureList failures={failures} />

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
          <p className="text-xs text-foreground">
            {selectedRows.length} selecionado{selectedRows.length === 1 ? '' : 's'}
          </p>
          {assignSector ? (
            <>
              <Select value={assignContractorId || undefined} onValueChange={setAssignContractorId}>
                <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Prestador da atribuição">
                  <SelectValue placeholder="Prestador" />
                </SelectTrigger>
                <SelectContent>
                  {optionsFor(assignSector).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRows.every(({ job, lot }) => (
                job.pipeline_status === 'cut'
                && lot.kit_closed === true
                && atelierEffectiveMode(job.execution_mode) !== 'internal'
              )) && (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={batching || !optionsFor(assignSector).some((c) => c.id === assignContractorId)}
                  onClick={() => {
                    void (async () => {
                      setBatching(true);
                      setFailures([]);
                      try {
                        const data = await sendAtelierShipment({
                          jobIds: selectedRows.map(({ job }) => job.id),
                          contractorId: assignContractorId,
                        });
                        setSelected(new Set());
                        await qc.invalidateQueries({ queryKey: atelierKeys.all });
                        toast.success(data?.order_number ? `Remessa ${data.order_number}` : 'Remessa enviada', data?.service_order_id ? {
                          action: {
                            label: 'Imprimir',
                            onClick: () => { void printAtelierShipment(data.service_order_id as string); },
                          },
                        } : undefined);
                      } catch (error) {
                        const message = error && typeof error === 'object' && 'message' in error
                          ? String((error as { message?: string }).message)
                          : 'Falha ao enviar a remessa';
                        toast.error(message);
                      } finally {
                        setBatching(false);
                      }
                    })();
                  }}
                >
                  Enviar remessa
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={batching || !optionsFor(assignSector).some((c) => c.id === assignContractorId)}
                onClick={() => {
                  void runBatch(
                    selectedRows.map(({ job, lot }) => ({
                      label: jobFailureLabel(job, lot),
                      run: () => setAtelierJobExecutionMode({
                        jobId: job.id,
                        mode: 'contractor',
                        contractorId: assignContractorId,
                      }),
                    })),
                    {
                      one: 'Prestador atribuído',
                      many: (n) => `${n} jobs com prestador`,
                    },
                  );
                }}
              >
                Atribuir prestador
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={batching}
                onClick={() => {
                  void runBatch(
                    selectedRows.map(({ job, lot }) => ({
                      label: jobFailureLabel(job, lot),
                      run: () => setAtelierJobExecutionMode({ jobId: job.id, mode: 'internal' }),
                    })),
                    {
                      one: 'Marcado interno',
                      many: (n) => `${n} jobs internos`,
                    },
                  );
                }}
              >
                Marcar interno
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {selectedRows.every(({ job }) => atelierCanReassign(job))
                ? 'Selecione jobs do mesmo setor.'
                : 'Só dá para atribuir job que ainda não foi enviado.'}
            </p>
          )}
        </div>
      )}

      {lots.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum lote no Ateliê"
          description="Quando um pedido com referência do Ateliê for aprovado, cada cor entra num lote aqui."
        />
      ) : (
        <>
          <CutBand lots={cutLots} pedido={pedido} />
          {modo === 'quadro' ? (
            visibleJobs.length === 0 ? (
              <EmptyState icon={CheckCircle} title="Nenhum job com esses filtros" description="Troque o pedido, o setor ou limpe os filtros." />
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {rails.map((rail) => {
                  const cols = ATELIER_BOARD_COLUMNS.filter((c) => c.rail === rail);
                  const label = ATELIER_RAIL_LABEL[rail];
                  return (
                    <div key={rail} className="flex gap-2">
                      {cols.map((col, index) => {
                        const rows = byColumn.get(col.id) ?? [];
                        return (
                          <section key={col.id} className="w-[240px] shrink-0 space-y-1.5" aria-labelledby={`col-${col.id}`}>
                            <header className="px-0.5">
                              {label && index === 0 ? (
                                <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
                              ) : (
                                <p className="h-[14px]" aria-hidden />
                              )}
                              <div className="flex items-baseline justify-between gap-1">
                                <h2 id={`col-${col.id}`} className={cn('text-xs font-semibold', rows.length ? 'text-foreground' : 'text-muted-foreground')}>
                                  {col.title}
                                </h2>
                                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{rows.length}</span>
                              </div>
                            </header>
                            <div className={cn('min-h-[72px] space-y-1.5 rounded-md p-1.5', rows.length ? 'border border-border bg-card/80' : 'border border-dashed border-border/40')}>
                              {rows.length === 0 ? (
                                <p className="py-3 text-center text-[10px] text-muted-foreground">—</p>
                              ) : rows.map(({ lot, job }) => (
                                <JobCard
                                  key={job.id}
                                  job={job}
                                  lot={lot}
                                  contractors={optionsFor(job.sector)}
                                  selected={selected.has(job.id)}
                                  onToggle={(atelierCanReassign(job) || atelierBatchAction(job)) ? () => {
                                    const next = new Set(selected);
                                    if (next.has(job.id)) next.delete(job.id);
                                    else next.add(job.id);
                                    setSelected(next);
                                  } : undefined}
                                  onReceipt={() => setReceiptJob(job)}
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <PedidoView
              groups={orderGroups}
              optionsFor={optionsFor}
              selected={selected}
              setSelected={setSelected}
              batching={batching}
              onBatch={runBatch}
              onReceipt={setReceiptJob}
            />
          )}
        </>
      )}
      <AtelierReceiptDialog job={receiptJob} onClose={() => setReceiptJob(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-[140px] flex-1 flex-col gap-1 sm:max-w-[200px]">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs" aria-label={`Filtrar por ${label.toLowerCase()}`}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{allLabel}</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </label>
  );
}

function PedidoJob({
  lot,
  job,
  orderNumber,
  selected,
  contractors,
  onToggle,
  onReceipt,
}: {
  lot: AtelierLotRow;
  job: AtelierLotJob;
  orderNumber: string;
  selected: boolean;
  contractors: { id: string; name: string }[];
  onToggle: () => void;
  onReceipt: () => void;
}) {
  const steps = atelierTimeline(job.execution_mode);
  const current = steps.findIndex((s) => s.id === job.pipeline_status);
  const enter = useColumnEnter(job.id, job.pipeline_status);
  const sector = ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector;
  return (
    <li className={cn(enter && 'kb-card-in', 'space-y-1.5 rounded-md border border-border/70 p-2')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-foreground">
            {lot.reference_code ?? '—'} · {lot.color ?? 'Sem cor'}
            <span className="ml-1 font-normal text-muted-foreground">{sector}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            {formatQty(Number(job.pairs))}p · {ATELIER_PIPELINE_LABEL[job.pipeline_status as AtelierPipelineStatus] ?? job.pipeline_status}
            {job.target_end ? ` · voltar ${formatDay(job.target_end)}` : ''}
            {atelierJobIsLate(job.target_end, job.pipeline_status, job.execution_mode) ? ' · atrasado' : ''}
          </p>
        </div>
        {(atelierBatchAction(job) || atelierCanReassign(job)) && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Selecionar ${sector} ${orderNumber}`}
          />
        )}
      </div>
      <ol className="flex flex-wrap gap-1" aria-label="Etapas do job">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] transition-colors duration-300',
              i === current
                ? 'border-foreground bg-foreground font-semibold text-background'
                : i < current
                  ? 'border-foreground/30 bg-muted text-foreground'
                  : 'border-border text-muted-foreground',
            )}
          >
            {step.label}
          </li>
        ))}
      </ol>
      {atelierJobBlocksProduction(job.execution_mode, job.pipeline_status) && (
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
          Trava Em Produção de {orderNumber}
        </p>
      )}
      <AtelierReceiptMeter
        received={Number(job.received_pairs) || 0}
        pairs={Number(job.pairs) || 0}
        label="recebidos"
      />
      <JobActions job={job} lot={lot} contractors={contractors} onReceipt={onReceipt} />
    </li>
  );
}

function PedidoView({
  groups,
  optionsFor,
  selected,
  setSelected,
  batching,
  onBatch,
  onReceipt,
}: {
  groups: {
    orderNumber: string;
    clientName: string | null;
    deliveryDeadline: string | null;
    pairs: number;
    openLots: AtelierLotRow[];
    entries: { lot: AtelierLotRow; job: AtelierLotJob }[];
    visible: { lot: AtelierLotRow; job: AtelierLotJob }[];
  }[];
  optionsFor: (sectorName: string) => { id: string; name: string }[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  batching: boolean;
  onBatch: (items: { label: string; run: () => Promise<unknown> }[]) => Promise<void>;
  onReceipt: (job: AtelierLotJob) => void;
}) {
  if (groups.length === 0) {
    return <EmptyState icon={CheckCircle} title="Nenhum pedido com esses filtros" description="Troque o pedido ou limpe os filtros." />;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const blocking = group.entries.filter(({ job }) => atelierJobBlocksProduction(job.execution_mode, job.pipeline_status));
        const selectedEntries = group.visible.filter(({ job }) => selected.has(job.id));
        const action = sharedBatchAction(selectedEntries.map(({ job }) => atelierBatchAction(job)));
        const mixed = selectedEntries.length > 0 && !action;
        return (
          <section key={group.orderNumber} className="space-y-2 rounded-md border border-border bg-card p-3">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="font-display text-base text-foreground">{group.orderNumber}</h2>
              <span className="text-[12px] text-muted-foreground">{group.clientName || '—'}</span>
              <span className="text-[11px] text-muted-foreground">
                Entrega {group.deliveryDeadline ? formatDay(group.deliveryDeadline) : '—'}
              </span>
              <span className={cn('rounded border px-1 py-px text-[10px] font-medium', deadlineClass(group.deliveryDeadline))}>
                {deadlineChipLabel(daysUntilDeadline(group.deliveryDeadline))}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{formatQty(group.pairs)}p</span>
            </header>
            <p className={cn('text-[12px]', blocking.length ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              {blocking.length > 0
                ? `Em Produção bloqueada · ${blocking.length} de ${group.entries.length} jobs ainda sem retorno.`
                : 'Estes jobs já liberaram o setor. A OP nasce quando o pedido for para Em Produção.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.openLots.length > 0 && (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={batching}
                  onClick={() => {
                    const msg = lotCutConfirmMessage(group.openLots, group.orderNumber);
                    if (!window.confirm(msg)) return;
                    void onBatch(group.openLots.map((lot) => ({
                      label: [lot.lot_number, lot.reference_code, lot.color].filter(Boolean).join(' · '),
                      run: () => confirmAtelierLotCut(lot.id),
                    })));
                  }}
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Cortar os lotes deste PV
                </Button>
              )}
              {action && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={batching}
                  onClick={() => {
                    void onBatch(selectedEntries.map(({ job, lot }) => ({
                      label: jobFailureLabel(job, lot),
                      run: () => BATCH_RUN[action](job.id),
                    })));
                  }}
                >
                  {batching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {atelierBatchButtonLabel(action, selectedEntries.length)}
                </Button>
              )}
              {mixed && (
                <p className="self-center text-[11px] text-muted-foreground">Selecione jobs na mesma etapa.</p>
              )}
            </div>
            {group.visible.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhum job deste pedido passa nos filtros.</p>
            ) : (
              <ul className="space-y-2">
                {group.visible.map(({ lot, job }) => (
                  <PedidoJob
                    key={`${job.id}-${job.pipeline_status}`}
                    lot={lot}
                    job={job}
                    orderNumber={group.orderNumber}
                    selected={selected.has(job.id)}
                    contractors={optionsFor(job.sector)}
                    onToggle={() => {
                      const next = new Set(selected);
                      if (next.has(job.id)) next.delete(job.id);
                      else next.add(job.id);
                      setSelected(next);
                    }}
                    onReceipt={() => onReceipt(job)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
