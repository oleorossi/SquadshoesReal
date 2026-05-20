import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { NumberInput } from '@/components/ui/number-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash as Trash2, Lock, CaretUpDown as ChevronsUpDown, Check, Package, ArrowSquareOut as ExternalLink, MagnifyingGlass as Search, Command, Palette, Plus, X, ChatText as MessageSquare } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useSheetMaterials } from '@/hooks/useTechnicalSheets';
// StockAvailabilityBadge removido do form — checagem só no save
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
  const { canSeeFinancialValues } = useAccessControl();
  const fichas = item.fichas || 1;
  const setFichas = (v: number) => onUpdate(index, 'fichas', v);

  const [createStrapDialog, setCreateStrapDialog] = useState(false);
  // editColorsDialog removido — variante de cor não é mais editada no PV.
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
        .select('upper_material, lining_material, insole_material, lining_accessories, components_accessories, sole_group_id, sole_material')
        .eq('id', item.reference_id!)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const { data: soleSizeRange } = useQuery({
    queryKey: ['sole_size_range_specific', sheetSpecs?.sole_group_id, sheetSpecs?.sole_material],
    enabled: !!sheetSpecs?.sole_group_id,
    queryFn: async () => {
      // Prioriza a VARIANTE específica configurada na ficha (sole_material).
      // Também retorna a classificação (tipo) do solado matched pro form
      // poder mostrar o badge contextual.
      const { data } = await supabase
        .from('products')
        .select('name, stock_grade, sole_classification')
        .eq('group_id', sheetSpecs!.sole_group_id!)
        .eq('category', 'Solado')
        .eq('active', true)
        .not('stock_grade', 'is', null);
      if (!data || data.length === 0) return null;

      const aggregate = (rows: typeof data): { sizeFrom: number; sizeTo: number; classification?: string } | null => {
        let minFrom: number | null = null;
        let maxTo: number | null = null;
        for (const row of rows) {
          const g = (row as any).stock_grade as Record<string, any> | null;
          if (!g) continue;
          const sf = g._size_from != null ? Number(g._size_from) : null;
          const st = g._size_to != null ? Number(g._size_to) : null;
          if (sf != null) minFrom = minFrom == null ? sf : Math.min(minFrom, sf);
          if (st != null) maxTo = maxTo == null ? st : Math.max(maxTo, st);
        }
        if (minFrom == null || maxTo == null || minFrom > maxTo) return null;
        return { sizeFrom: minFrom, sizeTo: maxTo };
      };

      const soleMat = (sheetSpecs?.sole_material || '').trim().toLowerCase();
      if (soleMat) {
        const matched = (data as any[]).filter(p => {
          const n = (p.name || '').toLowerCase().trim();
          if (!n) return false;
          if (n === soleMat) return true;
          for (const sep of [' ', '-', '/', '_']) {
            if (n.startsWith(soleMat + sep)) return true;
            if (soleMat.startsWith(n + sep)) return true;
          }
          return false;
        });
        const specificRange = aggregate(matched as typeof data);
        if (specificRange) {
          // Pega a classificação da primeira variante matched
          specificRange.classification = (matched[0] as any)?.sole_classification || 'tradicional';
          return specificRange;
        }
      }

      const fallback = aggregate(data);
      if (fallback) {
        fallback.classification = (data[0] as any)?.sole_classification || 'tradicional';
      }
      return fallback;
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

  // Grade size list — RANGE vem do SOLADO (fonte da verdade física).
  //
  // Decisão (2026-05): o solado define quais tamanhos podem ser produzidos.
  // Ficha técnica e PV refletem isso. Trigger no DB sincroniza ficha.sizes
  // automaticamente quando sole_group_id muda. Aqui usamos:
  //   1. soleSizeRange (stock_grade._size_from/_to)
  //   2. fallback: conjugações
  //   3. último fallback: ficha.sizes (caso solado não tenha range cadastrado)
  const SIZES = useMemo((): string[] => {
    let sf: number | null = soleSizeRange?.sizeFrom ?? null;
    let st: number | null = soleSizeRange?.sizeTo ?? null;

    if ((sf == null || st == null) && soleConjugations.length > 0) {
      const allSizes = soleConjugations.flatMap(c => c.sizes);
      if (allSizes.length > 0) {
        sf = sf ?? Math.min(...allSizes);
        st = st ?? Math.max(...allSizes);
      }
    }

    let baseSizes: string[];
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
        baseSizes = result;
      } else {
        baseSizes = Array.from({ length: st - sf + 1 }, (_, i) => String(sf! + i));
      }
    } else {
      baseSizes = parseSizeRange(selectedRef?.sizes, selectedRef?.shoe_category).map(String);
    }

    // Audit visual #15 (CRÍTICO): preservar tamanhos do grade original que
    // estão FORA do range atual do solado. Antes esses pares ficavam invisíveis
    // no editor — ao salvar com matriz "vazia", o usuário sobrescrevia e perdia
    // a distribuição original. Agora mesclamos: range atual primeiro, depois
    // tamanhos órfãos (do grade salvo) ordenados numericamente.
    const gradeKeys = Object.keys(grade || {}).filter(
      k => Number(grade[k]) > 0 && !baseSizes.includes(k),
    );
    if (gradeKeys.length === 0) return baseSizes;

    // Tamanhos órfãos: ordena pelo número inicial (suporta "33/34")
    const orphanSorted = gradeKeys.sort((a, b) => {
      const na = Number(a.split('/')[0]) || 0;
      const nb = Number(b.split('/')[0]) || 0;
      return na - nb;
    });

    // Merge inteligente: insere os órfãos na ordem numérica correta entre baseSizes
    const merged: string[] = [];
    const allKeys = [...baseSizes, ...orphanSorted];
    const seen = new Set<string>();
    for (const k of allKeys.sort((a, b) => {
      const na = Number(a.split('/')[0]) || 0;
      const nb = Number(b.split('/')[0]) || 0;
      return na - nb;
    })) {
      if (!seen.has(k)) { merged.push(k); seen.add(k); }
    }
    return merged;
  }, [soleSizeRange, soleConjugations, selectedRef?.sizes, selectedRef?.shoe_category, grade]);

  // Set de keys que vêm do grade salvo mas NÃO fazem parte do range atual do
  // SOLADO. Pode acontecer se o solado teve seu range alterado depois do PV
  // ser criado — preservamos visualmente pra não perder a distribuição original.
  const orphanSizes = useMemo(() => {
    let sf = soleSizeRange?.sizeFrom;
    let st = soleSizeRange?.sizeTo;
    if ((sf == null || st == null) && soleConjugations.length > 0) {
      const allSizes = soleConjugations.flatMap(c => c.sizes);
      if (allSizes.length > 0) {
        sf = sf ?? Math.min(...allSizes);
        st = st ?? Math.max(...allSizes);
      }
    }
    if (sf == null || st == null) return new Set<string>();
    const baseRangeKeys = new Set<string>();
    if (soleConjugations.length > 0) {
      for (let s = sf; s <= st; s++) {
        const conj = soleConjugations.find(c => c.sizes.includes(s));
        if (conj) baseRangeKeys.add(conj.size_key);
        else baseRangeKeys.add(String(s));
      }
    } else {
      for (let s = sf; s <= st; s++) baseRangeKeys.add(String(s));
    }
    return new Set(
      Object.keys(grade || {}).filter(k => Number(grade[k]) > 0 && !baseRangeKeys.has(k)),
    );
  }, [soleSizeRange, soleConjugations, grade]);

  // colorVariants removido — variante de cor sai do escopo da ficha técnica.
  // As cores disponíveis vêm exclusivamente das variantes de material
  // (reference_material_variants.available_colors[]) ou do BOM via grupos.

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

  // Resolve o group_id da cor principal do item — usado pra "cadastrar cor
  // na hora" via CreateStrapProductDialog. Prioriza variant de material
  // explicitamente selecionada; senão usa o primeiro grupo de forração/cabedal
  // do BOM da ficha técnica. Retorna null quando não consegue inferir (UI
  // esconde o botão "+ Cadastrar" nesse caso).
  const mainGroupForNewColor = useMemo<{ id: string; name: string } | null>(() => {
    if (item.material_variant_id) {
      const variant = activeMaterialVariants.find(v => v.id === item.material_variant_id);
      if (variant?.group_id) {
        return { id: variant.group_id, name: variant.group_name || variant.material_name || '' };
      }
    }
    // Fallback: primeiro material de forração/palmilha no BOM
    const liningCategories = new Set(['Forração da Palmilha', 'Palmilha']);
    for (const m of refMaterials as any[]) {
      const category = (m.products as any)?.category;
      const groupId = m.group_id || m.product_groups?.id || (m.products as any)?.group_id;
      const groupName = m.product_groups?.name || (m.products as any)?.name || '';
      if (groupId && liningCategories.has(category)) {
        return { id: groupId, name: groupName };
      }
    }
    return null;
  }, [item.material_variant_id, activeMaterialVariants, refMaterials]);

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

    // Also merge BOM lining/insole + CABEDAL group names from sheet specs.
    // upper_material adicionado em 20/05/2026 — user reportou que ao definir
    // cabedal "Napa Santorine" (que é um grupo de produtos com várias cores),
    // as cores não apareciam pra escolher no PV. As cores do cabedal são
    // tão válidas quanto as de forração/palmilha pra o item do PV.
    const sheetGroupNames: string[] = [
      sheetSpecs?.upper_material,
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

    // Fallback: reference-level colors field
    if (colorSet.size === 0 && selectedRef?.colors) {
      selectedRef.colors.split(',').forEach(color => colorSet.add(color.trim()));
    }
    return uniqueSortedColors(Array.from(colorSet));
  }, [item.material_variant_id, activeMaterialVariants, sheetSpecs, selectedRef?.colors, selectedRef?.has_straps, selectedRef?.strap_colors, refMaterials, productGroups, allProducts, groupSupplierMaterials, allGroupColors]);

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
    // BUG ANTIGO 2026-05-12: exigíamos selectedRef.has_straps=true. Mas
    // várias fichas técnicas existem com strap_colors configuradas (TIRA 1,
    // 2…) e has_straps=false (estado inconsistente vindo do save da ficha).
    // Resultado: PV nunca populava as tiras → section "Cores das Tiras"
    // ficava invisível mesmo após cor principal escolhida (SP117/SP119).
    // FIX: derivar — se a ficha tem strap_colors.length>0, considera que
    // tem tiras (independente do flag has_straps).
    const refStrapDefs = Array.isArray(selectedRef?.strap_colors) ? selectedRef!.strap_colors : [];
    const refHasStrapsEffective = !!selectedRef?.has_straps || refStrapDefs.length > 0;
    if (strapSyncedForRef.current !== refIdForStraps) {
      strapSyncedForRef.current = refIdForStraps;

      if (refHasStrapsEffective && refStrapDefs.length > 0 && currentStraps.length === 0) {
        const straps = (refStrapDefs as any[]).map((s: any) => ({
          id: s.id || String(Math.random()),
          label: s.label || 'TIRA',
          color: '',
          group_id: s.group_id || '',
          group_name: s.group_name || '',
          consumption: s.consumption || 0,
          consumption_per_size: s.consumption_per_size || {},
        }));
        update(idx, 'strap_colors', straps);
      } else if (refHasStrapsEffective && refStrapDefs.length > 0 && currentStraps.length > 0) {
        // Sync structure with current reference definition (straps added/removed in sheet)
        // but preserve colors the user already selected.
        const refStrapIds = new Set((refStrapDefs as any[]).map(s => s.id));
        const updatedStraps = (refStrapDefs as any[]).map((refStrap: any) => {
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

  // Auto-sincroniza cor das tiras com a cor principal do item. Regra de negócio
  // (user em 2026-05): "cor da sandália = cor da forração; em modelos com tiras,
  // cada cor de forração tem uma tira correspondente". Antes o operador
  // precisava clicar "Igualar à principal" toda vez ou setar manualmente cor
  // a cor — fonte recorrente de erro no débito (debit_strap_stock falhava
  // quando esquecia de igualar).
  // Só auto-sync quando:
  //  - item.color foi escolhida (não vazio)
  //  - tiras existem
  //  - tira ainda não tem cor OU todas as tiras estão com a mesma cor antiga
  //    (preserva override manual do operador se ele variou as tiras)
  useEffect(() => {
    if (!item.color) return;
    const straps = (item.strap_colors as any[]) || [];
    if (straps.length === 0) return;

    const allBlank = straps.every(s => !s?.color);
    const allSameOldColor = straps.every(s => s?.color && s.color !== item.color &&
      straps.every(other => other?.color === s.color));

    if (allBlank || allSameOldColor) {
      const updated = straps.map(s => ({ ...s, color: item.color }));
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'strap_colors', updated);
    }
  }, [item.color, (item.strap_colors as any[])?.length]);

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
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden mb-4 transition-all hover:border-primary/30">
      {/* Item header bar */}
      <div className="flex items-center justify-between bg-muted/20 px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded border bg-muted overflow-hidden flex-shrink-0">
              {(() => {
                // Priority: ref images[] → ref image_url
                // (color variant images removidas — variante de cor não existe mais)
                const refImages = (selectedRef as any)?.images;
                const refFirstImage = Array.isArray(refImages) && refImages.length > 0
                  ? (typeof refImages[0] === 'string' ? refImages[0] : refImages[0]?.url)
                  : null;
                const imgSrc = refFirstImage || selectedRef?.image_url;
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
                {/* Badge NCM da ficha — fica amber quando inválido (faltando ou
                    fora do formato 8 dígitos). NF-e exige NCM válido pra emissão;
                    mostrando aqui o usuário enxerga problema antes mesmo de
                    tentar emitir. */}
                {selectedRef && (() => {
                  const ncm = (selectedRef as any).ncm as string | null | undefined;
                  const valid = ncm && /^\d{8}$/.test(ncm);
                  if (!ncm) {
                    return (
                      <Badge variant="outline" className="h-4 text-[9px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800" title="Ficha sem NCM — NF-e será bloqueada">
                        ⚠ NCM
                      </Badge>
                    );
                  }
                  if (!valid) {
                    return (
                      <Badge variant="outline" className="h-4 text-[9px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 font-mono" title="NCM precisa de 8 dígitos">
                        NCM {ncm}
                      </Badge>
                    );
                  }
                  return (
                    <Badge variant="outline" className="h-4 text-[9px] font-mono opacity-60" title="NCM válido">
                      {ncm}
                    </Badge>
                  );
                })()}
              </div>
              <span className="text-xs font-medium text-foreground truncate max-w-[200px]">{selectedRef?.name || 'Selecione uma referência'}</span>
            </div>
          </div>
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
          {/* StockAvailabilityBadge removido: a verificação de estoque/cor
              fica APENAS no save (via checkSoleAvailability +
              enrichMaterialShortages em SaleOrderForm). Antes, o badge
              rodava o RPC check_stock_availability a cada mudança de
              qtd/cor — gerava ruído visual e chamadas desnecessárias. */}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase font-bold leading-none">Pares</p>
            <p className="font-mono font-bold text-sm leading-tight">{totalPairs}</p>
          </div>
          {canSeeFinancialValues && (
            <div className="text-right">
              <p className="text-[9px] text-muted-foreground uppercase font-bold leading-none">Subtotal</p>
              <p className="font-mono font-bold text-sm text-primary leading-tight">{formatCurrency(itemTotal)}</p>
            </div>
          )}
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

          {/* Fallback: ficha tem upper_material textual mas zero variantes
              cadastradas em reference_material_variants. Mostra read-only pro
              user saber qual cabedal vai ser usado. Débito continua via BOM
              da ficha (sheet_materials). Reportado em 20/05/2026 — user
              cadastrou Napa Santorine no campo Cabedal e estranhou não
              aparecer nada no PV. */}
          {activeMaterialVariants.length === 0 && sheetSpecs?.upper_material && (
            <div className="md:col-span-3">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                Cabedal
              </Label>
              <div className="h-9 px-3 rounded-md border bg-muted/30 flex items-center text-xs text-muted-foreground">
                {sheetSpecs.upper_material}
                <span className="ml-auto text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                  da ficha
                </span>
              </div>
            </div>
          )}

          {/* Cor — disabled until material is selected (when groups exist) */}
          {(() => {
            const isLocked = activeMaterialVariants.length > 0 && !item.material_variant_id;
            return (
          <div className={cn(
            "md:col-span-3",
            isLocked && "pointer-events-none"
          )}>
            <Label className={cn(
              "text-[10px] font-bold uppercase mb-1 block flex items-center gap-1",
              isLocked ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
            )}>
              Cor Principal
              {isLocked && (
                <span className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-[9px] font-bold border border-amber-500/30 normal-case">
                  🔒 Escolha o material primeiro
                </span>
              )}
            </Label>
            <div className="flex gap-1">
              <ColorSearchSelect
                colors={availableColors}
                value={item.color}
                onSelect={(v) => onUpdate(index, 'color', v)}
                onAddNew={mainGroupForNewColor ? (color) => {
                  // Reusa o CreateStrapProductDialog pra criar produto na cor
                  // principal (forração/cabedal). Sentinela index=-1 indica
                  // "cor principal, não tira" pro callback onCreated.
                  setPendingStrapGroupId(mainGroupForNewColor.id);
                  setPendingStrapGroupName(mainGroupForNewColor.name);
                  setPendingStrapColor(color);
                  setPendingStrapIndex(-1);
                  setCreateStrapDialog(true);
                } : undefined}
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
            );
          })()}

          {canSeeFinancialValues && (
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
          )}

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
          {/* Badge contextual do tipo de solado — ajuda a entender por que a
              grade mostra números individuais vs conjugados, e qual a regra
              de palmilha (cortada vs pronta na cor). */}
          {soleSizeRange?.classification && (
            <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2
              ${soleSizeRange.classification === 'tradicional' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-b border-emerald-200 dark:border-emerald-800' : ''}
              ${soleSizeRange.classification === 'palmilha_pronta' ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-b border-violet-200 dark:border-violet-800' : ''}
              ${soleSizeRange.classification === 'conjugado' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-b border-amber-200 dark:border-amber-800' : ''}
            `}>
              <span>Solado</span>
              <span className="opacity-50">·</span>
              <span>{soleSizeRange.classification === 'tradicional' ? 'Tradicional' : soleSizeRange.classification === 'palmilha_pronta' ? 'Palmilha Pronta' : 'Conjugado'}</span>
              {soleSizeRange.classification === 'conjugado' && soleConjugations.length > 0 && (
                <span className="opacity-70 normal-case font-medium tracking-normal">
                  · {soleConjugations.length} slot{soleConjugations.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
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
                {fichas > 1 ? (
                  <>
                    {gradeTotal} <span className="text-muted-foreground font-normal">×</span> {fichas} ={' '}
                    <span className="text-primary">{totalPairs}</span>
                    <span className="text-muted-foreground font-normal"> pares</span>
                  </>
                ) : (
                  <>
                    {gradeTotal} <span className="text-muted-foreground font-normal">pares</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="p-3">
            <div className="flex gap-1.5 justify-center flex-wrap">
              {SIZES.map(size => {
                const val = grade[size] || 0;
                const isConjugated = size.includes('/');
                // Audit visual #15: tamanho órfão = está no grade mas fora do
                // range atual do solado. Marcado em âmbar pra usuário ver
                // claramente que é dado preservado (não vai sumir ao salvar).
                const isOrphan = orphanSizes.has(size);
                return (
                  <div key={size} className="text-center relative" style={{ width: isConjugated ? '5.2rem' : (isInfantil ? '3.5rem' : '3.8rem') }}>
                    {isOrphan && (
                      <span
                        className="absolute -top-1 -right-1 z-10 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-bold border border-background shadow-sm"
                        title={`Tamanho ${size} fora do range atual do solado, mas preservado do PV original`}
                      >
                        ⚠
                      </span>
                    )}
                    <label
                      className={cn(
                        "text-[11px] font-bold block mb-1",
                        isOrphan
                          ? 'text-amber-700 dark:text-amber-300'
                          : isConjugated ? 'text-primary' : 'text-muted-foreground',
                      )}
                      title={isOrphan
                        ? `Tamanho ${size} fora do range atual do solado, mas preservado do PV original`
                        : undefined}
                    >
                      {size}
                    </label>
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
                        const raw = e.target.value.replace(',', '.');
                        const parsed = Number(raw);
                        if (Number.isFinite(parsed) && parsed !== Math.floor(parsed)) {
                          e.target.value = String(Math.floor(Math.max(0, parsed)));
                        }
                      }}
                      onFocus={e => e.target.select()}
                      className={cn(
                        "w-full h-10 text-sm font-mono text-center rounded border transition-all",
                        val > 0 ? 'border-primary/50 bg-primary/5 font-bold ring-1 ring-primary/10' : 'border-input hover:bg-muted/30',
                        isConjugated && 'border-primary/30',
                        isOrphan && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-300/40',
                      )}
                      placeholder="–"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Straps Section — fluxo sequencial: só abre após cor principal definida.
            Sem isso, ao selecionar referência com tiras o user via cor principal +
            tiras juntas e ficava confuso sobre qual preencher primeiro.
            Fallback: se o item já tem alguma tira com cor (edição de PV existente),
            sempre mostra. */}
        {(() => {
          const straps = (item.strap_colors as any[]) || [];
          if (straps.length === 0) return null;
          const anyStrapHasColor = straps.some((s: any) => !!s?.color);
          const principalDefined = !!item.color;
          // Se cor principal ainda não foi escolhida E nenhuma tira ainda tem cor,
          // mostra placeholder com hint em vez da section completa.
          if (!principalDefined && !anyStrapHasColor) {
            return (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground italic flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                Defina a <strong className="text-foreground">Cor Principal</strong> acima para abrir as <strong className="text-foreground">cores das {straps.length} tira{straps.length > 1 ? 's' : ''}</strong>.
              </div>
            );
          }
          return null;
        })()}
        {(item.strap_colors as any[])?.length > 0 && (!!item.color || ((item.strap_colors as any[]) || []).some((s: any) => !!s?.color)) && (() => {
          const straps = item.strap_colors as any[];
          // Detecta tiras com cor escolhida mas SEM produto no estoque (group_id + color)
          // Antes o operador só descobria isso quando OP entrava em produção e
          // debit_strap_stock falhava. Agora alertamos no momento da escolha.
          const missing = straps
            .map((s: any, idx: number) => {
              if (!s?.color || !s?.group_id) return null;
              const targetColor = s.color.trim().toLowerCase();
              const hasProduct = (allProducts as any[]).some(
                (p: any) => p.group_id === s.group_id &&
                  (p.color || '').trim().toLowerCase() === targetColor &&
                  p.active !== false,
              );
              return hasProduct ? null : { idx, color: s.color, group_name: s.group_name };
            })
            .filter(Boolean) as Array<{ idx: number; color: string; group_name: string }>;
          const hasMissing = missing.length > 0;

          return (
            <div className={`rounded-lg border overflow-hidden ${hasMissing ? 'border-amber-500/50' : 'border-border/60'}`}>
              <div className={`px-3 py-1.5 border-b flex items-center justify-between ${hasMissing ? 'bg-amber-500/10' : 'bg-muted/30'}`}>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Cores das Tiras{hasMissing && <span className="text-amber-700 ml-1">⚠ {missing.length} sem estoque</span>}
                </span>
                <Button variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={() => {
                  const updated = straps.map((s: any) => ({ ...s, color: item.color }));
                  onUpdate(index, 'strap_colors', updated);
                }}>Igualar à principal</Button>
              </div>

              {hasMissing && (
                <div className="px-3 py-2 bg-amber-500/5 border-b border-amber-500/30 text-xs text-amber-800 space-y-2">
                  <p>
                    <strong>Atenção:</strong> {missing.length === 1
                      ? `Cor "${missing[0].color}" não tem produto no estoque do grupo "${missing[0].group_name || 'tira'}".`
                      : `${missing.length} tiras com cor sem produto no estoque.`}
                    {' '}O débito vai falhar quando a OP entrar em produção. Cadastre agora pra continuar:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map(m => {
                      const strap = straps[m.idx];
                      return (
                        <Button
                          key={m.idx}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 border-amber-500/40 bg-card hover:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          onClick={() => {
                            setPendingStrapGroupId(strap.group_id);
                            setPendingStrapGroupName(strap.group_name || '');
                            setPendingStrapColor(strap.color);
                            setPendingStrapIndex(m.idx);
                            setCreateStrapDialog(true);
                          }}
                          title={`Cadastrar produto "${m.group_name} - ${m.color}" no estoque`}
                        >
                          <Plus className="h-3 w-3" />
                          Cadastrar "{m.color}"
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {straps.map((strap: any, sIdx: number) => {
                  const isMissing = missing.some(m => m.idx === sIdx);
                  return (
                    <div key={strap.id || sIdx} className="space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase truncate">{strap.label || `Tira ${sIdx + 1}`}</span>
                        {strap.group_name && <span className="text-[9px] text-muted-foreground opacity-70 truncate max-w-[80px]">({strap.group_name})</span>}
                      </div>
                      <ColorPickerDropdown
                        value={strap.color || ''}
                        colors={strap.group_id ? getColorsFromGroupId(strap.group_id) : availableColors}
                        onChange={(v) => {
                          const updated = [...straps];
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
                      {isMissing && (
                        <p className="text-[10px] text-amber-700 leading-tight">sem produto no estoque</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Observation */}
        <div>
          {item.observation !== null && item.observation !== undefined ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-bold text-muted-foreground uppercase">Observação</Label>
                <button
                  type="button"
                  onClick={() => onUpdate(index, 'observation', null)}
                  className="text-[10px] text-muted-foreground hover:text-destructive underline underline-offset-2"
                >
                  remover
                </button>
              </div>
              <div className="relative">
                <textarea
                  value={item.observation || ''}
                  onChange={e => onUpdate(index, 'observation', e.target.value.slice(0, 300))}
                  maxLength={300}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 pr-14 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  placeholder="Observação para esta referência (aparece nos relatórios)..."
                />
                <span className="absolute bottom-1.5 right-2 text-[9px] text-muted-foreground/70 font-mono bg-background/80 px-1 rounded pointer-events-none">
                  {(item.observation || '').length}/300
                </span>
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
          qc.invalidateQueries({ queryKey: ['products'] });
          if (pendingStrapColor) {
            if (pendingStrapIndex === -1) {
              // Sentinela: criação foi pra COR PRINCIPAL do item (não tira).
              // Auto-seleciona a cor recém-criada no item.color e propaga
              // pras tiras (via auto-sync do useEffect que existe).
              onUpdate(index, 'color', pendingStrapColor);
            } else if (pendingStrapIndex !== null) {
              // Auto-set the color on the strap after creation
              const updated = [...(item.strap_colors as any[])];
              if (updated[pendingStrapIndex]) {
                updated[pendingStrapIndex] = { ...updated[pendingStrapIndex], color: pendingStrapColor };
                onUpdate(index, 'strap_colors', updated);
              }
            }
          }
          setPendingStrapIndex(null);
          setPendingStrapColor('');
          setPendingStrapGroupId('');
          setPendingStrapGroupName('');
        }}
      />

      {/* EditColorVariantsDialog removido — variante de cor saiu do escopo. */}
    </div>
  );
}

const SaleOrderItemForm = memo(SaleOrderItemFormInner);
export default SaleOrderItemForm;

function ColorSearchSelect({
  colors, value, onSelect, onAddNew,
}: {
  colors: string[];
  value: string;
  onSelect: (color: string) => void;
  /** Quando definido, mostra "+ Cadastrar 'X' no estoque" se a busca n\u00e3o casar nenhuma cor. */
  onAddNew?: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = colors.filter(c => normalize(c).includes(normalize(search)));
  const trimmedSearch = search.trim();
  const showAdd = !!onAddNew && trimmedSearch && !colors.some(c => normalize(c) === normalize(trimmedSearch));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="flex-1 justify-between h-9 text-xs">
          {value || 'Escolha a cor...'}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] sm:w-[340px] p-0" align="start">
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
            {filtered.length === 0 && !showAdd && (
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
            {showAdd && (
              <button
                onClick={() => {
                  onAddNew!(trimmedSearch);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-xs text-primary font-medium hover:bg-accent rounded-sm flex items-center gap-1.5"
              >
                <Plus className="h-3 w-3" />
                Cadastrar "{trimmedSearch}" no estoque
              </button>
            )}
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
      <PopoverContent className="w-[260px] sm:w-[280px] p-1">
        <Input placeholder="Cor..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 mb-1 text-sm" autoFocus />
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {filtered.map(c => (
            <button key={c} onClick={() => { onChange(c); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded-sm break-words">{c}</button>
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
              className="w-full text-left px-2 py-1.5 text-xs text-primary font-medium hover:bg-accent rounded-sm"
            >
              + Cadastrar "{search}" no estoque
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
