import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowsLeftRight as ArrowRightLeft, Warning as AlertTriangle, CheckCircle as CheckCircle2, Info, BookOpen, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  purchase_unit: string | null;
  production_unit: string | null;
  consumption_unit: string | null;
  conversion_rate: number | null;
  dimensions_width: number | null;
  dimensions_length: number | null;
  dimensions_unit: string | null;
  yield_per_meter: number | null;
  yield_unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  product_groups: { name: string } | null;
};

// Categoriza o tipo de divergência de unidade entre compra e consumo.
type IssueLevel = 'ok' | 'soft' | 'critical';
type IssueInfo = {
  level: IssueLevel;
  label: string;
  hint?: string;
};

function classifyProduct(p: ProductRow): IssueInfo {
  const unit = (p.unit || '').toLowerCase();
  const pu = (p.purchase_unit || '').toLowerCase() || unit;
  const cu = (p.consumption_unit || p.production_unit || '').toLowerCase() || unit;

  // Se compra e consumo são iguais (ou consumo não declarado), nada a fazer
  const buyEqualsConsume = pu === cu || !cu;
  if (buyEqualsConsume) return { level: 'ok', label: 'Sem conversão necessária' };

  // Linear → área (ex: m comprado, dm²/m² consumido)
  const isLinear = /^(m|cm|mm|lin|metros?)$/.test(pu);
  const isArea = /(dm|cm|m|mm)\s*[²2]/.test(cu) || /^(dm2|cm2|m2|mm2)$/.test(cu);
  if (isLinear && isArea) {
    if (!p.dimensions_width) {
      return {
        level: 'critical',
        label: 'Falta largura',
        hint: 'Cadastre dimensions_width pra converter de metros pra dm²/m².',
      };
    }
    return { level: 'ok', label: 'Largura cadastrada' };
  }

  // Pacote → unidade (ex: placa, cento, dz, kg → un)
  const isPack = /^(placa|cento|mil|dz|d[uú]zia|cx|caixa|p[aá]r|pacote|fardo|rolo|saco)/.test(pu);
  if (isPack) {
    if (!p.conversion_rate || p.conversion_rate <= 0) {
      return {
        level: 'critical',
        label: 'Falta fator',
        hint: `Defina conversion_rate (quantos ${cu || unit} cabem em 1 ${pu}).`,
      };
    }
    return { level: 'ok', label: `1 ${pu} = ${p.conversion_rate} ${cu || unit}` };
  }

  // Massa/volume divergentes: g↔kg, ml↔L → ok automático via convert_to_product_unit
  const massPair = /^(g|kg|mg)$/.test(pu) && /^(g|kg|mg)$/.test(cu);
  const volPair = /^(ml|l)$/.test(pu) && /^(ml|l)$/.test(cu);
  if (massPair || volPair) {
    return { level: 'ok', label: 'Conversão automática' };
  }

  // Default: sinaliza divergência sem categoria conhecida
  return {
    level: 'soft',
    label: 'Divergência não classificada',
    hint: 'Verifique se purchase_unit e consumption_unit fazem sentido pro material.',
  };
}

// Solado removido em 2026-05-23 — gestão de solados vive em /solados (SolesHub).
// Aqui mostramos só matérias-primas que passam por conversão de unidade
// (dm² ↔ m, kg ↔ g, etc.). Solados têm fluxo próprio em SolesHub.
const CATEGORY_LABELS: Record<string, string> = {
  all: 'Todas categorias',
  Cabedal: 'Cabedal',
  Forro: 'Forro',
  Palmilha: 'Palmilha',
  Componente: 'Componente',
  'Químico': 'Químico',
  Embalagem: 'Embalagem',
};

const STATUS_LABELS: Record<string, string> = {
  all: 'Todos status',
  critical: 'Apenas críticos',
  soft: 'Atenção',
  ok: 'OK',
};

