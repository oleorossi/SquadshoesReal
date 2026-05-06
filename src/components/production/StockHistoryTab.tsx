import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, ArrowDownCircle, ArrowUpCircle, User } from 'lucide-react';
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useStockMovements, StockMovementWithProduct } from '@/hooks/useOrders';

type MovementType = 'in' | 'out';

interface StockHistoryTabProps {
  type: MovementType;
}

export function StockHistoryTab({ type }: StockHistoryTabProps) {
  const { data: allMovements = [], isLoading } = useStockMovements();
  const [search, setSearch] = useState('');

  const movements = useMemo(() => {
    return allMovements.filter(m => m.movement_type === type);
  }, [allMovements, type]);

  const filtered = useMemo(() => {
    if (!search) return movements;
    const q = search.toLowerCase();
    return movements.filter(m => {
      const prod = m.products;
      return (
        (prod?.name || '').toLowerCase().includes(q) ||
        (prod?.sku || '').toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q) ||
        (m.user_email || '').toLowerCase().includes(q) ||
        (m.responsible || '').toLowerCase().includes(q) ||
        (m.lot_number || '').toLowerCase().includes(q)
      );
    });
  }, [movements, search]);

  const isOut = type === 'out';

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por material, SKU, descrição ou usuário..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Data / Hora</TableHead>
              <TableHead className="font-semibold">Material</TableHead>
              <TableHead className="font-semibold">SKU</TableHead>
              <TableHead className="font-semibold text-right">Quantidade</TableHead>
              <TableHead className="font-semibold text-right">Estoque Anterior</TableHead>
              <TableHead className="font-semibold text-right">Estoque Novo</TableHead>
              <TableHead className="font-semibold">Descrição</TableHead>
              <TableHead className="font-semibold">Usuário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  {search ? 'Nenhum registro encontrado' : `Nenhum registro de ${isOut ? 'saída' : 'entrada'}`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(m => {
                const prod = m.products as any;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {isOut ? (
                          <ArrowDownCircle className="h-4 w-4 text-destructive shrink-0" />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4 text-success shrink-0" />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {format(new Date(m.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(m.created_at), 'HH:mm:ss')}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{prod?.name || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{prod?.sku || '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      <span className={isOut ? 'text-destructive' : 'text-success'}>
                        {isOut ? '-' : '+'}{Number(m.quantity).toLocaleString('pt-BR')} {prod?.unit || ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {Number(m.previous_stock).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {Number(m.new_stock).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="max-w-[250px]">
                      <p className="text-sm truncate" title={m.description || ''}>{m.description || '—'}</p>
                    </TableCell>
                    <TableCell>
                      {m.user_email ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{m.user_email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sistema</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} registro(s) de {isOut ? 'saída' : 'entrada'}
      </p>
    </div>
  );
}
