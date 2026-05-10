import React, { useState } from 'react';
import { Plus, Pencil, Loader2, Clock, Wrench, DollarSign, Gauge, Calendar, TrendingUp, Factory } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { parseSafeNumber, formatCurrency as globalFormatCurrency, safeToFixed } from '@/lib/utils';
import {
  useBomOperations, useAddBomOperation, useUpdateBomOperation, useDeleteBomOperation,
  BomOperationFormData, emptyOperationForm, PRODUCTION_STAGES,
} from '@/hooks/useBomOperations';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const STAGE_COLORS: Record<string, string> = {
   'Corte': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
   'Forração': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'Silk': 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
   'Colagem': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
   'Montagem': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  'Acabamento': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
   'Expedição': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
};

const DIFFICULTY_LEVELS = [
  { value: 'facil', label: 'Fácil', color: 'text-green-600', factor: 0.85 },
  { value: 'medio', label: 'Médio', color: 'text-amber-600', factor: 1.0 },
  { value: 'dificil', label: 'Difícil', color: 'text-orange-600', factor: 1.2 },
  { value: 'muito_dificil', label: 'Muito Difícil', color: 'text-red-600', factor: 1.5 },
] as const;

const DAILY_WORK_MINUTES = 480; // 8h

const formatCurrency = (v: any) => globalFormatCurrency(v);

interface OperationsTabProps {
  sheetId: string;
  assemblyTimeMinutes?: number;
  processDifficulty?: string;
  dailyCapacityPairs?: number;
  leadTimeCorteDias?: number;
  leadTimeCosturaDias?: number;
  leadTimeSilkDias?: number;
  leadTimeColagemDias?: number;
  leadTimeMontagemDias?: number;
  leadTimeAcabamentoDias?: number;
  leadTimeExpedicaoDias?: number;
  leadTimeBufferMaterialDias?: number;
   cuttingCapacityPerDay?: number;
   sewingCapacityPerDay?: number;
   silkCapacityPerDay?: number;
  gluingCapacityPerDay?: number;
  assemblyCapacityPerDay?: number;
  expeditionCapacityPerDay?: number;
  finishingCapacityPerDay?: number;
  onUpdateSheet?: (data: Record<string, any>) => void;
}

