import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CircleNotch as Loader2, Scissors, Hammer, Sparkle as Sparkles, ShoppingCart, Warehouse, CalendarCheck, MagnifyingGlass as Search, Warning as AlertTriangle, PencilLine as PenLine, FileText, Hand, Clock, FileArrowDown as FileDown, Stack as Layers, FlowArrow as Workflow, CheckCircle as CheckCircle2, Calendar } from '@phosphor-icons/react';
import { format, parseISO, isBefore, isToday, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

interface ScheduleRow {
  order_id: string;
  pedido_ref: string;
  sale_order_id: string;
  data_entrega_cliente: string;
  op_quantity: number;
  referencia_nome: string;
  order_status: string;
  data_inicio_acabamento: string;
  data_inicio_mesa: string;
  data_inicio_montagem: string;
  data_inicio_costura: string;
  data_inicio_corte: string;
  data_chegada_material: string;
  data_limite_compra: string;
  lead_time_acabamento_dias: number;
  lead_time_mesa_dias: number;
  lead_time_montagem_dias: number;
  lead_time_costura_dias: number;
  lead_time_corte_dias: number;
  lead_time_buffer_material_dias: number;
}

const BASE_COLS =
  'order_id, pedido_ref, sale_order_id, data_entrega_cliente, op_quantity, referencia_nome, order_status, ' +
  'data_inicio_acabamento, data_inicio_montagem, data_inicio_costura, data_inicio_corte, ' +
  'data_chegada_material, data_limite_compra, ' +
  'lead_time_acabamento_dias, lead_time_montagem_dias, lead_time_costura_dias, lead_time_corte_dias, lead_time_buffer_material_dias';

const MESA_COLS = ', data_inicio_mesa, lead_time_mesa_dias';

const EXCLUDED_STATUSES = new Set([
  'finalizado', 'faturado', 'cancelado', 'concluído', 'concluido', 'entregue',
]);

function filterAndDedup(raw: any[]): ScheduleRow[] {
  const seen = new Set<string>();
  const rows: ScheduleRow[] = [];
  for (const r of raw) {
    if (seen.has(r.order_id)) continue;
    if (r.order_status && EXCLUDED_STATUSES.has(r.order_status.toLowerCase())) continue;
    seen.add(r.order_id);
    rows.push(r);
  }
  return rows;
}

function useProductionSchedule() {
  return useQuery({
    queryKey: ['production_reverse_schedule'],
    queryFn: async () => {
      // Try with Mesa columns (requires migration 20260427240000_mesa-sector-planning.sql)
      const { data, error } = await supabase
        .from('purchase_projection_timeline' as any)
        .select(BASE_COLS + MESA_COLS)
        .order('data_entrega_cliente', { ascending: true });

      if (error) {
        // Migration not yet applied — fall back to pre-Mesa view schema
        if (
          error.message?.includes('data_inicio_mesa') ||
          error.message?.includes('lead_time_mesa_dias')
        ) {
          const { data: fallback, error: fallbackErr } = await supabase
            .from('purchase_projection_timeline' as any)
            .select(BASE_COLS)
            .order('data_entrega_cliente', { ascending: true });
          if (fallbackErr) throw fallbackErr;
          // Synthesise missing Mesa columns with zero-impact defaults
          const patched = (fallback || []).map((r: any) => ({
            ...r,
            lead_time_mesa_dias: 0,
            data_inicio_mesa: r.data_inicio_montagem ?? null,
          }));
          return filterAndDedup(patched);
        }
        throw error;
      }

      return filterAndDedup((data || []) as unknown as ScheduleRow[]);
    },
    staleTime: 5 * 60 * 1000,
  });
}

const fmt = (d: string | null | undefined) => {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM', { locale: ptBR }); } catch { return d; }
};
const fmtFull = (d: string | null | undefined) => {
  if (!d) return '—';
  try { return format(parseISO(d), "dd 'de' MMM", { locale: ptBR }); } catch { return d; }
};

function statusOf(dateStr: string | null | undefined) {
  if (!dateStr) return { tone: 'muted' as const, label: 'sem data' };
  try {
    const d = parseISO(dateStr);
    const today = new Date();
    if (isToday(d)) return { tone: 'today' as const, label: 'hoje' };
    if (isBefore(d, today)) return { tone: 'late' as const, label: 'atrasado' };
    const diff = differenceInCalendarDays(d, today);
    if (diff <= 3) return { tone: 'soon' as const, label: `em ${diff}d` };
    return { tone: 'ok' as const, label: `em ${diff}d` };
  } catch {
    return { tone: 'muted' as const, label: '' };
  }
}

const toneClasses: Record<string, string> = {
  late: 'bg-destructive/10 text-destructive border-destructive/30',
  today: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  soon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  muted: 'bg-muted text-muted-foreground border-border',
};

// Ordem canônica pós PR1-PR3. A view purchase_projection_timeline ainda usa as
// colunas legacy `data_inicio_mesa`, `data_inicio_corte` etc. (refactor da view
// é outro fix — ver AUDIT_FLUXO_COMPLETO #P4); aqui apenas reordenamos a
// renderização pra refletir o fluxo real (Aviamento ‖ Cortes → Costura → ...).
const stages = [
  { key: 'data_limite_compra',    label: 'Comprar',           icon: ShoppingCart, hint: 'Enviar pedido ao fornecedor' },
  { key: 'data_chegada_material', label: 'Material no pátio', icon: Warehouse,    hint: 'Material físico na fábrica' },
  { key: 'data_inicio_corte',     label: 'Iniciar Corte',     icon: Scissors,     hint: 'Liberar para corte (paralelo com Aviamento)' },
  { key: 'data_inicio_mesa',      label: 'Aviamento',         icon: Hand,         hint: 'Setor Aviamento (ex-Mesa) — separação e preparo das tiras artesanais' },
  { key: 'data_inicio_costura',   label: 'Iniciar Costura',   icon: PenLine,      hint: 'Após preparos paralelos — Costura' },
  { key: 'data_inicio_montagem',  label: 'Iniciar Montagem',  icon: Hammer,       hint: 'Liberar para montagem' },
  { key: 'data_inicio_acabamento',label: 'Iniciar Acabamento', icon: Sparkles,    hint: 'Acabamento e embalagem' },
  { key: 'data_entrega_cliente',  label: 'Entrega',           icon: CalendarCheck, hint: 'Entrega ao cliente' },
] as const;

function computeLateStages(row: ScheduleRow) {
  const today = new Date();
  const lateList: { key: string; label: string; date: string; daysLate: number }[] = [];
  for (const s of stages) {
    if (s.key === 'data_entrega_cliente') continue;
    const d = (row as any)[s.key] as string | null;
    if (!d) continue;
    try {
      const parsed = parseISO(d);
      if (isBefore(parsed, today) && !isToday(parsed)) {
        lateList.push({
          key: s.key,
          label: s.label,
          date: d,
          daysLate: differenceInCalendarDays(today, parsed),
        });
      }
    } catch {}
  }
  return lateList;
}

interface DelayDialogProps {
  open: boolean;
  onClose: () => void;
  scope: 'order' | 'op';
  focusRow: ScheduleRow | null;
  allRows: ScheduleRow[];
}

function DelayDetailDialog({ open, onClose, scope, focusRow, allRows }: DelayDialogProps) {
  // Fetch sale order summary
  const { data: saleOrder, isLoading: loadingSO } = useQuery({
    queryKey: ['delay-dialog-so', focusRow?.sale_order_id],
    queryFn: async () => {
      if (!focusRow?.sale_order_id) return null;
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, client_order_number, status, delivery_deadline, billing_week, delivery_week, delivery_month, total')
        .eq('id', focusRow.sale_order_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!focusRow?.sale_order_id,
  });

  // Determine which OPs to analyse
  const opsInScope = useMemo(() => {
    if (!focusRow) return [];
    if (scope === 'op') return [focusRow];
    return allRows.filter(r => r.sale_order_id === focusRow.sale_order_id);
  }, [scope, focusRow, allRows]);

  // Build flattened late item list
  const lateItems = useMemo(() => {
    const out: {
      order_id: string;
      pedido_ref: string;
      referencia_nome: string;
      op_quantity: number;
      stage_label: string;
      stage_date: string;
      days_late: number;
    }[] = [];
    for (const op of opsInScope) {
      const lateStages = computeLateStages(op);
      for (const ls of lateStages) {
        out.push({
          order_id: op.order_id,
          pedido_ref: op.pedido_ref,
          referencia_nome: op.referencia_nome,
          op_quantity: op.op_quantity,
          stage_label: ls.label,
          stage_date: ls.date,
          days_late: ls.daysLate,
        });
      }
    }
    return out.sort((a, b) => b.days_late - a.days_late);
  }, [opsInScope]);

  const totalPairs = opsInScope.reduce((sum, o) => sum + Number(o.op_quantity || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {scope === 'order' ? <FileText className="h-5 w-5 text-primary" /> : <Layers className="h-5 w-5 text-primary" />}
            {scope === 'order' ? 'Resumo do Pedido de Venda' : 'Detalhe da Ordem de Produção'}
          </DialogTitle>
          <DialogDescription>
            {scope === 'order'
              ? 'Visão completa do pedido de venda que originou esta OP, com todas as OPs vinculadas e itens em atraso.'
              : 'Visão focada apenas nesta OP e seus itens em atraso.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-4">
            {/* Sale Order Summary */}
            {loadingSO ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedido...
              </div>
            ) : saleOrder ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>PV #{saleOrder.order_number} — {saleOrder.client_name || '—'}</span>
                    <Badge variant="outline" className="text-xs">{saleOrder.status || '—'}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-0 text-xs">
                  <div>
                    <div className="text-muted-foreground">Pedido cliente</div>
                    <div className="font-semibold">{saleOrder.client_order_number || '—'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Entrega</div>
                    <div className="font-semibold">{fmtFull(saleOrder.delivery_deadline)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sem. faturamento</div>
                    <div className="font-semibold">{saleOrder.billing_week || saleOrder.delivery_week || '—'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total pares</div>
                    <div className="font-semibold">{totalPairs.toLocaleString('pt-BR')}</div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-3 text-xs text-muted-foreground">Pedido de venda não encontrado.</CardContent>
              </Card>
            )}

            {/* Scope summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-primary" />
                  {scope === 'order'
                    ? `OPs no pedido (${opsInScope.length})`
                    : `OP ${focusRow?.pedido_ref}`}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1.5">
                  {opsInScope.map(op => {
                    const lateCount = computeLateStages(op).length;
                    return (
                      <div
                        key={op.order_id}
                        className="flex items-center justify-between text-xs p-2 rounded-md border border-border bg-muted/20"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{op.pedido_ref}</span>
                          <span className="text-muted-foreground">{op.referencia_nome}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{op.op_quantity}p</Badge>
                          {lateCount > 0 ? (
                            <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-xs">
                              {lateCount} atraso{lateCount > 1 ? 's' : ''}
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">
                              em dia
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Late items */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Itens em Atraso ({lateItems.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Etapas cuja data planejada já passou. Priorize as com mais dias de atraso.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {lateItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    <CheckCircle2 className="h-6 w-6 mx-auto mb-1 text-emerald-500/70" />
                    Nenhum item em atraso. 🎉
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {lateItems.map((it, idx) => (
                      <div
                        key={`${it.order_id}-${it.stage_label}-${idx}`}
                        className="flex items-center justify-between gap-2 p-2 rounded-md border border-destructive/30 bg-destructive/5 text-xs"
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">{it.pedido_ref}</span>
                            <Separator orientation="vertical" className="h-3" />
                            <span className="font-semibold truncate">{it.stage_label}</span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {it.referencia_nome} · {it.op_quantity}p · planejado {fmtFull(it.stage_date)}
                          </div>
                        </div>
                        <Badge className="bg-destructive text-destructive-foreground text-xs gap-1 shrink-0">
                          <Clock className="h-2.5 w-2.5" />
                          {it.days_late}d
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

async function exportLateOrdersToExcel(rows: ScheduleRow[]) {
  const XLSX = await import('xlsx'); // lazy: 424KB só ao exportar
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '';
    try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return d; }
  };

  const lateRows = rows.filter(r => computeLateStages(r).length > 0);

  const data = lateRows.map(r => {
    const lateStages = computeLateStages(r);
    const maxDelay = lateStages.length > 0 ? Math.max(...lateStages.map(s => s.daysLate)) : 0;
    return {
      'OP': r.pedido_ref,
      'Referência': r.referencia_nome,
      'Pares': r.op_quantity,
      'Status': r.order_status,
      'Data Entrega': fmtDate(r.data_entrega_cliente),
      'Etapas em Atraso': lateStages.map(s => s.label).join(', '),
      'Dias Atraso (máx)': maxDelay,
      'Lim. Compra': fmtDate(r.data_limite_compra),
      'Chegada Material': fmtDate(r.data_chegada_material),
      'Início Corte': fmtDate(r.data_inicio_corte),
      'Início Costura': fmtDate(r.data_inicio_costura),
      'Início Montagem': fmtDate(r.data_inicio_montagem),
      'Início Mesa': r.lead_time_mesa_dias > 0 ? fmtDate(r.data_inicio_mesa) : '',
      'Início Acabamento': fmtDate(r.data_inicio_acabamento),
    };
  });

  // Sort by max delay descending so most critical come first
  data.sort((a, b) => (b['Dias Atraso (máx)'] as number) - (a['Dias Atraso (máx)'] as number));

  const ws = XLSX.utils.json_to_sheet(data);

  // Auto-width for columns
  const colWidths = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(key.length, ...data.map(r => String((r as any)[key] ?? '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OPs em Atraso');
  XLSX.writeFile(wb, `ops_em_atraso_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

/** Info do PV usada nos cabeçalhos quando agrupado por pedido. */
function useSaleOrdersInfo(saleOrderIds: string[]) {
  return useQuery({
    queryKey: ['schedule-pv-info', saleOrderIds.sort().join(',')],
    enabled: saleOrderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, status, delivery_deadline')
        .in('id', saleOrderIds);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}

export function ProductionScheduleTimeline() {
  const { data: rows = [], isLoading } = useProductionSchedule();
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState<'pedido' | 'op'>('pedido');
  const [collapsedPVs, setCollapsedPVs] = useState<Set<string>>(new Set());
  const [dialogState, setDialogState] = useState<{ open: boolean; scope: 'order' | 'op'; row: ScheduleRow | null }>({
    open: false, scope: 'order', row: null,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    // "/" = refinamento AND (ex.: "stx / alcineu")
    return rows.filter(r => searchMatchesAllTerms(search, r.pedido_ref, r.referencia_nome));
  }, [rows, search]);

  // Agrupa por sale_order_id mantendo a ordem de entrega.
  const groupedByPV = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of filtered) {
      const key = r.sale_order_id || `op-${r.order_id}`;
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    // Ordena cada grupo internamente por pedido_ref, e os grupos pela entrega
    // mais próxima do PV (menor data_entrega_cliente entre as OPs do PV).
    const entries = Array.from(map.entries()).map(([saleOrderId, ops]) => {
      ops.sort((a, b) => (a.pedido_ref || '').localeCompare(b.pedido_ref || ''));
      const earliestDelivery = ops.reduce((min, o) =>
        !min || (o.data_entrega_cliente && o.data_entrega_cliente < min) ? o.data_entrega_cliente : min,
        '' as string,
      );
      return { saleOrderId, ops, earliestDelivery };
    });
    entries.sort((a, b) => (a.earliestDelivery || '9999').localeCompare(b.earliestDelivery || '9999'));
    return entries;
  }, [filtered]);

  const pvIds = useMemo(
    () => groupedByPV.map(g => g.saleOrderId).filter(id => !id.startsWith('op-')),
    [groupedByPV],
  );
  const { data: pvInfo = [] } = useSaleOrdersInfo(pvIds);
  const pvInfoById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of pvInfo) m.set(p.id, p);
    return m;
  }, [pvInfo]);

  const togglePV = (saleOrderId: string) => {
    setCollapsedPVs(prev => {
      const next = new Set(prev);
      if (next.has(saleOrderId)) next.delete(saleOrderId);
      else next.add(saleOrderId);
      return next;
    });
  };

  const kpis = useMemo(() => {
    const today = new Date();
    let lateBuy = 0, lateCut = 0, totalPairs = 0;
    for (const r of rows) {
      try {
        if (r.data_limite_compra && isBefore(parseISO(r.data_limite_compra), today) && !isToday(parseISO(r.data_limite_compra))) lateBuy++;
        if (r.data_inicio_corte && isBefore(parseISO(r.data_inicio_corte), today) && !isToday(parseISO(r.data_inicio_corte))) lateCut++;
      } catch {}
      totalPairs += Number(r.op_quantity || 0);
    }
    return { lateBuy, lateCut, totalPairs, totalOps: rows.length };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Workflow className="h-5 w-5 text-primary" />
                Cronograma Reverso de Produção
              </CardTitle>
              <CardDescription>
                A partir da data de entrega, o sistema calcula quando comprar, quando o material precisa estar na fábrica e quando cada setor deve iniciar.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
              {/* Toggle: agrupar por pedido (PV) ou listar OP a OP */}
              <div className="inline-flex rounded-md border bg-background overflow-hidden">
                <button
                  type="button"
                  onClick={() => setGroupMode('pedido')}
                  className={`px-3 h-9 text-xs font-medium transition-colors ${
                    groupMode === 'pedido' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                  aria-pressed={groupMode === 'pedido'}
                >
                  Por Pedido
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('op')}
                  className={`px-3 h-9 text-xs font-medium border-l transition-colors ${
                    groupMode === 'op' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                  aria-pressed={groupMode === 'op'}
                >
                  Por OP
                </button>
              </div>
              <div className="relative flex-1 sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar OP ou referência..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                disabled={rows.filter(r => computeLateStages(r).length > 0).length === 0}
                onClick={() => exportLateOrdersToExcel(rows)}
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Exportar Atrasadas</span>
                <span className="sm:hidden">Excel</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
          <KpiBox label="OPs ativas" value={kpis.totalOps} />
          <KpiBox label="Total de pares" value={kpis.totalPairs.toLocaleString('pt-BR')} />
          <KpiBox label="Compras em atraso" value={kpis.lateBuy} tone={kpis.lateBuy > 0 ? 'late' : 'ok'} />
          <KpiBox label="Cortes em atraso" value={kpis.lateCut} tone={kpis.lateCut > 0 ? 'late' : 'ok'} />
        </CardContent>
      </Card>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Nenhuma Ordem de Produção com data de entrega definida.</p>
          </CardContent>
        </Card>
      )}

      {groupMode === 'op' ? (
        <div className="space-y-3">
          {filtered.map(op => <OpCard key={op.order_id} op={op} onDialog={setDialogState} />)}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByPV.map(({ saleOrderId, ops, earliestDelivery }) => {
            const pv = pvInfoById.get(saleOrderId);
            const totalPairs = ops.reduce((s, o) => s + Number(o.op_quantity || 0), 0);
            const lateOps = ops.filter(o => computeLateStages(o).length > 0).length;
            const totalLateStages = ops.reduce((s, o) => s + computeLateStages(o).length, 0);
            const isCollapsed = collapsedPVs.has(saleOrderId);
            const firstOp = ops[0];
            return (
              <Card key={saleOrderId} className="overflow-hidden">
                <CardHeader className="pb-3 bg-muted/40 border-b">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      <button
                        onClick={() => togglePV(saleOrderId)}
                        className="text-left min-w-0"
                        aria-expanded={!isCollapsed}
                      >
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                          PV {pv?.order_number || '—'}
                          <span className="text-muted-foreground font-normal truncate">
                            · {pv?.client_name || 'Cliente —'}
                          </span>
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {ops.length} {ops.length === 1 ? 'OP' : 'OPs'} · {totalPairs} pares · entrega mais próxima {fmtFull(earliestDelivery)}
                        </CardDescription>
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => setDialogState({ open: true, scope: 'order', row: firstOp })}
                      >
                        <FileText className="h-3 w-3" />
                        Resumo do PV
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {totalLateStages > 0 && (
                        <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-xs gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {lateOps}/{ops.length} {ops.length === 1 ? 'OP com atraso' : 'OPs com atraso'} ({totalLateStages} etapas)
                        </Badge>
                      )}
                      {pv?.status && <Badge variant="outline" className="text-xs">{pv.status}</Badge>}
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                        Entrega: {fmtFull(pv?.delivery_deadline || earliestDelivery)}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => togglePV(saleOrderId)}
                      >
                        {isCollapsed ? 'Expandir' : 'Recolher'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {!isCollapsed && (
                  <CardContent className="pt-3 space-y-3">
                    {ops.map(op => <OpCard key={op.order_id} op={op} onDialog={setDialogState} compact />)}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <DelayDetailDialog
        open={dialogState.open}
        onClose={() => setDialogState(s => ({ ...s, open: false }))}
        scope={dialogState.scope}
        focusRow={dialogState.row}
        allRows={rows}
      />
    </div>
  );
}

interface OpCardProps {
  op: ScheduleRow;
  onDialog: (s: { open: boolean; scope: 'order' | 'op'; row: ScheduleRow | null }) => void;
  /** Compacto: renderiza header menor (usado dentro do agrupamento por PV). */
  compact?: boolean;
}

function OpCard({ op, onDialog, compact = false }: OpCardProps) {
  const lateCount = computeLateStages(op).length;
  return (
    <Card className={compact ? 'overflow-hidden border-border/60' : 'overflow-hidden'}>
      <CardHeader className={compact ? 'pb-2 bg-muted/20 py-2' : 'pb-3 bg-muted/30'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <CardTitle className={compact ? 'text-sm' : 'text-base'}>OP {op.pedido_ref}</CardTitle>
              <CardDescription className="text-xs">
                {op.referencia_nome} · {op.op_quantity} pares
              </CardDescription>
            </div>
            {!compact && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => onDialog({ open: true, scope: 'order', row: op })}
                >
                  <FileText className="h-3 w-3" />
                  Levar do pedido
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => onDialog({ open: true, scope: 'op', row: op })}
                >
                  <Layers className="h-3 w-3" />
                  Levar a OP
                </Button>
              </div>
            )}
            {compact && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs gap-1 px-2"
                onClick={() => onDialog({ open: true, scope: 'op', row: op })}
              >
                <Layers className="h-3 w-3" />
                Detalhes
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lateCount > 0 && (
              <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-xs gap-1">
                <AlertTriangle className="h-3 w-3" />
                {lateCount} em atraso
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">{op.order_status}</Badge>
            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
              Entrega: {fmtFull(op.data_entrega_cliente)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className={compact ? 'pt-3 pb-3' : 'pt-4'}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {stages.map(s => {
            const date = (op as any)[s.key] as string;
            const st = statusOf(date);
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className={`p-3 rounded-lg border ${toneClasses[st.tone]} flex flex-col gap-1`}
                title={s.hint}
              >
                <div className="flex items-center justify-between text-xs uppercase tracking-wide opacity-70">
                  <span>{s.label}</span>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="font-bold text-base leading-tight">{fmt(date)}</div>
                <div className="text-xs opacity-80">{st.label}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Lead times:</span>
          <span>Corte {op.lead_time_corte_dias}d</span>
          <span>· Costura {op.lead_time_costura_dias}d</span>
          <span>· Montagem {op.lead_time_montagem_dias}d</span>
          {op.lead_time_mesa_dias > 0 && (
            <span>· Mesa {op.lead_time_mesa_dias}d</span>
          )}
          <span>· Acabamento {op.lead_time_acabamento_dias}d</span>
          <span>· Buffer material {op.lead_time_buffer_material_dias}d</span>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiBox({ label, value, tone }: { label: string; value: number | string; tone?: 'late' | 'ok' }) {
  const toneCls =
    tone === 'late' ? 'border-destructive/40 bg-destructive/5' :
    tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5' :
    'border-border';
  return (
    <div className={`p-3 rounded-md border ${toneCls}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {tone === 'late' && <AlertTriangle className="h-3 w-3 text-destructive" />}
        {label}
      </div>
      <div className="display text-2xl tabular-nums">{value}</div>
    </div>
  );
}

export default ProductionScheduleTimeline;
