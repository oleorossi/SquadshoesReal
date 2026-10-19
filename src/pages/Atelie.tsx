/**
 * Ateliê — referências complexas preparadas antes da OP (specs/atelie-corte-antecipado.md).
 * ?view=cadastro | fila
 * Fila por LOTE (ref × cor, vários PVs): Aguardando corte → Cortado →
 * No prestador → Voltou. O corte é aqui; a OP só nasce depois do retorno.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  CircleNotch as Loader2,
  Factory,
  Plus,
  Scissors,
  Truck,
  Warehouse,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  ATELIER_PIPELINE_LABEL,
  ATELIER_QUEUE_COLUMNS,
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTORS,
  atelierEffectiveMode,
  atelierLotColumn,
  atelierNextInternalOk,
  atelierNextStreetOk,
  groupAtelierLotsByReference,
  type AtelierExecutionMode,
  type AtelierSector,
} from '@/lib/atelier';
import {
  EMPTY_ATELIER_FILA_FILTERS,
  collectFilaFilterOptions,
  matchesAtelierFilaFilters,
  type AtelierFilaFilters,
} from '@/lib/atelierFilaFilters';
import { kitShortageLabels, lotHasKitShortage } from '@/lib/atelierKitShortage';
import {
  useAddAtelierReference,
  useAtelierCatalog,
  useAtelierLotKitPreview,
  useAtelierLots,
  useAtelierSettings,
  useConfirmAtelierLotCut,
  useMarkAtelierInternalDone,
  useMarkAtelierInternalStart,
  useMarkAtelierRealized,
  useMarkAtelierReceived,
  useMarkAtelierSent,
  useReapplyAtelierEligibility,
  useRemoveAtelierReference,
  useSetAtelierJobExecutionMode,
  useTechnicalSheetsLiteForAtelier,
  useUpdateAtelierSettings,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { useContractors } from '@/hooks/useContractors';
import { deadlineChipLabel, deadlineTone } from '@/lib/reportOrderGrouping';
import { daysUntilDeadline } from '@/lib/production/productionSequence';
import { cn } from '@/lib/utils';
import { AtelierRelatorioView } from '@/components/atelier/AtelierRelatorioView';

const VIEW_SET = new Set(['cadastro', 'fila', 'relatorio']);

function sheetLabel(s: {
  code?: string | null;
  model?: string | null;
  name?: string | null;
}): string {
  return [s.code, s.model || s.name].filter(Boolean).join(' · ') || 'Sem código';
}

function formatQty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

function formatDay(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** Tom do prazo de entrega do PV mais apertado do lote. */
function deadlineChipClass(lot: { min_delivery_deadline: string | null }): string {
  const tone = deadlineTone(daysUntilDeadline(lot.min_delivery_deadline));
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

/** Kit antes do corte: o que vai sair do estoque e onde falta. */
function KitPreview({ lotId }: { lotId: string }) {
  const { data: kit = [], isLoading, isError } = useAtelierLotKitPreview(lotId);
  if (isLoading) return <p className="text-xs text-muted-foreground">Calculando o kit…</p>;
  if (isError) return <p className="text-xs text-destructive">Não foi possível calcular o kit.</p>;
  if (kit.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem material no kit — o corte só registra a etapa.</p>;
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
            <span
              className={cn(
                'shrink-0 font-mono tabular-nums',
                short ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
              )}
            >
              {formatQty(Number(k.required))} {k.unit ?? ''}
              {short ? ` (tem ${formatQty(Number(k.available))})` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function JobRow({
  job,
  contractors,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
}) {
  const mode = atelierEffectiveMode(job.execution_mode);
  const setMode = useSetAtelierJobExecutionMode();
  const sendMut = useMarkAtelierSent();
  const realizedMut = useMarkAtelierRealized();
  const receiveMut = useMarkAtelierReceived();
  const startMut = useMarkAtelierInternalStart();
  const doneMut = useMarkAtelierInternalDone();
  const [contractorId, setContractorId] = useState(job.contractor_id ?? '');
  const canChangeMode = job.pipeline_status === 'cut' || job.pipeline_status === 'awaiting_cut';
  const nextStreet = atelierNextStreetOk(job.pipeline_status);
  const nextInternal = atelierNextInternalOk(job.pipeline_status);
  const busy =
    setMode.isPending ||
    sendMut.isPending ||
    realizedMut.isPending ||
    receiveMut.isPending ||
    startMut.isPending ||
    doneMut.isPending;
  const kitLines = Array.isArray(job.sent_kit_lines) ? job.sent_kit_lines : [];

  return (
    <div className="space-y-1 border-t border-border/50 pt-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px] leading-tight">
        <span className="font-medium text-foreground">
          {ATELIER_SECTOR_LABEL[job.sector]} · {job.order_number}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {Number(job.pairs)}p · {ATELIER_PIPELINE_LABEL[job.pipeline_status]}
        </span>
      </div>

      {canChangeMode && (
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['internal', 'contractor'] as AtelierExecutionMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() =>
                setMode.mutate({
                  jobId: job.id,
                  mode: m,
                  contractorId: m === 'contractor' ? contractorId || null : null,
                })
              }
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                mode === m
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {ATELIER_EXECUTION_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {mode === 'contractor' && nextStreet === 'sent_to_contractor' && (
        <div className="flex gap-1">
          <Select value={contractorId || undefined} onValueChange={setContractorId}>
            <SelectTrigger className="h-7 flex-1 text-[11px]" aria-label="Prestador">
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
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={busy || !contractorId}
            onClick={() => sendMut.mutate({ jobId: job.id, contractorId })}
          >
            <Truck className="h-3 w-3" />
            Enviar
          </Button>
        </div>
      )}

      {mode === 'contractor' && nextStreet === 'realized' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-muted-foreground">
              {job.contractor_name ?? 'Prestador'}
              {job.atelier_service_number ? ` · ${job.atelier_service_number}` : ''}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => realizedMut.mutate(job.id)}
            >
              <CheckCircle className="h-3 w-3" />
              Realizado
            </Button>
          </div>
          {kitLines.length > 0 && (
            <ul className="rounded border border-border/50 bg-muted/20 px-1.5 py-1 text-[10px] text-muted-foreground">
              {kitLines.map((line) => (
                <li key={`${line.product_id}-${line.product_name}`}>
                  <span className="font-medium text-foreground">{line.product_name}</span>
                  {' · '}
                  <span className="font-mono tabular-nums">
                    {formatQty(Number(line.quantity) || 0)}
                    {line.unit ? ` ${line.unit}` : ''}
                  </span>
                  <span> enviados</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'contractor' && nextStreet === 'received_at_factory' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">Conferir na fábrica</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={busy}
            onClick={() => receiveMut.mutate(job.id)}
          >
            <Warehouse className="h-3 w-3" />
            Conferir
          </Button>
        </div>
      )}

      {mode === 'internal' && nextInternal === 'in_progress' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={busy}
            onClick={() => startMut.mutate(job.id)}
          >
            <Factory className="h-3 w-3" />
            Em realização
          </Button>
        </div>
      )}

      {mode === 'internal' && nextInternal === 'done' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={busy}
            onClick={() => doneMut.mutate(job.id)}
          >
            <CheckCircle className="h-3 w-3" />
            Concluído
          </Button>
        </div>
      )}

      {mode === 'internal' && job.pipeline_status === 'done' && (
        <p className="text-[10px] font-medium text-foreground">Concluído — libera a OP deste setor.</p>
      )}
    </div>
  );
}

function LotCard({
  lot,
  contractors,
  focusOrderNumber,
}: {
  lot: AtelierLotRow;
  contractors: { id: string; name: string }[];
  /** Quando a fila filtra por PV, destaca esse pedido no cartão. */
  focusOrderNumber?: string;
}) {
  const cutMut = useConfirmAtelierLotCut();
  const [showKit, setShowKit] = useState(false);
  const shortage = lotHasKitShortage(lot.debits);
  const shortageLabels = kitShortageLabels(lot.debits);
  const focused = focusOrderNumber
    ? lot.orders.filter((o) => o.order_number === focusOrderNumber)
    : lot.orders;
  const displayOrders = focused.length > 0 ? focused : lot.orders;
  const displayJobs = focusOrderNumber
    ? lot.jobs.filter((j) => j.order_number === focusOrderNumber)
    : lot.jobs;
  const clients = [...new Set(displayOrders.map((o) => o.client_name).filter(Boolean))];
  const pairsShown = focusOrderNumber && focused.length > 0
    ? focused.reduce((s, o) => s + Number(o.pairs ?? 0), 0)
    : Number(lot.pairs);

  return (
    <article
      className={cn(
        'space-y-1.5 rounded-md border p-2',
        shortage
          ? 'border-red-500/50 bg-red-500/10'
          : 'border-border/70 bg-card',
      )}
    >
      <header className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-1.5">
          <p className="min-w-0 truncate font-display text-sm leading-none text-foreground">
            {lot.reference_code ?? '—'}
            <span className="ml-1 font-sans text-[11px] font-normal text-muted-foreground">
              {lot.color ?? 'Sem cor'}
            </span>
          </p>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{lot.lot_number}</span>
        </div>
        <p className="truncate text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{pairsShown}p</span>
          {focusOrderNumber && Number(lot.pairs) !== pairsShown ? (
            <span className="text-muted-foreground"> / {Number(lot.pairs)}p lote</span>
          ) : null}
          {' · '}
          {displayOrders.map((o) => o.order_number).join(', ')}
          {clients.length > 0 ? ` · ${clients.join(', ')}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-muted-foreground">
            Entrega{' '}
            <span className="font-medium text-foreground">
              {lot.min_delivery_deadline ? formatDay(lot.min_delivery_deadline) : '—'}
            </span>
            {lot.min_ready_date ? ` · pronto ${formatDay(lot.min_ready_date)}` : ''}
          </span>
          <span className={cn('rounded border px-1 py-px font-medium', deadlineChipClass(lot))}>
            {deadlineChipLabel(daysUntilDeadline(lot.min_delivery_deadline))}
          </span>
        </div>
      </header>

      <GradeStrip grade={lot.grade} />

      {lot.status === 'open' && (
        <div className="space-y-1.5">
          {showKit ? (
            <KitPreview lotId={lot.id} />
          ) : (
            <button
              type="button"
              onClick={() => setShowKit(true)}
              className="text-[11px] font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Ver kit
            </button>
          )}
          <Button
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={cutMut.isPending}
            onClick={() => {
              if (!window.confirm(`Confirmar o corte do ${lot.lot_number}? O material do kit sai do estoque agora.`)) {
                return;
              }
              cutMut.mutate(lot.id);
            }}
          >
            {cutMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
            Confirmar corte
          </Button>
        </div>
      )}

      {shortage && (
        <p className="rounded border border-red-500/30 bg-red-500/15 px-1.5 py-1 text-[10px] font-medium text-red-700 dark:text-red-400">
          Falta no kit: {shortageLabels.join(', ')}. Continua na fila — complete o estoque.
        </p>
      )}

      {lot.status === 'cut' &&
        displayJobs.map((job) => (
          <JobRow key={job.id} job={job} contractors={contractors} />
        ))}
    </article>
  );
}

function AgendaSettings() {
  const { data: settings, isLoading } = useAtelierSettings();
  const update = useUpdateAtelierSettings();
  const [costura, setCostura] = useState<string | null>(null);
  const [aviamento, setAviamento] = useState<string | null>(null);
  const [readyBefore, setReadyBefore] = useState<string | null>(null);

  const costuraVal = costura ?? String(settings?.costura_offset_days ?? 5);
  const aviVal = aviamento ?? String(settings?.aviamento_offset_days ?? 5);
  const readyVal = readyBefore ?? String(settings?.ready_before_billing_days ?? 7);

  const save = (field: 'costura' | 'aviamento' | 'ready', raw: string) => {
    const n = Math.max(0, Math.min(90, Math.round(Number(raw) || 0)));
    if (field === 'costura') {
      setCostura(String(n));
      if (n !== (settings?.costura_offset_days ?? 5)) {
        update.mutate({ costuraOffsetDays: n });
      }
    } else if (field === 'aviamento') {
      setAviamento(String(n));
      if (n !== (settings?.aviamento_offset_days ?? 5)) {
        update.mutate({ aviamentoOffsetDays: n });
      }
    } else {
      setReadyBefore(String(n));
      if (n !== (settings?.ready_before_billing_days ?? 7)) {
        update.mutate({ readyBeforeBillingDays: n });
      }
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agenda · pronto antes do faturamento
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Material do kit pronto N dias antes do faturamento (ex.: fatura 14 → pronto 7). Se faltar em
            estoque, a OC antecipa: chegar = pronto − max(Costura, Aviamento); comprar = chegar − lead do
            fornecedor — para o cabedal estar pronto quando a produção começa.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Pronto (−dias)
            </span>
            <Input
              type="number"
              min={0}
              max={90}
              className="h-9 w-20 font-mono text-right"
              disabled={isLoading || update.isPending}
              value={readyVal}
              onChange={(e) => setReadyBefore(e.target.value)}
              onBlur={(e) => save('ready', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Costura
            </span>
            <Input
              type="number"
              min={0}
              max={60}
              className="h-9 w-20 font-mono text-right"
              disabled={isLoading || update.isPending}
              value={costuraVal}
              onChange={(e) => setCostura(e.target.value)}
              onBlur={(e) => save('costura', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Aviamento
            </span>
            <Input
              type="number"
              min={0}
              max={60}
              className="h-9 w-20 font-mono text-right"
              disabled={isLoading || update.isPending}
              value={aviVal}
              onChange={(e) => setAviamento(e.target.value)}
              onBlur={(e) => save('aviamento', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
      </div>
    </Panel>
  );
}

function CadastroView() {
  const [sector, setSector] = useState<AtelierSector>('costura_cabedal');
  const [sheetId, setSheetId] = useState<string>('');
  const [q, setQ] = useState('');
  const { data: catalog = [], isLoading, isError } = useAtelierCatalog(sector);
  const { data: sheets = [] } = useTechnicalSheetsLiteForAtelier();
  const addMut = useAddAtelierReference();
  const removeMut = useRemoveAtelierReference();
  const reapply = useReapplyAtelierEligibility();

  const filteredSheets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inSector = new Set(catalog.map((c) => c.reference_id));
    return sheets
      .filter((s) => !inSector.has(s.id))
      .filter((s) => {
        if (!needle) return true;
        return sheetLabel(s).toLowerCase().includes(needle);
      })
      .slice(0, 40);
  }, [sheets, catalog, q]);

  return (
    <div className="space-y-4">
      <Tabs value={sector} onValueChange={(v) => setSector(v as AtelierSector)}>
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-0.5">
          {ATELIER_SECTORS.map((s) => (
            <TabsTrigger key={s} value={s} className="text-xs">
              {ATELIER_SECTOR_LABEL[s]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Panel className="p-4 space-y-3">
        {sector === 'corte_cabedal' ? (
          <p className="text-sm text-muted-foreground">
            O corte das referências do Ateliê já acontece na fila do Ateliê, por lote. Cadastrar aqui só marca a
            referência — o que manda para o prestador é Costura ou Aviamento.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cadastre as referências que fazem {ATELIER_SECTOR_LABEL[sector].toLowerCase()} no prestador. Quando o pedido
            é aprovado, cada cor entra num lote da fila: corte aqui, envio, e a OP só nasce quando voltar. A ficha precisa
            ter esse setor — o cadastro recusa se não tiver.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Buscar ficha…"
            className="h-9 flex-1"
          />
          <Select value={sheetId || undefined} onValueChange={setSheetId}>
            <SelectTrigger className="h-9 sm:w-[280px]">
              <SelectValue placeholder="Escolher referência" />
            </SelectTrigger>
            <SelectContent>
              {filteredSheets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {sheetLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-9"
            disabled={!sheetId || addMut.isPending}
            onClick={() => {
              if (!sheetId) return;
              addMut.mutate(
                { referenceId: sheetId, sector },
                { onSuccess: () => setSheetId('') },
              );
            }}
          >
            {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Cadastrar
          </Button>
        </div>
      </Panel>

      {isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o cadastro.</p>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : catalog.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="Nenhuma referência neste setor"
          description="Só o que estiver aqui gera demanda Ateliê quando o PV for aprovado."
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
          {catalog.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {sheetLabel(row.technical_sheets ?? {})}
                </p>
                <p className="text-xs text-muted-foreground">{ATELIER_SECTOR_LABEL[row.sector]}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive"
                disabled={removeMut.isPending}
                onClick={() => {
                  if (!window.confirm('Remover esta referência do Ateliê?')) return;
                  removeMut.mutate(row.id);
                }}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={reapply.isPending}
          onClick={() => {
            if (
              !window.confirm(
                'Reaplicar Ateliê? Lotes ainda não cortados de referências que saíram do cadastro são cancelados, e pedidos Aprovados ou Em Produção sem OP entram na fila.',
              )
            ) {
              return;
            }
            reapply.mutate();
          }}
        >
          {reapply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Reaplicar Ateliê
        </Button>
        <Button variant="ghost" size="sm" className="h-8" asChild>
          <Link to="/terceirizados?tab=relatorio">Ir ao Relatório · Terceirizados</Link>
        </Button>
      </div>
    </div>
  );
}

const COLUMN_TITLE: Record<string, string> = {
  awaiting_cut: 'Aguardando corte',
  cut: 'Cortado · enviar',
  sent_to_contractor: 'Enviado ao prestador',
  realized: 'Realizado',
  received_at_factory: 'Recebido e conferido',
};

function FilaView() {
  const { data: lots = [], isLoading, isError, refetch } = useAtelierLots();
  const { data: contractors = [] } = useContractors();
  const [filters, setFilters] = useState<AtelierFilaFilters>(EMPTY_ATELIER_FILA_FILTERS);

  const contractorOpts = (contractors as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const filterOptions = useMemo(() => collectFilaFilterOptions(lots), [lots]);

  const filteredLots = useMemo(
    () => lots.filter((lot) => matchesAtelierFilaFilters(lot, filters)),
    [lots, filters],
  );

  const byColumn = useMemo(() => {
    const m = new Map<string, AtelierLotRow[]>();
    for (const lot of filteredLots) {
      const col = atelierLotColumn(
        lot.status,
        lot.jobs.map((j) => j.pipeline_status),
        lot.kit_gate,
      );
      m.set(col, [...(m.get(col) ?? []), lot]);
    }
    return m;
  }, [filteredLots]);

  const filtersActive = Boolean(filters.orderNumber || filters.color);

  return (
    <div className="space-y-3">
      <AgendaSettings />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <label className="flex min-w-[140px] flex-1 flex-col gap-1 sm:max-w-[200px]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Pedido
            </span>
            <Select
              value={filters.orderNumber || '__all__'}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, orderNumber: v === '__all__' ? '' : v }))
              }
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Filtrar por pedido">
                <SelectValue placeholder="Todos os PVs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os PVs</SelectItem>
                {filterOptions.orderNumbers.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex min-w-[140px] flex-1 flex-col gap-1 sm:max-w-[200px]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Cor
            </span>
            <Select
              value={filters.color || '__all__'}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, color: v === '__all__' ? '' : v }))
              }
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Filtrar por cor">
                <SelectValue placeholder="Todas as cores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as cores</SelectItem>
                {filterOptions.colors.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {filtersActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 self-end text-xs"
              onClick={() => setFilters(EMPTY_ATELIER_FILA_FILTERS)}
            >
              Limpar filtros
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => void refetch()}>
          Atualizar
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Pedido isola um PV quando a mesma ref está em vários pedidos. Cor lista todos os lotes daquela
        cor, em qualquer referência.
        {filtersActive
          ? ` · ${filteredLots.length} de ${lots.length} lote${lots.length === 1 ? '' : 's'}`
          : null}
      </p>

      {isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar a fila.</p>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : lots.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum lote no Ateliê"
          description="Quando um pedido com referência do Ateliê for aprovado, cada cor entra num lote aqui."
        />
      ) : filteredLots.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum lote com esses filtros"
          description="Troque o pedido ou a cor, ou limpe os filtros."
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-5">
          {ATELIER_QUEUE_COLUMNS.map((col) => {
            const colLots = byColumn.get(col) ?? [];
            const active = colLots.length > 0;
            return (
              <section key={col} className="space-y-1.5" aria-labelledby={`col-${col}`}>
                <header className="flex items-baseline justify-between gap-1 px-0.5">
                  <h2
                    id={`col-${col}`}
                    className={cn(
                      'text-xs font-semibold leading-tight',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {COLUMN_TITLE[col]}
                  </h2>
                  <span
                    className={cn(
                      'font-mono text-[10px] tabular-nums',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {colLots.length}
                  </span>
                </header>
                <div
                  className={cn(
                    'min-h-[72px] space-y-1.5 rounded-md p-1.5',
                    active
                      ? 'border border-border bg-card/80'
                      : 'border border-dashed border-border/40 bg-muted/10',
                  )}
                >
                  {colLots.length === 0 ? (
                    <p className="py-3 text-center text-[10px] text-muted-foreground">—</p>
                  ) : (
                    groupAtelierLotsByReference(colLots).map((refGroup) => (
                      <section key={refGroup.key} className="space-y-1.5">
                        <header className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 px-0.5">
                          <h3 className="font-display text-xs leading-none text-foreground">
                            {refGroup.label}
                          </h3>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {refGroup.pairs}p · {refGroup.lots.length}{' '}
                            {refGroup.lots.length === 1 ? 'cor' : 'cores'}
                          </span>
                        </header>
                        {refGroup.lots.map((lot) => (
                          <LotCard
                            key={lot.id}
                            lot={lot}
                            contractors={contractorOpts}
                            focusOrderNumber={filters.orderNumber || undefined}
                          />
                        ))}
                      </section>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Atelie() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view') ?? 'fila';
  const view = VIEW_SET.has(raw) ? raw : 'fila';

  const setView = (v: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('view', v);
        return p;
      },
      { replace: true },
    );
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · ATELIÊ"
        title="Ateliê"
        description="Cabedal complexo: na ficha, marque o kit por setor. Corte na fábrica; Costura/Aviamento interno (em realização → concluído) ou prestador (enviado → realizado → conferido) antes da OP."
        actions={
          <Button variant="outline" size="sm" className="h-9" asChild>
            <Link to="/terceirizados">
              <ArrowLeft className="h-3.5 w-3.5" />
              Terceirizados
            </Link>
          </Button>
        }
      />

      <Tabs value={view} onValueChange={setView} className="space-y-4">
        <TabsList className="h-11 bg-muted/50 p-0.5">
          <TabsTrigger value="fila" className="text-xs sm:text-sm">
            Fila operacional
          </TabsTrigger>
          <TabsTrigger value="relatorio" className="text-xs sm:text-sm">
            Relatório
          </TabsTrigger>
          <TabsTrigger value="cadastro" className="text-xs sm:text-sm">
            Modelos complexos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fila">
          <FilaView />
        </TabsContent>
        <TabsContent value="relatorio">
          <AtelierRelatorioView />
        </TabsContent>
        <TabsContent value="cadastro">
          <CadastroView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
