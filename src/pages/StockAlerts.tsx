import { useMemo, useState } from 'react';
import { Warning as AlertTriangle, BellRinging as BellRing, Package, Footprints, MagnifyingGlass as Search, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLowStockAlerts } from '@/hooks/useLowStockAlerts';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Página de Alertas de Estoque
 * ----------------------------------------------------------------------------
 * Lista produtos cujo estoque caiu abaixo do `min_stock` configurado e, para
 * solados, mostra déficits por numeração comparando `stock_grade` x
 * `min_stock_grade`. O usuário configura os limites diretamente no cadastro
 * de cada produto.
 */
export default function StockAlerts() {
  const { data, isLoading, refetch, isFetching } = useLowStockAlerts();
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data?.products ?? [];
    if (!term) return list;
    return list.filter((p) =>
      [p.product_name, p.sku, p.category, p.group_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [data, search]);

  const filteredSoles = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data?.soleSizes ?? [];
    if (!term) return list;
    return list.filter((p) =>
      [p.product_name, p.sku, p.group_name, p.size]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [data, search]);

  const totalAlerts = (data?.products.length ?? 0) + (data?.soleSizes.length ?? 0);

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · Alertas"
          title="Alertas de Estoque"
          description="Produtos abaixo do estoque mínimo e solados com déficit por numeração. Configure os limites em min_stock (geral) ou min_stock_grade (por numeração) no cadastro de cada produto."
          actions={
            <>
              <Badge variant={totalAlerts > 0 ? 'destructive' : 'outline'} className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {totalAlerts} alerta{totalAlerts === 1 ? '' : 's'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  qc.invalidateQueries({ queryKey: ['low-stock-alerts'] });
                  refetch();
                }}
                disabled={isFetching}
              >
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isFetching && 'animate-spin')} />
                Atualizar
              </Button>
            </>
          }
        />

        <Panel
          eyebrow="ESTOQUE · ALERTAS"
          title="Itens em alerta"
          subtitle="Os limites são configurados por produto. O alerta dispara assim que o saldo cai abaixo do mínimo."
          actions={
            <div className="relative w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, SKU, categoria…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          }
        >
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="products">
                <TabsList>
                  <TabsTrigger value="products" className="text-xs gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    Produtos ({filteredProducts.length})
                  </TabsTrigger>
                  <TabsTrigger value="soles" className="text-xs gap-1.5">
                    <Footprints className="h-3.5 w-3.5" />
                    Solados por numeração ({filteredSoles.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="products" className="mt-3">
                  {filteredProducts.length === 0 ? (
                    <EmptyState
                      icon={BellRing}
                      title="Nenhum produto abaixo do mínimo"
                      description="Todos os produtos estão acima do estoque mínimo configurado."
                    />
                  ) : (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                            <TableHead>Produto</TableHead>
                            <TableHead>Grupo</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead className="text-right">Atual</TableHead>
                            <TableHead className="text-right">Mínimo</TableHead>
                            <TableHead className="text-right">Déficit</TableHead>
                            <TableHead>Un.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredProducts.map((p) => (
                            <TableRow key={p.product_id} className="bg-destructive/5">
                              <TableCell className="text-xs">
                                <div className="font-medium">{p.product_name}</div>
                                {p.sku && (
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    {p.sku}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {p.group_name ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {p.category ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono">
                                {p.quantity.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono">
                                {p.min_stock.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono text-destructive font-semibold">
                                {p.deficit.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-xs">{p.unit ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="soles" className="mt-3">
                  {filteredSoles.length === 0 ? (
                    <EmptyState
                      icon={Footprints}
                      title="Nenhum solado com déficit por numeração"
                      description="Todas as numerações estão acima do mínimo configurado."
                    />
                  ) : (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                            <TableHead>Solado</TableHead>
                            <TableHead>Grupo</TableHead>
                            <TableHead>Numeração</TableHead>
                            <TableHead className="text-right">Atual</TableHead>
                            <TableHead className="text-right">Mínimo</TableHead>
                            <TableHead className="text-right">Déficit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredSoles.map((p, i) => (
                            <TableRow key={`${p.product_id}-${p.size}-${i}`} className="bg-destructive/5">
                              <TableCell className="text-xs">
                                <div className="font-medium">{p.product_name}</div>
                                {p.sku && (
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    {p.sku}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {p.group_name ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px]">{p.size}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono">
                                {p.quantity}
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono">
                                {p.min_stock}
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono text-destructive font-semibold">
                                {p.deficit}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
        </Panel>
      </div>
    </AppLayout>
  );
}