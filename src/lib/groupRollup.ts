/**
 * Rollup de métricas de estoque sobre a árvore Setor → Família → Grupo.
 * Ver specs/grupos-estoque.md.
 *
 * - Grupo-folha: métricas vêm direto do read model (get_group_stock_rollups).
 * - Família (container): soma dos grupos-folha descendentes.
 * - Setor: soma dos grupos-folha do setor (denominador comum = R$).
 *
 * A barra "reservado vs livre" só faz sentido no nível Grupo-folha e apenas
 * quando a unidade é única (senão `unit=null`/`mixedUnits=true` → UI mostra "—").
 */
import type { ProductGroup } from '@/hooks/useGroups';
import type { GroupStockRollup } from '@/hooks/useGroupOrganization';
import { SECTOR_OPTIONS } from '@/lib/categoryFromGroup';

export type NodeMetrics = {
  itemCount: number;
  value: number;
  belowMin: number;
  /** leaf-only: reservado / livre para a barra. */
  reserved: number;
  available: number;
  unit: string | null;
  mixedUnits: boolean;
  isLeaf: boolean;
};

export type SectorMetrics = { itemCount: number; value: number; belowMin: number };

const ZERO_LEAF = (): NodeMetrics => ({
  itemCount: 0, value: 0, belowMin: 0, reserved: 0, available: 0, unit: null, mixedUnits: false, isLeaf: true,
});

export function buildGroupMetrics(groups: ProductGroup[], rollups: Map<string, GroupStockRollup>) {
  const childrenByParent = new Map<string | null, ProductGroup[]>();
  for (const g of groups) {
    const k = g.parent_group_id ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(g);
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const isLeaf = (id: string) => groupsById.get(id)?.is_family !== true && (childrenByParent.get(id)?.length ?? 0) === 0;

  const byGroup = new Map<string, NodeMetrics>();
  const visiting = new Set<string>(); // guarda anti-ciclo (dados corrompidos)

  function metricsOf(g: ProductGroup): NodeMetrics {
    const cached = byGroup.get(g.id);
    if (cached) return cached;
    if (visiting.has(g.id)) return ZERO_LEAF();
    visiting.add(g.id);

    const kids = childrenByParent.get(g.id) ?? [];
    let m: NodeMetrics;
    if (kids.length === 0 && g.is_family !== true) {
      const r = rollups.get(g.id);
      m = r
        ? {
            itemCount: Number(r.item_count) || 0,
            value: Number(r.stock_value) || 0,
            belowMin: Number(r.below_min_count) || 0,
            reserved: Number(r.reserved) || 0,
            available: Number(r.available) || 0,
            unit: Number(r.unit_count) === 1 ? r.stock_unit : null,
            mixedUnits: Number(r.unit_count) > 1,
            isLeaf: true,
          }
        : ZERO_LEAF();
    } else {
      let itemCount = 0, value = 0, belowMin = 0;
      for (const c of kids) {
        const cm = metricsOf(c);
        itemCount += cm.itemCount; value += cm.value; belowMin += cm.belowMin;
      }
      m = { itemCount, value, belowMin, reserved: 0, available: 0, unit: null, mixedUnits: false, isLeaf: false };
    }
    visiting.delete(g.id);
    byGroup.set(g.id, m);
    return m;
  }
  for (const g of groups) metricsOf(g);

  const bySector = new Map<string, SectorMetrics>();
  for (const g of groups) {
    if (!isLeaf(g.id)) continue; // soma só as folhas — famílias já são a soma delas
    const m = byGroup.get(g.id)!;
    const sec = g.sector || '—';
    const s = bySector.get(sec) ?? { itemCount: 0, value: 0, belowMin: 0 };
    s.itemCount += m.itemCount; s.value += m.value; s.belowMin += m.belowMin;
    bySector.set(sec, s);
  }

  return { byGroup, bySector, childrenByParent, isLeaf };
}

export type SectorNode = {
  sector: string;
  families: { family: ProductGroup; children: ProductGroup[] }[];
  looseLeaves: ProductGroup[];
};

/** Monta a árvore por setor (setor = raiz renderizada), na ordem de SECTOR_OPTIONS. */
export function buildSectorTree(groups: ProductGroup[]): SectorNode[] {
  const childrenByParent = new Map<string | null, ProductGroup[]>();
  for (const g of groups) {
    const k = g.parent_group_id ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(g);
  }
  const byName = (a: ProductGroup, b: ProductGroup) => a.name.localeCompare(b.name, 'pt-BR');
  const roots = (childrenByParent.get(null) ?? []).slice().sort(byName);

  const sectorMap = new Map<string, SectorNode>();
  const ensure = (sector: string): SectorNode => {
    let n = sectorMap.get(sector);
    if (!n) { n = { sector, families: [], looseLeaves: [] }; sectorMap.set(sector, n); }
    return n;
  };

  // Os nove setores fazem parte do vocabulário industrial, mesmo quando ainda
  // não possuem cadastro. Mantê-los visíveis dá uma porta clara para criar a
  // primeira família e evita que recursos fabris “desapareçam” da organização.
  SECTOR_OPTIONS.forEach((option) => ensure(option.value));

  for (const root of roots) {
    const kids = (childrenByParent.get(root.id) ?? []).slice().sort(byName);
    const node = ensure(root.sector || '—');
    if (root.is_family === true || kids.length > 0) node.families.push({ family: root, children: kids });
    else node.looseLeaves.push(root);
  }

  // Ordena setores por SECTOR_OPTIONS; setores fora da lista vão ao fim (alfabético).
  const order = SECTOR_OPTIONS.map(o => o.value);
  const present = Array.from(sectorMap.keys());
  present.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return present.map(s => sectorMap.get(s)!);
}
