import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  materialCoverageStatus,
  orderReadyForProduction,
  type MaterialCoverageStatus,
} from '@/lib/purchaseCoverage';

interface CoverageRow {
  sale_order_id: string;
  order_number: string;
  sale_status: string;
  product_id: string;
  product_name: string;
  unit: string | null;
  supplier_id: string | null;
  supplier_name: string;
  required: number;
  reserved: number;
  short: number;
  open_pending: number;
  received: number;
  purchase_order_id: string | null;
  purchase_order_number: string | null;
}

const STATUS_LABEL: Record<MaterialCoverageStatus, string> = {
  falta: 'Falta',
  comprado: 'Comprado',
  recebido: 'Recebido',
  reservado: 'Reservado',
};

function formatQty(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}

export function PurchaseMaterialCoverage({ mode }: { mode: 'fornecedor' | 'pedido' }) {
  const [supplierId, setSupplierId] = useState('');
  const [saleOrderId, setSaleOrderId] = useState('');
  const query = useQuery({
    queryKey: ['pv-material-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_pv_material_coverage' as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as CoverageRow[];
    },
  });

  const rows = useMemo(() => {
    return (query.data ?? []).map((row) => ({
      ...row,
      required: Number(row.required) || 0,
      reserved: Number(row.reserved) || 0,
      short: Number(row.short) || 0,
      open_pending: Number(row.open_pending) || 0,
      received: Number(row.received) || 0,
    })).map((row) => ({
      ...row,
      coverage: materialCoverageStatus({
        required: row.required,
        reserved: row.reserved,
        short: row.short,
        openPending: row.open_pending,
        received: row.received,
      }),
    }));
  }, [query.data]);

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.supplier_id ?? '', row.supplier_name);
    return [...map.entries()];
  }, [rows]);
  const orders = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.sale_order_id, row.order_number);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rows]);

  const filtered = rows.filter((row) => {
    if (supplierId && (row.supplier_id ?? '') !== supplierId) return false;
    if (saleOrderId && row.sale_order_id !== saleOrderId) return false;
    return true;
  });

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const key = mode === 'fornecedor'
        ? (row.supplier_id ?? row.supplier_name)
        : row.sale_order_id;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, list]) => ({
      key,
      title: mode === 'fornecedor' ? list[0].supplier_name : list[0].order_number,
      subtitle: mode === 'pedido' ? list[0].sale_status : `${new Set(list.map((row) => row.order_number)).size} pedidos`,
      ready: mode === 'pedido' && orderReadyForProduction(list.map((row) => ({ status: row.coverage }))),
      rows: list,
    }));
  }, [filtered, mode]);

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Lendo materiais dos pedidos…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-destructive">Não foi possível ler a cobertura de compra.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Necessidade real dos pedidos aprovados e em produção. O que já está numa OC aberta não volta a ser comprado.
        A entrada do material recebido abre a ordem.
      </p>
      <div className="flex flex-wrap gap-2">
        <Select value={supplierId || '__all__'} onValueChange={(value) => setSupplierId(value === '__all__' ? '' : value)}>
          <SelectTrigger className="h-9 w-56" aria-label="Filtrar fornecedor"><SelectValue placeholder="Todos os fornecedores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os fornecedores</SelectItem>
            {suppliers.filter(([id]) => id).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={saleOrderId || '__all__'} onValueChange={(value) => setSaleOrderId(value === '__all__' ? '' : value)}>
          <SelectTrigger className="h-9 w-44" aria-label="Filtrar pedido"><SelectValue placeholder="Todos os pedidos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os pedidos</SelectItem>
            {orders.map(([id, number]) => <SelectItem key={id} value={id}>{number}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum material nesta seleção.</p>
      ) : groups.map((group) => (
        <section key={group.key} className="rounded-lg border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <p className="text-xs text-muted-foreground">{group.subtitle}</p>
            </div>
            {group.ready && (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Pronto para produção</Badge>
            )}
          </header>
          <ul className="divide-y divide-border/70">
            {group.rows.map((row) => (
              <li key={`${row.sale_order_id}:${row.product_id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{row.product_name}</span>
                  <span className="text-muted-foreground"> · {formatQty(row.required)} {row.unit ?? ''}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.order_number}
                    {mode === 'pedido' ? ` · ${row.supplier_name}` : ''}
                    {` · reservado ${formatQty(row.reserved)}`}
                    {` · falta ${formatQty(row.short)}`}
                    {row.open_pending > 0 ? ` · a receber ${formatQty(row.open_pending)}` : ''}
                  </span>
                </span>
                <Badge variant="outline">{STATUS_LABEL[row.coverage]}</Badge>
                {row.purchase_order_id && row.open_pending > 0 && (
                  <Link
                    className="text-xs underline"
                    to={`/purchase-orders?open=${row.purchase_order_id}`}
                  >
                    Dar entrada{row.purchase_order_number ? ` ${row.purchase_order_number}` : ''}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
