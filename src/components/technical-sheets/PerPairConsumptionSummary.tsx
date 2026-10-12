/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { Calculator, CaretDown, CaretRight, Warning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  getPreferredComponentSheet,
  LINEAR_UNITS,
  PLATE_UNITS,
  normalizeText,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';
import {
  computePerPairConsumption,
  summarizePerPairCost,
  type PerPairCost,
  type PerPairPriceCandidate,
  type PerPairPriceSource,
  type PerPairRow,
  type PerPairSource,
} from '@/lib/sheetPerPairConsumption';
import { resolveConsumptionUnit } from '@/lib/materialUnit';
import { isHeterogeneousGroup, materialIdentity } from '@/lib/materialIdentity';
import { strapIdentityBasis } from '@/lib/strapIdentity';
import { strapMaterialMode } from '@/lib/strapMaterialPolicy';
import { cn } from '@/lib/utils';

interface StrapCatalogLike {
  types?: Array<{ id: string; name: string }>;
  measures?: Array<{ id: string; strap_type_id: string; display_name: string }>;
  variants?: Array<{ measure_id: string; base_group_id: string; finished_product_id: string }>;
}

interface Props {
  form: any;
  sizes: Array<string | number>;
  sheetMaterials: any[];
  componentSheets: any[];
  products: any[];
  groups: any[];
  strapCatalog?: StrapCatalogLike | null;
  /** Napa-base das tiras feitas da napa do modelo (`referenceStrapBaseGroups`, já descascada). */
  referenceBaseGroups?: Array<{ id: string; name: string }>;
  /** Mesma regra do Hub de Tiras (`can_see_financial_values`): sem ela, só consumo. */
  canSeeCost: boolean;
  onOpenMaterials: () => void;
}

const fmt = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: value >= 10 ? 2 : 4 }).format(value);
const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const brlUnit = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value);
const decimal2 = (value: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** Nota sob o nome do material: por que o custo é estimado, ou a faixa entre cores. */
function costNote(cost: PerPairCost): string | null {
  if (cost.status === 'estimated') {
    return cost.missingScope
      ? `estimado pelo grupo — sem preço na ${cost.missingScope}`
      : 'estimado pelo grupo';
  }
  if (cost.status === 'ok' && cost.perPairMin != null && cost.perPairMax != null) {
    return `${brl(cost.perPairMin)}–${decimal2(cost.perPairMax)} conforme a cor`;
  }
  return null;
}

function CostCell({ cost }: { cost: PerPairCost }) {
  if (cost.perPair != null) return <>{brl(cost.perPair)}</>;
  return (
    <span className="text-xs text-amber-600">
      {cost.status === 'no_width' ? 'sem largura' : 'sem preço'}
    </span>
  );
}

/**
 * Consumo e custo POR PAR da ficha, agrupado por material (spec
 * `consumo-por-par-na-ficha`, revisão 2). Somente leitura — a edição continua
 * na aba Materiais & Consumo. Só o que é exclusivo do modelo: sem solado,
 * palmilha, cola, linha, embalagem, forração e fibra (dono, 10–11/10/2026).
 */
export default function PerPairConsumptionSummary({
  form, sizes, sheetMaterials, componentSheets, products, groups, strapCatalog,
  referenceBaseGroups = [], canSeeCost, onOpenMaterials,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const groupById = new Map<string, any>((groups || []).map((g: any) => [g.id, g]));
    const productById = new Map<string, any>((products || []).map((p: any) => [p.id, p]));
    const activeByGroup = new Map<string, any[]>();
    for (const p of products || []) {
      if (!p?.group_id || p.active === false) continue;
      const list = activeByGroup.get(p.group_id) || [];
      list.push(p);
      activeByGroup.set(p.group_id, list);
    }
    const asCandidates = (list: any[]): PerPairPriceCandidate[] =>
      list.filter(Boolean).map((p: any) => ({ unit: p.unit, unitPrice: p.unit_price }));
    /**
     * Cada SKU ativo do grupo é uma "cor" candidata ao preço. Grupo com mais de
     * um material (`COMPONENTES DIVERSOS`: fivela, ilhós, binóculo…) não é
     * "cores do mesmo material": aí só contam os SKUs com a identidade do
     * material de referência — nunca a mediana de peças diferentes.
     */
    const groupCandidates = (groupId?: string | null, reference?: any) => {
      if (!groupId) return [];
      const list = activeByGroup.get(groupId) || [];
      if (!isHeterogeneousGroup(list)) return asCandidates(list);
      if (!reference?.name) return [];
      const identity = materialIdentity(reference);
      return asCandidates(list.filter((p: any) => materialIdentity(p) === identity));
    };
    const groupName = (groupId?: string | null) => (groupId ? groupById.get(groupId)?.name : null) || null;

    const groupByName = (name?: string | null) => {
      const key = normalizeText(name);
      return key ? (groups || []).find((g: any) => normalizeText(g.name) === key) : null;
    };
    /**
     * SKU que representa o grupo (unidade de estoque + setor). Pela unidade da
     * MAIORIA das cores — não o primeiro da lista, que vem por `updated_at` e
     * trocava a unidade do cabedal a cada débito numa cor em outra unidade
     * (NAPA SOFT + MASSABOX: 4 em `m`, 1 em `un`). Material de área prefere a
     * unidade física (m/placa), que é a que a ficha de componente converte.
     */
    const productOfGroup = (groupId?: string | null, preferPhysical = false) => {
      if (!groupId) return null;
      const withUnit = (activeByGroup.get(groupId) || []).filter((p: any) => (p.unit || '').trim());
      if (withUnit.length === 0) return (products || []).find((p: any) => p.group_id === groupId) || null;
      const isPhysical = (p: any) => {
        const u = normalizeText(p.unit);
        return LINEAR_UNITS.has(u) || PLATE_UNITS.has(u);
      };
      const physical = withUnit.filter(isPhysical);
      const pool = preferPhysical && physical.length > 0 ? physical : withUnit;
      const counts = new Map<string, number>();
      for (const p of pool) {
        const unit = normalizeText(p.unit);
        counts.set(unit, (counts.get(unit) || 0) + 1);
      }
      const [topUnit] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return pool.find((p: any) => normalizeText(p.unit) === topUnit) || pool[0];
    };
    const sheetForGroup = (groupId: string | undefined, unit: string): ComponentSheetCandidate | null => {
      if (!groupId) return null;
      const candidates = (componentSheets || []).filter((cs: any) =>
        cs.group_id === groupId || cs.products?.group_id === groupId);
      const u = normalizeText(unit);
      const mode = LINEAR_UNITS.has(u) ? 'linear' : PLATE_UNITS.has(u) ? 'plate' : 'any';
      return getPreferredComponentSheet(candidates, { mode });
    };
    /** Material escolhido por GRUPO (cabedal, material extra). */
    const groupSource = (
      component: string,
      name: string,
      scalar: number,
      perSize: Record<string, unknown> | null | undefined,
      preferPhysical: boolean,
      groupId?: string | null,
    ): PerPairSource | null => {
      // O UUID gravado na ficha vence o nome (nome é texto livre legado).
      const group: any = (groupId ? groupById.get(groupId) : null) || groupByName(name);
      const product: any = productOfGroup(group?.id, preferPhysical);
      const stockUnit = (product?.unit || group?.consumption_unit || 'un').toString();
      const u = normalizeText(stockUnit);
      // MESMA fonte do rótulo da grade na aba Materiais e do motor de consumo.
      // Antes isto era uma CÓPIA do critério antigo (`dimensions_width > 0` do
      // GRUPO) + `forceArea = true` fixo no Cabedal — então este card dizia dm²
      // para o ELÁSTICO ESPECIAL G (fita de 25 mm vendida a metro) mesmo depois
      // de a grade e o motor pararem de converter. Ver materialUnit.ts.
      const isArea = u === 'dm²' || u === 'dm2'
        || resolveConsumptionUnit(group?.name || name, groups, products, componentSheets, {
          groupId: group?.id ?? groupId ?? null,
        }).basis === 'roll_area';
      return {
        component,
        material: group?.name || name,
        category: product?.category ?? null,
        stockUnit,
        inputUnit: isArea ? 'dm2' : 'stock',
        componentSheet: sheetForGroup(group?.id, stockUnit),
        scalar: Number(scalar) || 0,
        perSize,
        price: group ? { candidates: groupCandidates(group.id, product), missingScope: group.name } : null,
      };
    };

    /** "TIRA OVERLOCK 5 MM · NAPA SOFT · PRETO" → "TIRAOVERLOCK5MMNAPASOFTPRETO". */
    const squash = (value?: string | null) =>
      (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    /**
     * SKUs de um grupo de estoque de tira que são DESTA tira. O grupo mistura
     * nomenclaturas ("TIRA OVERLOCK 5MM X" × "TIRA OVERLOCK 5 MM · NAPA SOFT · X")
     * e até outra tira (`Tira chata 8mm` guarda ELÁSTICO FORRADO 7 MM), então
     * casa pelo prefixo tipo+medida; sem nenhum casamento, só aceita o grupo
     * inteiro se ele for de um material só.
     */
    const strapGroupSkus = (groupId: string | null | undefined, key: string) => {
      if (!groupId) return [];
      const list = activeByGroup.get(groupId) || [];
      const matched = key ? list.filter((p: any) => squash(p.name).startsWith(key)) : [];
      if (matched.length > 0) return matched;
      return isHeterogeneousGroup(list) ? [] : list;
    };

    /**
     * Preço da tira. Comprada pronta: SKUs do grupo da identidade (o grupo É a
     * tira — os nomes ali são só a cor). Feita da napa: SKUs acabados das
     * variantes do Hub para a medida × napa-base do modelo; sem preço ali →
     * todas as cores daquela medida, de qualquer napa (estimado).
     */
    const strapPrice = (strap: any, measureKey: string): PerPairPriceSource => {
      if (strapIdentityBasis(strap) === 'finished_product_group') {
        const identityGroupId = strap.identity_group_id || strap.group_id || null;
        return {
          candidates: asCandidates(identityGroupId ? activeByGroup.get(identityGroupId) || [] : []),
          missingScope: groupName(identityGroupId),
        };
      }
      // Linha legada sem medida: o grupo gravado na linha É o estoque da tira.
      if (!strap.measure_id) {
        return {
          candidates: asCandidates(strapGroupSkus(strap.group_id, squash(groupName(strap.group_id)))),
          missingScope: groupName(strap.group_id),
        };
      }
      const measureVariants = (strapCatalog?.variants || []).filter((v) => v.measure_id === strap.measure_id);
      const mode = strapMaterialMode(strap);
      const allowed: string[] = Array.isArray(strap.allowed_material_group_ids) ? strap.allowed_material_group_ids : [];
      const baseGroups: Array<{ id: string; name: string | null }> =
        mode === 'fixed_group' && strap.material_group_id
          ? [{ id: strap.material_group_id, name: groupName(strap.material_group_id) }]
          : mode === 'select_on_order' && allowed.length > 0
            ? allowed.map((id) => ({ id, name: groupName(id) }))
            : referenceBaseGroups.map((g) => ({ id: g.id, name: g.name }));
      const baseIds = new Set(baseGroups.map((g) => g.id));
      const exact = measureVariants
        .filter((v) => baseIds.has(v.base_group_id))
        .map((v) => productById.get(v.finished_product_id))
        .filter((p: any) => p && p.active !== false);
      // Estimado: a mesma medida em qualquer napa — variantes do Hub + SKUs
      // dos grupos de estoque dessa tira (inclui os legados sem variante).
      const fallback = new Map<string, any>();
      const strapGroupIds = new Set<string>();
      for (const v of measureVariants) {
        const product = productById.get(v.finished_product_id);
        if (!product || product.active === false) continue;
        fallback.set(product.id, product);
        if (product.group_id) strapGroupIds.add(product.group_id);
      }
      if (strap.group_id) strapGroupIds.add(strap.group_id);
      for (const groupId of strapGroupIds) {
        for (const product of strapGroupSkus(groupId, measureKey)) fallback.set(product.id, product);
      }
      return {
        candidates: asCandidates(exact),
        fallbackCandidates: asCandidates([...fallback.values()]),
        missingScope: baseGroups.map((g) => g.name).filter(Boolean).join(' / ') || null,
      };
    };

    const sources: PerPairSource[] = [];
    const push = (s: PerPairSource | null) => { if (s) sources.push(s); };

    if ((form.upper_material || '').trim()) {
      push(groupSource(
        'Cabedal', form.upper_material, form.upper_consumption, form.upper_consumption_per_size, true,
        form.upper_material_group_id,
      ));
    }
    for (const extra of form.components_accessories || []) {
      if (!extra?.mandatory || !(extra.material || '').trim()) continue;
      push(groupSource('Material extra', extra.material, extra.consumption, extra.consumption_per_size, false));
    }
    // Palmilha e solado são básicos comuns a todo modelo — fora do resumo (dono, 11/10/2026).
    for (const comp of form.direct_components || []) {
      if (!comp?.product_id) continue;
      const product: any = productById.get(comp.product_id);
      push({
        component: 'Componente',
        material: product?.name || comp.product_name || 'Componente',
        category: product?.category ?? null,
        stockUnit: (product?.unit || comp.unit || 'un').toString(),
        inputUnit: 'stock',
        scalar: Number(comp.quantity) || 0,
        // O componente aponta um SKU; sem preço nele, as cores do grupo estimam.
        price: product
          ? {
            candidates: asCandidates([product]),
            fallbackCandidates: groupCandidates(product.group_id, product),
            missingScope: product.name,
          }
          : null,
      });
    }
    // BOM: só linhas compartilhadas (material_variant_id NULL); as da variante são override.
    for (const m of sheetMaterials || []) {
      if (m.material_variant_id) continue;
      const unit = (m.products?.unit || 'un').toString();
      const cs = (componentSheets || []).find((c: any) => c.product_id === m.product_id) || null;
      const u = normalizeText(unit);
      const bomGroupId = m.product_groups?.id || m.products?.group_id || null;
      const bomCandidates = groupCandidates(bomGroupId, m.products);
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
        price: {
          candidates: bomCandidates.length > 0 ? bomCandidates : asCandidates([m.products]),
          missingScope: m.product_groups?.name || m.products?.name || null,
        },
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
          price: strapPrice(strap, measure ? squash(`${type?.name || ''}${measure.display_name}`) : ''),
        });
      }
    }

    return computePerPairConsumption(sources, sizes);
  }, [form, sizes, sheetMaterials, componentSheets, products, groups, strapCatalog, referenceBaseGroups]);

  const summary = useMemo(() => summarizePerPairCost(rows), [rows]);
  const sizeKeys = sizes.map(String);
  const rowGrid = canSeeCost
    ? 'grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_7rem_8rem_6.5rem]'
    : 'grid-cols-[minmax(0,1fr)_auto]';

  const renderRow = (row: PerPairRow) => {
    const note = canSeeCost ? costNote(row.cost) : null;
    return (
      <li key={row.key} className={cn('grid items-baseline gap-x-3 px-4 py-2 text-sm', rowGrid)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{row.material}</span>
            <span className="text-xs text-muted-foreground">{row.components.join(' + ')}</span>
            {row.widthMissing && (
              <span
                className="inline-flex items-center gap-1 text-xs text-amber-600"
                title="Falta a largura na ficha de componente — sem ela não dá pra converter dm² em metros."
              >
                <Warning className="h-3.5 w-3.5" /> sem largura
              </span>
            )}
            {canSeeCost && row.cost.status === 'estimated' && (
              <span className="rounded bg-amber-500/10 px-1.5 text-xs text-amber-600">estimado</span>
            )}
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <span className="font-mono tabular-nums text-right text-foreground whitespace-nowrap">
          {fmt(row.average)} <span className="text-muted-foreground">{row.unit}/par</span>
        </span>
        {canSeeCost && (
          <>
            <span className="hidden sm:block font-mono tabular-nums text-right text-xs text-muted-foreground whitespace-nowrap">
              {row.cost.unitPrice != null ? `${brlUnit(row.cost.unitPrice)}/${row.unit}` : '—'}
            </span>
            <span className="font-mono tabular-nums text-right text-foreground whitespace-nowrap">
              <CostCell cost={row.cost} />
            </span>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">{canSeeCost ? 'Consumo e custo por par' : 'Consumo por par'}</h3>
        <span className="text-xs text-muted-foreground">média da grade · só o que é exclusivo do modelo</span>
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
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Nenhum consumo cadastrado ainda. Preencha em <strong>Materiais & Consumo</strong>.
        </p>
      ) : !expanded ? (
        <>
          <div className={cn('grid gap-x-3 px-4 pt-2 pb-1 text-xs text-muted-foreground', rowGrid)}>
            <span>Material</span>
            <span className="text-right">Consumo</span>
            {canSeeCost && (
              <>
                <span className="hidden sm:block text-right">Preço</span>
                <span className="text-right">Custo/par</span>
              </>
            )}
          </div>
          <ul className="divide-y divide-border/40 border-t border-border/40">
            {rows.map(renderRow)}
          </ul>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground">
                <th className="px-4 py-1.5 text-left font-semibold">Material</th>
                <th className="px-2 py-1.5 text-left font-semibold">Un.</th>
                {sizeKeys.map((s) => <th key={s} className="px-2 py-1.5 text-right font-mono font-semibold">{s}</th>)}
                <th className="px-3 py-1.5 text-right font-semibold">Média</th>
                {canSeeCost && <th className="px-4 py-1.5 text-right font-semibold">R$/par</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-1.5 font-medium text-foreground whitespace-nowrap">
                    {row.material}
                    {row.widthMissing && <Warning className="inline h-3.5 w-3.5 ml-1 text-amber-600" />}
                    {canSeeCost && row.cost.status === 'estimated' && (
                      <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 font-normal text-amber-600">estimado</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{row.unit}/par</td>
                  {sizeKeys.map((s) => (
                    <td key={s} className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {row.perSize[s] ? fmt(row.perSize[s]) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{fmt(row.average)}</td>
                  {canSeeCost && (
                    <td className="px-4 py-1.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap">
                      <CostCell cost={row.cost} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSeeCost && rows.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-b-xl border-t border-border/60 bg-muted/30 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Total exclusivo do modelo</p>
            <p className="text-xs text-muted-foreground">sem solado, palmilha, cola, linha, embalagem, forração e fibra</p>
          </div>
          <div className="ml-auto text-right">
            <p className="font-mono tabular-nums text-base font-bold text-foreground whitespace-nowrap">
              {brl(summary.total)}<span className="text-xs font-normal text-muted-foreground">/par</span>
            </p>
            {summary.missingCount > 0 && (
              <p className="text-xs text-amber-600">
                +{summary.missingCount} {summary.missingCount === 1 ? 'item' : 'itens'} sem preço — total incompleto
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
