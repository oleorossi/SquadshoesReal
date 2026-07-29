import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CaretLeft as ChevronLeft, CaretRight as ChevronRight,
  PushPin as Pin, PushPinSlash as PinOff, Info,
  CalendarBlank as CalendarIcon, ListChecks, Warning as AlertTriangle,
  DotsSixVertical as GripVertical,
} from '@phosphor-icons/react';
import {
  useProductionScheduleGrid, useProductionQueueDetail, useScheduleOps,
  usePinOrder, usePinOrderAt, useEnsureFreshSchedule, useLastEngineRun,
  ScheduleGridCell, QueueDetailRow,
} from '@/hooks/useProductionEngine';
import { useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useCan } from '@/hooks/useAccessControl';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const fmtDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtWeekday = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

function mondayOf(d: Date): Date {
  const r = new Date(d);
  const dow = (r.getDay() + 6) % 7; // 0 = segunda
  r.setDate(r.getDate() - dow);
  r.setHours(0, 0, 0, 0);
  return r;
}
// Formata no fuso LOCAL. Hoje todas as datas daqui nascem de `mondayOf` (meia-noite
// local), onde o slice do toISOString ainda acertava — mas passar um `new Date()`
// qualquer devolvia o dia seguinte depois das ~21h BRT. `format` fecha a armadilha
// sem mudar o resultado atual. Ver `@/lib/date`.
const toISO = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Tela PLANEJAMENTO (R3) — leitura única do motor dinâmico:
 *  • Grade setor × dia: pares planejados vs capacidade, com carryover destacado
 *    e popover "como cheguei nisso" (R2.8).
 *  • Fila: ordem real de produção (pin > prazo > criação) com drag = pin (R2.5).
 */
