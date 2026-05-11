import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle, Activity, Truck, Loader2, Send, CheckCircle2,
  Calendar, TrendingUp, ChevronRight, ArrowRight,
} from 'lucide-react';
import { format, parseISO, addWeeks, startOfWeek, getISOWeek, getISOWeekYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

// ─── Setores monitorados (canon = ordem real do fluxo) ─────────────────────

type MonitoredSector = 'Corte Palmilha' | 'Corte Forração' | 'Aviamento' | 'Costura';

const MONITORED_SECTORS: { key: MonitoredSector; capCol: string; label: string }[] = [
  { key: 'Corte Palmilha', capCol: 'sewing_capacity_per_day',   label: 'Corte Palmilha' },
  { key: 'Corte Forração', capCol: 'cutting_capacity_per_day',  label: 'Corte Forração' },
  { key: 'Aviamento',      capCol: 'mesa_daily_capacity',       label: 'Aviamento (Mesa)' },
  { key: 'Costura',        capCol: 'costura_capacity_per_day',  label: 'Costura' },
];

// Mapeamento sector → coluna de data_inicio na view purchase_projection_timeline
const SECTOR_TO_DATE_COLUMN: Record<MonitoredSector, string> = {
  'Corte Palmilha': 'data_inicio_palmilha',
  'Corte Forração': 'data_inicio_corte',
  'Aviamento':      'data_inicio_mesa',
  'Costura':        'data_inicio_costura',
};

const SECTOR_TO_LEAD_COLUMN: Record<MonitoredSector, string> = {
  'Corte Palmilha': 'lead_time_palmilha_dias',
  'Corte Forração': 'lead_time_corte_dias',
  'Aviamento':      'lead_time_mesa_dias',
  'Costura':        'lead_time_costura_dias',
};

const WEEKS_TO_SHOW = 8;

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoWeekKey(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
}

function weekHeader(d: Date): string {
  return `S${getISOWeek(d)}`;
}

function loadColor(pct: number): string {
  if (pct > 110) return 'bg-destructive/40 text-destructive-foreground border-destructive/60 font-bold';
  if (pct > 100) return 'bg-destructive/20 text-destructive border-destructive/30';
  if (pct > 85)  return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30';
  if (pct > 60)  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
  if (pct > 0)   return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20';
  return 'bg-muted/20 text-muted-foreground border-border/40';
}

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface TimelineRow {
  order_id: string;
  pedido_ref: string;
  sale_order_id: string;
  referencia_nome: string;
  op_quantity: number;
  order_status: string;
  data_entrega_cliente: string;
  data_inicio_palmilha: string | null;
  data_inicio_corte: string | null;
  data_inicio_mesa: string | null;
  data_inicio_costura: string | null;
  lead_time_palmilha_dias: number;
  lead_time_corte_dias: number;
  lead_time_mesa_dias: number;
  lead_time_costura_dias: number;
}

interface BottleneckRow {
  orderId: string;
  orderNumber: string;
  reference: string;
  quantity: number;
  sector: MonitoredSector;
  weekKey: string;
  weekLabel: string;
  loadPct: number;
  reason: string;
}

interface HeatmapCell {
  weekKey: string;
  weekLabel: string;
  sector: MonitoredSector;
  plannedPairs: number;
  capacityPairs: number;
  loadPct: number;
  orderIds: string[];
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function ProductionControlCenter() {
  const [outsourceTarget, setOutsourceTarget] = useState<BottleneckRow | null>(null);
  const [confirmDeadlineFor, setConfirmDeadlineFor] = useState<any>(null);

  const { data: timelineRows = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ['production_control_timeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_projection_timeline' as any)
        .select(
          'order_id, pedido_ref, sale_order_id, referencia_nome, op_quantity, order_status, data_entrega_cliente, ' +
          'data_inicio_palmilha, data_inicio_corte, data_inicio_mesa, data_inicio_costura, ' +
          'lead_time_palmilha_dias, lead_time_corte_dias, lead_time_mesa_dias, lead_time_costura_dias'
        );
      if (error) throw error;
      // Dedup por order_id (view tem 1 row por (OP × material))
      const seen = new Set<string>();
      const rows: TimelineRow[] = [];
      for (const r of (data || []) as unknown as TimelineRow[]) {
        if (seen.has(r.order_id)) continue;
        seen.add(r.order_id);
        rows.push(r);
      }
      return rows;
    },
  });

  // Capacidade global por setor (média ponderada das fichas técnicas ativas)
  const { data: capacities = {} as Record<MonitoredSector, number>, isLoading: loadingCaps } = useQuery({
    queryKey: ['sector_capacities_avg'],
    queryFn: async () => {
      const { data } = await supabase
        .from('technical_sheets')
        .select('sewing_capacity_per_day, cutting_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day')
        .eq('active', true)
        .limit(2000);
      const rows = (data || []) as any[];
      const result: Record<MonitoredSector, number> = {
        'Corte Palmilha': 0, 'Corte Forração': 0, 'Aviamento': 0, 'Costura': 0,
      };
      for (const s of MONITORED_SECTORS) {
        const vals = rows.map(r => Number(r[s.capCol]) || 0).filter(v => v > 0);
        result[s.key] = vals.length > 0
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          : 300; // fallback razoável
      }
      return result;
    },
  });

  // OSes terceirizadas ativas
  const { data: activeOutsourceOses = [] } = useQuery({
    queryKey: ['active_outsource_oses'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('*, contractors(name), orders:related_order_id(order_number, quantity, reference_id, technical_sheets:reference_id(name))')
        .not('related_order_id', 'is', null)
        .not('sector', 'is', null)
        .in('status', ['Pendente', 'pendente', 'em_andamento', 'aguardando_aceite'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Gera grade de semanas
  const weeks = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: WEEKS_TO_SHOW }, (_, i) => addWeeks(start, i));
  }, []);

  // Heatmap: pra cada (semana, setor) agrega pares planejados
  const { heatmap, bottlenecks } = useMemo(() => {
    const cells = new Map<string, HeatmapCell>();
    const initCell = (weekKey: string, weekLabel: string, sector: MonitoredSector) => {
      const id = `${weekKey}:${sector}`;
      if (!cells.has(id)) {
        cells.set(id, {
          weekKey, weekLabel, sector,
          plannedPairs: 0,
          capacityPairs: (capacities[sector] || 300) * 5, // 5 dias úteis
          loadPct: 0,
          orderIds: [],
        });
      }
      return cells.get(id)!;
    };

    for (const w of weeks) {
      for (const s of MONITORED_SECTORS) {
        initCell(isoWeekKey(w), weekHeader(w), s.key);
      }
    }

    for (const row of timelineRows) {
      const status = (row.order_status || '').toLowerCase();
      if (['finalizado', 'faturado', 'cancelado', 'concluido', 'concluído'].includes(status)) continue;
      for (const s of MONITORED_SECTORS) {
        const dateCol = SECTOR_TO_DATE_COLUMN[s.key];
        const leadCol = SECTOR_TO_LEAD_COLUMN[s.key];
        const startDate = (row as any)[dateCol] as string | null;
        const leadDays = Number((row as any)[leadCol]) || 0;
        if (!startDate || leadDays <= 0) continue;
        try {
          const d = parseISO(startDate);
          const wk = isoWeekKey(d);
          const cell = cells.get(`${wk}:${s.key}`);
          if (!cell) continue; // fora da janela visualizada
          cell.plannedPairs += row.op_quantity;
          cell.orderIds.push(row.order_id);
        } catch {/* ignore */}
      }
    }

    const heatmap = Array.from(cells.values()).map(c => ({
      ...c,
      loadPct: c.capacityPairs > 0 ? (c.plannedPairs / c.capacityPairs) * 100 : 0,
    }));

    // Gargalos = OPs em células > 100%
    const overloadedCells = heatmap.filter(c => c.loadPct > 100);
    const bottlenecks: BottleneckRow[] = [];
    for (const cell of overloadedCells) {
      for (const orderId of cell.orderIds) {
        const row = timelineRows.find(r => r.order_id === orderId);
        if (!row) continue;
        bottlenecks.push({
          orderId,
          orderNumber: row.pedido_ref,
          reference: row.referencia_nome,
          quantity: row.op_quantity,
          sector: cell.sector,
          weekKey: cell.weekKey,
          weekLabel: cell.weekLabel,
          loadPct: cell.loadPct,
          reason: cell.loadPct > 130
            ? `Setor saturado: ${Math.round(cell.loadPct)}% da capacidade`
            : `Setor próximo do limite: ${Math.round(cell.loadPct)}% da capacidade`,
        });
      }
    }
    bottlenecks.sort((a, b) => b.loadPct - a.loadPct);
    return { heatmap, bottlenecks };
  }, [timelineRows, weeks, capacities]);

  const opsAtRisk = new Set(bottlenecks.map(b => b.orderId)).size;
  const worstCell = heatmap.reduce(
    (acc, c) => (c.loadPct > acc.loadPct ? c : acc),
    { loadPct: 0, sector: 'Costura' as MonitoredSector, weekLabel: '—' } as HeatmapCell,
  );

  const isLoading = loadingTimeline || loadingCaps;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Activity className="h-7 w-7 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Controle de Produção</h1>
          <p className="text-sm text-muted-foreground">
            Monitora capacidade vs demanda de Corte, Aviamento e Costura.
            Identifica gargalos por semana e permite terceirizar OPs problemáticas com 1 clique.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">OPs em risco</p>
            <p className="text-2xl font-bold text-destructive">{opsAtRisk}</p>
            <p className="text-[10px] text-muted-foreground">{bottlenecks.length} gargalos detectados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Maior gargalo</p>
            <p className="text-lg font-bold text-amber-600 truncate">{worstCell.sector}</p>
            <p className="text-[10px] text-muted-foreground">
              {worstCell.weekLabel} · {Math.round(worstCell.loadPct)}% de carga
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">OSes terceirizadas</p>
            <p className="text-2xl font-bold">{activeOutsourceOses.length}</p>
            <p className="text-[10px] text-muted-foreground">ativas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Capacidade média</p>
            <p className="text-lg font-bold">
              {(capacities['Costura'] || 0)}/d
            </p>
            <p className="text-[10px] text-muted-foreground">pares/dia · Costura</p>
          </CardContent>
        </Card>
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Capacidade × Demanda · próximas {WEEKS_TO_SHOW} semanas
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 sticky left-0 bg-card">Setor</th>
                  {weeks.map(w => (
                    <th key={isoWeekKey(w)} className="text-center p-2 min-w-[68px]">
                      <p className="font-bold">{weekHeader(w)}</p>
                      <p className="text-[9px] text-muted-foreground font-normal">
                        {format(w, 'dd/MM', { locale: ptBR })}
                      </p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MONITORED_SECTORS.map(s => (
                  <tr key={s.key} className="border-b border-border/40">
                    <td className="p-2 font-medium sticky left-0 bg-card">
                      {s.label}
                      <p className="text-[10px] text-muted-foreground">
                        cap. {capacities[s.key] || 0}/d
                      </p>
                    </td>
                    {weeks.map(w => {
                      const wk = isoWeekKey(w);
                      const cell = heatmap.find(c => c.weekKey === wk && c.sector === s.key);
                      const pct = cell?.loadPct ?? 0;
                      const planned = cell?.plannedPairs ?? 0;
                      return (
                        <td key={wk} className="p-1 text-center">
                          <div
                            className={`rounded-md border px-1.5 py-1 ${loadColor(pct)}`}
                            title={`${planned} pares planejados · capacidade ${cell?.capacityPairs ?? 0} pares/semana`}
                          >
                            <p className="font-mono font-bold leading-none">
                              {Math.round(pct)}%
                            </p>
                            <p className="text-[9px] leading-tight mt-0.5 opacity-80">
                              {planned}p
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Gargalos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Gargalos detectados ({bottlenecks.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {bottlenecks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6 italic">
              Nenhum gargalo detectado nas próximas {WEEKS_TO_SHOW} semanas. 🎉
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {bottlenecks.slice(0, 50).map((b, i) => (
                <div key={`${b.orderId}-${b.sector}-${i}`} className="p-3 flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${
                      b.loadPct > 130 ? 'bg-destructive/10 text-destructive border-destructive/30' :
                      'bg-amber-500/10 text-amber-700 border-amber-500/30'
                    }`}
                  >
                    {b.loadPct > 130 ? 'Crítico' : 'Atenção'}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      OP {b.orderNumber} · <span className="text-muted-foreground">{b.reference}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.quantity} pares · Setor <span className="font-medium">{b.sector}</span> · {b.weekLabel}
                      <span className="ml-2">· {b.reason}</span>
                    </p>
                  </div>
                  <Button size="sm" className="gap-1.5" onClick={() => setOutsourceTarget(b)}>
                    <Truck className="h-3.5 w-3.5" /> Terceirizar
                  </Button>
                </div>
              ))}
              {bottlenecks.length > 50 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  +{bottlenecks.length - 50} gargalos adicionais (mostrando os 50 mais críticos)
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* OSes terceirizadas ativas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /> OSes terceirizadas ativas ({activeOutsourceOses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activeOutsourceOses.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6 italic">Sem OSes terceirizadas em aberto.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {activeOutsourceOses.map((os: any) => (
                <OutsourceOsRow
                  key={os.id}
                  os={os}
                  onConfirmDeadline={() => setConfirmDeadlineFor(os)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <OutsourceDialog
        target={outsourceTarget}
        onClose={() => setOutsourceTarget(null)}
      />

      <ConfirmDeadlineDialog
        os={confirmDeadlineFor}
        onClose={() => setConfirmDeadlineFor(null)}
      />
    </div>
  );
}

function OutsourceOsRow({ os, onConfirmDeadline }: { os: any; onConfirmDeadline: () => void }) {
  const status = String(os.status || '').toLowerCase();
  const needsDeadline = !os.service_date || ['aguardando_aceite', 'pendente'].includes(status);
  const opLabel = os.orders?.order_number
    ? `OP ${os.orders.order_number}${os.orders?.technical_sheets?.name ? ` · ${os.orders.technical_sheets.name}` : ''}`
    : '—';

  return (
    <div className="p-3 flex items-center gap-3">
      <Badge variant="outline" className={`text-[10px] capitalize ${
        needsDeadline ? 'bg-amber-500/10 text-amber-700 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
      }`}>
        {needsDeadline ? 'Aguardando prazo' : 'Em andamento'}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {os.contractors?.name || 'Contractor sem nome'} · <span className="text-muted-foreground">{os.sector}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {opLabel} · {os.quantity || 0} pares
          {os.unit_price ? ` · R$ ${Number(os.unit_price).toFixed(2)}/p` : ''}
          {os.total_value ? ` · total R$ ${Number(os.total_value).toFixed(2)}` : ''}
          {os.service_date ? ` · prazo ${format(parseISO(os.service_date), 'dd/MM/yyyy')}` : ''}
        </p>
        {os.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{os.description}</p>
        )}
      </div>
      {needsDeadline && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onConfirmDeadline}>
          <Calendar className="h-3.5 w-3.5" /> Definir prazo
        </Button>
      )}
    </div>
  );
}

// ─── Outsource dialog (terceiriza OP) ─────────────────────────────────────

function OutsourceDialog({ target, onClose }: { target: BottleneckRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [contractorId, setContractorId] = useState('');
  const [newContractor, setNewContractor] = useState('');
  const [quantity, setQuantity] = useState<number>(target?.quantity ?? 0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [deadline, setDeadline] = useState('');
  const [materialsNotes, setMaterialsNotes] = useState('');
  const [notes, setNotes] = useState('');

  // Reset quando muda target
  useMemo(() => {
    if (target) {
      setQuantity(target.quantity);
      setUnitPrice(0);
      setContractorId('');
      setNewContractor('');
      setDeadline('');
      setMaterialsNotes('');
      setNotes('');
    }
  }, [target?.orderId]);

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors_active'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('contractors')
        .select('id, name, service_type')
        .eq('active', true)
        .order('name');
      return data || [];
    },
  });

  const createContractor = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await (supabase as any)
        .from('contractors')
        .insert({ name: name.trim(), service_type: target?.sector || '', active: true })
        .select('id, name, service_type').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['contractors_active'] });
      setContractorId(data.id);
      setNewContractor('');
      toast.success(`${data.name} cadastrada.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!target || !contractorId) throw new Error('Selecione costureira/terceirizado.');
      const total = quantity * unitPrice;
      const payload = {
        related_order_id: target.orderId,
        sector: target.sector,
        contractor_id: contractorId,
        description: `Terceirização ${target.sector} — OP ${target.orderNumber} (${target.reference})`,
        quantity,
        unit_price: unitPrice,
        total_value: total,
        service_date: deadline || null,
        status: deadline ? 'em_andamento' : 'aguardando_aceite',
        materials_sent: materialsNotes ? [{ note: materialsNotes }] : [],
        notes: notes || `OP em gargalo: ${target.reason}. Setor saturado em ${target.weekLabel}.`,
      };
      const { error } = await (supabase as any).from('service_orders').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active_outsource_oses'] });
      qc.invalidateQueries({ queryKey: ['production_control_timeline'] });
      toast.success(deadline ? 'OS criada com prazo. Setor seguinte bloqueado até a entrega.' : 'OS criada. Aguardando aceite da costureira.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!target) return null;

  const total = quantity * unitPrice;

  return (
    <Dialog open={!!target} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> Terceirizar OP {target.orderNumber}
            <Badge variant="outline" className="text-[10px]">{target.sector}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardContent className="p-3 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium">{target.reference} · {target.quantity} pares</p>
                  <p className="text-muted-foreground mt-1">{target.reason} · semana {target.weekLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Costureira / Mesa terceirizada *</Label>
              <div className="flex gap-2 mt-1">
                <Select value={contractorId} onValueChange={setContractorId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    {contractors.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.service_type ? ` (${c.service_type})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Botão pra cadastrar novo terceiro inline */}
              <div className="flex gap-2 mt-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Nome da costureira/mesa..."
                  value={newContractor}
                  onChange={e => setNewContractor(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => createContractor.mutate(newContractor)}
                  disabled={!newContractor.trim() || createContractor.isPending}
                >
                  {createContractor.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Cadastrar'}
                </Button>
              </div>
            </div>

            <div>
              <Label>Quantidade (pares) *</Label>
              <Input type="number" min={1} max={target.quantity} value={quantity}
                onChange={e => setQuantity(+e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">
                OP completa: {target.quantity} pares
              </p>
            </div>
            <div>
              <Label>Valor unitário (R$/par)</Label>
              <Input type="number" step="0.01" min={0} value={unitPrice}
                onChange={e => setUnitPrice(+e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                Total: R$ {total.toFixed(2)}
              </p>
            </div>

            <div className="col-span-2">
              <Label>Prazo de entrega <span className="text-muted-foreground">(opcional — costureira pode confirmar depois)</span></Label>
              <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se definir agora, o setor seguinte da OP fica bloqueado até esta data.
                Sem prazo, a OS fica "aguardando aceite" até você cadastrar a data.
              </p>
            </div>

            <div className="col-span-2">
              <Label>Materiais enviados</Label>
              <Textarea rows={2} value={materialsNotes} onChange={e => setMaterialsNotes(e.target.value)}
                placeholder="Ex: 220 cabedais MOD-038 marrom, 220 forros, 1 cartão de medidas" />
            </div>

            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notas internas (opcional)" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !contractorId || quantity <= 0}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            <Send className="h-4 w-4 mr-1" /> Criar OS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm deadline dialog ──────────────────────────────────────────────

function ConfirmDeadlineDialog({ os, onClose }: { os: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [deadline, setDeadline] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      if (!os) return;
      const { error } = await (supabase as any)
        .from('service_orders')
        .update({
          service_date: deadline,
          status: 'em_andamento',
          updated_at: new Date().toISOString(),
        })
        .eq('id', os.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active_outsource_oses'] });
      toast.success('Prazo registrado. Setor seguinte da OP foi bloqueado automaticamente.');
      setDeadline('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!os) return null;

  return (
    <Dialog open={!!os} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Confirmar prazo da costureira
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-xs space-y-1">
              <p className="font-medium">{os.contractors?.name} · {os.sector}</p>
              <p className="text-muted-foreground">
                {os.orders?.order_number} · {os.quantity || 0} pares
                {os.unit_price ? ` · R$ ${Number(os.unit_price).toFixed(2)}/p` : ''}
              </p>
            </CardContent>
          </Card>

          <div>
            <Label>Data prometida pela costureira *</Label>
            <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">
              Quando confirmar, o setor seguinte da OP (geralmente Montagem) fica bloqueado
              até esta data via trigger no banco — não vai iniciar antes mesmo se outro
              operador tentar.
            </p>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ArrowRight className="h-3 w-3" />
            Após confirmar: status muda pra <strong>em andamento</strong>, kanban da OP
            mostra o bloqueio até <strong>{deadline ? format(parseISO(deadline), 'dd/MM/yyyy') : '—'}</strong>.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!deadline || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            <CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar prazo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
