import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import {
  ArrowsLeftRight as ArrowRightLeft,
  Warning as AlertTriangle,
  CheckCircle as CheckCircle2,
  Info,
  BookOpen,
  MagnifyingGlass,
  ArrowsClockwise as RefreshCw,
  Database,
  PencilSimple as Pencil,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SECTOR_OPTIONS } from '@/lib/categoryFromGroup';

// ── Types ──────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  purchase_unit: string | null;
  purchase_order_unit: string | null;
  production_unit: string | null;
  consumption_unit: string | null;
  conversion_rate: number | null;
  dimensions_width: number | null;
  dimensions_length: number | null;
  dimensions_unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  product_groups: { name: string } | null;
};

export type IssueLevel = 'ok' | 'soft' | 'critical';
export type IssueInfo = {
  level: IssueLevel;
  label: string;
  hint?: string;
};

interface ExampleRow {
  id: string;
  label: string;
  value: unknown;
}

interface CheckResult {
  key: string;
  table: string;
  field: string;
  severity: 'high' | 'medium' | 'low' | 'ok';
  description: string;
  expected: string;
  count: number;
  examples: ExampleRow[];
}

interface AuditResponse {
  generated_at: string;
  checks: CheckResult[];
}

// Query keys — invalidar juntas no Reexecutar
export const UNIT_AUDIT_QUERY_KEYS = [
  ['unit_audit_divergences'],
  ['unit_audit_invariants'],
  ['unit_audit_missing_width'],
  ['unit_audit_missing_sole_sizes'],
  ['unit_audit_conversion_products'],
] as const;

// Categorias do filtro = setores canônicos, sem Solado (vive em /solados).
const CATEGORY_OPTIONS = [
  { value: 'all', label: 'Todas categorias' },
  ...SECTOR_OPTIONS.filter((s) => s.value !== 'Solado').map((s) => ({
    value: s.value,
    label: s.label,
  })),
];

const STATUS_LABELS: Record<string, string> = {
  issues: 'Atenção + críticos',
  all: 'Todos status',
  critical: 'Apenas críticos',
  soft: 'Atenção',
  ok: 'OK',
};

/** Unidade de compra efetiva: purchase_unit → purchase_order_unit → unit. */
export function effectivePurchaseUnit(p: Pick<ProductRow, 'purchase_unit' | 'purchase_order_unit' | 'unit'>): string {
  return (p.purchase_unit || p.purchase_order_unit || p.unit || '').toLowerCase();
}

/**
 * Classifica divergência compra → estoque (`unit`).
 * Eixo canônico do projeto: estoque na unidade de consumo; compra converte na entrada.
 */
export function classifyProduct(p: ProductRow): IssueInfo {
  const stock = (p.unit || '').toLowerCase();
  const pu = effectivePurchaseUnit(p) || stock;

  if (pu === stock) {
    return { level: 'ok', label: 'Sem conversão necessária' };
  }

  const isLinear = /^(m|cm|mm|lin|metros?)$/.test(pu);
  const isArea = /(dm|cm|m|mm)\s*[²2]/.test(stock) || /^(dm2|cm2|m2|mm2|dm²|cm²|m²)$/.test(stock);
  if (isLinear && isArea) {
    if (!p.dimensions_width || p.dimensions_width <= 0) {
      return {
        level: 'critical',
        label: 'Falta largura',
        hint: 'Cadastre dimensions_width (mm) pra converter metros lineares em dm².',
      };
    }
    return {
      level: 'ok',
      label: 'Largura cadastrada',
      hint: `${p.dimensions_width} ${p.dimensions_unit || 'mm'}`,
    };
  }

  const isPack = /^(placa|cento|mil|dz|d[uú]zia|cx|caixa|p[aá]r|pacote|fardo|rolo|saco)/.test(pu);
  if (isPack) {
    if (!p.conversion_rate || p.conversion_rate <= 0) {
      return {
        level: 'critical',
        label: 'Falta fator',
        hint: `Defina conversion_rate (quantos ${stock} cabem em 1 ${pu}).`,
      };
    }
    return { level: 'ok', label: `1 ${pu} = ${p.conversion_rate} ${stock}` };
  }

  const massPair = /^(g|kg|mg)$/.test(pu) && /^(g|kg|mg)$/.test(stock);
  const volPair = /^(ml|l)$/.test(pu) && /^(ml|l)$/.test(stock);
  if (massPair || volPair) {
    return { level: 'ok', label: 'Conversão automática' };
  }

  // Compra ≠ estoque sem rate válido (=1 ou ausente) → crítico (espelha audit_unit_invariants).
  const rate = p.conversion_rate;
  if (!rate || rate <= 0 || rate === 1) {
    return {
      level: 'critical',
      label: 'Falta fator',
      hint: `purchase_unit (${pu}) ≠ unit (${stock}) exige conversion_rate ≠ 1.`,
    };
  }

  if (rate > 0 && rate !== 1) {
    return { level: 'ok', label: `1 ${pu} = ${rate} ${stock}` };
  }

  return {
    level: 'soft',
    label: 'Divergência não classificada',
    hint: 'Verifique se purchase_unit e unit fazem sentido pro material.',
  };
}

