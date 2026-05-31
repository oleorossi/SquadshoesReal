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
  /** Breakdown agregado por numeração (somado entre items do PV que casam
   *  na chave grupo+cor+unidade). Usado pra Solado mostrar totais reais
   *  por Nº (ex: "Nº 34: 30 · Nº 35: 60") em vez da grade base de 1 ficha.
   *  Pedido user 2026-05-27. */
  sizeBreakdown?: Record<string, number>;
  /** Disponibilidade em estoque no momento da consulta (não-solado): soma do
   *  estoque dos produtos do grupo que casam na cor. Verde se cobre o consumo. */
  available?: number;
  /** Solado: estoque por numeração (stock_grade do produto-solado resolvido).
   *  Permite marcar verde/vermelho número a número. */
  soleSizeStock?: Record<string, number>;
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
    // Soma breakdown por numeração quando ambos têm (Solado).
    if (row.sizeBreakdown) {
      existing.sizeBreakdown = existing.sizeBreakdown || {};
      for (const [size, qty] of Object.entries(row.sizeBreakdown)) {
        existing.sizeBreakdown[size] = (existing.sizeBreakdown[size] || 0) + qty;
      }
    }
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
    sizeBreakdown: row.sizeBreakdown,
  });
};

/**
 * Solado em matriz numeração × cor (igual à visão da OC), com cada célula
 * colorida por disponibilidade: verde = estoque do nº cobre o necessário,
 * vermelho = falta. Pedido user 2026-05-30.
 */
// Ordena numerações (dígito ou conjugada "33/34") pelo primeiro número.
const sizeSortKey = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 9999; };

// Estoque da COLUNA (numeração da grade, possivelmente conjugada "33/34"):
// direto se a chave existe no stock_grade; senão soma os números-membro.
const haveForCol = (stock: Record<string, number> | undefined, col: string): number => {
  if (!stock) return 0;
  if (stock[col] != null) return Number(stock[col]) || 0;
  const members = col.split(/[/-]/).map((x) => x.trim());
  if (members.length > 1) return members.reduce((s, m) => s + (Number(stock[m]) || 0), 0);
  return 0;
};

