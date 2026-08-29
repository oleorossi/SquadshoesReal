import { PageSkeleton } from '@/components/layout/PageSkeleton';
import { useState, useEffect, useMemo } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUpdateProduct, ProductSchema, useProducts } from '@/hooks/useProducts';
import { useForceDeleteProductFlow } from '@/components/inventory/ForceDeleteProductDialog';
import { MasterVariantDialog } from '@/components/inventory/MasterVariantDialog';
import { MaterialClassificationRail } from '@/components/groups/MaterialClassificationRail';
import { useCurrentProfile } from '@/hooks/useUserManagement';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useComponentSheets, useAddComponentSheet, useUpdateComponentSheet } from '@/hooks/useComponentSheets';
import { Product, ProductFormData, UNITS, LOCATIONS } from '@/types/inventory';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  ArrowLeft,
  FloppyDisk as Save,
  CircleNotch as Loader2,
  Image as ImageIcon,
  X,
  Stack as Layers,
  Footprints,
  ClockCounterClockwise as History,
  PlusCircle,
  MinusCircle,
  Warning as AlertTriangle,
  Palette,
  Ruler,
} from '@phosphor-icons/react';
import { cn, formatMoney, formatNumber, getSoleModelName, stripColorFromName } from '@/lib/utils';
import { toast } from 'sonner';
import { z } from 'zod';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { PURCHASE_UNITS, PRODUCTION_UNITS, normalizePurchaseUnit, normalizeProductionUnit } from '@/lib/productUnits';
import { SoleSilkPanel } from '@/components/technical-sheets/SoleSilkPanel';
import StockHistory from './StockHistory';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { sectorLabel, sectorOfGroup } from '@/lib/categoryFromGroup';
import { getGroupPath } from '@/lib/groupHierarchy';
import { useCan } from '@/hooks/useAccessControl';

const SOLADO_COLORS = ['Preto', 'Caramelo'];
const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = Array.from({ length: 16 }, (_, i) => 21 + i);
const PRODUCT_DETAIL_TABS = ['general', 'stock', 'technical', 'purchase', 'history'] as const;
const PRODUCT_DETAIL_TAB_ALIASES = { details: 'general' } as const;


// Unidades e normalização vêm da fonte ÚNICA (src/lib/productUnits.ts). Os
// normalizadores/listas locais foram removidos em 2026-07-04 — o antigo
// normalizeProductionUnit devolvia 'metros' (fora do enum canônico UNITS),
// reintroduzindo o bug que a normalização em massa de 2026-05-30 corrigiu.
// Agora 'metro'/'metros' → 'm' e nada de 'gr'/'metros' no dropdown.

const normalizeCalculationMethod = (value?: string | null): 'weight' | 'meter' | 'unit' => {
  if (value === 'weight' || value === 'meter' || value === 'unit') return value;
  return 'weight';
};

const sumGrade = (grade: Record<string, number>) => Object.entries(grade)
  .filter(([key]) => !key.startsWith('_'))
  .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);

/** Mesma identidade usada pela lista de estoque: grupo heterogêneo não pode
 * misturar Fivela, Ilhós e Binóculo como se fossem cores do mesmo material. */
const getVariantBaseName = (product: Product) => {
  if (product.category?.toLowerCase().includes('solado')) {
    return getSoleModelName(product.name, product.color).toUpperCase();
  }
  const withoutColor = stripColorFromName(product.name, product.color).trim();
  return withoutColor.replace(/\s+-\s+.*$/, '').trim().toUpperCase() || withoutColor.toUpperCase();
};

