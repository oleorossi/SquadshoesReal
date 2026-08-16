/**
 * Picking da tira artesanal em UMA LINHA (spec §2.5).
 *
 * O separador precisa ver a metragem do **material pronto** (a tira que ele vai
 * produzir), mas quem sai do estoque é a **napa**. Em duas linhas ele procuraria
 * uma tira que não existe na prateleira; em duas linhas separadas ele também
 * contaria a mesma coisa duas vezes. Então: tira em destaque, napa embaixo, na
 * mesma linha.
 *
 *   Tira chata 8mm CAPUCCINO — 139,2 m
 *     consome 2,32 m de NAPA SOFT CAPUCCINO (rend. 60 m/m)
 *
 * Fonte das duas grandezas: `v_strap_picking_operational`, que expõe o snapshot
 * exato da demanda e o saldo consumido da reserva canônica. A tela não resolve
 * produto por nome/cor nem refaz rendimento. Reservas legadas continuam
 * suportadas apenas pelo agregador puro para impressões históricas.
 */

import { supabase } from '@/integrations/supabase/client';
import { napaDisplayName } from '@/lib/strapSourcing';

export interface StrapPickingLine {
  strapVariantId: string;
  baseProductId: string;
  recipeId: string;
  /** Nome do material PRONTO (a tira) — o que aparece em destaque. */
  strapName: string;
  color: string;
  /** Metros de tira do lote. */
  strapRequiredM: number;
  /** Napa de que a tira é cortada. */
  napaName: string;
  /** Quantidade de NAPA que sai do estoque. */
  napaRequired: number;
  /** Metros de tira por metro de napa. */
  yieldPerMeter: number | null;
}

const norm = (s: string | null | undefined): string =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const str = (value: unknown): string => value == null ? '' : String(value).trim();

/** Chave de casamento com a linha de consumo da Lista de Separação. */
export const strapPickingKey = (label: string | null | undefined, color: string | null | undefined): string =>
  `${norm(label)}||${norm(color)}`;

export const strapPickingIdentityKey = (
  strapVariantId: string | null | undefined,
  baseProductId: string | null | undefined,
  recipeId: string | null | undefined,
): string => `id:${strapVariantId || ''}:${baseProductId || ''}:${recipeId || ''}`;

/**
 * Agrega as reservas de tira em uma linha por (rótulo da tira + cor), somando as
 * metragens entre as OPs do lote. Puro — a query fica em
 * `fetchStrapPickingLines`.
 *
 * O índice tem DUAS entradas por linha (rótulo da tira e nome do produto) porque
 * a Lista de Separação nomeia a linha ora pelo grupo, ora pelo rótulo da ficha, e
 * errar o casamento aqui apaga a napa da ficha de separação em silêncio.
 */
