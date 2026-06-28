/**
 * ProductionTimeline — Gantt horizontal das OPs ativas
 *
 * Adaptado de screen-production-timeline.jsx (pacote Novidade).
 * Cada OP é uma linha. Colunas representam as 5 macro-etapas da produção,
 * definidas em src/lib/productionSectors.ts (mesma taxonomia usada por
 * /producao/fluxo, /capacity-planning e /producao/visao-agregada):
 *   Corte → Costura → Montagem → Acabamento → Expedição
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
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, OrderStage } from '@/hooks/useOrderStages';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { MACRO_SECTORS, MICRO_SECTORS, MICRO_TO_MACRO, normalizeSectorId, type MacroSectorId } from '@/lib/productionSectors';

type Order = {
  id: string;
  order_number?: string | null;
  quantity: number;
  status: string;
  due_date?: string | null;
  created_at?: string | null;
  technical_sheets?: { name?: string | null } | null;
};

// Cores por macro-setor — corresponde 1:1 aos tokens do design system.
const MACRO_COLORS: Record<MacroSectorId, string> = {
  corte:      '--stage-cut-fg',
  costura:    '--stage-sew-fg',
  montagem:   '--stage-assy-fg',
  acabamento: '--stage-fin-fg',
  expedicao:  '--stage-pack-fg',
};

// Derivado de productionSectors: cada macro lista as labels dos micro-setores
// que ele agrega. Usado pra contar OrderStage por grupo.
const STAGE_GROUPS = MACRO_SECTORS.map((m) => ({
  key: m.id,
  label: m.label.toUpperCase(),
  sectors: MICRO_SECTORS.filter((mi) => MICRO_TO_MACRO[mi.id] === m.id).map((mi) => mi.label),
  colorVar: MACRO_COLORS[m.id],
}));

type Scope = 'hoje' | 'semana' | 'mes';

function calcGroupStatus(stages: OrderStage[], group: typeof STAGE_GROUPS[number]) {
  // sector_name vem do banco com a string canônica em pt-BR; comparamos
  // diretamente, com fallback de normalização para tolerar capitalização
  // variada ou aliases legados.
  const groupStages = stages.filter(s => {
    if (group.sectors.includes(s.stage_name)) return true;
    const normalized = normalizeSectorId(s.stage_name);
    if (!normalized) return false;
    return group.sectors.some(
      (lbl) => normalizeSectorId(lbl) === normalized,
    );
  });
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
          sectionLabel="PCP · TIMELINE OP"
          title="Onde está cada ordem"
        />

        <Panel
          eyebrow="Visão de chão"
          title={`${filtered.length} ordens · ${totalPairs.toLocaleString('pt-BR')} pares`}
          actions={
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
          }
        >
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
                  className="grid gap-2 mb-3 pb-3 border-b text-xs font-bold uppercase tracking-widest text-muted-foreground"
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
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {order.order_number || '—'}
                          </span>
                          {late && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                        </div>
                        <div className="text-xs font-semibold mt-0.5 truncate text-foreground">
                          {order.technical_sheets?.name || '—'}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {order.quantity} pares
                        </div>
                      </div>

                      {/* Stage cells */}
                      {STAGE_GROUPS.map(g => {
                        const { state, pct } = calcGroupStatus(oStages, g);
                        const groupColor = `hsl(var(${g.colorVar}))`;
                        const fillColor = state === 'done' ? 'hsl(var(--muted-foreground))'
                          : state === 'active' ? (late ? 'hsl(var(--primary))' : groupColor)
                          : state === 'partial' ? `hsl(var(${g.colorVar}) / 0.5)`
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
                            'font-mono text-xs font-bold',
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
                <div className="flex items-center gap-6 mt-5 pt-4 text-xs text-muted-foreground">
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
        </Panel>
      </div>
    </AppLayout>
  );
}
