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

/**
 * Cobertura de Terceirização por Referência.
 *
 * O cadastro em si (contratada · descrição · R$/par) já mora na aba "Terceirizados"
 * de cada ficha técnica (ReferenceTerceirizacoesPanel). O problema é escala: pra
 * configurar dezenas de fichas o usuário abriria uma por uma. Este painel junta
 * TODAS as fichas num lugar só, marca quais já têm config (verde) e quais faltam
 * (âmbar), e expande inline o MESMO painel da ficha pro cadastro rápido — sem
 * duplicar lógica. Sem essa config, `get_pv_terceirizacao_lines` fica mudo e o
 * caminho automático do pedido não gera OS.
 */

type SheetRow = { id: string; code: string | null; name: string | null };
type TercRow = {
  id: string; reference_id: string; description: string; value_per_pair: number; active: boolean;
  contractors?: { name: string; trade_name: string | null } | null;
};

export function TerceirizacaoCoberturaPanel() {
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: sheets = [], isLoading: loadingSheets } = useQuery({
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
  const { data: tercs = [], isLoading: loadingTercs } = useQuery({
    queryKey: ['reference_terceirizacoes', 'all-overview'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select('id, reference_id, description, value_per_pair, active, contractors(name, trade_name)');
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
    () => sheets.filter(s => (byRef.get(s.id)?.length || 0) > 0).length,
    [sheets, byRef],
  );

  const rows = useMemo(() => {
    return sheets
      .map(s => ({ sheet: s, entries: byRef.get(s.id) || [] }))
      .filter(r => {
        if (onlyGaps && r.entries.length > 0) return false;
        return searchMatchesAllTerms(
          search,
          r.sheet.code, r.sheet.name,
          ...r.entries.map(e => e.contractors?.trade_name || e.contractors?.name),
        );
      });
  }, [sheets, byRef, search, onlyGaps]);

  const loading = loadingSheets || loadingTercs;
  const gapCount = sheets.length - configuredCount;
  const activeServices = tercs.filter(t => t.active).length;
  const configuredProviders = new Set(
    tercs.map(t => t.contractors?.trade_name || t.contractors?.name).filter(Boolean),
  ).size;
  const coverageRatio = sheets.length > 0 ? (configuredCount / sheets.length) * 100 : 0;

  return (
    <div className="space-y-4">
      <ContractorSectionHeader
        eyebrow="CADASTRO · TARIFA POR REFERÊNCIA"
        title="Cobertura da terceirização"
        description="Defina quem executa cada serviço e o R$/par usado pelo pedido para gerar a OS sem digitação repetida."
      />

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
          { label: 'Serviços ativos', value: activeServices, hint: 'linhas válidas para gerar OS', icon: CheckCircle, tone: 'success' },
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
                  {entries.length > 0 ? (
                    <Badge variant="outline" className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                      <CheckCircle className="h-3 w-3" /> {entries.length} {entries.length === 1 ? 'serviço' : 'serviços'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
                      <Warning className="h-3 w-3" /> sem config
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
    </div>
  );
}
