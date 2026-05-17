 import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Badge } from "@/components/ui/badge";
 import { Button } from "@/components/ui/button";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 import { CircleNotch as Loader2, FileText, CaretRight as ChevronRight, CaretDown as ChevronDown, Funnel as Filter, X } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import {
   calculateGradeBasedDm2,
   calculateConsumptionWithUnit,
   convertDm2ToLinearMeters,
   convertDm2ToPlates,
   getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
   normalizeText,
   calcRequiredForGrade,
 } from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';

type ConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
};

type SoleByType = Record<string, Record<string, number>>; // soleColor -> size -> total pairs



const classifyBomMaterial = (groupName: string, productName: string, category: string): string => {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
   if (normalized.includes('tira') || normalized.includes('trança')) return 'Tiras';
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
  // Chave normalizada (case/acento-insensitive) para evitar duplicação por
  // diferenças tipográficas como "SOLADO INFANTIL" vs "Solado Infantil".
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const key = `${norm(groupName)}||${norm(color)}||${norm(productUnit)}`;
  const existing = map.get(key);

  if (existing) {
    existing.totalQuantity += totalQuantity;
    return;
  }

  map.set(key, { componentType: row.componentType, groupName, materialName, productUnit, color, totalQuantity });
};

const formatUnit = (unit: string) => {
  const labels: Record<string, string> = { metro: 'm', m: 'm', dm2: 'dm²', par: 'par', un: 'un', kg: 'kg', litro: 'L', placa: 'placas' };
  return labels[unit] || unit || 'un';
};

type OrderHeader = { order_number: string; client_order_number: string | null };

type Props = { saleOrderIds: string[] };

