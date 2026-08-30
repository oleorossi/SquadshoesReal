import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Hand, Pen, Scissors, Sliders as SlidersIcon, ArrowsCounterClockwise as RefreshCw } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { SignedImage } from '@/components/ui/signed-image';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { todayISO, safeFormatBR } from '@/lib/date';
import { fetchAllPages } from '@/lib/supabasePaginate';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  useSectorSettings, useUpdateSectorSetting, useRecomputeSchedule,
  useEnsureFreshSchedule, useProductionQueueDetail,
} from '@/hooks/useProductionEngine';
import { useCan } from '@/hooks/useAccessControl';
import { useRealtimeOrderStages } from '@/hooks/useOrderStages';
import {
  fetchCategoryDefaultsMap, offsetsFromSettings, loadHolidayCache, setHolidayCache,
} from '@/lib/sectorCapacity';
import { useHolidays } from '@/hooks/useTimesheet';
import {
  buildEarlyReleaseBoard, horizonPct,
  type EarlyLaneKey, type EarlyReleaseOp, type EarlyReleaseScheduleRow, type EarlyReleaseRow,
} from '@/lib/earlyReleaseBoard';

const LANE_TONE: Record<EarlyLaneKey, { bar: string; label: string }> = {
  aviamento: { bar: 'bg-[hsl(var(--stage-assy-fg))]', label: 'text-[hsl(var(--stage-assy-fg))]' },
  cabedal: { bar: 'bg-[hsl(var(--stage-sew-fg))]', label: 'text-[hsl(var(--stage-sew-fg))]' },
  cortes: { bar: 'bg-[hsl(var(--stage-cut-fg))]', label: 'text-[hsl(var(--stage-cut-fg))]' },
};

const fmtPairs = (n: number) => n.toLocaleString('pt-BR');
const fmtDay = (iso: string | null) => safeFormatBR(iso, '—', 'dd/MM');

