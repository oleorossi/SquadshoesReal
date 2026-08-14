import {
  CheckCircle as CheckCircle2,
  Clock,
  CurrencyDollar as DollarSign,
  Truck,
  Users,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';

import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';

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

function SummaryLine({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border/70 py-2.5 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

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
  return (
    <section aria-label="Resumo operacional da terceirização" className="grid gap-2.5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          icon={AlertTriangle}
          label="Atrasadas"
          value={integer.format(overdueOrders)}
          unit="OS"
          hint={overdueOrders > 0 ? 'abrir fila crítica' : 'nenhuma vencida'}
          tone={overdueOrders > 0 ? 'destructive' : 'default'}
          onClick={() => onFilter('atrasados')}
        />
        <StatCard
          icon={Truck}
          label="Na rua"
          value={integer.format(inFieldOrders)}
          unit="OS"
          hint={`${integer.format(inFieldPairs)} pares em campo`}
          onClick={() => onFilter('na_rua')}
        />
        <StatCard
          icon={Clock}
          label="Pendentes"
          value={integer.format(pendingOrders)}
          unit="OS"
          hint={`${integer.format(inProgressOrders)} em andamento`}
          tone={pendingOrders > 0 ? 'warning' : 'default'}
          onClick={() => onFilter('Pendente')}
        />
        <StatCard
          icon={DollarSign}
          label="A pagar"
          value={currency.format(amountDue)}
          hint={`${integer.format(amountDueOrders)} ${amountDueOrders === 1 ? 'OS aberta' : 'OS abertas'}`}
          tone={amountDue > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className={cn('overflow-hidden rounded-lg border border-border bg-card', 'xl:min-h-full')}>
        <div className="border-b border-border px-3.5 py-2.5">
          <p className="section-label">Resumo do setor</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Base histórica e estrutura disponível</p>
        </div>
        <div className="px-3.5">
          <SummaryLine
            icon={Users}
            label="Prestadores ativos"
            value={integer.format(activeContractors)}
            hint={`${integer.format(totalContractors)} cadastrados`}
          />
          <SummaryLine
            icon={CheckCircle2}
            label="OS concluídas"
            value={integer.format(completedOrders)}
            hint="histórico acumulado"
          />
          <SummaryLine
            icon={DollarSign}
            label="Valor das OS"
            value={currency.format(totalValue)}
            hint="não canceladas"
          />
        </div>
      </div>
    </section>
  );
}
