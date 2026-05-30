import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { MagnifyingGlass as Search, ChartLine, TrendUp, TrendDown, Minus, Warning } from '@phosphor-icons/react';
import { useDemandForecast } from '@/hooks/useDemandForecast';
import { normalizeForSearch } from '@/lib/searchUtils';

const CONFIDENCE_TONE: Record<string, string> = {
  high:   'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  medium: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
  low:    'bg-red-500/15 text-red-700 border-red-500/40',
  none:   'bg-muted text-muted-foreground border-border',
};
const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'alta', medium: 'média', low: 'baixa', none: '—',
};

export default function DemandForecastPage() {
  const { data: forecast = [], isLoading } = useDemandForecast();
  const [search, setSearch] = useState('');
  const [confFilter, setConfFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    return forecast.filter(r => {
      if (confFilter !== 'all' && r.confidence !== confFilter) return false;
      if (search.trim()) {
        const q = normalizeForSearch(search.trim());
        return normalizeForSearch(r.reference_name).includes(q)
          || normalizeForSearch(r.color).includes(q);
      }
      return true;
    });
  }, [forecast, search, confFilter]);

  const totals = useMemo(() => {
    return {
      total: forecast.length,
      high: forecast.filter(r => r.confidence === 'high').length,
      medium: forecast.filter(r => r.confidence === 'medium').length,
      projectedPairs: forecast.reduce((s, r) => s + r.projected_next_month, 0),
      growth: forecast.filter(r => r.momentum_factor > 1.05).length,
      decline: forecast.filter(r => r.momentum_factor < 0.95).length,
    };
  }, [forecast]);

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · PROJEÇÃO DE DEMANDA"
          title="Forecast de demanda"
          description="Projeção mensal por modelo×cor: média móvel de 3 meses × momentum (último mês / penúltimo, clipado entre 0.5 e 2.0). Confiança baseada em quantos meses do histórico têm venda."
        />

        <StatGrid>
          <StatCard icon={ChartLine} label="Modelos × cor" value={totals.total} hint="com venda nos últimos 3m" />
          <StatCard icon={ChartLine} label="Confiança alta" value={totals.high} hint={`+ ${totals.medium} média`} tone={totals.high > 0 ? 'success' : 'default'} />
          <StatCard icon={TrendUp} label="Em crescimento" value={totals.growth} hint="momentum > 1.05" tone="success" />
          <StatCard icon={ChartLine} label="Projeção próximo mês" value={totals.projectedPairs.toLocaleString('pt-BR')} hint="pares totais projetados" />
        </StatGrid>

        {forecast.length > 0 && totals.high === 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 flex items-start gap-3 text-sm">
            <Warning className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-300">Histórico curto — confiança limitada</p>
              <p className="text-xs text-amber-800 dark:text-amber-400 mt-1">
                Nenhum modelo×cor tem 3 meses de venda contínua. Confiança "alta" só aparece quando há venda em ≥3 dos últimos 3 meses. Use o forecast como direção, não como número fechado.
              </p>
            </div>
          </div>
        )}

        <Panel flush>
          <div className="flex flex-col sm:flex-row gap-3 p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por modelo ou cor..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={confFilter} onValueChange={setConfFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas confianças</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Calculando forecast...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ChartLine}
              title={forecast.length === 0 ? 'Sem histórico suficiente' : 'Nenhum modelo×cor encontrado'}
              description={forecast.length === 0 ? 'Não há vendas registradas nos últimos 3 meses. Forecast precisa de histórico mínimo.' : 'Ajuste os filtros.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Modelo</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead className="text-right">Média 3m</TableHead>
                  <TableHead className="text-right">Penúltimo</TableHead>
                  <TableHead className="text-right">Último mês</TableHead>
                  <TableHead className="text-center">Momentum</TableHead>
                  <TableHead className="text-right">Projeção 30d</TableHead>
                  <TableHead className="text-center">Confiança</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, idx) => {
                  const momentumIcon = row.momentum_factor > 1.05
                    ? <TrendUp className="h-3.5 w-3.5 text-emerald-600 inline" />
                    : row.momentum_factor < 0.95
                      ? <TrendDown className="h-3.5 w-3.5 text-red-600 inline" />
                      : <Minus className="h-3.5 w-3.5 text-muted-foreground inline" />;
                  return (
                    <TableRow key={`${row.reference_id}-${row.color}-${idx}`}>
                      <TableCell className="text-sm font-medium">{row.reference_name}</TableCell>
                      <TableCell className="text-sm">{row.color}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.avg_last_3_months}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.prev_month_sales}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.last_month_sales}</TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center gap-1 tabular-nums text-xs">
                          {momentumIcon}
                          ×{row.momentum_factor.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{row.projected_next_month}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-xs ${CONFIDENCE_TONE[row.confidence]}`}>
                          {CONFIDENCE_LABEL[row.confidence]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </AppLayout>
  );
}
