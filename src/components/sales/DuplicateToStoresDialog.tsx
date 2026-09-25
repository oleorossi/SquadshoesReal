import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Warning as AlertTriangle,
  ArrowLeft,
  Copy,
  CircleNotch as Loader2,
  PencilSimple as Pencil,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaintSelectList } from '@/components/sales/PaintSelectList';
import type { Client, EconomicGroup } from '@/hooks/useClients';
import {
  type PackagingMode,
  type SaleOrderFormData,
  type SaleOrderItemFormData,
} from '@/hooks/useSaleOrders';
import { supabase } from '@/integrations/supabase/client';
import {
  batchLabelForIndex,
  countBatchStores,
  createEmptyBatch,
  expandBatchesToJobs,
  pickDuplicateItems,
  removeClientsFromBatches,
  resolveSourceEconomicGroupId,
  sortDuplicateItemsByReference,
  storesTakenByOtherBatches,
  validateDupBatches,
  type DupBatch,
} from '@/lib/duplicateToStores';
import { resolveReferenceImageUrl } from '@/lib/referenceImage';
import { cn, formatNumber } from '@/lib/utils';

interface SourceOrder {
  id: string;
  representative?: string | null;
  payment_condition?: string | null;
  delivery_deadline?: string | null;
  delivery_week?: string | null;
  delivery_month?: string | null;
  notes?: string | null;
  packaging_mode?: string | null;
  client_id?: string | null;
}

interface RefLite {
  id: string;
  code?: string | null;
  name?: string | null;
}

interface OrderItemRow {
  id: string;
  reference_id: string;
  color?: string | null;
  grade?: Record<string, number> | null;
  unit_price?: number | null;
  quantity?: number | null;
  fichas?: number | null;
  strap_colors?: unknown;
  material_variant_id?: string | null;
  image_url?: string | null;
  ref_code?: string | null;
  ref_name?: string | null;
}

interface DuplicateToStoresDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: SourceOrder | null;
  clients: Client[];
  economicGroups: EconomicGroup[];
  references: RefLite[];
  sourceClientId: string | null;
  alreadyCopiedClientIds: Set<string>;
  createOrder: {
    mutateAsync: (args: {
      order: SaleOrderFormData;
      items: SaleOrderItemFormData[];
      client_id: string;
      parent_order_id: string;
      client_request_id: string;
    }) => Promise<unknown>;
    isPending: boolean;
  };
}

type ViewMode = 'board' | 'sheet';
type SheetStep = 1 | 2;

const CLEAR_GROUP = '__none__';

function summarizeBatchItems(
  batch: DupBatch,
  orderItems: OrderItemRow[],
): string {
  if (batch.itemIds.length === 0) return 'sem itens';
  const byRef = new Map<string, number>();
  for (const id of batch.itemIds) {
    const row = orderItems.find((i) => i.id === id);
    const key = row?.ref_code || row?.ref_name || row?.reference_id || '?';
    byRef.set(key, (byRef.get(key) || 0) + 1);
  }
  return [...byRef.entries()]
    .slice(0, 6)
    .map(([code, n]) => `${code}×${n}`)
    .join(' · ');
}

