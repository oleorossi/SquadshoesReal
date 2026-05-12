import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { apiService } from '@/lib/apiService';
import { useProducts } from '@/hooks/useProducts';

export function NotificationsTab() {
  const { data: products = [] } = useProducts();
  
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard_notifications'],
    queryFn: () => apiService.getDashboardNotifications(),
  });

  const productsArr = Array.isArray(products) ? products : [];
  const zeroStockItems = useMemo(() =>
    productsArr.filter(p => p.quantity === 0 && p.active),
    [productsArr]
  );

  // Exclude zero-stock items to avoid double-counting (they appear in zeroStockItems)
  const lowStockItems = useMemo(() =>
    productsArr.filter(p => p.quantity > 0 && p.quantity <= p.min_stock && p.active).sort((a, b) => a.quantity - b.quantity),
    [productsArr]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary opacity-50" />
      </div>
    );
  }

  const totalNotifications = zeroStockItems.length + lowStockItems.length + 
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
              <Badge variant="destructive" className="text-[10px]">{zeroStockItems.length}</Badge>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {zeroStockItems.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {p.color && <span className="text-muted-foreground ml-1">({p.color})</span>}
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono">{p.sku}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStockItems.length > 0 && (
        <Card className="border-amber-500/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="font-semibold text-sm text-amber-500">Estoque Baixo</span>
              <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">{lowStockItems.length}</Badge>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {lowStockItems.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {p.color && <span className="text-muted-foreground ml-1">({p.color})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{p.quantity} {p.unit}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{p.sku}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
