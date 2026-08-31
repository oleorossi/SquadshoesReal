import { useMemo, useState } from 'react';
import {
  CaretDown, CaretRight, MagnifyingGlass, Package, PencilSimple as Pencil, Plus, Warning,
  Stack as Layers, Folder, FolderOpen,
} from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import type { ProductGroup } from '@/hooks/useGroups';
import type { GroupStockRollup } from '@/hooks/useGroupOrganization';
import { buildGroupMetrics, buildSectorTree, type NodeMetrics } from '@/lib/groupRollup';
import { sectorLabel } from '@/lib/categoryFromGroup';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { formatCurrency, formatMoney, formatNumber } from '@/lib/utils';

export type ProductLite = {
  id: string; name: string; sku?: string | null; color?: string | null;
  group_id: string | null; quantity: number | null; reserved_stock: number | null;
  unit: string | null; unit_price: number | null; min_stock: number | null;
};

interface Props {
  groups: ProductGroup[];
  products: ProductLite[];
  rollups: Map<string, GroupStockRollup>;
  perm: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
  canManageItems: boolean;
  selectedLeafIds: Set<string>;
  onToggleLeaf: (id: string) => void;
  onEdit: (g: ProductGroup) => void;
  onManageItems: (g: ProductGroup) => void;
  onDelete: (g: ProductGroup) => void;
  onNewFamily: (sector: string) => void;
  onNewSubgroup: (family: ProductGroup) => void;
  onEditItem?: (item: ProductLite) => void;
  onAddItem?: (group: ProductGroup) => void;
  filter?: string;
  /** Limpa a busca do host — usado no empty state de resultado zero. */
  onClearFilter?: () => void;
}

/**
 * Grade da ficha. No celular nome e ações ocupam duas linhas; as métricas ficam
 * resumidas sob o nome. A partir de md vira a régua tabular completa.
 */
const ROW = 'grid grid-cols-[22px_minmax(0,1fr)] items-center gap-x-3 md:grid-cols-[22px_minmax(180px,1fr)_52px_118px_minmax(150px,210px)_136px]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

function BelowMinBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-destructive">
      <Warning className="h-3 w-3" weight="fill" />
      {count} abaixo do mín.
    </span>
  );
}

function DocumentMetric({ value, label, danger = false }: { value: string; label: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col border-l border-foreground/15 pl-3 first:border-l-0 first:pl-0 sm:first:border-l sm:first:pl-3">
      <dt className="order-2 mt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={`order-1 whitespace-nowrap font-mono text-xs font-semibold tabular-nums sm:text-sm ${danger ? 'text-destructive' : 'text-foreground'}`}>{value}</dd>
    </div>
  );
}

/**
 * Régua de reserva: a largura visual é limitada a 100%, mas o número nunca é
 * limitado. Assim 229% continua legível e não dá uma segunda volta enganosa,
 * como acontecia no antigo conic-gradient.
 */