export function ConversionReportTab() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: products = [], isLoading } = useQuery<ProductRow[]>({
    queryKey: ['conversion_report_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, category, unit, purchase_unit, production_unit, consumption_unit, conversion_rate, dimensions_width, dimensions_length, dimensions_unit, yield_per_meter, yield_unit, quantity, unit_price, product_groups(name)')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as ProductRow[];
    },
  });

  const enriched = useMemo(() =>
    products.map(p => ({ ...p, issue: classifyProduct(p) })),
    [products]
  );

  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    return enriched.filter(p => {
      // Solado vive em /solados (SolesHub) — sempre excluído deste relatório.
      if ((p.category || '').toLowerCase() === 'solado') return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && p.issue.level !== statusFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.sku || ''} ${p.category || ''} ${p.product_groups?.name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, search, categoryFilter, statusFilter]);

  const summary = useMemo(() => {
    const total = enriched.length;
    const ok = enriched.filter(p => p.issue.level === 'ok').length;
    const soft = enriched.filter(p => p.issue.level === 'soft').length;
    const critical = enriched.filter(p => p.issue.level === 'critical').length;
    return { total, ok, soft, critical };
  }, [enriched]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          Relatório de Conversão de Unidades
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Materiais comprados em uma unidade e consumidos em outra. Sinaliza onde falta cadastro pra
          a conversão funcionar — custo correto e consumo preciso dependem disso.
        </p>
      </div>

      {/* Recomendação prática */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Como organizar materiais com unidades diferentes
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-foreground">
          <p>
            <strong>Regra geral:</strong> guarde o estoque na <em>unidade de consumo</em> (a mesma
            usada na ficha técnica). Compre em <em>unidade de compra</em>, e converta na entrada.
            Mantém o custo unitário coerente e evita rateio errado em PVs fracionários.
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <div className="rounded border bg-card p-2.5">
              <p className="font-semibold flex items-center gap-1.5">
                <span className="text-success">✓</span> Exemplo: palmilha (placa → dm²)
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>• <code>unit</code> = <strong>dm²</strong> (consumo)</li>
                <li>• <code>purchase_unit</code> = <strong>placa</strong></li>
                <li>• <code>conversion_rate</code> = <strong>144</strong> (1 placa = 144 dm²)</li>
                <li>• <code>unit_price</code> em <strong>R$/dm²</strong> (preço da placa ÷ 144)</li>
                <li>• Entrada de PO: qty placas × 144 → soma em <code>quantity</code></li>
              </ul>
            </div>
            <div className="rounded border bg-card p-2.5">
              <p className="font-semibold flex items-center gap-1.5">
                <span className="text-success">✓</span> Exemplo: tecido (m → dm²)
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>• <code>unit</code> = <strong>dm²</strong></li>
                <li>• <code>purchase_unit</code> = <strong>m</strong></li>
                <li>• <code>dimensions_width</code> = <strong>15</strong> (largura em dm)</li>
                <li>• Sistema converte: 1m × 15dm = 15 dm²/m linear</li>
                <li>• Sem largura, não tem como rastrear consumo correto.</li>
              </ul>
            </div>
          </div>
          <p className="text-muted-foreground text-xs pt-1">
            Linha vermelha na tabela abaixo = material que vai gerar custo errado ou bloquear cálculo
            de consumo até ser ajustado.
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total de materiais</p>
            <p className="display text-xl tabular-nums">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" /> OK
            </p>
            <p className="display text-xl tabular-nums text-success">{summary.ok}</p>
          </CardContent>
        </Card>
        <Card className={summary.soft > 0 ? 'border-amber-500/40' : ''}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3 text-amber-500" /> Atenção
            </p>
            <p className="display text-xl tabular-nums text-amber-600 dark:text-amber-400">{summary.soft}</p>
          </CardContent>
        </Card>
        <Card className={summary.critical > 0 ? 'border-destructive/40 bg-destructive/5' : ''}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-destructive" /> Críticos
            </p>
            <p className="display text-xl tabular-nums text-destructive">{summary.critical}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar produto, SKU, grupo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? 'item' : 'itens'}
        </span>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-32" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">Nenhum material com os filtros aplicados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[280px]">Material</TableHead>
                    <TableHead className="text-center">Estoque</TableHead>
                    <TableHead className="text-center">Compra</TableHead>
                    <TableHead className="text-center">Consumo</TableHead>
                    <TableHead className="text-center">Fator</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const issue = p.issue;
                    const consumeUnit = p.consumption_unit || p.production_unit || p.unit;
                    const factor = p.conversion_rate
                      ? `${p.conversion_rate}`
                      : p.dimensions_width
                        ? `largura ${p.dimensions_width} ${p.dimensions_unit || ''}`.trim()
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
                        <TableCell className="text-center font-mono text-xs tabular-nums">
                          {Number(p.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <Badge variant="outline" className="font-mono text-xs">
                            {p.purchase_unit || p.unit}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <Badge variant="outline" className="font-mono text-xs">
                            {consumeUnit}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs tabular-nums">
                          {factor}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge
                              variant={
                                issue.level === 'critical' ? 'destructive' :
                                issue.level === 'soft' ? 'outline' :
                                'secondary'
                              }
                              className={cn(
                                'text-xs gap-1 w-fit',
                                issue.level === 'soft' && 'border-amber-500/50 text-amber-700 dark:text-amber-400'
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
  );
}
