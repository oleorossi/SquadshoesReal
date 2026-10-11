import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { invalidateProductSupply } from '@/hooks/useProductSupplySummary';

/**
 * Rateio da entrada de estoque (spec `specs/integracao-estoque-pv-compras.md`,
 * Q4/Q9/Q22). Toda entrada positiva quita a falta dos PVs pela prioridade, no
 * servidor (`tg_cover_commitments_on_stock_in`); estes hooks leem o que foi
 * para cada PV e deixam o dono editar o rateio.
 *
 * ⚠ As RPCs ficam FORA dos tipos gerados e podem ainda não existir no banco.
 * Leitura DEGRADA EM SILÊNCIO: erro → lista vazia / query em erro, sem toast.
 * Só a mutation (ação explícita do usuário) mostra erro.
 */

export interface InboundAllocationRow {
  allocation_id: string;
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  size_key: string | null;
  reservation_id: string | null;
  sale_order_id: string | null;
  order_number: string | null;
  client_name: string | null;
  quantity: number;
  stock_movement_id: string | null;
  created_at: string;
}

export interface OpenShortageRow {
  reservation_id: string;
  product_id: string;
  size_key: string | null;
  sale_order_id: string | null;
  order_number: string | null;
  client_name: string | null;
  quantity_short: number;
  /** Menor = mais prioritário. */
  priority: number | null;
}

export interface MaterialShortageItem {
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  quantity_short: number;
  /** Solado: falta por numeração, ex. {"35":6,"36":10}. */
  shortage_grade: Record<string, number> | null;
}

export interface SaleOrderMaterialShortageRow {
  sale_order_id: string;
  order_number: string | null;
  managed_lines: number;
  short_lines: number;
  shortages: MaterialShortageItem[];
}

/** Entrada de estoque do produto na janela do rateio (`stock_movements`, tipo `in`). */
export interface InboundEntryTotal {
  product_id: string;
  quantity: number;
  /** Solado: quanto entrou por numeração (new_grade − previous_grade). */
  grade: Record<string, number> | null;
}

export interface InboundAllocationEditLine {
  reservation_id: string;
  size_key: string | null;
  quantity: number;
  /** Entrada a que a linha pertence (aba Rastreio). Ausente = a mais recente da janela. */
  stock_movement_id?: string | null;
}

export interface InboundAllocationEdit {
  productId: string;
  /** Só para a mensagem de erro. */
  productName?: string;
  since: string;
  allocations: InboundAllocationEditLine[];
}

const sortedIds = (ids: string[]) => [...new Set(ids.filter(Boolean))].sort();

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Início da operação de entrada, no relógio do NAVEGADOR. Não é o `p_since` das
 * RPCs: `openInboundAllocationReview` o ancora no relógio do SERVIDOR com
 * `anchorInboundSince` antes de consultar o rateio. Daqui só se aproveita a
 * DURAÇÃO da operação (agora − início, ambos no relógio local — o desvio cancela).
 */
export function inboundEntrySince(): string {
  return new Date().toISOString();
}

/** Folga para a latência entre a gravação no banco e a leitura da âncora. */
const ANCHOR_SLACK_MS = 2_000;
/** Teto de desvio do relógio local tolerado: âncora mais velha que isto = a operação não gravou nada. */
const ANCHOR_MAX_SKEW_MS = 30 * 60 * 1000;
/** Margem antiga, usada só quando a âncora no servidor não pôde ser lida. */
const CLIENT_FALLBACK_MARGIN_MS = 5_000;

/**
 * Ancora a janela do rateio no relógio do SERVIDOR.
 *
 * `stock_inbound_allocations.created_at` é `now()` do banco e as RPCs filtram
 * `created_at >= p_since`. Com o `since` do navegador, um PC adiantado mais que
 * a margem não achava NADA (a tela de rateio nunca abria — "não apareceu nada")
 * e um PC atrasado puxava entradas anteriores de outras pessoas, que o Confirmar
 * (que SUBSTITUI tudo desde `p_since`) desfaria junto.
 *
 * Como: `products.updated_at` dos produtos da entrada é `now()` do banco na
 * gravação do saldo (gatilho `update_products_updated_at`) — é o FIM da
 * operação no relógio do servidor. Volta dali a duração da operação, medida no
 * relógio local (agora − início: o desvio cancela), mais uma folga.
 *
 * ⚠ Não ancorar em `stock_movements.created_at`: a "Entrada manual" do detalhe
 * do produto grava o movimento com a DATA escolhida (`occurred_at`), horas
 * antes do `now()` em que o rateio é gravado.
 *
 * Devolve `null` quando nenhum desses produtos foi gravado recentemente (a
 * operação não deu entrada neles: nada a revisar). Se a leitura falhar, cai no
 * comportamento antigo (relógio local − 5 s) em vez de esconder a tela.
 */
