// GroupItemsManager — gestão dos ITENS dentro de um grupo de produtos.
// Abre a partir da página Grupos (/grupos). Permite: ver/buscar os itens do
// grupo, mover item(ns) para outro grupo, remover do grupo (group_id=null),
// adicionar itens existentes ao grupo e editar atributos do item (reusa o
// ProductFormDialog do estoque). Tudo via products.group_id (useSetProductsGroup).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  MagnifyingGlass, Plus, PencilSimple, Trash, ArrowRight, CaretLeft, Package, X, Tag, Palette,
} from '@phosphor-icons/react';
import { useProducts, useUpdateProduct, useSetProductsGroup, useBulkSetProductPrice } from '@/hooks/useProducts';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';
import QuickColorVariantDialog from '@/components/groups/QuickColorVariantDialog';
import {
  quickVariantEligibility,
  recommendVariantTemplate,
  type QuickVariantSheetPattern,
} from '@/lib/quickGroupVariant';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  group: ProductGroup | null;
  groups: ProductGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canCreate: boolean;
}

const matches = (p: Product, q: string) =>
  searchMatchesAllTerms(q, p.name, p.sku, (p as any).color);
const byName = (a: Product, b: Product) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR');

const ADD_LIMIT = 200;

export default function GroupItemsManager({ group, groups, open, onOpenChange, canEdit, canCreate }: Props) {
  const navigate = useNavigate();
  const { data: products = [] } = useProducts();
  const setGroup = useSetProductsGroup();
  const updateProduct = useUpdateProduct();
  const bulkSetPrice = useBulkSetProductPrice();

  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [bulkPrice, setBulkPrice] = useState<number>(0);
  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [quickVariantOpen, setQuickVariantOpen] = useState(false);
  const [quickVariantTemplate, setQuickVariantTemplate] = useState<Product | null>(null);
  const quickVariantTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Reset quando troca de grupo ou reabre.
  useEffect(() => {
    setMode('list'); setSearch(''); setSelected(new Set());
    setMoveTarget(''); setBulkPrice(0); setAddSearch(''); setAddSelected(new Set());
    setQuickVariantOpen(false); setQuickVariantTemplate(null);
  }, [group?.id, open]);

  const groupItems = useMemo(() => {
    if (!group) return [] as Product[];
    return (products as Product[]).filter(p => (p as any).group_id === group.id).sort(byName);
  }, [products, group]);

  const items = useMemo(() => groupItems.filter(p => matches(p, search)), [groupItems, search]);

  const candidates = useMemo(() => {
    if (!group) return [] as Product[];
    if (addSearch.trim().length < 2) return [];
    return (products as Product[]).filter(p => (p as any).group_id !== group.id && matches(p, addSearch)).sort(byName);
  }, [products, group, addSearch]);
  const candidatesShown = candidates.slice(0, ADD_LIMIT);
  const quickSheetQueryKey = useMemo(
    () => groupItems.map(item => item.id).sort().join(','),
    [groupItems],
  );
  const {
    data: quickVariantSheets = [],
    isLoading: quickVariantSheetsLoading,
    isError: quickVariantSheetsError,
  } = useQuery({
    queryKey: ['quick_variant_group_sheets', group?.id, quickSheetQueryKey],
    enabled: open && !!group?.id && groupItems.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_sheets')
        .select('product_id, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id, notes')
        .in('product_id', groupItems.map(item => item.id));
      if (error) throw error;
      return data as unknown as QuickVariantSheetPattern[];
    },
    staleTime: 60_000,
  });
  const quickSheetsByProduct = useMemo(
    () => new Map(quickVariantSheets.map(sheet => [sheet.product_id, sheet])),
    [quickVariantSheets],
  );
  const recommendedTemplate = useMemo(
    () => recommendVariantTemplate(groupItems, quickSheetsByProduct),
    [groupItems, quickSheetsByProduct],
  );
  const quickVariantReason = group
    ? quickVariantEligibility(group, groupItems)
    : 'Grupo não selecionado.';

  const otherGroups = useMemo(() => {
    const parentIds = new Set(groups.map(item => item.parent_group_id).filter(Boolean));
    return groups
      .filter(item => item.id !== group?.id && !item.is_family && !parentIds.has(item.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [groups, group]);

  if (!group) return null;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  const busy = setGroup.isPending;

  const doMove = async () => {
    if (!canEdit || !moveTarget || selected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...selected], group_id: moveTarget });
    setSelected(new Set()); setMoveTarget('');
  };
  const doRemoveSelected = async () => {
    if (!canEdit || selected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...selected], group_id: null });
    setSelected(new Set());
  };
  const doRemoveOne = async (id: string) => {
    if (!canEdit) return;
    await setGroup.mutateAsync({ ids: [id], group_id: null });
  };
  const doApplyPrice = async () => {
    if (!canEdit || selected.size === 0 || !(bulkPrice > 0)) return;
    await bulkSetPrice.mutateAsync({ ids: [...selected], unit_price: bulkPrice });
    setSelected(new Set()); setBulkPrice(0);
  };
  const doAdd = async () => {
    if (!canEdit || addSelected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...addSelected], group_id: group.id });
    setAddSelected(new Set()); setMode('list');
  };
  const openQuickVariant = (template?: Product | null, trigger?: HTMLButtonElement | null) => {
    if (!canCreate || quickVariantReason) return;
    const resolved = template || recommendedTemplate.product;
    if (!resolved) return;
    quickVariantTriggerRef.current = trigger || null;
    setQuickVariantTemplate(resolved);
    setQuickVariantOpen(true);
  };
  const allChecked = items.length > 0 && items.every(p => selected.has(p.id));
  const colCls = 'px-3 py-2 text-left';

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => {
        if (!next) setQuickVariantOpen(false);
        onOpenChange(next);
      }}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              Itens do grupo · {group.name}
            </DialogTitle>
            <DialogDescription>
              {mode === 'list'
                ? `${items.length} ${items.length === 1 ? 'item' : 'itens'} neste grupo. Crie uma nova variação, mova, remova ou edite itens.`
                : 'Busque produtos de outros grupos (ou sem grupo) e adicione a este grupo.'}
            </DialogDescription>
          </DialogHeader>

          {/* ───────── modo LISTA ───────── */}
          {mode === 'list' && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar por nome, SKU ou cor…"
                  resultCount={items.length}
                  totalCount={groupItems.length}
                  className="min-w-[220px] flex-1"
                />
                {canCreate && (
                  <Button
                    onClick={(event) => openQuickVariant(null, event.currentTarget)}
                    disabled={
                      !!quickVariantReason
                      || quickVariantSheetsLoading
                      || quickVariantSheetsError
                      || !recommendedTemplate.product
                    }
                    title={quickVariantReason
                      || (recommendedTemplate.hasTie
                        ? 'Escolha o item-modelo pelo ícone de paleta em uma linha.'
                        : `Usará ${recommendedTemplate.product?.name || 'o padrão predominante'} como modelo.`)}
                    className="h-9 gap-1.5"
                  >
                    <Palette className="h-4 w-4" /> Nova variação
                  </Button>
                )}
                {canEdit && <Button variant="outline" onClick={() => setMode('add')} className="gap-1.5 h-9">
                  <Plus className="h-4 w-4" /> Adicionar itens
                </Button>}
              </div>

              {canCreate && quickVariantReason && (
                <div className="flex items-center gap-2 border border-foreground/15 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Palette className="h-4 w-4 shrink-0" />
                  Cadastro rápido indisponível: {quickVariantReason}
                </div>
              )}
              {canCreate && quickVariantSheetsError && !quickVariantReason && (
                <div className="flex items-center gap-2 border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <Palette className="h-4 w-4 shrink-0" />
                  Não foi possível comparar as fichas do grupo. Escolha o modelo pelo ícone de paleta em uma linha.
                </div>
              )}
              {canCreate && !quickVariantSheetsLoading && !quickVariantSheetsError && !quickVariantReason && recommendedTemplate.product && recommendedTemplate.matchingCount < recommendedTemplate.totalCount && (
                <div className="flex items-center gap-2 border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <Palette className="h-4 w-4 shrink-0" />
                  O grupo tem padrões diferentes. “Nova variação” usará o padrão predominante
                  ({recommendedTemplate.matchingCount} de {recommendedTemplate.totalCount} itens). Também é possível escolher o modelo pelo ícone de paleta em cada linha.
                </div>
              )}
              {canCreate && !quickVariantSheetsLoading && !quickVariantSheetsError && !quickVariantReason && !recommendedTemplate.product && (
                <div className="flex items-center gap-2 border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <Palette className="h-4 w-4 shrink-0" />
                  Não há um padrão predominante. Escolha o item-modelo pelo ícone de paleta em uma das linhas.
                </div>
              )}

              <div className="flex-1 overflow-auto rounded-lg border border-border">
                {items.length === 0 ? (
                  <div className="p-8">
                    {search ? (
                      <EmptyState size="sm" icon={MagnifyingGlass} title={`Nenhum resultado para "${search}"`}
                        action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>} />
                    ) : (
                      <EmptyState icon={Package} title="Grupo sem itens"
                        description="Use “Adicionar itens” para trazer produtos para este grupo." />
                    )}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        {canEdit && <th className="w-8 px-3 py-2">
                          <Checkbox checked={allChecked} onCheckedChange={() => {
                            if (allChecked) setSelected(new Set());
                            else setSelected(new Set(items.map(p => p.id)));
                          }} aria-label="Selecionar todos" />
                        </th>}
                        <th className={colCls}>Item</th>
                        <th className={colCls}>SKU</th>
                        <th className={colCls}>Cor</th>
                        <th className="px-3 py-2 text-right">Estoque</th>
                        <th className="px-3 py-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(p => (
                        <tr key={p.id} className={`border-t border-border ${selected.has(p.id) ? 'bg-primary/5' : ''}`}>
                          {canEdit && <td className="px-3 py-2"><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(selected, setSelected, p.id)} /></td>}
                          <td className="px-3 py-2 font-medium text-foreground">
                            {p.name}{(p as any).active === false && <Badge variant="outline" className="ml-2 text-[10px]">inativo</Badge>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{p.sku || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{(p as any).color || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number((p as any).quantity ?? 0).toLocaleString('pt-BR')} <span className="text-muted-foreground text-xs">{(p as any).unit || ''}</span></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {canCreate && !quickVariantReason && p.active !== false && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-primary"
                                title={`Criar nova variação usando ${p.name} como modelo`}
                                onClick={(event) => openQuickVariant(p, event.currentTarget)}
                              >
                                <Palette className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar item" onClick={() => navigate(`/estoque/${p.id}`)}>
                              <PencilSimple className="h-4 w-4" />
                            </Button>}
                            {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" title="Remover do grupo" disabled={busy} onClick={() => doRemoveOne(p.id)}>
                              <X className="h-4 w-4" />
                            </Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* barra de ações em massa */}
              {canEdit && selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium">{selected.size} selecionado{selected.size === 1 ? '' : 's'}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {/* Aplicar custo unitário em massa nos itens selecionados.
                        Usa o CurrencyInput (limpa o zero ao focar). */}
                    <div className="flex items-center gap-1.5 border-r border-border pr-2">
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Custo</span>
                      <div className="w-32">
                        <CurrencyInput value={bulkPrice} onChange={setBulkPrice} className="h-8 text-xs" />
                      </div>
                      <Button size="sm" className="h-8 gap-1.5" disabled={!(bulkPrice > 0) || bulkSetPrice.isPending} onClick={doApplyPrice}>
                        <Tag className="h-3.5 w-3.5" /> Aplicar
                      </Button>
                    </div>
                    <Select value={moveTarget} onValueChange={setMoveTarget}>
                      <SelectTrigger className="h-8 w-52"><SelectValue placeholder="Mover para o grupo…" /></SelectTrigger>
                      <SelectContent>
                        {otherGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 gap-1.5" disabled={!moveTarget || busy} onClick={doMove}>
                      <ArrowRight className="h-3.5 w-3.5" /> Mover
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={doRemoveSelected}>
                      <Trash className="h-3.5 w-3.5" /> Remover do grupo
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected(new Set())}>Limpar</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ───────── modo ADICIONAR ───────── */}
          {canEdit && mode === 'add' && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setMode('list'); setAddSelected(new Set()); }}>
                  <CaretLeft className="h-4 w-4" /> Voltar
                </Button>
                <SearchInput
                  autoFocus
                  value={addSearch}
                  onChange={setAddSearch}
                  placeholder="Buscar produto por nome, SKU ou cor (mín. 2 letras)…"
                  className="flex-1"
                />
              </div>

              <div className="flex-1 overflow-auto rounded-lg border border-border">
                {addSearch.trim().length < 2 ? (
                  <div className="p-8"><EmptyState icon={MagnifyingGlass} title="Busque para adicionar" description="Digite ao menos 2 letras para listar produtos de outros grupos (ou sem grupo)." /></div>
                ) : candidatesShown.length === 0 ? (
                  <div className="p-8">
                    <EmptyState size="sm" icon={MagnifyingGlass} title={`Nenhum resultado para "${addSearch}"`}
                      description="Nenhum produto fora deste grupo casa com a busca."
                      action={<Button variant="outline" size="sm" onClick={() => setAddSearch('')}>Limpar busca</Button>} />
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="w-8 px-3 py-2" /><th className={colCls}>Item</th><th className={colCls}>SKU</th><th className={colCls}>Grupo atual</th></tr>
                    </thead>
                    <tbody>
                      {candidatesShown.map(p => {
                        const g = groups.find(x => x.id === (p as any).group_id);
                        return (
                          <tr key={p.id} className={`border-t border-border cursor-pointer ${addSelected.has(p.id) ? 'bg-primary/5' : ''}`} onClick={() => toggle(addSelected, setAddSelected, p.id)}>
                            <td className="px-3 py-2"><Checkbox checked={addSelected.has(p.id)} onCheckedChange={() => toggle(addSelected, setAddSelected, p.id)} /></td>
                            <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{p.sku || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{g ? g.name : <span className="italic">sem grupo</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex items-center gap-2">
                {candidates.length > ADD_LIMIT && <span className="text-xs text-muted-foreground">Mostrando {ADD_LIMIT} de {candidates.length} — refine a busca.</span>}
                <Button className="ml-auto gap-1.5" disabled={addSelected.size === 0 || busy} onClick={doAdd}>
                  <Plus className="h-4 w-4" /> Adicionar {addSelected.size > 0 ? addSelected.size : ''} {addSelected.size === 1 ? 'item' : 'itens'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {group && (
        <QuickColorVariantDialog
          group={group}
          template={quickVariantTemplate}
          products={groupItems}
          open={quickVariantOpen}
          onOpenChange={(next) => {
            setQuickVariantOpen(next);
            if (!next) {
              setQuickVariantTemplate(null);
              const trigger = quickVariantTriggerRef.current;
              quickVariantTriggerRef.current = null;
              window.requestAnimationFrame(() => trigger?.focus());
            }
          }}
          onCreated={() => {
            setSelected(new Set());
            setSearch('');
          }}
        />
      )}

    </>
  );
}
