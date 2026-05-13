import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { stripColorFromName } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Product, ProductFormData, UNITS, UNIT_LABELS, LOCATIONS } from '@/types/inventory';
import { deriveCategoryFromGroup } from '@/lib/categoryFromGroup';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useProducts } from '@/hooks/useProducts';
import { useComponentSheets, useAddComponentSheet, useUpdateComponentSheet } from '@/hooks/useComponentSheets';
import { NumberInput } from '@/components/ui/number-input';
import { toast } from 'sonner';
import { X, Layers, ArrowRightLeft, Footprints, Box, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import React from 'react';
import { SoleSizeConjugationsEditor } from './SoleSizeConjugationsEditor';
import { useSoleConjugations } from '@/hooks/useSoleConjugations';

const SOLADO_COLORS = ['Preto', 'Caramelo'];
const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = Array.from({ length: 16 }, (_, i) => 21 + i); // 21-36
const ALL_SIZES = Array.from({ length: 22 }, (_, i) => 20 + i); // 20-41

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProductFormData, createComponentSheet?: boolean) => void | Promise<void>;
  onSubmitMultiple?: (data: ProductFormData[], createComponentSheet?: boolean) => void | Promise<void>;
  product?: Product | null;
  onEditProduct?: (product: Product) => void;
  defaultGroupId?: string;
}

/** Normalize legacy purchase unit strings to the canonical UNITS values. */
const normalizeUnit = (value?: string | null): string => {
  if (!value) return 'un';
  const v = value.trim().toLowerCase();
  if (v === 'metro' || v === 'metros' || v === 'm linear') return 'm';
  if (v === 'm2') return 'm²';
  if (v === 'dm2') return 'dm²';
  if (v === 'unidade' || v === 'und') return 'un';
  if (v === 'grama' || v === 'gramas' || v === 'gr') return 'g';
  if (v === 'litro' || v === 'litros' || v === 'lt') return 'L';
  return UNITS.includes(v as any) ? v : value.trim();
};

const normalizeCalculationMethod = (
  value?: string | null,
): NonNullable<ProductFormData['calculation_method']> => {
  if (value === 'weight' || value === 'meter' || value === 'unit') return value;
  return 'weight';
};

const emptyForm: ProductFormData = {
   name: '', technical_name: '', sku: '', category: '', color: '', quantity: 0, min_stock: 0, max_stock: 0, unit: 'un', unit_price: 0, price_wholesale: 0, price_retail: 0, location: '', group_id: null, active: true, image_url: '', min_stock_grade: {}, stock_grade: {}, yield_per_meter: null, yield_unit: 'dm²', dimensions_length: 0, dimensions_width: 0, dimensions_thickness: 0, dimensions_unit: 'mm',
  purchase_unit: 'un', production_unit: 'un', conversion_rate: 1, purchase_order_unit: 'un', min_order_quantity: 0,
  safety_stock: 0, lead_time_days: 7, supplier_lead_time_days: 7,
  calculation_method: 'weight',
  supplier_id: null,
  lot_number: null, expiration_date: null, is_chemical: false,
   linked_last_id: null, sole_material: null, heel_height: null,
   consumption_unit: null, is_standard_sole_item: false,
 };

// Whitelist de campos que fazem sentido propagar entre variações de cor do
// mesmo grupo. Excluídos: name, sku, color, quantity, max_stock, min_stock_grade,
// stock_grade, image_url, group_id, active, linked_last_id, sole_material,
// heel_height (próprios da variante).
const PROPAGABLE_FIELDS = [
  'unit_price', 'price_wholesale', 'price_retail',
  'unit', 'consumption_unit',
  'location',
  'dimensions_length', 'dimensions_width', 'dimensions_thickness', 'dimensions_unit',
  'yield_per_meter', 'yield_unit',
  'technical_name', 'category',
  'supplier_lead_time_days', 'lead_time_days',
  'min_stock',
  'supplier_id',
  'purchase_unit', 'production_unit', 'conversion_rate',
  'purchase_order_unit', 'min_order_quantity',
  'safety_stock',
  'calculation_method',
  'is_chemical',
] as const;

const PROPAGABLE_LABELS: Record<string, string> = {
  unit_price: 'Preço unitário',
  price_wholesale: 'Preço atacado',
  price_retail: 'Preço varejo',
  unit: 'Unidade',
  consumption_unit: 'Unidade de consumo',
  location: 'Localização',
  dimensions_length: 'Comprimento',
  dimensions_width: 'Largura',
  dimensions_thickness: 'Espessura',
  dimensions_unit: 'Unidade dimensional',
  yield_per_meter: 'Rendimento',
  yield_unit: 'Unidade de rendimento',
  technical_name: 'Nome técnico',
  category: 'Categoria',
  supplier_lead_time_days: 'Lead time fornecedor',
  lead_time_days: 'Lead time',
  min_stock: 'Estoque mínimo',
  supplier_id: 'Fornecedor',
  purchase_unit: 'Unidade de compra',
  production_unit: 'Unidade de produção',
  conversion_rate: 'Taxa de conversão',
  purchase_order_unit: 'Unidade de ordem de compra',
  min_order_quantity: 'Quantidade mínima',
  safety_stock: 'Estoque de segurança',
  calculation_method: 'Método de cálculo',
  is_chemical: 'Material químico',
};

function computePropagableDiff(original: Product, next: ProductFormData): Record<string, any> {
  const diff: Record<string, any> = {};
  for (const f of PROPAGABLE_FIELDS) {
    const a = (original as any)[f];
    const b = (next as any)[f];
    const aN = a == null ? null : a;
    const bN = b == null ? null : b;
    if (typeof aN === 'number' || typeof bN === 'number') {
      if (Number(aN || 0) !== Number(bN || 0)) diff[f] = bN;
    } else if (String(aN ?? '') !== String(bN ?? '')) {
      diff[f] = bN;
    }
  }
  return diff;
}

function getBaseName(name: string): string {
  const colonIdx = name.lastIndexOf(':');
  if (colonIdx > 0) return name.substring(0, colonIdx).trim().toUpperCase();
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx > 0) return name.substring(0, dashIdx).trim().toUpperCase();
  return name.trim().toUpperCase();
}

