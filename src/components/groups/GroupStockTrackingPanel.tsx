import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClockCounterClockwise,
  CloudSlash,
  ArrowCircleDown,
  CircleNotch as Loader2,
} from '@phosphor-icons/react';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useGroupStockTracking,
  type GroupStockTrackingAllocation,
  type GroupStockTrackingRow,
} from '@/hooks/useGroupStockTracking';

/**
 * Aba "Rastreio" da janela do grupo de estoque (spec
 * `specs/integracao-estoque-pv-compras.md`, Q20): cada entrada do grupo com o
 * rateio que ela fez para os PVs em falta, e o que ficou livre.
 *
 * Degrada em silêncio: se `list_group_stock_tracking` falhar (ou ainda não
 * existir no banco), mostra "Rastreio indisponível" — sem toast.
 */

interface GroupStockTrackingPanelProps {
  groupId: string;
  /** Itens do grupo — de onde sai a lista do filtro de cor. */
  products: ReadonlyArray<{ id: string; color?: string | null }>;
  /** Chamado ao clicar num PV (a janela fecha antes de navegar). */
  onNavigate?: () => void;
}

const ALL = '__all__';
const TRACKING_LIMIT = 200;

const QTY_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** `movement_reason` / `origin_type` → rótulo pt-BR. Desconhecido: o texto cru. */
const ORIGIN_LABELS: Record<string, string> = {
  compra: 'Compra',
  purchase: 'Compra',
  purchase_order: 'Compra',
  purchase_receipt: 'Compra',
  oc: 'Compra',
  nf: 'NF de entrada',
  nfe: 'NF de entrada',
  nf_entrada: 'NF de entrada',
  xml: 'NF de entrada',
  ajuste: 'Ajuste',
  adjustment: 'Ajuste',
  inventario: 'Inventário',
  inventory: 'Inventário',
  estorno: 'Estorno',
  devolucao: 'Devolução',
  producao: 'Produção',
  transferencia: 'Transferência',
  entrada: 'Entrada',
};

