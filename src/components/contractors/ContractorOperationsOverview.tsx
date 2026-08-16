import {
  CheckCircle as CheckCircle2,
  Clock,
  CurrencyDollar as DollarSign,
  Truck,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';

import { ContractorSummaryRail } from '@/components/contractors/ContractorSummaryRail';

interface Props {
  overdueOrders: number;
  inFieldOrders: number;
  inFieldPairs: number;
  pendingOrders: number;
  inProgressOrders: number;
  amountDue: number;
  amountDueOrders: number;
  completedOrders: number;
  totalValue: number;
  activeContractors: number;
  totalContractors: number;
  onFilter: (filter: 'atrasados' | 'na_rua' | 'Pendente') => void;
}

const integer = new Intl.NumberFormat('pt-BR');
const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

/**
 * Posto de expedição externa: leitura da esquerda para a direita do material que
 * está em campo até o retorno e a obrigação financeira.
 */
export function ContractorOperationsOverview({
  overdueOrders,
  inFieldOrders,
  inFieldPairs,
  pendingOrders,
  inProgressOrders,
  amountDue,
  amountDueOrders,
  completedOrders,
  totalValue,
  activeContractors,
  totalContractors,
  onFilter,
}: Props) {
  const activeRatio = totalContractors > 0 ? (activeContractors / totalContractors) * 100 : 0;

  return (
    <ContractorSummaryRail
      ariaLabel="Posto de expedição externa"
      lead={{
        label: 'Em campo agora',
        value: integer.format(inFieldOrders),
        hint: `${integer.format(inFieldPairs)} pares fora da fábrica`,
        meta: `${integer.format(inProgressOrders)} em processamento · ${integer.format(activeContractors)}/${integer.format(totalContractors)} prestadores ativos`,
        icon: Truck,
        progress: activeRatio,
        onClick: () => onFilter('na_rua'),
      }}
      metrics={[
        {
          label: 'Fila crítica',
          value: integer.format(overdueOrders),
          hint: overdueOrders > 0 ? 'OS com prazo vencido' : 'nenhum retorno vencido',
          icon: AlertTriangle,
          tone: overdueOrders > 0 ? 'destructive' : 'default',
          onClick: () => onFilter('atrasados'),
        },
        {
          label: 'A liberar',
          value: integer.format(pendingOrders),
          hint: 'OS aguardando despacho',
          icon: Clock,
          tone: pendingOrders > 0 ? 'warning' : 'default',
          onClick: () => onFilter('Pendente'),
        },
        {
          label: 'Recebidas',
          value: integer.format(completedOrders),
          hint: `${currency.format(totalValue)} no histórico`,
          icon: CheckCircle2,
          tone: 'success',
        },
        {
          label: 'A pagar',
          value: currency.format(amountDue),
          hint: `${integer.format(amountDueOrders)} ${amountDueOrders === 1 ? 'OS aberta' : 'OS abertas'}`,
          icon: DollarSign,
          tone: amountDue > 0 ? 'warning' : 'default',
        },
      ]}
    />
  );
}
