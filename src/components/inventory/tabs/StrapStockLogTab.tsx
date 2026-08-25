import { useState } from 'react';
import { CircleNotch as Loader2, MagnifyingGlass, ArrowDownRight, ArrowUpRight, ArrowCounterClockwise as RotateCcw, Warning } from '@phosphor-icons/react';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';

type StockMovement = {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  description: string | null;
  order_id: string | null;
  created_at: string;
  strap_stock_role: 'base' | 'finished';
  products: { name: string; sku: string; unit: string; color: string | null } | null;
  orders: { order_number: string; sale_order_id: string | null; sale_orders: { order_number: string } | null } | null;
};

interface StrapVariantProductQueryResult {
  data: Array<{ finished_product_id: string | null }> | null;
  error: unknown;
}

interface StrapStockMovementQueryResult {
  data: Array<Omit<StockMovement, 'strap_stock_role'>> | null;
  error: unknown;
}

interface StrapStockMovementQueryBuilder extends PromiseLike<StrapStockMovementQueryResult> {
  gte: (column: 'created_at', value: string) => StrapStockMovementQueryBuilder;
  or: (filter: string) => StrapStockMovementQueryBuilder;
  order: (column: 'created_at', options: { ascending: boolean }) => StrapStockMovementQueryBuilder;
  limit: (count: number) => StrapStockMovementQueryBuilder;
}

const strapIdentityClient = supabase as unknown as {
  from: (relation: 'artisanal_strap_variants') => {
    select: (columns: 'finished_product_id') => {
      not: (column: 'finished_product_id', operator: 'is', value: null) => PromiseLike<StrapVariantProductQueryResult>;
    };
  };
};

const strapStockClient = supabase as unknown as {
  from: (relation: 'stock_movements') => {
    select: (columns: string) => StrapStockMovementQueryBuilder;
  };
};

const STRAP_STOCK_HISTORY_DAYS = 180;

export default function StrapStockLogTab() {
  const isAdmin = useIsAdmin();
  const [search, setSearch] = useState('');

  const { data: movements = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['strap_stock_movements'],
    enabled: isAdmin,
    queryFn: async () => {
      const historyStart = new Date(
        Date.now() - STRAP_STOCK_HISTORY_DAYS * 86400000,
      ).toISOString();
      const [variantsResult, legacyProductsResult] = await Promise.all([
        strapIdentityClient
          .from('artisanal_strap_variants')
          .select('finished_product_id')
          .not('finished_product_id', 'is', null),
        supabase
          .from('products')
          .select('id')
          .eq('is_artisanal', true),
      ]);

      if (variantsResult.error) throw variantsResult.error;
      if (legacyProductsResult.error) throw legacyProductsResult.error;

      const strapProductIds = Array.from(new Set([
        ...(variantsResult.data || []).map((variant) => variant.finished_product_id),
        ...(legacyProductsResult.data || []).map((product) => product.id),
      ].filter((productId): productId is string => Boolean(productId))));

      const identityFilters = [
        'strap_variant_id.not.is.null',
        'sale_order_strap_demand_id.not.is.null',
        'strap_batch_item_id.not.is.null',
      ];
      if (strapProductIds.length > 0) {
        identityFilters.unshift(`product_id.in.(${strapProductIds.join(',')})`);
      }

      const { data, error } = await strapStockClient
        .from('stock_movements')
        .select('*, products(name, sku, unit, color), orders(order_number, sale_order_id, sale_orders(order_number))')
        .gte('created_at', historyStart)
        .or(identityFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const finishedProductIds = new Set(strapProductIds);
      return (data || []).map((movement) => ({
        ...movement,
        strap_stock_role: finishedProductIds.has(movement.product_id) ? 'finished' as const : 'base' as const,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = movements.filter((m) =>
    searchMatchesAllTerms(
      search,
      m.products?.name,
      m.products?.sku,
      m.products?.color,
      m.description,
      m.orders?.order_number,
      m.orders?.sale_orders?.order_number,
    ),
  );

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Warning}
        title="Não foi possível carregar o histórico de tiras"
        description={error instanceof Error ? error.message : 'Tente novamente em instantes.'}
        action={(
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchInput
          className="flex-1 max-w-sm"
          placeholder="Buscar por material, SKU, pedido ou descrição…"
          value={search}
          onChange={setSearch}
          resultCount={filtered.length}
          totalCount={movements.length}
        />
        <p className="text-xs text-muted-foreground">
          Últimos {STRAP_STOCK_HISTORY_DAYS} dias ({filtered.length} registros)
        </p>
      </div>

      {filtered.length === 0 ? (
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
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma movimentação de tiras encontrada
          </div>
        )
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Data/Hora</TableHead>
                <TableHead className="font-semibold">Tipo</TableHead>
                <TableHead className="font-semibold">Material</TableHead>
                <TableHead className="font-semibold">Papel</TableHead>
                <TableHead className="font-semibold">Cor</TableHead>
                <TableHead className="font-semibold">Pedido</TableHead>
                <TableHead className="font-semibold text-right">Quantidade</TableHead>
                <TableHead className="font-semibold text-right">Est. Anterior</TableHead>
                <TableHead className="font-semibold text-right">Est. Atual</TableHead>
                <TableHead className="font-semibold">Descrição</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((mov) => {
                const isOut = mov.movement_type === 'out';
                const isReturn = normalizeForSearch(mov.description).includes('estorno') ||
                  normalizeForSearch(mov.description).includes('retorno') ||
                  normalizeForSearch(mov.description).includes('credit');
                return (
                  <TableRow key={mov.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(mov.created_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      {isReturn ? (
                        <Badge variant="outline" className="text-xs bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400">
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Estorno
                        </Badge>
                      ) : isOut ? (
                        <Badge variant="outline" className="text-xs bg-destructive/15 text-destructive border-destructive/30">
                          <ArrowDownRight className="h-3 w-3 mr-1" />
                          Saída
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400">
                          <ArrowUpRight className="h-3 w-3 mr-1" />
                          Entrada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{mov.products?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {mov.strap_stock_role === 'finished' ? 'Tira pronta' : 'Material-base'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{mov.products?.color || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {mov.orders?.sale_orders?.order_number || mov.orders?.order_number || '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(mov.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {mov.products?.unit ?? ''}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {Number(mov.previous_stock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(mov.new_stock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                      {mov.description || '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

    </div>
  );
}
