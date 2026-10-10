import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Warning as AlertTriangle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { apiService } from '@/lib/apiService';
import { useProducts } from '@/hooks/useProducts';
import { isSoleProduct, isZeroStock } from '@/lib/stockAlerts';

export function NotificationsTab() {
  const { data: products = [] } = useProducts();
  
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard_notifications'],
    queryFn: () => apiService.getDashboardNotifications(),
  });

  // Solado vive em /solados (SolesHub) — gestão dedicada. Alertas de estoque
  // de solado não fazem sentido aqui porque eles são gerenciados por grade
  // (stock_grade) e não por scalar quantity. Filtra na fonte (PR 2026-05-23).
  const productsArr = (Array.isArray(products) ? products : []).filter(
    (p: any) => !isSoleProduct(p)
  );
  // Predicado vem de '@/lib/stockAlerts' — mesma fonte que o card "Estoque
  // Zerado" do Painel usa pra contar. Duplicar a regra aqui foi o que fez o
  // card mostrar 142 e esta lista 126 (05/08/2026). Estoque mínimo foi
  // removido (specs/remover-estoque-minimo.md): não há mais lista "baixo".
  const zeroStockItems = useMemo(() =>
    productsArr.filter(isZeroStock),
    [productsArr]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary opacity-50" />
      </div>
    );
  }

  const totalNotifications = zeroStockItems.length + 
    (dashboardData?.overduePayables?.length || 0) + 
    (dashboardData?.upcomingPayables?.length || 0) + 
    (dashboardData?.overdueSales?.length || 0) + 
    (dashboardData?.pendingOrders?.length || 0);

  if (totalNotifications === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Bell className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-lg font-medium">Tudo certo! 🎉</p>
        <p className="text-sm mt-1">Nenhuma notificação pendente no momento.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Central de Notificações</h3>
        <Badge variant="destructive" className="text-xs">{totalNotifications}</Badge>
      </div>

      {zeroStockItems.length > 0 && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-sm text-destructive">Estoque Zerado</span>
              <Badge variant="destructive" className="text-xs">{zeroStockItems.length}</Badge>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {zeroStockItems.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {p.color && <span className="text-muted-foreground ml-1">({p.color})</span>}
                  </div>
                  <Badge variant="outline" className="text-xs font-mono">{p.sku}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
