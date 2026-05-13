import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Truck, Package, Tag, NavigationArrow as Navigation, ArrowRight, Cube as Box, Buildings as Building2, MapPin, Warning as AlertTriangle, Scales as Weight, Ruler, Users, ClipboardText as ClipboardList, Clock, CheckCircle as CheckCircle2, XCircle, CalendarBlank as CalendarClock, TrendUp as TrendingUp, Package as PackageCheck } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useExpedicaoStats, PendingOrderItem } from '@/hooks/useExpedicaoStats';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export default function ExpedicaoHub() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useExpedicaoStats();

  const sections = [
    {
      title: 'Conferência',
      route: '/conferencia-saida',
      icon: PackageCheck,
      color: 'bg-primary/10 text-primary',
      kpis: [
        { label: 'Prontos p/ Expedir', value: stats?.pendingOrders ?? '-' },
        { label: 'Pares a Expedir', value: stats?.pendingPairs?.toLocaleString('pt-BR') ?? '-' },
        { label: 'Atrasados', value: stats?.overdueOrders ?? 0, alert: (stats?.overdueOrders ?? 0) > 0 },
        { label: 'Vencem Hoje', value: stats?.dueTodayOrders ?? 0, alert: (stats?.dueTodayOrders ?? 0) > 0 },
      ],
      step: 1,
    },
    {
      title: 'Embalagens',
      route: '/transporte?tab=packaging',
      icon: Package,
      color: 'bg-orange-500/10 text-orange-600',
      kpis: [
        { label: 'Tipos de Caixa', value: stats?.totalBoxTypes ?? '-' },
        { label: 'Estoque Total', value: stats?.totalBoxStock ?? '-' },
        { label: 'Alertas Estoque', value: stats?.lowStockAlerts ?? 0, alert: (stats?.lowStockAlerts ?? 0) > 0 },
        { label: 'Sem Fornecedor', value: stats?.boxTypesWithoutSupplier ?? 0, alert: (stats?.boxTypesWithoutSupplier ?? 0) > 0 },
      ],
      step: 2,
    },
    {
      title: 'Etiquetas',
      route: '/labels',
      icon: Tag,
      color: 'bg-violet-500/10 text-violet-600',
      kpis: [
        { label: 'Pedidos Prontos', value: stats?.pendingOrders ?? '-' },
        { label: 'Pares p/ Etiquetar', value: stats?.pendingPairs?.toLocaleString('pt-BR') ?? '-' },
      ],
      step: 3,
    },
    {
      title: 'Transporte',
      route: '/transporte',
      icon: Truck,
      color: 'bg-blue-500/10 text-blue-600',
      kpis: [
        { label: 'Baús Cadastrados', value: stats?.totalBaus ?? '-' },
        { label: 'Transportadoras', value: stats?.totalTransportadoras ?? '-' },
        { label: 'Capacidade Total', value: `${stats?.totalCapacidadeM3 ?? 0} m³` },
      ],
      step: 4,
    },
    {
      title: 'Rota de Entrega',
      route: '/transporte?tab=routes',
      icon: Navigation,
      color: 'bg-emerald-500/10 text-emerald-600',
      kpis: [
        { label: 'Clientes c/ Entrega', value: stats?.clientesComEntrega ?? '-' },
        { label: 'Pedidos Prontos', value: stats?.pendingOrders ?? '-' },
      ],
      step: 5,
    },
  ];

  return (
    <div className="space-y-5 page-enter">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Truck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Expedição</h1>
          <p className="text-muted-foreground text-sm">
            Centro integrado — embalagens, transporte e entrega
          </p>
        </div>
      </div>

      {/* Summary KPI strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            icon={<ClipboardList className="h-4 w-4" />}
            label="Pedidos p/ Expedir"
            value={stats.pendingOrders}
          />
          <SummaryCard
            icon={<Box className="h-4 w-4" />}
            label="Pares a Expedir"
            value={stats.pendingPairs.toLocaleString('pt-BR')}
          />
          <SummaryCard
            icon={<XCircle className="h-4 w-4" />}
            label="Atrasados"
            value={stats.overdueOrders}
            variant={stats.overdueOrders > 0 ? 'danger' : 'default'}
          />
          <SummaryCard
            icon={<CalendarClock className="h-4 w-4" />}
            label="Vencem Hoje"
            value={stats.dueTodayOrders}
            variant={stats.dueTodayOrders > 0 ? 'warning' : 'default'}
          />
        </div>
      )}

      {/* Capacity utilization bar */}
      {!isLoading && stats && stats.totalCapacidadeM3 > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Ocupação da Frota
              </span>
              <span className="text-sm text-muted-foreground">
                {stats.estimatedVolumeM3} m³ / {stats.totalCapacidadeM3} m³ ·{' '}
                {stats.estimatedWeightKg.toLocaleString('pt-BR')} kg estimados
              </span>
            </div>
            <Progress
              value={Math.min((stats.estimatedVolumeM3 / stats.totalCapacidadeM3) * 100, 100)}
              className="h-2.5"
            />
            {stats.estimatedVolumeM3 > stats.totalCapacidadeM3 && (
              <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Volume excede a capacidade da frota — múltiplas viagens ou terceirização necessária
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Flow indicator */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1 flex-wrap">
        {sections.map((s, i) => (
          <span key={s.title} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
            <Badge variant="outline" className="text-xs gap-1">
              <s.icon className="h-3 w-3" />
              {s.title}
            </Badge>
          </span>
        ))}
      </div>

      {/* Section cards with KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Card
              key={section.title}
              className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200 group"
              onClick={() => navigate(section.route)}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${section.color} shrink-0`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Etapa {section.step}
                      </Badge>
                      <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                        {section.title}
                      </h3>
                    </div>

                    {isLoading ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {section.kpis.map((kpi) => (
                          <div key={kpi.label} className="p-2 rounded-md bg-muted/50">
                            <p className="text-[10px] text-muted-foreground leading-tight">{kpi.label}</p>
                            <p className={`text-sm font-bold ${kpi.alert ? 'text-destructive' : ''}`}>
                              {kpi.alert && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                              {kpi.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all mt-1 shrink-0" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pending orders table */}
      {!isLoading && stats && stats.pendingOrdersList.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-foreground">Nenhum pedido pendente de expedição</p>
            <p className="text-sm text-muted-foreground">Todos os pedidos foram despachados ou ainda não há OPs prontas.</p>
          </CardContent>
        </Card>
      )}
      {!isLoading && stats && stats.pendingOrdersList.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Pedidos Pendentes de Expedição
              {stats.overdueOrders > 0 && (
                <Badge variant="destructive" className="text-[10px] gap-1 py-0">
                  <XCircle className="h-2.5 w-2.5" />
                  {stats.overdueOrders} atrasado{stats.overdueOrders !== 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pares</TableHead>
                  <TableHead>Embalagem</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="text-right pr-4">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.pendingOrdersList.slice(0, 15).map((order) => (
                  <OrderRow key={order.id} order={order} onSimulate={() => navigate('/transporte?tab=simulator')} />
                ))}
              </TableBody>
            </Table>
            {stats.pendingOrdersList.length > 15 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                Exibindo 15 de {stats.pendingOrdersList.length} pedidos
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OrderRow({ order, onSimulate }: { order: PendingOrderItem; onSimulate: () => void }) {
  const days = order.daysUntilDeadline;
  const isOverdue = days !== null && days < 0;
  const isDueToday = days === 0;
  const isDueSoon = days !== null && days > 0 && days <= 3;

  function deadlineLabel() {
    if (!order.delivery_deadline) return null;
    const fmt = format(new Date(order.delivery_deadline + 'T00:00:00'), 'dd/MM/yy', { locale: ptBR });
    if (isOverdue) return `${fmt} (${Math.abs(days!)}d atraso)`;
    if (isDueToday) return `Hoje (${fmt})`;
    if (isDueSoon) return `${fmt} (${days}d)`;
    return fmt;
  }

  return (
    <TableRow
      className={cn(
        'transition-colors',
        isOverdue && 'bg-destructive/5 hover:bg-destructive/10',
        isDueToday && 'bg-amber-500/5 hover:bg-amber-500/10',
      )}
    >
      <TableCell className="pl-4 font-mono text-sm font-semibold">{order.order_number}</TableCell>
      <TableCell className="max-w-[180px] truncate">{order.client_name}</TableCell>
      <TableCell className="font-mono tabular-nums">{order.total_pairs > 0 ? order.total_pairs : '—'}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px]">
          {order.packaging_mode || 'Não definido'}
        </Badge>
      </TableCell>
      <TableCell>
        {order.delivery_deadline ? (
          <span
            className={cn(
              'text-sm font-medium flex items-center gap-1',
              isOverdue ? 'text-destructive' : isDueToday ? 'text-amber-600' : isDueSoon ? 'text-amber-500' : 'text-muted-foreground',
            )}
          >
            {isOverdue && <XCircle className="h-3 w-3 shrink-0" />}
            {isDueToday && <Clock className="h-3 w-3 shrink-0" />}
            {isDueSoon && !isDueToday && <AlertTriangle className="h-3 w-3 shrink-0" />}
            {deadlineLabel()}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </TableCell>
      <TableCell className="text-right pr-4">
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onSimulate();
          }}
        >
          <Truck className="h-4 w-4 mr-1" />
          Simular
        </Button>
      </TableCell>
    </TableRow>
  );
}

type SummaryVariant = 'default' | 'danger' | 'warning';

function SummaryCard({
  icon, label, value, variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  variant?: SummaryVariant;
}) {
  const iconBg =
    variant === 'danger'
      ? 'bg-destructive/10 text-destructive'
      : variant === 'warning'
      ? 'bg-amber-500/10 text-amber-600'
      : 'bg-primary/10 text-primary';

  const valueCls =
    variant === 'danger'
      ? 'text-destructive'
      : variant === 'warning'
      ? 'text-amber-600'
      : '';

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', iconBg)}>{icon}</div>
        <div>
          <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
          <p className={cn('text-lg font-bold', valueCls)}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
