import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useQueries, keepPreviousData } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass as Search, ClipboardText as ClipboardList, Users, Package, FileText,
  X, ArrowRight, House as Home, Buildings, ClockCounterClockwise as Clock, Star,
  Receipt, ShoppingBag, Truck, FolderOpen, UserCircle, Lightning, Plus, Scissors,
} from '@phosphor-icons/react';
import { menuGroups, navigationCatalog } from '@/data/navigation';
import { useMenuFavorites } from '@/hooks/useMenuFavorites';
import { useAccessControl } from '@/hooks/useAccessControl';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { normalizeForSearch, searchNormOrFilter, searchMatchesAllTerms } from '@/lib/searchUtils';
import { isStrapServiceOrder } from '@/lib/strapServiceOrderIdentity';
import { isMissingPostgrestRelation } from '@/lib/postgrestErrors';

type QueryType = 'cnpj' | 'barcode' | 'invoice' | 'order_number' | 'group' | 'general';
type Scope =
  | 'all' | 'orders' | 'sales' | 'clients' | 'products' | 'references' | 'suppliers'
  | 'purchases' | 'os' | 'nfe' | 'employees' | 'groups';

function detectQueryType(query: string): QueryType {
  const trimmed = query.trim();
  if (trimmed.startsWith('/')) return 'group';
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed)) return 'cnpj';
  if (/^\d{10,13}$/.test(trimmed)) return 'barcode';
  if (/^NF\s?\d+$/i.test(trimmed)) return 'invoice';
  if (/^OP[-\s]?\d+$/i.test(trimmed)) return 'order_number';
  return 'general';
}

/**
 * Sanitiza input pra `.or(...)` do PostgREST. Vírgula separa clauses, parênteses
 * delimitam grupos, asterisco/percent é wildcard, contrabarra escapa. Quando o
 * usuário digita qualquer um (ex.: "TM, 12"), o filtro fica malformado e a query
 * retorna 0 resultados sem erro visível. Remove os chars problemáticos.
 */
function sanitizeForPostgrestOr(s: string): string {
  return s.replace(/[,()]/g, ' ').replace(/[\\%_]/g, '').trim();
}

/**
 * Constrói o filtro `.or()` do PostgREST com suporte a busca multi-palavra.
 * Termo de 1 palavra → `field.ilike.%termo%` por campo, unidos por OR.
 * Termo com várias palavras → cada campo precisa casar TODAS as palavras
 * (`and(field.ilike.%a%,field.ilike.%b%)`), campos unidos por OR. Assim
 * "sandalia preta" acha o que tem "sandalia" E "preta" no mesmo campo,
 * em qualquer ordem — antes exigia a substring exata "sandalia preta".
 */
function multiWordOr(fields: string[], rawTerm: string): string {
  const tokens = rawTerm
    .split(/\s+/)
    .map(t => t.replace(/[\\%_,()]/g, '').trim())
    .filter(t => t.length >= 1);
  if (tokens.length <= 1) {
    const t = tokens[0] ?? rawTerm;
    return fields.map(f => `${f}.ilike.%${t}%`).join(',');
  }
  return fields.map(f => `and(${tokens.map(t => `${f}.ilike.%${t}%`).join(',')})`).join(',');
}

const TYPE_LABELS: Record<QueryType, string> = {
  cnpj: 'CNPJ',
  barcode: 'Código de Barras',
  invoice: 'Nota Fiscal',
  order_number: 'Ordem de Produção',
  group: 'Grupo Econômico',
  general: 'Busca Geral',
};

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'orders', label: 'OPs' },
  { key: 'sales', label: 'Pedidos' },
  { key: 'clients', label: 'Clientes' },
  { key: 'products', label: 'Materiais' },
  { key: 'references', label: 'Modelos' },
  { key: 'suppliers', label: 'Fornecedores' },
  { key: 'purchases', label: 'OCs' },
  { key: 'os', label: 'OSs' },
  { key: 'nfe', label: 'NF-e' },
  { key: 'employees', label: 'Pessoas' },
  { key: 'groups', label: 'Grupos' },
];

