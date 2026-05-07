import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, History, ArrowDown, ArrowUp, RefreshCw, ShoppingBag } from 'lucide-react';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
}

interface Movement {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  description: string | null;
  order_id: string | null;
  created_at: string;
  user_id: string | null;
  // Para solados, alguns sistemas gravam grade_change em description ou JSONB extra
  grade_change?: any;
}

const TYPE_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  in:        { label: 'Entrada',  color: 'text-emerald-600', icon: ArrowUp },
  out:       { label: 'Saída',    color: 'text-rose-600',    icon: ArrowDown },
  adjust:    { label: 'Ajuste',   color: 'text-amber-600',   icon: RefreshCw },
  adjustment:{ label: 'Ajuste',   color: 'text-amber-600',   icon: RefreshCw },
  order:     { label: 'PV',       color: 'text-rose-600',    icon: ShoppingBag },
};

export default function SolesHistoricoTab({ sole }: Props) {
  const [periodDays, setPeriodDays] = useState(30);

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['soles_history', sole.id, periodDays],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - periodDays);
      const { data, error } = await supabase
        .from('stock_movements')
        .select('*')
        .eq('product_id', sole.id)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as Movement[];
    },
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    let entradas = 0, saidas = 0, ajustes = 0;
    for (const m of movements) {
      const t = m.movement_type?.toLowerCase();
      const q = Number(m.quantity) || 0;
      if (t === 'in')      entradas += q;
      else if (t === 'out')      saidas += q;
      else if (t === 'order')    saidas += q;
      else                       ajustes += Math.abs(q);
    }
    return { entradas, saidas, ajustes, count: movements.length };
  }, [movements]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Histórico de movimentações</h3>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">Período:</span>
          {[7, 30, 90, 180].map(d => (
            <button
              key={d}
              onClick={() => setPeriodDays(d)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                periodDays === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Movimentações</p>
          <p className="text-xl font-bold">{stats.count}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-emerald-600">Entradas</p>
          <p className="text-xl font-bold font-mono text-emerald-600">+{stats.entradas}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-rose-600">Saídas (PVs)</p>
          <p className="text-xl font-bold font-mono text-rose-600">-{stats.saidas}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-600">Ajustes</p>
          <p className="text-xl font-bold font-mono text-amber-600">{stats.ajustes}</p>
        </CardContent></Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : movements.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma movimentação nos últimos {periodDays} dias.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Quando</TableHead>
                  <TableHead className="w-24">Tipo</TableHead>
                  <TableHead className="text-right w-20">Qtd</TableHead>
                  <TableHead className="text-right w-24">Antes → Depois</TableHead>
                  <TableHead>Descrição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map(m => {
                  const meta = TYPE_LABELS[m.movement_type?.toLowerCase()] || { label: m.movement_type || '?', color: 'text-muted-foreground', icon: RefreshCw };
                  const Icon = meta.icon;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] gap-1 ${meta.color}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-bold ${meta.color}`}>
                        {m.movement_type?.toLowerCase() === 'in' ? '+' : '-'}{Math.abs(Number(m.quantity) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {m.previous_stock} → {m.new_stock}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[400px]">
                        {m.description || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