function SoleMatrix({ rows }: { rows: ConsumptionRow[] }) {
  const sizes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const s of Object.keys(r.sizeBreakdown || {})) set.add(s);
    return Array.from(set).sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  }, [rows]);
  const totalsBySize = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const [s, q] of Object.entries(r.sizeBreakdown || {})) m[s] = (m[s] || 0) + (Number(q) || 0);
    return m;
  }, [rows]);

  // Fallback: solado sem breakdown por numeração — tabela simples por cor,
  // colorida pelo total (soma do stock_grade ≥ total necessário).
  if (sizes.length === 0) {
    return (
      <div className="rounded-lg border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Solado</TableHead><TableHead>Cor</TableHead>
              <TableHead className="text-right">Consumo Total</TableHead>
              <TableHead className="text-right w-28">Em estoque</TableHead>
              <TableHead className="text-center w-24">Unidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const have = Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0);
              const ok = have >= r.totalQuantity;
              return (
                <TableRow key={i} className={ok ? 'bg-green-500/10' : 'bg-red-500/10'}>
                  <TableCell className="font-medium">{r.groupName}</TableCell>
                  <TableCell>{r.color}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{r.totalQuantity.toFixed(2)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{have.toFixed(0)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="text-xs">par</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto keep-together">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Cor</TableHead>
            {sizes.map((s) => <TableHead key={s} className="text-center px-2 whitespace-nowrap">{s}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const total = Object.values(r.sizeBreakdown || {}).reduce((s, v) => s + (Number(v) || 0), 0) || r.totalQuantity;
            return (
              <TableRow key={i}>
                <TableCell><Badge variant="outline" className="text-xs">{r.color}</Badge></TableCell>
                {sizes.map((s) => {
                  const need = r.sizeBreakdown?.[s] || 0;
                  const have = haveForCol(r.soleSizeStock, s);
                  if (need <= 0) return <TableCell key={s} className="text-center text-muted-foreground">·</TableCell>;
                  const ok = have >= need;
                  return (
                    <TableCell
                      key={s}
                      title={`Necessário ${need} · Em estoque ${Math.round(have * 10) / 10}`}
                      className={`text-center font-mono font-semibold tabular-nums ${ok ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}
                    >
                      {need}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-mono font-bold whitespace-nowrap">{total} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell>Total por numeração</TableCell>
            {sizes.map((s) => <TableCell key={s} className="text-center font-mono tabular-nums">{totalsBySize[s] || 0}</TableCell>)}
            <TableCell className="text-right font-mono">{Object.values(totalsBySize).reduce((s, v) => s + v, 0)} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Seção Solado: uma MATRIZ POR TIPO DE SOLADO (separadas). Ex.: solado 01 e 238 no
 * mesmo PV/OC aparecem em tabelas distintas, cada uma com sua própria numeração
 * (conjugada ou individual) × cor. Pedido user 2026-05-30.
 */
function SoleSection({ rows }: { rows: ConsumptionRow[] }) {
  const bySole = useMemo(() => {
    const m = new Map<string, ConsumptionRow[]>();
    for (const r of rows) { const k = r.groupName || '—'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [rows]);
  return (
    <div className="space-y-3">
      {bySole.map(([sole, soleRows]) => (
        <div key={sole} className="space-y-1 keep-together">
          <div className="text-xs font-semibold flex items-center gap-2">
            <span className="inline-block rounded bg-muted px-2 py-0.5 text-foreground">Solado {sole}</span>
            <span className="text-muted-foreground font-normal">{soleRows.length} cor(es)</span>
          </div>
          <SoleMatrix rows={soleRows} />
        </div>
      ))}
    </div>
  );
}

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
            insole_has_lining,
            insole_ready_made,
            insole_lining_consumption,
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
          .select('id, name, color, group_id, quantity, reserved_stock, stock_grade, sole_classification')
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

         // Palmilha = PLACA (base) + FORRAÇÃO (napa do forro). Pulada INTEIRA quando
         // a palmilha é pronta (insole_ready_made ou solado classificado
         // palmilha_pronta) — espelha o ramo SQL calculate_order_consumption*:
         // pronta = não debita nada (nem placa, nem forração).
         const soleProductIdForInsole = soleColorMap.get(`${item.reference_id}::${orderColor}`) || null;
         const insoleSoleProd = soleProductIdForInsole ? (allProducts || []).find(p => p.id === soleProductIdForInsole) : null;
         const isPalmilhaPronta = (sheet?.insole_ready_made === true)
           || ((insoleSoleProd as any)?.sole_classification === 'palmilha_pronta');

         if (!isPalmilhaPronta) {
           const palmMapping = palmilhaColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || palmilhaDefaultMap.get(item.reference_id);
           const insoleGroupName = sheet?.insole_material || '';
           const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
           const palmColor = palmMapping?.color || '—';
           const palmProductId = palmMapping?.productId;

           // PLACA (base): produto específico (unidade) ou material convertido a placas
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

           // FORRAÇÃO da palmilha: napa do forro (lining_material) que cobre a placa.
           // Linha linear ADICIONAL (mesma napa do Forro do cabedal). Só quando há
           // forro (insole_has_lining) e área de forração da palmilha > 0.
           const insoleLiningCons = Number(sheet?.insole_lining_consumption) || 0;
           const liningGroupForPalm = sheet?.lining_material || '';
           if (insoleLiningCons > 0 && liningGroupForPalm && sheet?.insole_has_lining !== false) {
             const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${orderColor.toLowerCase()}`) || liningDefaultMap.get(item.reference_id) || orderColor;
             const forrSheet = getPreferredGroupSheet(liningGroupForPalm, { color: mappedLiningColor, mode: 'linear', preferYield: true });
             const { total: forrTotal } = calculateConsumptionWithUnit(item, insoleLiningCons, forrSheet, 'metro', undefined, soleProductIdForInsole, sheet?.sole_drives_consumption);
             addConsumptionRow(consumptionMap, {
               componentType: 'Palmilha',
               groupName: liningGroupForPalm,
               materialName: 'Forração Palmilha',
               productUnit: 'metro',
               color: mappedLiningColor,
               totalQuantity: forrTotal,
               widthMissing: isLinearWidthMissing(forrSheet, 'm'),
             });
           }
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

        // Breakdown de numerações escalado pro TOTAL real do item (PR 2026-05-27).
        // Antes mostrava grade base de 1 ficha (Nº 34: 1, ...), agora multiplica
        // pelo número de fichas pra exibir totais reais segmentados por cor de
        // solado. Quando múltiplos items casam em (sole+cor), addConsumptionRow
        // agrega o breakdown.
        const grade = (item as any).grade as Record<string, number> | null | undefined;
        const scaledBreakdown: Record<string, number> = {};
        if (grade && typeof grade === 'object') {
          // Mantém numerações conjugadas (ex: "33/34", "39/40") — só descarta meta
          // (_size_from/_size_to). Antes filtrava só dígitos puros e SUMIA com as
          // conjugadas, deixando a matriz vazia pra solados conjugados (ex: 238).
          const isSize = (k: string) => !k.startsWith('_');
          const baseSum = Object.entries(grade).reduce((s, [k, v]) => isSize(k) ? s + (Number(v) || 0) : s, 0);
          const multiplier = baseSum > 0 ? itemQuantity / baseSum : 0;
          for (const [size, qty] of Object.entries(grade)) {
            if (!isSize(size)) continue;
            const scaled = Math.round((Number(qty) || 0) * multiplier);
            if (scaled > 0) scaledBreakdown[size] = scaled;
          }
        }

        addConsumptionRow(consumptionMap, {
          componentType: 'Solado',
          groupName: soleProduct?.name || sheet?.sole_material || '',
          // materialName usado só como fallback se sizeBreakdown vier vazio.
          materialName: 'Solado',
          productUnit: 'par',
          color: soleColor,
          totalQuantity: (Number(sheet?.sole_consumption) || 0) * itemQuantity,
          sizeBreakdown: Object.keys(scaledBreakdown).length > 0 ? scaledBreakdown : undefined,
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
          const unitLc = productUnit.toLowerCase();
          const isLinearUnit = ['m', 'metro', 'mt', 'meters', 'metros', 'cm'].includes(unitLc);
          const rawQty = (Number(material.quantity_per_unit) || 0) * itemQuantity;
          let totalQty = rawQty;
          let widthMissing = false;

          // Materiais de ÁREA cortados de bobina (napa/couro): têm ficha de componente
          // e quantity_per_unit está em dm²/par. Converter para metros lineares pela
          // largura — antes era multiplicado direto e aparecia ~100× inflado (ex: napa
          // 5.7 dm²/par × 720 = 4104 "m" em vez de ~30 m). Tiras/itens sem ficha (qty
          // já em metro/unidade) passam direto. Bug reportado no PV-00116 (2026-05-30).
          const cs = (componentSheets || []).find((c: any) => c.product_id === material.product_id) || null;
          if (isLinearUnit && cs) {
            if (!isLinearWidthMissing(cs as any, productUnit)) {
              totalQty = convertDm2ToLinearMeters(rawQty, cs as any);
              productUnit = 'metro';
            } else {
              // tem ficha de área mas sem largura → não dá pra converter; marca aviso
              widthMissing = true;
              totalQty = unitLc === 'cm' ? rawQty / 100 : rawQty;
              productUnit = unitLc === 'cm' ? 'metro' : productUnit;
            }
          } else if (unitLc === 'cm') {
            totalQty = rawQty / 100;
            productUnit = 'metro';
          }

          addConsumptionRow(consumptionMap, {
            componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
            groupName,
            materialName: product.name || groupName,
            productUnit,
            color: material.color || '—',
            totalQuantity: totalQty,
            widthMissing,
          });
        }
      }

      // ── Disponibilidade em estoque (no momento da consulta) ──────────────
      // Não-solado: soma o estoque dos produtos do grupo que casam na cor.
      // Solado: pega o stock_grade do produto-solado (número a número).
      const normTxt = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const colorMatchesProduct = (p: any, color: string): boolean => {
        if (!color || color === '—') return true;
        const c = normTxt(color);
        const pName = normTxt(p.name); const pColor = normTxt(p.color);
        if (pColor === c || pName === c) return true;
        const after = pName.includes(':') ? normTxt(pName.split(':').pop() || '') : pName.includes('-') ? normTxt(pName.split('-').pop() || '') : '';
        if (after && after === c) return true;
        if (pColor.length > 3 && c.length > 3 && (c.includes(pColor) || pColor.includes(c))) return true;
        return false;
      };
      const groupAvailable = (groupName: string, color: string): number => {
        const group = (productGroups || []).find((g: any) => normTxt(g.name) === normTxt(groupName));
        return (allProducts || []).filter((p: any) => {
          // membro do grupo; só cai no match por nome quando o grupo não existe
          // (evita puxar produto de OUTRO grupo que só compartilha o nome)
          const ok = group ? p.group_id === group.id : normTxt(p.name) === normTxt(groupName);
          if (!ok) return false;
          return colorMatchesProduct(p, color);
        }).reduce((s: number, p: any) => {
          // disponível = quantidade − reservado (consistente com o resto do app)
          const avail = (Number(p.quantity) || 0) - (Number(p.reserved_stock) || 0);
          return s + Math.max(0, avail);
        }, 0);
      };
      const soleStockGrade = (groupName: string, color: string): Record<string, number> => {
        const prod = (allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName) && colorMatchesProduct(p, color))
          || (allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName));
        const out: Record<string, number> = {};
        const g = prod?.stock_grade;
        if (g && typeof g === 'object') {
          for (const [k, v] of Object.entries(g)) {
            if (k.startsWith('_')) continue; // pula meta (_size_to, _size_from)
            const n = Number(v);
            if (Number.isFinite(n)) out[k] = n;
          }
        }
        return out;
      };
      for (const row of consumptionMap.values()) {
        if (row.componentType === 'Solado') row.soleSizeStock = soleStockGrade(row.groupName, row.color);
        else row.available = groupAvailable(row.groupName, row.color);
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

      const rowsHtml = componentRows.map(row => {
        const aplicacao = row.sizeBreakdown && Object.keys(row.sizeBreakdown).length > 0
          ? Object.entries(row.sizeBreakdown)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([s, qty]) => `Nº ${s}: ${qty}`)
              .join(' · ')
          : row.materialName;
        return `
        <tr>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb">
            <div style="font-weight:600;font-size:10pt">${aplicacao}</div>
            <div style="color:#6b7280;font-size:8.5pt">${row.groupName}${row.color && row.color !== '—' ? ` · ${row.color}` : ''}</div>
          </td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700;font-size:10pt">
            ${row.totalQuantity.toFixed(2)} <span style="color:#6b7280;font-weight:400;font-size:8.5pt">${formatUnit(row.productUnit)}</span>
          </td>
        </tr>
      `;
      }).join('');

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
      <DialogContent className="w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
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
                <span className="flex items-center gap-2 text-xs text-muted-foreground ml-1">
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-green-500/40 border border-green-500/60" /> em estoque</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-red-500/40 border border-red-500/60" /> em falta</span>
                </span>
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
                {componentType === 'Solado'
                  ? <SoleSection rows={componentRows} />
                  : (
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
                        <TableHead className="text-right w-28">Em estoque</TableHead>
                        <TableHead className="text-center w-24 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('productUnit')}>
                          <span className="flex items-center justify-center">Unidade <SortIcon col="productUnit" /></span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentRows.map((row, index) => {
                        // widthMissing infla o consumo ~100× — comparar com estoque seria
                        // enganoso, então a linha fica neutra (o aviso âmbar permanece).
                        const known = !row.widthMissing;
                        const ok = (row.available ?? 0) >= row.totalQuantity;
                        const rowBg = !known ? '' : ok ? 'bg-green-500/10' : 'bg-red-500/10';
                        return (
                        <TableRow key={`${row.componentType}-${row.groupName}-${row.materialName}-${row.color}-${index}`} className={rowBg}>
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
                          <TableCell className={`text-right font-mono font-semibold ${!known ? 'text-muted-foreground' : ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                            {!known ? '—' : (row.available ?? 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs">{formatUnit(row.productUnit)}</Badge>
                          </TableCell>
                        </TableRow>
                      ); })}
                    </TableBody>
                  </Table>
                </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
