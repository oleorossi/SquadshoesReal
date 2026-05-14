/**
 * Programação Diária — Campanha de Produção
 *
 * Modelo industrial moda/calçados: agrupa por CAMPANHA = solado × material.
 *
 * Hierarquia de setup (do mais caro ao mais barato):
 *   1. Solado (troca de molde/forma)     → 30–60 min — Solagem / Montagem
 *   2. Material (couro → sintético)       → 15–30 min — Corte / Costura
 *   3. Cor (dentro do mesmo material)     →  5–15 min — Corte / Silk
 *   4. Referência (mesmo solado+material) →  mínimo   — todos
 *
 * Ordenação dentro de cada campanha:
 *   - Cor: claro → escuro (evita contaminação de pigmento)
 *   - Referência: por prazo ASC
 *
 * Métricas exibidas:
 *   - Setups maiores (troca de solado) por setor/semana
 *   - Setups menores (troca de material/ref) por setor/semana
 *   - Score de agrupamento (% dias sem troca de solado)
 *
 * Indicadores visuais:
 *   - ⬛ Troca de Solado — campanha nova começa neste dia
 *   - ── Troca de Material — dentro do mesmo solado
 *   - · · Continuação de campanha do dia anterior
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeSectorLeadTimeDays } from '@/lib/leadTime';
import type { SectorKey } from '@/lib/leadTime';
import { computeParallelWindows } from '@/lib/sectorCapacity';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CircleNotch as Loader2, CaretLeft as ChevronLeft, CaretRight as ChevronRight, ArrowsClockwise as RefreshCw, CalendarBlank as CalendarDays, ChartBar as BarChart3, Stack as Layers, TrendDown as TrendingDown } from '@phosphor-icons/react';
import { format, startOfWeek, addDays, addWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const DISPLAY_SECTORS: { key: SectorKey; label: string }[] = [
  { key: 'corte_palmilha', label: 'Corte Palmilha' },
  { key: 'corte_forracao', label: 'Corte Forração' },
  { key: 'mesa',           label: 'Aviamento' },
  { key: 'costura',        label: 'Costura' },   // FIX D3
  { key: 'silk',           label: 'Silk' },
  { key: 'colagem',        label: 'Colagem' },
  { key: 'montagem',       label: 'Montagem' },
  { key: 'solagem',        label: 'Solagem' },
  { key: 'acabamento',     label: 'Acabamento' },
];

// Campanha = solado × material. Paleta indexada por campanha.
const CAMPAIGN_PALETTES = [
  { chip: 'bg-teal-500/15 border-teal-500/50 text-teal-700 dark:text-teal-300',         bar: 'bg-teal-500',    dot: 'bg-teal-500' },
  { chip: 'bg-violet-500/15 border-violet-500/50 text-violet-700 dark:text-violet-300', bar: 'bg-violet-500',  dot: 'bg-violet-500' },
  { chip: 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300',         bar: 'bg-rose-500',    dot: 'bg-rose-500' },
  { chip: 'bg-lime-600/15 border-lime-600/50 text-lime-700 dark:text-lime-300',         bar: 'bg-lime-600',    dot: 'bg-lime-600' },
  { chip: 'bg-sky-500/15 border-sky-500/50 text-sky-700 dark:text-sky-300',             bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  { chip: 'bg-fuchsia-500/15 border-fuchsia-500/50 text-fuchsia-700 dark:text-fuchsia-300', bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500' },
  { chip: 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300',     bar: 'bg-amber-500',   dot: 'bg-amber-500' },
  { chip: 'bg-indigo-500/15 border-indigo-500/50 text-indigo-700 dark:text-indigo-300', bar: 'bg-indigo-500',  dot: 'bg-indigo-500' },
  { chip: 'bg-orange-500/15 border-orange-500/50 text-orange-700 dark:text-orange-300', bar: 'bg-orange-500',  dot: 'bg-orange-500' },
  { chip: 'bg-cyan-500/15 border-cyan-500/50 text-cyan-700 dark:text-cyan-300',         bar: 'bg-cyan-500',    dot: 'bg-cyan-500' },
];
const FALLBACK_PALETTE = { chip: 'bg-muted/30 border-border text-muted-foreground', bar: 'bg-muted-foreground', dot: 'bg-muted-foreground' };

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'daily' | 'weekly';

interface ScheduleBlock {
  waveId: string;
  waveCode: string;
  referenceId: string;
  referenceCode: string;
  referenceName: string;
  itemColor: string;
  soleId: string | null;
  soleName: string | null;
  /** Derived from technical sheet name / shoe_category — used for material grouping */
  materialGroup: string;
  /** Campaign key = soleId + materialGroup */
  campaignKey: string;
  /** Index into CAMPAIGN_PALETTES */
  campaignIdx: number;
  /** Color lightness score 0–100 (lower = lighter, must run first) */
  colorLightness: number;
  sector: SectorKey;
  startDate: Date;   // inclusive first working day
  endDate: Date;     // exclusive (= start of next sector or deadline)
  totalQty: number;
  capPerDay: number;
  leadTimeDays: number;
  qtyPerDay: number;
}

