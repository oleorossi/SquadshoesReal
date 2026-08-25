import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Handshake, ArrowSquareOut as ExternalLink, Scissors, Warning } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, cn } from '@/lib/utils';
import { serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';
import { normalizeOsStatus, osStatusLabel, isOsDone, isOsCancelled } from '@/lib/osStatusMachine';
import { isStrapServiceOrder, type StrapServiceOrderIdentity } from '@/lib/strapServiceOrderIdentity';
import { narrowPostgrestClient, narrowPostgrestRelation } from '@/lib/narrowPostgrestClient';
import {
  attributeServiceOrderToPv,
  dedupeAndSortPvServiceOrders,
  type PvServiceOrderHeaderRef,
  type PvServiceOrderLineRef,
  type PvServiceOrderOpRef,
  type PvServiceOrderSaleItemRef,
} from '@/lib/pvServiceOrderAttribution';

interface PvServiceOrderItemRow extends PvServiceOrderLineRef {
  strap_variant_id?: string | null;
  strap_recipe_id?: string | null;
  strap_batch_item_id?: string | null;
  sale_order_strap_demand_id?: string | null;
  strap_stock_floor_contribution_id?: string | null;
}

interface PvServiceOrderHeaderRow extends PvServiceOrderHeaderRef, StrapServiceOrderIdentity {
  status: string;
  target_sector: string | null;
  sector: string | null;
  contractors: { name: string | null; trade_name: string | null } | null;
}

interface ServiceOrderIdRow {
  id: string;
}

const schemaGapSupabase = narrowPostgrestClient(supabase);
const serviceOrderItemsPostgrest = narrowPostgrestRelation<PvServiceOrderItemRow>(supabase);

/**
 * Card read-only "Ordens de Serviço deste pedido" no detalhe do PV. Lista as OS
 * geradas a partir deste pedido (fluxo por-OP no hub Terceirizados, além de OS
 * antigas/manuais vinculadas). A geração acontece em /terceirizados?tab=orders
 * ("Gerar OS por Pedido") — aqui é só acompanhamento.
 */
export function PvServiceOrdersCard({ saleOrderId }: { saleOrderId: string }) {
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pv_service_orders', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const [{ data: pvItems, error: itemsError }, { data: pvOrders, error: ordersError }] = await Promise.all([
        supabase
          .from('sale_order_items')
          .select('id, sale_order_id, quantity')
          .eq('sale_order_id', saleOrderId),
        supabase
          .from('orders')
          .select('id, sale_order_id, sale_order_item_id, order_number')
          .eq('sale_order_id', saleOrderId),
      ]);
      if (itemsError) throw itemsError;
      if (ordersError) throw ordersError;

      const itemIds = (pvItems || []).map((item) => item.id);
      const orderIds = (pvOrders || []).map((order) => order.id);
      const candidate = () => schemaGapSupabase
        .from<ServiceOrderIdRow>('service_orders')
        .select('id')
        .is('archived_at', null);

      // Cada consulta cobre uma forma persistida de vínculo. Separá-las evita
      // uma URL `.or(...)` enorme e torna explícito que arrays usam overlap /
      // contains, não igualdade textual.
      const candidateQueries = [
        candidate().or(`source_sale_order_id.eq.${saleOrderId},sale_order_id.eq.${saleOrderId}`),
        candidate().contains('linked_sale_order_ids', [saleOrderId]),
      ];
      if (itemIds.length > 0) {
        candidateQueries.push(candidate().in('source_sale_order_item_id', itemIds));
        candidateQueries.push(candidate().overlaps('selected_sale_order_item_ids', itemIds));
      }
      if (orderIds.length > 0) {
        candidateQueries.push(candidate().or(
          `order_id.in.(${orderIds.join(',')}),related_order_id.in.(${orderIds.join(',')})`,
        ));
      }

      const childCandidate = serviceOrderItemsPostgrest
        .from('service_order_items')
        .select('service_order_id');
      const childCandidateQuery = orderIds.length > 0
        ? childCandidate.or(`sale_order_id.eq.${saleOrderId},order_id.in.(${orderIds.join(',')})`)
        : childCandidate.eq('sale_order_id', saleOrderId);

      const [...candidateResults] = await Promise.all([...candidateQueries, childCandidateQuery]);
      for (const result of candidateResults) {
        if (result.error) throw result.error;
      }
      const serviceOrderIds = Array.from(new Set(candidateResults.flatMap((result) => (
        (result.data || []).map((row) => (
          'id' in row ? row.id : row.service_order_id
        )).filter((id): id is string => Boolean(id))
      ))));
      if (serviceOrderIds.length === 0) return [];

      const { data: headerRows, error: headerError } = await schemaGapSupabase
        .from<PvServiceOrderHeaderRow>('service_orders')
        // O hint `orders!order_id` é obrigatório: service_orders possui mais de
        // uma relação com orders no schema exposto pelo PostgREST.
        .select(`
          id, order_number, target_sector, sector, quantity, total_value, status,
          order_id, related_order_id, created_at, source_sale_order_id, sale_order_id,
          linked_sale_order_ids, source_sale_order_item_id, selected_sale_order_item_ids,
          artisanal_recipe_id, canonical_strap_recipe_id, artisanal_output_name,
          artisanal_output_color, artisanal_output_meters, artisanal_for_order_meters,
          artisanal_for_stock_meters, artisanal_base_color, artisanal_stock_entry_done,
          orders!order_id(order_number, sale_order_id), contractors(name, trade_name)
        `)
        .in('id', serviceOrderIds)
        .is('archived_at', null);
      if (headerError) throw headerError;

      const serviceOrders = dedupeAndSortPvServiceOrders(headerRows || []);
      const selectedItemIds = Array.from(new Set(serviceOrders.flatMap((order) => [
        order.source_sale_order_item_id,
        ...(order.selected_sale_order_item_ids || []),
      ].filter((id): id is string => Boolean(id)))));
      const referencedOrderIds = Array.from(new Set(serviceOrders.flatMap((order) => [
        order.order_id,
        order.related_order_id,
      ].filter((id): id is string => Boolean(id)))));

      const [linesResult, selectedItemsResult, referencedOrdersResult] = await Promise.all([
        serviceOrderItemsPostgrest
          .from('service_order_items')
          .select('id, service_order_id, sale_order_id, order_id, quantity, total_value, line_status, strap_variant_id, strap_recipe_id, strap_batch_item_id, sale_order_strap_demand_id, strap_stock_floor_contribution_id, orders!order_id(sale_order_id, order_number)')
          .in('service_order_id', serviceOrderIds),
        selectedItemIds.length > 0
          ? supabase.from('sale_order_items').select('id, sale_order_id, quantity').in('id', selectedItemIds)
          : Promise.resolve({ data: [], error: null }),
        referencedOrderIds.length > 0
          ? supabase.from('orders').select('id, sale_order_id, sale_order_item_id, order_number').in('id', referencedOrderIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (linesResult.error) throw linesResult.error;
      if (selectedItemsResult.error) throw selectedItemsResult.error;
      if (referencedOrdersResult.error) throw referencedOrdersResult.error;

      const saleItemsById = new Map<string, PvServiceOrderSaleItemRef>();
      for (const item of [
        ...((pvItems || []) as PvServiceOrderSaleItemRef[]),
        ...((selectedItemsResult.data || []) as PvServiceOrderSaleItemRef[]),
      ]) saleItemsById.set(item.id, item);
      const allSaleItems = [...saleItemsById.values()];
      const ordersById = new Map<string, PvServiceOrderOpRef>();
      for (const order of [
        ...((pvOrders || []) as PvServiceOrderOpRef[]),
        ...((referencedOrdersResult.data || []) as PvServiceOrderOpRef[]),
      ]) ordersById.set(order.id, order);
      const allOrders = [...ordersById.values()];
      const linesByServiceOrder = new Map<string, PvServiceOrderLineRef[]>();
      for (const line of linesResult.data || []) {
        const current = linesByServiceOrder.get(line.service_order_id) || [];
        current.push(line);
        linesByServiceOrder.set(line.service_order_id, current);
      }
      const canonicalIds = new Set<string>();
      for (const line of linesResult.data || []) {
        if (line.strap_variant_id || line.strap_recipe_id || line.strap_batch_item_id
          || line.sale_order_strap_demand_id || line.strap_stock_floor_contribution_id) {
          canonicalIds.add(line.service_order_id);
        }
      }

      return serviceOrders.map((order) => ({
        ...order,
        is_canonical_strap: canonicalIds.has(order.id),
        pv_attribution: attributeServiceOrderToPv(
          order,
          saleOrderId,
          linesByServiceOrder.get(order.id) || [],
          allSaleItems,
          allOrders,
        ),
      }));
    },
    staleTime: 30_000,
  });

  if (isLoading) return null;
  if (isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="flex items-start gap-2">
            <Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Não foi possível conferir as OS deste pedido.</strong>{' '}
              {error instanceof Error ? error.message : 'Recarregue os vínculos antes de continuar.'}
            </span>
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }
  if (rows.length === 0) return null;

  const statusCls = (raw: string) => {
    const s = normalizeOsStatus(raw);
    if (isOsCancelled(s)) return 'bg-muted text-muted-foreground border-border';
    if (isOsDone(s)) return 'bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400';
    return 'bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400';
  };

  const totalAtivo = rows
    .filter((r) => !isOsCancelled(normalizeOsStatus(r.status)) && r.pv_attribution.totalValue != null)
    .reduce((sum, r) => sum + Number(r.pv_attribution.totalValue), 0);
  const hasUnallocatedValues = rows.some((row) => row.pv_attribution.totalValue == null);
  const hasGenericOrders = rows.some((row) => !isStrapServiceOrder(row));
  const hasStrapOrders = rows.some((row) => isStrapServiceOrder(row));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          Ordens de Serviço deste pedido
          <Badge variant="outline" className="h-5 text-[10px] font-mono">{rows.length}</Badge>
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {hasStrapOrders && (
            <Link to="/tiras-artesanais?tab=producao" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Abrir Tiras <Scissors className="h-3 w-3" />
            </Link>
          )}
          {hasGenericOrders && (
            <Link to="/terceirizados?tab=orders" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Gerar / ver OS <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Serviços comuns são geridos em <strong>Terceirizados</strong>; produção e remessas de tira pertencem à <strong>Central de Tiras</strong>.
      </p>

      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2 font-semibold">Serviço · Contratada</th>
              <th className="px-3 py-2 font-semibold">OP</th>
              <th className="px-3 py-2 font-semibold text-right">Pares</th>
              <th className="px-3 py-2 font-semibold text-right">Total</th>
              <th className="px-3 py-2 font-semibold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const contractor = r.contractors?.trade_name || r.contractors?.name || '—';
              const cancelled = isOsCancelled(normalizeOsStatus(r.status));
              const strapOrder = isStrapServiceOrder(r);
              const destination = strapOrder
                ? r.is_canonical_strap
                  ? `/tiras-artesanais?tab=producao&q=${encodeURIComponent(r.order_number || '')}`
                  : '/tiras-artesanais?tab=diagnostico'
                : `/terceirizados?tab=orders&q=${encodeURIComponent(r.order_number || '')}`;
              const attribution = r.pv_attribution;
              const attributionWarning = attribution.source === 'shared-unallocated'
                ? 'OS compartilhada por vários PVs sem rateio persistido.'
                : attribution.source === 'container-unallocated'
                  ? 'O cabeçalho aponta para este PV, mas nenhuma linha do contêiner traz quantidade ou valor atribuível a ele.'
                  : null;
              return (
                <tr key={r.id} className={cn('align-top', cancelled && 'opacity-60')}>
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{strapOrder ? 'Produção de tiras' : r.target_sector ? serviceOrderSectorLabel(r.target_sector) : (r.order_number || 'OS')}</span>
                      <span className="text-muted-foreground"> · {contractor}</span>
                    </div>
                    {r.order_number && (
                      <Link to={destination} className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline">
                        OS {r.order_number}{strapOrder && <Scissors className="h-3 w-3" />}
                      </Link>
                    )}
                    {attribution.source === 'lines' && attribution.sharedAcrossPvs && (
                      <div className="mt-1 text-[10px] text-muted-foreground">Parcela deste PV calculada pelas linhas da OS.</div>
                    )}
                    {attributionWarning && (
                      <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">{attributionWarning}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{attribution.opNumbers.join(', ') || r.orders?.order_number || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {attribution.quantity == null ? '—' : attribution.quantity.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {attribution.totalValue == null ? '—' : formatCurrency(attribution.totalValue)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="outline" className={cn('text-[10px]', statusCls(r.status))}>{osStatusLabel(normalizeOsStatus(r.status))}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {hasUnallocatedValues && <span>* Totais compartilhados sem rateio não entram na soma.</span>}
        <span className="ml-auto">Total ativo atribuível ao PV: <strong className="ml-1 text-foreground font-mono tabular-nums">{formatCurrency(totalAtivo)}</strong></span>
      </div>
    </div>
  );
}
