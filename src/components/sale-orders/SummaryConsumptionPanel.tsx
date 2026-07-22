import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchConsumptionContext,
  computeConsumptionForItems,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import { annotateConsumptionAvailability, type ConsumptionRow } from '@/lib/consumptionRows';
import MaterialConsumptionView, { type OrderHeader } from '@/components/sale-orders/MaterialConsumptionView';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

/**
 * Consumo Consolidado (multi-PV). Roda o MOTOR CANÔNICO
 * (`computeConsumptionForItems`) sobre os itens agregados de todos os PVs
 * selecionados e apresenta pela MESMA tela/PDF do modal por-PV
 * (`MaterialConsumptionView`). Padronizado em 2026-07-22
 * (`specs/consumo-consolidado-padronizacao.md`) — antes reimplementava o motor
 * inline e divergia (variante, tira-base, supressão de forro, cor).
 */
type Props = { saleOrderIds: string[] };

export default function SummaryConsumptionPanel({ saleOrderIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [artisanalStrapRows, setArtisanalStrapRows] = useState<ArtisanalStrapCutRow[]>([]);
  const [orderHeaders, setOrderHeaders] = useState<OrderHeader[]>([]);

  useEffect(() => {
    if (saleOrderIds.length === 0) return;
    let cancelled = false;
    loadAll(() => cancelled);
    return () => { cancelled = true; };
  }, [saleOrderIds]);

  const loadAll = async (isCancelled: () => boolean = () => false) => {
    setLoading(true);
    try {
      // Itens de TODOS os PVs + cabeçalhos/packaging por PV. O sub-select de
      // technical_sheets reusa TECHNICAL_SHEET_CONSUMPTION_COLUMNS (fonte única do
      // motor) e o item traz material_variant_id (variante de material).
      const [{ data: items, error: itemsError }, { data: saleOrders }] = await Promise.all([
        supabase
          .from('sale_order_items')
          .select(`
            sale_order_id,
            reference_id,
            color,
            quantity,
            grade,
            fichas,
            strap_colors,
            material_variant_id,
            technical_sheets(${TECHNICAL_SHEET_CONSUMPTION_COLUMNS})
          `)
          .in('sale_order_id', saleOrderIds),
        supabase
          .from('sale_orders')
          .select('id, order_number, client_order_number, packaging_mode')
          .in('id', saleOrderIds),
      ]);

      if (itemsError) throw itemsError;
      if (!isCancelled()) {
        setOrderHeaders((saleOrders || []).map((so: any) => ({
          order_number: so.order_number,
          client_order_number: so.client_order_number,
        })));
      }
      if (!items || items.length === 0) {
        if (!isCancelled()) { setRows([]); setArtisanalStrapRows([]); }
        return;
      }

      // sale_order_id → packaging_mode (por PV; PVs diferentes podem ter modos
      // diferentes e cada um mostra só a caixa do seu modo).
      const packagingModeByOrder = new Map<string, string | null>(
        (saleOrders || []).map((so: any) => [so.id, so.packaging_mode ?? null]),
      );

      const refIds = [...new Set(items.map((i: any) => i.reference_id).filter(Boolean))];
      const ctx = await fetchConsumptionContext(refIds);

      // Cada item carrega o packaging_mode do SEU pedido.
      const itemsWithMode = (items as any[]).map((it) => ({
        ...it,
        packagingMode: packagingModeByOrder.get(it.sale_order_id) ?? null,
      }));

      // UMA chamada ao motor com TODOS os itens → linhas já agregadas por
      // grupo+cor (demanda combinada). A disponibilidade é anotada UMA vez sobre
      // essa demanda combinada (sem dupla contagem de estoque entre PVs).
      const computed = computeConsumptionForItems(
        itemsWithMode as unknown as ConsumptionItem[],
        ctx,
      );
      const { rows: annotatedRows, artisanalStrapRows: strapCut } =
        await annotateConsumptionAvailability(computed, ctx);

      if (isCancelled()) return;
      setRows(annotatedRows);
      setArtisanalStrapRows(strapCut);
    } catch (err) {
      if (isCancelled()) return;
      console.error('Erro ao carregar consumo consolidado:', err);
      setRows([]);
      setArtisanalStrapRows([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  return (
    <MaterialConsumptionView
      rows={rows}
      artisanalStrapRows={artisanalStrapRows}
      title="Consumo Consolidado"
      orderHeaders={orderHeaders}
      loading={loading}
      onRecalcular={() => loadAll()}
      emptyMessage="Nenhum consumo de material encontrado para os pedidos selecionados."
      stickyBleedClass=""
    />
  );
}
