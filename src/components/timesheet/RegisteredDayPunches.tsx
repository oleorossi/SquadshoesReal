import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  buildRegisteredDayLines,
  dayPunchContext,
  formatExpectedJourney,
  formatNeighborDayLine,
  missingSlotKeys,
  missingSlotLabel,
  type JourneySchedule,
  type PunchOverrideAudit,
} from '@/lib/ponto/registeredDayPunches';

export interface NeighborDayRef {
  date: string;
  /** null = não há linha de ponto nesse dia. */
  punches: string[] | null;
}

interface Props {
  timeRecordId?: string | null;
  punches: string[];
  schedule: JourneySchedule;
  dateStr: string;
  holidayName: string | null;
  previous: NeighborDayRef | null;
  next: NeighborDayRef | null;
}

/**
 * O que o relógio (e os ajustes anteriores) já gravaram neste dia,
 * mais a jornada prevista e o dia útil vizinho — só leitura.
 */
export function RegisteredDayPunches({
  timeRecordId,
  punches,
  schedule,
  dateStr,
  holidayName,
  previous,
  next,
}: Props) {
  const { data: overrides = [] } = useQuery({
    queryKey: ['time-record-overrides', timeRecordId],
    enabled: !!timeRecordId,
    staleTime: 30_000,
    queryFn: async (): Promise<PunchOverrideAudit[]> => {
      const { data, error } = await supabase
        .from('time_record_manual_overrides')
        .select('*')
        .eq('time_record_id', timeRecordId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PunchOverrideAudit[];
    },
  });

  const authorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of overrides) {
      if (row.created_by) ids.add(row.created_by);
    }
    return [...ids].sort();
  }, [overrides]);

  const { data: authors = {} } = useQuery({
    queryKey: ['punch-override-authors', authorIds.join(',')],
    enabled: authorIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data || []) {
        const name = String(row.full_name || '').trim();
        if (name) map[row.id] = name;
      }
      return map;
    },
  });

  const ctx = dayPunchContext(schedule, dateStr, holidayName);
  const lines = buildRegisteredDayLines(punches, ctx, overrides, authors);
  const journey = formatExpectedJourney(schedule, dateStr, holidayName);
  const missing = missingSlotKeys(punches, ctx).map(missingSlotLabel);
  const empty = lines.length === 0;

  return (
    <section
      aria-label="Batidas registradas no dia"
      className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Batidas registradas no dia
      </p>
      <p className="text-xs">
        <span className="text-muted-foreground">Jornada prevista </span>
        <span className="font-mono tabular-nums text-foreground">{journey}</span>
      </p>
      {empty ? (
        <p className="text-sm text-muted-foreground">Nenhuma batida registrada</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((line, index) =>
            line.type === 'gap' ? (
              <li
                key={`gap-${line.label}-${index}`}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {line.label}
              </li>
            ) : (
              <li key={`${line.punch.hhmm}-${index}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-mono tabular-nums font-semibold text-foreground">{line.punch.hhmm}</span>
                <span className="text-right text-[11px] text-muted-foreground">
                  {line.punch.originLabel}
                  {line.punch.authorName ? ` · ${line.punch.authorName}` : ''}
                  {line.punch.whenLabel ? ` · ${line.punch.whenLabel}` : ''}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {empty && missing.length > 0 && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          faltando: {missing.join(', ')}
        </p>
      )}
      {(previous || next) && (
        <div className="space-y-0.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          {previous && (
            <p>
              <span className="uppercase tracking-wide">Dia útil anterior</span>
              {' · '}
              <span className="font-mono tabular-nums">{formatNeighborDayLine(previous.date, previous.punches)}</span>
            </p>
          )}
          {next && (
            <p>
              <span className="uppercase tracking-wide">Dia útil seguinte</span>
              {' · '}
              <span className="font-mono tabular-nums">{formatNeighborDayLine(next.date, next.punches)}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
