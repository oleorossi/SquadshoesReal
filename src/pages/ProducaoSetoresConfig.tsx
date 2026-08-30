import { useState } from 'react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DotsSixVertical as GripVertical,
  Factory,
  Users,
  ArrowsCounterClockwise as RefreshCw,
  Info,
} from '@phosphor-icons/react';
import {
  useSectorSettings, useUpdateSectorSetting, useRecomputeSchedule,
  useLastEngineRun, useEnsureFreshSchedule, SectorSetting,
} from '@/hooks/useProductionEngine';
import { useCan } from '@/hooks/useAccessControl';
import { toast } from 'sonner';
import { SectorTeamPanel } from '@/components/production/SectorTeamPanel';
import { PlanningCapacityComparison } from '@/components/production/PlanningCapacityComparison';

/**
 * Tela SETORES (R1) — a configuração CENTRAL da produção. O que está aqui é a
 * regra GLOBAL do motor dinâmico: fluxo (ordem + paralelismo + liga/desliga),
 * capacidade em pares/dia, equipe (informativa) e regras de transição.
 * A ficha técnica preenchida SOBREPÕE por referência (R1.3).
 * Salvar recalcula TODAS as OPs abertas na hora (R1.4 — trigger no banco).
 */
export default function ProducaoSetoresConfig() {
  const { data: sectors = [], isLoading } = useSectorSettings();
  const update = useUpdateSectorSetting();
  const recompute = useRecomputeSchedule();
  const { data: lastRun } = useLastEngineRun();
  const canEdit = useCan('/producao/setores').canEdit;
  useEnsureFreshSchedule();

  const [dragSector, setDragSector] = useState<string | null>(null);

  // Drag pra reordenar o fluxo (DnD nativo, mesmo padrão da sidebar/TaskBoard).
  // flow_order regravado em passos de 10 pra toda a lista após o drop.
  const handleDrop = async (targetSector: string) => {
    if (!dragSector || dragSector === targetSector) return;
    const ordered = [...sectors].sort((a, b) => a.flow_order - b.flow_order);
    const fromIdx = ordered.findIndex(s => s.sector === dragSector);
    const toIdx = ordered.findIndex(s => s.sector === targetSector);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    setDragSector(null);
    try {
      // Regrava só os que mudaram de posição (cada update dispara recompute;
      // o advisory lock serializa e o último vence — custo aceitável pra 10 rows)
      await Promise.all(
        ordered.map((s, i) => {
          const newOrder = (i + 1) * 10;
          return s.flow_order === newOrder
            ? Promise.resolve()
            : update.mutateAsync({ sector: s.sector, flow_order: newOrder });
        }),
      );
    } catch {
      // toast de erro já emitido pela mutation
    }
  };

  const saveCapacity = (s: SectorSetting, value: number) => {
    if (!Number.isFinite(value) || value < 1) {
      toast.error('Capacidade precisa ser um número maior que zero.');
      return;
    }
    if (value !== s.daily_capacity_pairs) {
      update.mutate({ sector: s.sector, daily_capacity_pairs: Math.round(value) });
    }
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · SETORES"
        title="Setores"
        description="Regra global do motor: fluxo, capacidade e regras por setor. Ficha técnica preenchida sobrepõe por referência; salvar recalcula todas as OPs abertas na hora."
        actions={
          <Button
            variant="outline"
            className="h-9 gap-2"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
            Recalcular fila
          </Button>
        }
      />

      {lastRun && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Último recálculo: {new Date(lastRun.ran_at).toLocaleString('pt-BR')} ·{' '}
          {lastRun.queue_size} OPs · {lastRun.scheduled_pairs?.toLocaleString('pt-BR')} pares-etapa ·{' '}
          {lastRun.duration_ms}ms · gatilho: {lastRun.triggered_by}
        </p>
      )}

      {/* Painel ÚNICO de Equipe (R1) — idêntico ao do botão Equipe em
          Produtividade por Modelo, gravando no mesmo campo. */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="display text-sm uppercase tracking-wide mb-3">Equipe por setor</h2>
          <SectorTeamPanel />
        </CardContent>
      </Card>

      {/* R10: capacidade derivada × a que o Planejamento usa hoje, antes de trocar. */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="display text-sm uppercase tracking-wide mb-3">Capacidade do Planejamento — hoje × derivada</h2>
          <PlanningCapacityComparison />
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {[...sectors].sort((a, b) => a.flow_order - b.flow_order).map((s, idx) => (
            <Card
              key={s.sector}
              className={`transition-opacity ${dragSector === s.sector ? 'opacity-40' : ''} ${!s.enabled ? 'bg-muted/30' : ''}`}
              draggable={canEdit}
              onDragStart={e => {
                setDragSector(s.sector);
                e.dataTransfer.setData('text/sector', s.sector);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragSector(null)}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={e => { e.preventDefault(); handleDrop(s.sector); }}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 min-w-[220px]">
                    {canEdit && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
                    <span className="font-mono text-xs text-muted-foreground w-6">{String(idx + 1).padStart(2, '0')}</span>
                    <Factory className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className={`font-semibold text-sm ${!s.enabled ? 'text-muted-foreground line-through' : ''}`}>
                      {s.sector}
                    </span>
                    {s.parallel_group && (
                      <Badge variant="outline" className="text-[10px] uppercase">‖ {s.parallel_group}</Badge>
                    )}
                  </div>

                  {/* Capacidade pares/dia (R1.2 — número direto, decisão do dono) */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      defaultValue={s.daily_capacity_pairs}
                      key={`${s.sector}-${s.daily_capacity_pairs}`}
                      onBlur={e => saveCapacity(s, Number(e.target.value))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      disabled={!canEdit}
                      className="h-8 w-24 font-mono text-right"
                    />
                    <span className="text-xs text-muted-foreground">pares/dia</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      defaultValue={s.start_offset_days ?? 0}
                      key={`${s.sector}-offset-${s.start_offset_days ?? 0}`}
                      onBlur={e => {
                        const value = Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0)));
                        if (value !== (s.start_offset_days ?? 0)) {
                          update.mutate({ sector: s.sector, start_offset_days: value });
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      disabled={!canEdit}
                      className="h-8 w-16 font-mono text-right"
                      aria-label={`Dias de antecipação de ${s.sector}`}
                    />
                    <span className="text-xs text-muted-foreground">dias antes</span>
                  </div>

                  <div className="flex items-center gap-4 ml-auto">
                    {/* Regras de transição (R6.3) — avisam + pedem confirmação, nunca travam */}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <Switch
                        checked={s.check_prev_sector_limit}
                        onCheckedChange={v => update.mutate({ sector: s.sector, check_prev_sector_limit: v })}
                        disabled={!canEdit}
                      />
                      Limite do setor anterior
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <Switch
                        checked={s.check_material_reserved}
                        onCheckedChange={v => update.mutate({ sector: s.sector, check_material_reserved: v })}
                        disabled={!canEdit}
                      />
                      Material reservado
                    </label>
                    {/* Liga/desliga do fluxo global (R1.5: ficha com override mantém o setor) */}
                    <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={v => update.mutate({ sector: s.sector, enabled: v })}
                        disabled={!canEdit}
                      />
                      {s.enabled ? 'Ativo' : 'Inativo'}
                    </label>
                  </div>
                </div>

                {/* Anotações da equipe */}
                <div className="mt-2 pl-8">
                  <Input
                    placeholder="Equipe / observações do setor (informativo)..."
                    defaultValue={s.team_notes ?? ''}
                    key={`${s.sector}-notes-${s.team_notes}`}
                    onBlur={e => {
                      const v = e.target.value.trim() || null;
                      if (v !== s.team_notes) update.mutate({ sector: s.sector, team_notes: v });
                    }}
                    disabled={!canEdit}
                    className="h-8 text-xs"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Setores marcados com ‖ rodam em paralelo (preparação). A ordem daqui define o fluxo
        de toda OP cuja ficha técnica não tem a parte de setores preenchida — quando tem,
        vale a ficha (badge "ficha" no Planejamento e no Kanban). “Dias antes” antecipa o
        setor no planejamento (Aviamento e Costura Cabedal saem antes do PV entrar em
        produção); 0 = espera o bloco anterior. O chão (apontamento) não muda.
      </p>
    </div>
  );
}
