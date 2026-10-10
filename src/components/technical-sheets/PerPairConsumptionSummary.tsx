/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, CaretDown, CaretRight, Warning } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  getPreferredComponentSheet,
  LINEAR_UNITS,
  PLATE_UNITS,
  normalizeText,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';
import { computePerPairConsumption, type PerPairSource } from '@/lib/sheetPerPairConsumption';

interface StrapCatalogLike {
  types?: Array<{ id: string; name: string }>;
  measures?: Array<{ id: string; strap_type_id: string; display_name: string }>;
}

interface Props {
  form: any;
  sizes: Array<string | number>;
  sheetMaterials: any[];
  componentSheets: any[];
  products: any[];
  groups: any[];
  strapCatalog?: StrapCatalogLike | null;
  onOpenMaterials: () => void;
}

const fmt = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: value >= 10 ? 2 : 4 }).format(value);

/**
 * Consumo POR PAR da ficha, agrupado por material (spec `consumo-por-par-na-ficha`).
 * Somente leitura — a edição continua na aba Materiais & Consumo.
 * Sem forração, fibra, químicos e embalagem (decisão do dono, 10/10/2026).
 */
export default function PerPairConsumptionSummary({
  form, sizes, sheetMaterials, componentSheets, products, groups, strapCatalog, onOpenMaterials,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const soleId: string | null = form.primary_sole_id || null;

  // Palmilha (placa) por numeração é cadastro do SOLADO — a ficha só escolhe o grupo.
  const { data: soleSpecs = [] } = useQuery({
    queryKey: ['sole_technical_specs', 'insole-per-pair', soleId],
    enabled: !!soleId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sole_technical_specs')
        .select('size, insole_consumption_dm2')
        .eq('sole_id', soleId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const groupByName = (name?: string | null) => {
      const key = normalizeText(name);
      return key ? (groups || []).find((g: any) => normalizeText(g.name) === key) : null;
    };
    const productOfGroup = (groupId?: string | null) => groupId
      ? (products || []).find((p: any) => p.group_id === groupId && p.active !== false && (p.unit || '').trim())
        || (products || []).find((p: any) => p.group_id === groupId)
      : null;
    const sheetForGroup = (groupId: string | undefined, unit: string): ComponentSheetCandidate | null => {
      if (!groupId) return null;
      const candidates = (componentSheets || []).filter((cs: any) =>
        cs.group_id === groupId || cs.products?.group_id === groupId);
      const u = normalizeText(unit);
      const mode = LINEAR_UNITS.has(u) ? 'linear' : PLATE_UNITS.has(u) ? 'plate' : 'any';
      return getPreferredComponentSheet(candidates, { mode });
    };
    /** Material escolhido por GRUPO (cabedal, material extra, palmilha). */
    const groupSource = (
      component: string,
      groupName: string,
      scalar: number,
      perSize: Record<string, unknown> | null | undefined,
      forceArea: boolean,
    ): PerPairSource | null => {
      const group: any = groupByName(groupName);
      const product: any = productOfGroup(group?.id);
      const stockUnit = (product?.unit || group?.consumption_unit || 'un').toString();
      const u = normalizeText(stockUnit);
      const consUnit = normalizeText(group?.consumption_unit).replace(/2/g, '²');
      // Mesmo critério do rótulo da grade na aba Materiais (getUnitForGroupName).
      const isArea = forceArea
        || u === 'dm²' || u === 'dm2'
        || ((LINEAR_UNITS.has(u) || PLATE_UNITS.has(u))
          && (Number(group?.dimensions_width) > 0 || Number(group?.dimensions_length) > 0
            || ['dm²', 'm²', 'cm²'].includes(consUnit)));
      return {
        component,
        material: group?.name || groupName,
        category: product?.category ?? null,
        stockUnit,
        inputUnit: isArea ? 'dm2' : 'stock',
        componentSheet: sheetForGroup(group?.id, stockUnit),
        scalar: Number(scalar) || 0,
        perSize,
      };
    };

    const sources: PerPairSource[] = [];
    const push = (s: PerPairSource | null) => { if (s) sources.push(s); };

    if ((form.upper_material || '').trim()) {
      push(groupSource('Cabedal', form.upper_material, form.upper_consumption, form.upper_consumption_per_size, true));
    }
    for (const extra of form.components_accessories || []) {
      if (!extra?.mandatory || !(extra.material || '').trim()) continue;
      push(groupSource('Material extra', extra.material, extra.consumption, extra.consumption_per_size, false));
    }
    if ((form.insole_material || '').trim()) {
      const specMap: Record<string, number> = {};
      for (const s of soleSpecs as any[]) {
        if (s.insole_consumption_dm2 != null) specMap[String(s.size)] = Number(s.insole_consumption_dm2);
      }
      push(groupSource(
        'Palmilha',
        form.insole_material,
        form.insole_consumption,
        Object.keys(specMap).length > 0 ? specMap : form.insole_consumption_per_size,
        true,
      ));
    }
    for (const comp of form.direct_components || []) {
      if (!comp?.product_id) continue;
      const product: any = (products || []).find((p: any) => p.id === comp.product_id);
      push({
        component: 'Componente',
        material: product?.name || comp.product_name || 'Componente',
        category: product?.category ?? null,
        stockUnit: (product?.unit || comp.unit || 'un').toString(),
        inputUnit: 'stock',
        scalar: Number(comp.quantity) || 0,
      });
    }
    // BOM: só linhas compartilhadas (material_variant_id NULL); as da variante são override.
    for (const m of sheetMaterials || []) {
      if (m.material_variant_id) continue;
      const unit = (m.products?.unit || 'un').toString();
      const cs = (componentSheets || []).find((c: any) => c.product_id === m.product_id) || null;
      const u = normalizeText(unit);
      push({
        component: 'BOM',
        material: m.product_groups?.name || m.products?.name || 'Material',
        category: m.products?.category ?? null,
        stockUnit: unit,
        // Mesma regra de bomMaterialCostPerPair: ficha de componente + unidade física = dm²/par.
        inputUnit: cs && (LINEAR_UNITS.has(u) || PLATE_UNITS.has(u)) ? 'dm2' : 'stock',
        componentSheet: cs,
        scalar: Number(m.quantity_per_unit) || 0,
        perSize: m.consumption_per_size,
      });
    }
    if (form.has_straps) {
      for (const strap of form.strap_colors || []) {
        const measure = strapCatalog?.measures?.find((x) => x.id === strap.measure_id);
        const type = measure ? strapCatalog?.types?.find((t) => t.id === measure.strap_type_id) : null;
        const material = measure
          ? `${type?.name || 'Tira'} · ${measure.display_name}`
          : (strap.label || 'Tira (sem medida)');
        // strap_colors guarda cm/PAR (o input da aba é cm/pé, ÷2 só na tela).
        push({
          component: 'Tiras',
          material,
          category: null,
          stockUnit: 'm',
          inputUnit: 'stock',
          scale: 0.01,
          scalar: Number(strap.consumption) || 0,
          perSize: strap.consumption_per_size,
        });
      }
    }
    const soleGroup: any = (groups || []).find((g: any) => g.id === form.sole_group_id);
    if (soleGroup || form.primary_sole_id) {
      push({
        component: 'Solado',
        material: soleGroup?.name || 'Solado',
        category: 'Solado',
        stockUnit: 'par',
        inputUnit: 'stock',
        scalar: 1,
      });
    }

    return computePerPairConsumption(sources, sizes);
  }, [form, sizes, sheetMaterials, componentSheets, products, groups, strapCatalog, soleSpecs]);

  const sizeKeys = sizes.map(String);

  return (
    <div className="md:col-span-2 rounded-lg border border-border/60 bg-muted/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/60">
        <Calculator className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Consumo por par</span>
        <span className="text-xs text-muted-foreground">
          média da grade · sem forração, fibra e químicos
        </span>
        <div className="ml-auto flex items-center gap-1">
          {rows.length > 0 && sizeKeys.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <CaretDown className="h-3.5 w-3.5 mr-1" /> : <CaretRight className="h-3.5 w-3.5 mr-1" />}
              Ver por numeração
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenMaterials}>
            Editar em Materiais & Consumo
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Nenhum consumo cadastrado ainda. Preencha em <strong>Materiais & Consumo</strong>.
        </p>
      ) : !expanded ? (
        <ul className="divide-y divide-border/40">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="font-medium text-foreground truncate">{row.material}</span>
              <span className="text-xs text-muted-foreground truncate">{row.components.join(' + ')}</span>
              {row.widthMissing && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-amber-600"
                  title="Falta a largura na ficha de componente — sem ela não dá pra converter dm² em metros."
                >
                  <Warning className="h-3.5 w-3.5" /> sem largura
                </span>
              )}
              <span className="ml-auto font-mono tabular-nums text-foreground whitespace-nowrap">
                {fmt(row.average)} <span className="text-muted-foreground">{row.unit}/par</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                <th className="px-2 py-1.5 text-left font-semibold">Un.</th>
                {sizeKeys.map((s) => <th key={s} className="px-2 py-1.5 text-right font-mono font-semibold">{s}</th>)}
                <th className="px-3 py-1.5 text-right font-semibold">Média</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">
                    {row.material}
                    {row.widthMissing && <Warning className="inline h-3.5 w-3.5 ml-1 text-amber-600" />}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{row.unit}/par</td>
                  {sizeKeys.map((s) => (
                    <td key={s} className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {row.perSize[s] ? fmt(row.perSize[s]) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{fmt(row.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
