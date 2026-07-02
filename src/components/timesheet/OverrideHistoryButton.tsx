/**
 * Botão + Popover que mostra histórico de ajustes manuais (overrides) feitos
 * num time_record específico. Cumpre o requisito do plano de migração de
 * ponto (§4.4): "Toda alteração manual é registrada com usuário, data e
 * justificativa (trilha de auditoria)."
 *
 * Dados vêm de public.time_record_manual_overrides (criada na migration
 * canonical Opção C — 20260613120000).
 */
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClockCounterClockwise as History, User } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { EmptyState } from '@/components/ui/empty-state';

interface ManualOverrideRow {
  id: string;
  added_punch: string;
  position: number;
  reason: string;
  created_at: string;
  created_by: string | null;
  punches_before: string[] | null;
  punches_after: string[] | null;
}

interface UserBrief {
  email: string | null;
  raw_user_meta_data?: { full_name?: string } | null;
}

interface Props {
  timeRecordId: string;
  /** Texto do botão. Default: "Histórico". */
  label?: string;
}

function fmtDt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OverrideHistoryButton({ timeRecordId, label = 'Histórico' }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['time-record-overrides', timeRecordId],
    queryFn: async (): Promise<ManualOverrideRow[]> => {
      const { data, error } = await (supabase as any)
        .from('time_record_manual_overrides')
        .select('*')
        .eq('time_record_id', timeRecordId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ManualOverrideRow[];
    },
    staleTime: 30_000,
  });

  const count = data?.length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground">
          <History className="h-3 w-3" />
          {label}
          {count > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] tabular-nums">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-1rem))] p-0" align="end">
        <div className="px-4 py-3 border-b border-border bg-muted/40">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Trilha de Auditoria
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ajustes manuais neste dia, mais recente primeiro.
          </p>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-xs text-muted-foreground">Carregando…</div>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nenhum ajuste manual"
              description="Este dia ainda não recebeu intervenção pelo RH."
              size="sm"
            />
          ) : (
            <ul className="divide-y divide-border/50">
              {data.map((row) => (
                <li key={row.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-mono tabular-nums font-bold text-foreground">
                      + {row.added_punch}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {fmtDt(row.created_at)}
                    </span>
                  </div>
                  {row.reason && (
                    <p className="text-xs text-foreground/90 leading-snug">
                      <span className="text-muted-foreground">Motivo:</span> {row.reason}
                    </p>
                  )}
                  {row.punches_before && row.punches_after && (
                    <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-muted-foreground">
                      <span>antes: [{(row.punches_before || []).join(', ') || '—'}]</span>
                      <span>→</span>
                      <span className="text-foreground">depois: [{(row.punches_after || []).join(', ') || '—'}]</span>
                    </div>
                  )}
                  {row.created_by && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span className="font-mono tabular-nums truncate" title={row.created_by}>
                        {row.created_by.slice(0, 8)}…
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
