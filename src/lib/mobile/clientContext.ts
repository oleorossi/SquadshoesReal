/**
 * Context-aware lookups pro app mobile: preço da ref pra ESSE cliente,
 * histórico de pedidos, ticket médio. Padrão de manufacturing traveler
 * de mercado — vendedor não precisa decorar tabela; o app mostra o
 * preço certo automaticamente.
 */
import { supabase } from '@/integrations/supabase/client';
import { todayISO } from '@/lib/date';

/** Faixa de preço por quantidade (price-break). minQty = quantidade mínima
 *  (em pares) a partir da qual o preço vale. */
export interface PriceTier { id?: string; minQty: number; price: number; }

export type PriceListInvalidReason = 'inactive' | 'not_started' | 'expired' | 'not_found';

export interface PriceListContext {
  id: string;
  name: string;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  effective: boolean;
  invalidReason?: PriceListInvalidReason;
}

export interface PriceLookup {
  /** reference_id::color -> faixas de preço (asc por minQty). Cor vazia = default da ref. */
  byRefColor: Map<string, PriceTier[]>;
  /** reference_id -> faixas de preço default (qualquer cor). */
  byRef: Map<string, PriceTier[]>;
  /** Metadados da tabela atribuída ao cliente. Uma tabela fora da vigência
   *  permanece visível pra auditoria, mas não fornece preço ao pedido. */
  context?: PriceListContext;
}

export interface ClientCommercialDefaults {
  price_list_id: string | null;
  payment_condition: string | null;
  factoring_config_id: string | null;
  modalidade_frete: string | null;
  transport_company_id: string | null;
  discount_pct: number;
  credit_limit: number;
  block_new_orders: boolean;
  block_reason: string | null;
  inherited_from: string;
}

export interface ClientSalesContext {
  commercialDefaults: ClientCommercialDefaults;
  priceLookup: PriceLookup;
}

export interface ResolvedPriceRule {
  price: number;
  tier: PriceTier;
  match: 'color' | 'reference';
}

export function evaluatePriceListValidity(
  list: { active?: boolean | null; valid_from?: string | null; valid_to?: string | null },
  today = todayISO(),
): { effective: boolean; invalidReason?: PriceListInvalidReason } {
  if (list.active === false) return { effective: false, invalidReason: 'inactive' };
  if (list.valid_from && list.valid_from > today) return { effective: false, invalidReason: 'not_started' };
  if (list.valid_to && list.valid_to < today) return { effective: false, invalidReason: 'expired' };
  return { effective: true };
}

