import { supabase } from '@/integrations/supabase/client';
import { computeSectorLeadTimeDays } from './leadTime';

/**
 * Motor de capacidade setorial.
 *
 * Para cada item de pedido (referência + quantidade + data de faturamento)
 * calcula em qual janela de dias úteis cada setor (corte / costura / montagem)
 * irá operar, soma com a carga já comprometida pelos demais pedidos ativos,
 * e detecta sobrecarga vs. capacidade diária da ficha técnica.
 */

export type SectorKey = 'corte_palmilha' | 'corte_forracao' | 'mesa' | 'silk' | 'colagem' | 'montagem' | 'solagem' | 'acabamento' | 'expedicao'
  | 'corte' | 'costura'; // legacy aliases

export interface SectorOverloadItem {
  reference_id: string;
  reference_label: string;
  sector: SectorKey;
  capacity_per_day: number;        // pares/dia da ficha
  required_days: number;            // dias necessários só para este pedido
  available_days: number;           // dias úteis até o início do próximo setor
  daily_load: number;               // pares/dia que precisaríamos absorver
  daily_excess: number;             // excesso vs. capacidade
  shortfall_pairs: number;          // total de pares que não cabem na janela
  window_start_iso: string;
  window_end_iso: string;
}

export interface CapacityCheckInput {
  reference_id: string;
  reference_label: string;
  quantity: number;
}

export interface CapacityCheckResult {
  overloads: SectorOverloadItem[];
  hasOverload: boolean;
  billingDateISO: string;
}

const DAY_MS = 86_400_000;

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  const dir = days >= 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setTime(d.getTime() + dir * DAY_MS);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

/**
 * Verifica capacidade dos setores Corte/Costura/Montagem para um conjunto de itens
 * a serem faturados em uma data específica.
 *
 * Lógica do roteiro (recuando a partir da data de faturamento):
 *  faturamento  →  acabamento  →  montagem  →  costura  →  corte
 */
