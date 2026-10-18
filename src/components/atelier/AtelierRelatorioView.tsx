/**
 * Relatório operacional do Ateliê — Interno | Prestador + filtros + OKs.
 *
 * Corte: só na fábrica (confirmar corte do lote).
 * Prestador: Enviado → Realizado → Recebido e conferido.
 * Interno: Em realização → Concluído (sem enviado/recebido).
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle,
  CircleNotch as Loader2,
  Factory,
  Scissors,
  Truck,
  Warehouse,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  ATELIER_INTERNAL_OK_STEPS,
  ATELIER_PIPELINE_LABEL,
  ATELIER_SECTOR_LABEL,
  ATELIER_STREET_OK_STEPS,
  atelierEffectiveMode,
  atelierLotColumn,
  atelierNextInternalOk,
  atelierNextStreetOk,
  type AtelierExecutionMode,
  type AtelierPipelineStatus,
  type AtelierSector,
} from '@/lib/atelier';
import {
  EMPTY_ATELIER_REPORT_FILTERS,
  collectFilterOptions,
  matchesAtelierReportFilters,
  type AtelierReportFilters,
} from '@/lib/atelierReportFilters';
import { deadlineChipLabel, deadlineTone, groupReportByOrderThenReference } from '@/lib/reportOrderGrouping';
import { daysUntilDeadline } from '@/lib/production/productionSequence';
import { cn } from '@/lib/utils';
import {
  useAtelierLots,
  useConfirmAtelierLotCut,
  useMarkAtelierInternalDone,
  useMarkAtelierInternalStart,
  useMarkAtelierRealized,
  useMarkAtelierReceived,
  useMarkAtelierSent,
  useSetAtelierJobExecutionMode,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { useContractors } from '@/hooks/useContractors';

type ReportTab = AtelierExecutionMode;

function formatQty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

function formatDay(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function materialLabelsForLot(lot: AtelierLotRow): string[] {
  const fromDebits = lot.debits.map((d) => d.component).filter(Boolean) as string[];
  const names = lot.debits.map((d) => d.product_name).filter(Boolean);
  return [...new Set([...fromDebits, ...names])];
}

function deadlineChipClass(deadline: string | null): string {
  const tone = deadlineTone(daysUntilDeadline(deadline));
  if (tone === 'late') return 'border-red-500/30 bg-red-500/10 text-red-600';
  if (tone === 'warn') return 'border-amber-500/30 bg-amber-500/10 text-amber-600';
  return 'border-border bg-muted text-muted-foreground';
}

function jobMatchesTab(job: AtelierLotJob, tab: ReportTab): boolean {
  return atelierEffectiveMode(job.execution_mode) === tab;
}

function KitQtyList({ lot }: { lot: AtelierLotRow }) {
  if (!lot.debits.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Kit ainda sem débito — aparece após o corte (com quantidades).
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {lot.debits.map((d) => (
        <li
          key={d.product_id}
          className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-foreground"
        >
          <span className="font-medium">{d.product_name}</span>
          <span className="ml-1 font-mono tabular-nums text-muted-foreground">
            {formatQty(Number(d.required_qty) || Number(d.quantity) || 0)}
            {d.unit ? ` ${d.unit}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ModeSelector({
  job,
  contractors,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
}) {
  const setMode = useSetAtelierJobExecutionMode();
  const mode = atelierEffectiveMode(job.execution_mode);
  const canChange = job.pipeline_status === 'awaiting_cut' || job.pipeline_status === 'cut';
  const [contractorId, setContractorId] = useState(job.contractor_id ?? '');

  if (!canChange) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Modo: {ATELIER_EXECUTION_MODE_LABEL[mode]}
        {job.contractor_name ? ` · ${job.contractor_name}` : ''}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex rounded-md border border-border p-0.5">
        {(['internal', 'contractor'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={setMode.isPending}
            onClick={() =>
              setMode.mutate({
                jobId: job.id,
                mode: m,
                contractorId: m === 'contractor' ? contractorId || null : null,
              })
            }
            className={cn(
              'rounded px-2 py-1 text-[11px] font-medium transition-colors',
              mode === m
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            {ATELIER_EXECUTION_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {mode === 'contractor' && (
        <Select
          value={contractorId || undefined}
          onValueChange={(id) => {
            setContractorId(id);
            setMode.mutate({ jobId: job.id, mode: 'contractor', contractorId: id });
          }}
        >
          <SelectTrigger className="h-7 min-w-[140px] text-[11px]" aria-label="Prestador">
            <SelectValue placeholder="Prestador" />
          </SelectTrigger>
          <SelectContent>
            {contractors.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function StreetOkRail({ status }: { status: AtelierPipelineStatus }) {
  const order: Record<string, number> = {
    cut: 0,
    sent_to_contractor: 1,
    realized: 2,
    received_at_factory: 3,
  };
  const current = order[status] ?? -1;
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Etapas prestador">
      {ATELIER_STREET_OK_STEPS.map((step, i) => (
        <li
          key={step}
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-medium',
            current >= i + 1
              ? 'border-foreground/40 bg-muted text-foreground'
              : 'border-border/60 text-muted-foreground',
          )}
        >
          {i + 1}. {ATELIER_PIPELINE_LABEL[step]}
        </li>
      ))}
    </ol>
  );
}

function InternalOkRail({ status }: { status: AtelierPipelineStatus }) {
  const order: Record<string, number> = { cut: 0, in_progress: 1, done: 2 };
  const current = order[status] ?? -1;
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Etapas interno">
      {ATELIER_INTERNAL_OK_STEPS.map((step, i) => (
        <li
          key={step}
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-medium',
            current >= i + 1
              ? 'border-foreground/40 bg-muted text-foreground'
              : 'border-border/60 text-muted-foreground',
          )}
        >
          {i + 1}. {ATELIER_PIPELINE_LABEL[step]}
        </li>
      ))}
    </ol>
  );
}

function ContractorJobOk({
  job,
  contractors,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
}) {
  const sendMut = useMarkAtelierSent();
  const realizedMut = useMarkAtelierRealized();
  const receiveMut = useMarkAtelierReceived();
  const [contractorId, setContractorId] = useState(job.contractor_id ?? '');
  const next = atelierNextStreetOk(job.pipeline_status);
  const busy = sendMut.isPending || realizedMut.isPending || receiveMut.isPending;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          {ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector}
          <span className="ml-1.5 font-normal text-muted-foreground">{job.order_number}</span>
        </p>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatQty(Number(job.pairs))} pares
        </span>
      </div>
      <ModeSelector job={job} contractors={contractors} />
      <StreetOkRail status={job.pipeline_status} />

      {next === 'sent_to_contractor' && (
        <div className="flex flex-wrap gap-1.5">
          <Select value={contractorId || undefined} onValueChange={setContractorId}>
            <SelectTrigger className="h-8 min-w-[160px] flex-1 text-xs" aria-label="Prestador">
              <SelectValue placeholder="Escolher prestador" />
            </SelectTrigger>
            <SelectContent>
              {contractors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8"
            disabled={busy || !contractorId}
            onClick={() => sendMut.mutate({ jobId: job.id, contractorId })}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
            OK · Enviado ao prestador
          </Button>
        </div>
      )}

      {next === 'realized' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {job.contractor_name ?? 'Prestador'}
            {job.atelier_service_number ? ` · ${job.atelier_service_number}` : ''}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => realizedMut.mutate(job.id)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            OK · Realizado
          </Button>
        </div>
      )}

      {next === 'received_at_factory' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => receiveMut.mutate(job.id)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Warehouse className="h-3.5 w-3.5" />}
            OK · Recebido e conferido
          </Button>
        </div>
      )}

      {job.pipeline_status === 'received_at_factory' && (
        <p className="text-[11px] font-medium text-foreground">Conferido — libera a OP deste setor.</p>
      )}
    </div>
  );
}

function InternalJobOk({
  job,
  contractors,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
}) {
  const startMut = useMarkAtelierInternalStart();
  const doneMut = useMarkAtelierInternalDone();
  const next = atelierNextInternalOk(job.pipeline_status);
  const busy = startMut.isPending || doneMut.isPending;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          {ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector}
          <span className="ml-1.5 font-normal text-muted-foreground">{job.order_number}</span>
        </p>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatQty(Number(job.pairs))} pares
        </span>
      </div>
      <ModeSelector job={job} contractors={contractors} />
      <InternalOkRail status={job.pipeline_status} />

      {next === 'in_progress' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => startMut.mutate(job.id)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Factory className="h-3.5 w-3.5" />}
            OK · Em realização
          </Button>
        </div>
      )}

      {next === 'done' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => doneMut.mutate(job.id)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            OK · Concluído
          </Button>
        </div>
      )}

      {job.pipeline_status === 'done' && (
        <p className="text-[11px] font-medium text-foreground">Concluído — libera a OP deste setor.</p>
      )}
    </div>
  );
}

function CutOk({ lot }: { lot: AtelierLotRow }) {
  const cutMut = useConfirmAtelierLotCut();
  if (lot.status === 'cut' || lot.status === 'cancelled') {
    return (
      <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-xs text-foreground">
        <Scissors className="mr-1 inline h-3.5 w-3.5" />
        Corte na fábrica · {lot.status === 'cut' ? 'feito' : 'cancelado'}
        {lot.cut_at ? ` em ${formatDay(lot.cut_at)}` : ''}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
      <p className="text-xs text-muted-foreground">Corte na fábrica (sem envio ao prestador)</p>
      <Button
        size="sm"
        className="h-8"
        disabled={cutMut.isPending}
        onClick={() => {
          if (!window.confirm(`Confirmar o corte do ${lot.lot_number}? O material do kit sai do estoque agora.`)) {
            return;
          }
          cutMut.mutate(lot.id);
        }}
      >
        {cutMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
        OK · Cortar
      </Button>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  options,
  resultCount,
}: {
  filters: AtelierReportFilters;
  onChange: (next: AtelierReportFilters) => void;
  options: ReturnType<typeof collectFilterOptions>;
  resultCount: number;
}) {
  const set = <K extends keyof AtelierReportFilters>(key: K, value: AtelierReportFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Filtrar pedidos</p>
          <p className="text-xs text-muted-foreground">
            Cliente, entrega, semana, cor e tipo de material do kit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{resultCount} na lista</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => onChange({ ...EMPTY_ATELIER_REPORT_FILTERS })}
          >
            Limpar
          </Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1 text-xs">
          <span className="text-muted-foreground">Cliente</span>
          <SearchInput
            value={filters.client}
            onChange={(v) => set('client', v)}
            placeholder="Cliente…"
            disableSlashFocus
            hideHint
            inputClassName="h-9"
          />
        </div>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Entrega de</span>
          <Input
            type="date"
            className="h-9"
            value={filters.dateFrom}
            onChange={(e) => set('dateFrom', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Entrega até</span>
          <Input
            type="date"
            className="h-9"
            value={filters.dateTo}
            onChange={(e) => set('dateTo', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Semana</span>
          <Input
            list="atelie-report-weeks"
            className="h-9 font-mono"
            value={filters.week}
            onChange={(e) => set('week', e.target.value)}
            placeholder="2026-W42"
          />
          <datalist id="atelie-report-weeks">
            {options.weeks.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Cor</span>
          <Input
            list="atelie-report-colors"
            className="h-9"
            value={filters.color}
            onChange={(e) => set('color', e.target.value)}
            placeholder="Cor do lote"
          />
          <datalist id="atelie-report-colors">
            {options.colors.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Tipo de material</span>
          <Input
            list="atelie-report-materials"
            className="h-9"
            value={filters.material}
            onChange={(e) => set('material', e.target.value)}
            placeholder="Cabedal, napa…"
          />
          <datalist id="atelie-report-materials">
            {options.materials.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>
    </Panel>
  );
}

export function AtelierRelatorioView() {
  const { data: lots = [], isLoading, isError, refetch } = useAtelierLots();
  const { data: contractors = [] } = useContractors();
  const [filters, setFilters] = useState<AtelierReportFilters>({ ...EMPTY_ATELIER_REPORT_FILTERS });
  const [tab, setTab] = useState<ReportTab>('contractor');

  const contractorOpts = (contractors as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const flatRows = useMemo(() => {
    return lots.flatMap((lot) =>
      (lot.orders ?? []).map((order) => ({
        lot,
        order,
        clientName: order.client_name,
        deliveryDeadline: order.delivery_deadline,
        billingWeek: order.billing_week,
        color: lot.color,
        materialLabels: materialLabelsForLot(lot),
      })),
    );
  }, [lots]);

  const options = useMemo(() => collectFilterOptions(flatRows), [flatRows]);

  const filteredLotsByOrder = useMemo(() => {
    const kept = flatRows.filter((r) => {
      if (!matchesAtelierReportFilters(r, filters)) return false;
      const jobs = r.lot.jobs ?? [];
      if (jobs.length === 0) return tab === 'contractor';
      return jobs.some((j) => jobMatchesTab(j, tab));
    });
    return groupReportByOrderThenReference(kept, ({ lot, order }) => ({
      saleOrderId: order.sale_order_id,
      orderNumber: order.order_number,
      clientName: order.client_name,
      deliveryDeadline: order.delivery_deadline,
      referenceLabel: lot.reference_code ?? lot.reference_name ?? 'Sem referência',
      referenceKey: lot.reference_id,
      pairs: Number(order.pairs) || 0,
    }));
  }, [flatRows, filters, tab]);

  if (isError) {
    return <p className="text-sm text-destructive">Não foi possível carregar o relatório.</p>;
  }
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalPairs = filteredLotsByOrder.reduce((sum, g) => sum + g.pairs, 0);
  const hasAny = lots.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pedidos do Ateliê pela entrega. Corte na fábrica; Costura/Aviamento em{' '}
          <span className="font-medium text-foreground">interno</span> (em realização → concluído) ou{' '}
          <span className="font-medium text-foreground">prestador</span> (enviado → realizado → conferido).
          {hasAny && (
            <>
              {' '}
              <span className="font-medium text-foreground">
                {filteredLotsByOrder.length}{' '}
                {filteredLotsByOrder.length === 1 ? 'pedido' : 'pedidos'} · {formatQty(totalPairs)} pares
              </span>
            </>
          )}
        </p>
        <Button variant="outline" size="sm" className="h-8" onClick={() => void refetch()}>
          Atualizar
        </Button>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist">
        {([
          { id: 'contractor' as const, label: 'Prestador', icon: Truck },
          { id: 'internal' as const, label: 'Interno', icon: Factory },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {hasAny && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          options={options}
          resultCount={filteredLotsByOrder.length}
        />
      )}

      {!hasAny ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum pedido no Ateliê"
          description="Quando um pedido com referência do Ateliê for aprovado, ele aparece aqui pela data de entrega."
        />
      ) : filteredLotsByOrder.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum pedido nesta aba / filtros"
          description={
            tab === 'internal'
              ? 'Não há jobs internos. Troque para Prestador ou limpe os filtros.'
              : 'Limpe os filtros ou ajuste cliente, prazo, semana, cor ou material.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredLotsByOrder.map((group) => (
            <Panel key={group.saleOrderId} className="space-y-3 p-4">
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/60 pb-2">
                <h2 className="font-display text-lg leading-none text-foreground">
                  {group.orderNumber || '—'}
                </h2>
                <span className="text-sm text-muted-foreground">{group.clientName || '—'}</span>
                <span className="text-xs text-muted-foreground">
                  Entrega{' '}
                  <span className="font-medium text-foreground">
                    {group.deliveryDeadline ? formatDay(group.deliveryDeadline) : '—'}
                  </span>
                </span>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[11px] font-medium',
                    deadlineChipClass(group.deliveryDeadline),
                  )}
                >
                  {deadlineChipLabel(group.daysUntilDeadline)}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {formatQty(group.pairs)} pares
                </span>
              </header>

              {group.references.map((ref) => (
                <section key={ref.key} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="font-display text-sm leading-none text-foreground">{ref.label}</h3>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatQty(ref.pairs)} pares · {ref.rows.length}{' '}
                      {ref.rows.length === 1 ? 'cor' : 'cores'}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {ref.rows.map(({ lot, order }) => {
                      const col = atelierLotColumn(
                        lot.status,
                        lot.jobs.map((j) => j.pipeline_status),
                      );
                      const jobs = (lot.jobs ?? []).filter((j) => jobMatchesTab(j, tab));
                      return (
                        <li
                          key={`${lot.id}-${order.sale_order_id}`}
                          className="space-y-2 rounded-lg border border-border/70 bg-card p-3"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <span className="text-sm font-semibold text-foreground">
                                {lot.color ?? 'Sem cor'}
                              </span>
                              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                                {lot.lot_number}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {ATELIER_PIPELINE_LABEL[col] ?? col} ·{' '}
                              <span className="font-mono font-semibold text-foreground">
                                {formatQty(Number(order.pairs) || 0)} pares
                              </span>
                            </span>
                          </div>

                          <KitQtyList lot={lot} />
                          <CutOk lot={lot} />

                          {jobs.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Sem Costura/Aviamento neste modo — só o corte na fábrica, ou troque o modo da linha.
                            </p>
                          ) : tab === 'internal' ? (
                            jobs.map((job) => (
                              <InternalJobOk key={job.id} job={job} contractors={contractorOpts} />
                            ))
                          ) : (
                            jobs.map((job) => (
                              <ContractorJobOk key={job.id} job={job} contractors={contractorOpts} />
                            ))
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
