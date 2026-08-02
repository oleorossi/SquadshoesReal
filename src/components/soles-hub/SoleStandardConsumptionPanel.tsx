import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Trash as Trash2, FloppyDisk as Save, CircleNotch as Loader2, Copy,
  WarningCircle as AlertCircle, Ruler, Package as Package2,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/ui/search-input';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';
import {
  useSoleGroupItems, useSoleGroupRoles, useSetSoleGroupRole,
  useUpsertSoleGroupItem, useRemoveSoleGroupItem, useCopySoleGroupItems,
  useSoleGroupsWithItems, rolesForSole, ROLE_LABEL, ROLE_SOURCE,
  type SoleRole, type SoleGroupItemRow,
} from '@/hooks/useSoleGroupStandardConsumption';

/**
 * Consumo padrão do MODELO de solado — cadastro único.
 *
 * Substitui as abas "Itens Padrão" (sole_standard_materials, 0 linhas em
 * produção) e "Por Numeração" (sole_standard_items_consumption, parada desde
 * 07/06/2026), e absorve a edição de forração/palmilha que antes só existia por
 * SKU de cor.
 *
 * Duas naturezas de linha — ver useSoleGroupStandardConsumption.ts:
 *   PAPEL — quantidade aqui, material escolhido pela ficha/PV.
 *   ITEM  — material e quantidade, ambos do solado.
 *
 * Princípio de cadastro: UM número por linha. A grade por numeração só aparece
 * quando o usuário marca que o consumo varia com o tamanho — o cadastro antigo
 * obrigava 14 células até pra cola, e foi por isso que ficou parado.
 */

interface Props {
  soleGroupId: string | null;
  soleGroupName?: string;
  soleClassification?: 'tradicional' | 'palmilha_pronta' | 'conjugado' | null;
  isFachetado?: boolean | null;
}

type RoleDraft = { perPair: number; perSize: Record<string, number>; open: boolean; dirty: boolean };
type ItemDraft = { perPair: number; perSize: Record<string, number>; open: boolean; unit: string; dirty: boolean };

