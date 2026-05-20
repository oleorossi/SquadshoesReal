import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CircleNotch as Loader2, Hash, ArrowRight, FastForward, Calendar, DotsSixVertical as GripVertical, CheckSquare, Pin, Warning as AlertTriangle, Funnel as Filter, FileArrowDown as FileDown, FileText, EyeSlash as EyeOff, Clock, Scissors, Stack as Layers, Diamond as Gem, Printer, Flame, Hammer, Footprints, Hand, Sparkle as Sparkles, Truck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { BottleneckInfo } from "@/lib/sectorBottleneck";
import { OrderDetailsModal } from "./OrderDetailsModal";
import { BottleneckDetailsDialog } from "./BottleneckDetailsDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { exportBottleneckCSV, exportBottleneckPDF } from '@/lib/exportBottleneckOrders';
import { SmartSearch, SmartSearchSuggestion } from '@/components/ui/smart-search';

/**
 * Pequeno contador animado: faz uma transição numérica suave entre o valor
 * anterior e o novo (~250ms), para o usuário perceber o impacto do filtro
 * sem precisar reler a tela.
 */
function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState<number>(value);
  const fromRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const duration = 280;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = Math.round(from + (to - from) * eased);
      setDisplay(cur);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = display;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className={className}>{display}</span>;
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { normalizeForSearch } from '@/lib/searchUtils';

interface KanbanOrder {
  id: string;
  order_number: string;
  client_order_number?: string;
  client_name?: string;
  quantity: number;
  production_step: string;
  reference_name?: string;
  material_status?: string;
  image_url?: string;
  color?: string;
  current_sector?: string;
  billing_week?: string;
  delivery_deadline?: string;
  is_ahead_of_schedule?: boolean;
  manual_billing_override?: boolean;
  manual_override_reason?: string | null;
  original_min_billing_date?: string | null;
  bottleneck?: BottleneckInfo | null;
}

// Maps legacy DB sector names (pre-2026-05-06 rename + pre-PR-2 Costura) to
// canonical display keys. production_orders.current_sector pode ter valores
// antigos pra OPs criadas antes das migrações de rename.
const KANBAN_SECTOR_LEGACY: Record<string, string> = {
  // canonical underscore DB enum values → display names
  'corte_palmilha':  'Corte Palmilha',
  'corte_forracao':  'Corte Forração',
  'costura':         'Costura',
  // pre-rename aliases
  'corte':           'Corte Palmilha',
  'palmilha':        'Corte Palmilha',
  'forração':        'Corte Forração',
  'forracao':        'Corte Forração',
  // mesa → aviamento (label novo, enum DB ainda usa 'mesa')
  'mesa':            'Aviamento',
  'aviamento':       'Aviamento',
  'expedição':       'Expedição',
  'expedicao':       'Expedição',
};
function normalizeKanbanSector(s: string): string {
  const lower = s.toLowerCase().trim();
  if (KANBAN_SECTOR_LEGACY[lower]) return KANBAN_SECTOR_LEGACY[lower];
  // Case-insensitive match against canonical sector keys (handles 'silk' → 'Silk' etc.)
  return KANBAN_SECTORS.find(k => k.key.toLowerCase() === lower)?.key ?? s;
}

