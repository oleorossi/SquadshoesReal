import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowSquareOut as ExternalLink,
  CheckCircle,
  CircleNotch as Loader2,
  Package,
  Palette,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCreateSaleOrderReadinessOverride } from '@/hooks/useSaleOrderCommand';
import { useAddProduct, ProductSchema } from '@/hooks/useProducts';
import { useAddComponentSheet } from '@/hooks/useComponentSheets';
import type { ProductFormData } from '@/types/inventory';
import type { SaleOrderCommandPreflight } from '@/lib/saleOrderCommand';
import {
  buildSaleOrderReadinessCorrectionModel,
  type ReadinessMaterialProduct,
  type ReadinessProductGroup,
  type ReadinessSaleOrderItem,
  type ReadinessTechnicalSheet,
} from '@/lib/saleOrderReadinessCorrections';
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
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const ProductFormDialog = lazy(() => import('@/components/inventory/ProductFormDialog')
  .then((module) => ({ default: module.ProductFormDialog })));

export interface SaleOrderReadinessCorrectionTarget {
  id: string;
  orderNumber: string | null;
  status: string;
  preflight: SaleOrderCommandPreflight;
}

interface Props {
  target: SaleOrderReadinessCorrectionTarget | null;
  isAdmin: boolean;
  statusChangePending: boolean;
  onClose: () => void;
  onEditOrder: () => void;
  onRetry: (overrideId?: string | null) => Promise<void>;
}

interface ReadinessContext {
  items: ReadinessSaleOrderItem[];
  sheets: ReadinessTechnicalSheet[];
  products: ReadinessMaterialProduct[];
  groups: ReadinessProductGroup[];
}

const EMPTY_CONTEXT: ReadinessContext = {
  items: [],
  sheets: [],
  products: [],
  groups: [],
};

const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter(Boolean) as string[])];

const detailText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const formatPairs = (value: number | null | undefined) => (
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value) || 0)
);