function normalizeChecks(raw: unknown): CheckResult[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as AuditResponse;
  const checks = Array.isArray(obj.checks) ? obj.checks : Array.isArray(raw) ? (raw as CheckResult[]) : [];
  return checks;
}

function latestGeneratedAt(...responses: Array<AuditResponse | null | undefined>): string | null {
  const times = responses
    .map((r) => r?.generated_at)
    .filter(Boolean)
    .map((t) => new Date(t as string).getTime())
    .filter((n) => !Number.isNaN(n));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function sevBadgeVariant(s: string) {
  if (s === 'high') return 'destructive' as const;
  if (s === 'medium') return 'default' as const;
  if (s === 'ok') return 'secondary' as const;
  return 'outline' as const;
}

export function UnitConversionAuditTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  // Default: só problemas — evita “sumir” itens atrás de Todos.
  const [statusFilter, setStatusFilter] = useState('issues');

  const divergencesQ = useQuery({
    queryKey: ['unit_audit_divergences'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('audit_unit_divergences' as never);
      if (error) throw error;
      return data as unknown as AuditResponse;
    },
    staleTime: 30_000,
  });

  const invariantsQ = useQuery({
    queryKey: ['unit_audit_invariants'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('audit_unit_invariants' as never);
      if (error) throw error;
      return data as unknown as AuditResponse;
    },
    staleTime: 30_000,
  });

  const missingWidthQ = useQuery({
    queryKey: ['unit_audit_missing_width'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_materials_missing_width' as never);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) ?? [];
    },
    staleTime: 30_000,
  });

  const missingSoleQ = useQuery({
    queryKey: ['unit_audit_missing_sole_sizes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_missing_sole_consumption_sizes' as never, {
        p_sheet_id: null,
      } as never);
      if (error) throw error;
      return (data as unknown as Array<Record<string, unknown>>) ?? [];
    },
    staleTime: 30_000,
  });

  const productsQ = useQuery({
    queryKey: ['unit_audit_conversion_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, sku, category, unit, purchase_unit, purchase_order_unit, production_unit, consumption_unit, conversion_rate, dimensions_width, dimensions_length, dimensions_unit, quantity, unit_price, product_groups!products_group_id_fkey(name)',
        )
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as ProductRow[];
    },
    staleTime: 30_000,
  });

  const rpcLoading = divergencesQ.isLoading || invariantsQ.isLoading;
  const rpcError = divergencesQ.error || invariantsQ.error;
  const productsLoading = productsQ.isLoading;
  const refreshing =
    divergencesQ.isFetching ||
    invariantsQ.isFetching ||
    missingWidthQ.isFetching ||
    missingSoleQ.isFetching ||
    productsQ.isFetching;

  const allChecks = useMemo(() => {
    const a = normalizeChecks(divergencesQ.data);
    const b = normalizeChecks(invariantsQ.data);
    // Prefixo na key de invariants pra não colidir se um dia as keys se sobrepuserem.
    return [
      ...a,
      ...b.map((c) => ({ ...c, key: c.key.startsWith('inv:') ? c.key : `inv:${c.key}` })),
    ];
  }, [divergencesQ.data, invariantsQ.data]);

  const failingChecks = useMemo(
    () => allChecks.filter((c) => c.severity !== 'ok' && c.count > 0),
    [allChecks],
  );
  const passingChecks = useMemo(
    () => allChecks.filter((c) => c.count === 0 || c.severity === 'ok'),
    [allChecks],
  );
  const affectedRecords = useMemo(
    () => failingChecks.reduce((s, c) => s + (c.count || 0), 0),
    [failingChecks],
  );

  const generatedAt = latestGeneratedAt(
    divergencesQ.data ?? undefined,
    invariantsQ.data ?? undefined,
  );

  const materialsMissingWidth = missingWidthQ.data ?? [];
  const solesMissingSizes = missingSoleQ.data ?? [];

  const nonSole = useMemo(
    () => (productsQ.data ?? []).filter((p) => (p.category || '').toLowerCase() !== 'solado'),
    [productsQ.data],
  );

  const enriched = useMemo(
    () => nonSole.map((p) => ({ ...p, issue: classifyProduct(p) })),
    [nonSole],
  );

  const summary = useMemo(() => {
    const total = enriched.length;
    const ok = enriched.filter((p) => p.issue.level === 'ok').length;
    const soft = enriched.filter((p) => p.issue.level === 'soft').length;
    const critical = enriched.filter((p) => p.issue.level === 'critical').length;
    return { total, ok, soft, critical };
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (statusFilter === 'issues') {
        if (p.issue.level === 'ok') return false;
      } else if (statusFilter !== 'all' && p.issue.level !== statusFilter) {
        return false;
      }
      return searchMatchesAllTerms(
        search,
        p.name,
        p.sku,
        p.category,
        p.product_groups?.name,
        p.unit,
        p.purchase_unit,
        p.purchase_order_unit,
      );
    });
  }, [enriched, search, categoryFilter, statusFilter]);

  const allClear =
    !rpcLoading &&
    !productsLoading &&
    failingChecks.length === 0 &&
    summary.soft === 0 &&
    summary.critical === 0 &&
    materialsMissingWidth.length === 0;

  const revalidate = async () => {
    await Promise.all(
      UNIT_AUDIT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })),
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Auditoria de unidades e conversões
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Checklist SQL + lista compra→estoque. Certeza = zero falhas nas verificações e zero
            Atenção/Críticos na lista.
          </p>
        </div>
        <Button onClick={() => void revalidate()} disabled={refreshing} size="sm" className="gap-1.5 h-9">
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Reexecutar
        </Button>
      </div>

      {rpcError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Falha na auditoria SQL</AlertTitle>
          <AlertDescription>
            {(rpcError as Error)?.message ?? 'Erro ao carregar verificações de unidade'}
          </AlertDescription>
        </Alert>
      )}

      {/* Cobertura KPIs */}
      <StatGrid>
        <StatCard
          label="Verificações SQL"
          value={rpcLoading ? '…' : allChecks.length}
          hint={
            rpcLoading
              ? 'carregando'
              : `${passingChecks.length} ok · ${failingChecks.length} com falha`
          }
        />
        <StatCard
          label="Com divergência"
          value={rpcLoading ? '…' : failingChecks.length}
          tone={failingChecks.length > 0 ? 'destructive' : 'default'}
          hint={`${affectedRecords} registros afetados`}
        />
        <StatCard label="Materiais" value={productsLoading ? '…' : summary.total} hint="ativos, sem solado" />
        <StatCard
          label="OK"
          value={productsLoading ? '…' : summary.ok}
          tone="success"
        />
        <StatCard
          label="Atenção"
          value={productsLoading ? '…' : summary.soft}
          tone={summary.soft > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Críticos"
          value={productsLoading ? '…' : summary.critical}
          tone={summary.critical > 0 ? 'destructive' : 'default'}
        />
      </StatGrid>

      {generatedAt && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Última execução: {new Date(generatedAt).toLocaleString('pt-BR')}. Regras canônicas: kg, m,
            dm², cm, par — e invariantes compra×estoque×conversion_rate.
          </AlertDescription>
        </Alert>
      )}

      {allClear && (
        <Panel flush>
          <EmptyState
            icon={CheckCircle2}
            title="Auditoria limpa"
            description="Todas as verificações SQL passaram e nenhum material está em Atenção ou Crítico."
          />
        </Panel>
      )}

      {/* Educativo */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Como organizar materiais com unidades diferentes
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-foreground">
          <p>
            <strong>Regra geral:</strong> guarde o estoque na <em>unidade de consumo</em> (
            <code>unit</code>). Compre em <em>unidade de compra</em>, e converta na entrada.
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <div className="rounded border bg-card p-2.5">
              <p className="font-semibold flex items-center gap-1.5">
                <span className="text-success">✓</span> Palmilha (placa → dm²)
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>• <code>unit</code> = <strong>dm²</strong></li>
                <li>• <code>purchase_unit</code> = <strong>placa</strong></li>
                <li>• <code>conversion_rate</code> = área da placa em dm²</li>
                <li>• <code>unit_price</code> em R$/dm²</li>
              </ul>
            </div>
            <div className="rounded border bg-card p-2.5">
              <p className="font-semibold flex items-center gap-1.5">
                <span className="text-success">✓</span> Napa / tecido (m → dm² via largura)
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>• Estoque/consumo em <strong>m</strong> (ou dm² se assim cadastrado)</li>
                <li>• <code>dimensions_width</code> = <strong>1370</strong> mm (largura da bobina)</li>
                <li>• Conversão dm²→m: dm² ÷ (largura_mm / 10)</li>
                <li>• Sem largura, consumo e custeio ficam inválidos</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Checklist SQL */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Verificações SQL ({failingChecks.length} com falha · {passingChecks.length} ok)
        </h3>

        {rpcLoading && !divergencesQ.data && !invariantsQ.data ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : failingChecks.length === 0 ? (
          <Panel flush>
            <EmptyState
              size="sm"
              icon={CheckCircle2}
              title="Nenhuma divergência SQL"
              description="audit_unit_divergences e audit_unit_invariants passaram."
            />
          </Panel>
        ) : (
          <div className="space-y-3">
            {failingChecks.map((check) => (
              <Card
                key={check.key}
                className="border-l-4"
                style={{
                  borderLeftColor:
                    check.severity === 'high' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-sm font-semibold">{check.description}</CardTitle>
                        <Badge variant={sevBadgeVariant(check.severity)} className="text-xs">
                          {check.severity === 'high' ? 'CRÍTICO' : 'ATENÇÃO'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Database className="h-3 w-3" />
                        <code className="font-mono">
                          {check.table}.{check.field}
                        </code>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {check.count} {check.count === 1 ? 'registro' : 'registros'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xs text-muted-foreground mb-2">
                    <span className="font-medium">Esperado:</span> {check.expected}
                  </div>
                  {check.examples && check.examples.length > 0 && (
                    <div className="mt-2 rounded-md border border-border bg-muted/30 overflow-hidden">
                      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
                        Exemplos ({check.examples.length})
                      </div>
                      <ul className="divide-y divide-border">
                        {check.examples.map((ex) => (
                          <li
                            key={ex.id}
                            className="px-3 py-1.5 text-xs flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              className="truncate flex-1 text-left hover:underline"
                              title={ex.label}
                              onClick={() => {
                                if (check.table === 'products' && ex.id) {
                                  navigate(`/estoque/${ex.id}`);
                                }
                              }}
                            >
                              {ex.label}
                            </button>
                            <code className="font-mono text-destructive shrink-0">
                              {String(ex.value)}
                            </code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {passingChecks.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-2">
              Verificações que passaram ({passingChecks.length})
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {passingChecks.map((c) => (
                <div
                  key={c.key}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-muted/20"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span className="truncate text-xs" title={c.description}>
                    {c.description}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Complementares */}
      <Panel eyebrow="ESTOQUE · AUDITORIA" title="Validações complementares">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Materiais lineares sem largura</span>
              <Badge
                variant={materialsMissingWidth.length > 0 ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {missingWidthQ.isLoading ? '…' : materialsMissingWidth.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Produtos em m/cm usados em fichas sem <code>dimensions_width</code>.
            </p>
            {materialsMissingWidth.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {materialsMissingWidth.slice(0, 30).map((m) => {
                  const id = String(m.product_id ?? '');
                  return (
                    <button
                      key={id || String(m.product_name)}
                      type="button"
                      className="w-full text-xs border-b border-border/40 py-1 flex justify-between gap-2 text-left hover:bg-muted/40"
                      onClick={() => id && navigate(`/estoque/${id}`)}
                    >
                      <span className="font-mono truncate">{String(m.product_name ?? id)}</span>
                      <span className="text-muted-foreground shrink-0">
                        {Number(m.used_in_sheets ?? 0)} fichas
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Solados sem consumo por tamanho</span>
              <Badge
                variant={solesMissingSizes.length > 0 ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {missingSoleQ.isLoading ? '…' : solesMissingSizes.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Completar em{' '}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => navigate('/solados')}
              >
                /solados
              </button>{' '}
              — não inventar dm² aqui.
            </p>
            {solesMissingSizes.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {solesMissingSizes.slice(0, 30).map((s, i) => (
                  <div
                    key={`${s.sheet_id}-${s.size ?? i}`}
                    className="text-xs border-b border-border/40 py-1 flex justify-between gap-2"
                  >
                    <span className="font-mono truncate">
                      {String(s.sheet_name ?? s.sheet_id ?? '—')}
                    </span>
                    <span className="text-muted-foreground">tam {String(s.size ?? '—')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Lista compra → estoque */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Materiais · compra → estoque
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="flex-1 min-w-48 max-w-sm"
            inputClassName="h-8 text-xs"
            placeholder="Buscar por material, SKU, grupo, categoria ou unidade…"
            value={search}
            onChange={setSearch}
            resultCount={filtered.length}
            totalCount={summary.total}
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} {filtered.length === 1 ? 'item' : 'itens'}
          </span>
        </div>

        <Card>
          <CardContent className="p-0">
            {productsLoading ? (
              <div className="p-4">
                <Skeleton className="h-32" />
              </div>
            ) : filtered.length === 0 ? (
              search.trim() ? (
                <EmptyState
                  size="sm"
                  icon={MagnifyingGlass}
                  title={`Nenhum resultado para "${search}"`}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                      Limpar busca
                    </Button>
                  }
                />
              ) : statusFilter === 'issues' && summary.soft === 0 && summary.critical === 0 ? (
                <EmptyState
                  size="sm"
                  icon={CheckCircle2}
                  title="Nenhum material em Atenção ou Crítico"
                  description="Troque o filtro de status para ver os OK."
                />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">Nenhum material com os filtros aplicados.</p>
                </div>
              )
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-[260px]">Material</TableHead>
                      <TableHead className="text-center">Compra</TableHead>
                      <TableHead className="text-center">Estoque</TableHead>
                      <TableHead className="text-center">Fator / largura</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[100px] text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const issue = p.issue;
                      const buy = p.purchase_unit || p.purchase_order_unit || p.unit;
                      const factor = p.conversion_rate
                        ? String(p.conversion_rate)
                        : p.dimensions_width
                          ? `largura ${p.dimensions_width} ${p.dimensions_unit || 'mm'}`.trim()
                          : '—';

                      return (
                        <TableRow
                          key={p.id}
                          className={cn(
                            issue.level === 'critical' && 'bg-destructive/5',
                            issue.level === 'soft' && 'bg-amber-500/5',
                          )}
                        >
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.category || '—'}
                                {p.product_groups?.name ? ` · ${p.product_groups.name}` : ''}
                                {p.sku ? ` · ${p.sku}` : ''}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            <Badge variant="outline" className="font-mono text-xs">
                              {buy}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            <Badge variant="outline" className="font-mono text-xs">
                              {p.unit}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs tabular-nums">
                            {factor}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <Badge
                                variant={
                                  issue.level === 'critical'
                                    ? 'destructive'
                                    : issue.level === 'soft'
                                      ? 'outline'
                                      : 'secondary'
                                }
                                className={cn(
                                  'text-xs gap-1 w-fit',
                                  issue.level === 'soft' &&
                                    'border-amber-500/50 text-amber-700 dark:text-amber-400',
                                )}
                              >
                                {issue.level === 'critical' && <AlertTriangle className="h-3 w-3" />}
                                {issue.level === 'soft' && <Info className="h-3 w-3" />}
                                {issue.level === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                                {issue.label}
                              </Badge>
                              {issue.hint && (
                                <span className="text-xs text-muted-foreground">{issue.hint}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => navigate(`/estoque/${p.id}`)}
                            >
                              <Pencil className="h-3 w-3" />
                              Corrigir
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
