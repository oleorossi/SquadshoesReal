import { useMemo, useState } from 'react';
import { useSectorWorkload, type SectorWorkloadRow } from '@/hooks/useSectorWorkload';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CaretDown, CaretRight, Calendar, Package as Boxes } from '@phosphor-icons/react';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';

interface Props {
  stageName: string;
  /** Quando false, reagrupa todas as cores num único bloco por modelo (ex.: Corte Palmilha). */
  groupByColor?: boolean;
}

export function SectorWorkloadAggregated({ stageName, groupByColor = true }: Props) {
  // ⚠ Sem `isError`, falha de consulta caía no default `[]` e a tela mostrava
  // "Nenhuma OP ativa neste setor no momento" — que na bancada se lê como
  // "acabou o serviço", não como "o servidor não respondeu".
  const { data: rows = [], isLoading, isError, error, refetch } = useSectorWorkload(stageName, { groupByColor });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      // Atrasados primeiro, depois maior volume
      const da = a.earliest_deadline || '9999-12-31';
      const db = b.earliest_deadline || '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      return b.total_pairs - a.total_pairs;
    }),
    [rows],
  );

  const totals = useMemo(() => ({
    blocks: sorted.length,
    pairs: sorted.reduce((s, r) => s + r.total_pairs, 0),
    remaining: sorted.reduce((s, r) => s + r.remaining_pairs, 0),
    ops: sorted.reduce((s, r) => s + r.ops_count, 0),
  }), [sorted]);

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground text-sm">Calculando carga agregada...</div>;
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState
            size="sm"
            title="Não foi possível carregar a carga deste setor"
            description={`A consulta falhou — isto NÃO quer dizer setor sem OP. ${
              (error as Error)?.message || ''
            }`.trim()}
            onRetry={() => void refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          Nenhuma OP ativa neste setor no momento.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Blocos consolidados</div>
            <div className="display text-2xl tabular-nums font-mono mt-1">{totals.blocks}</div>
            <div className="text-xs text-muted-foreground">
              {groupByColor ? 'por modelo + cor' : 'só por modelo'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total pares</div>
            <div className="display text-2xl tabular-nums font-mono mt-1">{totals.pairs.toLocaleString('pt-BR')}</div>
            <div className="text-xs text-muted-foreground">somados de {totals.ops} OPs individuais</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">A produzir</div>
            <div className="display text-2xl tabular-nums font-mono mt-1">{totals.remaining.toLocaleString('pt-BR')}</div>
            <div className="text-xs text-muted-foreground">restantes a processar</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">OPs cobertas</div>
            <div className="display text-2xl tabular-nums font-mono mt-1">{totals.ops}</div>
            <div className="text-xs text-muted-foreground">
              fator de consolidação: {totals.blocks > 0 ? (totals.ops / totals.blocks).toFixed(1) : '0'}x
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Blocks */}
      <div className="space-y-2">
        {sorted.map(row => {
          const key = `${row.reference_id}-${row.color ?? '__all__'}`;
          const isOpen = expanded.has(key);
          const todayIso = new Date().toISOString().slice(0, 10);
          const isLate = row.earliest_deadline && row.earliest_deadline < todayIso;

          return (
            <Card
              key={key}
              className={cn('border-l-4 transition-colors',
                isLate ? 'border-l-red-500' : row.aggregated_status === 'em_andamento' ? 'border-l-blue-500' : 'border-l-muted')}
            >
              <CardContent className="p-3">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 text-left"
                  onClick={() => toggle(key)}
                >
                  {isOpen ? <CaretDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{row.model_name}</span>
                      {row.color && <Badge variant="outline" className="text-xs">{row.color}</Badge>}
                      {!groupByColor && (
                        <Badge variant="outline" className="text-xs bg-muted">
                          todas as cores agregadas
                        </Badge>
                      )}
                      {row.shoe_category && (
                        <span className="text-xs text-muted-foreground">{row.shoe_category}</span>
                      )}
                      {isLate && (
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400">
                          atrasado
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Boxes className="h-3 w-3" />
                        <strong className="text-foreground tabular-nums">{row.total_pairs}</strong> pares
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">{row.ops_count} OPs</span>
                      {row.remaining_pairs !== row.total_pairs && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">{row.remaining_pairs} a fazer</span>
                        </>
                      )}
                      {row.earliest_deadline && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(row.earliest_deadline + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 pl-7 space-y-2 border-t border-border/40 pt-3">
                    {row.aggregated_grade && Object.keys(row.aggregated_grade).length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Grade agregada (pares por tamanho)</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(row.aggregated_grade)
                            .filter(([k]) => /^\d+/.test(k))
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([size, qty]) => (
                              <Badge key={size} variant="outline" className="text-xs font-mono">
                                {size}: {qty}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        OPs cobertas neste bloco ({row.order_numbers.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {row.order_numbers.map((num) => (
                          <Badge key={num} variant="outline" className="text-xs font-mono">{num}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
