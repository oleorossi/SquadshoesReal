import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapLegacyMigrationDiagnostic,
  type ArtisanalStrapSourceMode,
  type LegacyStrapProductMigrationDetails,
  useResolveLegacyStrapProductMigration,
} from '@/hooks/useArtisanalStraps';
import {
  buildLegacyStrapProductAllocations,
  decimalToMigrationUnits,
  isLegacySelfTargetAllocation,
  migrationUnitsToDecimal,
  type LegacyStrapAllocationDraft,
} from '@/lib/legacyStrapMigration';

interface AllocationRow extends LegacyStrapAllocationDraft {
  key: string;
}

function detailsOf(diagnostic: ArtisanalStrapLegacyMigrationDiagnostic | null) {
  return diagnostic?.details as LegacyStrapProductMigrationDetails | undefined;
}

function assignmentMap(
  allocations: LegacyStrapProductMigrationDetails['current_allocations'],
  field: 'reservation_ids' | 'purchase_order_item_ids' | 'service_order_item_ids',
) {
  const result: Record<string, string> = {};
  allocations.forEach((allocation) => allocation[field].forEach((id) => {
    result[id] = allocation.strap_variant_id;
  }));
  return result;
}

function quantityLabel(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { maximumFractionDigits: 9 })
    : '—';
}