export async function anchorInboundSince(
  productIds: string[],
  clientSince: string,
): Promise<string | null> {
  const ids = sortedIds(productIds);
  if (ids.length === 0) return null;
  const startMs = Date.parse(clientSince);
  if (!Number.isFinite(startMs)) return clientSince;
  const fallback = new Date(startMs - CLIENT_FALLBACK_MARGIN_MS).toISOString();
  try {
    const elapsed = Math.max(0, Date.now() - startMs);
    const { data, error } = await supabase
      .from('products')
      .select('updated_at')
      .in('id', ids);
    if (error) throw error;
    const times = ((data ?? []) as Array<{ updated_at: string | null }>)
      .map((r) => (r.updated_at ? Date.parse(r.updated_at) : NaN))
      .filter((t) => Number.isFinite(t));
    if (times.length === 0) return fallback;
    const endMs = Math.max(...times);
    // Nada destes produtos foi gravado perto desta operação (descontado um
    // desvio de relógio plausível): não houve entrada para revisar.
    if (endMs < startMs - ANCHOR_MAX_SKEW_MS) return null;
    return new Date(endMs - elapsed - ANCHOR_SLACK_MS).toISOString();
  } catch (err) {
    console.warn('[rateio] âncora no relógio do servidor indisponível; usando o relógio local:', err);
    return fallback;
  }
}

export const inboundAllocationKeys = {
  all: ['inbound-allocations'] as const,
  list: (productIds: string[], since: string) =>
    ['inbound-allocations', sortedIds(productIds), since] as const,
  openShortages: (productIds: string[]) =>
    ['open-shortages-for-products', sortedIds(productIds)] as const,
  entryTotals: (productIds: string[], since: string) =>
    ['inbound-entry-totals', sortedIds(productIds), since] as const,
};

export const saleOrderMaterialShortagesKey = (saleOrderIds: string[]) =>
  ['sale-order-material-shortages', sortedIds(saleOrderIds)] as const;

// ── Fetchers ────────────────────────────────────────────────────────────────

