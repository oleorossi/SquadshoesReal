import { useCallback, useEffect, useMemo, useState } from 'react';
import { Warning as AlertTriangle, ArrowLeft, Copy, CircleNotch as Loader2 } from '@phosphor-icons/react';
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
  pickDuplicateItems,
  resolveSourceEconomicGroupId,
} from '@/lib/duplicateToStores';
import { formatNumber } from '@/lib/utils';

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

type WizardStep = 1 | 2;

const CLEAR_GROUP = '__none__';

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
  const [step, setStep] = useState<WizardStep>(1);
  const [groupId, setGroupId] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refById = useMemo(() => {
    const map: Record<string, RefLite> = {};
    for (const r of references) map[r.id] = r;
    return map;
  }, [references]);

  // Reset + pré-fill grupo ao abrir
  useEffect(() => {
    if (!open || !order) return;
    setStep(1);
    setSelectedClientIds([]);
    setSelectedItemIds([]);
    setOrderItems([]);
    setItemsError(null);
    setGroupId(resolveSourceEconomicGroupId({ sourceClientId, clients }));
  }, [open, order?.id, sourceClientId, clients]);

  const loadItems = useCallback(async () => {
    if (!order?.id) return;
    setItemsLoading(true);
    setItemsError(null);
    const { data, error } = await supabase
      .from('sale_order_items')
      .select('*')
      .eq('sale_order_id', order.id);
    setItemsLoading(false);
    if (error) {
      setItemsError(error.message);
      toast.error(`Erro ao ler itens do pedido original: ${error.message}`);
      return;
    }
    const rows = (data || []) as OrderItemRow[];
    if (rows.length === 0) {
      setItemsError('O pedido original não possui itens.');
      toast.error('O pedido original não possui itens — duplicação cancelada.');
      return;
    }
    setOrderItems(rows);
    setSelectedItemIds(rows.map((r) => r.id));
  }, [order?.id]);

  useEffect(() => {
    if (open && order?.id && step === 2 && orderItems.length === 0 && !itemsLoading && !itemsError) {
      void loadItems();
    }
  }, [open, order?.id, step, orderItems.length, itemsLoading, itemsError, loadItems]);

  // Sem grupo: PaintSelectList exige busca; candidatos = todos ativos exceto origem/copiados
  const storeItemsUniverse = useMemo(() => {
    return clients.filter(
      (c) =>
        c.active &&
        c.id !== sourceClientId &&
        !alreadyCopiedClientIds.has(c.id) &&
        (!groupId || c.economic_group_id === groupId),
    );
  }, [clients, sourceClientId, alreadyCopiedClientIds, groupId]);

  const alreadyCopiedStores = useMemo(() => {
    return clients.filter(
      (c) => c.active && alreadyCopiedClientIds.has(c.id),
    );
  }, [clients, alreadyCopiedClientIds]);

  const storeListItems = useMemo(
    () =>
      storeItemsUniverse.map((c) => ({
        id: c.id,
        title: c.razao_social,
        subtitle: c.cnpj || undefined,
        searchHaystack: [c.nome_fantasia],
      })),
    [storeItemsUniverse],
  );

  const itemListItems = useMemo(
    () =>
      orderItems.map((i) => {
        const ref = refById[i.reference_id];
        const title =
          [ref?.name, ref?.code && ref.code !== ref.name ? ref.code : null]
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
          searchHaystack: [i.color, ref?.code, ref?.name],
        };
      }),
    [orderItems, refById],
  );

  const goNext = () => {
    if (selectedClientIds.length === 0) return;
    setStep(2);
  };

  const goBack = () => setStep(1);

  const handleDuplicate = async () => {
    if (!order || selectedClientIds.length === 0 || selectedItemIds.length === 0) return;
    const picked = pickDuplicateItems(orderItems, selectedItemIds);
    if (picked.length === 0) {
      toast.error('Selecione ao menos 1 item');
      return;
    }

    const variantIdsInOrder = [
      ...new Set(picked.map((i) => i.material_variant_id).filter(Boolean)),
    ] as string[];
    let activeVariantIds = new Set<string>();
    if (variantIdsInOrder.length > 0) {
      const { data: activeVariants } = await (supabase as any)
        .from('reference_material_variants')
        .select('id')
        .in('id', variantIdsInOrder)
        .eq('active', true);
      activeVariantIds = new Set((activeVariants || []).map((v: any) => v.id));
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

    for (const clientId of selectedClientIds) {
      const client = clients.find((c) => c.id === clientId);
      if (!client) continue;
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
        factoring_config_id: null as any,
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
          strap_colors: (i.strap_colors as any[]) || [],
          material_variant_id: vid && activeVariantIds.has(vid) ? vid : null,
        };
      });
      const dupRequestId = crypto.randomUUID();
      try {
        await createOrder.mutateAsync({
          order: newOrder,
          items: newItems,
          client_id: client.id,
          parent_order_id: order.id,
          client_request_id: dupRequestId,
        });
        successCount++;
      } catch (err: any) {
        failures.push(`${client.razao_social}: ${err?.message || 'erro desconhecido'}`);
      }
    }

    setSubmitting(false);
    if (successCount > 0) toast.success(`${successCount} pedido(s) duplicado(s)!`);
    if (failures.length > 0) {
      toast.error(`${failures.length} duplicação(ões) falharam`, {
        description: failures.slice(0, 3).join(' | '),
      });
    }
    if (failures.length === 0) onOpenChange(false);
  };

  const busy = submitting || createOrder.isPending;
  const canGoNext = selectedClientIds.length > 0;
  const canSubmit = selectedClientIds.length > 0 && selectedItemIds.length > 0 && !itemsLoading && !itemsError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Duplicar para lojas</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Passo {step} de 2
            {step === 1 ? ' — Lojas' : ' — Itens'}
          </p>
        </DialogHeader>

        {step === 2 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-700 dark:text-amber-300">
              <p className="font-semibold mb-1">A duplicação reservará insumos novamente</p>
              <p>
                Cada loja selecionada vira um novo PV com os itens escolhidos — gerando reservas
                independentes em <span className="font-mono">products.reserved_stock</span>. Verifique
                a disponibilidade de materiais antes de confirmar pra evitar superalocação.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-1">
          {step === 1 && (
            <>
              <div>
                <Label>Grupo econômico (filtro opcional)</Label>
                <Select
                  value={groupId || CLEAR_GROUP}
                  onValueChange={(v) => {
                    setGroupId(v === CLEAR_GROUP ? '' : v);
                    setSelectedClientIds([]);
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
                  <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-1">
                    {alreadyCopiedStores
                      .slice(0, 5)
                      .map((c) => c.razao_social)
                      .join(' · ')}
                    {alreadyCopiedStores.length > 5 && ` · +${alreadyCopiedStores.length - 5}`}
                  </p>
                </div>
              )}

              <PaintSelectList
                items={storeListItems}
                selectedIds={selectedClientIds}
                onSelectedIdsChange={setSelectedClientIds}
                requireSearchToList={!groupId}
                emptyWithoutSearchHint="Busque por razão social, fantasia ou CNPJ (ou filtre por grupo)."
                emptyFilteredHint="Nenhuma loja elegível."
                label="Lojas"
                searchPlaceholder="Buscar loja por razão social, fantasia ou CNPJ…"
              />
            </>
          )}

          {step === 2 && (
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
                  selectedIds={selectedItemIds}
                  onSelectedIdsChange={setSelectedItemIds}
                  label="Itens do pedido"
                  searchPlaceholder="Buscar item por referência ou cor…"
                />
              )}
              {selectedItemIds.length === 0 && !itemsLoading && !itemsError && orderItems.length > 0 && (
                <p className="text-xs text-destructive">Selecione ao menos 1 item</p>
              )}
            </>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <div>
              {step === 2 && (
                <Button type="button" variant="outline" onClick={goBack} disabled={busy}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              {step === 1 ? (
                <Button onClick={goNext} disabled={!canGoNext}>
                  Continuar ({selectedClientIds.length})
                </Button>
              ) : (
                <Button onClick={() => void handleDuplicate()} disabled={!canSubmit || busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Duplicar · {selectedClientIds.length} loja
                  {selectedClientIds.length === 1 ? '' : 's'} · {selectedItemIds.length} item
                  {selectedItemIds.length === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
