/**
 * ProductionTimeline — Gantt horizontal das OPs ativas
 *
 * Adaptado de screen-production-timeline.jsx (pacote Novidade).
 * Cada OP é uma linha. Colunas representam os 5 mega-grupos de estágio:
 *   PREPARAÇÃO → COSTURA → MONTAGEM → FINALIZAÇÃO → EXPEDIÇÃO
 *
 * Cada cell mostra barra de progresso preenchida conforme status:
 *   - concluído: cinza
 *   - em andamento: cor do estágio (vermelho se atrasada) + dot indicador
 *   - pendente: vazio
 *
 * Header tem 3 botões: Hoje · Semana · Mês (escopo de filtro de OPs)
 */
import { useMemo, useState } from 'react';
import { CircleNotch as Loader2, ClipboardText as ClipboardList } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, OrderStage } from '@/hooks/useOrderStages';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

type Order = {
  id: string;
  order_number?: string | null;
  quantity: number;
  status: string;
  due_date?: string | null;
  created_at?: string | null;
  technical_sheets?: { name?: string | null } | null;
};

const STAGE_GROUPS = [
  { key: 'preparacao' as const, label: 'PREPARAÇÃO', sectors: ['Corte Palmilha', 'Corte Forração', 'Aviamento'], colorVar: '--stage-cut-fg' },
  { key: 'costura' as const,    label: 'COSTURA',    sectors: ['Costura', 'Silk'],                                colorVar: '--stage-sew-fg' },
  { key: 'montagem' as const,   label: 'MONTAGEM',   sectors: ['Colagem', 'Montagem'],                            colorVar: '--stage-assy-fg' },
  { key: 'finalizacao' as const,label: 'FINALIZAÇÃO',sectors: ['Solagem', 'Acabamento'],                          colorVar: '--stage-fin-fg' },
  { key: 'expedicao' as const,  label: 'EXPEDIÇÃO',  sectors: ['Expedição'],                                       colorVar: '--stage-pack-fg' },
];

type Scope = 'hoje' | 'semana' | 'mes';

function calcGroupStatus(stages: OrderStage[], group: typeof STAGE_GROUPS[number]) {
  const groupStages = stages.filter(s => group.sectors.includes(s.sector_name));
  if (!groupStages.length) return { state: 'none', pct: 0 };
  const done = groupStages.filter(s => s.status === 'concluido').length;
  const inProg = groupStages.find(s => s.status === 'em_andamento');
  if (done === groupStages.length) return { state: 'done', pct: 100 };
  if (inProg) {
    // Estima pct do grupo: (done + 0.5) / total (em andamento conta meio)
    const partial = ((done + 0.5) / groupStages.length) * 100;
    return { state: 'active', pct: Math.round(partial) };
  }
  if (done > 0) return { state: 'partial', pct: Math.round((done / groupStages.length) * 100) };
  return { state: 'pending', pct: 0 };
}

function isLate(order: Order): boolean {
  if (!order.due_date) return false;
  const status = (order.status || '').toLowerCase();
  if (status.includes('finaliz') || status.includes('cancel')) return false;
  return new Date(order.due_date).getTime() < Date.now();
}

