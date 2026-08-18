import { useEffect, useMemo, useState } from 'react';
import {
  Factory,
  FloppyDisk,
  LockKey,
  Package,
  Scissors,
  ShoppingBag,
  Warning,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useContractors } from '@/hooks/useContractors';
import {
  type ArtisanalStrapCapabilities,
  type ArtisanalStrapCatalog,
  type ArtisanalStrapIdentityBasis,
  type ArtisanalStrapSourceMode,
  useSaveArtisanalStrapBundle,
} from '@/hooks/useArtisanalStraps';
import { useSuppliers } from '@/hooks/useSuppliers';
import {
  canonicalStrapColorForProduct,
  purchasedReadyStrapColorsForGroup,
  registeredBaseMaterialColorsForGroup,
} from '@/lib/officialStrapColors';
import { isPurchasedReadyStrap } from '@/lib/strapIdentity';
import { StrapIdentityTrail } from './StrapIdentityTrail';

export type ArtisanalStrapEditorMode = 'create' | 'edit' | 'review';
export type ArtisanalStrapEditorOrigin =
  | 'hub'
  | 'estoque'
  | 'grupos'
  | 'compras'
  | 'terceirizados'
  | 'pv';

export interface ArtisanalStrapEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ArtisanalStrapCatalog;
  capabilities: ArtisanalStrapCapabilities;
  mode: ArtisanalStrapEditorMode;
  origin: ArtisanalStrapEditorOrigin;
  variantId?: string | null;
  identityBasis?: ArtisanalStrapIdentityBasis | null;
  measureId?: string | null;
  baseGroupId?: string | null;
  colorId?: string | null;
  finishedProductId?: string | null;
  buyReadyReviewId?: string | null;
  suggestedRecipeId?: string | null;
  suggestedYieldMPerM?: number | null;
  onSaved?: (variantId: string) => void;
}

interface EditorForm {
  typeId: string;
  typeName: string;
  measureId: string;
  measureName: string;
  finishedWidthMm: number;
  identityBasis: ArtisanalStrapIdentityBasis;
  identityGroupId: string;
  internalProductionEnabled: boolean;
  baseGroupId: string;
  colorId: string;
  variantId: string;
  finishedProductId: string;
  productName: string;
  sku: string;
  minStockM: number;
  floorMode: ArtisanalStrapSourceMode;
  purchaseEnabled: boolean;
  supplierId: string;
  supplierColorCode: string;
  purchaseUnit: string;
  conversionRate: number;
  purchasePrice: number;
  minOrderQuantity: number;
  purchaseMultiple: number;
  preparationDays: number;
  includeRecipe: boolean;
  recipeId: string;
  cutBandWidthMm: number;
  confirmedYield: number;
  executorType: 'factory' | 'contractor';
  contractorId: string;
  transformationCost: number;
  reason: string;
}

const EMPTY_FORM: EditorForm = {
  typeId: '',
  typeName: '',
  measureId: '',
  measureName: '',
  finishedWidthMm: 0,
  identityBasis: 'reference_base',
  identityGroupId: '',
  internalProductionEnabled: true,
  baseGroupId: '',
  colorId: '',
  variantId: '',
  finishedProductId: '',
  productName: '',
  sku: '',
  minStockM: 0,
  floorMode: 'internal',
  purchaseEnabled: false,
  supplierId: '',
  supplierColorCode: '',
  purchaseUnit: 'm',
  conversionRate: 1,
  purchasePrice: 0,
  minOrderQuantity: 1,
  purchaseMultiple: 1,
  preparationDays: 2,
  includeRecipe: true,
  recipeId: '',
  cutBandWidthMm: 0,
  confirmedYield: 0,
  executorType: 'factory',
  contractorId: '',
  transformationCost: 0,
  reason: '',
};

const ORIGIN_LABEL: Record<ArtisanalStrapEditorOrigin, string> = {
  hub: 'Hub de Tiras',
  estoque: 'Estoque',
  grupos: 'Grupos',
  compras: 'Compras',
  terceirizados: 'Terceirizados',
  pv: 'Pedido de venda',
};

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mostFrequentMinStock(
  catalog: ArtisanalStrapCatalog,
  selectedMeasureId: string,
  selectedBaseGroupId: string,
  excludedVariantId?: string | null,
): number | null {
  if (!selectedMeasureId || !selectedBaseGroupId) return null;
  const values = catalog.variants
    .filter((item) => item.id !== excludedVariantId
      && item.measure_id === selectedMeasureId
      && item.base_group_id === selectedBaseGroupId)
    .map((item) => Number(item.min_stock_m))
    .filter(Number.isFinite);
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .sort(([valueA, countA], [valueB, countB]) => countB - countA || valueA - valueB)[0][0];
}

