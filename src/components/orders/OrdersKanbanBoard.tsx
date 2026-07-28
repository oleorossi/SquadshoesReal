/**
 * OrdersKanbanBoard — visão kanban editorial (Novidade redesign)
 *
 * Mostra OPs distribuídas em 5 mega-grupos por estágio canônico:
 *   Preparação → Costura → Montagem → Finalização → Expedição
 *
 * Cada coluna tem header com count, e cards de OP compactos com:
 *   - número OP + linha (line) + flag "hot"/"late"
 *   - referência + cor (com swatch)
 *   - bignum de pares (Anton display)
 *   - progress bar com cor do estágio (vermelho se atrasada)
 *   - deadline + status
 *
 * Inspirado em screen-production-flow.jsx do pacote Novidade.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Funnel as Filter, Plus, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OrderStage } from '@/hooks/useOrderStages';
import { MaterialReservationErrorBadge } from '@/components/orders/MaterialReservationErrorBadge';

type Order = {
  id: string;
  order_number?: string | null;
  quantity: number;
  color?: string | null;
  status: string;
  due_date?: string | null;
  planned_delivery?: string | null;
  reference_id?: string | null;
  technical_sheets?: { name?: string | null } | null;
  sale_order_id?: string | null;
  material_status?: string | null;
  notes?: string | null;
};

interface Props {
  orders: Order[];
  stagesByOrderId: Map<string, OrderStage[]>;
  saleOrderById: Map<string, { order_number?: string; client_name?: string }>;
  onSelectOrder: (order: Order) => void;
}

const STAGE_GROUPS = [
  {
    key: 'preparacao' as const,
    label: 'PREPARAÇÃO',
    short: 'Corte / Aviamento',
    sectors: ['Corte Palmilha', 'Corte Forração', 'Aviamento'],
    colorVar: '--stage-cut-fg',
  },
  {
    key: 'costura' as const,
    label: 'COSTURA',
    short: 'Costura / Silk',
    sectors: ['Costura', 'Silk'],
    colorVar: '--stage-sew-fg',
  },
  {
    key: 'montagem' as const,
    label: 'MONTAGEM',
    short: 'Colagem / Montagem',
    sectors: ['Colagem', 'Montagem'],
    colorVar: '--stage-assy-fg',
  },
  {
    key: 'finalizacao' as const,
    label: 'FINALIZAÇÃO',
    short: 'Solagem / Acabamento',
    sectors: ['Solagem', 'Acabamento'],
    colorVar: '--stage-fin-fg',
  },
  {
    key: 'expedicao' as const,
    label: 'EXPEDIÇÃO',
    short: 'Pronto p/ envio',
    sectors: ['Expedição'],
    colorVar: '--stage-pack-fg',
  },
];

const SECTOR_TO_GROUP: Record<string, typeof STAGE_GROUPS[number]['key']> = {};
for (const g of STAGE_GROUPS) {
  for (const s of g.sectors) SECTOR_TO_GROUP[s] = g.key;
}

const COLOR_HEX_MAP: Record<string, string> = {
  preto: '#1a1a1a', black: '#1a1a1a', branco: '#ffffff', white: '#ffffff',
  'off white': '#f5f0e8', bege: '#d8c8a4', caramelo: '#b8773a',
  whisky: '#a05d2c', 'new whisky': '#a05d2c', tan: '#c69a6e',
  'new tan': '#c69a6e', cogumelo: '#9b8068', champagne: '#e8d5b0',
  champanhe: '#e8d5b0', rosado: '#e8b8b0', rosa: '#e8b8b0',
  'rosa claro': '#fadbe2', azul: '#3b6ea8', 'baby blue': '#a8c8e0',
  verde: '#3a7d4a', amarelo: '#e8c828', limoncello: '#f5e555',
  cinza: '#888888', grafite: '#4a4a4a', marrom: '#6b3a1f',
  malbec: '#5e1a26', carmim: '#9c1a30', cafe: '#3d2418',
  'café': '#3d2418', porcelana: '#f0e6dc', grape: '#5e3a6e',
  adocicado: '#c8a88f', prata: '#c0c0c0', ouro: '#e0b850',
  dourado: '#e0b850',
};

function colorHex(name?: string | null) {
  if (!name) return '#9aa3ae';
  const norm = name.toLowerCase().trim();
  return COLOR_HEX_MAP[norm] || '#9aa3ae';
}

/**
 * Determina qual mega-grupo de estágio a OP está no momento.
 * Lógica: primeiro 'em_andamento', senão último 'concluido', senão primeiro 'pendente'.
 */
