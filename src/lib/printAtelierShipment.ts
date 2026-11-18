/**
 * Papel da remessa do Ateliê. Reusa o recibo da OS (sem preço na folha).
 */
import { supabase } from '@/integrations/supabase/client';
import { printServiceOrderReceipt, type ReceiptItem } from '@/lib/printServiceOrderReceipt';

export async function printAtelierShipment(serviceOrderId: string) {
  const { data: order, error } = await supabase
    .from('service_orders')
    .select('id, order_number, description, service_date, quantity, notes, target_sector, contractor_id')
    .eq('id', serviceOrderId)
    .single();
  if (error) throw error;

  const { data: lines, error: lineError } = await supabase
    .from('service_order_items')
    .select('material_name, description, color, quantity')
    .eq('service_order_id', serviceOrderId);
  if (lineError) throw lineError;

  const { data: contractor } = await supabase
    .from('contractors')
    .select('name, trade_name, cnpj_cpf, phone')
    .eq('id', order.contractor_id)
    .maybeSingle();

  const items: ReceiptItem[] = (lines ?? []).map((line) => ({
    ref_code: line.material_name,
    ref_name: line.description,
    color: line.color,
    pairs: Number(line.quantity) || 0,
  }));

  printServiceOrderReceipt(
    {
      id: order.id,
      order_number: order.order_number,
      description: order.description,
      service_date: order.service_date,
      quantity: Number(order.quantity) || 0,
      notes: order.notes,
      target_sector: order.target_sector,
    },
    contractor ?? undefined,
    { items },
  );
}
