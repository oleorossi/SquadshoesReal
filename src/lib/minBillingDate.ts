import { supabase } from '@/integrations/supabase/client';
import { checkSectorCapacity, CapacityCheckInput } from '@/lib/sectorCapacity';
import { computeSectorLeadTimeDays } from '@/lib/leadTime';
import { nextDOW } from '@/lib/isoWeek';

/**
 * Retorna a data mínima de faturamento (ISO yyyy-mm-dd) para um pedido de venda,
 * calculada a partir de hoje somando: lead time fornecedor + buffer material +
 * corte + costura + montagem + acabamento.
 *
 * Usa a função SQL `compute_min_billing_date` para garantir paridade com o backend.
 */
export async function fetchMinBillingDate(saleOrderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('compute_min_billing_date' as any, {
    p_sale_order_id: saleOrderId,
  });
  if (error) {
    console.error('[minBillingDate] erro:', error);
    return null;
  }
  return (data as string) || null;
}

/**
 * Versão em lote — retorna um Map<sale_order_id, min_date>.
 */
export async function fetchMinBillingDates(saleOrderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (saleOrderIds.length === 0) return out;
  const { data, error } = await supabase
    .from('sale_order_min_billing' as any)
    .select('sale_order_id, min_billing_date')
    .in('sale_order_id', saleOrderIds);
  if (error) {
    console.error('[minBillingDates] erro:', error);
    return out;
  }
  for (const row of (data || []) as any[]) {
    if (row.sale_order_id && row.min_billing_date) {
      out.set(row.sale_order_id, row.min_billing_date);
    }
  }
  return out;
}

/** Verifica se uma data ISO está abaixo da data mínima (sem horário). */
export function isBeforeMinDate(targetISO: string, minISO: string): boolean {
  if (!targetISO || !minISO) return false;
  return targetISO < minISO; // ISO yyyy-mm-dd ordena lexicograficamente
}

