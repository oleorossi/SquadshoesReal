import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { NumberInput } from '@/components/ui/number-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, Lock, ChevronsUpDown, Check, Package, ExternalLink, Search, Command, Palette, Plus, X, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import { useSheetMaterials } from '@/hooks/useTechnicalSheets';
import StockAvailabilityBadge from './StockAvailabilityBadge';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllGroupColors } from '@/hooks/useGroupColors';
import CreateStrapProductDialog from './CreateStrapProductDialog';
import { toast } from 'sonner';
import { useReferenceMaterialVariants, useAllActiveReferenceMaterialVariants, VariantSummary } from '@/hooks/useReferenceMaterialVariants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
interface ReferenceOption {
  id: string;
  code: string;
  name: string;
  colors?: string | null;
  sale_price?: number;
  sizes?: string | null;
  shoe_category?: string | null;
  image_url?: string | null;
  ncm?: string | null;
  suggested_price?: number | null;
  packaging_box_dimensions?: string | null;
  has_straps?: boolean | null;
  strap_colors?: any[] | null;
}

interface Props {
  item: SaleOrderItemFormData;
  index: number;
  references: ReferenceOption[];
  canRemove: boolean;
  isAdmin: boolean;
  onUpdate: (idx: number, field: string, value: any) => void;
  onRemove: (idx: number) => void;
  onCopyGradeFromPrevious?: (idx: number) => void;
  onSaveStateAndNavigate?: () => void;
}

