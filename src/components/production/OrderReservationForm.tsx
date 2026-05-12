import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Warning as AlertTriangle, CheckCircle, ShoppingCart } from '@phosphor-icons/react';
import {
  getAvailableToPromise,
  validateMaterialAvailability,
  calculateGradedConsumption,
  type ProductStock,
} from '@/lib/inventoryIntelligence';

interface MaterialItem {
  id: string;
  name: string;
  color?: string;
  production_unit: string;
  purchase_unit: string;
  purchase_order_unit: string;
  conversion_rate: number;
  quantity: number;
  reserved_stock: number;
  safety_stock: number;
  lead_time_days: number;
  min_order_quantity: number;
  unit_price: number;
}

interface Props {
  materials: {
    material: MaterialItem;
    baseConsumption: number;
  }[];
  pairsBySizes: Record<string, number>;
  sizeMultipliers?: Record<string, number>;
  wastePct?: number;
  onReserve?: (reservations: { materialId: string; quantity: number }[]) => void;
  disabled?: boolean;
}

export function OrderReservationForm({
  materials,
  pairsBySizes,
  sizeMultipliers,
  wastePct = 1.0,
  onReserve,
  disabled,
}: Props) {
  const totalPairs = Object.values(pairsBySizes).reduce((s, v) => s + (v || 0), 0);

  const validations = materials.map(({ material, baseConsumption }) => {
    const { totalNeeded } = calculateGradedConsumption(
      baseConsumption,
      pairsBySizes,
      sizeMultipliers,
      wastePct
    );

    const availability = validateMaterialAvailability(totalNeeded, material as ProductStock);
    const atp = getAvailableToPromise({
      physical: material.quantity,
      reserved: material.reserved_stock,
      safety: material.safety_stock,
    });

    return {
      material,
      totalNeeded,
      atp,
      availability,
    };
  });

  const allAvailable = validations.every(v => v.availability.hasStock);
  const hasMissing = validations.some(v => !v.availability.hasStock);

  const handleReserve = () => {
    if (!onReserve) return;
    const reservations = validations.map(v => ({
      materialId: v.material.id,
      quantity: v.totalNeeded,
    }));
    onReserve(reservations);
  };

  return (
    <div className="p-4 border rounded-xl space-y-4 bg-card">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-foreground">Validação de Insumos</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{totalPairs} pares</span>
          <Badge variant={allAvailable ? 'default' : 'destructive'} className="gap-1">
            {allAvailable ? (
              <><CheckCircle className="h-3 w-3" /> Materiais Disponíveis</>
            ) : (
              <><AlertTriangle className="h-3 w-3" /> Falta Material</>
            )}
          </Badge>
        </div>
      </div>

      <div className="space-y-3">
        {validations.map(({ material, totalNeeded, atp, availability }) => (
          <div
            key={material.id}
            className={`p-3 rounded-lg border ${
              availability.hasStock ? 'bg-muted/30 border-border' : 'bg-destructive/5 border-destructive/20'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-sm text-foreground">
                  {material.name} {material.color && <span className="text-muted-foreground">({material.color})</span>}
                </p>
                <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                  <span>Necessário: <span className="font-mono font-semibold text-foreground">{totalNeeded.toFixed(2)} {material.production_unit}</span></span>
                  <span>ATP: <span className={`font-mono font-semibold ${availability.hasStock ? 'text-primary' : 'text-destructive'}`}>{atp.toFixed(2)} {material.production_unit}</span></span>
                </div>
              </div>
              {availability.hasStock ? (
                <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              )}
            </div>

            {!availability.hasStock && (
              <div className="mt-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <p className="flex items-center gap-1">
                  <ShoppingCart className="h-3 w-3" />
                  <strong>Comprar:</strong>{' '}
                  {availability.suggestedPurchaseQty.toFixed(2)} {availability.suggestedPurchaseUnit}
                  {' '}(≈ R$ {availability.estimatedCost.toFixed(2)})
                </p>
                <p>
                  Prazo de entrega: <strong>{material.lead_time_days} dias</strong> — 
                  Previsão: {availability.suggestedOrderDate.toLocaleDateString('pt-BR')}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        disabled={disabled || hasMissing}
        className="w-full"
        onClick={handleReserve}
      >
        {allAvailable ? 'Confirmar e Reservar Materiais' : 'Materiais Insuficientes'}
      </Button>
    </div>
  );
}
