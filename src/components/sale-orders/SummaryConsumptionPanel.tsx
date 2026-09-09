import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import MaterialConsumptionView, {
  type ConsumptionPartitionMode,
} from '@/components/sale-orders/MaterialConsumptionView';
import UpperCutOutsourcingSection from '@/components/sale-orders/UpperCutOutsourcingSection';
import {
  loadPvConsumption,
  materializePvConsumptionScope,
  normalizePvConsumptionIds,
  normalizePvConsumptionItemIds,
  parsePvConsumptionItemParam,
  pvConsumptionItemLabel,
  pvConsumptionQueryKey,
  PV_CONSUMPTION_STALE_MS,
  type PvConsumptionItem,
} from '@/lib/pvConsumption';

/**
 * Consumo de materiais de UM ou MAIS PVs. Lê a projeção batch do MESMO motor
 * SQL usado por reserva/baixa/custeio/MRP/compra e apresenta pela
 * `MaterialConsumptionView` (tela + PDF). Não recalcula quantidades no browser.
 *
 * Padronizado em 2026-07-22 (`specs/consumo-consolidado-padronizacao.md`) — antes
 * reimplementava o motor inline e divergia (variante, tira-base, supressão de
 * forro, cor).
 *
 * Em 05/08/2026 absorveu também o caso de UM PV: a página `?view=consumo&ids=…`
 * atende os dois escopos com o mesmo código.
 *
 * 22/08/2026: a carga mora em `loadPvConsumption` + React Query (prefetch no
 * detalhe do PV reaproveita o cache na mesma aba).
 *
 * 07/09/2026: filtro por item do PV (`?item=`) reescopa o report canônico
 * (solado + materiais + tiras) sem nova RPC.
 *
 * 09/09/2026: modo estendido "Por PV e modelo" rematerializa o mesmo report
 * com `partition: 'order_reference'` — sem nova RPC.
 *
 * 09/09/2026: `?item=` aceita CSV (`id1,id2`) pra multi-seleção de itens.
 */
type Props = {
  saleOrderIds: string[];
  /** Ação primária da tela (Gerar ordem de compra). Recebe o modo da tela
   *  (Consumo total vs cobertura). Omitida ⇒ o botão não aparece. */
  onGerarOC?: (opts: { grossNeed: boolean }) => void;
  /** Título compacto (legado). A página cheia omite. */
  embedded?: boolean;
};