export function formatBR(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Converte uma data ISO (yyyy-mm-dd) na chave de semana ISO 8601 — formato `YYYY-Www`.
 * Ex: 2026-04-29 → 2026-W18.
 */
export function toISOWeek(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function addBusinessDaysISO(startISO: string, days: number): string {
  const d = new Date(startISO + 'T00:00:00');
  let added = 0;
  while (added < days) {
    // setDate() handles DST transitions (BR fall-back/spring-forward) correctly.
    // Adding a fixed 86_400_000 ms drifts by ±1h on transition days.
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

export interface MinBillingPreview {
  minDateISO: string;
  minWeekISO: string;
  /** True quando faltou material em casa e o sistema teve que somar lead do fornecedor. */
  materialShortage: boolean;
  /** Dias úteis adicionados por causa de compra (0 quando material está em casa). */
  supplierLeadDays: number;
  /** Lista de materiais em falta (para mostrar ao usuário). */
  shortageItems: Array<{ product_id: string; product_name: string; needed: number; available: number; supplier_lead_days: number }>;
}

/**
 * Calcula o piso de lead time (em dias úteis) considerando MATERIAL — espelha a
 * parte de supplier_lead da função SQL `compute_min_billing_date` (audit P3):
 *
 *   1. Agrega `total_needed` por produto somando `sheet_materials.quantity_per_unit * soi.quantity`
 *      em todos os itens do pedido.
 *   2. Para cada produto cujo `total_needed > (quantity - reserved_stock)`, considera
 *      `supplier_lead_time_days` (default 10).
 *   3. Retorna o MAIOR lead time entre os produtos em falta + lista de detalhes.
 *
 * Quando não há ruptura, retorna 0 (sinaliza "material está em casa, pode entrar no
 * próximo slot livre só pela capacidade").
 */
export async function computeMaterialFloor(items: CapacityCheckInput[]): Promise<{
  supplierLeadDays: number;
  shortageItems: MinBillingPreview['shortageItems'];
}> {
  if (!items || items.length === 0) return { supplierLeadDays: 0, shortageItems: [] };

  const refIds = Array.from(new Set(items.map((i) => i.reference_id))).filter(Boolean);
  if (refIds.length === 0) return { supplierLeadDays: 0, shortageItems: [] };

  // Soma quantity por referência (mesmo PV pode ter mais de uma linha por ref)
  const qtyByRef = new Map<string, number>();
  for (const it of items) {
    qtyByRef.set(it.reference_id, (qtyByRef.get(it.reference_id) || 0) + Number(it.quantity || 0));
  }

  // Busca sheet_materials + dados do produto (incluído na select)
  const { data: smRows, error } = await supabase
    .from('sheet_materials')
    .select('sheet_id, product_id, quantity_per_unit, products(id, name, quantity, reserved_stock, supplier_lead_time_days, group_id)')
    .in('sheet_id', refIds);
  if (error) {
    console.error('[computeMaterialFloor] erro:', error);
    return { supplierLeadDays: 0, shortageItems: [] };
  }

  // Agrega total_needed por product_id
  type AggRow = {
    product_id: string;
    product_name: string;
    group_id: string | null;
    needed: number;
    available: number;
    productSupplierLead: number;
  };
  const byProduct = new Map<string, AggRow>();
  for (const r of (smRows || []) as any[]) {
    const refQty = qtyByRef.get(r.sheet_id) || 0;
    if (refQty <= 0 || !r.product_id) continue;
    const need = Number(r.quantity_per_unit || 0) * refQty;
    if (need <= 0) continue;
    const prev = byProduct.get(r.product_id);
    const pName = r.products?.name || '—';
    const pQty = Number(r.products?.quantity || 0);
    const pReserved = Number(r.products?.reserved_stock || 0);
    const available = Math.max(0, pQty - pReserved);
    const productSupplierLead = Number(r.products?.supplier_lead_time_days ?? 10);
    if (prev) {
      prev.needed += need;
    } else {
      byProduct.set(r.product_id, {
        product_id: r.product_id,
        product_name: pName,
        group_id: r.products?.group_id || null,
        needed: need,
        available,
        productSupplierLead,
      });
    }
  }

  // Identifica shortages
  const shortageProductIds: string[] = [];
  for (const row of byProduct.values()) {
    if (row.needed > row.available) shortageProductIds.push(row.product_id);
  }

  // G3 FIX: cascata de lead time consultando PO em aberto + group_supplier antes
  // de cair pro lead cadastrado no produto. Espelha get_effective_supplier_lead_days.
  // Só consulta pra produtos em ruptura (otimização).
  const effectiveLeadByProduct = new Map<string, number>();
  if (shortageProductIds.length > 0) {
    // 1. PO em aberto com eta_days conhecido (mais preciso)
    const { data: poRows } = await (supabase as any)
      .from('purchase_order_items')
      .select('product_id, purchase_orders!inner(id, eta_days, status)')
      .in('product_id', shortageProductIds);
    for (const r of (poRows || []) as any[]) {
      const po = r.purchase_orders;
      if (!po || !['pending', 'approved'].includes(po.status)) continue;
      if (po.eta_days == null) continue;
      const prev = effectiveLeadByProduct.get(r.product_id);
      if (prev === undefined || Number(po.eta_days) < prev) {
        effectiveLeadByProduct.set(r.product_id, Number(po.eta_days));
      }
    }

    // 2. group_suppliers.lead_time_days pros produtos que ainda não têm PO
    const groupIdsNeeded = Array.from(
      new Set(
        Array.from(byProduct.values())
          .filter((r) => r.group_id && shortageProductIds.includes(r.product_id))
          .filter((r) => !effectiveLeadByProduct.has(r.product_id))
          .map((r) => r.group_id as string),
      ),
    );
    if (groupIdsNeeded.length > 0) {
      const { data: gsRows } = await (supabase as any)
        .from('group_suppliers')
        .select('group_id, lead_time_days, updated_at')
        .in('group_id', groupIdsNeeded)
        .gt('lead_time_days', 0)
        .order('updated_at', { ascending: false });
      // Mantém o mais recente por group_id
      const leadByGroup = new Map<string, number>();
      for (const g of (gsRows || []) as any[]) {
        if (!leadByGroup.has(g.group_id)) {
          leadByGroup.set(g.group_id, Number(g.lead_time_days));
        }
      }
      for (const [pid, row] of byProduct.entries()) {
        if (effectiveLeadByProduct.has(pid)) continue;
        if (!row.group_id) continue;
        const groupLead = leadByGroup.get(row.group_id);
        if (groupLead && groupLead > 0) effectiveLeadByProduct.set(pid, groupLead);
      }
    }
  }

  const shortageItems: MinBillingPreview['shortageItems'] = [];
  let maxLead = 0;
  for (const row of byProduct.values()) {
    if (row.needed > row.available) {
      const effective = effectiveLeadByProduct.get(row.product_id) ?? row.productSupplierLead;
      shortageItems.push({
        product_id: row.product_id,
        product_name: row.product_name,
        needed: row.needed,
        available: row.available,
        supplier_lead_days: effective,
      });
      if (effective > maxLead) maxLead = effective;
    }
  }
  return { supplierLeadDays: maxLead, shortageItems };
}

/**
 * Calcula o piso de cascata produtiva (em dias úteis) — espelha a soma da
 * função SQL `compute_min_billing_date`:
 *
 *   buffer + MAX(palmilha, forração, mesa) + costura + silk + colagem
 *           + montagem + solagem + acabamento
 *
 * Setores fora de `production_sectors` contam 0. MAX entre items por setor
 * (idêntico ao MAX() agregado da SQL).
 */
export async function computeCascadeFloorDays(items: CapacityCheckInput[]): Promise<number> {
  if (!items || items.length === 0) return 0;
  const refIds = Array.from(new Set(items.map((i) => i.reference_id))).filter(Boolean);
  if (refIds.length === 0) return 0;

  const { data: sheets, error } = await supabase
    .from('technical_sheets')
    .select(
      'id, shoe_category, production_sectors, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias',
    )
    .in('id', refIds);
  if (error) {
    console.error('[computeCascadeFloorDays] erro:', error);
    return 0;
  }

  const categories = Array.from(new Set((sheets || []).map((s: any) => s.shoe_category).filter(Boolean)));
  const defaultsMap = new Map<string, any>();
  if (categories.length > 0) {
    const { data: defs } = await supabase
      .from('default_lead_times')
      .select('shoe_category, cutting_capacity_per_day, sewing_capacity_per_day, costura_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias')
      .in('shoe_category', categories as string[]);
    (defs || []).forEach((d: any) => defaultsMap.set(d.shoe_category, d));
  }

  const SECTOR_NORMALIZE: Record<string, string> = {
    'corte palmilha': 'corte_palmilha', 'corte forração': 'corte_forracao', 'corte forracao': 'corte_forracao',
    'aviamento': 'mesa', 'mesa': 'mesa', 'costura': 'costura', 'silk': 'silk', 'colagem': 'colagem',
    'montagem': 'montagem', 'solagem': 'solagem', 'acabamento': 'acabamento',
    'expedição': 'expedicao', 'expedicao': 'expedicao',
    'corte': 'corte_palmilha', 'palmilha': 'corte_palmilha',
    'forração': 'corte_forracao', 'forracao': 'corte_forracao', 'serigrafia': 'silk',
  };
  const norm = (s: string) => SECTOR_NORMALIZE[s.toLowerCase().trim()] ?? s.toLowerCase().trim();
  const hasSec = (sheet: any, canonical: string) => {
    const list: string[] = Array.isArray(sheet?.production_sectors) ? sheet.production_sectors : [];
    if (list.length === 0) return true;
    return list.some((s) => norm(s) === canonical);
  };

  // MAX por setor entre items (idêntico ao MAX() do SQL)
  let mxPalm = 0, mxForr = 0, mxCost = 0, mxMesa = 0, mxSilk = 0, mxCola = 0;
  let mxMont = 0, mxSola = 0, mxAcab = 0, mxBuffer = 0;

  for (const it of items) {
    const sheet = (sheets || []).find((s: any) => s.id === it.reference_id);
    if (!sheet) continue;
    const defs = sheet.shoe_category ? defaultsMap.get(sheet.shoe_category) || null : null;
    const qty = Number(it.quantity || 0);

    if (hasSec(sheet, 'corte_palmilha')) mxPalm = Math.max(mxPalm, computeSectorLeadTimeDays('corte_palmilha', qty, sheet, defs));
    if (hasSec(sheet, 'corte_forracao')) mxForr = Math.max(mxForr, computeSectorLeadTimeDays('corte_forracao', qty, sheet, defs));
    if (hasSec(sheet, 'costura'))        mxCost = Math.max(mxCost, computeSectorLeadTimeDays('costura', qty, sheet, defs));
    if (hasSec(sheet, 'mesa'))           mxMesa = Math.max(mxMesa, computeSectorLeadTimeDays('mesa', qty, sheet, defs));
    if (hasSec(sheet, 'silk'))           mxSilk = Math.max(mxSilk, computeSectorLeadTimeDays('silk', qty, sheet, defs));
    if (hasSec(sheet, 'colagem'))        mxCola = Math.max(mxCola, computeSectorLeadTimeDays('colagem', qty, sheet, defs));
    mxMont = Math.max(mxMont, computeSectorLeadTimeDays('montagem', qty, sheet, defs));
    if (hasSec(sheet, 'solagem'))        mxSola = Math.max(mxSola, computeSectorLeadTimeDays('solagem', qty, sheet, defs));
    mxAcab = Math.max(mxAcab, computeSectorLeadTimeDays('acabamento', qty, sheet, defs));

    const buf = Number(sheet.lead_time_buffer_material_dias || defs?.lead_time_buffer_material_dias || 2);
    if (buf > mxBuffer) mxBuffer = buf;
  }

  return (
    Math.max(mxBuffer, 2)
    + Math.max(mxPalm, mxForr, mxMesa)  // prep paralelo
    + mxCost + mxSilk + mxCola + mxMont + mxSola + mxAcab
  );
}

/**
 * Calcula a data mínima de faturamento para um pedido AINDA NÃO PERSISTIDO,
 * a partir dos itens em memória (referência + quantidade).
 *
 * Espelha a função SQL `compute_min_billing_date` (audit P1-P3):
 *   1. Verifica material em casa (estoque - reserved_stock) — se faltar,
 *      soma `supplier_lead_time_days` no piso.
 *   2. Soma a cascata produtiva (paralelismo prep + setores sequenciais).
 *   3. Itera a partir desse piso somando 2 dias úteis a cada tentativa e
 *      verifica capacidade contra demanda existente via `checkSectorCapacity`.
 *   4. Retorna a primeira data sem sobrecarga, snapped pra próxima Ter/Sex.
 */
export async function computeMinBillingForNewOrder(
  items: CapacityCheckInput[],
): Promise<MinBillingPreview | null> {
  if (!items || items.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().slice(0, 10);

  // 1. Lead time de material + cascata produtiva (em paralelo)
  const [{ supplierLeadDays, shortageItems }, cascadeDays] = await Promise.all([
    computeMaterialFloor(items),
    computeCascadeFloorDays(items),
  ]);

  // 2. Piso: hoje + supplier (se faltar material) + cascata. Espelha a soma da SQL.
  const floorDays = supplierLeadDays + cascadeDays;
  let candidate = addBusinessDaysISO(todayISO, floorDays);

  // 3. Itera verificando capacidade contra demanda existente (max 20 tentativas)
  for (let i = 0; i < 20; i++) {
    try {
      const result = await checkSectorCapacity(items, candidate);
      if (!result.hasOverload) {
        const snapped = snapToNextPickup(candidate);
        return {
          minDateISO: snapped,
          minWeekISO: toISOWeek(snapped),
          materialShortage: shortageItems.length > 0,
          supplierLeadDays,
          shortageItems,
        };
      }
    } catch {
      const snapped = snapToNextPickup(candidate);
      return {
        minDateISO: snapped,
        minWeekISO: toISOWeek(snapped),
        materialShortage: shortageItems.length > 0,
        supplierLeadDays,
        shortageItems,
      };
    }
    candidate = addBusinessDaysISO(candidate, 2);
  }

  const snapped = snapToNextPickup(candidate);
  return {
    minDateISO: snapped,
    minWeekISO: toISOWeek(snapped),
    materialShortage: shortageItems.length > 0,
    supplierLeadDays,
    shortageItems,
  };
}

/**
 * Arredonda uma data ISO pra próxima janela de pickup viável (Terça=2 ou Sexta=5).
 * Retorna a primeira janela >= dataBase. Espelha a lógica de
 * compute_min_billing_date no DB pra garantir paridade entre PVs salvos
 * (que usam SQL) e PVs em criação (que usam esta função client-side).
 */
function snapToNextPickup(iso: string): string {
  const tue = nextDOW(iso, 2);
  const fri = nextDOW(iso, 5);
  return tue < fri ? tue : fri;
}