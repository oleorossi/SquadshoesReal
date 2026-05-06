import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { NumberInput } from '@/components/ui/number-input';
import { Clock, Play, CheckCircle2, AlertTriangle, Timer, DollarSign, Lock, Scissors, Layers, Gem, Printer, Flame, Hammer, Footprints, Hand, Sparkles, Box, ScanSearch, PenLine, ClipboardList, Wind, LayoutGrid, Paintbrush, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OrderStage, useUpdateOrderStage, useOrderStages } from '@/hooks/useOrderStages';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

const STAGE_CONFIGS: Record<string, { color: string; icon: LucideIcon; hints: string }> = {
  // ── New sector names ───────────────────────────────────────────────────────
  'Corte Palmilha': { color: 'bg-orange-500/15 text-orange-700 border-orange-500/30', icon: Scissors,    hints: 'Separar palmilhas por numeração, conferir molde/faca, contar e identificar lotes.' },
  'Corte Forração': { color: 'bg-teal-500/15 text-teal-700 border-teal-500/30',       icon: Layers,      hints: 'Conferir cor de forração, cortar por cor e numeração, identificar peças por cor.' },
  'Mesa':           { color: 'bg-purple-500/15 text-purple-700 border-purple-500/30', icon: LayoutGrid,  hints: 'Receber palmilha forrada, montar tiras/cabedal, verificar alinhamento, registrar Frente e Traseiro.' },
  'Silk':           { color: 'bg-pink-500/15 text-pink-700 border-pink-500/30',       icon: Paintbrush,  hints: 'Verificar imagem do silk, conferir posicionamento e pressão antes de iniciar o lote.' },
  'Colagem':        { color: 'bg-amber-500/15 text-amber-700 border-amber-500/30',    icon: Wind,        hints: 'Verificar superfícies limpas, aplicar cola uniformemente, respeitar tempo de secagem, prensagem.' },
  'Montagem':       { color: 'bg-blue-500/15 text-blue-700 border-blue-500/30',       icon: Hammer,      hints: 'Conferir solado e palmilha, alinhar e montar casco, verificação visual do par.' },
  'Solagem':        { color: 'bg-lime-500/15 text-lime-700 border-lime-500/30',       icon: Footprints,  hints: 'Conferir solado e palmilha, aplicar cola, prensagem, verificar alinhamento e centragem.' },
  'Acabamento':     { color: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', icon: Sparkles, hints: 'Limpeza geral, verificar costuras e silk, aplicar etiqueta, embalagem individual, caixa identificada.' },
  'Expedição':      { color: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30', icon: Truck,       hints: 'Revisar par aprovado, conferir etiqueta de cliente, embalar por lote, gerar romaneio.' },
  // ── Legacy names (kept for backward compat with old OPs) ──────────────────
  'Corte':     { color: 'bg-blue-500/15 text-blue-700 border-blue-500/30',     icon: Scissors,   hints: 'Registrar quantidade de peças cortadas, tipo de faca utilizada, defeitos de corte.' },
  'Forração':  { color: 'bg-purple-500/15 text-purple-700 border-purple-500/30', icon: Layers,   hints: 'Registrar tipos de forro aplicados, verificar aderência e acabamento.' },
  'Aviamento': { color: 'bg-amber-500/15 text-amber-700 border-amber-500/30',   icon: Gem,        hints: 'Conferir aviamentos aplicados (fivelas, enfeites, ilhoses), registrar substituições.' },
  'Costura':   { color: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30', icon: PenLine,   hints: 'Verificar costuras, alinhamento e tensão da linha.' },
  'Embalagem': { color: 'bg-teal-500/15 text-teal-700 border-teal-500/30',      icon: Box,        hints: 'Embalar produto final, etiquetagem, conferência visual.' },
  'Inspeção':  { color: 'bg-rose-500/15 text-rose-700 border-rose-500/30',      icon: ScanSearch, hints: 'Inspeção de qualidade, registrar defeitos e aprovações.' },
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

interface Props {
  stage: OrderStage | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderNumber?: string;
}

export default function SectorStageDialog({ stage, open, onOpenChange, orderNumber }: Props) {
  const update = useUpdateOrderStage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    quantity_processed: 0,
    observations: '',
    defects: '',
    actual_time_minutes: 0,
  });

  // Load all stages for this order to check sequential constraint
  const { data: allStages = [] } = useOrderStages(stage?.order_id);

  // Determine if a previous stage is blocking this one from starting
  const blockingStage = (() => {
    if (!stage || stage.status !== 'pendente') return null;
    const prev = allStages
      .filter(s => s.stage_order < stage.stage_order)
      .sort((a, b) => b.stage_order - a.stage_order)[0];
    if (!prev || prev.status === 'concluido') return null;
    return prev;
  })();

  useEffect(() => {
    if (stage) {
      setForm({
        quantity_processed: stage.quantity_processed,
        observations: stage.observations || '',
        defects: stage.defects || '',
        actual_time_minutes: Number(stage.actual_time_minutes) || 0,
      });
    }
  }, [stage]);

  if (!stage) return null;

  const config = STAGE_CONFIGS[stage.stage_name] || { color: '', icon: ClipboardList, hints: '' };
  const StageIcon = config.icon;
  const pct = stage.quantity_total > 0 ? Math.round((form.quantity_processed / stage.quantity_total) * 100) : 0;

  const standardTime = Number(stage.standard_time_minutes) || 0;
  const costPerHour = Number(stage.cost_per_hour) || 0;
  const standardCostPerPair = Number(stage.cost_per_pair) || 0;
  const hasWipData = standardTime > 0 || costPerHour > 0;

  // Calculate actual cost per pair based on actual time
  const actualCostPerPair = form.actual_time_minutes > 0 && costPerHour > 0
    ? (form.actual_time_minutes / 60) * costPerHour
    : 0;
  const costVariance = actualCostPerPair > 0 ? actualCostPerPair - standardCostPerPair : 0;

  const handleStart = () => {
    update.mutate({
      id: stage.id,
      status: 'em_andamento',
      started_at: new Date().toISOString(),
      ...form,
    });
  };

  const handleSaveProgress = () => {
    update.mutate({ id: stage.id, ...form });
  };

  const handleComplete = async () => {
    try {
      await update.mutateAsync({
        id: stage.id,
        status: 'concluido',
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
        quantity_processed: form.quantity_processed,
        observations: form.observations,
        defects: form.defects,
        actual_time_minutes: form.actual_time_minutes,
      });

      // If completing Acabamento, advance order status to "Pronto" only when currently
      // "Em Produção" — prevents overwriting terminal statuses (Cancelada, Finalizado).
      if (stage.stage_name === 'Acabamento') {
        const now = new Date().toISOString();
        await supabase
          .from('orders')
          .update({ status: 'Pronto', updated_at: now })
          .eq('id', stage.order_id)
          .eq('status', 'Em Produção');
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      }

      onOpenChange(false);
    } catch {
      // update.mutateAsync already shows error toast via the mutation's onError
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <StageIcon className="h-5 w-5 shrink-0" />
            {stage.stage_name} — {orderNumber || 'OP'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Status badge */}
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`${config.color} text-xs`}>
              {stage.status === 'pendente' ? 'Pendente' : stage.status === 'em_andamento' ? 'Em Andamento' : 'Concluído'}
            </Badge>
            {stage.started_at && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Início: {new Date(stage.started_at).toLocaleString('pt-BR')}
              </span>
            )}
            {stage.completed_at && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                Fim: {new Date(stage.completed_at).toLocaleString('pt-BR')}
              </span>
            )}
          </div>

          {/* WIP Cost Info from BOM */}
          {hasWipData && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border p-2.5 bg-muted/30">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                  <Timer className="h-3 w-3" />
                  <span className="text-[10px] uppercase font-semibold">Tempo Padrão</span>
                </div>
                <span className="text-sm font-bold font-mono">{standardTime.toFixed(1)} min</span>
              </div>
              <div className="rounded-md border p-2.5 bg-muted/30">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-[10px] uppercase font-semibold">R$/hora</span>
                </div>
                <span className="text-sm font-bold font-mono">{formatCurrency(costPerHour)}</span>
              </div>
              <div className="rounded-md border p-2.5 bg-muted/30">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-[10px] uppercase font-semibold">Custo/Par</span>
                </div>
                <span className="text-sm font-bold font-mono text-primary">{formatCurrency(standardCostPerPair)}</span>
              </div>
            </div>
          )}

          {/* Sequential block warning */}
          {blockingStage && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Aguardando setor anterior:</strong> "{blockingStage.stage_name}" ainda está{' '}
                {blockingStage.status === 'pendente' ? 'pendente' : 'em andamento'}.
                Finalize-o antes de iniciar este setor.
              </span>
            </div>
          )}

          {/* Hints */}
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground border">
            <strong>Orientações:</strong> {config.hints}
          </div>

          {/* Quantity processed */}
          <div>
            <Label>Quantidade Processada</Label>
            <div className="flex items-center gap-3 mt-1">
              <Input
                type="number"
                min={0}
                max={stage.quantity_total}
                value={form.quantity_processed}
                onChange={e => setForm(f => ({ ...f, quantity_processed: Number(e.target.value) }))}
                className="font-mono w-32"
                disabled={stage.status === 'concluido'}
              />
              <span className="text-sm text-muted-foreground">/ {stage.quantity_total} pares</span>
            </div>
            <Progress value={pct} className="mt-2 h-2" />
            <p className="text-xs text-muted-foreground mt-1">{pct}% concluído</p>
          </div>

          {/* Actual time input */}
          {hasWipData && stage.status !== 'pendente' && (
            <div>
              <Label className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                Tempo Real (minutos)
              </Label>
              <div className="flex items-center gap-3 mt-1">
                <NumberInput
                  value={form.actual_time_minutes}
                  onChange={v => setForm(f => ({ ...f, actual_time_minutes: v }))}
                  className="font-mono w-32"
                  step="0.5"
                  min={0}
                  disabled={stage.status === 'concluido'}
                />
                {standardTime > 0 && (
                  <span className={`text-xs font-mono ${form.actual_time_minutes > standardTime ? 'text-destructive' : 'text-success'}`}>
                    {form.actual_time_minutes > 0 ? `${((form.actual_time_minutes / standardTime) * 100).toFixed(0)}% do padrão` : ''}
                  </span>
                )}
              </div>
              {actualCostPerPair > 0 && (
                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span>Custo real/par: <strong className="font-mono">{formatCurrency(actualCostPerPair)}</strong></span>
                  {costVariance !== 0 && (
                    <Badge variant={costVariance > 0 ? 'destructive' : 'default'} className="text-[10px]">
                      {costVariance > 0 ? '+' : ''}{formatCurrency(costVariance)} variação
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Execution time display */}
          {stage.started_at && (
            <div className="rounded-md bg-muted/30 p-3 border">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Tempo de Execução</p>
              <p className="text-sm font-mono">
                {stage.completed_at
                  ? formatDuration(new Date(stage.started_at), new Date(stage.completed_at))
                  : `Em andamento desde ${new Date(stage.started_at).toLocaleString('pt-BR')}`
                }
              </p>
            </div>
          )}

          {/* Observations */}
          <div>
            <Label>Observações</Label>
            <Textarea
              value={form.observations}
              onChange={e => setForm(f => ({ ...f, observations: e.target.value }))}
              className="mt-1"
              rows={2}
              placeholder="Anotações sobre o processo neste setor..."
              disabled={stage.status === 'concluido'}
            />
          </div>

          {/* Defects */}
          <div>
            <Label className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              Defeitos Encontrados
            </Label>
            <Textarea
              value={form.defects}
              onChange={e => setForm(f => ({ ...f, defects: e.target.value }))}
              className="mt-1"
              rows={2}
              placeholder="Descreva defeitos encontrados..."
              disabled={stage.status === 'concluido'}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            {stage.status === 'pendente' && (
              <Button onClick={handleStart} className="gap-2" disabled={!!blockingStage}>
                {blockingStage ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {blockingStage ? `Aguardando ${blockingStage.stage_name}` : 'Iniciar Etapa'}
              </Button>
            )}
            {stage.status === 'em_andamento' && (
              <>
                <Button variant="outline" onClick={handleSaveProgress}>Salvar Progresso</Button>
                <Button onClick={handleComplete} className="gap-2 bg-success hover:bg-success/90 text-success-foreground">
                  <CheckCircle2 className="h-4 w-4" /> Finalizar Etapa
                </Button>
              </>
            )}
            {stage.status === 'concluido' && (
              <p className="text-sm text-success font-medium flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Etapa concluída
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDuration(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}min`;
}
