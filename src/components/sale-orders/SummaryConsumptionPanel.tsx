import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchConsumptionContext,
  computeConsumptionForItems,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import { annotateConsumptionAvailability, type ConsumptionRow } from '@/lib/consumptionRows';
import {
  parseCanonicalStrapDemandPreview,
  type CanonicalStrapDemandPreview,
} from '@/lib/canonicalStrapDemandPreview';
import MaterialConsumptionView, { type OrderHeader } from '@/components/sale-orders/MaterialConsumptionView';
import UpperCutOutsourcingSection from '@/components/sale-orders/UpperCutOutsourcingSection';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

/**
 * Consumo de materiais de UM ou MAIS PVs. Roda o MOTOR CANÔNICO
 * (`computeConsumptionForItems`) sobre os itens agregados dos pedidos e
 * apresenta pela `MaterialConsumptionView` (tela + PDF).
 *
 * Padronizado em 2026-07-22 (`specs/consumo-consolidado-padronizacao.md`) — antes
 * reimplementava o motor inline e divergia (variante, tira-base, supressão de
 * forro, cor).
 *
 * Em 05/08/2026 absorveu também o caso de UM PV: o `MaterialConsumptionDialog`
 * foi aposentado e a página `?view=consumo&ids=…` atende os dois escopos com o
 * mesmo código. O modal duplicava esta busca inteira — duas cópias do mesmo
 * carregamento é como as duas telas divergiam antes.
 */
type Props = {
  saleOrderIds: string[];
  /** Ação primária da tela (Gerar OC). Omitida ⇒ o botão não aparece. */
  onGerarOC?: () => void;
};

export default function SummaryConsumptionPanel({ saleOrderIds, onGerarOC }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [artisanalStrapRows, setArtisanalStrapRows] = useState<ArtisanalStrapCutRow[]>([]);
  const [orderHeaders, setOrderHeaders] = useState<OrderHeader[]>([]);

  // Chave ESTÁVEL do escopo. Depender do array cru refazia a carga a cada render
  // do pai quando ele monta a lista com `.map()` (identidade nova toda vez).
  const idsKey = useMemo(() => [...saleOrderIds].sort().join(','), [saleOrderIds]);

  // Gatilho de recálculo automático: invalidado pelo save do PV
  // (useUpdateSaleOrder → invalidateQueries(['consumption-source'])).
  const { dataUpdatedAt: pvTouchedAt } = useQuery({
    queryKey: ['consumption-source', idsKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_orders')
        .select('id, updated_at')
        .in('id', idsKey ? idsKey.split(',') : []);
      return (data || []).map((r: any) => r.updated_at).join('|');
    },
    enabled: !!idsKey,
    staleTime: 0,
  });

  useEffect(() => {
    if (!idsKey) { setRows([]); setArtisanalStrapRows([]); setOrderHeaders([]); return; }
    let cancelled = false;
    loadAll(idsKey.split(','), () => cancelled);
    return () => { cancelled = true; };
  }, [idsKey, pvTouchedAt]);

  const loadAll = async (ids: string[], isCancelled: () => boolean = () => false) => {
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
          .in('sale_order_id', ids),
        supabase
          .from('sale_orders')
          .select('id, order_number, client_order_number, packaging_mode')
          .in('id', ids),
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
      const [ctx, previewResults] = await Promise.all([
        fetchConsumptionContext(refIds),
        Promise.all(ids.map((saleOrderId) =>
          (supabase as any).rpc('preview_sale_order_strap_demand', {
            p_sale_order_id: saleOrderId,
          }))),
      ]);
      const strapPreviews: CanonicalStrapDemandPreview[] = [];
      for (const result of previewResults as Array<{ data?: unknown; error?: { message?: string } | null }>) {
        if (result.error) throw result.error;
        for (const value of (Array.isArray(result.data) ? result.data : []) as Record<string, unknown>[]) {
          const parsed = parseCanonicalStrapDemandPreview(value);
          if (parsed.technicalStrapLineId) strapPreviews.push(parsed);
        }
      }

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
        await annotateConsumptionAvailability(computed, ctx, strapPreviews);

      if (isCancelled()) return;
      setRows(annotatedRows);
      setArtisanalStrapRows(strapCut);
    } catch (err) {
      if (isCancelled()) return;
      console.error('Erro ao carregar consumo:', err);
      setRows([]);
      setArtisanalStrapRows([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  // Escopo de UM PV: título nomeia o pedido e o Corte de Cabedal fica disponível
  // (a OS amarra PV + referência + cor, então não existe pra um lote de PVs).
  const singlePv = saleOrderIds.length === 1 ? saleOrderIds[0] : null;
  const singlePvNumber = singlePv ? (orderHeaders[0]?.order_number ?? '') : '';

  return (
    <MaterialConsumptionView
      rows={rows}
      artisanalStrapRows={artisanalStrapRows}
      title={singlePvNumber ? `Consumo de Materiais — ${singlePvNumber}` : 'Consumo Consolidado'}
      orderHeaders={singlePv ? undefined : orderHeaders}
      loading={loading}
      onRecalcular={() => loadAll(idsKey.split(','))}
      onGerarOC={onGerarOC}
      emptyMessage={
        singlePv
          ? 'Nenhum consumo de material encontrado para este pedido.'
          : 'Nenhum consumo de material encontrado para os pedidos selecionados.'
      }
      extraSections={
        singlePv && singlePvNumber
          ? <UpperCutOutsourcingSection saleOrderId={singlePv} orderNumber={singlePvNumber} />
          : null
      }
    />
  );
}
