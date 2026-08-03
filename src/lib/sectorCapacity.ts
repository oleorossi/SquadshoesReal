import { supabase } from '@/integrations/supabase/client';
import { computeSectorLeadTimeDays, getEffectiveCapacityPerDay } from './leadTime';
import { sheetHasSector, SECTOR_LABELS, DISPLAY_SECTORS, type SectorKey } from './sectors';

// Re-exporta a taxonomia da fonte única (./sectors) pra não quebrar imports
// existentes `from '@/lib/sectorCapacity'`.
export type { SectorKey };
export { SECTOR_LABELS };

/**
 * Motor de capacidade setorial.
 *
 * Para cada item de pedido (referência + quantidade + data de faturamento)
 * calcula em qual janela de dias úteis cada setor (corte / costura / montagem)
 * irá operar, soma com a carga já comprometida pelos demais pedidos ativos,
 * e detecta sobrecarga vs. capacidade diária da ficha técnica.
 */

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

// ── Feriados (alinhamento com o SQL is_business_day) ──────────────────────────
// Auditoria 2026-06-11: addBusinessDays/businessDaysBetween pulavam só fim de
// semana, enquanto o SQL is_business_day/add_business_days (usado por
// compute_wave_timeline / compute_min_billing_date) também pula FERIADOS
// (data exata, optional=false). Qualquer janela com feriado fazia a UI divergir
// das datas gravadas na onda e do min billing date do servidor.
//
// Cache a nível de módulo: populado por loadHolidayCache() (fetch, usado em
// checkSectorCapacity) ou setHolidayCache() (a partir de useHolidays nas telas).
// isBusinessDay cai no cache quando nenhum set é passado, então TODOS os cálculos
// de dias úteis (inclusive computeParallelWindows) ficam feriado-aware sem
// precisar threading de parâmetro. Cache vazio = comportamento antigo (sem
// regressão).
let _holidayCache: Set<string> | null = null;

function isHoliday(rows: any[]): Set<string> {
  return new Set<string>(
    (rows || [])
      .filter((r: any) => r?.optional !== true)
      .map((r: any) => String(r.holiday_date)),
  );
}

/** Popula o cache de feriados síncrono, a partir dos dados de useHolidays (telas). */
export function setHolidayCache(rows: any[] | null | undefined): void {
  _holidayCache = isHoliday(rows || []);
}

/** Carrega feriados do banco uma vez e cacheia (usado por checkSectorCapacity). */
export async function loadHolidayCache(force = false): Promise<Set<string>> {
  if (_holidayCache && !force) return _holidayCache;
  const { data } = await supabase.from('holidays').select('*');
  _holidayCache = isHoliday(data || []);
  return _holidayCache;
}

export function isBusinessDay(d: Date, holidays?: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const set = holidays ?? _holidayCache;
  if (set && set.has(d.toISOString().slice(0, 10))) return false;
  return true;
}

export function addBusinessDays(date: Date, days: number, holidays?: Set<string>): Date {
  const d = new Date(date);
  let added = 0;
  const dir = days >= 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setTime(d.getTime() + dir * DAY_MS);
    if (isBusinessDay(d, holidays)) added++;
  }
  return d;
}

