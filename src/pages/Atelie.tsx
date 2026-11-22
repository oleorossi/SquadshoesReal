/**
 * Ateliê — cabedal complexo preparado antes da OP.
 * ?view=fila | tiras | relatorio | cadastro
 * ?pedido=PV-00250 filtra a fila. ?modo=pedido abre a linha do tempo do PV.
 * O corte é do lote. A OP nasce no promote para Em Produção, depois que os jobs voltam.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleNotch as Loader2,
  Plus,
  Scissors,
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
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTORS,
  type AtelierSector,
} from '@/lib/atelier';
import { supplementAtelierLotsWithOrderJobs } from '@/lib/atelierOrderSupplement';
import {
  useAddAtelierReference,
  useAtelierCatalog,
  useSetAtelierPrepDays,
  useAtelierLots,
  useAtelierOrderJobs,
  useAtelierSettings,
  useReapplyAtelierEligibility,
  useRemoveAtelierReference,
  useTechnicalSheetsLiteForAtelier,
  useUpdateAtelierSettings,
} from '@/hooks/useAtelier';
import { AtelierExecutionDefaultControl, AtelierSectorAdmin } from '@/components/atelier/AtelierAdminPanel';
import { AtelierOperacao } from '@/components/atelier/AtelierOperacao';
import { AtelierRelatorioView } from '@/components/atelier/AtelierRelatorioView';
import { AtelierLancamento } from '@/components/atelier/AtelierLancamento';
import { AtelierStrapsView } from '@/components/atelier/AtelierStrapsView';

const VIEW_SET = new Set(['cadastro', 'fila', 'lancamento', 'relatorio', 'tiras']);

function sheetLabel(s: {
  code?: string | null;
  model?: string | null;
  name?: string | null;
}): string {
  return [s.code, s.model || s.name].filter(Boolean).join(' · ') || 'Sem código';
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
  const prepMut = useSetAtelierPrepDays();
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
            Cadastre as referências que passam por {ATELIER_SECTOR_LABEL[sector].toLowerCase()}. O padrão interno ou prestador fica aqui e o job novo copia. Até o corte, a fila ainda pode trocar. A OP nasce quando o pedido vai para Em Produção, depois que esses jobs voltam.
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

      {sector !== 'corte_cabedal' && <AtelierSectorAdmin sector={sector} />}

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
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="truncate font-medium text-foreground">
                    {sheetLabel(row.technical_sheets ?? {})}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ATELIER_SECTOR_LABEL[row.sector]}
                    {row.prep_business_days != null && row.prep_business_days > 5
                      ? ' · Complexo'
                      : row.prep_business_days != null && row.prep_business_days > 0
                        ? ' · Preparo curto'
                        : ' · Marcação explícita'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Preparo do cabedal (dias úteis)
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    className="h-8 w-20 text-right"
                    placeholder="vazio = 7"
                    defaultValue={row.prep_business_days ?? ''}
                    key={`${row.id}-${row.prep_business_days ?? 'vazio'}`}
                    onBlur={(event) => {
                      const raw = event.target.value.trim();
                      const next = raw === '' ? null : Math.max(0, Math.min(90, Math.round(Number(raw))));
                      if (next === (row.prep_business_days ?? null) || (raw !== '' && !Number.isFinite(Number(raw)))) return;
                      prepMut.mutate({ id: row.id, prepBusinessDays: next });
                    }}
                  />
                </label>
                {sector !== 'corte_cabedal' && (
                  <AtelierExecutionDefaultControl
                    referenceId={row.reference_id}
                    sector={row.sector}
                    mode={row.default_execution_mode ?? null}
                    contractorId={row.default_contractor_id ?? null}
                  />
                )}
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


function FilaView() {
  const [params, setParams] = useSearchParams();
  const { data: lots = [], isLoading, isError, refetch } = useAtelierLots();
  const pedido = params.get('pedido') ?? '';
  const orderJobs = useAtelierOrderJobs(pedido);
  const boardLots = useMemo(
    () => supplementAtelierLotsWithOrderJobs(lots, orderJobs.data ?? []),
    [lots, orderJobs.data],
  );
  const modo = params.get('modo') === 'pedido' ? 'pedido' : 'quadro';

  const setParam = (key: string, value: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    }, { replace: true });
  };

  return (
    <div className="space-y-3">
      <AgendaSettings />
      <AtelierOperacao
        lots={boardLots}
        isLoading={isLoading || (pedido.trim().length > 0 && orderJobs.isLoading)}
        isError={isError && orderJobs.isError && boardLots.length === 0}
        onRefresh={() => {
          void refetch();
          void orderJobs.refetch();
        }}
        pedido={pedido}
        modo={modo}
        onPedidoChange={(orderNumber) => setParam('pedido', orderNumber)}
        onModoChange={(next) => setParam('modo', next === 'quadro' ? '' : next)}
      />
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
        description="Cada costura e aviamento anda na própria etapa. O corte é do lote. A OP nasce quando o pedido vai para Em Produção, depois que os jobs voltam."
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
          <TabsTrigger value="lancamento" className="text-xs sm:text-sm">
            Lançamento
          </TabsTrigger>
          <TabsTrigger value="tiras" className="text-xs sm:text-sm">
            Tiras
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
        <TabsContent value="lancamento">
          <AtelierLancamento />
        </TabsContent>
        <TabsContent value="tiras">
          <AtelierStrapsView />
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
