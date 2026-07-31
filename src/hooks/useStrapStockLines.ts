import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { napaDisplayName, strapSourcingKey, type StrapSourcing } from '@/lib/strapSourcing';

/**
 * O que o motor único de tira artesanal diz sobre as tiras de um item do PV.
 *
 * Fonte: RPC `resolve_strap_stock_lines` (migration 20261021120000) — a MESMA
 * que compras (`compute_materials_per_pv`) e débito (`debit_strap_stock`) usam.
 * Não reimplementar a resolução aqui: o ponto do motor único é os três lados
 * lerem a mesma decisão.
 *
 * ⚠ Chamamos com `p_sale_order_item_id = NULL` de propósito. Com o id, o motor
 * lê o override JÁ GRAVADO em `sale_order_items.strap_sourcing` — que no
 * formulário é justamente o que ainda não foi salvo. Com NULL, o `sourcing` que
 * volta é o DEFAULT HERDADO (`products.is_artisanal`), e a UI combina esse
 * default com a escolha pendente do formulário. É o que deixa o preview
 * responder ao clique antes de salvar.
 *
 * A napa-base (`resolve_strap_base_napa`) é pedida por linha independentemente
 * do sourcing: precisamos mostrar de qual napa a tira SAIRIA ao marcar "corto
 * aqui", mesmo quando o default do produto é "compro pronta".
 */
export interface StrapStockLine {
  /** Chave `"<group_id>|<COR>"` — casa com `sale_order_items.strap_sourcing`. */
  key: string;
  strapProductId: string | null;
  strapProductName: string;
  strapColor: string;
  strapGroupId: string | null;
  /** Metros de tira pronta que este item consome. */
  strapRequiredM: number;
  /** Default vindo do cadastro do produto (sem override do PV). */
  inheritedSourcing: StrapSourcing;
  /** Família de napa da ficha (cabedal → fallback forração). */
  baseFamily: string | null;
  /** Napa de que a tira sairia se cortada aqui. */
  napaProductName: string | null;
  /** Metros de tira por metro de napa. */
  yieldPerMeter: number | null;
  /** Metros de NAPA consumidos (tira ÷ rendimento). */
  napaRequiredM: number | null;
  /** Por que "corto aqui" não resolve. Mensagem acionável, vinda do banco. */
  blockReason: string | null;
}

/** Estas duas RPCs não estão em `integrations/supabase/types.ts` (arquivo
 *  GERADO — não editar à mão), então a chamada não tipa. Um wrapper só, em vez
 *  de espalhar cast por chamada. */
type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>): RpcResult =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => RpcResult }).rpc(fn, args);

/** Uma entrada de `sale_order_items.strap_colors` (a que a UI do PV manipula). */
interface StrapColorEntry {
  group_id?: string | null;
  color?: string | null;
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
}

/** Linha crua de `resolve_strap_stock_lines` / `resolve_strap_base_napa`. */
type RpcRow = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

export interface StrapStockLinesInput {
  referenceId: string | null | undefined;
  strapColors: unknown;
  quantity: number | null | undefined;
  grade: Record<string, number> | null | undefined;
}

/** Chave de cache estável: só o que muda o resultado do motor. */
function cacheKey(input: StrapStockLinesInput): string {
  const straps = Array.isArray(input.strapColors) ? (input.strapColors as StrapColorEntry[]) : [];
  return JSON.stringify({
    r: input.referenceId || null,
    q: Number(input.quantity) || 0,
    g: input.grade || null,
    s: straps.map((s) => [s?.group_id || '', s?.color || '', s?.consumption ?? null, s?.consumption_per_size ?? null]),
  });
}

export function useStrapStockLines(input: StrapStockLinesInput, enabled = true) {
  const straps = Array.isArray(input.strapColors) ? (input.strapColors as StrapColorEntry[]) : [];
  const hasStraps = straps.length > 0 && straps.some((s) => !!s?.group_id && !!s?.color);

  return useQuery<StrapStockLine[]>({
    queryKey: ['strap_stock_lines', cacheKey(input)],
    enabled: enabled && !!input.referenceId && hasStraps,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await rpc('resolve_strap_stock_lines', {
        p_sale_order_item_id: null,
        p_reference_id: input.referenceId,
        p_strap_colors: straps,
        p_order_quantity: Number(input.quantity) || 0,
        p_order_grade: input.grade || null,
      });
      if (error) throw error;

      const rows = (data || []) as RpcRow[];
      // Napa-base por linha resolvida. Chamadas paralelas e pequenas (1–4 tiras
      // por item na prática); a mensagem de bloqueio vem pronta do banco.
      const napas = await Promise.all(rows.map(async (r): Promise<RpcRow | null> => {
        if (!r.strap_product_id || !r.base_family) return null;
        const { data: nd, error: ne } = await rpc('resolve_strap_base_napa', {
          p_strap_product_id: r.strap_product_id,
          p_family: r.base_family,
          p_color: str(r.strap_color),
        });
        if (ne) throw ne;
        return ((Array.isArray(nd) ? nd[0] : nd) as RpcRow | null) || null;
      }));

      return rows.map((r, i): StrapStockLine => {
        const napa = napas[i];
        const strapRequiredM = Number(r.strap_required_m) || 0;
        const yieldPerMeter = Number(napa?.yield_per_meter) > 0 ? Number(napa!.yield_per_meter) : null;
        return {
          key: strapSourcingKey(strOrNull(r.strap_group_id), str(r.strap_color)) || `${i}`,
          strapProductId: strOrNull(r.strap_product_id),
          strapProductName: str(r.strap_product_name) || 'Tira',
          strapColor: str(r.strap_color),
          strapGroupId: strOrNull(r.strap_group_id),
          strapRequiredM,
          inheritedSourcing: r.sourcing === 'in_house' ? 'in_house' : 'purchased',
          baseFamily: strOrNull(r.base_family),
          // Nome + COR: a napa tem uma variação por cor sob o mesmo nome.
          napaProductName: napa?.base_product_name
            ? napaDisplayName(str(napa.base_product_name), str(r.strap_color))
            : null,
          yieldPerMeter,
          napaRequiredM: yieldPerMeter ? strapRequiredM / yieldPerMeter : null,
          // O bloqueio do próprio motor (tira não resolvida no PV) vem em
          // `block_reason`; o da napa vem da resolução da família+cor.
          blockReason: strOrNull(napa?.block_reason) ?? strOrNull(r.block_reason),
        };
      });
    },
  });
}