export default function ProducaoPlanejamento() {
  useEnsureFreshSchedule();
  // Apontamento em outro terminal → realtime invalida as views do motor
  useRealtimeOrderStages();
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const from = toISO(weekStart);
  const to = toISO(new Date(weekStart.getTime() + 13 * 86400000)); // 2 semanas

  const { data: grid = [], isLoading: gridLoading } = useProductionScheduleGrid(from, to);
  const { data: queue = [], isLoading: queueLoading } = useProductionQueueDetail();
  const { data: lastRun } = useLastEngineRun();
  const pin = usePinOrder();
  const pinAt = usePinOrderAt();
  const canEdit = useCan('/producao/planejamento').canEdit;

  const [search, setSearch] = useState('');
  const [drill, setDrill] = useState<{ sector: string; date: string } | null>(null);
  const [dragOrderId, setDragOrderId] = useState<string | null>(null);

  // Dias úteis das 2 semanas exibidas
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      const dow = d.getDay();
      if (dow >= 1 && dow <= 5) out.push(toISO(d));
    }
    return out;
  }, [weekStart]);

  const sectors = useMemo(() => {
    const map = new Map<string, { flow_order: number; capacity: number }>();
    grid.forEach(c => { if (!map.has(c.sector)) map.set(c.sector, { flow_order: c.flow_order, capacity: c.capacity_pairs }); });
    return [...map.entries()]
      .sort((a, b) => a[1].flow_order - b[1].flow_order)
      .map(([sector, v]) => ({ sector, ...v }));
  }, [grid]);

  const cellMap = useMemo(() => {
    const m = new Map<string, ScheduleGridCell>();
    grid.forEach(c => m.set(`${c.sector}|${c.date}`, c));
    return m;
  }, [grid]);

  const filteredQueue = useMemo(
    () => queue.filter(q => searchMatchesAllTerms(search,
      q.order_number, q.reference_name, q.color, q.client_name, q.sale_order_number)),
    [queue, search],
  );

  // Drag na fila = fixar a OP NA posição do alvo (pin manual, R2.5). O RPC
  // renumera o bloco de pins — gravar queue_position cru invertia a intenção.
  const handleQueueDrop = (target: QueueDetailRow) => {
    if (!dragOrderId || dragOrderId === target.order_id) return;
    setDragOrderId(null);
    pinAt.mutate({ orderId: dragOrderId, position: target.queue_position });
  };

  // Tom da célula por UTILIZAÇÃO do motor (fração de dia), não pares×capacidade
  // global — com override de ficha os dois divergem e davam vermelho falso.
  const cellTone = (c: ScheduleGridCell | undefined) => {
    if (!c) return 'text-muted-foreground/50';
    if (c.carryover_pairs > 0) return 'bg-red-500/10 text-red-600 dark:text-red-400';
    if (c.utilization >= 0.999) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    return 'bg-green-500/10 text-green-600 dark:text-green-400';
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · PLANEJAMENTO"
        title="Planejamento"
        description="Fila diária do motor dinâmico: saldo não produzido rola pro dia seguinte com prioridade; produção acima do plano puxa OPs futuras."
      />

      {lastRun && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Motor: run de {new Date(lastRun.ran_at).toLocaleString('pt-BR')} · {lastRun.queue_size} OPs na fila ·
          horizonte até {fmtDate(lastRun.horizon_end)} · {lastRun.duration_ms}ms
        </p>
      )}

      <Tabs defaultValue="grade">
        <TabsList>
          <TabsTrigger value="grade" className="gap-1.5"><CalendarIcon className="h-3.5 w-3.5" /> Grade setor × dia</TabsTrigger>
          <TabsTrigger value="fila" className="gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Fila ({queue.length})</TabsTrigger>
        </TabsList>

        {/* ── GRADE ─────────────────────────────────────────────────────────── */}
        <TabsContent value="grade" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(w => new Date(w.getTime() - 7 * 86400000))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">
              {fmtDay(from)} – {fmtDay(to)}
            </span>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(w => new Date(w.getTime() + 7 * 86400000))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setWeekStart(mondayOf(new Date()))}>
              Hoje
            </Button>
          </div>

          {gridLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : sectors.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="Nada planejado no período"
              description="Sem OPs abertas na fila do motor pra essas duas semanas."
            />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-2 font-semibold sticky left-0 bg-card min-w-[130px]">Setor</th>
                      {days.map(d => (
                        <th key={d} className="p-2 text-center font-medium text-muted-foreground min-w-[76px]">
                          <div className="uppercase text-[10px]">{fmtWeekday(d)}</div>
                          <div>{fmtDay(d)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map(s => (
                      <tr key={s.sector} className="border-b border-border/60 hover:bg-muted/20">
                        <td className="p-2 font-medium sticky left-0 bg-card">{s.sector}</td>
                        {days.map(d => {
                          const c = cellMap.get(`${s.sector}|${d}`);
                          return (
                            <td key={d} className="p-1 text-center">
                              {c ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      className={`w-full rounded-md px-1.5 py-1.5 font-mono transition-colors hover:ring-1 hover:ring-border ${cellTone(c)}`}
                                      onDoubleClick={() => setDrill({ sector: s.sector, date: d })}
                                    >
                                      {c.planned_pairs}/{c.effective_capacity_pairs}
                                      {c.carryover_pairs > 0 && (
                                        <div className="text-[10px] font-semibold">+{c.carryover_pairs} atraso</div>
                                      )}
                                    </button>
                                  </PopoverTrigger>
                                  {/* R2.8 — "como cheguei nisso" */}
                                  <PopoverContent className="w-72 text-xs space-y-1.5">
                                    <p className="font-semibold">{s.sector} — {fmtDate(d)}</p>
                                    <p>
                                      Planejado: <strong className="font-mono">{c.planned_pairs}</strong> pares —{' '}
                                      <strong className="font-mono">{Math.round(c.utilization * 100)}%</strong> do dia usado.
                                      Capacidade do mix do dia ≈ <strong className="font-mono">{c.effective_capacity_pairs}</strong> pares
                                      {c.effective_capacity_pairs !== c.capacity_pairs
                                        ? <> (global do setor: <strong className="font-mono">{c.capacity_pairs}</strong>)</>
                                        : ' (capacidade global do setor)'}
                                    </p>
                                    <p>{c.ops} OP{c.ops !== 1 ? 's' : ''} no dia{c.ops_ficha_override > 0 ? ` — ${c.ops_ficha_override} com capacidade da FICHA TÉCNICA (override)` : ' — todas na capacidade global'}</p>
                                    {c.carryover_pairs > 0 && (
                                      <p className="text-red-600 dark:text-red-400">
                                        {c.carryover_pairs} pares são SALDO ROLADO de dias anteriores (entraram na frente da fila — R2.3).
                                      </p>
                                    )}
                                    <p className="text-muted-foreground">
                                      Alocação: fila híbrida (pin manual &gt; prazo de faturamento &gt; criação), limitada pela
                                      entrega do setor anterior até ontem.
                                    </p>
                                    <Button size="sm" variant="outline" className="h-7 w-full mt-1" onClick={() => setDrill({ sector: s.sector, date: d })}>
                                      Ver OPs do dia
                                    </Button>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── FILA ──────────────────────────────────────────────────────────── */}
        <TabsContent value="fila" className="mt-4 space-y-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por OP, referência, cor, cliente, PV…"
            resultCount={filteredQueue.length}
            totalCount={queue.length}
          />
          {queueLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : filteredQueue.length === 0 ? (
            <EmptyState icon={ListChecks} title="Fila vazia" description="Nenhuma OP aberta no motor (ou o filtro não casou nada)." />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="p-2 w-8"></th>
                      <th className="text-left p-2">#</th>
                      <th className="text-left p-2">OP</th>
                      <th className="text-left p-2">Referência</th>
                      <th className="text-left p-2">Cliente</th>
                      <th className="text-right p-2">Pares</th>
                      <th className="text-right p-2">Restante</th>
                      <th className="text-left p-2">Prazo</th>
                      <th className="text-left p-2">Conclusão prevista</th>
                      <th className="text-left p-2">Sinais</th>
                      <th className="p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQueue.map(q => (
                      <tr
                        key={q.order_id}
                        className={`border-b border-border/60 hover:bg-muted/20 ${dragOrderId === q.order_id ? 'opacity-40' : ''}`}
                        draggable={canEdit}
                        onDragStart={e => { setDragOrderId(q.order_id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => setDragOrderId(null)}
                        onDragOver={e => { e.preventDefault(); }}
                        onDrop={e => { e.preventDefault(); handleQueueDrop(q); }}
                      >
                        <td className="p-2 text-muted-foreground">
                          {canEdit && <GripVertical className="h-3.5 w-3.5 cursor-grab" />}
                        </td>
                        <td className="p-2 font-mono">{q.queue_position}</td>
                        <td className="p-2 font-mono">
                          <Link to={`/orders/${q.order_id}/edit`} className="hover:underline text-primary">
                            {q.order_number}
                          </Link>
                        </td>
                        <td className="p-2">{q.reference_name || '—'}{q.color ? ` · ${q.color}` : ''}</td>
                        <td className="p-2 text-muted-foreground">{q.client_name || '—'}</td>
                        <td className="p-2 text-right font-mono">{q.quantity}</td>
                        <td className="p-2 text-right font-mono">{q.remaining_pairs}</td>
                        <td className="p-2">{fmtDate(q.due_date)}</td>
                        <td className="p-2">{fmtDate(q.projected_completion)}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {q.pinned_position !== null && (
                              <Badge variant="outline" className="text-[10px] gap-0.5"><Pin className="h-2.5 w-2.5" /> fixada</Badge>
                            )}
                            {q.has_ficha_override && (
                              <Badge variant="outline" className="text-[10px]" title="Capacidades/fluxo vêm da FICHA TÉCNICA desta referência (override — R1.3)">ficha</Badge>
                            )}
                            {q.late_days > 0 && (
                              <Badge className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30 gap-0.5" variant="outline">
                                <AlertTriangle className="h-2.5 w-2.5" /> +{q.late_days}d
                              </Badge>
                            )}
                            {q.carryover_total > 0 && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
                                {q.carryover_total} rolados
                              </Badge>
                            )}
                            {!q.due_date && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">sem prazo</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          {canEdit && q.pinned_position !== null && (
                            <Button
                              variant="ghost" size="sm" className="h-6 w-6 p-0"
                              title="Despinar (volta pra ordenação automática por prazo)"
                              onClick={() => pin.mutate({ orderId: q.order_id, position: null })}
                            >
                              <PinOff className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">
            Arraste uma linha pra FIXAR a OP naquela posição (pin manual — vence a ordenação
            automática por prazo até despinar). O restante da fila é ordenado pela semana de
            faturamento do PV.
          </p>
        </TabsContent>
      </Tabs>

      {/* Drill-down: OPs de um setor × dia */}
      <ScheduleDayDrill drill={drill} onClose={() => setDrill(null)} queue={queue} />
    </div>
  );
}

function ScheduleDayDrill({
  drill, onClose, queue,
}: {
  drill: { sector: string; date: string } | null;
  onClose: () => void;
  queue: QueueDetailRow[];
}) {
  const { data: ops = [], isLoading } = useScheduleOps(drill?.sector ?? null, drill?.date ?? null);
  const byId = useMemo(() => new Map(queue.map(q => [q.order_id, q])), [queue]);
  return (
    <Dialog open={!!drill} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{drill?.sector} — {drill ? fmtDate(drill.date) : ''}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {ops.map(o => {
              const q = byId.get(o.order_id);
              return (
                <div key={`${o.order_id}-${o.sector}`} className="flex items-center justify-between rounded-md border border-border/60 p-2 text-xs">
                  <div>
                    <Link to={`/orders/${o.order_id}/edit`} className="font-mono text-primary hover:underline">
                      {q?.order_number || o.order_id.slice(0, 8)}
                    </Link>
                    <span className="text-muted-foreground"> · {q?.reference_name || ''}{q?.color ? ` · ${q.color}` : ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.carryover_pairs > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30">
                        {o.carryover_pairs} atraso
                      </Badge>
                    )}
                    {o.capacity_source === 'ficha_override' && (
                      <Badge variant="outline" className="text-[10px]">ficha</Badge>
                    )}
                    <span className="font-mono font-semibold">{o.planned_pairs} pares</span>
                  </div>
                </div>
              );
            })}
            {ops.length === 0 && <p className="text-xs text-muted-foreground">Nada planejado.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