function parseSizeRange(sizes?: string | null, shoeCategory?: string | null): number[] {
  if (shoeCategory === 'Infantil' && (!sizes || sizes === '33-41' || sizes === '34-40')) {
    return Array.from({ length: 13 }, (_, i) => 21 + i);
  }
  if (sizes && sizes.includes('-')) {
    const [start, end] = sizes.split('-').map(Number);
    if (!isNaN(start) && !isNaN(end) && start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return [34, 35, 36, 37, 38, 39, 40];
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function SaleOrderItemFormInner({ item, index, references, canRemove, isAdmin, onUpdate, onRemove, onCopyGradeFromPrevious, onSaveStateAndNavigate }: Props) {
  const qc = useQueryClient();
  const fichas = item.fichas || 1;
  const setFichas = (v: number) => onUpdate(index, 'fichas', v);

  const [createStrapDialog, setCreateStrapDialog] = useState(false);
  const [editColorsDialog, setEditColorsDialog] = useState(false);
  const [pendingStrapGroupId, setPendingStrapGroupId] = useState('');
  const [pendingStrapGroupName, setPendingStrapGroupName] = useState('');
  const [pendingStrapColor, setPendingStrapColor] = useState('');
  const [pendingStrapIndex, setPendingStrapIndex] = useState<number | null>(null);
  const prevRefId = useRef(item.reference_id);
  const isFirstRender = useRef(true);
  // Tracks the last reference_id for which strap structure was synced. Prevents
  // re-running the sync whenever the query cache refreshes strap_colors for the
  // same reference (which would restore straps the user intentionally removed).
  const strapSyncedForRef = useRef<string>('');
  // Latest-ref pattern: avoids stale closures when items are reordered (sortedIndices
  // in the parent shifts `index` between renders) without triggering effect re-runs.
  const latestRef = useRef({ index, onUpdate });
  latestRef.current = { index, onUpdate };

  const grade = item.grade as Record<string, number>;
  const selectedRef = references.find(r => r.id === item.reference_id);

  const gradeTotal = Object.values(grade).reduce((s, v) => s + (v || 0), 0);
  const totalPairs = gradeTotal * fichas;
  const itemTotal = totalPairs * (item.unit_price || 0);
  const pdv = selectedRef?.suggested_price || selectedRef?.sale_price || 0;

  const { data: refMaterials = [] } = useSheetMaterials(item.reference_id || null);

  const { data: sheetSpecs } = useQuery({
    queryKey: ['sheet_specs_for_colors', item.reference_id],
    enabled: !!item.reference_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('upper_material, lining_material, insole_material, lining_accessories, components_accessories, sole_group_id')
        .eq('id', item.reference_id!)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const { data: soleSizeRange } = useQuery({
    queryKey: ['sole_size_range', sheetSpecs?.sole_group_id],
    enabled: !!sheetSpecs?.sole_group_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('stock_grade')
        .eq('group_id', sheetSpecs!.sole_group_id!)
        .eq('active', true)
        .not('stock_grade', 'is', null)
        .limit(1)
        .maybeSingle();
      if (!data?.stock_grade) return null;
      const g = data.stock_grade as Record<string, any>;
      const sf = g._size_from != null ? Number(g._size_from) : null;
      const st = g._size_to != null ? Number(g._size_to) : null;
      if (sf == null || st == null || sf > st) return null;
      return { sizeFrom: sf, sizeTo: st };
    },
    staleTime: 5 * 60_000,
  });

  const { data: soleConjugations = [] } = useQuery({
    queryKey: ['sole_size_conjugations', sheetSpecs?.sole_group_id],
    enabled: !!sheetSpecs?.sole_group_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sole_size_conjugations')
        .select('size_key, sizes, display_order')
        .eq('sole_group_id', sheetSpecs!.sole_group_id!)
        .order('display_order');
      return (data || []) as Array<{ size_key: string; sizes: number[]; display_order: number }>;
    },
    staleTime: 5 * 60_000,
  });

  // Grade size list — conjugated when the sole has conjugations configured.
  // Non-conjugated sizes within the range appear as individual strings.
  // E.g. range 33-40, conjugations 33/34 + 39/40 → ["33/34","35","36","37","38","39/40"]
  //
  // When no stored range metadata (_size_from/_size_to) is available, we infer the
  // range from the min/max of the conjugation sizes so partial-conjugation soles
  // (like solado 238) still show all individual sizes in between.
  const SIZES = useMemo((): string[] => {
    let sf = soleSizeRange?.sizeFrom;
    let st = soleSizeRange?.sizeTo;

    // Fallback: infer range from conjugation sizes when no stored range
    if ((sf == null || st == null) && soleConjugations.length > 0) {
      const allSizes = soleConjugations.flatMap(c => c.sizes);
      if (allSizes.length > 0) {
        sf = sf ?? Math.min(...allSizes);
        st = st ?? Math.max(...allSizes);
      }
    }

    if (sf != null && st != null && sf <= st) {
      if (soleConjugations.length > 0) {
        const result: string[] = [];
        const added = new Set<string>();
        for (let s = sf; s <= st; s++) {
          const conj = soleConjugations.find(c => c.sizes.includes(s));
          if (conj) {
            if (!added.has(conj.size_key)) { result.push(conj.size_key); added.add(conj.size_key); }
          } else {
            result.push(String(s));
          }
        }
        return result;
      }
      return Array.from({ length: st - sf + 1 }, (_, i) => String(sf! + i));
    }
    return parseSizeRange(selectedRef?.sizes, selectedRef?.shoe_category).map(String);
  }, [soleSizeRange, soleConjugations, selectedRef?.sizes, selectedRef?.shoe_category]);

  const { data: colorVariants = [] } = useQuery({
    queryKey: ['color_variants', item.reference_id],
    enabled: !!item.reference_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_color_variants')
        .select('*')
        .eq('reference_id', item.reference_id!)
        .eq('active', true)
        .order('color');
      if (error) throw error;
      return data;
    },
  });

  const { data: materialVariants = [] } = useReferenceMaterialVariants(item.reference_id || null);
  const activeMaterialVariants = materialVariants.filter(v => v.active);
  const { data: allVariantsByRef = new Map<string, VariantSummary[]>() } = useAllActiveReferenceMaterialVariants();

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products_for_colors'],
    queryFn: async () => {
      const { data } = await supabase.from('products').select('id, name, color, group_id, category').eq('active', true);
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: groupSupplierMaterials = [] } = useQuery({
    queryKey: ['group_supplier_materials_for_colors'],
    queryFn: async () => {
      const { data } = await supabase
        .from('group_supplier_materials')
        .select('group_id, color, material_name')
        .eq('active', true);
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    queryFn: async () => {
      const { data } = await supabase.from('product_groups').select('id, name, colors');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: allGroupColors = [] } = useAllGroupColors();
  const normalizeGroupValue = (value?: string | null) => value?.trim().toLowerCase() || '';

  const uniqueSortedColors = (colors: string[]) => {
    return Array.from(new Set(colors.map(color => color.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };

  const getDerivedProductColor = (product: any) => {
    const explicitColor = product.color?.trim() || '';
    const productName = product.name?.trim() || '';
    if (productName.includes(':')) return productName.split(':').pop()?.trim() || '';
    if (productName.includes(' - ')) return productName.split(' - ').pop()?.trim() || '';
    return explicitColor ? '' : productName;
  };

  const getColorsFromProducts = (groupId: string) => {
    return uniqueSortedColors(
      allProducts.flatMap((product: any) => {
        if (product.group_id !== groupId) return [];
        const colors = new Set<string>();
        const explicitColor = product.color?.trim();
        const derivedColor = getDerivedProductColor(product);
        if (explicitColor) colors.add(explicitColor);
        if (derivedColor) colors.add(derivedColor);
        return Array.from(colors);
      })
    );
  };

  const getColorsFromGroupSupplierMaterials = (groupId: string) => {
    return uniqueSortedColors(
      groupSupplierMaterials.flatMap((material: any) => {
        if (material.group_id !== groupId) return [];
        const explicitColor = material.color?.trim();
        if (explicitColor) return [explicitColor];
        const materialName = material.material_name?.trim() || '';
        if (materialName.includes(':')) return [materialName.split(':').pop()?.trim() || ''];
        if (materialName.includes(' - ')) return [materialName.split(' - ').pop()?.trim() || ''];
        return [];
      })
    );
  };

  const mergeAllGroupColors = (group: any): string[] => {
    const allColors: string[] = [];
    if (group.colors) allColors.push(...group.colors.split(','));
    allColors.push(...getColorsFromGroupSupplierMaterials(group.id));
    allColors.push(...getColorsFromProducts(group.id));
    // Include colors from the group_colors table
    allGroupColors
      .filter(gc => gc.group_id === group.id)
      .forEach(gc => allColors.push(gc.color_name));
    return uniqueSortedColors(allColors);
  };

  const getColorsFromGroupName = (groupName: string): string[] => {
    if (!groupName) return [];
    const normalized = normalizeGroupValue(groupName);
    const group = productGroups.find((g: any) => g.id === groupName || normalizeGroupValue(g.name) === normalized);
    if (!group) return [];
    return mergeAllGroupColors(group);
  };

  const getColorsFromGroupId = (groupId: string): string[] => {
    if (!groupId) return [];
    const normalized = normalizeGroupValue(groupId);
    const group = productGroups.find((g: any) => g.id === groupId || normalizeGroupValue(g.name) === normalized);
    if (!group) return [];
    return mergeAllGroupColors(group);
  };

  const availableColors: string[] = useMemo(() => {
    // When a material group is selected and has specific colors defined, use those exclusively.
    // This enforces the Reference → Material → Color flow for multi-material references.
    if (item.material_variant_id) {
      const sel = activeMaterialVariants.find(v => v.id === item.material_variant_id);
      if (sel?.available_colors?.length) {
        return [...sel.available_colors].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      }
    }

    const colorSet = new Set<string>();

    // Primary source: colors from ALL BOM groups whose product category is lining/insole-related
    const liningCategories = new Set(['Forração da Palmilha', 'Palmilha']);
    refMaterials.forEach((m: any) => {
      const category = (m.products as any)?.category;
      const groupId = m.group_id || m.product_groups?.id || (m.products as any)?.group_id;
      if (groupId && liningCategories.has(category)) {
        getColorsFromGroupId(groupId).forEach(color => colorSet.add(color));
      }
    });

    // Also merge BOM lining/insole group names from sheet specs
    const sheetGroupNames: string[] = [
      sheetSpecs?.lining_material,
      sheetSpecs?.insole_material,
    ].filter(Boolean) as string[];

    // Include lining_accessories materials (array of {material, consumption})
    if (Array.isArray(sheetSpecs?.lining_accessories)) {
      (sheetSpecs.lining_accessories as any[]).forEach((acc: any) => {
        const mat = typeof acc === 'string' ? acc : acc?.material;
        if (mat) sheetGroupNames.push(mat);
      });
    }

    sheetGroupNames.forEach(groupName => {
      getColorsFromGroupName(groupName).forEach(color => colorSet.add(color));
    });

    // Fallback: all products categorized as "Forração da Palmilha"
    if (colorSet.size === 0) {
      const forracaoProducts = allProducts.filter((p: any) => p.category === 'Forração da Palmilha');
      forracaoProducts.forEach((product: any) => {
        const explicitColor = product.color?.trim();
        const derivedColor = getDerivedProductColor(product);
        if (explicitColor) colorSet.add(explicitColor);
        if (derivedColor) colorSet.add(derivedColor);
      });
    }

    // Always include color variants from the reference
    colorVariants.forEach((variant: any) => {
      if (variant.color?.trim()) colorSet.add(variant.color.trim());
    });

    // Fallback: reference-level colors field
    if (colorSet.size === 0 && selectedRef?.colors) {
      selectedRef.colors.split(',').forEach(color => colorSet.add(color.trim()));
    }
    return uniqueSortedColors(Array.from(colorSet));
  }, [item.material_variant_id, activeMaterialVariants, colorVariants, sheetSpecs, selectedRef?.colors, selectedRef?.has_straps, selectedRef?.strap_colors, refMaterials, productGroups, allProducts, groupSupplierMaterials, allGroupColors]);

  useEffect(() => {
    const currentStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const { index: idx, onUpdate: update } = latestRef.current;

    // Auto-populate unit price from reference if it's 0 and reference just loaded/changed
    if (selectedRef && selectedRef.sale_price != null && item.unit_price === 0) {
      update(idx, 'unit_price', selectedRef.sale_price);
    }

    // Strap sync: only run once per reference change. If the same reference's
    // strap_colors refresh in the query cache, skip — otherwise a cache update
    // would silently restore straps the user deliberately removed.
    const refIdForStraps = selectedRef?.id ?? item.reference_id ?? '';
    if (strapSyncedForRef.current !== refIdForStraps) {
      strapSyncedForRef.current = refIdForStraps;

      if (selectedRef?.has_straps && selectedRef.strap_colors?.length && currentStraps.length === 0) {
        const straps = (selectedRef.strap_colors as any[]).map((s: any) => ({
          id: s.id || String(Math.random()),
          label: s.label || 'TIRA',
          color: '',
          group_id: s.group_id || '',
          group_name: s.group_name || '',
          consumption: s.consumption || 0,
          consumption_per_size: s.consumption_per_size || {},
        }));
        update(idx, 'strap_colors', straps);
      } else if (selectedRef?.has_straps && selectedRef.strap_colors?.length && currentStraps.length > 0) {
        // Sync structure with current reference definition (straps added/removed in sheet)
        // but preserve colors the user already selected.
        const refStrapIds = new Set((selectedRef.strap_colors as any[]).map(s => s.id));
        const updatedStraps = (selectedRef.strap_colors as any[]).map((refStrap: any) => {
          const existing = currentStraps.find(s => s.id === refStrap.id);
          return {
            id: refStrap.id || String(Math.random()),
            label: refStrap.label || 'TIRA',
            color: existing?.color || '',
            group_id: refStrap.group_id || '',
            group_name: refStrap.group_name || '',
            consumption: refStrap.consumption || 0,
            consumption_per_size: refStrap.consumption_per_size || {},
          };
        });
        if (updatedStraps.length !== currentStraps.length || !currentStraps.every(s => refStrapIds.has(s.id))) {
          update(idx, 'strap_colors', updatedStraps);
        }
      }
    }
  }, [item.reference_id, selectedRef?.id, selectedRef?.strap_colors]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevRefId.current = item.reference_id;
      return;
    }
    const refChanged = prevRefId.current !== item.reference_id && prevRefId.current !== '';
    if (refChanged) {
      const { index: idx, onUpdate: update } = latestRef.current;
      if (selectedRef && selectedRef.sale_price != null && (item.unit_price === 0 || !isAdmin)) {
        update(idx, 'unit_price', selectedRef.sale_price);
      }
      update(idx, 'grade', {});
      update(idx, 'color', '');
      update(idx, 'strap_colors', []);
      update(idx, 'material_variant_id', null);
    }
    prevRefId.current = item.reference_id;
  }, [item.reference_id]);

  // Auto-select the only available material group when reference has exactly one.
  useEffect(() => {
    if (activeMaterialVariants.length === 1 && !item.material_variant_id) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'material_variant_id', activeMaterialVariants[0].id);
    }
  }, [item.reference_id, activeMaterialVariants.length]);

  useEffect(() => {
    if (totalPairs !== item.quantity) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'quantity', totalPairs);
    }
  }, [totalPairs, item.quantity]);

  const handleGradeChange = (size: string, value: number) => {
    onUpdate(index, 'grade', { ...grade, [size]: value });
  };

  const finalGrade: Record<string, number> = {};
  SIZES.forEach(s => {
    const key = s; // SIZES is already string[] (may contain "24/25" for conjugated soles)
    const val = (grade[key] || 0) * fichas;
    if (val > 0) finalGrade[key] = val;
  });

  const isInfantil = selectedRef?.shoe_category === 'Infantil';

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden mb-4 transition-all hover:border-primary/30">
      {/* Item header bar */}
      <div className="flex items-center justify-between bg-muted/20 px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => selectedRef && setEditColorsDialog(true)}
            title={selectedRef ? 'Clique para editar variantes de cor' : ''}
          >
            <div className="h-10 w-10 rounded border bg-muted overflow-hidden flex-shrink-0">
              {(() => {
                // Priority: color variant image → ref images[] → ref image_url → any variant with image
                const variantImg = item.color && colorVariants.length > 0
                  ? colorVariants.find((v: any) => v.color?.toLowerCase() === item.color?.toLowerCase() && v.image_url)?.image_url
                  : null;
                const refImages = (selectedRef as any)?.images;
                const refFirstImage = Array.isArray(refImages) && refImages.length > 0
                  ? (typeof refImages[0] === 'string' ? refImages[0] : refImages[0]?.url)
                  : null;
                const anyVariantImg = !variantImg && colorVariants.length > 0
                  ? colorVariants.find((v: any) => v.image_url)?.image_url
                  : null;
                const imgSrc = variantImg || refFirstImage || selectedRef?.image_url || anyVariantImg;
                return imgSrc ? (
                  <img src={imgSrc} alt={selectedRef?.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <Package className="h-5 w-5" />
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Ref</span>
                <span className="font-mono font-bold text-sm">{selectedRef?.code || '—'}</span>
              </div>
              <span className="text-xs font-medium text-foreground truncate max-w-[200px]">{selectedRef?.name || 'Selecione uma referência'}</span>
            </div>
            {selectedRef && <Palette className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
          </button>
          {item.color && (
            <>
              <div className="h-8 w-px bg-border mx-1" />
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-primary/5 text-primary border-primary/20">
                {item.color}
              </Badge>
            </>
          )}
          {item.material_variant_id && (() => {
            const sel = activeMaterialVariants.find(v => v.id === item.material_variant_id);
            if (sel) {
              return (
                <>
                  <div className="h-8 w-px bg-border mx-1" />
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px] gap-1 font-normal">
                    <span className="font-medium">{sel.material_name}</span>
                    {sel.sku && <span className="font-mono text-primary opacity-70">· {sel.sku}</span>}
                  </Badge>
                </>
              );
            }
            // Variant was deactivated/removed since the item was saved.
            return (
              <>
                <div className="h-8 w-px bg-border mx-1" />
                <Badge variant="destructive" className="h-5 px-1.5 text-[10px] gap-1 font-normal">
                  Material inativo — NF-e será bloqueada
                </Badge>
              </>
            );
          })()}
          {item.reference_id && totalPairs > 0 && (
            <StockAvailabilityBadge referenceId={item.reference_id} quantity={totalPairs} color={item.color} />
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase font-bold leading-none">Pares</p>
            <p className="font-mono font-bold text-sm leading-tight">{totalPairs}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase font-bold leading-none">Subtotal</p>
            <p className="font-mono font-bold text-sm text-primary leading-tight">{formatCurrency(itemTotal)}</p>
          </div>
          {canRemove && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Main Selection Row
            Layout varies by whether this reference has material groups:
            • No groups:  Ref(4) | Cor(3) | Preço(2) | Fichas(1) | Grade(2) = 12
            • Com grupos: Ref(3) | Material*(3) | Cor(3) | Preço(2) | Fichas(1) = 12
              (grade copy button moves to the grade section header)
        */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Referência — narrower when material groups exist */}
          <div className={cn("md:col-span-4", activeMaterialVariants.length > 0 && "md:col-span-3")}>
            <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Modelo / Referência</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-xs font-mono">
                  {selectedRef ? `${selectedRef.code} - ${selectedRef.name}` : "Selecionar..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <ReferenceSearch
                  references={references}
                  onSelect={(ref) => onUpdate(index, 'reference_id', ref.id)}
                  selectedId={item.reference_id}
                  variantsByRef={allVariantsByRef}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Material — shown BEFORE color when groups exist (fiscal SKU varies by material) */}
          {activeMaterialVariants.length > 0 && (
            <div className="md:col-span-3">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                Material *
              </Label>
              <Select
                value={item.material_variant_id || ''}
                onValueChange={v => {
                  onUpdate(index, 'material_variant_id', v || null);
                  // Clear color — available colors may differ per material group
                  onUpdate(index, 'color', '');
                }}
              >
                <SelectTrigger className={cn(
                  "h-9 text-xs",
                  !item.material_variant_id && "border-amber-400/60 text-muted-foreground"
                )}>
                  <SelectValue placeholder="Selecione o material…" />
                </SelectTrigger>
                <SelectContent>
                  {activeMaterialVariants.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.material_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Cor — disabled until material is selected (when groups exist) */}
          <div className={cn(
            "md:col-span-3",
            activeMaterialVariants.length > 0 && !item.material_variant_id && "opacity-40 pointer-events-none"
          )}>
            <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
              Cor Principal
              {activeMaterialVariants.length > 0 && !item.material_variant_id && (
                <span className="ml-1 normal-case font-normal text-muted-foreground">(selecione o material)</span>
              )}
            </Label>
            <div className="flex gap-1">
              <ColorSearchSelect
                colors={availableColors}
                value={item.color}
                onSelect={(v) => onUpdate(index, 'color', v)}
              />
              {onSaveStateAndNavigate && activeMaterialVariants.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  title="Cadastrar material no estoque"
                  onClick={onSaveStateAndNavigate}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">Preço Unitário</Label>
            <div className="relative">
              <NumberInput
                value={item.unit_price}
                onChange={(v) => onUpdate(index, 'unit_price', v)}
                className="h-9 font-mono text-xs"
                decimals={2}
              />
              {pdv > 0 && !isAdmin && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Lock className="h-3 w-3 text-muted-foreground opacity-30" /></div>}
            </div>
          </div>

          <div className="md:col-span-1">
            <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block text-center">Fichas</Label>
              <NumberInput
                value={fichas}
                onChange={(v) => setFichas(Math.max(1, v))}
                className="h-9 font-mono text-xs text-center"
                min={1}
                step="1"
              />
          </div>

          {/* Grade copy button — only in main row when no material groups (to keep 12-col total).
              When material groups exist, this button moves to the grade section header. */}
          {activeMaterialVariants.length === 0 && (
            <div className="md:col-span-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-1.5 text-[10px] font-bold uppercase tracking-widest w-full"
                onClick={() => onCopyGradeFromPrevious?.(index)}
                disabled={index === 0}
              >
                <Check className="h-3.5 w-3.5 text-primary" /> Grade
              </Button>
            </div>
          )}
        </div>

        {/* Grade Section */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/5">
          <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Distribuição por Numeração</span>
            <div className="flex items-center gap-2">
              {/* Grade copy button moves here when material groups are present */}
              {activeMaterialVariants.length > 0 && index > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
                  onClick={() => onCopyGradeFromPrevious?.(index)}
                >
                  <Check className="h-3 w-3 text-primary" /> Copiar grade
                </Button>
              )}
              <div className="text-[10px] font-bold">
                {gradeTotal} <span className="text-muted-foreground font-normal">pares/ficha</span>
              </div>
            </div>
          </div>
          <div className="p-3">
            <div className="flex gap-1.5 justify-center flex-wrap">
              {SIZES.map(size => {
                const val = grade[size] || 0;
                const isConjugated = size.includes('/');
                return (
                  <div key={size} className="text-center" style={{ width: isConjugated ? '4.2rem' : (isInfantil ? '3rem' : '3.4rem') }}>
                    <label className={cn("text-[10px] font-bold block mb-1", isConjugated ? 'text-primary' : 'text-muted-foreground')}>{size}</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={val || ''}
                      onChange={e => {
                        const raw = e.target.value.replace(',', '.');
                        const parsed = Number(raw);
                        const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
                        handleGradeChange(size, safe);
                      }}
                      onBlur={e => {
                        // After leaving the field, snap the displayed value to
                        // the integer that was stored so it's clear decimals are
                        // not accepted — prevents the "I typed 2.5 but it saved
                        // as 2" confusion.
                        const raw = e.target.value.replace(',', '.');
                        const parsed = Number(raw);
                        if (Number.isFinite(parsed) && parsed !== Math.floor(parsed)) {
                          e.target.value = String(Math.floor(Math.max(0, parsed)));
                        }
                      }}
                      onFocus={e => e.target.select()}
                      className={cn(
                        "w-full h-8 text-xs font-mono text-center rounded border transition-all",
                        val > 0 ? 'border-primary/50 bg-primary/5 font-bold ring-1 ring-primary/10' : 'border-input hover:bg-muted/30',
                        isConjugated && 'border-primary/30'
                      )}
                      placeholder="–"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Straps Section */}
        {(item.strap_colors as any[])?.length > 0 && (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cores das Tiras</span>
              <Button variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={() => {
                const updated = (item.strap_colors as any[]).map((s: any) => ({ ...s, color: item.color }));
                onUpdate(index, 'strap_colors', updated);
              }}>Igualar à principal</Button>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {(item.strap_colors as any[]).map((strap: any, sIdx: number) => (
                <div key={strap.id || sIdx} className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase truncate">{strap.label || `Tira ${sIdx + 1}`}</span>
                    {strap.group_name && <span className="text-[9px] text-muted-foreground opacity-70 truncate max-w-[80px]">({strap.group_name})</span>}
                  </div>
                  <ColorPickerDropdown
                    value={strap.color || ''}
                    colors={strap.group_id ? getColorsFromGroupId(strap.group_id) : availableColors}
                    onChange={(v) => {
                      const updated = [...(item.strap_colors as any[])];
                      updated[sIdx] = { ...updated[sIdx], color: v };
                      onUpdate(index, 'strap_colors', updated);
                    }}
                    disabled={!item.reference_id}
                    onAddNew={strap.group_id ? (color) => {
                      setPendingStrapGroupId(strap.group_id);
                      setPendingStrapGroupName(strap.group_name || '');
                      setPendingStrapColor(color);
                      setPendingStrapIndex(sIdx);
                      setCreateStrapDialog(true);
                    } : undefined}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Observation */}
        <div>
          {item.observation !== null && item.observation !== undefined ? (
            <div className="space-y-1">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase">Observação</Label>
              <textarea
                value={item.observation || ''}
                onChange={e => onUpdate(index, 'observation', e.target.value.slice(0, 300))}
                maxLength={300}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Observação para esta referência (aparece nos relatórios)..."
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{(item.observation || '').length}/300</span>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground" onClick={() => onUpdate(index, 'observation', null)}>
                  Remover
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-[11px]"
              onClick={() => onUpdate(index, 'observation', '')}
            >
              <MessageSquare className="h-3 w-3" /> Observação
            </Button>
          )}
        </div>
      </div>

      <CreateStrapProductDialog
        open={createStrapDialog}
        onOpenChange={setCreateStrapDialog}
        groupId={pendingStrapGroupId}
        groupName={pendingStrapGroupName}
        color={pendingStrapColor}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['products_for_colors'] });
          qc.invalidateQueries({ queryKey: ['group_supplier_materials_for_colors'] });
          qc.invalidateQueries({ queryKey: ['product_groups_colors'] });
          // Auto-set the color on the strap after creation
          if (pendingStrapIndex !== null && pendingStrapColor) {
            const updated = [...(item.strap_colors as any[])];
            if (updated[pendingStrapIndex]) {
              updated[pendingStrapIndex] = { ...updated[pendingStrapIndex], color: pendingStrapColor };
              onUpdate(index, 'strap_colors', updated);
            }
          }
          setPendingStrapIndex(null);
        }}
      />

      {selectedRef && (
        <EditColorVariantsDialog
          open={editColorsDialog}
          onOpenChange={setEditColorsDialog}
          referenceId={item.reference_id!}
          referenceName={`${selectedRef.code} - ${selectedRef.name}`}
          availableColors={availableColors}
          onColorsChanged={() => {
            qc.invalidateQueries({ queryKey: ['color_variants', item.reference_id] });
          }}
        />
      )}
    </div>
  );
}

const SaleOrderItemForm = memo(SaleOrderItemFormInner);
export default SaleOrderItemForm;

function ColorSearchSelect({ colors, value, onSelect }: { colors: string[]; value: string; onSelect: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = colors.filter(c => normalize(c).includes(normalize(search)));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="flex-1 justify-between h-9 text-xs">
          {value || 'Escolha a cor...'}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="p-2 space-y-2">
          <div className="flex items-center gap-2 px-2 border rounded-md">
            <Search className="h-4 w-4 text-muted-foreground opacity-50" />
            <input
              className="flex-1 h-9 text-sm outline-none bg-transparent"
              placeholder="Buscar cor ou material..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-[250px] overflow-y-auto space-y-0.5">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma cor encontrada.</p>
            )}
            {filtered.map(color => (
              <button
                key={color}
                onClick={() => { onSelect(color); setOpen(false); setSearch(''); }}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2 text-xs rounded-sm hover:bg-accent text-left",
                  value === color && "bg-accent font-bold"
                )}
              >
                <span>{color}</span>
                {value === color && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReferenceSearch({
  references, onSelect, selectedId, variantsByRef,
}: {
  references: ReferenceOption[];
  onSelect: (ref: ReferenceOption) => void;
  selectedId?: string;
  variantsByRef?: Map<string, VariantSummary[]>;
}) {
  const [search, setSearch] = useState('');
  const filtered = references.filter(r =>
    (r.code?.toLowerCase() + ' ' + r.name?.toLowerCase()).includes(search.toLowerCase())
  );
  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2 px-2 border rounded-md">
        <Command className="h-4 w-4 text-muted-foreground opacity-50" />
        <input
          className="flex-1 h-9 text-sm outline-none bg-transparent"
          placeholder="Buscar por código ou nome..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      {filtered.length > 50 && !search && (
        <p className="px-2 text-[10px] text-muted-foreground">
          {filtered.length} referências — busque por código ou nome para filtrar.
        </p>
      )}
      <div className="max-h-[300px] overflow-y-auto space-y-0.5">
        {filtered.map(ref => {
          const variants = variantsByRef?.get(ref.id) ?? [];
          return (
            <button
              key={ref.id}
              onClick={() => onSelect(ref)}
              className={cn(
                "flex items-start justify-between w-full px-3 py-2 text-xs rounded-sm hover:bg-accent text-left gap-2",
                selectedId === ref.id && "bg-accent font-bold"
              )}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="h-10 w-10 rounded border bg-muted overflow-hidden flex-shrink-0">
                  {ref.image_url ? (
                    <img src={ref.image_url} alt={ref.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-muted-foreground/30">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono bg-muted px-1.5 rounded text-muted-foreground w-fit">{ref.code}</span>
                  <span className="truncate max-w-[200px] font-medium">{ref.name}</span>
                  {variants.length > 0 && (
                    <span className="text-[9px] text-primary/70 font-medium">
                      {variants.length} grupo{variants.length !== 1 ? 's' : ''} de material
                    </span>
                  )}
                </div>
              </div>
              {ref.shoe_category && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 mt-0.5">{ref.shoe_category}</Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorPickerDropdown({ value, colors, onChange, disabled, onAddNew }: { value: string; colors: string[]; onChange: (v: string) => void; disabled?: boolean; onAddNew?: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = colors.filter(c => c.toLowerCase().includes(search.toLowerCase()));
  const showAdd = search.trim() && !colors.some(c => c.toLowerCase() === search.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={cn("w-full h-8 justify-between text-[11px] font-normal", !value && "text-muted-foreground")}>
          {value || 'Escolha a cor...'}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-1">
        <Input placeholder="Cor..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 mb-1 text-xs" />
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filtered.map(c => (
            <button key={c} onClick={() => { onChange(c); setOpen(false); }} className="w-full text-left px-2 py-1 text-xs hover:bg-accent rounded-sm">{c}</button>
          ))}
          {showAdd && (
            <button
              onClick={() => {
                if (onAddNew) {
                  onAddNew(search.trim());
                } else {
                  onChange(search.trim());
                }
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1 text-xs text-primary hover:bg-accent rounded-sm"
            >
              + Cadastrar "{search}" no estoque
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditColorVariantsDialog({
  open,
  onOpenChange,
  referenceId,
  referenceName,
  availableColors,
  onColorsChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  referenceId: string;
  referenceName: string;
  availableColors: string[];
  onColorsChanged: () => void;
}) {
  const [newColor, setNewColor] = useState('');
  const [search, setSearch] = useState('');

  const { data: variants = [], refetch } = useQuery({
    queryKey: ['color_variants_edit', referenceId],
    enabled: open && !!referenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_color_variants')
        .select('*')
        .eq('reference_id', referenceId)
        .order('color');
      if (error) throw error;
      return data;
    },
  });

  const addMut = useMutation({
    mutationFn: async (color: string) => {
      const { error } = await supabase
        .from('reference_color_variants')
        .insert({ reference_id: referenceId, color });
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
      onColorsChanged();
      toast.success('Cor adicionada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('reference_color_variants')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
      onColorsChanged();
      toast.success('Cor removida');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAdd = () => {
    const c = newColor.trim();
    if (!c) return;
    if (variants.some((v: any) => v.color.toLowerCase() === c.toLowerCase())) {
      toast.error('Cor já existe');
      return;
    }
    addMut.mutate(c);
    setNewColor('');
  };

  const existingSet = new Set(variants.map((v: any) => v.color.toLowerCase()));
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const suggestedColors = availableColors.filter(c => !existingSet.has(c.toLowerCase()));
  const filteredSuggested = search
    ? suggestedColors.filter(c => normalize(c).includes(normalize(search)))
    : suggestedColors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Variantes de Cor — {referenceName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current variants */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Cores cadastradas ({variants.length})</p>
            {variants.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nenhuma variante cadastrada.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {variants.map((v: any) => (
                  <Badge key={v.id} variant="secondary" className="gap-1 pr-1">
                    {v.color}
                    <button
                      onClick={() => deleteMut.mutate(v.id)}
                      className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                      title="Remover cor"
                    >
                      <X className="h-3 w-3 text-destructive" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Add manually */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Adicionar nova cor</p>
            <div className="flex gap-2">
              <Input
                value={newColor}
                onChange={e => setNewColor(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                placeholder="Nome da cor..."
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8" onClick={handleAdd} disabled={!newColor.trim()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
              </Button>
            </div>
          </div>

          {/* Suggested from BOM */}
          {suggestedColors.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Cores disponíveis no BOM</p>
              <div className="flex items-center gap-2 mb-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="h-7 text-xs"
                />
              </div>
              <div className="max-h-[200px] overflow-y-auto flex flex-wrap gap-1.5">
                {filteredSuggested.map(c => (
                  <button
                    key={c}
                    onClick={() => addMut.mutate(c)}
                    className="text-xs px-2 py-1 rounded-md border hover:bg-accent hover:border-primary/40 transition-colors"
                  >
                    <Plus className="h-3 w-3 inline mr-1" />{c}
                  </button>
                ))}
                {filteredSuggested.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">Nenhuma cor pendente.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