export function businessDaysBetween(start: Date, end: Date, holidays?: Set<string>): number {
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    if (isBusinessDay(cur, holidays)) count++;
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

// ── default_lead_times: fallback de capacidade por CATEGORIA (F1-05) ──────────
// O SQL compute_wave_timeline resolve capacidade na cadeia
// COALESCE(NULLIF(ficha,0), dlt_da_categoria) pra TODOS os setores. Toda
// superfície TS que calcula janela (computeParallelWindows /
// computeForwardSchedule / computeSectorDailyLoad) precisa carregar esses
// defaults e repassar — senão a ficha sem capacidade própria cai no lead
// legado/constante fixa e a tela diverge do motor de ondas (F1-05).
// Fonte única das colunas + do fetch, pra nenhuma tela selecionar um subset
// diferente e reintroduzir a divergência.

// ⚠ Fix 2026-08-03: faltavam `costura_cabedal_capacity_per_day` e
// `costura_palmilha_capacity_per_day` — colunas criadas quando a Costura foi
// dividida em dois setores (migs 20261001120000 / 20261015120000). O SQL
// (compute_wave_timeline, compute_min_billing_dates) já lia as duas; o TS não,
// então caía no legado `costura_capacity_per_day` e divergia do motor de ondas
// (Rasteirinha: onda usava 600, Gargalo Diário usava 550). Guard auto-derivado
// em `__tests__/sectorCapacity.columns.test.ts` — deriva do SECTOR_CONFIG.
export const DEFAULT_LEAD_TIME_COLUMNS =
  'shoe_category, cutting_capacity_per_day, sewing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, costura_cabedal_capacity_per_day, costura_palmilha_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, expedition_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_expedicao_dias';

/**
 * Carrega default_lead_times e devolve Map<shoe_category, row>.
 * Sem `categories` carrega todas (a tabela tem ~1 linha por categoria).
 */
export async function fetchCategoryDefaultsMap(categories?: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const cats = (categories || []).filter(Boolean);
  let query = supabase.from('default_lead_times').select(DEFAULT_LEAD_TIME_COLUMNS);
  if (cats.length > 0) query = query.in('shoe_category', cats);
  const { data } = await query;
  (data || []).forEach((d: any) => map.set(d.shoe_category, d));
  return map;
}

/** Resolve os defaults da categoria da ficha (null quando não há). */
export function categoryDefaultsFor(
  sheet: any,
  map: Map<string, any> | null | undefined,
): any | null {
  return sheet?.shoe_category ? map?.get(sheet.shoe_category) ?? null : null;
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

  // Feriados → dias úteis alinhados ao SQL (compute_min_billing_date etc.).
  await loadHolidayCache();

  // Carrega capacidades + (lead times legados, para fallback) das fichas envolvidas
  const { data: sheets } = await supabase
    .from('technical_sheets')
    .select(
      'id, name, code, shoe_category, production_sectors, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, requires_cutting, requires_sewing',
    )
    .in('id', refIds);

  const sheetMap = new Map<string, any>();
  (sheets || []).forEach((s: any) => sheetMap.set(s.id, s));

  // Carrega defaults por categoria (fallback quando ficha não tem capacidade nem
  // lead time) — fonte única fetchCategoryDefaultsMap (F1-05).
  const categories = Array.from(
    new Set((sheets || []).map((s: any) => s.shoe_category).filter(Boolean)),
  );
  const categoryDefaultsMap = await fetchCategoryDefaultsMap(categories as string[]);
  const getDefaults = (sheet: any) => categoryDefaultsFor(sheet, categoryDefaultsMap);

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
      if (isBusinessDay(cur)) {
        addLoad(refId, sector, cur.toISOString().slice(0, 10), perDay);
        remaining--;
      }
      cur.setTime(cur.getTime() + DAY_MS);
    }
  }

  // Cascata única: computeParallelWindows COM os defaults da categoria (F1-05).
  // Antes havia uma cópia local desta cascata — mesma topologia, mas com cap/
  // required lendo só a ficha crua. Delegar elimina o risco das duas divergirem.
  const computeWindows = (sheet: any, qty: number, deadline: Date) =>
    computeParallelWindows(sheet, qty, deadline, getDefaults(sheet));

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
        if (isBusinessDay(cur)) {
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

// =============================================================================
// computeParallelWindows — single source of truth pras janelas por setor
// =============================================================================
// D2+D3: telas frontend (CapacityPlanning; e as extintas ProductionDailySchedule
// / ProductionCapacityCalendar, removidas em 2026-06-28) calculavam cascata
// SEQUENCIAL e ignoravam o setor Costura, divergindo do SQL compute_wave_timeline
// (PR 3 + PR 2 paralelos).
//
// Esta função É a cascata que checkSectorCapacity usa internamente (e espelha o
// que update_wave_timeline grava no banco):
//   - Corte Palmilha ‖ Corte Forração ‖ Aviamento (Mesa) — paralelos prep
//   - Costura é sequencial entre prep e Silk
//   - Pós-prep: Silk → Colagem → Montagem → Solagem → Acabamento (Costura é prep paralela)
//
// F1-05: `categoryDefaults` (linha de default_lead_times da categoria da ficha)
// entra na MESMA cadeia do SQL — COALESCE(NULLIF(ficha,0), dlt) — tanto no lead
// (ceil(qty/cap)) quanto no cap/required. Sem ele (null), ficha sem capacidade
// própria caía no lead legado/constante fixa e as telas de janela (Setores por
// Dia, Cronograma Direto, Capacidade) divergiam do motor de ondas. Carregue via
// fetchCategoryDefaultsMap + categoryDefaultsFor e repasse SEMPRE.
// =============================================================================

// normalização e hasSector vêm da fonte única (./sectors).
const hasSectorPub = (sheet: any, canonical: string) => sheetHasSector(sheet, canonical);

export interface ParallelWindow {
  start: Date;
  end: Date;
  cap: number;
  required: boolean;
}

export type ParallelWindows = Record<
  'corte_palmilha' | 'corte_forracao' | 'costura_palmilha' | 'costura_cabedal'
  | 'mesa' | 'silk'
  | 'colagem' | 'montagem' | 'solagem' | 'acabamento',
  ParallelWindow
>;

export function computeParallelWindows(
  sheet: any,
  qty: number,
  deadline: Date,
  categoryDefaults: any = null,
): ParallelWindows {
  const ltAcab     = computeSectorLeadTimeDays('acabamento',     qty, sheet, categoryDefaults);
  const ltSolagem  = computeSectorLeadTimeDays('solagem',        qty, sheet, categoryDefaults);
  const ltMont     = computeSectorLeadTimeDays('montagem',       qty, sheet, categoryDefaults);
  const ltColagem  = hasSectorPub(sheet, 'Colagem') ? computeSectorLeadTimeDays('colagem', qty, sheet, categoryDefaults) : 0;
  const ltSilk     = hasSectorPub(sheet, 'Silk')    ? computeSectorLeadTimeDays('silk',    qty, sheet, categoryDefaults) : 0;
  const ltCostPalm = hasSectorPub(sheet, 'Costura Palmilha')
    ? computeSectorLeadTimeDays('costura_palmilha', qty, sheet, categoryDefaults) : 0;
  const ltCostCab  = hasSectorPub(sheet, 'Costura Cabedal')
    ? computeSectorLeadTimeDays('costura_cabedal', qty, sheet, categoryDefaults) : 0;
  const ltMesa     = (hasSectorPub(sheet, 'Mesa') || hasSectorPub(sheet, 'Aviamento'))
    ? computeSectorLeadTimeDays('mesa', qty, sheet, categoryDefaults) : 0;
  const ltForracao = hasSectorPub(sheet, 'Corte Forração') ? computeSectorLeadTimeDays('corte_forracao', qty, sheet, categoryDefaults) : 0;
  const ltPalmilha = hasSectorPub(sheet, 'Corte Palmilha') ? computeSectorLeadTimeDays('corte_palmilha', qty, sheet, categoryDefaults) : 0;

  // Capacidade EFETIVA (ficha > default da categoria) — mesma cadeia dos leads.
  // O gating `required` de mesa/silk/colagem/solagem usa a efetiva: antes usava a
  // cap CRUA da ficha, então a janela sumia da tela mesmo com a categoria tendo
  // capacidade (e o motor de ondas agendando o setor). Com defaults=null o valor
  // é idêntico ao antigo (só a ficha).
  const capPalmilha = getEffectiveCapacityPerDay('corte_palmilha', sheet, categoryDefaults);
  const capForracao = getEffectiveCapacityPerDay('corte_forracao', sheet, categoryDefaults);
  const capCostPalm = getEffectiveCapacityPerDay('costura_palmilha', sheet, categoryDefaults);
  const capCostCab  = getEffectiveCapacityPerDay('costura_cabedal',  sheet, categoryDefaults);
  const capMesa     = getEffectiveCapacityPerDay('mesa',           sheet, categoryDefaults);
  const capSilk     = getEffectiveCapacityPerDay('silk',           sheet, categoryDefaults);
  const capColagem  = getEffectiveCapacityPerDay('colagem',        sheet, categoryDefaults);
  const capMont     = getEffectiveCapacityPerDay('montagem',       sheet, categoryDefaults);
  const capSolagem  = getEffectiveCapacityPerDay('solagem',        sheet, categoryDefaults);
  const capAcab     = getEffectiveCapacityPerDay('acabamento',     sheet, categoryDefaults);

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
  // Prep em DOIS blocos paralelos (fluxo descrito pelo dono 2026-10-01):
  //   bloco 2 — Costura Palmilha ‖ Costura Cabedal ‖ Aviamento
  //   bloco 1 — Corte Palmilha ‖ Corte Forração   (antes do bloco 2)
  // Cada bloco termina junto; o bloco 1 termina quando o 2 começa. Antes os 4
  // começavam juntos (Costura era prep ao lado dos cortes) — o que adiantava
  // a costura pra antes do corte existir.
  const costPalmEnd   = silkStart;
  const costPalmStart = addBusinessDays(costPalmEnd, -ltCostPalm);
  const costCabEnd    = silkStart;
  const costCabStart  = addBusinessDays(costCabEnd,  -ltCostCab);
  const mesaEnd       = silkStart;
  const mesaStart     = addBusinessDays(mesaEnd,     -ltMesa);
  // Início do bloco 2 = o mais cedo entre os três (quem tem o maior lead manda)
  const bloco2Start = new Date(Math.min(costPalmStart.getTime(), costCabStart.getTime(), mesaStart.getTime()));
  const palmEnd    = bloco2Start;
  const palmStart  = addBusinessDays(palmEnd,    -ltPalmilha);
  const forrEnd    = bloco2Start;
  const forrStart  = addBusinessDays(forrEnd,    -ltForracao);

  return {
    corte_palmilha: { start: palmStart,    end: palmEnd,    cap: capPalmilha, required: hasSectorPub(sheet, 'Corte Palmilha') && sheet.requires_sewing !== false },
    corte_forracao: { start: forrStart,    end: forrEnd,    cap: capForracao, required: hasSectorPub(sheet, 'Corte Forração') && sheet.requires_cutting !== false },
    costura_palmilha: { start: costPalmStart, end: costPalmEnd, cap: capCostPalm, required: hasSectorPub(sheet, 'Costura Palmilha') },
    costura_cabedal:  { start: costCabStart,  end: costCabEnd,  cap: capCostCab,  required: hasSectorPub(sheet, 'Costura Cabedal') },
    mesa:           { start: mesaStart,    end: mesaEnd,    cap: capMesa,     required: (hasSectorPub(sheet, 'Mesa') || hasSectorPub(sheet, 'Aviamento')) && capMesa > 0 },
    silk:           { start: silkStart,    end: silkEnd,    cap: capSilk,     required: hasSectorPub(sheet, 'Silk') && capSilk > 0 },
    colagem:        { start: colaStart,    end: colaEnd,    cap: capColagem,  required: hasSectorPub(sheet, 'Colagem') && capColagem > 0 },
    montagem:       { start: montStart,    end: montEnd,    cap: capMont,     required: true },
    solagem:        { start: solaStart,    end: solaEnd,    cap: capSolagem,  required: capSolagem > 0 },
    acabamento:     { start: acabStart,    end: acabEnd,    cap: capAcab,     required: true },
  };
}

// =============================================================================
// computeForwardSchedule — agendamento PRA FRENTE ("começo hoje, entrego quando?")
// =============================================================================
// Dual EXATO da cascata reversa de computeParallelWindows, mas pra frente:
//   - os 4 prep (Corte Palmilha ‖ Corte Forração ‖ Aviamento/Mesa ‖ Costura) começam
//     JUNTOS na data de início; cada um termina em início + SEU lead.
//   - A cadeia sequencial só começa quando o ÚLTIMO prep terminar (ponto de
//     convergência = max dos fins de prep).
//   - Pós-prep sequencial: Silk → Colagem → Montagem → Solagem →
//     Acabamento (→ Expedição). A entrega estimada = fim do último setor.
// Reusa computeSectorLeadTimeDays + addBusinessDays (positivo) → MESMOS lead times
// e MESMA topologia da cascata reversa (sem motor novo, sem divergência).
//
// `setupDaysBySector` (opcional, B3): dias extras de setup/troca somados ao lead
// daquele setor (advisory — não altera a cascata persistida). Default vazio.
// `categoryDefaults` (F1-05): linha de default_lead_times da categoria — mesma
// cadeia ficha > categoria da cascata reversa/SQL. Repasse SEMPRE (ver
// computeParallelWindows).
// =============================================================================

export interface ForwardSectorStep {
  key: SectorKey;
  label: string;
  startISO: string;
  endISO: string;
  leadDays: number;
  required: boolean;
}

export interface ForwardSchedule {
  startISO: string;
  finishISO: string;            // entrega estimada se começar em startISO
  totalBusinessDays: number;    // dias úteis do início ao fim
  steps: ForwardSectorStep[];   // só os setores requeridos, na ordem do fluxo
}

// Fluxo do dono (2026-10-01): os dois CORTES abrem em paralelo; quando o
// último fecha, começam as duas COSTURAS e o AVIAMENTO, também em paralelo;
// só então a cadeia sequencial. Antes os 4 começavam juntos.
const FORWARD_CORTES: SectorKey[] = ['corte_palmilha', 'corte_forracao'];
const FORWARD_COSTURA_AVIAMENTO: SectorKey[] = ['costura_palmilha', 'costura_cabedal', 'mesa'];
const FORWARD_SEQ: SectorKey[] = ['silk', 'colagem', 'montagem', 'solagem', 'acabamento', 'expedicao'];

/** YYYY-MM-DD (data local) — reusa o helper local. */
function fwdISO(d: Date): string { return localISODate(d); }

export function computeForwardSchedule(
  sheet: any,
  qty: number,
  startDate: Date,
  setupDaysBySector: Partial<Record<SectorKey, number>> = {},
  categoryDefaults: any = null,
): ForwardSchedule {
  const setup = (k: SectorKey) => Math.max(0, Number(setupDaysBySector[k] || 0));
  // required espelha computeParallelWindows (mesma lógica de hasSector + caps).
  const w = computeParallelWindows(sheet, qty, startDate, categoryDefaults); // só pra reaproveitar `required`/`cap`
  const required = (k: SectorKey): boolean => {
    if (k === 'expedicao') return sheetHasSector(sheet, 'Expedição');
    const pw = (w as any)[k];
    return pw ? !!pw.required : false;
  };
  const lead = (k: SectorKey): number =>
    required(k) ? computeSectorLeadTimeDays(k, qty, sheet, categoryDefaults) + setup(k) : 0;

  const steps: ForwardSectorStep[] = [];
  const pushStep = (k: SectorKey, start: Date, end: Date, ld: number) => {
    if (!required(k)) return;
    steps.push({ key: k, label: SECTOR_LABELS[k] ?? k, startISO: fwdISO(start), endISO: fwdISO(end), leadDays: ld, required: true });
  };

  // Bloco 1 — os dois cortes, paralelos, começando na data de início.
  let cortesEnd = new Date(startDate);
  for (const k of FORWARD_CORTES) {
    const ld = lead(k);
    const end = addBusinessDays(startDate, ld);
    pushStep(k, startDate, end, ld);
    if (required(k) && end.getTime() > cortesEnd.getTime()) cortesEnd = end;
  }

  // Bloco 2 — costuras ‖ aviamento, paralelos, a partir do fim dos cortes.
  let convergence = new Date(cortesEnd);
  for (const k of FORWARD_COSTURA_AVIAMENTO) {
    const ld = lead(k);
    const end = addBusinessDays(cortesEnd, ld);
    pushStep(k, cortesEnd, end, ld);
    if (required(k) && end.getTime() > convergence.getTime()) convergence = end;
  }

  // Sequencial pós-prep, encadeado a partir da convergência.
  let cursor = new Date(convergence);
  for (const k of FORWARD_SEQ) {
    if (!required(k)) continue;
    const ld = lead(k);
    const end = addBusinessDays(cursor, ld);
    pushStep(k, cursor, end, ld);
    cursor = end;
  }

  // Ordena os steps na ordem canônica do fluxo (prep primeiro, depois seq).
  const order = [...FORWARD_CORTES, ...FORWARD_COSTURA_AVIAMENTO, ...FORWARD_SEQ];
  steps.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const finish = steps.length > 0 ? cursor : new Date(startDate);
  return {
    startISO: fwdISO(startDate),
    finishISO: fwdISO(finish),
    totalBusinessDays: businessDaysBetween(startDate, finish),
    steps,
  };
}

// =============================================================================
// computeSectorDailyLoad — carga PLANEJADA por setor num DIA específico
// =============================================================================
// Deriva da MESMA cascata de computeParallelWindows (todos os 9 setores do fluxo,
// paralelismo prep correto). Pro dia D, somamos pairs_per_day das OPs cujo
// [start, end) do setor contém D (em dia útil). Capacidade do dia = média
// ponderada por pares. Obs.: a view semanal v_sector_bottlenecks migrou pro
// modelo ADITIVO de dias de máquina (F1-02, mig 20260920101000) — a comparação
// dia-a-dia aqui continua ponderada por ser um recorte de UM dia.
// Usado pela tela "Setores por Dia" (PCP).
//
// É pura: recebe OPs + fichas já carregadas + o cache de feriados já populado
// (loadHolidayCache no hook) + o map de default_lead_times por categoria
// (fetchCategoryDefaultsMap no hook — F1-05). Não toca rede.
// =============================================================================

export type DailySeverity = 'idle' | 'ok' | 'warning' | 'critical' | 'unknown';

export interface DailyOpInput {
  order_id: string;
  order_number: string | null;
  reference_id: string;
  color: string | null;
  quantity: number;
  planned_delivery: string;          // ISO date (YYYY-MM-DD)
  sheet_name?: string | null;
}

export interface SectorDayContribution {
  order_id: string;
  order_number: string | null;
  reference_id: string;
  sheet_name: string | null;
  color: string | null;
  quantity: number;
  pairs_per_day: number;             // pares/dia desta OP neste setor
  capacity_per_day: number;          // capacidade da ficha pra este setor
  window_start: string;              // ISO
  window_end: string;                // ISO
  planned_delivery: string;          // ISO
}

export interface SectorDayLoad {
  sector: SectorKey;
  label: string;
  plannedPairs: number;              // Σ pairs_per_day no dia (arredondado)
  capacityPerDay: number;            // capacidade ponderada do setor no dia
  utilizationPct: number;            // 0 quando idle/sem capacidade
  severity: DailySeverity;           // idle (sem demanda) · ok · warning · critical · unknown (sem capacidade)
  opsCount: number;
  contributions: SectorDayContribution[];
}

/** Zera a hora pra comparar só a data (local). */
function atMidnight(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** YYYY-MM-DD em data LOCAL (toISOString shiftaria 1 dia em fuso ≥ UTC+0). */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Dia D cai dentro da janela [start, end) do setor E é dia útil? */
function dayInWindow(day: Date, start: Date, end: Date): boolean {
  const d = atMidnight(day);
  const s = atMidnight(start);
  const e = atMidnight(end);
  if (s === e) return d === s && isBusinessDay(day);   // janela degenerada (lead 0): só o dia inicial
  if (d < s || d >= e) return false;                    // [start, end)
  return isBusinessDay(day);
}

/**
 * Carga planejada por setor num dia. Retorna SEMPRE os 9 setores do fluxo
 * (DISPLAY_SECTORS), mesmo os ociosos (severity 'idle'), pra grade fixa na UI.
 */
export function computeSectorDailyLoad(
  dateISO: string,
  ops: DailyOpInput[],
  sheetMap: Map<string, any>,
  categoryDefaultsMap?: Map<string, any> | null,
): SectorDayLoad[] {
  const day = new Date(dateISO + 'T00:00:00');

  type Bucket = { pairs: number; capWeighted: number; qty: number; contribs: SectorDayContribution[] };
  const acc = new Map<SectorKey, Bucket>();
  for (const { key } of DISPLAY_SECTORS) acc.set(key, { pairs: 0, capWeighted: 0, qty: 0, contribs: [] });

  if (!isNaN(day.getTime())) {
    for (const op of ops) {
      const sheet = sheetMap.get(op.reference_id);
      if (!sheet) continue;
      const qty = Number(op.quantity || 0);
      if (qty <= 0 || !op.planned_delivery) continue;
      const deadline = new Date(op.planned_delivery + 'T00:00:00');
      if (isNaN(deadline.getTime())) continue;

      const windows = computeParallelWindows(sheet, qty, deadline, categoryDefaultsFor(sheet, categoryDefaultsMap));
      for (const { key } of DISPLAY_SECTORS) {
        const w = windows[key as keyof ParallelWindows];
        if (!w || !w.required) continue;
        if (!dayInWindow(day, w.start, w.end)) continue;
        const wd = businessDaysBetween(w.start, w.end);
        const perDay = qty / wd;
        const cap = Number(w.cap) || 0;
        const b = acc.get(key)!;
        b.pairs += perDay;
        b.qty += qty;
        b.capWeighted += cap * qty;
        b.contribs.push({
          order_id: op.order_id,
          order_number: op.order_number,
          reference_id: op.reference_id,
          sheet_name: op.sheet_name ?? sheet.name ?? null,
          color: op.color,
          quantity: qty,
          pairs_per_day: Math.round(perDay * 10) / 10,
          capacity_per_day: cap,
          window_start: localISODate(w.start),
          window_end: localISODate(w.end),
          planned_delivery: op.planned_delivery,
        });
      }
    }
  }

  return DISPLAY_SECTORS.map(({ key, label }) => {
    const b = acc.get(key)!;
    const capacityPerDay = b.qty > 0 ? Math.round(b.capWeighted / b.qty) : 0;
    const plannedPairs = Math.round(b.pairs);
    let severity: DailySeverity;
    let utilizationPct = 0;
    if (b.contribs.length === 0) {
      severity = 'idle';
    } else if (capacityPerDay <= 0) {
      severity = 'unknown';            // setor sem capacidade cadastrada → não dá pra comparar
    } else {
      // Compara a razão CRUA antes de arredondar (mesmos limiares 1.0/1.5 de
      // v_sector_bottlenecks): 100,4% é gargalo (warning), não pode arredondar
      // p/ 100 e cair em 'ok'.
      const ratio = b.pairs / capacityPerDay;
      utilizationPct = Math.round(ratio * 100); // só p/ exibição
      if (ratio > 1.5) severity = 'critical';
      else if (ratio > 1.0) severity = 'warning';
      else severity = 'ok';
    }
    return {
      sector: key,
      label,
      plannedPairs,
      capacityPerDay,
      utilizationPct,
      severity,
      opsCount: b.contribs.length,
      contributions: b.contribs.sort((a, c) => c.pairs_per_day - a.pairs_per_day),
    };
  });
}