export default function SummaryConsumptionPanel({ saleOrderIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [soleSizeBreakdown, setSoleSizeBreakdown] = useState<SoleByType>({});
  const [orderHeaders, setOrderHeaders] = useState<OrderHeader[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  useEffect(() => {
    if (saleOrderIds.length === 0) return;
    loadAll();
  }, [saleOrderIds]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: items, error: itemsError }, { data: saleOrders }] = await Promise.all([
        supabase
          .from('sale_order_items')
          .select(`
            reference_id, color, quantity, grade, fichas, strap_colors,
            technical_sheets(upper_material, upper_consumption, upper_consumption_per_size, lining_material, lining_consumption, insole_material, insole_consumption, sole_material, sole_consumption, sole_color, lining_accessories, components_accessories, lining_consumption_per_size, insole_consumption_per_size)
          `)
          .in('sale_order_id', saleOrderIds),
        supabase
          .from('sale_orders')
          .select('order_number, client_order_number')
          .in('id', saleOrderIds),
      ]);

      if (itemsError) throw itemsError;
      setOrderHeaders((saleOrders || []).map(so => ({ order_number: so.order_number, client_order_number: so.client_order_number })));
      if (!items || items.length === 0) { setRows([]); return; }

      const refIds = [...new Set(items.map(i => i.reference_id).filter(Boolean))];

      const [{ data: materials }, { data: allProducts }, { data: productGroups }, { data: componentSheets }, { data: sheetStrapData }, { data: soleColorMappings }] = await Promise.all([
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
        (supabase as any)
          .from('technical_sheet_sole_colors')
          .select('sheet_id, product_color, sole_product_id')
          .in('sheet_id', refIds),
      ]);

      // Build sole color mapping: (sheet_id, color) -> sole_product_id
      const soleColorMap = new Map<string, string>();
      for (const m of (soleColorMappings || []) as any[]) {
        if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_product_id);
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

      // Helper: resolve which option (main or alternatives) matches the color
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
        if (mainGroup && mainConsumption > 0) {
          if (!orderColor || orderColor === '—' || groupHasColor(mainGroup, orderColor)) {
            return { group: mainGroup, consumption: mainConsumption };
          }
        }
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
      const soleSizeMap: SoleByType = {};
      for (const item of items) {
        const orderColor = item.color || '—';
        const rawQty = Number(item.quantity) || 0;
        const sheet = item.technical_sheets as any;

        // Grade é a autoridade absoluta para total de pares
        const grade = (item as any).grade as Record<string, number> | null;
        const gradeEntries = grade && typeof grade === 'object'
          ? Object.entries(grade).filter(([, v]) => Number(v) > 0)
          : [];
        const gradePairsPerFicha = gradeEntries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
        const fichas = Number((item as any).fichas) || (gradePairsPerFicha > 0 && rawQty > 0 ? rawQty / gradePairsPerFicha : 1);
        const qty = gradePairsPerFicha > 0 ? gradePairsPerFicha * fichas : rawQty;

        // Item normalizado com qty e fichas consistentes baseados na grade
        const gradeItem = { ...item, quantity: qty, fichas };

        // Cabedal: resolve matching option
        const upperAlts = Array.isArray(sheet?.components_accessories)
          ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
          : [];
        const upperMatch = resolveOption(sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0, upperAlts, orderColor);
        if (upperMatch) {
          const upperSheet = getPreferredGroupSheet(upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
          const { total: upperTotal } = calculateConsumptionWithUnit(gradeItem, upperMatch.consumption, upperSheet, 'metro', undefined, undefined, sheet?.sole_drives_consumption);
          addConsumptionRow(consumptionMap, { componentType: 'Cabedal', groupName: upperMatch.group, materialName: 'Cabedal', productUnit: 'metro', color: orderColor, totalQuantity: upperTotal });
        }

        // Forro: resolve matching option — use simple dm²/par × qty, then convert to meters
        const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
        const liningMatch = resolveOption(sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0, liningAlts, orderColor);
        if (liningMatch) {
          const liningSheet = getPreferredGroupSheet(liningMatch.group, { color: orderColor, mode: 'linear' });
          const soleProductId = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
          const { total: liningTotal } = calculateConsumptionWithUnit(
            gradeItem, 
            liningMatch.consumption, 
            liningSheet, 
            'metro', 
            sheet?.lining_consumption_per_size,
            soleProductId,
            sheet?.sole_drives_consumption
          );
          addConsumptionRow(consumptionMap, { componentType: 'Forro', groupName: liningMatch.group, materialName: 'Forração', productUnit: 'metro', color: orderColor, totalQuantity: liningTotal });
        }

        // Palmilha: converte consumo dm²/par em placas usando dimensões do GRUPO (consistente com Ficha Técnica)
        const soleProductIdForInsole = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
        const insoleGroupName = sheet?.insole_material || '';
        const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
        const insoleSheet = getPreferredGroupSheet(insoleGroupName, { mode: 'plate', preferYield: true });
        const insoleDm2 = calculateGradeBasedDm2(
          gradeItem, 
          Number(sheet?.insole_consumption) || 0, 
          insoleSheet, 
          sheet?.insole_consumption_per_size,
          soleProductIdForInsole,
          sheet?.sole_drives_consumption
        );
        // Use group plate area (same source as YieldFromPlate in tech sheets)
        const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
        const insolePlates = groupPlateArea > 0
          ? (insoleDm2 / groupPlateArea)
          : convertDm2ToPlates(insoleDm2, insoleSheet);
        addConsumptionRow(consumptionMap, { componentType: 'Palmilha', groupName: insoleGroupName, materialName: 'Palmilha', productUnit: 'placa', color: '—', totalQuantity: insolePlates });

        // Solado: use explicit material from technical sheet if available
        const soleGroupName = sheet?.sole_material || '';
        if (soleGroupName) {
          const soleColor = (() => {
            const c = (orderColor || '').toLowerCase();
            if (c.includes('preto') || c.includes('black') || c.includes('pb')) return 'Preto';
            return 'Caramelo';
          })();
          
          // Rule: 1 pair of soling per pair produced. 
          // We use the consumption defined in the sheet if it's > 0, otherwise fallback to 1.
          const rawSoleCons = Number(sheet?.sole_consumption) || 0;
          const soleConsPerPair = rawSoleCons > 0 ? rawSoleCons : 1;
          
          addConsumptionRow(consumptionMap, { 
            componentType: 'Solado', 
            groupName: soleGroupName, 
            materialName: 'Solado', 
            productUnit: 'par', 
            color: soleColor, 
            totalQuantity: soleConsPerPair * qty 
          });

          // Accumulate sole breakdown by size
          if (gradeEntries.length > 0) {
            if (!soleSizeMap[soleColor]) soleSizeMap[soleColor] = {};
            for (const [size, pairsPerFicha] of gradeEntries) {
              const totalPairsForSize = (Number(pairsPerFicha) || 0) * fichas;
              soleSizeMap[soleColor][size] = (soleSizeMap[soleColor][size] || 0) + totalPairsForSize * soleConsPerPair;
            }
          } else if (rawQty > 0) {
            if (!soleSizeMap[soleColor]) soleSizeMap[soleColor] = {};
            soleSizeMap[soleColor]['—'] = (soleSizeMap[soleColor]['—'] || 0) + soleConsPerPair * rawQty;
          }
        }

        const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
        const sheetStraps: any[] = sheetStrapsMap.get(item.reference_id) || [];
        const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
        for (const strap of resolvedStraps) {
          const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
            grade: grade || {},
            quantity: qty,
            fichas,
          });

          addConsumptionRow(consumptionMap, {
            componentType: 'Tiras',
            groupName: strap.group_name || strap.label || 'Tira',
            materialName: strap.group_name || strap.label || 'Tira',
            productUnit: 'metro',
            color: strap.color || orderColor,
            totalQuantity: strapConsumptionCm / 100,
          });
        }

        // BOM entries: only exclude if the spec field for that group had consumption > 0
        const specGroupsWithConsumption = new Map<string, number>();
        if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
        if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
        if (sheet?.insole_material && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
        if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

        const itemMaterials = (materials || []).filter(m => m.sheet_id === item.reference_id);
        for (const material of itemMaterials) {
          const product = material.products as any;
          const group = material.product_groups as any;
          if (!product) continue;
          const groupName = group?.name || product.category || product.name || 'Outros';
          // Only skip BOM entry if the spec already accounts for consumption of this group
          // AND the BOM entry's category matches the spec type (to avoid excluding cabedal BOM when only lining spec exists)
          const groupKey = groupName.toLowerCase();
          const specHasGroup = specGroupsWithConsumption.has(groupKey);
          if (specHasGroup) {
            // Check if BOM category matches a spec type that uses this group
            const bomType = classifyBomMaterial(groupName, product.name || '', product.category || '');
            const isUpperGroup = upperMatch?.group?.toLowerCase() === groupKey;
            const isLiningGroup = liningMatch?.group?.toLowerCase() === groupKey;
            const isInsoleGroup = sheet?.insole_material?.toLowerCase() === groupKey;
            const isSoleGroup = sheet?.sole_material?.toLowerCase() === groupKey;
            // Skip only if the BOM classification matches the spec that uses this group
            const shouldSkip = (isUpperGroup && bomType === 'Cabedal') ||
                               (isLiningGroup && bomType === 'Forro') ||
                               (isInsoleGroup && bomType === 'Palmilha') ||
                               (isSoleGroup && bomType === 'Solado') ||
                               // Also skip if classified as same component type (generic match)
                               (isInsoleGroup && (bomType === 'Palmilha' || product.category?.toLowerCase().includes('palmilha')));
            if (shouldSkip) continue;
          }
          let productUnit = product.unit || 'un';
          let totalQty = (Number(material.quantity_per_unit) || 0) * qty;
          if (productUnit === 'cm') { totalQty /= 100; productUnit = 'metro'; }
          addConsumptionRow(consumptionMap, { componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''), groupName, materialName: product.name || groupName, productUnit, color: material.color || '—', totalQuantity: totalQty });
        }
      }

      const categoryOrder = ['Cabedal', 'Forro', 'Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'];
      const sortedRows = Array.from(consumptionMap.values()).sort((a, b) => {
        const catA = categoryOrder.indexOf(a.componentType);
        const catB = categoryOrder.indexOf(b.componentType);
        const catCmp = (catA === -1 ? 99 : catA) - (catB === -1 ? 99 : catB);
        if (catCmp !== 0) return catCmp;
        return a.groupName.localeCompare(b.groupName, 'pt-BR') || a.materialName.localeCompare(b.materialName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR');
      });

      setRows(sortedRows);
      setSoleSizeBreakdown(soleSizeMap);
    } catch (err) {
      console.error('Erro ao carregar consumo consolidado:', err);
      setRows([]);
      setSoleSizeBreakdown({});
    } finally {
      setLoading(false);
    }
  };


  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    }
    return map;
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of rows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [rows]);

  const handlePrintConsumption = useCallback(() => {
    const sectionOrder = ['Cabedal', 'Forro', 'Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'];
    let sectionsHtml = '';
    for (const section of sectionOrder) {
      const sectionRows = grouped.get(section);
      if (!sectionRows || sectionRows.length === 0) continue;
      const rowsHtml = sectionRows.map(row =>
        `<tr>
          <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.groupName)}</td>
          <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.color)}</td>
          <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700">${row.totalQuantity.toFixed(2)}</td>
          <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${formatUnit(row.productUnit)}</td>
        </tr>`
      ).join('');
      sectionsHtml += `
        <h3 style="font-size:14px;margin:16px 0 6px;padding:4px 8px;background:#f0f0f0;border-radius:4px">${section}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px">
          <thead><tr>
            <th style="background:#f9fafb;padding:6px 10px;text-align:left;border-bottom:2px solid #d1d5db;font-size:11px;font-weight:600;text-transform:uppercase">Material</th>
            <th style="background:#f9fafb;padding:6px 10px;text-align:left;border-bottom:2px solid #d1d5db;font-size:11px;font-weight:600;text-transform:uppercase">Cor</th>
            <th style="background:#f9fafb;padding:6px 10px;text-align:right;border-bottom:2px solid #d1d5db;font-size:11px;font-weight:600;text-transform:uppercase">Consumo</th>
            <th style="background:#f9fafb;padding:6px 10px;text-align:center;border-bottom:2px solid #d1d5db;font-size:11px;font-weight:600;text-transform:uppercase">Un.</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;

      // Add sole size breakdown grid for Solado section
      if (section === 'Solado' && Object.keys(soleSizeBreakdown).length > 0) {
        const sortedSoleTypes = Object.entries(soleSizeBreakdown).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
        for (const [soleType, sizes] of sortedSoleTypes) {
          const totalPairs = Object.values(sizes).reduce((s, v) => s + Math.round(v), 0);
          const sortedSizes = Object.entries(sizes).sort(([a], [b]) => {
            const na = Number(a), nb = Number(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
          });
          const sizeCells = sortedSizes.map(([size, total]) =>
            `<td style="text-align:center;padding:4px 6px;border:1px solid #d1d5db">
              <div style="font-size:10px;color:#6b7280">Nº ${size}</div>
              <div style="font-size:13px;font-family:monospace;font-weight:700">${Math.round(total)}</div>
            </td>`
          ).join('');
          sectionsHtml += `
            <div style="margin:8px 0 12px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden">
              <div style="background:#f3f4f6;padding:4px 10px;font-size:12px;font-weight:600;text-transform:uppercase;display:flex;align-items:center;gap:8px">
                Solado ${soleType}
                <span style="font-size:11px;font-weight:400;color:#6b7280">${totalPairs} ${totalPairs === 1 ? 'par' : 'pares'}</span>
              </div>
              <table style="width:auto;border-collapse:collapse;margin:6px 10px 8px"><tr>${sizeCells}</tr></table>
            </div>`;
        }
      }
    }

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#f3f4f6;padding:4px 12px;border-radius:6px;margin-right:8px;font-size:13px;font-weight:600">${total.toFixed(2)} ${formatUnit(unit)}</span>`
    ).join('');

    const orderHeaderHtml = orderHeaders.length > 0
      ? orderHeaders.map(oh => `<div style="font-size:13px;margin-bottom:2px"><strong>Pedido:</strong> ${escapeHtml(oh.order_number)}${oh.client_order_number ? ` &nbsp;|&nbsp; <strong>Pedido Cliente:</strong> ${escapeHtml(oh.client_order_number)}` : ''}</div>`).join('')
      : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consumo de Materiais</title>
      <style>@page{size:A4;margin:5mm 6mm}body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:0;padding:5mm 6mm}
      h1{font-size:18px;margin:0 0 4px}p.sub{color:#6b7280;font-size:13px;margin:0 0 16px}</style></head>
      <body>
        <h1>Resumo de Consumo de Materiais</h1>
        ${orderHeaderHtml}
        <p class="sub">${rows.length} ${rows.length === 1 ? 'item' : 'itens'} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div style="margin-bottom:16px">${totalsHtml}</div>
        ${sectionsHtml}
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [rows, totalsByUnit, grouped, orderHeaders, soleSizeBreakdown]);

  const uniqueGroups = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.groupName))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  const uniqueColors = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.color))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  const filteredGroupedByGroupAndColor = useMemo(() => {
    const map = new Map<string, Map<string, ConsumptionRow[]>>();
    for (const row of rows) {
      if (groupFilter !== "all" && row.groupName !== groupFilter) continue;
      if (colorFilter !== "all" && row.color !== colorFilter) continue;

      if (!map.has(row.groupName)) map.set(row.groupName, new Map());
      const groupMap = map.get(row.groupName)!;
      if (!groupMap.has(row.color)) groupMap.set(row.color, []);
      groupMap.get(row.color)!.push(row);
    }
    return map;
  }, [rows, groupFilter, colorFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-center text-muted-foreground py-8">Nenhum consumo de material encontrado.</p>;
  }
 
   return (
     <div className="space-y-4">
      {orderHeaders.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
          {orderHeaders.map((oh, i) => (
            <div key={i} className="flex flex-wrap gap-4 text-sm">
              <span><span className="font-semibold text-foreground">Pedido:</span> {oh.order_number}</span>
              {oh.client_order_number && (
                <span><span className="font-semibold text-foreground">Pedido Cliente:</span> {oh.client_order_number}</span>
              )}
            </div>
          ))}
        </div>
      )}

       <Tabs defaultValue="summary" className="w-full">
         <div className="flex items-center justify-between mb-2">
           <TabsList>
             <TabsTrigger value="summary">Consolidado</TabsTrigger>
             <TabsTrigger value="segmented">Segmentado</TabsTrigger>
           </TabsList>
           
           <div className="flex items-center gap-4">
             <div className="flex flex-wrap gap-2">
               {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
                 <Badge key={unit} variant="secondary" className="text-sm px-3 py-1">
                   {total.toFixed(2)} {formatUnit(unit)}
                 </Badge>
               ))}
               <Badge variant="outline" className="text-sm px-3 py-1">{rows.length} {rows.length === 1 ? 'item' : 'itens'}</Badge>
             </div>
             <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handlePrintConsumption()}>
               <FileText className="h-4 w-4" /> RELATÓRIO PDF
             </Button>
           </div>
         </div>
 
         <TabsContent value="summary" className="space-y-4 mt-4">
           {Array.from(grouped.entries()).map(([section, sectionRows]) => (
             <div key={section} className="space-y-1">
               <h3 className="text-sm font-semibold text-foreground bg-muted/60 px-3 py-1.5 rounded-md">{section}</h3>
               <div className="rounded-lg border overflow-hidden">
                 <Table>
                   <TableHeader>
                     <TableRow className="bg-muted/30">
                       <TableHead>Material</TableHead>
                       <TableHead>Cor</TableHead>
                       <TableHead className="text-right">Consumo Total</TableHead>
                       <TableHead className="text-center w-24">Unidade</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {sectionRows.map((row, index) => (
                       <TableRow key={`${row.groupName}-${row.color}-${index}`}>
                         <TableCell className="font-medium">{row.groupName}</TableCell>
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
 
               {section === 'Solado' && Object.keys(soleSizeBreakdown).length > 0 && (
                 <div className="mt-2 space-y-2">
                   {Object.entries(soleSizeBreakdown)
                     .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                     .map(([soleType, sizes]) => (
                       <div key={soleType} className="rounded-lg border overflow-hidden">
                         <div className="bg-muted/30 px-3 py-1.5 flex items-center gap-2">
                           <span className="text-xs font-semibold text-muted-foreground uppercase">Solado {soleType}</span>
                           <Badge variant="outline" className="text-[10px]">
                             {(() => { const total = Object.values(sizes).reduce((s, v) => s + Math.round(v), 0); return `${total} ${total === 1 ? 'par' : 'pares'}`; })()}
                           </Badge>
                         </div>
                         <div className="flex flex-wrap gap-2 p-3">
                           {Object.entries(sizes)
                             .sort(([a], [b]) => {
                               const na = Number(a), nb = Number(b);
                               if (!isNaN(na) && !isNaN(nb)) return na - nb;
                               return a.localeCompare(b);
                             })
                             .map(([size, total]) => (
                               <div key={size} className="flex flex-col items-center bg-muted/40 rounded-md px-3 py-1.5 min-w-[56px]">
                                 <span className="text-xs text-muted-foreground font-medium">Nº {size}</span>
                                 <span className="text-sm font-mono font-bold">{Math.round(total)}</span>
                                 <span className="text-[11px] text-muted-foreground">pares</span>
                               </div>
                             ))}
                         </div>
                       </div>
                     ))}
                 </div>
               )}
             </div>
           ))}
         </TabsContent>
 
          <TabsContent value="segmented" className="space-y-4 mt-4 animate-in fade-in-50 duration-300">
            <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/20 rounded-lg border border-muted/50 mb-6">
              <div className="flex items-center gap-2 text-muted-foreground mr-2">
                <Filter className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Filtros</span>
              </div>
              
              <div className="w-full sm:w-64">
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Filtrar por Grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todos os Grupos</SelectItem>
                    {uniqueGroups.map(g => (
                      <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
 
              <div className="w-full sm:w-64">
                <Select value={colorFilter} onValueChange={setColorFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Filtrar por Cor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todas as Cores</SelectItem>
                    {uniqueColors.map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
 
              {(groupFilter !== "all" || colorFilter !== "all") && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setGroupFilter("all"); setColorFilter("all"); }}
                >
                  <X className="h-3 w-3 mr-1" /> Limpar
                </Button>
              )}
            </div>
 
            {Array.from(filteredGroupedByGroupAndColor.entries())
              .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
              .map(([groupName, colorMap]) => (
               <div key={groupName} className="border rounded-lg overflow-hidden bg-background shadow-sm">
                 <div className="bg-muted/40 px-4 py-2 flex items-center justify-between border-b">
                   <h3 className="font-semibold text-sm flex items-center gap-2">
                     <span className="text-primary/70"><ChevronDown className="h-4 w-4" /></span>
                     {groupName}
                   </h3>
                   <div className="flex gap-2">
                     {Array.from(colorMap.values()).flat().reduce((acc, row) => {
                       const unit = row.productUnit;
                       const existing = acc.find(item => item.unit === unit);
                       if (existing) existing.total += row.totalQuantity;
                       else acc.push({ unit, total: row.totalQuantity });
                       return acc;
                     }, [] as {unit: string, total: number}[]).map(t => (
                       <Badge key={t.unit} variant="outline" className="text-[10px]">
                         {t.total.toFixed(2)} {formatUnit(t.unit)}
                       </Badge>
                     ))}
                   </div>
                 </div>
                 <div className="p-0">
                   <Table>
                     <TableHeader className="bg-muted/10">
                       <TableRow>
                         <TableHead className="w-[30%] pl-8">Cor</TableHead>
                         <TableHead>Componente / Finalidade</TableHead>
                         <TableHead className="text-right">Quantidade</TableHead>
                         <TableHead className="text-center w-24">Unidade</TableHead>
                       </TableRow>
                     </TableHeader>
                     <TableBody>
                       {Array.from(colorMap.entries())
                         .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
                         .map(([color, colorRows], colorIdx) => (
                           <Fragment key={color}>
                             {colorRows.map((row, rowIdx) => (
                               <TableRow key={`${color}-${rowIdx}`} className="hover:bg-muted/5 border-b">
                                  <TableCell className="pl-8 py-3">
                                    {rowIdx === 0 ? (
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                          <ChevronRight className="h-3 w-3 text-primary/50" />
                                          <span className="font-bold text-sm text-foreground">{color}</span>
                                        </div>
                                        {/* Color Total Summary */}
                                        <div className="flex flex-wrap gap-1 mt-1 pl-5">
                                          {colorRows.reduce((acc, r) => {
                                            const unit = r.productUnit;
                                            const existing = acc.find(item => item.unit === unit);
                                            if (existing) existing.total += r.totalQuantity;
                                            else acc.push({ unit, total: r.totalQuantity });
                                            return acc;
                                          }, [] as {unit: string, total: number}[]).map(t => (
                                            <span key={t.unit} className="text-[9px] font-bold text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded border border-muted-foreground/10">
                                              Total: {t.total.toFixed(2)} {formatUnit(t.unit)}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="pl-5 text-[10px] text-muted-foreground/40 italic">continuação...</div>
                                    )}
                                  </TableCell>
                                 <TableCell className="py-2">
                                   <div className="flex items-center gap-2">
                                     <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">
                                       {row.componentType}
                                     </Badge>
                                     <span className="text-xs text-muted-foreground">{row.materialName}</span>
                                   </div>
                                 </TableCell>
                                 <TableCell className="text-right py-2 font-mono text-sm font-semibold">
                                   {row.totalQuantity.toFixed(2)}
                                 </TableCell>
                                 <TableCell className="text-center py-2">
                                   <span className="text-xs font-medium text-muted-foreground">{formatUnit(row.productUnit)}</span>
                                 </TableCell>
                               </TableRow>
                             ))}
                           </Fragment>
                         ))}
                     </TableBody>
                   </Table>
                 </div>
               </div>
             ))}
         </TabsContent>
       </Tabs>
    </div>
  );
}