// `parallel: true` marca os 3 setores prep que rodam simultaneamente (PR3+S4).
// Renderizamos um header visual destacado pra equipe entender que pode atacar
// os 3 ao mesmo tempo, em vez de esperar fila sequencial.
const KANBAN_SECTORS = [
  { key: 'Pendente',       label: 'Pendente',       color: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400', icon: Clock,      parallel: false },
  { key: 'Corte Palmilha', label: 'Corte Palmilha', color: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',       icon: Scissors,   parallel: true  },
  { key: 'Corte Forração', label: 'Corte Forração', color: 'bg-purple-500/20 text-purple-700 dark:text-purple-400', icon: Layers,     parallel: true  },
  { key: 'Aviamento',      label: 'Aviamento',      color: 'bg-rose-500/20 text-rose-700 dark:text-rose-400',       icon: Hand,       parallel: true  },
  { key: 'Costura',        label: 'Costura',        color: 'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-400', icon: Layers,  parallel: false },
  { key: 'Silk',           label: 'Silk',           color: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-400',       icon: Printer,    parallel: false },
  { key: 'Colagem',        label: 'Colagem',        color: 'bg-orange-500/20 text-orange-700 dark:text-orange-400', icon: Flame,      parallel: false },
  { key: 'Montagem',       label: 'Montagem',       color: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400', icon: Hammer,  parallel: false },
  { key: 'Solagem',        label: 'Solagem',        color: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',    icon: Footprints, parallel: false },
  { key: 'Acabamento',     label: 'Acabamento',     color: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-400', icon: Sparkles,   parallel: false },
  { key: 'Expedição',      label: 'Expedição',      color: 'bg-teal-500/20 text-teal-700 dark:text-teal-400',       icon: FileText,   parallel: false },
];

function formatWeekLabel(week: string): string {
  if (!week) return '';
  if (week.startsWith('S') && week.length <= 3) return week;
  const match = week.match(/W(\d+)/);
  if (match) return `S${match[1]}`;
  return week;
}

function formatDeadline(d: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch { return d; }
}

interface SkipDecision {
  orderId: string;
  fromSector: string;
  toSector: string;
  skippedSectors: string[];
}

export function ProductionKanban({ orders, onRefresh }: { orders: KanbanOrder[], onRefresh?: () => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<KanbanOrder | null>(null);
  const [draggedOrder, setDraggedOrder] = useState<KanbanOrder | null>(null);
  const [dragOverSector, setDragOverSector] = useState<string | null>(null);
  const [skipDecision, setSkipDecision] = useState<SkipDecision | null>(null);

  // ── Pickup window por OP (via v_order_pickup_window) ────────────────────────
  // Carrega a janela de pickup das OPs visíveis para mostrar badge Ter/Sex.
  // K7 (audit): em listas >500 OPs, .in() com tudo trava a consulta.
  // Paginamos em chunks de 200 e juntamos os resultados.
  const orderIdList = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: pickupRows = [] } = useQuery({
    queryKey: ['kanban-pickup-windows', orderIdList.length, orderIdList.slice(0, 5).join(',')],
    queryFn: async () => {
      if (!orderIdList.length) return [] as Array<{ order_id: string; pickup_window: 'tuesday'|'friday'|null; pickup_date: string|null }>;
      const CHUNK = 200;
      const all: any[] = [];
      for (let i = 0; i < orderIdList.length; i += CHUNK) {
        const slice = orderIdList.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('v_order_pickup_window' as any)
          .select('order_id, pickup_window, pickup_date')
          .in('order_id', slice);
        if (data) all.push(...data);
      }
      return all;
    },
    enabled: orderIdList.length > 0,
    staleTime: 60_000,
  });
  const pickupByOrder = useMemo(() => {
    const m = new Map<string, { window: 'tuesday'|'friday'|null; date: string|null }>();
    for (const r of pickupRows) m.set(r.order_id, { window: r.pickup_window ?? null, date: r.pickup_date ?? null });
    return m;
  }, [pickupRows]);

  // K2 (audit): a partir do PR3 (paralelismo Corte P‖Corte F‖Aviamento), uma OP
  // pode estar em múltiplos setores ao mesmo tempo. Carrega todos os stages em
  // andamento das OPs visíveis e indexa por order_id → setores ativos.
  // Mesma paginação 200 do pickup pra evitar URI too long em listas grandes.
  const { data: activeStageRows = [] } = useQuery({
    queryKey: ['kanban-active-stages', orderIdList.length, orderIdList.slice(0, 5).join(',')],
    queryFn: async () => {
      if (!orderIdList.length) return [] as Array<{ order_id: string; stage_name: string }>;
      const CHUNK = 200;
      const all: Array<{ order_id: string; stage_name: string }> = [];
      for (let i = 0; i < orderIdList.length; i += CHUNK) {
        const slice = orderIdList.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('order_stages' as any)
          .select('order_id, stage_name')
          .in('order_id', slice)
          .eq('status', 'em_andamento');
        if (data) all.push(...(data as any));
      }
      return all;
    },
    enabled: orderIdList.length > 0,
    staleTime: 30_000,
  });
  const activeStagesByOrder = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of activeStageRows) {
      const norm = normalizeKanbanSector(r.stage_name);
      const set = m.get(r.order_id) ?? new Set<string>();
      set.add(norm);
      m.set(r.order_id, set);
    }
    return m;
  }, [activeStageRows]);
  // Bulk-finalize support for the last sector (Acabamento)
  const [acabamentoSelected, setAcabamentoSelected] = useState<Set<string>>(new Set());
  const [bulkFinalizing, setBulkFinalizing] = useState(false);
  const [bottleneckFilter, setBottleneckFilter] = useState<'all' | 'any-issue' | 'critical-only' | 'hide-ok'>('all');
  const [bottleneckDetail, setBottleneckDetail] = useState<KanbanOrder | null>(null);
  const [bulkMoveSector, setBulkMoveSector] = useState<string>('');
  const [bulkMoveRunning, setBulkMoveRunning] = useState(false);
  const { finalizeSectorTask, invalidateProductionCaches } = useProductionTransitions();

  // ===== Busca interna + persistência URL/localStorage =====
  const [searchParams, setSearchParams] = useSearchParams();
  const PREFS_KEY = 'kanban:search:v1';
  const HISTORY_KEY = 'kanban:search:history:v1';
  const HISTORY_MAX = 8;

  const readStoredPref = (): { q: string } => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? (JSON.parse(raw) as { q: string }) : { q: '' };
    } catch { return { q: '' }; }
  };
  const readHistory = (): string[] => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  };

  // Prioridade: URL > localStorage > ''
  const [search, setSearch] = useState<string>(() => {
    const fromUrl = searchParams.get('q');
    if (fromUrl !== null) return fromUrl;
    return readStoredPref().q || '';
  });
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readHistory());

  // Hidrata bottleneckFilter da URL (uma vez, na montagem)
  useEffect(() => {
    const f = searchParams.get('bn');
    if (f === 'all' || f === 'any-issue' || f === 'critical-only' || f === 'hide-ok') {
      setBottleneckFilter(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza prefs com URL (q, bn)
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (search) params.set('q', search); else params.delete('q');
    if (bottleneckFilter !== 'all') params.set('bn', bottleneckFilter); else params.delete('bn');
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, bottleneckFilter]);

  // Persiste o último termo no localStorage
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ q: search })); } catch { /* noop */ }
  }, [search]);

  // Registra no histórico quando o termo "se estabiliza" (debounce 800ms) e tem ≥2 chars
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      setSearchHistory((prev) => {
        const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, HISTORY_MAX);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [search]);

  // Predicado de busca textual aplicado a cada OP
  const matchesSearch = useCallback((o: KanbanOrder) => {
    const q = normalizeForSearch(search);
    if (!q) return true;
    return (
      normalizeForSearch(o.order_number).includes(q) ||
      normalizeForSearch(o.client_order_number).includes(q) ||
      normalizeForSearch(o.client_name).includes(q) ||
      normalizeForSearch(o.reference_name).includes(q) ||
      normalizeForSearch(o.color).includes(q)
    );
  }, [search]);

  // Sugestões dedupadas para SmartSearch (memoizadas em índices)
  const suggestionIndex = useMemo(() => {
    const clients = new Map<string, number>();
    const refs = new Map<string, number>();
    const colors = new Map<string, number>();
    const ops = new Map<string, number>();
    for (const o of orders) {
      const cli = (o.client_name || '').trim();
      if (cli) clients.set(cli, (clients.get(cli) ?? 0) + 1);
      const ref = (o.reference_name || '').trim();
      if (ref) refs.set(ref, (refs.get(ref) ?? 0) + 1);
      const col = (o.color || '').trim();
      if (col) colors.set(col, (colors.get(col) ?? 0) + 1);
      const op = (o.order_number || '').trim();
      if (op) ops.set(op, 1);
    }
    return { clients, refs, colors, ops };
  }, [orders]);

  const getSuggestions = useCallback((term: string): SmartSearchSuggestion[] => {
    const q = normalizeForSearch(term);
    if (!q) return [];
    const out: SmartSearchSuggestion[] = [];
    const pushFrom = (
      map: Map<string, number>,
      field: SmartSearchSuggestion['field'],
      label: string,
      withCount = true,
    ) => {
      let added = 0;
      for (const [val, count] of map) {
        if (added >= 5) break;
        if (normalizeForSearch(val).includes(q)) {
          out.push({ field, value: val, meta: withCount ? `${label} · ${count} OP${count === 1 ? '' : 's'}` : label });
          added++;
        }
      }
    };
    pushFrom(suggestionIndex.clients, 'name', 'Cliente');
    pushFrom(suggestionIndex.refs, 'sku', 'Referência');
    pushFrom(suggestionIndex.colors, 'category', 'Cor');
    pushFrom(suggestionIndex.ops, 'custom', 'OP', false);
    return out;
  }, [suggestionIndex]);

  // ===== Alertas para OPs que migraram para 'critical' =====
  const previousSeverityRef = useRef<Map<string, 'ok' | 'warning' | 'critical'>>(new Map());
  const isFirstSeverityScan = useRef(true);
  useEffect(() => {
    const next = new Map<string, 'ok' | 'warning' | 'critical'>();
    const newlyCritical: { order: KanbanOrder; where: 'atual' | 'próximo' }[] = [];
    for (const o of orders) {
      const b = o.bottleneck;
      const cur = b?.severity ?? 'ok';
      const nxt = b?.nextStage?.severity ?? 'ok';
      const worst: 'ok' | 'warning' | 'critical' =
        cur === 'critical' || nxt === 'critical'
          ? 'critical'
          : cur === 'warning' || nxt === 'warning'
            ? 'warning'
            : 'ok';
      next.set(o.id, worst);
      if (!isFirstSeverityScan.current) {
        const prev = previousSeverityRef.current.get(o.id);
        if (worst === 'critical' && prev !== 'critical') {
          newlyCritical.push({ order: o, where: cur === 'critical' ? 'atual' : 'próximo' });
        }
      }
    }
    previousSeverityRef.current = next;
    if (isFirstSeverityScan.current) {
      isFirstSeverityScan.current = false;
      return;
    }
    if (newlyCritical.length > 0) {
      const first = newlyCritical[0];
      const extra = newlyCritical.length - 1;
      toast.error(
        extra > 0
          ? `🔴 OP #${first.order.order_number} entrou em CRÍTICO (${first.where}) — e mais ${extra} OP(s)`
          : `🔴 OP #${first.order.order_number} entrou em CRÍTICO no setor ${first.where}`,
        {
          description: first.order.bottleneck?.reason || first.order.bottleneck?.nextStage?.reason || '',
          duration: 8000,
          action: {
            label: 'Ver detalhes',
            onClick: () => setBottleneckDetail(first.order),
          },
        },
      );
    }
  }, [orders]);

  const toggleAcabamentoOrder = (orderId: string) => {
    setAcabamentoSelected(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  };

  const handleBulkFinalizeAcabamento = async () => {
    if (acabamentoSelected.size === 0) return;
    setBulkFinalizing(true);
    try {
      const ids = Array.from(acabamentoSelected);
      const results = (await Promise.all(
        ids.map(orderId => finalizeSectorTask(orderId, 'Acabamento'))
      )) as any[];
      const successCount = results.filter(r => r && r.success).length;
      if (successCount > 0) {
        toast.success(`Acabamento finalizado para ${successCount} OP(s)!`);
        setAcabamentoSelected(new Set());
        await onRefresh?.();
      } else {
        toast.error('Nenhuma OP foi finalizada.');
      }
    } catch (err: any) {
      toast.error('Erro ao finalizar: ' + (err?.message || 'desconhecido'));
    } finally {
      setBulkFinalizing(false);
    }
  };


  const moveOrder = async (orderId: string, nextStep: string) => {
    setLoading(orderId);
    try {
      const currentOrder = orders.find(o => o.id === orderId);
      const currentSector = currentOrder?.current_sector || currentOrder?.production_step || 'Pendente';
      let toastSector = nextStep;

      if (currentSector === 'Pendente') {
        // Claim the stage transition BEFORE debiting stock. If the stage row is
        // missing or already started (concurrent tap), bail out before any stock
        // mutation so we don't ghost-consume materials.
        const { data: startedRows, error: startError } = await supabase
          .from('order_stages')
          .update({ status: 'em_andamento', started_at: new Date().toISOString() })
          .eq('order_id', orderId)
          .eq('stage_name', nextStep)
          .eq('status', 'pendente')
          .select('id');

        if (startError) throw startError;
        if (!startedRows || startedRows.length === 0) {
          throw new Error(`Etapa "${nextStep}" não encontrada ou já iniciada para esta OP.`);
        }

        const isFirstSector = ['Corte Palmilha', 'corte_palmilha', 'corte'].includes(nextStep) ||
          nextStep.toLowerCase() === 'corte palmilha';
        if (isFirstSector) {
          const { error: rpcError } = await supabase.rpc('convert_reservation_to_out', {
            p_order_id: orderId
          });
          if (rpcError) {
            // Revert stage claim so the operator can retry cleanly.
            await supabase.from('order_stages')
              .update({ status: 'pendente', started_at: null })
              .eq('order_id', orderId)
              .eq('stage_name', nextStep);
            toast.error("Erro ao baixar materiais reservados!");
            setLoading(null);
            return;
          }
        }

        const { error: updateError } = await supabase
          .from('orders')
          .update({ production_step: nextStep })
          .eq('id', orderId);

        if (updateError) throw updateError;
      } else {
        // finalize_production_sector uses the sheet's production_sectors to route correctly.
        // Use the RPC's returned next_sector so the toast reflects the actual destination.
        const result = await finalizeSectorTask(orderId, currentSector);
        toastSector = (result as any)?.next_sector || nextStep;
      }

      toast.success(`Lote movido para ${toastSector}`);
      invalidateProductionCaches();
      await onRefresh?.();
    } catch (error: any) {
      toast.error(`Erro ao mover pedido: ${error.message}`);
    } finally {
      setLoading(null);
    }
  };

  /**
   * Drop direto em um setor — pula etapas intermediárias.
   * Marca cada etapa pulada como 'concluida' e ativa apenas a etapa de destino.
   */
  const jumpToSector = async (orderId: string, fromSector: string, toSector: string, skipped: string[]) => {
    setLoading(orderId);
    try {
      const now = new Date().toISOString();

      // Claim the destination stage BEFORE any stock mutation. If the stage row
      // is missing or already started, bail without debiting stock.
      const { data: startedRows, error: startError } = await supabase
        .from('order_stages')
        .update({ status: 'em_andamento', started_at: now })
        .eq('order_id', orderId)
        .eq('stage_name', toSector)
        .eq('status', 'pendente')
        .select('id');

      if (startError) throw startError;
      if (!startedRows || startedRows.length === 0) {
        throw new Error(`Etapa "${toSector}" não encontrada ou já em andamento.`);
      }

      // Marca as etapas puladas como concluídas (incluindo a de origem se não for Pendente)
      const stagesToComplete = [...skipped];
      if (fromSector !== 'Pendente' && !stagesToComplete.includes(fromSector)) {
        stagesToComplete.push(fromSector);
      }

      if (stagesToComplete.length > 0) {
        // RPC sets quantity_processed = quantity_total in the same statement so
        // skipped stages don't show "0/total concluído" in the UI and capacity
        // planning doesn't treat them as still pending.
        const { error: skipError } = await (supabase as any).rpc('complete_order_stages_bulk', {
          p_order_id: orderId,
          p_stage_names: stagesToComplete,
        });

        if (skipError) throw skipError;
      }

      // Se vinha de Pendente, converte reservas em débito permanente APÓS a
      // etapa de destino já estar claimed (stage claim garante que só um vencedor debita).
      if (fromSector === 'Pendente') {
        const { error: rpcError } = await supabase.rpc('convert_reservation_to_out', {
          p_order_id: orderId,
        });
        if (rpcError) {
          // Revert the destination stage claim so the operator can retry cleanly.
          await supabase.from('order_stages')
            .update({ status: 'pendente', started_at: null })
            .eq('order_id', orderId)
            .eq('stage_name', toSector);
          throw new Error(`Erro ao baixar materiais reservados: ${rpcError.message}`);
        }
      }

      // Atualiza a ordem para refletir o setor atual
      const { error: updateError } = await supabase
        .from('orders')
        .update({ production_step: toSector })
        .eq('id', orderId);

      if (updateError) throw updateError;

      toast.success(
        skipped.length > 0
          ? `Pedido movido para ${toSector} — ${skipped.length} etapa(s) pulada(s)`
          : `Pedido movido para ${toSector}`
      );
      invalidateProductionCaches();
      await onRefresh?.();
    } catch (error: any) {
      toast.error(`Erro ao saltar setor: ${error.message}`);
    } finally {
      setLoading(null);
      setSkipDecision(null);
    }
  };

  const handleDrop = (toSectorKey: string) => {
    setDragOverSector(null);
    if (!draggedOrder) return;
    const fromSector = normalizeKanbanSector(draggedOrder.current_sector || draggedOrder.production_step || 'Pendente');
    if (fromSector === toSectorKey) { setDraggedOrder(null); return; }

    const fromIdx = KANBAN_SECTORS.findIndex(s => s.key === fromSector);
    const toIdx = KANBAN_SECTORS.findIndex(s => s.key === toSectorKey);

    // Apenas avança (não permite voltar via drag)
    if (toIdx <= fromIdx) {
      toast.warning('Arraste apenas para frente no fluxo de produção');
      setDraggedOrder(null);
      return;
    }

    // Etapas que serão puladas (entre origem e destino, exclusive)
    const skipped = KANBAN_SECTORS
      .slice(fromIdx + 1, toIdx)
      .map(s => s.key)
      .filter(k => k !== 'Pendente');

    // Guard contra "pular tudo" — quando é mais de 4 setores ou indo direto
    // de Pendente pra Expedição (saltando produção inteira), bloqueia.
    // Operador precisa explicitar avanço setor-a-setor pra evitar fraude
    // ou erro de drag-n-drop em mobile.
    const MAX_SKIP = 4;
    if (skipped.length > MAX_SKIP) {
      toast.error(
        `Não é possível pular ${skipped.length} setores de uma vez. Avance até no máximo ${MAX_SKIP + 1} setores adiante (atual → +${MAX_SKIP + 1}).`,
        { duration: 6000 }
      );
      setDraggedOrder(null);
      return;
    }
    if (fromSector === 'Pendente' && toSectorKey === 'Expedição') {
      toast.error(
        'Pendente → Expedição não é permitido. OPs precisam passar por pelo menos um setor produtivo.',
        { duration: 6000 }
      );
      setDraggedOrder(null);
      return;
    }

    // Se não há nada a pular, é um avanço normal — mas ainda pedimos confirmação
    setSkipDecision({
      orderId: draggedOrder.id,
      fromSector,
      toSector: toSectorKey,
      skippedSectors: skipped,
    });
    setDraggedOrder(null);
  };

  const getOrdersForSector = (sectorKey: string) => {
    return orders.filter(o => {
      // K2 (audit): se a OP tem stages 'em_andamento' em múltiplos setores
      // (paralelismo Corte P‖Corte F‖Aviamento), aparece em todos eles. Caso
      // contrário, cai no fluxo legado por current_sector.
      const activeSectors = activeStagesByOrder.get(o.id);
      if (activeSectors && activeSectors.size > 0) {
        if (!activeSectors.has(sectorKey)) return false;
      } else {
        const step = normalizeKanbanSector(o.current_sector || o.production_step || 'Pendente');
        if (step !== sectorKey) return false;
      }
      if (!matchesSearch(o)) return false;
      // Aplica filtro de gargalo
      const b = o.bottleneck;
      const currentSeverity = b?.severity ?? 'ok';
      const nextSeverity = b?.nextStage?.severity ?? 'ok';
      const worst =
        currentSeverity === 'critical' || nextSeverity === 'critical'
          ? 'critical'
          : currentSeverity === 'warning' || nextSeverity === 'warning'
            ? 'warning'
            : 'ok';
      switch (bottleneckFilter) {
        case 'critical-only':
          return worst === 'critical';
        case 'any-issue':
          return worst !== 'ok';
        case 'hide-ok':
          return worst !== 'ok';
        case 'all':
        default:
          return true;
      }
    });
  };

  // Lista das OPs visíveis (após filtro) para exportação
  const filteredOrders = orders.filter(o => {
    if (!matchesSearch(o)) return false;
    const b = o.bottleneck;
    const currentSeverity = b?.severity ?? 'ok';
    const nextSeverity = b?.nextStage?.severity ?? 'ok';
    const worst =
      currentSeverity === 'critical' || nextSeverity === 'critical'
        ? 'critical'
        : currentSeverity === 'warning' || nextSeverity === 'warning'
          ? 'warning'
          : 'ok';
    switch (bottleneckFilter) {
      case 'critical-only': return worst === 'critical';
      case 'any-issue':     return worst !== 'ok';
      case 'hide-ok':       return worst !== 'ok';
      default:              return true;
    }
  });

  // K2 (audit): contagem agora considera multi-sector — uma OP em paralelo conta
  // em cada setor onde tem stage ativa, refletindo a soma visual do kanban.
  const sectorCounts = useMemo(() => {
    const init: Record<string, { filtered: number; total: number }> = {};
    for (const s of KANBAN_SECTORS) init[s.key] = { filtered: 0, total: 0 };
    const filteredIds = new Set(filteredOrders.map((o) => o.id));
    for (const o of orders) {
      const activeSectors = activeStagesByOrder.get(o.id);
      const sectorsForThisOrder: string[] = activeSectors && activeSectors.size > 0
        ? Array.from(activeSectors)
        : [normalizeKanbanSector(o.current_sector || o.production_step || 'Pendente')];
      for (const sec of sectorsForThisOrder) {
        if (!init[sec]) continue;
        init[sec].total += 1;
        if (filteredIds.has(o.id)) init[sec].filtered += 1;
      }
    }
    return init;
  }, [orders, filteredOrders, activeStagesByOrder]);

  const hasActiveFilter = search.trim().length > 0 || bottleneckFilter !== 'all';

  const filterLabelMap: Record<typeof bottleneckFilter, string> = {
    'all': 'todas',
    'any-issue': 'com_gargalo',
    'critical-only': 'criticos',
    'hide-ok': 'sem_ok',
  };

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      toast.warning('Nenhuma OP para exportar com o filtro atual');
      return;
    }
    exportBottleneckCSV(filteredOrders, filterLabelMap[bottleneckFilter]);
    toast.success(`${filteredOrders.length} OP(s) exportada(s) em CSV`);
  };

  const handleExportPDF = () => {
    if (filteredOrders.length === 0) {
      toast.warning('Nenhuma OP para exportar com o filtro atual');
      return;
    }
    exportBottleneckPDF(filteredOrders, filterLabelMap[bottleneckFilter]);
    toast.success(`${filteredOrders.length} OP(s) exportada(s) em PDF`);
  };

  return (
    <div className="space-y-4">
      {/* Busca interna */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 max-w-md">
            <SmartSearch
              value={search}
              onChange={setSearch}
              getSuggestions={getSuggestions}
              placeholder="Buscar OP, cliente, referência, cor…"
            />
          </div>
          {/* Visão geral: OPs visíveis / total (sempre visível para dar contexto) */}
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors ${
              hasActiveFilter
                ? filteredOrders.length === 0
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground'
            }`}
            title="OPs visíveis após filtro / total carregado"
            aria-live="polite"
          >
            <span className="opacity-70">OPs visíveis:</span>
            <strong>
              <AnimatedCount value={filteredOrders.length} />
            </strong>
            <span className="opacity-70">/</span>
            <AnimatedCount value={orders.length} className="opacity-90" />
          </div>
        </div>

        {/* Resumo por coluna (impacto do filtro) */}
        {hasActiveFilter && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Por coluna:</span>
            {KANBAN_SECTORS.map((s) => {
              const c = sectorCounts[s.key];
              if (!c || c.total === 0) return null;
              const hidden = c.filtered === 0;
              return (
                <span
                  key={s.key}
                  className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border transition-all ${
                    hidden
                      ? 'border-destructive/50 bg-destructive/10 text-destructive ring-1 ring-destructive/30 animate-fade-in'
                      : 'border-border bg-muted/40 text-foreground'
                  }`}
                  title={
                    hidden
                      ? `${s.label} ficará oculta — 0 de ${c.total} visíveis com o filtro atual`
                      : `${s.label}: ${c.filtered} de ${c.total} visíveis`
                  }
                >
                  {hidden && <EyeOff className="h-3 w-3" />}
                  {(() => { const SI = s.icon; return <SI className="h-3 w-3 shrink-0" />; })()}
                  <span>{s.label}:</span>
                  <strong className={hidden ? 'tabular-nums' : 'tabular-nums'}>
                    <AnimatedCount value={c.filtered} />
                  </strong>
                  <span className={hidden ? 'opacity-80' : 'text-muted-foreground'}>
                    /<AnimatedCount value={c.total} />
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* Bulk move: move todas OPs filtradas pro setor escolhido */}
        {hasActiveFilter && filteredOrders.length > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-md border-2 border-primary/40 bg-primary/5">
            <span className="text-xs font-bold text-primary">
              Mover {filteredOrders.length} OP{filteredOrders.length !== 1 ? 's' : ''} filtrada{filteredOrders.length !== 1 ? 's' : ''} para:
            </span>
            <select
              className="h-7 text-xs rounded border bg-background px-2"
              value={bulkMoveSector}
              onChange={e => setBulkMoveSector(e.target.value)}
            >
              <option value="">Selecione setor destino…</option>
              {KANBAN_SECTORS.filter(s => s.key !== 'Pendente').map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!bulkMoveSector || bulkMoveRunning}
              onClick={async () => {
                if (!bulkMoveSector || filteredOrders.length === 0) return;
                if (!confirm(`Mover ${filteredOrders.length} OP(s) para ${bulkMoveSector}?`)) return;
                setBulkMoveRunning(true);
                let ok = 0;
                let failed = 0;
                for (const o of filteredOrders) {
                  try {
                    await moveOrder(o.id, bulkMoveSector);
                    ok++;
                  } catch {
                    failed++;
                  }
                }
                setBulkMoveRunning(false);
                setBulkMoveSector('');
                toast.success(`${ok} OP(s) movida(s)${failed > 0 ? ` · ${failed} falharam` : ''}`);
              }}
            >
              {bulkMoveRunning ? 'Movendo…' : 'Mover em massa'}
            </Button>
          </div>
        )}

        {!search && searchHistory.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Buscas recentes:</span>
            {searchHistory.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setSearch(h)}
                className="text-xs px-2 py-0.5 rounded-md border border-border bg-muted/40 hover:bg-muted text-foreground transition-colors"
              >
                {h}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSearchHistory([]);
                try { localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
              }}
              className="text-[11px] text-muted-foreground hover:text-destructive ml-1"
              aria-label="Limpar histórico de buscas"
            >
              limpar
            </button>
          </div>
        )}
      </div>

      {/* Resumo compacto */}
      <div className="flex flex-wrap items-center gap-2">
        {KANBAN_SECTORS.map((sector) => {
          const sectorOrders = getOrdersForSector(sector.key);
          const aheadCount = sectorOrders.filter(o => o.is_ahead_of_schedule).length;
          const total = sectorCounts[sector.key]?.total ?? sectorOrders.length;
          const showRatio = hasActiveFilter && total !== sectorOrders.length;
          const isZeroFiltered = hasActiveFilter && total > 0 && sectorOrders.length === 0;
          return (
            <Badge
              key={sector.key}
              variant="outline"
              className={`text-xs px-2 py-1 transition-all ${
                isZeroFiltered
                  ? 'bg-destructive/10 text-destructive border-destructive/50 ring-1 ring-destructive/30 opacity-90'
                  : sector.color
              }`}
            >
              {(() => { const SI = sector.icon; return <SI className="h-3 w-3 shrink-0 mr-0.5" />; })()} {sector.label}:{' '}
              <AnimatedCount value={sectorOrders.length} className="tabular-nums" />
              {showRatio && (
                <span className={`ml-0.5 ${isZeroFiltered ? 'opacity-80' : 'text-muted-foreground'}`}>
                  /<AnimatedCount value={total} className="tabular-nums" />
                </span>
              )}
              {aheadCount > 0 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">({aheadCount} ⚡)</span>
              )}
            </Badge>
          );
        })}

        <div
          className="flex items-center gap-1.5 ml-auto"
          /* K8 (audit): tooltip explica os 3 níveis de severidade do filtro
             (⚠ warning, 🔴 critical, ✓ ok). Antes, o usuário só via os emojis
             nos itens do select sem entender o que disparava cada classificação. */
          title="Severidade: 🔴 crítico = atrasou ≥3 dias o setor seguinte · ⚠ warning = vai atrasar entre 1–2 dias · ✓ OK = dentro do prazo. Filtros aplicam sobre o conjunto após a busca."
        >
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={bottleneckFilter} onValueChange={(v: any) => setBottleneckFilter(v)}>
            <SelectTrigger className="h-7 text-xs w-[200px]">
              <SelectValue placeholder="Filtrar gargalos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Mostrar todas as OPs</SelectItem>
              <SelectItem value="any-issue" className="text-xs">Apenas com gargalo (⚠ + 🔴)</SelectItem>
              <SelectItem value="critical-only" className="text-xs">Apenas críticos (🔴)</SelectItem>
              <SelectItem value="hide-ok" className="text-xs">Ocultar OPs OK</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                <FileDown className="h-3.5 w-3.5" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV} className="text-xs gap-2">
                <FileText className="h-3.5 w-3.5" />
                CSV ({filteredOrders.length} OP{filteredOrders.length === 1 ? '' : 's'})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF} className="text-xs gap-2">
                <FileText className="h-3.5 w-3.5" />
                PDF ({filteredOrders.length} OP{filteredOrders.length === 1 ? '' : 's'})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        💡 Dica: arraste uma OP e solte em qualquer setor à frente para pulá-la diretamente para lá. As etapas intermediárias serão tratadas conforme sua escolha.
      </p>

      <div className="text-[11px] flex items-center gap-2 text-muted-foreground bg-muted/40 border border-border/50 rounded-md px-2.5 py-1.5">
        <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>
          <span className="font-medium text-foreground">Corte Palmilha</span> ‖ <span className="font-medium text-foreground">Corte Forração</span> ‖ <span className="font-medium text-foreground">Aviamento</span> rodam <span className="font-medium text-primary">em paralelo</span>; Costura só inicia quando os 3 estiverem prontos.
        </span>
      </div>

      {/* Kanban columns */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3" style={{ minWidth: `${KANBAN_SECTORS.length * 220}px` }}>
          {KANBAN_SECTORS.map((sector) => {
            const sectorOrders = getOrdersForSector(sector.key);
            const sectorIndex = KANBAN_SECTORS.findIndex(s => s.key === sector.key);
            const isDragOver = dragOverSector === sector.key;

            return (
              <div
                key={sector.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverSector(sector.key); }}
                onDragLeave={() => setDragOverSector(prev => prev === sector.key ? null : prev)}
                onDrop={(e) => { e.preventDefault(); handleDrop(sector.key); }}
                className={`flex-1 min-w-[200px] max-w-[260px] rounded-xl border shadow-sm flex flex-col transition-all ${
                  isDragOver
                    ? 'bg-primary/10 border-primary border-2 shadow-lg scale-[1.02] ring-2 ring-primary/40 ring-offset-2'
                    : 'bg-muted/30 border-border/50'
                }`}
              >
                {/* Column header — destaca prep paralelos (#9 auditoria) */}
                <div className={`p-3 border-b border-border/30 flex flex-col gap-1.5 sticky top-0 rounded-t-xl z-10 ${
                  sector.parallel
                    ? 'bg-primary/5 ring-1 ring-inset ring-primary/20'
                    : 'bg-muted/30'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {(() => { const SI = sector.icon; return <SI className="h-4 w-4 shrink-0" />; })()}
                      <h3 className="font-semibold text-xs text-foreground">{sector.label}</h3>
                      {sector.parallel && (
                        <span
                          className="text-[9px] font-bold text-primary bg-primary/10 px-1 rounded leading-tight"
                          title="Roda em paralelo com os outros setores prep (Corte Palmilha ‖ Corte Forração ‖ Aviamento). Costura só inicia quando os 3 finalizam."
                        >
                          ‖ PREP
                        </span>
                      )}
                    </div>
                    <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px] h-5 min-w-[20px] flex items-center justify-center">
                      {sectorOrders.length}
                    </Badge>
                  </div>
                  {/* Bulk-finalize toolbar — only on the last sector (Acabamento) */}
                  {sector.key === 'Acabamento' && sectorOrders.length > 0 && (
                    <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-border/30">
                      <label className="flex items-center gap-1 cursor-pointer text-[10px] text-muted-foreground select-none">
                        <Checkbox
                          checked={
                            sectorOrders.length > 0 &&
                            sectorOrders.every(o => acabamentoSelected.has(o.id))
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setAcabamentoSelected(new Set(sectorOrders.map(o => o.id)));
                            } else {
                              setAcabamentoSelected(new Set());
                            }
                          }}
                          className="h-3.5 w-3.5"
                        />
                        Todas
                      </label>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 px-2 text-[10px]"
                        disabled={acabamentoSelected.size === 0 || bulkFinalizing}
                        onClick={(e) => { e.stopPropagation(); handleBulkFinalizeAcabamento(); }}
                      >
                        {bulkFinalizing ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <CheckSquare className="h-3 w-3 mr-1" />
                        )}
                        Finalizar ({acabamentoSelected.size})
                      </Button>
                    </div>
                  )}
                </div>

                {/* Cards — height adaptativa: viewport menos header da página em
                    desktop; em mobile (<sm) usa min-h pra coluna não colapsar
                    e overflow-y-auto pra rolar dentro do contêiner pai.
                    SCROLLAREA NUNCA pode esconder OPs — usar 65vh max em mobile. */}
                <ScrollArea className="flex-1 max-h-[65vh] sm:max-h-[calc(100vh-280px)]">
                  <div className="p-2 space-y-2">
                    {sectorOrders.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="text-[10px] text-muted-foreground/50">
                          {isDragOver
                            ? <span className="text-primary font-bold animate-pulse">↓ Soltar aqui ↓</span>
                            : 'Nenhuma OP'}
                        </p>
                      </div>
                    ) : (
                      sectorOrders.map((order) => (
                        <Card
                          key={order.id}
                          draggable
                          onDragStart={() => setDraggedOrder(order)}
                          onDragEnd={() => { setDraggedOrder(null); setDragOverSector(null); }}
                          className={`p-2.5 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/40 transition-all group bg-card active:scale-[0.98] ${
                            order.is_ahead_of_schedule ? 'border-l-2 border-l-amber-500' : ''
                          } ${
                            order.manual_billing_override
                              ? 'border-2 border-amber-500/70 ring-1 ring-amber-500/30 shadow-amber-500/10'
                              : ''
                          } ${
                            order.bottleneck?.severity === 'critical'
                              ? 'border-l-4 border-l-red-500'
                              : order.bottleneck?.severity === 'warning'
                                ? 'border-l-2 border-l-orange-500'
                                : ''
                          } ${draggedOrder?.id === order.id ? 'opacity-50' : ''}`}
                          onClick={() => setSelectedOrder(order)}
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              {sector.key === 'Acabamento' ? (
                                <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                                  <Checkbox
                                    checked={acabamentoSelected.has(order.id)}
                                    onCheckedChange={() => toggleAcabamentoOrder(order.id)}
                                    className="h-3.5 w-3.5"
                                  />
                                </span>
                              ) : (
                                <GripVertical className="h-3 w-3 text-muted-foreground/40" />
                              )}
                              <p className="font-mono text-[9px] font-bold text-primary bg-primary/10 px-1 py-0.5 rounded leading-none flex items-center gap-0.5">
                                <Hash className="h-2 w-2" />#{order.order_number}
                              </p>
                              {(() => {
                                const pk = pickupByOrder.get(order.id);
                                if (!pk?.window) return null;
                                const isTue = pk.window === 'tuesday';
                                return (
                                  <span
                                    className={`text-[8px] px-1 py-0 h-3.5 border rounded gap-0.5 inline-flex items-center font-mono ${
                                      isTue
                                        ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/40'
                                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/40'
                                    }`}
                                    title={`Pickup ${isTue ? 'Terça' : 'Sexta'} ${pk.date ? '· ' + pk.date.split('-').reverse().slice(0,2).join('/') : ''}`}
                                  >
                                    <Truck className="h-2 w-2 mr-0.5" />
                                    {isTue ? 'TER' : 'SEX'}
                                  </span>
                                );
                              })()}
                              {order.is_ahead_of_schedule && (
                                <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[8px] px-1 py-0 h-3.5 border-0">
                                  <FastForward className="h-2 w-2 mr-0.5" />ADIANTADO
                                </Badge>
                              )}
                              {(() => {
                                /* K2 (audit): badge "PARALELO" sinaliza que essa OP
                                   está rodando em ≥2 setores ao mesmo tempo.
                                   Antes o usuário via duplicação no kanban e ficava
                                   confuso pensando ser bug — agora é explícito. */
                                const active = activeStagesByOrder.get(order.id);
                                if (!active || active.size < 2) return null;
                                return (
                                  <Badge
                                    className="bg-violet-500/15 text-violet-700 dark:text-violet-400 text-[8px] px-1 py-0 h-3.5 border-0"
                                    title={`Em ${active.size} setores em paralelo: ${Array.from(active).join(' · ')}`}
                                  >
                                    PARALELO×{active.size}
                                  </Badge>
                                );
                              })()}
                              {order.manual_billing_override && (
                                <Badge
                                  className="bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[8px] px-1 py-0 h-3.5 border border-amber-500/40 gap-0.5"
                                  title={
                                    order.manual_override_reason
                                      ? `Data manual — ${order.manual_override_reason}`
                                      : 'Data de faturamento alterada manualmente abaixo do mínimo calculado'
                                  }
                                >
                                  <Pin className="h-2 w-2 mr-0.5" />MANUAL
                                </Badge>
                              )}
                              {order.bottleneck && order.bottleneck.severity !== 'ok' && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBottleneckDetail(order);
                                  }}
                                  className={`text-[8px] px-1 py-0 h-3.5 border rounded gap-0.5 inline-flex items-center hover:brightness-110 transition cursor-pointer ${
                                    order.bottleneck.severity === 'critical'
                                      ? 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/40'
                                      : 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40'
                                  }`}
                                  title={order.bottleneck.reason + ' — clique para detalhes'}
                                >
                                  <AlertTriangle className="h-2 w-2 mr-0.5" />
                                  +{order.bottleneck.daysOver}d
                                </button>
                              )}
                              {order.bottleneck?.nextStage && order.bottleneck.nextStage.severity !== 'ok' && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBottleneckDetail(order);
                                  }}
                                  className={`text-[8px] px-1 py-0 h-3.5 border rounded gap-0.5 inline-flex items-center hover:brightness-110 transition cursor-pointer ${
                                    order.bottleneck.nextStage.severity === 'critical'
                                      ? 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/40'
                                      : 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40'
                                  }`}
                                  title={order.bottleneck.nextStage.reason + ' — clique para detalhes'}
                                >
                                  <ArrowRight className="h-2 w-2 mr-0.5" />
                                  ~{order.bottleneck.nextStage.queueDays}d
                                </button>
                              )}
                            </div>
                            {loading === order.id && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                          </div>

                          <p className="text-xs font-semibold truncate leading-tight group-hover:text-primary transition-colors mb-0.5">
                            {order.reference_name || 'Ref. sem nome'}
                          </p>
                          {order.color && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {order.color}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/70 truncate italic">
                            {order.client_name || 'Cliente'}
                          </p>

                          <div className="flex justify-between items-center pt-1.5 mt-1.5 border-t border-border/30">
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[9px] font-medium py-0 h-4">
                                {order.quantity}p
                              </Badge>
                              {order.billing_week && (
                                <Badge variant="outline" className="text-[8px] py-0 h-3.5 bg-muted/50 gap-0.5">
                                  <Calendar className="h-2 w-2" />
                                  {formatWeekLabel(order.billing_week)}
                                </Badge>
                              )}
                              {!order.billing_week && order.delivery_deadline && (
                                <span className="text-[8px] text-muted-foreground font-mono">
                                  {formatDeadline(order.delivery_deadline)}
                                </span>
                              )}
                            </div>

                            {sectorIndex < KANBAN_SECTORS.length - 1 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 rounded-full hover:bg-primary/10 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveOrder(order.id, KANBAN_SECTORS[sectorIndex + 1].key);
                                }}
                              >
                                <ArrowRight className="h-2.5 w-2.5" />
                              </Button>
                            )}
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            );
          })}
        </div>
      </div>

      <OrderDetailsModal
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />

      {/* Diálogo de confirmação para pular etapas */}
      <AlertDialog open={!!skipDecision} onOpenChange={(open) => { if (!open) setSkipDecision(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mover OP para {skipDecision?.toSector}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta OP está em <strong>{skipDecision?.fromSector}</strong> e será movida para <strong>{skipDecision?.toSector}</strong>.
                </p>
                {skipDecision && skipDecision.skippedSectors.length > 0 && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10 p-3">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1.5">
                      ⚠ {skipDecision.skippedSectors.length} etapa(s) será(ão) pulada(s):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {skipDecision.skippedSectors.map(s => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Estas etapas serão marcadas como <strong>concluídas</strong> automaticamente.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!skipDecision) return;
                jumpToSector(
                  skipDecision.orderId,
                  skipDecision.fromSector,
                  skipDecision.toSector,
                  skipDecision.skippedSectors,
                );
              }}
            >
              Confirmar e mover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottleneckDetailsDialog
        open={!!bottleneckDetail}
        onOpenChange={(v) => { if (!v) setBottleneckDetail(null); }}
        orderNumber={bottleneckDetail?.order_number}
        referenceName={bottleneckDetail?.reference_name}
        bottleneck={bottleneckDetail?.bottleneck ?? null}
      />
    </div>
  );
}