export async function checkSectorCapacity(
  items: CapacityCheckInput[],
  billingDateISO: string,
): Promise<CapacityCheckResult> {
  const billingDate = new Date(billingDateISO + 'T00:00:00');
  if (isNaN(billingDate.getTime())) {
    return { overloads: [], hasOverload: false, billingDateISO };
  }

  const refIds = Array.from(new Set(items.map((i) => i.reference_id))).filter(Boolean);
  if (refIds.length === 0) {
    return { overloads: [], hasOverload: false, billingDateISO };
  }

  // Carrega capacidades + (lead times legados, para fallback) das fichas envolvidas
  const { data: sheets } = await supabase
    .from('technical_sheets')
    .select(
      'id, name, code, shoe_category, production_sectors, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, requires_cutting, requires_sewing',
    )
    .in('id', refIds);

  const sheetMap = new Map<string, any>();
  (sheets || []).forEach((s: any) => sheetMap.set(s.id, s));

  // Carrega defaults por categoria (fallback quando ficha não tem capacidade nem lead time)
  const categories = Array.from(
    new Set((sheets || []).map((s: any) => s.shoe_category).filter(Boolean)),
  );
  const categoryDefaultsMap = new Map<string, any>();
  if (categories.length > 0) {
    const { data: defaults } = await supabase
      .from('default_lead_times')
      .select('shoe_category, cutting_capacity_per_day, sewing_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias')
      .in('shoe_category', categories as string[]);
    (defaults || []).forEach((d: any) => categoryDefaultsMap.set(d.shoe_category, d));
  }
  const getDefaults = (sheet: any) =>
    sheet?.shoe_category ? categoryDefaultsMap.get(sheet.shoe_category) || null : null;

  // Carrega carga já comprometida — pedidos ativos com data de faturamento futura
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: activeOrders } = await supabase
    .from('sale_orders')
    .select('id, delivery_deadline, status, sale_order_items(reference_id, quantity)')
    .in('status', ['Pendente', 'Aprovado', 'Em Produção', 'Confirmado'])
    .gte('delivery_deadline', today.toISOString().slice(0, 10));

  // Agrega carga por (reference_id, dia, setor)
  type Bucket = Map<string, number>;
  const loadByRef: Map<string, Partial<Record<SectorKey, Bucket>>> = new Map();

  function addLoad(refId: string, sector: SectorKey, dayISO: string, qty: number) {
    if (!loadByRef.has(refId)) loadByRef.set(refId, {});
    const buckets = loadByRef.get(refId)!;
    if (!buckets[sector]) buckets[sector] = new Map();
    const cur = buckets[sector]!.get(dayISO) || 0;
    buckets[sector]!.set(dayISO, cur + qty);
  }

  function distributeAcrossWindow(
    refId: string,
    sector: SectorKey,
    qty: number,
    windowStart: Date,
    windowEnd: Date,
  ) {
    const days = businessDaysBetween(windowStart, windowEnd);
    const perDay = qty / days;
    const cur = new Date(windowStart);
    let remaining = days;
    while (remaining > 0) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        addLoad(refId, sector, cur.toISOString().slice(0, 10), perDay);
        remaining--;
      }
      cur.setTime(cur.getTime() + DAY_MS);
    }
  }

  // Legacy display names → canonical sector enum keys. Keep this in sync with
  // SQL `sector_display_to_enum` (migration 20260506120000). Without it,
  // hasSector('Corte Palmilha') never matches sheets that still have
  // production_sectors=["Corte","Forração","Aviamento",…] from before the
  // rename — cutting/forração windows would collapse to 0 days.
  const SECTOR_NORMALIZE: Record<string, string> = {
    // canonical
    'corte palmilha': 'corte_palmilha',
    'corte forração': 'corte_forracao',
    'corte forracao': 'corte_forracao',
    'mesa':           'mesa',
    'silk':           'silk',
    'colagem':        'colagem',
    'montagem':       'montagem',
    'solagem':        'solagem',
    'acabamento':     'acabamento',
    'expedição':      'expedicao',
    'expedicao':      'expedicao',
    // legacy aliases (pre-2026-05-06 sector rename)
    'corte':          'corte_palmilha',
    'palmilha':       'corte_palmilha',
    'costura':        'corte_forracao',
    'forração':       'corte_forracao',
    'forracao':       'corte_forracao',
    'aviamento':      'mesa',
    'serigrafia':     'silk',
  };
  const normalizeSector = (s: string) =>
    SECTOR_NORMALIZE[s.toLowerCase().trim()] ?? s.toLowerCase().trim();

  function hasSector(sheet: any, canonical: string): boolean {
    const sectors: string[] = Array.isArray(sheet?.production_sectors) ? sheet.production_sectors : [];
    if (sectors.length === 0) return true; // no restriction = all sectors active
    const target = normalizeSector(canonical);
    return sectors.some((s: string) => normalizeSector(s) === target);
  }

  function computeWindows(sheet: any, qty: number, deadline: Date) {
    const defaults = getDefaults(sheet);
    const ltAcab     = computeSectorLeadTimeDays('acabamento',     qty, sheet, defaults);
    const ltSolagem  = computeSectorLeadTimeDays('solagem',        qty, sheet, defaults);
    const ltMont     = computeSectorLeadTimeDays('montagem',       qty, sheet, defaults);
    const ltColagem  = hasSector(sheet, 'Colagem') ? computeSectorLeadTimeDays('colagem', qty, sheet, defaults) : 0;
    const ltSilk     = hasSector(sheet, 'Silk')    ? computeSectorLeadTimeDays('silk',    qty, sheet, defaults) : 0;
    const ltMesa     = hasSector(sheet, 'Mesa') ? computeSectorLeadTimeDays('mesa', qty, sheet, defaults) : 0;
    const ltForracao = hasSector(sheet, 'Corte Forração') ? computeSectorLeadTimeDays('corte_forracao', qty, sheet, defaults) : 0;
    const ltPalmilha = hasSector(sheet, 'Corte Palmilha') ? computeSectorLeadTimeDays('corte_palmilha', qty, sheet, defaults) : 0;

    const acabEnd    = deadline;
    const acabStart  = addBusinessDays(acabEnd,    -ltAcab);
    const solaEnd    = acabStart;
    const solaStart  = addBusinessDays(solaEnd,    -ltSolagem);
    const montEnd    = solaStart;
    const montStart  = addBusinessDays(montEnd,    -ltMont);
    const colaEnd    = montStart;
    const colaStart  = addBusinessDays(colaEnd,    -ltColagem);
    const silkEnd    = colaStart;
    const silkStart  = addBusinessDays(silkEnd,    -ltSilk);
    // Mesa runs sequentially after Corte Forração (it consumes its output)
    const mesaEnd    = silkStart;
    const mesaStart  = addBusinessDays(mesaEnd,    -ltMesa);
    const forrEnd    = mesaStart;
    const forrStart  = addBusinessDays(forrEnd,    -ltForracao);
    const palmEnd    = forrStart;
    const palmStart  = addBusinessDays(palmEnd,    -ltPalmilha);

    return {
      corte_palmilha: { start: palmStart,  end: palmEnd,   cap: Number(sheet.sewing_capacity_per_day   || 0), required: hasSector(sheet, 'Corte Palmilha') && sheet.requires_sewing !== false },
      corte_forracao: { start: forrStart,  end: forrEnd,   cap: Number(sheet.cutting_capacity_per_day  || 0), required: hasSector(sheet, 'Corte Forração') && sheet.requires_cutting !== false },
      mesa:           { start: mesaStart,  end: mesaEnd,   cap: Number(sheet.mesa_daily_capacity       || 0), required: hasSector(sheet, 'Mesa') && Number(sheet.mesa_daily_capacity) > 0 },
      silk:           { start: silkStart,  end: silkEnd,   cap: Number(sheet.silk_capacity_per_day     || 0), required: hasSector(sheet, 'Silk') && Number(sheet.silk_capacity_per_day) > 0 },
      colagem:        { start: colaStart,  end: colaEnd,   cap: Number(sheet.gluing_capacity_per_day   || 0), required: hasSector(sheet, 'Colagem') && Number(sheet.gluing_capacity_per_day) > 0 },
      montagem:       { start: montStart,  end: montEnd,   cap: Number(sheet.assembly_capacity_per_day || 0), required: true },
      solagem:        { start: solaStart,  end: solaEnd,   cap: Number(sheet.soling_capacity_per_day   || 0), required: Number(sheet.soling_capacity_per_day) > 0 },
      acabamento:     { start: acabStart,  end: acabEnd,   cap: Number(sheet.finishing_capacity_per_day|| 0), required: true },
    };
  }

  // Computa janelas de carga já existentes
  for (const ord of activeOrders || []) {
    const odl = (ord as any).delivery_deadline;
    if (!odl) continue;
    const orderBilling = new Date(odl + 'T00:00:00');
    for (const item of (ord as any).sale_order_items || []) {
      const sheet = sheetMap.get(item.reference_id);
      if (!sheet) continue;
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;

      const windows = computeWindows(sheet, qty, orderBilling);
      for (const [key, w] of Object.entries(windows) as [SectorKey, typeof windows.montagem][]) {
        if (w.required && w.cap > 0) {
          distributeAcrossWindow(item.reference_id, key, qty, w.start, w.end);
        }
      }
    }
  }

  // Agora analisa cada item NOVO contra a carga existente
  const overloads: SectorOverloadItem[] = [];

  for (const it of items) {
    const sheet = sheetMap.get(it.reference_id);
    if (!sheet) continue;

    const windows = computeWindows(sheet, it.quantity, billingDate);
    const sectors: { key: SectorKey; cap: number; start: Date; end: Date; required: boolean }[] =
      (Object.entries(windows) as [SectorKey, typeof windows.montagem][]).map(([key, w]) => ({
        key,
        cap: w.cap,
        start: w.start,
        end: w.end,
        required: w.required,
      }));

    for (const sec of sectors) {
      if (!sec.required || sec.cap <= 0) continue;
      const days = businessDaysBetween(sec.start, sec.end);
      const perDayNew = it.quantity / days;
      const buckets = loadByRef.get(it.reference_id)?.[sec.key];
      // Compute peak daily load and accumulate per-day excess (not peak × days)
      let peakLoad = 0;
      let totalShortfall = 0;
      const cur = new Date(sec.start);
      while (cur < sec.end) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) {
          const existing = buckets?.get(cur.toISOString().slice(0, 10)) || 0;
          const dayTotal = existing + perDayNew;
          peakLoad = Math.max(peakLoad, dayTotal);
          if (dayTotal > sec.cap) totalShortfall += dayTotal - sec.cap;
        }
        cur.setTime(cur.getTime() + DAY_MS);
      }
      if (peakLoad > sec.cap) {
        const dailyExcess = peakLoad - sec.cap;
        overloads.push({
          reference_id: it.reference_id,
          reference_label: it.reference_label,
          sector: sec.key,
          capacity_per_day: sec.cap,
          required_days: Math.ceil(it.quantity / Math.max(1, sec.cap)),
          available_days: days,
          daily_load: peakLoad,
          daily_excess: dailyExcess,
          shortfall_pairs: Math.ceil(totalShortfall),
          window_start_iso: sec.start.toISOString().slice(0, 10),
          window_end_iso: sec.end.toISOString().slice(0, 10),
        });
      }
    }
  }

  return {
    overloads,
    hasOverload: overloads.length > 0,
    billingDateISO,
  };
}

export const SECTOR_LABELS: Record<SectorKey, string> = {
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  mesa:           'Mesa',
  silk:           'Silk',
  colagem:        'Colagem',
  montagem:       'Montagem',
  solagem:        'Solagem',
  acabamento:     'Acabamento',
  expedicao:      'Expedição',
  // legacy
  corte:          'Corte',
  costura:        'Costura',
};
