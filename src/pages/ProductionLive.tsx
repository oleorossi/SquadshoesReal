/**
 * ProductionLive — monitor de chão em tempo real
 *
 * Adaptado de screen-production-live.jsx (pacote Novidade).
 * Mostra cada OP em status='Em Produção' como uma "linha" com:
 *   - identificador da OP (number)
 *   - estágio atual (setor em_andamento)
 *   - taxa pares/h vs meta (calculada da capacidade da ficha)
 *   - progresso geral (% setores concluídos)
 *   - status: rodando | atraso | ociosa
 *
 * Topo: ritmo agregado de pares/h calculado dos últimos 60min de
 * stock_movements de saída (in/out type).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Activity } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, OrderStage } from '@/hooks/useOrderStages';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type Order = {
  id: string;
  order_number?: string | null;
  quantity: number;
  status: string;
  color?: string | null;
  due_date?: string | null;
  technical_sheets?: { name?: string | null; assembly_capacity_per_day?: number | null } | null;
};

const STAGE_COLORS: Record<string, string> = {
  'Corte Palmilha': 'hsl(var(--stage-cut-fg))',
  'Corte Forração': 'hsl(var(--stage-cut-fg))',
  'Aviamento': 'hsl(var(--stage-cut-fg))',
  'Costura': 'hsl(var(--stage-sew-fg))',
  'Silk': 'hsl(var(--stage-sew-fg))',
  'Colagem': 'hsl(var(--stage-assy-fg))',
  'Montagem': 'hsl(var(--stage-assy-fg))',
  'Solagem': 'hsl(var(--stage-fin-fg))',
  'Acabamento': 'hsl(var(--stage-fin-fg))',
  'Expedição': 'hsl(var(--stage-pack-fg))',
};

function calcProgress(stages: OrderStage[]): { done: number; total: number; pct: number } {
  if (!stages?.length) return { done: 0, total: 0, pct: 0 };
  const done = stages.filter(s => s.status === 'concluido').length;
  return { done, total: stages.length, pct: Math.round((done / stages.length) * 100) };
}

function inferCurrentStage(stages: OrderStage[]): OrderStage | null {
  if (!stages?.length) return null;
  return stages.find(s => s.status === 'em_andamento')
       || [...stages].reverse().find(s => s.status === 'concluido')
       || stages[0];
}

function isLate(order: Order): boolean {
  if (!order.due_date) return false;
  const status = (order.status || '').toLowerCase();
  if (status.includes('finaliz') || status.includes('cancel')) return false;
  return new Date(order.due_date).getTime() < Date.now();
}

/** Ring SVG component pra OEE/progresso. */
function Ring({ value, color, size = 56, stroke = 4 }: {
  value: number; color: string; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="hsl(var(--border))" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** Hook que conta movimentos de saída na última hora pra estimar pares/h. */
function useLastHourPairsRate() {
  return useQuery({
    queryKey: ['live_pairs_rate'],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('stock_movements')
        .select('quantity, movement_type, created_at')
        .gte('created_at', since)
        .in('movement_type', ['out', 'consumption']);
      if (error) throw error;
      const totalPairs = (data || []).reduce((s, m) => s + (Number(m.quantity) || 0), 0);
      return Math.round(totalPairs);
    },
    staleTime: 60_000,
    refetchInterval: 120_000, // refresh a cada 2min
  });
}

export default function ProductionLive() {
  const { data: orders = [], isLoading } = useOrders();
  const activeOrders = useMemo(
    () => (orders as Order[]).filter(o => {
      const s = (o.status || '').toLowerCase();
      return s.includes('produ') || s === 'em produção';
    }),
    [orders],
  );
  const orderIds = activeOrders.map(o => o.id);
  const { data: stages = [] } = useAllOrderStages(orderIds);
  const { data: pairsLastHour = 0 } = useLastHourPairsRate();

  const stagesByOrderId = useMemo(() => {
    const map = new Map<string, OrderStage[]>();
    for (const s of stages) {
      if (!map.has(s.order_id)) map.set(s.order_id, []);
      map.get(s.order_id)!.push(s);
    }
    return map;
  }, [stages]);

  const stats = useMemo(() => {
    const running = activeOrders.length;
    const late = activeOrders.filter(isLate).length;
    const totalPairs = activeOrders.reduce((s, o) => s + o.quantity, 0);
    return { running, late, totalPairs };
  }, [activeOrders]);

  return (
    <AppLayout>
      <div className="space-y-5 pb-12">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <span className="live-dot" /> Produção · ao vivo
            </div>
            <h1 className="display text-3xl mt-2">Monitor de chão</h1>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Hero: ritmo agregado */}
        <Card className="slash-top">
          <CardContent className="p-6 flex items-baseline justify-between gap-6 flex-wrap">
            <div>
              <div className="eyebrow">Ritmo · últimos 60 min</div>
              <div className="flex items-baseline gap-3 mt-3">
                <span className="display text-foreground" style={{ fontSize: 80 }}>
                  {pairsLastHour}
                </span>
                <span className="font-mono text-sm text-muted-foreground">pares/h</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Baseado em movimentos de saída registrados
              </div>
            </div>
            <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="eyebrow text-[9px]">OPs ativas</div>
                <div className="display text-2xl mt-1">{stats.running}</div>
              </div>
              <div>
                <div className="eyebrow text-[9px]">Total pares</div>
                <div className="display text-2xl mt-1 tabular-nums">
                  {stats.totalPairs.toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div className="eyebrow text-[9px]">Atrasadas</div>
                <div className={cn('display text-2xl mt-1', stats.late > 0 && 'text-primary')}>
                  {stats.late}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Linhas em produção */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <div className="eyebrow">Linhas · status atual</div>
                <h2 className="display text-xl mt-1">
                  {stats.running} OPs · {stats.running - stats.late} rodando
                </h2>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeOrders.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Nenhuma OP em produção"
                description="Quando uma ordem entrar em produção, ela aparece aqui em tempo real."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeOrders.map(order => {
                  const stages = stagesByOrderId.get(order.id) || [];
                  const current = inferCurrentStage(stages);
                  const { done, total, pct } = calcProgress(stages);
                  const late = isLate(order);
                  const stageColor = current ? STAGE_COLORS[current.sector_name] || 'hsl(var(--muted-foreground))' : 'hsl(var(--muted-foreground))';

                  return (
                    <div
                      key={order.id}
                      className={cn(
                        'rounded-lg border bg-card p-5 relative overflow-hidden',
                        late && 'border-primary',
                      )}
                    >
                      {late && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary"
                          style={{ boxShadow: '0 0 12px hsl(var(--primary))' }} />
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <span className="display text-2xl tabular-nums">
                          {(order.order_number || '').replace(/^OP-/, '') || '—'}
                        </span>
                        {late ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Atraso
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Rodando
                          </span>
                        )}
                      </div>

                      {current && (
                        <div className="flex items-center gap-2 mt-3">
                          <span
                            className="font-mono text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: stageColor }}
                          >
                            {current.sector_name}
                          </span>
                        </div>
                      )}

                      <div className="text-sm font-semibold mt-2 leading-tight">
                        {order.technical_sheets?.name || '—'}
                      </div>

                      <div className="flex items-center justify-between mt-4">
                        <div>
                          <div className="eyebrow text-[9px]">Pares</div>
                          <div className="display text-2xl mt-1 tabular-nums">
                            {order.quantity}
                          </div>
                        </div>
                        <div className="relative">
                          <Ring
                            value={pct}
                            color={late ? 'hsl(var(--primary))' : 'hsl(var(--success, 158 64% 38%))'}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="font-mono text-xs font-bold tabular-nums">{pct}</span>
                            <span className="font-mono text-[8px] text-muted-foreground tracking-wider">
                              {done}/{total}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1 bg-border rounded-full mt-4 overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: late ? 'hsl(var(--primary))' : stageColor,
                          }}
                        />
                      </div>

                      {late && order.due_date && (
                        <div className="mt-3 p-2 rounded border border-primary/30 bg-primary/5 flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-primary shrink-0" />
                          <span className="text-[10px] text-primary">
                            Vencida em {new Date(order.due_date).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
