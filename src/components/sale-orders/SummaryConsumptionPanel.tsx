import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import MaterialConsumptionView from '@/components/sale-orders/MaterialConsumptionView';
import UpperCutOutsourcingSection from '@/components/sale-orders/UpperCutOutsourcingSection';
import { loadPvConsumption, pvConsumptionQueryKey, PV_CONSUMPTION_STALE_MS } from '@/lib/pvConsumption';

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
 *
 * 22/08/2026: a carga mora em `loadPvConsumption` + React Query, pra o diálogo
 * do PV reaproveitar o prefetch feito ao abrir o detalhe (sem 2ª ida ao motor).
 */
type Props = {
  saleOrderIds: string[];
  /** Ação primária da tela (Gerar OC). Omitida ⇒ o botão não aparece. */
  onGerarOC?: () => void;
};

export default function SummaryConsumptionPanel({ saleOrderIds, onGerarOC }: Props) {
  const idsKey = useMemo(() => [...saleOrderIds].sort().join(','), [saleOrderIds]);
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: pvConsumptionQueryKey(ids),
    queryFn: () => loadPvConsumption(ids),
    enabled: ids.length > 0,
    staleTime: PV_CONSUMPTION_STALE_MS,
  });

  const rows = data?.rows ?? [];
  const artisanalStrapRows = data?.artisanalStrapRows ?? [];
  const orderHeaders = data?.orderHeaders ?? [];

  const singlePv = saleOrderIds.length === 1 ? saleOrderIds[0] : null;
  const singlePvNumber = singlePv ? (orderHeaders[0]?.order_number ?? '') : '';

  return (
    <MaterialConsumptionView
      rows={rows}
      artisanalStrapRows={artisanalStrapRows}
      title={singlePvNumber ? `Consumo de Materiais — ${singlePvNumber}` : 'Consumo Consolidado'}
      orderHeaders={singlePv ? undefined : orderHeaders}
      loading={isLoading && !data}
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
    />
  );
}
