import { useState } from 'react';
import { Loader2, Search, ArrowDownRight, ArrowUpRight, RotateCcw, BarChart3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StrapSummaryDialog from '../StrapSummaryDialog';
import { useIsAdmin } from '@/hooks/useUserManagement';

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
  products: { name: string; sku: string; unit: string } | null;
  orders: { order_number: string; sale_order_id: string | null; sale_orders: { order_number: string } | null } | null;
};

export default function StrapStockLogTab() {
  const isAdmin = useIsAdmin();
  const [search, setSearch] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['strap_stock_movements'],
    enabled: isAdmin,
    queryFn: async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
      const { data, error } = await supabase
        .from('stock_movements')
        .select('*, products(name, sku, unit), orders(order_number, sale_order_id, sale_orders(order_number))')
        .gte('created_at', fifteenDaysAgo)
        .ilike('description', '%Tira%')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as StockMovement[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = search.trim()
    ? movements.filter((m) => {
        const q = search.toLowerCase();
        return (
          m.products?.name?.toLowerCase().includes(q) ||
          m.products?.sku?.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q)
        );
      })
    : movements;

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por material ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Últimos 15 dias ({filtered.length} registros)
        </p>
        <Button variant="outline" size="sm" className="gap-2 ml-auto" onClick={() => setSummaryOpen(true)}>
          <BarChart3 className="h-4 w-4" />
          Resumo Semanal
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Nenhuma movimentação de tiras encontrada
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Data/Hora</TableHead>
                <TableHead className="font-semibold">Tipo</TableHead>
                <TableHead className="font-semibold">Material</TableHead>
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
                const isReturn = mov.description?.toLowerCase().includes('estorno') ||
                  mov.description?.toLowerCase().includes('retorno') ||
                  mov.description?.toLowerCase().includes('credit');
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

      <StrapSummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} movements={movements} />
    </div>
  );
}