export async function fetchInboundAllocations(
  productIds: string[],
  since: string,
): Promise<InboundAllocationRow[]> {
  const ids = sortedIds(productIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('list_inbound_allocations' as never, {
    p_product_ids: ids,
    p_since: since,
  } as never);
  if (error) throw error;
  return ((data ?? []) as InboundAllocationRow[]).map((r) => ({ ...r, quantity: num(r.quantity) }));
}

/**
 * Há rateio automático para estes produtos desde `since`? Nunca lança: RPC
 * ausente/erro = "não há" (o diálogo simplesmente não abre).
 */
export async function checkInboundAllocations(
  productIds: string[],
  since: string,
): Promise<InboundAllocationRow[]> {
  try {
    return await fetchInboundAllocations(productIds, since);
  } catch (err) {
    console.warn('[rateio] list_inbound_allocations indisponível:', err);
    return [];
  }
}

export async function fetchOpenShortagesForProducts(productIds: string[]): Promise<OpenShortageRow[]> {
  const ids = sortedIds(productIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('list_open_shortages_for_products' as never, {
    p_product_ids: ids,
  } as never);
  if (error) throw error;
  return ((data ?? []) as OpenShortageRow[])
    .map((r) => ({ ...r, quantity_short: num(r.quantity_short), priority: r.priority == null ? null : num(r.priority) }))
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
}

export async function fetchSaleOrderMaterialShortages(
  saleOrderIds: string[],
): Promise<SaleOrderMaterialShortageRow[]> {
  const ids = sortedIds(saleOrderIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('list_sale_order_material_shortages' as never, {
    p_sale_order_ids: ids,
  } as never);
  if (error) throw error;
  return ((data ?? []) as SaleOrderMaterialShortageRow[]).map((r) => ({
    ...r,
    managed_lines: num(r.managed_lines),
    short_lines: num(r.short_lines),
    shortages: Array.isArray(r.shortages) ? r.shortages : [],
  }));
}

function gradeDelta(prev: unknown, next: unknown): Record<string, number> {
  const p = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  const n = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (key.startsWith('_')) continue;
    const d = num(n[key]) - num(p[key]);
    if (d > 0) out[key] = d;
  }
  return out;
}

/** Quanto entrou de cada produto desde `since` (para "Livre após rateio"). */
export async function fetchInboundEntryTotals(
  productIds: string[],
  since: string,
): Promise<InboundEntryTotal[]> {
  const ids = sortedIds(productIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('stock_movements')
    .select('product_id, quantity, previous_grade, new_grade')
    .in('product_id', ids)
    .eq('movement_type', 'in')
    .gte('created_at', since);
  if (error) throw error;
  const byProduct = new Map<string, InboundEntryTotal>();
  for (const m of (data ?? []) as Array<{
    product_id: string; quantity: number; previous_grade: unknown; new_grade: unknown;
  }>) {
    const qty = num(m.quantity);
    if (qty <= 0) continue;
    const cur = byProduct.get(m.product_id) ?? { product_id: m.product_id, quantity: 0, grade: null };
    cur.quantity += qty;
    const delta = gradeDelta(m.previous_grade, m.new_grade);
    if (Object.keys(delta).length > 0) {
      const g = cur.grade ?? {};
      for (const [k, v] of Object.entries(delta)) g[k] = (g[k] ?? 0) + v;
      cur.grade = g;
    }
    byProduct.set(m.product_id, cur);
  }
  return [...byProduct.values()];
}

// ── Queries ─────────────────────────────────────────────────────────────────

// `meta.silentError`: o `QueryCache.onError` global (App.tsx) tostaria toda
// falha destas leituras — inclusive "função não existe" antes da migration.
const SILENT = {
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 0,
  gcTime: 60_000,
  meta: { silentError: true },
} as const;

export function useInboundAllocations(productIds: string[], since: string | null, enabled = true) {
  return useQuery({
    queryKey: inboundAllocationKeys.list(productIds, since ?? ''),
    queryFn: () => fetchInboundAllocations(productIds, since as string),
    enabled: enabled && !!since && productIds.length > 0,
    ...SILENT,
  });
}

export function useOpenShortagesForProducts(productIds: string[], enabled = true) {
  return useQuery({
    queryKey: inboundAllocationKeys.openShortages(productIds),
    queryFn: () => fetchOpenShortagesForProducts(productIds),
    enabled: enabled && productIds.length > 0,
    ...SILENT,
  });
}

export function useInboundEntryTotals(productIds: string[], since: string | null, enabled = true) {
  return useQuery({
    queryKey: inboundAllocationKeys.entryTotals(productIds, since ?? ''),
    queryFn: () => fetchInboundEntryTotals(productIds, since as string),
    enabled: enabled && !!since && productIds.length > 0,
    ...SILENT,
  });
}

export function useSaleOrderMaterialShortages(saleOrderIds: string[], enabled = true) {
  return useQuery({
    queryKey: saleOrderMaterialShortagesKey(saleOrderIds),
    queryFn: () => fetchSaleOrderMaterialShortages(saleOrderIds),
    enabled: enabled && saleOrderIds.length > 0,
    ...SILENT,
  });
}

// ── Mutation ────────────────────────────────────────────────────────────────

/**
 * Aplica o rateio editado, produto a produto. Cada chamada SUBSTITUI o rateio
 * automático daquele produto desde `since` pelas linhas informadas (o servidor
 * valida soma ≤ entrada + livre e devolve erro legível em pt-BR).
 */
/** Erro do lote: lista os produtos que FORAM aplicados antes/depois da falha. */
export class InboundAllocationEditError extends Error {
  appliedProductIds: string[];
  constructor(message: string, appliedProductIds: string[]) {
    super(message);
    this.name = 'InboundAllocationEditError';
    this.appliedProductIds = appliedProductIds;
  }
}

export function useApplyInboundAllocationEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (edits: InboundAllocationEdit[]) => {
      const results: Array<{ ok: boolean; product_id: string; allocated: number }> = [];
      const failures: string[] = [];
      // Produtos são independentes: a falha de um não impede os outros.
      for (const edit of edits) {
        const { data, error } = await supabase.rpc('apply_inbound_allocation_edit' as never, {
          p_product_id: edit.productId,
          p_since: edit.since,
          p_allocations: edit.allocations.map((a) => ({
            reservation_id: a.reservation_id,
            size_key: a.size_key ?? null,
            quantity: a.quantity,
            stock_movement_id: a.stock_movement_id ?? null,
          })),
        } as never);
        if (error) {
          failures.push(`${edit.productName ? `${edit.productName}: ` : ''}${error.message}`);
          continue;
        }
        const res = (data ?? {}) as { ok?: boolean; product_id?: string; allocated?: number };
        results.push({ ok: res.ok !== false, product_id: res.product_id ?? edit.productId, allocated: num(res.allocated) });
      }
      if (failures.length > 0) {
        throw new InboundAllocationEditError(failures.join(' · '), results.map((r) => r.product_id));
      }
      return results;
    },
    onSettled: () => {
      // Também após falha: produtos anteriores do lote podem ter sido aplicados.
      invalidateProductSupply(qc);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-material-commitments'] });
      qc.invalidateQueries({ queryKey: ['open-shortages-for-products'] });
    },
    onSuccess: (results) => {
      if (results.length > 0) {
        toast.success(results.length === 1 ? 'Rateio confirmado.' : `Rateio confirmado em ${results.length} produtos.`);
      }
    },
    onError: (err: Error) => toast.error(`Erro ao confirmar o rateio — ${err.message}`),
  });
}
