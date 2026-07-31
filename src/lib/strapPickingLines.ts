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
 * Fonte das duas grandezas: `material_reservations.metadata` das reservas de
 * tira, que `debit_strap_stock` já grava com o motor único (migration
 * 20261021130000) — `strap_product_name` / `strap_required_m` /
 * `yield_per_meter` além do produto que efetivamente saiu do estoque. Não
 * recalculamos nada aqui: recalcular é o que fez compra e reserva divergirem.
 *
 * ⚠ Só reservas de PV criado a partir do cutover (31/07/2026) trazem esses
 * campos; nas antigas `sourcing` vem 'legacy' e não há napa a mostrar. Por isso
 * o enriquecimento é OPT-IN por linha: sem metadata, a lista de separação segue
 * exatamente como era.
 */

import { supabase } from '@/integrations/supabase/client';
import { napaDisplayName } from '@/lib/strapSourcing';

export interface StrapPickingLine {
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

/** Chave de casamento com a linha de consumo da Lista de Separação. */
export const strapPickingKey = (label: string | null | undefined, color: string | null | undefined): string =>
  `${norm(label)}||${norm(color)}`;

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
  reservations: Array<{ metadata: unknown; quantity_reserved?: number | null }> | null | undefined,
): Map<string, StrapPickingLine> {
  const byKey = new Map<string, StrapPickingLine>();
  const alias = new Map<string, string>();

  for (const r of reservations || []) {
    const md = r?.metadata as Record<string, unknown> | null | undefined;
    if (!md || typeof md !== 'object') continue;
    if (md.kind !== 'strap') continue;
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
    const napaRequired = Number(r?.quantity_reserved) || (yieldPerMeter ? strapRequiredM / yieldPerMeter : 0);

    const key = strapPickingKey(strapName, color);
    const existing = byKey.get(key);
    if (existing) {
      existing.strapRequiredM += strapRequiredM;
      existing.napaRequired += napaRequired;
    } else {
      // A napa vive como 1 produto por COR sob o mesmo nome — sem a cor, o
      // separador procuraria "NAPA SOFT" numa prateleira com 20 variações.
      byKey.set(key, {
        strapName, color, strapRequiredM, napaRequired, yieldPerMeter,
        napaName: napaDisplayName(napaName, color),
      });
    }
    // Rótulo da ficha ("TIRA 1") aponta pra mesma linha.
    const label = (md.label || '').toString().trim();
    if (label) alias.set(strapPickingKey(label, color), key);
  }

  for (const [from, to] of alias) {
    const target = byKey.get(to);
    if (target && !byKey.has(from)) byKey.set(from, target);
  }
  return byKey;
}

/** Reservas de tira das OPs do lote, já indexadas pra consulta na render. */
export async function fetchStrapPickingLines(orderIds: string[]): Promise<Map<string, StrapPickingLine>> {
  if (!orderIds || orderIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('material_reservations')
    .select('quantity_reserved, metadata')
    .in('order_id', orderIds)
    .in('status', ['reserved', 'partially_consumed']);
  if (error) throw error;
  return indexStrapPickingLines(data || []);
}

/** "consome 2,32 m de NAPA SOFT CAPUCCINO (rend. 60 m/m)" */
export function strapNapaSubline(line: StrapPickingLine, unit = 'm'): string {
  const qty = line.napaRequired.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rend = line.yieldPerMeter != null
    ? ` (rend. ${line.yieldPerMeter.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m/m)`
    : '';
  return `consome ${qty} ${unit} de ${line.napaName}${rend}`;
}