export function ArtisanalStrapEditor({
  open,
  onOpenChange,
  catalog,
  capabilities,
  mode,
  origin,
  variantId,
  identityBasis,
  measureId,
  baseGroupId,
  colorId,
  finishedProductId,
  buyReadyReviewId,
  suggestedRecipeId,
  suggestedYieldMPerM,
  onSaved,
}: ArtisanalStrapEditorProps) {
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [minStockConfirmed, setMinStockConfirmed] = useState(false);
  const [floorModeConfirmed, setFloorModeConfirmed] = useState(false);
  const saveBundle = useSaveArtisanalStrapBundle();
  const { data: suppliers = [] } = useSuppliers(open);
  const { data: contractors = [] } = useContractors();

  const variant = useMemo(
    () => catalog.variants.find((item) => item.id === variantId),
    [catalog.variants, variantId],
  );

  useEffect(() => {
    if (!open) return;
    const selectedVariant = catalog.variants.find((item) => item.id === variantId);
    const selectedMeasure = catalog.measures.find(
      (item) => item.id === (selectedVariant?.measure_id || measureId),
    );
    const selectedType = catalog.types.find((item) => item.id === selectedMeasure?.strap_type_id);
    const selectedProductId = selectedVariant?.finished_product_id
      || (identityBasis === 'finished_product_group' ? finishedProductId : null);
    const product = catalog.products.find((item) => item.id === selectedProductId);
    const selectedIdentityBasis = selectedVariant?.identity_basis
      || (identityBasis === 'finished_product_group' ? identityBasis : 'reference_base');
    const selectedInternalProductionEnabled = selectedVariant?.internal_production_enabled !== false
      && selectedIdentityBasis === 'reference_base';
    const selectedIdentityGroupId = selectedIdentityBasis === 'finished_product_group'
      ? selectedVariant?.base_group_id || baseGroupId || product?.group_id || ''
      : '';
    const selectedBaseId = selectedIdentityBasis === 'reference_base'
      ? selectedVariant?.base_group_id || baseGroupId || ''
      : '';
    const selectedColorId = selectedVariant?.color_id || colorId || '';
    const latestRecipe = selectedInternalProductionEnabled ? catalog.recipes
      .filter((item) => item.measure_id === selectedMeasure?.id && item.base_group_id === selectedBaseId)
      .sort((a, b) => Number(b.version) - Number(a.version))[0] : undefined;
    const suggestedRecipe = catalog.recipes.find((item) => item.id === suggestedRecipeId);
    const recipe = selectedInternalProductionEnabled
      && suggestedRecipe
      && suggestedRecipe.measure_id === selectedMeasure?.id
      && suggestedRecipe.base_group_id === selectedBaseId
      ? suggestedRecipe
      : latestRecipe;
    const hasYieldSuggestion = Number.isFinite(Number(suggestedYieldMPerM))
      && Number(suggestedYieldMPerM) > 0;
    const selectedFloorMode = selectedInternalProductionEnabled
      ? selectedVariant?.min_stock_replenishment_mode || 'internal'
      : 'buy_ready';
    const suggestedFloor = mostFrequentMinStock(
      catalog,
      selectedMeasure?.id || '',
      selectedBaseId,
      selectedVariant?.id,
    );

    setForm({
      ...EMPTY_FORM,
      typeId: selectedType?.id || '',
      typeName: selectedType?.name || '',
      measureId: selectedMeasure?.id || '',
      measureName: selectedMeasure?.display_name || '',
      finishedWidthMm: numberOrZero(selectedMeasure?.finished_width_mm),
      identityBasis: selectedIdentityBasis,
      identityGroupId: selectedIdentityGroupId,
      internalProductionEnabled: selectedInternalProductionEnabled,
      baseGroupId: selectedBaseId,
      colorId: selectedColorId,
      variantId: selectedVariant?.id || '',
      finishedProductId: selectedProductId || '',
      productName: product?.name || '',
      sku: product?.sku || '',
      minStockM: selectedVariant
        ? numberOrZero(selectedVariant.min_stock_m)
        : suggestedFloor ?? 0,
      floorMode: selectedFloorMode,
      purchaseEnabled: !selectedInternalProductionEnabled
        || selectedFloorMode === 'buy_ready'
        || Boolean(selectedVariant?.purchase_enabled),
      supplierId: product?.supplier_id || '',
      supplierColorCode: product?.supplier_color_code || '',
      purchaseUnit: product?.purchase_unit || 'm',
      conversionRate: numberOrZero(product?.conversion_rate) || 1,
      purchasePrice: numberOrZero(product?.purchase_price),
      minOrderQuantity: numberOrZero(product?.min_order_quantity) || 1,
      purchaseMultiple: numberOrZero(product?.purchase_multiple) || 1,
      preparationDays: product?.material_preparation_days == null
        ? 2
        : numberOrZero(product.material_preparation_days),
      includeRecipe: selectedInternalProductionEnabled && Boolean(recipe),
      recipeId: recipe?.id || '',
      cutBandWidthMm: numberOrZero(recipe?.cut_band_width_mm),
      confirmedYield: hasYieldSuggestion
        ? numberOrZero(suggestedYieldMPerM)
        : numberOrZero(recipe?.confirmed_yield_m_per_m),
      executorType: recipe?.executor_type || 'factory',
      contractorId: recipe?.default_contractor_id || '',
      transformationCost: numberOrZero(recipe?.transformation_cost_per_m),
      reason: hasYieldSuggestion && selectedInternalProductionEnabled
        ? `Sugestão prospectiva baseada no rendimento real apurado de ${numberOrZero(suggestedYieldMPerM).toLocaleString('pt-BR')} m/m`
        : buyReadyReviewId && selectedProductId
          ? 'Cadastro nominal da tira comprada pronta em revisão'
          : mode === 'create' ? 'Cadastro inicial da variante' : '',
    });
    setValidationError(null);
    setMinStockConfirmed(Boolean(selectedVariant));
    setFloorModeConfirmed(Boolean(selectedVariant) || !selectedInternalProductionEnabled);
  }, [open, variantId, identityBasis, measureId, baseGroupId, colorId, finishedProductId,
    buyReadyReviewId, suggestedRecipeId, suggestedYieldMPerM, mode, catalog]);

  useEffect(() => {
    if (!open || !form.internalProductionEnabled || form.recipeId || !form.measureId || !form.baseGroupId) return;
    const exactRecipe = catalog.recipes
      .filter((item) => item.measure_id === form.measureId && item.base_group_id === form.baseGroupId)
      .sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!exactRecipe) return;
    setForm((current) => {
      if (current.recipeId
        || current.measureId !== exactRecipe.measure_id
        || current.baseGroupId !== exactRecipe.base_group_id) return current;
      return {
        ...current,
        includeRecipe: true,
        recipeId: exactRecipe.id,
        cutBandWidthMm: numberOrZero(exactRecipe.cut_band_width_mm),
        confirmedYield: numberOrZero(exactRecipe.confirmed_yield_m_per_m),
        executorType: exactRecipe.executor_type,
        contractorId: exactRecipe.default_contractor_id || '',
        transformationCost: numberOrZero(exactRecipe.transformation_cost_per_m),
      };
    });
  }, [open, form.internalProductionEnabled, form.recipeId, form.measureId, form.baseGroupId, catalog.recipes]);

  const selectedType = catalog.types.find((item) => item.id === form.typeId);
  const selectedMeasure = catalog.measures.find((item) => item.id === form.measureId);
  const selectedBase = catalog.groups.find((item) => item.id === form.baseGroupId);
  const selectedIdentityGroup = catalog.groups.find((item) => item.id === form.identityGroupId);
  const selectedColor = catalog.colors.find((item) => item.id === form.colorId);
  const exactBuyReadyProductPrefill = mode === 'create'
    && !variant
    && identityBasis === 'finished_product_group'
    && Boolean(buyReadyReviewId)
    && Boolean(finishedProductId)
    && Boolean(baseGroupId)
    && catalog.products.some((product) => (
      product.id === finishedProductId && product.group_id === baseGroupId
    ));
  const availableRegisteredBaseColors = registeredBaseMaterialColorsForGroup(
    catalog,
    form.baseGroupId,
  );
  const availablePurchasedColors = purchasedReadyStrapColorsForGroup(catalog, form.identityGroupId);
  const availableIdentityColors = form.identityBasis === 'finished_product_group'
    ? exactBuyReadyProductPrefill
      ? catalog.colors
        .filter((item) => item.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      : availablePurchasedColors
    : availableRegisteredBaseColors;
  const selectedColorIsAvailable = !!form.colorId
    && availableIdentityColors.some((item) => item.id === form.colorId);
  const displayedColors = selectedColor && !selectedColorIsAvailable
    ? [selectedColor, ...availableIdentityColors]
    : availableIdentityColors;
  const identityGroupProducts = catalog.products
    .filter((product) => product.group_id === form.identityGroupId
      && (product.active !== false || product.id === form.finishedProductId))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const finishedIdentityGroups = catalog.groups
    .filter((group) => group.id === form.identityGroupId || catalog.products.some((product) => (
      product.group_id === group.id && product.active !== false && product.unit === 'm'
    )))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const minStockSuggestion = mostFrequentMinStock(
    catalog,
    form.measureId,
    form.baseGroupId,
    form.variantId,
  );
  const currentRecipe = catalog.recipes.find((item) => item.id === form.recipeId);
  const widthProfile = catalog.width_profiles
    .filter((item) => item.base_group_id === form.baseGroupId && item.status === 'approved')
    .sort((a, b) => String(b.valid_from || '').localeCompare(String(a.valid_from || '')))[0];
  const usefulWidthMm = numberOrZero(widthProfile?.usable_width_mm);
  const theoreticalYield = form.cutBandWidthMm > 0 && usefulWidthMm > 0
    ? Math.floor(usefulWidthMm / form.cutBandWidthMm)
    : 0;
  const lateralRemainder = theoreticalYield > 0
    ? usefulWidthMm - theoreticalYield * form.cutBandWidthMm
    : 0;

  // Identidade já persistida é imutável; um review contextual sem variante
  // precisa continuar permitindo que o operador resolva a opção ambígua.
  const identityLocked = Boolean(variant);
  const canWrite = capabilities.manage_strap_catalog;
  const canSeeFinancial = capabilities.can_see_financial_values === true;
  const readOnly = !canWrite;
  const recipeIsMutable = !currentRecipe
    || currentRecipe.status === 'draft'
    || currentRecipe.status === 'pending_approval';
  const canEditRecipeFields = false;
  const purchasedReady = isPurchasedReadyStrap({
    identity_basis: form.identityBasis,
    internal_production_enabled: form.internalProductionEnabled,
  });

  const setField = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  };

  const setFloorMode = (value: ArtisanalStrapSourceMode) => {
    if (purchasedReady) return;
    setForm((current) => ({
      ...current,
      floorMode: value,
      purchaseEnabled: value === 'buy_ready' ? true : current.purchaseEnabled,
      includeRecipe: value === 'internal' ? Boolean(current.recipeId) : current.includeRecipe,
    }));
    setFloorModeConfirmed(false);
    setValidationError(null);
  };

  const setIdentityBasis = (identityBasis: ArtisanalStrapIdentityBasis) => {
    const isFinishedProduct = identityBasis === 'finished_product_group';
    setForm((current) => ({
      ...current,
      identityBasis,
      identityGroupId: isFinishedProduct ? current.identityGroupId : '',
      internalProductionEnabled: !isFinishedProduct,
      baseGroupId: isFinishedProduct ? '' : current.baseGroupId,
      colorId: '',
      finishedProductId: isFinishedProduct ? '' : current.finishedProductId,
      productName: isFinishedProduct ? '' : current.productName,
      sku: isFinishedProduct ? '' : current.sku,
      supplierId: isFinishedProduct ? '' : current.supplierId,
      supplierColorCode: '',
      floorMode: isFinishedProduct ? 'buy_ready' : current.floorMode,
      purchaseEnabled: isFinishedProduct || current.purchaseEnabled,
      includeRecipe: isFinishedProduct ? false : current.includeRecipe,
      recipeId: isFinishedProduct ? '' : current.recipeId,
    }));
    setFloorModeConfirmed(isFinishedProduct);
    setMinStockConfirmed(false);
    setValidationError(null);
  };

  const setInternalProductionEnabled = (enabled: boolean) => {
    setForm((current) => ({
      ...current,
      internalProductionEnabled: enabled,
      floorMode: enabled ? current.floorMode : 'buy_ready',
      purchaseEnabled: enabled ? current.purchaseEnabled : true,
      includeRecipe: enabled ? Boolean(current.recipeId) : false,
      recipeId: enabled ? current.recipeId : '',
    }));
    setFloorModeConfirmed(!enabled);
    setValidationError(null);
  };

  const validate = (): string | null => {
    if (!form.typeId && !form.typeName.trim()) return 'Selecione uma família ou informe uma nova.';
    if (!form.measureId && (!form.measureName.trim() || form.finishedWidthMm <= 0)) {
      return 'Selecione uma medida ou informe nome e largura final.';
    }
    if (form.identityBasis === 'reference_base' && !form.baseGroupId) return 'Selecione a napa-base.';
    if (form.identityBasis === 'finished_product_group' && !form.identityGroupId) {
      return 'Selecione o grupo próprio da tira comprada pronta.';
    }
    if (!form.colorId) return 'Selecione a cor canônica.';
    if (!selectedColorIsAvailable) {
      return form.identityBasis === 'finished_product_group'
        ? 'A cor selecionada não possui produto ativo no grupo acabado.'
        : 'A cor selecionada não está cadastrada em um produto ativo desta napa-base.';
    }
    if (purchasedReady && form.internalProductionEnabled) {
      return 'Tira identificada pelo grupo acabado não pode habilitar produção interna.';
    }
    if (form.minStockM < 0) return 'O estoque mínimo não pode ser negativo.';
    if (!minStockConfirmed) return 'Confirme explicitamente o estoque mínimo desta variante.';
    if (!form.floorMode) return 'Defina a origem da reposição do estoque mínimo.';
    if (!floorModeConfirmed) return 'Confirme explicitamente a origem da reposição do estoque mínimo.';
    if (form.identityBasis === 'finished_product_group' && !form.finishedProductId) {
      return 'Selecione o produto acabado comprado dentro do grupo de identidade.';
    }
    if (exactBuyReadyProductPrefill && (
      form.finishedProductId !== finishedProductId
      || form.identityGroupId !== baseGroupId
    )) {
      return 'A revisão nominal exige exatamente o produto e o grupo informados no diagnóstico.';
    }
    if (!form.finishedProductId && (!form.productName.trim() || !form.sku.trim())) {
      return 'Informe nome e SKU inequívocos para o produto acabado.';
    }
    const selectedFinishedProduct = catalog.products.find((product) => product.id === form.finishedProductId);
    if (form.identityBasis === 'finished_product_group'
      && selectedFinishedProduct?.group_id !== form.identityGroupId) {
      return 'O produto acabado deve pertencer ao grupo próprio selecionado.';
    }
    if (form.identityBasis === 'finished_product_group'
      && !exactBuyReadyProductPrefill
      && canonicalStrapColorForProduct(catalog, form.finishedProductId)?.id !== form.colorId) {
      return 'A cor canônica deve ser a cor exata do produto acabado selecionado.';
    }
    if (purchasedReady && (form.floorMode !== 'buy_ready' || !form.purchaseEnabled || form.includeRecipe)) {
      return 'Tira comprada pronta exige piso por compra, compra habilitada e nenhuma receita interna.';
    }
    if (form.floorMode === 'internal' && !form.recipeId) {
      return 'Reposição interna exige uma conversão cadastrada na aba Receitas.';
    }
    if (form.purchaseEnabled) {
      if (!canSeeFinancial && !form.finishedProductId) {
        return 'A compra pronta de um produto novo exige um usuário com acesso financeiro para informar o preço.';
      }
      if (canSeeFinancial && form.purchasePrice <= 0) return 'Informe um preço de compra maior que zero.';
      if (!form.purchaseUnit.trim()) return 'Informe a unidade de compra.';
      if (form.conversionRate <= 0) return 'A conversão de compra deve ser maior que zero.';
      if (form.purchaseUnit === 'm' && form.conversionRate !== 1) {
        return 'Quando a unidade de compra é metro, a conversão deve ser 1.';
      }
      if (form.minOrderQuantity <= 0 || form.purchaseMultiple <= 0) {
        return 'MOQ e múltiplo de compra devem ser maiores que zero.';
      }
      if (form.preparationDays < 0) return 'Os dias de preparo não podem ser negativos.';
    }
    if (!form.reason.trim()) return 'Informe o motivo para a trilha de auditoria.';
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }

    const generatedName = [
      selectedType?.name || form.typeName,
      selectedMeasure?.display_name || form.measureName,
      form.identityBasis === 'finished_product_group' ? selectedIdentityGroup?.name : selectedBase?.name,
      selectedColor?.name,
    ].filter(Boolean).join(' · ');

    const result = await saveBundle.mutateAsync({
      reason: form.reason.trim(),
      payload: {
        type: form.typeId
          ? { id: form.typeId }
          : { name: form.typeName.trim(), active: true },
        measure: form.measureId
          ? { id: form.measureId }
          : {
              display_name: form.measureName.trim(),
              finished_width_mm: form.finishedWidthMm,
              active: true,
            },
        variant: {
          id: form.variantId || undefined,
          base_group_id: form.identityBasis === 'finished_product_group'
            ? form.identityGroupId
            : form.baseGroupId,
          identity_basis: form.identityBasis,
          identity_group_id: form.identityBasis === 'finished_product_group'
            ? form.identityGroupId
            : null,
          internal_production_enabled: form.internalProductionEnabled,
          color_id: form.colorId,
          finished_product_id: form.finishedProductId || undefined,
          min_stock_m: form.minStockM,
          min_stock_replenishment_mode: form.floorMode,
          purchase_enabled: form.purchaseEnabled,
          status: (mode === 'review' && variant) || exactBuyReadyProductPrefill
            ? 'active'
            : variant?.status || 'review_required',
          review_reason: (mode === 'review' && variant) || exactBuyReadyProductPrefill
            ? null
            : variant?.review_reason || null,
        },
        product: form.finishedProductId
          ? {
              id: form.finishedProductId,
              supplier_id: form.supplierId || null,
              supplier_color_code: form.supplierColorCode.trim() || null,
              purchase_unit: form.purchaseUnit,
              conversion_rate: form.conversionRate,
              ...(canSeeFinancial ? { purchase_price: form.purchasePrice } : {}),
              min_order_quantity: form.minOrderQuantity,
              purchase_multiple: form.purchaseMultiple,
              material_preparation_days: form.preparationDays,
            }
          : {
              name: form.productName.trim() || generatedName,
              sku: form.sku.trim(),
              supplier_id: form.supplierId || null,
              supplier_color_code: form.supplierColorCode.trim() || null,
              purchase_unit: form.purchaseUnit,
              conversion_rate: form.conversionRate,
              ...(canSeeFinancial ? { purchase_price: form.purchasePrice } : {}),
              min_order_quantity: form.minOrderQuantity,
              purchase_multiple: form.purchaseMultiple,
              material_preparation_days: form.preparationDays,
            },
        recipe: undefined,
      },
    });
    onSaved?.(result.variant_id);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
        <div className="flex min-h-full flex-col">
          <SheetHeader className="border-b border-border px-4 pb-4 pt-5 pr-12 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{ORIGIN_LABEL[origin]}</Badge>
              <Badge variant="secondary">
                {mode === 'create' ? 'Novo cadastro' : mode === 'review' ? 'Revisão' : 'Edição'}
              </Badge>
            </div>
            <SheetTitle>{mode === 'create' ? 'Cadastrar tira' : 'Editar tira'}</SheetTitle>
            <SheetDescription>
              Cadastre a cor e o produto acabado no estoque. A conversão técnica é compartilhada entre todas as cores.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 px-4 py-5 sm:px-6">
            {!canWrite && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Consulta somente</AlertTitle>
                <AlertDescription>
                  Sua permissão permite consultar a identidade, mas não alterar o catálogo.
                </AlertDescription>
              </Alert>
            )}

            {exactBuyReadyProductPrefill && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertTitle>Produto nominal preservado</AlertTitle>
                <AlertDescription>
                  O produto e o grupo vieram da revisão por UUID e permanecem bloqueados.
                  Selecione explicitamente a família, a medida e a cor canônica antes de ativar.
                </AlertDescription>
              </Alert>
            )}

            <StrapIdentityTrail
              typeName={selectedType?.name || form.typeName}
              measureName={selectedMeasure?.display_name || form.measureName}
              baseName={form.identityBasis === 'finished_product_group'
                ? selectedIdentityGroup?.name
                : selectedBase?.name}
              baseLabel={form.identityBasis === 'finished_product_group' ? 'Grupo acabado' : 'Napa-base'}
              colorName={selectedColor?.name}
            />

            <section className="space-y-3" aria-labelledby="strap-editor-identity">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-primary" />
                <h3 id="strap-editor-identity" className="text-sm font-bold">Identidade exata</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Base da identidade *</Label>
                  <Select
                    value={form.identityBasis}
                    onValueChange={(value) => setIdentityBasis(value as ArtisanalStrapIdentityBasis)}
                    disabled={readOnly || identityLocked || exactBuyReadyProductPrefill}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reference_base">Segue a napa da referência</SelectItem>
                      <SelectItem value="finished_product_group">Grupo próprio do produto acabado</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {form.identityBasis === 'finished_product_group'
                      ? 'Tira comprada pronta: não muda quando a referência troca SOFT por MADRI.'
                      : 'Tira cortada da napa efetiva da referência ou da variante de material.'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Família/tipo *</Label>
                  <Select
                    value={form.typeId || '__new__'}
                    onValueChange={(value) => {
                      setField('typeId', value === '__new__' ? '' : value);
                      setField('measureId', '');
                    }}
                    disabled={readOnly || identityLocked}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Nova família…</SelectItem>
                      {catalog.types.filter((item) => item.active).map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!form.typeId && (
                    <Input
                      value={form.typeName}
                      onChange={(event) => setField('typeName', event.target.value)}
                      placeholder="Ex.: TIRA CHATA"
                      disabled={readOnly || identityLocked}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Medida final *</Label>
                  <Select
                    value={form.measureId || '__new__'}
                    onValueChange={(value) => setField('measureId', value === '__new__' ? '' : value)}
                    disabled={readOnly || identityLocked || (!form.typeId && !form.typeName.trim())}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Nova medida…</SelectItem>
                      {catalog.measures
                        .filter((item) => item.active && item.strap_type_id === form.typeId)
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.display_name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {!form.measureId && (
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <Input
                        value={form.measureName}
                        onChange={(event) => setField('measureName', event.target.value)}
                        placeholder="Ex.: 8 mm"
                        disabled={readOnly || identityLocked}
                      />
                      <NumberInput
                        value={form.finishedWidthMm}
                        onChange={(value) => setField('finishedWidthMm', value)}
                        unit="mm"
                        disabled={readOnly || identityLocked}
                      />
                    </div>
                  )}
                </div>

                {form.identityBasis === 'reference_base' ? (
                  <div className="space-y-1.5">
                    <Label>Napa-base *</Label>
                    <Select
                      value={form.baseGroupId}
                      onValueChange={(value) => {
                        setForm((current) => ({
                          ...current,
                          baseGroupId: value,
                          colorId: '',
                          supplierColorCode: '',
                          minStockM: mostFrequentMinStock(catalog, current.measureId, value, current.variantId) ?? 0,
                        }));
                        setMinStockConfirmed(false);
                        setValidationError(null);
                      }}
                      disabled={readOnly || identityLocked || exactBuyReadyProductPrefill}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione a base" /></SelectTrigger>
                      <SelectContent>
                        {catalog.groups.map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Grupo próprio da tira *</Label>
                    <Select
                      value={form.identityGroupId}
                      onValueChange={(value) => {
                        setForm((current) => ({
                          ...current,
                          identityGroupId: value,
                          colorId: '',
                          finishedProductId: '',
                          productName: '',
                          sku: '',
                          supplierId: '',
                          supplierColorCode: '',
                        }));
                        setMinStockConfirmed(false);
                        setValidationError(null);
                      }}
                      disabled={readOnly || identityLocked || exactBuyReadyProductPrefill}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione o grupo acabado" /></SelectTrigger>
                      <SelectContent>
                        {finishedIdentityGroups.map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
                  <div>
                    <Label htmlFor="strap-internal-production">Produção interna</Label>
                    <p className="text-xs text-muted-foreground">
                      {form.identityBasis === 'finished_product_group'
                        ? 'Indisponível para identidade por produto acabado.'
                        : 'Permite cortar esta tira da napa-base e usar receita/rendimento.'}
                    </p>
                  </div>
                  <Switch
                    id="strap-internal-production"
                    checked={form.internalProductionEnabled}
                    onCheckedChange={setInternalProductionEnabled}
                    disabled={readOnly || form.identityBasis === 'finished_product_group'}
                    aria-label="Habilitar produção interna da tira"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Cor canônica *</Label>
                  <Select
                    value={form.colorId}
                    onValueChange={(value) => {
                      setForm((current) => ({
                        ...current,
                        colorId: value,
                        supplierColorCode: value === current.colorId
                          ? current.supplierColorCode
                          : '',
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked || (
                      form.identityBasis === 'finished_product_group' && !exactBuyReadyProductPrefill
                    )}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
                    <SelectContent>
                      {displayedColors.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}{availableIdentityColors.some((color) => color.id === item.id)
                            ? form.identityBasis === 'reference_base'
                              ? ' · Cadastrada na base'
                              : ' · Disponível para adicionar'
                            : ' · vínculo inválido'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(form.identityBasis === 'finished_product_group'
                    ? form.identityGroupId
                    : form.baseGroupId) && availableIdentityColors.length === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {form.identityBasis === 'finished_product_group'
                        ? 'Nenhum produto ativo deste grupo possui cor canônica mapeada.'
                        : 'Nenhum produto ativo desta napa-base possui uma cor cadastrada.'}
                    </p>
                  )}
                  {form.colorId && !selectedColorIsAvailable && (
                    <Alert variant="destructive">
                      <Warning className="h-4 w-4" />
                      <AlertTitle>Cor fora da identidade</AlertTitle>
                      <AlertDescription>
                        {form.identityBasis === 'finished_product_group'
                          ? 'A cor precisa existir como produto ativo dentro do grupo acabado.'
                          : 'Esta cor não está mais cadastrada em um produto ativo desta napa-base.'}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3" aria-labelledby="strap-editor-product">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h3 id="strap-editor-product" className="text-sm font-bold">Produto e estoque</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.identityBasis === 'finished_product_group' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Produto comprado pronto *</Label>
                    <Select
                      value={form.finishedProductId}
                      onValueChange={(productId) => {
                        const product = catalog.products.find((item) => item.id === productId);
                        if (!product) return;
                        const canonicalColor = canonicalStrapColorForProduct(catalog, product.id);
                        setForm((current) => ({
                          ...current,
                          finishedProductId: product.id,
                          productName: product.name,
                          sku: product.sku || '',
                          colorId: canonicalColor?.id || '',
                          supplierId: product.supplier_id || '',
                          supplierColorCode: product.supplier_color_code || '',
                          purchaseUnit: product.purchase_unit || 'm',
                          conversionRate: numberOrZero(product.conversion_rate) || 1,
                          purchasePrice: numberOrZero(product.purchase_price),
                          minOrderQuantity: numberOrZero(product.min_order_quantity) || 1,
                          purchaseMultiple: numberOrZero(product.purchase_multiple) || 1,
                          preparationDays: product.material_preparation_days == null
                            ? 2
                            : numberOrZero(product.material_preparation_days),
                        }));
                        setValidationError(null);
                      }}
                      disabled={readOnly || identityLocked || exactBuyReadyProductPrefill || !form.identityGroupId}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione um produto ativo do grupo" /></SelectTrigger>
                      <SelectContent>
                        {identityGroupProducts.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}{product.color ? ` · ${product.color}` : ''}{product.sku ? ` · ${product.sku}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      O produto permanece comprado (<strong>não artesanal</strong>) e deve estar no mesmo grupo da identidade.
                    </p>
                  </div>
                )}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nome do produto acabado *</Label>
                  <Input
                    value={form.productName}
                    onChange={(event) => setField('productName', event.target.value)}
                    placeholder="TIRA CHATA · 8 mm · NAPA SOFT · OFF WHITE"
                    disabled={readOnly || Boolean(form.finishedProductId) || form.identityBasis === 'finished_product_group'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>SKU inequívoco *</Label>
                  <Input
                    value={form.sku}
                    onChange={(event) => setField('sku', event.target.value)}
                    placeholder="TCH-08-SOFT-OW"
                    disabled={readOnly || Boolean(form.finishedProductId) || form.identityBasis === 'finished_product_group'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Estoque mínimo *</Label>
                  <NumberInput
                    value={form.minStockM}
                    onChange={(value) => {
                      setField('minStockM', value);
                      setMinStockConfirmed(false);
                    }}
                    unit="m"
                    disabled={readOnly}
                  />
                  {minStockSuggestion != null && !variant && (
                    <p className="text-xs text-muted-foreground">
                      Sugestão das variantes irmãs: <strong>{minStockSuggestion.toLocaleString('pt-BR')} m</strong>. Revise antes de confirmar.
                    </p>
                  )}
                  <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                    <Checkbox
                      checked={minStockConfirmed}
                      onCheckedChange={(checked) => setMinStockConfirmed(checked === true)}
                      disabled={readOnly}
                      aria-label="Confirmar estoque mínimo"
                    />
                    <span>Revisei e confirmo este estoque mínimo, inclusive se o valor for zero.</span>
                  </label>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Origem da reposição do estoque mínimo *</Label>
                  <Select
                    value={form.floorMode}
                    onValueChange={(value) => setFloorMode(value as ArtisanalStrapSourceMode)}
                    disabled={readOnly || purchasedReady}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">Produzir com napa própria</SelectItem>
                      <SelectItem value="buy_ready">Comprar tira pronta</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {purchasedReady
                      ? 'Origem fixa: esta tira só pode ser comprada pronta, inclusive no PV.'
                      : 'Essa escolha vale somente para recompor o piso; cada PV mantém sua própria origem.'}
                  </p>
                  <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                    <Checkbox
                      checked={floorModeConfirmed}
                      onCheckedChange={(checked) => setFloorModeConfirmed(checked === true)}
                      disabled={readOnly || purchasedReady}
                      aria-label="Confirmar origem da reposição do estoque mínimo"
                    />
                    <span>Revisei e confirmo este modo de reposição do piso para a variante.</span>
                  </label>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3" aria-labelledby="strap-editor-recipe">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Factory className="h-4 w-4 text-primary" />
                  <h3 id="strap-editor-recipe" className="text-sm font-bold">Conversão compartilhada</h3>
                </div>
              </div>

              {purchasedReady ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="mr-2">Comprada pronta</Badge>
                  Receita, rendimento, lote interno e transformação não se aplicam a esta identidade.
                </p>
              ) : form.includeRecipe ? (
                <div className="space-y-3">
                  <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                    Esta conversão vale para todas as cores da mesma família, medida e napa-base.
                    Para alterar banda ou rendimento, use a aba Receitas.
                  </p>
                  {Number.isFinite(Number(suggestedYieldMPerM)) && Number(suggestedYieldMPerM) > 0 && (
                    <Alert>
                      <Warning className="h-4 w-4" />
                      <AlertTitle>Sugestão do rendimento realizado</AlertTitle>
                      <AlertDescription>
                        O valor de {numberOrZero(suggestedYieldMPerM).toLocaleString('pt-BR')} m/m foi pré-preenchido para uma nova versão em rascunho. A receita aprovada permanece imutável até envio e aprovação explícitos.
                      </AlertDescription>
                    </Alert>
                  )}
                  {currentRecipe && !recipeIsMutable && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">Receita v{currentRecipe.version} preservada</p>
                        <p className="text-xs text-muted-foreground">Receitas vigentes e históricas são imutáveis.</p>
                      </div>
                    </div>
                  )}
                  {!widthProfile && form.baseGroupId && (
                    <Alert>
                      <Warning className="h-4 w-4" />
                      <AlertTitle>Largura útil pendente</AlertTitle>
                      <AlertDescription>
                        Aprove o perfil de largura da napa-base na aba Cadastro antes de salvar a receita.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Largura útil da napa</Label>
                      <NumberInput value={usefulWidthMm} onChange={() => undefined} unit="mm" disabled />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Largura da banda *</Label>
                      <NumberInput
                        value={form.cutBandWidthMm}
                        onChange={(value) => setField('cutBandWidthMm', value)}
                        unit="mm"
                        disabled={readOnly || !canEditRecipeFields}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Rendimento confirmado *</Label>
                      <NumberInput
                        value={form.confirmedYield}
                        onChange={(value) => setField('confirmedYield', value)}
                        unit="m/m"
                        disabled={readOnly || !canEditRecipeFields}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bandas completas</p>
                      <p className="font-mono text-lg font-bold">{theoreticalYield || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Teórico</p>
                      <p className="font-mono text-lg font-bold">{theoreticalYield ? `${theoreticalYield} m/m` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sobra lateral</p>
                      <p className="font-mono text-lg font-bold">{theoreticalYield ? `${lateralRemainder} mm` : '—'}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Executor padrão *</Label>
                      <Select
                        value={form.executorType}
                        onValueChange={(value) => setField('executorType', value as 'factory' | 'contractor')}
                        disabled={readOnly || !canEditRecipeFields}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="factory">Fábrica</SelectItem>
                          <SelectItem value="contractor">Terceirizado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.executorType === 'contractor' && (
                      <div className="space-y-1.5">
                        <Label>Terceirizado *</Label>
                        <Select
                          value={form.contractorId}
                          onValueChange={(value) => setField('contractorId', value)}
                          disabled={readOnly || !canEditRecipeFields}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {contractors.filter((item) => item.active).map((item) => (
                              <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {catalog.capabilities.can_see_financial_values !== false && (
                      <div className="space-y-1.5">
                        <Label>Custo de transformação</Label>
                        <NumberInput
                          value={form.transformationCost}
                          onChange={(value) => setField('transformationCost', value)}
                          unit="R$/m"
                          disabled={readOnly || !canEditRecipeFields}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Nenhuma conversão cadastrada para esta medida e napa-base. Cadastre os números uma única vez na aba Receitas; depois, todas as cores reutilizarão a mesma conversão.
                </p>
              )}
            </section>

            <Separator />

            <section className="space-y-3" aria-labelledby="strap-editor-purchase">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-primary" />
                  <h3 id="strap-editor-purchase" className="text-sm font-bold">Comprada pronta</h3>
                </div>
                <Switch
                  checked={form.purchaseEnabled}
                  onCheckedChange={(checked) => setField('purchaseEnabled', checked)}
                  disabled={readOnly || form.floorMode === 'buy_ready' || purchasedReady}
                  aria-label="Habilitar compra de tira pronta"
                />
              </div>

              {form.purchaseEnabled ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Fornecedor</Label>
                    <Select
                      value={form.supplierId || '__none__'}
                      onValueChange={(value) => {
                        const supplierId = value === '__none__' ? '' : value;
                        setForm((current) => ({
                          ...current,
                          supplierId,
                          supplierColorCode: supplierId === current.supplierId
                            ? current.supplierColorCode
                            : '',
                        }));
                        setValidationError(null);
                      }}
                      disabled={readOnly}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sem fornecedor — OC provisória</SelectItem>
                        {suppliers.filter((item) => item.active).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="strap-supplier-color-code">Código da cor no fornecedor</Label>
                    <Input
                      id="strap-supplier-color-code"
                      value={form.supplierColorCode}
                      onChange={(event) => setField('supplierColorCode', event.target.value)}
                      placeholder={form.supplierId ? 'Código exato desta cor' : 'Selecione um fornecedor primeiro'}
                      disabled={readOnly || !form.supplierId}
                    />
                    <p className="text-xs text-muted-foreground">Código específico deste produto/cor; não é copiado para outras cores.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unidade de compra *</Label>
                    <Select value={form.purchaseUnit} onValueChange={(value) => setField('purchaseUnit', value)} disabled={readOnly}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="m">Metro</SelectItem>
                        <SelectItem value="rolo">Rolo</SelectItem>
                        <SelectItem value="pacote">Pacote</SelectItem>
                        <SelectItem value="un">Unidade</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Conversão para metros *</Label>
                    <NumberInput value={form.conversionRate} onChange={(value) => setField('conversionRate', value)} unit="m" disabled={readOnly} />
                  </div>
                  {catalog.capabilities.can_see_financial_values !== false && (
                    <div className="space-y-1.5">
                      <Label>Preço de compra *</Label>
                      <NumberInput value={form.purchasePrice} onChange={(value) => setField('purchasePrice', value)} unit="R$" disabled={readOnly} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Quantidade mínima (MOQ) *</Label>
                    <NumberInput value={form.minOrderQuantity} onChange={(value) => setField('minOrderQuantity', value)} disabled={readOnly} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Múltiplo/pacote *</Label>
                    <NumberInput value={form.purchaseMultiple} onChange={(value) => setField('purchaseMultiple', value)} disabled={readOnly} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Dias de preparo *</Label>
                    <NumberInput value={form.preparationDays} onChange={(value) => setField('preparationDays', value)} unit="dias" decimals={0} disabled={readOnly} />
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Compra pronta desabilitada. O produto não será oferecido como origem comprada no PV.
                </p>
              )}
            </section>

            {!readOnly && (
              <section className="space-y-1.5" aria-labelledby="strap-editor-audit">
                <Label id="strap-editor-audit">Motivo da alteração *</Label>
                <Textarea
                  value={form.reason}
                  onChange={(event) => setField('reason', event.target.value)}
                  placeholder="Explique o cadastro ou ajuste para a auditoria."
                  rows={2}
                />
              </section>
            )}

            {validationError && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Revise o cadastro</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="sticky bottom-0 border-t border-border bg-background px-4 py-4 sm:px-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            {!readOnly && (
              <Button onClick={handleSave} disabled={saveBundle.isPending} className="gap-2">
                <FloppyDisk className="h-4 w-4" />
                {saveBundle.isPending ? 'Salvando…' : mode === 'review' ? 'Salvar e ativar' : 'Salvar tudo'}
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
