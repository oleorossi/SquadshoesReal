import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock, Hand, Pen, Scissors, Sliders as SlidersIcon,
  ArrowsCounterClockwise as RefreshCw, FileXls, ListChecks, Stack as Layers,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { todayISO, safeFormatBR } from '@/lib/date';
import { fetchAllPages } from '@/lib/supabasePaginate';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useSectorSettings, useUpdateSectorSetting, useRecomputeSchedule,
  useEnsureFreshSchedule, useProductionQueueDetail,
} from '@/hooks/useProductionEngine';
import { useCan } from '@/hooks/useAccessControl';
import { useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  fetchCategoryDefaultsMap, offsetsFromSettings, loadHolidayCache, setHolidayCache,
} from '@/lib/sectorCapacity';
import { useHolidays } from '@/hooks/useTimesheet';
import { fetchCanonicalConsumptionReport } from '@/lib/canonicalConsumptionReport';
import { formatUnitLabel } from '@/lib/unitLabels';
import { toast } from 'sonner';
import {
  buildEarlyReleaseBoard,
  type EarlyReleaseOp, type EarlyReleaseScheduleRow, type EarlyReleaseRow,
} from '@/lib/earlyReleaseBoard';
import {
  buildAviamentoSummaryRows, buildAntecipacaoMaterialRows, nestAntecipacaoMaterials,
  downloadAntecipacaoXlsx, type EarlyMaterialFact,
} from '@/lib/earlyReleaseExport';

const fmtPairs = (n: number) => n.toLocaleString('pt-BR');
const fmtDay = (iso: string | null) => safeFormatBR(iso, '—', 'dd/MM');
const laneText = (row: EarlyReleaseRow, key: EarlyReleaseRow['lanes'][number]['key']) => {
  const lane = row.lanes.find((l) => l.key === key);
  if (!lane?.start) return '—';
  return `${fmtDay(lane.start)} → ${fmtDay(lane.end)}`;
};

