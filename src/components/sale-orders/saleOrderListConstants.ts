import { getValidNextStatuses } from '@/lib/saleOrderStateMachine';
import { parseDateOnly } from '@/lib/dateOnly';

export const STATUS_OPTIONS = [
  'Rascunho',
  'Pendente',
  'Aprovado',
  'Em Produção',
  'Faturado',
  'Expedido',
  'Concluído',
  'Finalizado s/ NF',
  'Cancelado',
] as const;

export type SortKey =
  | 'order_number'
  | 'client_name'
  | 'total'
  | 'status'
  | 'pairs'
  | 'delivery_deadline';

export const SORT_ACCESSORS: Record<
  SortKey,
  (o: any, pairs: Record<string, number>) => string | number | null
> = {
  order_number: (o) => o.order_number ?? null,
  client_name: (o) => o.client_name ?? null,
  total: (o) => Number(o.total) || 0,
  status: (o) => o.status ?? null,
  pairs: (o, pairs) => pairs[o.id] ?? 0,
  delivery_deadline: (o) => o.delivery_deadline ?? null,
};

export const STATUS_TRANSITION_OPTIONS: Record<string, readonly string[]> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => {
    const allowed = new Set<string>([s, ...getValidNextStatuses(s)]);
    return [s, STATUS_OPTIONS.filter((o) => allowed.has(o))];
  }),
);

export const STATUS_COLORS: Record<string, string> = {
  Rascunho: 'bg-muted text-muted-foreground border-border',
  Pendente: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  Aprovado: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'Em Produção': 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  Faturado: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  Expedido: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  Concluído: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  'Finalizado s/ NF': 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  Cancelado: 'bg-destructive/15 text-destructive border-destructive/30',
};

export const STATUS_DOT: Record<string, string> = {
  Rascunho: 'bg-muted-foreground',
  Pendente: 'bg-yellow-500',
  Aprovado: 'bg-emerald-500',
  'Em Produção': 'bg-blue-500',
  Faturado: 'bg-violet-500',
  Expedido: 'bg-cyan-500',
  Concluído: 'bg-green-500',
  'Finalizado s/ NF': 'bg-amber-500',
  Cancelado: 'bg-destructive',
};

export const STATUS_BAND: Record<string, string> = {
  Rascunho: 'bg-muted/40',
  Pendente: 'bg-yellow-500/5',
  Aprovado: 'bg-emerald-500/5',
  'Em Produção': 'bg-blue-500/5',
  Faturado: 'bg-violet-500/5',
  Expedido: 'bg-cyan-500/5',
  Concluído: 'bg-green-500/5',
  'Finalizado s/ NF': 'bg-amber-500/5',
  Cancelado: 'bg-destructive/5',
};

export const TERMINAL_BILLED_STATUSES = ['Faturado', 'Finalizado s/ NF'];

const BRL_FMT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE_FMT = new Intl.DateTimeFormat('pt-BR');
const DATE_SHORT_FMT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export const formatSaleOrderCurrency = (v: number) => BRL_FMT.format(v);
export const formatSaleOrderDate = (d: string | null) =>
  d ? DATE_FMT.format(parseDateOnly(d)) : '—';
export const formatSaleOrderDateShort = (d: string) =>
  DATE_SHORT_FMT.format(parseDateOnly(d));
