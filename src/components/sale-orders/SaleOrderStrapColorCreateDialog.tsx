import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import QuickColorVariantDialog from '@/components/groups/QuickColorVariantDialog';
import { useAccessControl, useCan } from '@/hooks/useAccessControl';
import { useArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import type { ProductGroup } from '@/hooks/useGroups';
import { supabase } from '@/integrations/supabase/client';
import { canonicalStrapColorForProduct } from '@/lib/officialStrapColors';
import { canUseQuickGroupVariantForRoles, normalizeQuickVariantColor, quickVariantEligibility, type QuickGroupVariantInput, type QuickGroupVariantResult } from '@/lib/quickGroupVariant';
import { isUuid } from '@/lib/technicalStrapLines';
import type { Product } from '@/types/inventory';

export interface SaleOrderStrapColorCreateContext {
  referenceId: string;
  materialVariantId: string | null;
  technicalStrapLineId: string;
  label: string;
  typeId: string;
  typeName: string;
  measureId: string;
  measureName: string;
  baseGroupId: string;
  baseGroupName: string;
}

export interface SaleOrderStrapColorCreated {
  technicalStrapLineId: string;
  typeId: string;
  measureId: string;
  baseGroupId: string;
  productId: string;
  colorId: string;
  colorName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: SaleOrderStrapColorCreateContext;
  initialColor?: string;
  onCreated: (created: SaleOrderStrapColorCreated) => void | Promise<void>;
}

function ContextSummary({ context }: { context: SaleOrderStrapColorCreateContext }) {
  return <div className="space-y-1 rounded-md border bg-muted/20 p-3 text-sm">
    <p className="font-semibold">{context.label} · {context.typeName} · {context.measureName}</p>
    <p>Material: <strong>{context.baseGroupName}</strong></p>
    <p className="text-xs text-muted-foreground">Tipo, medida e consumo seguem a ficha técnica. Só uma nova cor deste material será cadastrada.</p>
  </div>;
}

/** Espelha a RPC contextual: remove somente a cor explícita no final do nome. */
function templateMaterialName(product: Product) {
  const name = normalizeQuickVariantColor(product.name || '');
  const color = normalizeQuickVariantColor(product.color || '');
  return color && name.endsWith(color)
    ? name.slice(0, -color.length).replace(/^[\s:-]+|[\s:-]+$/g, '').trim()
    : name;
}

/** Montado somente após os gates: não consulta preços para quem não os vê. */
function AuthorizedColorCreate({ open, onOpenChange, context, initialColor, onCreated }: Props) {
  const [templateId, setTemplateId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const catalogQuery = useArtisanalStrapCatalog(false);
  const materialQuery = useQuery({
    queryKey: ['sale_order_strap_color_create', context.baseGroupId],
    enabled: open,
    queryFn: async () => {
      const [groupResult, productsResult] = await Promise.all([
        supabase.from('product_groups').select('*').eq('id', context.baseGroupId).maybeSingle(),
        supabase.from('products').select('*').eq('group_id', context.baseGroupId).order('name'),
      ]);
      if (groupResult.error) throw groupResult.error;
      if (productsResult.error) throw productsResult.error;
      return { group: groupResult.data as ProductGroup | null, products: productsResult.data as Product[] };
    },
    staleTime: 0,
  });
  const group = materialQuery.data?.group;
  const products = materialQuery.data?.products || [];
  const activeProducts = products.filter(product => product.active !== false);
  const catalog = catalogQuery.data;
  const finishedIds = new Set((catalog?.variants || []).map(variant => variant.finished_product_id));
  const templateProducts = group && catalog ? activeProducts.filter(product =>
    product.group_id === group.id && product.unit === 'm'
    && product.is_artisanal !== true && !finishedIds.has(product.id)
    && !!product.color?.trim() && !!canonicalStrapColorForProduct(catalog, product.id)
    && templateMaterialName(product) === normalizeQuickVariantColor(group.name)) : [];
  const template = templateProducts.find(product => product.id === templateId) || null;
  // A RPC de PV exige que o SKU escolhido pertença à linha de material, mas
  // admite itens legados diferentes no mesmo grupo. O cadastro geral permanece
  // estrito. Um representante basta para os demais gates de grupo do atalho.
  const groupEligibility = group ? quickVariantEligibility(group, activeProducts.slice(0, 1)) : 'Material não encontrado no cadastro.';
  const eligibility = groupEligibility
    || (activeProducts.some(product => product.is_artisanal === true) ? 'Variações de tira devem ser criadas no Hub de Tiras.' : null)
    || (!templateProducts.length ? 'Nenhum item-modelo elegível neste material. É necessário um item ativo em metros, com cor canônica e nome correspondente à linha de material.' : null);
  const displayContext = {
    ...context,
    typeName: catalogQuery.data?.types.find(type => type.id === context.typeId)?.name || context.typeName,
    measureName: catalogQuery.data?.measures.find(measure => measure.id === context.measureId
      && measure.strap_type_id === context.typeId)?.display_name || context.measureName,
    baseGroupName: group?.name || context.baseGroupName,
  };

  const finishCreated = async (result: QuickGroupVariantResult) => {
    // A RPC retorna o UUID do produto, não a identidade canônica de cor. A
    // atualização obrigatória também resolve aliases sem inventar um color_id.
    const refreshed = await catalogQuery.refetch();
    if (refreshed.error || !refreshed.data) {
      throw new Error('Não foi possível atualizar o catálogo. Recarregue para selecionar a cor no pedido.');
    }
    const product = refreshed.data.products.find(entry => entry.id === result.product_id
      && entry.group_id === context.baseGroupId && entry.active !== false);
    const canonical = product && canonicalStrapColorForProduct(refreshed.data, product.id);
    if (!canonical) {
      throw new Error('A identidade da cor ainda não apareceu no catálogo. Recarregue para selecionar; não crie outra variação.');
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products_for_colors'] }),
      queryClient.invalidateQueries({ queryKey: ['product_groups_colors'] }),
      queryClient.invalidateQueries({ queryKey: ['strap_stock_lines_preview'] }),
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] }),
    ]);
    await onCreated({
      technicalStrapLineId: context.technicalStrapLineId,
      typeId: context.typeId,
      measureId: context.measureId,
      baseGroupId: context.baseGroupId,
      productId: result.product_id,
      colorId: canonical.id,
      colorName: canonical.name,
    });
  };

  const createContextualVariant = async (input: QuickGroupVariantInput): Promise<QuickGroupVariantResult> => {
    // Sem p_quantity: o servidor força saldo zero e valida ficha/variante,
    // posição, tipo/medida e o vínculo exato do item-modelo ao material.
    const { data, error } = await supabase.rpc('create_sale_order_strap_material_color' as never, {
      p_reference_id: context.referenceId,
      p_material_variant_id: context.materialVariantId,
      p_technical_strap_line_id: context.technicalStrapLineId,
      p_expected_type_id: context.typeId,
      p_expected_measure_id: context.measureId,
      p_base_group_id: context.baseGroupId,
      p_template_product_id: input.templateProductId,
      p_color: input.color,
      p_unit_price: input.unitPrice,
      p_request_id: input.requestId,
    } as never);
    if (error) throw new Error(error.message || 'Não foi possível cadastrar a cor para esta posição.');
    const result = data as unknown as QuickGroupVariantResult;
    if (!result?.success || !isUuid(result.product_id)) {
      throw new Error('O cadastro retornou uma resposta inválida. Recarregue o catálogo antes de tentar novamente.');
    }
    return result;
  };

  if (confirming && group && template) {
    return <QuickColorVariantDialog
      open={open} onOpenChange={onOpenChange} group={group} template={template} products={products}
      initialColor={initialColor} fixedQuantity={0} contextNote={<ContextSummary context={displayContext} />}
      createVariant={createContextualVariant}
      onCreated={finishCreated}
    />;
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Cadastrar cor para {context.label}</DialogTitle>
        <DialogDescription>Escolha o item deste material que fornecerá os padrões da nova cor. Nenhum saldo será acrescentado.</DialogDescription>
      </DialogHeader>
      <ContextSummary context={displayContext} />
      {materialQuery.isLoading || catalogQuery.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando itens do material…</p>
        : materialQuery.isError || catalogQuery.isError ? <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar o material. Tente novamente antes de cadastrar.</p>
          <Button type="button" variant="outline" onClick={() => { void materialQuery.refetch(); void catalogQuery.refetch(); }}>Recarregar material</Button>
        </div>
          : eligibility ? <p role="alert" className="text-sm text-destructive">{eligibility}</p>
            : <div className="space-y-2">
              <Label htmlFor="strap-color-template">Item-modelo do material</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="strap-color-template" aria-label="Item-modelo do material"><SelectValue placeholder="Escolha um item-modelo" /></SelectTrigger>
                <SelectContent searchable searchPlaceholder="Buscar item-modelo, SKU ou cor…">
                  {templateProducts.map(product => <SelectItem key={product.id} value={product.id}>
                    {product.name} · {product.sku || 'Sem SKU'}
                  </SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Os padrões de compra e da ficha de componente serão herdados deste item, com confirmação do mesmo valor unitário.</p>
            </div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button type="button" disabled={!template || !!eligibility || materialQuery.isFetching || materialQuery.isError || catalogQuery.isLoading || catalogQuery.isError}
          onClick={() => setConfirming(true)}>Continuar com este item</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function SaleOrderStrapColorCreateDialog(props: Props) {
  const permission = useCan('/estoque');
  const { canSeeFinancialValues } = useAccessControl();
  if (!props.open) return null;
  const validContext = [props.context.referenceId, props.context.technicalStrapLineId, props.context.typeId, props.context.measureId, props.context.baseGroupId].every(isUuid)
    && (props.context.materialVariantId == null || isUuid(props.context.materialVariantId));
  const canCreate = !permission.loading && permission.canCreate
    && canUseQuickGroupVariantForRoles(permission.roles) && canSeeFinancialValues;
  if (!validContext || !canCreate) return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Cadastro de cor indisponível</DialogTitle><DialogDescription>
        {permission.loading ? 'Aguarde a verificação das permissões.'
          : !validContext ? 'A ficha precisa identificar a tira, o tipo, a medida e o material antes do cadastro.'
            : 'Este cadastro exige permissão de criação no Estoque e acesso ao valor padrão do material. Você pode continuar selecionando as cores já cadastradas.'}
      </DialogDescription></DialogHeader>
      <DialogFooter><Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Fechar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
  const key = [props.context.referenceId, props.context.materialVariantId, props.context.technicalStrapLineId, props.context.typeId, props.context.measureId, props.context.baseGroupId].join(':');
  return <AuthorizedColorCreate key={key} {...props} />;
}

export { SaleOrderStrapColorCreateDialog };
