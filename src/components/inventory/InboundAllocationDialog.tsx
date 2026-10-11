import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle,
  CircleNotch as Loader2,
  Plus,
  Trash,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  InboundAllocationEditError,
  useApplyInboundAllocationEdit,
  useInboundAllocations,
  useInboundEntryTotals,
  useOpenShortagesForProducts,
  useSaleOrderMaterialShortages,
  type InboundAllocationEdit,
  type InboundAllocationRow,
  type InboundEntryTotal,
  type OpenShortageRow,
} from '@/hooks/useInboundAllocations';

/**
 * Tela de RATEIO da entrada de estoque (spec `integracao-estoque-pv-compras.md`
 * §4 — Q4/Q9/Q22). Abre pré-preenchida com o que o servidor já quitou de cada
 * PV pela prioridade; o dono pode editar e confirmar, ou manter.
 *
 * Não abre sem alocação: se a RPC falhar ou não houver linha, fecha sozinha
 * (quem decide abrir é `openInboundAllocationReview`, que já checa antes).
 */

interface InboundAllocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productIds: string[];
  since: string;
}

interface DraftLine {
  key: string;
  reservation_id: string;
  size_key: string | null;
  sale_order_id: string | null;
  order_number: string | null;
  client_name: string | null;
  /** Quanto o rateio automático deu a esta linha (0 = linha incluída à mão). */
  original: number;
  quantity: number;
  /** Entrada de onde veio o rateio automático (null = linha incluída à mão). */
  stock_movement_id: string | null;
}

interface ProductDraft {
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  lines: DraftLine[];
}

const EPS = 1e-6;
const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const fmt = (v: number) => qtyFmt.format(Math.abs(v) < EPS ? 0 : v);

const lineKey = (reservationId: string, sizeKey: string | null) => `${reservationId}|${sizeKey ?? ''}`;

const compareSize = (a: string | null, b: string | null) =>
  (a ?? '').localeCompare(b ?? '', 'pt-BR', { numeric: true });

function buildDrafts(rows: InboundAllocationRow[]): ProductDraft[] {
  const byProduct = new Map<string, ProductDraft>();
  for (const r of rows) {
    // Reserva apagada depois da entrada: nada a editar nessa linha.
    if (!r.reservation_id) continue;
    let draft = byProduct.get(r.product_id);
    if (!draft) {
      draft = { product_id: r.product_id, product_name: r.product_name, color: r.color, unit: r.unit, lines: [] };
      byProduct.set(r.product_id, draft);
    }
    const key = lineKey(r.reservation_id, r.size_key);
    const existing = draft.lines.find((l) => l.key === key);
    if (existing) {
      existing.original += r.quantity;
      existing.quantity += r.quantity;
    } else {
      draft.lines.push({
        key,
        reservation_id: r.reservation_id,
        size_key: r.size_key,
        sale_order_id: r.sale_order_id,
        order_number: r.order_number,
        client_name: r.client_name,
        original: r.quantity,
        quantity: r.quantity,
        stock_movement_id: r.stock_movement_id,
      });
    }
  }
  const drafts = [...byProduct.values()];
  for (const d of drafts) {
    d.lines.sort((a, b) =>
      (a.order_number ?? '').localeCompare(b.order_number ?? '', 'pt-BR', { numeric: true })
      || compareSize(a.size_key, b.size_key));
  }
  return drafts.sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR'));
}

const productChanged = (d: ProductDraft) => d.lines.some((l) => Math.abs(l.quantity - l.original) > EPS);

const allocatedBySize = (lines: DraftLine[]) => {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.size_key) continue;
    out.set(l.size_key, (out.get(l.size_key) ?? 0) + l.quantity);
  }
  return out;
};

/** Livre da entrada após o rateio — por numeração quando a entrada tem grade. */
function freeAfter(draft: ProductDraft, entry: InboundEntryTotal | undefined, sizeKey: string | null): number | null {
  if (!entry) return null;
  if (sizeKey && entry.grade) {
    const allocated = allocatedBySize(draft.lines).get(sizeKey) ?? 0;
    return (entry.grade[sizeKey] ?? 0) - allocated;
  }
  const allocated = draft.lines.reduce((s, l) => s + l.quantity, 0);
  return entry.quantity - allocated;
}