function formatDeadline(order: Order): string {
  if (!order.due_date) return '—';
  const d = new Date(order.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dDate.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function ProductionTimeline() {
  const [scope, setScope] = useState<Scope>('semana');
  const { data: orders = [], isLoading } = useOrders();

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff = (() => {
      if (scope === 'hoje') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      if (scope === 'semana') {
        const d = new Date(now); d.setDate(d.getDate() + 7); return d;
      }
      return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    })();
    return (orders as Order[]).filter(o => {
      const status = (o.status || '').toLowerCase();
      if (!status.includes('produ')) return false;  // só Em Produção
      // Semana/Hoje: inclui OPs sem due_date (passa do filtro de prazo) —
      // operador precisa ver TODAS as OPs em produção mesmo que prazo seja
      // futuro distante ou esteja em branco. Mês continua mostrando tudo.
      if (!o.due_date) return true;
      // Se due_date está dentro do cutoff (hoje/semana/mês) OU já passou
      // (atrasada), aparece. Atrasadas precisam visibilidade independente
      // de qual escopo o usuário escolheu.
      return new Date(o.due_date) <= cutoff || new Date(o.due_date) < now;
    });
  }, [orders, scope]);

  const orderIds = filtered.map(o => o.id);
  const { data: stages = [] } = useAllOrderStages(orderIds);

  const stagesByOrderId = useMemo(() => {
    const map = new Map<string, OrderStage[]>();
    for (const s of stages) {
      if (!map.has(s.order_id)) map.set(s.order_id, []);
      map.get(s.order_id)!.push(s);
    }
    return map;
  }, [stages]);

  const totalPairs = filtered.reduce((s, o) => s + o.quantity, 0);

  return (
    <AppLayout>
      <div className="space-y-5 pb-12">
        <EditorialPageHeader
          sectionLabel="PCP · Timeline"
          title="Onde está cada ordem"
        />

        <Card>
          <CardContent className="p-6">
            {/* Toolbar */}
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <div>
                <div className="eyebrow">Visão de chão</div>
                <div className="display text-xl mt-1">
                  {filtered.length} ordens · {totalPairs.toLocaleString('pt-BR')} pares
                </div>
              </div>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                {(['hoje', 'semana', 'mes'] as const).map(s => (
                  <Button
                    key={s}
                    variant={scope === s ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setScope(s)}
                    className="h-8 px-3 text-xs capitalize"
                  >
                    {s === 'mes' ? 'Mês' : s}
                  </Button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Nenhuma OP no período"
                description="Tente ampliar o escopo (Hoje → Semana → Mês) ou aprovar pedidos pendentes."
                size="sm"
              />
            ) : (
              <>
                {/* Header row */}
                <div
                  className="grid gap-2 mb-3 pb-3 border-b text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
                  style={{ gridTemplateColumns: '210px repeat(5, 1fr) 100px' }}
                >
                  <div>Ordem · Modelo</div>
                  {STAGE_GROUPS.map(g => (
                    <div key={g.key} style={{ color: `hsl(var(${g.colorVar}))` }}>
                      {g.label}
                    </div>
                  ))}
                  <div className="text-right">Prazo</div>
                </div>

                {/* OP rows */}
                {filtered.map(order => {
                  const oStages = stagesByOrderId.get(order.id) || [];
                  const late = isLate(order);

                  return (
                    <div
                      key={order.id}
                      className="grid gap-2 items-center py-3 border-b border-border/50 last:border-0"
                      style={{ gridTemplateColumns: '210px repeat(5, 1fr) 100px' }}
                    >
                      {/* OP label */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {order.order_number || '—'}
                          </span>
                          {late && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                        </div>
                        <div className="text-xs font-semibold mt-0.5 truncate text-foreground">
                          {order.technical_sheets?.name || '—'}
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground mt-0.5 tabular-nums">
                          {order.quantity} pares
                        </div>
                      </div>

                      {/* Stage cells */}
                      {STAGE_GROUPS.map(g => {
                        const { state, pct } = calcGroupStatus(oStages, g);
                        const groupColor = `hsl(var(${g.colorVar}))`;
                        const fillColor = state === 'done' ? 'hsl(var(--muted-foreground))'
                          : state === 'active' ? (late ? 'hsl(var(--primary))' : groupColor)
                          : state === 'partial' ? groupColor + ' / 0.5'
                          : 'transparent';
                        return (
                          <div key={g.key} className="relative h-8 flex items-center">
                            <div className="h-1.5 w-full bg-muted/50 rounded-full overflow-hidden border">
                              <div
                                className="h-full transition-all"
                                style={{ width: `${pct}%`, backgroundColor: fillColor }}
                              />
                            </div>
                            {state === 'active' && (
                              <>
                                <div
                                  className="absolute top-2 h-3 w-3 rounded-full border-2"
                                  style={{
                                    left: `calc(${pct}% - 6px)`,
                                    backgroundColor: late ? 'hsl(var(--primary))' : groupColor,
                                    borderColor: 'hsl(var(--background))',
                                    boxShadow: late
                                      ? '0 0 0 3px hsl(var(--primary) / 0.25)'
                                      : '0 0 0 3px hsl(var(--background) / 0.6)',
                                  }}
                                />
                                <span
                                  className="absolute top-5 left-0 font-mono text-[8.5px] tabular-nums"
                                  style={{ color: late ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
                                >
                                  {pct}%
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {/* Due */}
                      <div className="text-right">
                        <span
                          className={cn(
                            'font-mono text-[10px] font-bold',
                            late ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {late ? 'ATRASADA' : formatDeadline(order)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Legend */}
                <div className="flex items-center gap-6 mt-5 pt-4 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-3 bg-muted-foreground rounded" />
                    <span>Concluído</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span>Em produção</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                    <span>Atrasada</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
