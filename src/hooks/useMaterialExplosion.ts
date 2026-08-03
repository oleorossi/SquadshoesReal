import { useMemo } from 'react';
import { calculateGradedConsumption } from '@/lib/inventoryIntelligence';
import { resolveConversionFactors } from '@/lib/unitConversion';

interface SpecificationItem {
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
}

interface OrderInput {
  pairsBySizes: Record<string, number>;
  specifications: SpecificationItem[];
  sizeMultipliers?: Record<string, number>;
}

export interface ExplodedMaterial {
  materialId: string;
  name: string;
  color: string;
  totalNeeded: number;
  unit: string;
  inPurchaseUnit: number;
  purchaseUnit: string;
  imageUrl: string;
  physicalStock: number;
  availableStock: number;
  hasEnough: boolean;
}

export function useMaterialExplosion(selectedOrders: OrderInput[]) {
  return useMemo(() => {
    const explosion: Record<string, ExplodedMaterial> = {};

    selectedOrders.forEach(order => {
      order.specifications.forEach(spec => {
        const material = spec.material;
        const { totalNeeded } = calculateGradedConsumption(
          spec.baseConsumption,
          order.pairsBySizes,
          order.sizeMultipliers
        );

        if (!explosion[material.id]) {
          // Use unified conversion to determine if stock needs to be converted to production_unit
          const { needToStockDivisor } = resolveConversionFactors(
            material.production_unit,
            material.purchase_unit,  // stock unit (material.quantity is in purchase/stock unit)
            material.purchase_unit,
            material.conversion_rate,
          );
          const physicalPurchase = material.quantity ?? 0;
          const reservedPurchase = material.reserved_stock ?? 0;
          const safetyPurchase = material.safety_stock ?? 0;
          // Convert stock to production_unit: stock * needToStockDivisor
          // (needToStockDivisor = convRate when production≠stock, 1 when same)
          const physical = physicalPurchase * needToStockDivisor;
          const reserved = reservedPurchase * needToStockDivisor;
          const safety = safetyPurchase * needToStockDivisor;
          const available = Math.max(0, physical - reserved - safety);

          explosion[material.id] = {
            materialId: material.id,
            name: material.name,
            color: material.color ?? '',
            totalNeeded: 0,
            unit: material.production_unit,
            inPurchaseUnit: 0,
            purchaseUnit: material.purchase_unit,
            imageUrl: material.image_url ?? '',
            physicalStock: physical,                               // in production_unit
            availableStock: available,                             // in production_unit
            hasEnough: true,
          };
        }

        explosion[material.id].totalNeeded += totalNeeded;
        // Convert needed (production_unit) → purchase_unit using the same divisor
        const { needToStockDivisor: divisor } = resolveConversionFactors(
          material.production_unit,
          material.purchase_unit,
          material.purchase_unit,
          material.conversion_rate,
        );
        explosion[material.id].inPurchaseUnit = explosion[material.id].totalNeeded / divisor;
        explosion[material.id].hasEnough = explosion[material.id].availableStock >= explosion[material.id].totalNeeded;
      });
    });

    return Object.values(explosion);
  }, [selectedOrders]);
}
