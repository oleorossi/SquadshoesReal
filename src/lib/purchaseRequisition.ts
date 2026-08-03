import { supabase } from '@/integrations/supabase/client';

export interface RequisitionItem {
  materialId: string;
  materialName: string;
  materialSku: string;
  quantityNeeded: number;
  quantityToBuy: number;
  stockAvailable: number;
  unit: string;
  unitPrice: number;
  totalCost: number;
}

export interface PurchaseRequisition {
  orderId: string;
  orderNumber: string;
  totalPairs: number;
  items: RequisitionItem[];
  totalCost: number;
  generatedAt: string;
}

/**
 * Generates a purchase requisition list for a production order based on
 * the technical sheet's BOM and current inventory levels.
 */
export async function generatePurchaseRequisition(
  orderId: string,
  orderNumber: string,
  referenceId: string,
  totalPairs: number
): Promise<PurchaseRequisition> {
  // 1. Fetch the technical sheet for this reference
  const sheetQuery = supabase
    .from('technical_sheets' as any)
    .select('id')
    .eq('reference_id', referenceId)
    .limit(1)
    .maybeSingle();
  const { data: sheet } = await sheetQuery as { data: { id: string } | null };

  if (!sheet) {
    return {
      orderId,
      orderNumber,
      totalPairs,
      items: [],
      totalCost: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  // 2. Get the component sheets linked to materials in the BOM
  const { data: bomEntries = [] } = await supabase
    .from('bill_of_materials')
    .select('material_id, quantity_required')
    .eq('master_id', sheet.id);

  if (bomEntries.length === 0) {
    return {
      orderId,
      orderNumber,
      totalPairs,
      items: [],
      totalCost: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  // 3. Get the material details + component sheet waste data
  const materialIds = bomEntries.map(b => b.material_id).filter(Boolean) as string[];

  const { data: materials = [] } = await supabase
    .from('products')
    .select('id, name, sku, quantity, unit, unit_price, reserved_stock, safety_stock')
    .in('id', materialIds);

  const materialMap = new Map(materials.map(m => [m.id, m]));

  // 4. Calculate needs
  const requisitionItems: RequisitionItem[] = [];

  for (const bom of bomEntries) {
    if (!bom.material_id) continue;
    const material = materialMap.get(bom.material_id);
    if (!material) continue;

    const needed = (bom.quantity_required ?? 0) * totalPairs;

    const available = Math.max(
      0,
      (Number(material.quantity) || 0) -
        (Number(material.reserved_stock) || 0) -
        (Number(material.safety_stock) || 0)
    );

    const quantityToBuy = Math.max(0, needed - available);

    if (quantityToBuy > 0) {
      requisitionItems.push({
        materialId: material.id,
        materialName: material.name,
        materialSku: material.sku,
        quantityNeeded: needed,
        quantityToBuy,
        stockAvailable: available,
        unit: material.unit,
        unitPrice: Number(material.unit_price) || 0,
        totalCost: quantityToBuy * (Number(material.unit_price) || 0),
      });
    }
  }

  return {
    orderId,
    orderNumber,
    totalPairs,
    items: requisitionItems,
    totalCost: requisitionItems.reduce((sum, i) => sum + i.totalCost, 0),
    generatedAt: new Date().toISOString(),
  };
}