export function indexStrapPickingLines(
  reservations: Array<{
    metadata: unknown;
    quantity_reserved?: number | null;
    quantity_consumed?: number | null;
  }> | null | undefined,
): Map<string, StrapPickingLine> {
  const byKey = new Map<string, StrapPickingLine>();
  const aliases = new Map<string, Set<string>>();

  for (const r of reservations || []) {
    const md = r?.metadata as Record<string, unknown> | null | undefined;
    if (!md || typeof md !== 'object') continue;
    if (md.kind !== 'strap') continue;
    if (md.source_mode !== 'internal' && md.sourcing !== 'in_house') continue;
    const strapVariantId = str(md.strap_variant_id);
    const baseProductId = str(md.base_product_id || md.product_id);
    const recipeId = str(md.recipe_id);
    // Depois do cutover, ausência de qualquer ID torna a linha ambígua. O caminho
    // legado continua read-only, mas não pode se misturar a uma linha canônica.
    const canonical = !!strapVariantId && !!baseProductId && !!recipeId;
    const strapName = (md.strap_product_name || '').toString().trim();
    // Sem strap_product_name a reserva é da PRÓPRIA tira (comprada pronta ou
    // anterior ao cutover): não há napa a mostrar, a linha já está correta.
    if (!strapName) continue;
    const napaName = (md.product_name || '').toString().trim();
    if (!napaName) continue;

    const color = (md.color || '').toString().trim();
    const strapRequiredM = Number(md.strap_required_m) || 0;
    const yieldPerMeter = Number(md.yield_per_meter) > 0 ? Number(md.yield_per_meter) : null;
    // `quantity_reserved` JÁ é a napa (debit_strap_stock reserva o produto de
    // estoque, não a tira). O cálculo pelo rendimento é só rede de segurança.
    const reserved = Number(r?.quantity_reserved) || 0;
    const consumed = Number(r?.quantity_consumed) || 0;
    // Linha canônica aceita zero como um saldo real (ex.: demanda totalmente
    // coberta por tira pronta em estoque). O fallback pela divisão existe só
    // para metadata histórica, que não persistia a grandeza de napa.
    const persistedBaseRemaining = Math.max(0, reserved - consumed);
    const napaRequired = canonical
      ? persistedBaseRemaining
      : persistedBaseRemaining || (yieldPerMeter ? strapRequiredM / yieldPerMeter : 0);

    const key = canonical
      ? strapPickingIdentityKey(strapVariantId, baseProductId, recipeId)
      : `legacy:${strapPickingKey(strapName, color)}:${norm(napaName)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.strapRequiredM += strapRequiredM;
      existing.napaRequired += napaRequired;
    } else {
      // A napa vive como 1 produto por COR sob o mesmo nome — sem a cor, o
      // separador procuraria "NAPA SOFT" numa prateleira com 20 variações.
      byKey.set(key, {
        strapVariantId, baseProductId, recipeId,
        strapName, color, strapRequiredM, napaRequired, yieldPerMeter,
        napaName: napaDisplayName(napaName, color),
      });
    }
    // Rótulo da ficha ("TIRA 1") aponta pra mesma linha.
    const aliasKeys = [strapPickingKey(strapName, color)];
    const label = (md.label || '').toString().trim();
    if (label) aliasKeys.push(strapPickingKey(label, color));
    for (const aliasKey of aliasKeys) {
      const targets = aliases.get(aliasKey) || new Set<string>();
      targets.add(key);
      aliases.set(aliasKey, targets);
    }
  }

  // Alias nominal só é publicado quando identifica UMA linha canônica. Em caso
  // SOFT/MADRID com o mesmo rótulo/cor, omitir é mais seguro que escolher a napa errada.
  for (const [from, targets] of aliases) {
    if (targets.size !== 1) continue;
    const [to] = targets;
    const target = byKey.get(to);
    if (target && !byKey.has(from)) byKey.set(from, target);
  }
  return byKey;
}

/** Demandas canônicas dos itens das OPs, já indexadas pra consulta na render. */
export async function fetchStrapPickingLines(orderIds: string[]): Promise<Map<string, StrapPickingLine>> {
  if (!orderIds || orderIds.length === 0) return new Map();
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('sale_order_item_id')
    .in('id', orderIds);
  if (ordersError) throw ordersError;

  const saleOrderItemIds = [...new Set((orders || [])
    .map((order: any) => order.sale_order_item_id)
    .filter(Boolean))] as string[];
  if (saleOrderItemIds.length === 0) return new Map();

  const { data, error } = await (supabase as any)
    .from('v_strap_picking_operational')
    .select('*')
    .in('sale_order_item_id', saleOrderItemIds)
    .eq('source_mode', 'internal')
    .not('status', 'in', '(superseded,cancelled,error,fulfilled)');
  if (error) throw error;

  const canonicalReservations = ((data || []) as any[])
    .filter((row) => row.strap_variant_id && row.base_product_id && row.recipe_id
      && (Number(row.base_required_m) || 0) > (Number(row.base_consumed_m) || 0))
    .map((row) => ({
      quantity_reserved: Number(row.base_required_m) || 0,
      quantity_consumed: Number(row.base_consumed_m) || 0,
      metadata: {
        kind: 'strap',
        source_mode: 'internal',
        strap_variant_id: row.strap_variant_id,
        base_product_id: row.base_product_id,
        recipe_id: row.recipe_id,
        strap_product_name: row.finished_product_name,
        product_name: row.base_product_name,
        color: row.color_name,
        // A lista mostra a necessidade acabada ainda aberta; a sublinha usa o
        // saldo persistido de napa, sem divisão local.
        strap_required_m: Number(row.remaining_finished_m) || 0,
        yield_per_meter: Number(row.confirmed_yield_snapshot) || null,
      },
    }));

  return indexStrapPickingLines(canonicalReservations);
}

/** "consome 2,32 m de NAPA SOFT CAPUCCINO (rend. 60 m/m)" */
export function strapNapaSubline(line: StrapPickingLine, unit = 'm'): string {
  const qty = line.napaRequired.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rend = line.yieldPerMeter != null
    ? ` (rend. ${line.yieldPerMeter.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m/m)`
    : '';
  return `consome ${qty} ${unit} de ${line.napaName}${rend}`;
}
