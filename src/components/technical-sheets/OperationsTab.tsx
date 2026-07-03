import React, { useState } from 'react';
import { Plus, PencilSimple as Pencil, CircleNotch as Loader2, Clock, Wrench, CurrencyDollar as DollarSign, Gauge, Calendar, TrendUp as TrendingUp, Factory, Timer } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { formatCurrency as globalFormatCurrency, safeToFixed } from '@/lib/utils';
import {
  useBomOperations, useAddBomOperation, useUpdateBomOperation, useDeleteBomOperation,
  BomOperationFormData, emptyOperationForm, PRODUCTION_STAGES,
} from '@/hooks/useBomOperations';
import { KnifeSizeRangesEditor, type KnifeBucket } from './KnifeSizeRangesEditor';
import TimeStudyDialog from './TimeStudyDialog';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const STAGE_COLORS: Record<string, string> = {
   // Sub-etapas de Corte — 3 cores diferentes pra distinguir visualmente
   'Corte': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', // legacy genérico
   'Corte Palmilha': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
   'Corte Forração': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
   'Corte Cabedal':  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
   'Forração': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', // legacy alias
   'Costura': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
   'Aviamento': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  'Silk': 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
   'Colagem': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
   'Montagem': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
   'Solagem': 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300',
  'Acabamento': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
   'Expedição': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
};

// Proveniência do tempo-padrão (bom_operations.time_source). 'manual' e
// 'cronoanalise' nunca são sobrescritas pelo generate_bom_operations v2.
const TIME_SOURCE_LABELS: Record<string, string> = {
  capacidade: 'Capacidade',
  default: 'Padrão da categoria',
  cronoanalise: 'Cronoanálise',
  manual: 'Manual',
  pendente: 'Pendente',
};
const TIME_SOURCE_STYLES: Record<string, string> = {
  cronoanalise: 'border-green-500/40 text-green-600',
  pendente: 'border-amber-500/40 text-amber-600',
};

const DAILY_WORK_MINUTES = 480; // 8h

const formatCurrency = (v: any) => globalFormatCurrency(v);

interface OperationsTabProps {
  sheetId: string;
  /** @deprecated Mantido na prop pra compat com TechnicalSheets.tsx, não usado mais. */
  assemblyTimeMinutes?: number;
  /** @deprecated idem. */
  processDifficulty?: string;
  /** @deprecated coluna daily_capacity_pairs removida; capacidade agora é por setor. */
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
  /* Audit visual F2: setores ativos no modelo da ficha (vindo de
     production_sectors). Quando informado, setores não-aplicáveis ficam
     visualmente desaproximados (opacity + label "não usado neste modelo")
     pra orientar o operador sem esconder o config (caso ele queira voltar). */
  activeSectors?: string[];
  /** Numerações da ficha (ex: "33-41") — usado no editor de facas. */
  sheetSizes?: string;
  /** Mapping atual de facas de Corte Cabedal (NULL = sem cadastro). */
  knifeSizeRanges?: KnifeBucket[] | null;
  /** Propaga cada edição das facas pro FORM da ficha (fonte única de verdade),
   *  pra o "Salvar" geral persistir — sem isso a faca era sobrescrita por null. */
  onKnifeSizeRangesChange?: (v: KnifeBucket[] | null) => void;
}

