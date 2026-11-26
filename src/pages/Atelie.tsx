/**
 * Ateliê — cabedal complexo preparado antes da OP.
 * ?view=fila | tiras | relatorio | cadastro
 * ?pedido=PV-00250 filtra a fila. ?modo=pedido abre a linha do tempo do PV.
 * O corte é do lote. A OP nasce no promote para Em Produção, depois que os jobs voltam.
 */
import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  CircleNotch as Loader2,
  Plus,
  Scissors,
} from '@phosphor-icons/react';
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
  useReapplyAtelierEligibility,
  useRemoveAtelierReference,
  useTechnicalSheetsLiteForAtelier,
} from '@/hooks/useAtelier';
import { AtelierExecutionDefaultControl, AtelierSectorAdmin } from '@/components/atelier/AtelierAdminPanel';
import { AtelierOperacao } from '@/components/atelier/AtelierOperacao';
import { MotorPrazosResumo } from '@/components/atelier/MotorPrazosPanel';
import { useMotorConfig } from '@/hooks/useMotorConfig';
import { parseReferencePrepDays, prepSourceLabel } from '@/lib/motorConfig';
import { toast } from 'sonner';

function sheetLabel(s: {
  code?: string | null;
  model?: string | null;
  name?: string | null;
}): string {
  return [s.code, s.model || s.name].filter(Boolean).join(' · ') || 'Sem código';
}


export function CadastroView() {
  const [sector, setSector] = useState<AtelierSector>('costura_cabedal');
  const [sheetId, setSheetId] = useState<string>('');
  const [q, setQ] = useState('');
  const { data: catalog = [], isLoading, isError } = useAtelierCatalog(sector);
  const { data: sheets = [] } = useTechnicalSheetsLiteForAtelier();
  const addMut = useAddAtelierReference();
  const prepMut = useSetAtelierPrepDays();
  const removeMut = useRemoveAtelierReference();
  const reapply = useReapplyAtelierEligibility();
  const { data: motorConfig } = useMotorConfig();
  const effectivePrep = useMemo(
    () => new Map((motorConfig?.references ?? []).map((r) => [r.id, r.effective_prep_business_days])),
    [motorConfig],
  );

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
      {/* Prazos do motor moraram aqui; agora ficam em Motor de produção › Prazos. */}
      <MotorPrazosResumo />
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
                    {sector !== 'corte_cabedal' && (
                      <>
                        {' · prestador '}
                        {effectivePrep.get(row.id) ?? row.prep_business_days ?? '—'}
                        {' dias úteis ('}
                        {motorConfig ? prepSourceLabel(row, motorConfig.settings) : 'padrão'}
                        {')'}
                      </>
                    )}
                  </p>
                </div>
                {sector !== 'corte_cabedal' && (
                  <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Prazo do prestador (dias úteis)
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      className="h-8 w-20 text-right"
                      placeholder={`padrão ${motorConfig?.settings.effective_default_prep_business_days ?? 5}`}
                      defaultValue={row.prep_business_days ?? ''}
                      key={`${row.id}-${row.prep_business_days ?? 'vazio'}`}
                      onBlur={(event) => {
                        const parsed = parseReferencePrepDays(event.target.value);
                        if ('error' in parsed) {
                          toast.error(parsed.error);
                          event.target.value = row.prep_business_days == null ? '' : String(row.prep_business_days);
                          return;
                        }
                        if (parsed.value === (row.prep_business_days ?? null)) return;
                        prepMut.mutate({ id: row.id, prepBusinessDays: parsed.value });
                      }}
                    />
                    <span className="text-[11px]">envio ao prestador = pronto − este prazo · vazio = padrão</span>
                  </label>
                )}
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


export function FilaView() {
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
      <MotorPrazosResumo />
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


const ATELIE_TAB: Record<string, string> = {
  fila: 'corte',
  lancamento: 'lancar',
  relatorio: 'relatorio',
  cadastro: 'modelos',
  tiras: 'tiras',
};

/** /atelie e as views antigas abrem a aba equivalente do módulo único.
 * value="lancamento" continua reconhecido e cai em Lançar.
 * Fila operacional e Modelos complexos ficam nas abas Corte e Modelos.
 */
export default function Atelie() {
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'fila';
  const next = new URLSearchParams(params);
  next.delete('view');
  next.set('tab', ATELIE_TAB[view] ?? 'lancar');
  return <Navigate to={`/terceirizados?${next.toString()}`} replace />;
}
