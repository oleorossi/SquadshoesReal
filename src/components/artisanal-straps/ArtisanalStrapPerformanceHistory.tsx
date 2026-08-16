import { ChartLine, LockKey, Scissors, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapRealYieldHistoryRow,
  useArtisanalStrapCostVariance,
  useArtisanalStrapRealYieldHistory,
} from '@/hooks/useArtisanalStraps';
import { StrapIdentityTrail } from './StrapIdentityTrail';
import { StrapStatusBadge } from './StrapStatusBadge';

interface Props {
  catalog: ArtisanalStrapCatalog;
  yieldQuery: ReturnType<typeof useArtisanalStrapRealYieldHistory>;
  costQuery: ReturnType<typeof useArtisanalStrapCostVariance>;
  onSuggestYield: (row: ArtisanalStrapRealYieldHistoryRow) => void;
}

function numberLabel(value: unknown, maximumFractionDigits = 3) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { maximumFractionDigits })
    : '—';
}

function metersLabel(value: unknown) {
  return `${numberLabel(value, 2)} m`;
}

function currencyLabel(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

function identity(catalog: ArtisanalStrapCatalog, variantId: string) {
  const variant = catalog.variants.find((item) => item.id === variantId);
  const measure = catalog.measures.find((item) => item.id === variant?.measure_id);
  const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
  const base = catalog.groups.find((item) => item.id === variant?.base_group_id);
  const color = catalog.colors.find((item) => item.id === variant?.color_id);
  return { variant, measure, type, base, color };
}

export function ArtisanalStrapPerformanceHistory({
  catalog,
  yieldQuery,
  costQuery,
  onSuggestYield,
}: Props) {
  const yields = yieldQuery.data || [];
  const costs = costQuery.data || [];
  const canSeeFinancial = catalog.capabilities.can_see_financial_values === true;

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="RENDIMENTO REAL"
        title="Confirmado × realizado"
        subtitle="Os apontamentos físicos são comparados à versão usada no lote. A sugestão nunca altera uma receita aprovada."
        actions={<Badge variant="outline">{yields.length} comparação(ões)</Badge>}
      >
        {yieldQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando rendimentos realizados…</p>
        ) : yieldQuery.isError ? (
          <Alert variant="destructive">
            <Warning className="h-4 w-4" />
            <AlertTitle>Histórico de rendimento indisponível</AlertTitle>
            <AlertDescription>Atualize os dados de rendimento antes de sugerir outra versão.</AlertDescription>
          </Alert>
        ) : yields.length === 0 ? (
          <EmptyState
            icon={ChartLine}
            title="Ainda não há rendimento realizado"
            description="O primeiro recebimento com tira aprovada e napa consumida abrirá a comparação."
            size="sm"
          />
        ) : (
          <div className="space-y-3">
            {yields.map((row) => {
              const rowIdentity = identity(catalog, row.strap_variant_id);
              const canSuggest = catalog.capabilities.manage_strap_catalog
                && rowIdentity.variant
                && catalog.recipes.some((recipe) => recipe.id === row.recipe_id)
                && Number(row.actual_yield_m_per_m) > 0;
              return (
                <article
                  key={`${row.strap_variant_id}-${row.recipe_id}-${row.base_product_id}-${row.executor_type}-${row.contractor_id || 'factory'}`}
                  className="space-y-3 rounded-md border border-border p-3"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <StrapIdentityTrail
                        typeName={rowIdentity.type?.name}
                        measureName={rowIdentity.measure?.display_name}
                        baseName={rowIdentity.base?.name || row.base_product_name}
                        colorName={rowIdentity.color?.name}
                        compact
                      />
                      <p className="text-xs text-muted-foreground">
                        Receita v{row.recipe_version_snapshot} · {row.executor_type === 'factory' ? 'Fábrica' : 'Terceirizado'} · {row.receipt_count} parcial(is) · {dateLabel(row.first_receipt_at)} a {dateLabel(row.last_receipt_at)}
                      </p>
                    </div>
                    {canSuggest && (
                      <Button size="sm" variant="outline" className="shrink-0 gap-2" onClick={() => onSuggestYield(row)}>
                        <Scissors className="h-4 w-4" /> Criar versão sugerida
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Confirmado</p><p className="font-mono text-sm font-bold">{numberLabel(row.confirmed_yield_snapshot)} m/m</p></div>
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Realizado</p><p className="font-mono text-sm font-bold">{row.actual_yield_m_per_m == null ? '—' : `${numberLabel(row.actual_yield_m_per_m)} m/m`}</p></div>
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Desvio</p><p className="font-mono text-sm font-bold">{row.yield_deviation_pct == null ? '—' : `${Number(row.yield_deviation_pct) > 0 ? '+' : ''}${numberLabel(row.yield_deviation_pct, 2)}%`}</p></div>
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Tira aprovada</p><p className="font-mono text-sm font-bold">{metersLabel(row.approved_m)}</p></div>
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Napa consumida</p><p className="font-mono text-sm font-bold">{metersLabel(row.base_consumed_m)}</p></div>
                    <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Rejeitada</p><p className="font-mono text-sm font-bold">{metersLabel(row.rejected_m)}</p></div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="CUSTO POR ORIGEM"
        title="Variação prevista × realizada"
        subtitle="Compare o previsto e o realizado por pedido de venda, variante e origem."
        actions={canSeeFinancial
          ? <Badge variant="outline">{costs.length} linha(s)</Badge>
          : <Badge variant="secondary" className="gap-1"><LockKey className="h-3 w-3" /> Valores protegidos</Badge>}
      >
        {costQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando variações por PV…</p>
        ) : costQuery.isError ? (
          <Alert variant="destructive">
            <Warning className="h-4 w-4" />
            <AlertTitle>Relatório de variação indisponível</AlertTitle>
            <AlertDescription>Atualize os dados para tentar carregar o relatório novamente.</AlertDescription>
          </Alert>
        ) : costs.length === 0 ? (
          <EmptyState icon={ChartLine} title="Nenhuma variação realizada" description="O relatório abre depois das movimentações físicas vinculadas ao PV." size="sm" />
        ) : (
          <div className="space-y-3">
            {costs.map((row) => {
              const rowIdentity = identity(catalog, row.strap_variant_id);
              return (
                <article key={row.sale_order_strap_demand_id} className="space-y-3 rounded-md border border-border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold">PV {row.order_number}</p>
                        <Badge variant="outline">{row.source_mode === 'internal' ? 'Produção interna' : 'Compra pronta'}</Badge>
                        <StrapStatusBadge status={row.status} />
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {[rowIdentity.type?.name, rowIdentity.measure?.display_name, rowIdentity.base?.name, rowIdentity.color?.name].filter(Boolean).join(' · ') || row.strap_variant_id}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{metersLabel(row.planned_m)} previstos · {metersLabel(row.realized_m)} realizados</p>
                  </div>

                  {canSeeFinancial ? (
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                      <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Unitário previsto</p><p className="font-mono text-sm font-bold">{currencyLabel(row.planned_unit_cost)}</p></div>
                      <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Unitário realizado</p><p className="font-mono text-sm font-bold">{currencyLabel(row.realized_unit_cost)}</p></div>
                      <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Total previsto</p><p className="font-mono text-sm font-bold">{currencyLabel(row.planned_cost)}</p></div>
                      <div className="rounded-md bg-muted/30 p-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Total realizado</p><p className="font-mono text-sm font-bold">{currencyLabel(row.realized_cost)}</p></div>
                      <div className="col-span-2 rounded-md bg-muted/30 p-2 lg:col-span-1"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Variação</p><p className="font-mono text-sm font-bold">{row.cost_variance == null ? '—' : `${Number(row.cost_variance) > 0 ? '+' : ''}${currencyLabel(row.cost_variance)}`}</p></div>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground"><LockKey className="h-4 w-4" /> Quantidades e motivo permanecem visíveis; custos foram mascarados no servidor.</p>
                  )}
                  <p className="text-xs text-muted-foreground"><strong className="text-foreground">Motivo:</strong> {row.variance_reason}</p>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
