import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cube as Box,
  Package,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePackagingAlerts } from '@/hooks/usePackaging';

function AlertSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {title}
          <Badge variant="outline" className="ml-auto border-warning/30 bg-warning/10 text-warning-foreground">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

export default function PackagingAlerts() {
  const navigate = useNavigate();
  const { data, isLoading } = usePackagingAlerts();

  if (isLoading) return <Skeleton className="h-72 w-full" />;

  const alerts = data ?? {
    lowStock: [],
    boxesWithoutPrice: [],
    boxesWithoutTare: [],
    incompleteSoles: [],
    sheetsWithoutSole: [],
  };
  const total = alerts.lowStock.length + alerts.boxesWithoutPrice.length + alerts.boxesWithoutTare.length
    + alerts.incompleteSoles.length + alerts.sheetsWithoutSole.length;

  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Package className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Nenhuma pendência de embalagem</p>
          <p className="text-xs text-muted-foreground">Estoque, cadastro e vínculos por solado estão completos.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <AlertSection title="Estoque abaixo do mínimo" count={alerts.lowStock.length}>
        {alerts.lowStock.map(box => (
          <div key={box.id} className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/5 p-3">
            <div>
              <p className="text-sm font-medium">{box.nome}</p>
              <p className="text-xs text-muted-foreground">{box.tipo ?? (box.interno ? 'individual' : 'master')}</p>
            </div>
            <div className="text-right font-mono text-xs">
              <p className="font-semibold">{Number(box.quantity || 0)} em estoque</p>
              <p className="text-muted-foreground">mínimo {Number(box.min_stock || 0)}</p>
            </div>
          </div>
        ))}
      </AlertSection>

      <AlertSection
        title="Cadastro de caixa incompleto"
        count={new Set([...alerts.boxesWithoutPrice, ...alerts.boxesWithoutTare].map(box => box.id)).size}
      >
        {Array.from(new Map(
          [...alerts.boxesWithoutPrice, ...alerts.boxesWithoutTare].map(box => [box.id, box] as const),
        ).values()).map(box => {
          const missing: string[] = [];
          if (!(Number(box.unit_price || 0) > 0)) missing.push('preço');
          if (!(Number(box.empty_weight_kg || 0) > 0)) missing.push('tara');
          return (
            <div key={box.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">{box.nome}</p>
              </div>
              <Badge variant="outline" className="text-xs">Sem {missing.join(' e ')}</Badge>
            </div>
          );
        })}
      </AlertSection>

      <AlertSection title="Tipos de solado incompletos" count={alerts.incompleteSoles.length}>
        {alerts.incompleteSoles.map(sole => {
          const missing = [
            !sole.modo_tradicional_ok && 'Tradicional',
            !sole.modo_amarrado_ok && 'Amarrado',
            !sole.modo_colmeia_ok && 'Colmeia',
          ].filter(Boolean).join(', ');
          return (
            <div key={sole.sole_group_id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{sole.solado}</p>
                <p className="text-xs text-muted-foreground">
                  {sole.fichas_afetadas} fichas · faltando: {missing}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={() => navigate(`/embalagens?tab=soles&soleGroupId=${sole.sole_group_id}`)}
              >
                Configurar
              </Button>
            </div>
          );
        })}
      </AlertSection>

      <AlertSection title="Fichas sem tipo de solado" count={alerts.sheetsWithoutSole.length}>
        {alerts.sheetsWithoutSole.slice(0, 30).map(sheet => (
          <div key={sheet.sheet_id} className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{sheet.ficha}</p>
              <p className="text-xs text-muted-foreground">{sheet.itens_pv} itens de pedido afetados</p>
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => navigate('/technical-sheets')}>
              Vincular solado
            </Button>
          </div>
        ))}
      </AlertSection>
    </div>
  );
}
