import { useMaterialExplosion, type ExplodedMaterial } from '@/hooks/useMaterialExplosion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Scissors, Package as PackageCheck, Warning as AlertTriangle } from '@phosphor-icons/react';

interface OrderInput {
  pairsBySizes: Record<string, number>;
  specifications: {
    material: {
      id: string;
      name: string;
      color?: string;
      production_unit: string;
      purchase_unit: string;
      conversion_rate: number;
      image_url?: string;
      quantity?: number;
      reserved_stock?: number;
      safety_stock?: number;
    };
    baseConsumption: number;
    wastePct?: number;
  }[];
  sizeMultipliers?: Record<string, number>;
}

interface Props {
  selectedOrders: OrderInput[];
  onConfirmIssue?: (materials: ExplodedMaterial[]) => void;
  onPrintRequisition?: (materials: ExplodedMaterial[]) => void;
}

export function ExplosionPanel({ selectedOrders, onConfirmIssue, onPrintRequisition }: Props) {
  const materialsNeeded = useMaterialExplosion(selectedOrders);
  const allAvailable = materialsNeeded.every(m => m.hasEnough);

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="bg-primary/5 py-4">
          <CardTitle className="text-md flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            Explosão de Materiais para Separação
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-4 text-left">Insumo / Textura</th>
                <th className="p-4 text-right">Consumo Produção</th>
                <th className="p-4 text-right">Solicitar Almoxarifado</th>
                <th className="p-4 text-center">Status Estoque</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {materialsNeeded.map((mat) => (
                <tr key={mat.materialId} className="hover:bg-muted/30">
                  <td className="p-4 flex items-center gap-3">
                    {mat.imageUrl ? (
                      <img src={mat.imageUrl} className="h-10 w-10 rounded border object-cover" alt="textura" />
                    ) : (
                      <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground">—</div>
                    )}
                    <div>
                      <p className="font-bold text-foreground">{mat.name}</p>
                      <p className="text-xs text-muted-foreground uppercase">{mat.color}</p>
                    </div>
                  </td>
                  <td className="p-4 text-right font-mono text-foreground">
                    {mat.totalNeeded.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {mat.unit}
                  </td>
                  <td className="p-4 text-right">
                    <Badge variant="secondary" className="text-sm font-bold">
                      {mat.inPurchaseUnit.toFixed(2)} {mat.purchaseUnit}
                    </Badge>
                  </td>
                  <td className="p-4 text-center">
                    {mat.hasEnough ? (
                      <span className="text-xs text-primary font-bold uppercase flex items-center justify-center gap-1">
                        <PackageCheck className="h-3 w-3" /> Disponível
                      </span>
                    ) : (
                      <span className="text-xs text-destructive font-bold uppercase flex items-center justify-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Insuficiente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => onPrintRequisition?.(materialsNeeded)}>
          Imprimir Requisição Interna
        </Button>
        <Button
          disabled={!allAvailable}
          onClick={() => onConfirmIssue?.(materialsNeeded)}
        >
          Confirmar Baixa de Materiais
        </Button>
      </div>
    </div>
  );
}