function ReservationRuler({ pct, basis, compact = false }: { pct: number; basis: string; compact?: boolean }) {
  const safePct = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  const over = safePct > 100;
  const width = Math.min(100, safePct);
  return (
    <div className="min-w-0" role="img" aria-label={`${formatNumber(safePct, 0)}% reservado, calculado ${basis}`}>
      {!compact && (
        <div className="mb-1 flex justify-between font-mono text-[8px] text-muted-foreground" aria-hidden="true">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span>
        </div>
      )}
      <div className={`relative overflow-hidden border border-foreground/20 bg-muted/40 ${compact ? 'h-2' : 'h-3'}`}>
        <div className={`h-full ${over ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${width}%` }} />
        <span className="absolute inset-y-0 left-1/4 border-l border-background/70" />
        <span className="absolute inset-y-0 left-1/2 border-l border-background/70" />
        <span className="absolute inset-y-0 left-3/4 border-l border-background/70" />
      </div>
      <div className={`mt-1 flex items-center justify-between gap-2 font-mono ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
        <span className={over ? 'font-semibold text-destructive' : 'font-semibold text-foreground'}>{formatNumber(safePct, 0)}% reservado</span>
        <span className="truncate text-muted-foreground">{over ? 'reserva supera o saldo' : basis}</span>
      </div>
    </div>
  );
}

function ReservedBar({ m }: { m: NodeMetrics }) {
  if (m.mixedUnits || !m.unit) {
    return <span className="font-mono text-[10px] text-muted-foreground" title="Unidades mistas neste grupo — soma não faz sentido">UNIDADES MISTAS</span>;
  }
  const stock = m.reserved + m.available;
  const pct = stock > 0 ? (m.reserved / stock) * 100 : m.reserved > 0 ? 100 : 0;
  return <ReservationRuler pct={pct} basis={`por quantidade · livre ${formatNumber(Math.max(0, m.available), 0)} ${m.unit}`} compact />;
}

function DetailPanel({ group, items, onEditItem, onAddItem, canCreate }: {
  group: ProductGroup;
  items: ProductLite[];
  onEditItem?: (item: ProductLite) => void;
  onAddItem?: (group: ProductGroup) => void;
  canCreate: boolean;
}) {
  return (
    <div className="border-t border-foreground/15 bg-muted/20 px-3 py-3 sm:px-5">
      {items.length === 0 ? (
        <div className="py-2 text-xs text-muted-foreground">Nenhum item cadastrado neste grupo.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-xs">
            <thead>
              <tr className="border-b border-foreground/30 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
                <th className="text-left">Material / cor</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">Reservado</th>
                <th className="text-right">Disponível</th>
                <th className="text-right">Custo unit.</th>
                <th className="text-right">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => {
                const qty = Number(p.quantity) || 0;
                const res = Number(p.reserved_stock) || 0;
                const disp = qty - res;
                const min = Number(p.min_stock) || 0;
                const low = min > 0 && disp < min;
                const price = Number(p.unit_price) || 0;
                return (
                  <tr key={p.id} className="group border-b border-foreground/10 last:border-b-0 hover:bg-background/70 focus-within:bg-background/70 [&>td]:px-2 [&>td]:py-2">
                    <td className="text-left">
                      {onEditItem ? (
                        <button type="button" onClick={() => onEditItem(p)} className={`flex max-w-full items-center gap-2 text-left font-medium text-foreground hover:text-primary ${FOCUS}`}>
                          <span className="truncate">{p.name}</span>
                          {low && <span className="shrink-0 border border-destructive/30 px-1 font-mono text-[8px] uppercase text-destructive">↓ mínimo</span>}
                        </button>
                      ) : (
                        <span className="font-medium text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="text-right font-mono tabular-nums">{formatNumber(qty, 0)} {p.unit}</td>
                    <td className="text-right font-mono tabular-nums text-primary">{formatNumber(res, 0)}</td>
                    <td className={`text-right font-mono font-semibold tabular-nums ${disp < 0 ? 'text-destructive' : 'text-foreground'}`}>{formatNumber(disp, 0)}</td>
                    <td className="text-right font-mono tabular-nums text-muted-foreground">{formatCurrency(price)}</td>
                    <td className="text-right font-mono font-semibold tabular-nums">{formatMoney(qty * price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {onAddItem && canCreate && (
        <button
          type="button"
          onClick={() => onAddItem(group)}
          className={`mt-3 inline-flex items-center gap-1.5 border border-dashed border-foreground/30 px-2.5 py-1.5 text-xs font-semibold text-primary hover:border-primary hover:bg-primary/5 ${FOCUS}`}
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar material em {group.name}
        </button>
      )}
    </div>
  );
}

export default function GroupStockTree(props: Props) {
  const { groups, products, rollups, perm, canManageItems, selectedLeafIds, onToggleLeaf, onEdit, onManageItems, onDelete, onNewFamily, onNewSubgroup, onEditItem, onAddItem, filter, onClearFilter } = props;

  const { byGroup, bySector } = useMemo(() => buildGroupMetrics(groups, rollups), [groups, rollups]);
  const sectorTree = useMemo(() => buildSectorTree(groups), [groups]);
  const itemsByGroup = useMemo(() => {
    const m = new Map<string, ProductLite[]>();
    for (const p of products) {
      if (!p.group_id) continue;
      if (!m.has(p.group_id)) m.set(p.group_id, []);
      m.get(p.group_id)!.push(p);
    }
    return m;
  }, [products]);

  const summary = useMemo(() => {
    let items = 0;
    let value = 0;
    let belowMin = 0;
    for (const m of bySector.values()) {
      items += m.itemCount;
      value += m.value;
      belowMin += m.belowMin;
    }
    return { items, value, belowMin };
  }, [bySector]);

  const f = (filter ?? '').trim();
  const leafMatches = (g: ProductGroup): boolean => {
    if (!f) return true;
    const items = itemsByGroup.get(g.id) ?? [];
    return searchMatchesAllTerms(f, g.name, ...items.flatMap(p => [p.name, p.sku, p.color]));
  };

  const [collapsedSectors, setCollapsedSectors] = useState<Set<string>>(new Set());
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const metricsOf = (id: string): NodeMetrics =>
    byGroup.get(id) ?? { itemCount: 0, value: 0, belowMin: 0, reserved: 0, available: 0, unit: null, mixedUnits: false, isLeaf: true };

  const leafRow = (g: ProductGroup, depth: number) => {
    const m = metricsOf(g.id);
    const isOpen = openDetail === g.id;
    return (
      <div key={g.id} className={`border-t border-foreground/10 ${selectedLeafIds.has(g.id) ? 'bg-primary/5' : 'bg-card'}`}>
        <div className={`${ROW} px-3 py-2.5 transition-colors hover:bg-muted/25 sm:px-5`}>
          <div onClick={e => e.stopPropagation()} className="flex justify-center">
            {perm.canEdit && <Checkbox checked={selectedLeafIds.has(g.id)} onCheckedChange={() => onToggleLeaf(g.id)} aria-label={`Selecionar ${g.name}`} />}
          </div>
          <button type="button" onClick={() => setOpenDetail(isOpen ? null : g.id)} className={`flex min-w-0 items-start gap-2 text-left ${FOCUS}`} style={{ paddingLeft: depth * 14 }}>
            {isOpen ? <CaretDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> : <CaretRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{g.name}</span>
                <BelowMinBadge count={m.belowMin} />
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 font-mono text-[9px] uppercase text-muted-foreground md:hidden">
                <span>{m.itemCount} itens</span><span>{formatMoney(m.value)}</span>
                {m.unit && !m.mixedUnits && <span>livre {formatNumber(Math.max(0, m.available), 0)} {m.unit}</span>}
              </span>
            </span>
          </button>
          <div className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground md:block">{m.itemCount}</div>
          <div className="hidden text-right font-mono text-xs font-semibold tabular-nums md:block">{formatMoney(m.value)}</div>
          <div className="hidden md:block"><ReservedBar m={m} /></div>
          <div className="col-start-2 row-start-2 mt-1 flex justify-start gap-0.5 md:col-auto md:row-auto md:mt-0 md:justify-end" onClick={e => e.stopPropagation()}>
            {canManageItems && <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerir materiais" onClick={() => onManageItems(g)}><Package className="h-3.5 w-3.5" /></Button>}
            {perm.canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar grupo" onClick={() => onEdit(g)}><Pencil className="h-3.5 w-3.5" /></Button>}
            {perm.canDelete && <DeleteConfirmButton onConfirm={() => onDelete(g)} title="Excluir grupo?" size="h-7 w-7" iconSize="h-3.5 w-3.5" />}
          </div>
        </div>
        {isOpen && <DetailPanel group={g} items={itemsByGroup.get(g.id) ?? []} onEditItem={perm.canEdit ? onEditItem : undefined} onAddItem={onAddItem} canCreate={perm.canCreate} />}
      </div>
    );
  };

  const familyBlock = (family: ProductGroup, children: ProductGroup[]) => {
    const m = metricsOf(family.id);
    const familyMatches = Boolean(f && searchMatchesAllTerms(f, family.name));
    const visibleChildren = f && !familyMatches ? children.filter(leafMatches) : children;
    if (f && !familyMatches && visibleChildren.length === 0) return null;
    const collapsed = f ? false : collapsedFamilies.has(family.id);
    return (
      <div key={family.id}>
        <div className={`${ROW} border-t border-foreground/20 bg-muted/35 px-3 py-2 sm:px-5`}>
          <div />
          <button type="button" onClick={() => toggleSet(setCollapsedFamilies, family.id)} className={`flex min-w-0 items-center gap-2 text-left ${FOCUS}`}>
            {collapsed ? <CaretRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <CaretDown className="h-3.5 w-3.5 shrink-0 text-primary" />}
            {collapsed ? <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FolderOpen className="h-4 w-4 shrink-0 text-foreground" />}
            <span className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">{family.name}</span>
            <span className="inline-flex h-4 shrink-0 items-center gap-1 border border-foreground/15 bg-background px-1.5 font-mono text-[9px] text-muted-foreground"><Layers className="h-2.5 w-2.5" />{children.length}</span>
            <BelowMinBadge count={m.belowMin} />
          </button>
          <div className="hidden text-right font-mono text-[10px] tabular-nums text-muted-foreground md:block">{m.itemCount}</div>
          <div className="hidden text-right font-mono text-[10px] font-semibold tabular-nums md:block">{formatMoney(m.value)}</div>
          <div className="hidden md:block" />
          <div className="col-start-2 row-start-2 flex justify-start gap-0.5 md:col-auto md:row-auto md:justify-end" onClick={e => e.stopPropagation()}>
            {perm.canCreate && <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px] uppercase tracking-wide" title="Novo subgrupo nesta família" onClick={() => onNewSubgroup(family)}><Plus className="h-3 w-3" /> Subgrupo</Button>}
            {perm.canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar família" onClick={() => onEdit(family)}><Pencil className="h-3.5 w-3.5" /></Button>}
            {perm.canDelete && <DeleteConfirmButton onConfirm={() => onDelete(family)} title="Excluir família? Os subgrupos viram soltos." size="h-7 w-7" iconSize="h-3.5 w-3.5" />}
          </div>
        </div>
        {!collapsed && visibleChildren.map(c => leafRow(c, 1))}
      </div>
    );
  };

  const sectorBlocks = sectorTree.map(node => {
    const sm = bySector.get(node.sector) ?? { itemCount: 0, value: 0, belowMin: 0 };
    const visibleLoose = f ? node.looseLeaves.filter(leafMatches) : node.looseLeaves;
    const visibleFamilies = f
      ? node.families.filter((family) => searchMatchesAllTerms(f, family.family.name) || family.children.some(leafMatches))
      : node.families;
    if (f && visibleLoose.length === 0 && visibleFamilies.length === 0) return null;
    const collapsed = f ? false : collapsedSectors.has(node.sector);
    return (
      <section key={node.sector} className="border-t-2 border-foreground/70 first:border-t-0">
        <div className="grid gap-4 bg-card px-3 py-4 sm:px-5 lg:grid-cols-[minmax(240px,1fr)_minmax(330px,1.25fr)] lg:items-end">
          <div className="flex min-w-0 items-start gap-3">
            <button type="button" onClick={() => toggleSet(setCollapsedSectors, node.sector)} className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center border border-foreground/30 text-foreground hover:border-primary hover:text-primary ${FOCUS}`} aria-label={`${collapsed ? 'Expandir' : 'Recolher'} setor ${sectorLabel(node.sector)}`}>
              {collapsed ? <CaretRight className="h-4 w-4" /> : <CaretDown className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">Setor / aplicação principal</p>
              <h3 className="mt-1 truncate font-display text-2xl uppercase leading-none text-foreground sm:text-3xl">{sectorLabel(node.sector)}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <DocumentMetric value={String(sm.itemCount)} label="itens" />
                <DocumentMetric value={formatMoney(sm.value)} label="valor" />
                <DocumentMetric value={String(sm.belowMin)} label="abaixo mín." danger={sm.belowMin > 0} />
                <DocumentMetric value={String(node.families.length)} label="famílias" />
              </dl>
            </div>
          </div>
          <div className="flex justify-end">
            {perm.canCreate && <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" title={`Nova família em ${sectorLabel(node.sector)}`} onClick={() => onNewFamily(node.sector)}><Plus className="h-3.5 w-3.5" /> Família</Button>}
          </div>
        </div>

        {!collapsed && (
          <div>
            <div className={`${ROW} hidden border-t border-foreground/30 bg-foreground/[0.035] px-5 py-1.5 font-mono text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground md:grid`}>
              <span /><span>Família / grupo</span><span className="text-right">Itens</span><span className="text-right">Valor</span><span>Reserva / livre</span><span className="text-right">Ações</span>
            </div>
            {visibleFamilies.map(fam => familyBlock(fam.family, fam.children))}
            {visibleLoose.map(l => leafRow(l, 0))}
            {node.families.length === 0 && node.looseLeaves.length === 0 && <div className="border-t border-foreground/10 px-5 py-5 text-xs text-muted-foreground">Setor sem grupos cadastrados.</div>}
          </div>
        )}
      </section>
    );
  }).filter(Boolean);

  if (sectorBlocks.length === 0 && f) {
    return (
      <EmptyState
        size="sm"
        icon={MagnifyingGlass}
        title={`Nenhum resultado para "${f}"`}
        action={onClearFilter ? <Button variant="outline" size="sm" onClick={onClearFilter}>Limpar busca</Button> : undefined}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-sm border border-foreground/25 bg-card shadow-sm">
      <header className="relative border-b-2 border-foreground/70 px-3 py-4 sm:px-5">
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <div className="grid gap-5 pl-2 lg:grid-cols-[minmax(260px,0.85fr)_minmax(500px,1.4fr)] lg:items-end">
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-primary">Ficha geral · posição atual</p>
            <h2 className="mt-1 font-display text-3xl uppercase leading-none text-foreground sm:text-4xl">Controle de almoxarifado</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">Setores, famílias e grupos em uma folha contínua para conferência de saldo, reserva e reposição.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[0.75fr_0.75fr_1.5fr_0.8fr]">
            <DocumentMetric value={String(groups.length)} label="grupos" />
            <DocumentMetric value={String(summary.items)} label="itens" />
            <DocumentMetric value={formatMoney(summary.value)} label="valor total" />
            <DocumentMetric value={String(summary.belowMin)} label="abaixo mín." danger={summary.belowMin > 0} />
          </dl>
        </div>
      </header>
      {sectorBlocks}
    </div>
  );
}
