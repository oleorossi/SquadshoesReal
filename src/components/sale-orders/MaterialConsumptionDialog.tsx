import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, Package, FileText, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown, Warning as WarningIcon } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import {
  calculateGradeBasedDm2,
  calculateConsumptionWithUnit,
  isLinearWidthMissing,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
  normalizeText,
} from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderId: string | null;
  orderNumber: string;
};

type ConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
  widthMissing?: boolean;
};

const COMPONENT_ORDER = ['Cabedal', 'Forro', 'Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'] as const;

const classifyBomMaterial = (groupName: string, productName: string, category: string): string => {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
  if (normalized.includes('cabedal') || normalized.includes('napa') || normalized.includes('velvet') || normalized.includes('couro')) return 'Cabedal';
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (normalized.includes('forro')) return 'Forro';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Outros';
};

/** Calculate plate area in dm² from group dimensions (stored in mm by default) */
const calcGroupPlateAreaDm2 = (group: any): number => {
  if (!group?.dimensions_length || !group?.dimensions_width) return 0;
  const unit = (group.dimensions_unit || 'mm').toLowerCase();
  let l = Number(group.dimensions_length);
  let w = Number(group.dimensions_width);
  if (unit === 'cm') { l *= 10; w *= 10; }
  if (unit === 'm') { l *= 1000; w *= 1000; }
  return (l * w) / 10000;
};

const addConsumptionRow = (map: Map<string, ConsumptionRow>, row: ConsumptionRow) => {
  const totalQuantity = Number(row.totalQuantity) || 0;
  const groupName = row.groupName?.trim();
  if (!groupName || totalQuantity <= 0) return;

  const productUnit = row.productUnit?.trim() || 'un';
  const color = row.color?.trim() || '—';
  const materialName = row.materialName?.trim() || groupName;
  const key = `${row.componentType}||${groupName}||${color}||${productUnit}`;
  const existing = map.get(key);

  if (existing) {
    existing.totalQuantity += totalQuantity;
    if (row.widthMissing) existing.widthMissing = true;
    return;
  }

  map.set(key, {
    componentType: row.componentType,
    groupName,
    materialName,
    productUnit,
    color,
    totalQuantity,
    widthMissing: row.widthMissing,
  });
};