interface ColDef {
  label: string;
  sub: string;
  startDate: Date;
  endDate: Date;
  isToday: boolean;
}

interface SetupStats {
  majorSetups: number;  // troca de solado (campanhas diferentes)
  minorSetups: number;  // troca de material/ref dentro do mesmo solado
  totalDays: number;
  score: number;        // 0–100: % dias sem troca de solado
}

// ── Color lightness (claro → escuro) ─────────────────────────────────────────
// Ordena dentro de uma campanha: cores claras primeiro para evitar
// contaminação de pigmento na linha de produção.

const COLOR_TABLE: [string, number][] = [
  // Muito claro
  ['branco', 4], ['white', 4], ['off white', 5], ['cru', 7], ['natural', 8],
  ['gelo', 9], ['palha', 10], ['bege', 12], ['areia', 13], ['nude', 14],
  ['creme', 15], ['marfim', 16], ['perola', 17],
  // Claro
  ['amarelo', 22], ['dourado', 25], ['ouro', 26], ['champagne', 20],
  ['rosa claro', 28], ['rose', 29], ['pessego', 30], ['salmao', 31], ['coral', 34],
  ['pink', 32], ['salmon', 31],
  // Médio claro
  ['cinza claro', 38], ['prata', 40], ['silver', 40],
  ['azul claro', 42], ['celeste', 43], ['sky', 43],
  ['verde claro', 44], ['menta', 45], ['pistache', 46],
  ['laranja', 48], ['terracota', 50],
  // Médio
  ['rosa', 52], ['magenta', 55], ['lilás', 54], ['lilas', 54], ['roxo', 58],
  ['vermelho', 60], ['vinho', 65],
  ['azul', 62], ['turquesa', 57], ['petroleo', 68],
  ['verde', 64], ['musgo', 67],
  // Escuro
  ['marinho', 72], ['navy', 72], ['índigo', 74], ['indigo', 74],
  ['militar', 73], ['oliva', 70],
  ['marrom', 76], ['caramelo', 74], ['camel', 75], ['conhaque', 77],
  ['chocolate', 80], ['mogno', 82], ['tabaco', 78],
  // Muito escuro
  ['cinza escuro', 85], ['chumbo', 87], ['grafite', 88],
  ['preto', 96], ['black', 96],
];

function colorLightness(color: string): number {
  if (!color) return 50;
  // Normalize: lowercase, remove accents
  const c = color.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  // Longest match first to prefer "azul claro" over "azul"
  const sorted = [...COLOR_TABLE].sort((a, b) => b[0].length - a[0].length);
  for (const [name, score] of sorted) {
    const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (c.includes(normalized)) return score;
  }
  return 50;
}

// ── Campaign helpers ───────────────────────────────────────────────────────────

/**
 * Material group is derived from the technical sheet's shoe_category or
 * name. In the future this should come from reference_material_variants.
 * For now we extract the broadest material hint from the sheet name.
 */
