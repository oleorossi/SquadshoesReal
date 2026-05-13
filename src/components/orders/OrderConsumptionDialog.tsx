import { useState, useEffect, useMemo, useCallback } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, Package, FileText, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import {
   calculateGradeBasedDm2,
   calculateConsumptionWithUnit,
   convertDm2ToPlates,
   getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
   normalizeText,
   calcRequiredForGrade,
 } from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderIds: string[];
  title: string;
};

type ConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
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
    return;
  }

  map.set(key, { componentType: row.componentType, groupName, materialName, productUnit, color, totalQuantity });
};

export default function OrderConsumptionDialog({ open, onOpenChange, orderIds, title }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);

  useEffect(() => {
    if (!open || orderIds.length === 0) return;
    loadConsumption();
  }, [open, orderIds]);

  const loadConsumption = async () => {
    if (orderIds.length === 0) return;
    setLoading(true);

    try {
      // Load all production orders
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('id, reference_id, color, quantity, grade, sale_order_item_id')
        .in('id', orderIds);

      if (ordersError) throw ordersError;
      if (!ordersData || ordersData.length === 0) { setRows([]); return; }

      const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))];
      const saleOrderItemIds = [...new Set(ordersData.map(o => o.sale_order_item_id).filter(Boolean))] as string[];

      // Load shared data in parallel
      const [
        { data: sheetsData },
        { data: materials, error: materialsError },
        { data: allProducts },
        { data: productGroups },
        { data: componentSheets },
        { data: saleOrderItems },
        { data: soleColorMappings },
      ] = await Promise.all([
        supabase
          .from('technical_sheets')
          .select('id, upper_material, upper_consumption, upper_consumption_per_size, lining_material, lining_consumption, insole_material, insole_consumption, sole_material, sole_consumption, sole_color, sole_group_id, lining_accessories, components_accessories, strap_colors, sole_drives_consumption')
          .in('id', refIds),
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
        saleOrderItemIds.length > 0
          ? supabase
              .from('sale_order_items')
              .select('id, strap_colors, fichas')
              .in('id', saleOrderItemIds)
          : Promise.resolve({ data: [] }),
        (supabase as any)
          .from('technical_sheet_sole_colors')
          .select('sheet_id, product_color, sole_product_id')
          .in('sheet_id', refIds),
      ]);

      if (materialsError) throw materialsError;

      // Build lookup maps
      const sheetsMap = new Map((sheetsData || []).map(s => [s.id, s]));
      const saleItemsMap = new Map((saleOrderItems || []).map((si: any) => [si.id, si]));

      // Build sole color mapping: (sheet_id, color) -> sole_product_id
      const soleColorMap = new Map<string, string>();
      for (const m of (soleColorMappings || []) as any[]) {
        if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_product_id);
      }

      // Helpers (shared across all orders)
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
        opts: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
      ) => getPreferredComponentSheetFromCandidates(getComponentSheetsForGroup(groupName), opts);

      const groupHasColor = (groupName: string, color: string): boolean => {
        if (!groupName || !color || color === '—') return false;
        const normalizedColor = color.toLowerCase().trim();
        const group = (productGroups || []).find((g: any) => g.name === groupName);
        if (!group) return false;
        return (allProducts || []).some((p: any) => {
          if (p.group_id !== group.id) return false;
          const pName = (p.name || '').toLowerCase();
          const pColor = (p.color || '').toLowerCase();
          if (pColor === normalizedColor || pName === normalizedColor) return true;
          const afterDelimiter = pName.includes(':') ? pName.split(':').pop()?.trim() : pName.includes('-') ? pName.split('-').pop()?.trim() : '';
          if (afterDelimiter && afterDelimiter === normalizedColor) return true;
          if (pColor.length > 3 && normalizedColor.length > 3) {
            if (normalizedColor.includes(pColor) || pColor.includes(normalizedColor)) return true;
          }
          return false;
        });
      };

      const countGroupProducts = (groupName: string): number => {
        const group = (productGroups || []).find((g: any) => g.name === groupName);
        if (!group) return 0;
        return (allProducts || []).filter((p: any) => p.group_id === group.id).length;
      };

      const resolveOption = (
        mainGroup: string, mainConsumption: number,
        alternatives: any[], color: string
      ): { group: string; consumption: number } | null => {
        if (mainGroup && mainConsumption > 0) {
          if (!color || color === '—' || groupHasColor(mainGroup, color)) {
            return { group: mainGroup, consumption: mainConsumption };
          }
        }
        for (const alt of alternatives) {
          const altGroup = alt.material?.trim();
          const altConsumption = Number(alt.consumption) || 0;
          if (altGroup && altConsumption > 0 && groupHasColor(altGroup, color)) {
            return { group: altGroup, consumption: altConsumption };
          }
        }
        const candidates = [
          ...(mainGroup && mainConsumption > 0 ? [{ group: mainGroup, consumption: mainConsumption }] : []),
          ...alternatives.filter((a: any) => a.material?.trim() && (Number(a.consumption) || 0) > 0).map((a: any) => ({ group: a.material.trim(), consumption: Number(a.consumption) })),
        ];
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => countGroupProducts(b.group) - countGroupProducts(a.group));
        return candidates[0];
      };

      const consumptionMap = new Map<string, ConsumptionRow>();

      // Process each order
      for (const order of ordersData) {
        const sheet = sheetsMap.get(order.reference_id) as any;
        if (!sheet) continue;

        const saleItem = order.sale_order_item_id ? saleItemsMap.get(order.sale_order_item_id) as any : null;

        // orders.grade already contains TOTAL pairs per size (not per-ficha),
        // so fichas must be 1 to avoid double-counting.
        const item = {
          reference_id: order.reference_id,
          color: order.color || '—',
          quantity: order.quantity,
          grade: order.grade as Record<string, number> | null,
          fichas: 1,
          strap_colors: saleItem?.strap_colors ?? null,
        };

        const itemQuantity = Number(item.quantity) || 0;
        const orderColor = item.color || '—';

        // Cabedal
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
          // Per-size override: principal usa upper_consumption_per_size; opção alternativa usa o seu próprio
          const isPrincipal = upperMatch.group === (sheet?.upper_material || '');
          const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
          const overridePerSize = isPrincipal
            ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
            : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
          const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize, undefined, sheet?.sole_drives_consumption);
          addConsumptionRow(consumptionMap, {
            componentType: 'Cabedal', groupName: upperMatch.group, materialName: 'Cabedal',
            productUnit: 'metro', color: orderColor, totalQuantity: upperTotal,
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
          const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride, undefined, sheet?.sole_drives_consumption);
          addConsumptionRow(consumptionMap, {
            componentType: 'Cabedal', groupName: mandMat.material, materialName: 'Material Fixo',
            productUnit: 'metro', color: orderColor, totalQuantity: mandTotal,
          });
        }

        // Forro
        const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
        const liningMatch = resolveOption(
          sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0,
          liningAlts, orderColor
        );
        if (liningMatch) {
          const liningSheet = getPreferredGroupSheet(liningMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
          // Resolve sole product for this order's reference + color
          const soleProductId = soleColorMap.get(`${order.reference_id}::${orderColor}`) || null;
          const { total: liningTotal } = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', undefined, soleProductId, sheet?.sole_drives_consumption);
          addConsumptionRow(consumptionMap, {
            componentType: 'Forro', groupName: liningMatch.group, materialName: 'Forração',
            productUnit: 'metro', color: orderColor, totalQuantity: liningTotal,
          });
        }

        // Palmilha
        const soleProductIdForInsole = soleColorMap.get(`${order.reference_id}::${orderColor}`) || null;
        const insoleGroupName = sheet?.insole_material || '';
        const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
        const insoleSheet = getPreferredGroupSheet(insoleGroupName, { mode: 'plate', preferYield: true });
        const insoleDm2 = calculateGradeBasedDm2(item, Number(sheet?.insole_consumption) || 0, insoleSheet, undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
        const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
        // Aplica waste_pct também no caminho que usa dimensões do grupo,
        // para manter paridade com convertDm2ToPlates() (fallback).
        const insoleWastePct = Number(insoleSheet?.waste_pct) || 0;
        const insolePlates = groupPlateArea > 0
          ? (insoleDm2 / groupPlateArea) * (1 + insoleWastePct / 100)
          : convertDm2ToPlates(insoleDm2, insoleSheet);
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha', groupName: insoleGroupName, materialName: 'Palmilha',
          productUnit: 'placa', color: '—', totalQuantity: insolePlates,
        });

        // Solado
        const soleColor = (() => {
          const c = (orderColor || '').toLowerCase();
          if (c.includes('preto') || c.includes('black') || c.includes('pb')) return 'Preto';
          return 'Caramelo';
        })();
        // Solado: regra industrial fixa = 1 par de solado por par produzido (sempre que ficha define sole_material)
        const solePerPair = sheet?.sole_material ? 1 : 0;
        addConsumptionRow(consumptionMap, {
          componentType: 'Solado', groupName: sheet?.sole_material || '', materialName: 'Solado',
          productUnit: 'par', color: soleColor,
          totalQuantity: solePerPair * itemQuantity,
        });

        // Tiras
        const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
        const sheetStraps: any[] = Array.isArray(sheet?.strap_colors) ? (sheet.strap_colors as any[]) : [];
        const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
        for (const strap of resolvedStraps) {
          const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
            grade: (item.grade as Record<string, number>) || {},
            quantity: itemQuantity,
            fichas: item.fichas,
          });
          addConsumptionRow(consumptionMap, {
            componentType: 'Tiras', groupName: strap.group_name || strap.label || 'Tira',
            materialName: strap.label || strap.group_name || 'Tira',
            productUnit: 'metro', color: strap.color || orderColor,
            totalQuantity: strapConsumptionCm / 100,
          });
        }

        // BOM materials
        const specGroupsWithConsumption = new Map<string, number>();
        if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
        if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
        if (sheet?.insole_material && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.insole_material).toLowerCase(), Number(sheet.insole_consumption));
        if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

        const itemMaterials = (materials || []).filter((m) => m.sheet_id === order.reference_id);
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
          if (productUnit === 'cm') { totalQty = totalQty / 100; productUnit = 'metro'; }

          addConsumptionRow(consumptionMap, {
            componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
            groupName, materialName: product.name || groupName, productUnit,
            color: material.color || '—', totalQuantity: totalQty,
          });
        }
      }

      const sortedRows = Array.from(consumptionMap.values()).sort((a, b) => {
        const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as any) - COMPONENT_ORDER.indexOf(b.componentType as any);
        if (typeDiff !== 0) return typeDiff;
        return a.groupName.localeCompare(b.groupName, 'pt-BR') || a.materialName.localeCompare(b.materialName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR');
      });

      setRows(sortedRows);
    } catch (err) {
      console.error('[OrderConsumptionDialog] Failed to load consumption:', err);
      setRows([]);
    } finally {
      setLoading(false);
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
      metro: 'm', m: 'm', dm2: 'dm²', par: 'par', un: 'un', kg: 'kg', litro: 'L', placa: 'placa(s)',
    };
    return labels[unit] || unit || 'un';
  };

  const handlePrintPdf = useCallback(() => {
    const printRows = sortedRows;
    const tableRows = printRows.map(row =>
      `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:500">${escapeHtml(row.groupName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.materialName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.color)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700">${row.totalQuantity.toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${formatUnit(row.productUnit)}</td>
      </tr>`
    ).join('');

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#f3f4f6;padding:4px 12px;border-radius:6px;margin-right:8px;font-size:13px;font-weight:600">${total.toFixed(2)} ${formatUnit(unit)}</span>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consumo — ${title}</title>
      <style>@page{size:A4;margin:5mm 6mm}body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:0;padding:5mm 6mm}
      table{width:100%;border-collapse:collapse;font-size:13px}th{background:#f9fafb;padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
      h1{font-size:18px;margin:0 0 4px}p.sub{color:#6b7280;font-size:13px;margin:0 0 16px}</style></head>
      <body>
        <h1>Consumo de Materiais — ${title}</h1>
        <p class="sub">${rows.length} item(ns) · ${orderIds.length} OP(s) · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div style="margin-bottom:16px">${totalsHtml}</div>
        <table><thead><tr>
          <th>Grupo de Material</th><th>Aplicação</th><th>Cor</th>
          <th style="text-align:right">Consumo Total</th><th style="text-align:center">Unidade</th>
        </tr></thead><tbody>${tableRows}</tbody></table>
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [sortedRows, totalsByUnit, title, orderIds.length, rows.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Consumo — {title}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum consumo de material encontrado.</p>
        ) : (
          <div className="space-y-4">
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
                {orderIds.length > 1 && (
                  <Badge variant="outline" className="text-sm px-3 py-1">
                    {orderIds.length} OP(s)
                  </Badge>
                )}
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
                        <TableRow key={`${row.componentType}-${row.groupName}-${row.color}-${index}`}>
                          <TableCell className="font-medium">{row.groupName}</TableCell>
                          <TableCell>{row.materialName}</TableCell>
                          <TableCell>{row.color}</TableCell>
                          <TableCell className="text-right font-mono font-bold">{row.totalQuantity.toFixed(2)}</TableCell>
                          <TableCell className="text-center text-muted-foreground">{formatUnit(row.productUnit)}</TableCell>
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