export function OperationsTab({
  sheetId,
  // Props deprecated mantidas pra compat com TechnicalSheets.tsx; não usadas.
  assemblyTimeMinutes: _assemblyTimeMinutes = 0,
  processDifficulty: _processDifficulty = 'medio',
  dailyCapacityPairs: _dailyCapacityPairs = 0,
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
  activeSectors,
  sheetSizes = '',
  knifeSizeRanges = null,
  onKnifeSizeRangesChange,
}: OperationsTabProps) {
  const { data: operations = [], isLoading } = useBomOperations(sheetId);
  const { data: costPolicy } = useCostPolicies();
  // Rótulo da ficha pro cabeçalho do dialog de cronoanálise (referência travada).
  const { data: sheetLabel } = useQuery({
    queryKey: ['sheet_label', sheetId],
    enabled: !!sheetId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('technical_sheets')
        .select('name, code')
        .eq('id', sheetId)
        .single();
      return data ? (data.code ? `${data.code} · ${data.name}` : data.name) : 'Ficha atual';
    },
  });
  const addOp = useAddBomOperation();
  const updateOp = useUpdateBomOperation();
  const deleteOp = useDeleteBomOperation();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<BomOperationFormData>({ ...emptyOperationForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BomOperationFormData>({ ...emptyOperationForm });
  // Cronoanálise direto da linha do BOM: dialog pré-preenchido com a operação
  // (referência travada; "Salvar e aplicar ao BOM" atualiza tempo + custeio).
  const [timeStudyOp, setTimeStudyOp] = useState<any | null>(null);

  // Local state for production fields
  // Removidos: localAssemblyTime / localDifficulty / _localCapacity — card
  // "Configuração de Capacidade & Lead Times" deletado por redundância com
  // os cards "Setores produtivos" abaixo, que já capturam capacidade direta
  // (pares/dia) por setor.
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
  // Facas de Corte Cabedal (P/M/G/etc) — cadastro por ref. Persiste em
  // technical_sheets.knife_size_ranges (JSONB). NULL = sem cadastro, ficha
  // de Cabedal mostra sizes individuais.
  const [knifeRanges, setKnifeRanges] = useState<KnifeBucket[] | null>(knifeSizeRanges);

  const totalTimeMin = operations.reduce((s, op: any) => s + Number(op.standard_time_minutes || 0), 0);
  const totalMODCost = operations.reduce((s, op: any) => s + Number(op.cost_per_pair || 0), 0);
  const overheadPerPair = costPolicy?.overhead_rate_per_pair || 0;

  // Capacidade do dia = capacidade de Montagem (entrada manual no card abaixo).
  // Antes calculávamos sugestão via tempo×dificuldade — removido, entrada direta agora.
  const calculatedDailyCapacity = capMontagem;
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
        // assembly_time_minutes / process_difficulty removidos do payload —
        // card "Configuração de Capacidade & Lead Times" foi deletado
        // por redundância. daily_capacity_pairs também removido (capacidade
        // agora é por setor).
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
         knife_size_ranges: knifeRanges,
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
   'Corte': { time: 2, cost: 18, resource: 'Cortador' }, // legacy genérico
   'Corte Palmilha': { time: 1.5, cost: 18, resource: 'Cortador Palmilha' },
   'Corte Forração': { time: 2,   cost: 18, resource: 'Forrador' },
   'Corte Cabedal':  { time: 2.5, cost: 20, resource: 'Cortador Cabedal' },
   'Forração': { time: 2, cost: 18, resource: 'Forrador' }, // legacy alias
   'Costura': { time: 2, cost: 22, resource: 'Costureira' },
   'Aviamento': { time: 2, cost: 18, resource: 'Aviamento' },
   'Silk': { time: 1, cost: 16, resource: 'Silk' },
   'Colagem': { time: 1, cost: 16, resource: 'Colagem' },
   'Montagem': { time: 3, cost: 22, resource: 'Montador' },
   'Solagem': { time: 1.5, cost: 18, resource: 'Solagem' },
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
      {/* Card "Configuração de Capacidade & Lead Times" (Tempo de Montagem /
          Dificuldade / Tempo Efetivo) foi removido — era redundante com os
          cards "Setores produtivos" abaixo, onde a capacidade já é informada
          direta em pares/dia por setor. */}

      {/* ── Setores: capacidade + lead time juntos por card ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold">Setores produtivos</h3>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveProductionFields} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Cada setor tem <strong>capacidade</strong> (pares/dia) e <strong>lead time fallback</strong> (dias —
          usado se capacidade = 0). O sistema escolhe automaticamente: capacidade quando preenchida, fallback
          quando 0.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {([
            { key: 'corte',     label: 'Corte',      cap: capCorte,      setCap: setCapCorte,      lt: ltCorte,      setLt: setLtCorte },
            { key: 'forracao',  label: 'Corte Forração', cap: capCostura,    setCap: setCapCostura,    lt: ltCostura,    setLt: setLtCostura },
            { key: 'silk',      label: 'Silk',       cap: capSilk,       setCap: setCapSilk,       lt: ltSilk,       setLt: setLtSilk },
            { key: 'colagem',   label: 'Colagem',    cap: capColagem,    setCap: setCapColagem,    lt: ltColagem,    setLt: setLtColagem },
            {
              key: 'montagem', label: 'Montagem',
              cap: capMontagem, setCap: setCapMontagem,
              lt: ltMontagem,   setLt: setLtMontagem,
              // Sugestão automática removida — dependia do card de
              // tempo×dificuldade que foi deletado por redundância.
            },
            { key: 'acabamento', label: 'Acabamento', cap: capAcabamento, setCap: setCapAcabamento, lt: ltAcabamento, setLt: setLtAcabamento },
            { key: 'expedicao',  label: 'Expedição',  cap: capExpedicao,  setCap: setCapExpedicao,  lt: ltExpedicao,  setLt: setLtExpedicao },
          ] as const).map((s) => {
            const usingCapacity = (s.cap ?? 0) > 0;
            // Audit visual F2: marca setor como "não usado neste modelo" se
            // activeSectors foi passado e não inclui este setor. Mantém o card
            // visível (operador pode voltar pro modelo anterior), mas reduz
            // opacity e exibe legenda explícita.
            const sectorIsActive = !activeSectors || activeSectors.length === 0
              ? true
              : activeSectors.some(name => {
                  const n = name.toLowerCase();
                  return (
                    (s.key === 'corte' && (n.includes('corte palmilha') || n === 'corte')) ||
                    (s.key === 'forracao' && (n.includes('corte forração') || n.includes('costura') || n === 'forracao')) ||
                    (s.key === 'silk' && n.includes('silk')) ||
                    (s.key === 'colagem' && n.includes('colagem')) ||
                    (s.key === 'montagem' && n.includes('montagem')) ||
                    (s.key === 'acabamento' && n.includes('acabamento')) ||
                    (s.key === 'expedicao' && (n.includes('expedição') || n.includes('expedicao')))
                  );
                });
            return (
              <div
                key={s.key}
                className={`rounded-lg p-3 space-y-2 ${
                  !sectorIsActive
                    ? 'border-2 border-dashed border-muted-foreground/20 bg-muted/10'
                    : 'border bg-card'
                }`}
                title={!sectorIsActive ? 'Este setor não faz parte do modelo de produção configurado pra esta ficha' : undefined}
              >
                <div className="flex items-center justify-between">
                  <Badge className={`text-xs ${
                    !sectorIsActive
                      ? 'bg-muted/50 text-muted-foreground border-muted-foreground/20'
                      : STAGE_COLORS[s.label] || 'bg-muted text-muted-foreground'
                  }`}>
                    {s.label}
                  </Badge>
                  <span className={`text-xs uppercase tracking-wide font-bold ${
                    !sectorIsActive ? 'text-muted-foreground/60' : 'text-muted-foreground'
                  }`}>
                    {!sectorIsActive ? '— não usado —' : usingCapacity ? '✓ capacidade' : 'lead time'}
                  </span>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Capacidade (pares/dia)</Label>
                  <NumberInput value={s.cap} onChange={s.setCap} className="h-8 text-sm font-mono mt-0.5" min={0} step="1" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Lead time fallback (dias)</Label>
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
          <p className="text-xs text-muted-foreground">
            Margem entre data de chegada do material e início da produção. Aplicado globalmente, não por setor.
          </p>
        </div>
        <NumberInput value={ltBuffer} onChange={setLtBuffer} className="h-9 text-sm font-mono w-24" min={0} step="1" />
      </div>

      {/* ── Facas de Corte Cabedal (P/M/G/...) ── */}
      <KnifeSizeRangesEditor
        sheetSizes={sheetSizes}
        value={knifeRanges}
        onChange={(v) => { setKnifeRanges(v); onKnifeSizeRangesChange?.(v); }}
      />

      {/* ── Capacity Cards: Pares/Dia em destaque (origem do cálculo)
            + Semana/Mês como derivados visualmente conectados.
            Demanda Aberta separada com cor ambar pra criar contraste. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border-2 border-primary/40 p-3 bg-primary/5">
          <div className="flex items-center gap-2 text-primary mb-1">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-bold">Pares/Dia</span>
          </div>
          <span className="text-2xl font-bold font-mono text-primary">{calculatedDailyCapacity}</span>
          <p className="text-xs text-muted-foreground mt-0.5">em {safeToFixed(DAILY_WORK_MINUTES / 60, 0)}h de trabalho</p>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-semibold">Pares/Semana</span>
          </div>
          <span className="text-2xl font-bold font-mono">{weeklyCapacity}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{calculatedDailyCapacity} × 5</span> dias úteis
          </p>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-semibold">Pares/Mês</span>
          </div>
          <span className="text-2xl font-bold font-mono">{monthlyCapacity}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{calculatedDailyCapacity} × 22</span> dias úteis
          </p>
        </div>
        <div className={`rounded-lg border p-3 ${demandTotal > weeklyCapacity ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/30'}`}>
          <div className={`flex items-center gap-2 mb-1 ${demandTotal > weeklyCapacity ? 'text-amber-600' : 'text-muted-foreground'}`}>
            <Gauge className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-semibold">Demanda Aberta</span>
          </div>
          <span className={`text-2xl font-bold font-mono ${demandTotal > weeklyCapacity ? 'text-amber-700 dark:text-amber-400' : ''}`}>
            {demandTotal}
          </span>
          <span className="text-xs text-muted-foreground ml-1">pares</span>
          {daysNeeded > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
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
                <TableHead className="text-xs">OP</TableHead>
                <TableHead className="text-xs text-right">Qtd</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Entrega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersDemand.orders.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs font-mono">{o.order_number}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{o.quantity}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{o.status}</Badge></TableCell>
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
            <span className="text-xs uppercase tracking-wider font-semibold">Tempo Total</span>
          </div>
          <span className="text-lg font-bold font-mono">{safeToFixed(totalTimeMin, 1)} min</span>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wrench className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-semibold">MOD / Par</span>
          </div>
          <span className="text-lg font-bold font-mono text-primary">{formatCurrency(totalMODCost)}</span>
        </div>
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-xs uppercase tracking-wider font-semibold">Overhead / Par</span>
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
                <TableHead className="text-xs">Nº</TableHead>
                <TableHead className="text-xs">Operação</TableHead>
                <TableHead className="text-xs">Estágio</TableHead>
                <TableHead className="text-xs">Recurso</TableHead>
                <TableHead className="text-xs">Fonte do tempo</TableHead>
                <TableHead className="text-xs text-right">Tempo (min)</TableHead>
                <TableHead className="text-xs text-right">R$/hora</TableHead>
                <TableHead className="text-xs text-right">Custo/Par</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((op: any, idx: number) => (
                <TableRow key={op.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="text-xs font-medium">{op.operation_name}</TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${STAGE_COLORS[op.stage] || 'bg-muted text-muted-foreground'}`}>
                      {op.stage}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{op.resource_name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${TIME_SOURCE_STYLES[op.time_source] || ''}`}>
                      {TIME_SOURCE_LABELS[op.time_source] || op.time_source || '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">{safeToFixed(op.standard_time_minutes, 1)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(op.cost_per_hour)}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-semibold">{formatCurrency(op.cost_per_pair || 0)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 text-primary"
                        onClick={() => setTimeStudyOp(op)}
                        title="Cronometrar esta operação (cronoanálise)"
                      >
                        <Timer className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" onClick={() => handleEdit(op)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <DeleteConfirmButton onConfirm={() => deleteOp.mutate(op.id)} title="Remover operação?" size="h-6 w-6" iconSize="h-3 w-3" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={5} className="text-xs">Total MOD</TableCell>
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
            <DialogDescription className="sr-only">
              Nome, estágio, tempo padrão, custo por hora e recurso da operação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Cronoanálise pré-preenchida pela linha do BOM (referência travada). */}
      <TimeStudyDialog
        open={!!timeStudyOp}
        onOpenChange={(v) => { if (!v) setTimeStudyOp(null); }}
        prefill={timeStudyOp ? {
          sheetId,
          sheetLabel: sheetLabel ?? 'Ficha atual',
          bomOperationId: timeStudyOp.id,
          operationName: timeStudyOp.operation_name,
          stage: timeStudyOp.stage,
          costPerHour: Number(timeStudyOp.cost_per_hour) || 0,
        } : null}
      />
    </div>
  );
}
