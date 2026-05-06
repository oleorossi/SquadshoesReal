import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, Clock, Layers, Timer, TrendingUp, CalendarDays } from 'lucide-react';
import type { SectorBoardRow, ProductionStage } from '@/types/production-waves';
import { STAGE_LABEL } from '@/types/production-waves';
import { useAdvanceStage } from '@/hooks/useProductionWaves';
import { MesaCapacityDialog } from './MesaCapacityDialog';
import { cn } from '@/lib/utils';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STAGE_COLORS: Record<ProductionStage, string> = {
  corte_palmilha: 'border-warning/40 bg-warning/5',
  corte_forracao: 'border-primary/40 bg-primary/5',
  mesa:           'border-purple-500/40 bg-purple-500/5',
  silk:           'border-cyan-500/40 bg-cyan-500/5',
  colagem:        'border-orange-500/40 bg-orange-500/5',
  montagem:       'border-info/40 bg-info/5',
  solagem:        'border-success/40 bg-success/5',
  acabamento:     'border-destructive/40 bg-destructive/5',
  expedicao:      'border-emerald-500/40 bg-emerald-500/5',
  // legacy aliases
  corte:    'border-warning/40 bg-warning/5',
  palmilha: 'border-blue-500/40 bg-blue-500/5',
  costura:  'border-primary/40 bg-primary/5',
};

export function SectorColumn({
  row, onOpenWave,
}: {
  row: SectorBoardRow;
  onOpenWave: (waveId: string) => void;
}) {
  const advance = useAdvanceStage();
  const [mesaDialogOpen, setMesaDialogOpen] = useState(false);
  const cls = STAGE_COLORS[row.stage];
  const isAuto = row.active_wave?.start_mode === 'auto';
  const isMesa = row.stage === 'mesa';

  // Mesa capacity info (only when this column is Mesa with an active wave)
  const cap = row.active_wave?.capacity_per_day ?? 0;
  const totalPairs = row.active_wave?.total_pairs ?? 0;
  const daysNeeded = cap > 0 ? Math.ceil(totalPairs / cap) : null;
  const availDate = daysNeeded != null && row.active_wave?.started_at
    ? addDays(new Date(row.active_wave.started_at), daysNeeded)
    : daysNeeded != null
    ? addDays(new Date(), daysNeeded)
    : null;

  return (
    <Card className={`p-3 border-2 ${cls} min-h-[260px]`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold">
          <Layers className="w-4 h-4" />
          {STAGE_LABEL[row.stage]}
        </div>
        <Badge variant="outline" className="text-xs">#{row.ord}</Badge>
      </div>

      {/* onda ativa */}
      {row.active_wave ? (
        <div
          className={cn(
            'rounded-md p-3 border mb-2 shadow-sm cursor-pointer',
            isMesa
              ? 'bg-purple-500/5 border-purple-500/30 hover:ring-2 hover:ring-purple-400/40'
              : isAuto
              ? 'bg-amber-500/5 border-amber-500/30 hover:ring-2 hover:ring-amber-400/40'
              : 'bg-card border hover:ring-2 hover:ring-primary/40',
          )}
          onClick={() => onOpenWave(row.active_wave!.wave_id)}
        >
          <div className="flex items-center justify-between">
            <span className={cn('font-bold', isMesa ? 'text-purple-600' : isAuto ? 'text-amber-600' : 'text-primary')}>
              {row.active_wave.code}
            </span>
            <Badge
              className={cn(
                isMesa
                  ? 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                  : isAuto
                  ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  : 'bg-primary/10 text-primary border-primary/20',
              )}
            >
              {isAuto && !isMesa ? (
                <><Timer className="w-3 h-3 mr-1" /> Auto</>
              ) : (
                'Em execução'
              )}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Semana {row.active_wave.week_start} · {row.active_wave.total_pairs} pares
          </div>
          <div className="h-2 bg-muted rounded mt-2 overflow-hidden">
            <div
              className={cn('h-full', isMesa ? 'bg-purple-500' : isAuto ? 'bg-amber-500' : 'bg-primary')}
              style={{ width: `${row.active_wave.progress_pct}%` }}
            />
          </div>
          <div className="text-[10px] text-right text-muted-foreground mt-1">
            {row.active_wave.progress_pct.toFixed(0)}%
          </div>

          {/* Mesa capacity info */}
          {isMesa && (
            <div className="mt-2 rounded border border-purple-500/20 bg-purple-500/5 p-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Ritmo</span>
                <span className="font-semibold text-purple-600">
                  {cap > 0 ? `${cap} pares/dia` : '— não definido'}
                </span>
              </div>
              {daysNeeded != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Dias necessários</span>
                  <span className="font-semibold">{daysNeeded}d</span>
                </div>
              )}
              {availDate && (
                <div className="flex items-center gap-1 text-xs text-purple-600 font-medium">
                  <CalendarDays className="w-3 h-3" />
                  Disponível p/ próx. setor: {format(availDate, "dd/MM", { locale: ptBR })}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs border-purple-500/30 text-purple-600 hover:bg-purple-500/10 mt-1"
                onClick={(e) => { e.stopPropagation(); setMesaDialogOpen(true); }}
              >
                <TrendingUp className="w-3 h-3 mr-1" /> Aumentar capacidade
              </Button>
            </div>
          )}

          <Button
            size="sm"
            className={cn(
              'w-full mt-2',
              isMesa
                ? 'bg-purple-500 hover:bg-purple-600 text-white'
                : isAuto && 'bg-amber-500 hover:bg-amber-600 text-white',
            )}
            onClick={(e) => {
              e.stopPropagation();
              advance.mutate({ waveId: row.active_wave!.wave_id, stage: row.stage });
            }}
            disabled={advance.isPending}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            Finalizar setor
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      ) : (
        <div className="text-center py-6 text-xs text-muted-foreground italic">
          Nenhuma onda em execução
        </div>
      )}

      {/* próxima onda aguardando */}
      {row.next_wave && (
        <div className="text-xs p-2 bg-card/60 border border-dashed rounded flex items-center gap-2">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span>Na fila: <strong>{row.next_wave.code}</strong></span>
        </div>
      )}

      {/* contador de concluídas */}
      {row.completed_count > 0 && (
        <div className="text-[10px] text-muted-foreground mt-2 text-right">
          {row.completed_count} onda(s) já concluída(s) neste setor
        </div>
      )}

      {/* Mesa capacity dialog */}
      {isMesa && row.active_wave && (
        <MesaCapacityDialog
          open={mesaDialogOpen}
          onOpenChange={setMesaDialogOpen}
          waveId={row.active_wave.wave_id}
          waveCode={row.active_wave.code}
          totalPairs={row.active_wave.total_pairs}
          currentCapacity={cap}
          startedAt={row.active_wave.started_at}
        />
      )}
    </Card>
  );
}
