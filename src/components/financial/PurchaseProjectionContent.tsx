import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, WarningCircle as AlertCircle, CheckCircle as CheckCircle2, Pause, Stack as Layers, Palette, ShoppingCart, MagnifyingGlass as Search, Funnel as Filter, ChartBar as BarChart3 } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  getPurchaseProjection, getPurchaseProjectionSummary,
  RECOMMENDATION_LABEL, RECOMMENDATION_CLASS, ABC_CLASS_BG,
  type Recommendation, type AbcClass,
} from '@/services/purchaseProjectionService';
import { normalizeForSearch } from '@/lib/searchUtils';

const PERIOD_OPTIONS = [
  { value: 30,  label: '30 dias' },
  { value: 60,  label: '60 dias' },
  { value: 90,  label: '90 dias' },
  { value: 180, label: '180 dias' },
];

function fmtBR(n: number, decimals = 0): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y.slice(2)}`;
}

export default function PurchaseProjectionContent() {
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [search, setSearch] = useState('');
  const [recFilter, setRecFilter] = useState<'all' | Recommendation>('all');
  const [abcFilter, setAbcFilter] = useState<'all' | AbcClass>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['purchase-projection', periodDays],
    queryFn: () => getPurchaseProjection(periodDays),
    staleTime: 60_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['purchase-projection-summary', periodDays],
    queryFn: () => getPurchaseProjectionSummary(periodDays),
    staleTime: 60_000,
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.product_category) set.add(r.product_category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  const filtered = useMemo(() => {
    const term = normalizeForSearch(search.trim());
    return rows.filter((r) => {
      if (recFilter !== 'all' && r.recommendation !== recFilter) return false;
      if (abcFilter !== 'all' && r.abc_class !== abcFilter) return false;
      if (categoryFilter !== 'all' && r.product_category !== categoryFilter) return false;
      if (!term) return true;
      return (
        normalizeForSearch(r.product_name).includes(term) ||
        (r.color ?? '').toLowerCase().includes(term) ||
        (r.supplier_name ?? '').toLowerCase().includes(term) ||
        (r.product_category ?? '').toLowerCase().includes(term)
      );
    });
  }, [rows, search, recFilter, abcFilter, categoryFilter]);

  return (
    <div className="space-y-4">
      {/* Header + período */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Projeção estatística de compras
          </h2>
          <p className="text-xs text-muted-foreground">
            Curva ABC, velocidade de giro e sugestões de reposição baseadas em histórico real.
            Complementa o Plano de Compras (demanda futura) com lente histórica.
          </p>
        </div>
        <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground font-bold">Produtos ativos</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {summary ? fmtBR(summary.total_active_products) : <Skeleton className="h-7 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">com compra ou consumo</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30">
          <CardContent className="p-3">
            <div className="text-[11px] uppercase text-red-600 font-bold flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Críticos
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {summary ? summary.critical_reorder_count : <Skeleton className="h-7 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">vão zerar antes do lead time</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="p-3">
            <div className="text-[11px] uppercase text-amber-600 font-bold">Repor em breve</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {summary ? summary.reorder_count : <Skeleton className="h-7 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">cobertura &lt; 1.5× lead time</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30">
          <CardContent className="p-3">
            <div className="text-[11px] uppercase text-blue-600 font-bold flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> Estoque alto
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {summary ? summary.high_stock_count : <Skeleton className="h-7 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">mais de 90 dias parados</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground font-bold">Reposição estimada</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {summary ? fmtMoney(summary.total_reorder_value) : <Skeleton className="h-7 w-20" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">valor a comprar p/ críticos+repor</div>
          </CardContent>
        </Card>
      </div>

      {/* Curva ABC + Top categorias / cores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold uppercase flex items-center gap-1.5 text-muted-foreground">
              <BarChart3 className="w-3.5 h-3.5" /> Curva ABC
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {summary ? (
              <>
                <AbcRow class_="A" count={summary.abc_a_count} total={summary.total_active_products} hint="80% do valor" />
                <AbcRow class_="B" count={summary.abc_b_count} total={summary.total_active_products} hint="próximos 15%" />
                <AbcRow class_="C" count={summary.abc_c_count} total={summary.total_active_products} hint="últimos 5%" />
              </>
            ) : (
              <Skeleton className="h-20" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold uppercase flex items-center gap-1.5 text-muted-foreground">
              <Layers className="w-3.5 h-3.5" /> Top categorias
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-1">
            {summary?.top_5_categories.length ? (
              summary.top_5_categories.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 mr-2">{c.category}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtMoney(c.value)} <span className="opacity-60">· {c.items}</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic">Sem dados de compra no período.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold uppercase flex items-center gap-1.5 text-muted-foreground">
              <Palette className="w-3.5 h-3.5" /> Top cores
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-1">
            {summary?.top_10_colors.length ? (
              summary.top_10_colors.slice(0, 6).map((c) => (
                <div key={c.color} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 mr-2">{c.color}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtBR(c.qty, 1)} <span className="opacity-60">· {c.items}</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic">Sem cores compradas no período.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto, cor, fornecedor, categoria…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={recFilter} onValueChange={(v) => setRecFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Recomendação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="CRITICO_REPOR">Crítico — repor já</SelectItem>
            <SelectItem value="REPOR">Repor em breve</SelectItem>
            <SelectItem value="OK">OK</SelectItem>
            <SelectItem value="ESTOQUE_ALTO">Estoque alto</SelectItem>
            <SelectItem value="INATIVO">Sem consumo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={abcFilter} onValueChange={(v) => setAbcFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-[120px]">
            <SelectValue placeholder="Classe ABC" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas ABC</SelectItem>
            <SelectItem value="A">Classe A</SelectItem>
            <SelectItem value="B">Classe B</SelectItem>
            <SelectItem value="C">Classe C</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50 text-[11px] uppercase">
              <TableRow>
                <TableHead className="w-12 px-3 py-2 h-auto">ABC</TableHead>
                <TableHead className="px-3 py-2 h-auto">Produto</TableHead>
                <TableHead className="px-3 py-2 h-auto">Cor</TableHead>
                <TableHead className="px-3 py-2 h-auto">Categoria</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Estoque</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Consumo/dia</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Cobertura</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Min. sugerido</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Repor</TableHead>
                <TableHead className="px-3 py-2 h-auto">Fornecedor</TableHead>
                <TableHead className="px-3 py-2 h-auto">Recomendação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Skeleton className="h-32 m-3" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-sm text-muted-foreground">
                    {rows.length === 0
                      ? `Nenhuma compra ou consumo registrado nos últimos ${periodDays} dias.`
                      : 'Nenhum produto corresponde aos filtros.'}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.map((r) => (
                <ProjectionRow key={`${r.product_id}|${r.color}`} row={r} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {fmtBR(filtered.length)} de {fmtBR(rows.length)} produtos · período: últimos {periodDays} dias
        </p>
      )}
    </div>
  );
}

function AbcRow({ class_, count, total, hint }: { class_: AbcClass; count: number; total: number; hint: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <Badge className={cn('font-bold w-6 h-6 flex items-center justify-center p-0', ABC_CLASS_BG[class_])}>
        {class_}
      </Badge>
      <div className="flex-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">{count} produtos</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

function ProjectionRow({ row }: { row: ReturnType<typeof Object> & any }) {
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell className="px-3 py-2">
        <Badge className={cn('font-bold w-6 h-6 flex items-center justify-center p-0 text-[11px]', ABC_CLASS_BG[row.abc_class as AbcClass])}>
          {row.abc_class}
        </Badge>
      </TableCell>
      <TableCell className="px-3 py-2 max-w-[220px]">
        <div className="font-medium text-xs truncate">{row.product_name}</div>
        {row.is_artisanal && (
          <Badge variant="outline" className="text-[9px] mt-0.5 bg-amber-500/10 text-amber-700 border-amber-500/30">Artesanal</Badge>
        )}
      </TableCell>
      <TableCell className="px-3 py-2 text-xs">
        {row.color ? <Badge variant="outline" className="text-[11px]">{row.color}</Badge> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[140px]">
        {row.product_category ?? '—'}
      </TableCell>
      <TableCell className="px-3 py-2 text-right text-xs tabular-nums">
        {fmtBR(row.available_stock, 1)} {row.unit}
      </TableCell>
      <TableCell className="px-3 py-2 text-right text-xs tabular-nums">
        {fmtBR(row.avg_daily_consumption, 2)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right text-xs tabular-nums">
        {row.days_of_cover != null ? (
          <span className={cn(
            row.days_of_cover < row.supplier_lead_time_days ? 'text-red-600 font-bold' :
            row.days_of_cover > 90 ? 'text-blue-600' : ''
          )}>
            {fmtBR(row.days_of_cover, 0)}d
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-2 text-right text-xs tabular-nums">
        {fmtBR(row.suggested_min_stock)} {row.unit}
      </TableCell>
      <TableCell className="px-3 py-2 text-right text-xs tabular-nums font-bold">
        {row.suggested_reorder_qty > 0 ? (
          <span className="text-primary">+{fmtBR(row.suggested_reorder_qty)} {row.unit}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[120px]">
        {row.supplier_name ?? '—'}
      </TableCell>
      <TableCell className="px-3 py-2">
        <Badge variant="outline" className={cn('text-[11px] gap-1', RECOMMENDATION_CLASS[row.recommendation as Recommendation])}>
          {row.recommendation === 'CRITICO_REPOR' && <AlertCircle className="w-3 h-3" />}
          {row.recommendation === 'REPOR'         && <ShoppingCart className="w-3 h-3" />}
          {row.recommendation === 'OK'            && <CheckCircle2 className="w-3 h-3" />}
          {row.recommendation === 'ESTOQUE_ALTO'  && <TrendingDown className="w-3 h-3" />}
          {row.recommendation === 'INATIVO'       && <Pause className="w-3 h-3" />}
          {RECOMMENDATION_LABEL[row.recommendation as Recommendation]}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
