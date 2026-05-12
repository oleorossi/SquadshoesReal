import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Warning as AlertTriangle, Package } from '@phosphor-icons/react';
import { usePackagingAlerts } from '@/hooks/usePackaging';
import { Skeleton } from '@/components/ui/skeleton';

export default function PackagingAlerts() {
  const { data: alerts = [], isLoading } = usePackagingAlerts();

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Alertas de Estoque de Embalagens
          {alerts.length > 0 && (
            <Badge variant="destructive" className="ml-2">{alerts.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">
              Nenhum alerta de estoque de embalagens no momento.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((box: any) => {
              const qty = Number(box.quantity || 0);
              const minStock = Number(box.min_stock || 0);
              const deficit = minStock - qty;
              return (
                <div key={box.id} className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{box.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {box.interno ? 'Individual' : 'Master'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono">
                      <span className="text-destructive font-semibold">{qty}</span>
                      <span className="text-muted-foreground"> / {minStock} mín</span>
                    </p>
                    <p className="text-xs text-destructive">
                      Faltam {deficit > 0 ? deficit : 0} unidades
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
