/**
 * Context-aware lookups pro app mobile: preço da ref pra ESSE cliente,
 * histórico de pedidos, ticket médio. Padrão de manufacturing traveler
 * de mercado — vendedor não precisa decorar tabela; o app mostra o
 * preço certo automaticamente.
 */
import { supabase } from '@/integrations/supabase/client';

export interface PriceLookup {
  /** Mapa reference_id::color -> unit_price (do price list do cliente).
   *  Cor vazia = preço default da ref (sem variação por cor). */
  byRefColor: Map<string, number>;
  /** Mapa reference_id -> preço default (qualquer cor). */
  byRef: Map<string, number>;
}

export const fetchClientPriceList = async (clientId: string): Promise<PriceLookup> => {
  const byRefColor = new Map<string, number>();
  const byRef = new Map<string, number>();

  // 1. Busca price_list_id do cliente
  const { data: client } = await supabase
    .from('clients')
    .select('price_list_id')
    .eq('id', clientId)
    .maybeSingle();

  const priceListId = (client as any)?.price_list_id;
  if (!priceListId) return { byRefColor, byRef };

  // 2. Busca todos os items dessa lista
  const { data: items } = await supabase
    .from('price_list_items')
    .select('reference_id, color, unit_price')
    .eq('price_list_id', priceListId);

  for (const it of (items ?? [])) {
    const refId = (it as any).reference_id;
    const color = ((it as any).color || '').toUpperCase().trim();
    const price = Number((it as any).unit_price) || 0;
    if (color) {
      byRefColor.set(`${refId}::${color}`, price);
    } else {
      byRef.set(refId, price);
    }
  }
  return { byRefColor, byRef };
};

/**
 * Resolve preço pra (ref, cor) específica. Primeiro tenta a chave exata
 * (ref + cor), depois cai pro preço default da ref. Retorna 0 se não
 * houver tabela cadastrada (vendedor digita manualmente).
 */
export const resolvePrice = (
  lookup: PriceLookup,
  reference_id: string,
  color?: string | null,
): number => {
  if (color) {
    const exact = lookup.byRefColor.get(`${reference_id}::${color.toUpperCase().trim()}`);
    if (exact !== undefined) return exact;
  }
  return lookup.byRef.get(reference_id) ?? 0;
};

// ── Histórico do cliente ────────────────────────────────────────────────────

export interface ClientHistory {
  totalOrders: number;
  totalPairs: number;
  totalRevenue: number;
  avgTicket: number;
  lastOrderDate: string | null;
  topRefs: Array<{ reference_id: string; reference_name: string; pairs: number }>;
}

export const fetchClientHistory = async (clientId: string): Promise<ClientHistory> => {
  // PVs do cliente (últimos 12 meses)
  const since = new Date();
  since.setMonth(since.getMonth() - 12);

  const { data: orders } = await supabase
    .from('sale_orders')
    .select('id, total, created_at, order_number')
    .eq('client_id', clientId)
    .gte('created_at', since.toISOString())
    .neq('status', 'Cancelado');

  const ordersList = orders ?? [];
  const totalRevenue = ordersList.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const totalOrders = ordersList.length;

  let totalPairs = 0;
  const refCounts = new Map<string, { name: string; pairs: number }>();

  if (ordersList.length > 0) {
    const orderIds = ordersList.map((o: any) => o.id);
    // sale_order_items NÃO tem reference_name (auditoria 24/05/2026 expôs
    // HTTP 400). Pega via JOIN com technical_sheets.
    const { data: items } = await supabase
      .from('sale_order_items')
      .select('reference_id, quantity, technical_sheets:reference_id(name)')
      .in('sale_order_id', orderIds);

    for (const it of (items ?? [])) {
      const qty = Number((it as any).quantity) || 0;
      totalPairs += qty;
      const refId = (it as any).reference_id;
      const refName = (it as any).technical_sheets?.name ?? '—';
      if (refId) {
        const existing = refCounts.get(refId);
        if (existing) {
          existing.pairs += qty;
        } else {
          refCounts.set(refId, { name: refName, pairs: qty });
        }
      }
    }
  }

  const topRefs = Array.from(refCounts.entries())
    .map(([reference_id, v]) => ({ reference_id, reference_name: v.name, pairs: v.pairs }))
    .sort((a, b) => b.pairs - a.pairs)
    .slice(0, 3);

  const lastOrderDate = ordersList.length > 0
    ? ordersList.reduce((max: string, o: any) => (o.created_at > max ? o.created_at : max), ordersList[0].created_at as string)
    : null;

  return {
    totalOrders,
    totalPairs,
    totalRevenue,
    avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    lastOrderDate,
    topRefs,
  };
};
