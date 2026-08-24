import { useMemo, useState, useEffect } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Warning as AlertTriangle, Pulse as Activity, Truck, CircleNotch as Loader2, PaperPlaneRight as Send, CheckCircle as CheckCircle2, Calendar, TrendUp as TrendingUp, ArrowRight, Gear as Settings, Bell, Clock, Medal as Award, WarningCircle as AlertCircle, BellRinging as BellRing, X } from '@phosphor-icons/react';
import { format, parseISO, addWeeks, startOfWeek, getISOWeek, getISOWeekYear, differenceInBusinessDays, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { isOsActive, isOsCancelled, isOsDone } from '@/lib/osStatusMachine';

// ─── Setores monitorados ───────────────────────────────────────────────────

type MonitoredSector = 'Corte Palmilha' | 'Corte Forração' | 'Aviamento' | 'Costura';

const MONITORED_SECTORS: { key: MonitoredSector; capCol: string; label: string }[] = [
  { key: 'Corte Palmilha', capCol: 'sewing_capacity_per_day',   label: 'Corte Palmilha' },
  { key: 'Corte Forração', capCol: 'cutting_capacity_per_day',  label: 'Corte Forração' },
  { key: 'Aviamento',      capCol: 'mesa_daily_capacity',       label: 'Aviamento (Mesa)' },
  { key: 'Costura',        capCol: 'costura_capacity_per_day',  label: 'Costura' },
];

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

const SERVICE_ORDER_SECTOR: Record<MonitoredSector, string> = {
  'Corte Palmilha': 'corte_palmilha',
  'Corte Forração': 'corte_forracao',
  'Aviamento': 'mesa',
  'Costura': 'costura',
};

const WEEKS_TO_SHOW = 8;

// ─── Limiares de carga (cadastrados em system_settings) ────────────────────
//
// Os defaults espelham o servidor: `detect_production_bottlenecks_and_alert`
// faz COALESCE(alert_min_load_pct, 105) / COALESCE(alert_critical_load_pct, 130)
// (migration 20260627140001). Só valem quando a chave não existe / não é numérica
// — em produção as duas estão cadastradas (105 e 130).
const ALERT_SETTING_KEYS = [
  'alert_phone_whatsapp',
  'alert_webhook_url',
  'alert_min_load_pct',
  'alert_critical_load_pct',
] as const;

const DEFAULT_MIN_LOAD_PCT = 105;
const DEFAULT_CRITICAL_LOAD_PCT = 130;

/** Query compartilhada entre o painel e o dialog de configurações (mesma queryKey
 *  ⇒ salvar nas configurações reflete no painel sem reload). */
function useAlertSettings(enabled = true) {
  return useQuery({
    queryKey: ['system_settings_alerts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('system_settings')
        .select('*')
        .in('key', ALERT_SETTING_KEYS as unknown as string[]);
      if (error) throw error;
      return data || [];
    },
  });
}

/** `value` é jsonb: pode chegar como number (105) ou string ("105"). */
function settingToNumber(raw: any, fallback: number): number {
  const n = Number(String(raw ?? '').replace(/^"|"$/g, ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Teto de leitura do histórico. Exposto porque a UI avisa quando ele morde
// (hoje não morde: 387 OS no total, 32 com setor preenchido).
const HISTORY_LIMIT = 1000;

// ─── Helpers ───────────────────────────────────────────────────────────────

const isoWeekKey = (d: Date) => `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
const weekHeader = (d: Date) => `S${getISOWeek(d)}`;

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
  reference_id: string;
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

interface SheetCapacityRow {
  id: string;
  name: string;
  sewing_capacity_per_day: number | null;
  cutting_capacity_per_day: number | null;
  mesa_daily_capacity: number | null;
  costura_capacity_per_day: number | null;
}

interface BottleneckRow {
  orderId: string;
  saleOrderId: string;
  orderNumber: string;
  reference: string;
  sheetId: string;
  quantity: number;
  sector: MonitoredSector;
  weekKey: string;
  weekLabel: string;
  fichaCapacity: number;
  dailyNeeded: number;
  loadPct: number;
  /** Classificado com os limiares cadastrados, não com constantes locais. */
  severity: 'critical' | 'warning';
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
  // A aba mora na URL (contrato do lote L6): antes era <Tabs defaultValue>, então
  // F5 e o botão Voltar devolviam o usuário à primeira aba.
  const { value: abaUrl, setValue: setAbaUrl } = useUrlTabState({
    values: ['dashboard', 'alertas', 'historico'] as const,
    defaultValue: 'dashboard',
  });
  const [outsourceTarget, setOutsourceTarget] = useState<BottleneckRow | null>(null);
  const [confirmDeadlineFor, setConfirmDeadlineFor] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const qc = useQueryClient();

  // ── Timeline (OPs ativas com datas planejadas e refs)
  //
  // ⚠ `isError` é obrigatório aqui: com o default `[]` e só `isLoading`, uma falha
  // de leitura fazia o painel calcular 0 gargalos e anunciar "Sem gargalo" /
  // "Capacidade folgada" — a UI afirmava o contrário do que sabia.
  const {
    data: timelineRows = [],
    isLoading: loadingTimeline,
    isError: timelineError,
    refetch: refetchTimeline,
    isFetching: fetchingTimeline,
  } = useQuery({
    queryKey: ['production_control_timeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_projection_timeline' as any)
        .select(
          'order_id, pedido_ref, sale_order_id, referencia_nome, reference_id, op_quantity, order_status, data_entrega_cliente, ' +
          'data_inicio_palmilha, data_inicio_corte, data_inicio_mesa, data_inicio_costura, ' +
          'lead_time_palmilha_dias, lead_time_corte_dias, lead_time_mesa_dias, lead_time_costura_dias'
        );
      if (error) throw error;
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

  // ── Capacidades por ficha (per-OP usa sua própria ficha)
  const {
    data: sheetCapacities = [] as SheetCapacityRow[],
    isLoading: loadingCaps,
    isError: capsError,
    refetch: refetchCaps,
    isFetching: fetchingCaps,
  } = useQuery({
    queryKey: ['sheets_capacities'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheets')
        .select('id, name, sewing_capacity_per_day, cutting_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day')
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // ── Limiares de alerta cadastrados (Configurações)
  //
  // O dialog de Configurações promete que "acima desse % dispara warning /
  // vira critical", mas a detecção local ignorava os campos e usava 100/130
  // fixos. Agora os dois lados leem a mesma fonte.
  const { data: alertSettings = [] } = useAlertSettings();

  const { minLoadPct, criticalLoadPct } = useMemo(() => {
    const valueOf = (k: string) => (alertSettings as any[]).find(s => s.key === k)?.value;
    return {
      minLoadPct: settingToNumber(valueOf('alert_min_load_pct'), DEFAULT_MIN_LOAD_PCT),
      criticalLoadPct: settingToNumber(valueOf('alert_critical_load_pct'), DEFAULT_CRITICAL_LOAD_PCT),
    };
  }, [alertSettings]);

  // Lookup map id → ficha
  const sheetById = useMemo(() => {
    const m = new Map<string, SheetCapacityRow>();
    for (const s of sheetCapacities) m.set(s.id, s);
    return m;
  }, [sheetCapacities]);

  // Capacidade média (fallback pra heatmap aggregate)
  const avgCapacities = useMemo(() => {
    const result: Record<MonitoredSector, number> = {
      'Corte Palmilha': 0, 'Corte Forração': 0, 'Aviamento': 0, 'Costura': 0,
    };
    for (const s of MONITORED_SECTORS) {
      const col = s.capCol as keyof SheetCapacityRow;
      const vals = sheetCapacities
        .map(r => Number(r[col] as any) || 0)
        .filter(v => v > 0);
      result[s.key] = vals.length > 0
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : 300;
    }
    return result;
  }, [sheetCapacities]);

  // ── Alertas em aberto (assinatura realtime)
  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['production_alerts_active'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('production_alerts')
        .select('*')
        .is('dismissed_at', null)
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  // Subscribe em realtime — quando chega novo alert, toast + refetch
  useEffect(() => {
    const channel = (supabase as any)
      .channel('production-alerts-realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'production_alerts' },
        (payload: any) => {
          const a = payload.new;
          if (a?.severity === 'critical') {
            toast.error(a.title, { description: a.body, duration: 8000 });
          } else {
            toast.warning(a.title, { description: a.body, duration: 6000 });
          }
          qc.invalidateQueries({ queryKey: ['production_alerts_active'] });
        },
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [qc]);

  // ── OSes terceirizadas ativas
  //
  // ⚠ Este painel vinha SEMPRE VAZIO por DOIS filtros errados (auditoria
  // 2026-07-29 direto no banco de produção, 385 OS):
  //   1. `related_order_id` — ZERO linhas preenchidas. O vínculo OP↔OS é
  //      `order_id`. As duas colunas têm FK pra `orders`; aceitamos as duas.
  //   2. `sector` — só 1 linha preenchida. O setor da OS mora em
  //      `target_sector` (30 linhas).
  //   3. `status` — a lista literal ['Pendente','pendente','em_andamento',
  //      'aguardando_aceite'] não cobria o domínio real do banco, que grava
  //      'Em Andamento' (com espaço e maiúsculas). Essas OS sumiam do card sem
  //      erro. O vocabulário canônico é `osStatusMachine`: ativa = nem concluída
  //      nem cancelada. Aplicado no cliente de propósito — o recorte por setor já
  //      reduz a leitura a poucas dezenas de linhas, e assim nenhuma grafia nova
  //      precisa ser replicada num `.in()` daqui pra frente.
  // Sem OP vinculada a OS ainda é comum (só 3 das 385 têm `order_id`), então o
  // painel não exige o vínculo: mostra a terceirização que existe de fato.
  const { data: activeOutsourceOses = [] } = useQuery({
    queryKey: ['active_outsource_oses'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('*, contractors(name), orders!service_orders_order_id_fkey(order_number, quantity, reference_id, technical_sheets:reference_id(name))')
        .or('target_sector.not.is.null,sector.not.is.null')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data || []) as any[]).filter(os => isOsActive(os.status));
    },
  });

  // ── Semanas
  const weeks = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: WEEKS_TO_SHOW }, (_, i) => addWeeks(start, i));
  }, []);

  // ── Heatmap (aggregate) + Gargalos (per-ficha)
  const { heatmap, bottlenecks } = useMemo(() => {
    const cells = new Map<string, HeatmapCell>();
    const initCell = (weekKey: string, weekLabel: string, sector: MonitoredSector) => {
      const id = `${weekKey}:${sector}`;
      if (!cells.has(id)) {
        cells.set(id, {
          weekKey, weekLabel, sector,
          plannedPairs: 0,
          capacityPairs: (avgCapacities[sector] || 300) * 5,
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

    const perOpBottlenecks: BottleneckRow[] = [];

    for (const row of timelineRows) {
      const status = (row.order_status || '').toLowerCase();
      if (['finalizado', 'faturado', 'cancelado', 'concluido', 'concluído', 'pronto'].includes(status)) continue;

      const ficha = sheetById.get(row.reference_id);

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
          if (cell) {
            cell.plannedPairs += row.op_quantity;
            cell.orderIds.push(row.order_id);
          }

          // Per-ficha bottleneck check: daily_needed vs ficha_capacity
          const fichaCapacity = ficha ? Number((ficha as any)[s.capCol]) || avgCapacities[s.key] : avgCapacities[s.key];
          if (fichaCapacity <= 0) continue;
          const dailyNeeded = row.op_quantity / leadDays;
          const loadPct = (dailyNeeded / fichaCapacity) * 100;
          if (loadPct > minLoadPct && cell) {
            const severity: 'critical' | 'warning' = loadPct > criticalLoadPct ? 'critical' : 'warning';
            perOpBottlenecks.push({
              orderId: row.order_id,
              saleOrderId: row.sale_order_id,
              orderNumber: row.pedido_ref,
              reference: row.referencia_nome,
              sheetId: row.reference_id,
              quantity: row.op_quantity,
              sector: s.key,
              weekKey: cell.weekKey,
              weekLabel: cell.weekLabel,
              fichaCapacity,
              dailyNeeded,
              loadPct,
              severity,
              reason: severity === 'critical'
                ? `Ficha precisa de ${Math.round(dailyNeeded)} pares/dia mas só faz ${Math.round(fichaCapacity)}/dia (${Math.round(loadPct)}%).`
                : `Setor próximo do limite: ${Math.round(dailyNeeded)}/${Math.round(fichaCapacity)} pares/dia (${Math.round(loadPct)}%).`,
            });
          }
        } catch {/* ignore */}
      }
    }

    const heatmap = Array.from(cells.values()).map(c => ({
      ...c,
      loadPct: c.capacityPairs > 0 ? (c.plannedPairs / c.capacityPairs) * 100 : 0,
    }));

    perOpBottlenecks.sort((a, b) => b.loadPct - a.loadPct);
    return { heatmap, bottlenecks: perOpBottlenecks };
  }, [timelineRows, weeks, avgCapacities, sheetById, minLoadPct, criticalLoadPct]);

  const opsAtRisk = new Set(bottlenecks.map(b => b.orderId)).size;
  const worstCell = heatmap.reduce(
    (acc, c) => (c.loadPct > acc.loadPct ? c : acc),
    { loadPct: 0, sector: 'Costura' as MonitoredSector, weekLabel: '—' } as HeatmapCell,
  );
  const criticalAlerts = activeAlerts.filter((a: any) => a.severity === 'critical').length;

  const isLoading = loadingTimeline || loadingCaps;
  const planningError = timelineError || capsError;
  const retryPlanning = () => { refetchTimeline(); refetchCaps(); };
  const retryingPlanning = fetchingTimeline || fetchingCaps;

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · CONTROLE"
        title="Centro de Controle de Produção"
        description="Capacidade por ficha · Alertas automáticos via WhatsApp · Terceirização com 1 clique."
        actions={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="gap-1.5">
            <Settings className="h-4 w-4" /> Configurações
          </Button>
        }
      />

      <Tabs value={abaUrl} onValueChange={setAbaUrl}>
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Visão geral
          </TabsTrigger>
          <TabsTrigger value="alertas" className="gap-1.5">
            <Bell className="h-3.5 w-3.5" /> Alertas
            {activeAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">{activeAlerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5">
            <Award className="h-3.5 w-3.5" /> Histórico terceirização
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Visão geral ── */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          {planningError && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-lg border border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="font-semibold text-foreground">Falha ao carregar o planejamento de capacidade</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Sem os dados de OPs e fichas não dá pra saber se há gargalo — os indicadores ficam ocultos
                em vez de mostrar zero. Pode ser instabilidade momentânea de conexão.
              </p>
              <Button onClick={retryPlanning} disabled={retryingPlanning} className="mt-1 gap-1.5">
                {retryingPlanning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {retryingPlanning ? 'Carregando…' : 'Tentar novamente'}
              </Button>
            </div>
          )}

          {!planningError && (<>
          {/* KPIs */}
          <StatGrid>
            <StatCard
              label="OPs em risco"
              value={opsAtRisk}
              tone={opsAtRisk > 0 ? 'destructive' : 'default'}
              hint={`${bottlenecks.length} gargalos (per-ficha)`}
            />
            <StatCard
              label="Maior gargalo"
              value={worstCell.loadPct === 0 ? 'Sem gargalo' : worstCell.sector}
              tone={worstCell.loadPct === 0 ? 'success' : 'warning'}
              hint={
                worstCell.loadPct === 0
                  ? 'Capacidade folgada nas próximas semanas'
                  : `${worstCell.weekLabel && worstCell.weekLabel !== '—' ? `${worstCell.weekLabel} · ` : ''}${Math.round(worstCell.loadPct)}%`
              }
            />
            <StatCard
              label="Alertas críticos"
              value={criticalAlerts}
              tone={criticalAlerts > 0 ? 'destructive' : 'default'}
              hint={`${activeAlerts.length} alertas ativos`}
            />
            <StatCard
              label="OSes terceirizadas"
              value={activeOutsourceOses.length}
              hint="ativas"
            />
          </StatGrid>

          {/* Heatmap */}
          <Panel
            title={`Capacidade × Demanda · próximas ${WEEKS_TO_SHOW} semanas`}
            bodyClassName="overflow-x-auto"
          >
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <th className="text-left p-2 sticky left-0 bg-muted/40">Setor</th>
                      {weeks.map(w => (
                        <th key={isoWeekKey(w)} className="text-center p-2 min-w-[68px]">
                          <p>{weekHeader(w)}</p>
                          <p className="text-xs text-muted-foreground font-normal normal-case tracking-normal">{format(w, 'dd/MM', { locale: ptBR })}</p>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MONITORED_SECTORS.map(s => (
                      <tr key={s.key} className="border-b border-border/40">
                        <td className="p-2 font-medium sticky left-0 bg-card">
                          {s.label}
                          <p className="text-xs text-muted-foreground">média {avgCapacities[s.key] || 0}/d</p>
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
                                <p className="font-mono font-bold leading-none">{Math.round(pct)}%</p>
                                <p className="text-xs leading-tight mt-0.5 opacity-80">{planned}p</p>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Panel>

          {/* Gargalos per-ficha */}
          <Panel
            title={`Gargalos por ficha técnica (${bottlenecks.length})`}
            subtitle="Detecção compara demanda diária da OP com capacidade real da sua ficha"
            flush
          >
              {bottlenecks.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nenhum gargalo detectado"
                  description={`Capacidade das fichas folgada nas próximas ${WEEKS_TO_SHOW} semanas.`}
                  size="sm"
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {bottlenecks.slice(0, 50).map((b, i) => (
                    <div key={`${b.orderId}-${b.sector}-${i}`} className="p-3 flex items-center gap-3">
                      <Badge variant="outline" className={`text-xs capitalize ${
                        b.severity === 'critical' ? 'bg-destructive/10 text-destructive border-destructive/30'
                                                  : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                      }`}>
                        {b.severity === 'critical' ? 'Crítico' : 'Atenção'}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          OP {b.orderNumber} · <span className="text-muted-foreground">{b.reference}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {b.quantity} pares · <span className="font-medium">{b.sector}</span> · {b.weekLabel}
                          <span className="ml-2 font-mono">{Math.round(b.dailyNeeded)}/{Math.round(b.fichaCapacity)} pares/dia</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{b.reason}</p>
                      </div>
                      <Button size="sm" className="gap-1.5" onClick={() => setOutsourceTarget(b)}>
                        <Truck className="h-3.5 w-3.5" /> Terceirizar
                      </Button>
                    </div>
                  ))}
                  {bottlenecks.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      +{bottlenecks.length - 50} gargalos adicionais
                    </p>
                  )}
                </div>
              )}
          </Panel>
          </>)}

          {/* OSes terceirizadas ativas */}
          <Panel title={`OSes terceirizadas ativas (${activeOutsourceOses.length})`} flush>
              {activeOutsourceOses.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="Nenhuma OS em aberto"
                  description="OSes terceirizadas ativas aparecem aqui assim que forem criadas."
                  size="sm"
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {activeOutsourceOses.map((os: any) => (
                    <OutsourceOsRow key={os.id} os={os} onConfirmDeadline={() => setConfirmDeadlineFor(os)} />
                  ))}
                </div>
              )}
          </Panel>
        </TabsContent>

        {/* ── Tab: Alertas ── */}
        <TabsContent value="alertas" className="mt-4">
          <AlertsSection alerts={activeAlerts} />
        </TabsContent>

        {/* ── Tab: Histórico terceirização ── */}
        <TabsContent value="historico" className="mt-4">
          <OutsourceHistorySection />
        </TabsContent>
      </Tabs>

      <OutsourceDialog target={outsourceTarget} onClose={() => setOutsourceTarget(null)} />
      <ConfirmDeadlineDialog os={confirmDeadlineFor} onClose={() => setConfirmDeadlineFor(null)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ─── Alerts section ─────────────────────────────────────────────────────────

function AlertsSection({ alerts }: { alerts: any[] }) {
  const qc = useQueryClient();

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('production_alerts')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_alerts_active'] });
    },
  });

  const triggerDetection = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('detect_production_bottlenecks_and_alert');
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['production_alerts_active'] });
      // As chaves são `created`/`notified`/`failed` — o RETURN jsonb_build_object
      // de `detect_production_bottlenecks_and_alert` (mig 20260627140001). Lendo
      // `alerts_created`/`alerts_notified` (nomes das variáveis PL/pgSQL, não das
      // chaves) o toast dizia "0 alertas novos" mesmo tendo criado alertas.
      const created = data?.created ?? 0;
      const notified = data?.notified ?? 0;
      const failed = data?.failed ?? 0;
      const resumo = `Detecção rodada: ${created} alertas novos, ${notified} notificados.`;
      if (failed > 0) {
        toast.warning(`${resumo} ${failed} falharam no envio.`);
      } else {
        toast.success(resumo);
      }
    },
    onError: (e: Error) => toast.error(`Falha: ${e.message}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold">Alertas de produção</h2>
            <p className="text-xs text-muted-foreground">
              Detecção automática a cada 30min (SEG-SEX 8h-18h). Disparo WhatsApp se webhook configurado.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => triggerDetection.mutate()} disabled={triggerDetection.isPending}>
          {triggerDetection.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          Rodar detecção agora
        </Button>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nenhum alerta ativo"
          description="Alertas críticos param de aparecer aqui quando você dispensa ou quando o gargalo é resolvido."
        />
      ) : (
        <div className="space-y-2">
          {alerts.map((a: any) => (
            <Card key={a.id} className={a.severity === 'critical' ? 'border-destructive/30 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5'}>
              <CardContent className="p-3 flex items-start gap-3">
                {a.severity === 'critical'
                  ? <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{a.title}</p>
                    <Badge variant="outline" className={`text-xs capitalize ${
                      a.severity === 'critical' ? 'bg-destructive/10 text-destructive border-destructive/30'
                                                : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                    }`}>
                      {a.severity}
                    </Badge>
                    {a.notification_status === 'sent' && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                        WhatsApp enviado
                      </Badge>
                    )}
                    {a.notification_status === 'failed' && (
                      <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30" title={a.notification_error}>
                        WhatsApp falhou
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.body}</p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(parseISO(a.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={() => dismiss.mutate(a.id)}
                  title="Dispensar alerta">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Outsource history section ──────────────────────────────────────────────

interface ContractorStats {
  contractorId: string;
  contractorName: string;
  totalOses: number;
  totalPairs: number;
  totalValue: number;
  onTimeCount: number;
  lateCount: number;
  inProgressCount: number;
  cancelledCount: number;
  avgDelayDays: number;
}

function OutsourceHistorySection() {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['outsource_history'],
    queryFn: async () => {
      // Mesmo motivo do painel de OS ativas: `related_order_id` está vazio em
      // 100% das linhas e o setor mora em `target_sector`, não em `sector`.
      // Com os filtros antigos o histórico de terceirização era sempre zero.
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('*, contractors(id, name)')
        .or('target_sector.not.is.null,sector.not.is.null')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw error;
      return data || [];
    },
  });

  // O teto de leitura corta em silêncio: batendo nele, o ranking passa a
  // descrever só as OSes mais recentes sem dizer isso em lugar nenhum.
  const historyCapped = history.length >= HISTORY_LIMIT;

  const stats = useMemo<ContractorStats[]>(() => {
    const map = new Map<string, ContractorStats>();
    for (const os of history) {
      const cid = os.contractor_id || 'unknown';
      const cname = os.contractors?.name || 'Sem contractor';
      if (!map.has(cid)) {
        map.set(cid, {
          contractorId: cid,
          contractorName: cname,
          totalOses: 0,
          totalPairs: 0,
          totalValue: 0,
          onTimeCount: 0,
          lateCount: 0,
          inProgressCount: 0,
          cancelledCount: 0,
          avgDelayDays: 0,
        });
      }
      const s = map.get(cid)!;
      s.totalOses += 1;

      // Classificar ANTES de somar: pares e valor de OS cancelada não são
      // produção entregue, e entravam no total do ranking.
      if (isOsCancelled(os.status)) {
        s.cancelledCount += 1;
        continue;
      }

      s.totalPairs += Number(os.quantity || 0);
      s.totalValue += Number(os.total_value || 0);

      // `isOsDone` cobre 'Concluído' (grafia canônica gravada pelo form) —
      // o `String(status).toLowerCase() === 'concluido'` anterior comparava
      // sem acento, então a OS concluída de verdade nunca entrava na
      // pontualidade e o ranking mostrava 0% no prazo.
      if (isOsDone(os.status)) {
        // Nas OS planejadas, service_date é a SAÍDA e quoted_deadline é o
        // RETORNO. O fallback mantém a leitura das OS legadas.
        const promisedDate = os.quoted_deadline || os.service_date;
        const promised = promisedDate ? parseISO(promisedDate) : null;
        const deliveredAt = os.delivered_at || os.receipt_generated_at || os.updated_at;
        const delivered = deliveredAt ? parseISO(deliveredAt) : null;
        if (promised && delivered) {
          const delta = differenceInDays(delivered, promised);
          if (delta <= 0) {
            s.onTimeCount += 1;
          } else {
            s.lateCount += 1;
            s.avgDelayDays = (s.avgDelayDays * (s.lateCount - 1) + delta) / s.lateCount;
          }
        }
      } else {
        // Nem concluída nem cancelada = ainda em andamento (inclui
        // 'aguardando_aceite', que `normalizeOsStatus` trata como Pendente).
        s.inProgressCount += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalOses - a.totalOses);
  }, [history]);

  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando…</p>;
  if (stats.length === 0) {
    return (
      <EmptyState
        icon={Award}
        title="Nenhum histórico de terceirização ainda"
        description="Após criar e concluir OSes, o ranking de costureiras / terceirizados aparece aqui."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" /> Performance de costureiras / terceirizados
        </h2>
        <span className="text-xs text-muted-foreground">{history.length} OSes históricas</span>
      </div>

      {historyCapped && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Leitura limitada às {HISTORY_LIMIT} OSes mais recentes — existem mais no banco.
            O ranking abaixo descreve só esse recorte.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {stats.map((s, i) => {
          const totalConcluded = s.onTimeCount + s.lateCount;
          const onTimePct = totalConcluded > 0 ? Math.round((s.onTimeCount / totalConcluded) * 100) : null;
          return (
            <Card key={s.contractorId}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{s.contractorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.totalOses} OSes · {s.totalPairs} pares · R$ {s.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    {s.cancelledCount > 0 && (
                      <span className="ml-1">({s.cancelledCount} cancelada{s.cancelledCount > 1 ? 's' : ''}, fora do total)</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  {onTimePct !== null && (
                    <div className="text-center">
                      <p className={`font-bold ${onTimePct >= 80 ? 'text-emerald-600' : onTimePct >= 60 ? 'text-amber-600' : 'text-destructive'}`}>
                        {onTimePct}%
                      </p>
                      <p className="text-muted-foreground text-xs">no prazo</p>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="font-bold text-emerald-600">{s.onTimeCount}</p>
                    <p className="text-muted-foreground text-xs">concluídas</p>
                  </div>
                  {s.lateCount > 0 && (
                    <div className="text-center">
                      <p className="font-bold text-destructive">{s.lateCount}</p>
                      <p className="text-muted-foreground text-xs">+{s.avgDelayDays.toFixed(1)}d médio</p>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="font-bold">{s.inProgressCount}</p>
                    <p className="text-muted-foreground text-xs">em andamento</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings dialog ────────────────────────────────────────────────────────

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();

  // Mesma queryKey do painel: salvar aqui invalida e o painel reclassifica os
  // gargalos com os novos limiares sem reload.
  const { data: settings = [] } = useAlertSettings(open);

  const settingsMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of settings) m.set(s.key, s.value);
    return m;
  }, [settings]);

  const [phone, setPhone] = useState('');
  const [webhook, setWebhook] = useState('');
  const [minPct, setMinPct] = useState(DEFAULT_MIN_LOAD_PCT);
  const [critPct, setCritPct] = useState(DEFAULT_CRITICAL_LOAD_PCT);

  useEffect(() => {
    if (open && settings.length > 0) {
      setPhone(String(settingsMap.get('alert_phone_whatsapp') ?? '').replace(/^"|"$/g, ''));
      setWebhook(String(settingsMap.get('alert_webhook_url') ?? '').replace(/^"|"$/g, ''));
      setMinPct(settingToNumber(settingsMap.get('alert_min_load_pct'), DEFAULT_MIN_LOAD_PCT));
      setCritPct(settingToNumber(settingsMap.get('alert_critical_load_pct'), DEFAULT_CRITICAL_LOAD_PCT));
    }
  }, [open, settings.length, settingsMap]);

  const save = useMutation({
    mutationFn: async () => {
      const updates = [
        { key: 'alert_phone_whatsapp', value: JSON.stringify(phone) },
        { key: 'alert_webhook_url', value: JSON.stringify(webhook) },
        { key: 'alert_min_load_pct', value: String(minPct) },
        { key: 'alert_critical_load_pct', value: String(critPct) },
      ];
      for (const u of updates) {
        const { error } = await (supabase as any)
          .from('system_settings')
          .upsert({ ...u, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system_settings_alerts'] });
      toast.success('Configurações salvas.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testWebhook = useMutation({
    mutationFn: async () => {
      if (!webhook) throw new Error('Configure a URL primeiro.');
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          title: '[Teste] Centro de Controle',
          body: 'Mensagem de teste do sistema de alertas. Se você recebeu, está tudo OK!',
          severity: 'warning',
          alert_id: 'test',
          payload: { test: true },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },
    onSuccess: () => toast.success('Webhook OK! Teste enviado.'),
    onError: (e: Error) => toast.error(`Falha: ${e.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" /> Configurações do Centro de Controle
          </DialogTitle>
          <DialogDescription>Preferências de alertas e notificações do centro de controle.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs font-bold uppercase">WhatsApp destinatário</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+5521982622290" className="mt-1 font-mono" />
            <p className="text-xs text-muted-foreground mt-1">
              Formato E.164 (com código do país). Ex: +5521982622290.
            </p>
          </div>

          <div>
            <Label className="text-xs font-bold uppercase">URL do webhook</Label>
            <Input value={webhook} onChange={e => setWebhook(e.target.value)}
              placeholder="https://api.z-api.io/instances/.../send-text" className="mt-1 font-mono text-xs" />
            <p className="text-xs text-muted-foreground mt-1">
              POST que recebe <code className="font-mono">{`{phone, title, body, severity, payload}`}</code>.
              Use Z-API, Make.com, Zapier, WPPConnect ou Twilio. O endpoint deve enviar a mensagem pra WhatsApp.
            </p>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => testWebhook.mutate()} disabled={testWebhook.isPending || !webhook}>
              {testWebhook.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              <Send className="h-3 w-3" /> Testar webhook
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-bold uppercase">Carga mínima (% alerta)</Label>
              <Input type="number" min={100} max={200} value={minPct} onChange={e => setMinPct(+e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Acima desse % a OP entra na lista de gargalos como “Atenção”.</p>
            </div>
            <div>
              <Label className="text-xs font-bold uppercase">Carga crítica (% alerta)</Label>
              <Input type="number" min={100} max={300} value={critPct} onChange={e => setCritPct(+e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Acima desse % o gargalo é marcado como “Crítico”.</p>
            </div>
          </div>

          <Card className="bg-muted/30 border-border/50">
            <CardContent className="p-3 text-xs space-y-1 text-muted-foreground">
              <p className="font-medium text-foreground">Como funciona:</p>
              <ul className="list-disc ml-4 space-y-0.5">
                <li>Cron roda a cada 30min em horário comercial</li>
                <li>Detecta OPs cuja demanda diária excede capacidade da ficha</li>
                <li>Cria alerta + POST no webhook com payload completo</li>
                <li>Toast aparece pra quem estiver com a página aberta</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Outsource Os row ───────────────────────────────────────────────────────

function OutsourceOsRow({ os, onConfirmDeadline }: { os: any; onConfirmDeadline: () => void }) {
  const status = String(os.status || '').toLowerCase();
  const needsDeadline = !os.quoted_deadline || ['aguardando_aceite'].includes(status);
  const statusLabel = needsDeadline
    ? 'Aguardando prazo'
    : ['pendente', 'aguardando_envio'].includes(status) ? 'Prazo calculado' : 'Em andamento';
  const opLabel = os.orders?.order_number
    ? `OP ${os.orders.order_number}${os.orders?.technical_sheets?.name ? ` · ${os.orders.technical_sheets.name}` : ''}`
    : '—';

  return (
    <div className="p-3 flex items-center gap-3">
      <Badge variant="outline" className={`text-xs capitalize ${
        needsDeadline ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
      }`}>
        {statusLabel}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {os.contractors?.name || 'Contractor sem nome'} · <span className="text-muted-foreground">{os.sector}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {opLabel} · {os.quantity || 0} pares
          {os.unit_price ? ` · R$ ${Number(os.unit_price).toFixed(2)}/p` : ''}
          {os.total_value ? ` · total R$ ${Number(os.total_value).toFixed(2)}` : ''}
          {os.service_date ? ` · enviar ${format(parseISO(os.service_date), 'dd/MM/yyyy')}` : ''}
          {os.quoted_deadline ? ` · retornar ${format(parseISO(os.quoted_deadline), 'dd/MM/yyyy')}` : ''}
        </p>
        {os.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{os.description}</p>}
        {Number(os.provider_capacity_pairs_per_day) > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Capacidade {Number(os.provider_capacity_pairs_per_day).toLocaleString('pt-BR')} pares/dia
            {os.execution_days ? ` · execução ${os.execution_days}d` : ''}
            {os.queue_days != null ? ` · fila ${os.queue_days}d` : ''}
            {os.return_before_sector ? ` · retorno antes de ${os.return_before_sector}` : ''}
          </p>
        )}
        {os.planning_warning && (
          <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {os.planning_warning}
          </p>
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

// ─── Outsource dialog ──────────────────────────────────────────────────────

function OutsourceDialog({ target, onClose }: { target: BottleneckRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [contractorId, setContractorId] = useState('');
  const [newContractor, setNewContractor] = useState('');
  const [quantity, setQuantity] = useState<number>(target?.quantity ?? 0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (target) {
      setQuantity(target.quantity);
      setUnitPrice(0);
      setContractorId('');
      setNewContractor('');
      setDeadline('');
      setNotes('');
    }
  }, [target?.orderId]);

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors_active'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contractors')
        .select('id, name, service_type')
        .eq('active', true)
        .order('name');
      if (error) throw error;
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
      if (unitPrice <= 0) throw new Error('Informe o valor por par antes de gerar a OS.');
      // RPC atualizada pela migration do ciclo canônico de OS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('generate_op_service_orders', {
        p_sale_order_id: target.saleOrderId,
        p_lines: [{
          order_id: target.orderId,
          sector: SERVICE_ORDER_SECTOR[target.sector],
          contractor_id: contractorId,
          quantity,
          unit_price: unitPrice,
          quoted_deadline: deadline || null,
          // Exceção explícita do painel de gargalo: permite contingência
          // manual mesmo antes de completar o planejamento da ficha.
          require_planning_config: false,
        }],
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const result = data?.lines?.[0];
      if (!result || result.action === 'invalid_line' || result.action === 'op_not_in_pv') {
        throw new Error(result?.reason || 'A OP não pertence mais ao pedido informado.');
      }

      // O writer canônico cuida dos vínculos e da idempotência. Estas notas são
      // apenas o contexto operacional específico do painel de capacidade.
      if (result.os_id && notes) {
        // Campos de gargalo ainda não estão completos no types.ts gerado.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: noteError } = await (supabase as any)
          .from('service_orders')
          .update({
            notes: notes || `OP em gargalo: ${target.reason}. Capacidade da ficha: ${Math.round(target.fichaCapacity)}/dia.`,
          })
          .eq('id', result.os_id);
        if (noteError) throw noteError;
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active_outsource_oses'] });
      qc.invalidateQueries({ queryKey: ['outsource_history'] });
      qc.invalidateQueries({ queryKey: ['production_control_timeline'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      toast.success(deadline ? 'OS emitida com prazo. Agora registre a remessa física.' : 'OS emitida. Agora registre a remessa física.');
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
            <Badge variant="outline" className="text-xs">{target.sector}</Badge>
          </DialogTitle>
          <DialogDescription>Escolha a costureira/mesa, quantidade e valor para gerar a ordem de serviço.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardContent className="p-3 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium">{target.reference} · {target.quantity} pares</p>
                  <p className="text-muted-foreground mt-1">{target.reason} · {target.weekLabel}</p>
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
              <div className="flex gap-2 mt-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Nome da costureira/mesa..."
                  value={newContractor}
                  onChange={e => setNewContractor(e.target.value)}
                />
                <Button size="sm" variant="outline" className="h-8"
                  onClick={() => createContractor.mutate(newContractor)}
                  disabled={!newContractor.trim() || createContractor.isPending}>
                  {createContractor.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Cadastrar'}
                </Button>
              </div>
            </div>

            <div>
              <Label>Quantidade (pares) *</Label>
              <Input type="number" min={1} max={target.quantity} value={quantity}
                onChange={e => setQuantity(+e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">OP completa: {target.quantity} pares</p>
            </div>
            <div>
              <Label>Valor unitário (R$/par)</Label>
              <CurrencyInput value={unitPrice} onChange={setUnitPrice} />
              <p className="text-xs text-muted-foreground mt-1 font-mono">Total: R$ {total.toFixed(2)}</p>
            </div>

            <div className="col-span-2">
              <Label>Data de retorno <span className="text-muted-foreground">(automática, com ajuste opcional)</span></Label>
              <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                Sem ajuste manual, o servidor calcula o retorno e a data de envio pela capacidade cadastrada na ficha.
              </p>
            </div>

            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas internas (opcional)" />
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
          quoted_deadline: deadline,
          status: 'em_andamento',
          updated_at: new Date().toISOString(),
        })
        .eq('id', os.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active_outsource_oses'] });
      qc.invalidateQueries({ queryKey: ['outsource_history'] });
      toast.success('Prazo registrado. Setor seguinte da OP bloqueado automaticamente.');
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
            <Calendar className="h-4 w-4" /> Confirmar data de retorno
          </DialogTitle>
          <DialogDescription>Defina a data combinada de devolução da OS terceirizada.</DialogDescription>
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
            <Label>Data prometida pelo prestador *</Label>
            <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              A etapa dependente permanece bloqueada até o retorno efetivo da OS; esta data mede o prazo combinado e eventuais atrasos.
            </p>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <ArrowRight className="h-3 w-3" />
            Após confirmar: status muda pra <strong>em andamento</strong>, bloqueio até <strong>{deadline ? format(parseISO(deadline), 'dd/MM/yyyy') : '—'}</strong>.
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