function inferGroupKey(stages: OrderStage[] = []): typeof STAGE_GROUPS[number]['key'] {
  if (!stages.length) return 'preparacao';
  const inProgress = stages.find(s => s.status === 'em_andamento');
  if (inProgress) return SECTOR_TO_GROUP[inProgress.stage_name] || 'preparacao';
  // Senão: último concluido + 1 (se existir próximo) → senão último concluido
  const lastDone = [...stages].reverse().find(s => s.status === 'concluido');
  if (lastDone) {
    const idx = stages.findIndex(s => s.id === lastDone.id);
    const next = stages[idx + 1];
    if (next) return SECTOR_TO_GROUP[next.stage_name] || 'preparacao';
    return SECTOR_TO_GROUP[lastDone.stage_name] || 'expedicao';
  }
  return SECTOR_TO_GROUP[stages[0].stage_name] || 'preparacao';
}

function calcProgress(stages: OrderStage[] = []): number {
  if (!stages.length) return 0;
  const done = stages.filter(s => s.status === 'concluido').length;
  return Math.round((done / stages.length) * 100);
}

function isLate(order: Order): boolean {
  const due = order.due_date || order.planned_delivery;
  if (!due) return false;
  const status = (order.status || '').toLowerCase();
  if (status.includes('finaliz') || status.includes('cancel')) return false;
  const dueDate = new Date(due);
  return dueDate.getTime() < Date.now();
}

