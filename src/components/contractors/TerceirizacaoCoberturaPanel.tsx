import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MagnifyingGlass as Search, Handshake, CaretRight, Warning, CheckCircle, CircleNotch as Loader2,
  CurrencyDollar, Users,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { ReferenceTerceirizacoesPanel } from '@/components/technical-sheets/ReferenceTerceirizacoesPanel';
import { ContractorSectionHeader } from '@/components/contractors/ContractorSectionHeader';
import { ContractorSummaryRail } from '@/components/contractors/ContractorSummaryRail';
import {
  REFERENCE_OUTSOURCE_SECTORS,
  hasValidServiceOrderMaterialComponents,
  isValidOutsourceCapacity,
  isValidOutsourceRate,
  isServiceOrderReturnAllowed,
  serviceOrderReturnSectorsFromSettings,
  type ServiceOrderOption,
} from '@/lib/serviceOrderSectors';
import { useSectorSettings } from '@/hooks/useProductionEngine';

/**
 * Cobertura de Terceirização por Referência.
 *
 * O cadastro em si (atividade · prestador · capacidade · materiais · R$/par) mora na aba "Terceirizados"
 * de cada ficha técnica (ReferenceTerceirizacoesPanel). O problema é escala: pra
 * configurar dezenas de fichas o usuário abriria uma por uma. Este painel junta
 * TODAS as fichas num lugar só, marca quais têm configuração operacional completa
 * (verde) e quais ainda não permitem calcular prazo/material (âmbar),
 * e expande inline o MESMO painel da ficha pro cadastro rápido — sem
 * duplicar lógica. Sem essa config, `get_pv_terceirizacao_lines` fica mudo e o
 * caminho automático do pedido não gera OS.
 */

type SheetRow = { id: string; code: string | null; name: string | null };
type TercRow = {
  id: string;
  reference_id: string;
  description: string;
  value_per_pair: number;
  active: boolean;
  sector: string | null;
  capacity_pairs_per_day: number | null;
  return_before_sector: string | null;
  material_components: string[] | null;
  contractors?: { name: string; trade_name: string | null; active: boolean } | null;
};

const isPlanningReady = (
  entry: TercRow,
  returnSectors: ReadonlyArray<ServiceOrderOption>,
) => entry.active
  && entry.contractors?.active === true
  && REFERENCE_OUTSOURCE_SECTORS.some((option) => option.value === entry.sector)
  && isValidOutsourceCapacity(entry.capacity_pairs_per_day)
  && isValidOutsourceRate(entry.value_per_pair)
  && isServiceOrderReturnAllowed(entry.sector, entry.return_before_sector, returnSectors)
  && hasValidServiceOrderMaterialComponents(entry.material_components);

