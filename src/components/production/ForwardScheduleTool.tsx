import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  computeForwardSchedule, setHolidayCache, checkSectorCapacity, SECTOR_LABELS,
  fetchCategoryDefaultsMap, categoryDefaultsFor,
} from '@/lib/sectorCapacity';
import { useHolidays } from '@/hooks/useTimesheet';
import { Panel } from '@/components/ui/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, CalendarCheck, Clock, Warning } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** YYYY-MM-DD local de hoje. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmt = (iso: string) => {
  try { return format(parseISO(iso), "dd 'de' MMM", { locale: ptBR }); } catch { return iso; }
};
const fmtFull = (iso: string) => {
  try { return format(parseISO(iso), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR }); } catch { return iso; }
};

/**
 * Agendamento PRA FRENTE (B1): "se eu começar a produzir HOJE (ou na data X),
 * quando entrego?". Dual da cascata reversa do PCP — reaproveita o MESMO motor
 * (computeForwardSchedule, que espelha computeParallelWindows/compute_wave_timeline:
 * prep paralelo Corte Palmilha ‖ Corte Forração ‖ Aviamento → Costura → … →
 * Acabamento). É advisory: NÃO altera a onda persistida nem as datas de compra.
 */
export function ForwardScheduleTool() {
  const { data: holidays } = useHolidays();
  useEffect(() => { setHolidayCache(holidays); }, [holidays]);

  const { data: sheets = [] } = useQuery({
    queryKey: ['forward-schedule-sheets'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code, shoe_category, production_sectors, sewing_capacity_per_day, cutting_capacity_per_day, costura_capacity_per_day, costura_palmilha_capacity_per_day, costura_cabedal_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day, gluing_capacity_per_day, assembly_capacity_per_day, soling_capacity_per_day, finishing_capacity_per_day, expedition_capacity_per_day, lead_time_expedicao_dias, requires_cutting, requires_sewing')
        .order('name');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // F1-05: fallback de capacidade por categoria (default_lead_times) — mesma
  // cadeia ficha > categoria do motor de ondas (compute_wave_timeline). Sem isso
  // a projeção caía no lead legado quando a ficha não tem capacidade própria.
  const { data: categoryDefaultsMap } = useQuery({
    queryKey: ['category-default-lead-times'],
    staleTime: 5 * 60_000,
    queryFn: () => fetchCategoryDefaultsMap(),
  });

  const [sheetId, setSheetId] = useState<string>('');
  const [qty, setQty] = useState<number>(600);
  const [startISO, setStartISO] = useState<string>(todayISO());

  // Seleciona a 1ª ficha quando carrega.
  useEffect(() => {
    if (!sheetId && sheets.length > 0) setSheetId(sheets[0].id);
  }, [sheets, sheetId]);

  const sheet = useMemo(() => sheets.find((s) => s.id === sheetId), [sheets, sheetId]);

  const schedule = useMemo(() => {
    if (!sheet || qty <= 0 || !startISO) return null;
    const d = new Date(startISO + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return computeForwardSchedule(sheet, qty, d, {}, categoryDefaultsFor(sheet, categoryDefaultsMap));
  }, [sheet, qty, startISO, categoryDefaultsMap]);

  // B2 (advisory, capacidade finita): checa se algum setor JÁ está sobrecarregado
  // na janela projetada (carga das outras OPs ativas), reusando o MESMO motor
  // checkSectorCapacity. A entrega-lead-time acima é "capacidade infinita"; isto
  // avisa quando a realidade da fila pode empurrar a data.
  const { data: capCheck } = useQuery({
    queryKey: ['forward-capcheck', sheetId, qty, schedule?.finishISO],
    enabled: !!sheet && qty > 0 && !!schedule,
    staleTime: 60_000,
    queryFn: () => checkSectorCapacity(
      [{ reference_id: sheetId, reference_label: sheet!.name, quantity: qty }],
      schedule!.finishISO,
    ),
  });

  return (
    <Panel
      eyebrow="PCP · CRONOGRAMA DIRETO"
      title="Se começar hoje, entrega quando?"
      subtitle="Projeção pra frente reusando o motor da cascata (prep paralelo → Costura → … → Acabamento). Advisory — não altera a onda nem as datas de compra."
      bodyClassName="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Referência</Label>
          <Select value={sheetId} onValueChange={setSheetId}>
            <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Selecione a referência" /></SelectTrigger>
            <SelectContent>
              {sheets.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Quantidade (pares)</Label>
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value)))} className="h-9 mt-1 font-mono" />
        </div>
        <div>
          <Label className="text-xs">Início da produção</Label>
          <Input type="date" value={startISO} onChange={(e) => setStartISO(e.target.value || todayISO())} className="h-9 mt-1" />
        </div>
      </div>

      {!schedule ? (
        <p className="text-sm text-muted-foreground">Selecione uma referência, quantidade e data de início.</p>
      ) : schedule.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta ficha não tem setores de produção cadastrados.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <CalendarCheck className="h-5 w-5 text-emerald-600 shrink-0" weight="fill" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Entrega estimada</p>
              <p className="text-base font-bold text-foreground">{fmtFull(schedule.finishISO)}</p>
            </div>
            <Badge variant="outline" className="ml-auto gap-1 text-xs"><Clock className="h-3 w-3" /> {schedule.totalBusinessDays} dias úteis</Badge>
          </div>

          <div className="space-y-1.5">
            {schedule.steps.map((s) => (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 font-medium text-foreground">{s.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{fmt(s.startISO)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-foreground">{fmt(s.endISO)}</span>
                <Badge variant="secondary" className="ml-auto text-[10px] font-mono">{s.leadDays}d</Badge>
              </div>
            ))}
          </div>
          {capCheck?.hasOverload && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <Warning className="h-4 w-4 shrink-0" weight="fill" />
                <span className="text-xs font-semibold uppercase tracking-wider">Capacidade apertada nessa janela</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A data acima assume capacidade livre. Com a carga das outras OPs ativas, estes setores estouram
                a capacidade na janela — a entrega real pode atrasar:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {capCheck.overloads.map((o, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400 border-amber-500/40">
                    {SECTOR_LABELS[o.sector] ?? o.sector}: +{o.shortfall_pairs}p
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Os 3 setores de preparação (Corte Palmilha · Corte Forração · Aviamento) rodam em paralelo;
            a Costura só arranca quando o último deles termina. Lead time de cada setor = ⌈pares ÷ capacidade/dia⌉.
          </p>
        </>
      )}
    </Panel>
  );
}