async function loadReadinessContext(
  saleOrderId: string,
  preflight: SaleOrderCommandPreflight,
): Promise<ReadinessContext> {
  const { data: rawItems, error: itemsError } = await supabase
    .from('sale_order_items')
    .select('id, reference_id, color, quantity, unit_price')
    .eq('sale_order_id', saleOrderId)
    .order('created_at', { ascending: true });
  if (itemsError) throw itemsError;

  const items = (rawItems || []) as ReadinessSaleOrderItem[];
  const referenceIds = unique([
    ...preflight.blockers.map((issue) => issue.reference_id),
    ...items.map((item) => item.reference_id),
  ]);
  const productIds = unique(preflight.blockers.map((issue) => (
    detailText(issue.details?.product_id)
  )));

  const [sheetResponse, productResponse] = await Promise.all([
    referenceIds.length > 0
      ? supabase
        .from('technical_sheets')
        .select('id, code, name')
        .in('id', referenceIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length > 0
      ? supabase
        .from('products')
        .select('id, name, group_id, unit')
        .in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sheetResponse.error) throw sheetResponse.error;
  if (productResponse.error) throw productResponse.error;

  const products = (productResponse.data || []) as ReadinessMaterialProduct[];
  const groupIds = unique(products.map((product) => product.group_id));
  const groupResponse = groupIds.length > 0
    ? await supabase
      .from('product_groups')
      .select('id, name, is_color_agnostic, auto_component_sheet')
      .in('id', groupIds)
    : { data: [], error: null };
  if (groupResponse.error) throw groupResponse.error;

  return {
    items,
    sheets: (sheetResponse.data || []) as ReadinessTechnicalSheet[],
    products,
    groups: (groupResponse.data || []) as ReadinessProductGroup[],
  };
}

function issueDescription(issue: SaleOrderCommandPreflight['blockers'][number]): string {
  if (issue.code === 'item_price_missing') {
    return 'O preço deste item no PV está zerado ou inválido.';
  }
  if (issue.code === 'material_color_not_registered') {
    const component = detailText(issue.details?.component) || 'Material';
    const product = detailText(issue.details?.product_name) || 'produto do grupo';
    const color = detailText(issue.details?.color) || 'cor do item';
    return `${component}: o grupo de “${product}” não encontrou a cor ${color}.`;
  }
  return issue.message;
}

export default function SaleOrderReadinessCorrectionDialog({
  target,
  isAdmin,
  statusChangePending,
  onClose,
  onEditOrder,
  onRetry,
}: Props) {
  const queryClient = useQueryClient();
  const createOverride = useCreateSaleOrderReadinessOverride();
  const addProduct = useAddProduct();
  const addComponentSheet = useAddComponentSheet();
  const [overrideReason, setOverrideReason] = useState('');
  const [colorTargetKey, setColorTargetKey] = useState<string | null>(null);
  const [registeredColorKeys, setRegisteredColorKeys] = useState<Set<string>>(new Set());
  const [savingCorrections, setSavingCorrections] = useState(false);

  const blockerSignature = useMemo(() => (
    (target?.preflight.blockers || [])
      .map((issue) => `${issue.code}:${issue.item_id || ''}:${issue.reference_id || ''}:${detailText(issue.details?.product_id) || ''}`)
      .join('|')
  ), [target?.preflight.blockers]);

  const contextQuery = useQuery({
    queryKey: ['sale-order-readiness-correction-context', target?.id, blockerSignature],
    enabled: Boolean(target),
    queryFn: () => loadReadinessContext(target!.id, target!.preflight),
    staleTime: 0,
  });

  const context = contextQuery.data || EMPTY_CONTEXT;
  const model = useMemo(() => buildSaleOrderReadinessCorrectionModel({
    issues: target?.preflight.blockers || [],
    items: context.items,
    sheets: context.sheets,
    products: context.products,
    groups: context.groups,
  }), [context, target?.preflight.blockers]);

  useEffect(() => {
    setOverrideReason('');
    setRegisteredColorKeys(new Set());
  }, [target?.id, blockerSignature]);

  const colorTarget = model.colorCorrections.find((correction) => (
    correction.key === colorTargetKey
  )) || null;

  const busy = statusChangePending
    || savingCorrections
    || createOverride.isPending
    || addProduct.isPending
    || addComponentSheet.isPending;
  const allMaterialColorsRegistered = model.colorCorrections.every((correction) => (
    registeredColorKeys.has(correction.key)
  ));
  const canSaveAndRetry = model.unsupportedIssues.length === 0
    && allMaterialColorsRegistered;
  const actionableCount = model.colorCorrections.length;
  const issueCount = target?.preflight.blockers.length || 0;
  const requiresFullOrderEdit = !contextQuery.isLoading
    && model.unsupportedIssues.length > 0;

  const handleSaveAndRetry = async () => {
    if (!target || !isAdmin || !canSaveAndRetry) return;
    setSavingCorrections(true);
    try {
      await onRetry();
    } catch {
      // Hooks e command exibem o erro específico; o diálogo permanece aberto.
    } finally {
      setSavingCorrections(false);
    }
  };

  const handleCreateColorProduct = async (data: ProductFormData, createSheet?: boolean) => {
    if (!colorTarget) return;
    const validated = ProductSchema.parse(data) as ProductFormData;
    const result = await addProduct.mutateAsync(validated);
    if ((createSheet || colorTarget.group.auto_component_sheet) && result?.id) {
      try {
        await addComponentSheet.mutateAsync({
          product_id: result.id,
          dimensions_length: data.dimensions_length || 0,
          dimensions_width: data.dimensions_width || 0,
          dimensions_thickness: data.dimensions_thickness || 0,
          dimensions_unit: data.dimensions_unit || 'mm',
          yield_per_size: {},
          notes: '',
        });
      } catch (error) {
        // O produto já foi criado pelo stock command. Não induzir um segundo
        // cadastro ao manter o form aberto por falha isolada da ficha herdada.
        console.error('Erro ao criar ficha de componente automática:', error);
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products_for_colors'] }),
      queryClient.invalidateQueries({ queryKey: ['group_supplier_materials_for_colors'] }),
      queryClient.invalidateQueries({ queryKey: ['product_groups_colors'] }),
      queryClient.invalidateQueries({ queryKey: ['sale-order-command-preflight'] }),
    ]);
    setRegisteredColorKeys((current) => new Set(current).add(colorTarget.key));
    toast.success(`Cor ${colorTarget.color} cadastrada no grupo ${colorTarget.group.name}.`);
  };

  const handleOverride = async () => {
    if (!target || !model.canOverrideAll || overrideReason.trim().length < 10) return;
    try {
      const overrideId = await createOverride.mutateAsync({
        saleOrderId: target.id,
        command: target.preflight.command,
        justification: overrideReason,
      });
      await onRetry(overrideId);
    } catch {
      // As mutations preservam o diálogo e explicam o erro.
    }
  };

  return (
    <>
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border bg-muted/25 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-wider">
                {target?.orderNumber || 'Pedido de venda'}
              </Badge>
              <Badge variant="destructive">{issueCount} {issueCount === 1 ? 'bloqueio' : 'bloqueios'}</Badge>
            </div>
            <DialogTitle className="font-display text-xl sm:text-2xl">Corrigir prontidão do pedido</DialogTitle>
            <DialogDescription>
              {requiresFullOrderEdit
                ? 'Veja a referência, a cor e a quantidade de cada item com problema. As pendências sem editor rápido devem ser corrigidas em “Abrir pedido completo”.'
                : 'Veja a referência, a cor e a quantidade de cada item com problema. Corrija à direita e valide novamente sem sair desta tela.'}
            </DialogDescription>
          </DialogHeader>

          {contextQuery.isLoading ? (
            <div className="grid min-h-[430px] gap-0 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
              <div className="space-y-3 border-r border-border p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
              <div className="space-y-3 p-5">
                <Skeleton className="h-5 w-52" />
                <Skeleton className="h-36 w-full" />
              </div>
            </div>
          ) : contextQuery.isError ? (
            <div className="p-6">
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Não foi possível carregar os itens</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{(contextQuery.error as Error).message}</p>
                  <Button variant="outline" size="sm" onClick={() => contextQuery.refetch()}>
                    Tentar carregar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
              <ScrollArea className="max-h-[calc(94vh-190px)] border-b border-border lg:border-b-0 lg:border-r">
                <section className="space-y-3 p-4 sm:p-5" aria-labelledby="readiness-items-title">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        {model.itemGroups.length > 0 ? 'Itens afetados' : 'Escopo do bloqueio'}
                      </p>
                      <h3 id="readiness-items-title" className="font-display text-lg">
                        {model.itemGroups.length > 0
                          ? `${model.itemGroups.length} ${model.itemGroups.length === 1 ? 'item para revisar' : 'itens para revisar'}`
                          : `${model.generalIssues.length} ${model.generalIssues.length === 1 ? 'pendência do pedido' : 'pendências do pedido'}`}
                      </h3>
                    </div>
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>

                  {model.itemGroups.map((group, index) => (
                    <article key={group.key} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            Item {String(index + 1).padStart(2, '0')}
                          </p>
                          <p className="truncate font-display text-base font-semibold">
                            {group.sheet?.code || 'Sem código'} · {group.sheet?.name || 'Referência não encontrada'}
                          </p>
                        </div>
                        {group.item ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
                            <Badge variant="secondary">{group.item.color || 'Sem cor'}</Badge>
                            <Badge variant="outline" className="font-mono">{formatPairs(group.item.quantity)} pares</Badge>
                          </div>
                        ) : (
                          <Badge variant="outline">Dados do item indisponíveis</Badge>
                        )}
                      </div>
                      <div className="divide-y divide-border">
                        {group.issues.map((line) => (
                          <div key={line.key} className="flex gap-3 px-4 py-3">
                            <Warning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" weight="fill" />
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">{line.title}</p>
                                <span className="font-mono text-[10px] text-muted-foreground">{line.issue.code}</span>
                              </div>
                              <p className="text-sm leading-relaxed text-muted-foreground">
                                {issueDescription(line.issue)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}

                  {model.generalIssues.length > 0 && (
                    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                      <div className="border-b border-border bg-muted/20 px-4 py-3">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                          Pedido inteiro
                        </p>
                        <p className="font-display text-base font-semibold">Pendências gerais do PV</p>
                      </div>
                      <div className="divide-y divide-border">
                        {model.generalIssues.map((line) => (
                          <div key={line.key} className="flex gap-3 px-4 py-3">
                            <Warning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" weight="fill" />
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">{line.title}</p>
                                <span className="font-mono text-[10px] text-muted-foreground">{line.issue.code}</span>
                              </div>
                              <p className="text-sm leading-relaxed text-muted-foreground">{issueDescription(line.issue)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  )}
                </section>
              </ScrollArea>

              <ScrollArea className="max-h-[calc(94vh-190px)] bg-muted/10">
                <section className="space-y-4 p-4 sm:p-5" aria-labelledby="readiness-corrections-title">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Área de correção</p>
                    <h3 id="readiness-corrections-title" className="font-display text-lg">
                      {actionableCount > 0 ? 'Preencha o que está faltando' : 'Revise as orientações'}
                    </h3>
                  </div>

                  {!isAdmin && (
                    <Alert>
                      <Warning className="h-4 w-4" />
                      <AlertTitle>Correção administrativa</AlertTitle>
                      <AlertDescription>
                        Cadastros rápidos de material exigem um administrador. Preço ausente deve ser preenchido no pedido completo.
                      </AlertDescription>
                    </Alert>
                  )}

                  {model.colorCorrections.map((correction) => {
                    const registered = registeredColorKeys.has(correction.key);
                    return (
                      <div key={correction.key} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="rounded-md bg-muted p-2 text-foreground">
                              <Palette className="h-4 w-4" weight="bold" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{correction.group.name || 'Grupo de material'}</p>
                              <p className="text-xs text-muted-foreground">
                                {correction.component || 'Material'} · cor <strong className="text-foreground">{correction.color}</strong> · {correction.affectedItemIds.length} {correction.affectedItemIds.length === 1 ? 'item' : 'itens'}
                              </p>
                            </div>
                          </div>
                          {registered && <CheckCircle className="h-5 w-5 shrink-0 text-primary" weight="fill" />}
                        </div>
                        <Button
                          type="button"
                          variant={registered ? 'outline' : 'secondary'}
                          className="mt-3 w-full"
                          disabled={!isAdmin || busy || registered}
                          onClick={() => setColorTargetKey(correction.key)}
                        >
                          {registered ? 'Cor cadastrada' : `Cadastrar ${correction.color}`}
                        </Button>
                      </div>
                    );
                  })}

                  {model.agnosticColorIssues.length > 0 && (
                    <Alert className="border-primary/30 bg-primary/5">
                      <CheckCircle className="h-4 w-4 text-primary" weight="fill" />
                      <AlertTitle>Material sem variação de cor</AlertTitle>
                      <AlertDescription>
                        {model.agnosticColorIssues.length} {model.agnosticColorIssues.length === 1 ? 'aviso aponta' : 'avisos apontam'} um grupo agnóstico a cor. Nenhum produto colorido deve ser criado; a validação corrigida remove o falso bloqueio ao tentar novamente.
                      </AlertDescription>
                    </Alert>
                  )}

                  {model.unsupportedIssues.length > 0 && (
                    <Alert>
                      <Wrench className="h-4 w-4" />
                      <AlertTitle>
                        {model.unsupportedIssues.length}{' '}
                        {model.unsupportedIssues.length === 1
                          ? 'pendência exige edição completa'
                          : 'pendências exigem edição completa'}
                      </AlertTitle>
                      <AlertDescription>
                        Os itens estão identificados à esquerda. Abra o pedido para corrigir os campos ainda sem editor rápido.
                      </AlertDescription>
                    </Alert>
                  )}

                  {model.canOverrideAll && isAdmin && (
                    <details className="rounded-lg border border-border bg-card p-4">
                      <summary className="cursor-pointer text-sm font-semibold">Liberar como exceção administrativa</summary>
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Disponível somente porque todos os bloqueios restantes aceitam override auditável.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="readiness-override-reason">Justificativa obrigatória</Label>
                          <Textarea
                            id="readiness-override-reason"
                            value={overrideReason}
                            onChange={(event) => setOverrideReason(event.target.value)}
                            placeholder="Explique o motivo operacional e quem autorizou a exceção."
                            rows={3}
                            disabled={busy}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={overrideReason.trim().length < 10 || busy}
                          onClick={handleOverride}
                        >
                          {createOverride.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                          Registrar exceção e executar
                        </Button>
                      </div>
                    </details>
                  )}
                </section>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Button type="button" variant="ghost" disabled={busy} onClick={onEditOrder}>
              <ExternalLink className="h-4 w-4" />
              Abrir pedido completo
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Fechar</Button>
              {isAdmin && canSaveAndRetry && (
                <Button
                  type="button"
                  disabled={busy || contextQuery.isLoading || contextQuery.isError}
                  onClick={handleSaveAndRetry}
                >
                  {(savingCorrections || statusChangePending) && <Loader2 className="h-4 w-4 animate-spin" />}
                  Validar e tentar novamente
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {colorTarget && (
        <Suspense fallback={null}>
          <ProductFormDialog
            open
            onOpenChange={(open) => { if (!open) setColorTargetKey(null); }}
            onSubmit={handleCreateColorProduct}
            defaultGroupId={colorTarget.group.id}
            defaultColor={colorTarget.color}
          />
        </Suspense>
      )}
    </>
  );
}