export default function SummaryConsumptionPanel({ saleOrderIds, onGerarOC, embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [partitionMode, setPartitionMode] = useState<ConsumptionPartitionMode>('none');
  const idsKey = useMemo(
    () => normalizePvConsumptionIds(saleOrderIds).sort().join(','),
    [saleOrderIds],
  );
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: pvConsumptionQueryKey(ids),
    queryFn: () => loadPvConsumption(ids),
    enabled: ids.length > 0,
    staleTime: PV_CONSUMPTION_STALE_MS,
  });

  const items = data?.items ?? [];
  const itemParam = searchParams.get('item');
  const selectedItemIds = useMemo(() => {
    const requested = parsePvConsumptionItemParam(itemParam);
    if (requested.length === 0) return [] as string[];
    const known = new Set(items.map((item) => item.id));
    return requested.filter((id) => known.has(id));
  }, [itemParam, items]);

  // IDs inválidos/ausentes na URL → reescreve (ou limpa) pra não ficar filtro fantasma.
  useEffect(() => {
    if (!itemParam) return;
    if (isLoading && !data) return;
    const requested = parsePvConsumptionItemParam(itemParam);
    const known = new Set(items.map((item) => item.id));
    const valid = requested.filter((id) => known.has(id));
    if (valid.length === requested.length) return;
    const next = new URLSearchParams(searchParams);
    if (valid.length === 0) next.delete('item');
    else next.set('item', valid.join(','));
    setSearchParams(next, { replace: true });
  }, [itemParam, items, isLoading, data, searchParams, setSearchParams]);

  const setSelectedItemIds = (nextIds: string[]) => {
    const unique = normalizePvConsumptionItemIds(nextIds);
    const next = new URLSearchParams(searchParams);
    // Vazio ou todos os itens do PV → equivalente a "Todos os itens".
    const selectsAll = items.length > 0
      && unique.length === items.length
      && items.every((item) => unique.includes(item.id));
    if (unique.length === 0 || selectsAll) next.delete('item');
    else next.set('item', unique.join(','));
    setSearchParams(next, { replace: true });
  };

  const hasItemFilter = selectedItemIds.length > 0;
  const canPartition = !!data?.canPartitionByOrderReference && !hasItemFilter;
  const effectivePartition: ConsumptionPartitionMode =
    canPartition && partitionMode === 'order_reference' ? 'order_reference' : 'none';

  // Volta ao consolidado se o escopo deixa de permitir partição (ex.: filtro de item).
  useEffect(() => {
    if (!canPartition && partitionMode !== 'none') setPartitionMode('none');
  }, [canPartition, partitionMode]);

  const scopeKey = hasItemFilter
    ? [...selectedItemIds].sort().join(',')
    : 'all';

  const scopedQuery = useQuery({
    // dataUpdatedAt invalida o escopo quando "Recalcular" refresca o report.
    queryKey: [
      ...pvConsumptionQueryKey(ids),
      'scope',
      scopeKey,
      effectivePartition,
      dataUpdatedAt,
    ] as const,
    queryFn: async () => {
      if (!data?.report) {
        return { rows: data?.rows ?? [], artisanalStrapRows: data?.artisanalStrapRows ?? [] };
      }
      const partitionOpts = effectivePartition === 'order_reference'
        ? { partition: 'order_reference' as const, ...data.identity }
        : undefined;
      // Consolidado sem filtro de item: reusa as rows já materializadas no load.
      if (!hasItemFilter && effectivePartition === 'none') {
        return { rows: data.rows, artisanalStrapRows: data.artisanalStrapRows };
      }
      return materializePvConsumptionScope(data.report, selectedItemIds, partitionOpts);
    },
    enabled: !!data?.report || (!!data && !hasItemFilter && effectivePartition === 'none'),
    staleTime: PV_CONSUMPTION_STALE_MS,
  });

  const rows = scopedQuery.data?.rows ?? data?.rows ?? [];
  const artisanalStrapRows = scopedQuery.data?.artisanalStrapRows
    ?? data?.artisanalStrapRows
    ?? [];
  const orderHeaders = data?.orderHeaders ?? [];

  const singlePv = ids.length === 1 ? ids[0] : null;
  const singlePvNumber = singlePv ? (orderHeaders[0]?.order_number ?? '') : '';
  const multiPv = ids.length > 1;

  const itemOptions = useMemo(
    () => items.map((item: PvConsumptionItem) => ({
      id: item.id,
      label: pvConsumptionItemLabel(item, { multiPv }),
    })),
    [items, multiPv],
  );

  const scopeLoading = scopedQuery.isLoading && !scopedQuery.data
    && (hasItemFilter || effectivePartition === 'order_reference');

  return (
    <MaterialConsumptionView
      rows={rows}
      artisanalStrapRows={artisanalStrapRows}
      title={singlePvNumber ? `Consumo de Materiais — ${singlePvNumber}` : 'Consumo Consolidado'}
      orderHeaders={singlePv ? undefined : orderHeaders}
      loading={(isLoading && !data) || scopeLoading}
      onRecalcular={() => { void refetch(); }}
      onGerarOC={onGerarOC}
      emptyMessage={
        error
          ? `Erro ao carregar consumo: ${error instanceof Error ? error.message : 'tente de novo.'}`
          : singlePv
            ? 'Nenhum consumo de material encontrado para este pedido.'
            : 'Nenhum consumo de material encontrado para os pedidos selecionados.'
      }
      extraSections={
        singlePv && singlePvNumber
          ? <UpperCutOutsourcingSection saleOrderId={singlePv} orderNumber={singlePvNumber} />
          : null
      }
      embedded={embedded}
      itemOptions={itemOptions}
      selectedItemIds={selectedItemIds}
      onSelectedItemIdsChange={setSelectedItemIds}
      canPartition={canPartition}
      partitionMode={effectivePartition}
      onPartitionModeChange={setPartitionMode}
    />
  );
}
