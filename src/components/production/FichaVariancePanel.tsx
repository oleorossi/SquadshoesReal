import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calculateConsumption } from '@/services/consumptionService';
import {
  diagnosisLabel,
  mergeTheoreticalAndActual,
  varianceSummary,
  type VarianceStatus,
} from '@/lib/fichaVariance';
import { createPOsFromVariance } from '@/lib/fichaShortagePO';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const statusClass: Record<VarianceStatus, string> = {
  no_ponto: 'bg-success/15 text-success border-success/30',
  alerta: 'bg-warning/15 text-warning border-warning/30',
  critico: 'bg-destructive/15 text-destructive border-destructive/30',
  sem_ficha: 'bg-destructive/15 text-destructive border-destructive/30',
  sem_baixa: 'bg-warning/15 text-warning border-warning/30',
};

const statusLabel: Record<VarianceStatus, string> = {
  no_ponto: 'No ponto',
  alerta: 'Alerta',
  critico: 'Crítico',
  sem_ficha: 'Sem ficha',
  sem_baixa: 'Sem baixa',
};

type OrderRow = {
  id: string;
  order_number: string | null;
  quantity: number | null;
  color: string | null;
  grade: Record<string, number> | null;
  reference_id: string | null;
  sale_order_id: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  unit_price: number | null;
  quantity: number | null;
  min_stock: number | null;
  is_artisanal?: boolean | null;
};

type MovementRow = {
  product_id: string | null;
  quantity: number | null;
};

type SaleNumberRow = {
  order_number?: string | null;
};

export default function FichaVariancePanel() {
  const [orderId, setOrderId] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['ficha-variance-orders'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, quantity, color, grade, reference_id, sale_order_id')
        .not('reference_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data || []) as OrderRow[];
    },
  });

  const auditQuery = useQuery({
    queryKey: ['ficha-variance-audit', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const order = (ordersQuery.data || []).find((o) => o.id === orderId);
      if (!order?.reference_id) throw new Error('OP sem referência');

      const movementsQuery = supabase
        .from('stock_movements')
        .select('product_id, quantity, movement_type, description')
        .eq('movement_type', 'out')
        .or(`description.ilike.%${order.order_number || order.id}%,description.ilike.%${order.id}%`)
        .limit(500);

      const saleQuery = order.sale_order_id
        ? supabase.from('sale_orders').select('order_number').eq('id', order.sale_order_id).maybeSingle()
        : Promise.resolve({ data: null as SaleNumberRow | null });

      const [summary, movementsRes, productsRes, saleRes] = await Promise.all([
        calculateConsumption({
          referenceId: order.reference_id,
          quantity: Number(order.quantity) || 0,
          color: order.color,
          grade: order.grade,
        }),
        movementsQuery,
        supabase.from('products').select('id, name, unit, unit_price, quantity, min_stock, is_artisanal').limit(4000),
        saleQuery,
      ]);

      const products = new Map(
        ((productsRes.data || []) as ProductRow[]).map((p) => [p.id, p]),
      );

      const theoretical = summary.lines
        .filter((l) => l.product_id)
        .map((l) => ({
          productId: l.product_id,
          name: l.product_name,
          unit: l.unit || products.get(l.product_id || '')?.unit,
          qty: Number(l.required) || 0,
          unitCost: products.get(l.product_id || '')?.unit_price ?? null,
        }));

      const actualBucket = new Map<string, number>();
      for (const mov of (movementsRes.data || []) as MovementRow[]) {
        if (!mov.product_id) continue;
        actualBucket.set(mov.product_id, (actualBucket.get(mov.product_id) || 0) + Math.abs(Number(mov.quantity) || 0));
      }

      const actual = [...actualBucket.entries()].map(([productId, qty]) => ({
        productId,
        name: products.get(productId)?.name,
        unit: products.get(productId)?.unit,
        qty,
      }));

      const lines = mergeTheoreticalAndActual({ theoretical, actual });
      const stockByProduct: Record<string, { stock: number; minStock: number; isArtisanal?: boolean }> = {};
      for (const p of products.values()) {
        stockByProduct[p.id] = {
          stock: Number(p.quantity) || 0,
          minStock: Number(p.min_stock) || 0,
          isArtisanal: Boolean(p.is_artisanal),
        };
      }

      const saleData = saleRes.data as SaleNumberRow | null;

      return {
        order,
        lines,
        stockByProduct,
        pvNumber: saleData?.order_number || order.order_number || 'OP',
        summary: varianceSummary(lines),
      };
    },
  });

  const lines = auditQuery.data?.lines || [];
  const totals = useMemo(() => varianceSummary(lines), [lines]);

  async function handleCreatePOs() {
    if (!auditQuery.data) return;
    setCreating(true);
    try {
      const pos = await createPOsFromVariance({
        lines: auditQuery.data.lines,
        stockByProduct: auditQuery.data.stockByProduct,
        orderRef: String(auditQuery.data.pvNumber),
      });
      if (pos.length === 0) {
        toast.message('Nada pra comprar — sem overage nem furo de mínimo.');
      } else {
        toast.success(`${pos.length} ${pos.length === 1 ? 'OC' : 'OCs'}: ${pos.map((p) => p.poNumber).join(', ')}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao gerar OC';
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <Select value={orderId} onValueChange={setOrderId}>
            <SelectTrigger className="h-9" aria-label="Escolher OP para auditoria da ficha">
              <SelectValue placeholder="Escolher OP" />
            </SelectTrigger>
            <SelectContent>
              {(ordersQuery.data || []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.order_number || o.id.slice(0, 8)} · {o.quantity || 0} pares
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={!auditQuery.data || creating} onClick={handleCreatePOs}>
          Gerar OC da ruptura
        </Button>
      </div>

      {auditQuery.data && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{totals.ok} no ponto</Badge>
          <Badge variant="outline" className={statusClass.alerta}>{totals.alerta} alerta</Badge>
          <Badge variant="outline" className={statusClass.critico}>{totals.critico} crítico</Badge>
          <span className="text-muted-foreground">
            Extra CMV {totals.extraCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>
        </div>
      )}

      {auditQuery.isFetching && <p className="text-sm text-muted-foreground">Calculando explosão × baixas…</p>}
      {auditQuery.isError && (
        <p className="text-sm text-destructive">{(auditQuery.error as Error)?.message || 'Falha na auditoria'}</p>
      )}

      {lines.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead className="text-right">Teórico</TableHead>
              <TableHead className="text-right">Real</TableHead>
              <TableHead className="text-right">Δ</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Diagnóstico</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.productId || line.name}`}>
                <TableCell className="font-medium">{line.name}</TableCell>
                <TableCell className="text-right font-mono">{line.theoretical.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {line.unit}</TableCell>
                <TableCell className="text-right font-mono">{line.actual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {line.unit}</TableCell>
                <TableCell className="text-right font-mono">{line.delta.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusClass[line.status]}>{statusLabel[line.status]}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{diagnosisLabel(line.diagnosis)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