export function TerceirizacaoCoberturaPanel() {
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const {
    data: sectorSettings = [],
    isLoading: loadingSettings,
    isError: settingsFailed,
    refetch: refetchSettings,
  } = useSectorSettings();
  const liveReturnSectors = useMemo(
    () => serviceOrderReturnSectorsFromSettings(sectorSettings),
    [sectorSettings],
  );

  const {
    data: sheets = [],
    isLoading: loadingSheets,
    isError: sheetsFailed,
    refetch: refetchSheets,
  } = useQuery({
    queryKey: ['technical_sheets_cobertura'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, code, name')
        .order('code', { ascending: true });
      if (error) throw error;
      return (data || []) as SheetRow[];
    },
  });

  // Chave começando em 'reference_terceirizacoes' → as mutações do painel da ficha
  // (invalidate(['reference_terceirizacoes'])) refazem esta query por match de prefixo,
  // mantendo os contadores em dia após cadastro inline.
  const {
    data: tercs = [],
    isLoading: loadingTercs,
    isError: tercsFailed,
    refetch: refetchTercs,
  } = useQuery({
    queryKey: ['reference_terceirizacoes', 'all-overview'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select('id, reference_id, description, value_per_pair, active, sector, capacity_pairs_per_day, return_before_sector, material_components, contractors(name, trade_name, active)');
      if (error) throw error;
      return (data || []) as TercRow[];
    },
  });

  const byRef = useMemo(() => {
    const m = new Map<string, TercRow[]>();
    for (const t of tercs) {
      const arr = m.get(t.reference_id) || [];
      arr.push(t);
      m.set(t.reference_id, arr);
    }
    return m;
  }, [tercs]);

  const configuredCount = useMemo(
    () => sheets.filter(s => (
      byRef.get(s.id) || []
    ).some((entry) => isPlanningReady(entry, liveReturnSectors))).length,
    [sheets, byRef, liveReturnSectors],
  );

  const rows = useMemo(() => {
    return sheets
      .map(s => ({ sheet: s, entries: byRef.get(s.id) || [] }))
      .filter(r => {
        if (onlyGaps && r.entries.some((entry) => isPlanningReady(entry, liveReturnSectors))) return false;
        return searchMatchesAllTerms(
          search,
          r.sheet.code, r.sheet.name,
          ...r.entries.map(e => e.contractors?.trade_name || e.contractors?.name),
        );
      });
  }, [sheets, byRef, search, onlyGaps, liveReturnSectors]);

  const loading = loadingSettings || loadingSheets || loadingTercs;
  const dataFailed = settingsFailed || sheetsFailed || tercsFailed
    || (!loadingSettings && sectorSettings.length === 0);
  const gapCount = sheets.length - configuredCount;
  const activeServices = tercs.filter((entry) => isPlanningReady(entry, liveReturnSectors)).length;
  const incompleteServices = tercs.filter((entry) => (
    entry.active && !isPlanningReady(entry, liveReturnSectors)
  )).length;
  const configuredProviders = new Set(
    tercs.map(t => t.contractors?.trade_name || t.contractors?.name).filter(Boolean),
  ).size;
  const coverageRatio = sheets.length > 0 ? (configuredCount / sheets.length) * 100 : 0;

  return (
    <div className="space-y-4">
      <ContractorSectionHeader
        eyebrow="CADASTRO · TARIFA POR REFERÊNCIA"
        title="Cobertura da terceirização"
        description="Defina atividade, prestador, capacidade, retorno, materiais e R$/par para gerar cada OS com planejamento automático."
      />

      {dataFailed ? (
        <Panel flush>
          <EmptyState
            size="sm"
            icon={Warning}
            title="Não foi possível conferir a cobertura"
            description="O fluxo vivo de produção e as configurações precisam carregar antes de classificar uma ficha como pronta ou pendente."
            action={(
              <Button
                variant="outline"
                size="sm"
                onClick={() => void Promise.all([refetchSettings(), refetchSheets(), refetchTercs()])}
              >
                Tentar novamente
              </Button>
            )}
          />
        </Panel>
      ) : (
        <>

      <ContractorSummaryRail
        ariaLabel="Resumo da cobertura de tarifas"
        lead={{
          label: 'Cobertura pronta',
          value: `${configuredCount}/${sheets.length}`,
          hint: 'referências configuradas',
          meta: `${Math.round(coverageRatio)}% do catálogo`,
          icon: Handshake,
          progress: coverageRatio,
        }}
        metrics={[
          { label: 'Pendências', value: gapCount, hint: 'referências sem configuração', icon: Warning, tone: gapCount > 0 ? 'warning' : 'success' },
          { label: 'Serviços prontos', value: activeServices, hint: incompleteServices > 0 ? `${incompleteServices} ativos ainda incompletos` : 'capacidade e materiais válidos', icon: CheckCircle, tone: incompleteServices > 0 ? 'warning' : 'success' },
          { label: 'Prestadores', value: configuredProviders, hint: 'presentes nas referências', icon: Users },
          { label: 'Regra de preço', value: 'R$/par', hint: 'valor aplicado ao pedido', icon: CurrencyDollar },
        ]}
      />

      <section aria-label="Filtros de cobertura" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
        <SearchInput
          className="min-w-[200px] max-w-md flex-1"
          inputClassName="h-9"
          value={search}
          onChange={setSearch}
          placeholder="Buscar por código, nome da ficha ou contratada…"
          resultCount={rows.length}
          totalCount={sheets.length}
        />
        <Button
          variant={onlyGaps ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setOnlyGaps(v => !v)}
        >
          <Warning className="h-3.5 w-3.5" /> Só sem configuração ({gapCount})
        </Button>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <Panel flush>
          <EmptyState
            size="sm"
            icon={search ? Search : Handshake}
            title={search ? `Nenhum resultado para "${search}"` : 'Nada aqui'}
            description={onlyGaps ? 'Todas as fichas do filtro já têm terceirização configurada.' : search ? 'Ajuste os termos da busca.' : 'Nenhuma ficha encontrada.'}
            action={search ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button> : undefined}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {rows.map(({ sheet, entries }) => {
            const isOpen = expanded === sheet.id;
            const readyEntries = entries.filter((entry) => isPlanningReady(entry, liveReturnSectors));
            const contractorNames = Array.from(new Set(
              entries.map(e => e.contractors?.trade_name || e.contractors?.name).filter(Boolean),
            ));
            return (
              <div
                key={sheet.id}
                className={cn('rounded-lg border bg-card transition-colors', isOpen ? 'border-primary/40' : 'border-border/60 hover:border-border')}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : sheet.id)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                  aria-expanded={isOpen}
                >
                  <CaretRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{sheet.name || sheet.code || '—'}</span>
                      {sheet.code && sheet.code !== sheet.name && <span className="font-mono text-xs text-muted-foreground">Cód. interno: {sheet.code}</span>}
                    </div>
                    {entries.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{contractorNames.join(' · ')}</p>
                    )}
                  </div>
                  {readyEntries.length > 0 ? (
                    <Badge variant="outline" className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                      <CheckCircle className="h-3 w-3" /> {readyEntries.length} {readyEntries.length === 1 ? 'serviço pronto' : 'serviços prontos'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
                      <Warning className="h-3 w-3" /> {entries.length > 0 ? 'config incompleta' : 'sem config'}
                    </Badge>
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 p-3">
                    <ReferenceTerceirizacoesPanel sheetId={sheet.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
