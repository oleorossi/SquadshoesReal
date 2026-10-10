/**
 * Ateliê — cabedal complexo (rua).
 * ?view=cadastro | fila  — cadastro de refs × setor + pipeline
 * Aguardando corte → Debitar → Enviado → Recebido.
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
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTORS,
  ATELIER_STREET_SECTORS,
  type AtelierPipelineStatus,
  type AtelierSector,
} from '@/lib/atelier';
import {
  useAddAtelierReference,
  useAtelierCatalog,
  useAtelierJobs,
  useAtelierSettings,
  useConfirmAtelierDebit,
  useMarkAtelierReceived,
  useMarkAtelierSent,
  useReapplyAtelierEligibility,
  useRemoveAtelierReference,
  useTechnicalSheetsLiteForAtelier,
  useUpdateAtelierSettings,
  type AtelierJobRow,
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

function formatTarget(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}`;
  };
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (end) return `até ${fmt(end)}`;
  return `desde ${fmt(start!)}`;
}

function JobCard({
  job,
  onDebit,
  onSend,
  onReceive,
  debiting,
  sending,
  receiving,
  contractors,
}: {
  job: AtelierJobRow;
  onDebit: () => void;
  onSend: (contractorId?: string) => void;
  onReceive: () => void;
  debiting?: boolean;
  sending?: boolean;
  receiving?: boolean;
  contractors: { id: string; name: string }[];
}) {
  const [contractorId, setContractorId] = useState<string>('');
  const st = job.pipeline_status;
  const targetLabel = formatTarget(job.target_start, job.target_end);

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {job.sale_orders?.order_number ?? 'PV'} · {ATELIER_SECTOR_LABEL[job.sector]}
          </p>
          <p className="font-display text-base leading-tight text-foreground truncate">
            {job.reference_code ?? '—'}
            {job.color ? (
              <span className="ml-1.5 text-sm font-sans text-muted-foreground">{job.color}</span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {job.sale_orders?.client_name || 'Cliente'} · {Number(job.pairs)} pares
            {job.ready_date ? ` · pronto ${job.ready_date}` : ''}
          </p>
          {targetLabel ? (
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              Agenda {targetLabel}
            </p>
          ) : null}
          {job.atelier_service_number ? (
            <p className="mt-1 font-mono text-[11px] text-primary">{job.atelier_service_number}</p>
          ) : null}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium',
            st === 'awaiting_cut' && 'bg-muted text-muted-foreground',
            st === 'awaiting_debit' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            st === 'debited' && 'bg-muted text-foreground',
            st === 'sent_to_contractor' && 'bg-primary/10 text-primary',
            st === 'received_at_factory' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          )}
        >
          {ATELIER_PIPELINE_LABEL[st]}
        </span>
      </div>

      {st === 'awaiting_cut' && (
        <p className="text-xs text-muted-foreground">
          Aparece na fila; as seleções liberam quando <strong className="font-medium text-foreground">Corte Cabedal</strong> da
          OP for concluído no Kanban.
        </p>
      )}

      {st === 'awaiting_debit' && (
        <Button size="sm" className="w-full h-8" onClick={onDebit} disabled={debiting}>
          {debiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
          Confirmar débito
        </Button>
      )}

      {st === 'debited' && (
        <div className="flex flex-col gap-1.5">
          <Select value={contractorId || undefined} onValueChange={setContractorId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Prestador (opcional)" />
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
            className="w-full h-8"
            onClick={() => onSend(contractorId || undefined)}
            disabled={sending}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
            Marcar enviado
          </Button>
        </div>
      )}

      {st === 'sent_to_contractor' && (
        <Button size="sm" className="w-full h-8" onClick={onReceive} disabled={receiving}>
          {receiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Warehouse className="h-3.5 w-3.5" />}
          Recebido na fábrica
        </Button>
      )}
    </div>
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
            Substitui a Antecipação de fábrica. Targets nas jobs usam a âncora de corte − N dias.
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
            <strong className="text-foreground font-medium">Corte é interno</strong> (em casa). Cadastrar aqui marca a
            referência como cabedal complexo; o corte roda no Kanban e{' '}
            <strong className="text-foreground font-medium">destrava Costura/Aviamento</strong> na fila do Ateliê. Não
            gera job de rua de corte.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cadastre só as referências de cabedal <strong className="text-foreground font-medium">complexo</strong> deste
            setor. Após o PV ir para Aprovado, entram na fila como “Aguardando o corte”; as seleções liberam quando
            Corte Cabedal da OP for concluído.
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
                'Reaplicar Ateliê? Demandas abertas fora do cadastro serão canceladas e PVs Aprovado rematerializados.',
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

function FilaView() {
  const [sector, setSector] = useState<AtelierSector>('costura_cabedal');
  const { data: jobs = [], isLoading, isError, refetch } = useAtelierJobs(sector);
  const { data: contractors = [] } = useContractors();
  const debitMut = useConfirmAtelierDebit();
  const sendMut = useMarkAtelierSent();
  const receiveMut = useMarkAtelierReceived();

  const columns: { key: string; title: string; statuses: AtelierPipelineStatus[] }[] = [
    {
      key: 'awaiting_cut',
      title: '0 · Aguardando o corte',
      statuses: ['awaiting_cut'],
    },
    {
      key: 'awaiting_debit',
      title: '1 · Debitar / enviar',
      statuses: ['awaiting_debit', 'debited'],
    },
    {
      key: 'sent_to_contractor',
      title: '2 · No prestador',
      statuses: ['sent_to_contractor'],
    },
    {
      key: 'received_at_factory',
      title: '3 · Recebido',
      statuses: ['received_at_factory'],
    },
  ];

  const contractorOpts = (contractors as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div className="space-y-4">
      <AgendaSettings />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={sector} onValueChange={(v) => setSector(v as AtelierSector)}>
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-0.5">
            {ATELIER_STREET_SECTORS.map((s) => (
              <TabsTrigger key={s} value={s} className="text-xs">
                {ATELIER_SECTOR_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Fila vazia neste setor"
          description="Cadastre referências complexas e aprove PVs — só o que está no Ateliê aparece aqui."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-4 lg:grid-cols-2">
          {columns.map((col) => {
            const colJobs = jobs.filter((j) => col.statuses.includes(j.pipeline_status));
            return (
              <section key={col.key} className="space-y-2">
                <header className="flex items-baseline justify-between px-0.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {col.title}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">{colJobs.length}</span>
                </header>
                <div className="space-y-2 min-h-[120px] rounded-lg border border-dashed border-border/50 bg-muted/20 p-2">
                  {colJobs.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Nada aqui</p>
                  ) : (
                    colJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        contractors={contractorOpts}
                        debiting={debitMut.isPending}
                        sending={sendMut.isPending}
                        receiving={receiveMut.isPending}
                        onDebit={() => debitMut.mutate(job.id)}
                        onSend={(cid) =>
                          sendMut.mutate({ jobId: job.id, contractorId: cid })
                        }
                        onReceive={() => receiveMut.mutate(job.id)}
                      />
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
        description="Cabedal complexo: corte interno destrava a fila; Costura e Aviamento vão pra rua com agenda própria (unificou a Antecipação)."
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