function deriveMaterialGroup(sheetName: string, shoeCategory: string | null): string {
  const text = (sheetName + ' ' + (shoeCategory || '')).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (text.includes('couro')) return 'couro';
  if (text.includes('sintetico') || text.includes('sintet')) return 'sintetico';
  if (text.includes('tenis') || text.includes('sportive')) return 'tenis';
  if (text.includes('borracha')) return 'borracha';
  if (text.includes('jeans') || text.includes('lona')) return 'tecido';
  return shoeCategory?.toLowerCase() ?? 'default';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function addBizDays(date: Date, days: number): Date {
  if (days === 0) return new Date(date);
  const d = new Date(date);
  let added = 0;
  const dir = days > 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setTime(d.getTime() + dir * DAY_MS);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

function bizDaysInRange(start: Date, endExclusive: Date): number {
  if (endExclusive.getTime() <= start.getTime()) return 1;
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() < endExclusive.getTime()) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

function businessDaysInPeriod(start: Date, endInclusive: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const end = new Date(endInclusive); end.setHours(23, 59, 59, 999);
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) days.push(new Date(cur));
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return days;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

// ── Sector helpers ────────────────────────────────────────────────────────────

const SECTOR_NORM: Record<string, SectorKey> = {
  'corte palmilha': 'corte_palmilha', 'corte forração': 'corte_forracao',
  'corte forracao': 'corte_forracao', mesa: 'mesa', silk: 'silk',
  serigrafia: 'silk', colagem: 'colagem', montagem: 'montagem',
  solagem: 'solagem', acabamento: 'acabamento', expedição: 'expedicao',
  expedicao: 'expedicao', corte: 'corte_palmilha', palmilha: 'corte_palmilha',
  costura: 'corte_forracao', forração: 'corte_forracao', forracao: 'corte_forracao',
  aviamento: 'mesa',
};

function hasSector(sheet: any, key: SectorKey): boolean {
  const sectors: string[] = Array.isArray(sheet?.production_sectors) ? sheet.production_sectors : [];
  if (sectors.length === 0) return true;
  return sectors.some((s: string) => (SECTOR_NORM[s.toLowerCase().trim()] ?? '') === key);
}

// ── Window computation ────────────────────────────────────────────────────────

// FIX D2+D3: usa computeParallelWindows (lib/sectorCapacity.ts) — single source
// of truth com paralelismo Corte Palmilha ‖ Corte Forração ‖ Mesa + setor
// Costura entre prep e Silk. Antes essa tela calculava cascata sequencial e
// não conhecia Costura (PR 2/PR 3 só atualizou sectorCapacity.ts/leadTime.ts).
function computeWindows(sheet: any, qty: number, deadline: Date, _defaults: any | null) {
  const w = computeParallelWindows(sheet, qty, deadline);
  type W = { start: Date; end: Date; cap: number };
  const out: Partial<Record<SectorKey, W>> = {};
  if (w.corte_palmilha.required) out.corte_palmilha = { start: w.corte_palmilha.start, end: w.corte_palmilha.end, cap: w.corte_palmilha.cap };
  if (w.corte_forracao.required) out.corte_forracao = { start: w.corte_forracao.start, end: w.corte_forracao.end, cap: w.corte_forracao.cap };
  if (w.costura.required && w.costura.cap > 0)
                                 out.costura        = { start: w.costura.start,        end: w.costura.end,        cap: w.costura.cap };
  if (w.mesa.required)           out.mesa           = { start: w.mesa.start,           end: w.mesa.end,           cap: w.mesa.cap };
  if (w.silk.required)           out.silk           = { start: w.silk.start,           end: w.silk.end,           cap: w.silk.cap };
  if (w.colagem.required)        out.colagem        = { start: w.colagem.start,        end: w.colagem.end,        cap: w.colagem.cap };
  if (w.montagem.required)       out.montagem       = { start: w.montagem.start,       end: w.montagem.end,       cap: w.montagem.cap };
  if (w.solagem.required)        out.solagem        = { start: w.solagem.start,        end: w.solagem.end,        cap: w.solagem.cap };
  if (w.acabamento.required)     out.acabamento     = { start: w.acabamento.start,     end: w.acabamento.end,     cap: w.acabamento.cap };
  return out;
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useScheduleData() {
  return useQuery({
    queryKey: ['production_daily_schedule_v2'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [wavesRes, defaultsRes] = await Promise.all([
        supabase
          .from('production_waves')
          .select(`
            id, code, status, earliest_deadline, total_pairs,
            production_wave_items(
              id, reference_id, total_quantity, color, sole_product_id,
              sole_product:products!production_wave_items_sole_product_id_fkey(id, name, code),
              technical_sheets(
                id, code, name, shoe_category, production_sectors,
                cutting_capacity_per_day, sewing_capacity_per_day,
                assembly_capacity_per_day, finishing_capacity_per_day,
                mesa_daily_capacity, silk_capacity_per_day,
                gluing_capacity_per_day, soling_capacity_per_day,
                lead_time_corte_dias, lead_time_costura_dias,
                lead_time_montagem_dias, lead_time_acabamento_dias
              )
            )
          `)
          .in('status', ['draft', 'planning', 'running'])
          .not('earliest_deadline', 'is', null)
          .order('earliest_deadline', { ascending: true }),
        supabase
          .from('default_lead_times' as any)
          .select('shoe_category, cutting_capacity_per_day, sewing_capacity_per_day, mesa_daily_capacity, assembly_capacity_per_day, finishing_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias'),
      ]);

      if (wavesRes.error) throw wavesRes.error;

      const defaultsMap = new Map<string, any>();
      ((defaultsRes.data || []) as any[]).forEach((d: any) => { if (d.shoe_category) defaultsMap.set(d.shoe_category, d); });

      const waves = (wavesRes.data || []) as any[];

      // Build campaign → palette index map
      const campaignPaletteMap = new Map<string, number>();
      let cPIdx = 0;

      const rawBlocks: ScheduleBlock[] = [];

      for (const wave of waves) {
        if (!wave.earliest_deadline) continue;
        const deadline = new Date(wave.earliest_deadline + 'T00:00:00');

        for (const item of (wave.production_wave_items || [])) {
          const sheet = item.technical_sheets;
          if (!sheet) continue;
          const qty = Number(item.total_quantity || 0);
          if (qty <= 0) continue;

          const soleId: string | null = item.sole_product_id ?? null;
          const soleName: string | null = item.sole_product?.name ?? null;
          const materialGroup = deriveMaterialGroup(sheet.name || '', sheet.shoe_category);
          const campaignKey = `${soleId ?? 'no-sole'}::${materialGroup}`;

          if (!campaignPaletteMap.has(campaignKey)) {
            campaignPaletteMap.set(campaignKey, cPIdx % CAMPAIGN_PALETTES.length);
            cPIdx++;
          }

          const defaults = defaultsMap.get(sheet.shoe_category) ?? null;
          const wins = computeWindows(sheet, qty, deadline, defaults);

          for (const [sector, w] of Object.entries(wins)) {
            if (!w) continue;
            const lt = bizDaysInRange(w.start, w.end);
            rawBlocks.push({
              waveId: wave.id,
              waveCode: wave.code,
              referenceId: item.reference_id,
              referenceCode: sheet.code || '',
              referenceName: sheet.name || '',
              itemColor: item.color || '',
              soleId,
              soleName,
              materialGroup,
              campaignKey,
              campaignIdx: campaignPaletteMap.get(campaignKey)!,
              colorLightness: colorLightness(item.color || ''),
              sector: sector as SectorKey,
              startDate: w.start,
              endDate: w.end,
              totalQty: qty,
              capPerDay: w.cap,
              leadTimeDays: lt,
              qtyPerDay: qty / lt,
            });
          }
        }
      }

      return { blocks: rawBlocks, campaignPaletteMap };
    },
  });
}

// ── Column generation ─────────────────────────────────────────────────────────

function generateColumns(viewMode: ViewMode, offset: number): ColDef[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = isoDate(today);
  const monday = startOfWeek(today, { weekStartsOn: 1 });

  if (viewMode === 'daily') {
    const base = addWeeks(monday, offset);
    return [0, 1, 2, 3, 4].map(i => {
      const day = addDays(base, i);
      const iso = isoDate(day);
      return { label: format(day, 'EEE', { locale: ptBR }), sub: iso === todayISO ? 'Hoje' : format(day, 'dd/MM'), startDate: day, endDate: day, isToday: iso === todayISO };
    });
  }

  // Weekly: 4 weeks
  const base = addWeeks(monday, offset * 4);
  return Array.from({ length: 4 }, (_, i) => {
    const wStart = addWeeks(base, i);
    const wEnd   = addDays(wStart, 4);
    return {
      label: `Sem. ${format(wStart, 'w')}`,
      sub: `${format(wStart, 'dd/MM')} – ${format(wEnd, 'dd/MM')}`,
      startDate: wStart, endDate: wEnd,
      isToday: todayISO >= isoDate(wStart) && todayISO <= isoDate(wEnd),
    };
  });
}

// ── Sorting within cell (campaign order) ──────────────────────────────────────

/**
 * Campaign sort: agrupa por campanha (solado × material) para minimizar setups.
 * Dentro de cada campanha: claro → escuro, depois prazo.
 */
function sortedCellBlocks(blocks: ScheduleBlock[], sector: SectorKey, col: ColDef): ScheduleBlock[] {
  return blocks
    .filter(b => b.sector === sector && b.startDate <= col.endDate && b.endDate > col.startDate)
    .sort((a, b) => {
      // 1. Campanha (solado × material) — agrupa campanhas inteiras
      const camp = a.campaignKey.localeCompare(b.campaignKey);
      if (camp !== 0) return camp;
      // 2. Cor: claro → escuro dentro da campanha
      const lightDiff = a.colorLightness - b.colorLightness;
      if (lightDiff !== 0) return lightDiff;
      // 3. Referência
      const ref = a.referenceId.localeCompare(b.referenceId);
      if (ref !== 0) return ref;
      // 4. Prazo
      return a.endDate.getTime() - b.endDate.getTime();
    });
}

// ── Setup stats per sector ────────────────────────────────────────────────────

function computeSetupStats(blocks: ScheduleBlock[], cols: ColDef[]): Record<SectorKey, SetupStats> {
  const result: Record<SectorKey, SetupStats> = {} as any;
  const todayISO = isoDate(new Date());

  for (const { key } of DISPLAY_SECTORS) {
    let majorSetups = 0; // sole changes
    let minorSetups = 0; // material/ref changes within same sole
    let totalDays = 0;
    let prevCampaign: string | null = undefined as any;
    let prevSole: string | null = undefined as any;

    const days = cols.flatMap(col => businessDaysInPeriod(col.startDate, col.endDate));

    for (const day of days) {
      const dayISO = isoDate(day);
      // Only count future / today for setup planning
      if (dayISO < todayISO) continue;

      const dayBlocks = sortedCellBlocks(blocks, key, { startDate: day, endDate: day, label: '', sub: '', isToday: false });
      if (dayBlocks.length === 0) continue;

      totalDays++;
      const dominant = dayBlocks[0];

      if (prevSole !== undefined) {
        if (dominant.soleId !== prevSole) {
          majorSetups++;
        } else if (dominant.campaignKey !== prevCampaign) {
          minorSetups++;
        }
      }
      prevSole = dominant.soleId;
      prevCampaign = dominant.campaignKey;
    }

    const score = totalDays > 1
      ? Math.round(((totalDays - majorSetups) / (totalDays - 1)) * 100)
      : 100;

    result[key] = { majorSetups, minorSetups, totalDays, score };
  }
  return result;
}

// ── Cell component ────────────────────────────────────────────────────────────

function ScheduleCell({
  blocks,
  prevDayDominant,
}: {
  blocks: ScheduleBlock[];
  prevDayDominant: { campaignKey: string; soleId: string | null } | null;
}) {
  if (blocks.length === 0) return <div className="min-h-[60px] bg-muted/10" />;

  const dominant = blocks[0];
  const isMajorSetup  = prevDayDominant !== null && prevDayDominant.soleId !== dominant.soleId;
  const isMinorSetup  = prevDayDominant !== null && !isMajorSetup && prevDayDominant.campaignKey !== dominant.campaignKey;
  const isContinued   = prevDayDominant !== null && prevDayDominant.campaignKey === dominant.campaignKey;

  const totalQtyPerDay = blocks.reduce((s, b) => s + b.qtyPerDay, 0);
  // All blocks in the same sector share the same daily capacity — take the max, not the sum
  const totalCap = blocks.reduce((s, b) => Math.max(s, b.capPerDay), 0);
  const utilPct = totalCap > 0 ? Math.min(100, Math.round((totalQtyPerDay / totalCap) * 100)) : 0;

  return (
    <div className="p-1.5 space-y-1 min-h-[60px]">
      {/* Setup / continuity indicator */}
      {isMajorSetup && (
        <div className="flex items-center gap-1 text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 rounded px-1 py-0.5 border border-red-500/20">
          <span>⬛</span> Troca de Solado
        </div>
      )}
      {isMinorSetup && (
        <div className="flex items-center gap-1 text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-1 py-0.5">
          <span>─</span> Troca de Material
        </div>
      )}
      {isContinued && (
        <div className="text-[9px] text-muted-foreground/60 px-0.5">↓ continua</div>
      )}

      {/* Blocks sorted by campaign + color lightness */}
      {blocks.map((b, i) => {
        const palette = CAMPAIGN_PALETTES[b.campaignIdx] ?? FALLBACK_PALETTE;
        const isNewCampaignWithin = i > 0 && b.campaignKey !== blocks[i - 1].campaignKey;
        const isNewColorWithin    = i > 0 && !isNewCampaignWithin && b.colorLightness !== blocks[i - 1].colorLightness;
        const qty = b.qtyPerDay;
        const cap = b.capPerDay;
        const pct = cap > 0 ? Math.min(100, Math.round((qty / cap) * 100)) : 0;
        const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

        return (
          <TooltipProvider key={`${b.waveId}-${b.referenceCode}-${i}`} delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  {isNewCampaignWithin && <div className="border-t-2 border-dashed border-red-400/50 mt-1 mb-1" />}
                  {isNewColorWithin && <div className="border-t border-dotted border-border/80 mt-0.5 mb-0.5" />}
                  <div className={`rounded border px-1.5 py-1 text-[10px] leading-tight cursor-default ${palette.chip}`}>
                    <div className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${palette.dot}`} />
                      <span className="font-semibold truncate">{b.referenceCode}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] opacity-70">
                      {b.itemColor && <span className="truncate">{b.itemColor}</span>}
                      <span className="opacity-50">·</span>
                      <span className="truncate">{b.waveCode}</span>
                    </div>
                    {cap > 0 && (
                      <div className="mt-0.5">
                        <div className="flex justify-between text-[9px] mb-0.5">
                          <span>{Math.round(qty)}<span className="opacity-50">/{cap}</span></span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[240px]">
                <p className="font-semibold">{b.referenceName}</p>
                {b.soleName && <p><span className="opacity-70">Solado:</span> {b.soleName}</p>}
                <p><span className="opacity-70">Material:</span> {b.materialGroup}</p>
                {b.itemColor && <p><span className="opacity-70">Cor:</span> {b.itemColor} (lightness {b.colorLightness})</p>}
                <p><span className="opacity-70">Campanha:</span> {b.soleName ?? 'Sem solado'} × {b.materialGroup}</p>
                <p><span className="opacity-70">Onda:</span> {b.waveCode}</p>
                <p>{b.totalQty} pares · {b.leadTimeDays} dia{b.leadTimeDays !== 1 ? 's' : ''} · {Math.round(qty)}/dia</p>
                {cap > 0 && <p><span className="opacity-70">Capacidade:</span> {cap} pares/dia ({pct}%)</p>}
                <p className="text-[10px] opacity-60">
                  {format(b.startDate, 'dd/MM')} → {format(addDays(b.endDate, -1), 'dd/MM')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}

      {totalCap > 0 && (
        <div className="text-[9px] text-muted-foreground/70 text-right pt-0.5">
          {Math.round(totalQtyPerDay)}/{totalCap} par/dia — {utilPct}%
        </div>
      )}
    </div>
  );
}

// ── Setup summary cards ───────────────────────────────────────────────────────

function SetupSummaryCards({ stats }: { stats: Record<SectorKey, SetupStats> }) {
  const active = DISPLAY_SECTORS.filter(s => stats[s.key].totalDays > 0);
  if (active.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {active.map(({ key, label }) => {
        const { majorSetups, minorSetups, totalDays, score } = stats[key];
        return (
          <Card key={key}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="display text-xl tabular-nums leading-tight">
                {score}%
                <span className="text-xs font-normal text-muted-foreground ml-1">agrupamento</span>
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div className={`h-full rounded-full ${score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${score}%` }} />
              </div>
              <div className="flex gap-2 mt-1.5 text-[10px] text-muted-foreground">
                {majorSetups > 0 && (
                  <span className="text-red-500 font-medium">⬛ {majorSetups} solado</span>
                )}
                {minorSetups > 0 && (
                  <span className="text-amber-500">─ {minorSetups} material</span>
                )}
                {majorSetups === 0 && minorSetups === 0 && (
                  <span className="text-emerald-600">✓ sem trocas</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{totalDays} dias analisados</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Campaign legend ───────────────────────────────────────────────────────────

function CampaignLegend({ blocks }: { blocks: ScheduleBlock[] }) {
  const campaigns = Array.from(
    new Map(blocks.map(b => [
      b.campaignKey,
      { key: b.campaignKey, soleName: b.soleName, materialGroup: b.materialGroup, idx: b.campaignIdx },
    ])).values(),
  ).sort((a, b) => a.idx - b.idx);

  if (campaigns.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Layers className="h-3 w-3" /> Campanhas:
      </span>
      {campaigns.map(c => {
        const palette = CAMPAIGN_PALETTES[c.idx] ?? FALLBACK_PALETTE;
        const label = `${c.soleName ?? 'Sem solado'} × ${c.materialGroup}`;
        return (
          <div key={c.key} className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${palette.chip}`}>
            <div className={`w-2 h-2 rounded-full ${palette.dot}`} />
            {label}
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ProductionDailySchedule() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useScheduleData();
  const blocks = data?.blocks ?? [];

  const columns = useMemo(() => generateColumns(viewMode, offset), [viewMode, offset]);

  const setupStats = useMemo(() => computeSetupStats(blocks, columns), [blocks, columns]);

  // Prev-day dominant block per (sector × column-index) for changeover detection
  const prevDayMap = useMemo<Map<string, { campaignKey: string; soleId: string | null } | null>>(() => {
    const map = new Map<string, { campaignKey: string; soleId: string | null } | null>();
    for (const { key } of DISPLAY_SECTORS) {
      for (let ci = 0; ci < columns.length; ci++) {
        // In weekly view each column is a full week — comparing to the prior column
        // would compare week N against week N-1, not day-to-day. Suppress changeover
        // indicators in weekly view; they are only meaningful in daily (1 column = 1 day).
        if (viewMode !== 'daily' || ci === 0) { map.set(`${key}:${ci}`, null); continue; }
        const prevCol = columns[ci - 1];
        const prevBlocks = sortedCellBlocks(blocks, key, prevCol);
        map.set(`${key}:${ci}`, prevBlocks.length > 0 ? { campaignKey: prevBlocks[0].campaignKey, soleId: prevBlocks[0].soleId } : null);
      }
    }
    return map;
  }, [blocks, columns, viewMode]);

  const periodLabel = useMemo(() => {
    const first = columns[0]; const last = columns[columns.length - 1];
    return viewMode === 'daily'
      ? `${format(first.startDate, "dd 'de' MMMM", { locale: ptBR })} – ${format(last.endDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}`
      : `${format(first.startDate, 'dd/MM')} – ${format(last.endDate, 'dd/MM/yyyy')}`;
  }, [columns, viewMode]);

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary opacity-50" /></div>;
  if (error) return (
    <div className="text-center py-12 text-destructive">
      <p>Erro ao carregar programação.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Tentar novamente</Button>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="space-y-5">
        <EditorialPageHeader
          sectionLabel="PCP · Programação"
          title="Programação por Campanha"
          description="Campanha = solado × material — sequência claro→escuro dentro de cada campanha para minimizar setups"
          actions={
            <>
              <div className="flex rounded-md border overflow-hidden">
                <button onClick={() => { setViewMode('daily'); setOffset(0); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'daily' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40 text-muted-foreground'}`}>
                  <CalendarDays className="h-3 w-3" /> Diário
                </button>
                <button onClick={() => { setViewMode('weekly'); setOffset(0); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'weekly' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40 text-muted-foreground'}`}>
                  <BarChart3 className="h-3 w-3" /> Semanal
                </button>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} aria-label="Atualizar dados">
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </>
          }
        />

        {/* Setup summary */}
        <SetupSummaryCards stats={setupStats} />

        {/* Legend + reference */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o - 1)} aria-label="Período anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[200px] text-center">{periodLabel}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o + 1)} aria-label="Próximo período">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {offset !== 0 && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setOffset(0)}>Hoje</Button>}
            </div>
          </div>
          {blocks.length > 0 && <CampaignLegend blocks={blocks} />}
          {blocks.length > 0 && (
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="text-red-500 font-bold">⬛</span> Troca de Solado (setup maior)</span>
              <span className="flex items-center gap-1"><span className="text-amber-500">─</span> Troca de Material (setup menor)</span>
              <span className="flex items-center gap-1 text-dotted">· · Continuação de campanha</span>
              <span className="flex items-center gap-1">── Separador de cor (claro→escuro)</span>
            </div>
          )}
        </div>

        {/* Grid */}
        {blocks.length === 0 ? (
          <div className="rounded-lg border border-border py-16 text-center text-muted-foreground">
            <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma onda em planejamento ou produção</p>
            <p className="text-sm mt-1">Crie ondas com prazo de entrega para gerar a programação por campanha.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse min-w-[560px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/60 border-b border-r border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-36 min-w-[140px]">
                    Setor
                  </th>
                  {columns.map((col, ci) => (
                    <th key={ci} className={`border-b border-r border-border px-2 py-2 text-center text-xs font-semibold min-w-[120px] ${col.isToday ? 'bg-primary/10 text-primary' : 'bg-muted/40 text-muted-foreground'}`}>
                      <div className="capitalize">{col.label}</div>
                      <div className="font-normal text-[11px]">{col.sub}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DISPLAY_SECTORS.map(({ key, label }, ri) => {
                  const rowActive = columns.some(col => sortedCellBlocks(blocks, key, col).length > 0);
                  return (
                    <tr key={key} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/10'}>
                      <td className="sticky left-0 z-10 bg-inherit border-b border-r border-border px-3 py-2">
                        <span className={`text-xs font-medium ${rowActive ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                        {setupStats[key]?.majorSetups > 0 && (
                          <Badge variant="destructive" className="ml-1 text-[9px] px-1 py-0">
                            {setupStats[key].majorSetups}×
                          </Badge>
                        )}
                      </td>
                      {columns.map((col, ci) => {
                        const cellBlocks = sortedCellBlocks(blocks, key, col);
                        const prev = prevDayMap.get(`${key}:${ci}`) ?? null;
                        return (
                          <td key={ci} className={`border-b border-r border-border align-top p-0 ${col.isToday ? 'bg-primary/5' : ''}`}>
                            <ScheduleCell blocks={cellBlocks} prevDayDominant={prev} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