export default function SoleStandardConsumptionPanel({
  soleGroupId, soleGroupName, soleClassification, isFachetado,
}: Props) {
  const { data: items = [], isLoading: loadingItems } = useSoleGroupItems(soleGroupId);
  const { data: rolesData, isLoading: loadingRoles } = useSoleGroupRoles(soleGroupId);
  const setRole = useSetSoleGroupRole();
  const upsertItem = useUpsertSoleGroupItem();
  const removeItem = useRemoveSoleGroupItem();
  const copyItems = useCopySoleGroupItems();
  const { data: otherGroups = [] } = useSoleGroupsWithItems(soleGroupId);

  const sizes = rolesData?.sizes ?? [];
  const applicableRoles = useMemo(
    () => rolesForSole(soleClassification, isFachetado),
    [soleClassification, isFachetado],
  );

  // Quantas referências herdam este cadastro — é o que dá peso à edição.
  const { data: refCount = 0 } = useQuery({
    queryKey: ['sole_group_reference_count', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('technical_sheets')
        .select('id', { count: 'exact', head: true })
        .eq('sole_group_id', soleGroupId);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  // Materiais selecionáveis (tudo menos solado).
  const { data: materials = [] } = useQuery({
    queryKey: ['materials_for_sole_standard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, unit, category, color')
        .eq('active', true)
        .order('name')
        .limit(1000);
      if (error) throw error;
      return ((data || []) as any[]).filter((p) => {
        const c = (p.category || '').toLowerCase();
        return !(c.includes('solado') || c === 'sola');
      });
    },
    staleTime: 5 * 60_000,
  });

  const [roleDrafts, setRoleDrafts] = useState<Record<string, RoleDraft>>({});
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [adding, setAdding] = useState('');
  const [search, setSearch] = useState('');
  const [showCopy, setShowCopy] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [copyOverwrite, setCopyOverwrite] = useState(false);

  // Hidrata os rascunhos a partir do persistido.
  useEffect(() => {
    if (!rolesData) return;
    const next: Record<string, RoleDraft> = {};
    applicableRoles.forEach((role) => {
      const v = rolesData.byRole[role];
      next[role] = {
        perPair: v?.perPair ?? 0,
        perSize: v?.perSize ?? {},
        open: !!v?.variesBySize,
        dirty: false,
      };
    });
    setRoleDrafts(next);
  }, [rolesData, applicableRoles]);

  useEffect(() => {
    const next: Record<string, ItemDraft> = {};
    items.forEach((it) => {
      const grid = (it.consumption_per_size || {}) as Record<string, number>;
      next[it.id] = {
        perPair: Number(it.consumption_per_pair) || 0,
        perSize: grid,
        open: Object.keys(grid).length > 0,
        unit: it.unit || it.products?.unit || 'un',
        dirty: false,
      };
    });
    setItemDrafts(next);
  }, [items]);

  const patchRole = (role: SoleRole, patch: Partial<RoleDraft>) =>
    setRoleDrafts((p) => ({ ...p, [role]: { ...p[role], ...patch, dirty: true } }));

  const patchItem = (id: string, patch: Partial<ItemDraft>) =>
    setItemDrafts((p) => ({ ...p, [id]: { ...p[id], ...patch, dirty: true } }));

  /** Abrir a grade parte do valor único — nunca de células vazias. */
  const openGrid = (current: number, existing: Record<string, number>) => {
    const grid: Record<string, number> = {};
    sizes.forEach((s) => { grid[String(s)] = existing[String(s)] ?? current; });
    return grid;
  };

  const saveRole = (role: SoleRole) => {
    const d = roleDrafts[role];
    if (!d || !soleGroupId) return;
    setRole.mutate({
      soleGroupId,
      role,
      perPair: d.perPair,
      perSize: d.open ? d.perSize : {},
    });
    setRoleDrafts((p) => ({ ...p, [role]: { ...p[role], dirty: false } }));
  };

  const saveItem = (it: SoleGroupItemRow) => {
    const d = itemDrafts[it.id];
    if (!d || !soleGroupId) return;
    upsertItem.mutate({
      id: it.id,
      soleGroupId,
      materialProductId: it.material_product_id,
      perPair: d.perPair,
      perSize: d.open ? d.perSize : {},
      unit: d.unit,
      appliesTo: it.applies_to,
      displayOrder: it.display_order,
    });
    setItemDrafts((p) => ({ ...p, [it.id]: { ...p[it.id], dirty: false } }));
  };

  const handleAdd = () => {
    if (!adding || !soleGroupId) return;
    const mat = (materials as any[]).find((m) => m.id === adding);
    upsertItem.mutate({
      soleGroupId,
      materialProductId: adding,
      perPair: 0,
      unit: mat?.unit || 'un',
      displayOrder: items.length,
    });
    setAdding('');
    setSearch('');
  };

  const availableToAdd = useMemo(() => {
    const used = new Set(items.map((i) => i.material_product_id));
    const pool = (materials as any[]).filter((m) => !used.has(m.id));
    if (!search.trim()) return pool.slice(0, 80);
    return pool.filter((m) => searchMatchesAllTerms(search, m.name, m.sku, m.category)).slice(0, 80);
  }, [materials, items, search]);

  if (!soleGroupId) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground italic">
        Este solado não está vinculado a um grupo. Vincule em <strong>Estoque → Grupos</strong> para
        cadastrar o consumo padrão do modelo.
      </div>
    );
  }

  if (loadingItems || loadingRoles) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderGrid = (
    grid: Record<string, number>,
    onCell: (size: string, v: number) => void,
  ) => (
    <div className="overflow-x-auto pt-1">
      <div className="flex gap-1">
        {sizes.map((s) => (
          <div key={s} className="min-w-[58px]">
            <div className="text-center text-xs font-mono font-semibold bg-muted/60 border border-border/60 border-b-0 rounded-t py-0.5">
              {s}
            </div>
            <NumberInput
              value={grid[String(s)] ?? 0}
              onChange={(v) => onCell(String(s), Number(v) || 0)}
              step="0.01"
              min={0}
              decimals={4}
              className="h-7 w-[58px] text-center text-xs rounded-t-none"
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Package2 className="h-4 w-4 text-primary" />
            Consumo padrão do modelo
            {soleGroupName && <span className="text-muted-foreground font-normal">· {soleGroupName}</span>}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vale para <strong>todas as cores</strong> deste solado e para as{' '}
            <strong>{refCount} {refCount === 1 ? 'referência' : 'referências'}</strong> que o usam.
            A ficha técnica lista só o que é exclusivo da referência.
          </p>
        </div>
        {otherGroups.length > 0 && (
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setShowCopy(true)}>
            <Copy className="h-3.5 w-3.5" /> Copiar de outro modelo
          </Button>
        )}
      </div>

      {sizes.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Este modelo ainda não tem grade de numeração. Cadastre a grade na aba{' '}
            <strong>Cadastro</strong> antes de definir consumo que varia por tamanho.
          </span>
        </div>
      )}

      {/* ── PAPÉIS ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 border-b border-border/60 flex items-center gap-2">
          <Badge variant="outline" className="text-xs h-5 border-primary/40 text-primary">PAPEL</Badge>
          <span className="text-xs text-muted-foreground">
            O solado define a quantidade; o material vem da ficha e do pedido.
          </span>
        </div>
        <div className="divide-y divide-border/60">
          {applicableRoles.map((role) => {
            const d = roleDrafts[role];
            if (!d) return null;
            return (
              <div key={role} className="px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-semibold">{ROLE_LABEL[role]}</div>
                    <div className="text-xs text-muted-foreground font-mono">{ROLE_SOURCE[role]}</div>
                  </div>
                  {!d.open && (
                    <div className="flex items-center gap-1.5">
                      <NumberInput
                        value={d.perPair}
                        onChange={(v) => patchRole(role, { perPair: Number(v) || 0 })}
                        step="0.01"
                        min={0}
                        decimals={4}
                        className="h-8 w-24 text-right text-sm font-mono"
                      />
                      <span className="text-xs text-muted-foreground font-mono">dm²/par</span>
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={d.open}
                      onCheckedChange={(v) =>
                        patchRole(role, {
                          open: !!v,
                          perSize: v ? openGrid(d.perPair, d.perSize) : d.perSize,
                        })
                      }
                    />
                    <Ruler className="h-3.5 w-3.5" /> varia por numeração
                  </label>
                  <Button
                    size="sm"
                    variant={d.dirty ? 'default' : 'ghost'}
                    disabled={!d.dirty || setRole.isPending}
                    onClick={() => saveRole(role)}
                    className="h-8 gap-1 text-xs"
                  >
                    {setRole.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    {d.dirty ? 'Salvar' : 'Salvo'}
                  </Button>
                </div>
                {d.open && sizes.length > 0 &&
                  renderGrid(d.perSize, (size, v) =>
                    patchRole(role, { perSize: { ...d.perSize, [size]: v } }),
                  )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ITENS ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs h-5">ITEM</Badge>
            <span className="text-xs text-muted-foreground">
              O solado define o material e a quantidade — cola, linha, EVA, reforço.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger className="h-8 w-60 text-xs">
                <SelectValue placeholder="Buscar material…" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <div className="p-2 sticky top-0 bg-popover z-10 border-b border-border/50">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Nome, SKU ou categoria…"
                    onKeyDown={(e) => e.stopPropagation()}
                    inputClassName="h-7 text-xs"
                  />
                </div>
                {availableToAdd.length === 0 ? (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center italic">
                    {search ? `Nenhum resultado para "${search}"` : 'Todos os materiais já foram adicionados'}
                  </div>
                ) : (
                  availableToAdd.map((m: any) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      <div className="flex flex-col">
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {m.category}{m.color ? ` · ${m.color}` : ''} · {m.unit}
                        </span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!adding} onClick={handleAdd} className="h-8 gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nenhum item padrão neste modelo. Adicione cola, linha ou EVA acima — toda referência
            que usar este solado passa a herdar automaticamente.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {items.map((it) => {
              const d = itemDrafts[it.id];
              if (!d) return null;
              return (
                <div key={it.id} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-semibold">{it.products?.name || '—'}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {it.products?.category}
                        {it.products?.sku ? ` · SKU ${it.products.sku}` : ''}
                      </div>
                    </div>
                    {!d.open && (
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          value={d.perPair}
                          onChange={(v) => patchItem(it.id, { perPair: Number(v) || 0 })}
                          step="0.01"
                          min={0}
                          decimals={4}
                          className="h-8 w-24 text-right text-sm font-mono"
                        />
                        <Input
                          value={d.unit}
                          onChange={(e) => patchItem(it.id, { unit: e.target.value })}
                          className="h-8 w-16 text-xs"
                          aria-label="Unidade de consumo"
                        />
                        <span className="text-xs text-muted-foreground font-mono">/par</span>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={d.open}
                        onCheckedChange={(v) =>
                          patchItem(it.id, {
                            open: !!v,
                            perSize: v ? openGrid(d.perPair, d.perSize) : d.perSize,
                          })
                        }
                      />
                      <Ruler className="h-3.5 w-3.5" /> varia por numeração
                    </label>
                    <Button
                      size="sm"
                      variant={d.dirty ? 'default' : 'ghost'}
                      disabled={!d.dirty || upsertItem.isPending}
                      onClick={() => saveItem(it)}
                      className="h-8 gap-1 text-xs"
                    >
                      {upsertItem.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      {d.dirty ? 'Salvar' : 'Salvo'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem.mutate({ id: it.id, soleGroupId })}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      aria-label={`Remover ${it.products?.name || 'item'}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {d.open && sizes.length > 0 && (
                    <>
                      {renderGrid(d.perSize, (size, v) =>
                        patchItem(it.id, { perSize: { ...d.perSize, [size]: v } }),
                      )}
                      <div className="text-xs text-muted-foreground font-mono">valores em {d.unit}/par</div>
                    </>
                  )}
                  {it.notes && <div className="text-xs text-muted-foreground italic">{it.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Copiar de outro modelo */}
      <Dialog open={showCopy} onOpenChange={setShowCopy}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copiar itens de outro modelo</DialogTitle>
            <DialogDescription className="text-xs">
              Copia as linhas do tipo ITEM (cola, linha, EVA). Os papéis — forração e palmilha —
              não são copiados, porque a área depende da fôrma de cada solado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger><SelectValue placeholder="Modelo de origem…" /></SelectTrigger>
              <SelectContent>
                {otherGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    <span className="text-sm">{g.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({g.count} {g.count === 1 ? 'item' : 'itens'})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className={cn('flex items-start gap-2 p-2 rounded border bg-muted/30 cursor-pointer')}>
              <Checkbox checked={copyOverwrite} onCheckedChange={(v) => setCopyOverwrite(!!v)} className="mt-0.5" />
              <span className="text-xs">
                <strong>Substituir os itens atuais</strong>
                <span className="block text-muted-foreground mt-0.5">
                  Desmarcado, só adiciona o que falta — não duplica.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCopy(false)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={!copyFrom || copyItems.isPending}
              onClick={() =>
                copyItems.mutate(
                  { fromGroupId: copyFrom, toGroupId: soleGroupId, overwrite: copyOverwrite },
                  { onSuccess: () => { setShowCopy(false); setCopyFrom(''); setCopyOverwrite(false); } },
                )
              }
            >
              {copyItems.isPending ? 'Copiando…' : copyOverwrite ? 'Substituir e copiar' : 'Copiar faltantes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
