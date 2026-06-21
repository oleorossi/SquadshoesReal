// GroupItemsManager — gestão dos ITENS dentro de um grupo de produtos.
// Abre a partir da página Grupos (/grupos). Permite: ver/buscar os itens do
// grupo, mover item(ns) para outro grupo, remover do grupo (group_id=null),
// adicionar itens existentes ao grupo e editar atributos do item (reusa o
// ProductFormDialog do estoque). Tudo via products.group_id (useSetProductsGroup).
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  MagnifyingGlass, Plus, PencilSimple, Trash, ArrowRight, CaretLeft, Package, X, Tag,
} from '@phosphor-icons/react';
import { useProducts, useUpdateProduct, useSetProductsGroup, useBulkSetProductPrice } from '@/hooks/useProducts';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product, ProductFormData } from '@/types/inventory';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';

interface Props {
  group: ProductGroup | null;
  groups: ProductGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase();
const matches = (p: Product, q: string) =>
  !q || norm(p.name).includes(q) || norm(p.sku).includes(q) || norm((p as any).color).includes(q);
const byName = (a: Product, b: Product) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR');

const ADD_LIMIT = 200;

export default function GroupItemsManager({ group, groups, open, onOpenChange }: Props) {
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
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Reset quando troca de grupo ou reabre.
  useEffect(() => {
    setMode('list'); setSearch(''); setSelected(new Set());
    setMoveTarget(''); setBulkPrice(0); setAddSearch(''); setAddSelected(new Set());
  }, [group?.id, open]);

  const items = useMemo(() => {
    if (!group) return [];
    const q = norm(search);
    return (products as Product[]).filter(p => (p as any).group_id === group.id && matches(p, q)).sort(byName);
  }, [products, group, search]);

  const candidates = useMemo(() => {
    if (!group) return [] as Product[];
    const q = norm(addSearch);
    if (q.length < 2) return [];
    return (products as Product[]).filter(p => (p as any).group_id !== group.id && matches(p, q)).sort(byName);
  }, [products, group, addSearch]);
  const candidatesShown = candidates.slice(0, ADD_LIMIT);

  const otherGroups = useMemo(() => groups.filter(g => g.id !== group?.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [groups, group]);

  if (!group) return null;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };
  const busy = setGroup.isPending;

  const doMove = async () => {
    if (!moveTarget || selected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...selected], group_id: moveTarget });
    setSelected(new Set()); setMoveTarget('');
  };
  const doRemoveSelected = async () => {
    if (selected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...selected], group_id: null });
    setSelected(new Set());
  };
  const doRemoveOne = async (id: string) => { await setGroup.mutateAsync({ ids: [id], group_id: null }); };
  const doApplyPrice = async () => {
    if (selected.size === 0 || !(bulkPrice > 0)) return;
    await bulkSetPrice.mutateAsync({ ids: [...selected], unit_price: bulkPrice });
    setSelected(new Set()); setBulkPrice(0);
  };
  const doAdd = async () => {
    if (addSelected.size === 0) return;
    await setGroup.mutateAsync({ ids: [...addSelected], group_id: group.id });
    setAddSelected(new Set()); setMode('list');
  };
  const handleEditSubmit = async (data: ProductFormData) => {
    if (!editingProduct) return;
    await updateProduct.mutateAsync({ id: editingProduct.id, data: data as any });
    setEditOpen(false); setEditingProduct(null);
  };

  const allChecked = items.length > 0 && items.every(p => selected.has(p.id));
  const colCls = 'px-3 py-2 text-left';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              Itens do grupo · {group.name}
            </DialogTitle>
            <DialogDescription>
              {mode === 'list'
                ? `${items.length} ${items.length === 1 ? 'item' : 'itens'} neste grupo. Mova, remova ou edite; ou adicione itens existentes.`
                : 'Busque produtos de outros grupos (ou sem grupo) e adicione a este grupo.'}
            </DialogDescription>
          </DialogHeader>

          {/* ───────── modo LISTA ───────── */}
          {mode === 'list' && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, SKU ou cor…" className="pl-8 h-9" />
                </div>
                <Button onClick={() => setMode('add')} className="gap-1.5 h-9">
                  <Plus className="h-4 w-4" /> Adicionar itens
                </Button>
              </div>

              <div className="flex-1 overflow-auto rounded-lg border border-border">
                {items.length === 0 ? (
                  <div className="p-8">
                    <EmptyState icon={Package} title={search ? 'Nenhum item encontrado' : 'Grupo sem itens'}
                      description={search ? 'Ajuste a busca.' : 'Use “Adicionar itens” para trazer produtos para este grupo.'} />
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-8 px-3 py-2">
                          <Checkbox checked={allChecked} onCheckedChange={() => {
                            if (allChecked) setSelected(new Set());
                            else setSelected(new Set(items.map(p => p.id)));
                          }} aria-label="Selecionar todos" />
                        </th>
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
                          <td className="px-3 py-2"><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(selected, setSelected, p.id)} /></td>
                          <td className="px-3 py-2 font-medium text-foreground">
                            {p.name}{(p as any).active === false && <Badge variant="outline" className="ml-2 text-[10px]">inativo</Badge>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{p.sku || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{(p as any).color || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number((p as any).quantity ?? 0).toLocaleString('pt-BR')} <span className="text-muted-foreground text-xs">{(p as any).unit || ''}</span></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar item" onClick={() => { setEditingProduct(p); setEditOpen(true); }}>
                              <PencilSimple className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" title="Remover do grupo" disabled={busy} onClick={() => doRemoveOne(p.id)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* barra de ações em massa */}
              {selected.size > 0 && (
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
          {mode === 'add' && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setMode('list'); setAddSelected(new Set()); }}>
                  <CaretLeft className="h-4 w-4" /> Voltar
                </Button>
                <div className="relative flex-1">
                  <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input autoFocus value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Buscar produto por nome, SKU ou cor (mín. 2 letras)…" className="pl-8 h-9" />
                </div>
              </div>

              <div className="flex-1 overflow-auto rounded-lg border border-border">
                {addSearch.trim().length < 2 ? (
                  <div className="p-8"><EmptyState icon={MagnifyingGlass} title="Busque para adicionar" description="Digite ao menos 2 letras para listar produtos de outros grupos (ou sem grupo)." /></div>
                ) : candidatesShown.length === 0 ? (
                  <div className="p-8"><EmptyState icon={Package} title="Nenhum produto encontrado" description="Nenhum produto fora deste grupo casa com a busca." /></div>
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

      {/* editor de item (reusa o form do estoque) */}
      <ProductFormDialog
        open={editOpen}
        onOpenChange={(o) => { setEditOpen(o); if (!o) setEditingProduct(null); }}
        onSubmit={handleEditSubmit}
        product={editingProduct}
        defaultGroupId={group.id}
      />
    </>
  );
}
