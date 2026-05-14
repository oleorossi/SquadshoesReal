import { supabase } from '@/integrations/supabase/client';

export interface MaterialAutoOSResult {
  soNumber: string;
  contractorName: string;
  accumulated: boolean;
}

/**
 * When an ARTISANAL material is insufficient for an order (detected by
 * check_stock_availability at PV approval), creates — or accumulates into —
 * a Service Order (OS) to the contractor that produces that artisanal material.
 *
 * Espelha autoCreateMaterialPO, mas pra produtos is_artisanal=true: em vez de
 * comprar de fornecedor, a quantidade que falta é terceirizada a um contratado.
 *
 * Convenção do nome do produto artesanal: "Grupo: Cor" (ex.: "Tira Overlock 5mm: Dália").
 * Acumulação: se já existe uma OS 'Pendente' pro mesmo output (nome + cor), a
 * nova demanda é somada nela — assim uma OS por material/cor fica aberta.
 */
export async function autoCreateMaterialOS(params: {
  productId: string;
  productName: string;
  shortageQty: number;
  orderRef: string;
  saleOrderId: string;
}): Promise<MaterialAutoOSResult | null> {
  const { productId, productName, shortageQty, orderRef, saleOrderId } = params;
  if (shortageQty <= 0) return null;

  // ── Step 1: produto + confirma que é artesanal ───────────────────────────
  const { data: product } = await supabase
    .from('products')
    .select('id, name, unit_price, is_artisanal')
    .eq('id', productId)
    .maybeSingle();
  if (!product || !(product as any).is_artisanal) return null;

  const unitPrice = Number(product.unit_price) || 0;
  const groupName = (product.name || '').split(':')[0]?.trim() || product.name || '';
  const colorName = (product.name || '').split(':')[1]?.trim() || '';

  // ── Step 2: resolve receita + contratado ─────────────────────────────────
  const { data: recipe } = await (supabase as any)
    .from('artisanal_recipes')
    .select('id, default_contractor_id')
    .ilike('artisanal_product_name', `${groupName}%`)
    .limit(1)
    .maybeSingle();

  let contractorId: string | null = recipe?.default_contractor_id || null;
  if (!contractorId) {
    const { data: anyContractor } = await (supabase as any)
      .from('contractors')
      .select('id')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    contractorId = anyContractor?.id || null;
  }
  if (!contractorId) return null; // sem contratado não dá pra abrir OS

  const { data: contractor } = await (supabase as any)
    .from('contractors')
    .select('name')
    .eq('id', contractorId)
    .maybeSingle();
  const contractorName = contractor?.name || 'Contratado';

  const appendNote = `\nFalta de "${productName}" para PV ${orderRef} — faltam ${shortageQty}`;

  // ── Step 3: acumula numa OS 'Pendente' do mesmo output ───────────────────
  const { data: openOS } = await (supabase as any)
    .from('service_orders')
    .select('id, order_number, quantity, unit_price, artisanal_output_meters, artisanal_for_order_meters, linked_sale_order_ids, notes')
    .eq('artisanal_output_name', groupName)
    .eq('artisanal_output_color', colorName)
    .eq('status', 'Pendente')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openOS) {
    const newQty = Number(openOS.quantity || 0) + Math.ceil(shortageQty);
    const linked: string[] = Array.isArray(openOS.linked_sale_order_ids) ? openOS.linked_sale_order_ids : [];
    if (!linked.includes(saleOrderId)) linked.push(saleOrderId);
    const { error } = await (supabase as any)
      .from('service_orders')
      .update({
        quantity: newQty,
        total_value: newQty * Number(openOS.unit_price || unitPrice),
        artisanal_output_meters: Number(openOS.artisanal_output_meters || 0) + shortageQty,
        artisanal_for_order_meters: Number(openOS.artisanal_for_order_meters || 0) + shortageQty,
        linked_sale_order_ids: linked,
        notes: (openOS.notes || '') + appendNote,
      })
      .eq('id', openOS.id);
    if (error) throw new Error(`Falha ao acumular na OS ${openOS.order_number}: ${error.message}`);
    return { soNumber: openOS.order_number, contractorName, accumulated: true };
  }

  // ── Step 4: nenhuma OS aberta — cria nova ────────────────────────────────
  const qty = Math.ceil(shortageQty);
  const { data: os, error: osErr } = await (supabase as any)
    .from('service_orders')
    .insert({
      contractor_id: contractorId,
      description: `OS automática — Falta de "${productName}" para PV ${orderRef}`,
      quantity: qty,
      unit_price: unitPrice,
      total_value: qty * unitPrice,
      status: 'Pendente',
      notes: `Gerada automaticamente na aprovação do PV ${orderRef} — material artesanal insuficiente (faltam ${shortageQty}).`,
      artisanal_recipe_id: recipe?.id || null,
      artisanal_output_name: groupName,
      artisanal_output_color: colorName,
      artisanal_output_meters: shortageQty,
      artisanal_for_order_meters: shortageQty,
      artisanal_for_stock_meters: 0,
      sale_order_id: saleOrderId,
      linked_sale_order_ids: [saleOrderId],
    })
    .select('id, order_number')
    .single();

  if (osErr) throw new Error(`Falha ao criar OS para "${productName}": ${osErr.message}`);
  if (!os) return null;

  return { soNumber: os.order_number, contractorName, accumulated: false };
}
