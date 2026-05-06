import { supabase } from '@/integrations/supabase/client';
import logoSquad from '@/assets/logo-squad-shoes.jpg';
import { getSignedUrl } from '@/lib/getSignedUrl';

/**
 * Resolve a SILK image URL for an order following the standard hierarchy:
 *   1. Cliente.silk_url
 *   2. Grupo Econômico.silk_url
 *   3. Solado (product_groups.silk_url, via ficha técnica → cor_solado_id → group)
 *   4. Logo Squad (fallback)
 *
 * Falls back to the client logo if no silk_url is found at any level (back-compat).
 */
export async function getClientLogoUrl(order: { sale_order_id?: string | null; reference_id?: string | null }): Promise<string> {
  const info = await getOrderSilkInfo(order);
  return info.silkUrl;
}

export async function getOrderSilkInfo(order: { sale_order_id?: string | null; reference_id?: string | null }): Promise<{ silkUrl: string; importantInfo: string }> {
  if (!order.sale_order_id) return { silkUrl: logoSquad, importantInfo: '' };

  try {
    const { data: saleOrder } = await supabase
      .from('sale_orders')
      .select('client_cnpj, client_name, client_id')
      .eq('id', order.sale_order_id)
      .maybeSingle();

    if (!saleOrder) return { silkUrl: logoSquad, importantInfo: '' };

    // ---------- LEVEL 1+2: Client / Group silk ----------
    let clientRow: { silk_url?: string | null; logo_url?: string | null; economic_group_id?: string | null; notes?: string | null } | null = null;

    if (saleOrder.client_cnpj) {
      const cleanCnpj = saleOrder.client_cnpj.replace(/\D/g, '');
      if (cleanCnpj.length > 0) {
        const { data } = await supabase
          .from('clients')
          .select('silk_url, logo_url, economic_group_id, notes')
          .or(`cnpj.eq.${saleOrder.client_cnpj},cnpj.eq.${cleanCnpj}`)
          .limit(1);
        if (data && data.length > 0) clientRow = data[0];
      }
    }

    if (!clientRow && saleOrder.client_name) {
      const { data } = await supabase
        .from('clients')
        .select('silk_url, logo_url, economic_group_id, notes')
        .or(`razao_social.eq.${saleOrder.client_name},nome_fantasia.eq.${saleOrder.client_name}`)
        .limit(1);
      if (data && data.length > 0) clientRow = data[0];
    }

    if (clientRow) {
      let silkUrl = '';
      let importantInfo = clientRow.notes || '';

      // 1. Client silk
      if (clientRow.silk_url) silkUrl = await getSignedUrl(clientRow.silk_url);

      // 2. Economic group silk
      if (clientRow.economic_group_id) {
        const { data: group } = await supabase
          .from('economic_groups')
          .select('silk_url, logo_url, important_info')
          .eq('id', clientRow.economic_group_id)
          .maybeSingle();
        if (group?.important_info) importantInfo = group.important_info + (importantInfo ? '\n' + importantInfo : '');
        if (!silkUrl && group?.silk_url) silkUrl = await getSignedUrl(group.silk_url);
        // back-compat: if no silk, try group logo
        if (!silkUrl && group?.logo_url) silkUrl = await getSignedUrl(group.logo_url);
      }

      // back-compat: if no silk, try client logo
      if (!silkUrl && clientRow.logo_url) silkUrl = await getSignedUrl(clientRow.logo_url);

      if (silkUrl) return { silkUrl, importantInfo };
    }

    // ---------- LEVEL 3: Sole silk (product_groups.silk_url) ----------
    if (order.reference_id) {
      const { data: sheet } = await supabase
        .from('technical_sheets')
        .select('cor_solado_id, default_silk_url')
        .eq('id', order.reference_id)
        .maybeSingle();

      if (sheet?.cor_solado_id) {
        const { data: soleGroup } = await supabase
          .from('product_groups')
          .select('silk_url')
          .eq('id', sheet.cor_solado_id)
          .maybeSingle();
        if (soleGroup?.silk_url) return { silkUrl: await getSignedUrl(soleGroup.silk_url), importantInfo: '' };
      }

      // back-compat: technical sheet's default_silk_url
      if (sheet?.default_silk_url) return { silkUrl: await getSignedUrl(sheet.default_silk_url), importantInfo: '' };
    }
  } catch (e) {
    console.error('Error fetching silk url:', e);
  }

  return { silkUrl: logoSquad, importantInfo: '' };
}