function formatDeadline(order: Order): string {
  const due = order.due_date || order.planned_delivery;
  if (!due) return 'sem prazo';
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dDate.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function OrdersKanbanBoard({
  orders, stagesByOrderId, saleOrderById, onSelectOrder,
}: Props) {
  const navigate = useNavigate();

  // Distribui OPs nas 5 colunas
  const ordersByGroup = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const g of STAGE_GROUPS) map.set(g.key, []);
    for (const o of orders) {
      const stages = stagesByOrderId.get(o.id) || [];
      const key = inferGroupKey(stages);
      map.get(key)!.push(o);
    }
    return map;
  }, [orders, stagesByOrderId]);

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3">
        {STAGE_GROUPS.map(g => {
          const colOrders = ordersByGroup.get(g.key) || [];
          const totalPairs = colOrders.reduce((s, o) => s + o.quantity, 0);
          return (
            <div key={g.key} className="rounded-lg border bg-card p-4 slash-top">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="eyebrow">{g.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{g.short}</div>
                </div>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {String(STAGE_GROUPS.indexOf(g) + 1).padStart(2, '0')}/05
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-3">
                <span
                  className="display tabular-nums"
                  style={{ fontSize: 32, color: `hsl(var(${g.colorVar}))` }}
                >
                  {colOrders.length}
                </span>
                <span className="font-mono text-xs text-muted-foreground">OPs</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground mt-0.5 tabular-nums">
                {totalPairs.toLocaleString('pt-BR')} pares
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Quadro de fluxo</div>
          <h2 className="display text-2xl mt-1">Onde está cada ordem</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Filtrar
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => navigate('/orders/new')}>
            <Plus className="h-3.5 w-3.5" /> Nova OP
          </Button>
        </div>
      </div>

      {/* 5-column kanban */}
      <div className="grid grid-cols-5 gap-3 min-h-[480px]">
        {STAGE_GROUPS.map(g => {
          const colOrders = ordersByGroup.get(g.key) || [];
          return (
            <div
              key={g.key}
              className="rounded-lg bg-muted/30 p-3 flex flex-col"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 pb-3 border-b border-border/50 mb-3">
                <div
                  className="h-7 w-7 rounded border bg-card flex items-center justify-center font-mono text-xs font-bold tabular-nums"
                  style={{ color: `hsl(var(${g.colorVar}))` }}
                >
                  {String(STAGE_GROUPS.indexOf(g) + 1).padStart(2, '0')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="display text-sm tracking-wider truncate">{g.label}</div>
                  <div className="font-mono text-xs text-muted-foreground truncate">{g.short}</div>
                </div>
                <span className="font-mono text-xs font-bold text-muted-foreground">
                  {colOrders.length}
                </span>
              </div>

              {/* OP cards */}
              <div className="flex-1 space-y-2 overflow-y-auto">
                {colOrders.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground/60 py-8 italic">
                    Nenhuma OP
                  </div>
                ) : (
                  colOrders.map(order => {
                    const stages = stagesByOrderId.get(order.id) || [];
                    const progress = calcProgress(stages);
                    const late = isLate(order);
                    const so = order.sale_order_id ? saleOrderById.get(order.sale_order_id) : null;
                    return (
                      <button
                        key={order.id}
                        onClick={() => onSelectOrder(order)}
                        className={cn(
                          'w-full text-left rounded border bg-card p-3 relative overflow-hidden',
                          'hover:bg-muted/40 transition-colors group',
                          late && 'border-primary',
                        )}
                      >
                        {/* Late corner ribbon */}
                        {late && (
                          <div
                            className="absolute top-0 right-0 pointer-events-none"
                            style={{
                              width: 0, height: 0,
                              borderLeft: '14px solid transparent',
                              borderTop: '14px solid hsl(var(--primary))',
                            }}
                            aria-label="Atrasada"
                          />
                        )}

                        {/* Header: OP number + sale order */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-muted-foreground tabular-nums">
                            {order.order_number || '—'}
                          </span>
                          {so && (
                            <span
                              className="font-mono text-muted-foreground/70 px-1 py-0.5 border rounded text-xs"
                              title={so.client_name}
                            >
                              {so.order_number?.replace(/^PV-/, '') || '—'}
                            </span>
                          )}
                        </div>

                        {order.material_status === 'erro_reserva' && (
                          <div className="mt-1.5">
                            <MaterialReservationErrorBadge
                              materialStatus={order.material_status}
                              notes={order.notes}
                            />
                          </div>
                        )}

                        {/* Reference name */}
                        <div className="text-xs font-semibold mt-2 leading-tight truncate text-foreground">
                          {order.technical_sheets?.name || '—'}
                        </div>

                        {/* Big number of pairs */}
                        <div className="flex items-baseline gap-1 mt-1.5">
                          <span className="display text-2xl text-foreground tabular-nums">
                            {order.quantity}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">pares</span>
                        </div>

                        {/* Color swatch + name */}
                        {order.color && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-border"
                              style={{ backgroundColor: colorHex(order.color) }}
                              aria-hidden
                            />
                            <span className="text-xs text-muted-foreground truncate">
                              {order.color}
                            </span>
                          </div>
                        )}

                        {/* Progress bar */}
                        <div className="h-[3px] bg-border rounded-full mt-2.5 overflow-hidden">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: late
                                ? 'hsl(var(--primary))'
                                : `hsl(var(${g.colorVar}))`,
                            }}
                          />
                        </div>

                        {/* Footer: % + deadline */}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {progress}%
                          </span>
                          <span
                            className={cn(
                              'font-mono text-xs flex items-center gap-1',
                              late ? 'text-primary font-bold' : 'text-muted-foreground',
                            )}
                          >
                            {late && <AlertTriangle className="h-2.5 w-2.5" />}
                            {late ? 'ATRASADA' : formatDeadline(order)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