function originLabel(origin: string): string {
  const key = (origin || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (ORIGIN_LABELS[key]) return ORIGIN_LABELS[key];
  const raw = (origin || '').trim().replace(/_/g, ' ');
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Entrada';
}

function normColor(color: string | null | undefined): string {
  return (color || '').trim().toUpperCase();
}

function formatQty(n: number): string {
  return QTY_FORMAT.format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FORMAT.format(d);
}

/** Numeração "33/34" ordena pelo primeiro número; não-numérico vai pro fim. */
function sizeSortValue(key: string): number {
  const n = parseFloat(key.split('/')[0].replace(',', '.'));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function AllocationChip({ allocation, unit, onNavigate }: {
  allocation: GroupStockTrackingAllocation;
  unit: string | null;
  onNavigate?: () => void;
}) {
  const pv = allocation.order_number || 'PV';
  const content = (
    <>
      <span className="font-mono font-semibold">{allocation.client_name ? pv : `${pv}:`}</span>
      {allocation.client_name && (
        <span className="max-w-[180px] truncate text-muted-foreground">({allocation.client_name}):</span>
      )}
      <span className="font-semibold tabular-nums">
        {formatQty(allocation.quantity)}{unit ? ` ${unit}` : ''}
      </span>
      {allocation.size_key && (
        <span className="rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          nº {allocation.size_key}
        </span>
      )}
    </>
  );
  const base = 'inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-0.5 text-xs';
  if (!allocation.sale_order_id) {
    return <span className={base}>{content}</span>;
  }
  return (
    <Link
      to={`/sales?pv=${allocation.sale_order_id}`}
      onClick={() => onNavigate?.()}
      title={`Abrir ${pv}${allocation.client_name ? ` — ${allocation.client_name}` : ''}`}
      className={`${base} hover:border-primary hover:bg-primary/5`}
    >
      {content}
    </Link>
  );
}

function TrackingEntry({ row, sizeFilter, onNavigate }: {
  row: GroupStockTrackingRow;
  sizeFilter: string;
  onNavigate?: () => void;
}) {
  const allocations = sizeFilter === ALL
    ? row.allocations
    : row.allocations.filter((a) => a.size_key === sizeFilter);
  // Sem clamp: rateio acima do que a entrada trouxe acontece quando um rateio
  // editado de várias entradas fica todo pendurado numa só (ver
  // `apply_inbound_allocation_edit`). Esconder isso como "livre: 0" deixaria
  // chips somando mais que o "+qtd" sem explicação.
  const saldo = row.quantity - row.allocated_qty;
  const excedente = saldo < -1e-6 ? -saldo : 0;
  const livre = Math.max(0, saldo);

  return (
    <li className="space-y-2 border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
        <Badge variant="outline">{originLabel(row.origin)}</Badge>
        <span className="font-semibold">{row.color || 'Sem cor'}</span>
        <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
          <ArrowCircleDown className="h-4 w-4 text-muted-foreground" />
          +{formatQty(row.quantity)}{row.unit ? ` ${row.unit}` : ''}
        </span>
        {row.product_name && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{row.product_name}</span>
        )}
      </div>
      {row.description && (
        <p className="text-xs text-muted-foreground">{row.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {allocations.length === 0 && row.allocations.length === 0 && (
          <span className="text-xs text-muted-foreground">Sem rateio para PVs.</span>
        )}
        {allocations.map((a, i) => (
          <AllocationChip
            key={`${a.sale_order_id ?? 'pv'}-${a.size_key ?? ''}-${i}`}
            allocation={a}
            unit={row.unit}
            onNavigate={onNavigate}
          />
        ))}
        {excedente > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600"
            title="O rateio desta linha soma mais que a entrada — inclui rateio editado de outras entradas do mesmo período."
          >
            rateado acima da entrada: <span className="font-semibold tabular-nums">+{formatQty(excedente)}{row.unit ? ` ${row.unit}` : ''}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
            livre: <span className="font-semibold tabular-nums text-foreground">{formatQty(livre)}{row.unit ? ` ${row.unit}` : ''}</span>
          </span>
        )}
      </div>
    </li>
  );
}

export default function GroupStockTrackingPanel({ groupId, products, onNavigate }: GroupStockTrackingPanelProps) {
  const { data: rows = [], isLoading, isError } = useGroupStockTracking(groupId);
  const [colorFilter, setColorFilter] = useState<string>(ALL);
  const [sizeFilter, setSizeFilter] = useState<string>(ALL);

  /** Cores dos itens do grupo + as que aparecem no histórico (item já removido). */
  const colorOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const p of products) {
      const k = normColor(p.color);
      if (k && !byKey.has(k)) byKey.set(k, (p.color || '').trim());
    }
    for (const r of rows) {
      const k = normColor(r.color);
      if (k && !byKey.has(k)) byKey.set(k, (r.color || '').trim());
    }
    return [...byKey.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [products, rows]);

  const sizeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const a of r.allocations) if (a.size_key) set.add(a.size_key);
    return [...set].sort((a, b) => sizeSortValue(a) - sizeSortValue(b) || a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  const effectiveSize = sizeOptions.includes(sizeFilter) ? sizeFilter : ALL;

  const filtered = useMemo(() => rows.filter((r) => {
    if (colorFilter !== ALL && normColor(r.color) !== colorFilter) return false;
    if (effectiveSize !== ALL && !r.allocations.some((a) => a.size_key === effectiveSize)) return false;
    return true;
  }), [rows, colorFilter, effectiveSize]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando rastreio…
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={CloudSlash}
        size="sm"
        title="Rastreio indisponível no momento"
        description="O histórico de entradas e rateio para os PVs não pôde ser carregado agora."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClockCounterClockwise}
        size="sm"
        title="Nenhuma entrada registrada"
        description="Quando um item deste grupo receber entrada de estoque, ela aparece aqui com o rateio para os PVs."
      />
    );
  }

  const rateadas = filtered.filter((r) => r.allocations.length > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Cor</Label>
          <Select value={colorFilter} onValueChange={setColorFilter}>
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="Todas as cores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as cores</SelectItem>
              {colorOptions.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sizeOptions.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Numeração</Label>
            <Select value={effectiveSize} onValueChange={setSizeFilter}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as numerações</SelectItem>
                {sizeOptions.map((s) => (
                  <SelectItem key={s} value={s}>nº {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="ml-auto text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'entrada' : 'entradas'}
          {' · '}
          {rateadas} com rateio para PV
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwise}
          size="sm"
          title="Nenhuma entrada com esses filtros"
          description="Troque a cor ou a numeração para ver outras entradas."
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <TrackingEntry
              key={row.stock_movement_id}
              row={row}
              sizeFilter={effectiveSize}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}

      {rows.length >= TRACKING_LIMIT && (
        <p className="text-center text-[11px] text-muted-foreground">
          Mostrando as {TRACKING_LIMIT} entradas mais recentes.
        </p>
      )}
    </div>
  );
}
