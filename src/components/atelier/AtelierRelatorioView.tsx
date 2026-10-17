/**
 * Relatório operacional do Ateliê — filtros + OKs por etapa.
 *
 * Corte: só na fábrica (confirmar corte do lote).
 * Costura/Aviamento: Enviado ao prestador → Realizado → Recebido e conferido.
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle,
  CircleNotch as Loader2,
  Scissors,
  Truck,
  Warehouse,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  ATELIER_PIPELINE_LABEL,
  ATELIER_SECTOR_LABEL,
  ATELIER_STREET_OK_STEPS,
  atelierLotColumn,
  atelierNextStreetOk,
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
  useMarkAtelierRealized,
  useMarkAtelierReceived,
  useMarkAtelierSent,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { useContractors } from '@/hooks/useContractors';

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

function StreetOkRail({ status }: { status: AtelierPipelineStatus }) {
  const order: Record<string, number> = {
    cut: 0,
    sent_to_contractor: 1,
    realized: 2,
    received_at_factory: 3,
  };
  const current = order[status] ?? -1;
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Etapas de rua">
      {ATELIER_STREET_OK_STEPS.map((step, i) => {
        const done = current > i + 1 || (current === i + 1 && status === step);
        const active = status === step || (status === 'cut' && step === 'sent_to_contractor' && current === 0);
        return (
          <li
            key={step}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] font-medium',
              done || status === step
                ? 'border-foreground/40 bg-muted text-foreground'
                : active
                  ? 'border-primary/50 bg-primary/5 text-foreground'
                  : 'border-border/60 text-muted-foreground',
            )}
          >
            {i + 1}. {ATELIER_PIPELINE_LABEL[step]}
          </li>
        );
      })}
    </ol>
  );
}

function StreetJobOk({
  job,
  contractors,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
}) {
  const sendMut = useMarkAtelierSent();
  const realizedMut = useMarkAtelierRealized();
  const receiveMut = useMarkAtelierReceived();
  const [contractorId, setContractorId] = useState('');
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
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Cliente</span>
          <Input
            list="atelie-report-clients"
            className="h-9"
            value={filters.client}
            onChange={(e) => set('client', e.target.value)}
            placeholder="Buscar cliente"
          />
          <datalist id="atelie-report-clients">
            {options.clients.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
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
    const kept = flatRows.filter((r) => matchesAtelierReportFilters(r, filters));
    return groupReportByOrderThenReference(kept, ({ lot, order }) => ({
      saleOrderId: order.sale_order_id,
      orderNumber: order.order_number,
      clientName: order.client_name,
      deliveryDeadline: order.delivery_deadline,
      referenceLabel: lot.reference_code ?? lot.reference_name ?? 'Sem referência',
      referenceKey: lot.reference_id,
      pairs: Number(order.pairs) || 0,
    }));
  }, [flatRows, filters]);

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
          Pedidos do Ateliê pela entrega. Corte é OK na fábrica; Costura e Aviamento passam por
          enviado → realizado → recebido e conferido.
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
          title="Nenhum pedido com esses filtros"
          description="Limpe os filtros ou ajuste cliente, prazo, semana, cor ou material."
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

                          <CutOk lot={lot} />

                          {lot.jobs.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Sem Costura/Aviamento neste lote — só o corte na fábrica.
                            </p>
                          ) : (
                            lot.jobs.map((job) => (
                              <StreetJobOk key={job.id} job={job} contractors={contractorOpts} />
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
