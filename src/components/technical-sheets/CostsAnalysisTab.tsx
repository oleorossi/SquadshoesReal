import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Warning as AlertTriangle, ClockCounterClockwise as History } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import {
  useSheetMaterials, useOverheadHistory, type SheetFormData,
} from '@/hooks/useTechnicalSheets';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import { useBomOperations } from '@/hooks/useBomOperations';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { COMPONENT_CATEGORIES, matchCategory } from '@/lib/componentCategories';
import { formatCurrency as globalFormatCurrency, safeToFixed } from '@/lib/utils';
import { SectionTitle } from '@/components/technical-sheets/sheetFormFields';

/* ===== Costs Tab ===== */
export function CostsAnalysisTab({ sheetId, form, groups }: {
  sheetId: string;
  form: SheetFormData; groups: { id: string; name: string }[];
}) {
  const { data: materials = [] } = useSheetMaterials(sheetId);
  const { data: componentSheets = [] } = useComponentSheets();
  const { data: operations = [] } = useBomOperations(sheetId);
  const { data: costPolicy } = useCostPolicies();

  // BOM audit: warning quando grupo tem ≥5 variantes-cor (heurística de
  // BOM inflado por bulk insert/clone). Migration 20260531130000 criou
  // a view v_bom_audit_issues.
  const { data: bomIssues = [] } = useQuery({
    queryKey: ['bom_audit_issues', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_bom_audit_issues')
        .select('*')
        .eq('sheet_id', sheetId);
      if (error) throw error;
      return (data || []) as Array<{
        sheet_id: string; group_id: string | null; group_name: string;
        variants_count: number; colors_in_bom: string;
        issue_type: 'bom_color_variants_inflated' | 'bom_default_qty_per_unit';
        severity: 'critical' | 'warning';
      }>;
    },
  });

  const { data: groupsWithPricing = [] } = useQuery({
    queryKey: ['product_groups_pricing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, package_price, package_weight_kg, dimensions_length, dimensions_width, dimensions_unit').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: groupAvgPrices = [] } = useQuery({
    queryKey: ['product_groups_avg_prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('group_id, unit_price')
        .eq('active', true)
        .not('group_id', 'is', null);
      if (error) throw error;
      const groupMap: Record<string, { total: number; count: number }> = {};
      (data || []).forEach((p: any) => {
        if (!p.group_id || !p.unit_price) return;
        if (!groupMap[p.group_id]) groupMap[p.group_id] = { total: 0, count: 0 };
        groupMap[p.group_id].total += Number(p.unit_price);
        groupMap[p.group_id].count += 1;
      });
      return Object.entries(groupMap).map(([id, v]) => ({ id, avg_price: v.total / v.count }));
    },
  });

  const componentSheetMap = useMemo(() => {
    const map: Record<string, any> = {};
    componentSheets.forEach((cs: any) => { map[cs.product_id] = cs; });
    return map;
  }, [componentSheets]);

  // De-duplication: skip legacy sheet_materials entries whose category is already
  // accounted for in modern Especificações (Cabedal/Forração/Palmilha/Sola/Tiras),
  // preventing double-counting that inflates the total cost.
  const specsCoveredCategories = useMemo(() => {
    const set = new Set<string>();
    const upperPerSizeFilled = Object.values(((form as any).upper_consumption_per_size || {}) as Record<string, number>)
      .some(v => Number(v) > 0);
    if (form.upper_material && (form.upper_consumption > 0 || upperPerSizeFilled)) set.add('Cabedal');
    if (form.lining_material && form.lining_consumption > 0) set.add('Forração');
    if (form.insole_material && form.insole_consumption > 0) set.add('Palmilha');
    if (form.sole_material && form.sole_consumption > 0) { set.add('Sola'); set.add('Solado'); }
    if (form.has_straps && form.strap_colors?.length) set.add('Tiras');
    return set;
  }, [form]);

  const categoryCosts = useMemo(() => {
    const costs: Record<string, number> = {};
    let total = 0;
    const skipped: string[] = [];
    materials.forEach(m => {
      const rawCat = (m as any).products?.category || 'Outros';
      const cat = matchCategory(rawCat);
      // Skip if this category is already covered by Especificações (avoids duplicidade)
      if (specsCoveredCategories.has(cat)) { skipped.push(rawCat); return; }
      const cs = componentSheetMap[m.product_id];
      const unitPrice = Number((m as any).products?.unit_price || 0);
      const cost = Number(m.quantity_per_unit) * unitPrice;
      costs[cat] = (costs[cat] || 0) + cost;
      total += cost;
    });
    return { costs, total, skippedLegacyCount: skipped.length };
  }, [materials, componentSheetMap, specsCoveredCategories]);

  const getGroupPlateAreaDm2 = (group: any): number => {
    if (!group?.dimensions_length || !group?.dimensions_width) return 0;
    const unit = (group.dimensions_unit || 'mm').toLowerCase();
    let l = Number(group.dimensions_length);
    let w = Number(group.dimensions_width);
    if (unit === 'cm') { l *= 10; w *= 10; }
    if (unit === 'm') { l *= 1000; w *= 1000; }
    return (l * w) / 10000;
  };

  const getGroupPricePerDm2 = (groupName: string) => {
    const group = groupsWithPricing.find(g => g.name === groupName);
    if (!group) return 0;
    const plateArea = getGroupPlateAreaDm2(group);
    if (plateArea > 0 && group.package_price && group.package_price > 0) return group.package_price / plateArea;
    if (group.package_price && group.package_weight_kg && group.package_weight_kg > 0) return group.package_price / group.package_weight_kg;
    const avg = groupAvgPrices.find(a => a.id === group.id);
    const avgPrice = avg?.avg_price || 0;
    // avg_price is price per unit (plate). Convert to price per dm² if plate area is known.
    if (avgPrice > 0 && plateArea > 0) return avgPrice / plateArea;
    return avgPrice;
  };

  const getGroupPricePerDm2ById = (groupId: string) => {
    const group = groupsWithPricing.find(g => g.id === groupId);
    if (!group) return 0;
    const plateArea = getGroupPlateAreaDm2(group);
    if (plateArea > 0 && group.package_price && group.package_price > 0) return group.package_price / plateArea;
    if (group.package_price && group.package_weight_kg && group.package_weight_kg > 0) return group.package_price / group.package_weight_kg;
    const avg = groupAvgPrices.find(a => a.id === groupId);
    const avgPrice = avg?.avg_price || 0;
    if (avgPrice > 0 && plateArea > 0) return avgPrice / plateArea;
    return avgPrice;
  };

  const specsCosts = useMemo(() => {
    const items: { label: string; material: string; consumption: number; pricePerUnit: number; cost: number }[] = [];
    // Helper: o consumo efetivo SEMPRE prioriza a grade por numeração (consumption_per_size).
    // O campo "consumption" (média) é usado apenas como fallback quando a grade está vazia.
    const effectiveConsumption = (perSize: Record<string, number> | null | undefined, fallbackAvg: number): number => {
      if (perSize && typeof perSize === 'object') {
        const vals = Object.values(perSize).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return Number(fallbackAvg) || 0;
    };
    const upperEff = effectiveConsumption((form as any).upper_consumption_per_size, form.upper_consumption);
    if (form.upper_material && upperEff > 0) {
      const price = getGroupPricePerDm2(form.upper_material);
      items.push({ label: 'Cabedal', material: form.upper_material, consumption: upperEff, pricePerUnit: price, cost: upperEff * price });
    }
    (form.components_accessories || []).forEach((extra: any, idx: number) => {
      const eff = effectiveConsumption(extra.consumption_per_size, extra.consumption);
      if (extra.material && eff > 0 && !extra.id) {
        const price = getGroupPricePerDm2(extra.material);
        // Prioriza label custom (ex: "Elástico Traseiro 6mm") sobre genérico
        const customLabel = (extra.label || '').toString().trim();
        const label = customLabel
          ? `${customLabel} (${extra.material})`
          : extra.mandatory
            ? `Componente Extra (${extra.material})`
            : `Cabedal ${idx + 2}`;
        items.push({ label, material: extra.material, consumption: eff, pricePerUnit: price, cost: eff * price });
      }
    });
    if (form.lining_material && form.lining_consumption > 0) {
      const price = getGroupPricePerDm2(form.lining_material);
      items.push({ label: 'Forração', material: form.lining_material, consumption: form.lining_consumption, pricePerUnit: price, cost: form.lining_consumption * price });
    }
    // lining_accessories are alternative options, NOT additive — only primary forração counts for cost
    if (form.insole_material && form.insole_consumption > 0) {
      const price = getGroupPricePerDm2(form.insole_material);
      items.push({ label: 'Palmilha', material: form.insole_material, consumption: form.insole_consumption, pricePerUnit: price, cost: form.insole_consumption * price });
    }
    if (form.sole_material && form.sole_consumption > 0) {
      const price = getGroupPricePerDm2(form.sole_material);
      items.push({ label: 'Sola', material: form.sole_material, consumption: form.sole_consumption, pricePerUnit: price, cost: form.sole_consumption * price });
    }
    // Direct components (unit-based)
    (form.direct_components || []).forEach((comp: any, idx: number) => {
      if (comp.product_id && comp.quantity > 0 && comp.unit_price > 0) {
        items.push({ label: comp.product_name || `Componente ${idx + 1}`, material: (comp.unit || 'un').toString().trim() || 'un', consumption: comp.quantity, pricePerUnit: comp.unit_price, cost: comp.quantity * comp.unit_price });
      }
    });
    return items;
  }, [form, groupsWithPricing]);

  const strapsCosts = useMemo(() => {
    if (!form.has_straps || !form.strap_colors?.length) return [];
    return (form.strap_colors || []).map((strap: any) => {
      const groupId = strap.group_id;
      const perSize: Record<string, number> = strap.consumption_per_size || {};
      const filledVals = (Object.values(perSize) as any[]).map(v => Number(v)).filter(v => v > 0);
      const consumption = filledVals.length > 0 ? filledVals.reduce((a, b) => a + b, 0) / filledVals.length : Number(strap.consumption || 0);
      if (!groupId || consumption <= 0) return null;
      const price = getGroupPricePerDm2ById(groupId);
      const group = groupsWithPricing.find(g => g.id === groupId);
      return { label: strap.label || 'Tira', material: group?.name || '—', consumption, pricePerUnit: price, cost: consumption * price };
    }).filter(Boolean) as { label: string; material: string; consumption: number; pricePerUnit: number; cost: number }[];
  }, [form, groupsWithPricing]);

  const specsTotalCost = specsCosts.reduce((s, i) => s + i.cost, 0);
  const strapsTotalCost = strapsCosts.reduce((s, i) => s + i.cost, 0);
  const bomTotalCost = categoryCosts.total;
  const modTotalCost = operations.reduce((s: number, op: any) => s + Number(op.cost_per_pair || 0), 0);
   const overheadPerPair = (form as any).custom_overhead !== null && (form as any).custom_overhead !== undefined
     ? Number((form as any).custom_overhead)
     : (costPolicy?.overhead_rate_per_pair || 0);
  const packagingPerPair = costPolicy?.packaging_cost_per_pair || 0;
  const materialTotal = bomTotalCost + specsTotalCost + strapsTotalCost;
  const grandTotal = materialTotal + modTotalCost + overheadPerPair + packagingPerPair;
  const formatCurrency = (v: any) => globalFormatCurrency(v);

  // IMPORTANTE: chamar TODOS os hooks antes de qualquer early return.
  // Antes esse useOverheadHistory ficava depois do `if (!hasAnyData) return`,
  // causando "Rendered fewer/more hooks than during the previous render"
  // toda vez que a ficha alternava entre ter dados e não ter.
  const { data: overheadHistory = [] } = useOverheadHistory(sheetId);

  const hasAnyData = materials.length > 0 || specsCosts.length > 0 || strapsCosts.length > 0 || operations.length > 0;
  if (!hasAnyData) {
    return <div className="text-center py-8 text-muted-foreground"><p className="text-sm">Adicione materiais no BOM, operações ou preencha Especificações para calcular custos</p></div>;
  }

  return (
    <div className="space-y-6">
      {/* Warning: BOM com sintomas de bulk insert/clone errado.
          2 padrões cobertos pela view v_bom_audit_issues:
            - bom_color_variants_inflated: ≥5 variantes-cor do mesmo grupo
            - bom_default_qty_per_unit: ≥80% dos itens com qty_per_unit=1
              (default do cadastro, deveria ser fracionário) */}
      {bomIssues.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-bold text-warning">
                BOM possivelmente inflado — {bomIssues.length} alerta{bomIssues.length > 1 ? 's' : ''} detectado{bomIssues.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                Fichas saudáveis raramente têm mais de 2-3 cores do mesmo material no BOM.
                E <strong>consumo (qty/par) deve ser FRACIONÁRIO</strong> — ex: 0.005 lata de cola,
                não 1 lata por par. Itens com qty=1 inflam o custo em 50-100×.
                Revise em "Especificações por Componente" ou "Materiais".
              </p>
              <ul className="text-xs space-y-0.5 mt-1.5">
                {bomIssues.map((i, idx) => (
                  <li key={`${i.issue_type}-${i.group_id || idx}`} className="font-mono">
                    <span className={i.severity === 'critical' ? 'text-destructive font-bold' : 'text-warning'}>
                      {i.issue_type === 'bom_default_qty_per_unit'
                        ? `consumo default`
                        : `${i.variants_count}× cores`}
                    </span>
                    {' '}
                    <strong>{i.group_name}</strong>
                    <span className="text-muted-foreground"> · {i.colors_in_bom || '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <SectionTitle>Análise de Custo por Par</SectionTitle>
        {overheadHistory.length > 0 && (
           <Popover>
             <PopoverTrigger asChild>
               <Button variant="outline" size="sm" className="gap-2 h-7 text-xs">
                 <History className="h-3 w-3" />
                 Histórico de GGF
               </Button>
             </PopoverTrigger>
             <PopoverContent className="w-80 p-0" align="end">
               <div className="p-3 border-b bg-muted/30">
                 <h4 className="text-xs font-semibold">Histórico de Alterações GGF</h4>
                 <p className="text-xs text-muted-foreground">Últimas mudanças no overhead customizado</p>
               </div>
               <div className="max-h-60 overflow-y-auto">
                 {overheadHistory.map((entry) => (
                   <div key={entry.id} className="p-3 border-b last:border-0 text-xs space-y-1 hover:bg-muted/20 transition-colors">
                     <div className="flex items-center justify-between">
                       <span className="font-semibold text-primary">
                         {entry.new_value !== null ? formatCurrency(entry.new_value) : "Padrão"}
                       </span>
                       <span className="text-xs text-muted-foreground font-mono">
                         {new Date(entry.created_at).toLocaleDateString('pt-BR')}
                       </span>
                     </div>
                     <div className="flex items-center justify-between text-muted-foreground">
                       <span>De: {entry.old_value !== null ? formatCurrency(entry.old_value) : "Padrão"}</span>
                       <span className="italic">{entry.profiles?.full_name || "Sistema"}</span>
                     </div>
                   </div>
                 ))}
               </div>
             </PopoverContent>
           </Popover>
        )}
      </div>

      {materials.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Materiais BOM</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Componente</TableHead>
                <TableHead className="text-xs text-center">Itens</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
                <TableHead className="text-xs text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPONENT_CATEGORIES.map(catConfig => {
                const catCost = categoryCosts.costs[catConfig.key] || 0;
                if (catCost === 0) return null;
                const pct = grandTotal > 0 ? (catCost / grandTotal * 100) : 0;
                const CatIcon = catConfig.icon;
                const groupMats = materials.filter(m => matchCategory((m as any).products?.category || '') === catConfig.key);
                return (
                  <TableRow key={catConfig.key}>
                    <TableCell className="text-sm"><div className="flex items-center gap-2"><CatIcon className={`h-4 w-4 ${catConfig.color}`} /><span className="font-medium">{catConfig.label}</span></div></TableCell>
                    <TableCell className="text-sm text-center font-mono">{groupMats.length}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{formatCurrency(catCost)}</TableCell>
                    <TableCell className="text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                        <span className="text-xs font-mono text-muted-foreground w-12 text-right">{safeToFixed(pct, 1)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell className="text-sm">Subtotal BOM</TableCell>
                <TableCell className="text-sm text-center font-mono">{materials.length}</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(bomTotalCost)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {specsCosts.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Especificações Técnicas</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Componente</TableHead>
                <TableHead className="text-xs">Material / Grupo</TableHead>
                <TableHead className="text-xs text-right">Consumo/par</TableHead>
                <TableHead className="text-xs text-right">Preço/un</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {specsCosts.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm font-medium">{item.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.material}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.consumption.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.pricePerUnit > 0 ? formatCurrency(item.pricePerUnit) : <span className="text-destructive text-xs">Sem preço</span>}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-semibold">{formatCurrency(item.cost)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={4} className="text-sm">Subtotal Especificações</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(specsTotalCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {strapsCosts.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tiras</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Tira</TableHead>
                <TableHead className="text-xs">Material / Grupo</TableHead>
                <TableHead className="text-xs text-right">Consumo (dm²/par)</TableHead>
                <TableHead className="text-xs text-right">Preço/dm²</TableHead>
                <TableHead className="text-xs text-right">Custo/par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strapsCosts.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm font-medium">{item.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.material}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.consumption.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{item.pricePerUnit > 0 ? formatCurrency(item.pricePerUnit) : <span className="text-destructive text-xs">Sem preço</span>}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-semibold">{formatCurrency(item.cost)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-bold">
                <TableCell colSpan={4} className="text-sm">Subtotal Tiras</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(strapsTotalCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableBody>
            <TableRow className="bg-muted/20">
              <TableCell className="text-sm font-bold">Material (BOM + Especificações + Tiras)</TableCell>
              <TableCell className="text-sm text-right font-mono font-bold">{formatCurrency(materialTotal)}</TableCell>
            </TableRow>
            {modTotalCost > 0 && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">Mão de Obra Direta (MOD)</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(modTotalCost)}</TableCell>
              </TableRow>
            )}
             {(overheadPerPair > 0 || (form as any).custom_overhead !== null) && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">
                  Overhead Alocado
                  {(form as any).custom_overhead !== null && (
                    <Badge variant="outline" className="ml-2 text-[8px] bg-warning/10 text-warning border-warning/30">Customizado</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(overheadPerPair)}</TableCell>
              </TableRow>
            )}
            {packagingPerPair > 0 && (
              <TableRow className="bg-muted/20">
                <TableCell className="text-sm">Embalagem</TableCell>
                <TableCell className="text-sm text-right font-mono">{formatCurrency(packagingPerPair)}</TableCell>
              </TableRow>
            )}
            <TableRow className="bg-muted/30 font-bold">
              <TableCell className="text-sm">Custo Padrão por Par</TableCell>
              <TableCell className="text-sm text-right font-mono font-bold">{formatCurrency(grandTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