export function ArtisanalStrapLegacyProductMigrationDialog({
  diagnostic,
  catalog,
  onClose,
}: {
  diagnostic: ArtisanalStrapLegacyMigrationDiagnostic | null;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const resolveProduct = useResolveLegacyStrapProductMigration();
  const details = detailsOf(diagnostic);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [reservationAssignments, setReservationAssignments] = useState<Record<string, string>>({});
  const [purchaseAssignments, setPurchaseAssignments] = useState<Record<string, string>>({});
  const [serviceAssignments, setServiceAssignments] = useState<Record<string, string>>({});
  const [replenishmentMode, setReplenishmentMode] = useState<ArtisanalStrapSourceMode | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!details) return;
    const current = details.current_allocations || [];
    setAllocations(current.length > 0
      ? current.map((allocation) => ({
        key: allocation.allocation_id || crypto.randomUUID(),
        variantId: allocation.strap_variant_id,
        quantity: String(allocation.quantity),
      }))
      : [{ key: crypto.randomUUID(), variantId: '', quantity: String(details.quantity ?? 0) }]);
    setReservationAssignments(assignmentMap(current, 'reservation_ids'));
    setPurchaseAssignments(assignmentMap(current, 'purchase_order_item_ids'));
    setServiceAssignments(assignmentMap(current, 'service_order_item_ids'));
    // O diagnóstico não devolve o modo já salvo. Exigimos nova confirmação em
    // toda resolução para nunca inferir a origem do piso.
    setReplenishmentMode('');
    setReason('');
  }, [details]);

  const assignablePurchaseItems = (details?.open_purchase_order_items || []).filter((item) => item.assignable);
  const blockedPurchaseItems = (details?.open_purchase_order_items || []).filter((item) => !item.assignable);
  const assignableServiceItems = (details?.open_service_order_items || []).filter((item) => item.assignable !== false);
  const blockedServiceItems = (details?.open_service_order_items || []).filter((item) => item.assignable === false);
  const selectedVariantIds = new Set(allocations.map((allocation) => allocation.variantId).filter(Boolean));
  const selectedTargetProductIds = allocations.flatMap((allocation) => {
    const variant = catalog.variants.find((entry) => entry.id === allocation.variantId);
    return variant ? [variant.finished_product_id] : [];
  });
  const isSelfTarget = Boolean(details && isLegacySelfTargetAllocation(
    details.legacy_product_id,
    selectedTargetProductIds,
  ));

  const built = useMemo(() => {
    if (!details) return { payload: null, error: 'Produto legado não informado.' };
    try {
      const selectedVariants = allocations.map((allocation) => (
        catalog.variants.find((variant) => variant.id === allocation.variantId)
      ));
      if (selectedVariants.some((variant) => !variant)) {
        throw new Error('Uma variante selecionada não existe mais no catálogo; substitua-a antes de continuar.');
      }
      const targetProductIds = selectedVariants.map((variant) => variant!.finished_product_id);
      if (new Set(targetProductIds).size !== targetProductIds.length) {
        throw new Error('Duas variantes apontam para o mesmo produto acabado; desambigue o cadastro antes do rateio.');
      }
      if (blockedPurchaseItems.length > 0 && !isLegacySelfTargetAllocation(details.legacy_product_id, targetProductIds)) {
        throw new Error('Há OC congelada. Só é seguro conservá-la numa única alocação que mantenha o próprio produto legado; split ou outro destino exigem concluir ou sanear o documento.');
      }
      return {
        payload: buildLegacyStrapProductAllocations({
          expectedQuantity: details.quantity,
          expectedReservedStock: details.reserved_stock,
          allocations,
          reservations: (details.open_reservations || []).map((reservation) => ({
            id: reservation.id,
            remainingReserved: reservation.remaining_reserved,
          })),
          assignablePurchaseItemIds: assignablePurchaseItems.map((item) => item.id),
          serviceOrderItemIds: assignableServiceItems.map((item) => item.id),
          reservationAssignments,
          purchaseAssignments,
          serviceAssignments,
        }),
        error: null,
      };
    } catch (error) {
      return { payload: null, error: error instanceof Error ? error.message : 'Rateio inválido.' };
    }
  }, [allocations, assignablePurchaseItems, assignableServiceItems, blockedPurchaseItems.length, catalog.variants, details, purchaseAssignments, reservationAssignments, serviceAssignments]);

  const allocatedQuantity = useMemo(() => {
    try {
      return migrationUnitsToDecimal(allocations.reduce(
        (sum, allocation) => sum + decimalToMigrationUnits(allocation.quantity || '0'),
        0n,
      ));
    } catch {
      return 'inválida';
    }
  }, [allocations]);

  const variantLabel = (variantId: string) => {
    const variant = catalog.variants.find((entry) => entry.id === variantId);
    if (!variant) return `Variante indisponível · ${variantId}`;
    const measure = catalog.measures.find((entry) => entry.id === variant.measure_id);
    const type = catalog.types.find((entry) => entry.id === measure?.strap_type_id);
    const base = catalog.groups.find((entry) => entry.id === variant.base_group_id);
    const color = catalog.colors.find((entry) => entry.id === variant.color_id);
    const product = catalog.products.find((entry) => entry.id === variant.finished_product_id);
    return [type?.name, measure?.display_name, base?.name, color?.name, product?.name, variant.status]
      .filter(Boolean).join(' · ');
  };

  const changeVariant = (rowKey: string, nextVariantId: string) => {
    const previous = allocations.find((allocation) => allocation.key === rowKey)?.variantId;
    setAllocations((current) => current.map((allocation) => (
      allocation.key === rowKey ? { ...allocation, variantId: nextVariantId } : allocation
    )));
    if (!previous || previous === nextVariantId) return;
    const replace = (current: Record<string, string>) => Object.fromEntries(
      Object.entries(current).map(([id, variantId]) => [id, variantId === previous ? nextVariantId : variantId]),
    );
    setReservationAssignments(replace);
    setPurchaseAssignments(replace);
    setServiceAssignments(replace);
  };

  const removeAllocation = (row: AllocationRow) => {
    if (allocations.length <= 1) return;
    setAllocations((current) => current.filter((allocation) => allocation.key !== row.key));
    const clear = (current: Record<string, string>) => Object.fromEntries(
      Object.entries(current).filter(([, variantId]) => variantId !== row.variantId),
    );
    setReservationAssignments(clear);
    setPurchaseAssignments(clear);
    setServiceAssignments(clear);
  };

  const AssignmentSelect = ({
    value,
    onValueChange,
    label,
  }: {
    value?: string;
    onValueChange: (value: string) => void;
    label: string;
  }) => (
    <Select value={value || ''} onValueChange={onValueChange} disabled={selectedVariantIds.size === 0}>
      <SelectTrigger aria-label={label} className="w-full sm:w-[310px]"><SelectValue placeholder="Atribuir à variante…" /></SelectTrigger>
      <SelectContent>{[...selectedVariantIds].map((variantId) => (
        <SelectItem key={variantId} value={variantId}>{variantLabel(variantId)}</SelectItem>
      ))}</SelectContent>
    </Select>
  );

  return (
    <Dialog open={Boolean(diagnostic && details)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Ratear produto legado sem perder saldo</DialogTitle>
          <DialogDescription>
            {details?.product_name || 'Produto'}{details?.product_color ? ` · ${details.product_color}` : ''}. O corte só será liberado quando saldo, reservas e documentos abertos estiverem nominalmente atribuídos.
          </DialogDescription>
        </DialogHeader>

        {details && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md bg-muted/40 p-3"><p className="text-[9px] font-bold uppercase text-muted-foreground">Saldo legado</p><p className="font-mono text-lg font-bold">{quantityLabel(details.quantity)}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-[9px] font-bold uppercase text-muted-foreground">Rateado</p><p className="font-mono text-lg font-bold">{allocatedQuantity}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-[9px] font-bold uppercase text-muted-foreground">Reservado</p><p className="font-mono text-lg font-bold">{quantityLabel(details.reserved_stock)}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-[9px] font-bold uppercase text-muted-foreground">Mapa</p><p className="truncate text-sm font-semibold">{details.mapping_status}</p></div>
            </div>

            {(details.blockers || []).length > 0 && (
              <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>O mapa anterior sofreu drift</AlertTitle><AlertDescription className="space-y-1">{(details.blockers || []).map((blocker, index) => <p key={`${String(blocker.code)}-${index}`} className="font-mono text-[10px]">{JSON.stringify(blocker)}</p>)}</AlertDescription></Alert>
            )}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="text-sm font-semibold">1. Variantes e saldo final</h3><p className="text-xs text-muted-foreground">Digite manualmente o saldo de cada variante. A soma deve fechar exatamente.</p></div>
                <Button type="button" size="sm" variant="outline" onClick={() => setAllocations((current) => [...current, { key: crypto.randomUUID(), variantId: '', quantity: '0' }])}><Plus className="mr-1 h-4 w-4" /> Adicionar variante</Button>
              </div>
              {allocations.map((allocation) => {
                const payload = built.payload?.find((entry) => entry.strap_variant_id === allocation.variantId);
                return (
                  <div key={allocation.key} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
                    <div className="space-y-1.5"><Label>Variante canônica *</Label><Select value={allocation.variantId} onValueChange={(value) => changeVariant(allocation.key, value)}><SelectTrigger><SelectValue placeholder="Família · medida · base · cor" /></SelectTrigger><SelectContent>{catalog.variants.map((variant) => <SelectItem key={variant.id} value={variant.id} disabled={selectedVariantIds.has(variant.id) && allocation.variantId !== variant.id}>{variantLabel(variant.id)}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label>Quantidade *</Label><Input inputMode="decimal" value={allocation.quantity} onChange={(event) => setAllocations((current) => current.map((entry) => entry.key === allocation.key ? { ...entry, quantity: event.target.value.replace(/[^0-9.,]/g, '') } : entry))} /></div>
                    <Button type="button" size="icon" variant="ghost" aria-label="Remover variante do rateio" disabled={allocations.length <= 1} onClick={() => removeAllocation(allocation)}><Trash className="h-4 w-4 text-destructive" /></Button>
                    {allocation.variantId && <p className="text-xs text-muted-foreground sm:col-span-3">Reservado calculado pelas linhas atribuídas: <strong className="text-foreground">{payload?.reserved_stock || '0'}</strong></p>}
                  </div>
                );
              })}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">2. Reservas abertas</h3>
              {(details.open_reservations || []).length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma reserva aberta.</p> : details.open_reservations.map((reservation) => (
                <div key={reservation.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-xs font-semibold">Reserva {reservation.id.slice(0, 8)}</p><p className="text-xs text-muted-foreground">Saldo restante: {quantityLabel(reservation.remaining_reserved)} · {reservation.status}</p></div>
                  <AssignmentSelect label={`Variante da reserva ${reservation.id}`} value={reservationAssignments[reservation.id]} onValueChange={(value) => setReservationAssignments((current) => ({ ...current, [reservation.id]: value }))} />
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">3. OCs abertas atribuíveis</h3>
              {assignablePurchaseItems.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum item de OC aberto e editável.</p> : assignablePurchaseItems.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-xs font-semibold">{item.order_number || item.purchase_order_id}</p><p className="text-xs text-muted-foreground">Restante: {quantityLabel(item.remaining_quantity)} · {item.order_status}</p></div>
                  <AssignmentSelect label={`Variante do item de OC ${item.id}`} value={purchaseAssignments[item.id]} onValueChange={(value) => setPurchaseAssignments((current) => ({ ...current, [item.id]: value }))} />
                </div>
              ))}
              {blockedPurchaseItems.length > 0 && (
                <Alert variant={isSelfTarget ? 'default' : 'destructive'}>
                  <Warning className="h-4 w-4" />
                  <AlertTitle>{isSelfTarget ? 'OC congelada preservada no próprio produto' : 'OCs congeladas não podem ser remapeadas'}</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>{isSelfTarget
                      ? 'A alocação é única e aponta para o produto legado. Estes IDs ficam somente leitura e não entram no payload de reescrita.'
                      : 'Split ou troca de produto permanece bloqueado; o documento imutável nunca é atribuído a outra variante.'}</p>
                    {blockedPurchaseItems.map((item) => <p key={item.id}>{item.order_number || item.purchase_order_id}: {item.blocking_reason || 'documento imutável'}</p>)}
                  </AlertDescription>
                </Alert>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">4. OS abertas</h3>
              {assignableServiceItems.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma linha de OS aberta e atribuível.</p> : assignableServiceItems.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-xs font-semibold">{item.order_number || item.service_order_id}</p><p className="text-xs text-muted-foreground">Restante: {quantityLabel(item.remaining_meters)} m · {item.line_status}</p></div>
                  <AssignmentSelect label={`Variante do item de OS ${item.id}`} value={serviceAssignments[item.id]} onValueChange={(value) => setServiceAssignments((current) => ({ ...current, [item.id]: value }))} />
                </div>
              ))}
              {blockedServiceItems.length > 0 && (
                <Alert>
                  <Warning className="h-4 w-4" />
                  <AlertTitle>OS somente leitura</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>O cabeçalho está terminal; estas linhas não são obrigatórias e seus IDs não entram no payload.</p>
                    {blockedServiceItems.map((item) => <p key={item.id}>{item.order_number || item.service_order_id}: {item.blocking_reason || 'cabeçalho terminal'}</p>)}
                  </AlertDescription>
                </Alert>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Origem de reposição do piso *</Label><Select value={replenishmentMode} onValueChange={(value) => setReplenishmentMode(value as ArtisanalStrapSourceMode)}><SelectTrigger><SelectValue placeholder="Confirme explicitamente" /></SelectTrigger><SelectContent><SelectItem value="internal">Produzir internamente</SelectItem><SelectItem value="buy_ready">Comprar tira pronta</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Motivo auditável *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explique a conferência e o rateio realizado" /></div>
            </section>

            {built.error && <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Rateio ainda bloqueado</AlertTitle><AlertDescription>{built.error}</AlertDescription></Alert>}
            {!built.error && <Badge variant="secondary">Conservação fechada: saldo, reservado e documentos atribuíveis conferidos</Badge>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!details || !built.payload || !replenishmentMode || !reason.trim() || resolveProduct.isPending}
            onClick={async () => {
              if (!details || !built.payload || !replenishmentMode) return;
              try {
                await resolveProduct.mutateAsync({
                  legacyProductId: details.legacy_product_id,
                  allocations: built.payload,
                  replenishmentMode,
                  reason: reason.trim(),
                });
                onClose();
              } catch {
                // O hook mantém o diálogo aberto e mostra o blocker do servidor.
              }
            }}
          >{resolveProduct.isPending ? 'Registrando rateio…' : 'Registrar rateio conservativo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
