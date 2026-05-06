import { Package, Box, Link as LinkIcon, Calculator, AlertTriangle, Warehouse } from 'lucide-react';
import { StatsCard } from '@/components/inventory/StatsCard';
import { usePackagingStats } from '@/hooks/usePackaging';
import PackagingLinksPanel from '@/components/packaging/PackagingLinksPanel';
import PackagingAlerts from '@/components/packaging/PackagingAlerts';
import PackagingStockPanel from '@/components/packaging/PackagingStockPanel';
import { PackagingDecision } from '@/components/packaging/PackagingDecision';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const OrderPackagingDecision = () => {
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  const { data: orders = [] } = useQuery({
    queryKey: ['orders_for_packaging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          quantity,
          reference_id,
          sale_orders (
            packaging_mode,
            clients (
              accepts_bundled_packaging
            )
          )
        `)
        .not('sale_order_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selecionar pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pedido (OP)</Label>
              <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um pedido..." />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>
                      OP #{o.order_number} ({o.quantity} pares)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedOrder && (
        <PackagingDecision
          order={{
            reference: (selectedOrder as any).order_number,
            quantity: (selectedOrder as any).quantity,
            sheetId: (selectedOrder as any).reference_id,
            packagingMode: (selectedOrder as any).sale_orders?.packaging_mode || 'individual_amarrado',
            accepts_bundled_packaging:
              (selectedOrder as any).sale_orders?.clients?.accepts_bundled_packaging ?? true,
          }}
        />
      )}
    </div>
  );
};

const SECTIONS = [
  { id: 'stock', label: 'Cadastro & Estoque', icon: Warehouse },
  { id: 'links', label: 'Vínculos com fichas', icon: LinkIcon },
  { id: 'decision', label: 'Sugestão por pedido', icon: Calculator },
  { id: 'alerts', label: 'Alertas', icon: AlertTriangle },
];

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const PackagingManagementPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { data: stats, isLoading } = usePackagingStats();

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const alertsCount = stats?.low_stock_alerts ?? 0;

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Package className="h-8 w-8 text-primary" />
            Gestão de Embalagens
          </h1>
          <p className="text-muted-foreground mt-1">
            Cadastro, estoque, vínculos com fichas técnicas e sugestão automática por pedido.
          </p>
        </div>
      )}

      {/* Dashboard cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Embalagens Individuais"
          value={stats?.total_individual ?? 0}
          icon={Package}
          subtitle="Tipos cadastrados"
        />
        <StatsCard
          title="Caixas Master"
          value={stats?.total_master ?? 0}
          icon={Box}
          subtitle="Tipos cadastrados"
        />
        <StatsCard
          title="Vínculos com Fichas"
          value={stats?.total_linked_products ?? 0}
          icon={LinkIcon}
          subtitle="Embalagens vinculadas"
        />
        <StatsCard
          title="Alertas de Estoque"
          value={alertsCount}
          icon={AlertTriangle}
          variant={alertsCount > 0 ? 'warning' : 'default'}
          subtitle="Abaixo do mínimo"
        />
      </div>

      {/* Quick nav */}
      <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-background/80 backdrop-blur-sm border-b">
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Button
                key={s.id}
                variant="outline"
                size="sm"
                onClick={() => scrollTo(s.id)}
                className="gap-1.5"
              >
                <Icon className="h-4 w-4" />
                {s.label}
                {s.id === 'alerts' && alertsCount > 0 && (
                  <span className="ml-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                    {alertsCount > 99 ? '99+' : alertsCount}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Section: Cadastro & Estoque */}
      <section id="stock" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2 border-b pb-2">
          <Warehouse className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Cadastro & Estoque</h2>
        </div>
        <PackagingStockPanel />
      </section>

      {/* Section: Vínculos */}
      <section id="links" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2 border-b pb-2">
          <LinkIcon className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Vínculos com fichas técnicas</h2>
        </div>
        <PackagingLinksPanel />
      </section>

      {/* Section: Sugestão por pedido */}
      <section id="decision" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2 border-b pb-2">
          <Calculator className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Sugestão de embalagem por pedido</h2>
        </div>
        <OrderPackagingDecision />
      </section>

      {/* Section: Alertas */}
      <section id="alerts" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2 border-b pb-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-xl font-semibold">Alertas de estoque</h2>
          {alertsCount > 0 && (
            <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
              {alertsCount}
            </span>
          )}
        </div>
        <PackagingAlerts />
      </section>
    </div>
  );
};

export default PackagingManagementPage;
