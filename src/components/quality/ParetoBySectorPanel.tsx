import { useMemo } from 'react';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ChartBar } from '@phosphor-icons/react';
import { useQualityParetoBySector } from '@/hooks/useQualityDefectCatalog';

const SEVERITY_TONE: Record<string, string> = {
  minor:    'border-amber-400/60 text-amber-700',
  major:    'bg-orange-500/15 text-orange-700 border-orange-400/40',
  critical: 'bg-red-500/15 text-red-700 border-red-500/40',
};

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ParetoBySectorPanel() {
  const { data: rows = [], isLoading } = useQualityParetoBySector();

  const bySector = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.sector || '— sem setor —';
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  if (isLoading) {
    return (
      <Panel flush>
        <div className="p-8 text-center text-muted-foreground text-sm">Carregando análise Pareto...</div>
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel flush>
        <EmptyState
          icon={ChartBar}
          title="Sem dados de qualidade nos últimos 90 dias"
          description="Quando ocorrências forem registradas, esta análise vai mostrar os 80/20 por setor — quais defeitos respondem pela maior parte do prejuízo, e onde focar correções."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        eyebrow="QUALIDADE · ANÁLISE PARETO"
        title="Defeitos por setor — últimos 90 dias"
        subtitle="Linha vermelha = onde o acumulado chega a 80% dos pares afetados (regra 80/20). Esses são os defeitos a atacar primeiro."
      />

      {bySector.map(([sector, items]) => {
        const pareto80Index = items.findIndex(i => i.cumulative_pct >= 80);
        const totalCost = items.reduce((s, i) => s + Number(i.total_cost_impact || 0), 0);
        const totalOpen = items.reduce((s, i) => s + i.open_count, 0);
        const totalPairs = items[0]?.sector_total_pairs ?? 0;

        return (
          <Panel
            key={sector}
            eyebrow={`SETOR · ${sector.toUpperCase()}`}
            title={`${totalPairs} pares afetados · ${formatBRL(totalCost)} de impacto`}
            subtitle={totalOpen > 0 ? `${totalOpen} ocorrência(s) ainda em aberto` : 'Todas resolvidas'}
            flush
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Defeito</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Severidade</TableHead>
                  <TableHead className="text-right">Ocorrências</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead className="text-right">% acum.</TableHead>
                  <TableHead className="text-right">Impacto R$</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r, idx) => {
                  const isPareto80 = pareto80Index >= 0 && idx <= pareto80Index;
                  return (
                    <TableRow key={`${r.defect_code}-${idx}`} className={isPareto80 ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-medium text-sm">
                        <div>{r.defect_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.defect_code}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.category}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${SEVERITY_TONE[r.severity] || ''}`}>
                          {r.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.occurrences}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{r.total_pairs_affected}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={isPareto80 ? 'text-red-700 font-bold' : ''}>{r.cumulative_pct}%</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatBRL(Number(r.total_cost_impact || 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.open_count > 0 ? (
                          <span className="text-amber-700 font-semibold">{r.open_count}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Panel>
        );
      })}
    </div>
  );
}

export default ParetoBySectorPanel;