function LaneBar({
  start, end, horizonStart, horizonEnd, tone, label, today,
}: {
  start: string | null; end: string | null;
  horizonStart: string | null; horizonEnd: string | null;
  tone: string; label: string; today: string;
}) {
  if (!start || !end || !horizonStart || !horizonEnd) {
    return (
      <div className="h-7 rounded-md bg-muted/40 flex items-center px-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">sem janela</span>
      </div>
    );
  }
  const left = horizonPct(start, horizonStart, horizonEnd);
  const right = horizonPct(end, horizonStart, horizonEnd);
  const width = Math.max(3, right - left);
  const todayLeft = horizonPct(today, horizonStart, horizonEnd);
  return (
    <div className="relative h-7 rounded-md bg-muted/30 overflow-hidden">
      <div
        className={cn('absolute top-0.5 bottom-0.5 rounded-sm min-w-[10px]', tone)}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${label} ${fmtDay(start)} → ${fmtDay(end)}`}
      />
      {todayLeft >= 0 && todayLeft <= 100 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/80"
          style={{ left: `${todayLeft}%` }}
          title="Hoje"
        />
      )}
    </div>
  );
}

function HorizonAxis({
  start, end, today,
}: {
  start: string | null; end: string | null; today: string;
}) {
  if (!start || !end) return null;
  const todayLeft = horizonPct(today, start, end);
  const showToday = todayLeft > 2 && todayLeft < 98;
  return (
    <div className="relative h-7 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="absolute left-0 top-0">{fmtDay(start)}</span>
      {showToday && (
        <span
          className="absolute top-0 -translate-x-1/2 text-foreground"
          style={{ left: `${todayLeft}%` }}
        >
          hoje
        </span>
      )}
      <span className="absolute right-0 top-0">{fmtDay(end)}</span>
      {showToday && (
        <div
          className="absolute top-5 bottom-0 w-px bg-foreground/70"
          style={{ left: `${todayLeft}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

function OffsetField({
  label, value, onSave, disabled, icon: Icon,
}: {
  label: string; value: number; onSave: (n: number) => void; disabled: boolean;
  icon: typeof Hand;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">dias úteis antes dos cortes</p>
        </div>
        <Input
          type="number"
          min={0}
          max={60}
          defaultValue={value}
          key={`${label}-${value}`}
          onBlur={(e) => {
            const next = Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0)));
            if (next !== value) onSave(next);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          disabled={disabled}
          className="h-10 w-16 font-mono text-right text-lg"
          aria-label={`Dias de antecipação de ${label}`}
        />
      </CardContent>
    </Card>
  );
}

function ReferenceCard({
  row, horizonStart, horizonEnd, today,
}: {
  row: EarlyReleaseRow; horizonStart: string | null; horizonEnd: string | null; today: string;
}) {
  const opsPreview = row.opNumbers.slice(0, 6).join(' · ');
  const extraOps = row.opNumbers.length - 6;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          {row.photo_url ? (
            <SignedImage src={row.photo_url} alt={row.reference_name} className="h-14 w-14 rounded-md object-cover shrink-0 bg-muted" />
          ) : (
            <div className="h-14 w-14 rounded-md bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold text-base truncate">{row.reference_name}</h3>
              {row.daysAhead > 0 && (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {row.daysAhead} dia{row.daysAhead === 1 ? '' : 's'} na frente
                </Badge>
              )}
              {row.source === 'cascata' && (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">estimativa</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono">{fmtPairs(row.pairs)}</span> pares · {row.opCount} OP{row.opCount === 1 ? '' : 's'}
              {row.pvCount > 0 ? ` · ${row.pvCount} PV${row.pvCount === 1 ? '' : 's'}` : ''}
              {row.colors.length > 0 ? ` · ${row.colors.join(', ')}` : ''}
            </p>
            {opsPreview && (
              <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate" title={row.opNumbers.join(' · ')}>
                {opsPreview}{extraOps > 0 ? ` +${extraOps}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5 sm:space-y-0 sm:grid sm:grid-cols-[7.5rem_6.5rem_1fr_4.5rem] sm:gap-x-2 sm:gap-y-1.5 sm:items-center">
          {row.lanes.map((lane) => (
            <div key={lane.key} className="space-y-0.5 sm:contents">
              <div className="flex items-baseline justify-between gap-2 sm:contents">
                <span className={cn('text-[10px] font-bold uppercase tracking-wider truncate', LANE_TONE[lane.key].label)}>
                  {lane.label}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                  {lane.start ? `${fmtDay(lane.start)} → ${fmtDay(lane.end)}` : '—'}
                </span>
              </div>
              <LaneBar
                start={lane.start}
                end={lane.end}
                horizonStart={horizonStart}
                horizonEnd={horizonEnd}
                tone={LANE_TONE[lane.key].bar}
                label={lane.label}
                today={today}
              />
              <span className="hidden sm:block text-[11px] font-mono tabular-nums text-right text-muted-foreground">
                {lane.pairs > 0 ? `${fmtPairs(lane.pairs)} p` : ''}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Antecipação — Aviamento e Costura Cabedal contra o início da produção (cortes).
 * Uma linha por referência: pares somados, não por PV.
 */
export default function ProducaoAntecipacao() {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const canEditOffset = useCan('/producao/setores').canEdit;
  const { data: settings = [] } = useSectorSettings();
  const update = useUpdateSectorSetting();
  const recompute = useRecomputeSchedule();
  const { data: queue = [], isLoading: loadingQueue } = useProductionQueueDetail();
  const { data: holidays = [] } = useHolidays();
  const [q, setQ] = useState('');
  const today = todayISO();

  useEffect(() => { setHolidayCache(holidays); }, [holidays]);

  const offsets = useMemo(() => offsetsFromSettings(settings), [settings]);
  const aviamentoOffset = settings.find((s) => s.sector === 'Aviamento')?.start_offset_days ?? offsets.mesa ?? 0;
  const cabedalOffset = settings.find((s) => s.sector === 'Costura Cabedal')?.start_offset_days ?? offsets.costura_cabedal ?? 0;

  const ops: EarlyReleaseOp[] = useMemo(() => queue.map((row) => ({
    order_id: row.order_id,
    order_number: row.order_number,
    reference_id: row.reference_id || '',
    reference_name: row.reference_name,
    photo_url: row.reference_photo_url,
    color: row.color,
    quantity: Number(row.remaining_pairs_net || row.quantity || 0),
    planned_delivery: row.due_date,
    sale_order_id: row.sale_order_id,
    sale_order_number: row.sale_order_number,
  })), [queue]);

  const refIds = useMemo(() => [...new Set(ops.map((o) => o.reference_id).filter(Boolean))], [ops]);

  const { data: sheetMap } = useQuery({
    queryKey: ['antecipacao-sheets', refIds],
    enabled: refIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, Record<string, unknown>>();
      const { data } = await supabase
        .from('technical_sheets')
        .select('id, name, code, image_url, shoe_category, production_sectors, corte_palmilha_capacity_per_day, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, costura_cabedal_capacity_per_day, costura_palmilha_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, expedition_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_expedicao_dias, requires_cutting, requires_sewing')
        .in('id', refIds);
      for (const s of data ?? []) {
        map.set(s.id, s as unknown as Record<string, unknown>);
      }
      return map;
    },
  });

  const { data: categoryDefaultsMap } = useQuery({
    queryKey: ['antecipacao-dlt'],
    staleTime: 5 * 60_000,
    queryFn: () => fetchCategoryDefaultsMap(),
  });

  const { data: schedule = [], isLoading: loadingSchedule } = useQuery({
    queryKey: ['production_schedule_ops', 'antecipacao'],
    staleTime: 60_000,
    queryFn: async () => {
      await loadHolidayCache();
      const from = todayISO();
      return fetchAllPages<EarlyReleaseScheduleRow>((fromIdx, toIdx) =>
        supabase
          .from('production_schedule')
          .select('order_id, sector, date, planned_pairs')
          .in('sector', ['Aviamento', 'Mesa', 'Costura Cabedal', 'Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Corte Cabedal'])
          .gte('date', from)
          .order('date')
          .order('order_id')
          .range(fromIdx, toIdx),
      );
    },
  });

  const board = useMemo(() => buildEarlyReleaseBoard({
    ops,
    schedule,
    sheetMap: sheetMap ?? new Map(),
    categoryDefaultsMap,
    offsets,
  }), [ops, schedule, sheetMap, categoryDefaultsMap, offsets]);

  const filtered = useMemo(() => {
    const term = q.trim();
    if (!term) return board.rows;
    return board.rows.filter((row) =>
      searchMatchesAllTerms(term, row.reference_name, row.colors.join(' '), row.opNumbers.join(' ')),
    );
  }, [board.rows, q]);

  const loading = loadingQueue || loadingSchedule;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ANTECIPAÇÃO"
        title="Antecipação"
        description="Aviamento e Costura Cabedal começam antes do pedido entrar em produção. Cada linha é uma referência — pares somados, não por pedido."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-9 gap-2" asChild>
              <Link to="/producao/setores">
                <SlidersIcon className="h-4 w-4" />
                Setores
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-2"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
            >
              <RefreshCw className={cn('h-4 w-4', recompute.isPending && 'animate-spin')} />
              Recalcular fila
            </Button>
          </div>
        }
      />

      <StatGrid>
        <StatCard label="Referências" value={fmtPairs(board.totals.references)} icon={Scissors} />
        <StatCard label="Pares na fila" value={fmtPairs(board.totals.pairs)} hint={`${board.totals.ops} OPs`} />
        <StatCard label="Aviamento" value={fmtPairs(board.totals.aviamentoPairs)} unit="pares" icon={Hand} />
        <StatCard label="Costura Cabedal" value={fmtPairs(board.totals.cabedalPairs)} unit="pares" icon={Pen} />
        <StatCard label="Na frente" value={board.totals.avgDaysAhead} unit="dias" hint="média das refs antecipadas" icon={Clock} />
      </StatGrid>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OffsetField
          label="Aviamento"
          value={aviamentoOffset}
          icon={Hand}
          disabled={!canEditOffset}
          onSave={(n) => update.mutate({ sector: 'Aviamento', start_offset_days: n })}
        />
        <OffsetField
          label="Costura Cabedal"
          value={cabedalOffset}
          icon={Pen}
          disabled={!canEditOffset}
          onSave={(n) => update.mutate({ sector: 'Costura Cabedal', start_offset_days: n })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-[hsl(var(--stage-assy-fg))]" /> Aviamento</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-[hsl(var(--stage-sew-fg))]" /> Costura Cabedal</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-[hsl(var(--stage-cut-fg))]" /> Cortes (produção)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-foreground" /> Hoje</span>
      </div>

      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Buscar referência, cor ou OP"
        resultCount={filtered.length}
        totalCount={board.rows.length}
        className="max-w-md"
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Clock}
          title={q.trim() ? 'Nada combina com a busca' : 'Nenhuma OP na fila'}
          description={q.trim()
            ? 'Tente outro nome, cor ou número de OP.'
            : 'Quando houver pedido na fila, Aviamento e Costura Cabedal aparecem aqui — na frente dos cortes.'}
        />
      ) : (
        <div className="space-y-3">
          <div className="hidden sm:block sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-4 pt-1 pb-1 border-b border-border">
            <div className="grid grid-cols-[7.5rem_6.5rem_1fr_4.5rem] gap-x-2 items-end">
              <span />
              <span />
              <HorizonAxis start={board.horizonStart} end={board.horizonEnd} today={today} />
              <span />
            </div>
          </div>
          {filtered.map((row) => (
            <ReferenceCard
              key={row.reference_id}
              row={row}
              horizonStart={board.horizonStart}
              horizonEnd={board.horizonEnd}
              today={today}
            />
          ))}
        </div>
      )}
    </div>
  );
}
