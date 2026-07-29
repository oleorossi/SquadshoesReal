import { useMemo, useState } from 'react';
import { ArrowsClockwise as RefreshCw, Footprints, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLowStockAlerts } from '@/hooks/useLowStockAlerts';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

/**
 * Déficits de grade vivem junto dos alertas do estoque porque usam a mesma
 * origem de dados dos mínimos gerais; separar a rota escondia esse sinal dos
 * solados enquanto o usuário já estava revisando os materiais.
 */
export function SoleSizeStockAlertsPanel() {
  const { data, isLoading, isFetching, refetch } = useLowStockAlerts();
  const [search, setSearch] = useState('');

  const filteredSoles = useMemo(() => {
    const list = data?.soleSizes ?? [];
    if (!search.trim()) return list;
    return list.filter((sole) =>
      searchMatchesAllTerms(search, sole.product_name, sole.sku, sole.group_name, sole.size),
    );
  }, [data, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Footprints className="h-4 w-4 text-primary" />
            Solados por numeração
            <Badge variant="destructive" className="text-xs">{filteredSoles.length}</Badge>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Déficits entre o saldo por grade e o mínimo configurado em cada numeração.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar por solado, SKU, grupo ou numeração…"
        resultCount={filteredSoles.length}
        totalCount={data?.soleSizes.length ?? 0}
        inputClassName="h-8 text-xs"
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : filteredSoles.length === 0 ? (
        search.trim() ? (
          <EmptyState
            size="sm"
            icon={Search}
            title={`Nenhum resultado para “${search}”`}
            action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
          />
        ) : (
          <EmptyState
            size="sm"
            icon={Footprints}
            title="Nenhum solado com déficit por numeração"
            description="Todas as numerações estão acima do mínimo configurado."
          />
        )
      ) : (
        <div className="rounded-md border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Solado</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Numeração</TableHead>
                <TableHead className="text-right">Atual</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Déficit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSoles.map((sole, index) => (
                <TableRow key={`${sole.product_id}-${sole.size}-${index}`} className="bg-destructive/5">
                  <TableCell className="text-xs">
                    <div className="font-medium">{sole.product_name}</div>
                    {sole.sku && <div className="text-xs text-muted-foreground font-mono">{sole.sku}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{sole.group_name ?? '—'}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-xs">{sole.size}</Badge></TableCell>
                  <TableCell className="text-xs text-right font-mono">{sole.quantity}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{sole.min_stock}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-destructive font-semibold">{sole.deficit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