export default function MaterialConsumptionDialog({ open, onOpenChange, saleOrderId, orderNumber }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    loadConsumption(() => cancelled);
    return () => { cancelled = true; };
  }, [open, saleOrderId]);

  const loadConsumption = async (isCancelled: () => boolean = () => false) => {
    if (!saleOrderId) return;
    setLoading(true);

    try {
      const { data: items, error: itemsError } = await supabase
        .from('sale_order_items')
        .select(`
          reference_id,
          color,
          quantity,
          grade,
          fichas,
          strap_colors,
          technical_sheets(
            upper_material,
            upper_consumption,
            upper_consumption_per_size,
            lining_material,
            lining_consumption,
            insole_material,
            insole_consumption,
            sole_material,
            sole_consumption,
            sole_color,
            sole_group_id,
            lining_accessories,
            components_accessories
          )
        `)
        .eq('sale_order_id', saleOrderId);

      if (itemsError) throw itemsError;
      if (!items || items.length === 0) {
        setRows([]);
        return;
      }

      const refIds = [...new Set(items.map((item) => item.reference_id).filter(Boolean))];

        const [{ data: materials, error: materialsError }, { data: allProducts }, { data: productGroups }, { data: componentSheets }, { data: sheetStrapData }, { data: soleColorMappings }, { data: palmilhaColorMappings }, { data: liningColorMappings }] = await Promise.all([
        supabase
          .from('sheet_materials')
          .select('sheet_id, product_id, group_id, quantity_per_unit, color, products(name, unit, category), product_groups(name)')
          .in('sheet_id', refIds),
        supabase
          .from('products')
          .select('id, name, color, group_id')
          .eq('active', true),
        supabase
          .from('product_groups')
          .select('id, name, dimensions_length, dimensions_width, dimensions_unit'),
        supabase
          .from('component_sheets')
          .select('product_id, dimensions_width, dimensions_length, dimensions_unit, yield_per_size, yield_per_sole, waste_pct, products!inner(group_id, name, color, unit)'),
        supabase
          .from('technical_sheets')
          .select('id, strap_colors')
          .in('id', refIds),
          (supabase as any).from('technical_sheet_sole_colors').select('sheet_id, product_color, sole_product_id').in('sheet_id', refIds),
          (supabase as any).from('technical_sheet_palmilha_colors').select('sheet_id, cabedal_color, palmilha_color, palmilha_product_id').in('sheet_id', refIds),
          (supabase as any).from('technical_sheet_lining_colors').select('sheet_id, cabedal_color, lining_color').in('sheet_id', refIds),
      ]);

      if (materialsError) throw materialsError;

       // Build sole and palmilha color mapping: (sheet_id, color) -> product_id
      const soleColorMap = new Map<string, string>();
      for (const m of (soleColorMappings || []) as any[]) {
        if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_product_id);
      }
       const palmilhaColorMap = new Map<string, { color: string, productId: string | null }>();
       for (const m of (palmilhaColorMappings || []) as any[]) {
         palmilhaColorMap.set(`${m.sheet_id}::${(m.cabedal_color || '').toLowerCase()}`, { color: m.palmilha_color, productId: m.palmilha_product_id });
       }
       const palmilhaDefaultMap = new Map<string, { color: string, productId: string | null }>();
       for (const m of (palmilhaColorMappings || []) as any[]) {
         if (m.cabedal_color === '__DEFAULT__') palmilhaDefaultMap.set(m.sheet_id, { color: m.palmilha_color, productId: m.palmilha_product_id });
       }

       const liningColorMap = new Map<string, string>();
       for (const m of (liningColorMappings || []) as any[]) {
         liningColorMap.set(`${m.sheet_id}::${(m.cabedal_color || '').toLowerCase()}`, m.lining_color);
       }
       const liningDefaultMap = new Map<string, string>();
       for (const m of (liningColorMappings || []) as any[]) {
         if (m.cabedal_color === '__DEFAULT__') liningDefaultMap.set(m.sheet_id, m.lining_color);
       }

      // Build map of reference_id -> sheet strap_colors
      const sheetStrapsMap = new Map<string, any[]>();
      for (const s of (sheetStrapData || [])) {
        if (Array.isArray(s.strap_colors)) sheetStrapsMap.set(s.id, s.strap_colors as any[]);
      }

      const getComponentSheetsForGroup = (groupName: string) => {
        const normalizedGroup = normalizeText(groupName);
        return (componentSheets || []).filter((cs: any) => {
          const prod = cs.products as any;
          if (!prod?.group_id) return false;
          const group = (productGroups || []).find((g: any) => g.id === prod.group_id);
          return normalizeText(group?.name) === normalizedGroup;
        });
      };

      const getPreferredGroupSheet = (
        groupName: string,
        {
          color,
          mode = 'any',
          preferYield = false,
        }: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
      ) => getPreferredComponentSheetFromCandidates(getComponentSheetsForGroup(groupName), { color, mode, preferYield });

      // Helper: check if a group (by name) contains a product matching the color
      const groupHasColor = (groupName: string, color: string): boolean => {
        if (!groupName || !color || color === '—') return false;
        const normalizedColor = color.toLowerCase().trim();
        const group = (productGroups || []).find((g: any) => g.name === groupName);
        if (!group) return false;

        return (allProducts || []).some((p: any) => {
          if (p.group_id !== group.id) return false;
          const pName = (p.name || '').toLowerCase();
          const pColor = (p.color || '').toLowerCase();

          // Exact match on color field or product name
          if (pColor === normalizedColor || pName === normalizedColor) return true;
          // Extract color after delimiter (e.g. "NAPA SOFT: BEGE" → "bege")
          const afterDelimiter = pName.includes(':') ? pName.split(':').pop()?.trim() : pName.includes('-') ? pName.split('-').pop()?.trim() : '';
          if (afterDelimiter && afterDelimiter === normalizedColor) return true;
          // Fuzzy: only if both strings are long enough to avoid false positives
          if (pColor.length > 3 && normalizedColor.length > 3) {
            if (normalizedColor.includes(pColor) || pColor.includes(normalizedColor)) return true;
          }
          return false;
        });
      };

      // Count products per group for fallback ranking
      const countGroupProducts = (groupName: string): number => {
        const group = (productGroups || []).find((g: any) => g.name === groupName);
        if (!group) return 0;
        return (allProducts || []).filter((p: any) => p.group_id === group.id).length;
      };

      const resolveOption = (
        mainGroup: string, mainConsumption: number,
        alternatives: any[], orderColor: string
      ): { group: string; consumption: number } | null => {
        // Try main first
        if (mainGroup && mainConsumption > 0) {
          if (!orderColor || orderColor === '—' || groupHasColor(mainGroup, orderColor)) {
            return { group: mainGroup, consumption: mainConsumption };
          }
        }
        // Try alternatives
        for (const alt of alternatives) {
          const altGroup = alt.material?.trim();
          const altConsumption = Number(alt.consumption) || 0;
          if (altGroup && altConsumption > 0 && groupHasColor(altGroup, orderColor)) {
            return { group: altGroup, consumption: altConsumption };
          }
        }
        // Fallback: pick the group with the most product variants (most likely to carry the color)
        const candidates = [
          ...(mainGroup && mainConsumption > 0 ? [{ group: mainGroup, consumption: mainConsumption }] : []),
          ...alternatives.filter((a: any) => a.material?.trim() && (Number(a.consumption) || 0) > 0).map((a: any) => ({ group: a.material.trim(), consumption: Number(a.consumption) })),
        ];
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => countGroupProducts(b.group) - countGroupProducts(a.group));
        return candidates[0];
      };

      const consumptionMap = new Map<string, ConsumptionRow>();

      for (const item of items) {
        const orderColor = item.color || '—';
        const itemQuantity = Number(item.quantity) || 0;
        const sheet = item.technical_sheets as any;

        // Cabedal: resolve which option matches the order color
        const allCabedalAccessories = Array.isArray(sheet?.components_accessories)
          ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
          : [];
        const upperAlts = allCabedalAccessories.filter((e: any) => !e.mandatory);
        const mandatoryCabedalMaterials = allCabedalAccessories.filter((e: any) => e.mandatory === true);
        const upperMatch = resolveOption(
          sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0,
          upperAlts, orderColor
        );
        if (upperMatch) {
          const upperSheet = getPreferredGroupSheet(upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
          const isPrincipal = upperMatch.group === (sheet?.upper_material || '');
          const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
          const overridePerSize = isPrincipal
            ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
            : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
          const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize);
          addConsumptionRow(consumptionMap, {
            componentType: 'Cabedal',
            groupName: upperMatch.group,
            materialName: 'Cabedal',
            productUnit: 'metro',
            color: orderColor,
            totalQuantity: upperTotal,
            widthMissing: isLinearWidthMissing(upperSheet, 'm'),
          });
        }

        // Materiais mandatórios do cabedal — sempre consumidos, independente da cor
        for (const mandMat of mandatoryCabedalMaterials) {
          const mandConsumption = Number(mandMat.consumption) || 0;
          if (!mandMat.material || mandConsumption <= 0) continue;
          const mandSheet = getPreferredGroupSheet(mandMat.material, { color: orderColor, mode: 'linear', preferYield: true });
          const mandOverride = (mandMat.consumption_per_size && Object.keys(mandMat.consumption_per_size).length > 0)
            ? mandMat.consumption_per_size
            : null;
          const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride);
          addConsumptionRow(consumptionMap, {
            componentType: 'Cabedal',
            groupName: mandMat.material,
            materialName: 'Material Fixo',
            productUnit: 'metro',
            color: orderColor,
            totalQuantity: mandTotal,
            widthMissing: isLinearWidthMissing(mandSheet, 'm'),
          });
        }

        // Forro: resolve which option matches the order color
        const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
        const liningMatch = resolveOption(
          sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0,
          liningAlts, orderColor
        );
         if (liningMatch) {
           const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || liningDefaultMap.get(item.reference_id) || orderColor;
           const liningSheet = getPreferredGroupSheet(liningMatch.group, { color: mappedLiningColor, mode: 'linear', preferYield: true });
           const soleProductId = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
           const { total: liningTotal } = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', undefined, soleProductId, sheet?.sole_drives_consumption);
           addConsumptionRow(consumptionMap, {
             componentType: 'Forro',
             groupName: liningMatch.group,
             materialName: 'Forração',
             productUnit: 'metro',
             color: mappedLiningColor,
             totalQuantity: liningTotal,
             widthMissing: isLinearWidthMissing(liningSheet, 'm'),
           });
         }

         // Palmilha
         const palmMapping = palmilhaColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || palmilhaDefaultMap.get(item.reference_id);
         const insoleGroupName = sheet?.insole_material || '';
         const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
         const palmColor = palmMapping?.color || '—';
         const palmProductId = palmMapping?.productId;

         // If it's a specific product mapping (unit-based)
         if (palmProductId) {
           const prod = (allProducts || []).find(p => p.id === palmProductId);
           addConsumptionRow(consumptionMap, {
             componentType: 'Palmilha',
             groupName: insoleGroupName,
             materialName: prod?.name || 'Palmilha',
             productUnit: 'par',
             color: prod?.color || palmColor,
             totalQuantity: itemQuantity,
           });
         } else {
           // Legacy/Material-based Palmilha (converted to plates)
           const soleProductIdForInsole = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
           const insoleSheet = getPreferredGroupSheet(insoleGroupName, { mode: 'plate', preferYield: true });
           const insoleDm2 = calculateGradeBasedDm2(item, Number(sheet?.insole_consumption) || 0, insoleSheet, undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
           const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
           const insolePlates = groupPlateArea > 0 ? (insoleDm2 / groupPlateArea) : convertDm2ToPlates(insoleDm2, insoleSheet);
           
           addConsumptionRow(consumptionMap, {
             componentType: 'Palmilha',
             groupName: insoleGroupName,
             materialName: 'Palmilha',
             productUnit: 'placa',
             color: palmColor,
             totalQuantity: insolePlates,
           });
         }

        // Solado: resolver cor real via technical_sheet_sole_colors (mapeamento
        // por cor do cabedal → produto-solado específico). Match case/acento-
        // insensitive — antes "Caramelo" vs "CARAMELO" não casava e a cor
        // saía "—" mesmo com mapeamento cadastrado.
        const orderColorNorm = (orderColor || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        let soleProductIdResolved: string | null = null;
        for (const [k, v] of soleColorMap.entries()) {
          const [skId, skColor] = k.split('::');
          if (skId !== item.reference_id) continue;
          const kNorm = (skColor || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
          if (kNorm === orderColorNorm) { soleProductIdResolved = v; break; }
        }
        const soleProduct = soleProductIdResolved
          ? (allProducts || []).find(p => p.id === soleProductIdResolved)
          : null;
        const soleColor = soleProduct?.color || orderColor || sheet?.sole_color || '—';

        // Resumo de numerações pra coluna Aplicação. Quando OP tem grade,
        // mostra "34: 1 · 35: 2 · ..." ou "34-40 (12)" se uniforme. Sem grade,
        // fica "Solado" cru. Pedido em 18/05/2026 pelo user — quer ver
        // numeração + cor no resumo de consumo do PV.
        const grade = (item as any).grade as Record<string, number> | null | undefined;
        const sizesSummary = (() => {
          if (!grade || typeof grade !== 'object') return 'Solado';
          const entries = Object.entries(grade)
            .filter(([k, v]) => /^\d+$/.test(k) && Number(v) > 0)
            .sort(([a], [b]) => Number(a) - Number(b));
          if (entries.length === 0) return 'Solado';
          const values = entries.map(([, v]) => Number(v));
          const allEqual = values.every(v => v === values[0]);
          if (allEqual && entries.length > 1) {
            return `Nº ${entries[0][0]}–${entries[entries.length-1][0]} (${values[0]} pares cada)`;
          }
          return entries.map(([s, v]) => `Nº ${s}: ${v}`).join(' · ');
        })();

        addConsumptionRow(consumptionMap, {
          componentType: 'Solado',
          groupName: soleProduct?.name || sheet?.sole_material || '',
          materialName: sizesSummary,
          productUnit: 'par',
          color: soleColor,
          totalQuantity: (Number(sheet?.sole_consumption) || 0) * itemQuantity,
        });

        const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
        const sheetStraps: any[] = sheetStrapsMap.get(item.reference_id) || [];
        const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
        for (const strap of resolvedStraps) {
          const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
            grade: (item as any).grade || {},
            quantity: itemQuantity,
            fichas: (item as any).fichas,
          });

          addConsumptionRow(consumptionMap, {
            componentType: 'Tiras',
            groupName: strap.group_name || strap.label || 'Tira',
            materialName: strap.label || strap.group_name || 'Tira',
            productUnit: 'metro',
            color: strap.color || orderColor,
            totalQuantity: strapConsumptionCm / 100,
          });
        }

        const specGroupsWithConsumption = new Map<string, number>();
        if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
        if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
        if (sheet?.insole_material && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
        if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

        const itemMaterials = (materials || []).filter((material) => material.sheet_id === item.reference_id);
        for (const material of itemMaterials) {
          const product = material.products as any;
          const group = material.product_groups as any;
          if (!product) continue;

          const groupName = group?.name || product.category || product.name || 'Outros';
          const groupKey = groupName.toLowerCase();
          const specHasGroup = specGroupsWithConsumption.has(groupKey);
          if (specHasGroup) {
            const bomType = classifyBomMaterial(groupName, product.name || '', product.category || '');
            const isUpperGroup = upperMatch?.group?.toLowerCase() === groupKey;
            const isLiningGroup = liningMatch?.group?.toLowerCase() === groupKey;
            const isInsoleGroup = sheet?.insole_material?.toLowerCase() === groupKey;
            const isSoleGroup = sheet?.sole_material?.toLowerCase() === groupKey;
            const shouldSkip = (isUpperGroup && bomType === 'Cabedal') ||
                               (isLiningGroup && bomType === 'Forro') ||
                               (isInsoleGroup && (bomType === 'Palmilha' || product.category?.toLowerCase().includes('palmilha'))) ||
                               (isSoleGroup && bomType === 'Solado');
            if (shouldSkip) continue;
          }

          let productUnit = product.unit || 'un';
          let totalQty = (Number(material.quantity_per_unit) || 0) * itemQuantity;

          if (productUnit === 'cm') {
            totalQty = totalQty / 100;
            productUnit = 'metro';
          }

          addConsumptionRow(consumptionMap, {
            componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
            groupName,
            materialName: product.name || groupName,
            productUnit,
            color: material.color || '—',
            totalQuantity: totalQty,
          });
        }
      }

      const sortedRows = Array.from(consumptionMap.values()).sort((a, b) => {
        const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number]) - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
        if (typeDiff !== 0) return typeDiff;
        const groupDiff = a.groupName.localeCompare(b.groupName, 'pt-BR');
        if (groupDiff !== 0) return groupDiff;
        const materialDiff = a.materialName.localeCompare(b.materialName, 'pt-BR');
        if (materialDiff !== 0) return materialDiff;
        return a.color.localeCompare(b.color, 'pt-BR');
      });

      if (isCancelled()) return;
      setRows(sortedRows);
    } catch (err) {
      if (isCancelled()) return;
      console.error('Erro ao carregar consumo:', err);
      setRows([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  type SortKey = 'componentType' | 'groupName' | 'materialName' | 'color' | 'totalQuantity' | 'productUnit';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'totalQuantity') return (a.totalQuantity - b.totalQuantity) * dir;
      const aVal = (a[sortKey] || '').toLowerCase();
      const bVal = (b[sortKey] || '').toLowerCase();
      return aVal.localeCompare(bVal, 'pt-BR') * dir;
    });
  }, [rows, sortKey, sortDir]);

  const grouped = useMemo(() => {
    if (sortKey && sortKey !== 'componentType') {
      return new Map([['Todos', sortedRows]]);
    }
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of sortedRows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [sortedRows, sortKey]);

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    }
    return map;
  }, [rows]);

  const formatUnit = (unit: string) => {
    const labels: Record<string, string> = {
      metro: 'm',
      m: 'm',
      'm²': 'm²',
      dm2: 'dm²',
      par: 'par',
      un: 'un',
      kg: 'kg',
      litro: 'L',
      placa: 'placa(s)',
    };
    return labels[unit] || unit || 'un';
  };

  const handlePrintPdf = useCallback(() => {
    // Cores de cabeçalho por componentType (visual hierarchy)
    const componentColors: Record<string, { bg: string; border: string; text: string }> = {
      'Cabedal':    { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
      'Forro':      { bg: '#cffafe', border: '#06b6d4', text: '#155e75' },
      'Palmilha':   { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' },
      'Solado':     { bg: '#dcfce7', border: '#22c55e', text: '#14532d' },
      'Tiras':      { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
      'Químicos':   { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' },
      'Embalagem':  { bg: '#e0e7ff', border: '#6366f1', text: '#312e81' },
      'Outros':     { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' },
    };

    // Agrupa por componentType pra cards
    const cards: string[] = [];
    for (const [componentType, componentRows] of grouped.entries()) {
      if (componentType === 'Todos') continue;
      const colors = componentColors[componentType] || componentColors['Outros'];
      // Calcula total do componente (agrupa por unidade)
      const totalsThisComp = new Map<string, number>();
      for (const r of componentRows) {
        totalsThisComp.set(r.productUnit, (totalsThisComp.get(r.productUnit) || 0) + r.totalQuantity);
      }
      const totalSummary = Array.from(totalsThisComp.entries())
        .map(([u, v]) => `${v.toFixed(1)} ${formatUnit(u)}`)
        .join(' · ');

      const rowsHtml = componentRows.map(row => `
        <tr>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb">
            <div style="font-weight:600;font-size:10pt">${row.materialName}</div>
            <div style="color:#6b7280;font-size:8.5pt">${row.groupName}${row.color && row.color !== '—' ? ` · ${row.color}` : ''}</div>
          </td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700;font-size:10pt">
            ${row.totalQuantity.toFixed(2)} <span style="color:#6b7280;font-weight:400;font-size:8.5pt">${formatUnit(row.productUnit)}</span>
          </td>
        </tr>
      `).join('');

      cards.push(`
        <div class="card" style="border:2px solid ${colors.border};border-radius:6px;overflow:hidden;break-inside:avoid;margin-bottom:6px">
          <div style="background:${colors.bg};color:${colors.text};padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center">
            <span>▌${componentType}</span>
            <span style="font-size:8.5pt;font-weight:600;opacity:.8">${totalSummary}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;background:white">
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `);
    }

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#1f2937;color:white;padding:3px 10px;border-radius:4px;margin-right:6px;font-size:9.5pt;font-weight:600">
        ${total.toFixed(1)} ${formatUnit(unit)}
      </span>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consumo de Materiais — ${orderNumber}</title>
      <style>
        @page { size: A4 portrait; margin: 6mm 6mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #111; margin: 0; padding: 0; font-size: 10pt; line-height: 1.3; }
        h1 { font-size: 14pt; margin: 0 0 2px; }
        .sub { color: #6b7280; font-size: 9pt; margin: 0 0 8px; }
        .totals-strip { margin-bottom: 10px; padding: 6px 0; border-top: 2px solid #1f2937; border-bottom: 2px solid #1f2937; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media print {
          .card { break-inside: avoid; }
        }
      </style></head>
      <body>
        <h1>Consumo de Materiais — ${orderNumber}</h1>
        <p class="sub">${rows.length} item${rows.length !== 1 ? 'ns' : ''} · ${grouped.size} componente${grouped.size !== 1 ? 's' : ''} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div class="totals-strip">${totalsHtml}</div>
        <div class="grid">${cards.join('')}</div>
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [grouped, totalsByUnit, orderNumber, rows.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Consumo de Materiais — {orderNumber}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum consumo de material encontrado para este pedido.</p>
        ) : (
          <div className="space-y-4">
            {rows.some(r => r.widthMissing) && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
                <WarningIcon weight="fill" className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-900 dark:text-amber-300">Atenção — consumo pode estar inflado</p>
                  <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
                    Materiais marcados com <WarningIcon weight="fill" className="h-3 w-3 inline text-amber-600" /> não têm <strong>largura cadastrada</strong> na Ficha de Componente.
                    Sem isso, o sistema trata dm² como metro, fazendo o consumo aparecer ~100× maior que o real.
                    Cadastre em <strong>Materiais → produto → Ficha de Componente → Dimensões</strong> pra corrigir.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
                  <Badge key={unit} variant="secondary" className="text-sm px-3 py-1">
                    {total.toFixed(2)} {formatUnit(unit)}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-sm px-3 py-1">
                  {rows.length} item(ns)
                </Badge>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintPdf}>
                <FileText className="h-4 w-4" /> Gerar PDF
              </Button>
            </div>

            {Array.from(grouped.entries()).map(([componentType, componentRows]) => (
              <div key={componentType} className="space-y-1">
                {componentType !== 'Todos' && (
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{componentType}</h3>
                )}
                 <div className="rounded-lg border overflow-hidden overflow-x-auto">
                   <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('groupName')}>
                          <span className="flex items-center">Grupo de material <SortIcon col="groupName" /></span>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('materialName')}>
                          <span className="flex items-center">Aplicação <SortIcon col="materialName" /></span>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('color')}>
                          <span className="flex items-center">Cor <SortIcon col="color" /></span>
                        </TableHead>
                        <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('totalQuantity')}>
                          <span className="flex items-center justify-end">Consumo Total <SortIcon col="totalQuantity" /></span>
                        </TableHead>
                        <TableHead className="text-center w-24 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('productUnit')}>
                          <span className="flex items-center justify-center">Unidade <SortIcon col="productUnit" /></span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentRows.map((row, index) => (
                        <TableRow key={`${row.componentType}-${row.groupName}-${row.materialName}-${row.color}-${index}`} className={row.widthMissing ? 'bg-amber-500/5' : ''}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {row.widthMissing && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <WarningIcon weight="fill" className="h-4 w-4 text-amber-600 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="text-xs">
                                        Largura do material não cadastrada em <strong>Materiais → Ficha de Componente</strong>.
                                        Consumo pode estar até <strong>100× inflado</strong>. Cadastre <code>dimensions_width</code> pra corrigir.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {row.groupName}
                            </div>
                          </TableCell>
                          <TableCell>{row.materialName}</TableCell>
                          <TableCell>{row.color}</TableCell>
                          <TableCell className="text-right font-mono font-bold">{row.totalQuantity.toFixed(2)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs">{formatUnit(row.productUnit)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
