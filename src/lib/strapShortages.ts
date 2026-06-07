import { supabase } from '@/integrations/supabase/client';

/**
 * Detecta tiras com estoque insuficiente para um PV específico.
 *
 * Olha cada item do PV (sale_order_items) que tem `has_straps=true` na ficha
 * técnica. Pra cada linha de tira preenchida no item (color + group_id),
 * busca o produto-tira correspondente e calcula:
 *
 *   - demanda = fichas * consumption (consumption em pares/par × pares do PV)
 *   - disponível = products.quantity − reserved_stock
 *   - shortage = max(0, demanda − disponível)
 *
 * Quando shortage > 0, vira candidato pra OS (artesanal) ou OC (comprar pronto).
 * Quando `strap_colors=[]` no item mas a ficha tem tiras, marca o item como
 * 'incomplete_strap_colors' — UI tem que bloquear o save até preencher cor.
 */

export interface StrapShortage {
  /** Item do PV (sale_order_items.id). */
  sale_order_item_id: string;
  reference_id: string;
  cabedal_color: string;
  pairs: number;
  /** Cor da tira (do strap_colors do item). */
  strap_color: string;
  strap_label: string;
  /** Produto-tira identificado (estoque). */
  product_id: string | null;
  product_name: string | null;
  /** Demanda total (qty), disponível e shortage em unidades do produto-tira. */
  required: number;
  available: number;
  shortage: number;
  /** Quantidade que cada par consome (vem da ficha técnica). */
  consumption_per_pair: number;
  /** Group_id do material-tira (pra resolução de fornecedor). */
  group_id: string | null;
}

export interface StrapIncompleteItem {
  sale_order_item_id: string;
  reference_id: string;
  cabedal_color: string;
}

export interface StrapShortageReport {
  shortages: StrapShortage[];
  incomplete: StrapIncompleteItem[];
}

/**
 * Detecta shortages de tira pra um PV. Retorna shortages + items sem cor.
 * Inputs vêm da própria query: items + ficha técnica + estoque do produto-tira.
 */
export async function detectStrapShortagesForSaleOrder(
  saleOrderId: string,
): Promise<StrapShortageReport> {
  // 1) Itens do PV + ficha técnica (pra saber se tem tiras + sheet_straps)
  const { data: items, error: itemsErr } = await supabase
    .from('sale_order_items')
    .select('id, reference_id, color, quantity, strap_colors, sale_order_id')
    .eq('sale_order_id', saleOrderId);
  if (itemsErr) throw itemsErr;
  if (!items || items.length === 0) return { shortages: [], incomplete: [] };

  const refIds = Array.from(new Set(items.map((i: any) => i.reference_id).filter(Boolean)));
  const { data: sheets, error: sheetsErr } = await supabase
    .from('technical_sheets')
    .select('id, has_straps, strap_colors')
    .in('id', refIds);
  if (sheetsErr) throw sheetsErr;
  const sheetById = new Map<string, any>((sheets || []).map((s: any) => [s.id, s]));

  const incomplete: StrapIncompleteItem[] = [];
  // Coleta candidatos a shortage (cor preenchida + qty)
  type Candidate = {
    sale_order_item_id: string;
    reference_id: string;
    cabedal_color: string;
    pairs: number;
    strap_color: string;
    strap_label: string;
    group_id: string | null;
    consumption_per_pair: number;
  };
  const candidates: Candidate[] = [];

  for (const item of items as any[]) {
    const sheet = sheetById.get(item.reference_id);
    if (!sheet || sheet.has_straps !== true) continue;

    const itemStraps = Array.isArray(item.strap_colors) ? item.strap_colors : [];
    const sheetStraps = Array.isArray(sheet.strap_colors) ? sheet.strap_colors : [];

    // Caso 1: item sem strap_colors → marca como incomplete
    if (itemStraps.length === 0 && sheetStraps.length > 0) {
      incomplete.push({
        sale_order_item_id: item.id,
        reference_id: item.reference_id,
        cabedal_color: item.color || '',
      });
      continue;
    }

    // Caso 2: tem strap_colors → coleta cor por cor
    for (let i = 0; i < itemStraps.length; i++) {
      const s = itemStraps[i] || {};
      const sheetStrap = sheetStraps[i] || sheetStraps.find((x: any) => x.id === s.id) || {};
      const color = (s.color || '').trim();
      const groupId = s.group_id || sheetStrap.group_id || null;
      const consumption = Number(sheetStrap.consumption) || 0;

      if (!color || !groupId || consumption <= 0) continue;

      candidates.push({
        sale_order_item_id: item.id,
        reference_id: item.reference_id,
        cabedal_color: item.color || '',
        pairs: Number(item.quantity) || 0,
        strap_color: color,
        strap_label: s.label || sheetStrap.label || `TIRA ${i + 1}`,
        group_id: groupId,
        consumption_per_pair: consumption,
      });
    }
  }

  if (candidates.length === 0) return { shortages: [], incomplete };

  // 2) Resolve produtos-tira correspondentes (group_id + color)
  const groupColorPairs = Array.from(new Set(
    candidates.map(c => `${c.group_id}::${c.strap_color.toUpperCase()}`)
  ));

  const groupIds = Array.from(new Set(candidates.map(c => c.group_id).filter(Boolean) as string[]));
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, group_id, color, quantity, reserved_stock')
    .in('group_id', groupIds)
    .eq('active', true);
  if (prodErr) throw prodErr;
  const productByKey = new Map<string, any>();
  for (const p of (products || []) as any[]) {
    const key = `${p.group_id}::${(p.color || '').toUpperCase().trim()}`;
    productByKey.set(key, p);
  }

  // 3) Calcula shortage por candidate
  const shortages: StrapShortage[] = [];
  for (const c of candidates) {
    const key = `${c.group_id}::${c.strap_color.toUpperCase().trim()}`;
    const prod = productByKey.get(key);
    const available = prod ? Math.max(0, Number(prod.quantity || 0) - Number(prod.reserved_stock || 0)) : 0;
    // consumption_per_pair está em CM/par (igual a ficha/backend); o estoque do
    // produto-tira está em METROS. Sem o ÷100, required saía ~100× inflado e o
    // StrapShortageDialog disparava com falta falsa + OS/OC 100× maiores.
    const required = (c.consumption_per_pair * c.pairs) / 100;
    const shortage = Math.max(0, required - available);

    if (shortage > 0 || !prod) {
      shortages.push({
        sale_order_item_id: c.sale_order_item_id,
        reference_id: c.reference_id,
        cabedal_color: c.cabedal_color,
        pairs: c.pairs,
        strap_color: c.strap_color,
        strap_label: c.strap_label,
        product_id: prod?.id || null,
        product_name: prod?.name || null,
        required,
        available,
        shortage,
        consumption_per_pair: c.consumption_per_pair,
        group_id: c.group_id,
      });
    }
  }

  return { shortages, incomplete };
}