const RECENT_KEY = 'global-search-recent';
const GLOBAL_SERVICE_ORDER_LIMIT = 6;
const SERVICE_ORDER_IDENTITY_SELECT = [
  'id', 'order_number', 'sector', 'status', 'total_value', 'contractor_id', 'created_at',
  'artisanal_recipe_id', 'canonical_strap_recipe_id', 'artisanal_output_name',
  'artisanal_output_color', 'artisanal_output_meters', 'artisanal_for_order_meters',
  'artisanal_for_stock_meters', 'artisanal_base_color', 'artisanal_stock_entry_done',
].join(', ');
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(term: string) {
  const t = term.trim();
  if (t.length < 2) return;
  const next = [t, ...loadRecent().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

// ── Itens acessados recentemente (spec R9b) ────────────────────────────────
// Diferente das "buscas recentes" (termos), aqui guardamos os RESULTADOS que o
// usuário abriu: {type,id,label,href}. Cap 10, dedup por type+id, localStorage.
export interface RecentItem {
  type: 'op' | 'pv' | 'client' | 'product' | 'supplier' | 'reference' | 'oc' | 'os' | 'nfe' | 'employee' | 'group' | 'page';
  id: string;
  label: string;
  href: string;
  meta?: string;
}
const RECENT_ITEMS_KEY = 'global-search-recent-items';
function loadRecentItems(): RecentItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(i => i && i.href && i.label) : [];
  } catch { return []; }
}
function pushRecentItem(item: RecentItem) {
  const next = [item, ...loadRecentItems().filter(i => !(i.type === item.type && i.id === item.id))].slice(0, 10);
  try { localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

const RECENT_ITEM_ICON: Record<RecentItem['type'], typeof Package> = {
  op: ClipboardList, pv: FileText, client: Users, product: Package,
  supplier: Buildings, reference: Package, oc: ShoppingBag, os: Truck,
  nfe: Receipt, employee: UserCircle, group: FolderOpen, page: ArrowRight,
};

// ── Ações rápidas (spec R9d) — navegam pra rotas existentes; filtradas por
// permissão de menu (canAccessRoute) e pelo termo digitado. ────────────────
const QUICK_ACTIONS: { label: string; path: string; permPath: string; keywords: string }[] = [
  { label: 'Criar PV (novo pedido de venda)', path: '/sales/new', permPath: '/sales', keywords: 'criar novo pv pedido venda' },
  { label: 'Novo cliente', path: '/clients', permPath: '/clients', keywords: 'novo cliente cadastrar' },
  { label: 'Ir para Diagnósticos', path: '/system-diagnostics', permPath: '/system-diagnostics', keywords: 'diagnostico diagnosticos sistema' },
  { label: 'Ajuste de estoque', path: '/ajuste-estoque', permPath: '/ajuste-estoque', keywords: 'ajuste estoque ajustar' },
  { label: 'Imprimir fichas de operador', path: '/imprimir-fichas', permPath: '/imprimir-fichas', keywords: 'imprimir fichas operador' },
];

/** Destaca os tokens da busca dentro de um texto de resultado. */
function Highlight({ text, term }: { text: string | null | undefined; term: string }): ReactNode {
  if (!text) return null;
  const tokens = (term || '')
    .replace(/^\//, '')
    .split(/\s+/)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-primary/20 text-foreground rounded-[2px]">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

// Singleton guard: AppLayout renderiza o GlobalSearch em 3 lugares (sidebar
// expanded/collapsed/mobile). Sem isso, cada instância escuta o cmd+K e o
// usuário via 3 dialogs sobrepostos.
let activeShortcutOwner: symbol | null = null;

export function GlobalSearch({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [recent, setRecent] = useState<string[]>([]);
  const navigate = useNavigate();
  const [debouncedQuery] = useDebounce(query.trim(), 180);

  // Keyboard shortcut: Ctrl+K / Cmd+K — só a 1ª instância montada registra.
  useEffect(() => {
    const id = Symbol('global-search');
    if (activeShortcutOwner) return;
    activeShortcutOwner = id;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      if (activeShortcutOwner === id) activeShortcutOwner = null;
    };
  }, []);

  // Recarrega buscas recentes toda vez que abre.
  useEffect(() => { if (open) setRecent(loadRecent()); }, [open]);
  // Reseta scope ao fechar.
  useEffect(() => { if (!open) setScope('all'); }, [open]);

  const detectedType = useMemo(() => detectQueryType(query), [query]);
  const isGroupSearch = detectedType === 'group';
  // q normalizado (sem espaços/acentos) pra match com nav items locais.
  // "novo ped"/"NovoPed" devem casar com "Novo Pedido" — pedido user.
  const q = normalizeForSearch(query);

  // Busca por grupo: tira a "/" do começo. Busca normal: sanitiza pro PostgREST.
  const groupTerm = isGroupSearch ? sanitizeForPostgrestOr(debouncedQuery.replace(/^\//, '')) : '';
  const searchTerm = isGroupSearch ? '' : sanitizeForPostgrestOr(debouncedQuery);
  const hasMinChars = (isGroupSearch ? groupTerm : searchTerm).length >= 2;
  // Termo que normaliza pra vazio (só pontuação/símbolos, ex.: "..") NÃO pode
  // chegar nas queries: searchNormOrFilter('') = '' e .or('') vira `or=()` →
  // 400 do PostgREST + banner de erro. Sem [a-z0-9] não há o que buscar —
  // mostra "Nenhum resultado" sem bater no banco.
  const normOk = searchNormOrFilter(isGroupSearch ? groupTerm : searchTerm) !== '';
  const searchEnabled = open && hasMinChars && normOk && !isGroupSearch;
  const groupEnabled = open && hasMinChars && normOk && isGroupSearch;

  // Extrai dígitos sempre que houver ≥4 consecutivos — CNPJ truncado ("00012345")
  // não casa com "00.012.345/..." armazenado com pontos sem isso.
  const allDigits = searchTerm.replace(/\D/g, '');
  const cnpjDigits = allDigits.length >= 4 ? allDigits : '';

  const inScope = (s: Scope) => scope === 'all' || scope === s;

  // Permissões de menu: seções novas só aparecem se o usuário pode acessar a
  // tela correspondente (spec R8). canAccessRoute é a mesma régua do sidebar.
  const { canAccessRoute } = useAccessControl();
  const canSearchContractorServiceOrders = canAccessRoute('/terceirizados');
  const canSearchStrapServiceOrders = canAccessRoute('/tiras-artesanais');

  const [ordersQuery, clientsQuery, productsQuery, saleOrdersQuery, referencesQuery, suppliersQuery, purchaseOrdersQuery, contractorServiceOrdersQuery, strapServiceOrdersQuery, nfeQuery, employeesQuery, stockGroupsQuery, groupQuery] = useQueries({
    queries: [
      {
        queryKey: ['global-search-orders', searchTerm],
        enabled: searchEnabled && inScope('orders') && canAccessRoute('/orders'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          // search_norm (mig 20260911180000) cobre nº + cor + status sem
          // acento/caixa/hífen — "op00123" acha "OP-00123".
          const { data, error } = await supabase
            .from('orders')
            .select('id, order_number, status, color')
            .or(searchNormOrFilter(searchTerm))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-clients', searchTerm, cnpjDigits],
        enabled: searchEnabled && inScope('clients') && canAccessRoute('/clients'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          // search_norm (banco) cobre razao_social+nome_fantasia+client_number sem
          // acento/caixa; cnpj por dígitos continua casando a coluna crua.
          const orParts = [searchNormOrFilter(searchTerm)].filter(Boolean);
          if (cnpjDigits.length >= 4) orParts.push(`cnpj.ilike.%${cnpjDigits}%`);
          const { data, error } = await supabase
            .from('clients')
            .select('id, razao_social, cnpj, nome_fantasia, client_number, cidade')
            .or(orParts.join(','))
            .order('razao_social')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-products', searchTerm],
        enabled: searchEnabled && inScope('products') && canAccessRoute('/estoque'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          // search_norm cobre name+sku+color+technical_name sem acento/caixa
          // (ex.: "tamara" casa "NAPA SOFT TÂMARA").
          const { data, error } = await supabase
            .from('products')
            .select('id, name, sku, color, quantity, unit, product_groups(name)')
            .or(searchNormOrFilter(searchTerm))
            .order('updated_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-sale-orders', searchTerm, cnpjDigits],
        enabled: searchEnabled && inScope('sales') && canAccessRoute('/sales'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          // client_name via search_norm (sem acento/caixa); order_number e cnpj
          // (dígitos) continuam casando as colunas cruas.
          const orParts = [
            searchNormOrFilter(searchTerm),
            `order_number.ilike.%${searchTerm}%`,
          ].filter(Boolean);
          if (cnpjDigits.length >= 4) orParts.push(`client_cnpj.ilike.%${cnpjDigits}%`);
          const { data, error } = await supabase
            .from('sale_orders')
            .select('id, order_number, client_name, client_cnpj, status, total')
            .or(orParts.join(','))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Nomes de modelo vivem em technical_sheets.name (product_references
        // costuma ficar vazia neste DB). Buscamos as duas fontes e unimos.
        queryKey: ['global-search-references', searchTerm],
        enabled: searchEnabled && inScope('references') && canAccessRoute('/fichas-tecnicas'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const [refRes, sheetRes] = await Promise.all([
            supabase.from('product_references').select('id, name, shoe_category')
              .or(multiWordOr(['name'], searchTerm)).order('updated_at', { ascending: false }).limit(6),
            supabase.from('technical_sheets').select('id, name, shoe_category')
              .or(searchNormOrFilter(searchTerm)).order('updated_at', { ascending: false }).limit(6),
          ]);
          const fromRefs = (refRes.data ?? []).map(r => ({ id: r.id, name: r.name, category: r.shoe_category, source: 'product_references' as const }));
          const fromSheets = (sheetRes.data ?? []).map((r: any) => ({ id: r.id, name: r.name, category: r.shoe_category, source: 'technical_sheets' as const }));
          const seen = new Set<string>();
          return [...fromSheets, ...fromRefs].filter(r => {
            if (!r.name || seen.has(r.name)) return false;
            seen.add(r.name);
            return true;
          }).slice(0, 6);
        },
      },
      {
        queryKey: ['global-search-suppliers', searchTerm],
        enabled: searchEnabled && inScope('suppliers') && canAccessRoute('/suppliers'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          // search_norm cobre name+trade_name sem acento/caixa; cnpj por dígitos
          // continua casando a coluna crua.
          const orParts = [searchNormOrFilter(searchTerm)].filter(Boolean);
          if (cnpjDigits.length >= 4) orParts.push(`cnpj.ilike.%${cnpjDigits}%`);
          const { data, error } = await supabase
            .from('suppliers')
            .select('id, name, trade_name, cnpj, active')
            .or(orParts.join(','))
            .order('name')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // OCs — nº, fornecedor, status, notas via search_norm (spec R8).
        queryKey: ['global-search-purchase-orders', searchTerm],
        enabled: searchEnabled && inScope('purchases') && canAccessRoute('/purchase-orders'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('purchase_orders')
            .select('id, order_number, supplier_name, status, total_value')
            .or(searchNormOrFilter(searchTerm))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Domínio Terceirizados: a view exclui Tiras no servidor. Esta consulta
        // nem é habilitada para quem só possui acesso à Central de Tiras.
        queryKey: ['global-search-contractor-service-orders', searchTerm],
        enabled: searchEnabled && inScope('os') && canSearchContractorServiceOrders,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const orParts = [searchNormOrFilter(searchTerm)].filter(Boolean);
          const { data: byContractor, error: contractorSearchError } = await (supabase as any)
            .from('contractors')
            .select('id')
            .or(searchNormOrFilter(searchTerm))
            .limit(20);
          if (contractorSearchError) throw contractorSearchError;
          const contractorIds = (byContractor ?? []).map((c: any) => c.id);
          if (contractorIds.length > 0) orParts.push(`contractor_id.in.(${contractorIds.join(',')})`);
          let { data, error } = await (supabase as any)
            .from('v_non_strap_service_orders')
            .select('id, order_number, sector, status, total_value, contractor_id, created_at')
            .or(orParts.join(','))
            .order('created_at', { ascending: false })
            .limit(GLOBAL_SERVICE_ORDER_LIMIT);
          if (error) {
            if (!isMissingPostgrestRelation(error, 'v_non_strap_service_orders')) throw error;
            // Rollout fail-closed: carrega candidatos no schema antigo e remove
            // toda identidade de Tiras antes de expor um resultado genérico.
            const fallback = await (supabase as any)
              .from('service_orders')
              .select(SERVICE_ORDER_IDENTITY_SELECT)
              .or(orParts.join(','))
              .order('created_at', { ascending: false })
              .limit(GLOBAL_SERVICE_ORDER_LIMIT * 8);
            if (fallback.error) throw fallback.error;
            const candidates = fallback.data ?? [];
            const candidateIds = candidates.map((row: any) => row.id).filter(Boolean);
            const canonicalResult = candidateIds.length > 0
              ? await (supabase as any)
                .from('v_strap_service_order_items_operational')
                .select('service_order_id')
                .in('service_order_id', candidateIds)
              : { data: [], error: null };
            if (canonicalResult.error) throw canonicalResult.error;
            const canonicalIds = new Set((canonicalResult.data ?? []).map((row: any) => row.service_order_id));
            data = candidates
              .filter((row: any) => !isStrapServiceOrder({
                ...row,
                is_canonical_strap: canonicalIds.has(row.id),
              }))
              .slice(0, GLOBAL_SERVICE_ORDER_LIMIT);
            error = null;
          }
          const rows = data ?? [];
          if (rows.length === 0) return rows;
          const resultContractorIds = Array.from(new Set(rows.map((row: any) => row.contractor_id).filter(Boolean)));
          const { data: contractors, error: contractorsError } = await (supabase as any)
            .from('contractors')
            .select('id, name')
            .in('id', resultContractorIds);
          if (contractorsError) throw contractorsError;
          const contractorNameById = new Map((contractors ?? []).map((row: any) => [row.id, row.name]));
          return rows.map((row: any) => ({
            ...row,
            contractors: { name: contractorNameById.get(row.contractor_id) || null },
          }));
        },
      },
      {
        // Domínio Tiras: a view operacional traz a identidade canônica sem
        // materializar OS genéricas. A segunda fonte é a view positiva de
        // identidade legada/canônica, preservando OS antigas sem consultar o
        // dataset de Terceirizados para quem não pode acessá-lo.
        queryKey: ['global-search-strap-service-orders', searchTerm],
        enabled: searchEnabled && inScope('os') && canSearchStrapServiceOrders,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const [{ data: canonicalRows, error: canonicalError }, contractorSearch] = await Promise.all([
            (supabase as any)
              .from('v_strap_service_order_items_operational')
              .select('service_order_id, service_order_number, service_order_status, contractor_id, contractor_name, base_product_name, finished_product_name, needed_at')
              .or(multiWordOr([
                'service_order_number',
                'service_order_status',
                'contractor_name',
                'base_product_name',
                'finished_product_name',
              ], searchTerm))
              .order('needed_at', { ascending: false })
              .limit(GLOBAL_SERVICE_ORDER_LIMIT),
            (supabase as any)
              .from('contractors')
              .select('id')
              .or(searchNormOrFilter(searchTerm))
              .limit(20),
          ]);
          if (canonicalError) throw canonicalError;
          if (contractorSearch.error) throw contractorSearch.error;

          const legacySearchParts = [searchNormOrFilter(searchTerm)].filter(Boolean);
          const contractorIds = (contractorSearch.data ?? []).map((row: any) => row.id);
          if (contractorIds.length > 0) legacySearchParts.push(`contractor_id.in.(${contractorIds.join(',')})`);
          let { data: legacyRows, error: legacyError } = await (supabase as any)
            .from('v_strap_service_orders')
            .select(SERVICE_ORDER_IDENTITY_SELECT)
            .or(legacySearchParts.join(','))
            .order('created_at', { ascending: false })
            .limit(GLOBAL_SERVICE_ORDER_LIMIT);
          if (legacyError) {
            if (!isMissingPostgrestRelation(legacyError, 'v_strap_service_orders')) throw legacyError;
            const fallback = await (supabase as any)
              .from('service_orders')
              .select(SERVICE_ORDER_IDENTITY_SELECT)
              .or(legacySearchParts.join(','))
              .order('created_at', { ascending: false })
              .limit(GLOBAL_SERVICE_ORDER_LIMIT * 8);
            if (fallback.error) throw fallback.error;
            legacyRows = (fallback.data ?? [])
              .filter((row: any) => isStrapServiceOrder(row))
              .slice(0, GLOBAL_SERVICE_ORDER_LIMIT);
            legacyError = null;
          }

          const legacyContractorIds = Array.from(new Set((legacyRows ?? []).map((row: any) => row.contractor_id).filter(Boolean)));
          const legacyContractorsResult = legacyContractorIds.length > 0
            ? await (supabase as any).from('contractors').select('id, name').in('id', legacyContractorIds)
            : { data: [], error: null };
          if (legacyContractorsResult.error) throw legacyContractorsResult.error;
          const legacyContractorNames = new Map((legacyContractorsResult.data ?? []).map((row: any) => [row.id, row.name]));

          const unique = new Map<string, any>();
          for (const row of canonicalRows ?? []) {
            if (!unique.has(row.service_order_id)) {
              unique.set(row.service_order_id, {
                id: row.service_order_id,
                order_number: row.service_order_number,
                sector: 'Tiras',
                status: row.service_order_status,
                total_value: null,
                contractors: { name: row.contractor_name || null },
                is_canonical_strap: true,
              });
            }
          }
          for (const row of legacyRows ?? []) {
            if (!unique.has(row.id)) {
              unique.set(row.id, {
                ...row,
                contractors: { name: legacyContractorNames.get(row.contractor_id) || null },
                is_canonical_strap: false,
              });
            }
          }
          return [...unique.values()]
            .sort((a, b) => (b.order_number || '').localeCompare(a.order_number || '', 'pt-BR', { numeric: true }))
            .slice(0, GLOBAL_SERVICE_ORDER_LIMIT);
        },
      },
      {
        // NF-e — nº, série, chave de acesso, destinatário (nome/CNPJ) via search_norm.
        queryKey: ['global-search-nfe', searchTerm],
        enabled: searchEnabled && inScope('nfe') && canAccessRoute('/nfe'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('nfe_emitidas')
            .select('id, numero, serie, status, nome_destinatario, valor_total, chave_acesso')
            .or(searchNormOrFilter(searchTerm))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Funcionários — nome/cargo/setor/CPF/telefone via search_norm.
        queryKey: ['global-search-employees', searchTerm],
        enabled: searchEnabled && inScope('employees') && canAccessRoute('/rh'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('employees')
            .select('id, name, role, department, active')
            .or(searchNormOrFilter(searchTerm))
            .order('name')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Grupos de estoque — nome/descrição/cores/setor via search_norm.
        queryKey: ['global-search-stock-groups', searchTerm],
        enabled: searchEnabled && inScope('groups') && canAccessRoute('/grupos'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('product_groups')
            .select('id, name, sector, colors')
            .or(searchNormOrFilter(searchTerm))
            .order('name')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Busca por grupo econômico (prefixo "/"). Encadeia:
        // economic_groups → clients (economic_group_id) → sale_orders (client_id)
        // → orders (sale_order_id). Mostra o grupo + um preview dos PVs e OPs.
        queryKey: ['global-search-group', groupTerm],
        enabled: groupEnabled && canAccessRoute('/clients'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const empty = { groups: [], saleOrders: [], orders: [], clientCount: 0 };
          const { data: groups, error: gErr } = await supabase
            .from('economic_groups')
            .select('id, name, group_number')
            .or(searchNormOrFilter(groupTerm))
            .limit(5);
          if (gErr) throw gErr;
          if (!groups || groups.length === 0) return empty;

          const groupIds = groups.map(g => g.id);
          const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, economic_group_id')
            .in('economic_group_id', groupIds);
          if (cErr) throw cErr;
          const clientIds = (clients ?? []).map(c => c.id);
          if (clientIds.length === 0) return { ...empty, groups };

          const { data: saleOrders, error: soErr } = await supabase
            .from('sale_orders')
            .select('id, order_number, client_name, status')
            .in('client_id', clientIds)
            .order('created_at', { ascending: false })
            .limit(10);
          if (soErr) throw soErr;

          const soIds = (saleOrders ?? []).map(s => s.id);
          let orders: any[] = [];
          if (soIds.length > 0) {
            const { data: ords } = await supabase
              .from('orders')
              .select('id, order_number, status, sale_order_id')
              .in('sale_order_id', soIds)
              .order('created_at', { ascending: false })
              .limit(10);
            orders = ords ?? [];
          }
          return { groups, saleOrders: saleOrders ?? [], orders, clientCount: clientIds.length };
        },
      },
    ],
  });

  const orders = searchEnabled ? (ordersQuery.data ?? []) : [];
  const clients = searchEnabled ? (clientsQuery.data ?? []) : [];
  const products = searchEnabled ? (productsQuery.data ?? []) : [];
  const saleOrders = searchEnabled ? (saleOrdersQuery.data ?? []) : [];
  const references = searchEnabled ? (referencesQuery.data ?? []) : [];
  const suppliers = searchEnabled ? (suppliersQuery.data ?? []) : [];
  const purchaseOrders = searchEnabled ? (purchaseOrdersQuery.data ?? []) : [];
  const serviceOrders = searchEnabled && canSearchContractorServiceOrders
    ? (contractorServiceOrdersQuery.data ?? [])
    : [];
  const strapServiceOrders = searchEnabled && canSearchStrapServiceOrders
    ? (strapServiceOrdersQuery.data ?? [])
    : [];
  const nfes = searchEnabled ? (nfeQuery.data ?? []) : [];
  const employees = searchEnabled ? (employeesQuery.data ?? []) : [];
  const stockGroups = searchEnabled ? (stockGroupsQuery.data ?? []) : [];
  const groupResult = groupEnabled ? (groupQuery.data ?? null) : null;

  // Páginas (atalhos) — busca local, instantânea. A superfície `command` do
  // catálogo já inclui sidebar, Sistema e rotas secundárias sem remontar listas.
  const filteredNavItems = useMemo(() => {
    if (!q || q.length < 1 || isGroupSearch) return [];
    return navigationCatalog
      .filter((item) => item.surfaces.includes('command'))
      .filter((item) => normalizeForSearch(item.label).includes(q) || normalizeForSearch(item.group).includes(q))
      .filter((item) => canAccessRoute(item.path))
      .map((item) => ({ name: item.label, icon: item.icon, path: item.path, groupLabel: item.group }));
  }, [q, isGroupSearch, canAccessRoute]);

  const goTo = useCallback((path: string, persistTerm?: string, recentItem?: RecentItem) => {
    if (persistTerm) pushRecent(persistTerm);
    if (recentItem) pushRecentItem(recentItem);
    setOpen(false);
    setQuery('');
    navigate(path);
  }, [navigate]);

  // Itens acessados recentemente (spec R9b) — recarrega a cada abertura.
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  useEffect(() => { if (open) setRecentItems(loadRecentItems()); }, [open]);

  // Ações rápidas: filtradas por permissão de menu + termo digitado (spec R9d).
  const quickActions = useMemo(() => {
    if (isGroupSearch) return [];
    return QUICK_ACTIONS.filter(a =>
      canAccessRoute(a.permPath) && searchMatchesAllTerms(query, a.label, a.keywords),
    );

  }, [query, isGroupSearch, canAccessRoute]);

  // Favoritos de menu (mesma fonte da sidebar — persistido por usuário).
  const { favorites, toggleFavorite, isFavorite } = useMenuFavorites();

  /** Estrela de favoritar uma página, embutida numa CommandItem. Para o clique
   *  ANTES do cmdk pra não navegar ao favoritar (mouseDown + click). */
  const FavStar = ({ name, path }: { name: string; path: string }) => {
    const fav = isFavorite(path);
    return (
      <button
        type="button"
        aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        title={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        className={cn(
          'shrink-0 rounded p-1 transition-colors',
          // text-primary: mesma cor da estrela de favorito da sidebar (AppLayout)
          fav ? 'text-primary hover:text-primary/70' : 'text-muted-foreground/50 hover:text-primary',
        )}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(name, path); }}
      >
        <Star className="h-3.5 w-3.5" weight={fav ? 'fill' : 'regular'} />
      </button>
    );
  };

  const isLoading = searchEnabled && (
    ordersQuery.isFetching || clientsQuery.isFetching || productsQuery.isFetching ||
    saleOrdersQuery.isFetching || referencesQuery.isFetching || suppliersQuery.isFetching ||
    purchaseOrdersQuery.isFetching || contractorServiceOrdersQuery.isFetching || strapServiceOrdersQuery.isFetching || nfeQuery.isFetching ||
    employeesQuery.isFetching || stockGroupsQuery.isFetching
  );
  const groupLoading = groupEnabled && groupQuery.isFetching;
  const totalResults = filteredNavItems.length + quickActions.length + orders.length + clients.length +
    products.length + saleOrders.length + references.length + suppliers.length +
    purchaseOrders.length + serviceOrders.length + strapServiceOrders.length + nfes.length + employees.length + stockGroups.length;
  const groupTotal = groupResult
    ? groupResult.groups.length + groupResult.saleOrders.length + groupResult.orders.length
    : 0;
  const queryError = ordersQuery.error || clientsQuery.error || productsQuery.error ||
    saleOrdersQuery.error || referencesQuery.error || suppliersQuery.error ||
    purchaseOrdersQuery.error || contractorServiceOrdersQuery.error || strapServiceOrdersQuery.error || nfeQuery.error ||
    employeesQuery.error || stockGroupsQuery.error || groupQuery.error;

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          title="Buscar (⌘K) — pedidos, clientes, páginas"
          aria-label="Abrir busca global (atalho Command+K)"
          className="flex items-center justify-center h-7 w-7 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir busca global (atalho Command+K)"
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
            'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            'border border-sidebar-border/40 bg-sidebar-accent/20'
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Buscar pedidos, clientes...</span>
          <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-sidebar-border/60 bg-sidebar-background/80 px-1.5 font-mono text-xs font-semibold text-sidebar-foreground/80 shrink-0">
            ⌘K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 max-w-2xl gap-0 overflow-hidden [&>button]:hidden">
          <DialogTitle className="sr-only">Busca global</DialogTitle>
          <DialogDescription className="sr-only">Busque pedidos, clientes, modelos e fornecedores. Atalho: Command+K</DialogDescription>
          <Command shouldFilter={false} className="rounded-lg">
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <CommandInput
                placeholder="Buscar pedidos, clientes, OCs, OSs, NF-e, pessoas…  ( / = grupo econômico )"
                value={query}
                onValueChange={setQuery}
                className="border-0 focus:ring-0"
              />
              {q && detectedType !== 'general' && (
                <Badge variant="secondary" className="text-xs shrink-0 mr-2">
                  {TYPE_LABELS[detectedType]}
                </Badge>
              )}
              {q && (
                <button onClick={() => setQuery('')} aria-label="Limpar busca" className="p-1 rounded hover:bg-muted">
                  <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Chips de escopo — só na busca geral (busca por grupo tem fluxo próprio) */}
            {q && hasMinChars && !isGroupSearch && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto">
                {SCOPES.map(s => (
                  <button
                    key={s.key}
                    onClick={() => setScope(s.key)}
                    aria-pressed={scope === s.key}
                    className={cn(
                      'shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold tracking-tight transition-colors',
                      scope === s.key
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <CommandList className="max-h-[420px]">
              {/* Estado vazio: itens acessados + buscas recentes + atalhos */}
              {!q && (
                <div className="overflow-y-auto max-h-[320px]">
                  {recentItems.length > 0 && (
                    <CommandGroup heading="Acessados recentemente">
                      {recentItems.map(item => {
                        const Icon = RECENT_ITEM_ICON[item.type] ?? ArrowRight;
                        return (
                          <CommandItem key={`${item.type}:${item.id}`} onSelect={() => goTo(item.href, undefined, item)}>
                            <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium truncate">{item.label}</span>
                            {item.meta && <span className="ml-2 text-xs text-muted-foreground truncate">{item.meta}</span>}
                            <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground shrink-0" />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                  {recent.length > 0 && (
                    <CommandGroup heading="Buscas recentes">
                      {recent.map(term => (
                        <CommandItem key={term} onSelect={() => setQuery(term)}>
                          <Clock className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs">{term}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading="Favoritos / Atalhos">
                    <CommandItem onSelect={() => goTo('/dashboard')}>
                      <Home className="mr-2 h-3.5 w-3.5 text-primary" />
                      Início (Dashboard)
                    </CommandItem>
                    {favorites.filter(fav => canAccessRoute(fav.path)).map((fav) => (
                      <CommandItem key={fav.path} onSelect={() => goTo(fav.path)}>
                        <Star className="mr-2 h-3.5 w-3.5 text-primary" weight="fill" />
                        <span className="text-sm">{fav.name}</span>
                        <span className="ml-auto flex items-center gap-0.5 shrink-0">
                          <FavStar name={fav.name} path={fav.path} />
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {menuGroups.map((group) => {
                    const allowedItems = group.items.filter(item => canAccessRoute(item.path));
                    if (allowedItems.length === 0) return null;
                    return (
                      <CommandGroup key={group.label} heading={group.label}>
                        {allowedItems.map((item) => (
                          <CommandItem key={item.path} onSelect={() => goTo(item.path)}>
                            <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                            {item.label}
                            <span className="ml-auto shrink-0">
                              <FavStar name={item.label} path={item.path} />
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    );
                  })}
                </div>
              )}

              {/* Hint: digitou mas não atingiu o mínimo */}
              {q && !hasMinChars && filteredNavItems.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {isGroupSearch
                    ? 'Digite o nome do grupo econômico após a "/".'
                    : 'Digite pelo menos 2 caracteres pra buscar.'}
                </div>
              )}

              {/* ───────── MODO GRUPO ECONÔMICO ───────── */}
              {isGroupSearch && hasMinChars && (
                <>
                  {groupLoading && groupTotal === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">Buscando grupo…</div>
                  )}
                  {!groupLoading && !queryError && groupResult && groupResult.groups.length === 0 && (
                    <CommandEmpty>
                      <div className="py-2">
                        <p>Nenhum grupo econômico para "{groupTerm}"</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Digite parte do nome do grupo após a "/".
                        </p>
                      </div>
                    </CommandEmpty>
                  )}
                  {groupResult && groupResult.groups.length > 0 && (
                    <>
                      <CommandGroup heading="Grupo econômico">
                        {groupResult.groups.map((g: any) => (
                          <CommandItem key={g.id} onSelect={() => goTo(`/grupos-economicos/${g.id}`, query)}>
                            <Buildings className="mr-2 h-3.5 w-3.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold truncate">
                                <Highlight text={g.name} term={groupTerm} />
                              </span>
                              {g.group_number != null && (
                                <span className="text-muted-foreground text-xs ml-2 font-mono">#{g.group_number}</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">ver 360°</span>
                            <ArrowRight className="ml-1.5 h-3 w-3 text-muted-foreground shrink-0" />
                          </CommandItem>
                        ))}
                      </CommandGroup>

                      {groupResult.saleOrders.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading={`Pedidos de venda do grupo (${groupResult.saleOrders.length})`}>
                            {groupResult.saleOrders.map((so: any) => (
                              <CommandItem key={so.id} onSelect={() => goTo(`/sales/edit/${so.id}`, query)}>
                                <FileText className="mr-2 h-3.5 w-3.5 text-success" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-semibold">{so.order_number}</span>
                                  <span className="text-muted-foreground text-xs ml-2 truncate">{so.client_name}</span>
                                </div>
                                <Badge variant="outline" className="text-xs shrink-0">{so.status}</Badge>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}

                      {groupResult.orders.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading={`Ordens de produção do grupo (${groupResult.orders.length})`}>
                            {groupResult.orders.map((op: any) => (
                              <CommandItem key={op.id} onSelect={() => goTo(`/orders/${op.id}/edit`, query)}>
                                <ClipboardList className="mr-2 h-3.5 w-3.5 text-primary" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-semibold">{op.order_number}</span>
                                </div>
                                <Badge variant="outline" className="text-xs shrink-0">{op.status}</Badge>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ───────── MODO BUSCA GERAL ───────── */}
              {!isGroupSearch && q && hasMinChars && isLoading && totalResults === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">Buscando…</div>
              )}

              {q && hasMinChars && !isLoading && queryError && (
                <div className="py-6 text-center text-sm">
                  <p className="text-destructive font-medium">Erro ao buscar</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    {String((queryError as any)?.message ?? queryError).slice(0, 200)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Verifique sua conexão e tente de novo. Se persistir, contate o suporte.
                  </p>
                </div>
              )}

              {!isGroupSearch && q && hasMinChars && !isLoading && !queryError && totalResults === 0 && (
                <CommandEmpty>
                  <div className="py-2">
                    <p>Nenhum resultado para "{query}"</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Tente nº do pedido (OP-…), nome do cliente, CNPJ, produto — ou "/" + nome do grupo econômico.
                    </p>
                  </div>
                </CommandEmpty>
              )}

              {/* Ações rápidas (spec R9d) — só com busca ativa; permissão via canAccessRoute */}
              {!isGroupSearch && q && quickActions.length > 0 && (
                <CommandGroup heading="Ações rápidas">
                  {quickActions.map(a => (
                    <CommandItem key={a.path} onSelect={() => goTo(a.path)}>
                      {a.label.startsWith('Criar') || a.label.startsWith('Novo') || a.label.startsWith('Nova')
                        ? <Plus className="mr-2 h-3.5 w-3.5 text-primary" />
                        : <Lightning className="mr-2 h-3.5 w-3.5 text-primary" />}
                      <span className="text-xs font-medium">{a.label}</span>
                      <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground shrink-0" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {filteredNavItems.length > 0 && (
                <CommandGroup heading="Páginas">
                  {filteredNavItems.map(item => (
                    <CommandItem key={item.path} onSelect={() => goTo(item.path, undefined, { type: 'page', id: item.path, label: item.name, href: item.path, meta: item.groupLabel })}>
                      <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium"><Highlight text={item.name} term={q} /></span>
                      <span className="ml-2 text-xs text-muted-foreground">{item.groupLabel}</span>
                      <span className="ml-auto flex items-center gap-0.5 shrink-0">
                        <FavStar name={item.name} path={item.path} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {orders.length > 0 && (
                <CommandGroup heading={`Ordens de Produção (${orders.length})`}>
                  {orders.map((op: any) => (
                    <CommandItem
                      key={op.id}
                      onSelect={() => goTo(`/orders/${op.id}/edit`, query, { type: 'op', id: op.id, label: op.order_number, href: `/orders/${op.id}/edit`, meta: op.color || undefined })}
                    >
                      <ClipboardList className="mr-2 h-3.5 w-3.5 text-primary" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs font-semibold">
                          <Highlight text={op.order_number} term={searchTerm} />
                        </span>
                        {op.color && <span className="text-muted-foreground text-xs ml-2">{op.color}</span>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">{op.status}</Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {saleOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Pedidos de Venda (${saleOrders.length})`}>
                    {saleOrders.map((so: any) => (
                      <CommandItem
                        key={so.id}
                        onSelect={() => goTo(`/sales/edit/${so.id}`, query, { type: 'pv', id: so.id, label: `${so.order_number} · ${so.client_name ?? ''}`.trim(), href: `/sales/edit/${so.id}` })}
                      >
                        <FileText className="mr-2 h-3.5 w-3.5 text-success" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            <Highlight text={so.order_number} term={searchTerm} />
                          </span>
                          <span className="text-muted-foreground text-xs ml-2 truncate">
                            <Highlight text={so.client_name} term={searchTerm} />
                          </span>
                        </div>
                        {so.total != null && Number(so.total) > 0 && (
                          <span className="text-xs font-mono text-muted-foreground shrink-0 mr-2">{formatCurrency(so.total)}</span>
                        )}
                        <Badge variant="outline" className="text-xs shrink-0">{so.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {clients.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Clientes (${clients.length})`}>
                    {clients.map((c: any) => (
                      <CommandItem
                        key={c.id}
                        onSelect={() => goTo(`/clients?q=${encodeURIComponent(c.razao_social || c.cnpj || '')}`, query, { type: 'client', id: c.id, label: c.razao_social || c.nome_fantasia || c.cnpj || 'Cliente', href: `/clients?q=${encodeURIComponent(c.razao_social || c.cnpj || '')}`, meta: c.cidade || undefined })}
                      >
                        <Users className="mr-2 h-3.5 w-3.5 text-warning" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={c.razao_social} term={searchTerm} />
                          </span>
                          {c.cidade && <span className="text-muted-foreground text-xs ml-2">{c.cidade}</span>}
                          {c.cnpj && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={c.cnpj} term={searchTerm} />
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {suppliers.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Fornecedores (${suppliers.length})`}>
                    {suppliers.map((s: any) => (
                      <CommandItem
                        key={s.id}
                        onSelect={() => goTo(`/suppliers?q=${encodeURIComponent(s.trade_name || s.name || '')}`, query)}
                      >
                        <Buildings className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={s.trade_name || s.name} term={searchTerm} />
                          </span>
                          {s.cnpj && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={s.cnpj} term={searchTerm} />
                            </span>
                          )}
                        </div>
                        {s.active === false && <Badge variant="outline" className="text-xs shrink-0">inativo</Badge>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {products.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Materiais / Estoque (${products.length})`}>
                    {products.map((p: any) => (
                      <CommandItem
                        key={p.id}
                        onSelect={() => goTo(`/estoque?q=${encodeURIComponent(p.sku || p.name || '')}`, query, { type: 'product', id: p.id, label: p.name, href: `/estoque?q=${encodeURIComponent(p.sku || p.name || '')}`, meta: p.product_groups?.name || undefined })}
                      >
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={p.name} term={searchTerm} />
                          </span>
                          {p.color && <span className="text-muted-foreground text-xs ml-1">({p.color})</span>}
                          {p.product_groups?.name && (
                            <span className="text-muted-foreground text-xs ml-2 truncate">{p.product_groups.name}</span>
                          )}
                          {p.sku && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={p.sku} term={searchTerm} />
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {Number(p.quantity).toLocaleString('pt-BR')} {p.unit}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {references.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Modelos / Referências (${references.length})`}>
                    {references.map((r: any) => (
                      <CommandItem
                        key={r.id}
                        onSelect={() => goTo(`/fichas-tecnicas?q=${encodeURIComponent(r.name)}`, query)}
                      >
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={r.name} term={searchTerm} />
                          </span>
                          {r.category && <span className="text-muted-foreground text-xs ml-2">({r.category})</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {purchaseOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Ordens de Compra (${purchaseOrders.length})`}>
                    {purchaseOrders.map((po: any) => (
                      <CommandItem
                        key={po.id}
                        onSelect={() => goTo(`/purchase-orders?q=${encodeURIComponent(po.order_number || '')}`, query, { type: 'oc', id: po.id, label: `${po.order_number} · ${po.supplier_name ?? 'Sem fornecedor'}`, href: `/purchase-orders?q=${encodeURIComponent(po.order_number || '')}` })}
                      >
                        <ShoppingBag className="mr-2 h-3.5 w-3.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            <Highlight text={po.order_number} term={searchTerm} />
                          </span>
                          <span className="text-muted-foreground text-xs ml-2 truncate">
                            <Highlight text={po.supplier_name} term={searchTerm} />
                          </span>
                        </div>
                        {po.total_value != null && Number(po.total_value) > 0 && (
                          <span className="text-xs font-mono text-muted-foreground shrink-0 mr-2">{formatCurrency(po.total_value)}</span>
                        )}
                        <Badge variant="outline" className="text-xs shrink-0">{po.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {serviceOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Ordens de Serviço (${serviceOrders.length})`}>
                    {serviceOrders.map((os: any) => (
                      <CommandItem
                        key={os.id}
                        onSelect={() => goTo(`/terceirizados?tab=orders&q=${encodeURIComponent(os.order_number || '')}`, query, { type: 'os', id: os.id, label: `${os.order_number} · ${os.contractors?.name ?? 'Sem prestador'}`, href: `/terceirizados?tab=orders&q=${encodeURIComponent(os.order_number || '')}`, meta: os.sector || undefined })}
                      >
                        <Truck className="mr-2 h-3.5 w-3.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            <Highlight text={os.order_number} term={searchTerm} />
                          </span>
                          {os.contractors?.name && (
                            <span className="text-muted-foreground text-xs ml-2 truncate">
                              <Highlight text={os.contractors.name} term={searchTerm} />
                            </span>
                          )}
                          {os.sector && <span className="text-muted-foreground text-xs ml-2">({os.sector})</span>}
                        </div>
                        <Badge variant="outline" className="text-xs shrink-0">{os.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {strapServiceOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Ordens de Tiras (${strapServiceOrders.length})`}>
                    {strapServiceOrders.map((os: any) => {
                      const href = os.is_canonical_strap
                        ? `/tiras-artesanais?tab=producao&q=${encodeURIComponent(os.order_number || '')}`
                        : '/tiras-artesanais?tab=diagnostico';
                      return (
                        <CommandItem
                          key={os.id}
                          onSelect={() => goTo(href, query, {
                            type: 'os',
                            id: os.id,
                            label: `${os.order_number} · ${os.contractors?.name ?? 'Sem prestador'}`,
                            href,
                            meta: 'Tiras',
                          })}
                        >
                          <Scissors className="mr-2 h-3.5 w-3.5 text-primary" />
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-xs font-semibold">
                              <Highlight text={os.order_number} term={searchTerm} />
                            </span>
                            {os.contractors?.name && (
                              <span className="ml-2 truncate text-xs text-muted-foreground">
                                <Highlight text={os.contractors.name} term={searchTerm} />
                              </span>
                            )}
                          </div>
                          <Badge variant="outline" className="shrink-0 text-xs">
                            {os.is_canonical_strap ? os.status : 'Histórica'}
                          </Badge>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}

              {nfes.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`NF-e (${nfes.length})`}>
                    {nfes.map((nf: any) => (
                      <CommandItem
                        key={nf.id}
                        onSelect={() => goTo(`/nfe?q=${encodeURIComponent(nf.numero || nf.chave_acesso || '')}`, query, { type: 'nfe', id: nf.id, label: `NF ${nf.numero ?? 's/nº'} · ${nf.nome_destinatario ?? ''}`.trim(), href: `/nfe?q=${encodeURIComponent(nf.numero || nf.chave_acesso || '')}` })}
                      >
                        <Receipt className="mr-2 h-3.5 w-3.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            <Highlight text={nf.numero ? `NF ${nf.numero}` : 'NF s/nº'} term={searchTerm} />
                          </span>
                          {nf.nome_destinatario && (
                            <span className="text-muted-foreground text-xs ml-2 truncate">
                              <Highlight text={nf.nome_destinatario} term={searchTerm} />
                            </span>
                          )}
                        </div>
                        {nf.valor_total != null && Number(nf.valor_total) > 0 && (
                          <span className="text-xs font-mono text-muted-foreground shrink-0 mr-2">{formatCurrency(nf.valor_total)}</span>
                        )}
                        <Badge variant="outline" className="text-xs shrink-0">{nf.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {employees.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Funcionários (${employees.length})`}>
                    {employees.map((e: any) => (
                      <CommandItem
                        key={e.id}
                        onSelect={() => goTo(`/rh?tab=funcionarios&q=${encodeURIComponent(e.name || '')}`, query, { type: 'employee', id: e.id, label: e.name, href: `/rh?tab=funcionarios&q=${encodeURIComponent(e.name || '')}`, meta: e.role || undefined })}
                      >
                        <UserCircle className="mr-2 h-3.5 w-3.5 text-warning" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={e.name} term={searchTerm} />
                          </span>
                          {e.role && <span className="text-muted-foreground text-xs ml-2">{e.role}</span>}
                          {e.department && <span className="text-muted-foreground text-xs ml-1">· {e.department}</span>}
                        </div>
                        {e.active === false && <Badge variant="outline" className="text-xs shrink-0">inativo</Badge>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {stockGroups.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Grupos de Estoque (${stockGroups.length})`}>
                    {stockGroups.map((g: any) => (
                      <CommandItem
                        key={g.id}
                        onSelect={() => goTo(`/grupos?q=${encodeURIComponent(g.name || '')}`, query, { type: 'group', id: g.id, label: g.name, href: `/grupos?q=${encodeURIComponent(g.name || '')}`, meta: g.sector || undefined })}
                      >
                        <FolderOpen className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={g.name} term={searchTerm} />
                          </span>
                          {g.sector && <span className="text-muted-foreground text-xs ml-2">{g.sector}</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {q && hasMinChars && (totalResults > 0 || groupTotal > 0) && (
              <div className="border-t border-border p-2 flex items-center justify-between px-3">
                <span className="text-xs text-muted-foreground">
                  {(() => { const n = isGroupSearch ? groupTotal : totalResults; return `${n} ${n === 1 ? 'resultado' : 'resultados'}`; })()}
                  {isGroupSearch && groupResult && groupResult.clientCount > 0 && (
                    <span> · {groupResult.clientCount} {groupResult.clientCount === 1 ? 'loja' : 'lojas'} no grupo</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground font-mono">↑↓ navegar · ↵ abrir</span>
              </div>
            )}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
