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
import { formatCurrency, formatNumber } from '@/lib/utils';

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

/** Grade das linhas de grupo/família (setor tem layout próprio de card). */
const ROW = 'grid grid-cols-[22px_minmax(150px,1fr)_52px_104px_168px_92px] items-center gap-3';

/** Donut de % (conic-gradient) — vermelho (reservado) vs verde (livre), por valor. */
function Donut({ pct }: { pct: number }) {
  return (
    <div
      className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(hsl(var(--primary)) ${pct * 3.6}deg, rgb(34 197 94) 0deg)` }}
      role="img"
      aria-label={`${pct}% do valor reservado`}
    >
      <div className="absolute inset-[10px] rounded-full bg-card" />
      <span className="relative text-center leading-none">
        <span className="block font-display text-base text-foreground">{pct}%</span>
        <span className="block text-[7px] uppercase tracking-[0.12em] text-muted-foreground">reserv.</span>
      </span>
    </div>
  );
}

function ReservedBar({ m }: { m: NodeMetrics }) {
  if (m.mixedUnits || !m.unit) {
    return <span className="text-xs text-muted-foreground" title="Unidades mistas neste grupo — soma não faz sentido">—</span>;
  }
  const total = m.reserved + Math.max(0, m.available);
  const rp = total > 0 ? Math.round((m.reserved / total) * 100) : 0;
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex h-3.5 w-full overflow-hidden rounded-md bg-muted" title={`Reservado ${formatNumber(m.reserved, 0)} · Livre ${formatNumber(Math.max(0, m.available), 0)} ${m.unit}`}>
        <div className="bg-primary" style={{ width: `${rp}%` }} />
        <div className="bg-green-500" style={{ width: `${100 - rp}%` }} />
      </div>
      <div className="flex justify-between text-[9px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">{rp}% reserv.</span>
        <span>livre {formatNumber(Math.max(0, m.available), 0)} {m.unit}</span>
      </div>
    </div>
  );
}

function BelowMinBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
      <Warning className="h-3 w-3" weight="fill" />
      {count} abaixo mín
    </span>
  );
}

function KpiTile({ value, label, tone }: { value: string; label: string; tone?: 'money' | 'warn' }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-1.5 text-right sm:text-left">
      <span className={`block text-[15px] font-bold leading-tight tabular-nums ${tone === 'money' ? 'text-green-600' : tone === 'warn' ? 'text-destructive' : 'text-foreground'}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function DetailPanel({ group, items, onEditItem, onAddItem, canCreate }: {
  group: ProductGroup;
  items: ProductLite[];
  onEditItem?: (item: ProductLite) => void;
  onAddItem?: (group: ProductGroup) => void;
  canCreate: boolean;
}) {
  return (
    <div className="overflow-x-auto px-4 py-2">
      {items.length === 0 ? (
        <div className="py-2 text-xs text-muted-foreground">Nenhum item neste grupo.</div>
      ) : (
        <table className="w-full min-w-[540px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-semibold">
              <th className="text-left">Item / Cor</th>
              <th className="text-right">Saldo</th>
              <th className="text-right">Reserv.</th>
              <th className="text-right">Dispon.</th>
              <th className="text-right">Custo</th>
              <th className="text-right">Valor</th>
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
              const clickable = !!onEditItem;
              return (
                <tr
                  key={p.id}
                  className={`border-t border-border/60 [&>td]:px-2 [&>td]:py-1.5 ${clickable ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                  onClick={clickable ? () => onEditItem!(p) : undefined}
                >
                  <td className="text-left">
                    <span className="font-medium text-foreground">{p.name}</span>
                    {low && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-destructive/10 px-1 text-[10px] font-semibold text-destructive">↓ mín</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(qty, 0)} {p.unit}</td>
                  <td className="text-right tabular-nums"><span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{formatNumber(res, 0)}</span></td>
                  <td className="text-right tabular-nums"><span className="rounded bg-green-500/10 px-1.5 py-0.5 text-green-600">{formatNumber(disp, 0)}</span></td>
                  <td className="text-right tabular-nums">{formatCurrency(price)}</td>
                  <td className="text-right tabular-nums font-medium">{formatCurrency(qty * price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {onAddItem && canCreate && (
        <button
          type="button"
          onClick={() => onAddItem(group)}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
        >
          <Plus className="h-3 w-3" /> Adicionar item a {group.name}
        </button>
      )}
    </div>
  );
}

export default function GroupStockTree(props: Props) {
  const { groups, products, rollups, perm, selectedLeafIds, onToggleLeaf, onEdit, onManageItems, onDelete, onNewFamily, onNewSubgroup, onEditItem, onAddItem, filter, onClearFilter } = props;

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

  // % reservado POR VALOR por setor (Σ reservado×preço / Σ qtd×preço) — somável entre unidades.
  const sectorReservedPct = useMemo(() => {
    const secOf = new Map(groups.map(g => [g.id, g.sector || '—'] as const));
    const acc = new Map<string, { res: number; tot: number }>();
    for (const p of products) {
      if (!p.group_id) continue;
      const sec = secOf.get(p.group_id);
      if (!sec) continue;
      const price = Number(p.unit_price) || 0;
      const qty = Number(p.quantity) || 0;
      const res = Number(p.reserved_stock) || 0;
      const a = acc.get(sec) ?? { res: 0, tot: 0 };
      a.res += res * price;
      a.tot += qty * price;
      acc.set(sec, a);
    }
    const out = new Map<string, number>();
    for (const [sec, { res, tot }] of acc) out.set(sec, tot > 0 ? Math.round((res / tot) * 100) : 0);
    return out;
  }, [groups, products]);

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
    setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const metricsOf = (id: string): NodeMetrics =>
    byGroup.get(id) ?? { itemCount: 0, value: 0, belowMin: 0, reserved: 0, available: 0, unit: null, mixedUnits: false, isLeaf: true };

  const leafRow = (g: ProductGroup, depth: number) => {
    const m = metricsOf(g.id);
    const isOpen = openDetail === g.id;
    return (
      <div key={g.id} className="border-t border-border/60">
        <div className={`${ROW} px-3 py-2 hover:bg-muted/30 ${selectedLeafIds.has(g.id) ? 'bg-primary/5' : ''}`}>
          <div onClick={e => e.stopPropagation()} className="flex justify-center">
            {perm.canEdit && (
              <Checkbox checked={selectedLeafIds.has(g.id)} onCheckedChange={() => onToggleLeaf(g.id)} aria-label={`Selecionar ${g.name}`} />
            )}
          </div>
          <button type="button" onClick={() => setOpenDetail(isOpen ? null : g.id)} className="flex items-center gap-2 text-left" style={{ paddingLeft: depth * 16 }}>
            {isOpen ? <CaretDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <CaretRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
            <span className="truncate text-sm font-medium text-foreground">{g.name}</span>
            <BelowMinBadge count={m.belowMin} />
          </button>
          <div className="text-right text-sm tabular-nums text-muted-foreground">{m.itemCount}</div>
          <div className="text-right text-sm font-semibold tabular-nums">{formatCurrency(m.value)}</div>
          <div><ReservedBar m={m} /></div>
          <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerir itens" onClick={() => onManageItems(g)}>
              <Package className="h-3.5 w-3.5" />
            </Button>
            {perm.canEdit && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar grupo" onClick={() => onEdit(g)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {perm.canDelete && (
              <DeleteConfirmButton onConfirm={() => onDelete(g)} title="Excluir grupo?" size="h-7 w-7" iconSize="h-3.5 w-3.5" />
            )}
          </div>
        </div>
        {isOpen && (
          <div className="bg-muted/20">
            <DetailPanel group={g} items={itemsByGroup.get(g.id) ?? []} onEditItem={onEditItem} onAddItem={onAddItem} canCreate={perm.canCreate} />
          </div>
        )}
      </div>
    );
  };

  const familyBlock = (family: ProductGroup, children: ProductGroup[]) => {
    const m = metricsOf(family.id);
    const visibleChildren = f ? children.filter(leafMatches) : children;
    if (f && visibleChildren.length === 0) return null;
    const collapsed = f ? false : collapsedFamilies.has(family.id);
    return (
      <div key={family.id}>
        <div className={`${ROW} border-t border-border/60 bg-muted/40 px-3 py-2`}>
          <div />
          <button type="button" onClick={() => toggleSet(setCollapsedFamilies, family.id)} className="flex items-center gap-2 text-left">
            {collapsed ? <CaretRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <CaretDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {collapsed ? <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">{family.name}</span>
            <span className="inline-flex h-4 items-center gap-1 rounded bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
              <Layers className="h-2.5 w-2.5" />{children.length}
            </span>
            <BelowMinBadge count={m.belowMin} />
          </button>
          <div className="text-right text-xs tabular-nums text-muted-foreground">{m.itemCount}</div>
          <div className="text-right text-xs font-semibold tabular-nums">{formatCurrency(m.value)}</div>
          <div />
          <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
            {perm.canCreate && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" title="Novo subgrupo nesta família" onClick={() => onNewSubgroup(family)}>
                <Plus className="h-3 w-3" /> Subgrupo
              </Button>
            )}
            {perm.canEdit && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar família" onClick={() => onEdit(family)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {perm.canDelete && (
              <DeleteConfirmButton onConfirm={() => onDelete(family)} title="Excluir família? Os subgrupos viram soltos." size="h-7 w-7" iconSize="h-3.5 w-3.5" />
            )}
          </div>
        </div>
        {!collapsed && visibleChildren.map(c => leafRow(c, 1))}
      </div>
    );
  };

  const sectorBlocks = sectorTree
    .map(node => {
        const sm = bySector.get(node.sector) ?? { itemCount: 0, value: 0, belowMin: 0 };
        const visibleLoose = f ? node.looseLeaves.filter(leafMatches) : node.looseLeaves;
        const visibleFamilies = f ? node.families.filter(fam => fam.children.some(leafMatches)) : node.families;
        if (f && visibleLoose.length === 0 && visibleFamilies.length === 0) return null;
        const collapsed = f ? false : collapsedSectors.has(node.sector);
        const resPct = sectorReservedPct.get(node.sector) ?? 0;
        return (
          <div key={node.sector} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Cabeçalho do setor — card com donut + mini-KPIs */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-gradient-to-r from-primary/[0.04] to-transparent px-4 py-3">
              <Donut pct={resPct} />
              <button type="button" onClick={() => toggleSet(setCollapsedSectors, node.sector)} className="flex items-center gap-2.5 text-left">
                {collapsed ? <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <CaretDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm text-primary-foreground">
                  {sectorLabel(node.sector).slice(0, 2).toUpperCase()}
                </span>
                <span className="font-display text-2xl text-foreground">{sectorLabel(node.sector)}</span>
              </button>
              <div className="flex flex-wrap gap-2">
                <KpiTile value={String(sm.itemCount)} label="itens" />
                <KpiTile value={formatCurrency(sm.value)} label="em estoque" tone="money" />
                <KpiTile value={String(sm.belowMin)} label="abaixo mín" tone={sm.belowMin > 0 ? 'warn' : undefined} />
                <KpiTile value={String(node.families.length)} label="famílias" />
              </div>
              <div className="ml-auto">
                {perm.canCreate && (
                  <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" title={`Nova família em ${sectorLabel(node.sector)}`} onClick={() => onNewFamily(node.sector)}>
                    <Plus className="h-3.5 w-3.5" /> Família
                  </Button>
                )}
              </div>
            </div>

            {/* Corpo — famílias e grupos (rola horizontalmente em telas estreitas) */}
            {!collapsed && (
              <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                  {visibleFamilies.map(fam => familyBlock(fam.family, fam.children))}
                  {visibleLoose.map(l => leafRow(l, 0))}
                  {node.families.length === 0 && node.looseLeaves.length === 0 && (
                    <div className="px-3 py-4 text-xs text-muted-foreground">Setor sem grupos.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
    })
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {sectorBlocks.length > 0 ? (
        sectorBlocks
      ) : f ? (
        <EmptyState
          size="sm"
          icon={MagnifyingGlass}
          title={`Nenhum resultado para "${f}"`}
          action={onClearFilter ? (
            <Button variant="outline" size="sm" onClick={onClearFilter}>Limpar busca</Button>
          ) : undefined}
        />
      ) : null}
    </div>
  );
}
