import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import UpperCutOutsourcingSection from '@/components/sale-orders/UpperCutOutsourcingSection';
import {
  loadPvConsumption,
  materializePvConsumptionScope,
  normalizePvConsumptionIds,
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
 * detalhe do PV ajuda a mesma aba; nova aba sempre busca de novo).
 *
 * 07/09/2026: filtro por item do PV (`?item=`) reescopa o report canônico
 * (solado + materiais + tiras) sem nova RPC.
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
  const selectedItemId = useMemo(() => {
    if (!itemParam) return null;
    return items.some((item) => item.id === itemParam) ? itemParam : null;
  }, [itemParam, items]);

  // Item inválido/ausente na URL → limpa pra não ficar um filtro fantasma.
  useEffect(() => {
    if (!itemParam) return;
    if (isLoading && !data) return;
    if (items.some((item) => item.id === itemParam)) return;
    const next = new URLSearchParams(searchParams);
    next.delete('item');
    setSearchParams(next, { replace: true });
  }, [itemParam, items, isLoading, data, searchParams, setSearchParams]);

  const setSelectedItemId = (nextId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (nextId) next.set('item', nextId);
    else next.delete('item');
    setSearchParams(next, { replace: true });
  };

  const scopedQuery = useQuery({
    // dataUpdatedAt invalida o escopo quando "Recalcular" refresca o report.
    queryKey: [...pvConsumptionQueryKey(ids), 'scope', selectedItemId ?? 'all', dataUpdatedAt] as const,
    queryFn: async () => {
      if (!data?.report) return { rows: data?.rows ?? [], artisanalStrapRows: data?.artisanalStrapRows ?? [] };
      if (!selectedItemId) {
        return { rows: data.rows, artisanalStrapRows: data.artisanalStrapRows };
      }
      return materializePvConsumptionScope(data.report, selectedItemId);
    },
    enabled: !!data?.report || (!!data && !selectedItemId),
    staleTime: PV_CONSUMPTION_STALE_MS,
  });

  const rows = selectedItemId
    ? (scopedQuery.data?.rows ?? [])
    : (data?.rows ?? []);
  const artisanalStrapRows = selectedItemId
    ? (scopedQuery.data?.artisanalStrapRows ?? [])
    : (data?.artisanalStrapRows ?? []);
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

  const scopeLoading = !!selectedItemId && scopedQuery.isLoading && !scopedQuery.data;

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
      selectedItemId={selectedItemId}
      onSelectedItemIdChange={setSelectedItemId}
    />
  );
}