export const fetchClientPriceList = async (
  clientId: string,
  resolvedPriceListId?: string | null,
): Promise<PriceLookup> => {
  const byRefColor = new Map<string, PriceTier[]>();
  const byRef = new Map<string, PriceTier[]>();

  // Chamadas isoladas preservam a leitura direta legada. O fluxo de PV passa
  // o id já resolvido pela política comercial, que inclui herança do grupo
  // econômico e não pode voltar silenciosamente para clients.price_list_id.
  let priceListId = resolvedPriceListId;
  if (resolvedPriceListId === undefined) {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('price_list_id')
      .eq('id', clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    priceListId = client?.price_list_id;
  }
  if (!priceListId) return { byRefColor, byRef };

  // A atribuição ao cliente não basta: tabela inativa, futura ou vencida nunca
  // pode precificar um PV. Antes estes campos existiam no cadastro, mas eram
  // ignorados no fluxo de venda.
  const { data: priceList, error: listError } = await supabase
    .from('price_lists')
    .select('id, name, active, valid_from, valid_to')
    .eq('id', priceListId)
    .maybeSingle();
  if (listError) throw listError;
  if (!priceList) {
    return {
      byRefColor,
      byRef,
      context: {
        id: priceListId,
        name: 'Tabela não encontrada',
        active: false,
        validFrom: '',
        validTo: null,
        effective: false,
        invalidReason: 'not_found',
      },
    };
  }

  const validity = evaluatePriceListValidity(priceList);
  const context: PriceListContext = {
    id: priceList.id,
    name: priceList.name,
    active: priceList.active,
    validFrom: priceList.valid_from,
    validTo: priceList.valid_to,
    ...validity,
  };
  if (!context.effective) return { byRefColor, byRef, context };

  // 2. Busca todos os items dessa lista (com a faixa de quantidade — price-break)
  const { data: items, error: itemsError } = await supabase
    .from('price_list_items')
    .select('id, reference_id, color, unit_price, min_quantity')
    .eq('price_list_id', priceListId);
  if (itemsError) throw itemsError;

  for (const it of (items ?? [])) {
    const refId = it.reference_id;
    const color = (it.color || '').toUpperCase().trim();
    const tier: PriceTier = {
      id: it.id,
      minQty: Math.max(0, Number(it.min_quantity) || 0),
      price: Number(it.unit_price) || 0,
    };
    const target = color ? byRefColor : byRef;
    const key = color ? `${refId}::${color}` : refId;
    const arr = target.get(key);
    if (arr) arr.push(tier); else target.set(key, [tier]);
  }
  // Ordena as faixas por minQty ascendente p/ a resolução por volume.
  for (const arr of byRefColor.values()) arr.sort((a, b) => a.minQty - b.minQty);
  for (const arr of byRef.values()) arr.sort((a, b) => a.minQty - b.minQty);
  return { byRefColor, byRef, context };
};

/**
 * Resolve, em uma única barreira fail-closed, as duas fontes comerciais usadas
 * para autorizar um novo PV. Ausência de linha é tratada como falha de leitura:
 * o cliente existe, portanto o RPC deve sempre devolver exatamente um contexto.
 */
export const fetchClientSalesContext = async (clientId: string): Promise<ClientSalesContext> => {
  const commercialResult = await supabase
    .rpc('get_client_commercial_defaults', { p_client_id: clientId });
  if (commercialResult.error) throw commercialResult.error;
  const commercialDefaults = commercialResult.data?.[0] as ClientCommercialDefaults | undefined;
  if (!commercialDefaults) {
    throw new Error('Não foi possível resolver a política comercial do cliente.');
  }
  const priceLookup = await fetchClientPriceList(clientId, commercialDefaults.price_list_id);
  return { commercialDefaults, priceLookup };
};

export function clientCommercialBlockMessage(defaults: ClientCommercialDefaults): string {
  return defaults.block_reason?.trim()
    || 'Cliente ou grupo econômico bloqueado para novos pedidos.';
}

/** Escolhe o preço da MAIOR faixa cujo minQty <= quantidade. Abaixo de todas,
 *  usa a menor faixa (preço base). */
const pickTier = (tiers: PriceTier[] | undefined, quantity: number): PriceTier | undefined => {
  if (!tiers || tiers.length === 0) return undefined;
  let chosen = tiers[0];
  for (const t of tiers) {
    if (t.minQty <= quantity) chosen = t; else break;
  }
  return chosen;
};

export const resolvePriceRule = (
  lookup: PriceLookup,
  referenceId: string,
  color?: string | null,
  quantity = 0,
): ResolvedPriceRule | undefined => {
  if (lookup.context && !lookup.context.effective) return undefined;
  if (color) {
    const exact = pickTier(
      lookup.byRefColor.get(`${referenceId}::${color.toUpperCase().trim()}`),
      quantity,
    );
    if (exact) return { price: exact.price, tier: exact, match: 'color' };
  }
  const fallback = pickTier(lookup.byRef.get(referenceId), quantity);
  return fallback ? { price: fallback.price, tier: fallback, match: 'reference' } : undefined;
};

/**
 * Resolve preço pra (ref, cor, quantidade). Tenta a chave exata (ref+cor) e o
 * preço de faixa por quantidade; depois cai pro default da ref. quantity=0 →
 * faixa base. Retorna 0 se não houver tabela (vendedor digita manualmente).
 */
export const resolvePrice = (
  lookup: PriceLookup,
  reference_id: string,
  color?: string | null,
  quantity = 0,
): number => {
  return resolvePriceRule(lookup, reference_id, color, quantity)?.price ?? 0;
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