function OrderChips({ pvs, clients }: { pvs: string[]; clients: string[] }) {
  if (pvs.length === 0 && clients.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {pvs.map((n) => (
        <Badge key={`pv-${n}`} variant="mono" className="normal-case tracking-normal text-[11px]">
          {n}
        </Badge>
      ))}
      {clients.map((n) => (
        <Badge key={`cl-${n}`} variant="info" className="normal-case tracking-normal font-mono text-[11px]">
          Cliente {n}
        </Badge>
      ))}
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

async function loadMaterialFacts(orderIds: string[]): Promise<EarlyMaterialFact[]> {
  if (orderIds.length === 0) return [];
  const report = await fetchCanonicalConsumptionReport({ orderIds });
  return report.lines
    .filter((line) => line.line_kind !== 'packaging' && line.required > 0)
    .map((line) => ({
      order_id: line.scope_key,
      componentType: line.component,
      groupName: line.product_group_name || line.product_name,
      materialName: line.product_name,
      materialColor: line.product_color || line.color || '',
      quantity: line.required,
      unit: line.product_unit,
    }));
}

/**
 * Antecipação — Aviamento e Costura Cabedal contra o início da produção (cortes).
 * Agrupamento do Aviamento: referência + cor. PV e pedido do cliente em destaque.
 */
export default function ProducaoAntecipacao() {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const qc = useQueryClient();
  const { value: aba, setValue: setAba } = useUrlTabState({
    values: ['resumo', 'materiais'] as const,
    defaultValue: 'resumo',
  });
  const canEditOffset = useCan('/producao/setores').canEdit;
  const { data: settings = [] } = useSectorSettings();
  const update = useUpdateSectorSetting();
  const recompute = useRecomputeSchedule();
  const { data: queue = [], isLoading: loadingQueue } = useProductionQueueDetail();
  const { data: holidays = [] } = useHolidays();
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setHolidayCache(holidays); }, [holidays]);

  const offsets = useMemo(() => offsetsFromSettings(settings), [settings]);
  const aviamentoOffset = settings.find((s) => s.sector === 'Aviamento')?.start_offset_days ?? offsets.mesa ?? 0;
  const cabedalOffset = settings.find((s) => s.sector === 'Costura Cabedal')?.start_offset_days ?? offsets.costura_cabedal ?? 0;

  const soIds = useMemo(
    () => [...new Set(queue.map((row) => row.sale_order_id).filter((id): id is string => !!id))],
    [queue],
  );

  const { data: soMeta } = useQuery({
    queryKey: ['antecipacao-sale-orders', soIds],
    enabled: soIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, { order_number: string | null; client_order_number: string | null }>();
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_order_number')
        .in('id', soIds);
      if (error) throw error;
      for (const row of data ?? []) map.set(row.id, row);
      return map;
    },
  });

  const ops: EarlyReleaseOp[] = useMemo(() => queue.map((row) => {
    const so = row.sale_order_id ? soMeta?.get(row.sale_order_id) : undefined;
    return {
      order_id: row.order_id,
      order_number: row.order_number,
      reference_id: row.reference_id || '',
      reference_name: row.reference_name,
      photo_url: row.reference_photo_url,
      color: row.color,
      quantity: Number(row.remaining_pairs_net || row.quantity || 0),
      planned_delivery: row.due_date,
      sale_order_id: row.sale_order_id,
      sale_order_number: row.sale_order_number || so?.order_number || null,
      client_order_number: so?.client_order_number || null,
    };
  }), [queue, soMeta]);

  const opIds = useMemo(() => ops.map((o) => o.order_id).filter(Boolean), [ops]);
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

  const { data: materialFacts = [], isLoading: loadingMats } = useQuery({
    queryKey: ['antecipacao-consumo', opIds],
    enabled: aba === 'materiais' && opIds.length > 0,
    staleTime: 60_000,
    queryFn: () => loadMaterialFacts(opIds),
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
      searchMatchesAllTerms(
        term,
        row.reference_name,
        row.color,
        row.opNumbers.join(' '),
        row.pvNumbers.join(' '),
        row.clientOrderNumbers.join(' '),
      ),
    );
  }, [board.rows, q]);

  const materialRows = useMemo(
    () => buildAntecipacaoMaterialRows(ops, materialFacts),
    [ops, materialFacts],
  );

  const filteredMaterials = useMemo(() => {
    const term = q.trim();
    const allowed = new Set(filtered.map((r) => `${r.reference_name}::${r.color}`));
    const scoped = materialRows.filter((r) => allowed.has(`${r.reference_name}::${r.color}`));
    if (!term) return scoped;
    return scoped.filter((r) =>
      searchMatchesAllTerms(
        term,
        r.reference_name, r.color, r.componentType, r.sale_order_number,
        r.client_order_number, r.materialName, r.materialColor, r.opNumbers,
      ),
    );
  }, [materialRows, filtered, q]);

  const nested = useMemo(() => nestAntecipacaoMaterials(filteredMaterials), [filteredMaterials]);
  const loading = loadingQueue || loadingSchedule;

  const handleExport = async () => {
    setExporting(true);
    try {
      let facts = materialFacts;
      if (opIds.length > 0) {
        facts = await qc.fetchQuery({
          queryKey: ['antecipacao-consumo', opIds],
          queryFn: () => loadMaterialFacts(opIds),
          staleTime: 60_000,
        });
      }
      await downloadAntecipacaoXlsx({
        summary: buildAviamentoSummaryRows(filtered),
        materials: buildAntecipacaoMaterialRows(ops, facts).filter((r) =>
          filtered.some((g) => g.reference_name === r.reference_name && (g.color || '—') === r.color),
        ),
      });
      toast.success('Arquivo gerado.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao gerar o arquivo';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ANTECIPAÇÃO"
        title="Antecipação"
        description="Aviamento e Costura Cabedal começam antes dos cortes. Agrupamento do Aviamento: referência + cor. Pedido do sistema e pedido do cliente em destaque."
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
              onClick={handleExport}
              disabled={exporting || loading || filtered.length === 0}
            >
              <FileXls className={cn('h-4 w-4', exporting && 'animate-pulse')} />
              Exportar
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

      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Buscar referência, cor, PV, pedido cliente ou OP"
        resultCount={aba === 'resumo' ? filtered.length : nested.length}
        totalCount={aba === 'resumo' ? board.rows.length : nestAntecipacaoMaterials(materialRows).length}
        className="max-w-md"
      />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="resumo" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" />
            Aviamento ({filtered.length})
          </TabsTrigger>
          <TabsTrigger value="materiais" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Materiais
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-4 space-y-3">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={q.trim() ? 'Nada combina com a busca' : 'Nenhuma OP na fila'}
              description={q.trim()
                ? 'Tente referência, cor, PV, pedido do cliente ou OP.'
                : 'Quando houver pedido na fila, o Aviamento aparece aqui por referência e cor.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referência</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead>Pedido sistema</TableHead>
                  <TableHead>Pedido cliente</TableHead>
                  <TableHead>OPs</TableHead>
                  <TableHead>Aviamento</TableHead>
                  <TableHead>Costura Cabedal</TableHead>
                  <TableHead>Cortes</TableHead>
                  <TableHead className="text-right">Na frente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-semibold whitespace-nowrap">{row.reference_name}</TableCell>
                    <TableCell className="uppercase">{row.color || '—'}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtPairs(row.pairs)}</TableCell>
                    <TableCell>
                      <OrderChips pvs={row.pvNumbers} clients={[]} />
                    </TableCell>
                    <TableCell>
                      <OrderChips pvs={[]} clients={row.clientOrderNumbers} />
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[14rem] truncate" title={row.opNumbers.join(' · ')}>
                      {row.opNumbers.join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap">{laneText(row, 'aviamento')}</TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap">{laneText(row, 'cabedal')}</TableCell>
                    <TableCell className="font-mono text-[11px] whitespace-nowrap">{laneText(row, 'cortes')}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.daysAhead > 0 ? `${row.daysAhead}d` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="materiais" className="mt-4 space-y-3">
          {loading || loadingMats ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : nested.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={q.trim() ? 'Nada combina com a busca' : 'Sem material da antecipação'}
              description={q.trim()
                ? 'Tente outro nome, PV ou tipo de material.'
                : 'Cabedal, BOM, componente direto e tiras das OPs da fila aparecem aqui — agrupados por referência + cor, depois tipo, depois o mesmo pedido.'}
            />
          ) : (
            nested.map((group) => (
              <Card key={`${group.reference_name}::${group.color}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="font-semibold text-base">{group.reference_name}</h3>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">{group.color}</span>
                  </div>
                  {group.types.map((type) => (
                    <div key={type.componentType} className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{type.componentType}</p>
                      {type.orders.map((order) => (
                        <div key={`${order.sale_order_number}::${order.client_order_number}`} className="rounded-md border border-border p-3 space-y-2">
                          <OrderChips
                            pvs={order.sale_order_number ? [order.sale_order_number] : []}
                            clients={order.client_order_number ? [order.client_order_number] : []}
                          />
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Material</TableHead>
                                <TableHead>Cor</TableHead>
                                <TableHead className="text-right">Qtd</TableHead>
                                <TableHead>Un</TableHead>
                                <TableHead>OPs</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {order.lines.map((line, i) => (
                                <TableRow key={`${line.materialName}-${line.materialColor}-${i}`}>
                                  <TableCell>{line.materialName}</TableCell>
                                  <TableCell className="uppercase text-muted-foreground">{line.materialColor || '—'}</TableCell>
                                  <TableCell className="text-right font-mono tabular-nums">
                                    {line.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">{formatUnitLabel(line.unit)}</TableCell>
                                  <TableCell className="font-mono text-[11px] text-muted-foreground">{line.opNumbers || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