export function OperationsTab({
  sheetId,
  assemblyTimeMinutes = 0,
  processDifficulty = 'medio',
  dailyCapacityPairs = 0,
  leadTimeCorteDias = 2,
  leadTimeCosturaDias = 3,
  leadTimeSilkDias = 1,
  leadTimeColagemDias = 1,
  leadTimeMontagemDias = 2,
  leadTimeAcabamentoDias = 1,
  leadTimeExpedicaoDias = 2,
  leadTimeBufferMaterialDias = 2,
   cuttingCapacityPerDay = 0,
   sewingCapacityPerDay = 0,
   silkCapacityPerDay = 0,
  gluingCapacityPerDay = 0,
  assemblyCapacityPerDay = 0,
  expeditionCapacityPerDay = 0,
  finishingCapacityPerDay = 0,
  onUpdateSheet,
}: OperationsTabProps) {
  const { data: operations = [], isLoading } = useBomOperations(sheetId);
  const { data: costPolicy } = useCostPolicies();
  const addOp = useAddBomOperation();
  const updateOp = useUpdateBomOperation();
  const deleteOp = useDeleteBomOperation();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<BomOperationFormData>({ ...emptyOperationForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BomOperationFormData>({ ...emptyOperationForm });

  // Local state for production fields
  const [localAssemblyTime, setLocalAssemblyTime] = useState(assemblyTimeMinutes);
  const [localDifficulty, setLocalDifficulty] = useState(processDifficulty);
  const [_localCapacity] = useState(dailyCapacityPairs);
  const [ltCorte, setLtCorte] = useState(leadTimeCorteDias);
  const [ltCostura, setLtCostura] = useState(leadTimeCosturaDias);
  const [ltSilk, setLtSilk] = useState(leadTimeSilkDias);
  const [ltColagem, setLtColagem] = useState(leadTimeColagemDias);
  const [ltMontagem, setLtMontagem] = useState(leadTimeMontagemDias);
  const [ltAcabamento, setLtAcabamento] = useState(leadTimeAcabamentoDias);
  const [ltExpedicao, setLtExpedicao] = useState(leadTimeExpedicaoDias);
  const [ltBuffer, setLtBuffer] = useState(leadTimeBufferMaterialDias);
  const [capCorte, setCapCorte] = useState(cuttingCapacityPerDay);
  const [capCostura, setCapCostura] = useState(sewingCapacityPerDay);
   const [capSilk, setCapSilk] = useState(silkCapacityPerDay);
   const [capColagem, setCapColagem] = useState(gluingCapacityPerDay);
   const [capMontagem, setCapMontagem] = useState(assemblyCapacityPerDay);
   const [capAcabamento, setCapAcabamento] = useState(finishingCapacityPerDay);
   const [capExpedicao, setCapExpedicao] = useState(expeditionCapacityPerDay);
  const [saving, setSaving] = useState(false);

  const totalTimeMin = operations.reduce((s, op: any) => s + Number(op.standard_time_minutes || 0), 0);
  const totalMODCost = operations.reduce((s, op: any) => s + Number(op.cost_per_pair || 0), 0);
  const overheadPerPair = costPolicy?.overhead_rate_per_pair || 0;

  const difficultyInfo = DIFFICULTY_LEVELS.find(d => d.value === localDifficulty) || DIFFICULTY_LEVELS[1];

  // Suggested capacity for Montagem based on assembly time × difficulty
  const effectiveTimePerPair = localAssemblyTime > 0 ? localAssemblyTime * difficultyInfo.factor : totalTimeMin * difficultyInfo.factor;
  const suggestedAssemblyCapacity = effectiveTimePerPair > 0 ? Math.floor(DAILY_WORK_MINUTES / effectiveTimePerPair) : 0;
  // Manual capacity prevails; fallback to suggestion only if manual = 0
  const calculatedDailyCapacity = capMontagem > 0 ? capMontagem : suggestedAssemblyCapacity;
  const weeklyCapacity = calculatedDailyCapacity * 5;
  const monthlyCapacity = calculatedDailyCapacity * 22;

  // Fetch orders demand for capacity analysis
  const { data: ordersDemand } = useQuery({
    queryKey: ['orders_demand_capacity', sheetId],
    queryFn: async () => {
      const { data: sheet } = await supabase
        .from('technical_sheets')
        .select('name, code')
        .eq('id', sheetId)
        .single();
      if (!sheet) return { total: 0, orders: [] };

      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number, quantity, status, delivery_date')
        .or(`reference.eq.${sheet.name},reference.eq.${sheet.code}`)
        .in('status', ['Em Produção', 'Aguardando', 'Pendente', 'em_producao', 'aguardando', 'pendente'])
        .order('delivery_date', { ascending: true });

      return {
        total: (orders || []).reduce((s: number, o: any) => s + Number(o.quantity || 0), 0),
        orders: orders || [],
      };
    },
    staleTime: 30_000,
  });

  const handleSaveProductionFields = async () => {
    setSaving(true);
    try {
      const payload = {
        assembly_time_minutes: localAssemblyTime,
        process_difficulty: localDifficulty,
        // daily_capacity_pairs removido: substituído pelas capacidades
        // por setor (sewing_capacity_per_day, cutting_capacity_per_day, etc.)
        lead_time_corte_dias: ltCorte,
        lead_time_costura_dias: ltCostura,
        lead_time_silk_dias: ltSilk,
        lead_time_colagem_dias: ltColagem,
        lead_time_montagem_dias: ltMontagem,
        lead_time_acabamento_dias: ltAcabamento,
        lead_time_expedicao_dias: ltExpedicao,
         lead_time_buffer_material_dias: ltBuffer,
         cutting_capacity_per_day: capCorte,
         sewing_capacity_per_day: capCostura,
         silk_capacity_per_day: capSilk,
         gluing_capacity_per_day: capColagem,
         assembly_capacity_per_day: capMontagem,
         finishing_capacity_per_day: capAcabamento,
         expedition_capacity_per_day: capExpedicao,
      };
      const { error } = await supabase
        .from('technical_sheets')
        .update(payload as any)
        .eq('id', sheetId);
      if (error) throw error;
      onUpdateSheet?.(payload);
      toast.success('Dados de produção salvos!');
      window.history.back();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (!form.operation_name || !form.stage) return;
    addOp.mutate({ sheetId, data: { ...form, sort_order: operations.length + 1 } });
    setForm({ ...emptyOperationForm });
    setAdding(false);
  };

  const handleEdit = (op: any) => {
    setEditingId(op.id);
    setEditForm({
      operation_name: op.operation_name,
      stage: op.stage,
      standard_time_minutes: op.standard_time_minutes,
      resource_name: op.resource_name || '',
      cost_per_hour: op.cost_per_hour,
      sort_order: op.sort_order,
      notes: op.notes || '',
      active: op.active,
    });
  };

  const handleUpdate = () => {
    if (!editingId) return;
    updateOp.mutate({ id: editingId, data: editForm });
    setEditingId(null);
  };

  const handleAddPreset = () => {
    const existing = new Set(operations.map((op: any) => op.stage));
    const toAdd = PRODUCTION_STAGES.filter(s => !existing.has(s));
    if (toAdd.length === 0) return;
    const DEFAULT_COSTS: Record<string, { time: number; cost: number; resource: string }> = {
   'Corte': { time: 2, cost: 18, resource: 'Cortador' },
   'Forração': { time: 2, cost: 18, resource: 'Forrador' },
   'Silk': { time: 1, cost: 16, resource: 'Silk' },
   'Colagem': { time: 1, cost: 16, resource: 'Colagem' },
   'Montagem': { time: 3, cost: 22, resource: 'Montador' },
   'Acabamento': { time: 1.5, cost: 18, resource: 'Acabamento' },
   'Expedição': { time: 1, cost: 20, resource: 'Expedição' },
    };
    toAdd.forEach((stage, idx) => {
      const def = DEFAULT_COSTS[stage] || { time: 1, cost: 18, resource: '' };
      addOp.mutate({
        sheetId,
        data: {
          operation_name: stage, stage,
          standard_time_minutes: def.time, resource_name: def.resource,
          cost_per_hour: def.cost, sort_order: operations.length + idx + 1,
          notes: '', active: true,
        },
      });
    });
  };

  // Calculate days needed to fulfill demand
  const demandTotal = ordersDemand?.total || 0;
  const daysNeeded = calculatedDailyCapacity > 0 ? Math.ceil(demandTotal / calculatedDailyCapacity) : 0;

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className="space-y-6">
      {/* ── Production Time & Difficulty ── */}
      <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
             <h3 className="text-sm font-semibold">Configuração de Capacidade & Lead Times</h3>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveProductionFields} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Salvar
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs font-medium">Tempo de Montagem (min/par)</Label>
            <p className="text-[10px] text-muted-foreground mb-1">Tempo total de montagem por par completo</p>
            <NumberInput
              value={localAssemblyTime}
              onChange={v => setLocalAssemblyTime(v)}
              className="h-9 text-sm font-mono"
              step="0.5"
              min={0}
            />
          </div>
          <div>
            <Label className="text-xs font-medium">Dificuldade do Processo</Label>
            <p className="text-[10px] text-muted-foreground mb-1">Fator de ajuste: ×{safeToFixed(difficultyInfo.factor, 2)}</p>
            <Select value={localDifficulty} onValueChange={v => setLocalDifficulty(v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTY_LEVELS.map(d => (
                  <SelectItem key={d.value} value={d.value}>
                    <span className={d.color}>{d.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">(×{d.factor})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Tempo Efetivo (min/par)</Label>
            <p className="text-[10px] text-muted-foreground mb-1">= Tempo × Fator de dificuldade</p>
            <div className="h-9 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-mono font-semibold">
              {safeToFixed(effectiveTimePerPair, 1)} min
            </div>
          </div>
        </div>
      </div>

      {/* ── Setores: capacidade + lead time juntos por card ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold">Setores produtivos</h3>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2">
          Cada setor tem <strong>capacidade</strong> (pares/dia) e <strong>lead time fallback</strong> (dias —
          usado se capacidade = 0). O sistema escolhe automaticamente: capacidade quando preenchida, fallback
          quando 0.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {([
            { key: 'corte',     label: 'Corte',      cap: capCorte,      setCap: setCapCorte,      lt: ltCorte,      setLt: setLtCorte },
            { key: 'forracao',  label: 'Forração',   cap: capCostura,    setCap: setCapCostura,    lt: ltCostura,    setLt: setLtCostura },
            { key: 'silk',      label: 'Silk',       cap: capSilk,       setCap: setCapSilk,       lt: ltSilk,       setLt: setLtSilk },
            { key: 'colagem',   label: 'Colagem',    cap: capColagem,    setCap: setCapColagem,    lt: ltColagem,    setLt: setLtColagem },
            {
              key: 'montagem', label: 'Montagem',
              cap: capMontagem, setCap: setCapMontagem,
              lt: ltMontagem,   setLt: setLtMontagem,
              hint: suggestedAssemblyCapacity > 0
                ? `Sugestão por tempo×dificuldade: ${suggestedAssemblyCapacity} pares/dia`
                : undefined,
              applySuggestion: suggestedAssemblyCapacity > 0
                ? () => setCapMontagem(suggestedAssemblyCapacity)
                : undefined,
            },
            { key: 'acabamento', label: 'Acabamento', cap: capAcabamento, setCap: setCapAcabamento, lt: ltAcabamento, setLt: setLtAcabamento },
            { key: 'expedicao',  label: 'Expedição',  cap: capExpedicao,  setCap: setCapExpedicao,  lt: ltExpedicao,  setLt: setLtExpedicao },
          ] as const).map((s) => {
            const usingCapacity = (s.cap ?? 0) > 0;
            return (
              <div
                key={s.key}
                className="rounded-lg border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Badge className={`text-[10px] ${STAGE_COLORS[s.label] || 'bg-muted text-muted-foreground'}`}>
                    {s.label}
                  </Badge>
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    {usingCapacity ? '✓ capacidade' : 'lead time'}
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted-foreground">Capacidade (pares/dia)</Label>
                    {'applySuggestion' in s && s.applySuggestion && suggestedAssemblyCapacity > 0 && (
                      <button
                        type="button"
                        onClick={s.applySuggestion}
                        className="text-[9px] text-primary hover:underline"
                        title={'hint' in s && s.hint ? s.hint : undefined}
                      >
                        usar {suggestedAssemblyCapacity}
                      </button>
                    )}
                  </div>
                  <NumberInput value={s.cap} onChange={s.setCap} className="h-8 text-sm font-mono mt-0.5" min={0} step="1" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Lead time fallback (dias)</Label>
                  <NumberInput value={s.lt} onChange={s.setLt} className="h-8 text-sm font-mono mt-0.5" min={0} step="1" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Buffer global (não é setor) ── */}
      <div className="rounded-lg border bg-muted/20 p-3 flex items-center gap-3">
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1">
          <Label className="text-xs font-medium">Buffer de material (dias)</Label>
          <p className="text-[10px] text-muted-foreground">
            Margem entre data de chegada do material e início da produção. Aplicado globalmente, não por setor.
          </p>
        </div>
        <NumberInput value={ltBuffer} onChange={setLtBuffer} className="h-9 text-sm font-mono w-24" min={0} step="1" />
      </div>

      {/* ── Capacity Cards: Pares/Dia em destaque (origem do cálculo)
            + Semana/Mês como derivados visualmente conectados.
            Demanda Aberta separada com cor ambar pra criar contraste. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border-2 border-primary/40 p-3 bg-primary/5">
          <div className="flex items-center gap-2 text-primary mb-1">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-bold">Pares/Dia</span>
          </div>
          <span className="text-2xl font-bold font-mono text-primary">{calculatedDailyCapacity}</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">em {safeToFixed(DAILY_WORK_MINUTES / 60, 0)}h de trabalho</p>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Pares/Semana</span>
          </div>
          <span className="text-2xl font-bold font-mono">{weeklyCapacity}</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <span className="font-mono">{calculatedDailyCapacity} × 5</span> dias úteis
          </p>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Pares/Mês</span>
          </div>
          <span className="text-2xl font-bold font-mono">{monthlyCapacity}</span>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <span className="font-mono">{calculatedDailyCapacity} × 22</span> dias úteis
          </p>
        </div>
        <div className={`rounded-lg border p-3 ${demandTotal > weeklyCapacity ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/30'}`}>
          <div className={`flex items-center gap-2 mb-1 ${demandTotal > weeklyCapacity ? 'text-amber-600' : 'text-muted-foreground'}`}>
            <Gauge className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Demanda Aberta</span>
          </div>
          <span className={`text-2xl font-bold font-mono ${demandTotal > weeklyCapacity ? 'text-amber-700 dark:text-amber-400' : ''}`}>
            {demandTotal}
          </span>
          {daysNeeded > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              ≈ <strong className="text-foreground">{daysNeeded} dia{daysNeeded > 1 ? 's' : ''}</strong> para atender
            </p>
          )}
        </div>
      </div>

      {/* ── Demand Breakdown ── */}
      {ordersDemand && ordersDemand.orders.length > 0 && (
        <details className="rounded-lg border overflow-hidden">
          <summary className="px-4 py-2 bg-muted/30 cursor-pointer text-xs font-semibold flex items-center gap-2">
            <Factory className="h-3.5 w-3.5" />
            Pedidos em aberto para este modelo ({ordersDemand.orders.length})
          </summary>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-[11px]">OP</TableHead>
                <TableHead className="text-[11px] text-right">Qtd</TableHead>
                <TableHead className="text-[11px]">Status</TableHead>
                <TableHead className="text-[11px]">Entrega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersDemand.orders.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs font-mono">{o.order_number}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{o.quantity}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{o.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.delivery_date ? new Date(o.delivery_date).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      )}

      <Separator />

      {/* ── Operations List ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Operações Produtivas & MOD</h3>
        <div className="flex gap-1">
          {operations.length === 0 && (
            <Button variant="default" size="sm" className="gap-1 h-7 text-xs" onClick={handleAddPreset}>
              <Plus className="h-3 w-3" /> Adicionar Padrão
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setAdding(!adding)}>
            <Plus className="h-3 w-3" /> Operação
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Tempo Total</span>
          </div>
          <span className="text-lg font-bold font-mono">{safeToFixed(totalTimeMin, 1)} min</span>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wrench className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">MOD / Par</span>
          </div>
          <span className="text-lg font-bold font-mono text-primary">{formatCurrency(totalMODCost)}</span>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Overhead / Par</span>
          </div>
          <span className="text-lg font-bold font-mono">{formatCurrency(overheadPerPair)}</span>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-primary">Nova Operação</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Nome da Operação</Label>
              <Input value={form.operation_name} onChange={e => setForm(f => ({ ...f, operation_name: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Corte de cabedal" />
            </div>
            <div>
              <Label className="text-xs">Estágio</Label>
              <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tempo Padrão (min)</Label>
              <NumberInput value={form.standard_time_minutes} onChange={v => setForm(f => ({ ...f, standard_time_minutes: v }))} className="mt-1 h-9 text-sm" step="0.1" min={0} />
            </div>
            <div>
              <Label className="text-xs">Custo/Hora (R$)</Label>
              <NumberInput value={form.cost_per_hour} onChange={v => setForm(f => ({ ...f, cost_per_hour: v }))} className="mt-1 h-9 text-sm" step="0.01" min={0} />
            </div>
            <div>
              <Label className="text-xs">Recurso</Label>
              <Input value={form.resource_name} onChange={e => setForm(f => ({ ...f, resource_name: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Cortador" />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd} disabled={addOp.isPending}>Adicionar</Button>
          </div>
        </div>
      )}

      {/* Operations table */}
      {operations.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[11px]">Nº</TableHead>
                <TableHead className="text-[11px]">Operação</TableHead>
                <TableHead className="text-[11px]">Estágio</TableHead>
                <TableHead className="text-[11px]">Recurso</TableHead>
                <TableHead className="text-[11px] text-right">Tempo (min)</TableHead>
                <TableHead className="text-[11px] text-right">R$/hora</TableHead>
                <TableHead className="text-[11px] text-right">Custo/Par</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((op: any, idx: number) => (
                <TableRow key={op.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="text-xs font-medium">{op.operation_name}</TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${STAGE_COLORS[op.stage] || 'bg-muted text-muted-foreground'}`}>
                      {op.stage}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{op.resource_name || '—'}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{safeToFixed(op.standard_time_minutes, 1)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(op.cost_per_hour)}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-semibold">{formatCurrency(op.cost_per_pair || 0)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" onClick={() => handleEdit(op)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <DeleteConfirmButton onConfirm={() => deleteOp.mutate(op.id)} title="Remover operação?" size="h-6 w-6" iconSize="h-3 w-3" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={4} className="text-xs">Total MOD</TableCell>
                <TableCell className="text-xs text-right font-mono font-bold">{safeToFixed(totalTimeMin, 1)}</TableCell>
                <TableCell></TableCell>
                <TableCell className="text-xs text-right font-mono font-bold text-primary">{formatCurrency(totalMODCost)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {operations.length === 0 && !adding && (
        <div className="text-center py-8 text-muted-foreground">
          <Wrench className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhuma operação cadastrada</p>
          <p className="text-xs mt-1">Defina as etapas produtivas com tempos e custos por hora</p>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={() => setEditingId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Operação</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome da Operação</Label>
              <Input value={editForm.operation_name} onChange={e => setEditForm(f => ({ ...f, operation_name: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Estágio</Label>
              <Select value={editForm.stage} onValueChange={v => setEditForm(f => ({ ...f, stage: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tempo Padrão (min)</Label>
              <NumberInput value={editForm.standard_time_minutes} onChange={v => setEditForm(f => ({ ...f, standard_time_minutes: v }))} className="mt-1 h-9 text-sm" step="0.1" min={0} />
            </div>
            <div>
              <Label className="text-xs">Custo/Hora (R$)</Label>
              <NumberInput value={editForm.cost_per_hour} onChange={v => setEditForm(f => ({ ...f, cost_per_hour: v }))} className="mt-1 h-9 text-sm" step="0.01" min={0} />
            </div>
            <div>
              <Label className="text-xs">Recurso</Label>
              <Input value={editForm.resource_name} onChange={e => setEditForm(f => ({ ...f, resource_name: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancelar</Button>
            <Button size="sm" onClick={handleUpdate} disabled={updateOp.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