export default function InboundAllocationDialog({ open, onOpenChange, productIds, since }: InboundAllocationDialogProps) {
  const idsKey = useMemo(() => [...new Set(productIds)].sort().join(','), [productIds]);
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  const allocationsQ = useInboundAllocations(ids, since, open);
  const shortagesQ = useOpenShortagesForProducts(ids, open);
  const entriesQ = useInboundEntryTotals(ids, since, open);
  const applyEdit = useApplyInboundAllocationEdit();

  const [drafts, setDrafts] = useState<ProductDraft[] | null>(null);
  const [phase, setPhase] = useState<'edit' | 'done'>('edit');

  // Nova revisão (outros produtos/janela) → recomeça do rateio do servidor.
  useEffect(() => {
    setDrafts(null);
    setPhase('edit');
  }, [idsKey, since]);

  useEffect(() => {
    if (!open || drafts !== null) return;
    if (allocationsQ.isSuccess) {
      const built = buildDrafts(allocationsQ.data);
      if (built.length === 0) onOpenChange(false);
      else setDrafts(built);
    } else if (allocationsQ.isError) {
      onOpenChange(false);
    }
  }, [open, drafts, allocationsQ.isSuccess, allocationsQ.isError, allocationsQ.data, onOpenChange]);

  // Falta restante (depois do rateio automático) por linha.
  const openShortByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shortagesQ.data ?? []) {
      const key = lineKey(s.reservation_id, s.size_key);
      map.set(key, (map.get(key) ?? 0) + s.quantity_short);
    }
    return map;
  }, [shortagesQ.data]);

  const entryByProduct = useMemo(() => {
    const map = new Map<string, InboundEntryTotal>();
    for (const e of entriesQ.data ?? []) map.set(e.product_id, e);
    return map;
  }, [entriesQ.data]);

  /** Teto da linha = o que já recebeu + o que ainda falta (null = desconhecido). */
  const maxFor = (line: DraftLine): number | null => {
    if (!shortagesQ.isSuccess) return null;
    return line.original + (openShortByKey.get(line.key) ?? 0);
  };

  const lineError = (line: DraftLine): string | null => {
    const max = maxFor(line);
    if (max !== null && line.quantity > max + EPS) return `Acima da falta do PV (máx. ${fmt(max)})`;
    if (line.size_key && Math.abs(line.quantity - Math.round(line.quantity)) > EPS) return 'Solado: só pares inteiros';
    return null;
  };

  const saleOrderIds = useMemo(() => {
    const set = new Set<string>();
    for (const d of drafts ?? []) for (const l of d.lines) if (l.sale_order_id) set.add(l.sale_order_id);
    return [...set];
  }, [drafts]);
  const pvStatusQ = useSaleOrderMaterialShortages(saleOrderIds, open && saleOrderIds.length > 0);

  const pvStatus = useMemo(() => {
    const rows = pvStatusQ.data ?? [];
    const sortByNumber = (a: { order_number: string | null }, b: { order_number: string | null }) =>
      (a.order_number ?? '').localeCompare(b.order_number ?? '', 'pt-BR', { numeric: true });
    return {
      complete: rows.filter((r) => r.managed_lines > 0 && r.short_lines === 0).sort(sortByNumber),
      short: rows.filter((r) => r.short_lines > 0).sort(sortByNumber),
    };
  }, [pvStatusQ.data]);

  const hasErrors = (drafts ?? []).some((d) => d.lines.some((l) => lineError(l) !== null));
  const changed = (drafts ?? []).filter(productChanged);
  const busy = applyEdit.isPending;

  const updateLine = (productId: string, key: string, patch: Partial<DraftLine> | null) => {
    setDrafts((prev) => (prev ?? []).map((d) => {
      if (d.product_id !== productId) return d;
      const lines = patch === null
        ? d.lines.filter((l) => l.key !== key)
        : d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
      return { ...d, lines };
    }));
  };

  const addLine = (draft: ProductDraft, s: OpenShortageRow) => {
    const free = freeAfter(draft, entryByProduct.get(draft.product_id), s.size_key);
    const initial = free !== null && free > EPS ? Math.min(s.quantity_short, free) : 0;
    const line: DraftLine = {
      key: lineKey(s.reservation_id, s.size_key),
      reservation_id: s.reservation_id,
      size_key: s.size_key,
      sale_order_id: s.sale_order_id,
      order_number: s.order_number,
      client_name: s.client_name,
      original: 0,
      quantity: s.size_key ? Math.floor(initial) : initial,
      stock_movement_id: null,
    };
    setDrafts((prev) => (prev ?? []).map((d) =>
      d.product_id === draft.product_id ? { ...d, lines: [...d.lines, line] } : d));
  };

  const handleConfirm = async () => {
    if (!drafts || busy || hasErrors) return;
    if (changed.length === 0) {
      setPhase('done');
      return;
    }
    const edits: InboundAllocationEdit[] = changed.map((d) => ({
      productId: d.product_id,
      productName: d.color ? `${d.product_name} (${d.color})` : d.product_name,
      since,
      allocations: d.lines.map((l) => ({
        reservation_id: l.reservation_id,
        size_key: l.size_key,
        quantity: l.quantity,
        stock_movement_id: l.stock_movement_id,
      })),
    }));
    // O que foi aplicado vira o novo "original": o teto da linha (original +
    // falta restante) volta a bater com o servidor.
    const settle = (applied: Set<string>) => setDrafts((prev) => (prev ?? []).map((d) => (
      applied.has(d.product_id)
        ? {
          ...d,
          lines: d.lines.filter((l) => l.quantity > EPS || l.original > EPS)
            .map((l) => ({ ...l, original: l.quantity })),
        }
        : d
    )));
    try {
      await applyEdit.mutateAsync(edits);
      settle(new Set(edits.map((e) => e.productId)));
      setPhase('done');
    } catch (err) {
      // toast já exibido pela mutation; o que falhou fica como está para corrigir.
      if (err instanceof InboundAllocationEditError) settle(new Set(err.appliedProductIds));
    }
  };

  const visible = open && drafts !== null;

  return (
    <Dialog open={visible} onOpenChange={(o) => { if (!o && !busy) onOpenChange(false); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{phase === 'done' ? 'Rateio da entrada — resumo' : 'Rateio da entrada'}</DialogTitle>
          <DialogDescription>
            {phase === 'done'
              ? 'Quanto ficou para cada PV e quanto ficou livre no estoque.'
              : 'A entrada já quitou a falta dos PVs pela prioridade. Ajuste as quantidades se quiser outro rateio, ou mantenha como está.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(drafts ?? []).map((draft) => {
            const entry = entryByProduct.get(draft.product_id);
            const allocated = draft.lines.reduce((s, l) => s + l.quantity, 0);
            const free = freeAfter(draft, entry, null);
            const unit = draft.unit ?? '';
            const usedKeys = new Set(draft.lines.map((l) => l.key));
            const candidates = (shortagesQ.data ?? []).filter((s) =>
              s.product_id === draft.product_id && !usedKeys.has(lineKey(s.reservation_id, s.size_key)));
            const gradeFree = entry?.grade
              ? Object.keys(entry.grade).sort(compareSize).map((k) => ({ key: k, free: freeAfter(draft, entry, k) ?? 0 }))
              : [];

            return (
              <section key={draft.product_id} className="rounded-sm border border-border bg-card">
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{draft.product_name}</p>
                    {draft.color && <p className="text-xs text-muted-foreground">{draft.color}</p>}
                  </div>
                  {entry && (
                    <span className="text-xs text-muted-foreground">
                      Entrou <strong className="tabular-nums text-foreground">{fmt(entry.quantity)} {unit}</strong>
                    </span>
                  )}
                </header>

                <div className="divide-y divide-border/60">
                  {draft.lines.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum PV neste rateio — tudo fica livre.</p>
                  )}
                  {draft.lines.map((line) => {
                    const max = maxFor(line);
                    const err = phase === 'edit' ? lineError(line) : null;
                    return (
                      <div key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                            <span className="font-mono">{line.order_number ?? 'PV'}</span>
                            {line.size_key && <Badge variant="mono">nº {line.size_key}</Badge>}
                            {line.original === 0 && phase === 'edit' && <Badge variant="outline">incluído</Badge>}
                          </p>
                          {line.client_name && <p className="truncate text-xs text-muted-foreground">{line.client_name}</p>}
                        </div>
                        {phase === 'edit' ? (
                          <>
                            {max !== null && (
                              <span className="text-xs tabular-nums text-muted-foreground">falta {fmt(max)} {unit}</span>
                            )}
                            <div className="w-32">
                              <NumberInput
                                value={line.quantity}
                                onChange={(v) => updateLine(draft.product_id, line.key, { quantity: v })}
                                decimals={line.size_key ? 0 : 3}
                                inputMode={line.size_key ? 'numeric' : 'decimal'}
                                unit={unit}
                                placeholder="0"
                                disabled={busy}
                                className={cn('h-8 text-right tabular-nums', err && 'border-destructive')}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              disabled={busy}
                              aria-label={line.original === 0 ? 'Tirar este PV do rateio' : 'Zerar o rateio deste PV'}
                              onClick={() => updateLine(draft.product_id, line.key, line.original === 0 ? null : { quantity: 0 })}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                            {err && <p className="w-full text-right text-xs text-destructive">{err}</p>}
                          </>
                        ) : (
                          <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(line.quantity)} {unit}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-2">
                  {phase === 'edit' ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          disabled={busy || !shortagesQ.isSuccess || candidates.length === 0}
                          title={shortagesQ.isSuccess && candidates.length === 0 ? 'Nenhum outro PV com falta deste material' : undefined}
                        >
                          <Plus className="h-3.5 w-3.5" /> Adicionar PV
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-80 p-1">
                        <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          PVs com falta — por prioridade
                        </p>
                        <div className="max-h-64 overflow-y-auto">
                          {candidates.map((s) => (
                            <button
                              key={lineKey(s.reservation_id, s.size_key)}
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                              onClick={() => addLine(draft, s)}
                            >
                              <span className="min-w-0">
                                <span className="font-mono font-medium text-foreground">{s.order_number ?? 'PV'}</span>
                                {s.size_key && <span className="text-muted-foreground"> · nº {s.size_key}</span>}
                                {s.client_name && <span className="block truncate text-xs text-muted-foreground">{s.client_name}</span>}
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-red-600">falta {fmt(s.quantity_short)} {unit}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : <span />}
                  <div className="text-right text-xs text-muted-foreground">
                    <span>Para PVs <strong className="tabular-nums text-foreground">{fmt(allocated)} {unit}</strong></span>
                    {free !== null && (
                      <span>
                        {' · '}Livre após rateio{' '}
                        <strong className="tabular-nums text-foreground">{fmt(Math.max(free, 0))} {unit}</strong>
                      </span>
                    )}
                    {free !== null && free < -EPS && (
                      <p className="text-amber-600">
                        {fmt(-free)} {unit} acima do que entrou — usa saldo livre anterior, se houver.
                      </p>
                    )}
                    {gradeFree.length > 0 && (
                      <p className="mt-0.5 flex flex-wrap justify-end gap-1">
                        {gradeFree.map((g) => (
                          <span
                            key={g.key}
                            className={cn(
                              'rounded-sm border border-border/60 px-1 font-mono tabular-nums',
                              g.free < -EPS && 'border-amber-500/40 bg-amber-500/10 text-amber-600',
                            )}
                          >
                            {g.key}: {fmt(g.free)} livre
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </footer>
              </section>
            );
          })}

          {(pvStatus.complete.length > 0 || pvStatus.short.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {phase === 'done' ? 'Situação dos PVs' : 'Situação dos PVs com o rateio atual'}
              </p>
              {pvStatus.complete.map((pv) => (
                <div
                  key={pv.sale_order_id}
                  className="flex items-center gap-2 rounded-sm bg-green-500/10 px-2.5 py-1.5 text-sm font-medium text-green-600"
                >
                  <CheckCircle weight="fill" className="h-4 w-4 shrink-0" />
                  <span>
                    <Link
                      to={`/sales?pv=${pv.sale_order_id}`}
                      className="font-mono underline-offset-2 hover:underline"
                      onClick={() => onOpenChange(false)}
                    >
                      {pv.order_number ?? 'PV'}
                    </Link>
                    {' '}material completo — liberado para corte
                  </span>
                </div>
              ))}
              {pvStatus.short.map((pv) => (
                <div
                  key={pv.sale_order_id}
                  className="flex items-center gap-2 rounded-sm bg-amber-500/10 px-2.5 py-1.5 text-sm text-amber-600"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    <Link
                      to={`/sales?pv=${pv.sale_order_id}`}
                      className="font-mono underline-offset-2 hover:underline"
                      onClick={() => onOpenChange(false)}
                    >
                      {pv.order_number ?? 'PV'}
                    </Link>
                    {' '}ainda com falta de material ({pv.short_lines} {pv.short_lines === 1 ? 'item' : 'itens'})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === 'edit' ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Manter rateio
              </Button>
              <Button
                type="button"
                data-dialog-primary="true"
                disabled={busy || hasErrors}
                onClick={handleConfirm}
                className="gap-1.5"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar rateio
              </Button>
            </>
          ) : (
            <Button type="button" data-dialog-primary="true" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