export default function ProductDetail() {
  // A aba mora na URL (contrato do lote L6): antes era <Tabs defaultValue>, então
  // F5 e o botão Voltar devolviam o usuário à primeira aba.
  const { value: abaUrl, setValue: setAbaUrl } = useUrlTabState({
    values: PRODUCT_DETAIL_TABS,
    defaultValue: 'general',
    aliases: PRODUCT_DETAIL_TAB_ALIASES,
  });
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const perm = useCan('/estoque');
  const [zoomOpen, setZoomOpen] = useState(false);
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Product;
    },
    enabled: !!id,
  });

  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();
  const { data: componentSheets = [] } = useComponentSheets();
  const updateProduct = useUpdateProduct();
  const forceDeleteFlow = useForceDeleteProductFlow({
    onSuccess: () => navigate('/estoque'),
  });
  const variantDeleteFlow = useForceDeleteProductFlow();
  const { data: allProducts = [] } = useProducts();
  const addComponentSheet = useAddComponentSheet();
  const updateComponentSheet = useUpdateComponentSheet();

  // Form state
  const [form, setForm] = useState<ProductFormData>({
    name: '', technical_name: '', sku: '', category: '', color: '', quantity: 0, min_stock: 0, max_stock: 0,
    unit: 'un', unit_price: 0, location: '', group_id: null, active: true, image_url: '',
    min_stock_grade: {}, stock_grade: {}, yield_per_meter: null, yield_unit: 'dm²',
    dimensions_length: 0, dimensions_width: 0, dimensions_thickness: 0, dimensions_unit: 'mm',
    purchase_unit: 'un', production_unit: 'un', conversion_rate: 1, purchase_order_unit: 'un',
    min_order_quantity: 1, safety_stock: 0, lead_time_days: 7, calculation_method: 'weight',
    supplier_id: null, supplier_color_code: null,
    lot_number: null, expiration_date: null, is_chemical: false,
    linked_last_id: null, sole_material: null, heel_height: null,
  });

  const [soladoGrade, setSoladoGrade] = useState<Record<string, number>>({});
  const [minStockGrade, setMinStockGrade] = useState<Record<string, number>>({});
  const [shoeCategory, setShoeCategory] = useState<'adulto' | 'infantil'>('adulto');
  const [yieldPerSize, setYieldPerSize] = useState<Record<string, number>>({});
  const [plateLength, setPlateLength] = useState(0);
  const [plateWidth, setPlateWidth] = useState(0);
  const [plateThickness, setPlateThickness] = useState(0);
  const [plateUnit, setPlateUnit] = useState('mm');

  const selectedGroup = useMemo(
    () => groups.find(group => group.id === form.group_id) || null,
    [groups, form.group_id],
  );
  const effectiveCategory = selectedGroup ? sectorOfGroup(selectedGroup) : form.category;
  const selectedGroupPath = useMemo(
    () => selectedGroup ? getGroupPath(groups, selectedGroup.id) : [],
    [groups, selectedGroup],
  );
  const selectedFamily = useMemo(
    () => [...selectedGroupPath].reverse().find(group => group.id !== selectedGroup?.id && group.is_family) || null,
    [selectedGroupPath, selectedGroup],
  );
  const leafGroups = useMemo(() => {
    const parentIds = new Set(groups.map(group => group.parent_group_id).filter(Boolean));
    return groups
      .filter(group => !group.is_family && !parentIds.has(group.id))
      .sort((a, b) => {
        const sectorOrder = sectorLabel(sectorOfGroup(a)).localeCompare(sectorLabel(sectorOfGroup(b)), 'pt-BR');
        if (sectorOrder !== 0) return sectorOrder;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [groups]);
  const groupOptionLabels = useMemo(() => new Map(
    leafGroups.map(group => [
      group.id,
      getGroupPath(groups, group.id).map(pathItem => pathItem.name).join(' › '),
    ]),
  ), [groups, leafGroups]);

  const isSolado = effectiveCategory.toLowerCase().includes('solado');
  const hasGrade = isSolado;
  const currentSizes = shoeCategory === 'infantil' ? CHILD_SIZES : ADULT_SIZES;

  const variantBaseName = useMemo(
    () => product ? getVariantBaseName(product) : '',
    [product],
  );
  const groupVariants = useMemo(() => {
    if (!product?.group_id || !variantBaseName) return [] as Product[];
    return allProducts.filter(candidate => (
      candidate.group_id === product.group_id && getVariantBaseName(candidate) === variantBaseName
    ));
  }, [allProducts, product, variantBaseName]);
  const soladoColorOptions = useMemo(() => Array.from(new Set([
    form.color,
    ...groupVariants.map(variant => variant.color || ''),
    ...SOLADO_COLORS,
  ].map(color => color.trim()).filter(Boolean))), [form.color, groupVariants]);

  const grossStock = hasGrade ? sumGrade(soladoGrade) : Number(form.quantity) || 0;
  const reservedStock = Number(product?.reserved_stock) || 0;
  const availableStock = grossStock - reservedStock;
  const minimumStock = hasGrade ? sumGrade(minStockGrade) : Number(form.min_stock) || 0;
  const stockValue = grossStock * (Number(form.unit_price) || 0);
  const stockStatus = (() => {
    if (availableStock < 0) return { label: 'Crítico', variant: 'destructive' as const };
    if (minimumStock === 0) return { label: 'Normal', variant: 'success' as const };
    const ratio = availableStock / minimumStock;
    if (ratio <= 0.5) return { label: 'Crítico', variant: 'destructive' as const };
    if (ratio <= 1) return { label: 'Baixo', variant: 'warning' as const };
    return { label: 'Normal', variant: 'success' as const };
  })();

  const hasGroupDimensions = Boolean(selectedGroup && (
    Number(selectedGroup.dimensions_width) > 0 ||
    Number(selectedGroup.dimensions_length) > 0 ||
    Number(selectedGroup.dimensions_thickness) > 0
  ));
  const matchesGroupDimensions = Boolean(selectedGroup && hasGroupDimensions &&
    Number(plateWidth) === Number(selectedGroup.dimensions_width || 0) &&
    Number(plateLength) === Number(selectedGroup.dimensions_length || 0) &&
    Number(plateThickness) === Number(selectedGroup.dimensions_thickness || 0) &&
    plateUnit === (selectedGroup.dimensions_unit || 'mm'));
  const hasSizedYieldData = Object.entries(yieldPerSize).some(([key, value]) => (
    !key.startsWith('_') && key !== 'unit' && Number(value) > 0
  ));
  const showTechnicalYield = !isSolado && (
    hasSizedYieldData || ['Cabedal', 'Palmilha', 'Forração da Palmilha'].includes(effectiveCategory)
  );

  const existingSheet = useMemo(() => {
    if (!product) return null;
    return componentSheets.find(sheet => sheet.product_id === product.id) || null;
  }, [product, componentSheets]);

  // Populate form from product
  useEffect(() => {
    if (!product) return;
    const { id: _id, created_at, updated_at, ...rest } = product;
    const cleanName = stripColorFromName(rest.name || '', rest.color);
    const sheet = componentSheets.find(candidate => candidate.product_id === product.id);
    setForm({
      name: cleanName, technical_name: rest.technical_name || '', sku: rest.sku || '',
      category: rest.category || '', color: rest.color || '', quantity: rest.quantity ?? 0,
      min_stock: rest.min_stock ?? 0, max_stock: rest.max_stock ?? 0, unit: rest.unit || 'un',
      unit_price: rest.unit_price ?? 0, location: rest.location || '', group_id: rest.group_id || null,
      active: rest.active ?? true, image_url: rest.image_url || '',
      min_stock_grade: (rest.min_stock_grade && typeof rest.min_stock_grade === 'object' && !Array.isArray(rest.min_stock_grade))
        ? (rest.min_stock_grade as Record<string, number>) : {},
      stock_grade: (rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade))
        ? (rest.stock_grade as Record<string, number>) : {},
      yield_per_meter: rest.yield_per_meter ?? null, yield_unit: rest.yield_unit || 'dm²',
      dimensions_length: rest.dimensions_length ?? 0, dimensions_width: rest.dimensions_width ?? 0,
      dimensions_thickness: rest.dimensions_thickness ?? 0, dimensions_unit: rest.dimensions_unit || 'mm',
      purchase_unit: normalizePurchaseUnit(rest.purchase_unit),
      production_unit: normalizeProductionUnit(rest.production_unit),
      conversion_rate: rest.conversion_rate ?? (
        normalizePurchaseUnit(rest.purchase_unit || rest.purchase_order_unit) !== normalizeProductionUnit(rest.unit)
          ? 0
          : 1
      ),
      purchase_order_unit: normalizePurchaseUnit(rest.purchase_order_unit),
      min_order_quantity: rest.min_order_quantity ?? 1,
      safety_stock: rest.safety_stock ?? 0, lead_time_days: rest.lead_time_days ?? 7,
      calculation_method: normalizeCalculationMethod(rest.calculation_method),
      supplier_id: rest.supplier_id || null,
      supplier_color_code: rest.supplier_color_code || null,
      lot_number: rest.lot_number || null, expiration_date: rest.expiration_date || null,
      is_chemical: rest.is_chemical ?? false,
      linked_last_id: rest.linked_last_id || null,
      sole_material: rest.sole_material || null,
      heel_height: rest.heel_height ?? null,
    });
    // A ficha de componente é a fonte lida pelos motores de conversão. Só cai
    // no snapshot do produto quando ainda não existe ficha para este item.
    const dimensionSource = sheet || rest;
    setPlateLength(Number(dimensionSource.dimensions_length) || 0);
    setPlateWidth(Number(dimensionSource.dimensions_width) || 0);
    setPlateThickness(Number(dimensionSource.dimensions_thickness) || 0);
    setPlateUnit(dimensionSource.dimensions_unit || 'mm');

    const nextGrade = rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade)
      ? rest.stock_grade as Record<string, number>
      : {};
    const nextMinimumGrade = rest.min_stock_grade && typeof rest.min_stock_grade === 'object' && !Array.isArray(rest.min_stock_grade)
      ? rest.min_stock_grade as Record<string, number>
      : {};
    setSoladoGrade(nextGrade);
    setMinStockGrade(nextMinimumGrade);
    const nextYield = sheet?.yield_per_size && typeof sheet.yield_per_size === 'object'
      ? sheet.yield_per_size as Record<string, number>
      : {};
    setYieldPerSize(nextYield);
    const numericSizes = [...Object.keys(nextGrade), ...Object.keys(nextMinimumGrade), ...Object.keys(nextYield)]
      .map(Number)
      .filter(size => !Number.isNaN(size));
    setShoeCategory(numericSizes.some(size => size < 34) ? 'infantil' : 'adulto');
  }, [product, componentSheets]);

  // Sync grade total into quantity
  useEffect(() => {
    const productAlreadyUsesGrade = product?.category?.toLowerCase().includes('solado') ?? false;
    const hasEditableGrade = Object.keys(soladoGrade).some(key => !key.startsWith('_'));
    if (hasGrade && (productAlreadyUsesGrade || hasEditableGrade)) {
      const total = sumGrade(soladoGrade);
      update('quantity', total);
    }
  }, [soladoGrade, hasGrade, product?.category]);

  const update = <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) =>
    setForm(prev => {
      const next = { ...prev, [key]: value };
      
      if (key === 'purchase_order_unit' || key === 'unit') {
        const pUnit = normalizePurchaseUnit(key === 'purchase_order_unit' ? (value as string) : prev.purchase_order_unit);
        const sUnit = key === 'unit' ? (value as string) : prev.unit;
        
        if (pUnit === 'm²' && sUnit === 'dm²') {
          next.conversion_rate = 100;
        } else if (pUnit === 'dm²' && sUnit === 'm²') {
          next.conversion_rate = 0.01;
        } else if (pUnit === sUnit && (pUnit === 'm²' || pUnit === 'dm²')) {
          next.conversion_rate = 1;
        }
      }
      
      return next;
    });

  const handleGroupChange = (value: string) => {
    const nextGroupId = value === 'none' ? null : value;
    const nextGroup = groups.find(group => group.id === nextGroupId) || null;
    setForm(prev => ({
      ...prev,
      group_id: nextGroupId,
      category: nextGroup ? sectorOfGroup(nextGroup) : prev.category,
    }));
  };

  const applyGroupDimensions = () => {
    if (!selectedGroup || !hasGroupDimensions) return;
    // Largura e comprimento mantêm seus papéis próprios; não escolher a maior:
    // a conversão de bobina depende exclusivamente de dimensions_width.
    setPlateWidth(Number(selectedGroup.dimensions_width) || 0);
    setPlateLength(Number(selectedGroup.dimensions_length) || 0);
    setPlateThickness(Number(selectedGroup.dimensions_thickness) || 0);
    setPlateUnit(selectedGroup.dimensions_unit || 'mm');
  };

  const handleSave = async () => {
    if (!perm.canEdit) {
      toast.error('Seu acesso ao estoque é somente para consulta.');
      return;
    }
    if (!product) return;
    const groupHasChildren = selectedGroup
      ? groups.some(group => group.parent_group_id === selectedGroup.id)
      : false;
    if (selectedGroup && (selectedGroup.is_family || groupHasChildren)) {
      toast.error('Escolha um grupo-folha. Famílias e grupos-pai não recebem itens.');
      return;
    }
    const productAlreadyUsesGrade = product.category?.toLowerCase().includes('solado');
    if (hasGrade && !productAlreadyUsesGrade && Number(product.quantity) > 0 && sumGrade(soladoGrade) === 0) {
      toast.error('Distribua o saldo atual na grade antes de reclassificar este item como solado.');
      return;
    }
    setSaving(true);
    try {
      const baseData = { ...form };
      baseData.category = effectiveCategory;
      if (hasGrade) {
        baseData.min_stock_grade = minStockGrade;
        baseData.min_stock = sumGrade(minStockGrade);
        baseData.stock_grade = soladoGrade;
      }
      baseData.dimensions_length = plateLength;
      baseData.dimensions_width = plateWidth;
      baseData.dimensions_thickness = plateThickness;
      baseData.dimensions_unit = plateUnit;
      baseData.supplier_color_code = baseData.supplier_color_code?.trim() || null;
      if (baseData.supplier_color_code && !baseData.supplier_id) {
        toast.error('Selecione o fornecedor antes de informar o código da cor.');
        return;
      }

      const purchaseUnit = normalizePurchaseUnit(baseData.purchase_unit || baseData.purchase_order_unit);
      const stockUnit = normalizeProductionUnit(baseData.unit);
      const conversionRate = Number(baseData.conversion_rate);
      if (purchaseUnit !== stockUnit && (!Number.isFinite(conversionRate) || conversionRate <= 0)) {
        toast.error('A taxa de conversão deve ser maior que zero quando a unidade de compra for diferente da unidade de estoque.');
        return;
      }

      const validatedData = ProductSchema.parse(baseData);
      await updateProduct.mutateAsync({ id: product.id, data: validatedData as ProductFormData });

      // O limite por numeração não altera saldo e, portanto, não passa pelo RPC
      // de ajuste. useUpdateProduct o remove junto das grades de quantidade;
      // persisti-lo aqui evita que o mínimo editado suma ao recarregar a tela.
      if (hasGrade) {
        const { error: minimumGradeError } = await supabase
          .from('products')
          .update({ min_stock_grade: minStockGrade })
          .eq('id', product.id);
        if (minimumGradeError) throw minimumGradeError;
      }

      // `useUpdateProduct` remove quantity/stock_grade do UPDATE plano (precisam
      // do audit trail + controle de concorrência do RPC adjust_stock). Sem este
      // passo o campo "Quantidade Atual" mostrava sucesso mas o novo saldo era
      // descartado silenciosamente. Persistir a mudança de saldo pelo caminho
      // correto (mesmo RPC usado por StockAdjustmentPage/SoladoGradeDialog).
      const previousQty = Number(product.quantity ?? 0);
      let newQty: number;
      let newGrade: Record<string, number> | null = null;
      if (hasGrade) {
        // soladoGrade pode carregar metadados (_size_from/_size_to) — não somar
        // essas chaves no total, mas preservá-las no grade gravado.
        newGrade = soladoGrade;
        newQty = Object.entries(soladoGrade)
          .filter(([k]) => !k.startsWith('_'))
          .reduce((s, [, v]) => s + (Number(v) || 0), 0);
      } else {
        newQty = Number(form.quantity ?? 0);
      }
      const expectedGrade = (product.stock_grade && typeof product.stock_grade === 'object' && !Array.isArray(product.stock_grade))
        ? (product.stock_grade as Record<string, number>) : null;
      const currentGrade = expectedGrade ?? {};
      const qtyChanged = Math.abs(newQty - previousQty) > 1e-9;
      const gradeChanged = hasGrade && JSON.stringify(newGrade) !== JSON.stringify(currentGrade);
      if (qtyChanged || gradeChanged) {
        const res = await adjustStockSafe({
          productId: product.id,
          expectedPrevious: previousQty,
          newQty,
          reason: 'Ajuste manual pelo cadastro do material',
          expectedGrade,
          newGrade,
        });
        if (!res.success) {
          toast.error(res.errorMessage || 'Falha ao ajustar o estoque do material');
          return; // não sinaliza sucesso — o saldo não foi persistido
        }
      }

      // Save component sheet
      const hasYieldData = Object.values(yieldPerSize).some(v => v > 0);
      const hasDimensionData = plateWidth > 0 || plateLength > 0 || plateThickness > 0;
      const sheetData = {
        product_id: product.id,
        group_id: form.group_id || null,
        dimensions_length: plateLength,
        dimensions_width: plateWidth,
        dimensions_thickness: plateThickness,
        dimensions_unit: plateUnit,
        // Sem `waste_pct`: a coluna foi DROPADA em 20261115120300 (perda de corte
        // saiu do sistema). Mandá-la aqui derrubava o upsert da ficha com 42703 —
        // e o produto já tinha sido salvo acima, deixando os dois fora de sincronia.
        yield_per_size: yieldPerSize,
      };
      if (existingSheet) {
        await updateComponentSheet.mutateAsync({ id: existingSheet.id, data: sheetData });
      } else if (hasYieldData || hasDimensionData) {
        await addComponentSheet.mutateAsync({ ...sheetData, notes: '' });
      }

      qc.invalidateQueries({ queryKey: ['product-detail', id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
      toast.success('Material salvo com sucesso');
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        // Guards do banco (ex.: largura obrigatória em material de área,
        // tg_require_width_for_area_material) trazem a instrução no message —
        // engolir isso deixa o usuário sem saber o que preencher.
        const message = (error as { message?: string })?.message;
        toast.error(message || 'Erro ao salvar material');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!perm.canDelete) {
      toast.error('Você não tem permissão para excluir materiais.');
      return;
    }
    if (!product) return;
    forceDeleteFlow.tryDelete(product.id);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <PageSkeleton />
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="font-semibold text-foreground">Falha ao carregar dados</p>
          <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
        </div>
      </AppLayout>
    );
  }

  if (!product) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Material não encontrado</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/estoque')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar ao Estoque
          </Button>
        </div>
      </AppLayout>
    );
  }

  const classificationItem = [form.name, form.color].filter(Boolean).join(' · ') || 'Item sem nome';
  const selectedGroupIsLeaf = !selectedGroup || leafGroups.some(group => group.id === selectedGroup.id);
  const canManageVariants = (
    form.group_id === product.group_id &&
    groupVariants.length > 1
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/estoque')} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> Estoque
        </Button>

        <EditorialPageHeader
          sectionLabel="ESTOQUE · ITEM INDIVIDUAL"
          title={stripColorFromName(product.name, product.color)}
          description={product.sku}
          actions={
            <>
              {form.color && <Badge variant="secondary">{form.color}</Badge>}
              {perm.canEdit && canManageVariants && (
                <Button
                  variant="outline"
                  onClick={() => setVariantDialogOpen(true)}
                  className="gap-1.5"
                >
                  <Palette className="h-3.5 w-3.5" />
                  Variantes ({groupVariants.length})
                </Button>
              )}
              {perm.canEdit && <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar
              </Button>}
              {perm.canDelete && <DeleteConfirmButton onConfirm={handleDelete} title="Excluir material?" />}
            </>
          }
        />

        <MaterialClassificationRail
          sector={effectiveCategory}
          family={selectedFamily?.name}
          group={selectedGroup?.name}
          variant={classificationItem}
        />

        {!perm.canEdit && (
          <div className="border border-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Modo somente leitura — você pode consultar todas as informações, mas não alterar o material ou movimentar estoque.
          </div>
        )}

        <Panel
          eyebrow="POSIÇÃO ATUAL"
          title="Resumo de estoque"
          subtitle="Disponível = saldo bruto menos o que já está reservado para OPs abertas."
          flush
        >
          <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <div className="border-b border-r border-border p-4 xl:border-b-0">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Bruto</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                {formatNumber(grossStock, Number.isInteger(grossStock) ? 0 : 2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{form.unit}</span>
              </dd>
            </div>
            <div className="border-b border-border p-4 md:border-r xl:border-b-0">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reservado</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                {formatNumber(reservedStock, Number.isInteger(reservedStock) ? 0 : 2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{form.unit}</span>
              </dd>
            </div>
            <div className="border-b border-r border-border p-4 xl:border-b-0">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Disponível</dt>
              <dd className={cn(
                'mt-1 font-mono text-lg font-bold tabular-nums',
                availableStock < 0 ? 'text-destructive' : 'text-foreground',
              )}>
                {formatNumber(availableStock, Number.isInteger(availableStock) ? 0 : 2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{form.unit}</span>
              </dd>
            </div>
            <div className="border-b border-border p-4 md:border-r xl:border-b-0">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mínimo</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                {formatNumber(minimumStock, Number.isInteger(minimumStock) ? 0 : 2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{form.unit}</span>
              </dd>
            </div>
            <div className="border-r border-border p-4">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</dt>
              <dd className="mt-2"><Badge variant={stockStatus.variant}>{stockStatus.label}</Badge></dd>
            </div>
            <div className="p-4">
              <dt className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Valor bruto</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{formatMoney(stockValue)}</dd>
            </div>
          </dl>
        </Panel>

        <Tabs value={abaUrl} onValueChange={setAbaUrl} className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="general" className="min-w-[120px] flex-1">Geral</TabsTrigger>
            <TabsTrigger value="stock" className="min-w-[170px] flex-1">Estoque e custo</TabsTrigger>
            <TabsTrigger value="technical" className="min-w-[125px] flex-1">Técnica</TabsTrigger>
            <TabsTrigger value="purchase" className="min-w-[210px] flex-1">Compra / rastreio</TabsTrigger>
            <TabsTrigger value="history" className="min-w-[135px] flex-1 gap-2">
              <History className="h-4 w-4" />
              Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-4">
                  {form.image_url ? (
                    <button
                      type="button"
                      className="w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setZoomOpen(true)}
                      aria-label="Ampliar imagem do material"
                    >
                      <img
                        src={form.image_url}
                        alt={form.name || product.name}
                        className="max-h-64 w-full rounded-lg object-contain transition-all hover:ring-2 hover:ring-primary/50"
                      />
                    </button>
                  ) : (
                    <div className="flex h-48 w-full items-center justify-center rounded-lg bg-muted">
                      <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="w-full">
                    <Label className="text-xs text-muted-foreground">URL da imagem</Label>
                    <Input
                      value={form.image_url}
                      onChange={event => update('image_url', event.target.value)}
                      className="mt-1 text-xs"
                      placeholder="https://..."
                    />
                  </div>
                </CardContent>
              </Card>

              <Panel
                title="Identificação e classificação"
                subtitle="O setor é herdado do grupo; famílias e grupos-pai não recebem itens diretamente."
                className="lg:col-span-2"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Nome *</Label>
                    <Input value={form.name} onChange={event => update('name', event.target.value)} className="mt-1" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Nome técnico</Label>
                    <Textarea
                      value={form.technical_name || ''}
                      onChange={event => update('technical_name', event.target.value)}
                      className="mt-1 min-h-[58px]"
                    />
                  </div>
                  <div>
                    <Label>Código (SKU) *</Label>
                    <Input value={form.sku} onChange={event => update('sku', event.target.value)} className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label>{isSolado ? 'Cor do solado' : 'Cor / variante'}</Label>
                    {isSolado ? (
                      <Select value={form.color} onValueChange={value => update('color', value)}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
                        <SelectContent>
                          {soladoColorOptions.map(color => <SelectItem key={color} value={color}>{color}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={form.color} onChange={event => update('color', event.target.value)} className="mt-1" />
                    )}
                  </div>

                  <div>
                    <Label>Grupo / linha *</Label>
                    <Select value={form.group_id || 'none'} onValueChange={handleGroupChange}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um grupo-folha" /></SelectTrigger>
                      <SelectContent className="max-h-[360px]">
                        <SelectItem value="none">Sem grupo (cadastro legado)</SelectItem>
                        {selectedGroup && !selectedGroupIsLeaf && (
                          <SelectItem value={selectedGroup.id} disabled>
                            {selectedGroup.name} — não é grupo-folha
                          </SelectItem>
                        )}
                        {leafGroups.map(group => (
                          <SelectItem key={group.id} value={group.id}>
                            {sectorLabel(sectorOfGroup(group))} · {groupOptionLabels.get(group.id) || group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!selectedGroupIsLeaf && (
                      <p className="mt-1 text-xs text-warning">
                        Este vínculo legado aponta para uma família ou grupo-pai. Escolha uma linha final.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>Setor / categoria</Label>
                    <div className="mt-1 flex h-10 items-center justify-between rounded-md border border-border bg-muted/30 px-3">
                      <span className="text-sm font-medium">{sectorLabel(effectiveCategory)}</span>
                      <Badge variant={selectedGroup ? 'outline' : 'warning-soft'}>
                        {selectedGroup ? 'derivado do grupo' : 'legado sem grupo'}
                      </Badge>
                    </div>
                  </div>

                  {isSolado && (
                    <>
                      <div>
                        <Label>Material do solado</Label>
                        <Input
                          value={form.sole_material || ''}
                          onChange={event => update('sole_material', event.target.value)}
                          placeholder="TR, PVC, PU..."
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Altura do salto (mm)</Label>
                        <NumberInput
                          value={form.heel_height || 0}
                          onChange={value => update('heel_height', value)}
                          min={0}
                          step="0.1"
                          className="mt-1"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Fôrma vinculada</Label>
                        <Select
                          value={form.linked_last_id || 'none'}
                          onValueChange={value => update('linked_last_id', value === 'none' ? null : value)}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Selecione a fôrma correspondente" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhuma fôrma vinculada</SelectItem>
                            {allProducts
                              .filter(candidate => (
                                candidate.category === 'Fôrma' ||
                                candidate.category === 'Ferramentas' ||
                                candidate.id === form.linked_last_id
                              ))
                              .map(candidate => (
                                <SelectItem key={candidate.id} value={candidate.id}>
                                  {candidate.name} {candidate.sku ? '(' + candidate.sku + ')' : ''}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-3 pt-4">
                    <Switch id="active" checked={form.active} onCheckedChange={value => update('active', value)} />
                    <Label htmlFor="active">Material ativo</Label>
                  </div>
                </div>
              </Panel>
            </div>
          </TabsContent>

          <TabsContent value="stock" className="space-y-6">
            {hasGrade && (
              <Panel
                title={<span className="flex items-center gap-2"><Footprints className="h-4 w-4 text-primary" /> Grade de numeração</span>}
                subtitle="Saldo e mínimo são controlados por tamanho; os totais alimentam o resumo acima."
                bodyClassName="space-y-4"
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={shoeCategory === 'adulto' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShoeCategory('adulto')}
                  >
                    Adulto (34–40)
                  </Button>
                  <Button
                    type="button"
                    variant={shoeCategory === 'infantil' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShoeCategory('infantil')}
                  >
                    Infantil (21–36)
                  </Button>
                </div>
                <div className="overflow-x-auto pb-2">
                  <div className={cn(
                    'grid gap-2',
                    shoeCategory === 'infantil' ? 'min-w-[720px] grid-cols-8' : 'min-w-[620px] grid-cols-7',
                  )}>
                    {currentSizes.map(size => (
                      <div key={size} className="space-y-2 rounded-md border border-border bg-muted/15 p-2">
                        <p className="text-center font-mono text-xs font-bold text-foreground">{size}</p>
                        <div>
                          <Label className="text-[9px] uppercase tracking-wide text-muted-foreground">Atual</Label>
                          <NumberInput
                            min={0}
                            step="1"
                            value={soladoGrade[String(size)] || 0}
                            onChange={value => setSoladoGrade(prev => ({ ...prev, [String(size)]: value }))}
                            className="h-8 px-1 text-center text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-[9px] uppercase tracking-wide text-muted-foreground">Mínimo</Label>
                          <NumberInput
                            min={0}
                            step="1"
                            value={minStockGrade[String(size)] || 0}
                            onChange={value => setMinStockGrade(prev => ({ ...prev, [String(size)]: value }))}
                            className="h-8 px-1 text-center text-xs"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>Saldo bruto: <strong className="font-mono text-foreground">{formatNumber(grossStock, 0)} pares</strong></span>
                  <span>Mínimo: <strong className="font-mono text-foreground">{formatNumber(minimumStock, 0)} pares</strong></span>
                </div>
              </Panel>
            )}

            <Panel
              title="Estoque e custo"
              subtitle="Alterações de saldo continuam passando pelo ajuste auditado de estoque."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {!hasGrade && (
                  <>
                    <div>
                      <Label>Quantidade atual</Label>
                      <NumberInput
                        min={0}
                        step="0.0001"
                        value={form.quantity}
                        onChange={value => update('quantity', value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Estoque mínimo</Label>
                      <NumberInput
                        min={0}
                        step="0.0001"
                        value={form.min_stock}
                        onChange={value => update('min_stock', value)}
                        className="mt-1"
                      />
                    </div>
                  </>
                )}
                <div>
                  <Label>Reservado para OPs</Label>
                  <div className="mt-1 flex h-10 items-center rounded-md border border-border bg-muted/30 px-3 font-mono text-sm tabular-nums">
                    {formatNumber(reservedStock, Number.isInteger(reservedStock) ? 0 : 2)} {form.unit}
                  </div>
                </div>
                <div>
                  <Label>Unidade-base</Label>
                  <Select value={form.unit} onValueChange={value => update('unit', value)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Localização</Label>
                  <Select value={form.location} onValueChange={value => update('location', value)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {LOCATIONS.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Custo unitário (R$)</Label>
                  <CurrencyInput value={form.unit_price} onChange={value => update('unit_price', value)} className="mt-1" />
                </div>
                <div>
                  <Label>Cálculo de consumo</Label>
                  <Select
                    value={normalizeCalculationMethod(form.calculation_method)}
                    onValueChange={value => update('calculation_method', value as ProductFormData['calculation_method'])}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weight">Por peso (kg)</SelectItem>
                      <SelectItem value="meter">Por metro / área</SelectItem>
                      <SelectItem value="unit">Por unidade / par</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="technical" className="space-y-6">
            <Panel
              title={<span className="flex items-center gap-2"><Ruler className="h-4 w-4 text-primary" /> Dimensões do material</span>}
              subtitle="Largura e comprimento têm funções distintas no cálculo industrial."
              actions={hasGroupDimensions ? (
                <Button variant="outline" size="sm" onClick={applyGroupDimensions}>
                  Usar dimensões do grupo
                </Button>
              ) : null}
              bodyClassName="space-y-4"
            >
              {selectedGroup ? (
                <div className="flex flex-col justify-between gap-3 border-l-2 border-primary bg-muted/20 px-3 py-2 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Referência do grupo {selectedGroup.name}
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      Largura {formatNumber(Number(selectedGroup.dimensions_width) || 0, 2)}
                      {' × '}comprimento {formatNumber(Number(selectedGroup.dimensions_length) || 0, 2)}
                      {' × '}espessura {formatNumber(Number(selectedGroup.dimensions_thickness) || 0, 2)}
                      {' '}{selectedGroup.dimensions_unit || 'mm'}
                    </p>
                  </div>
                  <Badge variant={matchesGroupDimensions ? 'success-soft' : hasGroupDimensions ? 'warning-soft' : 'outline'}>
                    {matchesGroupDimensions ? 'herdado do grupo' : hasGroupDimensions ? 'exceção neste item' : 'grupo sem dimensões'}
                  </Badge>
                </div>
              ) : (
                <div className="border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
                  Vincule um grupo-folha para comparar e herdar a especificação dimensional.
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label>Largura útil</Label>
                  <NumberInput value={plateWidth} onChange={setPlateWidth} min={0} step="0.1" className="mt-1" />
                </div>
                <div>
                  <Label>Comprimento</Label>
                  <NumberInput value={plateLength} onChange={setPlateLength} min={0} step="0.1" className="mt-1" />
                </div>
                <div>
                  <Label>Espessura</Label>
                  <NumberInput value={plateThickness} onChange={setPlateThickness} min={0} step="0.01" className="mt-1" />
                </div>
                <div>
                  <Label>Unidade dimensional</Label>
                  <Select value={plateUnit} onValueChange={setPlateUnit}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mm">mm</SelectItem>
                      <SelectItem value="cm">cm</SelectItem>
                      <SelectItem value="m">m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A conversão de material de área para metro linear usa exclusivamente a <strong className="text-foreground">largura útil</strong>.
                O comprimento só compõe a área de placas.
              </p>
            </Panel>

            {showTechnicalYield && (
              <Panel
                title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Rendimento técnico</span>}
                subtitle="Consumo em dm² por par e numeração. Itens unitários, químicos, ferramentas e solados não exibem esta grade aqui."
                bodyClassName="space-y-4"
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={shoeCategory === 'adulto' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShoeCategory('adulto')}
                  >
                    Adulto (34–40)
                  </Button>
                  <Button
                    type="button"
                    variant={shoeCategory === 'infantil' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShoeCategory('infantil')}
                  >
                    Infantil (21–36)
                  </Button>
                </div>
                <div className="overflow-x-auto pb-2">
                  <div className={cn(
                    'grid gap-2',
                    shoeCategory === 'infantil' ? 'min-w-[720px] grid-cols-8' : 'min-w-[620px] grid-cols-7',
                  )}>
                    {currentSizes.map(size => (
                      <div key={'yield-' + size} className="text-center">
                        <span className="font-mono text-xs font-medium text-muted-foreground">{size}</span>
                        <NumberInput
                          min={0}
                          step="0.01"
                          value={yieldPerSize[String(size)] || 0}
                          onChange={value => setYieldPerSize(prev => ({ ...prev, [String(size)]: value }))}
                          className="mt-1 h-8 px-1 text-center text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  {existingSheet
                    ? <Badge variant="secondary">Ficha existente</Badge>
                    : Object.values(yieldPerSize).some(value => Number(value) > 0)
                      ? <Badge variant="outline" className="border-primary/30 text-primary">Nova ficha será criada</Badge>
                      : <span className="text-xs italic text-muted-foreground">Sem ficha de componente</span>
                  }
                </div>
              </Panel>
            )}

            {isSolado && (
              <Panel
                title={<span className="flex items-center gap-2"><Footprints className="h-4 w-4 text-primary" /> Grade e consumo do solado</span>}
                subtitle="Numerações e consumo por par são cadastrados por modelo e valem para todas as cores."
              >
                <Button variant="outline" className="gap-2" onClick={() => navigate('/solados')}>
                  <Footprints className="h-4 w-4" />
                  Gerenciar em Solados
                </Button>
              </Panel>
            )}

            {isSolado && (
              <Panel
                title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Cadastro de silk por solado</span>}
                subtitle="Artes vinculadas a este solado, com diferenciação por cliente ou grupo econômico."
              >
                <SoleSilkPanel
                  soleProductId={product.id}
                  soleName={stripColorFromName(product.name, product.color)}
                  readOnly={!perm.canEdit}
                />
              </Panel>
            )}
          </TabsContent>

          <TabsContent value="purchase" className="space-y-6">
            <Panel
              title="Fornecedor e reposição"
              subtitle="O código de cor pertence a esta variante e não é propagado para as cores irmãs."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <Label>Fornecedor</Label>
                  <Select value={form.supplier_id || 'none'} onValueChange={value => {
                    const supplierId = value === 'none' ? null : value;
                    setForm(prev => ({
                      ...prev,
                      supplier_id: supplierId,
                      supplier_color_code: null,
                    }));
                  }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem fornecedor</SelectItem>
                      {suppliers.filter(supplier => supplier.active).map(supplier => (
                        <SelectItem key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-2">
                  <Label htmlFor="supplier_color_code">Código da cor no fornecedor</Label>
                  <Input
                    id="supplier_color_code"
                    value={form.supplier_color_code || ''}
                    onChange={event => update('supplier_color_code', event.target.value)}
                    disabled={!form.supplier_id}
                    className="mt-1 font-mono"
                    placeholder={form.supplier_id ? 'Ex.: MAD-047' : 'Selecione um fornecedor primeiro'}
                  />
                </div>
                <div>
                  <Label>Lead time (dias)</Label>
                  <NumberInput
                    value={form.lead_time_days ?? 7}
                    onChange={value => update('lead_time_days', value)}
                    min={0}
                    step="1"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Lote mínimo de compra</Label>
                  <NumberInput
                    value={form.min_order_quantity ?? 1}
                    onChange={value => update('min_order_quantity', value)}
                    min={0}
                    step="1"
                    className="mt-1"
                  />
                </div>
              </div>
            </Panel>

            <Panel
              title="Conversão industrial"
              subtitle="Uma unidade-base por produto; o fator só converte a unidade recebida para a unidade de estoque."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label>Unidade de compra</Label>
                  <Select value={normalizePurchaseUnit(form.purchase_unit)} onValueChange={value => update('purchase_unit', value)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PURCHASE_UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Unidade de consumo</Label>
                  <Select value={normalizeProductionUnit(form.production_unit)} onValueChange={value => update('production_unit', value)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRODUCTION_UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Fator de conversão</Label>
                  <NumberInput
                    value={form.conversion_rate ?? 1}
                    onChange={value => update('conversion_rate', value)}
                    min={0.0001}
                    step="0.01"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    1 {normalizePurchaseUnit(form.purchase_unit)} = {form.conversion_rate ?? 1} {normalizeProductionUnit(form.production_unit)}
                  </p>
                </div>
                <div>
                  <Label>Unidade na OC</Label>
                  <Select
                    value={normalizePurchaseUnit(form.purchase_order_unit)}
                    onValueChange={value => update('purchase_order_unit', value)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PURCHASE_UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Panel>

            <Panel title="Rastreabilidade">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label>Nº do lote</Label>
                  <Input
                    value={form.lot_number || ''}
                    onChange={event => update('lot_number', event.target.value || null)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Data de validade</Label>
                  <Input
                    type="date"
                    value={form.expiration_date || ''}
                    onChange={event => update('expiration_date', event.target.value || null)}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <Switch
                    id="is_chemical"
                    checked={form.is_chemical ?? false}
                    onCheckedChange={value => update('is_chemical', value)}
                  />
                  <Label htmlFor="is_chemical">Produto químico</Label>
                </div>
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            {perm.canEdit && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <StockMovementForm product={product} type="in" />
                <StockMovementForm product={product} type="out" />
              </div>
            )}
            <Panel title="Histórico de movimentações">
              <StockHistory filterProductId={product.id} hideHeader={true} />
            </Panel>
          </TabsContent>
        </Tabs>

        <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-3 border-t border-border bg-background/95 p-4 backdrop-blur-sm">
          <Button variant="outline" onClick={() => navigate('/estoque')}>Cancelar</Button>
          {perm.canEdit && <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar alterações
          </Button>}
        </div>
      </div>

      {form.image_url && (
        <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
          <DialogContent className="max-w-3xl bg-background/95 p-2 backdrop-blur-sm">
            <button
              type="button"
              className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1.5 transition-colors hover:bg-muted"
              onClick={() => setZoomOpen(false)}
              aria-label="Fechar imagem ampliada"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex min-h-[300px] items-center justify-center">
              <img src={form.image_url} alt={form.name || product.name} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {perm.canEdit && canManageVariants && (
        <MasterVariantDialog
          open={variantDialogOpen}
          onOpenChange={open => {
            setVariantDialogOpen(open);
            if (!open) {
              qc.invalidateQueries({ queryKey: ['product-detail', product.id] });
            }
          }}
          baseName={variantBaseName}
          variants={groupVariants}
          onEditVariant={variant => {
            setVariantDialogOpen(false);
            if (variant.id !== product.id) navigate('/estoque/' + variant.id);
          }}
          onDeleteVariant={variantId => {
            if (variantId === product.id) {
              setVariantDialogOpen(false);
              forceDeleteFlow.tryDelete(variantId);
              return;
            }
            variantDeleteFlow.tryDelete(variantId);
          }}
        />
      )}
      {forceDeleteFlow.dialog}
      {variantDeleteFlow.dialog}
    </AppLayout>
  );
}
 
function StockMovementForm({ product, type }: { product: Product, type: 'in' | 'out' }) {
   const qc = useQueryClient();
   const { data: profile } = useCurrentProfile();
   const [quantity, setQuantity] = useState(0);
   const [description, setDescription] = useState('');
   const [responsible, setResponsible] = useState('');
   const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
   const [lotNumber, setLotNumber] = useState(product.lot_number || '');
   const [loading, setLoading] = useState(false);
 
   const handleMovement = async () => {
     if (quantity <= 0) {
       toast.error('Informe uma quantidade válida');
       return;
     }
 
     setLoading(true);
     try {
       const finalResponsible = responsible || profile?.full_name || profile?.email || 'Sistema';

       // Movimento pelo comando canônico (auditoria T4/concorrência). Antes a tela
       // calculava `prevStock ± qty` do snapshot React e gravava o ABSOLUTO em
       // products.quantity — qualquer débito de OP que tivesse acontecido no
       // meio-tempo era apagado sem erro nenhum. A RPC lê sob FOR UPDATE e
       // ainda barra saída avulsa que comeria material reservado pra OP.
       // RPC posterior à última geração dos tipos do Supabase.
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
       const { data, error: rpcErr } = await (supabase as any).rpc('move_stock_delta', {
         p_product_id: product.id,
         p_type: type,
         p_qty: quantity,
         p_description: description || null,
         p_lot_number: lotNumber || null,
         p_created_at: new Date(date).toISOString(),
         p_responsible: finalResponsible,
       });
       if (!result.success) throw new Error(result.errorMessage || 'Falha ao registrar o movimento');

       toast.success(type === 'in' ? 'Entrada registrada!' : 'Saída registrada!');
       setQuantity(0);
       setDescription('');
       qc.invalidateQueries({ queryKey: ['product-detail', product.id] });
       qc.invalidateQueries({ queryKey: ['stock_movements'] });
     } catch (error) {
       toast.error(`Erro: ${error instanceof Error ? error.message : 'Falha ao registrar movimentação'}`);
     } finally {
       setLoading(false);
     }
   };
 
   return (
     <Card className={cn("border-l-4", type === 'in' ? "border-l-success" : "border-l-destructive")}>
       <CardHeader className="pb-2">
         <CardTitle className="text-sm flex items-center gap-2">
           {type === 'in' ? <PlusCircle className="h-4 w-4 text-success" /> : <MinusCircle className="h-4 w-4 text-destructive" />}
           Registrar {type === 'in' ? 'Entrada' : 'Saída'}
         </CardTitle>
       </CardHeader>
       <CardContent className="space-y-3">
         <div className="grid grid-cols-2 gap-3">
           <div className="space-y-1">
             <Label className="text-xs uppercase text-muted-foreground">Quantidade ({product.unit})</Label>
             <NumberInput value={quantity} onChange={setQuantity} min={0} step="0.0001" />
           </div>
           <div className="space-y-1">
             <Label className="text-xs uppercase text-muted-foreground">Data</Label>
             <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
           </div>
         </div>
         <div className="grid grid-cols-2 gap-3">
           <div className="space-y-1">
             <Label className="text-xs uppercase text-muted-foreground">Lote</Label>
             <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder="Opcional" />
           </div>
           <div className="space-y-1">
             <Label className="text-xs uppercase text-muted-foreground">Responsável</Label>
             <Input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder="Nome..." />
           </div>
         </div>
         <div className="space-y-1">
           <Label className="text-xs uppercase text-muted-foreground">Motivo / Descrição</Label>
           <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Compra NF 123, Ajuste..." />
         </div>
         <Button
           className={cn("w-full mt-2", type === 'in' ? "bg-success hover:bg-success/90" : "")}
           variant={type === 'in' ? 'default' : 'destructive'}
           onClick={handleMovement}
           disabled={loading || quantity <= 0}
         >
           {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
           Confirmar {type === 'in' ? 'Entrada' : 'Saída'}
         </Button>
       </CardContent>
     </Card>
   );
 }
