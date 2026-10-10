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
  ATELIER_PIPELINE_LABEL,
  ATELIER_QUEUE_COLUMNS,
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTORS,
  atelierLotColumn,
  type AtelierSector,
} from '@/lib/atelier';
import {
  useAddAtelierReference,
  useAtelierCatalog,
  useAtelierLotKitPreview,
  useAtelierLots,
  useAtelierSettings,
  useConfirmAtelierLotCut,
  useMarkAtelierReceived,
  useMarkAtelierSent,
  useReapplyAtelierEligibility,
  useRemoveAtelierReference,
  useTechnicalSheetsLiteForAtelier,
  useUpdateAtelierSettings,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { useContractors } from '@/hooks/useContractors';
import { cn } from '@/lib/utils';

const VIEW_SET = new Set(['cadastro', 'fila']);

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

function GradeStrip({ grade }: { grade: Record<string, number> }) {
  const sizes = Object.keys(grade)
    .filter((k) => Number(grade[k]) > 0)
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  if (sizes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" aria-label="Grade do lote">
      {sizes.map((size) => (
        <span
          key={size}
          className="inline-flex items-baseline gap-1 rounded border border-border/70 px-1.5 py-0.5 font-mono text-[11px]"
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
  onSend,
  onReceive,
  busy,
}: {
  job: AtelierLotJob;
  contractors: { id: string; name: string }[];
  onSend: (contractorId: string) => void;
  onReceive: () => void;
  busy: boolean;
}) {
  const [contractorId, setContractorId] = useState<string>('');
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {ATELIER_SECTOR_LABEL[job.sector]} · {job.order_number}
        </span>
        <span className="text-muted-foreground">
          {Number(job.pairs)} pares · {ATELIER_PIPELINE_LABEL[job.pipeline_status]}
        </span>
      </div>
      {job.pipeline_status === 'cut' && (
        <div className="flex gap-1.5">
          <Select value={contractorId || undefined} onValueChange={setContractorId}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Prestador">
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
          <Button size="sm" className="h-8" disabled={busy || !contractorId} onClick={() => onSend(contractorId)}>
            <Truck className="h-3.5 w-3.5" />
            Enviar
          </Button>
        </div>
      )}
      {job.pipeline_status === 'sent_to_contractor' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {job.contractor_name ?? 'Prestador'}
            {job.atelier_service_number ? ` · ${job.atelier_service_number}` : ''}
          </span>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onReceive}>
            <Warehouse className="h-3.5 w-3.5" />
            Voltou
          </Button>
        </div>
      )}
    </div>
  );
}

function LotCard({ lot, contractors }: { lot: AtelierLotRow; contractors: { id: string; name: string }[] }) {
  const cutMut = useConfirmAtelierLotCut();
  const sendMut = useMarkAtelierSent();
  const receiveMut = useMarkAtelierReceived();
  const [showKit, setShowKit] = useState(false);
  const pending = lot.debits.filter((d) => Number(d.pending_qty) > 0);
  const clients = [...new Set(lot.orders.map((o) => o.client_name).filter(Boolean))];

  return (
    <article className="space-y-2 rounded-lg border border-border/70 bg-card p-3">
      <header className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-base leading-tight text-foreground">
            {lot.reference_code ?? '—'}
            <span className="ml-1.5 font-sans text-sm text-muted-foreground">{lot.color ?? 'Sem cor'}</span>
          </h3>
          <span className="font-mono text-[11px] text-muted-foreground">{lot.lot_number}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{Number(lot.pairs)} pares</span>
          {' · '}
          {lot.orders.map((o) => o.order_number).join(', ')}
          {lot.min_ready_date ? ` · pronto até ${formatDay(lot.min_ready_date)}` : ''}
        </p>
        {clients.length > 0 && <p className="truncate text-[11px] text-muted-foreground">{clients.join(', ')}</p>}
      </header>

      <GradeStrip grade={lot.grade} />

      {lot.status === 'open' && (
        <div className="space-y-2">
          {showKit ? (
            <KitPreview lotId={lot.id} />
          ) : (
            <button
              type="button"
              onClick={() => setShowKit(true)}
              className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Ver o kit de material
            </button>
          )}
          <Button
            size="sm"
            className="h-8 w-full"
            disabled={cutMut.isPending}
            onClick={() => {
              if (!window.confirm(`Confirmar o corte do ${lot.lot_number}? O material do kit sai do estoque agora.`)) {
                return;
              }
              cutMut.mutate(lot.id);
            }}
          >
            {cutMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
            Confirmar corte
          </Button>
        </div>
      )}

      {lot.status === 'cut' && pending.length > 0 && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          Faltou no corte: {pending.map((d) => `${d.product_name} ${formatQty(Number(d.pending_qty))}`).join(', ')}.
          A OP completa o que faltou.
        </p>
      )}

      {lot.status === 'cut' &&
        lot.jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            contractors={contractors}
            busy={sendMut.isPending || receiveMut.isPending}
            onSend={(cid) => sendMut.mutate({ jobId: job.id, contractorId: cid })}
            onReceive={() => receiveMut.mutate(job.id)}
          />
        ))}
    </article>
  );
}

