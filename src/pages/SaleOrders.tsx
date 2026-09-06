import { parseDateOnly } from '@/lib/dateOnly';
import { useState, useMemo, useEffect, lazy, Suspense, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDebounce } from 'use-debounce';
import { loadPvConsumption, pvConsumptionQueryKey, PV_CONSUMPTION_STALE_MS } from '@/lib/pvConsumption';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useMinWidth } from '@/hooks/use-mobile';
import PendenciasView from '@/components/sale-orders/PendenciasView';
import { ArrowUp, ArrowsDownUp, Baby, Barcode, Buildings, ShoppingCart, Plus, CircleNotch as Loader2, Copy, Printer, Factory, PencilSimple as Pencil, FileText, Funnel as Filter, X, MagnifyingGlass as Search, Package, Clock, CaretDown, ChartBar as BarChart3, ClipboardText as ClipboardList, ArrowsClockwise as RefreshCw, Tag, SquaresFour as LayoutDashboard, Lightning as Zap, FileXls as FileSpreadsheet, Receipt, XCircle, CheckCircle, Check, Download, TrendUp as TrendingUp, Warning as AlertTriangle, ArrowCounterClockwise as RotateCcw, HandPalm as Hand, UploadSimple as Upload, Trash as Trash2, ListChecks, ArrowSquareOut as ExternalLink, DotsThree, Images } from '@phosphor-icons/react';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { BulkActionsBar, MarqueeOverlay } from '@/components/ui/bulk-actions-bar';
import { cn } from "@/lib/utils";
// ⚠ Estes dialogs são `lazy` E têm guarda de montagem no JSX. As duas coisas:
// `lazy` sozinho não adia nada quando o componente é renderizado
// incondicionalmente com open={false} — o React monta, o chunk é buscado no
// primeiro paint e o ganho é zero. (auditoria PV 07/08/2026)
const MarginDialog = lazy(() => import('@/components/sale-orders/MarginDialog'));
const OrderPhotosDialog = lazy(() => import('@/components/sale-orders/OrderPhotosDialog'));
const OrderConsumptionDialog = lazy(() => import('@/components/sale-orders/OrderConsumptionDialog'));
const OperatorFichasDialog = lazy(() => import('@/components/sale-orders/OperatorFichasDialog'));
const GenerateServiceOrdersWizard = lazy(() => import('@/components/contractors/GenerateServiceOrdersWizard').then(m => ({ default: m.GenerateServiceOrdersWizard })));
const GeneratePurchaseOrdersDialog = lazy(() => import('@/components/purchase/GeneratePurchaseOrdersDialog'));
import PurchaseOrdersForPvCard from '@/components/purchase/PurchaseOrdersForPvCard';
import { PvOutdatedBadge } from '@/components/sale-orders/PvOutdatedBadge';
import { RevertInvoiceButton } from '@/components/sale-orders/RevertInvoiceButton';
import SummaryConsumptionPanel from '@/components/sale-orders/SummaryConsumptionPanel';
import type { SaleOrderReadinessCorrectionTarget } from '@/components/sale-orders/SaleOrderReadinessCorrectionDialog';
const SaleOrderReadinessCorrectionDialog = lazy(() => import('@/components/sale-orders/SaleOrderReadinessCorrectionDialog'));
const SaleOrdersOverviewDialog = lazy(() => import('@/components/sale-orders/SaleOrdersOverviewDialog'));
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { SmartSearch, SmartSearchSuggestion } from '@/components/ui/smart-search';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MaterialReservationErrorBadge } from '@/components/orders/MaterialReservationErrorBadge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSaleOrders, useSaleOrderAllItems, useCreateSaleOrder, useDeleteSaleOrder, useUpdateSaleOrderStatus, useResyncOPsFromSheets, useResyncOPsFromPV, useCommitPickingForSaleOrder, useRealtimeSaleOrders, SaleOrderFormData, SaleOrderItemFormData, PackagingMode, ORDER_TYPE_LABELS } from '@/hooks/useSaleOrders';
import {
  executeSaleOrderCommand,
  preflightSaleOrderCommand,
  SaleOrderReadinessBlockedError,
} from '@/lib/saleOrderCommand';
import { useTechnicalSheetsLite } from '@/hooks/useTechnicalSheets';
import { useClients, useEconomicGroups } from '@/hooks/useClients';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
const ImportClientsDialog = lazy(() => import('@/components/clients/ImportClientsDialog').then(m => ({ default: m.ImportClientsDialog })));
// BulkNfeDialog arrasta NfePreviewPanel junto — por isso ele também é lazy.
const BulkNfeDialog = lazy(() => import('@/components/nfe/BulkNfeDialog').then(m => ({ default: m.BulkNfeDialog })));
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { useAccessControl, useCan } from '@/hooks/useAccessControl';
import { useEmitNfe, useNfeEmitidas, useCheckNfeStatus, useCancelNfe, useCompanies } from '@/hooks/useNfe';
const NfeDevolucaoDialog = lazy(() => import('@/components/nfe/NfeDevolucaoDialog').then(m => ({ default: m.NfeDevolucaoDialog })));
const NfeViewerDialog = lazy(() => import('@/components/nfe/NfeViewerDialog').then(m => ({ default: m.NfeViewerDialog })));
const NfePreviewDialog = lazy(() => import('@/components/nfe/NfePreviewDialog').then(m => ({ default: m.NfePreviewDialog })));
import type { NfeEmitida } from '@/hooks/useNfe';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { printHtml, buildSaleOrderHtmlWithData, printSaleOrderPdf, fetchCompanySettings } from '@/lib/printOrder';
import { printAllSectorsForSaleOrder } from '@/lib/printSaleOrderOPs';
import { todayISO } from '@/lib/date';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { TableSkeleton } from '@/components/layout/PageSkeleton';
import { getValidNextStatuses } from '@/lib/saleOrderStateMachine';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { normalizeForSearch, searchMatchesAllTerms, splitSearchTerms } from '@/lib/searchUtils';
import { safeUrlAttr } from '@/lib/htmlUtils';
import SalesOperationsRail, { SalesOperationsRailSkeleton } from '@/components/sale-orders/SalesOperationsRail';

// TODOS os status canônicos do sale_orders (saleOrderStateMachine.ts).
// Antes faltavam 'Pendente', 'Expedido' e 'Concluído' — PVs nesses status
// não conseguiam ver options válidas no dropdown porque o filtro de
// transições removia tudo do STATUS_OPTIONS. Resultado: usuário via só
// "Cancelado" porque era a única transição comum em vários estados.
const STATUS_OPTIONS = ['Rascunho', 'Pendente', 'Aprovado', 'Em Produção', 'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF', 'Cancelado'] as const;

// Transições válidas por status, pré-computadas uma vez. Antes isto era um IIFE
// dentro do <SelectContent> de CADA linha: Set + spread + filter + map por linha,
// a todo render — e mesmo com o dropdown fechado, porque o Radix avalia os
// children do content quando o JSX é criado, não quando abre.
// (auditoria PV 07/08/2026)
// Colunas ordenáveis. Só entram aqui as que têm campo confirmado no dado —
// cabeçalho que parece clicável e não ordena é pior que cabeçalho estático.
// "Nº Cliente" e "Cidade" ficaram de fora por isso.
type SortKey = 'order_number' | 'client_name' | 'total' | 'status' | 'pairs' | 'delivery_deadline';

interface ForceProductionCommandResponse {
  ok: boolean;
  error?: { message?: string };
  result?: {
    created_ops?: number;
    updated_ops?: number;
    created_stages?: number;
  };
}

const SORT_ACCESSORS: Record<SortKey, (o: any, pairs: Record<string, number>) => string | number | null> = {
  order_number: (o) => o.order_number ?? null,
  client_name: (o) => o.client_name ?? null,
  total: (o) => Number(o.total) || 0,
  status: (o) => o.status ?? null,
  pairs: (o, pairs) => pairs[o.id] ?? 0,
  delivery_deadline: (o) => o.delivery_deadline ?? null,
};

/** Cabeçalho ordenável. Um clique ordena crescente, outro decrescente, o terceiro
 *  volta à ordem natural — sem estado morto em que o usuário não sabe como sair. */
function SortHead({ sk, sort, onSort, align, children }: {
  sk: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (k: SortKey) => void;
  align?: 'right';
  children: ReactNode;
}) {
  const active = sort?.key === sk;
  // aria-sort pertence ao <th>, não ao botão dentro dele — no botão o leitor de
  // tela ignora e a coluna não se anuncia como ordenada.
  return (
    <TableHead
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'text-right tabular-nums' : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sk)}
        aria-label={`Ordenar por ${typeof children === 'string' ? children : sk}`}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wider font-bold text-xs hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        {active
          ? <ArrowUp className={cn('h-3 w-3 shrink-0 transition-transform', sort!.dir === 'desc' && 'rotate-180')} weight="bold" />
          : <ArrowsDownUp className="h-3 w-3 shrink-0 opacity-30" />}
      </button>
    </TableHead>
  );
}

const STATUS_TRANSITION_OPTIONS: Record<string, readonly string[]> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => {
    const allowed = new Set<string>([s, ...getValidNextStatuses(s)]);
    return [s, STATUS_OPTIONS.filter((o) => allowed.has(o))];
  }),
);

// Audit visual: cores anteriores text-{color}-400 em dark caíam abaixo do
// ratio WCAG AA (4.5:1) sobre o fundo /15. text-{color}-300 dá contraste
// adequado mantendo a paleta semântica original.
const STATUS_COLORS: Record<string, string> = {
  'Rascunho': 'bg-muted text-muted-foreground border-border',
  'Pendente': 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  'Aprovado': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'Em Produção': 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'Faturado': 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'Expedido': 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'Concluído': 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  'Finalizado s/ NF': 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'Cancelado': 'bg-destructive/15 text-destructive border-destructive/30',
};

const STATUS_DOT: Record<string, string> = {
  'Rascunho': 'bg-muted-foreground',
  'Pendente': 'bg-yellow-500',
  'Aprovado': 'bg-emerald-500',
  'Em Produção': 'bg-blue-500',
  'Faturado': 'bg-violet-500',
  'Expedido': 'bg-cyan-500',
  'Concluído': 'bg-green-500',
  'Finalizado s/ NF': 'bg-amber-500',
  'Cancelado': 'bg-destructive',
};

// Tom sutil (5%) da faixa full-bleed do header da prévia, por status — espelha a
// semântica de STATUS_DOT. Status colors em alpha baixo são permitidas (CLAUDE.md);
// default neutro pra status desconhecido.
const STATUS_BAND: Record<string, string> = {
  'Rascunho': 'bg-muted/40',
  'Pendente': 'bg-yellow-500/5',
  'Aprovado': 'bg-emerald-500/5',
  'Em Produção': 'bg-blue-500/5',
  'Faturado': 'bg-violet-500/5',
  'Expedido': 'bg-cyan-500/5',
  'Concluído': 'bg-green-500/5',
  'Finalizado s/ NF': 'bg-amber-500/5',
  'Cancelado': 'bg-destructive/5',
};

const TERMINAL_BILLED_STATUSES = ['Faturado', 'Finalizado s/ NF'];

// Formatadores hoistados: `new Intl.*` — e `toLocaleDateString`, que constrói um
// por dentro — montam um formatador a CADA chamada. A lista formata ~6 células por
// linha e re-renderiza a cada tecla digitada na busca, então isso eram centenas de
// construções por render. Mesma saída, mesmo locale, mesmas opções: só a instância
// passa a ser reusada. (auditoria PV 07/08/2026)
//
// ⚠ NÃO trocar por `formatCurrency` de @/lib/utils — aquele usa BRL_UNIT_PRICE e
// vai a 4 casas; totais de PV virariam R$ 1.234,5678. O equivalente lá é formatMoney.
const BRL_FMT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE_FMT = new Intl.DateTimeFormat('pt-BR');
const DATE_SHORT_FMT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

const formatCurrency = (v: number) => BRL_FMT.format(v);

const formatDate = (d: string | null) =>
  d ? DATE_FMT.format(parseDateOnly(d)) : '—';

const formatDateShort = (d: string) =>
  DATE_SHORT_FMT.format(parseDateOnly(d));

// Lookup batch de min_billing_date pra todos os PVs ativos.
// Usado pra marcar em vermelho linhas com delivery_deadline < min_billing_date.
//
// ⚠ PERF (2026-08-03): chama a RPC `compute_min_billing_dates(uuid[])` — motor em
// LOTE — em vez de ler a view `sale_order_min_billing`.
//
// Histórico: a view rodava `compute_min_billing_date(id)` POR LINHA, e 87% do custo
// de cada chamada era uma segunda query escondida (`get_wave_material_needs_core`,
// necessidade de material por cor/variante/grade). Medido: 160,6ms por pedido, dos
// quais 139,9ms eram essa chamada. A versão em lote faz UMA chamada pra todos os
// pedidos (~1,8× mais rápido no total).
//
// NÃO voltar a ler a view aqui: ela materializa TODOS os PVs não-cancelados antes de
// qualquer filtro — o `.in(...)` do PostgREST não empurra o predicado pra dentro do
// argumento da função, então filtrar depois não economiza nada.
//
// ⚠ PERF (2026-08-03, fase 1a da spec): nem a RPC em lote roda mais aqui. Medido:
// `compute_min_billing_dates` levava 1.058 ms pra 58 linhas tocando 37.035 buffers, e
// era a consulta mais cara do banco inteiro (1.225 s acumulados em pg_stat_statements).
// Bater o N+1 resolveu a QUANTIDADE de chamadas, não o custo de cada uma.
//
// Agora a lista lê o cache (`get_min_billing_cached`): 0,888 ms / 18 buffers. O
// recálculo mora em `refresh_min_billing_cache` e roda em SEGUNDO PLANO — requisito 25
// da spec: nunca no caminho crítico da lista.
// Referências estáveis: um `new Map()` / `[]` inline como default de hook muda de
// identidade a cada render e faz o efeito de recálculo disparar em loop.
const EMPTY_MIN_BILLING_MAP: Map<string, string> = new Map();
const EMPTY_STALE_IDS: string[] = [];

function useMinBillingMap(activeIds: string[]) {
  // Ordena pra estabilizar a queryKey — a ordem de `orders` varia entre refetches
  // e uma key instável refaria a query cara sem necessidade.
  const ids = useMemo(() => [...activeIds].sort(), [activeIds]);
  return useQuery<{ map: Map<string, string>; staleIds: string[] }>({
    queryKey: ['sale_order_min_billing_map', ids],
    queryFn: async () => {
      const map = new Map<string, string>();
      const staleIds: string[] = [];
      if (ids.length === 0) return { map, staleIds };
      const { data, error } = await supabase
        .rpc('get_min_billing_cached' as any, { p_sale_order_ids: ids });
      if (error || !data) return { map, staleIds };
      for (const row of data as any[]) {
        if (row.sale_order_id && row.min_billing_date) {
          map.set(row.sale_order_id, row.min_billing_date);
        }
        if (row.sale_order_id && row.stale) staleIds.push(row.sale_order_id);
      }
      return { map, staleIds };
    },
    enabled: ids.length > 0,
    // Alinhado ao staleTime de useSaleOrders (5min), a lista que este map decora.
    staleTime: 5 * 60 * 1000,
  });
}