export function ProductFormDialog({ open, onOpenChange, onSubmit, onSubmitMultiple, product, onEditProduct, defaultGroupId }: ProductFormDialogProps) {
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [soladoColor, setSoladoColor] = useState('');
  const [soladoGrade, setSoladoGrade] = useState<Record<string, number>>({});
  const [minStockGrade, setMinStockGrade] = useState<Record<string, number>>({});
  const [shoeCategory, setShoeCategory] = useState<'adulto' | 'infantil'>('adulto');
  const [sizeFrom, setSizeFrom] = useState<number | null>(null);
  const [sizeTo, setSizeTo] = useState<number | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);
  const [multiColorMode, setMultiColorMode] = useState(false);
  const [multiColors, setMultiColors] = useState<string[]>([]);
  const [colorInput, setColorInput] = useState('');
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [copyDismissed, setCopyDismissed] = useState(false);
  const [createComponentSheet, setCreateComponentSheet] = useState(false);
  const [itemPackageWeight, setItemPackageWeight] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<Product | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [groupConflict, setGroupConflict] = useState<Product | null>(null);
  const [propagationPrompt, setPropagationPrompt] = useState<{
    diff: Record<string, any>;
    siblings: Array<{ id: string; name: string; color: string | null }>;
    resolve: (apply: boolean) => void;
  } | null>(null);
  const { data: groups = [] } = useGroups();
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const { data: allProducts = [] } = useProducts();
  const addComponentSheet = useAddComponentSheet();
  const updateComponentSheet = useUpdateComponentSheet();
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: boxTypes = [] } = useQuery({
    queryKey: ['box_types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('box_types').select('id, nome').eq('active', true).order('nome');
      if (error) throw error;
      return data || [];
    },
  });

  // Sole packaging state (individual / master / colmeia)
  type SolePackagingRow = { boxTypeId: string | null; pairsPerBox: number };
  type SolePackagingState = Record<'individual' | 'master' | 'colmeia', SolePackagingRow>;
  const EMPTY_SOLE_PACKAGING: SolePackagingState = {
    individual: { boxTypeId: null, pairsPerBox: 1 },
    master:     { boxTypeId: null, pairsPerBox: 12 },
    colmeia:    { boxTypeId: null, pairsPerBox: 1 },
  };
  const [solePackaging, setSolePackaging] = useState<SolePackagingState>(EMPTY_SOLE_PACKAGING);
  const [solePackagingIds, setSolePackagingIds] = useState<Partial<Record<string, string>>>({});

  const [yieldPerSize, setYieldPerSize] = useState<Record<string, number>>({});
  const [wastePct, setWastePct] = useState(8);
  const existingSheet = useMemo(() => {
    if (!product) return null;
    return (componentSheets as any[]).find((s: any) => s.product_id === product.id) || null;
  }, [product, componentSheets]);

  const isSolado = form.category.toLowerCase().includes('solado');
  const isPalmilha = form.category === 'Palmilha' || form.category === 'Placa de Palmilha';
  const isForro = form.category === 'Forração da Palmilha';
  const isCabedal = form.category === 'Cabedal';
  const hasPlate = isPalmilha || isForro || isCabedal;
  const hasGrade = isSolado;
  const [plateLength, setPlateLength] = useState(0);
  const [plateWidth, setPlateWidth] = useState(0);
  const [plateThickness, setPlateThickness] = useState(0);
  const [plateUnit, setPlateUnit] = useState('mm');
  const isEditing = !!product;

  const siblings = useMemo(() => {
    if (!isEditing || !product) return [];
    const baseName = getBaseName(product.name);
    if (baseName.length < 3) return [];
    return allProducts.filter(p => p.id !== product.id && getBaseName(p.name) === baseName);
  }, [isEditing, product, allProducts]);

  const handleCopyFrom = (source: Product) => {
    setForm(prev => ({
      ...prev,
      technical_name: source.technical_name || prev.technical_name,
      category: source.category || prev.category,
      unit: source.unit || prev.unit,
      group_id: source.group_id || prev.group_id,
      location: source.location || prev.location,
      min_stock: source.min_stock ?? prev.min_stock,
      max_stock: source.max_stock ?? prev.max_stock,
      unit_price: source.unit_price ?? prev.unit_price,
      yield_per_meter: source.yield_per_meter ?? prev.yield_per_meter,
      yield_unit: source.yield_unit || prev.yield_unit,
      dimensions_length: source.dimensions_length || prev.dimensions_length,
      dimensions_width: source.dimensions_width || prev.dimensions_width,
      dimensions_thickness: source.dimensions_thickness || prev.dimensions_thickness,
      dimensions_unit: source.dimensions_unit || prev.dimensions_unit,
      min_stock_grade: (source.min_stock_grade && typeof source.min_stock_grade === 'object' && !Array.isArray(source.min_stock_grade))
        ? (source.min_stock_grade as Record<string, number>)
        : prev.min_stock_grade,
    }));
    setPlateLength(source.dimensions_length || 0);
    setPlateWidth(source.dimensions_width || 0);
    setPlateThickness(source.dimensions_thickness || 0);
    setPlateUnit(source.dimensions_unit || 'mm');
    if (source.min_stock_grade && typeof source.min_stock_grade === 'object') {
      setMinStockGrade(source.min_stock_grade as Record<string, number>);
    }
    setCopyDismissed(true);
    toast.success(`Informações técnicas copiadas de "${source.name}"`);
  };

  // Conjugations configured for this sole group (fetched live so the editor and grade sync)
  const { data: soleConjugations = [] } = useSoleConjugations(isSolado ? form.group_id : null);

  // Individual sizes in the declared range — used for yield-per-size (always individual)
  const currentSizes = useMemo(() => {
    if (sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom) {
      return Array.from({ length: sizeTo - sizeFrom + 1 }, (_, i) => sizeFrom + i);
    }
    return shoeCategory === 'infantil' ? CHILD_SIZES : ADULT_SIZES;
  }, [sizeFrom, sizeTo, shoeCategory]);

  // Grade / stock entry sizes — conjugated when conjugations are configured.
  // Non-conjugated sizes within the range still appear as individual numbers.
  // E.g. range 23-28, conjugations 23/24 + 25/26 → ["23/24","25/26","27","28"]
  const gradeSizes = useMemo((): string[] => {
    if (isSolado && soleConjugations.length > 0 && sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom) {
      const result: string[] = [];
      const added = new Set<string>();
      for (let s = sizeFrom; s <= sizeTo; s++) {
        const conj = soleConjugations.find(c => c.sizes.includes(s));
        if (conj) {
          if (!added.has(conj.size_key)) { result.push(conj.size_key); added.add(conj.size_key); }
        } else {
          result.push(String(s));
        }
      }
      return result;
    }
    return currentSizes.map(String);
  }, [isSolado, soleConjugations, currentSizes, sizeFrom, sizeTo]);

  useEffect(() => {
    if (product) {
      const { id, created_at, updated_at, ...rest } = product;
      const cleanName = stripColorFromName(rest.name || '', rest.color);
      setForm({
        name: cleanName,
        technical_name: rest.technical_name || '',
        sku: rest.sku || '',
        category: rest.category || '',
        color: rest.color || '',
        quantity: rest.quantity ?? 0,
        min_stock: rest.min_stock ?? 0,
        max_stock: rest.max_stock ?? 0,
        unit: rest.unit || 'un',
        unit_price: rest.unit_price ?? 0,
        price_wholesale: (rest as any).price_wholesale ?? 0,
        price_retail: (rest as any).price_retail ?? 0,
        location: rest.location || '',
        group_id: rest.group_id || null,
        active: rest.active ?? true,
        image_url: rest.image_url || '',
        min_stock_grade: (rest.min_stock_grade && typeof rest.min_stock_grade === 'object' && !Array.isArray(rest.min_stock_grade))
          ? (rest.min_stock_grade as Record<string, number>) : {},
        stock_grade: (rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade))
          ? (rest.stock_grade as Record<string, number>) : {},
        yield_per_meter: rest.yield_per_meter ?? null,
        yield_unit: rest.yield_unit || 'dm²',
        dimensions_length: rest.dimensions_length ?? 0,
        dimensions_width: rest.dimensions_width ?? 0,
        dimensions_thickness: rest.dimensions_thickness ?? 0,
        dimensions_unit: rest.dimensions_unit || 'mm',
        purchase_unit: normalizeUnit(rest.purchase_unit || rest.purchase_order_unit),
        production_unit: rest.unit || 'un',
        conversion_rate: rest.conversion_rate ?? 1,
        purchase_order_unit: normalizeUnit(rest.purchase_unit || rest.purchase_order_unit),
        min_order_quantity: rest.min_order_quantity ?? 1,
        safety_stock: rest.safety_stock ?? 0,
        lead_time_days: rest.lead_time_days ?? 10,
        supplier_lead_time_days: rest.supplier_lead_time_days ?? 10,
        calculation_method: normalizeCalculationMethod(rest.calculation_method),
        lot_number: rest.lot_number || null,
        expiration_date: rest.expiration_date || null,
        is_chemical: rest.is_chemical ?? false,
        linked_last_id: rest.linked_last_id || null,
        sole_material: rest.sole_material || null,
        heel_height: rest.heel_height ?? null,
         box_type_id: rest.box_type_id || null,
         consumption_unit: (rest as any).consumption_unit || null,
         is_standard_sole_item: (rest as any).is_standard_sole_item ?? false,
       });
      setMultiColorMode(false);
      setMultiColors([]);
      setColorInput('');
      setCopyDismissed(false);
      let dimLength = rest.dimensions_length || 0;
      let dimWidth = rest.dimensions_width || 0;
      let dimThickness = rest.dimensions_thickness || 0;
      let dimUnit = rest.dimensions_unit || 'mm';
      if (!dimLength && !dimWidth && !dimThickness && rest.group_id) {
        const grp = groups.find(g => g.id === rest.group_id);
        if (grp) {
          dimLength = grp.dimensions_length || 0;
          dimWidth = grp.dimensions_width || 0;
          dimThickness = grp.dimensions_thickness || 0;
          dimUnit = grp.dimensions_unit || 'mm';
          if (dimLength || dimWidth || dimThickness) {
            setForm(prev => ({
              ...prev,
              dimensions_length: dimLength,
              dimensions_width: dimWidth,
              dimensions_thickness: dimThickness,
              dimensions_unit: dimUnit,
              calculation_method: normalizeCalculationMethod(grp.calculation_method || prev.calculation_method),
            }));
          }
        }
      }
      setPlateLength(dimLength);
      setPlateWidth(dimWidth);
      setPlateThickness(dimThickness);
      setPlateUnit(dimUnit);
      if (rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade)) {
        setSoladoGrade(rest.stock_grade as Record<string, number>);
        const gradeObj = rest.stock_grade as Record<string, any>;
        // Restore size range from stored metadata
        if (gradeObj._size_from != null && gradeObj._size_to != null) {
          setSizeFrom(Number(gradeObj._size_from));
          setSizeTo(Number(gradeObj._size_to));
        } else {
          const keys = Object.keys(gradeObj).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
          if (keys.length > 0) {
            setSizeFrom(keys[0]);
            setSizeTo(keys[keys.length - 1]);
          }
          if (keys.some(k => k < 34)) {
            setShoeCategory('infantil');
          } else {
            setShoeCategory('adulto');
          }
        }
      }
      if (rest.min_stock_grade && typeof rest.min_stock_grade === 'object') {
        const grade = rest.min_stock_grade as Record<string, number>;
        setMinStockGrade(grade);
        if (sizeFrom == null) {
          const keys = Object.keys(grade).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
          if (keys.length > 0 && sizeFrom == null) {
            setSizeFrom(keys[0]);
            setSizeTo(keys[keys.length - 1]);
          }
        }
      }
      if (rest.color) {
        setSoladoColor(rest.color);
      } else {
        const colorMatch = (rest.name || '').match(/\s*-\s*(Preto|Caramelo)\s*$/i);
        setSoladoColor(colorMatch ? colorMatch[1] : '');
      }
      const sheet = (componentSheets as any[]).find((s: any) => s.product_id === product.id);
      if (sheet) {
        const yps = sheet.yield_per_size && typeof sheet.yield_per_size === 'object' ? sheet.yield_per_size as Record<string, number> : {};
        setYieldPerSize(yps);
        setWastePct(sheet.waste_pct ?? 0);
      } else {
        setYieldPerSize({});
        setWastePct(0);
      }
    } else {
      const defaultGroup = defaultGroupId ? groups.find(g => g.id === defaultGroupId) : null;
      setForm({ ...emptyForm, group_id: defaultGroupId || null, category: defaultGroup ? deriveCategoryFromGroup(defaultGroup.name) : '' });
      setSoladoColor('');
      setSoladoGrade({});
      setMinStockGrade({});
      setShoeCategory('adulto');
      setSizeFrom(null);
      setSizeTo(null);
      setAutoFilled(false);
      setMultiColorMode(false);
      setMultiColors([]);
      setColorInput('');
      setErrors({});
      setAttempted(false);
      setPlateLength(0);
      setPlateWidth(0);
      setPlateThickness(0);
      setPlateUnit('mm');
      setCreateComponentSheet(false);
      setDuplicateMatch(null);
      setDuplicateConfirmed(false);
      setGroupConflict(null);
      setYieldPerSize({});
      setWastePct(8);
    }
  }, [product, open, groups]);

  const tryAutoFill = useCallback((name: string) => {
    if (isEditing || !name || name.length < 3) return;
    
    const baseName = getBaseName(name);
    if (baseName.length < 3) return;

    const similar = allProducts.find(p => getBaseName(p.name) === baseName);
    if (similar && !autoFilled) {
      setForm(prev => ({
        ...prev,
        category: similar.category || prev.category,
        unit: similar.unit || prev.unit,
        group_id: similar.group_id || prev.group_id,
        location: similar.location || prev.location,
        max_stock: similar.max_stock || prev.max_stock,
        min_stock: similar.min_stock || prev.min_stock,
        dimensions_length: similar.dimensions_length || prev.dimensions_length,
        dimensions_width: similar.dimensions_width || prev.dimensions_width,
        dimensions_thickness: similar.dimensions_thickness || prev.dimensions_thickness,
        dimensions_unit: similar.dimensions_unit || prev.dimensions_unit,
      }));
      setPlateLength(similar.dimensions_length || 0);
      setPlateWidth(similar.dimensions_width || 0);
      setPlateThickness(similar.dimensions_thickness || 0);
      setPlateUnit(similar.dimensions_unit || 'mm');
      setAutoFilled(true);
      toast.info(`Dados preenchidos com base em "${similar.name}"`);
    }
  }, [allProducts, isEditing, autoFilled]);

  useEffect(() => {
    if (hasGrade) {
      update('unit', 'par');
    }
  }, [form.category]);

  useEffect(() => {
    if (hasGrade) {
      const total = Object.values(soladoGrade).reduce((s, v) => s + (v || 0), 0);
      update('quantity', total);
    }
  }, [soladoGrade, hasGrade]);

  useEffect(() => {
    if (isSolado && soladoColor) {
      const baseName = form.name.replace(/\s*-\s*(Preto|Caramelo)$/i, '').trim();
      update('name', baseName ? `${baseName} - ${soladoColor}` : `Solado - ${soladoColor}`);
    }
  }, [soladoColor]);

  useEffect(() => {
    setSoladoGrade({});
    setMinStockGrade({});
  }, [shoeCategory]);

  // Load existing packaging_configs for this sole product
  useEffect(() => {
    if (!product?.id || !isSolado) { setSolePackaging(EMPTY_SOLE_PACKAGING); setSolePackagingIds({}); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('packaging_configs')
        .select('id, packaging_type, box_type_id, pairs_per_box')
        .eq('sole_product_id', product.id)
        .eq('active', true);
      if (!data) return;
      const next = { ...EMPTY_SOLE_PACKAGING } as SolePackagingState;
      const ids: Partial<Record<string, string>> = {};
      for (const row of data as any[]) {
        const t = row.packaging_type as keyof SolePackagingState;
        if (t === 'individual' || t === 'master' || t === 'colmeia') {
          next[t] = { boxTypeId: row.box_type_id ?? null, pairsPerBox: Number(row.pairs_per_box) || 1 };
          ids[t] = row.id;
        }
      }
      setSolePackaging(next);
      setSolePackagingIds(ids);
    })();
  }, [product?.id, isSolado]);

  const handleAddColors = () => {
    if (!colorInput.trim()) return;
    const existingLower = new Set(multiColors.map(c => c.toLowerCase()));
    const newColors = colorInput
      .split(/[,;]/)
      .map(c => c.trim())
      .filter(c => c && !existingLower.has(c.toLowerCase()));
    if (newColors.length > 0) {
      setMultiColors(prev => [...prev, ...newColors]);
      setColorInput('');
    }
  };

  const handleRemoveColor = (color: string) => {
    setMultiColors(prev => prev.filter(c => c !== color));
  };

  const handleColorKeyDown = (e: React.KeyboardEvent) => {
    if (multiColorMode && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      handleAddColors();
    }
  };

  const validate = (): Record<string, boolean> => {
    const errs: Record<string, boolean> = {};
    if (!form.name.trim()) errs.name = true;
    if (!form.sku.trim()) errs.sku = true;
    if (!form.group_id) errs.group_id = true;
    if (hasGrade && (sizeFrom == null || sizeTo == null || sizeTo < sizeFrom)) errs.sizeRange = true;
    return errs;
  };

  const isFormValid = form.name.trim() !== '' && form.sku.trim() !== '' && !!form.group_id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const fieldNames: Record<string, string> = {
        name: 'Nome',
        sku: 'SKU',
        group_id: 'Grupo',
        sizeRange: 'Grade de Tamanhos'
      };
      const missingFields = Object.keys(errs)
        .map(key => fieldNames[key] || key)
        .join(', ');
      toast.error(`Preencha todos os campos obrigatórios: ${missingFields}`, {
        style: { color: 'red' }
      });
      return;
    }
    if (duplicateMatch && !duplicateConfirmed) {
      toast.warning('Confirme ou descarte o item duplicado encontrado antes de salvar');
      return;
    }
    const baseData = { ...form };
    // Unidade de estoque == unidade de consumo: sincronizamos sempre que houver
    // unit definido. Form tem só "Unidade de Consumo" (que escreve em form.unit)
    // — espelhamos no consumption_unit pra manter as duas colunas alinhadas.
    if (baseData.unit) {
      baseData.consumption_unit = baseData.unit;
    }
    if (hasGrade) {
      baseData.min_stock_grade = minStockGrade;
      baseData.min_stock = Object.values(minStockGrade).reduce((s, v) => s + (v || 0), 0);
      const gradeWithRange = { ...soladoGrade };
      if (sizeFrom != null && sizeTo != null) {
        gradeWithRange._size_from = sizeFrom;
        gradeWithRange._size_to = sizeTo;
      }
      baseData.stock_grade = gradeWithRange;
    }
    if (hasPlate || plateLength || plateWidth || plateThickness) {
      baseData.dimensions_length = plateLength;
      baseData.dimensions_width = plateWidth;
      baseData.dimensions_thickness = plateThickness;
      baseData.dimensions_unit = plateUnit;
    }

    const hasYieldData = Object.values(yieldPerSize).some(v => v > 0);
    const saveComponentSheet = async (productId: string) => {
      if (!hasYieldData && !existingSheet) return;
      const sheetData = {
        product_id: productId,
        group_id: form.group_id || null,
        dimensions_length: plateLength,
        dimensions_width: plateWidth,
        dimensions_thickness: plateThickness,
        dimensions_unit: plateUnit,
        yield_per_size: yieldPerSize,
        waste_pct: wastePct,
      };
      if (existingSheet) {
        await updateComponentSheet.mutateAsync({ id: existingSheet.id, data: sheetData });
      } else if (hasYieldData) {
        await addComponentSheet.mutateAsync({ ...sheetData, notes: '' });
      }
    };

    // When saving a sole, propagate _size_from/_size_to to all sibling color variants
    // so every variant of the same sole model shares the same declared size range.
    const syncSoleRangeToSiblings = async (productId: string) => {
      if (!isSolado || !form.group_id || sizeFrom == null || sizeTo == null) return;
      const { data: siblings } = await supabase
        .from('products')
        .select('id, stock_grade')
        .eq('group_id', form.group_id)
        .eq('active', true)
        .neq('id', productId);
      if (!siblings?.length) return;

      const toUpdate = siblings.filter(sib => {
        const g = (sib.stock_grade && typeof sib.stock_grade === 'object' && !Array.isArray(sib.stock_grade))
          ? (sib.stock_grade as Record<string, any>) : {};
        return Number(g._size_from) !== sizeFrom || Number(g._size_to) !== sizeTo;
      });
      if (!toUpdate.length) return;

      await Promise.all(toUpdate.map(sib => {
        const g = (sib.stock_grade && typeof sib.stock_grade === 'object' && !Array.isArray(sib.stock_grade))
          ? (sib.stock_grade as Record<string, any>) : {};
        return supabase
          .from('products')
          .update({ stock_grade: { ...g, _size_from: sizeFrom, _size_to: sizeTo } })
          .eq('id', sib.id);
      }));

      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(
        toUpdate.length === 1
          ? 'Faixa de numeração copiada para a outra variante do solado'
          : `Faixa de numeração copiada para ${toUpdate.length} variantes do solado`
      );
    };

    const saveSolePackagingConfigs = async (productId: string) => {
      if (!isSolado) return;
      for (const type of ['individual', 'master', 'colmeia'] as const) {
        const cfg = solePackaging[type];
        const existingId = solePackagingIds[type];
        if (!cfg.boxTypeId) {
          if (existingId) await (supabase as any).from('packaging_configs').update({ active: false }).eq('id', existingId);
          continue;
        }
        const payload = {
          packaging_type: type,
          box_type_id: cfg.boxTypeId,
          pairs_per_box: cfg.pairsPerBox,
          active: true,
          sole_product_id: productId,
          nome: `Embalagem ${type} — solado`,
        };
        if (existingId) {
          await (supabase as any).from('packaging_configs').update(payload).eq('id', existingId);
        } else {
          await (supabase as any).from('packaging_configs').insert(payload);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['packaging_links_overview'] });
    };

    // Propagação entre variações de cor: se há outros produtos no mesmo grupo
    // (siblings) e algum campo propagável foi alterado, pergunta ao usuário
    // se deve aplicar a alteração em todas as variantes. Roda ANTES do save
    // pra encadear o UPDATE dos siblings no mesmo turno e manter o dialog
    // do form aberto enquanto o AlertDialog aguarda resposta.
    let propagateDiff: Record<string, any> = {};
    let propagateSiblingIds: string[] = [];
    if (isEditing && product && product.group_id) {
      const diff = computePropagableDiff(product, baseData);
      if (Object.keys(diff).length > 0) {
        const { data: siblings } = await supabase
          .from('products')
          .select('id, name, color')
          .eq('group_id', product.group_id)
          .eq('active', true)
          .neq('id', product.id);
        if (siblings && siblings.length > 0) {
          const apply = await new Promise<boolean>((resolve) => {
            setPropagationPrompt({ diff, siblings, resolve });
          });
          setPropagationPrompt(null);
          if (apply) {
            propagateDiff = diff;
            propagateSiblingIds = siblings.map((s) => s.id);
          }
        }
      }
    }

    setSubmitting(true);
    try {
      if (isEditing) {
        await onSubmit(baseData, createComponentSheet);
        if (product) {
          await Promise.all([
            saveComponentSheet(product.id),
            saveSolePackagingConfigs(product.id),
            syncSoleRangeToSiblings(product.id),
          ]);
        }
        if (propagateSiblingIds.length > 0) {
          const { error } = await supabase
            .from('products')
            .update(propagateDiff)
            .in('id', propagateSiblingIds);
          if (error) {
            toast.error(`Erro ao propagar nas variantes: ${error.message}`);
          } else {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['paginated_products'] });
            toast.success(
              `Alteração aplicada em ${propagateSiblingIds.length} variante${propagateSiblingIds.length > 1 ? 's' : ''} do grupo.`
            );
          }
        }
      } else if (multiColorMode && multiColors.length > 0 && onSubmitMultiple) {
        const products = multiColors.map((color, idx) => ({
          ...baseData,
          color,
          name: form.name,
          sku: multiColors.length > 1 ? `${form.sku}-${String(idx + 1).padStart(2, '0')}` : form.sku,
        }));
        await onSubmitMultiple(products, createComponentSheet);
        toast.success(`${products.length} materiais criados com cores diferentes`);
      } else if (multiColorMode && multiColors.length > 0) {
        await Promise.all(multiColors.map((color, idx) =>
          onSubmit({
            ...baseData,
            color,
            name: form.name,
            sku: multiColors.length > 1 ? `${form.sku}-${String(idx + 1).padStart(2, '0')}` : form.sku,
          }, createComponentSheet)
        ));
        toast.success(`${multiColors.length} materiais criados com cores diferentes`);
      } else {
        await onSubmit(baseData, createComponentSheet);
      }

      // ── Validação visual: confirmar habilitação como Item Padrão de Solado ──
      const wasStandard = !!(product as any)?.is_standard_sole_item;
      const isStandardNow = !!baseData.is_standard_sole_item;
      if (isStandardNow && !wasStandard) {
        toast.success(
          `"${baseData.name}" agora aparece como Item Padrão de Solado — disponível imediatamente na lista.`,
          { duration: 4500 }
        );
      } else if (!isStandardNow && wasStandard) {
        toast.info(`"${baseData.name}" removido dos Itens Padrão de Solado.`);
      }
      // Invalidar apenas o painel de itens padrão aqui; as queries de produtos
      // são invalidadas pelo onSuccess das mutações (após o insert/update completar).
      queryClient.invalidateQueries({ queryKey: ['sole_standard_items'] });

      // Emitir evento global para destacar o item recém-habilitado em painéis abertos
      if (isStandardNow && !wasStandard) {
        try {
          window.dispatchEvent(
            new CustomEvent('sole-standard-item-enabled', {
              detail: {
                productId: (product as any)?.id ?? null,
                name: baseData.name,
                category: baseData.category,
                at: Date.now(),
              },
            })
          );
        } catch {
          // CustomEvent indisponível — ignorar silenciosamente
        }
      }

      localStorage.setItem('inventory_active_tab', 'materials');
      onOpenChange(false);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && (err as any).name === 'ZodError') {
        const msgs = (err as any).errors?.map((e: any) => e.message).join('; ') || 'Dados inválidos';
        toast.error(`Erro de validação: ${msgs}`);
      }
      // DB/mutation errors already shown via onError callback
    } finally {
      setSubmitting(false);
    }
  };

  const update = <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) =>
    setForm(prev => {
      const next = { ...prev, [key]: value };

      if (key === 'unit') {
        // production_unit always mirrors the stock unit
        next.production_unit = value as string;
        // Auto-suggest conversion_rate for common pairs
        const pu = prev.purchase_unit || prev.purchase_order_unit || 'un';
        const su = value as string;
        if (pu === 'm²' && su === 'dm²') next.conversion_rate = 100;
        else if (pu === 'dm²' && su === 'm²') next.conversion_rate = 0.01;
        else if (pu === su) next.conversion_rate = 1;
      }

      if (key === 'purchase_unit') {
        // purchase_order_unit always mirrors purchase_unit
        next.purchase_order_unit = value as string;
        // Auto-suggest conversion_rate for common pairs
        const pu = value as string;
        const su = next.unit;
        if (pu === 'm²' && su === 'dm²') next.conversion_rate = 100;
        else if (pu === 'dm²' && su === 'm²') next.conversion_rate = 0.01;
        else if (pu === su) next.conversion_rate = 1;
      }

      return next;
    });

   const checkDuplicateName = useCallback((name: string, groupId: string | null, color?: string) => {
     if (!name.trim()) { setDuplicateMatch(null); return; }
     const normalizedName = name.trim().toLowerCase();
     const normalizedColor = (color || '').trim().toLowerCase();
     
     // 1. Check for EXACT match in the same group (original logic)
     const exactMatch = allProducts.find(p => {
       if (product && p.id === product.id) return false;
       const sameGroup = (groupId && p.group_id === groupId) || (!groupId && !p.group_id);
       if (!sameGroup || p.name.trim().toLowerCase() !== normalizedName) return false;
       const existingColor = (p.color || '').trim().toLowerCase();
       if (normalizedColor && existingColor && normalizedColor !== existingColor) return false;
       return true;
     });
 
     if (exactMatch && !duplicateConfirmed) {
       setDuplicateMatch(exactMatch);
       return;
     }
 
     // 2. Check for "2 words match" logic (new requirement)
     const words = normalizedName.split(/\s+/).filter(w => w.length >= 3);
     if (words.length >= 2) {
       const partialMatch = allProducts.find(p => {
         if (product && p.id === product.id) return false;
         const existingWords = p.name.toLowerCase().split(/\s+/);
         const matches = words.filter(w => existingWords.includes(w));
         return matches.length >= 2;
       });
 
       if (partialMatch && !duplicateConfirmed) {
         setDuplicateMatch(partialMatch);
         return;
       }
     }
 
     setDuplicateMatch(null);
   }, [allProducts, product, duplicateConfirmed]);

  const handleNameBlur = () => {
    tryAutoFill(form.name);
    checkDuplicateName(form.name, form.group_id, form.color);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Material' : 'Novo Material'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {attempted && Object.keys(errors).length > 0 && (
            <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5">
              <p className="text-sm font-semibold text-destructive mb-1">
                Preencha todos os campos obrigatórios:
              </p>
              <ul className="list-disc list-inside text-xs text-destructive">
                {errors.name && <li>Nome do material</li>}
                {errors.sku && <li>Código (SKU)</li>}
                {errors.group_id && <li>Grupo</li>}
                {errors.sizeRange && <li>Grade de Tamanhos (Numeração De/Até)</li>}
              </ul>
            </div>
          )}
          {isEditing && siblings.length > 0 && !copyDismissed && (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
              <p className="text-sm font-medium">Copiar informações técnicas?</p>
              <p className="text-xs text-muted-foreground">
                Existem {siblings.length} variante(s) de cor com o mesmo nome base. Deseja copiar os dados técnicos?
              </p>
              <div className="flex flex-wrap gap-2">
                {siblings.slice(0, 5).map(s => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => handleCopyFrom(s)}
                  >
                    {s.color || s.name}
                  </Button>
                ))}
                <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setCopyDismissed(true)}>
                  Não, obrigado
                </Button>
              </div>
            </div>
          )}
           <div className="grid grid-cols-1 gap-6 mt-4">
             <div className="col-span-1">
              <Label htmlFor="name" className={attempted && errors.name ? 'text-destructive' : ''}>Nome *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => { update('name', e.target.value); setDuplicateConfirmed(false); setDuplicateMatch(null); if (attempted) setErrors(prev => ({ ...prev, name: !e.target.value.trim() })); }}
                onBlur={handleNameBlur}
                className={`mt-1 ${attempted && errors.name ? 'border-destructive ring-destructive' : ''}`}
                placeholder="Ex: NAPA SOFT, LINHA60"
              />
              {attempted && errors.name && <p className="text-xs text-destructive mt-1">Nome é obrigatório</p>}
              {!isEditing && (
                <p className="text-xs text-muted-foreground mt-1">
                  Ao digitar, dados técnicos serão preenchidos de materiais similares
                </p>
              )}
              {duplicateMatch && !duplicateConfirmed && (
                <div className="mt-2 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 space-y-2">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    ⚠️ Já existe um item com este nome no mesmo grupo
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    "{duplicateMatch.name}" {duplicateMatch.color ? `(Cor: ${duplicateMatch.color})` : ''} — SKU: {duplicateMatch.sku || 'N/A'}
                    {duplicateMatch.group_id ? ` — Grupo: ${groups.find(g => g.id === duplicateMatch.group_id)?.name || ''}` : ''}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">É o mesmo item?</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                      onClick={() => {
                        onOpenChange(false);
                        toast.info('Este item já está cadastrado. Localize-o na lista de materiais.', { duration: 5000 });
                      }}
                    >
                      Sim, é o mesmo
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setDuplicateConfirmed(true);
                        setDuplicateMatch(null);
                        toast.success('OK, continuando com o cadastro');
                      }}
                    >
                      Não, é diferente
                    </Button>
                  </div>
                </div>
              )}
            </div>
             <div className="col-span-2">
               <Label htmlFor="technical_name">Nome Técnico</Label>
              <Textarea
                id="technical_name"
                value={form.technical_name || ''}
                onChange={e => update('technical_name', e.target.value)}
                className="mt-1 min-h-[60px]"
                 placeholder="Ex: Couro sintético PU 1.2mm, base algodão"
               />
             </div>

             <div className="col-span-2 flex items-center gap-2 py-2">
               <Switch
                 id="is_standard_sole_item"
                 checked={form.is_standard_sole_item || false}
                 onCheckedChange={v => update('is_standard_sole_item', v)}
               />
               <div className="grid gap-1.5 leading-none">
                 <Label htmlFor="is_standard_sole_item" className="text-sm font-medium leading-none cursor-pointer">
                   Item Padrão de Solado
                 </Label>
                 <p className="text-xs text-muted-foreground">
                   Se marcado, este item (como cola ou linha) será adicionado automaticamente às fichas técnicas ao selecionar o solado correspondente.
                 </p>
               </div>
             </div>
            {!hasGrade && (
              <div className="col-span-2">
                <Label htmlFor="color">Cor</Label>
                {isEditing ? (
                  <Input
                    id="color"
                    value={form.color}
                    onChange={e => update('color', e.target.value)}
                    className="mt-1"
                    placeholder="Ex: Preto"
                  />
                ) : !multiColorMode ? (
                  <div className="space-y-2 mt-1">
                    <div className="flex gap-2">
                      <Input
                        id="color"
                        value={form.color}
                        onChange={e => update('color', e.target.value)}
                        className="flex-1"
                        placeholder="Ex: Preto"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs whitespace-nowrap"
                        onClick={() => {
                          setMultiColorMode(true);
                          if (form.color.trim()) {
                            setMultiColors([form.color.trim()]);
                            update('color', '');
                          }
                        }}
                      >
                        + Várias cores
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Para cadastrar várias cores do mesmo material, clique em "+ Várias cores"
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 mt-1">
                    <div className="flex gap-2">
                      <Input
                        id="color"
                        value={colorInput}
                        onChange={e => setColorInput(e.target.value)}
                        onKeyDown={handleColorKeyDown}
                        onBlur={handleAddColors}
                        className="flex-1"
                        placeholder="Digite uma cor e pressione Enter"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={handleAddColors}>
                        Adicionar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          setMultiColorMode(false);
                          setMultiColors([]);
                          setColorInput('');
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                    {multiColors.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {multiColors.map(color => (
                          <Badge key={color} variant="secondary" className="gap-1 pr-1">
                            {color}
                            <button
                              type="button"
                              onClick={() => handleRemoveColor(color)}
                              className="hover:bg-muted rounded-full p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-primary">{multiColors.length} material(is)</span> serão criados, um para cada cor
                    </p>
                  </div>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="sku" className={attempted && errors.sku ? 'text-destructive' : ''}>Código (SKU) *</Label>
              <Input id="sku" value={form.sku} onChange={e => { update('sku', e.target.value); if (attempted) setErrors(prev => ({ ...prev, sku: !e.target.value.trim() })); }} className={`mt-1 font-mono ${attempted && errors.sku ? 'border-destructive ring-destructive' : ''}`} placeholder="Ex: CAB-001" />
              {attempted && errors.sku && <p className="text-xs text-destructive mt-1">SKU é obrigatório</p>}
            </div>
            <div>
              <Label>Grupo</Label>
              <Select value={form.group_id || 'none'} onValueChange={v => {
                const gid = v === 'none' ? null : v;
                update('group_id', gid);
                const selectedGroup = gid ? groups.find(g => g.id === gid) : null;
                const derivedCategory = deriveCategoryFromGroup(selectedGroup?.name);
                update('category', derivedCategory);
                if (attempted) setErrors(prev => ({ ...prev, category: false }));
                if (selectedGroup) {
                  if (selectedGroup.dimensions_length || selectedGroup.dimensions_width || selectedGroup.dimensions_thickness) {
                    setPlateLength(selectedGroup.dimensions_length || 0);
                    setPlateWidth(selectedGroup.dimensions_width || 0);
                    setPlateThickness(selectedGroup.dimensions_thickness || 0);
                    setPlateUnit(selectedGroup.dimensions_unit || 'mm');
                    update('dimensions_length', selectedGroup.dimensions_length || 0);
                    update('dimensions_width', selectedGroup.dimensions_width || 0);
                    update('dimensions_thickness', selectedGroup.dimensions_thickness || 0);
                    update('dimensions_unit', selectedGroup.dimensions_unit || 'mm');
                  }
                  if (selectedGroup.package_weight_kg > 0 && selectedGroup.package_price > 0) {
                    const calcPrice = Math.round((selectedGroup.package_price / selectedGroup.package_weight_kg) * 10000) / 10000;
                    update('unit_price', calcPrice);
                  }
                }
              }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem grupo</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {(() => {
                const sg = form.group_id ? groups.find(g => g.id === form.group_id) : null;
                if (sg && sg.package_weight_kg > 0 && sg.package_price > 0) {
                  const calcPrice = sg.package_price / sg.package_weight_kg;
                  return (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Grupo: {sg.package_weight_kg}kg por{' '}
                      {calcPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })}/kg
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            <div>
              <Label>Fornecedor</Label>
              <Select value={form.supplier_id || 'none'} onValueChange={v => update('supplier_id', v === 'none' ? null : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem fornecedor</SelectItem>
                  {suppliers.filter(s => s.active).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.trade_name || s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isEditing && (
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Mover para Grupo
                </Label>
                <Select value={form.group_id || 'none'} onValueChange={v => {
                  const gid = v === 'none' ? null : v;
                  if (gid && product) {
                    const conflicting = allProducts.find(p => {
                      if (p.id === product.id) return false;
                      if (p.group_id !== gid) return false;
                      const sameName = form.name.trim().toLowerCase() === p.name.trim().toLowerCase();
                      const sameColor = form.color && p.color && form.color.trim().toLowerCase() === p.color.trim().toLowerCase();
                      return sameName || sameColor;
                    });
                    if (conflicting) {
                      setGroupConflict(conflicting);
                      return;
                    }
                  }
                  update('group_id', gid);
                  if (gid) {
                    const selectedGroup = groups.find(g => g.id === gid);
                    if (selectedGroup) {
                      toast.info(`Item será movido para o grupo "${selectedGroup.name}" ao salvar`);
                    }
                  }
                }}>
                  <SelectTrigger className="mt-1 border-dashed">
                    <SelectValue placeholder="Selecione o grupo de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem grupo</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Selecione um grupo diferente para mover este item
                </p>
              </div>
            )}

            {groupConflict && (
              <Dialog open={!!groupConflict} onOpenChange={() => setGroupConflict(null)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-base">Item já existe neste grupo</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Já existe um item com nome ou cor similar no grupo de destino:
                    </p>
                    <div className="p-3 rounded-lg border bg-muted/50 space-y-1">
                      <p className="text-sm font-medium">{groupConflict.name}</p>
                      {groupConflict.color && (
                        <p className="text-xs text-muted-foreground">Cor: {groupConflict.color}</p>
                      )}
                      <p className="text-xs text-muted-foreground">SKU: {groupConflict.sku || 'N/A'}</p>
                      <p className="text-xs text-muted-foreground">
                        Estoque: {groupConflict.quantity} {groupConflict.unit}
                      </p>
                    </div>
                    <p className="text-sm font-medium">É o mesmo item?</p>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="default"
                        className="flex-1"
                        onClick={() => {
                          const conflictProduct = groupConflict;
                          setGroupConflict(null);
                          onOpenChange(false);
                          if (onEditProduct) {
                            onEditProduct(conflictProduct);
                          }
                        }}
                      >
                        Sim, editar o existente
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const targetGroupId = groupConflict.group_id;
                          setGroupConflict(null);
                          update('group_id', targetGroupId);
                          const selectedGroup = groups.find(g => g.id === targetGroupId);
                          if (selectedGroup) {
                            toast.info(`Item será movido para o grupo "${selectedGroup.name}" ao salvar`);
                          }
                        }}
                      >
                        Não, mover mesmo assim
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {isSolado && (
              <div className="col-span-2">
                <Label>Cor do Solado</Label>
                <Select value={soladoColor} onValueChange={setSoladoColor}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
                  <SelectContent>
                    {SOLADO_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isSolado && (
              <>
                <div className="col-span-1">
                  <Label htmlFor="sole_material">Material do Solado</Label>
                  <Input
                    id="sole_material"
                    value={form.sole_material || ''}
                    onChange={e => update('sole_material', e.target.value)}
                    placeholder="Ex: TR, PVC, Micro"
                    className="mt-1"
                  />
                </div>
                <div className="col-span-1">
                  <Label htmlFor="heel_height">Altura do Salto (mm)</Label>
                  <NumberInput
                    id="heel_height"
                    value={form.heel_height || 0}
                    onChange={v => update('heel_height', v)}
                    min={0}
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="linked_last_id">Vincular com Fôrma</Label>
                  <Select 
                    value={form.linked_last_id || 'none'} 
                    onValueChange={v => update('linked_last_id', v === 'none' ? null : v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione a fôrma correspondente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma fôrma vinculada</SelectItem>
                      {allProducts
                        .filter(p => p.category === 'Fôrma' || p.category === 'Ferramentas' || p.id === form.linked_last_id)
                        .map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} {p.sku ? `(${p.sku})` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {hasGrade && (
              <div className="col-span-2 p-3 rounded-lg border bg-muted/30">
                <Label className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <Footprints className="h-4 w-4 text-primary" />
                  Faixa de Numeração
                </Label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">De (número inicial)</Label>
                    <Select value={sizeFrom != null ? String(sizeFrom) : ''} onValueChange={v => setSizeFrom(Number(v))}>
                      <SelectTrigger className="mt-1 h-9">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_SIZES.map(s => (
                          <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Até (número final)</Label>
                    <Select value={sizeTo != null ? String(sizeTo) : ''} onValueChange={v => setSizeTo(Number(v))}>
                      <SelectTrigger className="mt-1 h-9">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_SIZES.filter(s => sizeFrom == null || s >= sizeFrom).map(s => (
                          <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Badge variant="secondary" className="h-9 px-3 flex items-center text-sm">
                      {sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom
                        ? `${sizeTo - sizeFrom + 1} tamanhos`
                        : 'Selecione a faixa'}
                    </Badge>
                  </div>
                </div>
                {sizeFrom == null || sizeTo == null ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                    ⚠️ Selecione a faixa de numeração para definir a grade
                  </p>
                ) : null}
              </div>
            )}

            {hasGrade && (
              <div className="col-span-2 p-3 rounded-lg border bg-muted/30">
                <SoleSizeConjugationsEditor
                  soleGroupId={form.group_id}
                  sizeFrom={sizeFrom}
                  sizeTo={sizeTo}
                />
              </div>
            )}

            {hasGrade && sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom && (
              <div className="col-span-2">
                <Label className="text-xs font-semibold">Grade de Numeração (pares por tamanho)</Label>
                {soleConjugations.length > 0 && (
                  <p className="text-[10px] text-primary mt-1 mb-1">Numerações conjugadas ativas — grade usa chaves conjugadas</p>
                )}
                <div className={`grid gap-2 mt-2`} style={{ gridTemplateColumns: `repeat(${gradeSizes.length}, minmax(0, 1fr))` }}>
                  {gradeSizes.map(size => (
                    <div key={size} className="text-center">
                      <span className="text-xs text-muted-foreground font-medium">{size}</span>
                      <NumberInput
                        min={0}
                        step="1"
                        value={soladoGrade[size] || 0}
                        onChange={v => setSoladoGrade(prev => ({ ...prev, [size]: v }))}
                        className="h-8 text-xs text-center px-1"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total de pares: <span className="font-semibold text-foreground">
                    {Object.values(soladoGrade).reduce((s, v) => s + (v || 0), 0)}
                  </span>
                </p>
              </div>
            )}

            <div className="col-span-2 p-3 rounded-lg border bg-muted/30">
              <Label className="text-sm font-semibold">Dimensões do Material</Label>
              <div className="grid grid-cols-4 gap-3 mt-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Altura</Label>
                  <NumberInput
                    value={plateLength}
                    onChange={setPlateLength}
                    min={0}
                    step="0.1"
                    className="mt-1 h-9"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Largura</Label>
                  <NumberInput
                    value={plateWidth}
                    onChange={setPlateWidth}
                    min={0}
                    step="0.1"
                    className="mt-1 h-9"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Espessura</Label>
                  <NumberInput
                    value={plateThickness}
                    onChange={setPlateThickness}
                    min={0}
                    step="0.01"
                    className="mt-1 h-9"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Unidade</Label>
                  <Select value={plateUnit} onValueChange={setPlateUnit}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mm">mm</SelectItem>
                      <SelectItem value="cm">cm</SelectItem>
                      <SelectItem value="m">m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Dimensões da placa, rolo ou folha do material.
              </p>
            </div>

            {isSolado && (
              <div className="col-span-2 p-3 rounded-lg border bg-muted/30 mb-4 space-y-3">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <Box className="h-4 w-4 text-primary" />
                  Tipos de Caixa por Solado
                </Label>
                <div className="space-y-2">
                  {([
                    { key: 'individual', label: 'Individual' },
                    { key: 'master',     label: 'Master' },
                    { key: 'colmeia',    label: 'Colmeia' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="grid grid-cols-[90px_1fr_80px_32px] gap-2 items-center">
                      <span className="text-xs font-medium text-muted-foreground">{label}</span>
                      <Select
                        value={solePackaging[key].boxTypeId ?? 'none'}
                        onValueChange={v => setSolePackaging(prev => ({
                          ...prev,
                          [key]: { ...prev[key], boxTypeId: v === 'none' ? null : v },
                        }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhuma</SelectItem>
                          {(boxTypes as any[]).map((box: any) => (
                            <SelectItem key={box.id} value={box.id}>{box.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <NumberInput
                        min={1}
                        value={solePackaging[key].pairsPerBox}
                        onChange={v => setSolePackaging(prev => ({
                          ...prev,
                          [key]: { ...prev[key], pairsPerBox: v },
                        }))}
                        className="h-8 text-xs text-center px-1"
                        disabled={!solePackaging[key].boxTypeId}
                      />
                      <span className="text-[10px] text-muted-foreground leading-none">pares</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Aplicado automaticamente ao empacotar OPs com este solado. {!product && <span className="text-warning font-medium">Salve e edite o produto para ativar.</span>}
                </p>
              </div>
            )}

            <div className="col-span-2 p-3 rounded-lg border bg-muted/30 space-y-3">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Rendimento Técnico (dm²/par por numeração)
              </Label>
              <p className="text-[10px] text-muted-foreground -mt-1">
                Consumo em dm² por par para cada numeração. Usado no cálculo de pares estimados no estoque.
              </p>
              <div className={`grid gap-2 ${shoeCategory === 'infantil' ? 'grid-cols-8' : 'grid-cols-7'}`}>
                {currentSizes.map(size => (
                  <div key={size} className="text-center">
                    <span className="text-xs text-muted-foreground font-medium">{size}</span>
                    <NumberInput
                      min={0}
                      step="0.01"
                      value={yieldPerSize[String(size)] || 0}
                      onChange={v => setYieldPerSize(prev => ({ ...prev, [String(size)]: v }))}
                      className="h-8 text-xs text-center px-1"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Perda / Desperdício (%)</Label>
                  <NumberInput
                    value={wastePct}
                    onChange={setWastePct}
                    min={0}
                    step="0.5"
                    className="mt-1 h-9"
                    placeholder="8"
                  />
                </div>
                <div className="flex items-end">
                  {existingSheet
                    ? <Badge variant="secondary" className="text-[10px]">Ficha existente</Badge>
                    : Object.values(yieldPerSize).some(v => v > 0)
                      ? <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Nova ficha será criada</Badge>
                      : <span className="italic text-xs text-muted-foreground">Sem ficha de componente</span>
                  }
                </div>
              </div>
            </div>

            <div className="col-span-2 p-3 rounded-lg border bg-muted/30 space-y-3">
              <Label className="text-sm font-semibold">Unidades de Medida</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Unidade de Consumo</Label>
                  <Select value={form.unit} onValueChange={v => update('unit', v)}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Mesma unidade usada no estoque e nas fichas técnicas</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Unidade de Compra</Label>
                  <Select value={form.purchase_unit || form.unit} onValueChange={v => update('purchase_unit', v)}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Unidade que aparece nas notas fiscais e OCs</p>
                </div>
              </div>
              {(form.purchase_unit && form.purchase_unit !== form.unit) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Fator de Conversão</Label>
                    <NumberInput
                      value={form.conversion_rate ?? 1}
                      onChange={v => update('conversion_rate', v)}
                      min={0.0001}
                      step={form.unit === 'kg' || form.purchase_unit === 'kg' ? '0.001' : '0.01'}
                      className="mt-1 h-9"
                      placeholder="Ex: 137"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      1 {form.purchase_unit} = {form.conversion_rate ?? 1} {form.unit}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Lote Mínimo de Compra</Label>
                    <NumberInput
                      value={form.min_order_quantity ?? 0}
                      onChange={v => update('min_order_quantity', v)}
                      min={0}
                      step="1"
                      className="mt-1 h-9"
                      placeholder="Ex: 50"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Em {form.purchase_unit || form.unit}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {!hasGrade && (
              <div>
                <Label htmlFor="quantity">Quantidade Atual</Label>
                <NumberInput id="quantity" min={0} step="0.0001" value={form.quantity} onChange={v => update('quantity', v)} required className="mt-1" />
              </div>
            )}

            {hasGrade && sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom ? (
              <div className="col-span-2">
                <Label className="text-xs font-semibold">Estoque Mínimo por Numeração</Label>
                <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: `repeat(${gradeSizes.length}, minmax(0, 1fr))` }}>
                  {gradeSizes.map(size => (
                    <div key={size} className="text-center">
                      <span className="text-xs text-muted-foreground font-medium">{size}</span>
                      <NumberInput
                        min={0}
                        step="1"
                        value={minStockGrade[size] || 0}
                        onChange={v => setMinStockGrade(prev => ({ ...prev, [size]: v }))}
                        className="h-8 text-xs text-center px-1"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Estoque mínimo total: <span className="font-semibold text-foreground">
                    {Object.values(minStockGrade).reduce((s, v) => s + (v || 0), 0)} pares
                  </span>
                </p>
              </div>
            ) : hasGrade ? null : (
              <div>
                <Label htmlFor="min_stock">Estoque Mínimo</Label>
                <NumberInput id="min_stock" min={0} step="0.0001" value={form.min_stock} onChange={v => update('min_stock', v)} required className="mt-1" />
              </div>
            )}

            {/* Estoque Máximo - escondido para solados */}
            {!hasGrade && (
              <div>
                <Label htmlFor="max_stock">Estoque Máximo</Label>
                <NumberInput id="max_stock" min={0} step="0.0001" value={form.max_stock} onChange={v => update('max_stock', v)} required className="mt-1" />
              </div>
            )}
            {hasGrade && (
              <div className="col-span-2 text-xs text-muted-foreground italic">
                Solados utilizam estoque mínimo por numeração. Estoque máximo não se aplica.
              </div>
            )}
            {(() => {
              const selectedGroup = groups.find(g => g.name === form.category);
              const hasGroupPrice = selectedGroup && selectedGroup.package_price > 0 && selectedGroup.package_weight_kg > 0;
              return (
                <div className="col-span-2 rounded-lg border p-3 bg-muted/30 space-y-3">
                  <Label className="text-sm font-semibold">Custo do Material</Label>
                  {hasGroupPrice && (
                    <p className="text-xs text-muted-foreground -mt-1">
                      Grupo <span className="font-semibold">{selectedGroup.name}</span>: R$ {selectedGroup.package_price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por {selectedGroup.package_weight_kg}kg
                    </p>
                  )}
                  <div className={`grid gap-3 ${hasGroupPrice ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    {hasGroupPrice && (
                      <>
                        <div>
                          <Label className="text-xs text-muted-foreground">Peso da Embalagem (kg)</Label>
                          <NumberInput
                            value={itemPackageWeight}
                            onChange={(v) => {
                              setItemPackageWeight(v);
                              if (v > 0 && selectedGroup.package_price > 0 && selectedGroup.package_weight_kg > 0) {
                                const pricePerKg = selectedGroup.package_price / selectedGroup.package_weight_kg;
                                update('unit_price', Math.round(pricePerKg * v * 10000) / 10000);
                              }
                            }}
                            min={0}
                            step="0.01"
                            className="mt-1"
                            placeholder="Ex: 14"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Preço por kg</Label>
                          <div className="mt-1 h-9 flex items-center px-3 rounded-md border bg-background text-sm font-mono text-muted-foreground">
                            {selectedGroup.package_weight_kg > 0
                              ? (selectedGroup.package_price / selectedGroup.package_weight_kg).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })
                              : '—'}
                          </div>
                        </div>
                      </>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 col-span-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {form.unit === 'kg' ? 'Custo por kg (R$)' : ['metro', 'm', 'metros'].includes(form.unit) ? 'Custo por metro (R$)' : form.unit === 'par' ? 'Custo por par (R$)' : 'Custo Unitário (R$)'}
                        </Label>
                        <CurrencyInput 
                          id="unit_price" 
                          value={form.unit_price} 
                          onChange={v => update('unit_price', v)} 
                          required 
                          className="mt-1" 
                        />
                      </div>

                      {form.conversion_rate !== 1 && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Preço por {form.purchase_unit || form.unit} (R$)
                          </Label>
                          <CurrencyInput 
                            id="purchase_price" 
                            value={Math.round(form.unit_price * form.conversion_rate * 100) / 100} 
                            onChange={v => {
                              if (form.conversion_rate > 0) {
                                update('unit_price', v / form.conversion_rate);
                              }
                            }} 
                            className="mt-1 border-dashed bg-primary/5" 
                          />
                          <p className="text-[9px] text-primary/70 mt-1">
                            Preço da unidade de compra (ex: rolo, saco, chapa)
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Cálculo de Consumo</Label>
                      <Select value={normalizeCalculationMethod(form.calculation_method)} onValueChange={v => update('calculation_method', v as any)}>
                        <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weight">Por Peso (kg)</SelectItem>
                          <SelectItem value="meter">Por Metro (m/dm²)</SelectItem>
                          <SelectItem value="unit">Por Unidade (un/par/pc)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div>
              <Label>Estoque de Segurança</Label>
              <NumberInput value={form.safety_stock ?? 0} onChange={v => update('safety_stock', v)} min={0} step="0.01" className="mt-1" placeholder="0" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Estoque mínimo reservado como segurança</p>
            </div>
            <div>
              <Label>Lead Time Interno (dias)</Label>
              <NumberInput value={form.lead_time_days ?? 7} onChange={v => update('lead_time_days', v)} min={0} step="1" className="mt-1" placeholder="7" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Prazo interno de processamento</p>
            </div>
            <div>
              <Label>Lead Time Fornecedor (dias)</Label>
              <NumberInput value={form.supplier_lead_time_days ?? 10} onChange={v => update('supplier_lead_time_days', v)} min={0} step="1" className="mt-1" placeholder="10" />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Prazo do fornecedor (em dias). Usado na projeção de compras.
                Quando o fornecedor tem lead time cadastrado, ele tem prioridade
                e este valor é ignorado.
              </p>
            </div>

            {form.is_chemical && (
              <>
                <div>
                  <Label htmlFor="lot_number">Nº do Lote</Label>
                  <Input id="lot_number" value={form.lot_number || ''} onChange={e => update('lot_number', e.target.value || null)} className="mt-1" placeholder="Ex: LOTE-2026-001" />
                </div>
                <div>
                  <Label htmlFor="expiration_date">Data de Validade</Label>
                  <Input type="date" value={form.expiration_date || ''} onChange={e => update('expiration_date', e.target.value || null)} className="mt-1" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Importante para produtos químicos.</p>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 pt-2">
              <Switch id="is_chemical" checked={form.is_chemical ?? false} onCheckedChange={v => update('is_chemical', v)} />
              <Label htmlFor="is_chemical">Produto Químico / Validade Controlada</Label>
            </div>

            <div>
              <Label>Localização Física</Label>
              <Select value={form.location} onValueChange={v => update('location', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="image_url">URL da Imagem</Label>
              <Input id="image_url" value={form.image_url} onChange={e => update('image_url', e.target.value)} className="mt-1" placeholder="https://..." />
            </div>
            <div className="flex items-center gap-3 pt-4">
              <Switch id="active" checked={form.active} onCheckedChange={v => update('active', v)} />
              <Label htmlFor="active">Material Ativo</Label>
            </div>
            {!isEditing && (
              <div className="flex items-center gap-3 pt-2">
                <Switch id="component_sheet" checked={createComponentSheet} onCheckedChange={setCreateComponentSheet} />
                <Label htmlFor="component_sheet" className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  Ficha de Componente (BOM)
                </Label>
              </div>
            )}
            {!isEditing && createComponentSheet && (
              <p className="text-[10px] text-muted-foreground col-span-2 -mt-2">
                Ao ativar, este item (e todo o grupo) será adicionado automaticamente à lista de Fichas de Componentes.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
            <Button type="submit" disabled={submitting || (attempted && !isFormValid)}>
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</>
                : product ? 'Salvar' : multiColors.length > 1 ? `Adicionar ${multiColors.length} itens` : 'Adicionar'}
            </Button>
          </div>
        </form>
      </DialogContent>

      <AlertDialog
        open={!!propagationPrompt}
        onOpenChange={(open) => {
          if (!open && propagationPrompt) {
            propagationPrompt.resolve(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar nas outras variações do grupo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Você alterou {propagationPrompt && Object.keys(propagationPrompt.diff).length === 1
                    ? '1 campo'
                    : `${propagationPrompt ? Object.keys(propagationPrompt.diff).length : 0} campos`}.
                  Deseja propagar para as outras {propagationPrompt?.siblings.length} variações deste grupo?
                </p>
                {propagationPrompt && (
                  <>
                    <div className="rounded-md border bg-muted/30 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Campos alterados
                      </p>
                      <ul className="text-xs space-y-0.5">
                        {Object.entries(propagationPrompt.diff).map(([key, val]) => (
                          <li key={key} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">
                              {PROPAGABLE_LABELS[key] || key}:
                            </span>
                            <span className="font-mono">{String(val ?? '—')}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Variações que serão atualizadas
                      </p>
                      <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                        {propagationPrompt.siblings.map((s) => (
                          <li key={s.id}>
                            {s.color ? `${s.color} — ` : ''}{s.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => propagationPrompt?.resolve(false)}>
              Não, só nesta cor
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => propagationPrompt?.resolve(true)}>
              Sim, aplicar em todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function SendToComponentSheetButton({ productId }: { productId: string }) {
  const { data: sheets = [] } = useComponentSheets();
  const addSheet = useAddComponentSheet();

  const alreadyExists = sheets.some((s: any) => s.product_id === productId);

  const handleClick = async () => {
    if (alreadyExists) {
      toast.info('Este material já possui uma Ficha de Componente.');
      return;
    }
    await addSheet.mutateAsync({
      product_id: productId,
      dimensions_length: 0,
      dimensions_width: 0,
      dimensions_thickness: 0,
      dimensions_unit: 'mm',
      yield_per_size: {},
      waste_pct: 8,
      notes: '',
    });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={alreadyExists ? 'secondary' : 'outline'}
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleClick}
            disabled={addSheet.isPending}
          >
            <Layers className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {alreadyExists ? 'Já possui Ficha de Componente' : 'Enviar para Ficha de Componentes'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