function AgendaSettings() {
  const { data: settings, isLoading } = useAtelierSettings();
  const update = useUpdateAtelierSettings();
  const [costura, setCostura] = useState<string | null>(null);
  const [aviamento, setAviamento] = useState<string | null>(null);

  const costuraVal = costura ?? String(settings?.costura_offset_days ?? 5);
  const aviVal = aviamento ?? String(settings?.aviamento_offset_days ?? 5);

  const save = (field: 'costura' | 'aviamento', raw: string) => {
    const n = Math.max(0, Math.min(60, Math.round(Number(raw) || 0)));
    if (field === 'costura') {
      setCostura(String(n));
      if (n !== (settings?.costura_offset_days ?? 5)) {
        update.mutate({ costuraOffsetDays: n });
      }
    } else {
      setAviamento(String(n));
      if (n !== (settings?.aviamento_offset_days ?? 5)) {
        update.mutate({ aviamentoOffsetDays: n });
      }
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agenda · dias úteis antes dos cortes
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Quantos dias úteis antes da data do pedido o lote deve voltar do prestador.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
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
  sent_to_contractor: 'No prestador',
  received_at_factory: 'Voltou · libera a OP',
};

function FilaView() {
  const { data: lots = [], isLoading, isError, refetch } = useAtelierLots();
  const { data: contractors = [] } = useContractors();

  const contractorOpts = (contractors as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const byColumn = useMemo(() => {
    const m = new Map<string, AtelierLotRow[]>();
    for (const lot of lots) {
      const col = atelierLotColumn(lot.status, lot.jobs.map((j) => j.pipeline_status));
      m.set(col, [...(m.get(col) ?? []), lot]);
    }
    return m;
  }, [lots]);

  return (
    <div className="space-y-4">
      <AgendaSettings />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Cada lote junta a mesma referência e cor de vários pedidos. Corte aqui, envie ao prestador e, quando voltar,
          a OP nasce com essas etapas prontas.
        </p>
        <Button variant="outline" size="sm" className="h-8" onClick={() => void refetch()}>
          Atualizar
        </Button>
      </div>

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
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {ATELIER_QUEUE_COLUMNS.map((col) => {
            const colLots = byColumn.get(col) ?? [];
            return (
              <section key={col} className="space-y-2" aria-labelledby={`col-${col}`}>
                <header className="flex items-baseline justify-between px-0.5">
                  <h2 id={`col-${col}`} className="text-sm font-semibold text-foreground">
                    {COLUMN_TITLE[col]}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">{colLots.length}</span>
                </header>
                <div className="min-h-[120px] space-y-2 rounded-lg border border-dashed border-border/50 bg-muted/20 p-2">
                  {colLots.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Nada aqui</p>
                  ) : (
                    colLots.map((lot) => <LotCard key={lot.id} lot={lot} contractors={contractorOpts} />)
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
        description="Referências complexas preparadas antes da produção: corte em lote por cor, envio ao prestador e retorno antes da OP."
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
          <TabsTrigger value="cadastro" className="text-xs sm:text-sm">
            Modelos complexos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fila">
          <FilaView />
        </TabsContent>
        <TabsContent value="cadastro">
          <CadastroView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