// Recalcula em segundo plano o que o cache marcou como velho e invalida o map quando
// terminar. Roda DEPOIS da lista já ter renderizado — não bloqueia nada.
function useRefreshMinBillingInBackground(staleIds: string[]) {
  const qc = useQueryClient();
  const key = staleIds.join(',');
  useEffect(() => {
    if (!staleIds.length) return;
    let cancelled = false;
    (async () => {
      const { error } = await supabase.rpc('refresh_min_billing_cache' as any, {
        p_sale_order_ids: staleIds,
      });
      if (!cancelled && !error) {
        qc.invalidateQueries({ queryKey: ['sale_order_min_billing_map'] });
      }
    })();
    return () => { cancelled = true; };
    // `key` estabiliza a lista de ids; `staleIds` muda de referência a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, qc]);
}

export default function SaleOrders() {
  const isMdUp = useMinWidth(768);
  const { data: orders = [], isLoading, isError, error } = useSaleOrders();
  const { data: allSaleItems = [] } = useSaleOrderAllItems();
  // Só PVs ativos: os terminais (Faturado/Finalizado s/ NF/Cancelado) nunca chegam a
  // ser marcados como inviáveis, então pagar compute_min_billing_date por eles é puro
  // desperdício. Mesmo predicado usado em `activeCount` e no cálculo de `isInfeasible`.
  const activeSaleOrderIds = useMemo(
    () => orders
      .filter(o => !TERMINAL_BILLED_STATUSES.includes(o.status) && o.status !== 'Cancelado')
      .map(o => o.id),
    [orders],
  );
  const { data: minBillingData } = useMinBillingMap(activeSaleOrderIds);
  const minBillingMap = minBillingData?.map ?? EMPTY_MIN_BILLING_MAP;
  useRefreshMinBillingInBackground(minBillingData?.staleIds ?? EMPTY_STALE_IDS);
  // Lite: a lista só usa id/code/name/shoe_category. O hook cheio faz select('*')
  // e traz ~227 kB de colunas que esta tela nunca abre (auditoria PV 07/08/2026).
  const { data: references = [] } = useTechnicalSheetsLite();
  const { data: clients = [] } = useClients();
  const { data: economicGroups = [] } = useEconomicGroups();
  const { data: representatives = [] } = useRepresentatives();
  const createOrder = useCreateSaleOrder();
  const deleteOrder = useDeleteSaleOrder();
  const isAdmin = useIsAdmin();
  // Geração em lote pode encontrar mais de um PV bloqueado. A fila preserva
  // todos eles em vez de deixar o último erro sobrescrever os anteriores.
  const [readinessCorrectionTargets, setReadinessCorrectionTargets] = useState<SaleOrderReadinessCorrectionTarget[]>([]);
  const readinessCorrectionTarget = readinessCorrectionTargets[0] || null;
  const updateStatus = useUpdateSaleOrderStatus({
    onReadinessBlocked: (blocked, vars) => {
      const nextTarget: SaleOrderReadinessCorrectionTarget = {
        id: vars.id,
        orderNumber: orders.find((order) => order.id === vars.id)?.order_number || null,
        status: vars.status,
        preflight: blocked.preflight,
      };
      setReadinessCorrectionTargets((current) => {
        const existingIndex = current.findIndex((target) => target.id === vars.id);
        if (existingIndex < 0) return [...current, nextTarget];
        return current.map((target, index) => index === existingIndex ? nextTarget : target);
      });
    },
  });
  // Qual PV está sendo promovido agora — alimenta o indicador da linha (req. 30).
  const statusPendingId = updateStatus.isPending
    ? (updateStatus.variables as { id?: string } | undefined)?.id ?? null
    : null;
  // Subscribe Realtime: outros users veem mudanças/exclusões em ~200ms via WS.
  useRealtimeSaleOrders();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const emitNfe = useEmitNfe();
  const checkNfeStatus = useCheckNfeStatus();
  const cancelNfe = useCancelNfe();
  const { data: companies = [] } = useCompanies();
  const [nfeCompanyId, setNfeCompanyId] = useState('');
  const [cancelNfeTarget, setCancelNfeTarget] = useState<{ id: string; numero: string | null } | null>(null);
  const [cancelJustificativa, setCancelJustificativa] = useState('');
  const [devolucaoTarget, setDevolucaoTarget] = useState<{ id: string; numero: string | null } | null>(null);
  const [viewNfeTarget, setViewNfeTarget] = useState<NfeEmitida | null>(null);
  // Preview de NF-e (dry_run) — atalho ao lado do botão "Emitir NF-e" no resumo do PV.
  // Abre dialog com payload completo (destinatário, itens, totais, peso, parcelas) antes
  // de qualquer chamada destrutiva ao ClickNotas. Usuário confere e confirma emissão.
  const [previewNfeOrder, setPreviewNfeOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const resyncOPs = useResyncOPsFromSheets();
  const resyncPVOPs = useResyncOPsFromPV();
  // O fallback de picking pode debitar muitos itens de uma vez; a confirmação
  // estruturada mantém o impacto visível antes de tocar nas reservas das OPs.
  const commitPicking = useCommitPickingForSaleOrder();
  // bulkSyncFinancial removido em 2026-05 — sync acontece automaticamente no faturamento
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Sugestões para SmartSearch (PV): Cliente, Representante, Referência
  const searchSuggestions = useMemo(() => {
    return (term: string): SmartSearchSuggestion[] => {
      const q = term.toLowerCase().trim();
      if (!q) return [];
      const out: SmartSearchSuggestion[] = [];

      // Clientes (name)
      const clientMatches = (clients as any[])
        .filter((c: any) => {
          const name = (c.razao_social || c.nome_fantasia || '').toLowerCase();
          const cnpj = (c.cnpj || '').toLowerCase();
          return name.includes(q) || cnpj.includes(q);
        })
        .slice(0, 5);
      for (const c of clientMatches) {
        out.push({ field: 'name', value: c.razao_social || c.nome_fantasia || '', meta: 'Cliente' });
      }

      // Representantes (category — usado como agrupamento)
      const repMatches = (representatives as any[])
        .filter((r: any) => normalizeForSearch(r.name).includes(q))
        .slice(0, 5);
      for (const r of repMatches) {
        out.push({ field: 'category', value: r.name, meta: 'Representante' });
      }

      // Referências (sku)
      const refMatches = (references as any[])
        .filter((r: any) => normalizeForSearch(r.code).includes(q) || normalizeForSearch(r.name).includes(q))
        .slice(0, 5);
      for (const r of refMatches) {
        out.push({ field: 'sku', value: r.code || r.name, meta: r.name });
      }

      return out;
    };
  }, [clients, representatives, references]);



  // Set de sale_order_ids com NF-e autorizada — fonte da verdade fiscal pra
  // pintar a linha de verde no /sales (pedido user 19/05/2026 — não usar status,
  // usar registro real de NF). Refresh automático quando alguma NF muda status
  // (invalidação por queryKey 'sale_orders_with_nfe' em useNfe).
  const { data: nfeIssuedSaleOrderIds = new Set<string>() } = useQuery({
    queryKey: ['sale_orders_with_nfe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nfe_emitidas')
        .select('sale_order_id')
        .eq('status', 'autorizada')
        .not('sale_order_id', 'is', null);
      if (error) throw error;
      const set = new Set<string>();
      for (const row of (data || []) as any[]) {
        if (row.sale_order_id) set.add(row.sale_order_id);
      }
      return set;
    },
    staleTime: 60 * 1000,
  });
  // Mesma colisão de cache do SaleOrderForm: havia aqui um useQuery inline com
  // a queryKey ['user_roles', id] devolvendo string[], enquanto useUserRoles
  // devolve UserRole[]. Uma chave, dois formatos → includes('admin') dava false
  // pra admin de verdade. Usa o hook canônico.
  // Produção/almoxarifado veem PVs pra contexto de produção, mas SEM valores
  // (preço unit, total, comissão). canSeeFinancialValues=false bloqueia colunas
  // e KPIs financeiros sem retirar a navegação.
  const { canSeeFinancialValues, roles } = useAccessControl();
  // Espelha o gate do SaleOrderCommand: admin, gerente ou comercial, sempre
  // respeitando a ação granular `edit` da tela. Mostrar o lápis para um grant
  // somente-leitura permitiria iniciar uma mutação que a própria UI proibiu.
  //
  // ⚠ Antes as duas portas de edição discordavam entre si: o lápis da linha não
  // tinha gate nenhum e o botão "Editar" do detalhe exigia isAdmin. A incoerência
  // mascarava o fato de que NENHUM dos dois era gate de verdade.
  // Gate de permissões da tela de Pedidos (criar/excluir) — esconde ações de
  // usuários explicitamente restritos; admins/sem-grant continuam vendo tudo.
  const perm = useCan('/sales');
  const canEditPv = perm.canEdit
    && (isAdmin || roles.includes('gerente') || roles.includes('comercial'));
  // Espelha a policy de escrita de purchase_orders/items. Acesso de consulta ao
  // módulo financeiro não concede autoridade para criar uma OC.
  const canBuy = isAdmin || roles.includes('gerente');

  // Confirmação estruturada genérica (AlertDialog) — substitui os confirm()
  // nativos de ações de alto impacto da página.
  const [pendingConfirm, setPendingConfirm] = useState<null | {
    title: string;
    description: ReactNode;
    actionLabel: string;
    /** Pinta o botão de confirmação como destrutivo (excluir, cancelar). */
    destructive?: boolean;
    onConfirm: () => void | Promise<void>;
  }>(null);

  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = useState<any[]>([]);
  const [osDialogOpen, setOsDialogOpen] = useState(false); // atalho "Gerar OS" do PV
  const [loadingOrderItems, setLoadingOrderItems] = useState(false);
  // `enabled` obrigatório: sem PV selecionado o id é undefined e a query varreria
  // nfe_emitidas inteira em vez de não rodar (auditoria PV 07/08/2026).
  const { data: selectedOrderNfes = [] } = useNfeEmitidas(selectedOrder?.id, { enabled: !!selectedOrder?.id });

  const [dupDialog, setDupDialog] = useState(false);
  const [dupOrderId, setDupOrderId] = useState<string | null>(null);
  const [dupSelectedClients, setDupSelectedClients] = useState<string[]>([]);
  const [dupGroupId, setDupGroupId] = useState<string>('');
  const [dupClientSearch, setDupClientSearch] = useState('');
  const [generatingOPs, setGeneratingOPs] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [marginDialogOpen, setMarginDialogOpen] = useState(false);
  const [photosDialogOpen, setPhotosDialogOpen] = useState(false);
  const [consumoDialog, setConsumoDialog] = useState<{ ids: string[]; numbers: string[] } | null>(null);
  // "Ficha Montagem": abre a seleção de OPs em vez de imprimir o PV inteiro.
  const [operatorFichasOpen, setOperatorFichasOpen] = useState(false);
  // Canal "Compras por Pedido" — alvo do modal de geração de OCs (1 ou N PVs).
  const [poGenTarget, setPoGenTarget] = useState<{ ids: string[]; numbers: string[] } | null>(null);

  // Busca NÃO persiste: reseta ao sair e voltar pra tela (useState remonta
  // limpo). Antes usava usePersistedState com a chave 'searchTerm' — a MESMA
  // de Orders, então o termo vazava entre PVs e OPs.
  const [searchTerm, setSearchTerm] = useState('');
  // Debounce só pra ALIMENTAR o filtro pesado (filteredOrders re-renderiza até
  // 1000 linhas). O input segue ligado a searchTerm (digitação responsiva); o
  // recálculo da lista só roda 250ms após parar de digitar. (auditoria perf)
  const [debouncedSearchTerm] = useDebounce(searchTerm, 250);
  const [filterStatus, setFilterStatus] = usePersistedState<string>('filterStatus', 'all');
  const [filterRep, setFilterRep] = usePersistedState<string>('filterRep', 'all');
  const [filterGroup, setFilterGroup] = usePersistedState<string>('filterGroup', 'all');
  const [filterSegment, setFilterSegment] = usePersistedState<string>('filterSegment', 'all');
  const [filterMonth, setFilterMonth] = usePersistedState<string>('filterMonth', 'all');
  const [showFilters, setShowFilters] = usePersistedState('showFilters', false);
  const [importClientsOpen, setImportClientsOpen] = useState(false);
  const [bulkNfeOpen, setBulkNfeOpen] = useState(false);
  const [bulkNfeMode, setBulkNfeMode] = useState<'preview' | 'emit'>('preview');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>('');
  const [mainTab, setMainTab] = usePersistedState<string>('saleOrderMainTab', 'ativos');

  // Derived data
  const clientGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach(c => { if (c.economic_group_id) map[c.razao_social] = c.economic_group_id; });
    return map;
  }, [clients]);

  // Map: client name (lowercased) -> client record (for CNPJ + client_number lookups)
  const clientByName = useMemo(() => {
    const map: Record<string, typeof clients[number]> = {};
    clients.forEach(c => { if (c.razao_social) map[c.razao_social.toLowerCase()] = c; });
    return map;
  }, [clients]);

  // Map: digits-only CNPJ -> client record (replaces O(n) .find() in dup-order
  // detection, which was scanning all clients for every duplicate-check call).
  const clientByCnpj = useMemo(() => {
    const map = new Map<string, typeof clients[number]>();
    clients.forEach(c => {
      const cnpj = (c.cnpj || '').replace(/\D/g, '');
      if (cnpj) map.set(cnpj, c);
    });
    return map;
  }, [clients]);

  // Reference lookup: id -> { code, name } for searching by referência (code or name)
  const refById = useMemo(() => {
    const map: Record<string, { code: string; name: string }> = {};
    references.forEach((r: any) => {
      map[r.id] = { code: (r.code || '').toLowerCase(), name: (r.name || '').toLowerCase() };
    });
    return map;
  }, [references]);

  // Index: sale_order_id -> Set of searchable strings from items (ref code, ref name, color)
  const itemsBySaleOrder = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!map[id]) map[id] = new Set();
      const ref = refById[it.reference_id];
      if (ref?.code) map[id].add(ref.code);
      if (ref?.name) map[id].add(ref.name);
      if (it.color) map[id].add(String(it.color).toLowerCase());
    });
    return map;
  }, [allSaleItems, refById]);

  // Index: sale_order_id -> total pairs (sum of item.quantity)
  const pairsBySaleOrder = useMemo(() => {
    const map: Record<string, number> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      map[id] = (map[id] || 0) + (Number(it.quantity) || 0);
    });
    return map;
  }, [allSaleItems]);

  // Index: sale_order_id -> Set of segments (Adulto / Infantil) based on items' references
  const segmentsBySaleOrder = useMemo(() => {
    const refSegment: Record<string, 'Adulto' | 'Infantil'> = {};
    references.forEach((r: any) => {
      const cat = (r.shoe_category || '').toLowerCase();
      refSegment[r.id] = cat.includes('infantil') || cat.includes('kids') || cat.includes('crian') || cat.includes('bebe') || cat.includes('bebê')
        ? 'Infantil'
        : 'Adulto';
    });
    const map: Record<string, Set<'Adulto' | 'Infantil'>> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!map[id]) map[id] = new Set();
      const seg = refSegment[it.reference_id];
      if (seg) map[id].add(seg);
    });
    return map;
  }, [allSaleItems, references]);

  // Busca ATRAVESSA as abas (spec melhorias-busca-sistema R5, 2026-07-11 —
  // substitui o comportamento "buscar apenas na aba" de 29/06/2026): o match
  // roda sobre o conjunto todo num único passe; a aba ativa exibe os seus
  // resultados e as outras ganham badge de contagem pra 1 clique achar o PV.
  // Filtros explícitos (status/rep/grupo/segmento/mês) continuam valendo em
  // todas as abas.
  const { filteredOrders, searchTabCounts } = useMemo(() => {
    const searching = !!debouncedSearchTerm && !!debouncedSearchTerm.trim();
    const counts = { ativos: 0, faturados: 0, cancelados: 0 };

    const tabOf = (order: (typeof orders)[number]): keyof typeof counts => {
      if (order.status === 'Cancelado') return 'cancelados';
      if (TERMINAL_BILLED_STATUSES.includes(order.status)) return 'faturados';
      return 'ativos';
    };

    const matchesSearch = (order: (typeof orders)[number]): boolean => {
      const q = debouncedSearchTerm.toLowerCase().trim();
      if (!q) return true;

      // Atalho "/<nome>" → filtra por GRUPO ECONÔMICO do cliente (pedido
      // user 19/05/2026). Ex: "/lng" pega PVs de TODOS os clientes do grupo
      // que tenha "lng" no nome (LNG 10, LNG 30, etc). Quando só "/" foi
      // digitado, mostra tudo (operador ainda está formando a query).
      if (q.startsWith('/')) {
        const groupQuery = q.slice(1).trim();
        if (!groupQuery) return true;
        const cli = clientByName[(order.client_name || '').toLowerCase()];
        const groupId = cli?.economic_group_id;
        if (!groupId) return false;
        const group = (economicGroups as any[]).find((g: any) => g.id === groupId);
        return !!(group && normalizeForSearch(group.name).includes(normalizeForSearch(groupQuery)));
      }

      const client = clientByName[(order.client_name || '').toLowerCase()];
      const cnpjDigits = (client?.cnpj || (order as any).client_cnpj || '').replace(/\D/g, '');
      const itemTokens = itemsBySaleOrder[order.id];
      const normCandidates = [
        order.order_number,
        order.client_name,
        order.client_order_number,
        order.representative,
        order.payment_condition,
        order.nfe,
        order.remessa,
        order.delivery_week,
        order.delivery_month,
        order.notes,
        order.status,
        (order as any).client_number,
        client?.client_number,
        client?.nome_fantasia,
      ].map(normalizeForSearch);
      const tokenArr = itemTokens ? Array.from(itemTokens).map(normalizeForSearch) : [];
      // Espaço e "/" separam termos AND (refinamento): "stx alcineu" exige um
      // campo com "stx" E um campo com "alcineu" (referência + cliente, em
      // qualquer ordem). Normaliza (remove espaço/hífen/acento) por termo;
      // tDigits cobre CNPJ.
      const terms = splitSearchTerms(q);
      const matchTerm = (term: string) => {
        const tNorm = normalizeForSearch(term);
        if (!tNorm) return true;
        const tDigits = term.replace(/\D/g, '');
        return normCandidates.some(v => v.includes(tNorm))
          || (tDigits.length >= 3 && cnpjDigits.includes(tDigits))
          || tokenArr.some(t => t.includes(tNorm));
      };
      return terms.every(matchTerm);
    };

    const current: typeof orders = [];
    for (const order of orders) {
      if (filterStatus !== 'all' && order.status !== filterStatus) continue;
      if (filterRep !== 'all' && order.representative !== filterRep) continue;
      if (filterGroup !== 'all') {
        const grp = clientGroupMap[order.client_name];
        if (grp !== filterGroup) continue;
      }
      if (filterSegment !== 'all') {
        const segs = segmentsBySaleOrder[order.id];
        if (!segs || !segs.has(filterSegment as 'Adulto' | 'Infantil')) continue;
      }
      if (filterMonth !== 'all' && order.delivery_month !== filterMonth) continue;
      if (searching && !matchesSearch(order)) continue;
      const tab = tabOf(order);
      if (searching) counts[tab]++;
      if (tab === mainTab) current.push(order);
    }
    return { filteredOrders: current, searchTabCounts: searching ? counts : null };
  }, [orders, mainTab, filterStatus, filterRep, filterGroup, filterSegment, segmentsBySaleOrder, debouncedSearchTerm, clientGroupMap, clientByName, itemsBySaleOrder, economicGroups, filterMonth]);

  // Marquee selection + range/Ctrl click + Esc-to-clear (replaces ad-hoc
  // useState<Set>). `selectedIds`/`setSelectedIds` shims abaixo mantêm
  // compatibilidade com o restante do componente (~30 referências).
  // Ordenação por coluna. Não persiste entre sessões (mesma decisão dos filtros,
  // 07/08/2026): visita nova começa na ordem natural do banco.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort(s => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const sortedOrders = useMemo(() => {
    if (!sort) return filteredOrders;
    const mult = sort.dir === 'asc' ? 1 : -1;
    const get = SORT_ACCESSORS[sort.key];
    return [...filteredOrders].sort((a, b) => {
      const va = get(a, pairsBySaleOrder);
      const vb = get(b, pairsBySaleOrder);
      // Vazio sempre no fim, independente da direção — senão ordenar por "Entrega"
      // enche o topo da tela de traços e esconde o que o usuário quer ver.
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * mult;
    });
  }, [filteredOrders, sort, pairsBySaleOrder]);

  // ⚠ A seleção é alimentada por `sortedOrders`, NÃO por `filteredOrders`. O
  // Shift+clique seleciona um INTERVALO por índice: se a fonte estivesse na ordem
  // não ordenada, o intervalo marcaria linhas diferentes das que estão na tela.
  const sel = useMarqueeSelection(sortedOrders, (o) => o.id);
  const selectedIds = sel.selectedIds;
  // Shim: aceita Set<string> direto OU updater. Usado em locais como
  // `setSelectedIds(new Set())` (= sel.clear) e em handlers de bulk que
  // resetam após terminar.
  const setSelectedIds = (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    const value = typeof next === 'function' ? next(sel.selectedIds) : next;
    if (value.size === 0) sel.clear();
    else {
      // Caso (raro) de set programático com conteúdo: clear + toggle.
      sel.clear();
      value.forEach((id) => sel.toggle(id));
    }
  };
  // Bookmarks da rota legada carregam a mesma ferramenta no host; os IDs ficam
  // na URL para não perder a seleção ao atravessar o redirect.
  const consumptionViewIds = useMemo(() => {
    if (searchParams.get('view') !== 'consumo') return [];
    return (searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
  }, [searchParams]);
  const isConsumptionView = searchParams.get('view') === 'consumo';
  const isPendenciasView = searchParams.get('view') === 'pendencias';
  const consumptionViewOrders = useMemo(
    () => orders.filter((order) => consumptionViewIds.includes(order.id)),
    [orders, consumptionViewIds],
  );
  const closeConsumptionView = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    next.delete('ids');
    setSearchParams(next, { replace: true });
  };
  const toggleSelect = (id: string) => sel.toggle(id);
  const toggleSelectAll = () => {
    if (sel.count === filteredOrders.length) sel.clear();
    else sel.selectAll();
  };

  // Cada badge usa o MESMO predicado do tab gating em filteredOrders.
  // Ativos = não-faturados E não-cancelados (Rascunho continua em Ativos;
  // Cancelado ganhou aba própria em 29/06/2026 pra não poluir Ativos).
  const activeCount = useMemo(() => orders.filter(o => !TERMINAL_BILLED_STATUSES.includes(o.status) && o.status !== 'Cancelado').length, [orders]);
  const billedCount = useMemo(() => orders.filter(o => TERMINAL_BILLED_STATUSES.includes(o.status)).length, [orders]);
  const cancelledCount = useMemo(() => orders.filter(o => o.status === 'Cancelado').length, [orders]);

  const pendingOrders = useMemo(() => orders.filter(o => o.status === 'Rascunho'), [orders]);

  const activeFiltersCount = [filterStatus !== 'all', filterRep !== 'all', filterGroup !== 'all', filterSegment !== 'all', filterMonth !== 'all'].filter(Boolean).length;

  // KPI calculations
  const kpis = useMemo(() => {
    const total = filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const drafts = filteredOrders.filter(o => o.status === 'Rascunho').length;
    const approved = filteredOrders.filter(o => o.status === 'Aprovado').length;
    const inProduction = filteredOrders.filter(o => o.status === 'Em Produção').length;
    return { total, pending: drafts, approved, inProduction, count: filteredOrders.length };
  }, [filteredOrders]);

  const totalPares = useMemo(() =>
    filteredOrders.reduce((s, o) => s + (pairsBySaleOrder[o.id] || 0), 0),
  [filteredOrders, pairsBySaleOrder]);

  const deadlineRiskCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredOrders.filter((order) => {
      if (TERMINAL_BILLED_STATUSES.includes(order.status) || order.status === 'Cancelado') return false;
      const overdue = !!order.delivery_deadline && parseDateOnly(order.delivery_deadline) < today;
      const minBilling = minBillingMap.get(order.id) || null;
      const infeasible = !!(minBilling && order.delivery_deadline && order.delivery_deadline < minBilling);
      return overdue || infeasible;
    }).length;
  }, [filteredOrders, minBillingMap]);

  const currentScopeLabel = mainTab === 'faturados'
    ? 'Faturados / sem NF'
    : mainTab === 'cancelados'
      ? 'Pedidos cancelados'
      : 'Pedidos ativos';
  const selectedMinBilling = selectedOrder ? minBillingMap.get(selectedOrder.id) || null : null;
  const selectedDeadlineInfeasible = !!(
    selectedOrder
    && selectedMinBilling
    && selectedOrder.delivery_deadline
    && selectedOrder.delivery_deadline < selectedMinBilling
  );

  const uniqueMonths = useMemo(() => {
    const months = new Set(orders.map(o => o.delivery_month).filter(Boolean));
    return Array.from(months).sort();
  }, [orders]);

  const uniqueReps = useMemo(() => {
    const reps = new Set(orders.map(o => o.representative).filter(Boolean));
    return Array.from(reps).sort();
  }, [orders]);

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (filterStatus !== 'all') chips.push({ key: 'status', label: `Status: ${filterStatus}`, onRemove: () => setFilterStatus('all') });
    if (filterRep !== 'all') chips.push({ key: 'representante', label: `Rep: ${filterRep}`, onRemove: () => setFilterRep('all') });
    if (filterGroup !== 'all') {
      const groupName = economicGroups.find(g => g.id === filterGroup)?.name || filterGroup;
      chips.push({ key: 'grupo', label: `Grupo: ${groupName}`, onRemove: () => setFilterGroup('all') });
    }
    if (filterSegment !== 'all') chips.push({ key: 'segmento', label: `Segmento: ${filterSegment}`, onRemove: () => setFilterSegment('all') });
    if (filterMonth !== 'all') {
      const [year, month] = filterMonth.split('-').map(Number);
      const formattedMonth = year && month
        ? new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        : filterMonth;
      chips.push({
        key: 'mes',
        label: `Mês: ${formattedMonth.charAt(0).toUpperCase()}${formattedMonth.slice(1)}`,
        onRemove: () => setFilterMonth('all'),
      });
    }
    return chips;
  }, [economicGroups, filterGroup, filterMonth, filterRep, filterSegment, filterStatus, setFilterGroup, setFilterMonth, setFilterRep, setFilterSegment, setFilterStatus]);

  const dupSourceClientId = useMemo(() => {
    if (!dupOrderId) return null;
    const order = orders.find(o => o.id === dupOrderId);
    if (order?.client_id) return order.client_id;

    const normalizedOrderName = (order?.client_name || '').trim().toLowerCase();
    const normalizedOrderCnpj = (order?.client_cnpj || '').replace(/\D/g, '');

    // Prefer CNPJ match (more reliable), fall back to name match.
    const matchedClient =
      (normalizedOrderCnpj && clientByCnpj.get(normalizedOrderCnpj)) ||
      (normalizedOrderName.length > 0 && clientByName[normalizedOrderName]) ||
      null;

    return matchedClient?.id ?? null;
  }, [dupOrderId, orders, clientByCnpj, clientByName]);

  // IDs de clientes que já receberam cópia deste PV (parent_order_id liga ao
  // PV origem). Pedido user 20/05/2026: "duplicar deve desconsiderar lojas do
  // grupo que já foi copiado daquele pedido". Considera também o cliente da
  // ÚLTIMA cópia do encadeamento (ex: A duplica pra B, depois abre B e dup
  // pra C — quero excluir A e B da lista).
  const alreadyCopiedClientIds = useMemo<Set<string>>(() => {
    if (!dupOrderId) return new Set();
    const ids = new Set<string>();
    // PVs filhos: parent_order_id = dupOrderId
    for (const o of orders) {
      if ((o as any).parent_order_id === dupOrderId && o.client_id) {
        ids.add(o.client_id);
      }
    }
    return ids;
  }, [dupOrderId, orders]);

  const dupGroupClients = useMemo(() => {
    if (!dupGroupId) return [];
    return clients.filter(c =>
      c.economic_group_id === dupGroupId
      && c.active
      && c.id !== dupSourceClientId
      && !alreadyCopiedClientIds.has(c.id)
    );
  }, [dupGroupId, clients, dupSourceClientId, alreadyCopiedClientIds]);

  // Lojas do grupo que JÁ receberam cópia — pra mostrar como info contextual
  // no dialog (não bloqueia, só informa).
  const dupAlreadyCopiedStores = useMemo(() => {
    if (!dupGroupId) return [];
    return clients.filter(c =>
      c.economic_group_id === dupGroupId
      && c.active
      && alreadyCopiedClientIds.has(c.id)
    );
  }, [dupGroupId, clients, alreadyCopiedClientIds]);

  // Excluir desceu de window.prompt ("digite EXCLUIR <N>") para o mesmo
  // AlertDialog de Aprovar/Cancelar (decisão do dono, 07/08/2026).
  //
  // O prompt nasceu do incidente de mai/2026 — 7 PVs sumiram com um OK acidental
  // no window.confirm — e a lição continua válida: confirmação passiva não serve.
  // O que mudou é a CALIBRAGEM: exclusão aqui é soft-delete restaurável por
  // admin/gerente, enquanto aprovar em massa (que ia sem confirmação alguma)
  // dispara o pipeline produtivo. A fricção foi para onde o estrago é maior, e o
  // AlertDialog — ação destrutiva explícita, com a lista dos PVs à vista — é mais
  // forte que o confirm que causou o incidente.
  const handleBulkDelete = () => {
    const n = selectedIds.size;
    if (n === 0) return;
    setPendingConfirm({
      title: `Excluir ${n} pedido${n === 1 ? '' : 's'}?`,
      description: (
        <div className="space-y-2">
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
            {orders.filter(o => selectedIds.has(o.id)).slice(0, 5).map(o => (
              <div key={o.id}>{o.order_number} — {o.client_name || '—'}</div>
            ))}
            {n > 5 && <div className="text-muted-foreground">… e mais {n - 5}</div>}
          </div>
          <p className="text-muted-foreground">Os pedidos ficam ocultos e podem ser restaurados por admin ou gerente.</p>
        </div>
      ),
      actionLabel: `Excluir (${n})`,
      destructive: true,
      onConfirm: () => { void doBulkDelete(); },
    });
  };

  const doBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(id => deleteOrder.mutateAsync(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    setSelectedIds(new Set());
    if (failed === 0) {
      toast.success(`${ids.length} pedido(s) excluído(s) — restauráveis se preciso`);
    } else {
      toast.error(`${ids.length - failed} excluído(s), ${failed} falha(s). PVs com NF-e ativa não podem ser excluídos.`);
    }
  };

  const handleBulkStatusChange = async (status: string, viabilityConfirmed = false) => {
    if (!canEditPv) {
      toast.error('Você não tem permissão para alterar o status de pedidos de venda.');
      return;
    }
    const ids = Array.from(selectedIds);
    // Pré-check só se o status alvo é Aprovado/Em Produção (estados que
    // disparam o pipeline produtivo). Cancelar/Rascunho não precisam de
    // viabilidade — são ações de "desistir" ou "voltar atrás".
    if (status === 'Aprovado' || status === 'Em Produção') {
      const targets = filteredOrders.filter((o) => ids.includes(o.id));
      const infeasibleOrders = targets.filter((o) => {
        const min = minBillingMap.get(o.id);
        return min && o.delivery_deadline && o.delivery_deadline < min;
      });
      if (infeasibleOrders.length > 0 && !viabilityConfirmed) {
        setPendingConfirm({
          title: `${infeasibleOrders.length} pedido(s) com data inviável`,
          description: (
            <div className="space-y-3">
              <p>A produção não cabe no prazo informado para estes PVs:</p>
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
                {infeasibleOrders.slice(0, 5).map(order => (
                  <div key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs">
                    <span className="truncate font-mono font-semibold text-foreground">{order.order_number}</span>
                    <span className="font-mono tabular-nums">{formatDate(order.delivery_deadline)}</span>
                    <span className="font-mono tabular-nums text-destructive">mín. {formatDate(minBillingMap.get(order.id) || null)}</span>
                  </div>
                ))}
                {infeasibleOrders.length > 5 && (
                  <p className="pt-1 text-xs">... e mais {infeasibleOrders.length - 5}</p>
                )}
              </div>
              <p>Recomendado: ajuste as datas antes de mover para “{status}”.</p>
            </div>
          ),
          actionLabel: `Mover para ${status}`,
          onConfirm: () => handleBulkStatusChange(status, true),
        });
        return;
      }
    }
    // ⚠ EM SÉRIE, não Promise.allSettled. Promover N PVs em paralelo faz dois
    // pedidos que compartilham o mesmo material (napa, solado) disputarem a MESMA
    // linha de `products` ao mesmo tempo — deadlock ou débito perdido. É o mesmo
    // motivo pelo qual o motor de promoção percorre os itens em série lá dentro.
    // (requisito 2 de specs/pv-producao-performance-e-pendencias.md)
    const results: PromiseSettledResult<unknown>[] = [];
    for (const id of ids) {
      try {
        results.push({ status: 'fulfilled', value: await updateStatus.mutateAsync({ id, status }) });
      } catch (e) {
        results.push({ status: 'rejected', reason: e });
      }
    }
    const failed = results.filter(r => r.status === 'rejected').length;
    const readinessBlocked = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected'
        && result.reason instanceof SaleOrderReadinessBlockedError,
    ).length;
    const otherFailures = failed - readinessBlocked;
    const updated = ids.length - failed;
    setSelectedIds(new Set());
    if (failed === 0) {
      toast.success(`${ids.length} pedido(s) atualizado(s) para "${status}"`);
    } else {
      const summary = [`${updated} atualizado(s)`];
      if (readinessBlocked > 0) summary.push(`${readinessBlocked} aguardam correção`);
      if (otherFailures > 0) summary.push(`${otherFailures} falha(s)`);
      const message = `${summary.join(' · ')}.`;
      if (otherFailures > 0) toast.error(message);
      else toast.warning(message);
    }
  };

  // Generate next 6 months for bulk week/month change
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return months;
  }, []);

  const [bulkMonth, setBulkMonth] = useState<string>('');
  const [bulkWeek, setBulkWeek] = useState<string>('');

  const bulkWeekOptions = useMemo(() => {
    if (!bulkMonth) return [] as { value: string; label: string }[];
    const [year, month] = bulkMonth.split('-').map(Number);
    const weeks: { value: string; label: string }[] = [];
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const weekStart = new Date(firstDay);
    const dayOfWeek = weekStart.getDay();
    if (dayOfWeek !== 1) weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
    let weekNum = 1;
    while (weekStart <= lastDay) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 4);
      weeks.push({
        value: `S${weekNum}`,
        label: `Semana ${weekNum} (${weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
      });
      weekStart.setDate(weekStart.getDate() + 7);
      weekNum++;
    }
    return weeks;
  }, [bulkMonth]);

  const handleBulkUpdateDelivery = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkMonth && !bulkWeek) {
      toast.info('Selecione mês e/ou semana para aplicar.');
      return;
    }
    const updates: any = {};
    if (bulkMonth) {
      updates.delivery_month = bulkMonth;
    }
    if (bulkWeek) {
      updates.delivery_week = bulkWeek;
    }
    
    // Sync billing_week for production wave engine
    if (bulkMonth && bulkWeek) {
      updates.billing_week = `${bulkMonth}-${bulkWeek}`;
    } else if (bulkWeek) {
      updates.billing_week = bulkWeek;
    } else if (bulkMonth) {
      // Month-only update: clear billing_week to prevent stale month-week mismatch
      // (e.g., billing_week="2026-04-S2" while delivery_month="2026-05"). The wave
      // engine falls back to delivery_month when billing_week is null.
      updates.billing_week = null;
    }

    // Only allow editing delivery dates for PVs in editable statuses.
    // Faturado/Expedido PVs have NF-e issued against the old delivery date;
    // Cancelado/Concluído PVs should be immutable.
    const PROTECTED_STATUSES = ['Faturado', 'Finalizado s/ NF', 'Expedido', 'Cancelado', 'Concluído'];
    const editableIds = orders
      .filter(o => selectedIds.has(o.id) && !PROTECTED_STATUSES.includes(o.status))
      .map(o => o.id);
    const skipped = selectedIds.size - editableIds.length;
    if (skipped > 0) toast.info(`${skipped} pedido(s) ignorado(s) — status não permite edição de entrega.`);
    if (editableIds.length === 0) return;

    // Um único PATCH direto não tinha expected_version, receipt nem
    // rematerialização de PV ativo. O lote é intencionalmente serial: cada PV
    // passa pelo mesmo command boundary da edição individual e falha isolado.
    let updatedCount = 0;
    const failures: string[] = [];
    for (const orderId of editableIds) {
      try {
        const [{ data: header, error: headerError }, { data: items, error: itemsError }] = await Promise.all([
          supabase.from('sale_orders').select('*').eq('id', orderId).single(),
          supabase.from('sale_order_items').select('*').eq('sale_order_id', orderId).order('created_at'),
        ]);
        if (headerError || !header) throw headerError || new Error('PV não encontrado');
        if (itemsError) throw itemsError;
        if (!items?.length) throw new Error('PV sem itens não pode ser atualizado');
        if (PROTECTED_STATUSES.includes(header.status)) {
          throw new Error(`status mudou para ${header.status}`);
        }

        const expectedOrderVersion = Number(
          (header as unknown as { order_version?: number | null }).order_version,
        ) || 0;
        const preflight = await preflightSaleOrderCommand({
          saleOrderId: orderId,
          command: 'update',
          expectedOrderVersion,
        });
        if (!preflight.ready) throw new SaleOrderReadinessBlockedError(preflight);

        await executeSaleOrderCommand({
          saleOrderId: orderId,
          command: 'update',
          expectedOrderVersion,
          idempotencyKey: `pv:${orderId}:bulk-delivery:${crypto.randomUUID()}`,
          payload: {
            header: { ...header, ...updates },
            items,
            teardown_op_ids: [],
            cancel_op_ids: [],
          },
        });
        updatedCount += 1;
      } catch (error) {
        const label = orders.find((order) => order.id === orderId)?.order_number || orderId.slice(0, 8);
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      toast.warning(`${failures.length} pedido(s) não foram atualizados.`, {
        description: failures.slice(0, 3).join('\n'),
        duration: 12000,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
    if (updatedCount > 0) toast.success(`${updatedCount} pedido(s) atualizado(s)`);
    setBulkMonth('');
    setBulkWeek('');
    setSelectedIds(new Set());
  };

  const handleBulkPrint = async () => {
    if (selectedIds.size === 0) return;
    const selectedOrders = orders.filter(o => selectedIds.has(o.id));
    const allHtmlParts: string[] = [];
    // Busca a identidade da empresa 1× e reaproveita em todos os PVs do lote.
    const company = await fetchCompanySettings();
    for (const order of selectedOrders) {
      allHtmlParts.push(await buildSaleOrderHtmlWithData(order, company));
    }
    const combinedHtml = allHtmlParts.join('<div style="page-break-before:always"></div>');
    printHtml(`Pedidos de Venda (${selectedOrders.length})`, combinedHtml);
  };

  // Aprovar e cancelar delegam ao mesmo fluxo do diálogo de status para não
  // contornar guards de viabilidade nem o tratamento parcial de falhas.
  // Fricção invertida (decisão do dono, 07/08/2026). Aprovar e Cancelar em massa
  // iam em 1 CLIQUE, enquanto Excluir — que é soft-delete restaurável — exigia
  // digitar uma frase. A justificativa certa é MAGNITUDE DE EFEITO COLATERAL, não
  // reversibilidade: aprovar dispara o pipeline produtivo (OPs, reserva/débito de
  // material, contas a receber), e desfazer isso é muito mais caro do que
  // restaurar um PV oculto.
  const confirmBulkStatus = (status: string, verbo: string, extra?: string, destructive = false) => () => {
    const n = selectedIds.size;
    if (n === 0) return;
    setPendingConfirm({
      title: `${verbo} ${n} pedido${n === 1 ? '' : 's'}?`,
      description: (
        <div className="space-y-2">
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
            {orders.filter(o => selectedIds.has(o.id)).slice(0, 5).map(o => (
              <div key={o.id}>{o.order_number} — {o.client_name || '—'}</div>
            ))}
            {n > 5 && <div className="text-muted-foreground">… e mais {n - 5}</div>}
          </div>
          {extra && <p className="text-muted-foreground">{extra}</p>}
        </div>
      ),
      actionLabel: `${verbo} (${n})`,
      destructive,
      onConfirm: () => { void handleBulkStatusChange(status); },
    });
  };

  const handleBulkApprove = confirmBulkStatus(
    'Aprovado', 'Aprovar',
    'Gera as ordens de produção, reserva/debita material e cria as contas a receber.',
  );
  const handleBulkCancel = confirmBulkStatus(
    'Cancelado', 'Cancelar',
    'Libera as reservas de material dos pedidos cancelados.',
    true,
  );
  const handleBulkExport = () => {
    const list = selectedIds.size > 0 ? filteredOrders.filter(o => selectedIds.has(o.id)) : filteredOrders;
    handleExportSaleOrdersExcel(list);
  };

  const handleBulkConsumption = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    void queryClient.prefetchQuery({
      queryKey: pvConsumptionQueryKey(ids),
      queryFn: () => loadPvConsumption(ids),
      staleTime: PV_CONSUMPTION_STALE_MS,
    });
    navigate(`/sales?view=consumo&ids=${ids.join(',')}`);
  };

  const handleBulkPurchaseOrders = () => {
    const selected = orders.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) return;
    setPoGenTarget({ ids: selected.map(o => o.id), numbers: selected.map(o => o.order_number) });
  };

  const handleBulkLabels = () => {
    if (selectedIds.size === 0) return;
    // A Central é a fonte canônica: exclui OPs canceladas/rascunhos, respeita
    // embalagem Colméia e separa ativas, impressas e finalizadas. O gerador
    // legado desta página consultava TODAS as OPs dos PVs e podia reimprimir
    // canceladas (PV-00162: 2.124 etiquetas indevidas em 25/08/2026).
    const params = new URLSearchParams();
    for (const id of selectedIds) params.append('sale_order', id);
    navigate(`/label-system?${params.toString()}`);
  };

  /** Abre BulkNfeDialog com os PVs selecionados.
   * mode='preview': só mostra previews lado a lado.
   * mode='emit': preview + botão grande de emitir todas em sequência. */
  const openBulkNfe = (mode: 'preview' | 'emit') => {
    if (selectedIds.size === 0) {
      toast.info('Selecione pelo menos um pedido.');
      return;
    }
    setBulkNfeMode(mode);
    setBulkNfeOpen(true);
  };

  const bulkNfeOrders = useMemo(() => {
    return orders.filter(o => selectedIds.has(o.id)).map(o => ({
      id: o.id,
      order_number: o.order_number,
      client_name: o.client_name,
    }));
  }, [orders, selectedIds]);

  const clearFilters = () => {
    setFilterStatus('all');
    setFilterRep('all');
    setFilterGroup('all');
    setFilterSegment('all');
    setFilterMonth('all');
    setSearchTerm('');
  };

  const openDupDialog = (orderId: string) => {
    setDupOrderId(orderId);
    setDupGroupId('');
    setDupSelectedClients([]);
    setDupClientSearch('');
    setDupDialog(true);
  };

  const handleDuplicate = async () => {
    if (!dupOrderId || dupSelectedClients.length === 0) return;
    const order = orders.find(o => o.id === dupOrderId);
    if (!order) return;
    const { data: orderItems, error: itemsFetchError } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', dupOrderId);
    if (itemsFetchError) {
      toast.error(`Erro ao ler itens do pedido original: ${itemsFetchError.message}`);
      return;
    }
    if (!orderItems || orderItems.length === 0) {
      toast.error('O pedido original não possui itens — duplicação cancelada.');
      return;
    }

    // Validate material_variant_id references before copying: variants may have been
    // deactivated or deleted since the original order was placed. Copying a stale ID
    // would silently block NF-e emission (emit-nfe returns 400 for inactive variants).
    const variantIdsInOrder = [...new Set(
      orderItems.map(i => (i as any).material_variant_id).filter(Boolean)
    )] as string[];
    let activeVariantIds = new Set<string>();
    if (variantIdsInOrder.length > 0) {
      const { data: activeVariants } = await (supabase as any)
        .from('reference_material_variants')
        .select('id')
        .in('id', variantIdsInOrder)
        .eq('active', true);
      activeVariantIds = new Set((activeVariants || []).map((v: any) => v.id));
      const staleCount = variantIdsInOrder.filter(id => !activeVariantIds.has(id)).length;
      if (staleCount > 0) {
        toast.warning(`${staleCount} variação(ões) de material inativa(s) — o campo será limpo nos itens copiados. Revise antes de faturar.`);
      }
    }

    let successCount = 0;
    const failures: string[] = [];
    for (const clientId of dupSelectedClients) {
      const client = clients.find(c => c.id === clientId);
      if (!client) continue;
      const newOrder: SaleOrderFormData = { client_name: client.razao_social, client_cnpj: client.cnpj || '', client_contact: client.contato || '', client_order_number: '', representative: order.representative || '', payment_condition: order.payment_condition || '', delivery_deadline: order.delivery_deadline || '', delivery_week: order.delivery_week || '', delivery_month: order.delivery_month || '', notes: order.notes || '', status: 'Rascunho', nfe: '', remessa: '', is_factoring: false, factoring_config_id: null as any, packaging_mode: (order.packaging_mode || 'individual_amarrado') as PackagingMode };
      const newItems: SaleOrderItemFormData[] = (orderItems || []).map(i => {
        const vid = (i as any).material_variant_id;
        return {
          reference_id: i.reference_id,
          color: i.color || '',
          grade: (i.grade as Record<string, number>) || {},
          unit_price: Number(i.unit_price) || 0,
          quantity: Number(i.quantity) || 0,
          fichas: (i as any).fichas || 1,
          strap_colors: (i.strap_colors as any[]) || [],
          material_variant_id: (vid && activeVariantIds.has(vid)) ? vid : null,
        };
      });
      // Idempotência: 1 UUID por cliente/submit, gerado ANTES do mutate —
      // se houver retry do mesmo submit, reusa o id e o UNIQUE do banco
      // (sale_orders.client_request_id) impede duplicar o PV copiado.
      const dupRequestId = crypto.randomUUID();
      try {
        // parent_order_id liga a cópia ao PV origem — permite filtrar
        // "lojas já copiadas" no próximo dialog de duplicação (pedido user
        // 20/05/2026: "tudo que duplicar deve desconsiderar lojas do grupo
        // que já foi copiado daquele pedido").
        await createOrder.mutateAsync({ order: newOrder, items: newItems, client_id: client.id, parent_order_id: dupOrderId, client_request_id: dupRequestId });
        successCount++;
      } catch (err: any) {
        const msg = err?.message || 'erro desconhecido';
        failures.push(`${client.razao_social}: ${msg}`);
      }
    }
    if (successCount > 0) toast.success(`${successCount} pedido(s) duplicado(s)!`);
    if (failures.length > 0) {
      toast.error(`${failures.length} duplicação(ões) falharam`, { description: failures.slice(0, 3).join(' | ') });
    }
    if (failures.length === 0) setDupDialog(false);
  };

  const toggleDupClient = (clientId: string) => setDupSelectedClients(prev => prev.includes(clientId) ? prev.filter(id => id !== clientId) : [...prev, clientId]);
  const toggleAllDupClients = () => {
    if (dupSelectedClients.length === dupGroupClients.length) setDupSelectedClients([]);
    else setDupSelectedClients(dupGroupClients.map(c => c.id));
  };

  // Restaura o detalhe a partir do ?pv= (F5, link colado, aba nova).
  //
  // Espera `orders` carregar: com a lista vazia o find falharia e o param seria
  // apagado antes de ter chance de resolver. Se o id não existir depois de
  // carregada — PV excluído, link velho, id digitado errado —, o param é limpo em
  // vez de ficar preso na URL prometendo um pedido que não abre.
  //
  // A guarda `detailDialogOpen` impede reabrir depois que o usuário fechou: o
  // fechamento limpa o param, mas sem ela um re-render entre as duas coisas
  // reabriria o dialog sozinho.
  const pvParam = searchParams.get('pv');
  useEffect(() => {
    // ⚠ Sem guarda por `selectedOrder?.id === pvParam`. Ela parecia sensata e
    // quebrava o caso principal: `selectedOrder` NUNCA é limpo ao fechar o
    // detalhe, então reabrir o mesmo PV por link (colar a URL de novo, voltar
    // pela aba) casava a guarda e o diálogo não abria mais. `detailDialogOpen`
    // sozinho já impede o efeito de reabrir o que o usuário acabou de fechar.
    if (!pvParam || isLoading || detailDialogOpen) return;
    const target = orders.find((o: any) => o.id === pvParam);
    if (!target) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('pv');
        return next;
      }, { replace: true });
      return;
    }
    void openOrderDetails(target);
    // openOrderDetails é recriada a cada render (não é useCallback); incluí-la
    // aqui dispararia o efeito em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvParam, isLoading, orders, detailDialogOpen]);

  const prefetchPvConsumption = (id: string) => {
    void queryClient.prefetchQuery({
      queryKey: pvConsumptionQueryKey([id]),
      queryFn: () => loadPvConsumption([id]),
      staleTime: PV_CONSUMPTION_STALE_MS,
    });
  };

  const openOrderDetails = async (order: any) => {
    setSelectedOrder(order);
    setDetailDialogOpen(true);
    // Prefetch do consumo + chunk do diálogo enquanto o detalhe ainda carrega
    // os itens — o clique em "Consumo de materiais" reaproveita o cache.
    prefetchPvConsumption(order.id);
    void import('@/components/sale-orders/OrderConsumptionDialog');
    // ?pv= na URL: o detalhe passa a sobreviver ao F5, abrir em duas abas e ser
    // mandado por link — antes ele só existia em estado local.
    //
    // ⚠ `replace: true`, NÃO push. Uma versão anterior usava push alegando que
    // "o Voltar do browser fecha o dialog" — não fecha: `detailDialogOpen` é
    // estado local e nada o observa quando o param some da URL. O push só
    // empilhava uma entrada morta por PV aberto (e duas, quando a própria URL
    // era a origem), fazendo o primeiro Voltar não fazer nada.
    //
    // ⚠ O NÚMERO do PV continua sendo <button>, não <a> (decisão do dono,
    // 07/08/2026): Ctrl+clique na linha já é o gesto de SELEÇÃO em massa, e um
    // link roubaria esse gesto. A endereçabilidade vem daqui, sem custo de gesto.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('pv', order.id);
      return next;
    }, { replace: true });
    setLoadingOrderItems(true);
    const [itemsResult, productionOrdersResult] = await Promise.all([
      supabase.from('sale_order_items').select('*, technical_sheets(name, code, image_url, images)').eq('sale_order_id', order.id).order('created_at', { ascending: true }),
      supabase.from('orders').select('id, sale_order_item_id, material_status, notes').eq('sale_order_id', order.id),
    ]);
    const { data: items, error } = itemsResult;

    if (error || productionOrdersResult.error) {
      toast.error(`Erro: ${(error || productionOrdersResult.error)?.message}`);
      setSelectedOrderItems([]);
    } else {
      // Fetch color variant images
      const refIds = [...new Set((items || []).map(i => i.reference_id))];
      const { data: colorVariants } = await supabase.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds);
      
      const mappedItems = (items || []).map(item => {
        const variant = colorVariants?.find(v => v.reference_id === item.reference_id && v.color === item.color);
        const productionOrders = (productionOrdersResult.data || []).filter(op => op.sale_order_item_id === item.id);
        return { ...item, variant_image_url: variant?.image_url || '', productionOrders };
      });
      // Sort by referência (código interno só como fallback) then by color.
      mappedItems.sort((a: any, b: any) => {
        const refA = (a.technical_sheets?.name || a.technical_sheets?.code || a.reference_id || '').toString();
        const refB = (b.technical_sheets?.name || b.technical_sheets?.code || b.reference_id || '').toString();
        const cmp = refA.localeCompare(refB, 'pt-BR', { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.color || '').localeCompare(b.color || '', 'pt-BR', { sensitivity: 'base' });
      });
      setSelectedOrderItems(mappedItems);
    }
    setLoadingOrderItems(false);
  };

  const handleBulkGenerateOPs = async (viabilityConfirmed = false) => {
    if (!canEditPv) {
      toast.error('Você não tem permissão para aprovar pedidos de venda.');
      return;
    }
    if (pendingOrders.length === 0) { toast.info('Nenhum rascunho para aprovar.'); return; }

    // Pré-check de viabilidade: bloqueia approval em massa de PVs com
    // delivery_deadline anterior à data mínima viável (capacidade dos
    // 9 setores + buffer + supplier descontando POs pending). Pré-2026-06
    // o sistema aprovava sem checar — geravam OPs que entravam em ondas
    // com purchase_deadline já vencido.
    const infeasibleOrders = pendingOrders.filter((o) => {
      const min = minBillingMap.get(o.id);
      return min && o.delivery_deadline && o.delivery_deadline < min;
    });
    if (infeasibleOrders.length > 0 && !viabilityConfirmed) {
      setPendingConfirm({
        title: `${infeasibleOrders.length} pedido(s) com data inviável`,
        description: (
          <div className="space-y-3">
            <p>A geração de OPs aprovará pedidos cujo prazo não comporta a produção:</p>
            <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
              {infeasibleOrders.slice(0, 5).map(order => (
                <div key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs">
                  <span className="truncate font-mono font-semibold text-foreground">{order.order_number}</span>
                  <span className="font-mono tabular-nums">{formatDate(order.delivery_deadline)}</span>
                  <span className="font-mono tabular-nums text-destructive">mín. {formatDate(minBillingMap.get(order.id) || null)}</span>
                </div>
              ))}
              {infeasibleOrders.length > 5 && (
                <p className="pt-1 text-xs">... e mais {infeasibleOrders.length - 5}</p>
              )}
            </div>
            <p>Recomendado: ajuste as datas antes de continuar.</p>
          </div>
        ),
        actionLabel: 'Aprovar e gerar OPs',
        onConfirm: () => handleBulkGenerateOPs(true),
      });
      return;
    }

    setGeneratingOPs(true);
    let ordersProcessed = 0;
    let opsCreated = 0;
    let readinessBlockedCount = 0;
    const errors: string[] = [];

    // A aprovação em lote é apenas coordenação de chamadas seriais ao mesmo
    // comando canônico usado na linha individual. Status, OPs, plano material,
    // reservas, recibo e efeitos financeiros pertencem ao SaleOrderCommand.
    try {
      for (const order of pendingOrders) {
        try {
          const result = await updateStatus.mutateAsync({
            id: order.id,
            status: 'Aprovado',
          });
          ordersProcessed++;
          opsCreated += Number(result?.ops_criadas) || 0;
        } catch (error: unknown) {
          if (error instanceof SaleOrderReadinessBlockedError) {
            readinessBlockedCount += 1;
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${order.order_number}: ${message}`);
        }
      }
    } finally {
      setGeneratingOPs(false);
    }

    if (ordersProcessed > 0) {
      toast.success(`${ordersProcessed} pedido(s) aprovado(s), ${opsCreated} OP(s) gerada(s) pelo comando canônico.`);
    }
    if (readinessBlockedCount > 0 || errors.length > 0) {
      const summary: string[] = [];
      if (readinessBlockedCount > 0) summary.push(`${readinessBlockedCount} aguardam correção`);
      if (errors.length > 0) summary.push(`${errors.length} outra(s) falha(s)`);
      toast.warning(summary.join(' · '), errors.length > 0 ? {
        description: errors.slice(0, 3).join('; '),
      } : undefined);
    }
  };

  const handleExportSaleOrdersExcel = async (ordersToExport: typeof filteredOrders) => {
    if (ordersToExport.length === 0) { toast.error('Nenhum pedido para exportar.'); return; }

    // Build reference lookup: sale_order_id -> list of "Referência · código interno · cor"
    const refsByOrder: Record<string, string[]> = {};
    (allSaleItems || []).forEach((it: any) => {
      const id = it.sale_order_id;
      if (!id) return;
      if (!refsByOrder[id]) refsByOrder[id] = [];
      const ref = refById[it.reference_id];
      const label = [ref?.name, ref?.code && ref.code !== ref.name ? `Cód. interno: ${ref.code}` : ''].filter(Boolean).join(' · ') || it.reference_id;
      const entry = it.color ? `${label} (${it.color})` : label;
      if (!refsByOrder[id].includes(entry)) refsByOrder[id].push(entry);
    });

    // Economic group lookup
    const groupById: Record<string, string> = {};
    economicGroups.forEach((g: any) => { groupById[g.id] = g.name; });

    // Sort by economic group name, then by client name (keeps stores from same group together)
    const sorted = [...ordersToExport].sort((a, b) => {
      const aGroupId = clientGroupMap[a.client_name] || '';
      const bGroupId = clientGroupMap[b.client_name] || '';
      const aGroup = groupById[aGroupId] || '';
      const bGroup = groupById[bGroupId] || '';
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup, 'pt-BR');
      return (a.client_name || '').localeCompare(b.client_name || '', 'pt-BR');
    });

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Pedidos de Venda');
    ws.columns = [
      { header: 'Grupo Econômico', key: 'grupo', width: 25 },
      { header: 'Razão Social', key: 'razao_social', width: 32 },
      { header: 'Nº Pedido Sistema', key: 'order_number', width: 18 },
      { header: 'Nº Pedido Cliente', key: 'client_order_number', width: 18 },
      { header: 'Cidade/UF', key: 'cidade', width: 22 },
      { header: 'Valor Total', key: 'total', width: 16 },
      { header: 'Qtd Pares', key: 'pares', width: 12 },
      { header: 'Referências', key: 'referencias', width: 50 },
      { header: 'Semana Faturamento', key: 'semana', width: 20 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Representante', key: 'representante', width: 22 },
    ];

    // Header style
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    sorted.forEach(order => {
      const client = clientByName[(order.client_name || '').toLowerCase()];
      const groupId = clientGroupMap[order.client_name] || '';
      const groupName = groupById[groupId] || '';
      const cidade = client ? [client.cidade, (client as any).estado].filter(Boolean).join('/') : '';
      const semana = (order as any).billing_week || order.delivery_week || '';
      ws.addRow({
        grupo: groupName,
        razao_social: order.client_name || '',
        order_number: order.order_number || '',
        client_order_number: order.client_order_number || '',
        cidade,
        total: Number(order.total || 0),
        pares: pairsBySaleOrder[order.id] || 0,
        referencias: (refsByOrder[order.id] || []).join(', '),
        semana,
        status: order.status || '',
        representante: order.representative || '',
      });
    });

    // Format currency column
    ws.getColumn('total').numFmt = '"R$"#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos_venda_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(`Excel gerado com ${sorted.length} pedido(s)!`);
  };

  if (isLoading) {
    return (
      <div className="w-full space-y-6 page-enter">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · PV"
          title="Pedidos de Venda"
          description="Gestão comercial e geração de ordens de produção"
        />
        <SalesOperationsRailSkeleton />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="w-full space-y-6 page-enter">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · PV"
          title="Pedidos de Venda"
          description="Gestão comercial e geração de ordens de produção"
        />
        <EmptyState
          icon={AlertTriangle}
          title="Erro ao carregar pedidos"
          description={error?.message || 'Tente recarregar a página.'}
          action={<Button variant="outline" onClick={() => window.location.reload()}>Recarregar</Button>}
        />
      </div>
    );
  }

  // Aba de Pendências — mesma troca de visão por URL que o `?view=consumo` já usa,
  // sem rota nova (requisito 13 de specs/pv-producao-performance-e-pendencias.md).
  if (isPendenciasView) {
    return (
      <div className="w-full space-y-6 page-enter">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · PV"
          title="Pendências de lançamento"
          description="Itens que não viraram OP, material que faltou e prazos inviáveis"
          actions={
            <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => navigate('/sales')}>
              <ClipboardList className="h-4 w-4" />
              Voltar aos pedidos
            </Button>
          }
        />
        <PendenciasView />
      </div>
    );
  }

  // Consumo de Materiais — PÁGINA multi-PV (`?ids=`).
  //
  // 1 PV abre no diálogo (OrderConsumptionDialog) pra não perder o detalhe
  // nem o `?pv=` da URL. Esta página continua no lote (N PVs, URL
  // compartilhável, F5). As duas usam `loadPvConsumption` + o mesmo motor.
  if (isConsumptionView) {
    return (
      <>
        <div className="w-full space-y-6 page-enter">
          <EditorialPageHeader
            sectionLabel="COMERCIAL · PV"
            title="Consumo de Materiais"
            description={
              consumptionViewOrders.length === 1
                ? `Pedido ${consumptionViewOrders[0].order_number} — o que comprar, quanto falta e a grade do solado`
                : 'Demanda somada dos pedidos selecionados — o que comprar e quanto falta'
            }
            meta={
              consumptionViewOrders.length > 1
                ? <><strong>{consumptionViewOrders.length}</strong> PEDIDOS NO ESCOPO</>
                : undefined
            }
            actions={
              <Button variant="outline" size="sm" className="h-9 gap-2" onClick={closeConsumptionView}>
                <ClipboardList className="h-4 w-4" />
                Voltar aos pedidos
              </Button>
            }
          />
          {consumptionViewIds.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum pedido no escopo"
              description="Volte à lista e selecione os pedidos para ver o consumo."
              action={<Button variant="outline" size="sm" onClick={closeConsumptionView}>Selecionar pedidos</Button>}
            />
          ) : (
            <SummaryConsumptionPanel
              saleOrderIds={consumptionViewIds}
              onGerarOC={canBuy ? () => setPoGenTarget({
                ids: consumptionViewIds,
                numbers: consumptionViewOrders.map((o: any) => o.order_number),
              }) : undefined}
            />
          )}
        </div>

        {poGenTarget && (
          <Suspense fallback={null}>
            <GeneratePurchaseOrdersDialog
              open={!!poGenTarget}
              onOpenChange={(v) => { if (!v) setPoGenTarget(null); }}
              pvIds={poGenTarget.ids}
              pvNumbers={poGenTarget.numbers}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <div className="w-full space-y-6 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · PV"
          title="Pedidos de Venda"
          description="Gestão comercial e geração de ordens de produção"
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2"
                onClick={() => navigate('/sales?view=pendencias')}
                title="Falhas de lançamento, baixa parcial e datas inviáveis"
              >
                <AlertTriangle className="h-4 w-4" />
                <span className="hidden sm:inline">Pendências</span>
              </Button>
              {perm.canCreate && (
                <Button size="sm" onClick={() => navigate('/sales/new')} className="h-9 gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Novo Pedido</span>
                </Button>
              )}
              {canEditPv && <Button
                variant="outline"
                size="sm"
                // Confirmação com CONTAGEM antes de rodar. Esta é a ação mais cara
                // da tela — aprova rascunhos, gera OPs, debita estoque e cria
                // contas a receber — e ia em 1 clique, sem aviso. O escopo segue
                // sendo a base inteira (decisão do dono, 07/08/2026): ela ignora
                // aba, filtro e seleção de propósito, por ser rotina de fim de dia.
                // O que faltava era o usuário saber QUANTOS antes de disparar.
                onClick={() => {
                  if (pendingOrders.length === 0) { toast.info('Nenhum rascunho para aprovar.'); return; }
                  setPendingConfirm({
                    title: `Gerar OPs para ${pendingOrders.length} rascunho(s)?`,
                    description: (
                      <div className="space-y-2">
                        <p>Isto aprova <strong>todos</strong> os pedidos em Rascunho do sistema — não apenas os da aba ou do filtro atual.</p>
                        <p className="text-muted-foreground">Gera as ordens de produção, reserva/debita material e cria as contas a receber.</p>
                      </div>
                    ),
                    actionLabel: `Gerar OPs (${pendingOrders.length})`,
                    onConfirm: () => { void handleBulkGenerateOPs(); },
                  });
                }}
                disabled={generatingOPs}
                className="h-9 gap-2"
                // "rascunho", não "pendente": pendingOrders filtra status === 'Rascunho',
                // e 'Pendente' é OUTRO status canônico — o rótulo antigo apontava
                // para o conjunto errado.
                title={pendingOrders.length > 0 ? `Aprovar ${pendingOrders.length} rascunho(s)` : 'Não há rascunhos para aprovar'}
              >
                {generatingOPs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Factory className="h-4 w-4" />}
                <span className="hidden sm:inline">Gerar OPs</span>
                {pendingOrders.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{pendingOrders.length}</Badge>
                )}
              </Button>}
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2"
                onClick={() => navigate('/label-system')}
                aria-label="Etiqueta Individual"
                title="Abrir a geração de etiquetas térmicas das caixas individuais"
              >
                <Barcode className="h-4 w-4" />
                <span className="hidden sm:inline">Etiqueta Individual</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2">
                    <DotsThree className="h-4 w-4" weight="bold" />
                    <span className="hidden sm:inline">Mais</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem onSelect={() => setImportClientsOpen(true)} className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar Clientes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { void handleExportSaleOrdersExcel(sortedOrders); }} className="gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    Exportar Excel
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={resyncOPs.isPending}
                        onSelect={() => setPendingConfirm({
                          title: 'Resincronizar OPs com as fichas?',
                          description: 'Cada OP ativa será revalidada e resincronizada em uma transação isolada. OPs com fato físico ou erro permanecem intactas; o histórico não é reescrito.',
                          actionLabel: 'Resincronizar',
                          onConfirm: () => resyncOPs.mutate(),
                        })}
                        className="gap-2"
                      >
                        {resyncOPs.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Resync Fichas
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        {/* Main tabs: Ativos vs Faturados */}
        <div className="flex items-center gap-1 overflow-x-auto border-b" role="tablist" aria-label="Situação dos pedidos">
          <button
            type="button"
            onClick={() => setMainTab('ativos')}
            role="tab"
            aria-selected={mainTab === 'ativos'}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2',
              mainTab === 'ativos'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Pedidos Ativos
            <Badge
              variant={searchTabCounts && searchTabCounts.ativos > 0 && mainTab !== 'ativos' ? 'default' : 'secondary'}
              title={searchTabCounts ? 'Resultados da busca nesta aba' : undefined}
              className="ml-2 h-5 px-1.5 text-xs"
            >
              {searchTabCounts ? searchTabCounts.ativos : activeCount}
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => setMainTab('faturados')}
            role="tab"
            aria-selected={mainTab === 'faturados'}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2',
              mainTab === 'faturados'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Faturados / Sem NF
            <Badge
              variant={searchTabCounts && searchTabCounts.faturados > 0 && mainTab !== 'faturados' ? 'default' : 'secondary'}
              title={searchTabCounts ? 'Resultados da busca nesta aba' : undefined}
              className="ml-2 h-5 px-1.5 text-xs"
            >
              {searchTabCounts ? searchTabCounts.faturados : billedCount}
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => setMainTab('cancelados')}
            role="tab"
            aria-selected={mainTab === 'cancelados'}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2',
              mainTab === 'cancelados'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Cancelados
            <Badge
              variant={searchTabCounts && searchTabCounts.cancelados > 0 && mainTab !== 'cancelados' ? 'default' : 'secondary'}
              title={searchTabCounts ? 'Resultados da busca nesta aba' : undefined}
              className="ml-2 h-5 px-1.5 text-xs"
            >
              {searchTabCounts ? searchTabCounts.cancelados : cancelledCount}
            </Badge>
          </button>
        </div>

        <SalesOperationsRail
          scopeLabel={currentScopeLabel}
          orderCount={kpis.count}
          pairs={totalPares}
          drafts={kpis.pending}
          approved={kpis.approved}
          inProduction={kpis.inProduction}
          deadlineRisk={deadlineRiskCount}
          total={canSeeFinancialValues ? formatCurrency(kpis.total) : undefined}
        />

        {/* Search & Filter Bar */}
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[16rem] flex-[1_1_32rem] max-w-2xl">
              <SmartSearch
                value={searchTerm}
                onChange={setSearchTerm}
                getSuggestions={searchSuggestions}
                placeholder="Buscar PV, cliente, ref… ou /grupo (ex: /lng)"
              />
            </div>
            <Button
              variant={showFilters || activeFiltersCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="gap-2 h-9"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge variant="default" className="ml-1 h-5 px-1.5 text-xs">{activeFiltersCount}</Badge>
              )}
            </Button>
            {!showFilters && activeFilterChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeFilterChips.map(chip => (
                  <Badge key={chip.key} variant="outline" className="h-7 gap-1 pl-2 pr-1 text-xs font-medium">
                    {chip.label}
                    <button
                      type="button"
                      onClick={chip.onRemove}
                      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`Remover filtro ${chip.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Limpar
              </Button>
            )}
            <span className="ml-auto hidden text-right text-[10px] uppercase tracking-wider text-muted-foreground lg:block">
              <strong className="font-mono text-xs text-foreground">{sortedOrders.length}</strong> PVs visíveis<br />
              <strong className="font-mono text-xs text-foreground">{totalPares.toLocaleString('pt-BR')}</strong> pares
            </span>
          </div>

          {/* Busca ATRAVESSA as abas (spec R5): mostra a contagem da aba atual
              e, quando há match em outra aba, um link clicável pra ela — nunca
              deixa um PV existente "invisível" pela aba selecionada. */}
          {searchTerm.trim() && searchTabCounts && (
            <p className="text-xs text-muted-foreground -mt-1">
              {filteredOrders.length} resultado{filteredOrders.length !== 1 ? 's' : ''} em{' '}
              <span className="font-medium text-foreground">{mainTab === 'faturados' ? 'Faturados / Sem NF' : mainTab === 'cancelados' ? 'Cancelados' : 'Pedidos Ativos'}</span>
              {(['ativos', 'faturados', 'cancelados'] as const)
                .filter(t => t !== mainTab && searchTabCounts[t] > 0)
                .map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMainTab(t)}
                    className="ml-2 underline underline-offset-2 text-primary hover:text-primary/80"
                  >
                    {t === 'ativos' ? 'Ativos' : t === 'faturados' ? 'Faturados / Sem NF' : 'Cancelados'} ({searchTabCounts[t]})
                  </button>
                ))}
              {searchTabCounts.ativos + searchTabCounts.faturados + searchTabCounts.cancelados === 0 && (
                <span className="ml-1">— nenhum resultado em nenhuma aba</span>
              )}
            </p>
          )}

          {/* Filter Row */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger aria-label="Filtrar por status" className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Representante</Label>
                <Select value={filterRep} onValueChange={setFilterRep}>
                  <SelectTrigger aria-label="Filtrar por representante" className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {uniqueReps.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Grupo Econômico</Label>
                <Select value={filterGroup} onValueChange={setFilterGroup}>
                  <SelectTrigger aria-label="Filtrar por grupo econômico" className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {economicGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Segmento</Label>
                <Select value={filterSegment} onValueChange={setFilterSegment}>
                  <SelectTrigger aria-label="Filtrar por segmento" className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="Adulto">Adulto</SelectItem>
                    <SelectItem value="Infantil">Infantil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Mês Fat.</Label>
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger aria-label="Filtrar por mês de faturamento" className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {uniqueMonths.map(m => {
                      const [y, mo] = m.split('-').map(Number);
                      const label = new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                      return <SelectItem key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        {filteredOrders.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={ShoppingCart}
              title={orders.length === 0 ? 'Nenhum pedido de venda' : searchTerm.trim() ? `Nenhum resultado para "${searchTerm.trim()}"` : 'Nenhum pedido encontrado'}
              description={orders.length === 0 ? 'Crie o primeiro pedido de venda.' : searchTerm.trim() ? 'A busca varre todas as abas — confira o termo ou limpe a busca.' : 'Nenhum pedido encontrado com os filtros atuais.'}
              action={
                searchTerm.trim()
                  ? <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>Limpar busca</Button>
                  : activeFiltersCount > 0 ? <Button variant="link" size="sm" onClick={clearFilters}>Limpar filtros</Button> : undefined
              }
            />
          </Panel>
        ) : (
          <>
          {!isMdUp && (
          <div className="space-y-2">
            {sortedOrders.map(order => {
              const pairs = pairsBySaleOrder[order.id] || 0;
              const minBilling = minBillingMap.get(order.id) || null;
              const isOverdue = !!(order.delivery_deadline && parseDateOnly(order.delivery_deadline) < new Date() && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado');
              const isInfeasible = !!(minBilling && order.delivery_deadline && order.delivery_deadline < minBilling && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado');
              return (
                <article
                  key={order.id}
                  className={cn(
                    'rounded-xl border bg-card p-4 shadow-sm transition-colors',
                    sel.isSelected(order.id) && 'border-primary bg-primary/5',
                    (isOverdue || isInfeasible) && 'border-l-4 border-l-destructive',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={sel.isSelected(order.id)}
                      onCheckedChange={() => sel.toggle(order.id)}
                      aria-label={`Selecionar pedido ${order.order_number}`}
                      className="mt-1"
                    />
                    <button type="button" onClick={() => openOrderDetails(order)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-primary">{order.order_number || '—'}</span>
                        <Badge variant="outline" className={cn('shrink-0 text-xs', STATUS_COLORS[order.status])}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[order.status])} />
                          {order.status}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">{order.client_name}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span><strong className="block font-mono text-sm text-foreground">{pairs.toLocaleString('pt-BR')}</strong>pares</span>
                        {canSeeFinancialValues && <span><strong className="block truncate font-mono text-sm text-foreground">{formatCurrency(Number(order.total))}</strong>total</span>}
                        <span className={cn('text-right', (isOverdue || isInfeasible) && 'font-semibold text-destructive')}><strong className="block text-sm text-foreground">{formatDate(order.delivery_deadline)}</strong>entrega</span>
                      </div>
                      {isInfeasible && minBilling && <p className="mt-2 text-xs font-semibold text-destructive">Data mínima viável: {formatDate(minBilling)}</p>}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" className="min-h-10 flex-1 gap-1.5" onMouseEnter={() => prefetchPvConsumption(order.id)} onClick={() => setConsumoDialog({ ids: [order.id], numbers: [order.order_number] })}>
                      <Package className="h-4 w-4" /> Consumo
                    </Button>
                    <Button variant="outline" size="sm" className="min-h-10 flex-1 gap-1.5" disabled={!canEditPv} onClick={() => navigate(`/sales/edit/${order.id}`)}>
                      <Pencil className="h-4 w-4" /> Editar
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          )}
          {isMdUp && (
          <div
            ref={sel.containerRef}
            onMouseDown={sel.onContainerMouseDown}
            data-marquee-container
            className="relative overflow-x-auto rounded-lg border border-border bg-card shadow-sm"
          >
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Selecionar todos os pedidos visíveis"
                    />
                  </TableHead>
                  <SortHead sk="order_number" sort={sort} onSort={toggleSort}>Nº Pedido</SortHead>
                  <TableHead>Nº Cliente</TableHead>
                  <SortHead sk="client_name" sort={sort} onSort={toggleSort}>Cliente</SortHead>
                  <TableHead>Cidade</TableHead>
                  {canSeeFinancialValues && <SortHead sk="total" sort={sort} onSort={toggleSort} align="right">Total</SortHead>}
                  <SortHead sk="status" sort={sort} onSort={toggleSort}>Status</SortHead>
                  <SortHead sk="pairs" sort={sort} onSort={toggleSort} align="right">Pares</SortHead>
                  <SortHead sk="delivery_deadline" sort={sort} onSort={toggleSort}>Entrega / Fat.</SortHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedOrders.map(order => {
                  const isSelected = sel.isSelected(order.id);
                  const isOverdue = order.delivery_deadline && parseDateOnly(order.delivery_deadline) < new Date() && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado';
                  const isInformal = (order as any).nfe_required === false;
                  // PV com NF-e emitida — guiado pela TABELA nfe_emitidas (fonte da
                  // verdade fiscal), não pelo status do PV. User pediu (19/05/2026)
                  // pra usar marcação real de NF: status pode estar inconsistente
                  // (PV faturado externamente, sync errado, etc), mas se existe
                  // registro de NF autorizada no banco, fica verde.
                  const hasEmittedNfe = nfeIssuedSaleOrderIds.has(order.id);
                  const minBilling = minBillingMap.get(order.id) || null;
                  const isInfeasible = !!(
                    minBilling && order.delivery_deadline && order.delivery_deadline < minBilling
                    && !TERMINAL_BILLED_STATUSES.includes(order.status)
                    && order.status !== 'Cancelado'
                  );
                  // Pedido com alguma referência infantil (shoe_category infantil/kids/
                  // criança/bebê). Marca com badge rosa-claro + ícone pra identificar
                  // de relance no meio dos pedidos adultos.
                  const isInfantil = !!segmentsBySaleOrder[order.id]?.has('Infantil');
                  return (
                    <TableRow
                      key={order.id}
                      data-marquee-item
                      data-marquee-id={order.id}
                      className={cn(
                        'group cursor-pointer border-l-4 border-l-transparent transition-colors',
                        isSelected ? 'border-l-primary bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/50',
                        (isOverdue || isInfeasible) && '!border-l-destructive',
                        isInformal && !isSelected && !(isOverdue || isInfeasible) && 'border-l-amber-500',
                        hasEmittedNfe && !isSelected && !(isOverdue || isInfeasible) && 'border-l-emerald-500',
                      )}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        // Ignora clicks em interativos — Select status, checkbox,
                        // botões da coluna Ações, etc. (idem comportamento anterior).
                        if (target.closest('button, a, input, [role="combobox"], [role="checkbox"], [data-radix-collection-item], [role="menuitem"]')) return;
                        // Modifier-aware select: Shift = range, Ctrl/Cmd = toggle,
                        // click normal abre o dialog de detalhes (preserva UX).
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                          sel.toggle(order.id, e);
                          return;
                        }
                        openOrderDetails(order);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => sel.toggle(order.id)} aria-label={`Selecionar pedido ${order.order_number}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openOrderDetails(order); }}
                              className="font-mono text-sm text-primary hover:underline font-bold text-left w-fit"
                            >
                              {order.order_number || '—'}
                            </button>
                            {hasEmittedNfe && (
                              <Badge variant="outline" className="h-4 px-1.5 text-xs uppercase font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
                                NF
                              </Badge>
                            )}
                            {isInformal && (
                              <Badge variant="outline" className="h-4 px-1.5 text-xs uppercase font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40">
                                Sem NF
                              </Badge>
                            )}
                            {isInfantil && (
                              <Badge variant="outline" className="h-4 pl-1 pr-1.5 text-xs uppercase font-bold bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/40 gap-0.5">
                                <Baby className="h-3 w-3" weight="fill" /> Infantil
                              </Badge>
                            )}
                            {(order as any).order_type && (order as any).order_type !== 'carteira' && ORDER_TYPE_LABELS[(order as any).order_type] && (
                              <Badge variant="outline" className="h-4 px-1.5 text-xs uppercase font-bold bg-primary/10 text-primary border-primary/30">
                                {ORDER_TYPE_LABELS[(order as any).order_type]}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground uppercase font-medium">{formatDate(order.created_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                        {order.client_order_number || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col max-w-[220px]">
                          <span className="font-semibold text-sm truncate">{order.client_name}</span>
                          <span className="text-xs text-muted-foreground truncate">{order.client_cnpj || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm truncate max-w-[120px]">
                            {(() => {
                              const client = clientByName[(order.client_name || '').toLowerCase()];
                              return client ? [client.cidade, client.estado].filter(Boolean).join('/') : '—';
                            })()}
                          </span>
                        </div>
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right tabular-nums">
                          <div className="flex flex-col items-end">
                            <span className="font-mono font-bold text-sm text-primary">{formatCurrency(Number(order.total))}</span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {/* Requisito 30: enquanto a promoção roda, o controle fica
                            desabilitado com indicador. Antes um duplo-clique
                            disparava DUAS orquestrações concorrentes sobre o mesmo
                            PV. Desabilita a coluna inteira, não só a linha: duas
                            promoções simultâneas disputam as mesmas linhas de estoque. */}
                        <Select value={order.status} disabled={!canEditPv || updateStatus.isPending} onValueChange={async (v) => {
                          try {
                            await updateStatus.mutateAsync({ id: order.id, status: v });
                          } catch {
                            // A mutation é a dona única do feedback: readiness abre
                            // a janela estruturada e os demais erros geram um toast.
                            // mutateAsync ainda rejeita depois do onError; engolir
                            // aqui evita duas mensagens para a mesma falha.
                          }
                        }}>
                          <SelectTrigger aria-label={`Status do pedido ${order.order_number}: ${order.status}. Alterar`} className="h-7 w-[130px] text-xs border-0 bg-transparent p-0 shadow-none hover:ring-1 hover:ring-border [&>svg]:hidden disabled:opacity-60">
                            <Badge variant="outline" className={`${STATUS_COLORS[order.status] || ''} text-xs gap-1`}>
                              {statusPendingId === order.id
                                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-label="Processando" />
                                : <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${STATUS_DOT[order.status]}`} />}
                              {order.status}
                              <CaretDown className="h-3 w-3 opacity-50" />
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {/* Só transições válidas pela state machine (+ o status
                                atual, pra a Select ter um valor selecionável). O `??`
                                é obrigatório: status legado fora de STATUS_OPTIONS
                                deixaria a lista vazia e a Select sem valor. */}
                            {(STATUS_TRANSITION_OPTIONS[order.status] ?? [order.status]).map(s => (
                              <SelectItem key={s} value={s}>
                                <span className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                                  {s}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-semibold tabular-nums">
                        {(pairsBySaleOrder[order.id] || 0).toLocaleString('pt-BR')}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-xs tabular-nums',
                          (isOverdue || isInfeasible) ? 'text-destructive font-semibold' : 'text-muted-foreground'
                        )}
                        title={
                          isInfeasible && minBilling
                            ? `DATA INVIÁVEL — mínima necessária: ${formatDate(minBilling)} (considera estoque, supplier lead time descontando POs em trânsito, e capacidade dos 9 setores).`
                            : isOverdue
                              ? 'Prazo de entrega já passou.'
                              : undefined
                        }
                      >
                        <div className="flex flex-col">
                          <span>
                            {formatDate(order.delivery_deadline)}
                            {(isOverdue || isInfeasible) && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 align-text-bottom" />}
                          </span>
                          {isInfeasible && minBilling && (
                            <span className="text-xs font-mono text-destructive font-bold">
                              MÍN: {formatDate(minBilling)}
                            </span>
                          )}
                          {!isInfeasible && (order.delivery_month || order.delivery_week) && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {[order.delivery_month, order.delivery_week].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerar pedido (PDF)" onClick={() => { void printSaleOrderPdf(order); }}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar por grupo" onClick={() => openDupDialog(order.id)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" disabled={!canEditPv} onClick={() => navigate(`/sales/edit/${order.id}`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Consumo de materiais" onMouseEnter={() => prefetchPvConsumption(order.id)} onClick={() => setConsumoDialog({ ids: [order.id], numbers: [order.order_number] })}>
                            <Package className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && order.status === 'Faturado' && (
                            <RevertInvoiceButton
                              saleOrderId={order.id}
                              orderNumber={order.order_number}
                              size="icon"
                            />
                          )}
                          {isAdmin && !TERMINAL_BILLED_STATUSES.includes(order.status) && order.status !== 'Cancelado' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                              title="Forçar Produção (admin)"
                              onClick={() => setPendingConfirm({
                                title: `Forçar produção do pedido ${order.order_number}?`,
                                description: 'Isso irá colocar o pedido em "Em Produção", criar OPs ausentes e gerar etapas. Apenas administradores podem executar.',
                                actionLabel: 'Forçar produção',
                                onConfirm: async () => {
                                try {
                                  const expectedVersion = Number(order.order_version);
                                  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
                                    throw new Error('Versão do PV indisponível. Recarregue a lista antes de promover.');
                                  }
                                  const requestId = crypto.randomUUID();
                                  const { data, error } = await supabase.rpc('force_sale_order_production_command' as never, {
                                    p_sale_order_id: order.id,
                                    p_expected_order_version: expectedVersion,
                                    p_client_request_id: requestId,
                                    p_override_id: null,
                                  } as never);
                                  if (error) throw error;
                                  const response = data as unknown as ForceProductionCommandResponse;
                                  if (!response?.ok) throw new Error(response?.error?.message || 'Promoção recusada pelo servidor.');
                                  const r = response.result || {};
                                  toast.success(`Produção forçada • ${r.created_ops ?? 0} OP(s) criada(s), ${r.updated_ops ?? 0} atualizada(s), ${r.created_stages ?? 0} etapa(s) geradas`);
                                  queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
                                  queryClient.invalidateQueries({ queryKey: ['orders'] });
                                  queryClient.invalidateQueries({ queryKey: ['order_stages'] });
                                } catch (err: any) {
                                  toast.error(`Erro ao forçar produção: ${err.message}`);
                                }
                                },
                              })}
                            >
                              <Zap className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {perm.canDelete && (
                          <DeleteConfirmButton
                            onConfirm={() => deleteOrder.mutate(order.id)}
                            title={`Excluir ${order.order_number}?`}
                            description={`O pedido fica oculto mas pode ser restaurado por admin/gerente. Pra apagar de vez (com estorno de estoque), use "Cancelar" ou contate o admin.`}
                            confirmTypedText={order.order_number}
                            size="h-7 w-7"
                            iconSize="h-3.5 w-3.5"
                          />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* Table Footer Summary */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/30 text-sm">
              <span className="text-muted-foreground">{filteredOrders.length} pedido(s){filteredOrders.length !== orders.length ? ` de ${orders.length}` : ''}</span>
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground">
                  Total: <span className="font-bold font-mono text-foreground">{formatCurrency(filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0))}</span>
                </span>
              </div>
            </div>
            {/* Retângulo visual do drag-marquee (renderizado dentro do
                container .relative pra coords absolutas funcionarem). */}
            <MarqueeOverlay rect={sel.marqueeRect} />
          </div>
          )}
          {!isMdUp && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">{filteredOrders.length} pedido(s){filteredOrders.length !== orders.length ? ` de ${orders.length}` : ''}</span>
              {canSeeFinancialValues && (
                <span className="text-muted-foreground">
                  Total: <span className="font-bold font-mono text-foreground">{formatCurrency(filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0))}</span>
                </span>
              )}
            </div>
          )}
          </>
        )}
      </div>

      {/* O header permanece estável; todo comando que depende da seleção nasce
          aqui, junto do contador que deixa explícito quais PVs serão afetados. */}
      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.count === 1 ? 'PV selecionado' : 'PVs selecionados'}
        actions={[
          ...(canEditPv ? [{ label: 'Aprovar', icon: <Check className="h-3.5 w-3.5" />, onClick: handleBulkApprove }] : []),
          ...(canBuy ? [{ label: 'Gerar OCs', icon: <ShoppingCart className="h-3.5 w-3.5" />, variant: 'outline' as const, onClick: handleBulkPurchaseOrders }] : []),
          { label: 'Emitir NF-e', icon: <Receipt className="h-3.5 w-3.5" />, onClick: () => openBulkNfe('emit') },
          { label: 'Etiqueta Individual', icon: <Barcode className="h-3.5 w-3.5" />, variant: 'outline' as const, onClick: handleBulkLabels },
          ...(canEditPv ? [{ label: 'Cancelar', icon: <X className="h-3.5 w-3.5" />, variant: 'destructive' as const, onClick: handleBulkCancel }] : []),
        ]}
        secondaryActions={[
          ...(canEditPv ? [{ label: 'Alterar Status', icon: <ListChecks className="h-3.5 w-3.5" />, variant: 'outline' as const, onClick: () => { setBulkStatusTarget(''); setBulkStatusOpen(true); } }] : []),
          { label: 'Pré-visualizar NF-e', icon: <Receipt className="h-3.5 w-3.5" />, variant: 'outline', onClick: () => openBulkNfe('preview') },
          { label: 'Consumo', icon: <BarChart3 className="h-3.5 w-3.5" />, variant: 'outline', onClick: handleBulkConsumption },
          { label: 'Visão Geral', icon: <LayoutDashboard className="h-3.5 w-3.5" />, variant: 'outline', onClick: () => setOverviewOpen(true) },
          { label: 'Imprimir Fichas', icon: <Printer className="h-3.5 w-3.5" />, variant: 'outline', onClick: handleBulkPrint },
          { label: 'Exportar Excel', icon: <Download className="h-3.5 w-3.5" />, variant: 'outline', onClick: handleBulkExport },
          ...(perm.canDelete ? [{ label: 'Excluir', icon: <Trash2 className="h-3.5 w-3.5" />, variant: 'destructive' as const, onClick: handleBulkDelete }] : []),
        ]}
      />

      {/* Preview + Emit NF-e em LOTE — accordion com 1 NF por PV */}
      {bulkNfeOpen && (
        <Suspense fallback={null}>
          <BulkNfeDialog
            open={bulkNfeOpen}
            onOpenChange={setBulkNfeOpen}
            saleOrders={bulkNfeOrders}
            mode={bulkNfeMode}
          />
        </Suspense>
      )}

      {/* Alterar Status em LOTE — select arbitrário do status alvo */}
      <Dialog open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Alterar status em lote
            </DialogTitle>
            <DialogDescription>
              {sel.count} pedido(s) selecionado(s) — escolha o status alvo.
              Cancelado/Rascunho não checam viabilidade; Aprovado/Em Produção
              alertam se houver datas inviáveis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 pt-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Status alvo</Label>
            <Select value={bulkStatusTarget} onValueChange={setBulkStatusTarget}>
              <SelectTrigger><SelectValue placeholder="Selecione o status" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s] || 'bg-muted'}`} />
                      {s}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-3">
            <Button variant="outline" onClick={() => setBulkStatusOpen(false)}>Cancelar</Button>
            <Button
              disabled={!bulkStatusTarget}
              onClick={async () => {
                setBulkStatusOpen(false);
                await handleBulkStatusChange(bulkStatusTarget);
                setBulkStatusTarget('');
              }}
            >
              Aplicar para {sel.count} PV(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IMPORT CLIENTS DIALOG */}
      {importClientsOpen && (
        <Suspense fallback={null}>
          <ImportClientsDialog open={importClientsOpen} onOpenChange={setImportClientsOpen} />
        </Suspense>
      )}

      {/* ORDER DETAILS DIALOG */}
      {/* Fechar o detalhe limpa o ?pv=. Fica no onOpenChange e não num useEffect
          de propósito: os outros pontos que fecham este dialog (Editar, ficha
          técnica) navegam para FORA de /sales logo em seguida, e mexer em
          searchParams durante essa transição é pedir aviso de setState em
          componente desmontado. Ali o param some junto com a rota. */}
      <Dialog
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open);
          if (!open) {
            setSearchParams(prev => {
              const next = new URLSearchParams(prev);
              next.delete('pv');
              return next;
            }, { replace: true });
          }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[1440px] max-h-[94vh] gap-0 overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-30 space-y-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
            <div className={cn(
              'border-b px-6 py-4 pr-12',
              STATUS_BAND[selectedOrder?.status || ''] || 'bg-muted/30'
            )}>
            <div className="flex items-start justify-between gap-4 gap-y-3 flex-wrap">
              <div className="min-w-0">
                <p className="eyebrow">Comercial · Pedido de Venda</p>
                <div className="flex items-center gap-2.5 flex-wrap mt-1">
                  <DialogTitle className="display text-3xl sm:text-4xl m-0 leading-none">{selectedOrder?.order_number || ''}</DialogTitle>
                  {selectedOrder && <Badge variant="outline" className={STATUS_COLORS[selectedOrder.status] || ''}><span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${STATUS_DOT[selectedOrder.status]}`} />{selectedOrder.status}</Badge>}
                  <PvOutdatedBadge saleOrderId={selectedOrder?.id || null} />
                  {/* Badge "Picking individual realizado" — exclui o PV do Picking Semanal. */}
                  {(selectedOrder as any)?.picking_individually_done_at && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 gap-1.5">
                      <Hand className="h-3 w-3" />
                      Picking individual em {new Date((selectedOrder as any).picking_individually_done_at).toLocaleDateString('pt-BR')}
                    </Badge>
                  )}
                </div>
              </div>
              {/* Faixa de KPIs — totais do PV em destaque editorial (Anton) */}
              {selectedOrder && (
                <div className="flex items-center gap-5 sm:gap-7 shrink-0">
                  <div>
                    <p className="eyebrow">Pares</p>
                    <p className="font-display text-2xl leading-none tabular-nums">{loadingOrderItems ? '—' : selectedOrderItems.reduce((s, i) => s + Number(i.quantity || 0), 0).toLocaleString('pt-BR')}</p>
                  </div>
                  {canSeeFinancialValues && (
                    <div>
                      <p className="eyebrow">Total</p>
                      <p className="font-display text-2xl leading-none tabular-nums">{loadingOrderItems ? '—' : formatCurrency(selectedOrderItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0))}</p>
                    </div>
                  )}
                  <div>
                    <p className="eyebrow">Itens</p>
                    <p className="font-display text-2xl leading-none tabular-nums">{loadingOrderItems ? '—' : selectedOrderItems.length}</p>
                  </div>
                </div>
              )}
            </div>
            </div>
            <DialogDescription className="sr-only">Detalhes, totais e ações do pedido {selectedOrder?.order_number || ''}</DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 px-6 pb-6 pt-4">
              {/* Mesa de liberação do PV: as ações seguem a ordem de trabalho
                  (pedido → materiais/produção → documentos/terceiros). */}
              <div className="grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[0.72fr_1.55fr_0.9fr] [&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs [&_button]:gap-1.5">
                <section className="border-b border-border p-2.5 lg:border-b-0 lg:border-r" aria-labelledby="pv-actions-order">
                  <p id="pv-actions-order" className="eyebrow mb-2"><span className="mr-1 font-mono text-primary">01</span> Pedido</p>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ações do pedido">
                  {canEditPv && <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailDialogOpen(false); navigate(`/sales/edit/${selectedOrder.id}`); }}><Pencil className="h-3.5 w-3.5" /> Editar</Button>}
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setMarginDialogOpen(true)}><TrendingUp className="h-3.5 w-3.5" /> Margem</Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setPhotosDialogOpen(true)} disabled={loadingOrderItems || selectedOrderItems.length === 0}><Images className="h-3.5 w-3.5" /> Fotos</Button>
                  {/* Botão "Aprovar" individual — só aparece em Rascunho.
                      Sem esse botão, o usuário só conseguia aprovar via "Gerar OPs"
                      em massa (o que aprovava TODOS os Rascunhos de uma vez).
                      Aqui flipa apenas o status (sem gerar OPs ainda). */}
                  {isAdmin && selectedOrder.status === 'Rascunho' && (
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => setPendingConfirm({
                        title: `Aprovar o pedido ${selectedOrder.order_number}?`,
                        description: 'Isso permite incluir o pedido em ondas de produção.',
                        actionLabel: 'Aprovar',
                        onConfirm: async () => {
                        try {
                          await updateStatus.mutateAsync({ id: selectedOrder.id, status: 'Aprovado' });
                        } catch (error: any) {
                          // O guard de prontidão já abriu a correção estruturada;
                          // repetir a mensagem completa em toast encobre o modal.
                          if (!(error instanceof SaleOrderReadinessBlockedError)) {
                            toast.error(`Erro ao aprovar: ${error?.message || error}`);
                          }
                          return;
                        }
                        toast.success(`Pedido ${selectedOrder.order_number} aprovado.`);
                        queryClient.invalidateQueries({ queryKey: ['sale_orders'] });
                        // Fecha por setState (não passa pelo onOpenChange), então
                        // limpa o ?pv= aqui — senão o param fica preso e um F5
                        // reabriria o detalhe de um PV que o usuário já fechou.
                        // Os outros dois pontos que fecham direto navegam pra fora
                        // de /sales, e ali o param sai junto com a rota.
                        setSearchParams(prev => {
                          const next = new URLSearchParams(prev);
                          next.delete('pv');
                          return next;
                        }, { replace: true });
                        setDetailDialogOpen(false);
                        },
                      })}
                    >
                      <CheckCircle className="h-3.5 w-3.5" /> Aprovar
                    </Button>
                  )}
                  </div>
                </section>

                <section className="border-b border-border p-2.5 lg:border-b-0 lg:border-r" aria-labelledby="pv-actions-production">
                  <p id="pv-actions-production" className="eyebrow mb-2"><span className="mr-1 font-mono text-primary">02</span> Materiais e produção</p>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ações de materiais e produção">
                  {isAdmin && (selectedOrder.status === 'Aprovado' || selectedOrder.status === 'Em Produção') && (
                    <Button variant="outline" size="sm" className="gap-2" disabled={resyncPVOPs.isPending} onClick={() => setPendingConfirm({
                      title: 'Resincronizar as OPs deste pedido?',
                      description: 'Revalida ficha, plano e reservas de cada OP ativa em transação própria, preservando identidade e histórico. OP com fato físico não é reescrita.',
                      actionLabel: 'Resincronizar OPs',
                      onConfirm: () => resyncPVOPs.mutate(selectedOrder.id),
                    })}>
                      {resyncPVOPs.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Resync OPs
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-2" title="O que comprar, quanto falta e a grade do solado" onMouseEnter={() => prefetchPvConsumption(selectedOrder.id)} onClick={() => setConsumoDialog({ ids: [selectedOrder.id], numbers: [selectedOrder.order_number] })}><Package className="h-3.5 w-3.5" /> Consumo de materiais</Button>
                  {canBuy && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setPoGenTarget({ ids: [selectedOrder.id], numbers: [selectedOrder.order_number] })}
                      title="Gera Ordens de Compra só para este pedido (canal Compras por Pedido, separado do MRP)"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Gerar OCs
                    </Button>
                  )}
                  {/* Picking individual — desde 31/07/2026 a baixa sai sozinha na
                      LIBERAÇÃO PRA PRODUÇÃO (consumeReservationsOnRelease), que
                      também marca picking_individually_done_at. Como este botão só
                      aparece enquanto essa marca está vazia, ele deixou de ser o
                      gesto principal e virou FALLBACK: PV liberado antes da mudança,
                      ou liberação em que a baixa automática falhou (o toast avisa).
                      Manter — é a única forma de repetir a baixa sem esperar o
                      faturamento. Pra reverter, release_order_reservations por OP. */}
                  {!(selectedOrder as any).picking_individually_done_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={commitPicking.isPending}
                      onClick={() => setPendingConfirm({
                        title: `Baixar material do pedido ${selectedOrder.order_number}?`,
                        description: (
                          <div className="space-y-2">
                            <p>Normalmente a baixa acontece sozinha quando o pedido é liberado para produção. Use este fallback se o pedido foi liberado antes dessa regra existir ou se a baixa automática falhou.</p>
                            <p>Cada item será subtraído do estoque e registrado como saída. Itens sem saldo serão pulados; o restante continuará, e o que faltar ainda sairá no faturamento.</p>
                          </div>
                        ),
                        actionLabel: 'Baixar material',
                        onConfirm: () => commitPicking.mutate(selectedOrder.id),
                      })}
                      title="Fallback: baixa as reservas deste PV agora, caso a baixa automática da liberação pra produção não tenha rodado"
                    >
                      {commitPicking.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hand className="h-3.5 w-3.5" />}
                      Baixar material
                    </Button>
                  )}
                  </div>
                </section>

                <section className="p-2.5" aria-labelledby="pv-actions-documents">
                  <p id="pv-actions-documents" className="eyebrow mb-2"><span className="mr-1 font-mono text-primary">03</span> Documentos e terceiros</p>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Impressão, documentos e terceirização">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2">
                        <Printer className="h-3.5 w-3.5" />
                        Imprimir / Documentos
                        <CaretDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                      <DropdownMenuItem
                        className="gap-2"
                        onSelect={() => {
                          void printAllSectorsForSaleOrder(selectedOrder.id, selectedOrder.order_number)
                            .catch((err: any) => toast.error(err.message));
                        }}
                      >
                        <FileText className="h-4 w-4" /> OPs
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setOperatorFichasOpen(true)} className="gap-2">
                        <Printer className="h-4 w-4" /> Ficha Montagem
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => { void printSaleOrderPdf(selectedOrder); }} className="gap-2">
                        <FileText className="h-4 w-4" /> Gerar Pedido (PDF)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* Atalho explícito: o deep-link abre a Central já filtrada e
                      agora também pré-seleciona as referências deste PV. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2"
                    onClick={() => navigate(`/label-system?sale_order=${selectedOrder.id}`)}
                    title="Abrir as etiquetas térmicas das caixas individuais deste pedido"
                  >
                    <Barcode className="h-3.5 w-3.5" /> Etiqueta Individual
                  </Button>
                {/* Atalho: cria uma Ordem de Serviço com os itens deste pedido
                    (terceirização) — mesmo fluxo/tabela da OS do menu. Primário
                    (vermelho) por ser uma ação de criação, igual Gerar OCs/OPs. */}
                <Button size="sm" className="gap-2" onClick={() => setOsDialogOpen(true)} title="Gerar Ordem de Serviço com os itens deste pedido — mesmo fluxo do menu Terceirizados">
                  <Buildings className="h-3.5 w-3.5" /> Gerar OS
                </Button>
                  </div>
                </section>
              </div>

              <div className={cn(
                'overflow-hidden rounded-lg border border-l-4 bg-card',
                selectedDeadlineInfeasible ? 'border-l-destructive' : 'border-l-foreground',
              )}>
                <div className="border-b bg-muted/30 px-4 py-2">
                  <p className="eyebrow">Dados comerciais e entrega</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
                  {([
                    { label: 'Representante', value: selectedOrder.representative || '—' },
                    { label: 'Cliente', value: selectedOrder.client_name || '—' },
                    { label: 'CNPJ', value: selectedOrder.client_cnpj || '—', mono: true },
                    { label: 'Contato', value: selectedOrder.client_contact || '—' },
                    ...(selectedOrder.client_order_number ? [{ label: 'Nº Pedido Cliente', value: selectedOrder.client_order_number, mono: true }] : []),
                    { label: 'Pagamento', value: selectedOrder.payment_condition || '—' },
                    { label: 'Entrega', value: selectedOrder.delivery_deadline ? parseDateOnly(selectedOrder.delivery_deadline).toLocaleDateString('pt-BR') : '—' },
                    ...(selectedMinBilling ? [{ label: 'Data mínima viável', value: formatDate(selectedMinBilling), mono: true, critical: selectedDeadlineInfeasible }] : []),
                    ...(canSeeFinancialValues && Number(selectedOrder.commission_value) > 0 ? [{ label: 'Comissão', value: formatCurrency(Number(selectedOrder.commission_value)), mono: true }] : []),
                    { label: 'Criado em', value: new Date(selectedOrder.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
                  ] as { label: string; value: string; mono?: boolean; critical?: boolean }[]).map((f) => (
                    <div key={f.label} className="min-w-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                      <dd className={cn('truncate text-sm text-foreground', f.mono && 'font-mono', f.critical && 'font-bold text-destructive')} title={String(f.value)}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
                {selectedOrder.notes && (
                  <div className="border-t px-4 py-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Observação</span>
                    <p className="text-sm text-foreground">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-card overflow-hidden overflow-x-auto">
                {loadingOrderItems ? (
                  <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...</div>
                ) : selectedOrderItems.length === 0 ? (
                  <EmptyState icon={Package} title="Nenhum item neste pedido" />
                ) : (
                  <div className="divide-y">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-foreground px-4 py-2.5 text-background">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-background/55">Conteúdo do pedido</p>
                        <p className="text-sm font-semibold">Referências, cores e distribuição da grade</p>
                      </div>
                      <p className="font-mono text-xs text-background/70">
                        {selectedOrderItems.length} {selectedOrderItems.length === 1 ? 'item' : 'itens'} · {selectedOrderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString('pt-BR')} pares
                      </p>
                    </div>
                    <div className={cn(
                      'grid items-center bg-muted/60 px-4 py-2 text-xs font-semibold text-muted-foreground',
                      canSeeFinancialValues
                        ? 'grid-cols-[1fr_auto_auto_auto_auto]'
                        : 'grid-cols-[1fr_auto_auto]'
                    )}>
                      <span>Ref. / Descrição</span>
                      <span className="w-[300px] text-center">Grade</span>
                      <span className="w-16 text-center">Qtd</span>
                      {canSeeFinancialValues && <span className="w-20 text-right">Unitário</span>}
                      {canSeeFinancialValues && <span className="w-24 text-right">Total</span>}
                    </div>
                    {(() => {
                      // Agrupa por referência (name+code): cabeçalho da ref UMA
                      // vez (foto + referência + descrição + totais) e as cores como
                      // sub-linhas abaixo. Pedido user 11/06/2026 — "mesma
                      // referência uma embaixo da outra".
                      const map = new Map<string, { key: string; refId: string | null; refCode: string; refName: string; refImage: string; items: any[] }>();
                      const order: string[] = [];
                      [...selectedOrderItems]
                        .sort((a, b) => {
                          const ra = `${(a as any).technical_sheets?.name || ''} ${(a as any).technical_sheets?.code || ''}`.trim();
                          const rb = `${(b as any).technical_sheets?.name || ''} ${(b as any).technical_sheets?.code || ''}`.trim();
                          const refCmp = ra.localeCompare(rb, 'pt-BR', { numeric: true });
                          if (refCmp !== 0) return refCmp;
                          return String(a.color || '').localeCompare(String(b.color || ''), 'pt-BR');
                        })
                        .forEach((item) => {
                          const refCode = (item as any).technical_sheets?.code || '';
                          const refName = (item as any).technical_sheets?.name || '';
                          const key = `${refName}||${refCode}`.toLowerCase() || item.id;
                          const tsImages = (item as any).technical_sheets?.images as string[] | null;
                          const img = item.variant_image_url || (tsImages && tsImages.length > 0 ? tsImages[0] : ((item as any).technical_sheets?.image_url || ''));
                          let g = map.get(key);
                          if (!g) { g = { key, refId: item.reference_id, refCode, refName, refImage: img, items: [] }; map.set(key, g); order.push(key); }
                          if (!g.refImage && img) g.refImage = img;
                          g.items.push(item);
                        });
                      return order.map((key) => {
                        const g = map.get(key)!;
                        const groupPairs = g.items.reduce((s, i) => s + Number(i.quantity || 0), 0);
                        const groupValue = g.items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
                        const headLabel = g.refName || g.refCode || '—';
                        return (
                          <div key={key}>
                            {/* Cabeçalho da referência (uma vez por grupo) */}
                            <div className="flex items-center gap-3 bg-muted/40 px-4 py-2.5">
                              {g.refImage ? <img src={g.refImage} alt={g.refName} className="h-16 w-16 rounded-md object-cover border shrink-0" /> : <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center text-muted-foreground text-[10px] shrink-0">Sem foto</div>}
                              <div className="min-w-0 flex-1">
                                {g.refId ? (
                                  <button type="button" onClick={() => { setDetailDialogOpen(false); navigate(`/fichas-tecnicas?ref=${g.refId}`); }} title="Abrir ficha técnica desta referência" className="group inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline text-left">
                                    {headLabel}<ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                                  </button>
                                ) : <p className="text-sm font-bold">{headLabel}</p>}
                                <p className="text-xs text-muted-foreground">{g.refCode && g.refCode !== g.refName ? `Cód. interno: ${g.refCode} · ` : ''}{g.items.length} {g.items.length === 1 ? 'cor' : 'cores'}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-mono font-bold text-sm">{groupPairs} <span className="text-xs font-normal text-muted-foreground">pares</span></p>
                                {canSeeFinancialValues && <p className="font-mono text-xs text-muted-foreground">{formatCurrency(groupValue)}</p>}
                              </div>
                            </div>
                            {/* Sub-linhas por cor */}
                            <div className="divide-y divide-border/50">
                              {g.items.map((item) => {
                                const grade = (item.grade || {}) as Record<string, number>;
                                const gradeEntries = Object.entries(grade)
                                  .filter(([k, qty]) => !k.startsWith('_') && Number(qty) > 0)
                                  .sort((a, b) => {
                                    const na = parseInt(String(a[0]).split('/')[0], 10);
                                    const nb = parseInt(String(b[0]).split('/')[0], 10);
                                    return (isNaN(na) ? 0 : na) - (isNaN(nb) ? 0 : nb);
                                  });
                                const gradePairs = gradeEntries.reduce((s, [, qty]) => s + Number(qty), 0);
                                const totalQty = Number(item.quantity || 0);
                                const fichas = gradePairs > 0 ? Math.round(totalQty / gradePairs) : 1;
                                const unit = Number(item.unit_price || 0);
                                return (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      'grid items-start px-4 py-3 gap-2 pl-6 hover:bg-muted/20 transition-colors',
                                      canSeeFinancialValues
                                        ? 'grid-cols-[1fr_auto_auto_auto_auto]'
                                        : 'grid-cols-[1fr_auto_auto]',
                                    )}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-semibold">{item.color || '—'}</p>
                                        {item.production_excluded_at && (
                                          <Badge
                                            variant="outline"
                                            className="gap-1 border-warning/40 bg-warning/10 text-warning-foreground"
                                          >
                                            <AlertTriangle className="h-3 w-3" weight="fill" />
                                            Retirado da produção
                                          </Badge>
                                        )}
                                        {(item.productionOrders || []).map((op: any) => (
                                          <MaterialReservationErrorBadge
                                            key={op.id}
                                            materialStatus={op.material_status}
                                            notes={op.notes}
                                          />
                                        ))}
                                      </div>
                                      {item.production_excluded_at && (
                                        <div
                                          role="status"
                                          className="mt-2 border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning-foreground"
                                        >
                                          <p className="font-semibold">Este item não faz mais parte da carga de produção.</p>
                                          <p className="mt-0.5 break-words">
                                            {item.production_exclusion_reason || 'Exclusão administrativa registrada sem motivo informado.'}
                                          </p>
                                        </div>
                                      )}
                                      {(item.strap_colors as any[])?.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2 p-2 rounded bg-muted/30 border border-border/40">
                                          <p className="text-xs font-bold text-muted-foreground uppercase w-full">Cores das Tiras:</p>
                                          {(item.strap_colors as any[]).map((s: any, sIdx: number) => (
                                            <div key={sIdx} className="flex items-center gap-1.5 bg-background px-2 py-0.5 rounded border text-xs">
                                              <span className="font-semibold text-muted-foreground truncate max-w-[60px]">{s.label || `TIRA ${sIdx + 1}`}:</span>
                                              <span className="font-bold text-primary">{s.color || '—'}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="w-[300px] text-center space-y-1 pt-0.5">
                                      {gradeEntries.length > 0 ? (
                                        <>
                                          <p className="text-xs text-muted-foreground">Grade: {gradePairs} pares × {fichas} fichas</p>
                                          <div className="flex justify-center gap-0">
                                            <table className="border-collapse">
                                              <thead><tr>{gradeEntries.map(([size]) => <th key={size} className="px-1.5 py-0.5 text-xs text-muted-foreground font-medium border border-border/50 bg-muted/40">{size}</th>)}</tr></thead>
                                              <tbody>
                                                <tr>{gradeEntries.map(([size, qty]) => <td key={size} className="px-1.5 py-0.5 text-xs font-mono font-semibold text-center border border-border/50">{qty}</td>)}</tr>
                                                {fichas > 1 && <tr className="bg-muted/40">{gradeEntries.map(([size, qty]) => <td key={size} className="px-1.5 py-0.5 text-xs font-mono font-bold text-center border border-border/50">{Number(qty) * fichas}</td>)}</tr>}
                                              </tbody>
                                            </table>
                                          </div>
                                        </>
                                      ) : <span className="text-xs text-muted-foreground">—</span>}
                                    </div>
                                    <div className="w-16 text-center font-mono font-bold text-sm pt-1">{totalQty}</div>
                                    {canSeeFinancialValues && (
                                      <>
                                        <div className="w-20 text-right font-mono text-sm pt-1">{formatCurrency(unit)}</div>
                                        <div className="w-24 text-right font-mono font-bold text-sm pt-1">{formatCurrency(totalQty * unit)}</div>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>

              {/* Totais movidos pra faixa de KPIs do header (Pares/Total/Itens). */}

              {/* Compras deste PV (canal "Compras por Pedido") */}
              {canBuy && <PurchaseOrdersForPvCard pvId={selectedOrder.id} />}

              {/* PV informal: aviso no lugar do painel NF-e */}
              {(selectedOrder as any).nfe_required === false && selectedOrderNfes.length === 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <p className="font-semibold text-amber-700 dark:text-amber-300">Pedido informal — sem NF-e</p>
                    <p className="text-muted-foreground mt-0.5">
                      Material e produção debitam normalmente. Não emite nota, não gera conta a receber.
                      Vai pra <strong>Finalizado s/ NF</strong> ao ser expedido.
                    </p>
                  </div>
                </div>
              )}

              {/* NF-e panel — pra qualquer PV formal (nfe_required≠false) que não esteja
                  cancelado. Antes a condição exigia status='Faturado'|'Aprovado' o que
                  escondia o painel inteiro pra PVs em 'Em Produção'/'Pendente'/etc, e o
                  operador não tinha como emitir nem ver NFs prévias. O backend (emit-nfe)
                  é quem decide se é seguro emitir agora — frontend só deve mostrar a
                  opção. */}
              {(selectedOrder as any).nfe_required !== false && selectedOrder.status !== 'Cancelado' && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Receipt className="h-4 w-4" />
                      NF-e
                    </div>
                    <div className="flex items-center gap-2">
                      {companies.length > 0 && (() => {
                        const primary = companies.find(c => c.is_primary);
                        const primaryLabel = primary
                          ? `${primary.nome_fantasia || primary.razao_social} ★`
                          : 'Empresa principal';
                        return (
                          <Select value={nfeCompanyId || '__primary__'} onValueChange={v => setNfeCompanyId(v === '__primary__' ? '' : v)}>
                            <SelectTrigger className="h-7 text-xs w-52">
                              <SelectValue placeholder={primaryLabel} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__primary__">{primaryLabel}</SelectItem>
                              {companies.filter(c => !c.is_primary).map(c => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.nome_fantasia || c.razao_social}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                      {/* Botão Emitir aparece pra qualquer status não-cancelado SE não
                          houver NF ativa (autorizada/processando/cancelando). Backend
                          re-valida tudo (status, IE, NCM, etc) — esse check de UI só
                          esconde quando claramente não faz sentido tentar.
                          18/05/2026: removido botão "Emitir direto" — agora SEMPRE
                          passa pelo preview (NfePreviewDialog tem botão "Confirmar e
                          emitir" dentro). Evita emissão sem conferência de IE/NCM/peso/
                          volumes/transportador/total. Mesmo fluxo da rota /nfe. */}
                      {!selectedOrderNfes.some((n: any) => ['autorizada', 'processando', 'cancelando'].includes(n.status)) && (
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => setPreviewNfeOrder({ id: selectedOrder.id, orderNumber: selectedOrder.order_number })}
                          title="Conferir dados antes de emitir (passo obrigatório)"
                        >
                          <Receipt className="h-3 w-3" /> Emitir NF-e
                        </Button>
                      )}
                    </div>
                  </div>
                  {selectedOrderNfes.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-4 py-3">Nenhuma NF-e emitida para este pedido.</p>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {selectedOrderNfes.map((nfe: any) => (
                        <div
                          key={nfe.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setViewNfeTarget(nfe as NfeEmitida)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewNfeTarget(nfe as NfeEmitida); } }}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-muted/40 transition-colors"
                          title="Clique para visualizar DANFE e XML"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {nfe.status === 'autorizada' && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
                              {nfe.status === 'processando' && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                              {(nfe.status === 'rejeitada' || nfe.status === 'erro') && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                              {nfe.status === 'cancelada' && <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-medium capitalize">{nfe.status}</span>
                              {nfe.numero && <span className="text-muted-foreground">NF {nfe.numero}/{nfe.serie}</span>}
                              {nfe.cnpj_emitente && <span className="text-xs text-muted-foreground">CNPJ {nfe.cnpj_emitente}</span>}
                            </div>
                            {nfe.motivo_rejeicao && <p className="text-xs text-red-500 mt-0.5 truncate" title={nfe.motivo_rejeicao}>{nfe.motivo_rejeicao}</p>}
                            <p className="text-xs text-muted-foreground">{new Date(nfe.created_at).toLocaleString('pt-BR')}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {nfe.status === 'processando' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Verificar status" onClick={() => checkNfeStatus.mutate(nfe.id)}>
                                {checkNfeStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              </Button>
                            )}
                            {nfe.danfe_url && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="DANFE" asChild>
                                <a href={nfe.danfe_url} target="_blank" rel="noopener noreferrer"><Download className="h-3 w-3" /></a>
                              </Button>
                            )}
                            {nfe.xml_url && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="XML" asChild>
                                <a href={nfe.xml_url} target="_blank" rel="noopener noreferrer"><FileText className="h-3 w-3" /></a>
                              </Button>
                            )}
                            {nfe.status === 'autorizada' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" title="Cancelar NF-e"
                                onClick={() => { setCancelNfeTarget({ id: nfe.id, numero: nfe.numero }); setCancelJustificativa(''); }}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            )}
                            {nfe.status === 'autorizada' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700" title="Emitir NF-e de devolução"
                                onClick={() => setDevolucaoTarget({ id: nfe.id, numero: nfe.numero })}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* NF-e cancel dialog */}
      <Dialog open={!!cancelNfeTarget} onOpenChange={() => setCancelNfeTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-4 w-4" /> Cancelar NF-e {cancelNfeTarget?.numero}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">A justificativa deve ter ao menos 15 caracteres e será enviada à SEFAZ.</p>
            <div>
              <Label>Justificativa</Label>
              <Textarea
                className="mt-1 min-h-[80px]"
                value={cancelJustificativa}
                onChange={e => setCancelJustificativa(e.target.value)}
                placeholder="Motivo do cancelamento..."
              />
              <p className="text-xs text-muted-foreground mt-1">{cancelJustificativa.length}/15 mínimo</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelNfeTarget(null)}>Voltar</Button>
            <Button variant="destructive"
              disabled={cancelJustificativa.trim().length < 15 || cancelNfe.isPending}
              onClick={async () => {
                if (!cancelNfeTarget) return;
                await cancelNfe.mutateAsync({ nfeId: cancelNfeTarget.id, justificativa: cancelJustificativa, dataEmissao: (cancelNfeTarget as any).data_emissao });
                setCancelNfeTarget(null);
              }}>
              {cancelNfe.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NF-e devolução dialog */}
      {devolucaoTarget && selectedOrder && (
        <Suspense fallback={null}>
          <NfeDevolucaoDialog
            open={!!devolucaoTarget}
            onOpenChange={(v) => { if (!v) setDevolucaoTarget(null); }}
            nfeId={devolucaoTarget.id}
            nfeNumero={devolucaoTarget.numero}
            saleOrderId={selectedOrder.id}
            clientName={selectedOrder.client_name}
          />
        </Suspense>
      )}

      {/* NF-e viewer (DANFE + XML) — abre quando o usuário clica numa NF da lista */}
      {viewNfeTarget && (
        <Suspense fallback={null}>
          <NfeViewerDialog
            nfe={viewNfeTarget}
            open={!!viewNfeTarget}
            onOpenChange={(v) => { if (!v) setViewNfeTarget(null); }}
            clientLabel={selectedOrder?.client_name || viewNfeTarget?.nome_destinatario || undefined}
            orderNumber={selectedOrder?.order_number || undefined}
          />
        </Suspense>
      )}

      {/* NF-e preview (dry_run) — atalho do resumo do PV. Mostra tudo que vai
          pra SEFAZ antes do POST destrutivo. Operador confere e confirma. */}
      {previewNfeOrder && (
        <Suspense fallback={null}>
          <NfePreviewDialog
            saleOrderId={previewNfeOrder?.id || null}
            companyId={nfeCompanyId || undefined}
            orderNumber={previewNfeOrder?.orderNumber}
            open={!!previewNfeOrder}
            onClose={() => setPreviewNfeOrder(null)}
          />
        </Suspense>
      )}

      {/* DUPLICATE DIALOG */}
      <Dialog open={dupDialog} onOpenChange={setDupDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Duplicar por Grupo Econômico</DialogTitle></DialogHeader>
          {/* Audit visual: aviso explícito sobre impacto de estoque/reservas.
              Usuário não esperava que duplicar PV gerasse N reservas novas. */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mt-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-700 dark:text-amber-300">
              <p className="font-semibold mb-1">A duplicação reservará insumos novamente</p>
              <p>
                Cada cliente selecionado vira um novo PV com mesmos itens — gerando reservas
                independentes em <span className="font-mono">products.reserved_stock</span>. Verifique
                a disponibilidade de materiais antes de confirmar pra evitar superalocação.
              </p>
            </div>
          </div>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Grupo Econômico</Label>
              <Select value={dupGroupId} onValueChange={v => { setDupGroupId(v); setDupSelectedClients([]); setDupClientSearch(''); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um grupo" /></SelectTrigger>
                <SelectContent>{economicGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Info contextual: lojas que JÁ receberam cópia deste PV são
                ocultadas da lista (filtradas via parent_order_id). Pedido
                user 20/05/2026: "duplicar deve desconsiderar lojas do grupo
                que já foi copiado daquele pedido". */}
            {dupGroupId && dupAlreadyCopiedStores.length > 0 && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  ✓ {dupAlreadyCopiedStores.length} {dupAlreadyCopiedStores.length === 1 ? 'loja já recebeu cópia' : 'lojas já receberam cópia'} (não aparecem na lista abaixo)
                </p>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-1">
                  {dupAlreadyCopiedStores.slice(0, 5).map(c => c.razao_social).join(' · ')}
                  {dupAlreadyCopiedStores.length > 5 && ` · +${dupAlreadyCopiedStores.length - 5}`}
                </p>
              </div>
            )}

            {/* Vazio quando todas já foram copiadas */}
            {dupGroupId && dupGroupClients.length === 0 && dupAlreadyCopiedStores.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-center">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  Todas as lojas ativas do grupo já receberam cópia deste PV
                </p>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">
                  Nada pra duplicar — feche este dialog.
                </p>
              </div>
            )}

            {dupGroupId && dupGroupClients.length > 0 && (() => {
              const filteredClients = dupClientSearch.trim()
                ? dupGroupClients.filter(c => searchMatchesAllTerms(
                    dupClientSearch,
                    c.razao_social,
                    c.nome_fantasia,
                    c.cnpj,
                  ))
                : dupGroupClients;
              return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Lojas do Grupo</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllDupClients} className="text-xs">{dupSelectedClients.length === dupGroupClients.length ? 'Desmarcar todos' : 'Selecionar todos'}</Button>
                </div>
                <SearchInput
                  placeholder="Buscar loja por razão social, fantasia ou CNPJ…"
                  value={dupClientSearch}
                  onChange={setDupClientSearch}
                  resultCount={filteredClients.length}
                  totalCount={dupGroupClients.length}
                  inputClassName="h-9"
                />
                <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                  {filteredClients.map(c => {
                    const isSelected = dupSelectedClients.includes(c.id);
                    return (
                      // Bug fix 20/05/2026: era <label> com Checkbox dentro, mas
                      // shadcn Checkbox é <button>, não <input> — clicar na label
                      // não togglava o estado, parecia que multi-seleção não
                      // funcionava. Trocado por div com onClick na linha toda.
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleDupClient(c.id)}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleDupClient(c.id); } }}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleDupClient(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Selecionar ${c.razao_social}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : ''}`}>
                            {c.razao_social}
                          </div>
                          {c.cnpj && <div className="text-xs text-muted-foreground font-mono">{c.cnpj}</div>}
                        </div>
                      </div>
                    );
                  })}
                  {filteredClients.length === 0 && <p className="text-xs text-muted-foreground p-3">Nenhuma loja encontrada.</p>}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-bold text-primary">{dupSelectedClients.length}</span> de {dupGroupClients.length} {dupGroupClients.length === 1 ? 'loja selecionada' : 'lojas selecionadas'}
                  {dupSelectedClients.length > 0 && ' — clique em "Duplicar" pra criar N PVs de uma vez'}
                </p>
              </div>
              );
            })()}
            {dupGroupId && dupGroupClients.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cliente ativo neste grupo.</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDupDialog(false)}>Cancelar</Button>
              <Button onClick={handleDuplicate} disabled={dupSelectedClients.length === 0 || createOrder.isPending}>
                {createOrder.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                Duplicar ({dupSelectedClients.length})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {readinessCorrectionTarget && (
        <Suspense fallback={null}>
          <SaleOrderReadinessCorrectionDialog
            target={readinessCorrectionTarget}
            isAdmin={isAdmin}
            statusChangePending={updateStatus.isPending}
            onClose={() => setReadinessCorrectionTargets((current) => current.slice(1))}
            onEditOrder={() => {
              const target = readinessCorrectionTarget;
              if (!target) return;
              setReadinessCorrectionTargets((current) => current.filter((item) => item.id !== target.id));
              navigate(`/sales/edit/${target.id}`);
            }}
            onRetry={async (overrideId) => {
              const target = readinessCorrectionTarget;
              if (!target) return;
              try {
                await updateStatus.mutateAsync({
                  id: target.id,
                  status: target.status,
                  override_id: overrideId || null,
                });
                setReadinessCorrectionTargets((current) => current.filter((item) => item.id !== target.id));
              } catch {
                // onReadinessBlocked atualiza o mesmo alvo com o preflight novo.
              }
            }}
          />
        </Suspense>
      )}

      <AlertDialog open={pendingConfirm !== null} onOpenChange={(o) => { if (!o) setPendingConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>{pendingConfirm?.description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              // Ação destrutiva (excluir/cancelar) tem que PARECER destrutiva —
              // senão o diálogo de excluir 12 PVs é visualmente idêntico ao de
              // aprovar 12, e a confirmação vira reflexo em vez de decisão.
              className={pendingConfirm?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              // ⚠ preventDefault é LOAD-BEARING, não higiene.
              //
              // AlertDialogAction É um Dialog.Close: o Radix compõe este onClick
              // com `() => onOpenChange(false)`, e o dele roda DEPOIS do nosso.
              // Sem o preventDefault, um onConfirm que abre um SEGUNDO
              // pendingConfirm — é o caso do aviso de data inviável, disparado
              // por handleBulkGenerateOPs e handleBulkStatusChange — tinha o
              // estado sobrescrito por null no mesmo tick: o 2º diálogo nunca
              // aparecia, a ação morria sem toast e o usuário achava que aprovou.
              // composeEventHandlers checa defaultPrevented, então isto desliga
              // o fechamento automático; quem fecha é o setPendingConfirm(null).
              onClick={(e) => {
                e.preventDefault();
                const fn = pendingConfirm?.onConfirm;
                setPendingConfirm(null);
                void fn?.();
              }}
            >
              {pendingConfirm?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {overviewOpen && (
        <Suspense fallback={null}>
          <SaleOrdersOverviewDialog
            open={overviewOpen}
            onOpenChange={setOverviewOpen}
            orders={orders.filter(o => selectedIds.has(o.id))}
          />
        </Suspense>
      )}

      {marginDialogOpen && (
        <Suspense fallback={null}>
          <MarginDialog
            open={marginDialogOpen}
            onOpenChange={setMarginDialogOpen}
            saleOrderId={selectedOrder?.id || null}
            orderNumber={selectedOrder?.order_number || ''}
            total={Number(selectedOrder?.total) || 0}
          />
        </Suspense>
      )}

      {photosDialogOpen && (
        <Suspense fallback={null}>
          <OrderPhotosDialog
            open={photosDialogOpen}
            onOpenChange={setPhotosDialogOpen}
            orderNumber={selectedOrder?.order_number || ''}
            clientName={selectedOrder?.client_name || ''}
            items={selectedOrderItems}
          />
        </Suspense>
      )}

      {consumoDialog && (
        <Suspense fallback={null}>
          <OrderConsumptionDialog
            open={!!consumoDialog}
            onOpenChange={(v) => { if (!v) setConsumoDialog(null); }}
            saleOrderIds={consumoDialog.ids}
            orderNumbers={consumoDialog.numbers}
            onGerarOC={canBuy ? () => {
              const { ids, numbers } = consumoDialog;
              setConsumoDialog(null);
              setPoGenTarget({ ids, numbers });
            } : undefined}
          />
        </Suspense>
      )}

      {/* "Ficha Montagem": seleção de OPs antes de imprimir. Sem OP vinculada,
          o próprio diálogo oferece o caminho antigo (pelos itens do pedido). */}
      {operatorFichasOpen && (
        <Suspense fallback={null}>
          <OperatorFichasDialog
            open={operatorFichasOpen}
            onOpenChange={setOperatorFichasOpen}
            saleOrderId={selectedOrder?.id || null}
            orderNumber={selectedOrder?.order_number || ''}
          />
        </Suspense>
      )}

      {/* Atalho "Gerar OS" do PV — usa o mesmo assistente do pós-cadastro e do
          menu de Terceirizados. A unidade de emissão é OP × setor; assim não há
          um segundo modelo de OS criado diretamente pelos itens do pedido. */}
      {/* Guarda por `osDialogOpen`, não só por `selectedOrder`: este nunca volta a
          null depois do primeiro PV aberto, então sozinho ele montaria o diálogo
          (e baixaria o chunk) para sempre. */}
      {osDialogOpen && selectedOrder && (
        <Suspense fallback={null}>
        <GenerateServiceOrdersWizard
          open={osDialogOpen}
          onOpenChange={setOsDialogOpen}
          initialSaleOrderId={selectedOrder.id}
        />
        </Suspense>
      )}

      {poGenTarget && (
        <Suspense fallback={null}>
          <GeneratePurchaseOrdersDialog
            open={!!poGenTarget}
            onOpenChange={(v) => { if (!v) setPoGenTarget(null); }}
            pvIds={poGenTarget.ids}
            pvNumbers={poGenTarget.numbers}
          />
        </Suspense>
      )}
    </>
  );
}