export default function DuplicateToStoresDialog({
  open,
  onOpenChange,
  order,
  clients,
  economicGroups,
  references,
  sourceClientId,
  alreadyCopiedClientIds,
  createOrder,
}: DuplicateToStoresDialogProps) {
  const [view, setView] = useState<ViewMode>('sheet');
  const [sheetStep, setSheetStep] = useState<SheetStep>(1);
  const [batches, setBatches] = useState<DupBatch[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Lojas ok nesta sessão (falha parcial) — somem junto com alreadyCopied. */
  const [sessionCopiedIds, setSessionCopiedIds] = useState<Set<string>>(new Set());

  const refById = useMemo(() => {
    const map: Record<string, RefLite> = {};
    for (const r of references) map[r.id] = r;
    return map;
  }, [references]);

  const excludedCopied = useMemo(() => {
    const s = new Set(alreadyCopiedClientIds);
    for (const id of sessionCopiedIds) s.add(id);
    return s;
  }, [alreadyCopiedClientIds, sessionCopiedIds]);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || null,
    [batches, activeBatchId],
  );

  const takenByOthers = useMemo(
    () => storesTakenByOtherBatches(batches, activeBatchId),
    [batches, activeBatchId],
  );

  // Reset ao abrir: 1 lote + sheet lojas
  useEffect(() => {
    if (!open || !order) return;
    const groupId = resolveSourceEconomicGroupId({ sourceClientId, clients });
    const first = createEmptyBatch({ index: 0, economicGroupId: groupId });
    setBatches([first]);
    setActiveBatchId(first.id);
    setView('sheet');
    setSheetStep(1);
    setOrderItems([]);
    setItemsError(null);
    setItemsLoaded(false);
    setSessionCopiedIds(new Set());
  }, [open, order?.id, sourceClientId, clients]);

  const updateActiveBatch = useCallback(
    (patch: Partial<DupBatch>) => {
      if (!activeBatchId) return;
      setBatches((prev) =>
        prev.map((b) => (b.id === activeBatchId ? { ...b, ...patch } : b)),
      );
    },
    [activeBatchId],
  );

  const loadItems = useCallback(async () => {
    if (!order?.id) return;
    setItemsLoading(true);
    setItemsError(null);
    const { data, error } = await supabase
      .from('sale_order_items')
      .select('*, technical_sheets(name, code, image_url, images)')
      .eq('sale_order_id', order.id);
    if (error) {
      setItemsLoading(false);
      setItemsError(error.message);
      toast.error(`Erro ao ler itens do pedido original: ${error.message}`);
      return;
    }
    const raw = (data || []) as Array<
      OrderItemRow & {
        technical_sheets?: {
          name?: string | null;
          code?: string | null;
          image_url?: string | null;
          images?: unknown;
        } | null;
      }
    >;
    if (raw.length === 0) {
      setItemsLoading(false);
      setItemsError('O pedido original não possui itens.');
      toast.error('O pedido original não possui itens — duplicação cancelada.');
      return;
    }

    const refIds = [...new Set(raw.map((r) => r.reference_id).filter(Boolean))];
    const variantImageByKey = new Map<string, string>();
    if (refIds.length > 0) {
      const { data: colorVariants } = await supabase
        .from('reference_color_variants')
        .select('reference_id, color, image_url')
        .in('reference_id', refIds);
      for (const v of colorVariants || []) {
        if (!v.image_url) continue;
        const key = `${v.reference_id}::${String(v.color || '').trim().toUpperCase()}`;
        variantImageByKey.set(key, v.image_url);
      }
    }

    const withImages: OrderItemRow[] = raw.map((row) => {
      const colorKey = `${row.reference_id}::${String(row.color || '').trim().toUpperCase()}`;
      const variantUrl = variantImageByKey.get(colorKey) || '';
      const masterUrl = resolveReferenceImageUrl(row.technical_sheets);
      const fromLite = refById[row.reference_id];
      const ts = row.technical_sheets;
      return {
        id: row.id,
        reference_id: row.reference_id,
        color: row.color,
        grade: row.grade,
        unit_price: row.unit_price,
        quantity: row.quantity,
        fichas: row.fichas,
        strap_colors: row.strap_colors,
        material_variant_id: row.material_variant_id,
        image_url: variantUrl || masterUrl || null,
        ref_code: fromLite?.code || ts?.code || null,
        ref_name: fromLite?.name || ts?.name || null,
      };
    });

    const sortRefs: Record<string, RefLite> = {};
    for (const row of withImages) {
      sortRefs[row.reference_id] = {
        id: row.reference_id,
        code: row.ref_code,
        name: row.ref_name,
      };
    }

    const sorted = sortDuplicateItemsByReference(withImages, sortRefs);
    setItemsLoading(false);
    setOrderItems(sorted);
    setItemsLoaded(true);
  }, [order?.id, refById]);

  useEffect(() => {
    if (
      open &&
      order?.id &&
      view === 'sheet' &&
      sheetStep === 2 &&
      !itemsLoaded &&
      !itemsLoading &&
      !itemsError
    ) {
      void loadItems();
    }
  }, [open, order?.id, view, sheetStep, itemsLoaded, itemsLoading, itemsError, loadItems]);

  const storeUniverse = useMemo(() => {
    const groupId = activeBatch?.economicGroupId || '';
    return clients.filter((c) => {
      if (!c.active) return false;
      if (c.id === sourceClientId) return false;
      if (excludedCopied.has(c.id)) return false;
      if (takenByOthers.has(c.id)) return false;
      if (groupId && c.economic_group_id !== groupId) return false;
      return true;
    });
  }, [clients, sourceClientId, excludedCopied, takenByOthers, activeBatch?.economicGroupId]);

  const alreadyCopiedStores = useMemo(
    () => clients.filter((c) => c.active && excludedCopied.has(c.id)),
    [clients, excludedCopied],
  );

  const storeListItems = useMemo(
    () =>
      storeUniverse.map((c) => ({
        id: c.id,
        title: c.razao_social,
        subtitle: c.cnpj || undefined,
        searchHaystack: [c.nome_fantasia],
      })),
    [storeUniverse],
  );

  const itemListItems = useMemo(
    () =>
      orderItems.map((i) => {
        const code = i.ref_code || refById[i.reference_id]?.code || '';
        const name = i.ref_name || refById[i.reference_id]?.name || '';
        const title =
          [code || name, code && name && code !== name ? name : null]
            .filter(Boolean)
            .join(' · ') || i.reference_id;
        const qty = Number(i.quantity) || 0;
        const subtitle = [i.color, qty ? `${formatNumber(qty)} pares` : null]
          .filter(Boolean)
          .join(' · ');
        return {
          id: i.id,
          title,
          subtitle: subtitle || undefined,
          imageUrl: i.image_url ?? null,
          searchHaystack: [i.color, code, name],
        };
      }),
    [orderItems, refById],
  );

  const openSheet = (batchId: string, step: SheetStep = 1) => {
    setActiveBatchId(batchId);
    setSheetStep(step);
    setView('sheet');
  };

  const goBoard = () => {
    setView('board');
    setSheetStep(1);
  };

  const addBatch = () => {
    const groupId = resolveSourceEconomicGroupId({ sourceClientId, clients });
    const next = createEmptyBatch({
      index: batches.length,
      economicGroupId: groupId,
    });
    setBatches((prev) => [...prev, next]);
    openSheet(next.id, 1);
  };

  const removeBatch = (batchId: string) => {
    if (batches.length <= 1) return;
    const next = batches.filter((b) => b.id !== batchId).map((b, i) => ({
      ...b,
      label: batchLabelForIndex(i),
    }));
    setBatches(next);
    if (activeBatchId === batchId) {
      setActiveBatchId(next[0]?.id || null);
      setView('board');
    }
  };

  const finishSheetItems = () => {
    if (!activeBatch || activeBatch.itemIds.length === 0) return;
    goBoard();
  };

  const handleDuplicateAll = async () => {
    if (!order) return;
    const errors = validateDupBatches(batches);
    if (errors.length > 0) {
      toast.error('Complete os lotes antes de duplicar', {
        description: errors.map((e) => e.message).join(' · '),
      });
      return;
    }
    if (orderItems.length === 0 && !itemsLoaded) {
      await loadItems();
    }

    const jobs = expandBatchesToJobs(batches);
    if (jobs.length === 0) {
      toast.error('Nenhuma loja para duplicar');
      return;
    }

    // Se o usuário só montou no quadro sem abrir o passo itens de novo, garante carga.
    let itemsForPick = orderItems;
    if (itemsForPick.length === 0) {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*')
        .eq('sale_order_id', order.id);
      if (error || !data?.length) {
        toast.error('Não foi possível carregar os itens do pedido');
        return;
      }
      itemsForPick = data as OrderItemRow[];
    }

    const variantIdsInOrder = [
      ...new Set(
        jobs
          .flatMap((j) => pickDuplicateItems(itemsForPick, j.itemIds))
          .map((i) => i.material_variant_id)
          .filter(Boolean),
      ),
    ] as string[];
    let activeVariantIds = new Set<string>();
    if (variantIdsInOrder.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types gerados sem reference_material_variants neste client
      const { data: activeVariants } = await (supabase as any)
        .from('reference_material_variants')
        .select('id')
        .in('id', variantIdsInOrder)
        .eq('active', true);
      activeVariantIds = new Set(
        ((activeVariants || []) as Array<{ id: string }>).map((v) => v.id),
      );
      const staleCount = variantIdsInOrder.filter((id) => !activeVariantIds.has(id)).length;
      if (staleCount > 0) {
        toast.warning(
          `${staleCount} variação(ões) de material inativa(s) — o campo será limpo nos itens copiados. Revise antes de faturar.`,
        );
      }
    }

    setSubmitting(true);
    let successCount = 0;
    const failures: string[] = [];
    const okClientIds: string[] = [];

    for (const job of jobs) {
      const client = clients.find((c) => c.id === job.clientId);
      if (!client) continue;
      const picked = pickDuplicateItems(itemsForPick, job.itemIds);
      if (picked.length === 0) {
        failures.push(`${client.razao_social}: sem itens`);
        continue;
      }
      const newOrder: SaleOrderFormData = {
        client_name: client.razao_social,
        client_cnpj: client.cnpj || '',
        client_contact: client.contato || '',
        client_order_number: '',
        representative: order.representative || '',
        payment_condition: order.payment_condition || '',
        delivery_deadline: order.delivery_deadline || '',
        delivery_week: order.delivery_week || '',
        delivery_month: order.delivery_month || '',
        notes: order.notes || '',
        status: 'Rascunho',
        nfe: '',
        remessa: '',
        is_factoring: false,
        factoring_config_id: '',
        packaging_mode: (order.packaging_mode || 'individual_amarrado') as PackagingMode,
      };
      const newItems: SaleOrderItemFormData[] = picked.map((i) => {
        const vid = i.material_variant_id;
        return {
          reference_id: i.reference_id,
          color: i.color || '',
          grade: (i.grade as Record<string, number>) || {},
          unit_price: Number(i.unit_price) || 0,
          quantity: Number(i.quantity) || 0,
          fichas: i.fichas || 1,
          strap_colors: Array.isArray(i.strap_colors) ? i.strap_colors : [],
          material_variant_id: vid && activeVariantIds.has(vid) ? vid : null,
        };
      });
      try {
        await createOrder.mutateAsync({
          order: newOrder,
          items: newItems,
          client_id: client.id,
          parent_order_id: order.id,
          client_request_id: crypto.randomUUID(),
        });
        successCount++;
        okClientIds.push(client.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        failures.push(`${client.razao_social}: ${msg}`);
      }
    }

    setSubmitting(false);

    if (okClientIds.length > 0) {
      setBatches((prev) => removeClientsFromBatches(prev, okClientIds));
      setSessionCopiedIds((prev) => {
        const next = new Set(prev);
        for (const id of okClientIds) next.add(id);
        return next;
      });
    }

    if (successCount > 0) toast.success(`${successCount} pedido(s) duplicado(s)!`);
    if (failures.length > 0) {
      toast.error(`${failures.length} duplicação(ões) falharam`, {
        description: failures.slice(0, 3).join(' | '),
      });
    }
    if (failures.length === 0) onOpenChange(false);
    else setView('board');
  };

  const busy = submitting || createOrder.isPending;
  const totalStores = countBatchStores(batches);
  const requireSearch = !(activeBatch?.economicGroupId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Duplicar para lojas</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {view === 'board'
              ? `${batches.length} lote${batches.length === 1 ? '' : 's'} · monte o mapa e confirme uma vez`
              : `${activeBatch?.label || 'Lote'} — passo ${sheetStep} de 2${
                  sheetStep === 1 ? ' · Lojas' : ' · Itens'
                }`}
          </p>
        </DialogHeader>

        {view === 'board' && (
          <div className="space-y-4 mt-1">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <p className="font-semibold mb-1">A duplicação reservará insumos novamente</p>
                <p>
                  Cada loja vira um novo PV com o mix do seu lote — reservas independentes em{' '}
                  <span className="font-mono">products.reserved_stock</span>. Confira o mapa antes de
                  confirmar.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {batches.map((b) => {
                const storeNames = b.clientIds
                  .map((id) => clients.find((c) => c.id === id)?.razao_social || id)
                  .slice(0, 4);
                const incomplete = b.clientIds.length === 0 || b.itemIds.length === 0;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'rounded-md border px-3 py-2.5 flex items-start gap-3',
                      incomplete ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{b.label}</p>
                        {incomplete && (
                          <span className="text-[10px] uppercase tracking-wide text-destructive font-medium">
                            incompleto
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="font-medium text-foreground">
                          {b.clientIds.length} loja{b.clientIds.length === 1 ? '' : 's'}
                        </span>
                        {storeNames.length > 0 && (
                          <> · {storeNames.join(' · ')}
                            {b.clientIds.length > storeNames.length &&
                              ` · +${b.clientIds.length - storeNames.length}`}
                          </>
                        )}
                        {b.clientIds.length === 0 && ' · nenhuma selecionada'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="font-medium text-foreground">
                          {b.itemIds.length} item{b.itemIds.length === 1 ? '' : 's'}
                        </span>
                        {' · '}
                        {summarizeBatchItems(b, orderItems)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => openSheet(b.id, b.clientIds.length > 0 ? 2 : 1)}
                        disabled={busy}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Editar
                      </Button>
                      {batches.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeBatch(b.id)}
                          disabled={busy}
                          aria-label={`Apagar ${b.label}`}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={addBatch}
              disabled={busy}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Adicionar lote
            </Button>

            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-primary">{batches.length}</span> lote
              {batches.length === 1 ? '' : 's'}
              {' · '}
              <span className="font-bold text-primary">{totalStores}</span> loja
              {totalStores === 1 ? '' : 's'}
              {' · '}
              <span className="font-bold text-primary">{totalStores}</span> PV
              {totalStores === 1 ? '' : 's'}
            </p>

            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={() => void handleDuplicateAll()} disabled={busy || totalStores === 0}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Duplicar tudo · {totalStores} PV{totalStores === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {view === 'sheet' && activeBatch && (
          <div className="space-y-4 mt-1">
            {sheetStep === 1 && (
              <>
                <div>
                  <Label>Grupo econômico (filtro opcional)</Label>
                  <Select
                    value={activeBatch.economicGroupId || CLEAR_GROUP}
                    onValueChange={(v) => {
                      updateActiveBatch({
                        economicGroupId: v === CLEAR_GROUP ? '' : v,
                        clientIds: [],
                      });
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Sem filtro — busque lojas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CLEAR_GROUP}>Sem filtro de grupo</SelectItem>
                      {economicGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {alreadyCopiedStores.length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      ✓ {alreadyCopiedStores.length}{' '}
                      {alreadyCopiedStores.length === 1
                        ? 'loja já recebeu cópia'
                        : 'lojas já receberam cópia'}{' '}
                      (não aparecem na lista)
                    </p>
                  </div>
                )}

                {takenByOthers.size > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {takenByOthers.size} loja{takenByOthers.size === 1 ? '' : 's'} em outro lote — ocultas
                    nesta lista.
                  </p>
                )}

                <PaintSelectList
                  items={storeListItems}
                  selectedIds={activeBatch.clientIds}
                  onSelectedIdsChange={(ids) => updateActiveBatch({ clientIds: ids })}
                  requireSearchToList={requireSearch}
                  emptyWithoutSearchHint="Busque por razão social, fantasia ou CNPJ (ou filtre por grupo)."
                  emptyFilteredHint="Nenhuma loja elegível."
                  label="Lojas"
                  searchPlaceholder="Buscar loja por razão social, fantasia ou CNPJ…"
                />
              </>
            )}

            {sheetStep === 2 && (
              <>
                {itemsLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens…
                  </div>
                )}
                {itemsError && !itemsLoading && (
                  <p className="text-sm text-destructive">{itemsError}</p>
                )}
                {!itemsLoading && !itemsError && orderItems.length > 0 && (
                  <PaintSelectList
                    items={itemListItems}
                    selectedIds={activeBatch.itemIds}
                    onSelectedIdsChange={(ids) => updateActiveBatch({ itemIds: ids })}
                    label="Itens do pedido"
                    searchPlaceholder="Buscar item por referência ou cor…"
                    listClassName="max-h-[min(55vh,28rem)]"
                  />
                )}
                {activeBatch.itemIds.length === 0 &&
                  !itemsLoading &&
                  !itemsError &&
                  orderItems.length > 0 && (
                    <p className="text-xs text-destructive">Selecione ao menos 1 item</p>
                  )}
              </>
            )}

            <div className="flex justify-between gap-3 pt-2">
              <div className="flex gap-2">
                {sheetStep === 2 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSheetStep(1)}
                    disabled={busy}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Voltar
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={goBoard} disabled={busy}>
                    Ver lotes
                  </Button>
                )}
              </div>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                {sheetStep === 1 ? (
                  <Button
                    onClick={() => setSheetStep(2)}
                    disabled={activeBatch.clientIds.length === 0}
                  >
                    Continuar ({activeBatch.clientIds.length})
                  </Button>
                ) : (
                  <Button
                    onClick={finishSheetItems}
                    disabled={activeBatch.itemIds.length === 0 || itemsLoading || !!itemsError}
                  >
                    Concluir lote · {activeBatch.itemIds.length} item
                    {activeBatch.itemIds.length === 1 ? '' : 's'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
